import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { boardCounts, connect, enabled, insertActivity, newFixture, opts, seed, unseed, type Connection, type Row } from "./integration-kit.ts";
import type { BoardStep, MappingBoard } from "./board-model.ts";
import { applyOps, boardOpSchema, opsForNewStep, type ActorKind, type BoardOp } from "./board-ops.ts";
import { MAPPING_LIMITS } from "./vocab.ts";

// `saveBoardOps` sul database del pacchetto (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.3, §8.2): ogni operazione, e le
// regole R1–R6.
// - Quello che il database tiene dopo un salvataggio è quello che il riduttore del browser (`applyOps`) mostra subito:
//   ogni salvataggio riuscito si confronta con lui, campo per campo.
// - R1: un id di un'altra unità o di un altro workspace non tocca niente. R2: un bersaglio sparito rifiuta la sua
//   operazione e lascia passare le altre. R3: un campo cambiato da altri è rifiutato, un campo che ha già il valore
//   nuovo è accettato. R4: la stessa richiesta due volte lascia un passo, una nota, gli stessi voti.
// - Le note di «Attriti» e «Dati e documenti» riscrivono le loro colonne; l'unità va «in corso» al primo passo; la
//   revisione sale di uno a ogni salvataggio; eliminare un passo porta via note, dipendenze e nodo della value map, ed
//   è rifiutato se uno use case lo elenca; i voti di due persone si sommano e nessuno abbassa quelli dell'altro.
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui.

const f = newFixture();
let db: Connection;
let q: Connection["q"];
let store: typeof import("./board-store.ts");

type Scope = { workspaceId: string; departmentId: string };
const scope = (): Scope => ({ workspaceId: f.ws, departmentId: f.unit });
const otherScope = (): Scope => ({ workspaceId: f.ws, departmentId: f.otherUnit });
const lead = (kind: ActorKind = "persona") => ({ kind, userId: f.lead, role: "transformation_lead" });
const contributor = (kind: ActorKind = "persona") => ({ kind, userId: f.contributor, role: "contributor" });
const id = () => randomUUID();
const op = <T extends Omit<BoardOp, "id">>(body: T) => ({ id: id(), ...body }) as BoardOp;

const read = async (who = lead(), where = scope()): Promise<MappingBoard> => {
  const board = await store.readBoard(db.exec, where, who);
  assert.ok(board, "la board c'è");
  return board;
};
const steps = (board: MappingBoard): BoardStep[] => board.processes.flatMap((process) => process.steps);
const step = (board: MappingBoard, stepId: string): BoardStep => {
  const found = steps(board).find((item) => item.id === stepId);
  assert.ok(found, `manca il passo ${stepId}`);
  return found;
};
/** Quello che il riduttore sa dire di una board: tutto tranne revisione e ora. */
const shape = (board: MappingBoard) => ({ ...board, revision: 0, savedAt: null });

/**
 * Salva e controlla: nessun rifiuto oltre quelli attesi, la revisione sale di uno, e la board che torna dal database è
 * quella che il riduttore dà applicando le operazioni non rifiutate.
 */
async function save(ops: BoardOp[], who = lead(), expected: Record<string, string> = {}, where = scope()): Promise<MappingBoard> {
  const beforeBoard = await read(who, where);
  const result = await store.saveBoardOps(db.exec, where, who, { baseRevision: beforeBoard.revision, ops });
  assert.ok(result.ok, `salvataggio non riuscito: ${JSON.stringify(result)}`);
  assert.deepEqual(Object.fromEntries(result.rejected.map((r) => [r.id, r.reason])), expected);
  // Il browser rifinisce ogni operazione con lo schema prima di applicarla: qui lo stesso.
  const applied = ops.filter((item) => !(item.id in expected)).map((item) => boardOpSchema.parse(item));
  if (applied.length > 0 || Object.values(expected).some((reason) => reason !== "forbidden")) {
    assert.equal(result.revision, beforeBoard.revision + 1, "la revisione sale di uno");
    assert.equal(result.board.revision, result.revision);
    assert.equal(result.board.savedAt, result.savedAt);
    assert.ok(Math.abs(new Date(result.savedAt).getTime() - Date.now()) < 60_000);
  }
  assert.deepEqual(shape(result.board), shape(applyOps(beforeBoard, applied, who)), "il database tiene quello che il riduttore mostra");
  assert.deepEqual(shape(await read(who, where)), shape(result.board), "una nuova lettura dà la stessa board");
  return result.board;
}

const activityRow = async (activityId: string): Promise<Row> => (await q(`SELECT * FROM activities WHERE id = $1`, [activityId]))[0];
const positions = async (table: string, where: string, params: unknown[]) => (await q(`SELECT position FROM ${table} WHERE ${where} ORDER BY position`, params)).map((r: Row) => Number(r.position));

const P1 = id();
const P2 = id();
const S1 = id();
const S2 = id();
const S3 = id();
const S4 = id();

before(async () => {
  if (!enabled) return;
  db = await connect();
  q = db.q;
  store = await import("./board-store.ts");
  await seed(q, f, "store");
});

after(async () => {
  if (!enabled) return;
  await unseed(q, f);
});

test("una unità vuota: nessun processo, mai salvata, da iniziare; i primi processi e passi la mettono in corso", opts, async () => {
  const empty = await read();
  assert.deepEqual([empty.processes, empty.analysis, empty.revision, empty.savedAt, empty.unit.status, empty.store], [[], [], 0, null, "not_started", "pronto"]);
  assert.deepEqual(await boardCounts(q, [f.ws]), { mapping_boards: 0, mapping_processes: 0, mapping_steps: 0, mapping_notes: 0, mapping_votes: 0 });

  // Solo processi: l'unità resta da iniziare.
  let board = await save([op({ t: "process.add", processId: P2, name: "Dall'ordine alla consegna" }), op({ t: "process.add", processId: P1, name: "  Dalla richiesta   all'ordine ", beforeId: P2 })]);
  assert.deepEqual(board.processes.map((process) => [process.id, process.name]), [[P1, "Dalla richiesta all'ordine"], [P2, "Dall'ordine alla consegna"]]);
  assert.equal(board.unit.status, "not_started");
  assert.equal((await q(`SELECT mapping_status::text AS s FROM departments WHERE id = $1`, [f.unit]))[0].s, "not_started");

  // I passi: in fondo, prima di un altro, subito dopo un altro.
  board = await save([
    op({ t: "step.add", stepId: S2, processId: P1, title: "Confronto delle offerte" }),
    op({ t: "step.add", stepId: S1, processId: P1, title: "Raccolta delle richieste", beforeId: S2 }),
    op({ t: "step.add", stepId: S4, processId: P1, title: "Invio dell'ordine" }),
    op({ t: "step.add", stepId: S3, processId: P1, title: "Scelta del fornitore", afterId: S2 }),
  ]);
  assert.deepEqual(board.processes[0].steps.map((item) => item.id), [S1, S2, S3, S4]);
  assert.equal(board.unit.status, "in_progress");
  assert.equal((await q(`SELECT mapping_status::text AS s FROM departments WHERE id = $1`, [f.unit]))[0].s, "in_progress", "in corso al primo passo");
  assert.equal(board.revision, 2);
  // Quello che scrive una persona sulla board nasce confermato.
  assert.deepEqual(board.processes[0].steps.map((item) => [item.status, item.origin]), Array(4).fill(["confermato", "board"]));
  // Un passo aggiunto sulla board è una riga intera di activities: unità, workspace, titolo; senza stream.
  const row = await activityRow(S1);
  assert.deepEqual([row.department_id, row.workspace_id, row.title, row.classification, row.description], [f.unit, f.ws, "Raccolta delle richieste", null, null]);
  assert.deepEqual(await positions("mapping_steps", "process_id = $1", [P1]), [1, 2, 3, 4]);
  assert.deepEqual(await positions("mapping_processes", "department_id = $1", [f.unit]), [1, 2]);
});

