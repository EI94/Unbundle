/**
 * Le chiamate della pagina «Contesto» alle sue rotte (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.5, §7.3,
 * §10.2): salvare gli appunti, leggerli parte per parte, caricare un documento, fare una domanda. La `fetch` arriva da
 * fuori: nel browser quella vera, nei test una finta.
 *
 * La lettura di un appunto lungo è fatta di più richieste: finché la rotta risponde `in_corso` si richiama, una parte
 * alla volta (una chiamata al modello per richiesta). «Rileggi» (`again`) vale solo per la prima richiesta: le altre
 * continuano la stessa lettura.
 * Nessun testo scritto qui: i messaggi vengono da `CONTEXT_TEXT`. Modulo puro, senza `node:`.
 */
import { CONTEXT_TEXT } from "../../lib/context/text.ts";
import type { AskAnswer } from "../../lib/db/queries/context-ask.ts";
import type { ReadOutcome } from "../../lib/db/queries/context-read.ts";
import type { AddedSource } from "../../lib/db/queries/context-sources.ts";
import { responseMessage } from "./view-model.ts";

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Un errore di una rotta: lo stato HTTP (0 se la rete non ha risposto), il codice e il messaggio da mostrare. */
export interface RouteFailure {
  ok: false;
  status: number;
  error: string;
  message: string;
  fieldErrors: Record<string, string>;
  retryAfterSeconds: number | null;
}
export type RouteResult<T> = { ok: true; value: T } | RouteFailure;

const base = (workspaceId: string) => `/api/context/${encodeURIComponent(workspaceId)}`;

function isAbort(error: unknown): boolean {
  return error !== null && typeof error === "object" && (error as { name?: unknown }).name === "AbortError";
}

/** Il corpo JSON di una risposta, o null. */
async function bodyOf(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/** Una risposta non riuscita, con il messaggio della rotta (mai un codice) o quello dato. */
async function failureOf(response: Response, fallback: string): Promise<RouteFailure> {
  const body = await bodyOf(response);
  const record = body !== null && typeof body === "object" ? (body as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  if (record.fieldErrors !== null && typeof record.fieldErrors === "object") {
    for (const [key, value] of Object.entries(record.fieldErrors as Record<string, unknown>)) if (typeof value === "string" && value) fieldErrors[key] = value;
  }
  const retryAfter = Number(response.headers.get("retry-after"));
  return {
    ok: false,
    status: response.status,
    error: typeof record.error === "string" ? record.error : "",
    message: responseMessage(body, fallback),
    fieldErrors,
    retryAfterSeconds: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
  };
}

const networkFailure = (message: string): RouteFailure => ({ ok: false, status: 0, error: "rete", message, fieldErrors: {}, retryAfterSeconds: null });

/** Una richiesta JSON a una rotta: il corpo della risposta, o l'errore. Un'interruzione (`AbortError`) passa a chi chiama. */
async function call<T>(fetchImpl: FetchLike, url: string, init: RequestInit, fallback: string): Promise<RouteResult<T>> {
  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, headers: { Accept: "application/json", ...(init.body && typeof init.body === "string" ? { "Content-Type": "application/json" } : {}), ...(init.headers ?? {}) } });
  } catch (error) {
    if (isAbort(error)) throw error;
    return networkFailure(fallback);
  }
  if (!response.ok) return failureOf(response, fallback);
  const body = await bodyOf(response);
  if (body === null) return networkFailure(fallback);
  return { ok: true, value: body as T };
}

// ─── Appunti ─────────────────────────────────────────────────────────

export interface NoteDraft {
  title: string;
  occurredOn: string;
  body: string;
  participants: string;
  link: string;
}

/** «Aggiungi»: salva gli appunti (senza leggerli). 422 porta gli errori per campo. */
export function saveNote(fetchImpl: FetchLike, workspaceId: string, draft: NoteDraft, signal?: AbortSignal): Promise<RouteResult<AddedSource>> {
  const payload = {
    title: draft.title.trim(),
    occurredOn: draft.occurredOn.trim(),
    body: draft.body,
    participants: draft.participants.trim() || null,
    link: draft.link.trim() || null,
  };
  return call<AddedSource>(fetchImpl, `${base(workspaceId)}/sources`, { method: "POST", body: JSON.stringify(payload), signal }, CONTEXT_TEXT.errors.retry);
}

/** L'esito di una lettura intera: l'ultimo `ReadOutcome`, oppure un errore della rotta. */
export type ReadResult = { ok: true; outcome: ReadOutcome } | RouteFailure;

/** Quante richieste al massimo per una lettura: un appunto ha al massimo 3 parti; il resto è un margine. */
export const READ_CALLS_MAX = 6;

/**
 * Legge una fonte fino in fondo: richiama finché la rotta risponde `in_corso`. `onPart` riceve le parti già lette e
 * il totale, per «Leggo gli appunti… 2 di 3». `again` («Rileggi») solo alla prima richiesta.
 */
