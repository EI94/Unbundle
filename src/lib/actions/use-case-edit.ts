"use server";

/**
 * Server action della scheda «Use case» (docs/use-case/DESIGN.md §6.2, §6.3, §6.8, §7.6, §9.1;
 * PIANO-LAVORI H4b):
 * - `updateUseCaseFieldAction`: un campo di «Cosa è», modificato sul posto (titolo, testi,
 *   area, AI Lab, impatto ambientale e sociale) e «Possibile doppione di» in «Dettagli»;
 * - `saveValuationAction`: «Salva la valutazione» (KPI del modello del workspace, valore
 *   all'anno, costo come importo o fascia);
 * - `requestAiSuggestionAction`: «Chiedi un nuovo suggerimento», che scrive solo
 *   `ai_suggestion` (§7.6 regola 3) e non cambia `version`;
 * - `redactTextAction`: «Oscura testo».
 *
 * Ogni action è un endpoint raggiungibile con una POST diretta, quindi rifà da sé tutto:
 * ingresso validato, sessione (`requireSession`), accesso al workspace
 * (`getCollaboratorAccess`, che esclude chi segue solo un corso), area accesa per il workspace.
 * Poi passa dal servizio unico (`service.ts`, canale `pagina`), che rilegge ruolo e «Lateral
 * Space» e applica le regole: modificano «Cosa è» e «Valutazione» tutti i revisori; «Oscura
 * testo» lo usano Lateral Space con ruolo da revisore e chi gestisce il workspace.
 *
 * La risposta porta solo la nuova `version` e un eventuale toast, oppure l'errore del servizio
 * (per `versione_superata` il testo esatto di §6.8: la pagina ricarica i dati e il testo
 * scritto resta nel campo). Dopo una scrittura, e dopo una versione superata,
 * `revalidatePath` su `/use-cases` e `/use-cases/<id>`. Nessun testo delle schede nei log.
 */
import { revalidatePath } from "next/cache";
import type { Session } from "@/lib/auth";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { getOrCreateWorkspaceScoringModel } from "@/lib/db/queries/scoring-model";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { getUseCaseById } from "@/lib/db/queries/use-cases";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { logSafeError } from "@/lib/log/safe-error";
import { generatePortfolioScoresWithAi } from "@/lib/portfolio/ai-ranking";
import { INVALID_DECISION_INPUT, isActionTarget, toActionResult, type DecisionActionResult } from "@/lib/use-cases/decision-ui";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import {
  REDACTABLE_FIELDS,
  SERVICE_MESSAGES,
  recordAiSuggestion,
  redactText,
  saveValuation,
  updateUseCase,
  type RedactableField,
  type ServiceError,
  type WriteContext,
} from "@/lib/use-cases/service";
import { getCollaboratorAccess, type WorkspaceAccess } from "@/lib/workspace-access";

/**
 * I campi che la scheda modifica sul posto (§6.2): i testi di «Cosa è», area, AI Lab, impatto
 * ambientale e sociale, e «Possibile doppione di» in «Dettagli». Origine, tipo e nota pubblica
 * hanno i loro controlli; la nota pubblica sta in «Decisione» (`savePublicNoteAction`).
 */
const EDITABLE_FIELDS = [
  "title",
  "description",
  "flowDescription",
  "humanInTheLoop",
  "guardrails",
  "businessCase",
  "dataRequirements",
  "sustainabilityImpact",
  "area",
  "aiLab",
  "possibleDuplicateOf",
] as const;

export type EditableUseCaseField = (typeof EDITABLE_FIELDS)[number];

/** Un testo che la pagina non manderebbe mai: oltre il doppio del limite più lungo (4.000). */
const FIELD_VALUE_MAX = 8_000;

