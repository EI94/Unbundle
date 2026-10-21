import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { getStrategicGoalsByWorkspace } from "@/lib/db/queries/workspaces";
import { organizations, type Activity, type StrategicGoal, type UseCase } from "@/lib/db/schema";
import { logSafeError } from "@/lib/log/safe-error";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";
import {
  ACTIVITY_MAPPING_TEXT,
  activityMappingItems,
  activityMappingState,
  quickCreateItem,
  quickFieldErrors,
  readQuickCreate,
} from "./create";
import type { FieldErrors } from "./inputs";
import {
  MAX_CREATE_ITEMS,
  SERVICE_MESSAGES,
  createUseCases,
  creationFollowUps,
  type CreatedUseCase,
  type NewUseCaseItem,
  type WriteContext,
} from "./service";
import type { ServiceError, ServiceResult, UseCaseSource } from "./types";

/**
 * Nuovo use case e Activity mapping: le scritture (docs/use-case/DESIGN.md §5, §8.1, §8.5,
 * §9.1 passo 6, §9.2; PIANO-LAVORI H3c).
 *
 * Il cuore delle tre action di `src/lib/actions/use-case-create.ts` e di
 * `generateUseCasesAction`, fuori dalle action perché lo provino le suite d'integrazione con
 * trasporti finti. Ogni scheda nasce da `createUseCases` del servizio, che controlla permessi,
 * campi, origine e «nascosta alla ricerca» e assegna il codice subito.
 *
 * - **Dopo la risposta** (passo 6): valutazione dell'AI e notifiche, solo per i canali che le
 *   prevedono (`creationFollowUps`): il modulo completo sì, il pannello rapido e Activity
 *   mapping no. Le programma `deps.schedule` (nell'action: `after()` di Next); un errore
 *   dell'una non ferma l'altra e nel log va solo il nome dell'errore.
 * - **Activity mapping**: prima i permessi (solo i revisori, prima di chiamare il modello),
 *   poi le attività, poi il generatore (`deps.generate`), poi il servizio a lotti.
 */

const LOG_SCOPE = "use-case-create";

/** La nota dell'auto-ranking, come oggi per il modulo web e per il connettore. */
const AUTO_RANKING_LABEL = "Auto-ranking AI";

/** Chi scrive dalla pagina: id, ruolo letto e «Lateral Space». Il servizio li rilegge comunque. */
export interface PageWriter {
  userId: string;
  role: string | null;
  isLateralSpace: boolean;
}

/** Il contesto di una scrittura dalla pagina (`pagina`) o da Activity mapping (`activity_mapping`). */
export function writeContextFor(
  workspaceId: string,
  writer: PageWriter,
  channel: Extract<WriteContext["channel"], "pagina" | "activity_mapping"> = "pagina",
): WriteContext {
  return {
    workspaceId,
    actor: { userId: writer.userId, role: writer.role, isLateralSpace: writer.isLateralSpace, kind: "persona" },
    channel,
  };
}

// ─── Dopo la risposta (passo 6) ──────────────────────────────────────

/** I trasporti di valutazione e notifiche. Nell'action: `after`, l'auto-ranking e le notifiche di oggi. */
export interface CreateFollowUpDeps {
  schedule: (task: () => Promise<void>) => void;
  autoScore: (params: {
    workspaceId: string;
    useCaseId: string;
    reviewedBy: null;
    noteLabel: string;
    onlyIfUntouched: true;
  }) => Promise<UseCase>;
  notify: (params: { useCase: UseCase; workspaceId: string; source: "web" | "slack" | "claude" }) => Promise<void>;
  loadUseCase: (useCaseId: string) => Promise<UseCase | null>;
}

function notifySource(source: UseCaseSource): "web" | "slack" | "claude" {
  if (source === "web_proposed") return "web";
  if (source === "slack_proposed") return "slack";
  return "claude";
}

/**
 * Programma valutazione e notifiche della scheda appena creata, se il canale le prevede.
 * L'auto-ranking valuta solo una scheda ancora intatta (`onlyIfUntouched`) e non firma
 * `reviewed_by`; la notifica parte anche se l'auto-ranking fallisce, con la scheda riletta.
 */
function scheduleFollowUps(
  workspaceId: string,
  source: UseCaseSource,
  useCaseId: string,
  writer: Pick<PageWriter, "isLateralSpace">,
  deps: CreateFollowUpDeps,
): void {
  const plan = creationFollowUps(source, writer);
  if (!plan.aiValuation && !plan.notifications) return;
  deps.schedule(async () => {
    let current: UseCase | null = null;
    if (plan.aiValuation) {
      try {
        current = await deps.autoScore({ workspaceId, useCaseId, reviewedBy: null, noteLabel: AUTO_RANKING_LABEL, onlyIfUntouched: true });
      } catch (error) {
        logSafeError(LOG_SCOPE, "auto_ranking_failed", error, { useCaseId });
      }
    }
    if (plan.notifications) {
      try {
        current ??= await deps.loadUseCase(useCaseId);
        if (current) await deps.notify({ useCase: current, workspaceId, source: notifySource(source) });
      } catch (error) {
        logSafeError(LOG_SCOPE, "notify_failed", error, { useCaseId });
      }
    }
  });
}

/**
 * Crea una scheda con il servizio e programma ciò che il suo canale prevede dopo la risposta.
 * Lo usano il pannello rapido (nessun seguito) e il modulo completo (valutazione e notifiche).
 */
