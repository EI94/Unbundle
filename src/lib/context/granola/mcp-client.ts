/**
 * Un client MCP minimo per Granola, in sola lettura (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.4).
 * Solo `fetch`, niente SDK: MCP su HTTP (JSON-RPC 2.0), `initialize`, la notifica `notifications/initialized`, poi
 * `tools/call`.
 *
 * - **Solo lettura.** Il tipo e il controllo a runtime ammettono solo i cinque strumenti che leggono
 *   (`GRANOLA_READ_TOOLS`): un altro nome lancia `strumento_vietato` prima di ogni richiesta. Gli strumenti che
 *   scrivono non hanno un nome in questo codice.
 * - **Richiesta.** `POST` alla risorsa con `Authorization: Bearer …`, `Accept: application/json, text/event-stream`; dopo
 *   `initialize` anche `MCP-Protocol-Version` (quella che ha risposto il server) e `Mcp-Session-Id`, se il server l'ha dato.
 * - **Risposta.** JSON, oppure eventi SSE letti finché arriva il messaggio con lo stesso `id` (notifiche e richieste del
 *   server si ignorano). Al massimo 2 MB e 30 secondi per chiamata.
 * - **Errori** (`GranolaMcpError`, con un codice e mai il testo del server): 401 → `non_autorizzato`; `rate_limit` →
 *   `limite` con i secondi da aspettare; il piano a pagamento → `piano`; tempo scaduto → `tempo`; il resto `protocollo`
 *   o `rete`.
 * - Una chiamata alla volta: Granola chiede al massimo 2 `search_meetings` e 5 `get_meetings` insieme, e chi usa questo
 *   client le fa sempre in fila.
 * Nei log solo il nome dello strumento, il codice dell'errore e i numeri. Modulo puro (la `fetch` arriva da fuori).
 */
import type { GranolaEndpoints } from "./endpoints.ts";

export const GRANOLA_READ_TOOLS = ["search_meetings", "get_meetings", "list_meeting_folders", "get_account_info", "get_meeting_transcript"] as const;
export type GranolaReadTool = (typeof GRANOLA_READ_TOOLS)[number];

export type GranolaErrorCode = "non_autorizzato" | "limite" | "piano" | "protocollo" | "rete" | "tempo" | "strumento_vietato";

export class GranolaMcpError extends Error {
  readonly code: GranolaErrorCode;
  readonly retryAfterSeconds: number | null;
  readonly retryable: boolean;

  constructor(code: GranolaErrorCode, opts: { retryAfterSeconds?: number | null; retryable?: boolean } = {}) {
    // Il messaggio è il codice: il testo del server non esce mai da qui.
    super(`granola_${code}`);
    this.name = "GranolaMcpError";
    this.code = code;
    this.retryAfterSeconds = opts.retryAfterSeconds ?? null;
    this.retryable = opts.retryable ?? (code === "limite" || code === "rete" || code === "tempo");
  }
}

export interface GranolaMcpDeps {
  fetch: typeof fetch;
  endpoints: GranolaEndpoints;
  /** Per chiamata: 30 secondi. */
  timeoutMs?: number;
  /** Per risposta: 2 MB. */
  maxBytes?: number;
}

export interface GranolaSession {
  accessToken: string;
  sessionId: string | null;
  protocolVersion: string;
  nextId: number;
}

export const GRANOLA_PROTOCOL_VERSION = "2025-06-18";
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const SESSION_ID = /^[\x21-\x7e]{1,200}$/;
const VERSION = /^\d{4}-\d{2}-\d{2}$/;

type JsonRecord = Record<string, unknown>;
const isRecord = (value: unknown): value is JsonRecord => typeof value === "object" && value !== null && !Array.isArray(value);

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

/** Il corpo della risposta, al massimo `maxBytes`: oltre si ferma e lancia `protocollo`. */
async function readLimited(response: Response, maxBytes: number): Promise<string> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.cancel().catch(() => {});
    throw new GranolaMcpError("protocollo");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new GranolaMcpError("protocollo");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** Il messaggio JSON-RPC con quell'`id` in uno stream SSE, letto a pezzi: le altre righe si ignorano. */
