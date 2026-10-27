import { parseApiResponse, type ApiResult } from "@/lib/uc/views/referente-form";
import { referentApiBase, REFERENT_API, type DraftBody, type DraftResult, type ReferentAskView, type SubmitBody, type SubmitResult } from "@/lib/use-cases/referent/contract";

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

export function submitAnswers(token: string, body: SubmitBody = {}): Promise<ApiResult<SubmitResult>> {
  return call(token, REFERENT_API.submit, { method: "POST", body });
}

export function removeFile(token: string, fileId: string): Promise<ApiResult<{ removed: true }>> {
  return call(token, REFERENT_API.fileRemove, { method: "POST", body: { fileId } });
}

export function confirmFile(token: string, fileId: string): Promise<ApiResult<{ confirmed: true }>> {
  return call(token, REFERENT_API.fileConfirm, { method: "POST", body: { fileId } });
}