test("step.set: ogni campo va nella sua colonna, di activities o di mapping_steps", opts, async () => {
  const board = await save([
    op({ t: "step.set", stepId: S1, field: "title", prev: "Raccolta delle richieste", next: "Raccolta delle richieste d'acquisto" }),
    op({ t: "step.set", stepId: S1, field: "description", prev: null, next: "Le richieste arrivano per e-mail.\nSi copiano in un foglio." }),
    op({ t: "step.set", stepId: S1, field: "tools", prev: [], next: ["E-mail", "Foglio di calcolo", "e-mail"] }),
    op({ t: "step.set", stepId: S1, field: "input", prev: null, next: "La richiesta di un ufficio." }),
    op({ t: "step.set", stepId: S1, field: "output", prev: null, next: "Una riga nel foglio." }),
    op({ t: "step.set", stepId: S1, field: "decision", prev: null, next: "Chi compra decide se la richiesta è completa." }),
    op({ t: "step.set", stepId: S1, field: "frequency", prev: null, next: "giornaliera" }),
    op({ t: "step.set", stepId: S1, field: "hoursWeek", prev: null, next: 6.5 }),
    op({ t: "step.set", stepId: S1, field: "quality", prev: null, next: "Media" }),
    op({ t: "step.set", stepId: S1, field: "workType", prev: null, next: "enrichment" }),
    op({ t: "step.set", stepId: S1, field: "who", prev: [], next: ["Buyer", "Responsabile acquisti"] }),
    op({ t: "step.set", stepId: S1, field: "decisionLabel", prev: null, next: "Richiesta completa" }),
    op({ t: "step.set", stepId: S1, field: "exception", prev: null, next: "Se manca il centro di costo, la richiesta torna indietro." }),
    op({ t: "step.set", stepId: S1, field: "friction", prev: null, next: 3 }),
    op({ t: "step.set", stepId: S1, field: "status", prev: "confermato", next: "da_validare" }),
  ]);
  const s = step(board, S1);
  assert.deepEqual(
    [s.title, s.description, s.tools, s.input, s.output, s.decision, s.frequency, s.hoursWeek, s.quality, s.workType, s.who, s.decisionLabel, s.exception, s.friction, s.frictionSet, s.status],
    [
      "Raccolta delle richieste d'acquisto",
      "Le richieste arrivano per e-mail.\nSi copiano in un foglio.",
      ["E-mail", "Foglio di calcolo"],
      "La richiesta di un ufficio.",
      "Una riga nel foglio.",
      "Chi compra decide se la richiesta è completa.",
      "giornaliera",
      6.5,
      "Media",
      "enrichment",
      ["Buyer", "Responsabile acquisti"],
      "Richiesta completa",
      "Se manca il centro di costo, la richiesta torna indietro.",
      3,
      true,
      "da_validare",
    ],
  );
  // I campi che sono colonne di activities si scrivono lì: gli altri lettori li trovano dove li hanno sempre trovati.
  const row = await activityRow(S1);
  assert.deepEqual(
    [row.title, row.description, row.tools_used, row.input_description, row.output_description, row.decision_points, row.frequency, Number(row.time_spent_hours_week), row.quality_perceived, row.work_type],
    [s.title, s.description, ["E-mail", "Foglio di calcolo"], s.input, s.output, s.decision, "giornaliera", 6.5, "Media", "enrichment"],
  );
  const [extra] = await q(`SELECT who, decision_label, exception_text, friction_level, status FROM mapping_steps WHERE activity_id = $1`, [S1]);
  assert.deepEqual([extra.who, extra.decision_label, extra.exception_text, extra.friction_level, extra.status], [["Buyer", "Responsabile acquisti"], "Richiesta completa", s.exception, 3, "da_validare"]);

  // Svuotare: i testi tornano NULL, la lista degli strumenti NULL (come ha sempre scritto la chat), il livello torna «non scelto».
  const cleared = await save([
    op({ t: "step.set", stepId: S1, field: "description", prev: s.description, next: "   " }),
    op({ t: "step.set", stepId: S1, field: "tools", prev: s.tools, next: [] }),
    op({ t: "step.set", stepId: S1, field: "hoursWeek", prev: 6.5, next: null }),
    op({ t: "step.set", stepId: S1, field: "workType", prev: "enrichment", next: null }),
    op({ t: "step.set", stepId: S1, field: "friction", prev: 3, next: null }),
    op({ t: "step.set", stepId: S1, field: "who", prev: s.who, next: [] }),
  ]);
  const c = step(cleared, S1);
  assert.deepEqual([c.description, c.tools, c.hoursWeek, c.workType, c.friction, c.frictionSet, c.who], [null, [], null, null, 0, false, []]);
  const after = await activityRow(S1);
  assert.deepEqual([after.description, after.tools_used, after.time_spent_hours_week, after.work_type], [null, null, null, null]);
});

test("le note: per corsia, in ordine, con stato e titolo; «Attriti» e «Dati e documenti» riscrivono le loro colonne", opts, async () => {
  const n = { a1: id(), f1: id(), f2: id(), f0: id(), d1: id(), t1: id(), i1: id(), p1: id(), p2: id() };
  let board = await save([
    op({ t: "note.add", noteId: n.a1, stepId: S1, lane: "attivita", text: "Si apre la casella condivisa" }),
    op({ t: "note.add", noteId: n.f1, stepId: S1, lane: "attriti", text: "Richieste incomplete" }),
    op({ t: "note.add", noteId: n.f2, stepId: S1, lane: "attriti", text: "Tre solleciti per ordine" }),
    op({ t: "note.add", noteId: n.f0, stepId: S1, lane: "attriti", text: "Nessun modulo unico", beforeId: n.f1 }),
    op({ t: "note.add", noteId: n.d1, stepId: S1, lane: "dati", text: "Elenco dei fornitori" }),
    op({ t: "note.add", noteId: n.t1, stepId: S1, lane: "tempi", text: "Quaranta richieste a settimana" }),
    op({ t: "note.add", noteId: n.i1, stepId: S1, lane: "idee", text: "Un modulo unico per tutti gli uffici" }),
    op({ t: "note.add", noteId: n.p1, stepId: null, lane: "analisi", title: "Dove va il tempo", text: "Nei solleciti. Ogni ordine ne chiede tre." }),
    op({ t: "note.add", noteId: n.p2, stepId: null, lane: "analisi", text: "Le richieste arrivano incomplete.", beforeId: n.p1 }),
  ]);
  let s = step(board, S1);
  assert.deepEqual(s.notes.attriti.map((note) => note.text), ["Nessun modulo unico", "Richieste incomplete", "Tre solleciti per ordine"]);
  assert.deepEqual(board.analysis.map((note) => [note.id, note.title]), [[n.p2, null], [n.p1, "Dove va il tempo"]]);
  // Quello che scrive una persona nasce validato.
  assert.deepEqual([...s.notes.attriti, ...s.notes.dati, ...board.analysis].map((note) => [note.status, note.origin]), Array(6).fill(["validato", "board"]));
  // Un attrito scritto, nessun livello scelto: «medio».
  assert.deepEqual([s.friction, s.frictionSet], [2, false]);
  let row = await activityRow(S1);
  assert.equal(row.pain_points, "Nessun modulo unico\nRichieste incomplete\nTre solleciti per ordine");
  assert.equal(row.data_required, "Elenco dei fornitori");
  assert.deepEqual(await positions("mapping_notes", "activity_id = $1 AND lane = 'attriti'", [S1]), [1, 2, 3]);
  assert.deepEqual(await positions("mapping_notes", "department_id = $1 AND activity_id IS NULL", [f.unit]), [1, 2]);

  board = await save([
    op({ t: "note.set", noteId: n.f1, field: "text", prev: "Richieste incomplete", next: "Richieste senza centro di costo" }),
    op({ t: "note.set", noteId: n.f2, field: "status", prev: "validato", next: "ipotesi" }),
    op({ t: "note.set", noteId: n.p2, field: "title", prev: null, next: "Da dove parte il problema" }),
    op({ t: "note.set", noteId: n.p1, field: "title", prev: "Dove va il tempo", next: null }),
    op({ t: "note.remove", noteId: n.f0 }),
    op({ t: "note.remove", noteId: n.d1 }),
  ]);
  s = step(board, S1);
  assert.deepEqual(s.notes.attriti.map((note) => [note.text, note.status]), [["Richieste senza centro di costo", "validato"], ["Tre solleciti per ordine", "ipotesi"]]);
  assert.deepEqual(board.analysis.map((note) => note.title), ["Da dove parte il problema", null]);
  row = await activityRow(S1);
  assert.equal(row.pain_points, "Richieste senza centro di costo\nTre solleciti per ordine");
  assert.equal(row.data_required, null, "senza note la colonna torna NULL");

  // Una nota di un passo non ha titolo: l'operazione è rifiutata, senza errori; una nota già sparita conta come tolta.
  const title = op({ t: "note.set", noteId: n.f1, field: "title", prev: null, next: "Un titolo" });
  board = await save([title, op({ t: "note.remove", noteId: n.d1 }), op({ t: "note.remove", noteId: n.f1 }), op({ t: "note.remove", noteId: n.f2 })], lead(), { [title.id]: "conflict" });
  assert.equal((await activityRow(S1)).pain_points, null);
  assert.deepEqual([step(board, S1).friction, step(board, S1).frictionSet], [0, false]);
});

