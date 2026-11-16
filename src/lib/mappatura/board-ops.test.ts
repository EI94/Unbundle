import test from "node:test";
import assert from "node:assert/strict";
import { allSteps, locateStep, type MappingBoard } from "./board-model.ts";
import {
  ACTOR_DEFAULTS,
  REVIEWER_ONLY_OPS,
  applyOps,
  boardOpSchema,
  coalesce,
  cutLine,
  cutList,
  cutProse,
  newStep,
  opsForNewStep,
  opsForStepPatch,
  saveInputSchema,
  splitNoteText,
  stepFieldValue,
  type BoardOp,
} from "./board-ops.ts";
import { FIXTURE_IDS, fixtureBoard } from "./board-fixture.ts";
import { MAPPING_LIMITS } from "./vocab.ts";

// Le operazioni della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.3): lo schema che le controlla e le rifinisce,
// il riduttore che il browser usa per mostrare subito una modifica, l'unione delle modifiche dello stesso campo, e le
// operazioni che scrivono un passo raccolto dall'assistente o dai documenti.

const I = FIXTURE_IDS;
let seq = 0;
const id = () => `f0f0f0f0-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
const op = <T extends Omit<BoardOp, "id">>(body: T) => ({ id: id(), ...body }) as BoardOp;
const person = { kind: "persona" as const };
const parse = (value: unknown) => boardOpSchema.safeParse(value);
const stepOf = (board: MappingBoard, stepId: string) => locateStep(board, stepId)!.step;

test("lo schema accetta ogni tipo di operazione e la rifinisce: testi senza spazi ai bordi, liste senza doppioni, id in minuscolo", () => {
  const samples: BoardOp[] = [
    op({ t: "process.add", processId: id(), name: "Resi" }),
    op({ t: "process.add", processId: id(), name: "Resi", beforeId: I.processA }),
    op({ t: "process.set", processId: I.processA, field: "name", prev: "Prima", next: "Dopo" }),
    op({ t: "process.set", processId: I.processA, field: "owner", prev: null, next: null }),
    op({ t: "process.move", processId: I.processA, beforeId: null }),
    op({ t: "process.remove", processId: I.processA }),
    op({ t: "process.vote", processId: I.processA, mine: 0 }),
    op({ t: "step.add", stepId: id(), processId: I.processA, title: "Un passo" }),
    op({ t: "step.add", stepId: id(), processId: I.processA, title: "Un passo", afterId: I.richieste }),
    op({ t: "step.set", stepId: I.richieste, field: "hoursWeek", prev: 6.5, next: null }),
    op({ t: "step.move", stepId: I.richieste, processId: I.processB, beforeId: I.solleciti }),
    op({ t: "step.remove", stepId: I.richieste }),
    op({ t: "step.stream", stepId: I.richieste, prev: null, next: "automate" }),
    op({ t: "streams.reset" }),
    op({ t: "note.add", noteId: id(), stepId: I.richieste, lane: "idee", text: "Un'idea" }),
    op({ t: "note.add", noteId: id(), stepId: null, lane: "analisi", title: "Un titolo", text: "Un punto" }),
    op({ t: "note.set", noteId: id(), field: "status", prev: "fonte", next: "validato" }),
    op({ t: "note.remove", noteId: id() }),
    op({ t: "board.set", field: "headline", prev: null, next: "Una frase" }),
  ];
  for (const sample of samples) assert.ok(parse(sample).success, JSON.stringify(sample));
  assert.deepEqual(new Set(samples.map((sample) => sample.t)).size, 15, "tutti e quindici i tipi");

  const refined = parse({ id: id().toUpperCase(), t: "step.set", stepId: I.richieste.toUpperCase(), field: "title", prev: "x", next: "  Raccolta \n delle   richieste " });
  assert.ok(refined.success);
  assert.deepEqual([refined.data.id, (refined.data as { stepId: string }).stepId, (refined.data as { next: string }).next], [refined.data.id.toLowerCase(), I.richieste, "Raccolta delle richieste"]);
  const next = (value: unknown) => {
    const parsed = parse(value);
    assert.ok(parsed.success, JSON.stringify(value));
    return (parsed.data as { next: unknown }).next;
  };
  const set = (field: string, value: unknown, prev: unknown = null) => ({ id: id(), t: "step.set", stepId: I.richieste, field, prev, next: value });
  // Un testo su più righe tiene gli a capo; vuoto diventa null.
  assert.equal(next(set("description", "  Prima riga.  \r\n\r\n\r\n\r\nSeconda riga.  ")), "Prima riga.\n\nSeconda riga.");
  assert.equal(next(set("description", "   ")), null);
  assert.equal(next(set("frequency", "  ogni   lunedì ")), "ogni lunedì");
  assert.equal(next(set("decisionLabel", " \n ")), null);
  // Le liste: rifinite, senza vuoti, senza doppioni a meno di maiuscole.
  assert.deepEqual(next(set("who", [" Buyer ", "buyer", "", "Ufficio  tecnico"], [])), ["Buyer", "Ufficio tecnico"]);
  assert.deepEqual(next(set("tools", [], [])), []);
  assert.equal(next(set("hoursWeek", 2.456)), 2.46);
  // Gli id che PostgreSQL calcola con md5 (non sono UUID di versione 4) valgono lo stesso.
  assert.ok(parse(op({ t: "note.remove", noteId: "d41d8cd9-8f00-b204-e980-0998ecf8427e" })).success);
});

test("lo schema rifiuta id sbagliati, testi troppo lunghi, valori fuori vocabolario, campi in più", () => {
  const L = MAPPING_LIMITS;
  const set = (field: string, value: unknown, prev: unknown = null) => ({ id: id(), t: "step.set", stepId: I.richieste, field, prev, next: value });
  const bad: unknown[] = [
    null,
    "step.remove",
    { t: "step.remove", stepId: I.richieste },
    { id: "1", t: "step.remove", stepId: I.richieste },
    { id: id(), t: "step.remove", stepId: "non-un-id" },
    { id: id(), t: "step.remove", stepId: `${I.richieste}'; DROP TABLE activities; --` },
    { id: id(), t: "step.remove", stepId: I.richieste, extra: 1 },
    { id: id(), t: "step.delete", stepId: I.richieste },
    set("title", ""),
    set("title", "   "),
    set("title", null),
    set("title", "a".repeat(L.title + 1)),
    set("description", "a".repeat(L.description + 1)),
    set("input", "a".repeat(L.io + 1)),
    set("decision", "a".repeat(L.decision + 1)),
    set("decisionLabel", "a".repeat(L.decisionLabel + 1)),
    set("exception", "a".repeat(L.exception + 1)),
    set("frequency", "a".repeat(101)),
    set("quality", "a".repeat(101)),
    set("who", Array.from({ length: L.who + 1 }, (_, i) => `Ruolo ${i}`), []),
    set("who", ["a".repeat(L.whoItem + 1)], []),
    set("who", "Buyer", []),
    set("tools", Array.from({ length: L.tools + 1 }, (_, i) => `Strumento ${i}`), []),
    set("tools", ["a".repeat(L.toolItem + 1)], []),
    set("tools", ["E-mail"], null),
    set("hoursWeek", -1),
    set("hoursWeek", L.hoursWeek + 1),
    set("hoursWeek", "3"),
    set("hoursWeek", Number.NaN),
    set("hoursWeek", 3, "tre"),
    set("workType", "altro"),
    set("friction", 4),
    set("friction", 1.5),
    set("friction", 2, 7),
    set("status", "validato", "da_validare"),
    set("status", null, "da_validare"),
    set("stream", "automate"),
    set("classification", "automate"),
    { id: id(), t: "process.add", processId: id(), name: "" },
    { id: id(), t: "process.add", processId: id(), name: "a".repeat(L.processName + 1) },
    { id: id(), t: "process.set", processId: id(), field: "name", prev: "x", next: null },
    { id: id(), t: "process.set", processId: id(), field: "owner", prev: null, next: "a".repeat(L.owner + 1) },
    { id: id(), t: "process.set", processId: id(), field: "position", prev: 1, next: 2 },
    { id: id(), t: "process.vote", processId: id(), mine: -1 },
    { id: id(), t: "process.vote", processId: id(), mine: L.votes + 1 },
    { id: id(), t: "process.vote", processId: id(), mine: 1.5 },
    { id: id(), t: "process.move", processId: id() },
    { id: id(), t: "step.add", stepId: id(), processId: id(), title: "Un passo", beforeId: id(), afterId: id() },
    { id: id(), t: "step.stream", stepId: id(), prev: null, next: "automatable" },
    { id: id(), t: "streams.reset", stepId: id() },
    { id: id(), t: "note.add", noteId: id(), stepId: id(), lane: "analisi", text: "Un punto con un passo" },
    { id: id(), t: "note.add", noteId: id(), stepId: null, lane: "attriti", text: "Una nota senza passo" },
    { id: id(), t: "note.add", noteId: id(), stepId: id(), lane: "attriti", title: "Titolo", text: "Una nota di un passo con un titolo" },
    { id: id(), t: "note.add", noteId: id(), stepId: id(), lane: "persone", text: "Una corsia che non c'è" },
    { id: id(), t: "note.add", noteId: id(), stepId: id(), lane: "attriti", text: "  " },
    { id: id(), t: "note.add", noteId: id(), stepId: id(), lane: "attriti", text: "a".repeat(L.note + 1) },
    { id: id(), t: "note.add", noteId: id(), stepId: null, lane: "analisi", title: "a".repeat(L.noteTitle + 1), text: "Un punto" },
    { id: id(), t: "note.set", noteId: id(), field: "text", prev: "x", next: "" },
    { id: id(), t: "note.set", noteId: id(), field: "status", prev: "fonte", next: "confermato" },
    { id: id(), t: "note.set", noteId: id(), field: "lane", prev: "attriti", next: "dati" },
    { id: id(), t: "board.set", field: "headline", prev: null, next: "a".repeat(L.headline + 1) },
    { id: id(), t: "board.set", field: "revision", prev: 1, next: 2 },
  ];
  for (const item of bad) assert.equal(parse(item).success, false, JSON.stringify(item)?.slice(0, 120));
});

