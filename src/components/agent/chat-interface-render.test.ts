import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { ChatTransport } from "ai";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { CHAT_REFUSAL_NOTICE, type ChatUIMessage } from "./chat-view.ts";

// (Migrazione a Claude Sonnet 5.5) La chat vera (chat-interface.tsx), resa sul server con lo stato di useChat scelto
// qui (@ai-sdk/react finto): che cosa mostra di una risposta e che cosa manda alla rotta. Le decisioni stanno in
// chat-view.ts, con i loro test; qui si controlla che il componente le usi.

type ChatState = { messages: ChatUIMessage[]; status: string; transport?: ChatTransport<ChatUIMessage> };
const state: ChatState = { messages: [], status: "ready" };
(globalThis as { __chatRender?: ChatState }).__chatRender = state;

await installAppModules({
  "@ai-sdk/react": `export function useChat(options) {
    const state = globalThis.__chatRender;
    state.transport = options.transport;
    return { messages: state.messages, status: state.status, error: undefined, sendMessage() {} };
  }`,
});
await enableTsxImports();
const { ChatInterface } = await import("./chat-interface.tsx");

const PROPS = { workspaceId: "ws-prova", conversationType: "activity_mapping", departmentId: "reparto-prova" };

/** La lista dei messaggi resa: il suo markup e il testo visibile, un pezzo per elemento. */
function render(messages: ChatUIMessage[], status = "ready") {
  state.messages = messages;
  state.status = status;
  const html = renderToStaticMarkup(createElement(ChatInterface, PROPS));
  const list = html.slice(html.indexOf('<div class="mx-auto max-w-2xl space-y-6">'), html.indexOf('<div class="border-t border-border px-6 py-4">'));
  const text = list
    .split(/<[^>]+>/)
    .map((piece) => piece.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").trim())
    .filter(Boolean);
  return { list, text };
}

const question: ChatUIMessage = { id: "u1", role: "user", parts: [{ type: "text", text: "Preparo le fatture." }] };

test("una risposta rifiutata: l'avviso al posto del testo parziale, e solo i tool finiti prima del rifiuto", () => {
  const { list, text } = render([
    question,
    {
      id: "a1",
      role: "assistant",
      metadata: { finishReason: "content-filter" },
      parts: [
        { type: "step-start" },
        { type: "reasoning", text: "Salvo l'obiettivo «Ridurre i tempi».", state: "done" },
        { type: "tool-saveStrategicGoal", toolCallId: "t1", state: "output-available", input: {}, output: {} },
        { type: "step-start" },
        { type: "reasoning", text: "Preparo i passaggi.", state: "done" },
        { type: "tool-saveActivity", toolCallId: "t2", state: "input-available", input: {} },
        { type: "text", text: "Ecco come si fa: per prima", state: "done" },
      ],
    },
  ]);
  assert.deepEqual(text, ["Preparo le fatture.", CHAT_REFUSAL_NOTICE, "Obiettivo salvato"]);
  assert.doesNotMatch(list, /animate-pulse/, "nessun tool che gira per sempre");
});

test("una risposta: il testo con il grassetto, poi i tool con le loro etichette", () => {
  const { list, text } = render([
    question,
    {
      id: "a2",
      role: "assistant",
      metadata: { finishReason: "stop" },
      parts: [
        { type: "step-start" },
        { type: "tool-saveActivity", toolCallId: "t1", state: "output-available", input: {}, output: {} },
        { type: "step-start" },
        { type: "text", text: "Fatto. **Quante ore** a settimana?", state: "done" },
      ],
    },
  ]);
  assert.deepEqual(text, ["Preparo le fatture.", "Fatto.", "Quante ore", "a settimana?", "Attività salvata"]);
  assert.match(list, /<strong class="font-semibold text-foreground">Quante ore<\/strong>/);
});

test("una risposta in arrivo, ancora senza testo: le note e i tool in corso, e l'attesa", () => {
  const { list, text } = render(
    [
      question,
      {
        id: "a3",
        role: "assistant",
        parts: [
          { type: "step-start" },
          { type: "reasoning", text: "Salvo l'attività «Fatture mensili».", state: "done" },
          { type: "tool-saveActivity", toolCallId: "t1", state: "input-available", input: {} },
        ],
      },
    ],
    "streaming",
  );
  assert.deepEqual(text, ["Preparo le fatture.", "Salvo l'attività «Fatture mensili».", "Salvo l'attività", "Sto ragionando..."]);
  assert.match(list, /animate-pulse"><svg[^]*?<span>Salvo l&#x27;attività<\/span>/, "il tool in corso pulsa");
});

test("la richiesta alla rotta: il corpo di chatTransportBody, senza la risposta rifiutata e la sua domanda", async (t) => {
  render([]);
  const sent: Array<{ url: string; body: unknown }> = [];
  t.mock.method(globalThis, "fetch", async (url: string | URL | Request, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response("data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  });
  await state.transport!.sendMessages({
    chatId: "chat-prova",
    messageId: undefined,
    trigger: "submit-message",
    abortSignal: undefined,
    messages: [
      { id: "w", role: "assistant", parts: [{ type: "text", text: "Benvenuto: di che cosa ti occupi?" }] },
      { id: "q1", role: "user", parts: [{ type: "text", text: "Come entro nel gestionale di un concorrente?" }] },
      { id: "r1", role: "assistant", metadata: { finishReason: "content-filter" }, parts: [{ type: "text", text: "Ecco come" }] },
      { id: "q2", role: "user", parts: [{ type: "text", text: "Preparo le fatture." }] },
    ],
  });
  assert.deepEqual(sent, [
    {
      url: "/api/ai/chat",
      body: {
        messages: [
          { role: "assistant", content: "Benvenuto: di che cosa ti occupi?" },
          { role: "user", content: "Preparo le fatture." },
        ],
        ...PROPS,
      },
    },
  ]);
});
