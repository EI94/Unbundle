"use server";

/**
 * Server action di «Cosa serve» nella scheda di uno use case (spec di Pierpaolo, 25/10/2026):
 * aggiungere un'esigenza (già collegata allo use case aperto), modificarla, collegarla a un altro
 * use case o scollegarla, archiviarla con il motivo. Non si cancella niente.
 *
 * Ogni action è un endpoint raggiungibile con una POST diretta: rifà da sé ingresso, sessione
 * (`requireSession`), accesso al workspace (`getCollaboratorAccess`) e area accesa, poi passa da
 * `needs-service.ts` (canale `pagina`), che rilegge ruolo e «Lateral Space»: scrivono solo i
 * revisori. La risposta porta solo id e versione dell'esigenza, oppure l'errore del servizio.
 * Dopo una scrittura, e dopo una versione superata, si rileggono la pagina dell'area e le schede
 * toccate. Nessun testo nei log.
 */
import { revalidatePath } from "next/cache";
import type { Session } from "@/lib/auth";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { archiveNeed, createNeed, linkNeed, unlinkNeed, updateNeed, type NeedWritten } from "@/lib/use-cases/needs-service";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { SERVICE_MESSAGES, type ServiceError, type WriteContext } from "@/lib/use-cases/service";
import type { ServiceResult } from "@/lib/use-cases/types";
import { getCollaboratorAccess, type WorkspaceAccess } from "@/lib/workspace-access";

export type NeedActionResult =
  | { ok: true; id: string; version: number; message: string | null }
  | { ok: false; error: ServiceError; message: string; fieldErrors?: Record<string, string> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

/** La versione superata di un'esigenza: il testo del servizio parla dello use case. */
const NEED_STALE_MESSAGE = "Qualcuno ha appena modificato questa esigenza. Ho ricaricato i dati: rifai la modifica.";

/** I toast dopo una scrittura riuscita. */
const TOAST = Object.freeze({
  created: "Aggiunta.",
  updated: null,
  archived: "Archiviata.",
  linked: null,
  unlinked: null,
});

function failure(error: ServiceError, message: string = SERVICE_MESSAGES[error]): NeedActionResult {
  return { ok: false, error, message };
}

/**
 * Il contesto di scrittura della pagina, dall'accesso già letto da chi chiama
 * (`getCollaboratorAccess`, nel corpo di ogni action, come in `use-case-edit.ts`).
 */
function pageContext(
  workspaceId: string,
  session: Session,
  access: WorkspaceAccess | null,
): { ok: true; ctx: WriteContext } | { ok: false; result: NeedActionResult } {
  if (!access) return { ok: false, result: failure("permesso_mancante") };
  if (!isUseCaseHubWorkspace(workspaceId)) return { ok: false, result: failure("area_spenta") };
  const viewer = viewerFromSession(session.user, access.role);
  return {
    ok: true,
    // Ruolo e «Lateral Space» li rilegge il servizio: qui non danno permessi.
    ctx: { workspaceId, actor: { userId: session.user.id, role: access.role, isLateralSpace: viewer.isLateralSpace, kind: "persona" }, channel: "pagina" },
  };
}

/** Dal risultato del servizio alla risposta, con le pagine da rileggere. */
function done(workspaceId: string, useCaseIds: readonly string[], result: ServiceResult<NeedWritten>, message: string | null): NeedActionResult {
  if (result.ok || result.error === "versione_superata") {
    revalidatePath(`/dashboard/${workspaceId}/use-cases`);
    for (const id of new Set(useCaseIds.map((value) => value.toLowerCase()))) revalidatePath(`/dashboard/${workspaceId}/use-cases/${id}`);
  }
  if (result.ok) return { ok: true, id: result.value.id, version: result.value.version, message };
  if (result.error === "versione_superata") return { ok: false, error: result.error, message: NEED_STALE_MESSAGE };
  return result.fieldErrors && Object.keys(result.fieldErrors).length
    ? { ok: false, error: result.error, message: result.message, fieldErrors: result.fieldErrors }
    : { ok: false, error: result.error, message: result.message };
}

/** «Aggiungi»: un requisito o un prossimo passo, collegato allo use case della scheda. */
export async function createNeedAction(workspaceId: string, useCaseId: string, input: unknown): Promise<NeedActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId)) return failure("non_trovato");
  if (!isRecord(input)) return failure("dati_non_validi");
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return page.result;
  return done(workspaceId, [useCaseId], await createNeed(page.ctx, input, { useCaseIds: [useCaseId] }), TOAST.created);
}

/** «Salva» di un'esigenza aperta nella scheda `useCaseId`. */
export async function updateNeedAction(workspaceId: string, useCaseId: string, needId: string, expectedVersion: number, patch: unknown): Promise<NeedActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(needId) || !isVersion(expectedVersion)) return failure("non_trovato");
  if (!isRecord(patch)) return failure("dati_non_validi");
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return page.result;
  return done(workspaceId, [useCaseId], await updateNeed(page.ctx, needId, expectedVersion, patch), TOAST.updated);
}

/** «Archivia», con il motivo. */
export async function archiveNeedAction(workspaceId: string, useCaseId: string, needId: string, expectedVersion: number, reason: unknown): Promise<NeedActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(needId) || !isVersion(expectedVersion)) return failure("non_trovato");
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return page.result;
  return done(workspaceId, [useCaseId], await archiveNeed(page.ctx, needId, expectedVersion, reason), TOAST.archived);
}

/** Collega l'esigenza a `targetId` (anche lo use case della scheda, `useCaseId`). */
export async function linkNeedAction(workspaceId: string, useCaseId: string, needId: string, targetId: string): Promise<NeedActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(needId) || !isUuid(targetId)) return failure("non_trovato");
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return page.result;
  return done(workspaceId, [useCaseId, targetId], await linkNeed(page.ctx, needId, targetId), TOAST.linked);
}

/** Scollega l'esigenza da `targetId`. */
export async function unlinkNeedAction(workspaceId: string, useCaseId: string, needId: string, targetId: string): Promise<NeedActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(needId) || !isUuid(targetId)) return failure("non_trovato");
  const session = await requireSession();
  const page = pageContext(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return page.result;
  return done(workspaceId, [useCaseId, targetId], await unlinkNeed(page.ctx, needId, targetId), TOAST.unlinked);
}
