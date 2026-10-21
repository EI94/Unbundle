"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import type { Session } from "@/lib/auth";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { generateUseCases } from "@/lib/ai/generate-use-cases";
import { getUseCaseById } from "@/lib/db/queries/use-cases";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { dispatchNewPortfolioNotifications } from "@/lib/notifications/portfolio-dispatch";
import { autoScorePortfolioUseCase } from "@/lib/portfolio/ai-ranking";
import {
  FORM_TEXT,
  QUICK_CREATE_TEXT,
  activityMappingPath,
  parseUseCaseForm,
  proposedToast,
  receiptPath,
  savedToast,
} from "@/lib/use-cases/create";
import {
  createQuickUseCase,
  createUseCaseWithFollowUps,
  proposeFromActivityMapping,
  writeContextFor,
  type CreateFollowUpDeps,
  type PageWriter,
} from "@/lib/use-cases/create-flow";
import { abilitiesForUseCase, type UseCaseAbilities } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { SERVICE_MESSAGES } from "@/lib/use-cases/service";
import { getCollaboratorAccess, type WorkspaceAccess } from "@/lib/workspace-access";

/**
 * Server action di «Nuovo use case» e di «Proponi da Activity mapping» (docs/use-case/DESIGN.md
 * §5, §8.5, §9.1; PIANO-LAVORI H3c, §9 punto 5). Tutte con `requireSession`,
 * `getCollaboratorAccess` e area accesa per il workspace; le scritture passano dal servizio
 * (`create-flow.ts`, che chiama `createUseCases`). Valutazione dell'AI e notifiche del modulo
 * completo partono dopo la risposta, con `after()`.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type PageActor =
  | {
      ok: true;
      user: Session["user"];
      abilities: UseCaseAbilities;
      writer: PageWriter;
      esgEnabled: boolean;
    }
  | { ok: false; message: string };

/**
 * Chi scrive, con l'accesso appena riletto da ogni action (`getCollaboratorAccess`, in testa
 * all'action: `workspace-isolation.test.ts`); solo nei workspace con l'area accesa.
 */
function pageActor(session: Session, workspaceId: string, access: WorkspaceAccess | null): PageActor {
  if (!UUID.test(workspaceId)) return { ok: false, message: SERVICE_MESSAGES.non_trovato };
  if (!isUseCaseHubWorkspace(workspaceId)) return { ok: false, message: SERVICE_MESSAGES.area_spenta };
  if (!access) return { ok: false, message: SERVICE_MESSAGES.permesso_mancante };
  const viewer = viewerFromSession(session.user, access.role);
  const abilities = abilitiesForUseCase(viewer);
  if (!abilities.canOpenArea) return { ok: false, message: SERVICE_MESSAGES.permesso_mancante };
  return {
    ok: true,
    user: session.user,
    abilities,
    writer: { userId: session.user.id, role: access.role, isLateralSpace: viewer.isLateralSpace },
    esgEnabled: access.workspace.esgEnabled === true,
  };
}

/** Valutazione dell'AI e notifiche dopo la risposta, con i trasporti di oggi. */
function followUpDeps(): CreateFollowUpDeps {
  return {
    schedule: (task) => after(task),
    autoScore: (params) => autoScorePortfolioUseCase(params),
    notify: (params) => dispatchNewPortfolioNotifications(params),
    loadUseCase: (useCaseId) => getUseCaseById(useCaseId),
  };
}

