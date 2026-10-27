"use server";

/**
 * Server action di «Chiedi al referente» nel capitolo «Cosa serve» della scheda (SPEC §2.4):
 * preparare le domande, chiedere al referente, aggiungere domande, mandare un promemoria, revocare,
 * riprovare l'invio, correggere l'email, cancellare i dati di una persona, e le risposte e i file del
 * team.
 *
 * Ogni action è un endpoint raggiungibile con una POST diretta: rifà da sé ingresso (uuid,
 * versione), sessione (`requireSession`), accesso al workspace (`getCollaboratorAccess`), area
 * accesa e funzione accesa (`referentAskEnabled`), poi passa dal servizio di
 * `queries/use-case-referents.ts` (canale `pagina`), che rilegge ruolo e «Lateral Space»: scrivono
 * solo i revisori (`canEditNeeds`). Dopo una scrittura si rileggono la pagina dell'area e la scheda;
 * le action che mettono in coda un'email la mandano dopo la risposta (`after()`), quelle che
 * cancellano file tolgono gli oggetti dopo la risposta. Nei log solo codici.
 */
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import type { Session } from "@/lib/auth";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { scheduleReferentDispatch } from "@/lib/db/queries/use-case-referent-public";
import { cleanupDeletedFiles } from "@/lib/db/queries/use-case-referent-files";
import {
  addReviewerAnswer,
  addToReferentRequest,
  correctReferentEmail,
  deleteNeedFile,
  eraseReferentData,
  prepareReferentQuestions,
  remindReferentRequest,
  removeNeedAnswer,
  retryReferentRequestEmail,
  revealReferentContactEmail,
  reviewNeedFile,
  revokeReferentRequest,
  sendReferentRequest,
  type ReferentFailure,
} from "@/lib/db/queries/use-case-referents";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import type { AddToReferentRequestInput, FileReviewOutcome, ReferentActionResult, SendReferentRequestInput } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_UI_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import type { ServiceResult, WriteContext } from "@/lib/use-cases/service";
import { getCollaboratorAccess, type WorkspaceAccess } from "@/lib/workspace-access";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);
const isVersion = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);

const T = REFERENT_UI_TEXT.toasts;

function failure<T>(code: string, message: string = REFERENT_ERROR_MESSAGES[code] ?? REFERENT_ERROR_MESSAGES.riprova): ReferentActionResult<T> {
  return { ok: false, code, message };
}

type Page = { ok: true; ctx: WriteContext; session: Session } | { ok: false; result: ReferentActionResult<never> };

/** Sessione, accesso al workspace, area e funzione accese: il contesto di scrittura della pagina. */
async function page(workspaceId: string): Promise<Page> {
  const session = await requireSession();
  const access: WorkspaceAccess | null = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) return { ok: false, result: failure("permesso_mancante") };
  if (!isUseCaseHubWorkspace(workspaceId) || !referentAskEnabled(workspaceId, process.env)) return { ok: false, result: failure("funzione_spenta") };
  const viewer = viewerFromSession(session.user, access.role);
  return {
    ok: true,
    session,
    // Ruolo e «Lateral Space» li rilegge il servizio: qui non danno permessi.
    ctx: { workspaceId, actor: { userId: session.user.id, role: access.role, isLateralSpace: viewer.isLateralSpace, kind: "persona" }, channel: "pagina" },
  };
}

