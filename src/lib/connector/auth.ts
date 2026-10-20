/**
 * Autenticazione di fase 1 del connettore (prompt WP4): header statico con un
 * token di workspace.
 *
 * - Si legge **solo** `Authorization: Bearer ub_mcp_…`. Nessun token in query,
 *   cookie o corpo (un token nell'indirizzo si rifiuta prima, vedi `http-hygiene.ts`).
 * - Il token vale se non è revocato né scaduto, ha **entrambi** gli scope
 *   `connector:read` e `connector:submit` ed è del workspace dello slug. Altrimenti
 *   401 `{"error":"unauthorized"}`. Così dentro i tool non serve un errore di scope.
 *   I token REST (`portfolio:submit`) non hanno questi scope e i token del
 *   connettore non hanno `portfolio:submit`: le due porte restano separate.
 * - In modalità `header` il 401 non ha `WWW-Authenticate`. Il ramo `oauth` (fase 2)
 *   risponde 401 con `WWW-Authenticate: Bearer resource_metadata="…"`: resta spento
 *   finché non ci sono gli endpoint OAuth (nessuna configurazione usa `oauth`).
 * - I token del connettore nascono con i due scope e scadono dopo 90 giorni; la
 *   dashboard avvisa 14 giorni prima (`connectorTokenExpiry`). Decisione di Pierpaolo
 *   all'arresto B (14/10/2026): 90 giorni invece dei 60 proposti, per coprire il pilota.
 *
 * Il token si confronta solo come hash SHA-256: è la stessa funzione delle altre
 * credenziali di workspace (`hashIntegrationToken`), che il MCP del team importa.
 * Modulo puro (solo `node:crypto`): gira con `node --test`.
 */
import { createHash } from "node:crypto";
import type { IdentityMode } from "./contract.ts";
import type { ConnectorAuthMode } from "./config.ts";
import { hygieneError } from "./http-hygiene.ts";

/** Prefisso dei token di workspace (REST, server stdio e connettore). */
export const CONNECTOR_TOKEN_PREFIX = "ub_mcp_";
/** `workspace_integration_tokens.provider` dei token del connettore. */
export const CONNECTOR_PROVIDER = "claude_connector";
export const CONNECTOR_READ_SCOPE = "connector:read";
export const CONNECTOR_SUBMIT_SCOPE = "connector:submit";
/** Scope di ogni token del connettore, tutti richiesti all'autenticazione. */
export const CONNECTOR_SCOPES: readonly string[] = Object.freeze([CONNECTOR_READ_SCOPE, CONNECTOR_SUBMIT_SCOPE]);

/** Durata di un token del connettore (decisione dell'arresto B: 90 giorni). */
export const CONNECTOR_TOKEN_TTL_DAYS = 90;
/** Giorni prima della scadenza in cui la dashboard avvisa Lateral Space. */
export const CONNECTOR_TOKEN_WARNING_DAYS = 14;
/**
 * Testo da mostrare accanto alla scadenza del token (sezione «Connettore Claude»):
 * in Claude l'header non si modifica.
 */
export const CONNECTOR_TOKEN_ROTATION_NOTE =
  "In Claude l'header del connettore non si modifica: per cambiare token l'Owner rimuove e riaggiunge il connettore, e tutti rifanno «Connetti».";

/** Indirizzo pubblico di Unbundle, sempre con www (prompt §3). */
export const CONNECTOR_PUBLIC_ORIGIN = "https://www.theunbundle.com";

const DAY_MS = 24 * 60 * 60 * 1000;
const TOKEN_BODY = /^[A-Za-z0-9_-]{16,200}$/;

/** Hash SHA-256 esadecimale di una credenziale di workspace: in tabella c'è solo questo. */
export function hashIntegrationToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Il token di `Authorization: Bearer <token>`, solo se ha il prefisso atteso e una
 * forma plausibile; altrimenti null (401 senza toccare il database).
 */
export function bearerTokenFromHeader(value: string | null, prefix: string = CONNECTOR_TOKEN_PREFIX): string | null {
  if (!value) return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(value.trim());
  const token = match?.[1];
  if (!token || !token.startsWith(prefix)) return null;
  return TOKEN_BODY.test(token.slice(prefix.length)) ? token : null;
}

/** Vero se `scopes` è un elenco che contiene tutti gli scope richiesti. */
export function hasAllScopes(scopes: unknown, required: readonly string[]): boolean {
  if (!Array.isArray(scopes)) return false;
  return required.every((scope) => scopes.includes(scope));
}

/** Chi chiama il connettore, a ogni richiesta. */
export interface ConnectorPrincipal {
  workspaceId: string;
  slug: string;
  /** `token:<id>` in fase 1, `user:<identityId>` in fase 2 (chiave dell'idempotenza). */
  principalKey: string;
  identityMode: IdentityMode;
  scopes: string[];
  /** Token di workspace (fase 1); null per un'identità di fase 2. */
  tokenId: string | null;
  /** Identità verificata (fase 2); null in fase 1. */
  identityId: string | null;
}

/** Principal di fase 1, da un token già verificato. */
export function principalFromToken(
  token: { id: string; scopes: readonly string[] },
  config: { workspaceId: string; slug: string; identityMode: IdentityMode }
): ConnectorPrincipal {
  return {
    workspaceId: config.workspaceId,
    slug: config.slug,
    principalKey: `token:${token.id}`,
    identityMode: config.identityMode,
    scopes: [...token.scopes],
    tokenId: token.id,
    identityId: null,
  };
}

/** Metadati della risorsa protetta (fase 2), per l'header `WWW-Authenticate`. */
export function resourceMetadataUrl(slug: string, origin: string = CONNECTOR_PUBLIC_ORIGIN): string {
  return `${origin.replace(/\/+$/, "")}/.well-known/oauth-protected-resource/api/mcp/connettore/${encodeURIComponent(slug)}`;
}

/**
 * 401 `{"error":"unauthorized"}`. In modalità `header` (e per uno slug che non
 * esiste) senza `WWW-Authenticate`; in modalità `oauth` con i metadati della risorsa.
 */
export function connectorUnauthorized(config: { authMode: ConnectorAuthMode; slug: string } | null, origin?: string): Response {
  if (config?.authMode === "oauth") {
    return hygieneError("unauthorized", {
      "WWW-Authenticate": `Bearer resource_metadata="${resourceMetadataUrl(config.slug, origin)}"`,
    });
  }
  return hygieneError("unauthorized");
}

/** Scadenza di un token del connettore creato adesso. */
export function connectorTokenExpiresAt(now: Date = new Date()): Date {
  return new Date(now.getTime() + CONNECTOR_TOKEN_TTL_DAYS * DAY_MS);
}

export interface ConnectorTokenExpiry {
  expired: boolean;
  /** Giorni interi rimasti (per eccesso); null senza scadenza. */
  daysLeft: number | null;
  /** Vero da 14 giorni prima della scadenza: la dashboard avvisa Lateral Space. */
  expiringSoon: boolean;
}

export function connectorTokenExpiry(expiresAt: Date | null, now: Date = new Date()): ConnectorTokenExpiry {
  if (!expiresAt) return { expired: false, daysLeft: null, expiringSoon: false };
  const ms = expiresAt.getTime() - now.getTime();
  if (ms <= 0) return { expired: true, daysLeft: 0, expiringSoon: true };
  const daysLeft = Math.ceil(ms / DAY_MS);
  return { expired: false, daysLeft, expiringSoon: daysLeft <= CONNECTOR_TOKEN_WARNING_DAYS };
}