export async function createUseCaseWithFollowUps(
  ctx: WriteContext,
  item: NewUseCaseItem,
  deps: CreateFollowUpDeps,
  writer: Pick<PageWriter, "isLateralSpace">,
): Promise<ServiceResult<CreatedUseCase>> {
  const result = await createUseCases(ctx, [item]);
  if (!result.ok) return result;
  const [created] = result.value;
  scheduleFollowUps(ctx.workspaceId, item.source, created.id, writer, deps);
  return { ok: true, value: created };
}

// ─── Pannello rapido (§5.2) ──────────────────────────────────────────

export type QuickCreateOutcome =
  | { ok: true; value: CreatedUseCase }
  | { ok: false; error: ServiceError; message: string; fieldErrors: FieldErrors };

/**
 * «Salva» e «Salva e aggiungi un altro» del pannello rapido: `source = manual`, nessun
 * proponente, codice subito; nascosta ai colleghi se l'origine è «AI Transformation». Solo
 * Lateral Space con ruolo da revisore (lo decide il servizio). Gli errori per campo hanno i
 * nomi dei campi del pannello.
 */
export async function createQuickUseCase(
  ctx: WriteContext,
  input: unknown,
  deps: CreateFollowUpDeps,
  writer: Pick<PageWriter, "isLateralSpace">,
): Promise<QuickCreateOutcome> {
  const checked = readQuickCreate(input);
  if (!checked.ok) {
    return { ok: false, error: "dati_non_validi", message: SERVICE_MESSAGES.dati_non_validi, fieldErrors: checked.fieldErrors };
  }
  const result = await createUseCaseWithFollowUps(ctx, quickCreateItem(checked.value), deps, writer);
  if (!result.ok) return { ok: false, error: result.error, message: result.message, fieldErrors: quickFieldErrors(result.fieldErrors) };
  return result;
}

// ─── Activity mapping (§8.5) ─────────────────────────────────────────

/** Il generatore di oggi (`generateUseCases`): le attività classificate e il contesto strategico. */
export interface ActivityMappingDeps {
  generate: (
    activities: Activity[],
    context: { companyValueThesis: unknown; goals: StrategicGoal[] },
    includeEsg: boolean,
  ) => Promise<readonly unknown[]>;
}

/**
 * Quando si può proporre. `tutte_classificate` (la pagina «Use case», §8.5): nessuna attività
 * da classificare. `almeno_una` (la pagina di oggi, `generateUseCasesAction`): basta
 * un'attività classificata, come prima.
 */
export type ActivityMappingRule = "tutte_classificate" | "almeno_una";

/** Il messaggio di oggi della pagina «Use cases» senza attività classificate. */
export const NO_CLASSIFIED_ACTIVITIES_ERROR = "Nessuna attività classificata. Esegui prima la classificazione.";

export type ActivityMappingOutcome =
  | { ok: true; created: CreatedUseCase[] }
  | { ok: false; error: ServiceError | "da_classificare"; message: string };

/**
 * «Proponi da Activity mapping» (§8.5) e il pulsante della pagina di oggi: Claude legge le
 * attività classificate e propone use case, che nascono bozze «AI Transformation», nascoste ai
 * colleghi, senza notifiche e mai approvate. Il modello si chiama solo per un revisore e solo
 * con le attività pronte.
 */
export async function proposeFromActivityMapping(
  ctx: WriteContext,
  deps: ActivityMappingDeps,
  opts: { rule: ActivityMappingRule },
): Promise<ActivityMappingOutcome> {
  const userId = ctx.actor.userId;
  const access = ctx.actor.kind === "persona" && userId ? await getCollaboratorAccess(userId, ctx.workspaceId) : null;
  if (!access || !canReviewWorkspacePortfolio(access.role)) {
    return { ok: false, error: "permesso_mancante", message: SERVICE_MESSAGES.permesso_mancante };
  }

  const activities = await getActivitiesByWorkspace(ctx.workspaceId);
  const classified = activities.filter((activity) => Boolean(activity.classification));
  if (opts.rule === "tutte_classificate") {
    if (activityMappingState({ total: activities.length, classified: classified.length }) !== "pronto") {
      return { ok: false, error: "da_classificare", message: ACTIVITY_MAPPING_TEXT.classifyFirst };
    }
  } else if (classified.length === 0) {
    return { ok: false, error: "da_classificare", message: NO_CLASSIFIED_ACTIVITIES_ERROR };
  }

  const workspace = access.workspace;
  const includeEsg = workspace.esgEnabled === true;
  const [goals, [org]] = await Promise.all([
    getStrategicGoalsByWorkspace(ctx.workspaceId),
    db
      .select({ companyValueThesis: organizations.companyValueThesis })
      .from(organizations)
      .where(eq(organizations.id, workspace.organizationId))
      .limit(1),
  ]);

  let generated: readonly unknown[];
  try {
    generated = await deps.generate(classified, { companyValueThesis: org?.companyValueThesis, goals }, includeEsg);
  } catch (error) {
    logSafeError(LOG_SCOPE, "activity_mapping_generate_failed", error, { workspaceId: ctx.workspaceId });
    return { ok: false, error: "riprova", message: ACTIVITY_MAPPING_TEXT.error };
  }

  const items = activityMappingItems(Array.isArray(generated) ? generated : [], { includeEsg });
  const created: CreatedUseCase[] = [];
  for (let start = 0; start < items.length; start += MAX_CREATE_ITEMS) {
    const result = await createUseCases(ctx, items.slice(start, start + MAX_CREATE_ITEMS));
    if (!result.ok) return { ok: false, error: result.error, message: result.message };
    created.push(...result.value);
  }
  return { ok: true, created };
}
