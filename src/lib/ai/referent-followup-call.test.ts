import test from "node:test";
import assert from "node:assert/strict";
import { installAppModules, message, recordLogs, refusal, THINKING, fakeAppClaude } from "./claude-test-kit.ts";
import { ClaudeRefusalError } from "./models.ts";

// (Migrazione a Claude Sonnet 5.5) La chiamata vera della proposta nel filo con il referente
// (providerFollowUpGenerator): la richiesta che parte, con lo sforzo esplicito della sua riga, e un rifiuto.
// Database finto; il modello è il Claude finto di claude-test-kit.ts, senza rete.

await installAppModules({
  "@/lib/db/uc-executor": `export async function getAppUcExecutor() { throw new Error("niente database in questa prova"); }`,
  "@/lib/db/queries/use-case-referent-base": `export const isUuid = (value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value);`,
  "@/lib/db/queries/uc-subprocessors": `export async function loadSubprocessorAck() { return null; }`,
});
const { providerFollowUpGenerator } = await import("../db/queries/use-case-referent-ai.ts");

const PROMPT = "Il referente ha risposto: «circa 200 al mese».";

test("la proposta del filo: sforzo «low» esplicito, 16000 token, output strutturato, un tempo massimo", async (t) => {
  recordLogs(t);
  const requests = fakeAppClaude([message([THINKING, { type: "text", text: JSON.stringify({ complete: true, question: null }) }])]);
  assert.deepEqual(await providerFollowUpGenerator({ prompt: PROMPT, model: "claude-sonnet-5-5" }), { complete: true, question: null });
  const [request] = requests;
  assert.equal(request.body.model, "claude-sonnet-5-5");
  assert.equal(request.body.max_tokens, 16000);
  const outputConfig = request.body.output_config as { effort?: string; format?: { type: string } };
  assert.equal(outputConfig.effort, "low", "mai il predefinito «high»: la chiamata ha 30 secondi");
  assert.equal(outputConfig.format?.type, "json_schema");
  assert.equal("thinking" in request.body, false);
  assert.equal(request.body.fallbacks, undefined);
  assert.ok(request.signal, "la chiamata ha un tempo massimo");
});

test("la proposta del filo: un rifiuto con il JSON completo è un errore, non una proposta", async (t) => {
  const lines = recordLogs(t);
  fakeAppClaude([refusal([{ type: "text", text: JSON.stringify({ complete: false, question: "Quante al mese?" }) }], "general_harms")]);
  await assert.rejects(providerFollowUpGenerator({ prompt: PROMPT, model: "claude-sonnet-5-5" }), (error: unknown) => error instanceof ClaudeRefusalError);
  assert.deepEqual(lines, ['[use-case-referent-ai] risposta_rifiutata {"finishReason":"content-filter","category":"general_harms"}']);
});
