import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { createAnthropic } from "@ai-sdk/anthropic";
import { generateObject, generateText, stepCountIs, streamText, tool } from "ai";
import { z } from "zod";
import {
  CLAUDE_MODEL,
  CLAUDE_TASKS,
  claudeCallSettings,
  claudeStopSummary,
  logClaudeStop,
  WEB_SEARCH_TIMEOUT_MS,
  type ClaudeTask,
} from "./models.ts";

// (Migrazione a Claude Sonnet 5.5) Le richieste vere di @ai-sdk/anthropic, senza rete: `createAnthropic`
// riceve una fetch finta che registra indirizzo, intestazione beta e corpo, e risponde come l'API di
// Claude (JSON, o eventi SSE per lo streaming). Nessuna chiave vera, nessuna chiamata all'API.

type Body = Record<string, unknown>;
type Captured = { url: URL; betas: string[]; body: Body };

function fakeClaude(replies: Array<() => Response>) {
  const requests: Captured[] = [];
  const provider = createAnthropic({
    apiKey: "chiave-finta-di-prova",
    fetch: async (url, init) => {
      const beta = new Headers(init?.headers).get("anthropic-beta") ?? "";
      requests.push({
        url: new URL(String(url)),
        betas: beta.split(",").map((b) => b.trim()).filter(Boolean),
        body: JSON.parse(String(init?.body)) as Body,
      });
      const reply = replies.shift();
      if (!reply) throw new Error("nessuna risposta finta rimasta");
      return reply();
    },
  });
  return { provider, requests };
}

/** Una risposta dell'API (non in streaming). */
function message(content: unknown[], stop_reason = "end_turn", extra: Body = {}) {
  return () =>
    Response.json({
      id: "msg_prova",
      type: "message",
      role: "assistant",
      model: CLAUDE_MODEL,
      content,
      stop_reason,
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 10 },
      ...extra,
    });
}

/** Una risposta dell'API in streaming: gli eventi SSE. */
function sse(events: Body[]) {
  return () =>
    new Response(events.map((e) => `event: ${String(e.type)}\ndata: ${JSON.stringify(e)}\n\n`).join(""), {
      headers: { "content-type": "text/event-stream" },
    });
}

const ev = {
  start: (id: string): Body => ({
    type: "message_start",
    message: { id, type: "message", role: "assistant", model: CLAUDE_MODEL, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } },
  }),
  // Un blocco di ragionamento come lo manda il modello per default: testo vuoto, firma presente.
  thinking: (index: number, signature: string): Body[] => [
    { type: "content_block_start", index, content_block: { type: "thinking", thinking: "" } },
    { type: "content_block_delta", index, delta: { type: "signature_delta", signature } },
    { type: "content_block_stop", index },
  ],
  text: (index: number, text: string): Body[] => [
    { type: "content_block_start", index, content_block: { type: "text", text: "" } },
    { type: "content_block_delta", index, delta: { type: "text_delta", text } },
    { type: "content_block_stop", index },
  ],
  toolUse: (index: number, id: string, name: string, json: string): Body[] => [
    { type: "content_block_start", index, content_block: { type: "tool_use", id, name, input: {} } },
    { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: json } },
    { type: "content_block_stop", index },
  ],
  end: (stop_reason: string, extra: Body = {}): Body[] => [
    { type: "message_delta", delta: { stop_reason, stop_sequence: null, ...extra }, usage: { output_tokens: 20 } },
    { type: "message_stop" },
  ],
};

/** Un blocco di ragionamento in una risposta non in streaming (testo vuoto per default, firmato). */
const THINKING = { type: "thinking", thinking: "", signature: "firma-di-prova" };

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

test("generateObject: un rifiuto non diventa un oggetto (errore con finishReason «content-filter»)", async () => {
  const { provider } = fakeClaude([
    message([], "refusal", { stop_details: { type: "refusal", category: "general_harms", explanation: null } }),
  ]);
  await assert.rejects(
    generateObject({ model: provider(CLAUDE_MODEL), ...claudeCallSettings("report"), schema: z.object({ executiveSummary: z.string() }), prompt: "Genera il report." }),
    (error: { finishReason?: string }) => error.finishReason === "content-filter",
  );
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