test("spostare: un passo nella riga e in un'altra riga, un processo; le posizioni restano da 1 a n", opts, async () => {
  let board = await save([op({ t: "step.move", stepId: S4, processId: P1, beforeId: S1 }), op({ t: "step.move", stepId: S2, processId: P2, beforeId: null }), op({ t: "step.move", stepId: S3, processId: P2, beforeId: S2 })]);
  assert.deepEqual(board.processes.map((process) => process.steps.map((item) => item.id)), [[S4, S1], [S3, S2]]);
  assert.deepEqual(await positions("mapping_steps", "process_id = $1", [P1]), [1, 2]);
  assert.deepEqual(await positions("mapping_steps", "process_id = $1", [P2]), [1, 2]);
  // Prima di sé stesso: resta dov'è. In fondo alla sua riga.
  board = await save([op({ t: "step.move", stepId: S3, processId: P2, beforeId: S3 }), op({ t: "step.move", stepId: S4, processId: P1, beforeId: null })]);
  assert.deepEqual(board.processes.map((process) => process.steps.map((item) => item.id)), [[S1, S4], [S3, S2]]);
  board = await save([op({ t: "process.move", processId: P2, beforeId: P1 })]);
  assert.deepEqual(board.processes.map((process) => process.id), [P2, P1]);
  board = await save([op({ t: "process.move", processId: P2, beforeId: null }), op({ t: "process.set", processId: P2, field: "owner", prev: null, next: "Responsabile della logistica" })]);
  assert.deepEqual(board.processes.map((process) => [process.id, process.owner]), [[P1, null], [P2, "Responsabile della logistica"]]);
  assert.deepEqual(await positions("mapping_processes", "department_id = $1", [f.unit]), [1, 2]);
  board = await save([op({ t: "process.set", processId: P2, field: "name", prev: "Dall'ordine alla consegna", next: "Dall'ordine alla merce" }), op({ t: "process.set", processId: P2, field: "owner", prev: "Responsabile della logistica", next: null })]);
  assert.deepEqual([board.processes[1].name, board.processes[1].owner], ["Dall'ordine alla merce", null]);
});

test("i voti: ognuno i suoi, la board mostra la somma, nessuno abbassa quelli di un altro", opts, async () => {
  let board = await save([op({ t: "process.vote", processId: P1, mine: 2 })]);
  assert.deepEqual([board.processes[0].votes, board.processes[0].myVotes], [2, 2]);
  board = await save([op({ t: "process.vote", processId: P1, mine: 3 }), op({ t: "process.vote", processId: P2, mine: 1 })], contributor());
  assert.deepEqual(board.processes.map((process) => [process.votes, process.myVotes]), [[5, 3], [1, 1]]);
  // Chi contribuisce porta i suoi a zero: restano quelli dell'altra persona.
  board = await save([op({ t: "process.vote", processId: P1, mine: 0 })], contributor());
  assert.deepEqual([board.processes[0].votes, board.processes[0].myVotes], [2, 0]);
  assert.deepEqual((await read(lead())).processes.map((process) => [process.votes, process.myVotes]), [[2, 2], [1, 0]]);
  const rows = await q(`SELECT user_id, votes FROM mapping_votes WHERE process_id = $1`, [P1]);
  assert.deepEqual(rows.map((r: Row) => [r.user_id, r.votes]), [[f.lead, 2]], "la riga a zero non resta");
  // Oltre il massimo non si salva niente.
  const tooMany = await store.saveBoardOps(db.exec, scope(), lead(), { baseRevision: 0, ops: [op({ t: "process.vote", processId: P1, mine: 100 })] });
  assert.deepEqual(tooMany, { ok: false, code: "non_valida" });
});

test("gli stream: li corregge solo chi rivede; «Usa gli stream proposti» riporta alla proposta", opts, async () => {
  await q(`UPDATE activities SET classification = 'automatable', confidence_score = 0.7 WHERE id = $1`, [S1]);
  await q(`UPDATE mapping_steps SET proposed_stream = 'automate', classification_reason = 'Lavoro ripetitivo con dati chiari.', ai_potential = 'Si può leggere la richiesta da sola.' WHERE activity_id = $1`, [S1]);
  await q(`UPDATE mapping_steps SET proposed_stream = 'differentiate' WHERE activity_id = $1`, [S2]);
  let board = await read();
  assert.deepEqual([step(board, S1).stream, step(board, S1).proposedStream, step(board, S1).confidence, step(board, S1).reason, step(board, S1).aiPotential], ["automate", "automate", 0.7, "Lavoro ripetitivo con dati chiari.", "Si può leggere la richiesta da sola."]);

  // Un contributore: l'operazione torna «forbidden», niente cambia, la revisione resta.
  const denied = op({ t: "step.stream", stepId: S1, prev: "automate", next: "innovate" });
  const reset = op({ t: "streams.reset" });
  const revision = board.revision;
  board = await save([denied, reset], contributor(), { [denied.id]: "forbidden", [reset.id]: "forbidden" });
  assert.equal(board.revision, revision);
  assert.equal((await activityRow(S1)).classification, "automatable");

  // Chi rivede: il valore di prima («automatable») si legge come Automate, e il confronto lo sa.
  board = await save([op({ t: "step.stream", stepId: S1, prev: "automate", next: "innovate" }), op({ t: "step.stream", stepId: S4, prev: null, next: "automate" })]);
  assert.deepEqual([step(board, S1).stream, step(board, S4).stream], ["innovate", "automate"]);
  const row = await activityRow(S1);
  assert.deepEqual([row.classification, Number(row.confidence_score).toFixed(1)], ["innovate", "0.7"], "la confidenza resta: descrive la proposta");
  // Togliere lo stream: il passo torna da classificare.
  board = await save([op({ t: "step.stream", stepId: S4, prev: "automate", next: null })]);
  assert.equal(step(board, S4).stream, null);

  // «Usa gli stream proposti»: chi ha una proposta ci torna, chi non ce l'ha resta com'è.
  board = await save([op({ t: "streams.reset" })]);
  assert.deepEqual([step(board, S1).stream, step(board, S2).stream, step(board, S4).stream], ["automate", "differentiate", null]);
});