test("un salvataggio: al più 200 operazioni, una revisione di partenza che sia un numero", () => {
  const vote = () => op({ t: "process.vote", processId: I.processA, mine: 1 });
  assert.ok(saveInputSchema.safeParse({ baseRevision: 0, ops: [] }).success);
  assert.ok(saveInputSchema.safeParse({ baseRevision: 12, ops: Array.from({ length: MAPPING_LIMITS.opsPerSave }, vote) }).success);
  assert.equal(saveInputSchema.safeParse({ baseRevision: 12, ops: Array.from({ length: MAPPING_LIMITS.opsPerSave + 1 }, vote) }).success, false);
  for (const input of [{ ops: [] }, { baseRevision: -1, ops: [] }, { baseRevision: 1.5, ops: [] }, { baseRevision: "3", ops: [] }, { baseRevision: 0 }, { baseRevision: 0, ops: [vote()], altro: 1 }, { baseRevision: 0, ops: [{ t: "streams.reset" }] }]) {
    assert.equal(saveInputSchema.safeParse(input).success, false, JSON.stringify(input));
  }
  // Le operazioni escono rifinite anche dentro un salvataggio.
  const parsed = saveInputSchema.parse({ baseRevision: 0, ops: [op({ t: "process.add", processId: id(), name: "  Resi  " })] });
  assert.equal((parsed.ops[0] as { name: string }).name, "Resi");
  assert.deepEqual([...REVIEWER_ONLY_OPS], ["step.stream", "streams.reset"]);
});

