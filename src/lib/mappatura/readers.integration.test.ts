import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connect, enabled, insertActivity, newFixture, opts, seed, unseed, type Connection } from "./integration-kit.ts";
import type { BoardOp } from "./board-ops.ts";

// Gli altri lettori delle attività, con una board in uso (docs/mappatura/MAPPATURA-BOARD-PIANO.md §3.6, §8.2): la board
// non aggiunge colonne ad `activities`, e quello che scrive lo scrive dove gli altri l'hanno sempre letto.
// - «Proponi da Activity mapping» (`activityMappingReadiness`): «da classificare» dopo un passo aggiunto sulla board,
//   «pronto» dopo la classificazione;
// - l'Overview (`getActivityOverviewStats`), la value map (`getActivitiesByWorkspace` e i suoi nodi) e l'elenco delle
//   unità (`listUnitBoards`) contano le stesse attività;
// - l'elenco delle unità: una riga per unità del workspace, con i numeri della sua board, anche prima dell'adozione e
//   senza la 0039.
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui.

const f = newFixture();
let db: Connection;
let q: Connection["q"];
let store: typeof import("./board-store.ts");
let units: typeof import("./units.ts");
let complete: typeof import("./complete.ts");
let createData: typeof import("../use-cases/create-data.ts");
let activityQueries: typeof import("../db/queries/activities.ts");

const scope = () => ({ workspaceId: f.ws, departmentId: f.unit });
const lead = () => ({ kind: "persona" as const, userId: f.lead, role: "transformation_lead" });
const op = <T extends Omit<BoardOp, "id">>(body: T) => ({ id: randomUUID(), ...body }) as BoardOp;
const ids: Record<string, string> = {};

async function save(ops: BoardOp[]) {
  const result = await store.saveBoardOps(db.exec, scope(), lead(), { baseRevision: 0, ops });
  assert.ok(result.ok && result.rejected.length === 0, JSON.stringify(result.ok ? result.rejected : result));
  return result.board;
}

before(async () => {
  if (!enabled) return;
  db = await connect();
  q = db.q;
  store = await import("./board-store.ts");
  units = await import("./units.ts");
  complete = await import("./complete.ts");
  createData = await import("../use-cases/create-data.ts");
  activityQueries = await import("../db/queries/activities.ts");
  await seed(q, f, "lettori");
});

after(async () => {
  if (!enabled) return;
  await db.ensure.runMappingBoardDdl();
  await unseed(q, f);
});

test("un workspace senza attività: nessuna attività per «Proponi da Activity mapping», le unità tutte da iniziare", opts, async () => {
  assert.equal(await createData.activityMappingReadiness(f.ws), "nessuna_attivita");
  const list = await units.listUnitBoards(db.exec, f.ws);
  // Una riga per unità di questo workspace, in ordine di nome; quella dell'altro workspace non c'è.
  assert.deepEqual(list.map((unit) => [unit.id, unit.name, unit.status, unit.steps, unit.processes]), [[f.otherUnit, "Magazzino", "not_started", 0, 0], [f.unit, "Ufficio acquisti", "not_started", 0, 0]]);
  assert.deepEqual(list[1], { id: f.unit, name: "Ufficio acquisti", description: "Compra materiali e servizi per gli altri uffici.", teamSize: 6, status: "not_started", processes: 0, steps: 0, hoursWeek: 0, toValidate: 0, unclassified: 0, streams: { automate: 0, differentiate: 0, innovate: 0 } });
  assert.deepEqual(await units.listUnitBoards(db.exec, f.otherWs).then((rows) => rows.map((unit) => unit.id)), [f.foreignUnit]);
  assert.deepEqual(await units.listUnitBoards(db.exec, "non-un-id"), []);
});

