import test from "node:test";
import assert from "node:assert/strict";
import { assertHouseStyle, collectTexts } from "../../../lib/mappatura/text-rules.ts";
import {
  VIEW_TEXT,
  addNoteLabel,
  addStepLabel,
  frictionGroupLabel,
  frictionsChipText,
  noteLabel,
  processOptionText,
  rolesToolsHint,
  rowFrictionsText,
  stepRefText,
  toClassifyText,
  toValidateChipText,
  toValidateText,
  todaySummaryText,
  unitStepsLine,
} from "./text.ts";

// Le scritte delle viste della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §7.2): lo stile della casa su tutte, le
// forme del singolare, le scritte del piano parola per parola, la parola dell'unità che arriva dal workspace.

test("ogni scritta delle viste rispetta lo stile della casa: «use case», nessuna chiave interna, maiuscola solo all'inizio", () => {
  const texts = [
    ...collectTexts(VIEW_TEXT),
    ...Object.values(todaySummaryText({ steps: 1, hoursWeek: 1, decisions: 1 })),
    ...Object.values(todaySummaryText({ steps: 6, hoursWeek: 28.5, decisions: 3 })),
    unitStepsLine(1, 1),
    unitStepsLine(6, 28.5),
    toValidateText(2),
    toClassifyText(1),
    frictionsChipText(1),
    toValidateChipText(5),
    rolesToolsHint(1, 1),
    rolesToolsHint(4, 7),
    rowFrictionsText(1),
    rowFrictionsText(3),
    addStepLabel("dalla richiesta all'ordine"),
    addNoteLabel("attriti"),
    noteLabel("attività"),
    frictionGroupLabel("Medio"),
    stepRefText("A2", "confronto delle offerte"),
    processOptionText("B", "dall'ordine alla consegna"),
  ];
  assert.ok(texts.length > 90, "le scritte ci sono");
  assertHouseStyle(texts);
});

test("le forme del singolare: 1 passo, 1 ruolo, 1 strumento, 1 attrito", () => {
  assert.deepEqual(todaySummaryText({ steps: 1, hoursWeek: 2, decisions: 1 }), { value: "1 passo", label: "2 h a settimana · 1 dove decide una persona" });
  assert.equal(unitStepsLine(1, 1), "1 passo · 1 h a settimana");
  assert.equal(rolesToolsHint(1, 1), "1 ruolo · 1 strumento");
  assert.equal(rowFrictionsText(1), "1 attrito");
  assert.equal(frictionsChipText(1), "1 attrito");
});

test("(rilascio 10, §1 regola 5) lo zero non si vede: il riquadro di «Oggi» e i chip solo con un numero", () => {
  assert.deepEqual(todaySummaryText({ steps: 3, hoursWeek: 0, decisions: 0 }), { value: "3 passi", label: "" });
  assert.deepEqual(todaySummaryText({ steps: 6, hoursWeek: 28.5, decisions: 3 }), { value: "6 passi", label: "28,5 h a settimana · 3 dove decide una persona" });
  assert.equal(unitStepsLine(6, 28.5), "6 passi · 28,5 h a settimana");
  assert.equal(rolesToolsHint(2, 5), "2 ruoli · 5 strumenti");
  assert.equal(rowFrictionsText(3), "3 attriti");
  assert.equal(toValidateChipText(5), "5 da validare");
});

test("le scritte del piano, parola per parola", () => {
  assert.equal(toValidateText(4), "4 da validare");
  assert.equal(toClassifyText(1), "1 da classificare");
  assert.equal(addStepLabel("Resi"), "Aggiungi un passo a Resi");
  assert.equal(addNoteLabel("Attriti"), "Aggiungi nota: Attriti");
  assert.equal(noteLabel("Cosa si fa"), "Nota: Cosa si fa");
  assert.equal(frictionGroupLabel("Forte"), "Attrito: Forte");
  assert.equal(VIEW_TEXT.legend.toValidate, "«da validare» = passo da confermare");
  assert.deepEqual(Object.values(VIEW_TEXT.empty), ["Nessun passo, per ora", "Racconta il lavoro all'assistente, oppure aggiungi il primo passo.", "Inizia con l'assistente", "Aggiungi un passo"]);
  assert.deepEqual(
    [VIEW_TEXT.drawer.confirm, VIEW_TEXT.drawer.unconfirm, VIEW_TEXT.drawer.left, VIEW_TEXT.drawer.right, VIEW_TEXT.drawer.moveTo, VIEW_TEXT.drawer.remove],
    ["Conferma il passo", "Segna da validare", "Sposta a sinistra", "Sposta a destra", "Sposta in", "Elimina il passo"],
  );
  // Nessuna scritta delle viste dice «caso d'uso» o «wave», e nessuna è una chiave salvata.
  for (const text of collectTexts(VIEW_TEXT)) {
    assert.doesNotMatch(text, /cas[oi] d[’']uso|\bwave\b|not_started|da_validare|enrichment/i, text);
  }
});
