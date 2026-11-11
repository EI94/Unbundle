import "server-only";
/**
 * L'MCP del caso (rilascio 8.0b, RILASCIO-8.0b-COSTRUZIONE.md §5): `POST /api/cli/mcp`, Streamable HTTP senza
 * stato, risposte JSON, con `serveStatelessMcp` come il MCP del team.
 *
 * 1. Ingresso come la CLI (`openCli`): nessun token nell'indirizzo, solo POST, niente `Origin`, JSON, corpo piccolo,
 *    token valido e accesso al workspace riletto adesso.
 * 2. Solo il token di un caso solo (`unbundle mcp <ID>`): un token di tutti i casi riceve 403. Il caso lo dà il
 *    token, con i ruoli nel caso riletti a ogni richiesta (`resolveCliCase`): chi esce dal team non entra più.
 * 3. I 5 strumenti (`mcp-contract.ts`). Il limite orario del token lo consumano solo le chiamate agli strumenti
 *    (600 letture, 120 scritture), come il MCP del team. Le scritture passano dal registro con l'idempotenza.
 * 4. Una riga di log per ogni messaggio JSON-RPC (area `case-mcp`): strumento o metodo, esito, durata, i primi 8
 *    caratteri dell'id del token. Mai token, argomenti, testi, nomi o e-mail.
 */
import { logMcpCall } from "@/lib/connector/call-log";
import { readJsonBodyLimited, withHygieneHeaders } from "@/lib/connector/http-hygiene";
import { serveStatelessMcp } from "@/lib/connector/mcp-server";
import { addTeamDecision, proposeAgentQuestion, recordBuildSession } from "@/lib/db/queries/use-case-factory";
import { logSafeError } from "@/lib/log/safe-error";
import { cliWriteDenial, executeCliWrite, resolveCliCase, type CliCase, type CliWriteOutcome } from "./case";
import { loadCliContext } from "./context";
import { parseBuildSession } from "./inputs";
import {
  buildSessionBody,
  CASE_MCP_SERVER_INFO,
  CASE_MCP_TOOL_NAMES,
  caseMcpErrorResult,
  caseMcpInstructions,
  caseMcpResult,
  caseMcpToolDefinitions,
  caseMcpWriteBody,
  INVALID_PAYLOAD_MESSAGE,
  isCaseMcpToolName,
  isCaseMcpWriteTool,
  parseCaseMcpArgs,
  type CaseMcpToolName,
  type CaseMcpToolResult,
} from "./mcp-contract";
import { CLI_ROUTE_LIMITS, cliError, consumeCliTokenLimit, openCli, type OpenedCli } from "./route-kit";

export const CASE_MCP_LOG_AREA = "case-mcp";

const NOT_FOUND = "Caso non trovato, o non sei più nel suo team.";

type JsonRpcMessage = { id?: unknown; method?: unknown; params?: unknown };

function jsonRpcMessages(body: unknown): JsonRpcMessage[] {
  const list = Array.isArray(body) ? body : [body];
  return list.filter((m): m is JsonRpcMessage => !!m && typeof m === "object" && !Array.isArray(m));
}

function writeResult<T extends Record<string, unknown>>(outcome: CliWriteOutcome<T>, extra: Record<string, unknown> = {}): CaseMcpToolResult {
  if (!outcome.ok) return caseMcpErrorResult(outcome.code, outcome.message, outcome.retryAfterSeconds === undefined ? {} : { retryAfterSeconds: outcome.retryAfterSeconds });
  return caseMcpResult({ ...outcome.value, ...extra, ripetuta: outcome.repeated });
}

/** Esegue uno strumento: restituisce sempre un risultato (anche gli errori, con `isError`). */
async function callTool(name: CaseMcpToolName, args: unknown, opened: OpenedCli, c: CliCase): Promise<{ outcome: string; result: CaseMcpToolResult }> {
  const done = (result: CaseMcpToolResult) => ({ outcome: result.isError ? String(result.structuredContent.error) : "ok", result });
  const { executor } = opened;

  if (name === "get_case_context" || name === "list_decisions") {
    const parsed = name === "get_case_context" ? parseCaseMcpArgs("get_case_context", args) : parseCaseMcpArgs("list_decisions", args);
    if (!parsed.ok) return done(parsed.result);
    const value = parsed.value as { layer?: string; since?: string };
    const layer = name === "list_decisions" ? "decisioni" : value.layer && value.layer !== "brief" ? value.layer : null;
    const context = await loadCliContext(executor, c, { layer: layer as Parameters<typeof loadCliContext>[2]["layer"], since: value.since ? new Date(value.since) : null });
    if (!context) return done(caseMcpErrorResult("non_trovato", NOT_FOUND));
    return done(caseMcpResult({ caso: c.useCase.code, testo: context.testo, dati: context.dati }, context.testo));
  }

  const denial = cliWriteDenial(c);
  if (denial) return done(caseMcpErrorResult(denial.code, denial.message));

  if (name === "record_decision") {
    const parsed = parseCaseMcpArgs("record_decision", args);
    if (!parsed.ok) return done(parsed.result);
    const a = parsed.value;
    const outcome = await executeCliWrite(opened, a.idempotencyKey, "record_decision", caseMcpWriteBody(a), async () => {
      const r = await addTeamDecision(executor, c.actor, c.target, { topic: a.topic, choice: a.choice, reason: a.reason, rejected: a.rejected, topicKey: a.setupTopic ?? null });
      return r.ok ? { ok: true as const, value: { id: r.value.id } } : r;
    });
    return done(writeResult(outcome, { registrata: true }));
  }

  if (name === "propose_question") {
    const parsed = parseCaseMcpArgs("propose_question", args);
    if (!parsed.ok) return done(parsed.result);
    const a = parsed.value;
    const outcome = await executeCliWrite(opened, a.idempotencyKey, "propose_question", caseMcpWriteBody(a), async () => {
      const r = await proposeAgentQuestion(executor, c.actor, c.target, { question: a.question, reason: a.reason, channel: "mcp" });
      return r.ok ? { ok: true as const, value: { id: r.value.id } } : r;
    });
    return done(writeResult(outcome, { proposta: true, nota: "Non parte da sola: la decide il team in Unbundle." }));
  }

  const parsed = parseCaseMcpArgs("report_session", args);
  if (!parsed.ok) return done(parsed.result);
  const session = parseBuildSession(buildSessionBody(parsed.value));
  if (!session.ok) return done(caseMcpErrorResult("invalid_payload", `${INVALID_PAYLOAD_MESSAGE} ${session.message}`));
  const recorded = await recordBuildSession(executor, c.target, session.value);
  if (!recorded.ok) return done(caseMcpErrorResult(recorded.code, recorded.message));
  return done(caseMcpResult({ registrata: recorded.value.created, ripetuta: !recorded.value.created }));
}

