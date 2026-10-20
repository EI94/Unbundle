/**
 * Un server MCP senza stato per una sola richiesta HTTP (prompt WP5, §3): `Server` a
 * basso livello dell'SDK 1.29, nuovo a ogni POST, con
 * `WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined,
 * enableJsonResponse: true })`; `connect`, `handleRequest`, poi `close`. Nessuno stato
 * in memoria tra le richieste.
 *
 * Generico: il connettore lo usa con i suoi 4 tool, il MCP del team
 * (`docs/use-case/DESIGN.md` §9.4) con i suoi, senza modifiche. Chi chiama ha già
 * fatto l'igiene HTTP e l'autenticazione e passa il corpo già letto (`parsedBody`).
 *
 * - `tools/list` restituisce le definizioni così come sono (nessun `outputSchema`).
 * - `tools/call` chiama `callTool`, che valida da sé gli argomenti e restituisce
 *   sempre un risultato (anche gli errori del contratto, con `isError: true`): così
 *   l'SDK non risponde mai con il suo «Input validation error». Un tool sconosciuto
 *   (`callTool` restituisce null) è un errore JSON-RPC `InvalidParams`.
 * - Negoziazione del protocollo dell'SDK: un client che chiede una versione
 *   supportata (fino a 2025-11-25, compresa 2025-06-18) la riceve; un'altra versione
 *   riceve l'ultima.
 * - HTTP: 200 per le richieste JSON-RPC (anche quando un tool risponde con un
 *   errore del contratto), 202 per le sole notifiche; i 4xx sono quelli del
 *   transport (`Accept` senza `text/event-stream` → 406, versione del protocollo non
 *   supportata → 400).
 * - Un handler che lancia un'eccezione non porta il messaggio al client: si risponde
 *   con un errore JSON-RPC generico.
 */
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

export interface StatelessMcpToolDefinition {
  name: string;
  title?: string;
  description?: string;
  inputSchema: { [key: string]: unknown };
  annotations?: object;
}

export interface StatelessMcpCall {
  /** Id della richiesta JSON-RPC (per collegare il log alla chiamata). */
  requestId: string | number;
}

export interface StatelessMcpOptions {
  serverInfo: { name: string; version: string };
  instructions: string;
  tools: readonly StatelessMcpToolDefinition[];
  /** Esegue un tool. null = tool sconosciuto (errore JSON-RPC). Non deve lanciare. */
  callTool(name: string, args: unknown, call: StatelessMcpCall): Promise<{ [key: string]: unknown } | null>;
  /** Il corpo JSON-RPC già letto dall'igiene HTTP. */
  parsedBody: unknown;
  authInfo?: AuthInfo;
}

/** Messaggio dell'errore JSON-RPC per un tool sconosciuto. */
export const UNKNOWN_TOOL_MESSAGE = "Strumento sconosciuto.";

/** Serve una richiesta POST con un server nuovo e lo chiude subito dopo. */
export async function serveStatelessMcp(request: Request, opts: StatelessMcpOptions): Promise<Response> {
  const server = new Server(opts.serverInfo, { instructions: opts.instructions, capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: opts.tools.map((tool) => ({ ...tool })) as Tool[] }));
  server.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    let result: { [key: string]: unknown } | null;
    try {
      result = await opts.callTool(req.params.name, req.params.arguments ?? {}, { requestId: extra.requestId });
    } catch {
      throw new McpError(ErrorCode.InternalError, "Errore del server.");
    }
    if (!result) throw new McpError(ErrorCode.InvalidParams, UNKNOWN_TOOL_MESSAGE);
    return result as CallToolResult;
  });

  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  try {
    await server.connect(transport);
    return await transport.handleRequest(request, { parsedBody: opts.parsedBody, authInfo: opts.authInfo });
  } finally {
    await server.close().catch(() => undefined);
  }
}
