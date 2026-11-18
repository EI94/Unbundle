"use server";

/**
 * Le azioni del contesto nel lavoro (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.2, §5.2): scritture
 * brevi, senza modello. Ogni azione è un endpoint raggiungibile con una POST diretta: rilegge da sé la sessione e
 * l'accesso al workspace, ricontrolla il permesso, poi passa dalle funzioni condivise, che rifanno il loro controllo.
 *
 * - «Chiudi con questo» (`closeNeedFromCallAction`, D3): la richiesta di «Cosa serve» passa ad «A posto» (`validata`)
 *   per la strada di sempre, `updateNeedAction`, come quando una persona cambia lo stato a mano: la «Storia» scrive la
 *   riga di sempre, e una richiesta al referente mostra la domanda come gestita. Solo dopo, il legame con il fatto
 *   diventa «usato» (`markNeedLinkUsed`). Chi: chi modifica «Cosa serve» (`canEditNeeds`).
 * - «Non risponde» (`dismissNeedLinkAction`): il legame diventa «scartato» e la riga sparisce; la richiesta resta
 *   aperta. Stesso permesso.
 * - «Ancora veri (n)» (`reconfirmFactsAction`, §2.10): la data dell'ultima conferma dei fatti scelti si rinfresca e il
 *   segno «da verificare» si toglie. Solo Lateral Space (`reconfirmFacts` lo ricontrolla). Non è un cambio: «In breve»
 *   non si riscrive e nessuno riceve un avviso.
 *
 * Nei log solo id e codici, mai un testo.
 */
import { revalidatePath } from "next/cache";
import type { Session } from "@/lib/auth";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { contextActorFor, contextActorFromSession, type ContextActor } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { reconfirmFacts } from "@/lib/db/queries/context-freshness";
import { dismissNeedLink, listNeedLinks, markNeedLinkUsed } from "@/lib/db/queries/context-needs";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { logSafeError } from "@/lib/log/safe-error";
import { abilitiesForUseCase } from "@/lib/use-cases/permissions";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { SERVICE_MESSAGES, type ServiceError } from "@/lib/use-cases/service";
import type { ServiceResult } from "@/lib/use-cases/types";
import { getCollaboratorAccess, type WorkspaceAccess } from "@/lib/workspace-access";
import { updateNeedAction } from "./use-case-needs";

/** L'esito di «Chiudi con questo» e «Non risponde»: il messaggio del toast, oppure l'errore con la sua frase. */
export type NeedLinkActionResult = { ok: true; message: string } | { ok: false; error: ServiceError; message: string };

const LOG_SCOPE = "context/work-actions";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;

function failure(error: ServiceError, message: string = SERVICE_MESSAGES[error]): NeedLinkActionResult {
  return { ok: false, error, message };
}

/**
 * Chi decide una riga «Una call risponde»: chi modifica «Cosa serve» (`canEditNeeds`), con l'area accesa per il
 * workspace. Ruolo e Lateral Space dalla sessione e dall'accesso appena letti da chi chiama (`getCollaboratorAccess`,
 * nel corpo di ogni azione); la persona di «Contesto» con il canale «web».
 */
function needEditor(workspaceId: string, session: Session, access: WorkspaceAccess | null): { ok: true; actor: ContextActor } | { ok: false; result: NeedLinkActionResult } {
  if (!access) return { ok: false, result: failure("permesso_mancante") };
  if (!isUseCaseHubWorkspace(workspaceId)) return { ok: false, result: failure("area_spenta") };
  if (!abilitiesForUseCase(viewerFromSession(session.user, access.role)).canEditNeeds) return { ok: false, result: failure("permesso_mancante") };
  return { ok: true, actor: contextActorFor(session.user, access, workspaceId) };
}