test("applyOps, i processi: aggiungere in fondo o prima di un altro, rinominare, spostare, votare, eliminare solo se vuoti", () => {
  const board = fixtureBoard();
  const P = id();
  let next = applyOps(board, [op({ t: "process.add", processId: P, name: "Resi", beforeId: I.processB })], person);
  assert.deepEqual(next.processes.map((process) => process.id), [I.processA, P, I.processB]);
  assert.deepEqual(next.processes[1], { id: P, name: "Resi", owner: null, votes: 0, myVotes: 0, steps: [] });
  assert.equal(board.processes.length, 2, "la board di partenza non cambia");
  // Lo stesso id due volte: uno solo. Prima di un processo che non c'è: in fondo.
  assert.equal(applyOps(next, [op({ t: "process.add", processId: P, name: "Altro" })], person), next);
  assert.equal(applyOps(next, [op({ t: "process.add", processId: id(), name: "In fondo", beforeId: id() })], person).processes.at(-1)?.name, "In fondo");

  next = applyOps(next, [op({ t: "process.set", processId: P, field: "name", prev: "Resi", next: "Resi al fornitore" }), op({ t: "process.set", processId: P, field: "owner", prev: null, next: "Magazzino" })], person);
  assert.deepEqual([next.processes[1].name, next.processes[1].owner], ["Resi al fornitore", "Magazzino"]);
  assert.equal(applyOps(next, [op({ t: "process.set", processId: P, field: "owner", prev: "Magazzino", next: null })], person).processes[1].owner, null);

  assert.deepEqual(applyOps(next, [op({ t: "process.move", processId: P, beforeId: I.processA })], person).processes.map((process) => process.id), [P, I.processA, I.processB]);
  assert.deepEqual(applyOps(next, [op({ t: "process.move", processId: I.processA, beforeId: null })], person).processes.map((process) => process.id), [P, I.processB, I.processA]);
  assert.equal(applyOps(next, [op({ t: "process.move", processId: P, beforeId: P })], person), next, "prima di sé stesso: resta dov'è");

  // I voti: i miei sono assoluti, il totale segue.
  const voted = applyOps(next, [op({ t: "process.vote", processId: I.processA, mine: 4 })], person);
  assert.deepEqual([voted.processes[0].votes, voted.processes[0].myVotes], [6, 4]);
  assert.deepEqual([applyOps(voted, [op({ t: "process.vote", processId: I.processA, mine: 0 })], person).processes[0].votes], [2]);

  // Un processo con dei passi non si elimina; uno vuoto sì.
  assert.equal(applyOps(next, [op({ t: "process.remove", processId: I.processA })], person), next);
  assert.deepEqual(applyOps(next, [op({ t: "process.remove", processId: P })], person).processes.map((process) => process.id), [I.processA, I.processB]);
});

test("applyOps, i passi: aggiungere (in fondo, prima, subito dopo), cambiare ogni campo, spostare, eliminare", () => {
  const board = fixtureBoard();
  const [S, T, U] = [id(), id(), id()];
  const next = applyOps(
    board,
    [
      op({ t: "step.add", stepId: S, processId: I.processB, title: "Archivio della bolla" }),
      op({ t: "step.add", stepId: T, processId: I.processA, title: "Verifica del budget", beforeId: I.confronto }),
      op({ t: "step.add", stepId: U, processId: I.processA, title: "Firma dell'ordine", afterId: I.scelta }),
    ],
    person,
  );
  assert.deepEqual(next.processes[0].steps.map((step) => step.id), [I.richieste, T, I.confronto, I.scelta, U, I.ordine]);
  assert.deepEqual(next.processes[1].steps.map((step) => step.id), [I.solleciti, I.controllo, S]);
  // Un passo nuovo è quello che `step.add` lascia nel database: il titolo e nient'altro; di una persona nasce confermato.
  assert.deepEqual(stepOf(next, S), newStep(S, "Archivio della bolla", person));
  assert.deepEqual([stepOf(next, S).status, stepOf(next, S).origin], ["confermato", "board"]);
  assert.deepEqual([newStep(S, "x", { kind: "assistente" }).status, newStep(S, "x", { kind: "assistente" }).origin], ["da_validare", "chat"]);
  assert.deepEqual([newStep(S, "x", { kind: "documenti" }).status, newStep(S, "x", { kind: "documenti" }).origin], ["da_validare", "documenti"]);
  // Dopo l'ultimo passo: in fondo. Dopo un passo che non c'è: dove dice `beforeId`, o in fondo.
  assert.equal(applyOps(board, [op({ t: "step.add", stepId: S, processId: I.processA, title: "x", afterId: I.ordine })], person).processes[0].steps.at(-1)?.id, S);
  assert.equal(applyOps(board, [op({ t: "step.add", stepId: S, processId: I.processA, title: "x", afterId: id() })], person).processes[0].steps.at(-1)?.id, S);
  // Lo stesso id due volte, o un processo che non c'è: niente.
  assert.equal(applyOps(next, [op({ t: "step.add", stepId: S, processId: I.processA, title: "Doppione" })], person), next);
  assert.equal(applyOps(board, [op({ t: "step.add", stepId: S, processId: id(), title: "Senza processo" })], person), board);

  const fields: Array<[Parameters<typeof stepFieldValue>[1], unknown]> = [
    ["title", "Raccolta delle richieste d'acquisto"],
    ["description", "Un'altra descrizione."],
    ["tools", ["Portale"]],
    ["input", "Un modulo."],
    ["output", "Una riga."],
    ["decision", "Decide il responsabile."],
    ["frequency", "mensile"],
    ["hoursWeek", 2],
    ["quality", "Alta"],
    ["workType", "delivery"],
    ["who", ["Segreteria"]],
    ["decisionLabel", "Via libera"],
    ["exception", "Mai successo."],
    ["friction", 1],
    ["status", "da_validare"],
  ];
  let changed = board;
  for (const [field, value] of fields) {
    changed = applyOps(changed, [{ id: id(), t: "step.set", stepId: I.richieste, field, prev: stepFieldValue(stepOf(changed, I.richieste), field), next: value } as BoardOp], person);
    assert.deepEqual(stepFieldValue(stepOf(changed, I.richieste), field), value, field);
  }
  assert.equal(fields.length, 15, "tutti i campi di step.set");
  // Svuotare un testo lo porta a null; togliere il livello lo fa tornare a quello che dicono le note.
  const cleared = applyOps(changed, [op({ t: "step.set", stepId: I.richieste, field: "description", prev: "x", next: null }), op({ t: "step.set", stepId: I.richieste, field: "friction", prev: 1, next: null })], person);
  assert.deepEqual([stepOf(cleared, I.richieste).description, stepOf(cleared, I.richieste).friction, stepOf(cleared, I.richieste).frictionSet, stepFieldValue(stepOf(cleared, I.richieste), "friction")], [null, 2, false, null]);
  // Un livello scelto, anche zero, resta scelto.
  const none = applyOps(board, [op({ t: "step.set", stepId: I.confronto, field: "friction", prev: null, next: 0 })], person);
  assert.deepEqual([stepOf(none, I.confronto).friction, stepOf(none, I.confronto).frictionSet], [0, true]);

  // Spostare: nella riga, in un'altra riga, prima di sé stesso (resta dov'è).
  assert.deepEqual(applyOps(board, [op({ t: "step.move", stepId: I.ordine, processId: I.processA, beforeId: I.richieste })], person).processes[0].steps.map((step) => step.id), [I.ordine, I.richieste, I.confronto, I.scelta]);
  const across = applyOps(board, [op({ t: "step.move", stepId: I.richieste, processId: I.processB, beforeId: I.controllo })], person);
  assert.deepEqual(across.processes.map((process) => process.steps.map((step) => step.id)), [[I.confronto, I.scelta, I.ordine], [I.solleciti, I.richieste, I.controllo]]);
  assert.deepEqual(applyOps(board, [op({ t: "step.move", stepId: I.confronto, processId: I.processA, beforeId: I.confronto })], person).processes[0].steps.map((step) => step.id), board.processes[0].steps.map((step) => step.id));
  assert.equal(applyOps(board, [op({ t: "step.move", stepId: I.confronto, processId: id(), beforeId: null })], person), board);

  // Eliminare: il passo sparisce, e con lui i collegamenti degli altri passi verso di lui.
  const removed = applyOps(board, [op({ t: "step.remove", stepId: I.confronto })], person);
  assert.deepEqual(allSteps(removed).map((step) => step.id), [I.richieste, I.scelta, I.ordine, I.solleciti, I.controllo]);
  assert.deepEqual([stepOf(removed, I.richieste).neededBy, stepOf(removed, I.scelta).dependsOn], [[], []]);
  // Un passo che uno use case elenca resta dov'è (il server risponderebbe «linked»).
  const linked = fixtureBoard();
  linked.processes[0].steps[1].useCaseIds = ["uc-1"];
  assert.equal(applyOps(linked, [op({ t: "step.remove", stepId: I.confronto })], person), linked);
});