test("board.set: la frase di sintesi", opts, async () => {
  let board = await save([op({ t: "board.set", field: "headline", prev: null, next: "  Il tempo va nei   solleciti. " })]);
  assert.equal(board.headline, "Il tempo va nei solleciti.");
  board = await save([op({ t: "board.set", field: "headline", prev: "Il tempo va nei solleciti.", next: "" })]);
  assert.equal(board.headline, null);
});

test("R3: un campo cambiato da altri è rifiutato, il resto si salva; un campo che ha già il valore nuovo è accettato", opts, async () => {
  const board = await read();
  const title = step(board, S2).title;
  // Qualcun altro cambia il titolo dopo la lettura.
  await q(`UPDATE activities SET title = 'Confronto di tre offerte' WHERE id = $1`, [S2]);
  const stale = op({ t: "step.set", stepId: S2, field: "title", prev: title, next: "Confronto delle offerte ricevute" });
  const fine = op({ t: "step.set", stepId: S2, field: "description", prev: null, next: "Si chiedono tre offerte." });
  const result = await store.saveBoardOps(db.exec, scope(), lead(), { baseRevision: board.revision, ops: [stale, fine] });
  assert.ok(result.ok);
  assert.deepEqual(result.rejected, [{ id: stale.id, reason: "conflict" }]);
  // La board che torna ha i valori più recenti: il titolo dell'altra persona, la descrizione appena salvata.
  assert.deepEqual([step(result.board, S2).title, step(result.board, S2).description], ["Confronto di tre offerte", "Si chiedono tre offerte."]);
  assert.equal(result.revision, board.revision + 1);

  // La stessa modifica mandata due volte (risposta persa): la seconda trova già il valore nuovo e passa.
  const again = op({ t: "step.set", stepId: S2, field: "description", prev: null, next: "Si chiedono tre offerte." });
  await save([again]);
  // Ogni tipo di campo confronta: liste, numeri, parole, note, processi, la frase della board.
  await q(`UPDATE mapping_steps SET who = '["Buyer"]'::jsonb, friction_level = 1 WHERE activity_id = $1`, [S2]);
  await q(`UPDATE activities SET time_spent_hours_week = 2, tools_used = '["Telefono"]'::jsonb WHERE id = $1`, [S2]);
  await q(`UPDATE mapping_processes SET name = 'Nome cambiato da altri' WHERE id = $1`, [P2]);
  await q(`UPDATE mapping_boards SET headline = 'Frase di un''altra persona' WHERE department_id = $1`, [f.unit]);
  const noteId = id();
  await save([op({ t: "note.add", noteId, stepId: S2, lane: "tempi", text: "Due giorni per ogni confronto" })]);
  await q(`UPDATE mapping_notes SET body = 'Tre giorni' WHERE id = $1`, [noteId]);
  const conflicts = [
    op({ t: "step.set", stepId: S2, field: "who", prev: [], next: ["Ufficio tecnico"] }),
    op({ t: "step.set", stepId: S2, field: "friction", prev: null, next: 3 }),
    op({ t: "step.set", stepId: S2, field: "hoursWeek", prev: null, next: 4 }),
    op({ t: "step.set", stepId: S2, field: "tools", prev: [], next: ["E-mail"] }),
    op({ t: "process.set", processId: P2, field: "name", prev: "Dall'ordine alla merce", next: "Consegna" }),
    op({ t: "board.set", field: "headline", prev: null, next: "La mia frase" }),
    op({ t: "note.set", noteId, field: "text", prev: "Due giorni per ogni confronto", next: "Un giorno" }),
    op({ t: "step.stream", stepId: S2, prev: null, next: "innovate" }),
  ];
  const after = await save(conflicts, lead(), Object.fromEntries(conflicts.map((item) => [item.id, "conflict"])));
  assert.deepEqual([step(after, S2).who, step(after, S2).friction, step(after, S2).hoursWeek, step(after, S2).tools, step(after, S2).stream], [["Buyer"], 1, 2, ["Telefono"], "differentiate"]);
  assert.deepEqual([after.processes[1].name, after.headline, step(after, S2).notes.tempi[0].text], ["Nome cambiato da altri", "Frase di un'altra persona", "Tre giorni"]);
  // Con il valore giusto come `prev`, passano.
  await save([
    op({ t: "step.set", stepId: S2, field: "who", prev: ["Buyer"], next: ["Ufficio tecnico"] }),
    op({ t: "step.set", stepId: S2, field: "hoursWeek", prev: 2, next: 4 }),
    op({ t: "process.set", processId: P2, field: "name", prev: "Nome cambiato da altri", next: "Dall'ordine alla merce" }),
    op({ t: "board.set", field: "headline", prev: "Frase di un'altra persona", next: null }),
  ]);
});

test("R2: un bersaglio sparito rifiuta la sua operazione e lascia passare le altre, senza errori", opts, async () => {
  const ghost = id();
  const ops = [
    op({ t: "step.set", stepId: ghost, field: "title", prev: "x", next: "Un titolo" }),
    op({ t: "step.move", stepId: ghost, processId: P1, beforeId: null }),
    op({ t: "step.move", stepId: S1, processId: ghost, beforeId: null }),
    op({ t: "step.remove", stepId: ghost }),
    op({ t: "step.stream", stepId: ghost, prev: null, next: "automate" }),
    op({ t: "step.add", stepId: id(), processId: ghost, title: "Passo in un processo che non c'è" }),
    op({ t: "process.set", processId: ghost, field: "name", prev: "x", next: "Un nome" }),
    op({ t: "process.move", processId: ghost, beforeId: null }),
    op({ t: "process.remove", processId: ghost }),
    op({ t: "process.vote", processId: ghost, mine: 3 }),
    op({ t: "note.add", noteId: id(), stepId: ghost, lane: "attriti", text: "Nota su un passo che non c'è" }),
    op({ t: "note.set", noteId: ghost, field: "text", prev: "x", next: "Un testo" }),
  ];
  const fine = op({ t: "step.set", stepId: S1, field: "input", prev: "La richiesta di un ufficio.", next: "La richiesta di un ufficio, per e-mail." });
  const gone = op({ t: "note.remove", noteId: ghost });
  const counts = await boardCounts(q, [f.ws]);
  const board = await save([...ops, fine, gone], lead(), Object.fromEntries(ops.map((item) => [item.id, "gone"])));
  assert.equal(step(board, S1).input, "La richiesta di un ufficio, per e-mail.");
  assert.deepEqual(await boardCounts(q, [f.ws]), counts);
  // Un passo che dipende da sé stesso o va «prima» di un passo che non c'è: in fondo, senza errori.
  const added = id();
  const placed = await save([op({ t: "step.add", stepId: added, processId: P1, title: "Archivio dell'ordine", beforeId: ghost }), op({ t: "step.move", stepId: S1, processId: P1, beforeId: ghost })]);
  assert.deepEqual(placed.processes[0].steps.map((item) => item.id).slice(-2), [added, S1]);
  await save([op({ t: "step.move", stepId: S1, processId: P1, beforeId: S4 }), op({ t: "step.remove", stepId: added })]);
});