test("un passo aggiunto sulla board è un'attività come le altre: tutti la contano, e resta da classificare", opts, async () => {
  const process = randomUUID();
  Object.assign(ids, { process, richieste: randomUUID(), confronto: randomUUID() });
  await save([
    op({ t: "process.add", processId: process, name: "Dalla richiesta all'ordine" }),
    op({ t: "step.add", stepId: ids.richieste, processId: process, title: "Raccolta delle richieste" }),
    op({ t: "step.add", stepId: ids.confronto, processId: process, title: "Confronto delle offerte" }),
    op({ t: "step.set", stepId: ids.richieste, field: "hoursWeek", prev: null, next: 6.5 }),
    op({ t: "step.set", stepId: ids.confronto, field: "hoursWeek", prev: null, next: 2 }),
    op({ t: "step.set", stepId: ids.confronto, field: "status", prev: "confermato", next: "da_validare" }),
  ]);
  // Due attività scritte dal codice di prima, non ancora sulla board: una di prima con un valore di prima, una nuda.
  ids.vecchia = await insertActivity(q, f, { title: "Solleciti di consegna", classification: "blocked_by_system", time_spent_hours_week: 5 });
  ids.altrove = await insertActivity(q, { ws: f.ws, unit: f.otherUnit }, { title: "Controllo dei colli", time_spent_hours_week: 4 });

  // «Proponi da Activity mapping»: finché un'attività del workspace è senza stream, prima si classifica.
  assert.equal(await createData.activityMappingReadiness(f.ws), "da_classificare");
  // L'Overview, la value map e l'elenco delle unità contano le stesse quattro attività.
  const overview = await activityQueries.getActivityOverviewStats(f.ws);
  assert.deepEqual(overview, { total: 4, classified: 1, automate: 0, differentiate: 0, innovate: 0 }, "l'Overview non conta i due valori «blocked» (com'era)");
  const forMap = await activityQueries.getActivitiesByWorkspace(f.ws);
  assert.deepEqual(forMap.map((activity) => activity.title).sort(), ["Confronto delle offerte", "Controllo dei colli", "Raccolta delle richieste", "Solleciti di consegna"]);
  const list = await units.listUnitBoards(db.exec, f.ws);
  assert.equal(list.reduce((sum, unit) => sum + unit.steps, 0), forMap.length);
  assert.equal(list.reduce((sum, unit) => sum + unit.steps - unit.unclassified, 0), overview.classified);
  // L'elenco non adotta: conta con un LEFT JOIN. Un'attività non ancora sulla board è un passo «da validare».
  const [warehouse, purchasing] = list;
  assert.deepEqual(purchasing, { id: f.unit, name: "Ufficio acquisti", description: "Compra materiali e servizi per gli altri uffici.", teamSize: 6, status: "in_progress", processes: 1, steps: 3, hoursWeek: 13.5, toValidate: 2, unclassified: 2, streams: { automate: 1, differentiate: 0, innovate: 0 } });
  assert.deepEqual([warehouse.status, warehouse.processes, warehouse.steps, warehouse.hoursWeek, warehouse.toValidate, warehouse.unclassified], ["in_progress", 1, 1, 4, 1, 1], "con un'attività e ancora senza board: in corso, un processo che nascerà");
  assert.equal(Number((await q(`SELECT count(*)::int AS n FROM mapping_steps WHERE activity_id = ANY($1::uuid[])`, [[ids.vecchia, ids.altrove]]))[0].n), 0, "l'elenco non ha adottato niente");
  assert.equal((await q(`SELECT mapping_status::text AS s FROM departments WHERE id = $1`, [f.otherUnit]))[0].s, "not_started", "e non ha scritto lo stato");

  // La board dell'unità e l'elenco dicono gli stessi numeri (la board adotta, l'elenco contava già).
  const board = await store.readBoard(db.exec, scope(), lead());
  assert.ok(board);
  const steps = board.processes.flatMap((item) => item.steps);
  assert.deepEqual([steps.length, steps.filter((step) => step.status === "da_validare").length, steps.filter((step) => step.stream === null).length, board.unit.status], [3, 2, 2, "in_progress"]);
  assert.deepEqual(await units.listUnitBoards(db.exec, f.ws).then((rows) => rows[1]), purchasing, "dopo l'adozione l'elenco dice lo stesso");
});