test("applyOps, gli stream: sceglierne uno, toglierlo, tornare alla proposta", () => {
  const board = fixtureBoard({ classified: true });
  const chosen = applyOps(board, [op({ t: "step.stream", stepId: I.richieste, prev: "automate", next: "innovate" }), op({ t: "step.stream", stepId: I.scelta, prev: "differentiate", next: null })], person);
  assert.deepEqual([stepOf(chosen, I.richieste).stream, stepOf(chosen, I.scelta).stream, stepOf(chosen, I.richieste).proposedStream], ["innovate", null, "automate"]);
  const reset = applyOps(chosen, [op({ t: "streams.reset" })], person);
  assert.deepEqual(allSteps(reset).map((step) => step.stream), ["automate", "differentiate", "differentiate", null, "automate", "innovate"], "chi non ha una proposta resta com'è");
  assert.equal(applyOps(reset, [op({ t: "streams.reset" })], person), reset);
});

test("applyOps, le note: per corsia e in ordine, lo stato, il titolo solo sui punti di analisi; l'attrito mostrato segue le note", () => {
  const board = fixtureBoard();
  const [A, B, C, D] = [id(), id(), id(), id()];
  const first = stepOf(board, I.richieste).notes.attriti[0].id;
  let next = applyOps(
    board,
    [
      op({ t: "note.add", noteId: A, stepId: I.richieste, lane: "attriti", text: "Tre solleciti per ordine", beforeId: first }),
      op({ t: "note.add", noteId: B, stepId: I.scelta, lane: "attriti", text: "La motivazione si scrive a mano" }),
      op({ t: "note.add", noteId: C, stepId: null, lane: "analisi", title: "Un terzo punto", text: "Che cosa emerge." }),
      op({ t: "note.add", noteId: D, stepId: I.ordine, lane: "idee", text: "Ordini ricorrenti" }),
    ],
    person,
  );
  assert.deepEqual(stepOf(next, I.richieste).notes.attriti.map((note) => note.id).slice(0, 2), [A, first]);
  assert.deepEqual(stepOf(next, I.richieste).notes.attriti[0], { id: A, lane: "attriti", title: null, text: "Tre solleciti per ordine", status: "validato", origin: "board" });
  assert.deepEqual(next.analysis.at(-1), { id: C, lane: "analisi", title: "Un terzo punto", text: "Che cosa emerge.", status: "validato", origin: "board" });
  // «Scelta» non aveva attriti né un livello scelto: con la prima nota si mostra «medio». «Ordine» ha un livello scelto: resta.
  assert.deepEqual([stepOf(board, I.scelta).friction, stepOf(next, I.scelta).friction, stepOf(next, I.scelta).frictionSet], [0, 2, false]);
  assert.deepEqual([stepOf(next, I.ordine).friction, stepOf(next, I.ordine).frictionSet], [1, true]);
  // Dell'assistente e dei documenti nasce «da fonti».
  const fromChat = applyOps(board, [op({ t: "note.add", noteId: A, stepId: I.scelta, lane: "dati", text: "Albo fornitori" })], { kind: "assistente" });
  assert.deepEqual([stepOf(fromChat, I.scelta).notes.dati[0].status, stepOf(fromChat, I.scelta).notes.dati[0].origin], ["fonte", "chat"]);
  assert.deepEqual(ACTOR_DEFAULTS.documenti, { stepStatus: "da_validare", noteStatus: "fonte", origin: "documenti" });

  next = applyOps(
    next,
    [
      op({ t: "note.set", noteId: A, field: "text", prev: "Tre solleciti per ordine", next: "Quattro solleciti per ordine" }),
      op({ t: "note.set", noteId: A, field: "status", prev: "validato", next: "ipotesi" }),
      op({ t: "note.set", noteId: C, field: "title", prev: "Un terzo punto", next: null }),
      op({ t: "note.set", noteId: A, field: "title", prev: null, next: "Una nota di un passo non ha titolo" }),
      op({ t: "note.remove", noteId: B }),
    ],
    person,
  );
  assert.deepEqual([stepOf(next, I.richieste).notes.attriti[0].text, stepOf(next, I.richieste).notes.attriti[0].status, stepOf(next, I.richieste).notes.attriti[0].title], ["Quattro solleciti per ordine", "ipotesi", null]);
  assert.equal(next.analysis.at(-1)?.title, null);
  assert.deepEqual([stepOf(next, I.scelta).notes.attriti, stepOf(next, I.scelta).friction], [[], 0], "tolta l'ultima nota, l'attrito mostrato torna a zero");
  assert.equal(applyOps(next, [op({ t: "note.remove", noteId: B })], person), next, "una nota già sparita");
  assert.equal(applyOps(next, [op({ t: "note.add", noteId: A, stepId: I.ordine, lane: "dati", text: "Lo stesso id" })], person), next);
  assert.equal(applyOps(next, [op({ t: "note.add", noteId: id(), stepId: id(), lane: "dati", text: "Un passo che non c'è" })], person), next);
});

