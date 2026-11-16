import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { boardCounts, connect, enabled, insertActivity, newFixture, opts, seed, unseed, type Connection, type Row } from "./integration-kit.ts";
import type { BoardStep, MappingBoard } from "./board-model.ts";
import { MAPPING_LIMITS } from "./vocab.ts";

// L'adozione sul database del pacchetto (docs/mappatura/MAPPATURA-BOARD-PIANO.md §3.5, §8.2): le attività di prima
// compaiono sulla board **senza perdere niente**.
// - attività con ogni colonna riempita, classificazioni di prima comprese, e dipendenze: dopo `readBoard` ogni valore è
//   nel modello di lettura, e le righe di `activities` sono quelle di prima, byte per byte (`to_jsonb`);
// - l'ordine segue le dipendenze; una seconda lettura non adotta niente; due letture insieme scrivono ogni nota una
//   volta; un'attività inserita dopo con SQL semplice è adottata alla lettura seguente; un'attività con il workspace
//   sbagliato non si legge;
// - senza la 0039 la board si legge lo stesso, dalle sole attività, e niente si può scrivere.
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui.

const f = newFixture();
let db: Connection;
let q: Connection["q"];
let store: typeof import("./board-store.ts");
const scope = () => ({ workspaceId: f.ws, departmentId: f.unit });
const viewer = () => ({ userId: f.lead, role: "transformation_lead" });
const ids: Record<string, string> = {};

/** Le attività di «Ufficio acquisti», in ordine di creazione: una per ogni valore che `classification` può tenere. */
const ACTIVITIES: Array<{ key: string; title: string; classification: string | null; stream: string | null }> = [
  { key: "richieste", title: "Raccolta delle richieste", classification: "automatable", stream: "automate" },
  { key: "confronto", title: "Confronto delle offerte", classification: "differentiating", stream: "differentiate" },
  { key: "scelta", title: "Scelta del fornitore", classification: "emerging_opportunity", stream: "innovate" },
  { key: "ordine", title: "Invio dell'ordine", classification: "automate", stream: "automate" },
  { key: "solleciti", title: "Solleciti di consegna", classification: "blocked_by_system", stream: "automate" },
  { key: "controllo", title: "Controllo della merce", classification: "blocked_by_governance", stream: "automate" },
  { key: "trattativa", title: "Trattativa sui prezzi", classification: "differentiate", stream: "differentiate" },
  { key: "valutazione", title: "Valutazione dei fornitori", classification: "augmentable", stream: "differentiate" },
  { key: "mercati", title: "Ricerca di nuovi mercati", classification: "innovate", stream: "innovate" },
  { key: "archivio", title: "Archivio dei contratti", classification: null, stream: null },
];

const FULL = {
  description: "Le richieste arrivano per e-mail e si copiano in un foglio.",
  work_type: "enrichment",
  confidence_score: 0.8,
  frequency: "giornaliera",
  time_spent_hours_week: 6.5,
  tools_used: ["E-mail", "Foglio di calcolo"],
  input_description: "La richiesta di un ufficio.",
  output_description: "Una riga nel foglio delle richieste.",
  decision_points: "Chi compra decide se la richiesta è completa.",
  dependencies: ["nota di prima"],
  pain_points: "Richieste incomplete",
  data_required: "Elenco dei fornitori",
  quality_perceived: "Media",
  onet_task_id: "13-1023.00",
  onet_match_score: 0.7,
  ai_exposure_score: 0.25,
};

const snapshot = async () => (await q(`SELECT a.id, to_jsonb(a) AS row FROM activities a WHERE a.department_id = $1 ORDER BY a.id`, [f.unit])).map((r: Row) => JSON.stringify(r));
const steps = (board: MappingBoard): BoardStep[] => board.processes.flatMap((process) => process.steps);
const stepOf = (board: MappingBoard, key: string): BoardStep => {
  const step = steps(board).find((item) => item.id === ids[key]);
  assert.ok(step, `manca il passo ${key}`);
  return step;
};

