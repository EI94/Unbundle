/**
 * Igiene HTTP dei server MCP remoti di Unbundle (connettore, prompt WP4).
 *
 * Funzioni con parametri, senza nulla di proprio del connettore: le usa la rotta
 * del connettore (`/api/mcp/connettore/[slug]`) e, senza modifiche, il MCP del team
 * (`docs/use-case/DESIGN.md` §9.4). Chi chiama passa l'elenco delle origini
 * ammesse, il limite del corpo e i prefissi dei propri token.
 *
 * - **Token nell'indirizzo**: un parametro con un nome da credenziale (`token`,
 *   `apiKey`, `access_token`, `key`…) o un valore, nella query o nel percorso, che
 *   inizia con un prefisso di token Unbundle → 400 `{"error":"token_in_url"}`,
 *   senza ripetere l'indirizzo. I token trovati si restituiscono a chi chiama, che
 *   li considera compromessi (non finiscono mai in un log o in una risposta).
 * - **Origin**: se l'header c'è e non è nell'elenco → 403. Elenco vuoto: ogni
 *   `Origin` presente dà 403. Senza `Origin` la richiesta passa. Il controllo si fa
 *   qui, prima del transport: l'opzione `allowedOrigins` dell'SDK con un elenco
 *   vuoto non controlla nulla.
 * - **Content-Type** diverso da `application/json` → 415.
 * - **Corpo** oltre il limite (256 KB), letto a blocchi: un `content-length` falso
 *   non basta a superarlo → 413. JSON o UTF-8 non validi → 400.
 * - L'header `Accept` lo controlla l'SDK (406): qui nessun controllo che rifiuti
 *   `text/event-stream`.
 * - Ogni risposta ha `Cache-Control: no-store` e `X-Content-Type-Options: nosniff`.
 *
 * Gli errori sono `{ "error": codice }`: mai l'indirizzo, il corpo o un header.
 * Modulo puro, senza import: gira con `node --test`.
 */

/** Limite del corpo JSON-RPC (prompt WP4). */
export const MCP_BODY_MAX_BYTES = 256 * 1024;

/** Intestazioni di ogni risposta dei server MCP remoti. */
export const HYGIENE_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
});

/** Nomi di parametro che indicano una credenziale (confronto senza maiuscole). */
export const DEFAULT_TOKEN_PARAM_NAMES: readonly string[] = Object.freeze([
  "token",
  "apikey",
  "api_key",
  "access_token",
  "key",
  "authorization",
]);

/**
 * Prefissi dei token Unbundle: token di workspace (connettore e REST) e token
 * personali del MCP del team. Un valore con uno di questi prefissi, ovunque
 * nell'indirizzo, è un token esposto.
 */
export const DEFAULT_TOKEN_PREFIXES: readonly string[] = Object.freeze(["ub_mcp_", "ub_team_"]);

export const HYGIENE_ERROR_STATUS = Object.freeze({
  not_found: 404,
  method_not_allowed: 405,
  token_in_url: 400,
  origin_not_allowed: 403,
  unsupported_media_type: 415,
  payload_too_large: 413,
  invalid_json: 400,
  unauthorized: 401,
  internal_error: 500,
} as const);

export type HygieneErrorCode = keyof typeof HYGIENE_ERROR_STATUS;

// ── Risposte ─────────────────────────────────────────────────────────

/** Risposta JSON con le intestazioni di igiene. */
export function hygieneJson(body: unknown, status = 200, extra: Readonly<Record<string, string>> = {}): Response {
  return Response.json(body, { status, headers: { ...HYGIENE_HEADERS, ...extra } });
}

/** Errore `{ error: codice }` con lo stato HTTP del codice. */
export function hygieneError(code: HygieneErrorCode, extra: Readonly<Record<string, string>> = {}): Response {
  return hygieneJson({ error: code }, HYGIENE_ERROR_STATUS[code], extra);
}

/** 405 per i metodi diversi da quelli ammessi (di solito solo POST). */
export function methodNotAllowed(allowed: readonly string[] = ["POST"]): Response {
  return hygieneError("method_not_allowed", { Allow: allowed.join(", ") });
}

/**
 * Aggiunge le intestazioni di igiene a una risposta già pronta (per esempio quella
 * del transport dell'SDK), senza toccare stato e corpo.
 */
