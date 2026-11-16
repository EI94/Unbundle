"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { contextActorFromSession, type ContextActor } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { CommitmentParty, ContextSection, ContextVisibility } from "@/lib/context/vocab";
import { refreshContextBrief } from "@/lib/db/queries/context-brief";
import { addQuestion, closeCommitment, closeQuestion, editFact, reconfirmFact, reopenCommitment, retireFact, writeFact } from "@/lib/db/queries/context-memory";
import { confirmProposals, discardProposals, editProposal, type ConfirmItem, type ConfirmResult, type ProposalView } from "@/lib/db/queries/context-proposals";
import { removeContextSource, setDocumentVisibility } from "@/lib/db/queries/context-sources";
import { logSafeError } from "@/lib/log/safe-error";
import type { ServiceResult } from "@/lib/use-cases/types";

/**
 * Le azioni della pagina «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.5): scritture brevi,
 * senza modello. Ognuna rilegge chi chiama dalla sessione (`contextActorFromSession`: chi non entra risponde
 * `permesso_mancante`), chiama la funzione condivisa, che rifà da sé il controllo dei permessi, e solo se riesce
 * aggiorna la pagina (`revalidatePath` di `/dashboard/<ws>/contesto`, con «Da confermare» sotto).
 *
 * Dopo una conferma, e dopo un fatto scritto, modificato o ritirato, «In breve» si riscrive con `after()`, dopo la
 * risposta: la pagina di «Da confermare» ha `maxDuration = 60`, e la chiamata al modello ne ha 40. Un fatto «Per tutti»
 * che esce da «In breve» lo toglie già da sé, nella sua transazione (`dropBriefStatement`).
 */

type Patch<T> = { [K in keyof T]?: T[K] };

const denied = <T>(): ServiceResult<T> => ({ ok: false, error: "permesso_mancante", message: CONTEXT_TEXT.errors.denied });
const retry = <T>(): ServiceResult<T> => ({ ok: false, error: "riprova", message: CONTEXT_TEXT.errors.retry });

/** Chi chiama, la funzione condivisa, e la pagina aggiornata solo se l'azione è riuscita. Nei log solo codici e id. */
async function run<T>(workspaceId: string, op: string, write: (actor: ContextActor) => Promise<ServiceResult<T>>): Promise<ServiceResult<T>> {
  try {
    const who = await contextActorFromSession(workspaceId);
    if (!who.ok) return denied<T>();
    const result = await write(who.actor);
    if (result.ok) revalidatePath(`/dashboard/${workspaceId}/contesto`, "layout");
    return result;
  } catch (error) {
    logSafeError("context/actions", `${op}_non_riuscita`, error, { workspaceId });
    return retry<T>();
  }
}

/** Se la memoria è cambiata, «In breve» si riscrive dopo la risposta (non lancia: `refreshContextBrief` non lancia). */
function rewriteBriefAfter<T>(workspaceId: string, result: ServiceResult<T>): ServiceResult<T> {
  if (result.ok) {
    after(async () => {
      await refreshContextBrief(workspaceId, { force: true });
    });
  }
  return result;
}

// ─── «Da confermare» ─────────────────────────────────────────────────

/** «Conferma (n)»: tutte o nessuna. Poi, dopo la risposta, «In breve» si riscrive. */
export async function confirmProposalsAction(workspaceId: string, items: ConfirmItem[]): Promise<ServiceResult<ConfirmResult>> {
  return rewriteBriefAfter(workspaceId, await run(workspaceId, "conferma", (actor) => confirmProposals(actor, Array.isArray(items) ? items : [])));
}

/** «Modifica» su una proposta: testo, sezione, chi la vede, use case; per un impegno parte, ruolo, data. */
export async function editProposalAction(
  workspaceId: string,
  proposalId: string,
  expectedVersion: number,
  patch: Patch<{ statement: string; section: ContextSection; visibility: ContextVisibility; useCaseIds: string[]; party: CommitmentParty; roleLabel: string | null; dueOn: string | null }>,
): Promise<ServiceResult<ProposalView>> {
  return run(workspaceId, "modifica_proposta", (actor) => editProposal(actor, proposalId, expectedVersion, patch ?? {}));
}

