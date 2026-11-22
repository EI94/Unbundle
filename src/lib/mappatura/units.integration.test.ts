import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { connect, enabled, newFixture, opts, seed, unseed, type Connection } from "./integration-kit.ts";

// (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7, F-160) «Aggiungi un'unità» sul database (`addUnit`, la transazione di
// `addUnitAction`): l'unità nasce con il solo nome nel suo workspace, compare nell'elenco dei Processi e la sua board si
// apre vuota; un nome che c'è già (anche con le maiuscole diverse) non passa, né oltre il tetto delle unità; due
// aggiunte insieme con lo stesso nome ne fanno una sola (il lucchetto del workspace).
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui.

const f = newFixture();
let db: Connection;
let units: typeof import("./units.ts");
let store: typeof import("./board-store.ts");
let vocab: typeof import("./vocab.ts");

const count = async (workspaceId: string, name?: string) =>
  Number(
    (
      await db.q(
        name === undefined
          ? `SELECT count(*)::int AS n FROM departments WHERE workspace_id = $1`
          : `SELECT count(*)::int AS n FROM departments WHERE workspace_id = $1 AND lower(name) = lower($2)`,
        name === undefined ? [workspaceId] : [workspaceId, name],
      )
    )[0].n,
  );

before(async () => {
  if (!enabled) return;
  db = await connect();
  units = await import("./units.ts");
  store = await import("./board-store.ts");
  vocab = await import("./vocab.ts");
  await seed(db.q, f, "unita");
});

after(async () => {
  if (!enabled) return;
  await unseed(db.q, f);
});

test("un'unità nuova: solo il nome, nel suo workspace e nell'elenco dei Processi; la sua board si apre vuota", opts, async () => {
  const added = await units.addUnit(db.exec, f.ws, "Logistica");
  assert.ok(added.ok);
  const [row] = await db.q(`SELECT workspace_id, name, description, head_name, team_size, mapping_status FROM departments WHERE id = $1`, [added.departmentId]);
  assert.deepEqual(row, { workspace_id: f.ws, name: "Logistica", description: null, head_name: null, team_size: null, mapping_status: "not_started" });
  const list = await units.listUnitBoards(db.exec, f.ws);
  assert.deepEqual(list.map((unit) => unit.name), ["Logistica", "Magazzino", "Ufficio acquisti"], "in ordine di nome, con le altre");
  const shown = list.find((unit) => unit.id === added.departmentId);
  assert.deepEqual([shown?.status, shown?.steps, shown?.processes], ["not_started", 0, 0]);
  assert.equal((await units.listUnitBoards(db.exec, f.otherWs)).some((unit) => unit.id === added.departmentId), false, "l'altro workspace non la vede");
  const board = await store.readBoard(db.exec, { workspaceId: f.ws, departmentId: added.departmentId }, { userId: f.lead, role: "transformation_lead" });
  assert.ok(board, "la board si apre");
  assert.equal(board.unit.name, "Logistica");
  assert.equal(board.processes.reduce((sum, process) => sum + process.steps.length, 0), 0, "senza passi: l'assistente si apre da sé");
});

test("un nome che c'è già non passa, anche con le maiuscole diverse; in un altro workspace sì", opts, async () => {
  assert.deepEqual(await units.addUnit(db.exec, f.ws, "magazzino"), { ok: false, reason: "duplicate" });
  assert.deepEqual(await units.addUnit(db.exec, f.ws, "UFFICIO ACQUISTI"), { ok: false, reason: "duplicate" });
  assert.equal(await count(f.ws, "magazzino"), 1);
  const elsewhere = await units.addUnit(db.exec, f.otherWs, "Magazzino");
  assert.ok(elsewhere.ok);
});

test("due aggiunte insieme con lo stesso nome: ne nasce una sola, l'altra dice che c'è già", opts, async () => {
  const both = await Promise.all([units.addUnit(db.exec, f.ws, "Qualità"), units.addUnit(db.exec, f.ws, "qualità")]);
  assert.deepEqual(both.map((result) => result.ok).sort(), [false, true]);
  assert.deepEqual(both.find((result) => !result.ok), { ok: false, reason: "duplicate" });
  assert.equal(await count(f.ws, "qualità"), 1);
});

test("il tetto: con `MAPPING_LIMITS.units` unità il workspace è pieno; un nome uguale dice ancora che c'è già", opts, async () => {
  const missing = vocab.MAPPING_LIMITS.units - (await count(f.otherWs));
  assert.ok(missing > 0);
  await db.q(`INSERT INTO departments (workspace_id, name) SELECT $1, 'Unità di prova ' || g FROM generate_series(1, $2::int) g`, [f.otherWs, missing]);
  assert.equal(await count(f.otherWs), vocab.MAPPING_LIMITS.units);
  assert.deepEqual(await units.addUnit(db.exec, f.otherWs, "Una di troppo"), { ok: false, reason: "full" });
  assert.deepEqual(await units.addUnit(db.exec, f.otherWs, "unità di prova 1"), { ok: false, reason: "duplicate" });
  assert.equal(await count(f.otherWs), vocab.MAPPING_LIMITS.units);
});
