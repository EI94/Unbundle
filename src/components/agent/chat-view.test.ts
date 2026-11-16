import test from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_REFUSAL_NOTICE,
  HIDDEN_TOOLS,
  MAPPING_TOOL_LABELS,
  TOOL_LABELS,
  assistantView,
  chatRequestMessages,
  chatTransportBody,
  isRefusedReply,
  messageText,
  progressItems,
  toolChip,
  toolNameOf,
  toolOutcome,
  type ChatUIMessage,
} from "./chat-view.ts";

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

test("il browser rimanda un turno di testo per messaggio, senza la risposta rifiutata né la domanda che l'ha avuta", () => {
  const messages: ChatUIMessage[] = [
    { id: "w", role: "assistant", parts: [{ type: "text", text: "Benvenuto: di che cosa ti occupi?" }] },
    { id: "u1", role: "user", parts: [{ type: "text", text: "Preparo le fatture." }] },
    { id: "a1", role: "assistant", metadata: { finishReason: "stop" }, parts: [{ type: "text", text: "Ogni quanto?" }] },
    { id: "u2", role: "user", parts: [{ type: "text", text: "Come entro nel gestionale di un concorrente?" }] },
    refused,
    { id: "u3", role: "user", parts: [{ type: "text", text: "Ogni mese." }] },
  ];
  // La domanda rifiutata non torna al modello unita a quella dopo («Prova a riformularla»).
  assert.deepEqual(chatRequestMessages(messages), [
    { role: "assistant", content: "Benvenuto: di che cosa ti occupi?" },
    { role: "user", content: "Preparo le fatture." },
    { role: "assistant", content: "Ogni quanto?" },
    { role: "user", content: "Ogni mese." },
  ]);
});