test("applyOps: un bersaglio che non c'è più non fa niente, e la board resta la stessa", () => {
  const board = fixtureBoard();
  const ghost = id();
  const ops = [
    op({ t: "process.set", processId: ghost, field: "name", prev: "x", next: "y" }),
    op({ t: "process.move", processId: ghost, beforeId: null }),
    op({ t: "process.remove", processId: ghost }),
    op({ t: "process.vote", processId: ghost, mine: 3 }),
    op({ t: "step.set", stepId: ghost, field: "title", prev: "x", next: "y" }),
    op({ t: "step.move", stepId: ghost, processId: I.processA, beforeId: null }),
    op({ t: "step.remove", stepId: ghost }),
    op({ t: "step.stream", stepId: ghost, prev: null, next: "automate" }),
    op({ t: "note.set", noteId: ghost, field: "text", prev: "x", next: "y" }),
    op({ t: "note.remove", noteId: ghost }),
  ];
  assert.equal(applyOps(board, ops, person), board);
  assert.equal(applyOps(board, [], person), board);
  const headline = applyOps(board, [op({ t: "board.set", field: "headline", prev: null, next: "Una frase." })], person);
  assert.equal(headline.headline, "Una frase.");
  assert.equal(applyOps(headline, [op({ t: "board.set", field: "headline", prev: "Una frase.", next: null })], person).headline, null);
});

test("applyOps tiene i limiti del server, e mette l'unità «in corso» al primo passo", () => {
  const L = MAPPING_LIMITS;
  let board = fixtureBoard({ empty: true });
  const processes = Array.from({ length: L.processes + 1 }, () => id());
  board = applyOps(board, processes.map((processId, index) => op({ t: "process.add", processId, name: `Processo ${index + 1}` })), person);
  assert.equal(board.processes.length, L.processes);
  assert.equal(board.unit.status, "not_started", "solo processi: ancora da iniziare");
  const steps = Array.from({ length: L.stepsPerProcess + 1 }, () => id());
  board = applyOps(board, steps.map((stepId, index) => op({ t: "step.add", stepId, processId: processes[0], title: `Passo ${index + 1}` })), person);
  assert.equal(board.processes[0].steps.length, L.stepsPerProcess);
  assert.equal(board.unit.status, "in_progress");
  // Un passo di un'altra riga non entra in una riga piena; nella stessa riga ci si sposta.
  const other = id();
  board = applyOps(board, [op({ t: "step.add", stepId: other, processId: processes[1], title: "Altrove" }), op({ t: "step.move", stepId: other, processId: processes[0], beforeId: null })], person);
  assert.deepEqual([board.processes[0].steps.length, board.processes[1].steps.length], [L.stepsPerProcess, 1]);
  assert.equal(applyOps(board, [op({ t: "step.move", stepId: steps[5], processId: processes[0], beforeId: steps[0] })], person).processes[0].steps[0].id, steps[5]);
  // 30 note per corsia, 6 punti di analisi.
  board = applyOps(board, Array.from({ length: L.notesPerLane + 1 }, (_, index) => op({ t: "note.add", noteId: id(), stepId: steps[0], lane: "tempi", text: `Nota ${index + 1}` })), person);
  assert.equal(stepOf(board, steps[0]).notes.tempi.length, L.notesPerLane);
  board = applyOps(board, Array.from({ length: L.analysisPoints + 1 }, (_, index) => op({ t: "note.add", noteId: id(), stepId: null, lane: "analisi", text: `Punto ${index + 1}` })), person);
  assert.equal(board.analysis.length, L.analysisPoints);
  // 200 passi per unità.
  for (let p = 1; p <= 4; p++) board = applyOps(board, Array.from({ length: L.stepsPerProcess }, (_, index) => op({ t: "step.add", stepId: id(), processId: processes[p], title: `Passo ${index + 1}` })), person);
  assert.equal(allSteps(board).length, L.stepsPerUnit);
  assert.equal(applyOps(board, [op({ t: "step.add", stepId: id(), processId: processes[5], title: "Il duecentunesimo" })], person), board);
});

