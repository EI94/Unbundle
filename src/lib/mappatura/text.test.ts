import test from "node:test";
import assert from "node:assert/strict";
import {
  BOARD_TABS,
  BOARD_TEXT,
  FREQUENCY_LABEL,
  FRICTION_LABEL,
  LANE_LABEL,
  MAPPING_COMPLETED_SIGNAL,
  ORIGIN_LABEL,
  ORIGIN_SOURCE,
  STEP_STATUS_LABEL,
  STREAM_LABEL,
  STREAM_LINE,
  UNIT_STATUS_LABEL,
  WORK_TYPE_LABEL,
  counted,
  formatCount,
  formatHours,
  frequencyLabel,
  mappingCompletedSignal,
  noteCaption,
  noteMark,
  pillText,
  exposureBadgeLabel,
  removeChipLabel,
  savedAtLabel,
  votesLabel,
} from "./text.ts";
import { assertHouseStyle, collectTexts, houseStyleFaults } from "./text-rules.ts";
import { FREQUENCIES, FRICTIONS, LANES, MAPPING_LIMITS, NOTE_STATUSES, ORIGINS, STEP_STATUSES, STREAMS, UNIT_STATUSES, WORK_TYPES } from "./vocab.ts";

// Le scritte della cornice della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §7.1, §7.6): lo stile della casa, una
// scritta per ogni parola del vocabolario, i plurali, la data della pillola.

const LABELS = { STREAM_LABEL, STREAM_LINE, UNIT_STATUS_LABEL, WORK_TYPE_LABEL, FREQUENCY_LABEL, FRICTION_LABEL, STEP_STATUS_LABEL, ORIGIN_LABEL, ORIGIN_SOURCE, LANE_LABEL };

test("ogni scritta rispetta lo stile della casa: «use case», nessuna chiave interna, maiuscola solo all'inizio", () => {
  const texts = [
    ...collectTexts(BOARD_TEXT),
    ...collectTexts(LABELS),
    ...ORIGINS.flatMap((origin) => NOTE_STATUSES.flatMap((status) => [noteCaption(status, origin), noteMark(status, origin)])).filter((text): text is string => text !== null),
    pillText("saved", "2026-11-16T09:30:00.000Z"),
    pillText("saved", null),
    pillText("loading", null),
    pillText("dirty", null),
    pillText("saving", null),
    pillText("readonly", null),
    pillText("local", null),
    ...Object.values(mappingCompletedSignal("Ufficio acquisti", 6, 28.5)),
    ...Object.values(mappingCompletedSignal("Magazzino", 1, 1)),
    counted(1, "passo", "passi"),
    counted(3, "passo", "passi"),
    votesLabel(5, 2),
    removeChipLabel("magazzino"),
    exposureBadgeLabel(34),
  ];
  assert.ok(texts.length > 100, "le scritte ci sono");
  assertHouseStyle(texts);
  // Il controllo vede davvero i difetti.
  assert.deepEqual(houseStyleFaults("Salvataggio non riuscito. Riprova con «Salva ora»."), []);
  assert.deepEqual(houseStyleFaults("Passi dove decide una persona"), []);
  assert.deepEqual(houseStyleFaults("AI exposure media"), []);
  for (const bad of ["Collegato a un caso d'uso", "I casi d'uso della wave 1", "Stato: not_started", "Tipo: enrichment", "Stream automate", "Da Validare", "Modifiche  da salvare", " Pronto", "ad_hoc"]) {
    assert.ok(houseStyleFaults(bad).length > 0, bad);
  }
});

