import test from "node:test";
import assert from "node:assert/strict";
import { assertHouseStyle, collectTexts } from "../../../lib/mappatura/text-rules.ts";
import {
  VIEW_TEXT,
  addNoteLabel,
  addStepLabel,
  capitalized,
  discoveryText,
  drawerContext,
  frictionGroupLabel,
  mapCountsLine,
  noteLabel,
  openBoardLabel,
  peopleText,
  processOptionText,
  rolesToolsHint,
  rowFrictionsText,
  stepRefText,
  toClassifyText,
  toValidateText,
  todayTileTexts,
  unitStepsLine,
  unitsLede,
  unitsSectionTitle,
  unitsTileTexts,
  unitsTitle,
} from "./text.ts";

// Le scritte delle viste della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §7.2): lo stile della casa su tutte, le
// forme del singolare, le scritte del piano parola per parola, la parola dell'unità che arriva dal workspace.

const FUNZIONI = { singular: "funzione", plural: "funzioni" };
const REPARTI = { singular: "reparto", plural: "reparti" };

test("ogni scritta delle viste rispetta lo stile della casa: «use case», nessuna chiave interna, maiuscola solo all'inizio", () => {
  const texts = [
    ...collectTexts(VIEW_TEXT),
    ...[FUNZIONI, REPARTI].flatMap((words) => [
      ...Object.values(unitsTitle(words)),
      unitsLede(words),
      unitsSectionTitle(words),
      discoveryText(),
      ...unitsTileTexts({ complete: 1, total: 3, steps: 1, hoursWeek: 1, toValidate: 1 }, words).flatMap((tile) => [tile.value, tile.label]),
      ...unitsTileTexts({ complete: 0, total: 15, steps: 12, hoursWeek: 28.5, toValidate: 4 }, words).flatMap((tile) => [tile.value, tile.label]),
    ]),
    ...todayTileTexts({ steps: 1, processes: 1, hoursWeek: 1, decisions: 1, toValidate: 1 }).flatMap((tile) => [tile.value, tile.label]),
    ...todayTileTexts({ steps: 6, processes: 2, hoursWeek: 28.5, decisions: 3, toValidate: 2 }).flatMap((tile) => [tile.value, tile.label]),
    unitStepsLine(1, 1),
    unitStepsLine(6, 28.5),
    toValidateText(2),
    toClassifyText(1),
    peopleText(1),
    peopleText(6),
    openBoardLabel("magazzino"),
    rolesToolsHint(1, 1),
    rolesToolsHint(4, 7),
    mapCountsLine(2, 1, 1),
    mapCountsLine(2, 4, 5),
    rowFrictionsText(1),
    rowFrictionsText(3),
    addStepLabel("dalla richiesta all'ordine"),
    addNoteLabel("attriti"),
    noteLabel("attività"),
    frictionGroupLabel("Medio"),
    drawerContext("dalla richiesta all'ordine", "A2"),
    stepRefText("A2", "confronto delle offerte"),
    processOptionText("B", "dall'ordine alla consegna"),
  ];
  assert.ok(texts.length > 120, "le scritte ci sono");
  assertHouseStyle(texts);
});

test("le forme del singolare: 1 passo, 1 processo, 1 ruolo, 1 strumento, 1 attrito, 1 confermato, 1 persona", () => {
  assert.deepEqual(
    todayTileTexts({ steps: 1, processes: 1, hoursWeek: 0, decisions: 1, toValidate: 1 }).map((tile) => tile.label),
    ["passo in 1 processo", "ore a settimana", "passo dove decide una persona", "passo da validare"],
  );
  assert.deepEqual(
    todayTileTexts({ steps: 3, processes: 1, hoursWeek: 12.5, decisions: 0, toValidate: 0 }).map((tile) => [tile.value, tile.label]),
    [
      ["3", "passi in 1 processo"],
      ["12,5 h", "ore a settimana"],
      ["0", "passi dove decide una persona"],
      ["0", "passi da validare"],
    ],
  );
  assert.equal(todayTileTexts({ steps: 1, processes: 2, hoursWeek: 0, decisions: 0, toValidate: 0 })[0].label, "passo in 2 processi");
  assert.deepEqual(
    unitsTileTexts({ complete: 1, total: 3, steps: 1, hoursWeek: 6.5, toValidate: 1 }, FUNZIONI).map((tile) => [tile.value, tile.label]),
    [
      ["1 di 3", "funzioni con la mappatura completa"],
      ["1", "passo mappato"],
      ["6,5 h", "ore a settimana"],
      ["1", "passo da validare"],
    ],
  );
  assert.deepEqual(unitsTileTexts({ complete: 0, total: 2, steps: 4, hoursWeek: 0, toValidate: 3 }, REPARTI).map((tile) => tile.label), ["reparti con la mappatura completa", "passi mappati", "ore a settimana", "passi da validare"]);
  assert.equal(unitStepsLine(1, 1), "1 passo · 1 h a settimana");
  assert.equal(unitStepsLine(6, 28.5), "6 passi · 28,5 h a settimana");
  assert.equal(rolesToolsHint(1, 1), "1 ruolo · 1 strumento");
  assert.equal(rolesToolsHint(2, 5), "2 ruoli · 5 strumenti");
  assert.equal(mapCountsLine(1, 1, 1), "1 da validare · 1 confermato · 1 attrito");
  assert.equal(mapCountsLine(2, 4, 5), "2 da validare · 4 confermati · 5 attriti");
  assert.equal(rowFrictionsText(1), "1 attrito");
  assert.equal(rowFrictionsText(3), "3 attriti");
  assert.equal(peopleText(1), "1 persona");
  assert.equal(peopleText(12), "12 persone");
});

test("le scritte del piano, parola per parola; la parola dell'unità viene dal workspace", () => {
  assert.deepEqual(unitsTitle(FUNZIONI), { plain: "Il lavoro di oggi,", accent: "funzione per funzione" });
  assert.equal(unitsLede(REPARTI), "Ogni reparto ha la sua board: i processi, i passi, chi li fa e dove decide una persona.");
  assert.equal(unitsSectionTitle(REPARTI), "Reparti");
  assert.equal(capitalized(""), "");
  // Senza unità la frase non nomina la parola dell'unità: «Le reparti» non si può dire (§7, nessuna concordanza).
  assert.equal(discoveryText(), "La mappatura comincia dalla Discovery. Completa quella fase per aprire le board.");
  assert.equal(openBoardLabel("Magazzino"), "Apri la board di Magazzino");
  assert.equal(toValidateText(4), "4 da validare");
  assert.equal(toClassifyText(1), "1 da classificare");
  assert.equal(addStepLabel("Resi"), "Aggiungi un passo a Resi");
  assert.equal(addNoteLabel("Attriti"), "Aggiungi nota: Attriti");
  assert.equal(noteLabel("Attività"), "Nota: Attività");
  assert.equal(frictionGroupLabel("Forte"), "Attrito: Forte");
  assert.equal(drawerContext("Resi", "B2"), "Resi · B2");
  assert.equal(VIEW_TEXT.map.hint, "clicca un passo per aprire attività, persone, dati, attriti, tempi e volumi");
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
