import test from "node:test";
import assert from "node:assert/strict";
import { CHAT_REFUSAL_NOTICE, chatRequestMessages, isRefusedReply, messageText, progressItems, toolNameOf, type ChatUIMessage } from "./chat-view.ts";

// (Migrazione a Claude Sonnet 5.5) Che cosa la chat mostra e rimanda: le risposte rifiutate dal modello e le note di
// avanzamento che scrive tra un tool e l'altro.

const refused: ChatUIMessage = {
  id: "r",
  role: "assistant",
  metadata: { finishReason: "content-filter" },
  parts: [{ type: "step-start" }, { type: "text", text: "Ecco come si fa: per prima cosa" }],
};

test("una risposta con finishReason «content-filter» è rifiutata; le altre no", () => {
  assert.equal(isRefusedReply(refused), true);
  assert.equal(isRefusedReply({ ...refused, metadata: { finishReason: "stop" } }), false);
  assert.equal(isRefusedReply({ ...refused, metadata: undefined }), false, "i messaggi salvati, ricaricati, non hanno metadati");
  assert.equal(isRefusedReply({ ...refused, role: "user" }), false);
  assert.match(CHAT_REFUSAL_NOTICE, /^Non posso rispondere a questa richiesta\./);
});

test("il browser rimanda un turno di testo per messaggio, senza la risposta rifiutata", () => {
  const messages: ChatUIMessage[] = [
    { id: "w", role: "assistant", parts: [{ type: "text", text: "Benvenuto: di che cosa ti occupi?" }] },
    { id: "u1", role: "user", parts: [{ type: "text", text: "Preparo le fatture." }] },
    refused,
    { id: "u2", role: "user", parts: [{ type: "text", text: "Ogni mese." }] },
  ];
  assert.deepEqual(chatRequestMessages(messages), [
    { role: "assistant", content: "Benvenuto: di che cosa ti occupi?" },
    { role: "user", content: "Preparo le fatture." },
    { role: "user", content: "Ogni mese." },
  ]);
});

test("il testo di un messaggio: solo le parti di testo", () => {
  assert.equal(
    messageText({
      role: "assistant",
      parts: [{ type: "text", text: "Ho salvato " }, { type: "tool-saveActivity" }, { type: "text", text: "l'attività." }],
    }),
    "Ho salvato l'attività.",
  );
});

test("le note di avanzamento: le parti di ragionamento con testo, ognuna prima del tool che introduce", () => {
  const parts = [
    { type: "step-start" },
    { type: "reasoning", text: "" },
    { type: "reasoning", text: "  Cerco qualche dato su Acme.  " },
    { type: "tool-webSearch", toolName: undefined, state: "output-available" },
    { type: "step-start" },
    { type: "reasoning", text: "Salvo l'attività «Fatture mensili»." },
    { type: "tool-saveActivity", state: "input-available" },
    { type: "reasoning", text: "This part of the response was interrupted before it finished." },
    { type: "text", text: "Fatto." },
  ];
  const view = progressItems(parts, new Set(["webSearch"])).map((item) => (item.kind === "note" ? item.text : `tool:${toolNameOf(item.part)}`));
  assert.deepEqual(view, [
    // Il ragionamento vero (vuoto) non conta; la nota di un tool nascosto resta, il tool no.
    "Cerco qualche dato su Acme.",
    "Salvo l'attività «Fatture mensili».",
    "tool:saveActivity",
    // La frase inglese dell'API per una nota interrotta non è un avanzamento.
  ]);
  assert.deepEqual(progressItems([{ type: "text", text: "Solo testo." }], new Set()), []);
});

test("il nome del tool: toolName, o il tipo della parte senza «tool-»", () => {
  assert.equal(toolNameOf({ type: "tool-saveActivity" }), "saveActivity");
  assert.equal(toolNameOf({ type: "dynamic-tool", toolName: "createDepartment" }), "createDepartment");
  assert.equal(toolNameOf({ type: "dynamic-tool" }), "tool");
});