test("coalesce: più modifiche dello stesso campo diventano una, con il prev della prima e il next dell'ultima", () => {
  const title = (prev: string, next: string) => op({ t: "step.set", stepId: I.richieste, field: "title", prev, next });
  const a = title("A", "B");
  const b = title("B", "C");
  const c = title("C", "D");
  const other = op({ t: "step.set", stepId: I.richieste, field: "description", prev: null, next: "x" });
  const elsewhere = op({ t: "step.set", stepId: I.confronto, field: "title", prev: "A", next: "B" });
  const move = op({ t: "step.move", stepId: I.richieste, processId: I.processB, beforeId: null });
  const merged = coalesce([a, other, b, move, elsewhere, c]);
  assert.deepEqual(merged.map((item) => item.id), [other.id, move.id, elsewhere.id, c.id], "resta l'ultima, al suo posto");
  assert.deepEqual([(merged[3] as { prev: unknown }).prev, (merged[3] as { next: unknown }).next], ["A", "D"]);
  // Quello che la board mostra è lo stesso, unite o no.
  const board = fixtureBoard();
  const ops = [op({ t: "step.set", stepId: I.richieste, field: "title", prev: "Raccolta delle richieste", next: "B" }), other, title("B", "C"), move, op({ t: "process.vote", processId: I.processA, mine: 2 }), op({ t: "process.vote", processId: I.processA, mine: 5 })];
  assert.deepEqual(applyOps(board, coalesce(ops), person), applyOps(board, ops, person));
  assert.equal(coalesce(ops).filter((item) => item.t === "process.vote").length, 1, "dei voti resta l'ultimo valore");
  assert.equal((coalesce(ops).find((item) => item.t === "process.vote") as { mine: number }).mine, 5);

  // Tornare al valore di partenza: l'operazione sparisce. Vale anche per le liste.
  assert.deepEqual(coalesce([title("A", "B"), title("B", "A")]), []);
  assert.deepEqual(coalesce([op({ t: "step.set", stepId: I.richieste, field: "who", prev: ["Buyer"], next: [] }), op({ t: "step.set", stepId: I.richieste, field: "who", prev: [], next: ["Buyer"] })]), []);
  // Ogni tipo di campo: processi, note, la frase della board, lo stream.
  const pairs: BoardOp[][] = [
    [op({ t: "process.set", processId: I.processA, field: "owner", prev: null, next: "A" }), op({ t: "process.set", processId: I.processA, field: "owner", prev: "A", next: "B" })],
    [op({ t: "note.set", noteId: I.unit, field: "text", prev: "A", next: "B" }), op({ t: "note.set", noteId: I.unit, field: "text", prev: "B", next: "C" })],
    [op({ t: "board.set", field: "headline", prev: null, next: "A" }), op({ t: "board.set", field: "headline", prev: "A", next: "B" })],
    [op({ t: "step.stream", stepId: I.richieste, prev: null, next: "automate" }), op({ t: "step.stream", stepId: I.richieste, prev: "automate", next: "innovate" })],
  ];
  for (const pair of pairs) {
    const [one] = coalesce(pair);
    assert.equal(coalesce(pair).length, 1, pair[0].t);
    assert.deepEqual([one.id, (one as { prev: unknown }).prev, (one as { next: unknown }).next], [pair[1].id, (pair[0] as { prev: unknown }).prev, (pair[1] as { next: unknown }).next]);
  }
  // Campi diversi, o bersagli diversi, non si uniscono; aggiunte, spostamenti ed eliminazioni restano come sono.
  const untouched = [op({ t: "process.set", processId: I.processA, field: "name", prev: "A", next: "B" }), op({ t: "process.set", processId: I.processA, field: "owner", prev: null, next: "B" }), op({ t: "process.set", processId: I.processB, field: "name", prev: "A", next: "B" }), move, op({ t: "step.move", stepId: I.richieste, processId: I.processA, beforeId: null }), op({ t: "note.remove", noteId: I.unit })];
  assert.deepEqual(coalesce(untouched), untouched);
  // «Usa gli stream proposti» in mezzo separa: lo stream scelto prima e quello scelto dopo restano due operazioni.
  const before = op({ t: "step.stream", stepId: I.richieste, prev: "automate", next: "innovate" });
  const reset = op({ t: "streams.reset" });
  const after = op({ t: "step.stream", stepId: I.richieste, prev: "automate", next: "differentiate" });
  assert.deepEqual(coalesce([before, reset, after]), [before, reset, after]);
  const classified = fixtureBoard({ classified: true });
  assert.deepEqual(applyOps(classified, coalesce([before, reset, after]), person), applyOps(classified, [before, reset, after], person));
  assert.deepEqual(coalesce([]), []);
});

