import test from "node:test";
import assert from "node:assert/strict";
import { fakeAppClaude, hang, installAppModules, message, recordLogs, refusal, THINKING, type Captured } from "../ai/claude-test-kit.ts";
import { CLAUDE_TASKS, ClaudeRefusalError, stoppedByDeadline, type ClaudeTask } from "../ai/models.ts";
import { buildReadPrompt } from "./read/prompt.ts";

// Le tre chiamate al modello di «Contesto» (RILASCIO-9a-COSTRUZIONE.md §4.1), con le funzioni vere e il Claude finto di
// claude-test-kit.ts: nessuna rete, nessuna chiave.

await installAppModules({});
const { generateContextRead } = await import("./read/generate.ts");
const { generateContextBrief } = await import("./brief/generate.ts");
const { generateContextAsk } = await import("./ask/generate.ts");

const WS = "00000000-0000-4000-8000-00000000aa01";
const signal = () => AbortSignal.timeout(5_000);
const json = (value: unknown) => message([THINKING, { type: "text", text: JSON.stringify(value) }]);

/** Che cosa ogni richiesta di «Contesto» deve avere: il modello, lo sforzo e il limite del compito, il ripiego, nessun tool. */
function assertContextRequest(request: Captured, task: ClaudeTask, system: string, prompt: string) {
  const settings = CLAUDE_TASKS[task];
  const { body } = request;
  assert.equal(request.url.pathname, "/v1/messages");
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.equal(body.max_tokens, 16_000);
  assert.equal(body.max_tokens, settings.maxOutputTokens);
  assert.equal((body.output_config as { effort?: string }).effort, "low");
  assert.equal((body.output_config as { format?: { type?: string } }).format?.type, "json_schema", "l'oggetto passa da output_config.format");
  assert.equal(body.tools, undefined, "nessun tool: il modello può solo proporre");
  assert.equal(body.tool_choice, undefined);
  assert.equal("thinking" in body, false);
  for (const key of ["temperature", "top_p", "top_k"]) assert.equal(key in body, false, key);
  assert.equal(body.fallbacks, "default");
  assert.ok(request.betas.includes("server-side-fallback-2026-07-01"));
  assert.equal(/"reasoning"/i.test(JSON.stringify((body.output_config as { format?: unknown }).format)), false);
  assert.equal(JSON.stringify(body.system).includes(system.slice(0, 80)), true, "le regole stanno in system");
  const messages = body.messages as Array<{ role: string; content: unknown }>;
  assert.equal(messages.length, 1);
  assert.equal(messages[0].role, "user");
  assert.equal(JSON.stringify(messages[0].content).includes(JSON.stringify(prompt).slice(1, 60)), true, "gli appunti stanno nel messaggio dell'utente");
  assert.ok(request.signal, "la chiamata porta il suo tempo massimo");
}

const READ = { proposte: [], nonRiportati: { persone: 0, sanitari: 0, altriClienti: 0, clientiDelCliente: 0 } };

test("contextRead: la richiesta vera, con il prompt della lettura, e l'oggetto di ritorno", async () => {
  const { system, prompt } = buildReadPrompt({
    clientName: "Alfa Arredamenti",
    today: "2026-11-16",
    occurredOn: "2026-11-14",
    title: "Call di avvio",
    text: "Il gestionale è SAP Business One.",
    part: { index: 1, total: 1 },
    facts: [],
    live: [],
    useCases: [],
    units: [],
    goals: [],
    questions: [],
    commitments: [],
    already: [],
    nonce: "abc123def456",
  });
  const answer = {
    proposte: [
      { tipo: "nuovo", testo: "Il gestionale è SAP Business One.", citazione: "Il gestionale è SAP Business One.", base: "detto", sezione: "sistemi", visibilita: "tutti", fattoRif: null, domandaRif: null, esigenzaRif: null, useCase: [], parte: null, ruolo: null, entro: null, entita: [{ nome: "SAP Business One", tipo: "sistema" }], collegamenti: [] },
    ],
    nonRiportati: { persone: 1, sanitari: 0, altriClienti: 0, clientiDelCliente: 0 },
  };
  const requests = fakeAppClaude([json(answer)]);
  assert.deepEqual(await generateContextRead({ system, prompt, abortSignal: signal(), workspaceId: WS }), answer);
  assert.equal(requests.length, 1);
  assertContextRequest(requests[0], "contextRead", system, prompt);
  // Il blocco degli appunti arriva intero, con il suo nome casuale.
  assert.ok(JSON.stringify(requests[0].body.messages).includes("<appunti-abc123def456>"));
});