export async function readUntilDone(
  fetchImpl: FetchLike,
  workspaceId: string,
  sourceId: string,
  opts: { again?: boolean; signal?: AbortSignal; onPart?: (part: { partsRead: number; partsTotal: number }) => void } = {},
): Promise<ReadResult> {
  const url = `${base(workspaceId)}/sources/${encodeURIComponent(sourceId)}/read`;
  let again = opts.again === true;
  let last: ReadOutcome | null = null;
  for (let calls = 0; calls < READ_CALLS_MAX; calls += 1) {
    const result = await call<{ outcome?: ReadOutcome }>(fetchImpl, url, { method: "POST", body: JSON.stringify(again ? { again: true } : {}), signal: opts.signal }, CONTEXT_TEXT.read.failed);
    if (!result.ok) return result;
    const outcome = result.value?.outcome;
    if (!outcome || typeof outcome !== "object" || typeof outcome.status !== "string") return networkFailure(CONTEXT_TEXT.read.failed);
    last = outcome;
    if (outcome.status !== "in_corso") return { ok: true, outcome };
    again = false;
    opts.onPart?.({ partsRead: outcome.partsRead, partsTotal: outcome.partsTotal });
  }
  // Ancora parti dopo il massimo delle richieste: la lettura resta a metà e la riprende la pagina o la notte.
  return { ok: true, outcome: last ?? { status: "errore" } };
}

/** Come è finito il giro degli appunti in attesa: quanti letti, e perché si è fermato prima della fine. */
export interface PendingRun {
  read: number;
  stoppedBy: "ok_mancante" | "limite" | "sessione" | "errore" | null;
}

/**
 * Gli appunti in attesa, uno alla volta (`PendingReader`): ognuno fino in fondo. Un appunto che non si legge (rifiuto,
 * tempo, errore, già in lettura, tolto nel frattempo) non ferma gli altri. Si ferma tutto senza l'ok ai fornitori,
 * al limite del giorno, senza sessione, o se la rotta non risponde (rete, 503).
 */
export async function readPending(
  fetchImpl: FetchLike,
  workspaceId: string,
  sourceIds: readonly string[],
  opts: { signal?: AbortSignal; onProgress?: (index: number, total: number) => void } = {},
): Promise<PendingRun> {
  let read = 0;
  for (let i = 0; i < sourceIds.length; i += 1) {
    opts.onProgress?.(i + 1, sourceIds.length);
    const result = await readUntilDone(fetchImpl, workspaceId, sourceIds[i], { signal: opts.signal });
    if (!result.ok) {
      if (result.status === 401) return { read, stoppedBy: "sessione" };
      if (result.status === 0 || result.status >= 500) return { read, stoppedBy: "errore" };
      continue;
    }
    const status = result.outcome.status;
    if (status === "letto") read += 1;
    if (status === "ok_mancante" || status === "limite") return { read, stoppedBy: status };
  }
  return { read, stoppedBy: null };
}

// ─── Documenti ───────────────────────────────────────────────────────

/** La risposta della rotta di caricamento (§10.2). */
export interface UploadedDocument {
  id: string;
  sourceId: string;
  fileName: string;
  summary: string;
  textRead: boolean;
  ai: "ok" | "ok_mancante" | "non_serve";
}

/**
 * Carica un documento (`POST /api/documents/upload`, multipart). `origine`: `appunti` da «Aggiungi appunti» (Lateral
 * Space: nasce «Solo Lateral Space»), `chat` da «Carica documento». Data, titolo, «Con chi» e link sono facoltativi.
 */
export async function uploadDocument(
  fetchImpl: FetchLike,
  input: { workspaceId: string; file: File; origine: "appunti" | "chat"; occurredOn?: string; title?: string; participants?: string; link?: string },
  signal?: AbortSignal,
): Promise<RouteResult<UploadedDocument>> {
  const form = new FormData();
  form.set("file", input.file);
  form.set("workspaceId", input.workspaceId);
  form.set("origine", input.origine);
  if (input.occurredOn?.trim()) form.set("data", input.occurredOn.trim());
  if (input.title?.trim()) form.set("titolo", input.title.trim());
  if (input.participants?.trim()) form.set("conChi", input.participants.trim());
  if (input.link?.trim()) form.set("link", input.link.trim());
  const result = await call<UploadedDocument>(fetchImpl, "/api/documents/upload", { method: "POST", body: form, signal }, CONTEXT_TEXT.errors.retry);
  if (result.ok && (typeof result.value?.sourceId !== "string" || !result.value.sourceId)) return networkFailure(CONTEXT_TEXT.errors.retry);
  return result;
}

// ─── «Chiedi al contesto» ────────────────────────────────────────────

/** Una domanda. 429 (troppe domande) torna come errore con il suo messaggio e i secondi da aspettare. */
export function ask(fetchImpl: FetchLike, workspaceId: string, question: string, signal?: AbortSignal): Promise<RouteResult<AskAnswer>> {
  return call<AskAnswer>(fetchImpl, `${base(workspaceId)}/ask`, { method: "POST", body: JSON.stringify({ question }), signal }, CONTEXT_TEXT.ask.failed);
}

// ─── Pannelli ────────────────────────────────────────────────────────

/** Il dettaglio di un fatto o di una fonte, per i pannelli. */
export function getJson<T>(fetchImpl: FetchLike, url: string, signal?: AbortSignal): Promise<RouteResult<T>> {
  return call<T>(fetchImpl, url, { method: "GET", signal }, CONTEXT_TEXT.errors.retry);
}

export const factUrl = (workspaceId: string, factId: string) => `${base(workspaceId)}/facts/${encodeURIComponent(factId)}`;
export const sourceUrl = (workspaceId: string, sourceId: string) => `${base(workspaceId)}/sources/${encodeURIComponent(sourceId)}`;