before(async () => {
  if (!enabled) return;
  db = await connect();
  q = db.q;
  store = await import("./board-store.ts");
  await seed(q, f, "adozione");
  for (const [index, activity] of ACTIVITIES.entries()) {
    ids[activity.key] = await insertActivity(q, f, { title: activity.title, minutesAgo: 60 - index, ...FULL, classification: activity.classification });
  }
  // L'ultima non ha quasi niente: solo il titolo e due testi fatti di spazi.
  await q(`UPDATE activities SET description = NULL, work_type = NULL, confidence_score = NULL, frequency = NULL, time_spent_hours_week = NULL, tools_used = NULL, input_description = NULL,
             output_description = NULL, decision_points = NULL, dependencies = NULL, pain_points = '   ', data_required = '', quality_perceived = NULL, onet_task_id = NULL, onet_match_score = NULL,
             ai_exposure_score = NULL WHERE id = $1`, [ids.archivio]);
  // «Confronto» (creata prima) dipende da «Scelta» (creata dopo); «Ordine» da «Scelta»: l'ordine deve seguirle.
  await q(`INSERT INTO activity_dependencies (source_activity_id, target_activity_id, dependency_type) VALUES ($1, $2, 'input'), ($3, $2, 'approval')`, [ids.confronto, ids.scelta, ids.ordine]);
  // Un'attività con il workspace sbagliato (nessuna in produzione): la board non la legge.
  ids.fuori = await insertActivity(q, f, { title: "Attività con il workspace sbagliato", ws: f.otherWs });
});

after(async () => {
  if (!enabled) return;
  await db.ensure.runMappingBoardDdl();
  await unseed(q, f);
});