async function readSseFor(response: Response, id: number, maxBytes: number): Promise<JsonRecord> {
  if (!response.body) throw new GranolaMcpError("protocollo");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let buffer = "";
  let data: string[] = [];
  const dispatch = (): JsonRecord | null => {
    if (data.length === 0) return null;
    const payload = data.join("\n");
    data = [];
    try {
      const message = JSON.parse(payload) as unknown;
      const list = Array.isArray(message) ? message : [message];
      for (const item of list) if (isRecord(item) && item.id === id && ("result" in item || "error" in item)) return item;
    } catch {
      // Un evento che non è JSON: si ignora.
    }
    return null;
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (value) {
        size += value.byteLength;
        if (size > maxBytes) throw new GranolaMcpError("protocollo");
        buffer += decoder.decode(value, { stream: true });
      }
      if (done) buffer += `${decoder.decode()}\n\n`;
      let newline: number;
      while ((newline = buffer.search(/\r\n|\r|\n/)) >= 0) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + (buffer.startsWith("\r\n", newline) ? 2 : 1));
        if (line === "") {
          const found = dispatch();
          if (found) return found;
        } else if (line.startsWith("data:")) {
          data.push(line.slice(5).replace(/^ /, ""));
        }
      }
      if (done) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  throw new GranolaMcpError("protocollo");
}