test("prima di una risposta rifiutata si tolgono tutti i turni dell'utente di seguito: il modello li aveva ricevuti uniti", () => {
  const user = (id: string, text: string): ChatUIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
  // Dopo un errore di rete la domanda resta a schermo senza risposta; la seconda parte unita alla prima.
  assert.deepEqual(chatRequestMessages([user("u1", "Prima parte."), user("u2", "Seconda parte."), refused, user("u3", "Altra domanda.")]), [
    { role: "user", content: "Altra domanda." },
  ]);
  // Due rifiuti di seguito: restano solo i turni prima del primo.
  const answer: ChatUIMessage = { id: "a0", role: "assistant", metadata: { finishReason: "stop" }, parts: [{ type: "text", text: "Di che cosa ti occupi?" }] };
  assert.deepEqual(chatRequestMessages([user("u0", "Ciao."), answer, user("u1", "Uno."), refused, user("u2", "Due."), { ...refused, id: "r2" }]), [
    { role: "user", content: "Ciao." },
    { role: "assistant", content: "Di che cosa ti occupi?" },
  ]);
  // Una risposta interrotta senza testo (solo un tool) non arriva al modello, quindi non separa le domande: il modello
  // le ha ricevute unite, e si tolgono tutte e due. Una risposta interrotta con del testo invece arriva, e le separa.
  const toolsOnly: ChatUIMessage = { id: "a1", role: "assistant", parts: [{ type: "step-start" }, { type: "tool-saveActivity", toolCallId: "t1", state: "input-available", input: {} }] };
  assert.deepEqual(chatRequestMessages([user("u0", "Ciao."), answer, user("u1", "Uno."), toolsOnly, user("u2", "Due."), refused, user("u3", "Tre.")]), [
    { role: "user", content: "Ciao." },
    { role: "assistant", content: "Di che cosa ti occupi?" },
    { role: "user", content: "Tre." },
  ]);
  // Lo stesso per una risposta il cui solo testo sono spazi o a capo: chatHistory toglie anche lei (il testo, senza
  // spazi, è vuoto), e il modello riceve unite le due domande.
  const whitespaceOnly: ChatUIMessage = {
    id: "a1",
    role: "assistant",
    parts: [{ type: "step-start" }, { type: "text", text: "\n\n" }, { type: "tool-saveActivity", toolCallId: "t1", state: "input-available", input: {} }],
  };
  assert.deepEqual(chatRequestMessages([user("u0", "Ciao."), answer, user("u1", "Uno."), whitespaceOnly, user("u2", "Due."), refused, user("u3", "Tre.")]), [
    { role: "user", content: "Ciao." },
    { role: "assistant", content: "Di che cosa ti occupi?" },
    { role: "user", content: "Tre." },
  ]);
  const withText: ChatUIMessage = { id: "a1", role: "assistant", parts: [{ type: "text", text: "Ogni quanto" }] };
  assert.deepEqual(chatRequestMessages([user("u1", "Uno."), withText, user("u2", "Due."), refused, user("u3", "Tre.")]), [
    { role: "user", content: "Uno." },
    { role: "assistant", content: "Ogni quanto" },
    { role: "user", content: "Tre." },
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

test("il corpo della richiesta alla rotta: i turni di chatRequestMessages e il contesto della chat", () => {
  const messages: ChatUIMessage[] = [
    { id: "u1", role: "user", parts: [{ type: "text", text: "Come entro nel gestionale di un concorrente?" }] },
    refused,
    { id: "u2", role: "user", parts: [{ type: "text", text: "Preparo le fatture." }] },
  ];
  const context = { workspaceId: "ws-prova", conversationType: "activity_mapping", departmentId: "reparto-prova" };
  assert.deepEqual(chatTransportBody(messages, undefined, context), { messages: [{ role: "user", content: "Preparo le fatture." }], ...context });
  // Il corpo della richiesta (quello del trasporto, unito a quello della singola richiesta) vince sul contesto.
  assert.deepEqual(chatTransportBody(messages, { workspaceId: "ws-altro", conversationType: "leadership_setup" }, context), {
    messages: [{ role: "user", content: "Preparo le fatture." }],
    workspaceId: "ws-altro",
    conversationType: "leadership_setup",
    departmentId: "reparto-prova",
  });
});

test("una risposta rifiutata si mostra con l'avviso, mai con il suo testo parziale; le altre con il loro testo", () => {
  const view = assistantView(refused, HIDDEN_TOOLS, { arriving: false });
  assert.equal(view.kind, "refused");
  assert.equal(view.kind === "refused" && view.notice, CHAT_REFUSAL_NOTICE);
  assert.doesNotMatch(JSON.stringify(view), /Ecco come si fa/);
  assert.deepEqual(assistantView({ ...refused, metadata: { finishReason: "stop" } }, HIDDEN_TOOLS, { arriving: false }), {
    kind: "answer",
    text: "Ecco come si fa: per prima cosa",
    progress: [],
  });
  // I messaggi ricaricati non hanno metadati: sono risposte salvate, quindi finite.
  assert.equal(assistantView({ ...refused, metadata: undefined }, HIDDEN_TOOLS, { arriving: false }).kind, "answer");
});

test("una risposta ancora senza testo: note e tool nell'ordine, con le etichette; i tool nascosti no", () => {
  const arriving: ChatUIMessage = {
    id: "a",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "Cerco qualche dato su Acme." },
      { type: "tool-webSearch", toolCallId: "t0", state: "output-available", input: {}, output: {} },
      { type: "step-start" },
      { type: "reasoning", text: "Salvo l'attività «Fatture mensili»." },
      { type: "tool-saveActivity", toolCallId: "t1", state: "input-available", input: {} },
    ],
  };
  assert.deepEqual(assistantView(arriving, HIDDEN_TOOLS, { arriving: true }), {
    kind: "answer",
    text: "",
    progress: [
      { kind: "note", text: "Cerco qualche dato su Acme." },
      { kind: "note", text: "Salvo l'attività «Fatture mensili»." },
      { kind: "tool", label: "Salvo l'attività", done: false },
    ],
  });
  assert.ok(HIDDEN_TOOLS.has("webSearch"));
});

test("una risposta rifiutata: l'avviso e solo i tool finiti nei passi prima; niente note, niente tool in corso o falliti", () => {
  const refusedAfterTools: ChatUIMessage = {
    id: "r",
    role: "assistant",
    metadata: { finishReason: "content-filter" },
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "Salvo l'obiettivo «Ridurre i tempi»." },
      { type: "tool-saveStrategicGoal", toolCallId: "t1", state: "output-available", input: { title: "Ridurre i tempi" }, output: { success: true } },
      { type: "tool-webSearch", toolCallId: "t2", state: "output-available", input: {}, output: {} },
      { type: "step-start" },
      { type: "reasoning", text: "Preparo i passaggi per entrare nel gestionale del concorrente." },
      // Il passo rifiutato: i suoi tool non partono (in attesa per sempre), o hanno un errore (chiamata non valida).
      { type: "tool-saveActivity", toolCallId: "t3", state: "input-available", input: {} },
      { type: "tool-linkActivityDependency", toolCallId: "t4", state: "output-error", input: {}, errorText: "Invalid input" },
      { type: "text", text: "Ecco come si fa: per prima", state: "done" },
    ],
  };
  assert.deepEqual(assistantView(refusedAfterTools, HIDDEN_TOOLS, { arriving: false }), {
    kind: "refused",
    notice: CHAT_REFUSAL_NOTICE,
    progress: [{ kind: "tool", label: "Obiettivo salvato", done: true }],
  });
});

