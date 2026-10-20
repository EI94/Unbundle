/**
 * Ingresso della rotta del connettore, prima del server MCP (prompt WP4).
 *
 * Ordine dei controlli, ognuno con la sua risposta JSON `{ error }` e le
 * intestazioni di igiene:
 *  1. `MCP_CONNECTOR_ENABLED` diverso da `true` → 404, per ogni metodo;
 *  2. token nell'indirizzo → 400 `token_in_url`, senza ripetere l'indirizzo; i token
 *     trovati, se validi, si segnalano come esposti (si cercano solo per hash);
 *  3. metodo diverso da POST → 405 con `Allow: POST`;
 *  4. configurazione per slug (uno slug che non esiste vale come credenziale non
 *     valida: 401 più avanti);
 *  5. `Origin` fuori da `allowed_origins` → 403; `Content-Type` non JSON → 415;
 *     `content-length` oltre 256 KB → 413;
 *  6. autenticazione: solo `Authorization: Bearer ub_mcp_…`, token attivo del
 *     workspace dello slug con entrambi gli scope del connettore → altrimenti 401;
 *     in modalità `oauth` (fase 2, spenta) 401 con `WWW-Authenticate`;
 *  7. corpo letto a blocchi: oltre 256 KB → 413, JSON non valido → 400.
 * Il corpo si legge solo dopo l'autenticazione.
 *
 * Il connettore sospeso (`enabled = false`) passa da qui: è ogni tool a rispondere
 * `connector_disabled` (`connectorSuspendedError`), così Claude lo dice alla persona.
 * Un errore del database diventa 500 `internal_error`, con un log senza dati della
 * richiesta (mai token, corpo o indirizzo).
 *
 * Modulo puro: le dipendenze arrivano da fuori (nell'app `appConnectorGateDeps`,
 * `src/lib/connector/app-deps.ts`); gira con `node --test`.
 */
import { logSafeError } from "../log/safe-error.ts";
import {
  bearerTokenFromHeader,
  CONNECTOR_SCOPES,
  connectorUnauthorized,
  hasAllScopes,
  hashIntegrationToken,
  principalFromToken,
  type ConnectorPrincipal,
} from "./auth.ts";
import {
  isConnectorRouteEnabled,
  isValidConnectorSlug,
  toConnectorRuntimeConfig,
  type ConnectorConfigRow,
  type ConnectorRuntimeConfig,
} from "./config.ts";
import {
  findTokenInUrl,
  hygieneError,
  methodNotAllowed,
  readMcpJsonBody,
  screenMcpRequest,
  type HygieneErrorCode,
} from "./http-hygiene.ts";

export interface ConnectorGateDeps {
  env: Readonly<Record<string, string | undefined>>;
  /** La riga della configurazione dello slug, oppure null. */
  loadConfig(slug: string): Promise<ConnectorConfigRow | null>;
  /**
   * Il token con questo hash, se è attivo (non revocato né scaduto), del workspace
   * indicato e con tutti gli scope richiesti; aggiorna `last_used_at` solo in quel
   * caso. Altrimenti null.
   */
  authenticateToken(input: {
    tokenHash: string;
    workspaceId: string;
    requiredScopes: readonly string[];
  }): Promise<{ id: string; scopes: string[] } | null>;
  /**
   * Segna come «esposto, da revocare» il token con questo hash, se è valido, e la
   * prima volta avvisa Lateral Space (nell'app: `exposed_at` e canale admin di Slack).
   */
  markTokenExposed(tokenHash: string): Promise<unknown>;
  log?: Pick<Console, "error">;
}

export type ConnectorGateResult =
  | { ok: true; principal: ConnectorPrincipal; config: ConnectorRuntimeConfig; body: unknown }
  | { ok: false; outcome: HygieneErrorCode; response: Response; config: ConnectorRuntimeConfig | null };

function fail(outcome: HygieneErrorCode, response: Response, config: ConnectorRuntimeConfig | null = null): ConnectorGateResult {
  return { ok: false, outcome, response, config };
}

export async function gateConnectorRequest(request: Request, slug: string, deps: ConnectorGateDeps): Promise<ConnectorGateResult> {
  if (!isConnectorRouteEnabled(deps.env)) return fail("not_found", hygieneError("not_found"));

  const inUrl = findTokenInUrl(request.url);
  if (inUrl.found) {
    for (const candidate of inUrl.candidates) {
      try {
        await deps.markTokenExposed(hashIntegrationToken(candidate));
      } catch (error) {
        logSafeError("connector", "exposed_token_flag_failed", error, {}, deps.log);
      }
    }
    return fail("token_in_url", hygieneError("token_in_url"));
  }

  if (request.method.toUpperCase() !== "POST") return fail("method_not_allowed", methodNotAllowed(["POST"]));

  let config: ConnectorRuntimeConfig | null = null;
  if (isValidConnectorSlug(slug)) {
    try {
      const row = await deps.loadConfig(slug);
      config = row ? toConnectorRuntimeConfig(row) : null;
    } catch (error) {
      logSafeError("connector", "config_load_failed", error, {}, deps.log);
      return fail("internal_error", hygieneError("internal_error"));
    }
  }

  const screen = screenMcpRequest(request, { allowedOrigins: config?.allowedOrigins ?? [] });
  if (!screen.ok) return fail(screen.code, screen.response, config);

  if (!config || config.authMode !== "header") return fail("unauthorized", connectorUnauthorized(config), config);
  const raw = bearerTokenFromHeader(request.headers.get("authorization"));
  if (!raw) return fail("unauthorized", connectorUnauthorized(config), config);

  let token: { id: string; scopes: string[] } | null;
  try {
    token = await deps.authenticateToken({
      tokenHash: hashIntegrationToken(raw),
      workspaceId: config.workspaceId,
      requiredScopes: CONNECTOR_SCOPES,
    });
  } catch (error) {
    logSafeError("connector", "auth_failed", error, { slug: config.slug }, deps.log);
    return fail("internal_error", hygieneError("internal_error"), config);
  }
  if (!token || !hasAllScopes(token.scopes, CONNECTOR_SCOPES)) {
    return fail("unauthorized", connectorUnauthorized(config), config);
  }

  const body = await readMcpJsonBody(request);
  if (!body.ok) return fail(body.code, body.response, config);

  return { ok: true, principal: principalFromToken(token, config), config, body: body.body };
}