/** La scheda dello use case si rilegge: la riga c'è o non c'è più. */
function revalidateCard(workspaceId: string, useCaseId: string): void {
  revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId.toLowerCase()}`);
}

/**
 * «Chiudi con questo»: la riga che la persona ha davanti (un legame aperto di una richiesta aperta di questo use case,
 * con un fatto attivo «Per tutti», `listNeedLinks`) chiude la sua richiesta. `needVersion` è la versione della richiesta
 * letta con la pagina: se qualcuno l'ha appena cambiata, la risposta lo dice e la pagina si rilegge.
 */
export async function closeNeedFromCallAction(workspaceId: string, useCaseId: string, linkId: string, needVersion: number): Promise<NeedLinkActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(linkId) || !isVersion(needVersion)) return failure("non_trovato", CONTEXT_TEXT.errors.notFound);
  const session = await requireSession();
  const page = needEditor(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return page.result;
  const link = Object.values(await listNeedLinks(page.actor, useCaseId)).find((view) => view.id.toLowerCase() === linkId.toLowerCase());
  if (!link) {
    // Già deciso, il fatto non è più vero, o la richiesta è già chiusa: la pagina si rilegge.
    revalidateCard(workspaceId, useCaseId);
    return failure("versione_superata", CONTEXT_TEXT.errors.stale);
  }
  // La strada di sempre: l'esigenza passa ad «A posto» come se la persona cambiasse lo stato a mano.
  const closed = await updateNeedAction(workspaceId, useCaseId, link.needId, needVersion, { status: "validata" });
  if (!closed.ok) return { ok: false, error: closed.error, message: closed.message };
  // Solo dopo, il legame diventa «usato». Se non riesce, la richiesta resta chiusa e la riga non torna (la scheda mostra
  // solo i legami delle richieste aperte): basta il log.
  const used = await markNeedLinkUsed(page.actor, link.id);
  if (!used.ok) logSafeError(LOG_SCOPE, "legame_non_segnato_usato", null, { workspaceId, linkId: link.id, esito: used.error });
  return { ok: true, message: CONTEXT_TEXT.needLink.closed };
}

/** «Non risponde»: il legame diventa «scartato» e la riga sparisce; la richiesta resta aperta. */
export async function dismissNeedLinkAction(workspaceId: string, useCaseId: string, linkId: string): Promise<NeedLinkActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(linkId)) return failure("non_trovato", CONTEXT_TEXT.errors.notFound);
  const session = await requireSession();
  const page = needEditor(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId));
  if (!page.ok) return page.result;
  const result = await dismissNeedLink(page.actor, linkId);
  if (result.ok || result.error === "versione_superata" || result.error === "non_trovato") revalidateCard(workspaceId, useCaseId);
  return result.ok ? { ok: true, message: CONTEXT_TEXT.needLink.dismissed } : { ok: false, error: result.error, message: result.message };
}

/**
 * «Ancora veri (n)» di «Da verificare»: i fatti scelti (da 1 a 75 per volta: la pagina manda gruppi) tornano freschi.
 * Chi chiama dalla sessione (`contextActorFromSession`: senza accesso `permesso_mancante`); solo se riesce si rilegge
 * «Contesto», con la sua riga di servizio e la pagina stessa.
 */
export async function reconfirmFactsAction(workspaceId: string, factIds: string[]): Promise<ServiceResult<{ reconfirmed: number }>> {
  try {
    const who = await contextActorFromSession(workspaceId);
    if (!who.ok) return { ok: false, error: "permesso_mancante", message: CONTEXT_TEXT.errors.denied };
    const result = await reconfirmFacts(who.actor, Array.isArray(factIds) ? factIds : []);
    if (result.ok) revalidatePath(`/dashboard/${workspaceId}/contesto`, "layout");
    return result;
  } catch (error) {
    logSafeError(LOG_SCOPE, "riconferma_non_riuscita", error, { workspaceId });
    return { ok: false, error: "riprova", message: CONTEXT_TEXT.errors.retry };
  }
}