test("quando arriva il testo della risposta le note se ne vanno; i tool restano, nell'ordine", () => {
  const parts: ChatUIMessage["parts"] = [
    { type: "step-start" },
    { type: "reasoning", text: "Salvo l'attività «Fatture mensili»." },
    { type: "tool-saveActivity", toolCallId: "t1", state: "output-available", input: {}, output: {} },
    { type: "step-start" },
    { type: "reasoning", text: "Ora collego la dipendenza." },
    { type: "tool-linkActivityDependency", toolCallId: "t2", state: "output-available", input: {}, output: {} },
    { type: "step-start" },
  ];
  const reply = (parts: ChatUIMessage["parts"], metadata?: ChatUIMessage["metadata"]): ChatUIMessage => ({ id: "a", role: "assistant", metadata, parts });
  // Prima del testo: le note, ognuna prima del suo tool.
  assert.deepEqual(assistantView(reply(parts), HIDDEN_TOOLS, { arriving: true }).progress, [
    { kind: "note", text: "Salvo l'attività «Fatture mensili»." },
    { kind: "tool", label: "Attività salvata", done: true },
    { kind: "note", text: "Ora collego la dipendenza." },
    { kind: "tool", label: "Passi collegati", done: true },
  ]);
  // Uno spazio non è ancora una risposta.
  assert.equal(assistantView(reply([...parts, { type: "text", text: "\n " }]), HIDDEN_TOOLS, { arriving: true }).progress.length, 4);
  // Con il testo: restano i tool. Lo stesso a risposta finita.
  for (const [metadata, arriving] of [[undefined, true], [{ finishReason: "stop" }, false]] as const) {
    assert.deepEqual(assistantView(reply([...parts, { type: "text", text: "Fatto. Altro?" }], metadata), HIDDEN_TOOLS, { arriving }), {
      kind: "answer",
      text: "Fatto. Altro?",
      progress: [
        { kind: "tool", label: "Attività salvata", done: true },
        { kind: "tool", label: "Passi collegati", done: true },
      ],
    });
  }
});

test("una risposta che non arriva più (interrotta da un errore o dallo stop, o finita senza testo): solo i tool finiti", () => {
  const interrupted: ChatUIMessage = {
    id: "a",
    role: "assistant",
    parts: [
      { type: "step-start" },
      { type: "reasoning", text: "Preparo le fatture." },
      { type: "tool-saveActivity", toolCallId: "t1", state: "output-available", input: {}, output: { success: true } },
      { type: "step-start" },
      { type: "reasoning", text: "Salvo l'attività «Fatture mensili»." },
      { type: "tool-saveActivity", toolCallId: "t2", state: "input-available", input: {} },
    ],
  };
  // Mentre arriva: le note e il tool in corso.
  assert.deepEqual(assistantView(interrupted, HIDDEN_TOOLS, { arriving: true }).progress, [
    { kind: "note", text: "Preparo le fatture." },
    { kind: "tool", label: "Attività salvata", done: true },
    { kind: "note", text: "Salvo l'attività «Fatture mensili»." },
    { kind: "tool", label: "Salvo l'attività", done: false },
  ]);
  // Interrotta: il tool in corso non finirà più e le note non indicano più niente; resta quello che è stato fatto.
  assert.deepEqual(assistantView(interrupted, HIDDEN_TOOLS, { arriving: false }), {
    kind: "answer",
    text: "",
    progress: [{ kind: "tool", label: "Attività salvata", done: true }],
  });
  // Finita al limite dei passi, senza testo: lo stesso.
  assert.deepEqual(assistantView({ ...interrupted, metadata: { finishReason: "tool-calls" }, parts: interrupted.parts.slice(0, 3) }, HIDDEN_TOOLS, { arriving: false }).progress, [
    { kind: "tool", label: "Attività salvata", done: true },
  ]);
});

