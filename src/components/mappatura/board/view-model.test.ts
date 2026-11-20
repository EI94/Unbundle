import test from "node:test";
import assert from "node:assert/strict";
import { FIXTURE_IDS, fixtureBoard, fixtureUnits } from "../../../lib/mappatura/board-fixture.ts";
import { allSteps, locateStep, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { applyOps, boardOpSchema, type BoardOp } from "../../../lib/mappatura/board-ops.ts";
import type { OpInput } from "../store/board-client.ts";
import {
  drawerReturnFocus,
  focusAfterRemoval,
  mapFocusSelector,
  analysisShown,
  boardEditable,
  boardEmpty,
  dropBeforeId,
  dropMoveOp,
  frictionOp,
  headlineOp,
  hoursOp,
  laneFull,
  mapCounts,
  moveTargets,
  newProcessOp,
  newStepOps,
  newStepPlace,
  noteAddOp,
  noteTextOps,
  noteTitleOp,
  noteToggleOp,
  pointAddOp,
  processMoveOp,
  processNameOp,
  processOwnerOp,
  statusOp,
  stepCodes,
  stepDimmed,
  stepMoveOp,
  stepTextOp,
  stepValueOp,
  todayTiles,
  unitRow,
  unitsTiles,
  voteOp,
} from "./view-model.ts";

// Quello che le viste calcolano e le operazioni dei loro controlli (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.2, §1.3,
// P38, P52–P58, P65): ogni operazione passa lo schema delle fondamenta, e applicata con il riduttore dà la board attesa.

const I = FIXTURE_IDS;
let seq = 0;
const newId = () => `f0000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
/** Un'operazione dei controlli come la manda lo store: con il suo id, controllata dallo schema. */
const valid = (op: OpInput): BoardOp => {
  const parsed = boardOpSchema.safeParse({ ...op, id: newId() });
  assert.ok(parsed.success, `operazione non valida: ${JSON.stringify(op)}`);
  return parsed.data;
};
const apply = (board: MappingBoard, ...ops: Array<OpInput | null>) => applyOps(board, ops.filter((op): op is OpInput => op !== null).map(valid), { kind: "persona" });
const order = (board: MappingBoard) => board.processes.map((process) => process.steps.map((step) => step.title));

test("i riquadri e i conteggi nascono dalla board: una modifica li cambia tutti insieme (P37, P38, P60)", () => {
  const board = fixtureBoard();
  assert.deepEqual(todayTiles(board), [
    { value: "6", label: "passi in 2 processi" },
    { value: "28,5 h", label: "ore a settimana" },
    { value: "3", label: "passi dove decide una persona" },
    { value: "2", label: "passi da validare" },
  ]);
  // Gli attriti: le note della corsia, o uno per un livello scelto senza note (A1 ne ha due, A2, A4 e B1 uno).
  assert.equal(mapCounts(board), "2 da validare · 4 confermati · 5 attriti");
  // Confermare un passo e togliergli le ore cambia i riquadri e la riga dei conteggi, subito.
  const confronto = locateStep(board, I.confronto)!.step;
  const next = apply(board, statusOp(confronto), hoursOp(confronto, null, 8));
  assert.deepEqual(todayTiles(next).map((tile) => tile.value), ["6", "20,5 h", "3", "1"]);
  assert.equal(mapCounts(next), "1 da validare · 5 confermati · 5 attriti");
});

test("che cosa si vede: modificabile, vuota, i punti di analisi, i passi sfumati", () => {
  assert.equal(boardEditable(fixtureBoard()), true);
  assert.equal(boardEditable(fixtureBoard({ readOnly: true })), false);
  assert.equal(boardEditable({ ...fixtureBoard(), store: "mancante" }), false, "senza la 0039 si legge e basta");
  assert.equal(boardEmpty(fixtureBoard({ empty: true })), true);
  assert.equal(boardEmpty(fixtureBoard()), false);
  // I punti di analisi: quando ce n'è uno, o quando la mappatura è completa.
  assert.equal(analysisShown(fixtureBoard()), true);
  assert.equal(analysisShown({ ...fixtureBoard(), analysis: [] }), false);
  assert.equal(analysisShown({ ...fixtureBoard({ classified: true }), analysis: [] }), true);
  // «Evidenzia attriti» sfuma solo i passi senza attrito.
  const steps = allSteps(fixtureBoard());
  assert.deepEqual(steps.filter((step) => stepDimmed(step, true)).map((step) => step.id), [I.scelta, I.controllo]);
  assert.deepEqual(steps.filter((step) => stepDimmed(step, false)), []);
  assert.equal(laneFull(Array.from({ length: 30 }, () => steps[0].notes.attriti[0]), "attriti"), true);
  assert.equal(laneFull(fixtureBoard().analysis, "analisi"), false);
  assert.equal(laneFull(Array.from({ length: 6 }, () => fixtureBoard().analysis[0]), "analisi"), true);
});

test("il posto di un passo nuovo e i codici dei passi: calcolati dall'ordine, mai salvati", () => {
  const board = fixtureBoard();
  assert.deepEqual(newStepPlace(board, I.processA), { processName: "Dalla richiesta all'ordine", code: "A5" });
  assert.deepEqual(newStepPlace(board, I.processB), { processName: "Dall'ordine alla consegna", code: "B3" });
  assert.deepEqual(newStepPlace(fixtureBoard({ empty: true }), null), { processName: "Processo principale", code: "A1" });
  assert.deepEqual(stepCodes(board).get(I.scelta), { code: "A3", title: "Scelta del fornitore" });
  assert.deepEqual(moveTargets(board, I.confronto), [{ id: I.processB, letter: "B", name: "Dall'ordine alla consegna" }]);
});

test("spostare un passo dal drawer: a sinistra, a destra, in un altro processo (P58, F6)", () => {
  const board = fixtureBoard();
  // A2 a sinistra va prima di A1; a destra va dopo A3.
  assert.deepEqual(stepMoveOp(board, I.confronto, "left"), { t: "step.move", stepId: I.confronto, processId: I.processA, beforeId: I.richieste });
  assert.deepEqual(stepMoveOp(board, I.confronto, "right"), { t: "step.move", stepId: I.confronto, processId: I.processA, beforeId: I.ordine });
  assert.deepEqual(order(apply(board, stepMoveOp(board, I.confronto, "left")))[0], ["Confronto delle offerte", "Raccolta delle richieste", "Scelta del fornitore", "Invio dell'ordine"]);
  assert.deepEqual(order(apply(board, stepMoveOp(board, I.confronto, "right")))[0], ["Raccolta delle richieste", "Scelta del fornitore", "Confronto delle offerte", "Invio dell'ordine"]);
  // Il penultimo a destra va in fondo.
  assert.deepEqual(stepMoveOp(board, I.scelta, "right"), { t: "step.move", stepId: I.scelta, processId: I.processA, beforeId: null });
  // Già in fondo da quella parte: niente.
  assert.equal(stepMoveOp(board, I.richieste, "left"), null);
  assert.equal(stepMoveOp(board, I.ordine, "right"), null);
  // In un altro processo: in fondo; nel suo, o in uno che non c'è: niente.
  assert.deepEqual(stepMoveOp(board, I.confronto, { processId: I.processB }), { t: "step.move", stepId: I.confronto, processId: I.processB, beforeId: null });
  assert.deepEqual(order(apply(board, stepMoveOp(board, I.confronto, { processId: I.processB })))[1], ["Solleciti di consegna", "Controllo della merce", "Confronto delle offerte"]);
  assert.equal(stepMoveOp(board, I.confronto, { processId: I.processA }), null);
  assert.equal(stepMoveOp(board, "00000000-0000-4000-8000-000000000000", "left"), null);
  // Un processo pieno (40 passi) non prende un passo in più.
  const full = { ...board, processes: board.processes.map((process) => (process.id === I.processB ? { ...process, steps: Array.from({ length: 40 }, (_, n) => ({ ...process.steps[0], id: `b${n}` })) } : process)) };
  assert.equal(stepMoveOp(full, I.confronto, { processId: I.processB }), null);
  assert.deepEqual(moveTargets(full, I.confronto), []);
});

test("trascinare un passo per la maniglia: dove cade, e niente quando resta dov'era (P58)", () => {
  const cards = [
    { id: "a", left: 0, width: 100 },
    { id: "b", left: 118, width: 100 },
    { id: "c", left: 236, width: 100 },
  ];
  assert.equal(dropBeforeId(cards, 10, "c"), "a");
  assert.equal(dropBeforeId(cards, 160, "c"), "b");
  assert.equal(dropBeforeId(cards, 200, "c"), null, "oltre la metà dell'ultima che conta: in fondo");
  assert.equal(dropBeforeId(cards, 140, "b"), "c", "la card trascinata non conta");
  assert.equal(dropBeforeId([], 10, "a"), null);

  const board = fixtureBoard();
  // Nella sua riga: prima di A1 è uno spostamento; prima di A3 (cioè dov'è già) no; in fondo sì.
  assert.deepEqual(dropMoveOp(board, I.confronto, I.processA, I.richieste), { t: "step.move", stepId: I.confronto, processId: I.processA, beforeId: I.richieste });
  assert.equal(dropMoveOp(board, I.confronto, I.processA, I.scelta), null);
  assert.equal(dropMoveOp(board, I.confronto, I.processA, I.confronto), null);
  assert.equal(dropMoveOp(board, I.ordine, I.processA, null), null, "l'ultimo lasciato in fondo resta dov'è");
  assert.deepEqual(order(apply(board, dropMoveOp(board, I.richieste, I.processA, null)))[0], ["Confronto delle offerte", "Scelta del fornitore", "Invio dell'ordine", "Raccolta delle richieste"]);
  // In un'altra riga, prima di una sua card.
  const across = dropMoveOp(board, I.ordine, I.processB, I.controllo);
  assert.deepEqual(across, { t: "step.move", stepId: I.ordine, processId: I.processB, beforeId: I.controllo });
  assert.deepEqual(order(apply(board, across)), [
    ["Raccolta delle richieste", "Confronto delle offerte", "Scelta del fornitore"],
    ["Solleciti di consegna", "Invio dell'ordine", "Controllo della merce"],
  ]);
  assert.equal(dropMoveOp(board, I.ordine, "00000000-0000-4000-8000-000000000000", null), null);
});

test("i processi: su, giù, nome, chi lo segue, voti, uno nuovo", () => {
  const board = fixtureBoard();
  assert.equal(processMoveOp(board, I.processA, "up"), null);
  assert.deepEqual(processMoveOp(board, I.processA, "down"), { t: "process.move", processId: I.processA, beforeId: null });
  assert.deepEqual(processMoveOp(board, I.processB, "up"), { t: "process.move", processId: I.processB, beforeId: I.processA });
  assert.equal(processMoveOp(board, I.processB, "down"), null);
  assert.deepEqual(apply(board, processMoveOp(board, I.processB, "up")).processes.map((process) => process.id), [I.processB, I.processA]);
  // Il nome non si svuota; chi lo segue sì.
  assert.equal(processNameOp({ id: I.processA }, "", "Dalla richiesta all'ordine"), null);
  assert.equal(processNameOp({ id: I.processA }, "Dalla richiesta all'ordine", "Dalla richiesta all'ordine"), null);
  assert.deepEqual(processNameOp({ id: I.processA }, "Acquisti", "Dalla richiesta all'ordine"), { t: "process.set", processId: I.processA, field: "name", prev: "Dalla richiesta all'ordine", next: "Acquisti" });
  assert.deepEqual(processOwnerOp({ id: I.processB }, "Buyer", ""), { t: "process.set", processId: I.processB, field: "owner", prev: null, next: "Buyer" });
  assert.deepEqual(processOwnerOp({ id: I.processA }, "", "Responsabile acquisti"), { t: "process.set", processId: I.processA, field: "owner", prev: "Responsabile acquisti", next: null });
  assert.equal(processOwnerOp({ id: I.processB }, " ", ""), null);
  // I voti: i miei, mai sotto zero né oltre 99; lo stesso valore non manda niente.
  assert.deepEqual(voteOp({ id: I.processA, myVotes: 1 }, 2), { t: "process.vote", processId: I.processA, mine: 2 });
  assert.equal(voteOp({ id: I.processA, myVotes: 0 }, -1), null);
  assert.deepEqual(voteOp({ id: I.processA, myVotes: 98 }, 120), { t: "process.vote", processId: I.processA, mine: 99 });
  assert.equal(apply(board, voteOp(board.processes[0], 2)).processes[0].votes, 4, "il totale è la somma: 3 − 1 (i miei di prima) + 2");
  const id = newId();
  assert.deepEqual(newProcessOp(id), { t: "process.add", processId: id, name: "Nuovo processo" });
  assert.deepEqual(apply(board, newProcessOp(id)).processes.map((process) => process.name), ["Dalla richiesta all'ordine", "Dall'ordine alla consegna", "Nuovo processo"]);
});

test("un passo nuovo nasce dal suo titolo: senza titolo niente; in un'unità vuota nasce anche il primo processo (P53, P55)", () => {
  assert.equal(newStepOps(I.processA, "", newId), null);
  assert.equal(newStepOps(I.processA, "   ", newId), null);
  const added = newStepOps(I.processB, "  Archivio delle bolle ", newId)!;
  assert.deepEqual(added.ops, [{ t: "step.add", stepId: added.stepId, processId: I.processB, title: "Archivio delle bolle" }]);
  const board = apply(fixtureBoard(), ...added.ops);
  assert.deepEqual(locateStep(board, added.stepId)?.code, "B3");
  assert.equal(locateStep(board, added.stepId)?.step.status, "confermato", "quello che una persona scrive sulla board nasce confermato");
  // Un'unità senza processi: «Processo principale» e il passo, insieme.
  const empty = newStepOps(null, "Raccolta delle richieste", newId)!;
  assert.deepEqual(empty.ops, [
    { t: "process.add", processId: empty.processId, name: "Processo principale" },
    { t: "step.add", stepId: empty.stepId, processId: empty.processId, title: "Raccolta delle richieste" },
  ]);
  assert.deepEqual(order(apply(fixtureBoard({ empty: true }), ...empty.ops)), [["Raccolta delle richieste"]]);
});

test("i campi di un passo: il valore che la persona ha visto e quello nuovo, mai una modifica che non cambia niente", () => {
  const board = fixtureBoard();
  const richieste = locateStep(board, I.richieste)!.step;
  const ordine = locateStep(board, I.ordine)!.step;
  // Un campo vuoto è null, come lo legge il server; il titolo non si svuota.
  assert.deepEqual(stepTextOp(ordine, "description", "Si manda l'ordine al fornitore.", ""), { t: "step.set", stepId: I.ordine, field: "description", prev: null, next: "Si manda l'ordine al fornitore." });
  assert.deepEqual(stepTextOp(richieste, "exception", "", "Se manca il centro di costo, la richiesta torna indietro."), { t: "step.set", stepId: I.richieste, field: "exception", prev: "Se manca il centro di costo, la richiesta torna indietro.", next: null });
  assert.equal(stepTextOp(ordine, "input", "", ""), null);
  assert.equal(stepTextOp(richieste, "title", "", "Raccolta delle richieste"), null);
  assert.deepEqual(stepTextOp(richieste, "title", "Raccolta richieste", "Raccolta delle richieste"), { t: "step.set", stepId: I.richieste, field: "title", prev: "Raccolta delle richieste", next: "Raccolta richieste" });
  // Ruoli e strumenti, frequenza e tipo di lavoro: il valore a schermo come prev.
  assert.deepEqual(stepValueOp(richieste, "who", ["Buyer", "Segreteria"]), { t: "step.set", stepId: I.richieste, field: "who", prev: ["Buyer"], next: ["Buyer", "Segreteria"] });
  assert.equal(stepValueOp(richieste, "who", ["Buyer"]), null);
  assert.deepEqual(stepValueOp(richieste, "frequency", ""), { t: "step.set", stepId: I.richieste, field: "frequency", prev: "giornaliera", next: null });
  assert.deepEqual(stepValueOp(ordine, "workType", "detection"), { t: "step.set", stepId: I.ordine, field: "workType", prev: "delivery", next: "detection" });
  assert.deepEqual(hoursOp(ordine, 2.5, 2), { t: "step.set", stepId: I.ordine, field: "hoursWeek", prev: 2, next: 2.5 });
  assert.equal(hoursOp(ordine, 2, 2), null);
  // Lo stato: confermare e tornare da validare.
  const confronto = locateStep(board, I.confronto)!.step;
  assert.deepEqual(statusOp(confronto), { t: "step.set", stepId: I.confronto, field: "status", prev: "da_validare", next: "confermato" });
  assert.deepEqual(statusOp(ordine), { t: "step.set", stepId: I.ordine, field: "status", prev: "confermato", next: "da_validare" });
  // L'attrito: un livello scelto, o uno mostrato (2 perché c'è un attrito scritto) che diventa una scelta.
  assert.deepEqual(frictionOp(confronto, 2), { t: "step.set", stepId: I.confronto, field: "friction", prev: null, next: 2 });
  assert.equal(frictionOp(richieste, 3), null);
  assert.deepEqual(frictionOp(richieste, 0), { t: "step.set", stepId: I.richieste, field: "friction", prev: 3, next: 0 });
  // Ogni operazione passa lo schema e il riduttore la applica.
  const next = apply(board, stepTextOp(ordine, "description", "Si manda l'ordine al fornitore.", ""), stepValueOp(richieste, "who", ["Buyer", "Segreteria"]), frictionOp(confronto, 3));
  assert.equal(locateStep(next, I.ordine)?.step.description, "Si manda l'ordine al fornitore.");
  assert.deepEqual(locateStep(next, I.richieste)?.step.who, ["Buyer", "Segreteria"]);
  assert.equal(locateStep(next, I.confronto)?.step.friction, 3);
});

test("le note e i punti di analisi: nascono validati, vuoti spariscono, la spunta torna a «ipotesi» o «da fonti» (P52–P56)", () => {
  const board = fixtureBoard();
  const richieste = locateStep(board, I.richieste)!.step;
  assert.equal(noteAddOp(I.richieste, "attriti", "  ", newId), null);
  const added = apply(board, noteAddOp(I.richieste, "attriti", "Moduli diversi per ufficio", newId));
  const note = locateStep(added, I.richieste)!.step.notes.attriti.at(-1)!;
  assert.deepEqual([note.text, note.status, note.origin], ["Moduli diversi per ufficio", "validato", "board"]);
  // Il testo: cambiato, uguale, vuoto (la nota sparisce).
  const first = richieste.notes.attivita[0];
  assert.deepEqual(noteTextOps(first, "Si apre la casella", first.text), [{ t: "note.set", noteId: first.id, field: "text", prev: first.text, next: "Si apre la casella" }]);
  assert.deepEqual(noteTextOps(first, first.text, first.text), []);
  assert.deepEqual(noteTextOps(first, "", first.text), [{ t: "note.remove", noteId: first.id }]);
  assert.equal(locateStep(apply(board, ...noteTextOps(first, "", first.text)), I.richieste)?.step.notes.attivita.length, 1);
  // La spunta: una nota della chat torna «da fonti», una scritta sulla board torna «ipotesi».
  const fromChat = richieste.notes.attriti[1];
  assert.deepEqual(noteToggleOp(fromChat), { t: "note.set", noteId: fromChat.id, field: "status", prev: "fonte", next: "validato" });
  assert.deepEqual(noteToggleOp({ ...fromChat, status: "validato" }), { t: "note.set", noteId: fromChat.id, field: "status", prev: "validato", next: "fonte" });
  assert.deepEqual(noteToggleOp(first), { t: "note.set", noteId: first.id, field: "status", prev: "validato", next: "ipotesi" });
  // I punti di analisi: senza testo non nascono; il titolo si toglie lasciando il punto.
  assert.equal(pointAddOp("Titolo", "", newId), null);
  const point = apply(board, pointAddOp("", "Le offerte arrivano tardi.", newId)).analysis.at(-1)!;
  assert.deepEqual([point.title, point.text, point.lane], [null, "Le offerte arrivano tardi.", "analisi"]);
  const [titled] = board.analysis;
  assert.deepEqual(noteTitleOp(titled, "", "Il tempo va nei solleciti"), { t: "note.set", noteId: titled.id, field: "title", prev: "Il tempo va nei solleciti", next: null });
  assert.equal(noteTitleOp(titled, "Il tempo va nei solleciti", "Il tempo va nei solleciti"), null);
  // La scoperta: scritta, cambiata, tolta.
  assert.deepEqual(headlineOp("Il tempo va nei solleciti.", ""), { t: "board.set", field: "headline", prev: null, next: "Il tempo va nei solleciti." });
  assert.deepEqual(headlineOp("", "Il tempo va nei solleciti."), { t: "board.set", field: "headline", prev: "Il tempo va nei solleciti.", next: null });
  assert.equal(headlineOp("", ""), null);
  assert.equal(apply(board, headlineOp("Il tempo va nei solleciti.", "")).headline, "Il tempo va nei solleciti.");
});

test("le righe delle unità: lo stato mostrato, i conteggi, quello che resta da fare, gli stream dopo la classificazione", () => {
  const [acquisti, magazzino, amministrazione] = fixtureUnits();
  assert.deepEqual(unitRow(acquisti), {
    status: "mapped",
    tone: "ok",
    steps: "6 passi · 28,5 h a settimana",
    todo: ["2 da validare", "1 da classificare"],
    streams: [
      { stream: "automate", count: 3 },
      { stream: "differentiate", count: 1 },
      { stream: "innovate", count: 1 },
    ],
  });
  // In corso: «da classificare» non si dice finché la mappatura non è completa; niente stream.
  assert.deepEqual(unitRow(magazzino), { status: "in_progress", tone: "wait", steps: "4 passi · 31 h a settimana", todo: ["4 da validare"], streams: null });
  assert.deepEqual(unitRow(amministrazione), { status: "not_started", tone: "neutral", steps: "0 passi · 0 h a settimana", todo: [], streams: null });
  // Un'unità con passi è «In corso» da sola, anche se nessuno l'ha segnata.
  assert.equal(unitRow({ ...amministrazione, steps: 2, hoursWeek: 3 }).status, "in_progress");
  assert.deepEqual(unitsTiles(fixtureUnits(), { singular: "funzione", plural: "funzioni" }), [
    { value: "1 di 3", label: "funzioni con la mappatura completa" },
    { value: "10", label: "passi mappati" },
    { value: "59,5 h", label: "ore a settimana" },
    { value: "6", label: "passi da validare" },
  ]);
});

test("dopo «Elimina il passo» il fuoco va alla card prima nella riga, o a quella dopo, o a «+ passo» della riga vuota (F1)", () => {
  const board = fixtureBoard();
  const [first, second] = board.processes[0].steps;
  const last = board.processes[0].steps.at(-1)!;
  // Nel mezzo e in fondo: la card prima; in testa: quella dopo.
  assert.deepEqual(focusAfterRemoval(board, second.id), { kind: "step", stepId: first.id });
  assert.deepEqual(focusAfterRemoval(board, last.id), { kind: "step", stepId: board.processes[0].steps.at(-2)!.id });
  assert.deepEqual(focusAfterRemoval(board, first.id), { kind: "step", stepId: second.id });
  // L'unico passo della riga: «+ passo» di quella riga. Un passo che non c'è: niente.
  const alone = { ...board, processes: [{ ...board.processes[1], steps: board.processes[1].steps.slice(0, 1) }] };
  assert.deepEqual(focusAfterRemoval(alone, alone.processes[0].steps[0].id), { kind: "add", processId: alone.processes[0].id });
  assert.equal(focusAfterRemoval(board, "f0f0f0f0-0000-4000-8000-000000000999"), null);
  assert.equal(mapFocusSelector({ kind: "step", stepId: first.id }), `[data-b="step"][data-step-id="${first.id}"]`);
  assert.equal(mapFocusSelector({ kind: "add", processId: I.processB }), `[data-add-step="${I.processB}"]`);
});

test("alla chiusura del drawer: il posto deciso, chi l'ha aperto se c'è ancora, la card del passo o la vista; mai la pagina", () => {
  const found = new Map<string, { name: string }>([
    [`[data-b="step"][data-step-id="${I.richieste}"]`, { name: "card A1" }],
    [`[data-add-step="${I.processB}"]`, { name: "+ passo B" }],
  ]);
  const view = { name: "vista", querySelector: (selector: string) => found.get(selector) ?? null };
  const gone = { isConnected: false };
  const there = { isConnected: true };
  // Dopo «Elimina il passo»: il posto deciso; se non si trova, la vista.
  assert.equal(drawerReturnFocus({ view, planned: { kind: "step", stepId: I.richieste }, opener: gone, stepId: null })?.name, "card A1");
  assert.equal(drawerReturnFocus({ view, planned: { kind: "add", processId: I.processB }, opener: gone, stepId: null })?.name, "+ passo B");
  assert.equal(drawerReturnFocus({ view, planned: { kind: "step", stepId: I.scelta }, opener: gone, stepId: null })?.name, "vista");
  // Chi l'ha aperto c'è ancora: lo rimette il dialogo (null).
  assert.equal(drawerReturnFocus({ view, planned: null, opener: there, stepId: I.richieste }), null);
  // Non c'è più (il blocco dell'unità vuota, sparito con il primo passo): la card del passo del drawer, o la vista.
  assert.equal(drawerReturnFocus({ view, planned: null, opener: gone, stepId: I.richieste })?.name, "card A1");
  assert.equal(drawerReturnFocus({ view, planned: null, opener: null, stepId: null })?.name, "vista");
});

test("(rilascio 10, §3.7) i Processi: il passo (l'unità in corso, poi la prima da iniziare, poi un'unità nuova), il numero e le righe senza zeri", async () => {
  const { processesStep, processesNumber, unitDotTone, unitFactLine } = await import("./view-model.ts");
  const [acquisti, magazzino, amministrazione] = fixtureUnits();
  // In corso vince; poi la prima da iniziare; tutte complete o nessuna: un'unità nuova.
  assert.deepEqual(processesStep([acquisti, amministrazione, magazzino]), { kind: "continue", unit: magazzino });
  assert.deepEqual(processesStep([acquisti, amministrazione]), { kind: "start", unit: amministrazione });
  assert.deepEqual(processesStep([acquisti]), { kind: "add" });
  assert.deepEqual(processesStep([]), { kind: "add" });
  // Un'unità «da iniziare» con dei passi è in corso, come mostra la sua riga.
  assert.deepEqual(processesStep([acquisti, { ...amministrazione, steps: 2 }]), { kind: "continue", unit: { ...amministrazione, steps: 2 } });
  // Il numero grande: «1 di 3»; niente senza unità.
  assert.equal(processesNumber(fixtureUnits()), "1 di 3");
  assert.equal(processesNumber([]), null);
  // Il puntino dello stato, nel semaforo dell'app.
  assert.deepEqual(["not_started", "in_progress", "mapped", "validated"].map((s) => unitDotTone(s as never)), ["grigio", "blu", "verde", "verde"]);
  // La riga: passi, ore e quello che resta da fare; niente a zero.
  assert.equal(unitFactLine(acquisti), "6 passi · 28,5 h a settimana · 2 da validare · 1 da classificare");
  assert.equal(unitFactLine(magazzino), "4 passi · 31 h a settimana · 4 da validare");
  assert.equal(unitFactLine(amministrazione), null);
  assert.equal(unitFactLine({ ...amministrazione, steps: 1, hoursWeek: 0 }), "1 passo");
});