/** I secondi da aspettare e se si può riprovare, dal testo o dal JSON di un errore `rate_limit`. */
function rateLimitInfo(text: string): { retryAfterSeconds: number | null; retryable: boolean } {
  let seconds: number | null = null;
  let retryable = true;
  try {
    const json = JSON.parse(text) as unknown;
    if (isRecord(json)) {
      const s = Number(json.retry_after_seconds);
      if (Number.isFinite(s) && s >= 0) seconds = Math.ceil(s);
      if (json.retryable === false) retryable = false;
    }
  } catch {
    // Non è JSON: si legge il testo.
  }
  if (seconds === null) {
    const found = /retry_after_seconds["']?\s*[:=]\s*["']?(\d{1,6}(?:\.\d+)?)/i.exec(text);
    if (found) seconds = Math.ceil(Number(found[1]));
  }
  if (/retryable["']?\s*[:=]\s*["']?false/i.test(text)) retryable = false;
  return { retryAfterSeconds: seconds, retryable };
}

const PAID_PLAN = /\bpaid\b|upgrade|subscription|free plan|not (?:available|included) (?:on|in) your plan/i;

/** Il codice di un errore dello strumento (un errore JSON-RPC o un risultato `isError`), dal suo testo. */
function toolError(text: string): GranolaMcpError {
  if (/rate[_ -]?limit/i.test(text)) return new GranolaMcpError("limite", rateLimitInfo(text));
  if (PAID_PLAN.test(text)) return new GranolaMcpError("piano", { retryable: false });
  return new GranolaMcpError("protocollo", { retryable: false });
}

/** I secondi di `Retry-After` (numero), o null. */
function retryAfterHeader(response: Response): number | null {
  const value = Number(response.headers.get("retry-after"));
  return Number.isFinite(value) && value >= 0 ? Math.ceil(value) : null;
}

async function post(session: GranolaSession, body: JsonRecord, deps: GranolaMcpDeps, initializing: boolean): Promise<Response> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
  };
  if (!initializing) headers["MCP-Protocol-Version"] = session.protocolVersion;
  if (session.sessionId) headers["Mcp-Session-Id"] = session.sessionId;
  try {
    return await deps.fetch(deps.endpoints.resource, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (error) {
    throw new GranolaMcpError(isTimeout(error) ? "tempo" : "rete");
  }
}

/** Gli stati HTTP che non sono una risposta: 401 e 403, 429, il resto. */
function checkStatus(response: Response): void {
  if (response.status === 401 || response.status === 403) throw new GranolaMcpError("non_autorizzato", { retryable: false });
  if (response.status === 429) throw new GranolaMcpError("limite", { retryAfterSeconds: retryAfterHeader(response) });
  if (response.status >= 500) throw new GranolaMcpError("rete");
  if (response.status < 200 || response.status >= 300) throw new GranolaMcpError("protocollo", { retryable: false });
}

/** Una richiesta JSON-RPC e la sua risposta (`result`); un `error` del server diventa un `GranolaMcpError`. */
async function request(session: GranolaSession, method: string, params: JsonRecord, deps: GranolaMcpDeps, initializing = false): Promise<{ result: JsonRecord; response: Response }> {
  const id = session.nextId++;
  const maxBytes = deps.maxBytes ?? DEFAULT_MAX_BYTES;
  const response = await post(session, { jsonrpc: "2.0", id, method, params }, deps, initializing);
  checkStatus(response);
  let message: JsonRecord;
  try {
    const type = (response.headers.get("content-type") ?? "").toLowerCase();
    if (type.includes("text/event-stream")) {
      message = await readSseFor(response, id, maxBytes);
    } else {
      const parsed = JSON.parse(await readLimited(response, maxBytes)) as unknown;
      const list = Array.isArray(parsed) ? parsed : [parsed];
      const found = list.find((item) => isRecord(item) && item.id === id);
      if (!isRecord(found)) throw new GranolaMcpError("protocollo");
      message = found;
    }
  } catch (error) {
    if (error instanceof GranolaMcpError) throw error;
    throw new GranolaMcpError(isTimeout(error) ? "tempo" : "protocollo");
  }
  if (isRecord(message.error)) {
    const error = message.error;
    const data = error.data === undefined ? "" : JSON.stringify(error.data);
    throw toolError(`${typeof error.message === "string" ? error.message : ""} ${data}`);
  }
  if (!isRecord(message.result)) throw new GranolaMcpError("protocollo");
  return { result: message.result, response };
}

/** `initialize`, poi la notifica `notifications/initialized`. */
export async function openGranolaSession(accessToken: string, deps: GranolaMcpDeps): Promise<GranolaSession> {
  const session: GranolaSession = { accessToken, sessionId: null, protocolVersion: GRANOLA_PROTOCOL_VERSION, nextId: 1 };
  const { result, response } = await request(
    session,
    "initialize",
    { protocolVersion: GRANOLA_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: "Unbundle", version: "1.0.0" } },
    deps,
    true,
  );
  const version = typeof result.protocolVersion === "string" && VERSION.test(result.protocolVersion) ? result.protocolVersion : GRANOLA_PROTOCOL_VERSION;
  const sessionId = response.headers.get("mcp-session-id");
  session.protocolVersion = version;
  session.sessionId = sessionId && SESSION_ID.test(sessionId) ? sessionId : null;
  const notified = await post(session, { jsonrpc: "2.0", method: "notifications/initialized" }, deps, false);
  await notified.body?.cancel().catch(() => {});
  checkStatus(notified);
  return session;
}

/**
 * `tools/call`. Restituisce il testo del risultato (i blocchi `text` uniti; senza testo, il JSON di
 * `structuredContent`). Un nome fuori da GRANOLA_READ_TOOLS lancia `strumento_vietato` prima di ogni richiesta.
 */
export async function callGranolaTool(session: GranolaSession, tool: GranolaReadTool, args: Record<string, unknown>, deps: GranolaMcpDeps): Promise<string> {
  if (!(GRANOLA_READ_TOOLS as readonly string[]).includes(tool)) throw new GranolaMcpError("strumento_vietato", { retryable: false });
  const { result } = await request(session, "tools/call", { name: tool, arguments: args ?? {} }, deps);
  const blocks = Array.isArray(result.content) ? result.content : [];
  let text = blocks
    .filter((block): block is JsonRecord => isRecord(block) && block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n");
  if (!text && isRecord(result.structuredContent)) text = JSON.stringify(result.structuredContent);
  if (result.isError === true) throw toolError(text);
  return text;
}