test("ogni parola del vocabolario ha la sua scritta, e nessuna scritta è la chiave salvata", () => {
  for (const stream of STREAMS) assert.ok(STREAM_LABEL[stream] && STREAM_LINE[stream], stream);
  for (const status of UNIT_STATUSES) assert.ok(UNIT_STATUS_LABEL[status] && UNIT_STATUS_LABEL[status] !== status, status);
  for (const workType of WORK_TYPES) assert.ok(WORK_TYPE_LABEL[workType] && WORK_TYPE_LABEL[workType] !== workType, workType);
  for (const frequency of FREQUENCIES) assert.ok(FREQUENCY_LABEL[frequency] && frequencyLabel(frequency) !== frequency, frequency);
  for (const friction of FRICTIONS) assert.ok(FRICTION_LABEL[friction], String(friction));
  for (const status of STEP_STATUSES) assert.ok(STEP_STATUS_LABEL[status] && !STEP_STATUS_LABEL[status].includes("_"), status);
  for (const origin of ORIGINS) assert.ok(ORIGIN_LABEL[origin] && ORIGIN_SOURCE[origin], origin);
  for (const lane of LANES) assert.ok(LANE_LABEL[lane] && LANE_LABEL[lane] !== lane, lane);
  assert.deepEqual(Object.keys(LABELS).map((name) => Object.keys(LABELS[name as keyof typeof LABELS]).length), [3, 3, 4, 4, 4, 4, 2, 4, 4, 6]);
  // Le scritte del piano, parola per parola.
  assert.deepEqual(STREAMS.map((stream) => STREAM_LABEL[stream]), ["Automatizzare", "Differenziare", "Innovare"]);
  assert.deepEqual(STREAMS.map((stream) => STREAM_LINE[stream]), ["Non dovrebbe esistere così", "Concentrare l'energia umana", "Valore che prima non esisteva"]);
  assert.deepEqual(UNIT_STATUSES.map((status) => UNIT_STATUS_LABEL[status]), ["Da iniziare", "In corso", "Mappatura completa", "Mappatura completa"]);
  assert.deepEqual(WORK_TYPES.map((workType) => WORK_TYPE_LABEL[workType]), ["Raccolta dati", "Confronto", "Interpretazione", "Consegna"]);
  assert.deepEqual(FREQUENCIES.map((frequency) => FREQUENCY_LABEL[frequency]), ["Ogni giorno", "Ogni settimana", "Ogni mese", "Quando serve"]);
  assert.deepEqual(FRICTIONS.map((friction) => FRICTION_LABEL[friction]), ["Nessuno", "Lieve", "Medio", "Forte"]);
  assert.deepEqual(ORIGINS.map((origin) => ORIGIN_LABEL[origin]), ["Dalla chat", "Dai documenti", "Aggiunto sulla mappa", "Da prima della mappa"]);
  assert.deepEqual([BOARD_TEXT.defaultProcessName, BOARD_TEXT.newProcessName], ["Processo principale", "Nuovo processo"]);
  assert.deepEqual([...BOARD_TABS], ["oggi", "classificazione"]);
  assert.deepEqual(BOARD_TABS.map((tab) => BOARD_TEXT.tabs[tab]), ["Oggi", "Con l'AI"]);
  // Una frequenza scritta a parole da una persona si mostra com'è.
  assert.deepEqual([frequencyLabel("  Giornaliera "), frequencyLabel("ogni lunedì"), frequencyLabel("ad_hoc")], ["Ogni giorno", "ogni lunedì", "Quando serve"]);
});

test("le didascalie delle note: «ipotesi», «da fonti · …», niente per una nota validata", () => {
  assert.deepEqual(ORIGINS.map((origin) => noteCaption("fonte", origin)), ["da fonti · chat", "da fonti · documenti", "da fonti", "da fonti · prima della mappa"]);
  assert.deepEqual([noteCaption("ipotesi", "chat"), noteCaption("ipotesi", "board"), noteCaption("validato", "chat")], ["ipotesi", "ipotesi", null]);
  assert.deepEqual([noteMark("ipotesi", "board"), noteMark("fonte", "chat"), noteMark("fonte", "documenti"), noteMark("fonte", "prima"), noteMark("validato", "documenti")], ["[ipotesi]", "[fonte: chat]", "[fonte: documenti]", "[fonte: prima della mappa]", null]);
  assert.equal(BOARD_TEXT.marks.toValidate, "[da validare]");
});

