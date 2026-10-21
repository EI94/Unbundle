/**
 * La rotta del MCP del team «Unbundle Use case» dall'inizio alla fine (docs/use-case/DESIGN.md
 * §9.4), senza Next: la usano `src/app/api/mcp/use-case/route.ts` e i test.
 *
 * Stessa architettura del connettore (prompt WP4 e WP5), con i suoi moduli usati senza
 * modifiche: igiene HTTP e limite di richieste con parametri, server MCP senza stato, riga di log.
 *  1. Ingresso, nell'ordine: `MCP_TEAM_ENABLED` diverso da `true` → 404 per ogni metodo; token
 *     nell'indirizzo → 400 `{"error":"token_in_url"}` senza ripetere l'indirizzo (un token valido
 *     si segna «esposto, da revocare» e da allora riceve 401, anche nell'header); metodo diverso
 *     da POST → 405 con `Allow: POST`; `Origin`
 *     presente → 403 (nessuna origine ammessa: i client MCP non sono pagine web); `Content-Type`
 *     non JSON → 415; corpo oltre 256 KB → 413; autenticazione (`auth.ts`: token personale,
 *     ruolo riletto adesso) → altrimenti 401; corpo JSON letto a blocchi.
 *  2. Server MCP nuovo per questa richiesta (`serveStatelessMcp`), con le istruzioni del workspace
 *     (`instructions.ts`) e i 6 tool (`contract.ts`, `tools.ts`). Il workspace lo dà il token.
 *     Con l'area spenta handshake e `tools/list` funzionano e ogni tool risponde `area_spenta`.
 *  3. Una riga di log per ogni messaggio JSON-RPC (`logMcpCall`, area `team-mcp`): data e ora,
 *     tool o metodo, esito, durata, i primi 8 caratteri dell'id del token. Mai token, corpo,
 *     indirizzo, header `Authorization`, testi, nomi o email; anche le richieste respinte
 *     all'ingresso hanno la loro riga, con il codice di igiene.
 *  4. `Cache-Control: no-store` e `X-Content-Type-Options: nosniff` su ogni risposta.
 *
 * Il limite di richieste lo consumano solo i `tools/call` (`tools.ts`).
 */
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { hashIntegrationToken } from "../../connector/auth.ts";
import { logMcpCall } from "../../connector/call-log.ts";
import {
  findTokenInUrl,
  hygieneError,
  methodNotAllowed,
  readMcpJsonBody,
  screenMcpRequest,
  withHygieneHeaders,
  type HygieneErrorCode,
} from "../../connector/http-hygiene.ts";
import { serveStatelessMcp } from "../../connector/mcp-server.ts";
import { logSafeError } from "../../log/safe-error.ts";
import { authenticateTeamRequest, isTeamMcpEnabled, type TeamAuthDeps, type TeamPrincipal } from "./auth.ts";
import { isTeamToolName, TEAM_MCP_SERVER_INFO, TEAM_MCP_TOOL_NAMES, teamToolDefinitions } from "./contract.ts";
import { teamMcpInstructions } from "./instructions.ts";
import { callTeamTool, TEAM_MCP_LOG_AREA, type TeamToolDeps } from "./tools.ts";

/** Nessuna origine ammessa: claude.ai e Claude Code non mandano `Origin`; una pagina web sì, e riceve 403. */
export const TEAM_MCP_ALLOWED_ORIGINS: readonly string[] = Object.freeze([]);

type Env = Readonly<Record<string, string | undefined>>;

export interface TeamHandlerDeps {
  env: Env;
  auth: TeamAuthDeps;
  /**
   * Segna «esposto, da revocare» il token con questo hash, se è valido, e la prima volta avvisa
   * Lateral Space (nell'app: `exposed_at` e canale admin di Slack, come il connettore).
   */
  markTokenExposed(tokenHash: string): Promise<unknown>;
  tools: TeamToolDeps;
  log?: Pick<Console, "info" | "error">;
  /** Orologio in millisecondi per le durate (test). */
  now?: () => number;
}

/** Informazioni d'autenticazione per l'SDK: mai il segreto, al suo posto la chiave del principal. */
export function teamAuthInfo(principal: TeamPrincipal): AuthInfo {
  return { token: principal.principalKey, clientId: TEAM_MCP_SERVER_INFO.name, scopes: [...principal.scopes], extra: { workspaceId: principal.workspaceId } };
}