test("dopo la classificazione: «pronto» per «Proponi da Activity mapping», e i conteggi per stream tornano dappertutto", opts, async () => {
  const result = (classification: "automate" | "differentiate" | "innovate") => ({ classification, confidenceScore: 0.8, reasoning: "Un motivo.", aiPotential: "Un potenziale." });
  const written = await complete.recordClassifications(db.exec, f.ws, new Map([[ids.richieste, result("automate")], [ids.confronto, result("differentiate")], [ids.altrove, result("innovate")]]));
  assert.equal(written, 3);
  assert.equal(await createData.activityMappingReadiness(f.ws), "pronto");
  assert.deepEqual(await activityQueries.getActivityOverviewStats(f.ws), { total: 4, classified: 4, automate: 1, differentiate: 1, innovate: 1 });
  const list = await units.listUnitBoards(db.exec, f.ws);
  assert.deepEqual(list.map((unit) => [unit.name, unit.unclassified, unit.streams]), [["Magazzino", 0, { automate: 0, differentiate: 0, innovate: 1 }], ["Ufficio acquisti", 0, { automate: 2, differentiate: 1, innovate: 0 }]]);
  // Un altro passo sulla board: di nuovo «da classificare», finché non lo si classifica.
  ids.ordine = randomUUID();
  await save([op({ t: "step.add", stepId: ids.ordine, processId: ids.process, title: "Invio dell'ordine" })]);
  assert.equal(await createData.activityMappingReadiness(f.ws), "da_classificare");
  assert.equal((await units.listUnitBoards(db.exec, f.ws))[1].unclassified, 1);
  // Lo stream scelto a mano da chi rivede vale come quello del classificatore.
  await save([op({ t: "step.stream", stepId: ids.ordine, prev: null, next: "automate" })]);
  assert.equal(await createData.activityMappingReadiness(f.ws), "pronto");
});

test("la value map: un passo eliminato sulla board porta via il suo nodo, gli altri restano", opts, async () => {
  await q(`INSERT INTO value_map_nodes (workspace_id, activity_id, x_maturity, y_strategic_value) VALUES ($1, $2, 0.4, 0.6), ($1, $3, 0.2, 0.8)`, [f.ws, ids.ordine, ids.richieste]);
  await save([op({ t: "step.remove", stepId: ids.ordine })]);
  const nodes = await q(`SELECT activity_id FROM value_map_nodes WHERE workspace_id = $1`, [f.ws]);
  assert.deepEqual(nodes.map((row) => row.activity_id), [ids.richieste]);
  assert.equal((await activityQueries.getActivitiesByWorkspace(f.ws)).length, 4);
  assert.equal((await units.listUnitBoards(db.exec, f.ws)).reduce((sum, unit) => sum + unit.steps, 0), 4);
});