function refresh(workspaceId: string, useCaseId: string): void {
  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId.toLowerCase()}`);
}

/** Dal risultato del servizio alla risposta; dopo una scrittura, e dopo una versione superata, si rilegge la pagina. */
function done<V, D>(
  workspaceId: string,
  useCaseId: string,
  result: ServiceResult<V> | ReferentFailure,
  ok: (value: V) => { data: D; message: string | null },
): ReferentActionResult<D> {
  if (result.ok || result.error === "versione_superata" || result.error === "domande_cambiate") refresh(workspaceId, useCaseId);
  if (result.ok) {
    const { data, message } = ok(result.value);
    return { ok: true, data, message };
  }
  const message = result.error === "versione_superata" ? REFERENT_ERROR_MESSAGES.versione_superata : result.message;
  return result.fieldErrors && Object.keys(result.fieldErrors).length
    ? { ok: false, code: result.error, message, fieldErrors: result.fieldErrors }
    : { ok: false, code: result.error, message };
}

function afterFiles(workspaceId: string): void {
  after(async () => {
    try {
      await cleanupDeletedFiles({ workspaceId }, process.env);
    } catch (error) {
      console.error("[use-case.referenti] file non cancellati dall'archivio", error instanceof Error ? error.name : "errore");
    }
  });
}

/** «Prepara le domande». */
export async function prepareReferentQuestionsAction(workspaceId: string, useCaseId: string): Promise<ReferentActionResult<{ added: number }>> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId)) return failure("non_trovato");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await prepareReferentQuestions(p.ctx, useCaseId);
  return done(workspaceId, useCaseId, result, (v) => {
    const gaps = (v as { gaps?: number }).gaps ?? v.added;
    const message = v.added === 1 ? T.prepareOne : v.added > 1 ? fillText(T.prepareMany, { n: v.added }) : gaps > 0 ? T.prepareAlready : T.prepareNothing;
    return { data: { added: v.added }, message };
  });
}

/** «Chiedi al referente» e «Chiedi di nuovo». */
export async function sendReferentRequestAction(workspaceId: string, useCaseId: string, input: SendReferentRequestInput): Promise<ReferentActionResult<{ requestId: string }>> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId)) return failure("non_trovato");
  if (!isRecord(input)) return failure("dati_non_validi", REFERENT_ERROR_MESSAGES.riprova);
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await sendReferentRequest(p.ctx, useCaseId, input, {
    env: process.env,
    requester: { name: p.session.user.name ?? null, emailVerified: p.session.user.emailVerified === true },
  });
  if (result.ok) scheduleReferentDispatch(result.value.requestId);
  return done(workspaceId, useCaseId, result, (v) => ({ data: { requestId: v.requestId }, message: fillText(T.sent, { Nome: v.contactName }) }));
}

/** «Aggiungi domande» a una richiesta viva. */
export async function addToReferentRequestAction(
  workspaceId: string,
  useCaseId: string,
  requestId: string,
  expectedVersion: number,
  input: AddToReferentRequestInput,
): Promise<ReferentActionResult<{ added: number }>> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(requestId) || !isVersion(expectedVersion)) return failure("non_trovato");
  if (!isRecord(input)) return failure("nessuna_domanda");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await addToReferentRequest(p.ctx, useCaseId, requestId, expectedVersion, input, { env: process.env });
  if (result.ok && result.value.emailQueued) scheduleReferentDispatch(requestId);
  return done(workspaceId, useCaseId, result, (v) => ({
    data: { added: v.added },
    message: fillText(v.emailQueued ? T.addedEmail : T.addedSameLink, { Nome: v.contactName }),
  }));
}

/** «Manda un promemoria». */
export async function remindReferentRequestAction(workspaceId: string, useCaseId: string, requestId: string, expectedVersion: number): Promise<ReferentActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(requestId) || !isVersion(expectedVersion)) return failure("non_trovato");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await remindReferentRequest(p.ctx, useCaseId, requestId, expectedVersion, { env: process.env });
  if (result.ok && result.value.now) scheduleReferentDispatch(requestId);
  return done(workspaceId, useCaseId, result, (v) => ({ data: null, message: v.now ? T.remindedNow : T.remindedLater }));
}

/** «Revoca il link». */
export async function revokeReferentRequestAction(workspaceId: string, useCaseId: string, requestId: string, expectedVersion: number): Promise<ReferentActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(requestId) || !isVersion(expectedVersion)) return failure("non_trovato");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await revokeReferentRequest(p.ctx, useCaseId, requestId, expectedVersion);
  if (result.ok) afterFiles(workspaceId);
  return done(workspaceId, useCaseId, result, () => ({ data: null, message: T.revoked }));
}

/** «Riprova l'invio». */
export async function retryReferentRequestEmailAction(workspaceId: string, useCaseId: string, requestId: string, expectedVersion: number): Promise<ReferentActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(requestId) || !isVersion(expectedVersion)) return failure("non_trovato");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await retryReferentRequestEmail(p.ctx, useCaseId, requestId, expectedVersion, { env: process.env });
  if (result.ok) scheduleReferentDispatch(requestId);
  return done(workspaceId, useCaseId, result, () => ({ data: null, message: T.retried }));
}

/** L'indirizzo intero di un referente, per il riepilogo della finestra «Chiedi al referente». Solo lettura. */
export async function revealReferentContactEmailAction(workspaceId: string, useCaseId: string, contactId: string): Promise<ReferentActionResult<{ email: string | null }>> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(contactId)) return failure("non_trovato");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await revealReferentContactEmail(p.ctx, useCaseId, contactId);
  if (result.ok) return { ok: true, data: { email: result.value.email }, message: null };
  return { ok: false, code: result.error, message: result.message };
}

/** «Correggi l'email» di un referente usato solo dagli use case. */
export async function correctReferentEmailAction(workspaceId: string, useCaseId: string, contactId: string, input: { email: string }): Promise<ReferentActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(contactId)) return failure("non_trovato");
  if (!isRecord(input)) return failure("email_mancante");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await correctReferentEmail(p.ctx, useCaseId, contactId, input, { env: process.env });
  return done(workspaceId, useCaseId, result, () => ({ data: null, message: T.emailCorrected }));
}

/** «Cancella i dati di questa persona». */
export async function eraseReferentDataAction(workspaceId: string, useCaseId: string, contactId: string): Promise<ReferentActionResult<{ contactAnonymized: boolean }>> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(contactId)) return failure("non_trovato");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await eraseReferentData(p.ctx, useCaseId, contactId, { env: process.env });
  if (result.ok) afterFiles(workspaceId);
  return done(workspaceId, useCaseId, result, (v) => ({ data: { contactAnonymized: v.contactAnonymized }, message: v.contactAnonymized ? T.erased : T.erasedHubOnly }));
}

/** «Aggiungi una risposta» del team; con `validate` («L'ho già verificata») l'informazione diventa «A posto». */
export async function addNeedAnswerAction(workspaceId: string, useCaseId: string, needId: string, input: { text: string; validate?: boolean }): Promise<ReferentActionResult<{ answerId: string }>> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(needId)) return failure("non_trovato");
  if (!isRecord(input)) return failure("risposta_vuota");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await addReviewerAnswer(p.ctx, useCaseId, needId, input);
  return done(workspaceId, useCaseId, result, (v) => ({ data: { answerId: v.answerId }, message: input.validate === true ? T.answerAddedValidated : T.answerAdded }));
}

/** «Elimina la risposta». */
export async function removeNeedAnswerAction(workspaceId: string, useCaseId: string, answerId: string): Promise<ReferentActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(answerId)) return failure("non_trovato");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await removeNeedAnswer(p.ctx, useCaseId, answerId);
  return done(workspaceId, useCaseId, result, () => ({ data: null, message: T.answerRemoved }));
}

/** «Elimina» un file. */
export async function deleteNeedFileAction(workspaceId: string, useCaseId: string, fileId: string): Promise<ReferentActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(fileId)) return failure("non_trovato");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await deleteNeedFile(p.ctx, useCaseId, fileId, process.env);
  if (result.ok) afterFiles(workspaceId);
  return done(workspaceId, useCaseId, result, () => ({ data: null, message: T.fileDeleted }));
}

/** «Accetta il file» / «Rifiuta il file»: il controllo di un PDF con poco testo, solo Lateral Space. */
export async function reviewNeedFileAction(workspaceId: string, useCaseId: string, fileId: string, outcome: FileReviewOutcome): Promise<ReferentActionResult> {
  if (!isUuid(workspaceId) || !isUuid(useCaseId) || !isUuid(fileId)) return failure("non_trovato");
  if (outcome !== "accetta" && outcome !== "rifiuta") return failure("revisione_non_ammessa");
  const p = await page(workspaceId);
  if (!p.ok) return p.result;
  const result = await reviewNeedFile(p.ctx, useCaseId, fileId, outcome, process.env);
  if (result.ok && result.value.status === "rifiutato") afterFiles(workspaceId);
  return done(workspaceId, useCaseId, result, (v) => ({ data: null, message: v.status === "pulito" ? T.fileAccepted : T.fileRejected }));
}
