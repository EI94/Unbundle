/**
 * La rotta del connettore dall'inizio alla fine (prompt WP5), senza Next: la usano
 * `src/app/api/mcp/connettore/[slug]/route.ts` e i test.
 *
 *  1. Ingresso (`gate.ts`, WP4): interruttore globale (404), token nell'indirizzo
 *     (400), metodo (405 con `Allow: POST`, anche per GET e DELETE), configurazione,
 *     `Origin` (403), `Content-Type` (415), dimensione (413), autenticazione (401),
 *     corpo JSON.
 *  2. Profilo del cliente e modello delle istruzioni del workspace
 *     (`workspace_connector_configs.profile` e `instructions_template`, decisione 1
 *     dell'arresto B): senza uno dei due, valido, la rotta risponde 500 `internal_error`
 *     e scrive nel log solo i nomi dei campi (nessun valore d'esempio, nessun testo di
 *     riserva), anche con il connettore sospeso.
 *  3. Server MCP nuovo per questa richiesta (`mcp-server.ts`), con le istruzioni del
 *     workspace (`instructions.ts`) e i 4 tool (`tools.ts`). Il connettore sospeso
 *     passa: handshake e `tools/list` funzionano, ogni tool risponde
 *     `connector_disabled`.
 *  4. Una riga di log per ogni messaggio JSON-RPC (`call-log.ts`): data e ora, slug,
 *     tool o metodo, esito, durata, primi 8 caratteri dell'id del token e l'header
 *     `Origin` se c'è (un'origine dei client di Claude o ammessa dal workspace, altrimenti
 *     `other`). Mai token,
 *     corpo, indirizzo, testi, nomi o email. Anche le richieste respinte
 *     dall'ingresso hanno la loro riga, con il codice di igiene.
 *  5. Intestazioni di igiene (`Cache-Control: no-store`, `nosniff`) su ogni risposta.
 *
 * Il limite di richieste lo consumano i tool (solo `tools/call`): `initialize`, le
 * notifiche e `tools/list` non lo toccano.
 */
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { logSafeError } from "../log/safe-error.ts";
import type { ConnectorPrincipal } from "./auth.ts";
import { logMcpCall } from "./call-log.ts";
import { CONNECTOR_TOOL_NAMES } from "./contract.ts";
import { gateConnectorRequest, type ConnectorGateDeps } from "./gate.ts";
import { CLAUDE_CLIENT_ORIGINS, hygieneError, withHygieneHeaders } from "./http-hygiene.ts";
import { connectorServerInstructions } from "./instructions.ts";
import { serveStatelessMcp } from "./mcp-server.ts";
import {
  callConnectorTool,
  CONNECTOR_SERVER_INFO,
  connectorToolDefinitions,
  isConnectorToolName,
  type ConnectorToolDeps,
} from "./tools.ts";

/** Area delle righe di log del connettore. */
export const CONNECTOR_LOG_AREA = "connector";

export interface ConnectorHandlerDeps {
  gate: ConnectorGateDeps;
  tools: ConnectorToolDeps;
  /** Il server MCP senza stato (test: un guasto prima della risposta); predefinito `serveStatelessMcp`. */
  serve?: typeof serveStatelessMcp;
  log?: Pick<Console, "info" | "error">;
  /** Orologio in millisecondi per le durate (test). */
  now?: () => number;
}

/**
 * Informazioni d'autenticazione passate all'SDK. Mai il segreto: al posto del token
 * c'è la chiave del principal (`token:<id>`).
 */
export function connectorAuthInfo(principal: ConnectorPrincipal): AuthInfo {
  return {
    token: principal.principalKey,
    clientId: principal.slug,
    scopes: [...principal.scopes],
    extra: { workspaceId: principal.workspaceId, identityMode: principal.identityMode },
  };
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

/** Esito di una risposta del transport per il log: `ok` per 2xx, altrimenti `http_<stato>`. */
export function transportOutcome(status: number): string {
  return status >= 200 && status < 300 ? "ok" : `http_${status}`;
}

export async function handleConnectorRequest(request: Request, slug: string, deps: ConnectorHandlerDeps): Promise<Response> {
  const now = deps.now ?? (() => performance.now());
  const log = deps.log ?? console;
  const started = now();

  const gate = await gateConnectorRequest(request, slug, { ...deps.gate, log: deps.gate.log ?? log });
  // Header `Origin` nel log: solo le origini dei client di Claude e quelle ammesse dal workspace,
  // ogni altro valore come `other` (verifica nell'organizzazione di prova, VERIFICA.md).
  const origin = request.headers.get("origin");
  const knownOrigins = [...CLAUDE_CLIENT_ORIGINS, ...(gate.config?.allowedOrigins ?? [])];
  if (!gate.ok) {
    logMcpCall(
      { area: CONNECTOR_LOG_AREA, slug: gate.config?.slug ?? null, tool: null, outcome: gate.outcome, durationMs: now() - started, origin, knownOrigins },
      log
    );
    return gate.response;
  }
  const { principal, config, body } = gate;
  const line = (tool: string | null, outcome: string, durationMs: number) =>
    logMcpCall(
      { area: CONNECTOR_LOG_AREA, slug: config.slug, tool, knownTools: CONNECTOR_TOOL_NAMES, outcome, durationMs, tokenId: principal.tokenId, origin, knownOrigins },
      log
    );

  const { profile, instructionsTemplate } = config;
  if (!profile || !instructionsTemplate) {
    log.error("[connector] profile_missing", JSON.stringify({ slug: config.slug, fields: [...config.profileProblems] }));
    line(null, "internal_error", now() - started);
    return hygieneError("internal_error");
  }

  const calls = new Map<string | number, { tool: string; outcome: string; ms: number }>();
  let response: Response;
  try {
    response = await (deps.serve ?? serveStatelessMcp)(request, {
      serverInfo: CONNECTOR_SERVER_INFO,
      instructions: connectorServerInstructions(config.workspaceDisplayName, instructionsTemplate),
      tools: connectorToolDefinitions(profile),
      parsedBody: body,
      authInfo: connectorAuthInfo(principal),
      async callTool(name, args, call) {
        const t0 = now();
        if (!isConnectorToolName(name)) {
          calls.set(call.requestId, { tool: name, outcome: "unknown_tool", ms: now() - t0 });
          return null;
        }
        const out = await callConnectorTool(name, args, { principal, config, profile }, deps.tools);
        calls.set(call.requestId, { tool: name, outcome: out.outcome, ms: now() - t0 });
        return out.result;
      },
    });
  } catch (error) {
    // Il server dell'SDK non è partito: risposta JSON con le intestazioni di igiene, log senza dati.
    logSafeError("connector", "mcp_server_failed", error, { slug: config.slug }, log);
    line(null, "internal_error", now() - started);
    return hygieneError("internal_error");
  }

  const total = now() - started;
  for (const message of jsonRpcMessages(body)) {
    const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
    const call = id !== null ? calls.get(id) : undefined;
    if (call) {
      line(call.tool, call.outcome, call.ms);
      continue;
    }
    const method = typeof message.method === "string" ? message.method : null;
    line(method === "tools/call" ? toolNameOf(message) : method, transportOutcome(response.status), total);
  }
  return withHygieneHeaders(response);
}