test("R1: un id di un'altra unità o di un altro workspace non tocca niente", opts, async () => {
  // L'altra unità dello stesso workspace ha la sua board; quella dell'altro workspace anche.
  const theirs = { process: id(), step: id(), note: id() };
  await save([op({ t: "process.add", processId: theirs.process, name: "Ricevimento merci" }), op({ t: "step.add", stepId: theirs.step, processId: theirs.process, title: "Controllo dei colli" }), op({ t: "note.add", noteId: theirs.note, stepId: theirs.step, lane: "attriti", text: "Bolle scritte a mano" })], lead(), {}, otherScope());
  const foreign = await insertActivity(q, { ws: f.otherWs, unit: f.foreignUnit }, { title: "Attività di un altro workspace", pain_points: "Non si tocca" });
  const snapshot = async () =>
    JSON.stringify([
      await q(`SELECT to_jsonb(a) AS r FROM activities a WHERE a.department_id = ANY($1::uuid[]) ORDER BY a.id`, [[f.otherUnit, f.foreignUnit]]),
      await q(`SELECT to_jsonb(s) AS r FROM mapping_steps s WHERE s.department_id = ANY($1::uuid[]) ORDER BY s.activity_id`, [[f.otherUnit, f.foreignUnit]]),
      await q(`SELECT to_jsonb(p) AS r FROM mapping_processes p WHERE p.department_id = ANY($1::uuid[]) ORDER BY p.id`, [[f.otherUnit, f.foreignUnit]]),
      await q(`SELECT to_jsonb(n) AS r FROM mapping_notes n WHERE n.department_id = ANY($1::uuid[]) ORDER BY n.id`, [[f.otherUnit, f.foreignUnit]]),
      await q(`SELECT to_jsonb(v) AS r FROM mapping_votes v WHERE v.department_id = ANY($1::uuid[]) ORDER BY v.process_id`, [[f.otherUnit, f.foreignUnit]]),
    ]);
  const before = await snapshot();
  const mine = await boardCounts(q, [f.ws]);

  // Dalla board di «Ufficio acquisti», con gli id dell'altra unità e dell'altro workspace.
  const ops = [
    op({ t: "step.set", stepId: theirs.step, field: "title", prev: "Controllo dei colli", next: "Titolo cambiato da fuori" }),
    op({ t: "step.set", stepId: theirs.step, field: "who", prev: [], next: ["Estraneo"] }),
    op({ t: "step.set", stepId: foreign, field: "title", prev: "Attività di un altro workspace", next: "Titolo cambiato da fuori" }),
    op({ t: "step.remove", stepId: theirs.step }),
    op({ t: "step.remove", stepId: foreign }),
    op({ t: "step.stream", stepId: theirs.step, prev: null, next: "automate" }),
    op({ t: "step.move", stepId: theirs.step, processId: P1, beforeId: null }),
    op({ t: "step.move", stepId: S1, processId: theirs.process, beforeId: null }),
    op({ t: "step.add", stepId: id(), processId: theirs.process, title: "Passo messo da fuori" }),
    op({ t: "step.add", stepId: theirs.step, processId: P1, title: "Un id che esiste già altrove" }),
    op({ t: "process.set", processId: theirs.process, field: "name", prev: "Ricevimento merci", next: "Nome cambiato da fuori" }),
    op({ t: "process.move", processId: theirs.process, beforeId: P1 }),
    op({ t: "process.remove", processId: theirs.process }),
    op({ t: "process.vote", processId: theirs.process, mine: 5 }),
    op({ t: "process.add", processId: theirs.process, name: "Un id che esiste già altrove" }),
    op({ t: "note.add", noteId: id(), stepId: theirs.step, lane: "attriti", text: "Nota messa da fuori" }),
    op({ t: "note.add", noteId: theirs.note, stepId: S1, lane: "attriti", text: "Un id che esiste già altrove" }),
    op({ t: "note.set", noteId: theirs.note, field: "text", prev: "Bolle scritte a mano", next: "Testo cambiato da fuori" }),
  ];
  const quiet = op({ t: "note.remove", noteId: theirs.note });
  await save([...ops, quiet], lead(), Object.fromEntries(ops.map((item) => [item.id, "gone"])));
  assert.equal(await snapshot(), before, "l'altra unità e l'altro workspace sono come prima");
  assert.deepEqual(await boardCounts(q, [f.ws]), mine);
  // «Usa gli stream proposti» vale solo per l'unità in cui si è.
  await q(`UPDATE mapping_steps SET proposed_stream = 'innovate' WHERE activity_id = $1`, [theirs.step]);
  const proposed = await snapshot();
  await save([op({ t: "streams.reset" })]);
  assert.equal(await snapshot(), proposed);

  // Un'unità che non è di quel workspace non si trova, in nessun verso.
  for (const where of [{ workspaceId: f.otherWs, departmentId: f.unit }, { workspaceId: f.ws, departmentId: f.foreignUnit }, { workspaceId: f.ws, departmentId: id() }]) {
    assert.deepEqual(await store.saveBoardOps(db.exec, where, lead(), { baseRevision: 0, ops: [op({ t: "process.add", processId: id(), name: "Da fuori" })] }), { ok: false, code: "non_trovata" });
    assert.equal(await store.resolveProcess(db.exec, where, "Da fuori"), null);
  }
  assert.equal(await snapshot(), proposed);
});

test("R4: la stessa richiesta due volte lascia un passo, una nota, gli stessi voti", opts, async () => {
  const stepId = id();
  const noteId = id();
  const processId = id();
  const ops = [
    op({ t: "process.add", processId, name: "Resi al fornitore" }),
    op({ t: "step.add", stepId, processId, title: "Apertura del reso" }),
    op({ t: "step.set", stepId, field: "description", prev: null, next: "Si compila il modulo di reso." }),
    op({ t: "note.add", noteId, stepId, lane: "attriti", text: "Il modulo è su carta" }),
    op({ t: "process.vote", processId, mine: 4 }),
  ];
  const first = await save(ops);
  const counts = await boardCounts(q, [f.ws]);
  const row = JSON.stringify(await activityRow(stepId));
  // Il browser rimanda la stessa richiesta dopo una risposta persa: niente si rifiuta, niente raddoppia.
  const second = await store.saveBoardOps(db.exec, scope(), lead(), { baseRevision: first.revision - 1, ops });
  assert.ok(second.ok);
  assert.deepEqual(second.rejected, []);
  assert.deepEqual(await boardCounts(q, [f.ws]), counts);
  assert.deepEqual(shape(second.board), shape(first));
  assert.equal(second.revision, first.revision + 1, "la revisione sale a ogni salvataggio");
  assert.equal(JSON.stringify({ ...(await activityRow(stepId)), updated_at: null }), JSON.stringify({ ...JSON.parse(row), updated_at: null }));
  assert.equal(second.board.processes.find((process) => process.id === processId)?.votes, 4);
  // Eliminare due volte: la stessa eliminazione rimandata risponde come la prima volta («ok», il server la ricorda);
  // un'altra eliminazione dello stesso passo lo trova già sparito («gone»). Chi salva non vede mai un errore.
  const remove = op({ t: "step.remove", stepId });
  await save([remove]);
  await save([remove]);
  const again = op({ t: "step.remove", stepId });
  await save([again, op({ t: "process.remove", processId })], lead(), { [again.id]: "gone" });
});

