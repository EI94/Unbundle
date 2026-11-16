/**
 * Il collegamento a Granola: OAuth 2.1, cliente pubblico, PKCE S256 (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md
 * §8.2, §8.3).
 *
 * - **Il cliente.** Unbundle è un cliente pubblico: nessun segreto. Il suo `client_id` è l'indirizzo di un documento di
 *   metadati servito da Unbundle (`/api/granola/client-metadata`), sempre sull'origine pubblica (`emailOrigin`), mai su
 *   quella della richiesta. In riserva, la registrazione dinamica (RFC 7591).
 * - **Scope.** `openid email profile offline_access`, tenendo solo quelli che il server di autorizzazione elenca; in
 *   più quelli che la risorsa protetta dichiara, se il server li elenca.
 * - **Token.** Codice, rinnovo e revoca con un `POST` in form; la risposta si legge con prudenza: un errore porta solo il
 *   suo codice OAuth (`invalid_grant`…), mai il testo.
 * Modulo puro: `fetch` e indirizzi arrivano da fuori. Mai un token nei log.
 */
import { createHash, randomBytes } from "node:crypto";
import type { GranolaEndpoints } from "./endpoints.ts";
import type { GranolaTokens } from "./token-crypto.ts";

export const GRANOLA_CLIENT_NAME = "Unbundle";
export const GRANOLA_SCOPES = ["openid", "email", "profile", "offline_access"] as const;
/** Quanto vale uno stato del collegamento: 10 minuti. */
export const GRANOLA_STATE_TTL_MS = 10 * 60 * 1000;
const TOKEN_TIMEOUT_MS = 15_000;

// ─── Indirizzi e documento del cliente ───────────────────────────────

export function clientMetadataUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/granola/client-metadata`;
}

export function callbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, "")}/api/granola/callback`;
}

export interface GranolaClientMetadata {
  client_id?: string;
  client_name: string;
  client_uri: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: "none";
  scope: string;
}

/** Il documento di metadati del cliente (il `client_id` è il suo indirizzo), o la richiesta di registrazione senza `client_id`. */
export function clientMetadataDocument(origin: string, opts: { withClientId?: boolean } = {}): GranolaClientMetadata {
  const base = origin.replace(/\/+$/, "");
  const document: GranolaClientMetadata = {
    client_name: GRANOLA_CLIENT_NAME,
    client_uri: base,
    redirect_uris: [callbackUrl(base)],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    scope: GRANOLA_SCOPES.join(" "),
  };
  return opts.withClientId === false ? document : { client_id: clientMetadataUrl(base), ...document };
}

/** Documento di metadati (predefinito) o registrazione dinamica: la riserva se Granola non accetta il documento, o se lo chiede l'ambiente. */
export function chooseClientMode(endpoints: Pick<GranolaEndpoints, "metadataDocumentSupported">, mode: "cimd" | "dcr"): "cimd" | "dcr" {
  return mode === "dcr" || !endpoints.metadataDocumentSupported ? "dcr" : "cimd";
}

/** Gli scope da chiedere: i quattro di base che il server elenca, più quelli della risorsa protetta che il server elenca. */
export function granolaScopes(endpoints: Pick<GranolaEndpoints, "scopesSupported" | "resourceScopes">): string[] {
  const supported = endpoints.scopesSupported ?? [];
  const base = supported.length > 0 ? GRANOLA_SCOPES.filter((scope) => supported.includes(scope)) : [...GRANOLA_SCOPES];
  const extra = (endpoints.resourceScopes ?? []).filter((scope) => supported.length === 0 || supported.includes(scope));
  return [...new Set([...base, ...extra])];
}

// ─── PKCE e stato ────────────────────────────────────────────────────

const base64url = (bytes: Buffer) => bytes.toString("base64url");

/** Il `code_challenge` S256 di un verifier: base64url(sha256(verifier)). */
export function pkceChallenge(verifier: string): string {
  return base64url(createHash("sha256").update(verifier, "ascii").digest());
}

/** `code_verifier` di 32 byte casuali in base64url (43 caratteri) e il suo `code_challenge`. */
export function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: pkceChallenge(verifier) };
}

/** L'impronta di uno stato com'è salvata (`state_hash`): sha256 in esadecimale. Lo stato in chiaro non si salva. */
export function stateHash(state: string): string {
  return createHash("sha256").update(state, "utf8").digest("hex");
}

/** Uno stato nuovo: 32 byte casuali in base64url, e la sua impronta. */
export function createState(): { state: string; hash: string } {
  const state = base64url(randomBytes(32));
  return { state, hash: stateHash(state) };
}

/** Vero per uno stato con la forma di quelli che Unbundle crea. */
export function isStateShape(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);
}