test("la pillola: «Salvato gg/mm, hh:mm» a Roma, «Pronto» se mai salvata, e gli altri stati", () => {
  // 16/11/2026 09:30 UTC è 10:30 a Roma (ora solare); 16/07/2026 22:30 UTC è 00:30 del 17 a Roma (ora legale).
  assert.equal(savedAtLabel("2026-11-16T09:30:00.000Z"), "16/11, 10:30");
  assert.equal(savedAtLabel("2026-07-16T22:30:00.000Z"), "17/07, 00:30");
  assert.deepEqual([savedAtLabel(null), savedAtLabel(undefined), savedAtLabel(""), savedAtLabel("ieri")], [null, null, null, null]);
  assert.equal(pillText("saved", "2026-11-16T09:30:00.000Z"), "Salvato 16/11, 10:30");
  assert.equal(pillText("saved", null), "Pronto");
  assert.deepEqual(
    (["loading", "dirty", "saving", "readonly", "local"] as const).map((state) => pillText(state, "2026-11-16T09:30:00.000Z")),
    ["Caricamento", "Modifiche da salvare", "Salvataggio…", "Sola lettura", "Modifiche solo su questo dispositivo"],
  );
});

test("i numeri e i plurali: 1 passo, 3 passi; le ore con la virgola; la riga della campanella", () => {
  // In italiano il punto delle migliaia comincia da cinque cifre (1250, 12.500): così lo scrivono il server e il browser.
  assert.deepEqual([counted(0, "passo", "passi"), counted(1, "passo", "passi"), counted(2, "passo", "passi"), counted(12500, "passo", "passi")], ["0 passi", "1 passo", "2 passi", "12.500 passi"]);
  assert.deepEqual([formatHours(0), formatHours(4), formatHours(6.5), formatHours(12.25), formatHours(12345.67), formatHours(Number.NaN)], ["0", "4", "6,5", "12,3", "12.345,7", "0"]);
  assert.deepEqual([formatCount(7), formatCount(1250), formatCount(12500), formatCount(Number.NaN)], ["7", "1250", "12.500", "0"]);
  assert.deepEqual(mappingCompletedSignal("Ufficio acquisti", 6, 28.5), { title: "Mappatura completata: Ufficio acquisti", description: "6 passi, 28,5 ore a settimana." });
  assert.deepEqual(mappingCompletedSignal("Magazzino", 1, 1), { title: "Mappatura completata: Magazzino", description: "1 passo, 1 ora a settimana." });
  assert.equal(mappingCompletedSignal("Magazzino", 0, 0).description, "0 passi, 0 ore a settimana.");
  assert.equal(MAPPING_COMPLETED_SIGNAL, "mapping_completed");
  assert.deepEqual([votesLabel(5, 2), removeChipLabel("Buyer"), exposureBadgeLabel(34.4), exposureBadgeLabel(0)], ["Voti: 5. Tuoi: 2.", "Togli Buyer", "AI 34%", "AI 0%"]);
  assert.deepEqual(BOARD_TEXT.card, { who: "Chi:", toValidate: "da validare", decides: "Decide una persona" });
});

test("i toast dei limiti dicono i numeri di MAPPING_LIMITS", () => {
  const L = MAPPING_LIMITS;
  assert.ok(BOARD_TEXT.toast.limitStepsInProcess.includes(` ${L.stepsPerProcess} `));
  assert.ok(BOARD_TEXT.toast.limitStepsInBoard.includes(` ${L.stepsPerUnit} `));
  assert.ok(BOARD_TEXT.toast.limitProcesses.includes(` ${L.processes} `));
  assert.ok(BOARD_TEXT.toast.limitNotes.includes(` ${L.notesPerLane} `));
  assert.ok(BOARD_TEXT.toast.limitAnalysis.includes(` ${L.analysisPoints} `));
});