function revalidateUseCases(workspaceId: string, useCaseId?: string) {
  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  if (useCaseId) revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId}`);
}

// ─── Pannello rapido (§5.2) ──────────────────────────────────────────

export type QuickCreateActionResult =
  | { ok: true; id: string; code: string | null; message: string }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

/**
 * «Salva» e «Salva e aggiungi un altro» del pannello rapido (solo Lateral Space con ruolo da
 * revisore): `source = manual`, nessun proponente, codice subito, nessuna valutazione dell'AI
 * e nessuna notifica. `input`: `{ title, problem, aiLab, origin, kind }`.
 */
export async function createQuickUseCaseAction(workspaceId: string, input: unknown): Promise<QuickCreateActionResult> {
  const session = await requireSession();
  const access = UUID.test(workspaceId) ? await getCollaboratorAccess(session.user.id, workspaceId) : null;
  const actor = pageActor(session, workspaceId, access);
  if (!actor.ok) return { ok: false, message: actor.message, fieldErrors: {} };
  const result = await createQuickUseCase(writeContextFor(workspaceId, actor.writer), input, followUpDeps(), actor.writer);
  if (!result.ok) {
    return { ok: false, message: result.error === "riprova" ? QUICK_CREATE_TEXT.error : result.message, fieldErrors: result.fieldErrors };
  }
  revalidateUseCases(workspaceId, result.value.id);
  return { ok: true, id: result.value.id, code: result.value.code, message: savedToast(result.value.code) };
}

// ─── Modulo completo (§5.3) ──────────────────────────────────────────

export type UseCaseFormActionResult =
  | { ok: true; id: string; code: string | null; href: string }
  | { ok: false; message: string; fieldErrors: Record<string, string> };

/**
 * «Invia lo use case» del modulo completo: `source = web_proposed`, origine e valutazione
 * iniziale solo dai revisori. Dopo la risposta, come oggi, valutazione automatica dell'AI e
 * notifiche. Quando va bene restituisce l'indirizzo della ricevuta in cima alla pagina «Use
 * case» (§2.5, §5.5), dove il modulo porta subito: niente `redirect()` qui, così il modulo
 * distingue un errore di rete dalla navigazione.
 */
export async function createUseCaseFromFormAction(workspaceId: string, formData: FormData): Promise<UseCaseFormActionResult> {
  const session = await requireSession();
  const access = UUID.test(workspaceId) ? await getCollaboratorAccess(session.user.id, workspaceId) : null;
  const actor = pageActor(session, workspaceId, access);
  if (!actor.ok) return { ok: false, message: actor.message, fieldErrors: {} };
  const parsed = parseUseCaseForm((name) => formData.get(name), {
    esgEnabled: actor.esgEnabled,
    isReviewer: actor.abilities.isReviewer,
  });
  if (!parsed.ok) return { ok: false, message: parsed.message, fieldErrors: parsed.fieldErrors };

  // Chi propone, per la ricevuta e per le proprie proposte (D13): l'email se Firebase l'ha
  // verificata (come oggi il modulo web), altrimenti l'id, che `isOwnProposal` riconosce sempre.
  const user = actor.user;
  const proposer = user.emailVerified && user.email ? user.email : user.id;
  const result = await createUseCaseWithFollowUps(
    writeContextFor(workspaceId, actor.writer),
    { ...parsed.item, proposedBy: proposer },
    followUpDeps(),
    actor.writer,
  );
  if (!result.ok) {
    return {
      ok: false,
      message: result.error === "dati_non_validi" ? FORM_TEXT.fixFields : result.message,
      fieldErrors: result.fieldErrors ?? {},
    };
  }
  revalidateUseCases(workspaceId, result.value.id);
  return { ok: true, id: result.value.id, code: result.value.code, href: receiptPath(workspaceId, result.value.id) };
}

// ─── Activity mapping (§8.5) ─────────────────────────────────────────

export type ActivityMappingActionResult =
  | { ok: true; count: number; message: string }
  | { ok: false; message: string; /** «Prima classifica…»: il link ad Activity mapping. */ href: string | null };

/**
 * Menu «⋯» › «Proponi da Activity mapping» (revisori): Claude propone use case dalle attività
 * classificate. Arrivano in «Da decidere» come bozze «AI Transformation», nascoste ai
 * colleghi, senza notifiche; nessuno è approvato da solo. Con attività da classificare
 * risponde «Prima classifica le attività in Activity mapping.» con il link.
 */
export async function proposeFromActivityMappingAction(workspaceId: string): Promise<ActivityMappingActionResult> {
  const session = await requireSession();
  const access = UUID.test(workspaceId) ? await getCollaboratorAccess(session.user.id, workspaceId) : null;
  const actor = pageActor(session, workspaceId, access);
  if (!actor.ok) return { ok: false, message: actor.message, href: null };
  const result = await proposeFromActivityMapping(
    writeContextFor(workspaceId, actor.writer, "activity_mapping"),
    { generate: generateUseCases },
    { rule: "tutte_classificate" },
  );
  if (!result.ok) {
    return { ok: false, message: result.message, href: result.error === "da_classificare" ? activityMappingPath(workspaceId) : null };
  }
  revalidateUseCases(workspaceId);
  return { ok: true, count: result.created.length, message: proposedToast(result.created.length) };
}
