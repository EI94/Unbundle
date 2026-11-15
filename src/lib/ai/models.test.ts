import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { generateObject, generateText, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import { ev, fakeClaude, message, recordLogs, refusal, sse, THINKING, type Captured } from "./claude-test-kit.ts";
import {
  CLAUDE_MODEL,
  CLAUDE_TASKS,
  ClaudeRefusalError,
  claudeCallSettings,
  claudeStopSummary,
  logClaudeStop,
  throwIfRefused,
  WEB_SEARCH_TIMEOUT_MS,
  type ClaudeTask,
} from "./models.ts";

// (Migrazione a Claude Sonnet 5.5) Le richieste vere di @ai-sdk/anthropic, senza rete: il provider finto di
// claude-test-kit.ts (`createAnthropic({ apiKey: "test", fetch })`) registra indirizzo, intestazione beta e corpo, e
// risponde come l'API di Claude (JSON, o eventi SSE per lo streaming). Nessuna chiave vera, nessuna chiamata all'API.

/** Che cosa ogni richiesta a Claude Sonnet 5.5 deve avere, e che cosa non deve mai avere (un 400). */
function assertSonnet55Request(request: Captured, task: ClaudeTask) {
  const settings = CLAUDE_TASKS[task];
  const { body } = request;
  assert.equal(request.url.pathname, "/v1/messages");
  assert.equal(body.model, "claude-sonnet-5-5");
  assert.equal(body.max_tokens, settings.maxOutputTokens, "il limite del compito, mai i 128000 dell'SDK");
  assert.equal((body.output_config as { effort?: string } | undefined)?.effort, settings.effort);
  for (const key of ["temperature", "top_p", "top_k"]) assert.equal(key in body, false, `${key} non si manda`);
  assert.equal("thinking" in body, false, "ragionamento adattivo: `thinking` assente, mai `disabled`");
  const toolChoice = body.tool_choice as { type?: string } | undefined;
  assert.ok(toolChoice === undefined || toolChoice.type === "auto", `tool_choice forzato: ${JSON.stringify(toolChoice)}`);
  const messages = body.messages as Array<{ role: string }>;
  assert.equal(messages[messages.length - 1].role === "assistant", false, "nessun prefill");
  assert.equal(body.fallbacks, settings.fallbacks ? "default" : undefined);
  assert.equal(request.betas.includes("server-side-fallback-2026-07-01"), settings.fallbacks);
}

test("un solo modello, claude-sonnet-5-5; ogni chiamata ha sforzo, limite dei token e ripiego espliciti", () => {
  assert.equal(CLAUDE_MODEL, "claude-sonnet-5-5");
  for (const task of Object.keys(CLAUDE_TASKS) as ClaudeTask[]) {
    const { effort, maxOutputTokens, fallbacks } = CLAUDE_TASKS[task];
    assert.ok(effort === "low" || effort === "medium", `${task}: sforzo ${effort}`);
    // Il ragionamento adattivo conta nel limite: mai sotto 16000; oltre 32000 nei 300 secondi non finirebbe.
    assert.ok(maxOutputTokens >= 16_000 && maxOutputTokens <= 32_000, `${task}: ${maxOutputTokens}`);
    const settings = claudeCallSettings(task);
    assert.equal(settings.maxOutputTokens, maxOutputTokens);
    // Solo sforzo e ripiego: niente `thinking`, niente modalità dell'output strutturato (la sceglie l'SDK).
    assert.deepEqual(settings.providerOptions, {
      anthropic: fallbacks ? { effort, fallbacks: "default" } : { effort },
    });
  }
  assert.equal(CLAUDE_TASKS.chat.effort, "medium", "la chat chiama più tool che salvano in un turno");
  assert.equal(CLAUDE_TASKS.chat.fallbacks, false, "la chat a più passi: niente ripiego lato server");
  assert.ok(WEB_SEARCH_TIMEOUT_MS >= 15_000 && WEB_SEARCH_TIMEOUT_MS <= 60_000, "la ricerca sta dentro i 120 secondi della chat");
});

test("generateObject: JSON in output_config.format, niente tool forzato; l'oggetto si legge dopo un blocco di ragionamento", async () => {
  const schema = z.object({
    useCases: z.array(
      z.object({
        title: z.string(),
        impactEconomic: z.number().min(1).max(5),
        leverType: z.enum(["revenue_growth", "cost_reduction"]),
        timeline: z.string().optional(),
      }),
    ),
  });
  const answer = { useCases: [{ title: "Verbali automatici", impactEconomic: 4, leverType: "cost_reduction" }] };
  const { provider, requests } = fakeClaude([message([THINKING, { type: "text", text: JSON.stringify(answer) }])]);
  const result = await generateObject({
    model: provider(CLAUDE_MODEL),
    ...claudeCallSettings("useCases"),
    schema,
    prompt: "Genera gli use case.",
  });
  assert.deepEqual(result.object, answer);
  assert.deepEqual(result.warnings ?? [], [], "nessun parametro riscritto o tolto dall'SDK");
  assert.equal(requests.length, 1);
  const [request] = requests;
  assertSonnet55Request(request, "useCases");
  assert.equal(request.body.max_tokens, 32_000);
  assert.equal(request.body.tools, undefined, "nessun tool `json`");
  assert.equal(request.body.tool_choice, undefined);
  const format = (request.body.output_config as { format?: { type: string; schema: unknown } }).format;
  assert.equal(format?.type, "json_schema");
  assert.equal(/"minimum"|"maximum"/.test(JSON.stringify(format?.schema)), false, "i limiti 1-5 vanno nelle descrizioni");
  // La rivalidazione con zod resta: un punteggio fuori scala non passa.
  assert.equal(schema.safeParse({ useCases: [{ ...answer.useCases[0], impactEconomic: 7 }] }).success, false);
});

test("generateObject: un rifiuto senza testo non diventa un oggetto (errore con finishReason «content-filter»)", async () => {
  const { provider } = fakeClaude([
    message([], "refusal", { stop_details: { type: "refusal", category: "general_harms", explanation: null } }),
  ]);
  await assert.rejects(
    generateObject({ model: provider(CLAUDE_MODEL), ...claudeCallSettings("report"), schema: z.object({ executiveSummary: z.string() }), prompt: "Genera il report." }),
    (error: { finishReason?: string }) => error.finishReason === "content-filter",
  );
});

test("generateObject: un rifiuto con il JSON completo torna come oggetto; throwIfRefused lo ferma, nel log solo motivo e categoria", async (t) => {
  const lines = recordLogs(t);
  const answer = { executiveSummary: "Sintesi riservata del cliente." };
  const { provider } = fakeClaude([refusal([THINKING, { type: "text", text: JSON.stringify(answer) }], "general_harms")]);
  const result = await generateObject({
    model: provider(CLAUDE_MODEL),
    schema: z.object({ executiveSummary: z.string() }),
    prompt: "Genera il report.",
    ...claudeCallSettings("report"),
  });
  assert.equal(result.finishReason, "content-filter");
  assert.deepEqual(result.object, answer, "l'SDK lo restituisce: senza il controllo si userebbe");
  assert.throws(
    () => throwIfRefused("ai/generate-report", result),
    (error: unknown) =>
      error instanceof ClaudeRefusalError &&
      error.finishReason === "content-filter" &&
      error.category === "general_harms" &&
      error.message === "Claude ha rifiutato la richiesta (ai/generate-report).",
  );
  assert.deepEqual(lines, ['[ai/generate-report] risposta_rifiutata {"finishReason":"content-filter","category":"general_harms"}']);

  // Una risposta completa passa com'è, senza log.
  const { provider: ok } = fakeClaude([message([THINKING, { type: "text", text: JSON.stringify(answer) }])]);
  const done = await generateObject({ model: ok(CLAUDE_MODEL), schema: z.object({ executiveSummary: z.string() }), prompt: "Genera il report.", ...claudeCallSettings("report") });
  assert.equal(throwIfRefused("ai/generate-report", done), done);
  assert.equal(lines.length, 1);
});

test("generateText (testo di un PDF): blocco documento, sforzo basso, 32000 token; il testo resta senza il ragionamento", async () => {
  const { provider, requests } = fakeClaude([message([THINKING, { type: "text", text: "Testo estratto dal PDF." }])]);
  const result = await generateText({
    model: provider(CLAUDE_MODEL),
    ...claudeCallSettings("pdfText"),
    messages: [
      {
        role: "user",
        content: [
          { type: "file", data: Buffer.from("%PDF-1.4 prova").toString("base64"), mediaType: "application/pdf" },
          { type: "text", text: "Estrai tutto il testo contenuto in questo documento PDF." },
        ],
      },
    ],
  });
  assert.equal(result.text, "Testo estratto dal PDF.");
  assert.deepEqual(result.warnings ?? [], []);
  assert.equal(result.finishReason, "stop");
  const [request] = requests;
  assertSonnet55Request(request, "pdfText");
  assert.equal(request.body.max_tokens, 32_000);
  assert.equal((request.body.output_config as { format?: unknown }).format, undefined, "testo libero, nessuno schema");
  assert.equal(request.body.tools, undefined);
  const [userMessage] = request.body.messages as Array<{ content: Array<{ type: string }> }>;
  assert.deepEqual(userMessage.content.map((block) => block.type), ["document", "text"]);
});

test("generateText: un rifiuto arriva come finishReason «content-filter»; nel log solo il motivo e la categoria", async () => {
  const partial = "Ecco il riassunto del documento riserv";
  const { provider, requests } = fakeClaude([
    message([{ type: "text", text: partial }], "refusal", {
      stop_details: { type: "refusal", category: "general_harms", explanation: "Spiegazione del rifiuto" },
    }),
  ]);
  const result = await generateText({
    model: provider(CLAUDE_MODEL),
    ...claudeCallSettings("documentSummary"),
    system: "Riassumi il documento in massimo 5 bullet point.",
    prompt: "Riassumi questo documento.",
  });
  assertSonnet55Request(requests[0], "documentSummary");
  assert.equal(result.finishReason, "content-filter", "le chiamate controllano questo prima di usare il testo");
  assert.equal(result.text, partial, "il testo parziale c'è: per questo non si usa");
  assert.deepEqual(claudeStopSummary(result), { finishReason: "content-filter", category: "general_harms" });
  const lines: string[] = [];
  logClaudeStop("prova", "sintesi_rifiutata", result, { warn: (...args: unknown[]) => lines.push(args.join(" ")) });
  assert.deepEqual(lines, ['[prova] sintesi_rifiutata {"finishReason":"content-filter","category":"general_harms"}']);
  // Una categoria che non è un token breve non finisce nei log; senza dettagli resta null.
  assert.equal(claudeStopSummary({ finishReason: "content-filter", providerMetadata: { anthropic: { stopDetails: { category: "testo con spazi" } } } }).category, null);
  assert.deepEqual(claudeStopSummary({ finishReason: "stop" }), { finishReason: "stop", category: null });
});

test("generateText con la ricerca web dell'API: tool non forzato, sforzo basso, il riassunto dopo i risultati", async () => {
  const { provider, requests } = fakeClaude([
    message([
      THINKING,
      { type: "server_tool_use", id: "srvtoolu_prova", name: "web_search", input: { query: "Acme" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "srvtoolu_prova",
        content: [{ type: "web_search_result", url: "https://example.com", title: "Esempio", encrypted_content: "x", page_age: null }],
      },
      { type: "text", text: "Acme produce bulloni." },
    ]),
  ]);
  const result = await generateText({
    model: provider(CLAUDE_MODEL),
    ...claudeCallSettings("webSearch"),
    tools: { web_search: provider.tools.webSearch_20250305({ maxUses: 3 }) },
    stopWhen: stepCountIs(5),
    prompt: 'Cerca su internet: "Acme".',
  });
  assert.equal(result.text, "Acme produce bulloni.");
  assert.deepEqual(result.warnings ?? [], []);
  assert.equal(requests.length, 1, "la ricerca gira sull'API: un passo solo");
  const [request] = requests;
  assertSonnet55Request(request, "webSearch");
  assert.deepEqual((request.body.tools as Array<{ type: string }>).map((t) => t.type), ["web_search_20250305"]);
});

test("streamText con un tool (chat): sforzo medio, 16000 token per passo, niente ripiego; il passo dopo il tool rimanda il ragionamento firmato", async () => {
  const { provider, requests } = fakeClaude([
    sse([ev.start("msg_1"), ...ev.thinking(0, "firma-A"), ...ev.toolUse(1, "toolu_prova", "saveActivity", '{"title":"Fatture mensili"}'), ...ev.end("tool_use")]),
    sse([ev.start("msg_2"), ...ev.thinking(0, "firma-B"), ...ev.text(1, "Ho salvato l'attività."), ...ev.end("end_turn")]),
  ]);
  const saved: string[] = [];
  let finished: { text: string; finishReason: string } | undefined;
  const result = streamText({
    model: provider(CLAUDE_MODEL),
    ...claudeCallSettings("chat"),
    system: "Prompt di sistema della chat.",
    messages: [
      { role: "assistant", content: "Benvenuto: di che cosa ti occupi?" },
      { role: "user", content: "Preparo le fatture ogni mese." },
    ],
    tools: {
      saveActivity: tool({
        description: "Salva un'attività",
        inputSchema: z.object({ title: z.string() }),
        execute: async ({ title }) => {
          saved.push(title);
          return { success: true };
        },
      }),
    },
    stopWhen: stepCountIs(20),
    onFinish: ({ text, finishReason }) => {
      finished = { text, finishReason };
    },
  });
  await result.consumeStream();
  assert.equal(await result.finishReason, "stop");
  assert.deepEqual((await result.steps).flatMap((step) => step.warnings ?? []), []);
  assert.deepEqual(saved, ["Fatture mensili"]);
  assert.deepEqual(finished, { text: "Ho salvato l'attività.", finishReason: "stop" });
  assert.equal(requests.length, 2);
  for (const request of requests) {
    assertSonnet55Request(request, "chat");
    assert.equal(request.body.max_tokens, 16_000);
    assert.equal(request.body.stream, true);
    assert.deepEqual((request.body.tools as Array<{ name: string }>).map((t) => t.name), ["saveActivity"]);
  }
  // Il secondo passo è il primo più due messaggi (solo aggiunte): il turno dell'assistente com'era, il
  // ragionamento con la sua firma e la chiamata al tool, poi il risultato del tool.
  const first = requests[0].body.messages as unknown[];
  const second = requests[1].body.messages as Array<{ role: string; content: Array<Record<string, unknown>> }>;
  assert.deepEqual(second.slice(0, first.length), first);
  assert.equal(second.length, first.length + 2);
  const [replay, toolResult] = second.slice(first.length);
  assert.equal(replay.role, "assistant");
  assert.deepEqual(replay.content.map((block) => block.type), ["thinking", "tool_use"]);
  assert.equal(replay.content[0].signature, "firma-A");
  assert.equal(toolResult.role, "user");
  assert.equal(toolResult.content[0].type, "tool_result");
});

test("streamText: un rifiuto a metà risposta arriva in onFinish come «content-filter», con la categoria", async () => {
  const { provider } = fakeClaude([
    sse([ev.start("msg_1"), ...ev.text(0, "Ecco una rispo"), ...ev.end("refusal", { stop_details: { type: "refusal", category: "cyber", explanation: null } })]),
  ]);
  let finished: { finishReason: string; providerMetadata: unknown } | undefined;
  const result = streamText({
    model: provider(CLAUDE_MODEL),
    ...claudeCallSettings("chat"),
    messages: [{ role: "user", content: "Domanda." }],
    onFinish: ({ finishReason, providerMetadata }) => {
      finished = { finishReason, providerMetadata };
    },
  });
  await result.consumeStream();
  assert.equal(finished?.finishReason, "content-filter", "la chat non salva il testo parziale");
  assert.deepEqual(claudeStopSummary(finished ?? {}), { finishReason: "content-filter", category: "cyber" });
});

/** Le chiamate al modello dell'app e i loro compiti (src/lib/ai/models.ts). */
const CALL_SITES: Readonly<Record<string, readonly ClaudeTask[]>> = {
  "src/app/api/ai/chat/route.ts": ["chat"],
  "src/lib/ai/tools/web-search-tool.ts": ["webSearch"],
  "src/app/api/documents/upload/route.ts": ["pdfText", "documentSummary"],
  "src/app/api/cron/weekly-pulse/route.ts": ["weeklySignals"],
  "src/lib/ai/classify.ts": ["classifyActivity"],
  "src/lib/ai/onet-matching.ts": ["onetMatch"],
  "src/lib/actions/value-map.ts": ["valueMap"],
  "src/lib/actions/pre-generate-activities.ts": ["preGenerateActivities"],
  "src/lib/ai/generate-report.ts": ["report"],
  "src/lib/ai/generate-simulation.ts": ["simulation"],
  "src/lib/ai/generate-use-cases.ts": ["useCases"],
  "src/lib/ai/generate-blueprints.ts": ["blueprints"],
  "src/lib/actions/intelligence.ts": ["competitiveAnalysis"],
  "src/lib/actions/strategy.ts": ["okrSuggestions"],
};

const ROOT = new URL("../../../", import.meta.url);
// Composto, così questo file non contiene l'id che cerca.
const RETIRED_MODEL = ["claude", "sonnet", "4", "20250514"].join("-");
/** Dove l'id ritirato può restare: la storia nei commenti e le prove della scelta dell'output strutturato. */
const RETIRED_MODEL_ALLOWED = new Set(["src/lib/ai/models.ts", "src/lib/portfolio/ai-ranking-contract.ts", "src/lib/portfolio/ai-ranking-safety.test.ts"]);

test("ogni chiamata usa il modello e le impostazioni del suo compito; nessun id scritto a mano, nessun modello ritirato", () => {
  const tasks = new Set<ClaudeTask>();
  for (const [path, expected] of Object.entries(CALL_SITES)) {
    const source = readFileSync(new URL(path, ROOT), "utf8");
    assert.equal(source.split("anthropic(CLAUDE_MODEL)").length - 1, expected.length, `${path}: una chiamata per compito`);
    for (const task of expected) {
      assert.ok(source.includes(`...claudeCallSettings("${task}")`), `${path}: impostazioni di «${task}»`);
      tasks.add(task);
    }
  }
  assert.deepEqual([...tasks].sort(), Object.keys(CLAUDE_TASKS).sort(), "ogni compito ha la sua chiamata");

  const files = (readdirSync(new URL("src/", ROOT), { recursive: true }) as string[])
    .map((file) => `src/${file.split("\\").join("/")}`)
    .filter((file) => /\.(ts|tsx|mts)$/.test(file));
  assert.ok(files.length > 100, "i sorgenti ci sono");
  for (const file of files) {
    const source = readFileSync(new URL(file, ROOT), "utf8");
    if (!file.endsWith(".test.ts")) {
      assert.equal(/anthropic\(\s*["'`]claude-/.test(source), false, `${file}: il modello viene da src/lib/ai/models.ts`);
    }
    if (source.includes(RETIRED_MODEL)) assert.ok(RETIRED_MODEL_ALLOWED.has(file), `${file}: ${RETIRED_MODEL} è ritirato`);
  }
});

test("ogni generateObject dell'app passa subito da throwIfRefused, prima di usare o scrivere l'oggetto", () => {
  const files = (readdirSync(new URL("src/", ROOT), { recursive: true }) as string[])
    .map((file) => `src/${file.split("\\").join("/")}`)
    // models.ts definisce throwIfRefused e ne mostra l'uso in un commento.
    .filter((file) => /\.(ts|tsx)$/.test(file) && !file.endsWith(".test.ts") && file !== "src/lib/ai/models.ts");
  const sites: string[] = [];
  for (const file of files) {
    const source = readFileSync(new URL(file, ROOT), "utf8");
    const calls = source.match(/\bgenerateObject\(/g)?.length ?? 0;
    const guarded = [...source.matchAll(/throwIfRefused\("([a-z0-9/-]+)", await generateObject\(/g)];
    assert.equal(guarded.length, calls, `${file}: ${calls} generateObject, ${guarded.length} dentro throwIfRefused("scope", await generateObject(...))`);
    sites.push(...guarded.map((match) => `${file} ${match[1]}`));
  }
  // Le undici chiamate con CLAUDE_MODEL, più l'auto-ranking del portfolio e la proposta del filo con il referente.
  assert.equal(sites.length, 13, sites.join("\n"));
});
