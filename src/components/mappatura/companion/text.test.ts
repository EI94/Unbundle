import test from "node:test";
import assert from "node:assert/strict";
import { assertHouseStyle, collectTexts } from "../../../lib/mappatura/text-rules.ts";
import { MAPPING_TOOL_LABELS } from "../../agent/chat-view.ts";
import { COMPANION_TEXT, addStepsLabel, chatErrorText, chosenText, stepsAddedText, waitingText, welcomeText } from "./text.ts";

// (Mappatura board) Le scritte dell'assistente accanto alla board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §7.4, §7.5):
// lo stile della casa, i plurali per uno, l'errore della chat in parole e mai il suo messaggio.

test("ogni scritta dell'assistente rispetta lo stile della casa", () => {
  const texts = [
    ...collectTexts(COMPANION_TEXT),
    ...collectTexts(MAPPING_TOOL_LABELS),
    welcomeText("x", false),
    welcomeText("x", true),
    ...[0, 4, 5, 14, 15, 29, 30, 75].map(waitingText),
    chosenText(3, 5),
    addStepsLabel(1),
    addStepsLabel(4),
    stepsAddedText(1),
    stepsAddedText(4),
  ];
  assert.ok(texts.length > 40);
  assertHouseStyle(texts);
});

test("il benvenuto: il nome dell'unità in grassetto; con i documenti una frase in più", () => {
  assert.equal(welcomeText("Ufficio acquisti", false), "Mappiamo il lavoro di **Ufficio acquisti**. Racconta una settimana tipo: su cosa va più tempo? Salvo ogni passo sulla board mentre parliamo.");
  assert.equal(
    welcomeText(" Ufficio *acquisti* ", true),
    "Mappiamo il lavoro di **Ufficio acquisti**. Racconta una settimana tipo: su cosa va più tempo? Salvo ogni passo sulla board mentre parliamo. Ho già i documenti caricati: li uso per fare domande più precise.",
  );
});

test("l'attesa secondo i secondi, i plurali per uno, le proposte scelte", () => {
  assert.deepEqual([0, 4, 5, 14, 15, 29, 30].map(waitingText), [
    "Sto ragionando…",
    "Sto ragionando…",
    "Elaboro la risposta…",
    "Elaboro la risposta…",
    "Ancora un momento (15 s)…",
    "Ancora un momento (29 s)…",
    "Ci sto mettendo un po' (30 s)…",
  ]);
  assert.deepEqual([addStepsLabel(1), addStepsLabel(3)], ["Aggiungi 1 passo", "Aggiungi 3 passi"]);
  assert.deepEqual([stepsAddedText(1), stepsAddedText(3)], ["1 passo aggiunto: è da validare.", "3 passi aggiunti: sono da validare."]);
  assert.equal(chosenText(2, 5), "2 di 5 scelti");
});

test("l'errore della chat: la rete, la sessione, troppe richieste, altro; mai il messaggio del server", () => {
  const E = COMPANION_TEXT.errors;
  assert.equal(chatErrorText(new TypeError("Failed to fetch")), E.network);
  assert.equal(chatErrorText(new Error("NetworkError when attempting to fetch resource.")), E.network);
  assert.equal(chatErrorText(new Error("Unauthorized")), E.session);
  assert.equal(chatErrorText(new Error("429 Too Many Requests")), E.rate);
  assert.equal(chatErrorText(new Error("Unit not found")), E.other);
  assert.equal(chatErrorText(undefined), E.other);
});
