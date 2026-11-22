import test from "node:test";
import assert from "node:assert/strict";
import { assertHouseStyle, collectTexts } from "../../../lib/mappatura/text-rules.ts";
import { STREAMS } from "../../../lib/mappatura/vocab.ts";
import {
  CLASSIFICATION_TEXT,
  caseRowLabel,
  classifiedText,
  classifyButtonLabel,
  completedClassifiedText,
  onetLine,
  partialText,
  reliabilityText,
  streamTileLabel,
} from "./text.ts";

// (Mappatura board) Le scritte della scheda «Classificazione» e del completamento (docs/mappatura/MAPPATURA-BOARD-PIANO.md
// §7.3): lo stile della casa, «use case», gli stream con la maiuscola, i plurali per uno.

test("ogni scritta della classificazione rispetta lo stile della casa", () => {
  const texts = [
    ...collectTexts(CLASSIFICATION_TEXT),
    ...STREAMS.map((stream) => streamTileLabel(stream, 12.5)),
    classifyButtonLabel(1),
    classifyButtonLabel(3),
    completedClassifiedText(1),
    completedClassifiedText(5),
    classifiedText(0),
    classifiedText(1),
    classifiedText(5),
    partialText(1, 4),
    partialText(3, 5),
    reliabilityText(0.86),
    // I titoli delle occupazioni sono dati (in inglese): qui un valore qualsiasi, conta la frase intorno.
    onetLine("13-1023.00", "titolo"),
    caseRowLabel("UC-0001", "x"),
  ];
  assert.ok(texts.length > 45);
  assertHouseStyle(texts);
});

test("i numeri e i plurali per uno", () => {
  assert.equal(streamTileLabel("automate", 19.5), "Automatizzare · 19,5 h a settimana");
  assert.equal(streamTileLabel("innovate", 4), "Innovare · 4 h a settimana");
  assert.deepEqual([classifyButtonLabel(1), classifyButtonLabel(2)], ["Classifica 1 passo", "Classifica 2 passi"]);
  assert.deepEqual([completedClassifiedText(1), completedClassifiedText(5)], ["Mappatura completata: 1 passo classificato.", "Mappatura completata: 5 passi classificati."]);
  assert.deepEqual([classifiedText(1), classifiedText(5), classifiedText(0)], ["1 passo classificato.", "5 passi classificati.", "Nessun passo da classificare."]);
  assert.deepEqual([partialText(1, 4), partialText(3, 5)], ["Classificato 1 passo su 4. Riprova per gli altri.", "Classificati 3 passi su 5. Riprova per gli altri."]);
  assert.equal(reliabilityText(0.856), "Affidabilità 86%");
  assert.deepEqual([onetLine("13-1023.00", " Purchasing agents "), onetLine("13-1023.00", null)], ["O*NET 13-1023.00 · Purchasing agents", "O*NET 13-1023.00"]);
  assert.equal(caseRowLabel(null, "Richieste in un modulo solo"), "Apri Richieste in un modulo solo");
});