/** L'indirizzo dove va il browser per dare l'accesso. */
export function authorizationUrl(
  endpoints: Pick<GranolaEndpoints, "authorization" | "resource">,
  p: { clientId: string; redirectUri: string; scope: readonly string[]; state: string; challenge: string },
): string {
  const url = new URL(endpoints.authorization);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", p.clientId);
  url.searchParams.set("redirect_uri", p.redirectUri);
  url.searchParams.set("scope", p.scope.join(" "));
  url.searchParams.set("state", p.state);
  url.searchParams.set("code_challenge", p.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("resource", endpoints.resource);
  return url.toString();
}

// ─── Token ───────────────────────────────────────────────────────────

export type TokenOutcome =
  | { ok: true; tokens: GranolaTokens; expiresIn: number | null }
  /** `error`: il codice OAuth (`invalid_grant`…), oppure `rete`, `tempo`, `protocollo`. Mai un testo del server. */
  | { ok: false; error: string };

const OAUTH_CODE = /^[a-z0-9_]{2,40}$/;
type Deps = { fetch: typeof fetch; endpoints: GranolaEndpoints };

function isTimeout(error: unknown): boolean {
  const name = (error as { name?: unknown })?.name;
  return name === "TimeoutError" || name === "AbortError";
}

async function postForm(deps: Deps, url: string, form: Record<string, string>): Promise<{ status: number; json: Record<string, unknown> | null } | { error: "rete" | "tempo" }> {
  try {
    const response = await deps.fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(form).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    const text = await response.text();
    let json: Record<string, unknown> | null = null;
    try {
      const parsed = text.length <= 64_000 ? (JSON.parse(text) as unknown) : null;
      json = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch (error) {
    return { error: isTimeout(error) ? "tempo" : "rete" };
  }
}

/** La risposta del server di token: i token e la durata, o il codice dell'errore. */
export function readTokenResponse(status: number, json: Record<string, unknown> | null): TokenOutcome {
  if (status < 200 || status >= 300 || !json || typeof json.access_token !== "string") {
    const code = typeof json?.error === "string" ? json.error.trim().toLowerCase() : "";
    return { ok: false, error: OAUTH_CODE.test(code) ? code : "protocollo" };
  }
  const accessToken = json.access_token.trim();
  if (!accessToken || accessToken.length > 8_000) return { ok: false, error: "protocollo" };
  const tokenType = typeof json.token_type === "string" && json.token_type.trim() ? json.token_type.trim() : "Bearer";
  if (tokenType.toLowerCase() !== "bearer") return { ok: false, error: "protocollo" };
  const refreshToken = typeof json.refresh_token === "string" && json.refresh_token.trim() ? json.refresh_token.trim() : null;
  if (refreshToken && refreshToken.length > 8_000) return { ok: false, error: "protocollo" };
  const seconds = typeof json.expires_in === "number" ? json.expires_in : typeof json.expires_in === "string" ? Number(json.expires_in) : NaN;
  const expiresIn = Number.isFinite(seconds) && seconds > 0 ? Math.min(Math.floor(seconds), 365 * 24 * 3600) : null;
  const scope = typeof json.scope === "string" && json.scope.trim() ? json.scope.trim().slice(0, 1_000) : null;
  return { ok: true, tokens: { accessToken, refreshToken, tokenType: "Bearer", scope }, expiresIn };
}

/** Il codice del ritorno in cambio dei token (`grant_type=authorization_code`, con il verifier e la risorsa). */
export async function exchangeCode(deps: Deps, p: { code: string; redirectUri: string; clientId: string; verifier: string }): Promise<TokenOutcome> {
  const reply = await postForm(deps, deps.endpoints.token, {
    grant_type: "authorization_code",
    code: p.code,
    redirect_uri: p.redirectUri,
    client_id: p.clientId,
    code_verifier: p.verifier,
    resource: deps.endpoints.resource,
  });
  return "error" in reply ? { ok: false, error: reply.error } : readTokenResponse(reply.status, reply.json);
}

/** Il rinnovo (`grant_type=refresh_token`): il `refresh_token` può cambiare. */
export async function refreshTokens(deps: Deps, p: { refreshToken: string; clientId: string }): Promise<TokenOutcome> {
  const reply = await postForm(deps, deps.endpoints.token, {
    grant_type: "refresh_token",
    refresh_token: p.refreshToken,
    client_id: p.clientId,
    resource: deps.endpoints.resource,
  });
  return "error" in reply ? { ok: false, error: reply.error } : readTokenResponse(reply.status, reply.json);
}

/** La revoca (RFC 7009). Vero se il server ha risposto 200; se non riesce si va avanti lo stesso. */
export async function revokeToken(deps: Deps, p: { token: string; hint: "refresh_token" | "access_token"; clientId: string }): Promise<boolean> {
  const reply = await postForm(deps, deps.endpoints.revocation, { token: p.token, token_type_hint: p.hint, client_id: p.clientId });
  return !("error" in reply) && reply.status === 200;
}

/** La registrazione dinamica (RFC 7591), la riserva: il `client_id` ricevuto, o null. */
export async function registerClient(deps: Deps, origin: string): Promise<string | null> {
  try {
    const response = await deps.fetch(deps.endpoints.registration, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify(clientMetadataDocument(origin, { withClientId: false })),
      redirect: "error",
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    });
    if (response.status !== 200 && response.status !== 201) return null;
    const json = (await response.json()) as { client_id?: unknown };
    const clientId = typeof json?.client_id === "string" ? json.client_id.trim() : "";
    return clientId && clientId.length <= 500 && !/\s/.test(clientId) ? clientId : null;
  } catch {
    return null;
  }
}