/** Il toast di «Oscura testo» (§6.8, §14.3). */
const REDACTED_TOAST = "Testo oscurato.";
/** Il toast dopo «Chiedi un nuovo suggerimento». */
const AI_SUGGESTION_TOAST = "Suggerimento AI aggiornato.";
/** Il modello non ha risposto (rete, chiave, risposta non valida). */
const AI_SUGGESTION_FAILED = "Suggerimento AI non disponibile. Riprova tra un momento.";

function failure(error: ServiceError, message: string = SERVICE_MESSAGES[error]): DecisionActionResult {
  return { ok: false, error, message };
}

function isEditableField(value: unknown): value is EditableUseCaseField {
  return typeof value === "string" && (EDITABLE_FIELDS as readonly string[]).includes(value);
}

/**
 * Il contesto di scrittura della persona in sessione, con l'accesso al workspace appena
 * riletto da chi chiama (`getCollaboratorAccess`, nel corpo di ogni action), per la pagina
 * dell'area accesa.
 */
function pageContext(
  workspaceId: string,
  session: Session,
  access: WorkspaceAccess | null,
): { ok: true; ctx: WriteContext; canEditValuation: boolean } | { ok: false; result: DecisionActionResult } {
  if (!access) return { ok: false, result: failure("permesso_mancante") };
  if (!isUseCaseHubWorkspace(workspaceId)) return { ok: false, result: failure("area_spenta") };
  const viewer = viewerFromSession(session.user, access.role);
  return {
    ok: true,
    ctx: {
      workspaceId,
      // Ruolo e «Lateral Space» li rilegge il servizio: qui non danno permessi.
      actor: { userId: session.user.id, role: access.role, isLateralSpace: viewer.isLateralSpace, kind: "persona" },
      channel: "pagina",
    },
    canEditValuation: abilitiesForUseCase(viewer).canEditValuation,
  };
}