test("eliminare un passo porta via note, riga del passo, dipendenze e nodo della value map; non se uno use case lo elenca", opts, async () => {
  const doomed = id();
  const noteId = id();
  await save([op({ t: "step.add", stepId: doomed, processId: P1, title: "Archivio delle offerte" }), op({ t: "note.add", noteId, stepId: doomed, lane: "dati", text: "Offerte in PDF" })]);
  await q(`INSERT INTO activity_dependencies (source_activity_id, target_activity_id, dependency_type) VALUES ($1, $2, 'input'), ($2, $3, 'handoff')`, [doomed, S1, S4]);
  await q(`INSERT INTO value_map_nodes (workspace_id, activity_id, x_maturity, y_strategic_value) VALUES ($1, $2, 0.4, 0.6)`, [f.ws, doomed]);
  let board = await read();
  assert.deepEqual([step(board, doomed).dependsOn, step(board, S1).neededBy, step(board, S1).dependsOn, step(board, S4).neededBy], [[S1], [doomed], [S4], [S1]]);

  // Uno use case del workspace lo elenca: rifiutato, anche se chi chiede non lo vedrebbe.
  const useCase = id();
  await q(`INSERT INTO use_cases (id, workspace_id, title, source, related_activity_ids) VALUES ($1, $2, 'Lettura delle offerte', 'activity_mapping', $3::jsonb)`, [useCase, f.ws, JSON.stringify([id(), doomed])]);
  const refused = op({ t: "step.remove", stepId: doomed });
  board = await save([refused], contributor(), { [refused.id]: "linked" });
  assert.ok(steps(board).some((item) => item.id === doomed));
  // Uno use case di un altro workspace con lo stesso id nella lista non conta.
  await q(`UPDATE use_cases SET workspace_id = $2 WHERE id = $1`, [useCase, f.otherWs]);
  board = await save([op({ t: "step.remove", stepId: doomed })], contributor());
  assert.ok(!steps(board).some((item) => item.id === doomed));
  const left = async (table: string, column: string) => Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${column} = $1`, [doomed]))[0].n);
  assert.deepEqual(
    [await left("activities", "id"), await left("mapping_steps", "activity_id"), await left("mapping_notes", "activity_id"), await left("activity_dependencies", "source_activity_id"), await left("value_map_nodes", "activity_id")],
    [0, 0, 0, 0, 0],
  );
  assert.deepEqual(step(board, S1).neededBy, []);
  assert.deepEqual(step(board, S1).dependsOn, [S4], "le altre dipendenze restano");
  await q(`DELETE FROM use_cases WHERE id = $1`, [useCase]);
});

test("un processo si elimina solo vuoto", opts, async () => {
  const emptyOne = id();
  await save([op({ t: "process.add", processId: emptyOne, name: "Processo vuoto" })]);
  const full = op({ t: "process.remove", processId: P1 });
  const board = await save([full, op({ t: "process.remove", processId: emptyOne })], lead(), { [full.id]: "gone" });
  assert.ok(board.processes.some((process) => process.id === P1));
  assert.ok(!board.processes.some((process) => process.id === emptyOne));
});

test("come nasce quello che scrivono l'assistente e i documenti: «da validare», «da fonti», con la sua origine", opts, async () => {
  let seq = 0;
  const newId = () => `aaaaaaaa-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const draft = {
    title: "Registrazione della fattura",
    description: "La fattura si registra a mano nel gestionale.",
    who: ["Contabilità", "contabilità", "Buyer"],
    tools: ["Gestionale"],
    input: "La fattura del fornitore.",
    output: "La fattura registrata.",
    decision: "Chi registra decide se la fattura corrisponde all'ordine.",
    decisionLabel: "Fattura conforme",
    exception: "Se l'importo non torna, si scrive al fornitore.",
    friction: 2 as const,
    frequency: "settimanale",
    hoursWeek: 3,
    quality: "Bassa",
    workType: "detection" as const,
    steps: ["Si apre la fattura", "Si cerca l'ordine"],
    frictions: ["Doppia digitazione"],
    data: ["Ordine", "Bolla"],
    times: ["Venti fatture a settimana"],
  };
  const fromChat = opsForNewStep(draft, { processId: P2, afterStepId: S3 }, newId);
  let board = await save(fromChat.ops, lead("assistente"));
  const chatStep = step(board, fromChat.stepId);
  assert.deepEqual(board.processes[1].steps.map((item) => item.id), [S3, fromChat.stepId, S2], "subito dopo il passo indicato");
  assert.deepEqual([chatStep.status, chatStep.origin, chatStep.who, chatStep.friction, chatStep.frictionSet, chatStep.hoursWeek, chatStep.workType], ["da_validare", "chat", ["Contabilità", "Buyer"], 2, true, 3, "detection"]);
  assert.deepEqual(chatStep.notes.attivita.map((note) => [note.text, note.status, note.origin]), [["Si apre la fattura", "fonte", "chat"], ["Si cerca l'ordine", "fonte", "chat"]]);
  const row = await activityRow(fromChat.stepId);
  assert.deepEqual([row.pain_points, row.data_required, row.decision_points, row.work_type], ["Doppia digitazione", "Ordine\nBolla", draft.decision, "detection"]);

  const fromDocs = opsForNewStep({ title: "Pagamento della fattura", frictions: ["Scadenze su un foglio a parte"] }, { processId: P2 }, newId);
  board = await save(fromDocs.ops, contributor("documenti"));
  const docStep = step(board, fromDocs.stepId);
  assert.deepEqual([docStep.status, docStep.origin, docStep.notes.attriti.map((note) => [note.status, note.origin])], ["da_validare", "documenti", [["fonte", "documenti"]]]);
  assert.equal(board.processes[1].steps.at(-1)?.id, fromDocs.stepId, "senza un posto, in fondo");
  // Una persona conferma il passo e valida la nota; tolta la spunta, la nota torna «da fonti», non «ipotesi».
  const note = docStep.notes.attriti[0];
  board = await save([op({ t: "step.set", stepId: docStep.id, field: "status", prev: "da_validare", next: "confermato" }), op({ t: "note.set", noteId: note.id, field: "status", prev: "fonte", next: "validato" })]);
  assert.deepEqual([step(board, docStep.id).status, step(board, docStep.id).notes.attriti[0].status, step(board, docStep.id).notes.attriti[0].origin], ["confermato", "validato", "documenti"]);
});

test("un passo confermato che l'assistente cambia torna «da validare»; l'assistente non conferma, una persona sì", opts, async () => {
  const processId = id();
  const other = id();
  const stepId = id();
  const status = async () => (await q(`SELECT status FROM mapping_steps WHERE activity_id = $1`, [stepId]))[0].status;
  const confirm = () => save([op({ t: "step.set", stepId, field: "status", prev: "da_validare", next: "confermato" })]);
  let board = await save([
    op({ t: "process.add", processId, name: "Rientri dal cliente" }),
    op({ t: "process.add", processId: other, name: "Reclami" }),
    op({ t: "step.add", stepId, processId, title: "Rientro di un collo" }),
  ]);
  try {
    assert.equal(step(board, stepId).status, "confermato", "scritto da una persona: confermato");
    // Un campo di activities, uno della riga del passo, una nota, lo spostamento: ogni volta torna «da validare».
    const changes: Array<[string, BoardOp]> = [
      ["descrizione", op({ t: "step.set", stepId, field: "description", prev: null, next: "Il collo rotto torna al fornitore." })],
      ["ruoli", op({ t: "step.set", stepId, field: "who", prev: [], next: ["Magazzino"] })],
      ["nota", op({ t: "note.add", noteId: id(), stepId, lane: "attriti", text: "Il corriere non passa." })],
      ["spostamento", op({ t: "step.move", stepId, processId: other, beforeId: null })],
    ];
    for (const [label, change] of changes) {
      board = await save([change], lead("assistente"));
      assert.deepEqual([step(board, stepId).status, await status()], ["da_validare", "da_validare"], label);
      board = await confirm();
      assert.equal(step(board, stepId).status, "confermato", `${label}: una persona lo conferma`);
    }
    // L'assistente non conferma un passo: l'operazione esce prima di ogni SQL.
    await save([op({ t: "step.set", stepId, field: "description", prev: "Il collo rotto torna al fornitore.", next: "Il collo torna al fornitore." })], lead("assistente"));
    const denied = op({ t: "step.set", stepId, field: "status", prev: "da_validare", next: "confermato" });
    board = await save([denied], lead("assistente"), { [denied.id]: "forbidden" });
    assert.deepEqual([step(board, stepId).status, await status()], ["da_validare", "da_validare"]);
    await confirm();
    // Un cambio dell'assistente rifiutato (il campo è cambiato nel frattempo) non tocca lo stato.
    const stale = op({ t: "step.set", stepId, field: "description", prev: "Un testo di prima", next: "Un altro testo" });
    board = await save([stale], lead("assistente"), { [stale.id]: "conflict" });
    assert.deepEqual([step(board, stepId).status, await status()], ["confermato", "confermato"]);
  } finally {
    // La board torna com'era per le prove che seguono, anche se una prova sopra non passa.
    await store.saveBoardOps(db.exec, scope(), lead(), {
      baseRevision: 0,
      ops: [op({ t: "step.remove", stepId }), op({ t: "process.remove", processId }), op({ t: "process.remove", processId: other })],
    });
  }
});

