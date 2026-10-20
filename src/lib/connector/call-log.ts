/**
 * Una riga di log strutturata per ogni chiamata ai server MCP remoti (prompt WP4;
 * stessa forma per il MCP del team, `docs/use-case/DESIGN.md` §9.4).
 *
 * Contiene data e ora, area, slug (solo il connettore), tool o metodo, codice di
 * esito, durata, i primi 8 caratteri dell'**id** del token e, se la richiesta ha
 * l'header `Origin`, l'origine quando è una di quelle conosciute (i client di Claude e
 * le origini ammesse dal workspace), altrimenti `other`. Mai il token, il corpo,
 * l'header `Authorization`, l'indirizzo con la query, testi, nomi o email. Ogni
 * campo passa da un filtro: un valore fuori forma diventa `unknown` o sparisce,
 * così un testo scritto da qualcuno non può entrare nel log nemmeno per errore.
 * Il nome del tool arriva dal client (`params.name` o il metodo JSON-RPC): una
 * forma valida non basta, entra solo se è un metodo del protocollo
 * (`MCP_PROTOCOL_METHODS`) o uno dei tool del server (`knownTools`). Lo slug va
 * passato dalla configurazione trovata, mai dal segmento dell'indirizzo.
 * Nessuna tabella di log per persona.
 *
 * Modulo puro: gira con `node --test`.
 */

import { loggableOrigin } from "./http-hygiene.ts";

/**
 * Metodi del protocollo MCP che il log scrive per nome. `server/discover` è la richiesta con
 * cui i client più recenti (Claude Code 2.1.299, protocollo 2026-07-28) aprono la connessione:
 * il transport dell'SDK 1.29 risponde 400 per la versione e il client ripiega su `initialize`.
 */
export const MCP_PROTOCOL_METHODS: readonly string[] = Object.freeze([
  "server/discover",
  "initialize",
  "ping",
  "tools/list",
  "tools/call",
  "resources/list",
  "resources/templates/list",
  "prompts/list",
  "notifications/initialized",
  "notifications/cancelled",
]);

export interface McpCallLogEntry {
  /** `connector` o `team-mcp`. */
  area: string;
  /** Slug della configurazione trovata (solo il connettore), mai quello letto dall'indirizzo. */
  slug?: string | null;
  /** Nome del tool, oppure il metodo JSON-RPC (`initialize`, `tools/list`). */
  tool?: string | null;
  /**
   * Tool del server: il connettore passa `CONNECTOR_TOOL_NAMES`, il MCP del team i
   * suoi. Un nome fuori da questo elenco e da `MCP_PROTOCOL_METHODS` diventa `unknown`.
   */
  knownTools?: readonly string[];
  /** Codice di esito: `ok`, un codice d'errore del contratto o dell'igiene HTTP. */
  outcome: string;
  durationMs: number;
  /** Id (uuid) del token: nel log ne finiscono i primi 8 caratteri. */
  tokenId?: string | null;
  /**
   * Header `Origin` della richiesta, come arriva (null o assente se manca). Nel log entra
   * solo un'origine di `knownOrigins`, normalizzata; ogni altro valore diventa `other`
   * (`loggableOrigin`): l'header lo scrive il client, come il nome del tool.
   */
  origin?: string | null;
  /** Origini che il log scrive per nome: il connettore passa `CLAUDE_CLIENT_ORIGINS` più le origini ammesse dal workspace. */
  knownOrigins?: readonly string[];
}

const AREA = /^[a-z][a-z0-9-]{0,30}$/;
const SLUG = /^[a-z0-9-]{3,40}$/;
const TOOL = /^[a-z][a-z0-9_/]{0,63}$/;
const OUTCOME = /^[a-z][a-z0-9_]{0,63}$/;
const TOKEN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isKnownTool(tool: string, knownTools: readonly string[] = []): boolean {
  return MCP_PROTOCOL_METHODS.includes(tool) || knownTools.includes(tool);
}

/** La riga JSON, con i soli campi ammessi. */
export function formatMcpCallLog(entry: McpCallLogEntry, now: Date = new Date()): string {
  const line: Record<string, string | number> = {
    at: now.toISOString(),
    area: AREA.test(entry.area) ? entry.area : "unknown",
  };
  if (entry.slug && SLUG.test(entry.slug)) line.slug = entry.slug;
  line.tool = entry.tool && TOOL.test(entry.tool) && isKnownTool(entry.tool, entry.knownTools) ? entry.tool : "unknown";
  line.outcome = OUTCOME.test(entry.outcome) ? entry.outcome : "unknown";
  line.ms = Number.isFinite(entry.durationMs) ? Math.max(0, Math.round(entry.durationMs)) : 0;
  if (entry.tokenId && TOKEN_ID.test(entry.tokenId)) line.token = entry.tokenId.slice(0, 8).toLowerCase();
  const origin = loggableOrigin(entry.origin, entry.knownOrigins ?? []);
  if (origin) line.origin = origin;
  return JSON.stringify(line);
}

/** Scrive la riga: `[mcp] call {…}`. */
export function logMcpCall(entry: McpCallLogEntry, log: Pick<Console, "info"> = console, now: Date = new Date()) {
  log.info(`[mcp] call ${formatMcpCallLog(entry, now)}`);
}