test("un tool fallito non si mostra come fatto: né con un errore, né con un risultato che dice `success: false`", () => {
  const reply: ChatUIMessage = {
    id: "a",
    role: "assistant",
    metadata: { finishReason: "stop" },
    parts: [
      { type: "step-start" },
      { type: "tool-saveActivity", toolCallId: "t1", state: "output-available", input: {}, output: { success: true } },
      // L'esecuzione ha lanciato (il database), o l'input del modello non rispettava lo schema.
      { type: "tool-saveStrategicGoal", toolCallId: "t2", state: "output-error", input: {}, errorText: "DB down" },
      { type: "tool-linkActivityDependency", toolCallId: "t3", state: "output-error", input: undefined, errorText: "Invalid input" },
      // Il tool ha risposto che non ha salvato.
      { type: "tool-saveCompanyFacts", toolCallId: "t4", state: "output-available", input: {}, output: { success: false, message: "Non salvati." } },
      { type: "step-start" },
      { type: "text", text: "Non sono riuscito a salvare l'obiettivo, riprovo più tardi." },
    ],
  };
  assert.deepEqual(assistantView(reply, HIDDEN_TOOLS, { arriving: false }), {
    kind: "answer",
    text: "Non sono riuscito a salvare l'obiettivo, riprovo più tardi.",
    progress: [{ kind: "tool", label: "Attività salvata", done: true }],
  });
  // Lo stesso mentre la risposta arriva: il tool fallito non resta in corso.
  assert.deepEqual(assistantView({ ...reply, metadata: undefined, parts: reply.parts.slice(0, 5) }, HIDDEN_TOOLS, { arriving: true }).progress, [
    { kind: "tool", label: "Attività salvata", done: true },
  ]);
  assert.equal(toolOutcome({ type: "tool-saveCompanyFacts", state: "output-available", output: { success: false } }), "failed");
  assert.equal(toolOutcome({ type: "tool-saveActivity", state: "output-denied" }), "failed");
  assert.equal(toolOutcome({ type: "tool-saveActivity", state: "output-available", output: { success: true } }), "done");
  assert.equal(toolOutcome({ type: "tool-saveActivity", state: "output-available", output: null }), "done");
  assert.equal(toolOutcome({ type: "tool-saveActivity", state: "input-available" }), "running");
});

test("l'etichetta di un tool: «fatto» con il risultato, «in corso» prima; senza etichetta, il nome o «Elaboro...»", () => {
  assert.deepEqual(toolChip({ type: "tool-saveActivity", state: "output-available" }), { kind: "tool", label: "Attività salvata", done: true });
  // Un tool fallito non si mostra: né «fatto», né in corso per sempre (in AI SDK 6 lo stato è `output-error`).
  assert.equal(toolChip({ type: "tool-saveActivity", state: "output-error" }), null);
  for (const state of ["input-streaming", "input-available"]) {
    assert.deepEqual(toolChip({ type: "tool-saveActivity", state }), { kind: "tool", label: "Salvo l'attività", done: false }, state);
  }
  assert.deepEqual(toolChip({ type: "tool-nuovoTool", state: "output-available" }), { kind: "tool", label: "nuovoTool", done: true });
  assert.deepEqual(toolChip({ type: "tool-nuovoTool", state: "input-available" }), { kind: "tool", label: "Elaboro...", done: false });
});


test("(mappatura board) l'assistente accanto alla board mostra i passi: le etichette dei quattro tool della board, sopra quelle di sempre", () => {
  // §7.5: «Salvo il passo» e «Passo salvato»; il tool che correggeva il tipo di lavoro non c'è più.
  assert.deepEqual(MAPPING_TOOL_LABELS, {
    saveActivity: { active: "Salvo il passo", done: "Passo salvato" },
    updateActivity: { active: "Aggiorno il passo", done: "Passo aggiornato" },
    linkActivityDependency: { active: "Collego i passi", done: "Passi collegati" },
    markDepartmentMapped: { active: "Completo la mappatura", done: "Mappatura completata" },
  });
  assert.equal("updateActivityClassification" in TOOL_LABELS, false);
  const labels = { ...TOOL_LABELS, ...MAPPING_TOOL_LABELS };
  assert.deepEqual(toolChip({ type: "tool-saveActivity", state: "output-available", output: { success: true } }, labels), { kind: "tool", label: "Passo salvato", done: true });
  assert.deepEqual(toolChip({ type: "tool-saveActivity", state: "input-available" }, labels), { kind: "tool", label: "Salvo il passo", done: false });
  // Un tool che le etichette della board non nominano prende quelle di sempre.
  assert.deepEqual(toolChip({ type: "tool-saveStrategicGoal", state: "output-available" }, MAPPING_TOOL_LABELS), { kind: "tool", label: "Obiettivo salvato", done: true });
  const reply: ChatUIMessage = {
    id: "a",
    role: "assistant",
    metadata: { finishReason: "stop" },
    parts: [
      { type: "step-start" },
      { type: "tool-saveActivity", toolCallId: "t1", state: "output-available", input: {}, output: { success: true } },
      { type: "tool-markDepartmentMapped", toolCallId: "t2", state: "output-available", input: {}, output: { success: true } },
      { type: "text", text: "Fatto." },
    ],
  };
  assert.deepEqual(assistantView(reply, HIDDEN_TOOLS, { arriving: false, labels }).progress, [
    { kind: "tool", label: "Passo salvato", done: true },
    { kind: "tool", label: "Mappatura completata", done: true },
  ]);
  // Senza `labels`, la chat generica resta com'era.
  assert.deepEqual(assistantView(reply, HIDDEN_TOOLS, { arriving: false }).progress[0], { kind: "tool", label: "Attività salvata", done: true });
});