test("i limiti: 26 processi, 40 passi per processo, 30 note per corsia, 6 punti di analisi", opts, async () => {
  const g = newFixture();
  await seed(q, g, "limiti");
  const where = { workspaceId: g.ws, departmentId: g.unit };
  const who = { kind: "persona" as const, userId: g.lead, role: "transformation_lead" };
  try {
    const processIds = Array.from({ length: MAPPING_LIMITS.processes }, id);
    let board = await save(processIds.map((processId, index) => op({ t: "process.add", processId, name: `Processo ${index + 1}` })), who, {}, where);
    assert.equal(board.processes.length, 26);
    const extraProcess = op({ t: "process.add", processId: id(), name: "Il ventisettesimo" });
    board = await save([extraProcess], who, { [extraProcess.id]: "limit" }, where);
    assert.equal(board.processes.length, 26);
    assert.equal(await store.resolveProcess(db.exec, where, "Un processo nuovo"), null, "oltre il massimo non ne nasce un altro");

    const stepIds = Array.from({ length: MAPPING_LIMITS.stepsPerProcess }, id);
    board = await save(stepIds.map((stepId, index) => op({ t: "step.add", stepId, processId: processIds[0], title: `Passo ${index + 1}` })), who, {}, where);
    assert.equal(board.processes[0].steps.length, 40);
    const extraStep = op({ t: "step.add", stepId: id(), processId: processIds[0], title: "Il quarantunesimo" });
    const elsewhere = id();
    const move = op({ t: "step.move", stepId: elsewhere, processId: processIds[0], beforeId: null });
    board = await save([extraStep, op({ t: "step.add", stepId: elsewhere, processId: processIds[1], title: "Un passo di un'altra riga" }), move, op({ t: "step.move", stepId: stepIds[39], processId: processIds[0], beforeId: stepIds[0] })], who, { [extraStep.id]: "limit", [move.id]: "limit" }, where);
    assert.deepEqual([board.processes[0].steps.length, board.processes[0].steps[0].id, board.processes[1].steps.length], [40, stepIds[39], 1]);
    assert.equal(Number((await q(`SELECT count(*)::int AS n FROM activities WHERE department_id = $1`, [g.unit]))[0].n), 41, "il passo rifiutato non ha lasciato un'attività");

    const noteOps = Array.from({ length: MAPPING_LIMITS.notesPerLane }, (_, index) => op({ t: "note.add", noteId: id(), stepId: stepIds[0], lane: "attivita", text: `Nota ${index + 1}` }));
    await save(noteOps, who, {}, where);
    const extraNote = op({ t: "note.add", noteId: id(), stepId: stepIds[0], lane: "attivita", text: "La trentunesima" });
    const otherLane = op({ t: "note.add", noteId: id(), stepId: stepIds[0], lane: "tempi", text: "Un'altra corsia ha ancora posto" });
    board = await save([extraNote, otherLane], who, { [extraNote.id]: "limit" }, where);
    assert.deepEqual([step(board, stepIds[0]).notes.attivita.length, step(board, stepIds[0]).notes.tempi.length], [30, 1]);

    await save(Array.from({ length: MAPPING_LIMITS.analysisPoints }, (_, index) => op({ t: "note.add", noteId: id(), stepId: null, lane: "analisi", title: `Punto ${index + 1}`, text: "Che cosa emerge." })), who, {}, where);
    const extraPoint = op({ t: "note.add", noteId: id(), stepId: null, lane: "analisi", text: "Il settimo punto" });
    board = await save([extraPoint], who, { [extraPoint.id]: "limit" }, where);
    assert.equal(board.analysis.length, 6);

    // 200 passi per unità: gli altri 159 con un'attività ciascuno (adottate alla lettura), poi il duecentunesimo.
    for (let index = 0; index < MAPPING_LIMITS.stepsPerUnit - 41; index++) await insertActivity(q, { ws: g.ws, unit: g.unit }, { title: `Attività di prima ${index + 1}` });
    await q(`UPDATE mapping_steps SET process_id = $1 WHERE department_id = $2 AND process_id = $3 AND position > 20`, [processIds[2], g.unit, processIds[0]]);
    board = await read(who, where);
    assert.equal(steps(board).length, 200);
    const overUnit = op({ t: "step.add", stepId: id(), processId: processIds[3], title: "Il duecentunesimo" });
    board = await save([overUnit], who, { [overUnit.id]: "limit" }, where);
    assert.equal(steps(board).length, 200);
  } finally {
    await unseed(q, g);
  }
});

test("un processo che l'adozione ha riempito oltre 40 passi: i suoi passi si riordinano nella riga; da un'altra riga non entra nessuno", opts, async () => {
  const g = newFixture();
  await seed(q, g, "riga-lunga");
  const where = { workspaceId: g.ws, departmentId: g.unit };
  const who = { kind: "persona" as const, userId: g.lead, role: "transformation_lead" };
  try {
    // 41 attività scritte prima della board: l'adozione le mette tutte in «Processo principale».
    for (let index = 0; index < MAPPING_LIMITS.stepsPerProcess + 1; index++) await insertActivity(q, { ws: g.ws, unit: g.unit }, { title: `Attività ${index + 1}`, minutesAgo: 100 - index });
    let board = await read(who, where);
    assert.deepEqual([board.processes.length, board.processes[0].steps.length], [1, 41]);
    const row = board.processes[0];
    const fifth = row.steps[4].id;
    // Il quinto passo prima del quarto, poi l'ultimo in testa: dentro la sua riga, ogni spostamento passa.
    board = await save([op({ t: "step.move", stepId: fifth, processId: row.id, beforeId: row.steps[3].id })], who, {}, where);
    assert.equal(board.processes[0].steps[3].id, fifth);
    board = await save([op({ t: "step.move", stepId: row.steps[40].id, processId: row.id, beforeId: row.steps[0].id })], who, {}, where);
    assert.deepEqual([board.processes[0].steps[0].id, board.processes[0].steps.length], [row.steps[40].id, 41]);
    // Da un'altra riga il limite resta: la riga piena non prende un passo in più.
    const other = id();
    const outside = id();
    board = await save([op({ t: "process.add", processId: other, name: "Un altro processo" }), op({ t: "step.add", stepId: outside, processId: other, title: "Un passo fuori" })], who, {}, where);
    const enter = op({ t: "step.move", stepId: outside, processId: row.id, beforeId: null });
    board = await save([enter], who, { [enter.id]: "limit" }, where);
    assert.deepEqual([board.processes[0].steps.length, board.processes[1].steps.length], [41, 1]);
    assert.deepEqual(await positions("mapping_steps", "department_id = $1 AND process_id = $2", [g.unit, row.id]), Array.from({ length: 41 }, (_, index) => index + 1));
  } finally {
    await unseed(q, g);
  }
});