function revalidatePages(workspaceId: string, useCaseId: string): void {
  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId}`);
}

/** La pagina e la scheda si rileggono dopo una scrittura, o quando la versione era vecchia. */
function revalidateUseCase(workspaceId: string, useCaseId: string, result: DecisionActionResult): DecisionActionResult {
  if (result.ok || result.error === "versione_superata") revalidatePages(workspaceId, useCaseId);
  return result;
}

/**
 * Un campo di «Cosa è» (o «Possibile doppione di»), salvato sul posto: Invio salva, Esc
 * annulla (§6.2). Un testo vuoto toglie il valore, tranne il titolo. Gli errori del campo
 * tornano con il nome del campo (`fieldErrors[field]`).
 */
export async function updateUseCaseFieldAction(
  workspaceId: string,
  useCaseId: string,
  expectedVersion: number,
  field: unknown,
  value: unknown,
): Promise<DecisionActionResult> {
  if (!isActionTarget(workspaceId, useCaseId, expectedVersion)) return failure("non_trovato");
  if (!isEditableField(field)) return failure("dati_non_validi", INVALID_DECISION_INPUT);
  if (value !== null && (typeof value !== "string" || value.length > FIELD_VALUE_MAX)) return failure("dati_non_validi", INVALID_DECISION_INPUT);
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return page.result;
  const result = await updateUseCase(page.ctx, useCaseId, expectedVersion, { [field]: value });
  return revalidateUseCase(workspaceId, useCaseId, toActionResult(result, null));
}

/**
 * «Salva la valutazione» (§6.3): `{ kpis, valueEurYear, cost }`. KPI da 1 a 5 o vuoti
 * («Nessun valore», che non vuol dire zero), valore all'anno in euro, costo come importo o
 * fascia, mai entrambi. Salvare porta la scheda a «valutata», salvo le archiviate.
 */
export async function saveValuationAction(
  workspaceId: string,
  useCaseId: string,
  expectedVersion: number,
  valuation: unknown,
): Promise<DecisionActionResult> {
  if (!isActionTarget(workspaceId, useCaseId, expectedVersion)) return failure("non_trovato");
  if (!valuation || typeof valuation !== "object" || Array.isArray(valuation)) return failure("dati_non_validi", INVALID_DECISION_INPUT);
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return page.result;
  const result = await saveValuation(page.ctx, useCaseId, expectedVersion, valuation as Parameters<typeof saveValuation>[3]);
  return revalidateUseCase(workspaceId, useCaseId, toActionResult(result, null));
}

/**
 * «Chiedi un nuovo suggerimento» (§6.3, §7.6): il modello legge la scheda e propone punteggi e
 * motivazione; si scrive solo `ai_suggestion` (mai `custom_scores`, `reviewed_by`, le note),
 * quindi `version` non cambia e «Salva la valutazione» con la versione di prima va a buon fine.
 * Se la scheda cambia mentre il modello risponde, il suggerimento non si salva e la pagina si
 * rilegge (versione superata).
 */
export async function requestAiSuggestionAction(workspaceId: string, useCaseId: string, expectedVersion: number): Promise<DecisionActionResult> {
  if (!isActionTarget(workspaceId, useCaseId, expectedVersion)) return failure("non_trovato");
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return page.result;
  // Prima del modello, che costa: il servizio rifà il controllo quando scrive.
  if (!page.canEditValuation) return failure("permesso_mancante");
  const useCase = await getUseCaseById(useCaseId);
  if (!useCase || useCase.workspaceId !== workspaceId) return failure("non_trovato");
  if (useCase.version !== expectedVersion) return revalidateUseCase(workspaceId, useCaseId, failure("versione_superata"));

  let suggestion: Awaited<ReturnType<typeof generatePortfolioScoresWithAi>>;
  try {
    const [workspace, model] = await Promise.all([getWorkspaceById(workspaceId), getOrCreateWorkspaceScoringModel(workspaceId)]);
    if (!workspace) return failure("non_trovato");
    suggestion = await generatePortfolioScoresWithAi({
      workspaceName: workspace.name,
      useCase,
      config: model.resolvedConfig,
      esgEnabled: workspace.esgEnabled === true,
    });
  } catch (error) {
    logSafeError("use-case-edit", "ai_suggestion_failed", error);
    return failure("riprova", AI_SUGGESTION_FAILED);
  }

  const result = await recordAiSuggestion(
    page.ctx,
    useCaseId,
    { kind: "suggerimento", scores: suggestion.customScores, rationale: suggestion.rationale, model: suggestion.model },
    { expectedVersion },
  );
  if (!result.ok) return revalidateUseCase(workspaceId, useCaseId, failure(result.error, result.message));
  if (!result.value.written) return revalidateUseCase(workspaceId, useCaseId, failure("versione_superata"));
  return revalidateUseCase(workspaceId, useCaseId, { ok: true, version: expectedVersion, message: AI_SUGGESTION_TOAST });
}

/**
 * «Oscura testo» (§6.8): i testi scelti diventano «[testo rimosso]» e non restano in
 * Unbundle (scheda, segnali della campanella, Storia senza testi). Non si torna indietro.
 */
export async function redactTextAction(
  workspaceId: string,
  useCaseId: string,
  expectedVersion: number,
  fields: unknown,
): Promise<DecisionActionResult> {
  if (!isActionTarget(workspaceId, useCaseId, expectedVersion)) return failure("non_trovato");
  if (
    !Array.isArray(fields) ||
    fields.length === 0 ||
    fields.length > REDACTABLE_FIELDS.length ||
    fields.some((field) => typeof field !== "string" || !(REDACTABLE_FIELDS as readonly string[]).includes(field))
  ) {
    return failure("dati_non_validi", INVALID_DECISION_INPUT);
  }
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return page.result;
  const result = await redactText(page.ctx, useCaseId, expectedVersion, fields as RedactableField[]);
  return revalidateUseCase(workspaceId, useCaseId, toActionResult(result, REDACTED_TOAST));
}