export function withHygieneHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(HYGIENE_HEADERS)) headers.set(name, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

// ── Token nell'indirizzo ─────────────────────────────────────────────

export interface TokenInUrlOptions {
  /** Nomi di parametro da credenziale; predefiniti: `DEFAULT_TOKEN_PARAM_NAMES`. */
  paramNames?: readonly string[];
  /** Prefissi dei token; predefiniti: `DEFAULT_TOKEN_PREFIXES`. */
  tokenPrefixes?: readonly string[];
}

export interface TokenInUrlFinding {
  found: boolean;
  /**
   * Token trovati (valori con un prefisso noto), al massimo 5, senza doppioni.
   * Sono segreti compromessi: si usano solo per cercarli (come hash) e segnalarli.
   */
  candidates: string[];
}

const MAX_CANDIDATES = 5;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeDecode(value: string) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * Cerca una credenziale nella query o nel percorso. `found` vale anche per un
 * parametro con un nome da credenziale senza un token riconoscibile.
 */
export function findTokenInUrl(url: string | URL, opts: TokenInUrlOptions = {}): TokenInUrlFinding {
  let parsed: URL;
  try {
    parsed = typeof url === "string" ? new URL(url) : url;
  } catch {
    return { found: false, candidates: [] };
  }
  const names = new Set((opts.paramNames ?? DEFAULT_TOKEN_PARAM_NAMES).map((n) => n.toLowerCase()));
  const prefixes = (opts.tokenPrefixes ?? DEFAULT_TOKEN_PREFIXES).filter((p) => p.length > 0);
  const pattern = prefixes.length
    ? new RegExp(`(?:${prefixes.map(escapeRegExp).join("|")})[A-Za-z0-9_-]{8,256}`, "g")
    : null;

  let found = false;
  const candidates: string[] = [];
  const scan = (text: string) => {
    if (!pattern || !text) return;
    for (const match of text.matchAll(pattern)) {
      found = true;
      if (candidates.length < MAX_CANDIDATES && !candidates.includes(match[0])) candidates.push(match[0]);
    }
    if (prefixes.some((p) => text.includes(p))) found = true;
  };

  for (const [name, value] of parsed.searchParams) {
    if (names.has(name.toLowerCase())) found = true;
    scan(name);
    scan(value);
  }
  scan(safeDecode(parsed.pathname));
  return { found, candidates };
}

// ── Origin ───────────────────────────────────────────────────────────

/** `scheme://host[:porta]` in minuscolo, solo http e https; altrimenti null. */
export function normalizeOrigin(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 300) return null;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
  if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
  if (parsed.pathname !== "/" && parsed.pathname !== "") return null;
  return parsed.origin.toLowerCase();
}

/** Elenco di origini ammesse, ripulito: solo voci valide, senza doppioni. */
export function normalizeAllowedOrigins(list: unknown): string[] {
  if (!Array.isArray(list)) return [];
  const out: string[] = [];
  for (const entry of list) {
    const origin = normalizeOrigin(entry);
    if (origin && !out.includes(origin)) out.push(origin);
  }
  return out;
}

/**
 * Origini dei client di Claude e di Anthropic che il log delle chiamate scrive per nome
 * (`loggableOrigin`): servono alla verifica nell'organizzazione di prova (claude.ai manda un
 * header `Origin`? quale?, `docs/connettore/VERIFICA.md`). Non sono ammesse per questo: le
 * ammette solo `allowed_origins` del workspace.
 */
export const CLAUDE_CLIENT_ORIGINS: readonly string[] = Object.freeze([
  "https://claude.ai",
  "https://www.claude.ai",
  "https://claude.com",
  "https://www.claude.com",
  "https://anthropic.com",
  "https://www.anthropic.com",
]);

/**
 * L'header `Origin` come entra nel log delle chiamate: assente → null; un'origine di
 * `knownOrigins` (per esempio `CLAUDE_CLIENT_ORIGINS` più le origini ammesse dal workspace)
 * → la sua forma normalizzata; ogni altro valore, valido o no → `other`. L'header lo scrive
 * il client: un'origine sconosciuta non entra nel log nemmeno come nome di host.
 */
export function loggableOrigin(header: string | null | undefined, knownOrigins: readonly string[]): string | null {
  if (header === null || header === undefined) return null;
  const origin = normalizeOrigin(header);
  return origin && normalizeAllowedOrigins(knownOrigins).includes(origin) ? origin : "other";
}

/**
 * Vero se la richiesta può passare: senza header `Origin`, oppure con un'origine
 * dell'elenco. Un header presente ma vuoto, `null` o non valido non passa.
 */