type JsonRpcMessage = { id?: unknown; method?: unknown; params?: unknown };

function jsonRpcMessages(body: unknown): JsonRpcMessage[] {
  const list = Array.isArray(body) ? body : [body];
  return list.filter((m): m is JsonRpcMessage => !!m && typeof m === "object" && !Array.isArray(m));
}

function toolNameOf(message: JsonRpcMessage): string | null {
  const name = message.params && typeof message.params === "object" ? (message.params as { name?: unknown }).name : undefined;
  return typeof name === "string" ? name : null;
}

function transportOutcome(status: number): string {
  return status >= 200 && status < 300 ? "ok" : `http_${status}`;
}

export async function handleTeamMcpRequest(request: Request, deps: TeamHandlerDeps): Promise<Response> {
  const now = deps.now ?? (() => performance.now());
  const log = deps.log ?? console;
  const started = now();
  const line = (tool: string | null, outcome: string, durationMs: number, tokenId: string | null = null) =>
    logMcpCall({ area: TEAM_MCP_LOG_AREA, tool, knownTools: TEAM_MCP_TOOL_NAMES, outcome, durationMs, tokenId }, log);
  const reject = (code: HygieneErrorCode, response: Response, tokenId: string | null = null) => {
    line(null, code, now() - started, tokenId);
    return response;
  };

  if (!isTeamMcpEnabled(deps.env)) return reject("not_found", hygieneError("not_found"));

  const inUrl = findTokenInUrl(request.url);
  if (inUrl.found) {
    for (const candidate of inUrl.candidates) {
      try {
        await deps.markTokenExposed(hashIntegrationToken(candidate));
      } catch (error) {
        logSafeError(TEAM_MCP_LOG_AREA, "exposed_token_flag_failed", error, {}, log);
      }
    }
    return reject("token_in_url", hygieneError("token_in_url"));
  }
  if (request.method.toUpperCase() !== "POST") return reject("method_not_allowed", methodNotAllowed(["POST"]));

  const screen = screenMcpRequest(request, { allowedOrigins: TEAM_MCP_ALLOWED_ORIGINS });
  if (!screen.ok) return reject(screen.code, screen.response);

  let principal: TeamPrincipal;
  try {
    const auth = await authenticateTeamRequest(request.headers.get("authorization"), deps.auth);
    if (!auth.ok) return reject("unauthorized", hygieneError("unauthorized"));
    principal = auth.principal;
  } catch (error) {
    logSafeError(TEAM_MCP_LOG_AREA, "auth_failed", error, {}, log);
    return reject("internal_error", hygieneError("internal_error"));
  }

  const body = await readMcpJsonBody(request);
  if (!body.ok) return reject(body.code, body.response, principal.tokenId);

  const calls = new Map<string | number, { tool: string; outcome: string; ms: number }>();
  let response: Response;
  try {
    response = await serveStatelessMcp(request, {
      serverInfo: TEAM_MCP_SERVER_INFO,
      instructions: teamMcpInstructions(principal.workspaceName),
      tools: teamToolDefinitions(),
      parsedBody: body.body,
      authInfo: teamAuthInfo(principal),
      async callTool(name, args, call) {
        const t0 = now();
        if (!isTeamToolName(name)) {
          calls.set(call.requestId, { tool: name, outcome: "unknown_tool", ms: now() - t0 });
          return null;
        }
        const out = await callTeamTool(name, args, principal, deps.tools);
        calls.set(call.requestId, { tool: name, outcome: out.outcome, ms: now() - t0 });
        return out.result;
      },
    });
  } catch (error) {
    logSafeError(TEAM_MCP_LOG_AREA, "mcp_server_failed", error, {}, log);
    return reject("internal_error", hygieneError("internal_error"), principal.tokenId);
  }

  const total = now() - started;
  for (const message of jsonRpcMessages(body.body)) {
    const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
    const call = id !== null ? calls.get(id) : undefined;
    if (call) {
      line(call.tool, call.outcome, call.ms, principal.tokenId);
      continue;
    }
    const method = typeof message.method === "string" ? message.method : null;
    line(method === "tools/call" ? toolNameOf(message) : method, transportOutcome(response.status), total, principal.tokenId);
  }
  return withHygieneHeaders(response);
}