export async function handleCaseMcpRequest(request: Request): Promise<Response> {
  const started = performance.now();
  const line = (tool: string | null, outcome: string, durationMs: number, tokenId: string | null = null) =>
    logMcpCall({ area: CASE_MCP_LOG_AREA, tool, knownTools: CASE_MCP_TOOL_NAMES, outcome, durationMs, tokenId });
  const reject = (response: Response, tokenId: string | null = null) => {
    line(null, `http_${response.status}`, performance.now() - started, tokenId);
    return response;
  };

  let opened: OpenedCli;
  let c: CliCase;
  let parsedBody: unknown;
  try {
    const open = await openCli(request, { method: "POST", write: false, limit: false });
    if (!open.ok) return reject(open.response);
    opened = open.value;
    const { principal } = opened;
    if (principal.caseUseCaseId === null) {
      return reject(cliError(403, "token_caso", "L'MCP del caso vuole il token di un caso solo: crealo con «unbundle mcp <ID>»."), principal.tokenId);
    }
    const resolved = await resolveCliCase(opened, principal.caseUseCaseId);
    if (!resolved.ok) return reject(resolved.response, principal.tokenId);
    c = resolved.value;
    const body = await readJsonBodyLimited(request, CLI_ROUTE_LIMITS.bodyBytes);
    if (!body.ok) return reject(cliError(400, "json", "Il corpo non è un JSON valido o è troppo grande."), principal.tokenId);
    parsedBody = body.value;
  } catch (error) {
    logSafeError(CASE_MCP_LOG_AREA, "ingresso", error);
    return reject(cliError(500, "errore", "Qualcosa non ha funzionato: riprova."));
  }

  const tokenId = opened.principal.tokenId;
  const calls = new Map<string | number, { tool: string; outcome: string; ms: number }>();
  let response: Response;
  try {
    response = await serveStatelessMcp(request, {
      serverInfo: CASE_MCP_SERVER_INFO,
      instructions: caseMcpInstructions(c.useCase.code),
      tools: caseMcpToolDefinitions(),
      parsedBody,
      async callTool(name, args, call) {
        const t0 = performance.now();
        if (!isCaseMcpToolName(name)) {
          calls.set(call.requestId, { tool: name, outcome: "unknown_tool", ms: performance.now() - t0 });
          return null;
        }
        let out: { outcome: string; result: CaseMcpToolResult };
        try {
          const limit = await consumeCliTokenLimit(tokenId, isCaseMcpWriteTool(name));
          out = limit.ok
            ? await callTool(name, args, opened, c)
            : { outcome: "rate_limited", result: caseMcpErrorResult("rate_limited", "Troppe richieste con questo token: riprova tra poco.", { retryAfterSeconds: limit.retryAfterSeconds }) };
        } catch (error) {
          logSafeError(CASE_MCP_LOG_AREA, "strumento", error, { tool: name });
          out = { outcome: "errore", result: caseMcpErrorResult("errore", "Qualcosa non ha funzionato: riprova (con lo stesso idempotencyKey, se scrivevi).") };
        }
        calls.set(call.requestId, { tool: name, outcome: out.outcome, ms: performance.now() - t0 });
        return out.result;
      },
    });
  } catch (error) {
    logSafeError(CASE_MCP_LOG_AREA, "server", error);
    return reject(cliError(500, "errore", "Qualcosa non ha funzionato: riprova."), tokenId);
  }

  const total = performance.now() - started;
  for (const message of jsonRpcMessages(parsedBody)) {
    const id = typeof message.id === "string" || typeof message.id === "number" ? message.id : null;
    const call = id !== null ? calls.get(id) : undefined;
    if (call) {
      line(call.tool, call.outcome, call.ms, tokenId);
      continue;
    }
    line(typeof message.method === "string" ? message.method : null, response.status >= 200 && response.status < 300 ? "ok" : `http_${response.status}`, total, tokenId);
  }
  return withHygieneHeaders(response);
}