test("opsForNewStep: step.add, poi un campo alla volta, poi una nota per voce; i testi lunghi si tagliano, mai si rifiutano", () => {
  let n = 0;
  const newId = () => `abababab-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const { stepId, ops } = opsForNewStep(
    {
      title: `  Registrazione   della fattura ${"x".repeat(200)}`,
      description: "y".repeat(3000),
      who: ["Contabilità", "contabilità", " ", ...Array.from({ length: 20 }, (_, i) => `Ruolo ${i}`)],
      tools: ["z".repeat(200)],
      input: "La fattura.",
      output: "",
      decision: "Chi registra decide.",
      decisionLabel: "Fattura conforme, importi e quantità controllati riga per riga con l'ordine",
      exception: "Se l'importo non torna.",
      friction: 3,
      frequency: "settimanale",
      hoursWeek: 500,
      quality: "Bassa",
      workType: "detection",
      steps: ["Si apre la fattura", "si apre la fattura", "Si cerca l'ordine"],
      frictions: ["w".repeat(2500)],
      data: ["Ordine", "  "],
      times: Array.from({ length: 40 }, (_, i) => `Volume ${i}`),
    },
    { processId: I.processA, afterStepId: I.confronto },
    newId,
  );
  // Ogni operazione passa lo schema così com'è: niente da rifinire, niente da rifiutare.
  for (const item of ops) assert.deepEqual(boardOpSchema.parse(item), item, item.t);
  assert.ok(saveInputSchema.safeParse({ baseRevision: 0, ops }).success);
  const add = ops[0] as Extract<BoardOp, { t: "step.add" }>;
  assert.deepEqual([add.t, add.stepId, add.processId, add.afterId, add.title.length, add.title.startsWith("Registrazione della fattura x")], ["step.add", stepId, I.processA, I.confronto, 120, true]);
  const sets = ops.filter((item): item is Extract<BoardOp, { t: "step.set" }> => item.t === "step.set");
  assert.deepEqual(sets.map((item) => item.field), ["description", "who", "tools", "input", "decision", "decisionLabel", "exception", "friction", "frequency", "hoursWeek", "quality", "workType"], "un campo vuoto («output») non si scrive");
  const value = (field: string) => sets.find((item) => item.field === field)!.next;
  assert.equal((value("description") as string).length, 2000);
  assert.deepEqual([(value("who") as string[]).length, (value("who") as string[])[0], (value("tools") as string[])[0].length], [12, "Contabilità", 80]);
  assert.deepEqual([(value("decisionLabel") as string).length <= 60, value("friction"), value("hoursWeek"), value("workType")], [true, 3, 168, "detection"]);
  // Il valore di prima è quello di un passo appena nato.
  assert.deepEqual(sets.map((item) => item.prev), [null, [], [], null, null, null, null, null, null, null, null, null]);
  const notes = ops.filter((item): item is Extract<BoardOp, { t: "note.add" }> => item.t === "note.add");
  assert.deepEqual(notes.map((item) => item.lane), ["attivita", "attivita", "attriti", "dati", ...Array(30).fill("tempi")]);
  assert.deepEqual([notes[0].text, notes[1].text, notes[2].text.length, notes[3].text, notes.every((item) => item.stepId === stepId)], ["Si apre la fattura", "Si cerca l'ordine", 2000, "Ordine", true]);
  assert.equal(new Set([...ops.map((item) => item.id), ...notes.map((item) => item.noteId), stepId]).size, ops.length + notes.length + 1, "ogni id una volta sola");
  // Sulla board: il passo subito dopo quello indicato, con tutto quello che il modulo diceva.
  const board = applyOps(fixtureBoard(), ops, { kind: "assistente" });
  assert.deepEqual(board.processes[0].steps.map((step) => step.id), [I.richieste, I.confronto, stepId, I.scelta, I.ordine]);
  assert.deepEqual([stepOf(board, stepId).status, stepOf(board, stepId).origin, stepOf(board, stepId).notes.tempi.length, stepOf(board, stepId).friction], ["da_validare", "chat", 30, 3]);

  // Solo il titolo: una sola operazione, in fondo. Senza titolo: niente.
  const bare = opsForNewStep({ title: "Pagamento" }, { processId: I.processB }, newId);
  assert.deepEqual(bare.ops.map((item) => item.t), ["step.add"]);
  assert.equal("afterId" in bare.ops[0], false);
  assert.deepEqual(opsForNewStep({ title: "   ", description: "Senza titolo" }, { processId: I.processB }, newId).ops, []);
});

test("opsForStepPatch: solo i campi che cambiano, con il valore di adesso come prev; le liste aggiungono note, non ne tolgono mai", () => {
  let n = 0;
  const newId = () => `cdcdcdcd-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const board = fixtureBoard();
  const current = stepOf(board, I.richieste);
  const ops = opsForStepPatch(
    current,
    {
      title: "Raccolta delle richieste",
      description: "Le richieste arrivano da un modulo.",
      who: ["Buyer", "Segreteria"],
      friction: 1,
      hoursWeek: 6.5,
      output: "   ",
      tools: [],
      frictions: ["richieste incomplete", "Tre passaggi a mano"],
      data: ["Elenco dei fornitori"],
      steps: ["Si controlla il centro di costo"],
    },
    newId,
  );
  for (const item of ops) assert.deepEqual(boardOpSchema.parse(item), item, item.t);
  const sets = ops.filter((item): item is Extract<BoardOp, { t: "step.set" }> => item.t === "step.set");
  // Il titolo e le ore non cambiano; un campo che resterebbe vuoto non si tocca (l'assistente non svuota).
  assert.deepEqual(sets.map((item) => [item.field, item.prev, item.next]), [
    ["description", current.description, "Le richieste arrivano da un modulo."],
    ["who", ["Buyer"], ["Buyer", "Segreteria"]],
    ["friction", 3, 1],
  ]);
  const notes = ops.filter((item): item is Extract<BoardOp, { t: "note.add" }> => item.t === "note.add");
  assert.deepEqual(notes.map((item) => [item.lane, item.text]), [["attivita", "Si controlla il centro di costo"], ["attriti", "Tre passaggi a mano"]], "una voce che la corsia ha già non si aggiunge due volte");
  assert.ok(!ops.some((item) => item.t === "note.remove" || item.t === "step.remove"));
  const after = applyOps(board, ops, { kind: "assistente" });
  assert.deepEqual(stepOf(after, I.richieste).notes.attriti.map((note) => note.text), ["Richieste incomplete", "Nessun modulo unico", "Tre passaggi a mano"]);
  // L'attrito non ancora scelto ha null come valore di prima.
  assert.deepEqual(opsForStepPatch(stepOf(board, I.confronto), { friction: 2 }, newId).map((item) => [(item as { prev: unknown }).prev, (item as { next: unknown }).next]), [[null, 2]]);
  // Una corsia piena non prende altre note; un modulo senza novità non scrive niente.
  const full = fixtureBoard();
  full.processes[0].steps[0].notes.tempi = Array.from({ length: MAPPING_LIMITS.notesPerLane }, (_, index) => ({ id: newId(), lane: "tempi" as const, title: null, text: `Volume ${index}`, status: "validato" as const, origin: "board" as const }));
  assert.deepEqual(opsForStepPatch(stepOf(full, I.richieste), { times: ["Un volume in più"] }, newId), []);
  assert.deepEqual(opsForStepPatch(current, { title: current.title, who: [...current.who], frictions: ["Richieste incomplete"] }, newId), []);
  assert.deepEqual(opsForStepPatch(current, {}, newId), []);
});