test("gli use case nati dalla mappatura: solo quelli che chi guarda può vedere, legati ai soli passi di questa unità", opts, async () => {
  const links = await import("./use-case-links.ts");
  const board = await store.readBoard(db.exec, scope(), lead());
  assert.ok(board);
  const stepIds = new Set(board.processes.flatMap((process) => process.steps.map((step) => step.id)));
  const [fromMapping, elsewhere, byHand, foreign] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const hidden = JSON.stringify({ hiddenFromSearch: true });
  await q(
    `INSERT INTO use_cases (id, workspace_id, title, code, source, origin, intake, related_activity_ids) VALUES
       ($1, $5, 'Lettura delle richieste', 'MP-0001', 'activity_mapping', 'transformation', $7::jsonb, $8::jsonb),
       ($2, $5, 'Controllo dei colli con una foto', 'MP-0002', 'activity_mapping', 'transformation', $7::jsonb, $9::jsonb),
       ($3, $5, 'Uno use case scritto a mano', 'MP-0003', NULL, 'adoption', NULL, $10::jsonb),
       ($4, $6, 'Uno use case di un altro workspace', 'MP-0001', 'activity_mapping', 'transformation', $7::jsonb, $10::jsonb)`,
    [fromMapping, elsewhere, byHand, foreign, f.ws, f.otherWs, hidden, JSON.stringify([ids.richieste, "non-un-id", ids.confronto, ids.richieste, randomUUID()]), JSON.stringify([ids.altrove]), JSON.stringify([ids.richieste])],
  );
  const reviewer = { userId: f.lead, email: "guida@prova.test", emailVerified: true, role: "transformation_lead", isLateralSpace: false };
  const contributor = { userId: f.contributor, email: "contributo@prova.test", emailVerified: true, role: "contributor", isLateralSpace: false };
  const hubBefore = process.env.USE_CASE_HUB_WORKSPACES;
  const excludeBefore = process.env.USE_CASE_HUB_EXCLUDE;
  try {
    // Con l'area «Use case» spenta: nessuno.
    delete process.env.USE_CASE_HUB_WORKSPACES;
    assert.deepEqual(await links.boardUseCaseLinks(f.ws, reviewer, stepIds), { links: [], byStep: new Map() });
    process.env.USE_CASE_HUB_WORKSPACES = f.ws;
    delete process.env.USE_CASE_HUB_EXCLUDE;
    // Chi rivede: lo use case nato dalla mappatura che elenca passi di questa unità, con codice, titolo e link.
    const seen = await links.boardUseCaseLinks(f.ws, reviewer, stepIds);
    assert.deepEqual(seen.links, [{ id: fromMapping, code: "MP-0001", title: "Lettura delle richieste", href: `/dashboard/${f.ws}/use-cases/${fromMapping}`, stream: null }]);
    assert.deepEqual([...seen.byStep].sort(), [[ids.confronto, [fromMapping]], [ids.richieste, [fromMapping]]].sort());
    // Sulla board: i passi collegati, e lo stream dello use case dai suoi passi (Automate e Differentiate: il primo).
    const { withUseCaseLinks } = await import("./board-model.ts");
    const linked = withUseCaseLinks(board, seen);
    assert.deepEqual(linked.processes[0].steps.map((step) => step.useCaseIds.length), [1, 1, 0]);
    assert.equal(linked.useCases[0].stream, "automate");
    // Chi contribuisce non vede le bozze nate dalla mappatura: nessun collegamento. Ma il passo resta non eliminabile.
    assert.deepEqual(await links.boardUseCaseLinks(f.ws, contributor, stepIds), { links: [], byStep: new Map() });
    const refused = op({ t: "step.remove", stepId: ids.richieste });
    const result = await store.saveBoardOps(db.exec, scope(), { kind: "persona", userId: f.contributor, role: "contributor" }, { baseRevision: 0, ops: [refused] });
    assert.ok(result.ok);
    assert.deepEqual(result.rejected, [{ id: refused.id, reason: "linked" }]);
    // Una board senza passi, o chi non entra nell'area: nessuno.
    assert.deepEqual(await links.boardUseCaseLinks(f.ws, reviewer, new Set()), { links: [], byStep: new Map() });
    assert.deepEqual(await links.boardUseCaseLinks(f.ws, { ...reviewer, role: "learner" }, stepIds), { links: [], byStep: new Map() });
  } finally {
    if (hubBefore === undefined) delete process.env.USE_CASE_HUB_WORKSPACES;
    else process.env.USE_CASE_HUB_WORKSPACES = hubBefore;
    if (excludeBefore !== undefined) process.env.USE_CASE_HUB_EXCLUDE = excludeBefore;
    await q(`DELETE FROM use_cases WHERE id = ANY($1::uuid[])`, [[fromMapping, elsewhere, byHand, foreign]]);
  }
});

test("senza la 0039 l'elenco delle unità conta dalle sole attività", opts, async () => {
  const withStore = await units.listUnitBoards(db.exec, f.ws);
  await q(`DROP INDEX mapping_votes_user_idx`);
  try {
    const list = await units.listUnitBoards(db.exec, f.ws);
    assert.deepEqual(list.map((unit) => [unit.id, unit.steps, unit.hoursWeek, unit.unclassified, unit.streams, unit.status]), withStore.map((unit) => [unit.id, unit.steps, unit.hoursWeek, unit.unclassified, unit.streams, unit.status]));
    // Senza le righe dei passi ogni passo conta come «da validare», in un processo solo.
    assert.deepEqual(list.map((unit) => [unit.toValidate, unit.processes]), [[1, 1], [3, 1]]);
  } finally {
    await db.ensure.runMappingBoardDdl();
  }
});
