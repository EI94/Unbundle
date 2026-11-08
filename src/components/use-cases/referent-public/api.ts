import { parseApiResponse, type ApiResult } from "@/lib/uc/views/referente-form";
import {
  referentApiBase,
  REFERENT_API,
  type CheckBody,
  type CheckResult,
  type DraftBody,
  type DraftResult,
  type ReferentAskView,
  type SubmitBody,
  type SubmitResult,
  type ThreadEditBody,
  type ThreadReplyBody,
  type ThreadSeenBody,
  type ThreadTextBody,
  type ThreadWriteResult,
} from "@/lib/use-cases/referent/contract";

/**
 * Chiamate della pagina `/rispondi/<token>` alle sue API (SPEC §4.2): sempre JSON, niente cache,
 * niente cookie (la pagina non dipende dalla sessione), niente `Referer` (il link è nell'indirizzo).
 * Il token sta solo nell'indirizzo della chiamata: mai in un log, mai sul dispositivo.
 * I file passano da `uploadReferentFile` (upload-transport.ts), con le stesse regole di rete.
 */

export type { ApiResult } from "@/lib/uc/views/referente-form";

type Path = (typeof REFERENT_API)[keyof typeof REFERENT_API];

async function call<T>(token: string, path: Path | "", init: { method: "GET" | "POST"; body?: unknown; keepalive?: boolean }): Promise<ApiResult<T>> {
  let response: Response;
  try {
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    response = await fetch(`${referentApiBase(token)}${path ? `/${path}` : ""}`, {
      method: init.method,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body,
      cache: "no-store",
      credentials: "omit",
      // Con `Referrer-Policy: no-referrer` una POST verso la stessa origine può partire con
      // `Origin: null` e l'API la rifiuterebbe: `same-origin` manda l'origine vera, `referrer: ""`
      // toglie comunque il `Referer`, che conterrebbe il link.
      referrerPolicy: "same-origin",
      referrer: "",
      keepalive: init.keepalive === true && body !== undefined && body.length < 60_000,
    });
  } catch {
    return parseApiResponse<T>(0, null);
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return parseApiResponse<T>(response.status, json);
}

export function fetchAskView(token: string): Promise<ApiResult<ReferentAskView>> {
  return call<ReferentAskView>(token, "", { method: "GET" });
}

export function acceptPrivacy(token: string, version: string): Promise<ApiResult<{ accepted: true }>> {
  return call(token, REFERENT_API.privacy, { method: "POST", body: { version } });
}

export function saveDraft(token: string, body: DraftBody, keepalive = false): Promise<ApiResult<DraftResult>> {
  return call(token, REFERENT_API.draft, { method: "POST", body, keepalive });
}

/** (Rilascio 5) La bozza della conferma (passo 1) o della stima (passo 2). */
export function saveCheck(token: string, body: CheckBody, keepalive = false): Promise<ApiResult<CheckResult>> {
  return call(token, REFERENT_API.check, { method: "POST", body, keepalive });
}

export function submitAnswers(token: string, body: SubmitBody = {}): Promise<ApiResult<SubmitResult>> {
  return call(token, REFERENT_API.submit, { method: "POST", body });
}

export function removeFile(token: string, fileId: string): Promise<ApiResult<{ removed: true }>> {
  return call(token, REFERENT_API.fileRemove, { method: "POST", body: { fileId } });
}

/** (Rilascio 6) «Ho un dubbio»: una domanda al team su una domanda, una voce o in generale. */
export function postDoubt(token: string, body: ThreadTextBody): Promise<ApiResult<ThreadWriteResult>> {
  return call(token, REFERENT_API.doubt, { method: "POST", body });
}

/** (Rilascio 6) La risposta a un chiarimento del team. */
export function postReply(token: string, body: ThreadReplyBody): Promise<ApiResult<ThreadWriteResult>> {
  return call(token, REFERENT_API.reply, { method: "POST", body });
}

/** (Rilascio 6) «Aggiungi qualcosa» a una risposta già inviata. */
export function postAddition(token: string, body: ThreadTextBody): Promise<ApiResult<ThreadWriteResult>> {
  return call(token, REFERENT_API.add, { method: "POST", body });
}

/** (Rilascio 6) La modifica di una risposta già inviata, finché il team non la segna «A posto». */
export function postEdit(token: string, body: ThreadEditBody): Promise<ApiResult<{ editedAt: string }>> {
  return call(token, REFERENT_API.edit, { method: "POST", body });
}

/** (Rilascio 6) Le risposte del team che la pagina ha mostrato. */
export function markSeen(token: string, body: ThreadSeenBody): Promise<ApiResult<{ seen: number }>> {
  return call(token, REFERENT_API.seen, { method: "POST", body });
}