test("opsForStepPatch: ruoli e strumenti l'assistente li aggiunge, non li toglie mai (li tolgono le persone sulla board)", () => {
  let n = 0;
  const newId = () => `cececece-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  const current = stepOf(fixtureBoard(), I.richieste);
  assert.deepEqual([current.who, current.tools], [["Buyer"], ["E-mail", "Foglio di calcolo"]]);
  // Una lista che non ripete quello che c'è: si aggiunge in fondo, quello che c'era resta, nello stesso ordine.
  const sets = opsForStepPatch(current, { who: ["Segreteria"], tools: ["foglio di calcolo", "Gestionale"] }, newId).filter((item): item is Extract<BoardOp, { t: "step.set" }> => item.t === "step.set");
  assert.deepEqual(sets.map((item) => [item.field, item.prev, item.next]), [
    ["who", ["Buyer"], ["Buyer", "Segreteria"]],
    ["tools", ["E-mail", "Foglio di calcolo"], ["E-mail", "Foglio di calcolo", "Gestionale"]],
  ]);
  for (const item of sets) assert.deepEqual(boardOpSchema.parse(item), item);
  // Niente di nuovo (a meno di maiuscole e spazi): nessuna operazione.
  assert.deepEqual(opsForStepPatch(current, { who: ["  buyer "], tools: ["E-MAIL"] }, newId), []);
  // Mai oltre il limite: una lista piena non prende altre voci.
  const crowded = { ...current, who: Array.from({ length: MAPPING_LIMITS.who }, (_, index) => `Ruolo ${index + 1}`) };
  assert.deepEqual(opsForStepPatch(crowded, { who: ["Un ruolo in più"] }, newId), []);
});

test("i tagli: una riga, un testo, una lista", () => {
  assert.deepEqual([cutLine("  a \n b  ", 10), cutLine("abcdef", 3), cutLine("ab cd", 3), cutLine("   ", 3), cutLine(null, 3), cutLine(undefined, 3)], ["a b", "abc", "ab", null, null, null]);
  assert.deepEqual([cutProse(" a \r\n b ", 10), cutProse("a\n\n\n\nb", 10), cutProse("", 10)], ["a\n b", "a\n\nb", null]);
  assert.deepEqual(cutList([" a ", "A", "", "b", "c"], 2, 5), ["a", "b"]);
  assert.deepEqual(cutList(undefined, 2, 5), []);
});

test("un testo più lungo di una nota: parti agli a capo entro il limite, una riga troppo lunga a pezzi; unite ridanno il testo", () => {
  const max = 50;
  const lines = ["Prima riga del testo.", "Seconda riga, un po' più lunga.", "", "Terza riga dopo una riga vuota.", "Quarta."];
  const text = lines.join("\n");
  const parts = splitNoteText(text, max);
  assert.ok(parts.length > 1);
  for (const part of parts) assert.ok(part.length > 0 && part.length <= max && part === part.trim(), JSON.stringify(part));
  // Agli a capo: unite da un a capo le parti ridanno le righe, senza la riga vuota a un confine.
  assert.equal(parts.join("\n").replace(/\n{2,}/g, "\n"), lines.filter(Boolean).join("\n"));
  // Una riga più lunga del limite: pezzi di `max` caratteri, nessuna lettera persa.
  const long = "abcdefghij".repeat(12);
  const pieces = splitNoteText(`Inizio.\n${long}\nFine.`, max);
  assert.ok(pieces.every((part) => part.length <= max));
  assert.equal(pieces.join("").replace(/\s/g, ""), `Inizio.${long}Fine.`);
  // Un testo entro il limite resta una parte sola; spazi e righe vuote non diventano note.
  assert.deepEqual(splitNoteText("Corto.", max), ["Corto."]);
  assert.deepEqual(splitNoteText(" \n \n ", max), []);
  // Con il limite vero: un testo di 2.724 caratteri su più righe entra in due note.
  const legacy = Array.from({ length: 60 }, () => "Le richieste arrivano per e-mail e telefono.").join("\n");
  const real = splitNoteText(legacy, MAPPING_LIMITS.note);
  assert.equal(real.length, 2);
  assert.equal(real.join("\n"), legacy);
});

/** Una stringa senza metà di emoji: UTF-8 la scrive e la rilegge uguale (una metà da sola diventerebbe U+FFFD). */
const wellFormed = (text: string) => new TextDecoder().decode(new TextEncoder().encode(text)) === text;

test("un taglio non spezza mai un'emoji né una lettera con i suoi segni: né le note di un testo lungo, né i limiti dei campi", () => {
  const max = MAPPING_LIMITS.note;
  // L'emoji a cavallo del 2000° carattere (1999 + 2): il primo pezzo si ferma prima, l'emoji intera apre il secondo.
  const emoji = "\u{1F600}";
  const line = `${"a".repeat(max - 1)}${emoji}${" e poi il resto del testo".repeat(20)}`;
  const parts = splitNoteText(line, max);
  assert.equal(parts.length, 2);
  for (const part of parts) assert.ok(wellFormed(part) && part.length <= max, `${part.length} unità, ben formata: ${wellFormed(part)}`);
  assert.equal(parts[0], "a".repeat(max - 1));
  assert.ok(parts[1].startsWith(emoji));
  assert.equal(parts.join("").replace(/\s/g, ""), line.replace(/\s/g, ""));
  // Un grafema di più punti di codice (una famiglia unita da ZWJ, una bandiera, una lettera con l'accento combinato)
  // sul confine resta intero nel pezzo dopo.
  for (const cluster of ["\u{1F469}‍\u{1F469}‍\u{1F467}", "\u{1F1EE}\u{1F1F9}", "é"]) {
    const text = `${"x".repeat(max - 1)}${cluster}fine`;
    const cut = splitNoteText(text, max);
    assert.deepEqual(cut, ["x".repeat(max - 1), `${cluster}fine`], JSON.stringify(cluster));
  }
  // Un grafema più lungo di un pezzo intero va per punti di codice: nessun pezzo supera il limite, niente si perde.
  const marks = `o${"́".repeat(12)}`;
  const small = splitNoteText(marks, 5);
  assert.ok(small.every((part) => part.length <= 5 && wellFormed(part)));
  assert.equal(small.join(""), marks);
  // I limiti dei campi (titoli, descrizioni, note dell'assistente) tagliano allo stesso modo.
  assert.equal(cutLine(`${"a".repeat(MAPPING_LIMITS.title - 1)}${emoji}`, MAPPING_LIMITS.title), "a".repeat(MAPPING_LIMITS.title - 1));
  assert.equal(cutProse(`${"b".repeat(9)}\u{1F1EE}\u{1F1F9}`, 10), "b".repeat(9));
  assert.equal(cutLine(`ab${emoji}`, 4), `ab${emoji}`);
  assert.deepEqual(cutList([`${"c".repeat(MAPPING_LIMITS.toolItem - 1)}${emoji}`], 3, MAPPING_LIMITS.toolItem), ["c".repeat(MAPPING_LIMITS.toolItem - 1)]);
});