/** «Scarta». */
export async function discardProposalsAction(workspaceId: string, proposalIds: string[]): Promise<ServiceResult<{ discarded: number }>> {
  return run(workspaceId, "scarto", (actor) => discardProposals(actor, Array.isArray(proposalIds) ? proposalIds : []));
}

// ─── Fatti ───────────────────────────────────────────────────────────

/** «Scrivi un fatto». Poi «In breve» si riscrive. */
export async function writeFactAction(
  workspaceId: string,
  input: { statement: string; section: ContextSection; visibility: ContextVisibility; useCaseIds?: string[] },
): Promise<ServiceResult<{ factId: string }>> {
  return rewriteBriefAfter(workspaceId, await run(workspaceId, "fatto_scritto", (actor) => writeFact(actor, input)));
}

/** «Modifica» su un fatto, e «Per tutti / Solo Lateral Space». Poi «In breve» si riscrive. */
export async function editFactAction(
  workspaceId: string,
  factId: string,
  expectedVersion: number,
  patch: Patch<{ statement: string; section: ContextSection; visibility: ContextVisibility; useCaseIds: string[] }>,
): Promise<ServiceResult<{ factId: string }>> {
  return rewriteBriefAfter(workspaceId, await run(workspaceId, "fatto_modificato", (actor) => editFact(actor, factId, expectedVersion, patch ?? {})));
}

/** «Ancora vero». */
export async function reconfirmFactAction(workspaceId: string, factId: string): Promise<ServiceResult<true>> {
  return run(workspaceId, "fatto_riconfermato", (actor) => reconfirmFact(actor, factId));
}

/** «Non più vero». Poi «In breve» si riscrive. */
export async function retireFactAction(workspaceId: string, factId: string, expectedVersion: number): Promise<ServiceResult<true>> {
  return rewriteBriefAfter(workspaceId, await run(workspaceId, "fatto_ritirato", (actor) => retireFact(actor, factId, expectedVersion)));
}

// ─── Impegni e domande ───────────────────────────────────────────────

/** «Fatto» su un impegno. */
export async function closeCommitmentAction(workspaceId: string, commitmentId: string, expectedVersion: number): Promise<ServiceResult<true>> {
  return run(workspaceId, "impegno_chiuso", (actor) => closeCommitment(actor, commitmentId, expectedVersion));
}

/** «Riapri» su un impegno appena segnato come fatto. */
export async function reopenCommitmentAction(workspaceId: string, commitmentId: string, expectedVersion: number): Promise<ServiceResult<true>> {
  return run(workspaceId, "impegno_riaperto", (actor) => reopenCommitment(actor, commitmentId, expectedVersion));
}

/** «Chiusa» su una domanda aperta. */
export async function closeQuestionAction(workspaceId: string, questionId: string, expectedVersion: number): Promise<ServiceResult<true>> {
  return run(workspaceId, "domanda_chiusa", (actor) => closeQuestion(actor, questionId, expectedVersion));
}

/** «Aggiungi alle domande aperte», da «Chiedi al contesto»: chi apre la pagina. */
export async function addQuestionAction(workspaceId: string, input: { question: string; askWhom?: string | null }): Promise<ServiceResult<{ questionId: string }>> {
  return run(workspaceId, "domanda_aggiunta", (actor) => addQuestion(actor, input ?? { question: "" }));
}

// ─── Appunti e documenti ─────────────────────────────────────────────

/** «Togli» su un appunto (Lateral Space) o su un documento (chi può). I fatti restano, «senza fonte». */
export async function removeSourceAction(workspaceId: string, sourceId: string): Promise<ServiceResult<true>> {
  return run(workspaceId, "fonte_tolta", (actor) => removeContextSource(actor, sourceId));
}

/** «Per tutti / Solo Lateral Space» su un documento. */
export async function setDocumentVisibilityAction(workspaceId: string, sourceId: string, visibility: ContextVisibility): Promise<ServiceResult<true>> {
  return run(workspaceId, "visibilita", (actor) => setDocumentVisibility(actor, sourceId, visibility));
}