export function isOriginAllowed(origin: string | null, allowedOrigins: readonly string[]): boolean {
  if (origin === null) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized) return false;
  return normalizeAllowedOrigins(allowedOrigins).includes(normalized);
}

// ── Corpo ────────────────────────────────────────────────────────────

/** Solo `application/json` (parametri come `charset` ammessi). */
export function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  return value.split(";", 1)[0].trim().toLowerCase() === "application/json";
}

/** Vero se `content-length` dichiara più del limite, o non è un numero. */
export function declaredBodyTooLarge(headers: { get(name: string): string | null }, maxBytes = MCP_BODY_MAX_BYTES): boolean {
  const declared = headers.get("content-length");
  if (declared === null) return false;
  return !/^\d{1,15}$/.test(declared.trim()) || Number(declared.trim()) > maxBytes;
}

export type JsonBodyResult =
  | { ok: true; value: unknown }
  | { ok: false; code: "unsupported_media_type" | "payload_too_large" | "invalid_json" };

/**
 * Corpo JSON letto a blocchi, con il limite di byte e UTF-8 valido. Oltre il
 * limite smette di leggere e annulla il resto del flusso.
 */
export async function readJsonBodyLimited(request: Request, maxBytes = MCP_BODY_MAX_BYTES): Promise<JsonBodyResult> {
  if (!isJsonContentType(request.headers.get("content-type"))) return { ok: false, code: "unsupported_media_type" };
  if (declaredBodyTooLarge(request.headers, maxBytes)) return { ok: false, code: "payload_too_large" };
  if (!request.body) return { ok: false, code: "invalid_json" };
  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return { ok: false, code: "payload_too_large" };
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
  } catch {
    return { ok: false, code: "invalid_json" };
  } finally {
    reader.releaseLock();
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, code: "invalid_json" };
  }
}

// ── Controlli in ordine ──────────────────────────────────────────────

export interface McpRequestScreenOptions {
  /** Origini ammesse (header `Origin`); vuoto = nessuna. */
  allowedOrigins: readonly string[];
  /** Limite del corpo; predefinito `MCP_BODY_MAX_BYTES`. */
  maxBytes?: number;
  /** Metodi ammessi; predefinito solo POST. */
  methods?: readonly string[];
  tokenInUrl?: TokenInUrlOptions;
}

export type McpScreenResult =
  | { ok: true }
  | {
      ok: false;
      code: HygieneErrorCode;
      response: Response;
      /** Token trovati nell'indirizzo (solo con `token_in_url`), da trattare come compromessi. */
      exposedTokens: string[];
    };

function rejected(code: HygieneErrorCode, extra: Readonly<Record<string, string>> = {}, exposedTokens: string[] = []): McpScreenResult {
  return { ok: false, code, response: hygieneError(code, extra), exposedTokens };
}

/**
 * Controlli che non leggono il corpo, nell'ordine: token nell'indirizzo (prima di
 * tutto, così un token esposto non arriva oltre), metodo, `Origin`, `Content-Type`,
 * lunghezza dichiarata. Chi chiama autentica dopo, e solo allora legge il corpo
 * con `readMcpJsonBody`: una richiesta senza credenziale non fa leggere 256 KB.
 */
export function screenMcpRequest(request: Request, opts: McpRequestScreenOptions): McpScreenResult {
  const finding = findTokenInUrl(request.url, opts.tokenInUrl);
  if (finding.found) return rejected("token_in_url", {}, finding.candidates);
  const methods = opts.methods ?? ["POST"];
  if (!methods.includes(request.method.toUpperCase())) {
    return rejected("method_not_allowed", { Allow: methods.join(", ") });
  }
  if (!isOriginAllowed(request.headers.get("origin"), opts.allowedOrigins)) return rejected("origin_not_allowed");
  if (!isJsonContentType(request.headers.get("content-type"))) return rejected("unsupported_media_type");
  if (declaredBodyTooLarge(request.headers, opts.maxBytes ?? MCP_BODY_MAX_BYTES)) return rejected("payload_too_large");
  return { ok: true };
}

/** Il corpo JSON-RPC, oppure la risposta d'errore pronta (413, 415 o 400). */
export async function readMcpJsonBody(
  request: Request,
  maxBytes = MCP_BODY_MAX_BYTES
): Promise<{ ok: true; body: unknown } | { ok: false; code: HygieneErrorCode; response: Response }> {
  const result = await readJsonBodyLimited(request, maxBytes);
  if (result.ok) return { ok: true, body: result.value };
  return { ok: false, code: result.code, response: hygieneError(result.code) };
}
