import { parseApiResponse, type ApiResult } from "@/lib/uc/views/referente-form";

/**
 * Chiamate della pagina del referente alle API pubbliche `/api/r/[token]/…`
 * (WP7b). Sempre JSON, stessa origine, niente cache, niente cookie, niente
 * `Referer`. Il token sta solo nell'indirizzo della chiamata: mai in un log,
 * mai sul dispositivo.
 */

function url(token: string, path: string): string {
  return `/api/r/${encodeURIComponent(token)}${path ? `/${path}` : ""}`;
}

async function call<T>(token: string, path: string, init: { method: "GET" | "POST" | "PUT"; body?: unknown; keepalive?: boolean; signal?: AbortSignal }): Promise<ApiResult<T>> {
  let response: Response;
  try {
    const body = init.body === undefined ? undefined : JSON.stringify(init.body);
    response = await fetch(url(token, path), {
      method: init.method,
      headers: body === undefined ? { accept: "application/json" } : { accept: "application/json", "content-type": "application/json" },
      body,
      cache: "no-store",
      credentials: "omit",
      mode: "cors",
      // La pagina ha `Referrer-Policy: no-referrer`. Per lo standard Fetch una
      // POST verso la stessa origine con quella politica parte con
      // `Origin: null`, e l'API la rifiuterebbe (Chrome manda comunque
      // l'origine vera, non tutti i browser lo fanno). Con `same-origin`
      // l'`Origin` è quello vero ovunque; `referrer: ""` toglie comunque il
      // `Referer`, che conterrebbe il link.
      referrerPolicy: "same-origin",
      referrer: "",
      // `keepalive` vale solo sotto i 64 KB: oltre, la chiamata parte normale.
      keepalive: init.keepalive === true && body !== undefined && body.length < 60_000,
      signal: init.signal,
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

export function getView<T>(token: string): Promise<ApiResult<T>> {
  return call<T>(token, "", { method: "GET" });
}

export function postJson<T>(token: string, path: string, body: unknown): Promise<ApiResult<T>> {
  return call<T>(token, path, { method: "POST", body });
}

/** Invio a gruppi del riepilogo (`POST …/answers`, al massimo 50 risposte per chiamata). */
export function postAnswers<T>(token: string, answers: readonly unknown[]): Promise<ApiResult<T>> {
  return call<T>(token, "answers", { method: "POST", body: { answers } });
}

export function putDraft<T>(token: string, itemId: string, body: unknown, keepalive = false): Promise<ApiResult<T>> {
  return call<T>(token, `items/${encodeURIComponent(itemId)}/draft`, { method: "PUT", body, keepalive });
}

/** Esito di «Carica un Excel»: il file caricato e le righe lette (`POST …/upload-table`). */
export interface TableFileData {
  file: {
    fileId: string;
    fileName: string;
    sizeBytes: number | null;
    status: "pulito" | "in_quarantena" | "rifiutato";
    usable: boolean;
    message: string | null;
    duplicate: boolean;
  };
  rows: string[][] | null;
  rowsMessage: string | null;
}

/**
 * «Carica un Excel» su una domanda tabella (DESIGN §4.3 R2c): multipart, come
 * il caricamento di un allegato in modalità server (≤ 4 MB), con le stesse
 * regole di rete delle altre chiamate.
 */
export async function postTableFile(token: string, itemId: string, file: File, declaration: boolean): Promise<ApiResult<TableFileData>> {
  const form = new FormData();
  form.set("file", file, file.name);
  form.set("itemId", itemId);
  form.set("declaration", declaration ? "true" : "false");
  let response: Response;
  try {
    response = await fetch(url(token, "upload-table"), {
      method: "POST",
      headers: { accept: "application/json" },
      body: form,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "same-origin",
      referrer: "",
    });
  } catch {
    return parseApiResponse<TableFileData>(0, null);
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return parseApiResponse<TableFileData>(response.status, json);
}