test("nessuna perdita: ogni valore delle attività di prima è sulla board, e le righe di activities non cambiano", opts, async () => {
  const beforeRows = await snapshot();
  assert.deepEqual(await boardCounts(q, [f.ws]), { mapping_boards: 0, mapping_processes: 0, mapping_steps: 0, mapping_notes: 0, mapping_votes: 0 });

  const board = await store.readBoard(db.exec, scope(), viewer());
  assert.ok(board);
  assert.deepEqual(await snapshot(), beforeRows, "le righe di activities sono quelle di prima");

  assert.equal(board.store, "pronto");
  assert.deepEqual(board.unit, { id: f.unit, name: "Ufficio acquisti", description: "Compra materiali e servizi per gli altri uffici.", teamSize: 6, status: "in_progress" });
  assert.equal((await q(`SELECT mapping_status::text AS s FROM departments WHERE id = $1`, [f.unit]))[0].s, "not_started", "l'adozione non scrive lo stato dell'unità");
  // L'adozione non alza la revisione: la board non risulta salvata.
  assert.equal(board.revision, 0);
  assert.equal(board.savedAt, null);
  assert.deepEqual(board.can, { edit: true, setStream: true, complete: true });
  assert.equal(board.headline, null);
  assert.deepEqual(board.analysis, []);
  assert.deepEqual(board.useCases, []);

  // Un processo solo, «Processo principale», con le dieci attività; quella con il workspace sbagliato non c'è.
  assert.equal(board.processes.length, 1);
  assert.deepEqual([board.processes[0].name, board.processes[0].owner, board.processes[0].votes, board.processes[0].myVotes], ["Processo principale", null, 0, 0]);
  assert.equal(steps(board).length, ACTIVITIES.length);
  assert.ok(!steps(board).some((step) => step.id === ids.fuori));

  // L'ordine di creazione, spostato quanto serve: «Confronto» e «Ordine» vengono dopo «Scelta».
  assert.deepEqual(
    steps(board).map((step) => step.title),
    ["Raccolta delle richieste", "Scelta del fornitore", "Confronto delle offerte", "Invio dell'ordine", "Solleciti di consegna", "Controllo della merce", "Trattativa sui prezzi", "Valutazione dei fornitori", "Ricerca di nuovi mercati", "Archivio dei contratti"],
  );

  for (const activity of ACTIVITIES.slice(0, 9)) {
    const step = stepOf(board, activity.key);
    assert.deepEqual(
      {
        title: step.title,
        description: step.description,
        tools: step.tools,
        input: step.input,
        output: step.output,
        decision: step.decision,
        frequency: step.frequency,
        hoursWeek: step.hoursWeek,
        quality: step.quality,
        workType: step.workType,
        stream: step.stream,
        confidence: step.confidence,
        onetCode: step.onetCode,
        aiExposure: step.aiExposure,
      },
      {
        title: activity.title,
        description: FULL.description,
        tools: FULL.tools_used,
        input: FULL.input_description,
        output: FULL.output_description,
        decision: FULL.decision_points,
        frequency: FULL.frequency,
        hoursWeek: FULL.time_spent_hours_week,
        quality: FULL.quality_perceived,
        workType: FULL.work_type,
        stream: activity.stream,
        confidence: 0.8,
        onetCode: FULL.onet_task_id,
        aiExposure: FULL.ai_exposure_score,
      },
      activity.key,
    );
    // Quello che la board aggiunge nasce vuoto, «da validare», con l'origine «prima della board».
    assert.deepEqual([step.who, step.decisionLabel, step.exception, step.status, step.origin, step.proposedStream, step.reason, step.aiPotential, step.onetTitle], [[], null, null, "da_validare", "prima", null, null, null, null]);
    // «Attriti» e «Dati e documenti» dalle colonne di sempre: una nota «da fonti» ciascuna, con l'id che dipende solo da attività e corsia.
    assert.deepEqual(step.notes.attriti, [{ id: store.adoptedNoteId(step.id, "attriti"), lane: "attriti", title: null, text: FULL.pain_points, status: "fonte", origin: "prima" }]);
    assert.deepEqual(step.notes.dati, [{ id: store.adoptedNoteId(step.id, "dati"), lane: "dati", title: null, text: FULL.data_required, status: "fonte", origin: "prima" }]);
    assert.deepEqual([step.notes.attivita, step.notes.tempi, step.notes.idee], [[], [], []]);
    // Un attrito scritto e nessun livello scelto: si mostra «medio».
    assert.deepEqual([step.friction, step.frictionSet], [2, false]);
  }

  // L'attività quasi vuota: niente note da testi fatti di spazi, nessun attrito, nessuno stream.
  const bare = stepOf(board, "archivio");
  assert.deepEqual(
    [bare.title, bare.description, bare.tools, bare.input, bare.output, bare.decision, bare.frequency, bare.hoursWeek, bare.quality, bare.workType, bare.stream, bare.confidence, bare.onetCode, bare.aiExposure],
    ["Archivio dei contratti", null, [], null, null, null, null, null, null, null, null, null, null, null],
  );
  assert.deepEqual([bare.notes.attriti, bare.notes.dati, bare.friction, bare.frictionSet], [[], [], 0, false]);

  // Le dipendenze tra passi dell'unità, nei due versi.
  assert.deepEqual(stepOf(board, "confronto").dependsOn, [ids.scelta]);
  assert.deepEqual(stepOf(board, "ordine").dependsOn, [ids.scelta]);
  assert.deepEqual([...stepOf(board, "scelta").neededBy].sort(), [ids.confronto, ids.ordine].sort());
  assert.deepEqual(stepOf(board, "richieste").dependsOn, []);

  // Nel database: l'id di «Processo principale» dipende solo dall'unità; le posizioni vanno da 1 a 10.
  const [process] = await q(`SELECT id, position FROM mapping_processes WHERE department_id = $1`, [f.unit]);
  assert.equal(process.id, store.defaultProcessId(f.unit));
  const positions = await q(`SELECT position FROM mapping_steps WHERE department_id = $1 ORDER BY position`, [f.unit]);
  assert.deepEqual(positions.map((r: Row) => Number(r.position)), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(await boardCounts(q, [f.ws]), { mapping_boards: 1, mapping_processes: 1, mapping_steps: 10, mapping_notes: 18, mapping_votes: 0 });
  assert.equal((await q(`SELECT count(*)::int AS n FROM mapping_steps WHERE activity_id = $1`, [ids.fuori]))[0].n, 0, "il workspace sbagliato non si adotta");
});

test("una seconda lettura non adotta niente; chi contribuisce legge la stessa board senza poter correggere gli stream", opts, async () => {
  const rows = await snapshot();
  const counts = await boardCounts(q, [f.ws]);
  assert.deepEqual(await store.adoptUnit(db.exec, scope()), { adopted: 0 });
  const board = await store.readBoard(db.exec, scope(), { userId: f.contributor, role: "contributor" });
  assert.ok(board);
  assert.deepEqual(board.can, { edit: true, setStream: false, complete: true });
  assert.equal(steps(board).length, ACTIVITIES.length);
  assert.deepEqual(await boardCounts(q, [f.ws]), counts);
  assert.deepEqual(await snapshot(), rows);
  assert.equal(board.revision, 0);
  // Chi segue solo un corso non ha permessi; l'unità di un altro workspace non si trova.
  assert.deepEqual((await store.readBoard(db.exec, scope(), { userId: f.contributor, role: "learner" }))?.can, { edit: false, setStream: false, complete: false });
  assert.equal(await store.readBoard(db.exec, { workspaceId: f.otherWs, departmentId: f.unit }, viewer()), null);
  assert.equal(await store.readBoard(db.exec, { workspaceId: f.ws, departmentId: f.foreignUnit }, viewer()), null);
  assert.equal(await store.readBoard(db.exec, { workspaceId: f.ws, departmentId: "non-un-id" }, viewer()), null);
});

test("un'attività inserita dopo con SQL semplice è adottata alla lettura seguente, in fondo", opts, async () => {
  ids.resi = await insertActivity(q, f, { title: "Gestione dei resi", pain_points: "Tre passaggi a mano", data_required: null });
  const rows = await snapshot();
  const board = await store.readBoard(db.exec, scope(), viewer());
  assert.ok(board);
  assert.deepEqual(await snapshot(), rows);
  const last = steps(board).at(-1)!;
  assert.deepEqual([last.id, last.title, last.status, last.origin], [ids.resi, "Gestione dei resi", "da_validare", "prima"]);
  assert.deepEqual(last.notes.attriti.map((note) => note.text), ["Tre passaggi a mano"]);
  assert.deepEqual(last.notes.dati, []);
  assert.equal(steps(board).length, ACTIVITIES.length + 1);
  assert.equal(board.revision, 0);
});

test("due letture insieme scrivono ogni passo, ogni nota e il processo una volta sola", opts, async () => {
  const first = await insertActivity(q, { ws: f.ws, unit: f.otherUnit }, { title: "Ricevimento della merce", pain_points: "Bolle scritte a mano", data_required: "Ordini aperti", minutesAgo: 2 });
  const second = await insertActivity(q, { ws: f.ws, unit: f.otherUnit }, { title: "Sistemazione a scaffale", minutesAgo: 1 });
  const other = { workspaceId: f.ws, departmentId: f.otherUnit };
  const boards = await Promise.all([store.readBoard(db.exec, other, viewer()), store.readBoard(db.exec, other, viewer()), store.readBoard(db.exec, other, viewer())]);
  for (const board of boards) {
    assert.ok(board);
    assert.equal(board.processes.length, 1);
  }
  const counts = async (table: string) => Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE department_id = $1`, [f.otherUnit]))[0].n);
  assert.deepEqual([await counts("mapping_boards"), await counts("mapping_processes"), await counts("mapping_steps"), await counts("mapping_notes")], [1, 1, 2, 2]);
  const board = await store.readBoard(db.exec, other, viewer());
  assert.deepEqual(board?.processes[0].steps.map((step) => step.id), [first, second]);
  assert.deepEqual(board?.processes[0].steps[0].notes.attriti.map((note) => note.id), [store.adoptedNoteId(first, "attriti")]);
});

test("un passo rimasto senza processo torna nel primo alla lettura seguente", opts, async () => {
  const extra = "0f0e0d0c-0b0a-4a0b-8c0d-0e0f0a0b0c0d";
  await q(`INSERT INTO mapping_processes (id, workspace_id, department_id, name, position) VALUES ($1, $2, $3, 'Processo che sparisce', 2)`, [extra, f.ws, f.otherUnit]);
  const [moved] = await q(`UPDATE mapping_steps SET process_id = $1, position = 1 WHERE department_id = $2 AND activity_id = (SELECT activity_id FROM mapping_steps WHERE department_id = $2 ORDER BY position DESC LIMIT 1) RETURNING activity_id`, [extra, f.otherUnit]);
  await q(`DELETE FROM mapping_processes WHERE id = $1`, [extra]);
  assert.equal((await q(`SELECT process_id FROM mapping_steps WHERE activity_id = $1`, [moved.activity_id]))[0].process_id, null);
  const board = await store.readBoard(db.exec, { workspaceId: f.ws, departmentId: f.otherUnit }, viewer());
  assert.ok(board);
  assert.equal(board.processes.length, 1);
  assert.deepEqual(board.processes[0].steps.map((step) => step.id).at(-1), moved.activity_id, "in fondo al primo processo");
  assert.equal((await q(`SELECT process_id FROM mapping_steps WHERE activity_id = $1`, [moved.activity_id]))[0].process_id, store.defaultProcessId(f.otherUnit));
});

test("«Attriti» e «Dati e documenti» più lunghi di una nota entrano interi, in più note; una nota aggiunta dopo non taglia la colonna", opts, async () => {
  const g = newFixture();
  await seed(q, g, "testi-lunghi");
  const where = { workspaceId: g.ws, departmentId: g.unit };
  const who = { kind: "persona" as const, userId: g.lead, role: "transformation_lead" };
  try {
    // Un testo di prima su più righe (circa 3.200 caratteri) e uno di una riga sola più lunga di una nota.
    const pain = [...Array.from({ length: 30 }, (_, index) => `Punto ${index + 1}: le richieste arrivano per e-mail, per telefono e a voce, e ognuna va ricopiata nel foglio.`), "FINE DEGLI ATTRITI"].join("\n");
    const data = `${"Ordini aperti, bolle, listini e contratti dei fornitori; ".repeat(45)}FINE DEI DATI`;
    assert.ok(pain.length > MAPPING_LIMITS.note && data.length > MAPPING_LIMITS.note);
    const activityId = await insertActivity(q, { ws: g.ws, unit: g.unit }, { title: "Smistamento delle richieste", pain_points: pain, data_required: data });
    const board = await store.readBoard(db.exec, where, who);
    assert.ok(board);
    const step = steps(board).find((item) => item.id === activityId);
    assert.ok(step);
    // Più note per corsia, ognuna entro il limite, «da fonti», «prima della board»; la prima con l'id di sempre.
    assert.equal(step.notes.attriti.length, 2);
    assert.equal(step.notes.dati.length, 2);
    for (const note of [...step.notes.attriti, ...step.notes.dati]) {
      assert.ok(note.text.length <= MAPPING_LIMITS.note, `${note.text.length} caratteri`);
      assert.deepEqual([note.status, note.origin], ["fonte", "prima"]);
    }
    assert.equal(step.notes.attriti[0].id, store.adoptedNoteId(activityId, "attriti"));
    assert.equal(step.notes.dati[0].id, store.adoptedNoteId(activityId, "dati"));
    // Unite come le ricopia la coda, le note ridanno il testo: per righe, esatto; una riga troppo lunga, con un a capo in più.
    assert.equal(step.notes.attriti.map((note) => note.text).join("\n"), pain);
    assert.equal(step.notes.dati.map((note) => note.text).join("").replace(/\s/g, ""), data.replace(/\s/g, ""));
    // Una nota aggiunta in ogni corsia: le colonne di sempre tengono il testo intero, con la nota nuova in fondo.
    const saved = await store.saveBoardOps(db.exec, where, who, {
      baseRevision: board.revision,
      ops: [
        { id: randomUUID(), t: "note.add", noteId: randomUUID(), stepId: activityId, lane: "attriti", text: "Nessun modulo unico." },
        { id: randomUUID(), t: "note.add", noteId: randomUUID(), stepId: activityId, lane: "dati", text: "Anche le fatture." },
      ],
    });
    assert.ok(saved.ok && saved.rejected.length === 0);
    const [row] = await q(`SELECT pain_points, data_required FROM activities WHERE id = $1`, [activityId]);
    assert.equal(row.pain_points, `${pain}\nNessun modulo unico.`);
    assert.ok(String(row.data_required).endsWith("FINE DEI DATI\nAnche le fatture."));
    assert.equal(String(row.data_required).replace(/\s/g, ""), `${data}Anche le fatture.`.replace(/\s/g, ""));
  } finally {
    await unseed(q, g);
  }
});

test("un testo di prima con un'emoji a cavallo del 2000° carattere: la board si apre e si salva, l'emoji resta intera", opts, async () => {
  const g = newFixture();
  await seed(q, g, "emoji");
  const where = { workspaceId: g.ws, departmentId: g.unit };
  const who = { kind: "persona" as const, userId: g.lead, role: "transformation_lead" };
  try {
    const emoji = "\u{1F600}";
    const pain = `${"a".repeat(MAPPING_LIMITS.note - 1)}${emoji}${" e poi il resto del testo".repeat(20)}`;
    const activityId = await insertActivity(q, { ws: g.ws, unit: g.unit }, { title: "Passo con un testo lungo", pain_points: pain });
    // Prima: il pezzo tagliato a metà dell'emoji faceva fallire l'adozione, e con lei ogni lettura e salvataggio dell'unità.
    const board = await store.readBoard(db.exec, where, who);
    assert.ok(board);
    const notes = steps(board).find((item) => item.id === activityId)?.notes.attriti.map((note) => note.text) ?? [];
    assert.deepEqual(notes.map((text) => text.length), [MAPPING_LIMITS.note - 1, pain.length - (MAPPING_LIMITS.note - 1)]);
    assert.ok(notes[1].startsWith(emoji));
    assert.equal(notes.join("").replace(/\s/g, ""), pain.replace(/\s/g, ""));
    const saved = await store.saveBoardOps(db.exec, where, who, { baseRevision: board.revision, ops: [{ id: randomUUID(), t: "board.set", field: "headline", prev: null, next: "Prova" }] });
    assert.ok(saved.ok && saved.rejected.length === 0);
    // La colonna di prima non cambia con l'adozione.
    assert.equal((await q(`SELECT pain_points FROM activities WHERE id = $1`, [activityId]))[0].pain_points, pain);
  } finally {
    await unseed(q, g);
  }
});

test("senza la 0039 la board si legge dalle sole attività, in sola lettura, e niente si scrive", opts, async () => {
  const withStore = await store.readBoard(db.exec, scope(), viewer());
  assert.ok(withStore);
  await q(`DROP INDEX mapping_votes_user_idx`);
  try {
    assert.equal(await store.mappingStoreReady(db.exec), false);
    const counts = await boardCounts(q, [f.ws]);
    const board = await store.readBoard(db.exec, scope(), viewer());
    assert.ok(board);
    assert.equal(board.store, "mancante");
    assert.deepEqual(board.can, { edit: false, setStream: false, complete: false });
    assert.deepEqual([board.revision, board.savedAt], [0, null]);
    // Gli stessi passi, nello stesso ordine, in una riga sola con lo stesso id; le note dalle colonne, con gli stessi id.
    assert.equal(board.processes.length, 1);
    assert.deepEqual([board.processes[0].id, board.processes[0].name], [store.defaultProcessId(f.unit), "Processo principale"]);
    assert.deepEqual(steps(board).map((step) => step.id), steps(withStore).map((step) => step.id));
    for (const step of steps(board)) {
      const same: BoardStep = steps(withStore).find((item) => item.id === step.id)!;
      assert.deepEqual([step.title, step.description, step.tools, step.stream, step.hoursWeek, step.notes.attriti, step.notes.dati, step.dependsOn], [same.title, same.description, same.tools, same.stream, same.hoursWeek, same.notes.attriti, same.notes.dati, same.dependsOn]);
    }
    const save = await store.saveBoardOps(db.exec, scope(), { kind: "persona", ...viewer() }, { baseRevision: 0, ops: [{ id: "1a1a1a1a-1a1a-4a1a-8a1a-1a1a1a1a1a1a", t: "board.set", field: "headline", prev: null, next: "Una frase" }] });
    assert.deepEqual(save, { ok: false, code: "non_disponibile" });
    assert.equal(await store.resolveProcess(db.exec, scope(), "Dall'ordine alla consegna"), null);
    assert.deepEqual(await boardCounts(q, [f.ws]), counts);
    const since = await store.readBoardSince(db.exec, scope(), viewer(), 0);
    assert.ok(since && !since.unchanged && since.board.store === "mancante");
  } finally {
    await db.ensure.runMappingBoardDdl();
  }
  assert.equal(await store.mappingStoreReady(db.exec), true);
});
