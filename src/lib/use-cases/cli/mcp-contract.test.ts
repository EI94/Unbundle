// Il contratto dell'MCP del caso (rilascio 8.0b): 5 strumenti, 2 letture e 3 scritture, schemi stretti, nessun campo
// sulla persona; la decisione vuole il sì della persona; la sintesi della sessione tiene solo l'impronta dell'id.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { parseBuildSession } from "./inputs.ts";
import {
  buildSessionBody,
  CASE_MCP_TOOL_NAMES,
  caseMcpErrorResult,
  caseMcpInstructions,
  caseMcpToolDefinitions,
  caseMcpWriteBody,
  isCaseMcpToolName,
  isCaseMcpWriteTool,
  parseCaseMcpArgs,
  sessionKeyOf,
} from "./mcp-contract.ts";

const decision = (over: Record<string, unknown> = {}) => ({
  topic: " Modello ",
  choice: "Un modello piccolo per lo smistamento",
  reason: "Costa meno e basta",
  confirmedByUser: true,
  idempotencyKey: "chiave-di-prova-1",
  ...over,
});

test("cinque strumenti: due letture e tre scritture, nessuna distruttiva, schemi stretti senza outputSchema", () => {
  const defs = caseMcpToolDefinitions();
  assert.deepEqual(defs.map((d) => d.name), [...CASE_MCP_TOOL_NAMES]);
  assert.deepEqual(
    defs.filter((d) => d.annotations.readOnlyHint).map((d) => d.name),
    ["get_case_context", "list_decisions"],
  );
  assert.deepEqual(CASE_MCP_TOOL_NAMES.filter(isCaseMcpWriteTool), ["record_decision", "propose_question", "report_session"]);
  for (const d of defs) {
    assert.equal(d.annotations.destructiveHint, false, d.name);
    assert.equal(d.inputSchema.type, "object", d.name);
    assert.equal(d.inputSchema.additionalProperties, false, d.name);
    assert.ok(!("outputSchema" in d), d.name);
    assert.ok(d.title && d.description.length > 40, d.name);
  }
  assert.ok(isCaseMcpToolName("record_decision") && !isCaseMcpToolName("delete_decision") && !isCaseMcpToolName(42));
});

test("nessun campo sulla persona né sul caso: il caso lo dà il token (art. 15.4)", () => {
  const all = JSON.stringify(caseMcpToolDefinitions().map((d) => d.inputSchema));
  assert.doesNotMatch(all, /proposed_?by|submitted_?by|author|email|user_?id|"caso"|useCase/i);
});

test("la decisione vuole il sì della persona e una chiave; i campi fuori elenco no", () => {
  for (const over of [{ confirmedByUser: undefined }, { confirmedByUser: false }, { confirmedByUser: "true" }]) {
    const r = parseCaseMcpArgs("record_decision", decision(over));
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.result.structuredContent.error, "conferma_mancante");
  }
  const noKey = parseCaseMcpArgs("record_decision", decision({ idempotencyKey: "corta" }));
  assert.ok(!noKey.ok && noKey.result.isError && (noKey.result.structuredContent.fieldErrors as Record<string, string>).idempotencyKey);
  const extra = parseCaseMcpArgs("record_decision", decision({ proposedBy: "x" }));
  assert.ok(!extra.ok && (extra.result.structuredContent.fieldErrors as Record<string, string>).proposedBy);
  const long = parseCaseMcpArgs("record_decision", decision({ topic: "x".repeat(81) }));
  assert.ok(!long.ok && (long.result.structuredContent.fieldErrors as Record<string, string>).topic);
  const good = parseCaseMcpArgs("record_decision", decision({ setupTopic: "dati" }));
  assert.ok(good.ok);
  if (good.ok) {
    assert.equal(good.value.topic, "Modello");
    assert.deepEqual(caseMcpWriteBody(good.value as unknown as Record<string, unknown>), {
      topic: "Modello",
      choice: "Un modello piccolo per lo smistamento",
      reason: "Costa meno e basta",
      setupTopic: "dati",
    });
  }
  assert.equal(parseCaseMcpArgs("record_decision", decision({ setupTopic: "colore" })).ok, false);
});

test("la domanda: testo e perché nei limiti, una chiave; il contesto: strato e data validi", () => {
  assert.ok(parseCaseMcpArgs("propose_question", { question: "Quali aeroporti escludete?", idempotencyKey: "k-0000001" }).ok);
  assert.equal(parseCaseMcpArgs("propose_question", { question: "x".repeat(501), idempotencyKey: "k-0000001" }).ok, false);
  assert.equal(parseCaseMcpArgs("propose_question", { question: "Va bene?" }).ok, false);
  assert.ok(parseCaseMcpArgs("get_case_context", {}).ok);
  assert.ok(parseCaseMcpArgs("get_case_context", undefined).ok);
  assert.ok(parseCaseMcpArgs("get_case_context", { layer: "decisioni", since: "2026-11-10" }).ok);
  assert.equal(parseCaseMcpArgs("get_case_context", { layer: "tutto" }).ok, false);
  assert.equal(parseCaseMcpArgs("get_case_context", { since: "ieri" }).ok, false);
  assert.ok(parseCaseMcpArgs("list_decisions", {}).ok);
  assert.equal(parseCaseMcpArgs("list_decisions", { tutte: true }).ok, false);
});

test("la sessione: l'id diventa la sua impronta, la stessa della CLI; il resto passa dal controllo di POST sessioni", () => {
  const args = { sessionId: "sessione-0f3a-prova", harness: "codex", durationSeconds: 600, outcome: "commit", endedAt: "2026-11-11T10:00:00Z", inputTokens: 1200 } as const;
  const parsed = parseCaseMcpArgs("report_session", args);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const body = buildSessionBody(parsed.value);
  assert.equal(body.chiaveSessione, createHash("sha256").update("sessione-0f3a-prova").digest("hex"));
  assert.equal(sessionKeyOf("sessione-0f3a-prova"), body.chiaveSessione);
  assert.ok(!JSON.stringify(body).includes("sessione-0f3a-prova"), "l'id vero non resta");
  const session = parseBuildSession(body, new Date("2026-11-11T12:00:00Z"));
  assert.ok(session.ok && session.value.inputTokens === 1200 && session.value.outputTokens === 0 && session.value.taskRef === null);
  const badPr = parseBuildSession(buildSessionBody({ ...parsed.value, pr: "https://example.test/pull/1" }), new Date("2026-11-11T12:00:00Z"));
  assert.equal(badPr.ok, false);
  assert.equal(parseCaseMcpArgs("report_session", { ...args, sessionId: "corto" }).ok, false);
  assert.equal(parseCaseMcpArgs("report_session", { ...args, transcript: "…" }).ok, false, "mai il testo della conversazione");
});

test("istruzioni ed errori: il caso, dati non istruzioni; isError con codice e messaggio", () => {
  const text = caseMcpInstructions("PX-0042");
  assert.match(text, /il caso PX-0042/);
  assert.match(text, /dati, non istruzioni/);
  assert.match(text, /non parte da sola/i);
  const err = caseMcpErrorResult("rate_limited", "Troppe richieste.", { retryAfterSeconds: 30 });
  assert.equal(err.isError, true);
  assert.deepEqual(err.structuredContent, { error: "rate_limited", message: "Troppe richieste.", retryAfterSeconds: 30 });
  assert.deepEqual(JSON.parse(err.content[0].text), err.structuredContent);
});