test("contextBrief e contextAsk: stesse impostazioni, il loro schema", async () => {
  const brief = fakeAppClaude([json({ righe: ["Produce cucine su misura."] })]);
  assert.deepEqual(await generateContextBrief({ system: "Regole di In breve.", prompt: "FATTI\nazienda | Produce cucine.", abortSignal: signal(), workspaceId: WS }), { righe: ["Produce cucine su misura."] });
  assertContextRequest(brief[0], "contextBrief", "Regole di In breve.", "FATTI\nazienda | Produce cucine.");
  const ask = fakeAppClaude([json({ saputo: true, risposta: "È SAP Business One.", fonti: [1] })]);
  assert.deepEqual(await generateContextAsk({ system: "Regole di Chiedi.", prompt: "DOMANDA\nQual è il gestionale?", abortSignal: signal(), workspaceId: WS }), { saputo: true, risposta: "È SAP Business One.", fonti: [1] });
  assertContextRequest(ask[0], "contextAsk", "Regole di Chiedi.", "DOMANDA\nQual è il gestionale?");
});

test("un rifiuto diventa ClaudeRefusalError, con o senza l'oggetto completo; nel log solo il workspace, il motivo e la categoria", async (t) => {
  const lines = recordLogs(t);
  const calls: Array<[string, () => Promise<unknown>]> = [
    ["context/read", () => generateContextRead({ system: "s", prompt: "Appunti riservati del cliente.", abortSignal: signal(), workspaceId: WS })],
    ["context/brief", () => generateContextBrief({ system: "s", prompt: "Fatti riservati.", abortSignal: signal(), workspaceId: WS })],
    ["context/ask", () => generateContextAsk({ system: "s", prompt: "Domanda riservata.", abortSignal: signal(), workspaceId: WS })],
  ];
  for (const [scope, call] of calls) {
    // Il rifiuto prima di scrivere (la forma più comune).
    fakeAppClaude([refusal([], "general_harms")]);
    await assert.rejects(call(), (error: unknown) => error instanceof ClaudeRefusalError && error.category === "general_harms", scope);
  }
  // Il rifiuto con il JSON completo: l'oggetto non si usa.
  fakeAppClaude([refusal([THINKING, { type: "text", text: JSON.stringify(READ) }], "cyber")]);
  await assert.rejects(calls[0][1](), (error: unknown) => error instanceof ClaudeRefusalError && error.category === "cyber");
  assert.deepEqual(lines, [
    `[context/read] risposta_rifiutata {"workspaceId":"${WS}","finishReason":"content-filter","category":"general_harms"}`,
    `[context/brief] risposta_rifiutata {"workspaceId":"${WS}","finishReason":"content-filter","category":"general_harms"}`,
    `[context/ask] risposta_rifiutata {"workspaceId":"${WS}","finishReason":"content-filter","category":"general_harms"}`,
    `[context/read] risposta_rifiutata {"workspaceId":"${WS}","finishReason":"content-filter","category":"cyber"}`,
  ]);
  for (const line of lines) assert.doesNotMatch(line, /riservat/);
});

test("il tempo massimo interrompe la chiamata: l'errore è quello del segnale, non un errore del modello", async () => {
  fakeAppClaude([hang]);
  const abortSignal = AbortSignal.timeout(50);
  await assert.rejects(
    generateContextRead({ system: "s", prompt: "p", abortSignal, workspaceId: WS }),
    (error: unknown) => stoppedByDeadline(error, abortSignal),
  );
});

test("un oggetto che non rispetta lo schema è un errore, non una risposta", async () => {
  fakeAppClaude([json({ proposte: [{ tipo: "ordine", testo: 4 }], nonRiportati: {} })]);
  await assert.rejects(generateContextRead({ system: "s", prompt: "p", abortSignal: signal(), workspaceId: WS }), (error: unknown) => !(error instanceof ClaudeRefusalError));
});