test("un salvataggio non valido o troppo grande non scrive niente", opts, async () => {
  const counts = await boardCounts(q, [f.ws]);
  const revision = (await read()).revision;
  const bad: unknown[] = [
    { id: id(), t: "step.set", stepId: S1, field: "title", prev: "x", next: "" },
    { id: id(), t: "step.set", stepId: S1, field: "title", prev: "x", next: "a".repeat(MAPPING_LIMITS.title + 1) },
    { id: id(), t: "step.set", stepId: S1, field: "hoursWeek", prev: null, next: 169 },
    { id: id(), t: "step.set", stepId: S1, field: "workType", prev: null, next: "altro" },
    { id: id(), t: "step.set", stepId: S1, field: "colonna", prev: null, next: "x" },
    { id: id(), t: "step.add", stepId: "non-un-id", processId: P1, title: "Titolo" },
    { id: id(), t: "note.add", noteId: id(), stepId: S1, lane: "analisi", text: "Un punto di analisi con un passo" },
    { id: id(), t: "note.add", noteId: id(), stepId: null, lane: "attriti", text: "Una nota senza passo" },
    { id: id(), t: "note.add", noteId: id(), stepId: S1, lane: "attriti", title: "Titolo", text: "Una nota di un passo con un titolo" },
    { id: id(), t: "tabella.drop" },
    { id: id(), t: "step.remove", stepId: S1, altro: true },
  ];
  for (const item of bad) {
    const result = await store.saveBoardOps(db.exec, scope(), lead(), { baseRevision: revision, ops: [item as BoardOp] });
    assert.deepEqual(result, { ok: false, code: "non_valida" }, JSON.stringify(item));
  }
  const many = Array.from({ length: MAPPING_LIMITS.opsPerSave + 1 }, () => op({ t: "process.vote", processId: P1, mine: 1 }));
  assert.deepEqual(await store.saveBoardOps(db.exec, scope(), lead(), { baseRevision: revision, ops: many }), { ok: false, code: "troppe_modifiche" });
  assert.deepEqual(await store.saveBoardOps(db.exec, scope(), lead(), { baseRevision: -1, ops: [] }), { ok: false, code: "non_valida" });
  assert.deepEqual(await boardCounts(q, [f.ws]), counts);
  assert.equal((await read()).revision, revision);
  // Chi segue solo un corso non scrive: ogni operazione torna «forbidden», senza SQL.
  const denied = op({ t: "process.vote", processId: P1, mine: 9 });
  const result = await store.saveBoardOps(db.exec, scope(), { kind: "persona", userId: f.contributor, role: "learner" }, { baseRevision: revision, ops: [denied] });
  assert.ok(result.ok);
  assert.deepEqual([result.rejected, result.revision], [[{ id: denied.id, reason: "forbidden" }], revision]);
});

test("resolveProcess: per nome senza badare a maiuscole e spazi, uno nuovo in fondo, senza nome il primo", opts, async () => {
  const board = await read();
  assert.equal(await store.resolveProcess(db.exec, scope(), "  dalla RICHIESTA   all'ordine "), P1);
  assert.equal(await store.resolveProcess(db.exec, scope(), null), board.processes[0].id);
  assert.equal(await store.resolveProcess(db.exec, scope(), "   "), board.processes[0].id);
  // Un nome nuovo: nasce in fondo. Chiesto tre volte insieme (tre tool nello stesso passo del modello), ne nasce uno.
  const created = await Promise.all([store.resolveProcess(db.exec, scope(), "Pagamenti ai fornitori"), store.resolveProcess(db.exec, scope(), "Pagamenti ai fornitori"), store.resolveProcess(db.exec, scope(), "pagamenti ai  fornitori")]);
  assert.ok(created[0]);
  assert.deepEqual(new Set(created).size, 1);
  const after = await read();
  assert.deepEqual([after.processes.length, after.processes.at(-1)?.id, after.processes.at(-1)?.name], [board.processes.length + 1, created[0], "Pagamenti ai fornitori"]);
  assert.equal(await store.resolveProcess(db.exec, scope(), "Pagamenti ai fornitori"), created[0]);
  // Su un'unità senza processi: «Processo principale», con l'id che dipende solo dall'unità.
  const g = newFixture();
  await seed(q, g, "processi");
  try {
    const where = { workspaceId: g.ws, departmentId: g.unit };
    const [a, b] = await Promise.all([store.resolveProcess(db.exec, where, null), store.resolveProcess(db.exec, where, null)]);
    assert.deepEqual([a, b], [store.defaultProcessId(g.unit), store.defaultProcessId(g.unit)]);
    const fresh = await read({ kind: "persona", userId: g.lead, role: "analyst" }, where);
    assert.deepEqual(fresh.processes.map((process) => process.name), ["Processo principale"]);
  } finally {
    await unseed(q, g);
  }
});

test("resolveProcess: un processo eliminato e chiesto di nuovo con lo stesso nome rinasce, e il passo dell'assistente ci entra", opts, async () => {
  // Il server ricorda le operazioni applicate (R4): con un id d'operazione che dipende dal processo, la seconda
  // `process.add` sarebbe «già fatta» e non scriverebbe niente; il processo non rinascerebbe e il passo andrebbe perso.
  const name = "Resi ai fornitori";
  const first = await store.resolveProcess(db.exec, scope(), name);
  assert.ok(first);
  assert.ok((await read()).processes.some((process) => process.id === first));
  await save([op({ t: "process.remove", processId: first })]);
  assert.ok(!(await read()).processes.some((process) => process.id === first), "eliminato");

  const again = await store.resolveProcess(db.exec, scope(), name);
  assert.equal(again, first, "lo stesso nome dà lo stesso processo");
  const board = await read();
  assert.deepEqual(board.processes.filter((process) => process.id === again).map((process) => [process.name, process.steps.length]), [[name, 0]], "il processo c'è di nuovo");
  const stepId = id();
  const added = await save([op({ t: "step.add", stepId, processId: first, title: "Reso di un collo danneggiato" })], lead("assistente"));
  assert.deepEqual(added.processes.find((process) => process.id === first)?.steps.map((item) => item.id), [stepId]);
  // La board torna com'era per le prove che seguono.
  await save([op({ t: "step.remove", stepId }), op({ t: "process.remove", processId: first })]);
});

test("readBoardSince: «unchanged» con la stessa revisione, la board se è cambiata o se un'attività è appena entrata", opts, async () => {
  const board = await read();
  assert.deepEqual(await store.readBoardSince(db.exec, scope(), lead(), board.revision), { unchanged: true, revision: board.revision });
  const older = await store.readBoardSince(db.exec, scope(), lead(), board.revision - 1);
  assert.ok(older && !older.unchanged && older.board.revision === board.revision);
  const fresh = await store.readBoardSince(db.exec, scope(), lead(), null);
  assert.ok(fresh && !fresh.unchanged);
  // Un'attività scritta dal codice di prima non alza la revisione: si vede perché viene adottata adesso.
  const late = await insertActivity(q, f, { title: "Attività scritta dal codice di prima" });
  const adopted = await store.readBoardSince(db.exec, scope(), lead(), board.revision);
  assert.ok(adopted && !adopted.unchanged);
  assert.ok(steps(adopted.board).some((item) => item.id === late));
  assert.equal(adopted.board.revision, board.revision);
  assert.equal(await store.readBoardSince(db.exec, { workspaceId: f.otherWs, departmentId: f.unit }, lead(), 0), null);
});
