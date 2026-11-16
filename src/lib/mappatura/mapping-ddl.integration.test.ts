import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { boardCounts, connect, enabled, insertActivity, newFixture, opts, rejects, seed, unseed, type Connection, type Row } from "./integration-kit.ts";
import {
  MAPPING_BOARD_DDL,
  MAPPING_BOARD_INDEXES,
  MAPPING_BOARD_NAMED_CONSTRAINTS,
  MAPPING_BOARD_PROBE_SQL,
  MAPPING_BOARD_TABLES,
  MISSING_ACTIVITIES_FOR_BOARD_MESSAGE,
} from "../db/mapping-board-ddl.ts";

// La 0039 sul database del pacchetto (docs/mappatura/MAPPATURA-BOARD-PIANO.md §3.2, §8.2):
// - il self-heal due volte e il file due volte non cambiano niente; la sonda è vera, falsa senza un suo indice, di nuovo
//   vera dopo un altro giro; da zero, in una transazione annullata, il self-heal crea tutto;
// - lo scope sta nel database: un'unità di un altro workspace non possiede un processo, un passo non entra in un
//   processo di un'altra unità, una nota resta nell'unità del suo passo;
// - i CHECK rifiutano la riga sbagliata;
// - cancellare un'attività porta via le sue righe; cancellare un workspace con una board piena (operazioni applicate
//   comprese) non lascia niente.
// Con scripts/use-case-test/run-db-tests.mjs. Dati inventati, creati e cancellati qui.

const migration = readFileSync(new URL("../../../drizzle/0039_mapping_board.sql", import.meta.url), "utf8");
const f = newFixture();
let db: Connection;
let q: Connection["q"];

async function schemaSnapshot(): Promise<string> {
  const tables = [...MAPPING_BOARD_TABLES, "activities", "departments", "activity_dependencies"];
  const list = tables.map((x) => `'${x}'`).join(", ");
  const columns = await q(`SELECT table_name, column_name, data_type, is_nullable, column_default, character_maximum_length FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN (${list}) ORDER BY table_name, ordinal_position`);
  const constraints = await q(`SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conrelid IN (${tables.map((x) => `'public.${x}'::regclass`).join(", ")}) ORDER BY 1, 2`);
  const indexes = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN (${list}) ORDER BY 1`);
  return JSON.stringify({ columns, constraints, indexes });
}

const probe = async () => (await q(`SELECT ${MAPPING_BOARD_PROBE_SQL} AS ok`))[0].ok;

before(async () => {
  if (!enabled) return;
  db = await connect();
  q = db.q;
  await seed(q, f, "ddl");
});

after(async () => {
  if (!enabled) return;
  await unseed(q, f);
});

test("lo schema della 0039 c'è; il self-heal due volte e il file due volte non cambiano niente", opts, async () => {
  assert.equal(await probe(), true);
  const first = await schemaSnapshot();
  await db.ensure.runMappingBoardDdl();
  await db.ensure.runMappingBoardDdl();
  await q(migration);
  await q(migration);
  assert.equal(await schemaSnapshot(), first);
  assert.equal(await probe(), true);
  // Gli oggetti sono quelli della sonda: sei tabelle, dieci indici, 37 vincoli con nome.
  const tables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'mapping_%' ORDER BY 1`)).map((r) => String(r.tablename));
  assert.deepEqual(tables, [...MAPPING_BOARD_TABLES].sort());
  const named = (await q(`SELECT conname FROM pg_constraint WHERE conrelid IN (${MAPPING_BOARD_TABLES.map((t) => `'public.${t}'::regclass`).join(", ")}) ORDER BY 1`)).map((r) => String(r.conname));
  for (const name of MAPPING_BOARD_NAMED_CONSTRAINTS) assert.ok(named.includes(name), name);
  // Oltre ai 37, solo le chiavi verso workspace e persone, con il nome dato da PostgreSQL.
  assert.deepEqual(
    named.filter((name) => !MAPPING_BOARD_NAMED_CONSTRAINTS.includes(name)).sort(),
    [
      "mapping_applied_ops_workspace_id_fkey",
      "mapping_boards_workspace_id_fkey",
      "mapping_notes_workspace_id_fkey",
      "mapping_processes_workspace_id_fkey",
      "mapping_steps_workspace_id_fkey",
      "mapping_votes_user_id_fkey",
      "mapping_votes_workspace_id_fkey",
    ],
  );
  // Nessuna colonna in più nelle tabelle di prima.
  const activityColumns = (await q(`SELECT count(*)::int AS n FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'activities'`))[0].n;
  assert.equal(activityColumns, 23);
});

test("la sonda è falsa senza uno dei suoi indici, e torna vera dopo un altro giro del self-heal", opts, async () => {
  try {
    for (const index of ["mapping_votes_user_idx", "activities_department_idx"]) {
      assert.ok((MAPPING_BOARD_INDEXES as readonly string[]).includes(index));
      await q(`DROP INDEX ${index}`);
      assert.equal(await probe(), false, `senza ${index}`);
      await db.ensure.runMappingBoardDdl();
      assert.equal(await probe(), true, `di nuovo con ${index}`);
    }
  } finally {
    await db.ensure.runMappingBoardDdl();
  }
});

test("su un database senza la 0039 il self-heal la crea (in una transazione annullata); senza le tabelle di partenza si ferma", opts, async () => {
  const marker = `prova-0039-annullata-${f.suffix}`;
  const text = [
    `DROP TABLE mapping_applied_ops, mapping_votes, mapping_notes, mapping_steps, mapping_processes, mapping_boards;`,
    `DROP INDEX departments_scope_unique, activities_scope_unique, activities_department_idx, activities_workspace_idx;`,
    `DO $$ BEGIN IF ${MAPPING_BOARD_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora vera'; END IF; END $$;`,
    ...MAPPING_BOARD_DDL,
    `DO $$ BEGIN IF NOT ${MAPPING_BOARD_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora falsa'; END IF; END $$;`,
    `DO $$ BEGIN RAISE EXCEPTION '${marker}'; END $$;`,
  ].join("\n");
  await assert.rejects(q(text), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(marker));
  assert.equal(await probe(), true, "annullata: tutto come prima");
  const withoutActivities = [`DROP TABLE activities CASCADE;`, MAPPING_BOARD_DDL[0]].join("\n");
  await assert.rejects(q(withoutActivities), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(MISSING_ACTIVITIES_FOR_BOARD_MESSAGE));
  assert.equal((await q(`SELECT to_regclass('public.activities') IS NOT NULL AS ok`))[0].ok, true);
  assert.equal(await probe(), true);
});

test("lo scope sta nel database: processi, passi, note e voti restano nell'unità e nel workspace giusti", opts, async () => {
  const process = `INSERT INTO mapping_processes (id, workspace_id, department_id, name, position) VALUES ($1, $2, $3, $4, 1)`;
  // Un'unità di un altro workspace non possiede un processo di questo workspace, e viceversa.
  await rejects(q, process, [randomUUID(), f.ws, f.foreignUnit, "Processo fuori posto"], "mapping_processes_unit_fkey");
  await rejects(q, process, [randomUUID(), f.otherWs, f.unit, "Processo fuori posto"], "mapping_processes_unit_fkey");
  await rejects(q, `INSERT INTO mapping_boards (department_id, workspace_id) VALUES ($1, $2)`, [f.unit, f.otherWs], "mapping_boards_unit_fkey");
  const here = randomUUID();
  const there = randomUUID();
  await q(process, [here, f.ws, f.unit, "Dalla richiesta all'ordine"]);
  await q(process, [there, f.ws, f.otherUnit, "Ricevimento merci"]);
  const activity = await insertActivity(q, f, { title: "Raccolta delle richieste" });
  const elsewhere = await insertActivity(q, f, { title: "Controllo dei colli", unit: f.otherUnit });
  const step = `INSERT INTO mapping_steps (activity_id, workspace_id, department_id, process_id, position) VALUES ($1, $2, $3, $4, 1)`;
  // Un passo non entra in un processo di un'altra unità: lo rifiuta la chiave.
  await rejects(q, step, [activity, f.ws, f.unit, there], "mapping_steps_process_fkey");
  // La riga di un passo sta nell'unità e nel workspace della sua attività.
  await rejects(q, step, [activity, f.ws, f.otherUnit, there], "mapping_steps_activity_fkey");
  await rejects(q, step, [activity, f.otherWs, f.unit, null], "mapping_steps_activity_fkey");
  await q(step, [activity, f.ws, f.unit, here]);
  await q(step, [elsewhere, f.ws, f.otherUnit, there]);
  await rejects(q, `UPDATE mapping_steps SET process_id = $2 WHERE activity_id = $1`, [activity, there], "mapping_steps_process_fkey");
  // Una nota di un passo resta nell'unità del passo; un punto di analisi nel workspace dell'unità.
  const note = `INSERT INTO mapping_notes (workspace_id, department_id, activity_id, lane, title, body) VALUES ($1, $2, $3, $4, $5, $6)`;
  await rejects(q, note, [f.ws, f.otherUnit, activity, "attriti", null, "Richieste incomplete"], "mapping_notes_step_fkey");
  await rejects(q, note, [f.otherWs, f.unit, null, "analisi", "Dove va il tempo", "Le richieste arrivano incomplete."], "mapping_notes_unit_fkey");
  await q(note, [f.ws, f.unit, activity, "attriti", null, "Richieste incomplete"]);
  await q(note, [f.ws, f.unit, null, "analisi", "Dove va il tempo", "Le richieste arrivano incomplete."]);
  // Un voto resta nell'unità del suo processo.
  const vote = `INSERT INTO mapping_votes (process_id, user_id, workspace_id, department_id, votes) VALUES ($1, $2, $3, $4, $5)`;
  await rejects(q, vote, [here, f.lead, f.ws, f.otherUnit, 1], "mapping_votes_process_fkey");
  await q(vote, [here, f.lead, f.ws, f.unit, 2]);
  await rejects(q, vote, [here, f.lead, f.ws, f.unit, 1], "mapping_votes_pkey");

  // Un processo che sparisce lascia il passo senza processo, nell'unità e nel workspace di prima; i voti vanno con lui.
  await q(`DELETE FROM mapping_processes WHERE id = $1`, [here]);
  const [left] = await q(`SELECT process_id, department_id, workspace_id FROM mapping_steps WHERE activity_id = $1`, [activity]);
  assert.deepEqual([left.process_id, left.department_id, left.workspace_id], [null, f.unit, f.ws]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM mapping_votes WHERE process_id = $1`, [here]))[0].n, 0);
  // Cancellare l'attività porta via la riga del passo e le sue note; il punto di analisi resta.
  await q(`DELETE FROM activities WHERE id = $1`, [activity]);
  assert.equal((await q(`SELECT count(*)::int AS n FROM mapping_steps WHERE activity_id = $1`, [activity]))[0].n, 0);
  const remaining = await q(`SELECT lane FROM mapping_notes WHERE department_id = $1`, [f.unit]);
  assert.deepEqual(remaining.map((r: Row) => r.lane), ["analisi"]);
});

test("i CHECK rifiutano la riga sbagliata", opts, async () => {
  const processId = randomUUID();
  await q(`INSERT INTO mapping_processes (id, workspace_id, department_id, name, position) VALUES ($1, $2, $3, 'Dall''ordine alla consegna', 1)`, [processId, f.ws, f.unit]);
  const activity = await insertActivity(q, f, { title: "Confronto delle offerte" });
  await q(`INSERT INTO mapping_boards (department_id, workspace_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [f.unit, f.ws]);
  await rejects(q, `UPDATE mapping_boards SET revision = -1 WHERE department_id = $1`, [f.unit], "mapping_boards_revision_check");
  await rejects(q, `UPDATE mapping_boards SET headline = '   ' WHERE department_id = $1`, [f.unit], "mapping_boards_headline_check");
  await rejects(q, `UPDATE mapping_processes SET name = ' ' WHERE id = $1`, [processId], "mapping_processes_name_check");
  await rejects(q, `UPDATE mapping_processes SET owner = '' WHERE id = $1`, [processId], "mapping_processes_owner_check");
  const step = `INSERT INTO mapping_steps (activity_id, workspace_id, department_id, process_id, who, exception_text, decision_label, friction_level, status, origin, proposed_stream)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9, $10, $11)`;
  const ok = [activity, f.ws, f.unit, processId, "[]", null, null, null, "da_validare", "prima", null];
  const stepWith = (i: number, v: unknown) => ok.map((x, j) => (j === i ? v : x));
  await rejects(q, step, stepWith(4, "{}"), "mapping_steps_who_check");
  await rejects(q, step, stepWith(4, JSON.stringify(Array.from({ length: 13 }, (_, i) => `Ruolo ${i}`))), "mapping_steps_who_check");
  await rejects(q, step, stepWith(5, "  "), "mapping_steps_exception_check");
  await rejects(q, step, stepWith(6, ""), "mapping_steps_decision_label_check");
  await rejects(q, step, stepWith(7, 4), "mapping_steps_friction_check");
  await rejects(q, step, stepWith(7, -1), "mapping_steps_friction_check");
  await rejects(q, step, stepWith(8, "validato"), "mapping_steps_status_check");
  await rejects(q, step, stepWith(9, "altro"), "mapping_steps_origin_check");
  await rejects(q, step, stepWith(10, "automatable"), "mapping_steps_proposed_check");
  await q(step, stepWith(7, 3));
  await rejects(q, `UPDATE mapping_steps SET classification_reason = repeat('a', 2001) WHERE activity_id = $1`, [activity], "mapping_steps_reason_check");
  await rejects(q, `UPDATE mapping_steps SET ai_potential = repeat('a', 2001) WHERE activity_id = $1`, [activity], "mapping_steps_potential_check");
  const note = `INSERT INTO mapping_notes (workspace_id, department_id, activity_id, lane, title, body, status, origin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`;
  const good = [f.ws, f.unit, activity, "attriti", null, "Tre solleciti per ordine", "validato", "board"];
  const noteWith = (i: number, v: unknown) => good.map((x, j) => (j === i ? v : x));
  await rejects(q, note, noteWith(3, "persone"), "mapping_notes_lane_check");
  await rejects(q, note, noteWith(5, "   "), "mapping_notes_body_check");
  await rejects(q, note, noteWith(5, "a".repeat(2001)), "mapping_notes_body_check");
  await rejects(q, note, noteWith(6, "chiusa"), "mapping_notes_status_check");
  await rejects(q, note, noteWith(7, "altro"), "mapping_notes_origin_check");
  // Un punto di analisi non ha un passo; una nota di un passo non ha titolo e non è «analisi».
  await rejects(q, note, noteWith(3, "analisi"), "mapping_notes_scope_check");
  await rejects(q, note, noteWith(2, null), "mapping_notes_scope_check");
  await rejects(q, note, noteWith(4, "Un titolo"), "mapping_notes_title_lane_check");
  await rejects(q, note, [f.ws, f.unit, null, "analisi", " ", "Testo", "validato", "board"], "mapping_notes_title_check");
  await q(note, good);
  await rejects(q, `INSERT INTO mapping_votes (process_id, user_id, workspace_id, department_id, votes) VALUES ($1, $2, $3, $4, 100)`, [processId, f.contributor, f.ws, f.unit], "mapping_votes_votes_check");
  await rejects(q, `INSERT INTO mapping_votes (process_id, user_id, workspace_id, department_id, votes) VALUES ($1, $2, $3, $4, -1)`, [processId, f.contributor, f.ws, f.unit], "mapping_votes_votes_check");
  // Un'operazione applicata: un esito del vocabolario, un id una volta sola, nell'unità del suo workspace.
  const applied = `INSERT INTO mapping_applied_ops (op_id, workspace_id, department_id, outcome) VALUES ($1, $2, $3, $4)`;
  const opId = randomUUID();
  await rejects(q, applied, [opId, f.ws, f.unit, "fatto"], "mapping_applied_ops_outcome_check");
  await rejects(q, applied, [opId, f.otherWs, f.unit, "ok"], "mapping_applied_ops_unit_fkey");
  await q(applied, [opId, f.ws, f.unit, "ok"]);
  await rejects(q, applied, [opId, f.ws, f.unit, "conflict"], "mapping_applied_ops_pkey");
});

test("cancellare un workspace con una board piena non solleva niente e non lascia righe nelle sei tabelle", opts, async () => {
  const g = newFixture();
  await seed(q, g, "ddl2");
  try {
    const processId = randomUUID();
    await q(`INSERT INTO mapping_boards (department_id, workspace_id, headline) VALUES ($1, $2, 'Il tempo va nei solleciti.')`, [g.unit, g.ws]);
    await q(`INSERT INTO mapping_processes (id, workspace_id, department_id, name, owner, position) VALUES ($1, $2, $3, 'Dalla richiesta all''ordine', 'Responsabile acquisti', 1)`, [processId, g.ws, g.unit]);
    const first = await insertActivity(q, g, { title: "Raccolta delle richieste" });
    const second = await insertActivity(q, g, { title: "Invio dell'ordine" });
    await q(`INSERT INTO activity_dependencies (source_activity_id, target_activity_id, dependency_type) VALUES ($1, $2, 'input')`, [second, first]);
    for (const [activity, position] of [[first, 1], [second, 2]] as const) {
      await q(`INSERT INTO mapping_steps (activity_id, workspace_id, department_id, process_id, position, who) VALUES ($1, $2, $3, $4, $5, '["Buyer"]'::jsonb)`, [activity, g.ws, g.unit, processId, position]);
      await q(`INSERT INTO mapping_notes (workspace_id, department_id, activity_id, lane, body) VALUES ($1, $2, $3, 'attriti', 'Richieste incomplete')`, [g.ws, g.unit, activity]);
    }
    await q(`INSERT INTO mapping_notes (workspace_id, department_id, activity_id, lane, title, body) VALUES ($1, $2, NULL, 'analisi', 'Dove va il tempo', 'Nei solleciti.')`, [g.ws, g.unit]);
    await q(`INSERT INTO mapping_votes (process_id, user_id, workspace_id, department_id, votes) VALUES ($1, $2, $3, $4, 3), ($1, $5, $3, $4, 1)`, [processId, g.lead, g.ws, g.unit, g.contributor]);
    await q(`INSERT INTO mapping_applied_ops (op_id, workspace_id, department_id, outcome) VALUES ($1, $3, $4, 'ok'), ($2, $3, $4, 'conflict')`, [randomUUID(), randomUUID(), g.ws, g.unit]);
    const appliedOps = async () => Number((await q(`SELECT count(*)::int AS n FROM mapping_applied_ops WHERE workspace_id = $1`, [g.ws]))[0].n);
    assert.deepEqual(await boardCounts(q, [g.ws]), { mapping_boards: 1, mapping_processes: 1, mapping_steps: 2, mapping_notes: 3, mapping_votes: 2 });
    assert.equal(await appliedOps(), 2);
    await q(`DELETE FROM workspaces WHERE id = $1`, [g.ws]);
    assert.deepEqual(await boardCounts(q, [g.ws]), { mapping_boards: 0, mapping_processes: 0, mapping_steps: 0, mapping_notes: 0, mapping_votes: 0 });
    assert.equal(await appliedOps(), 0);
    assert.equal((await q(`SELECT count(*)::int AS n FROM activities WHERE workspace_id = $1`, [g.ws]))[0].n, 0);
    // Una persona che se ne va porta via solo i suoi voti.
    assert.equal((await q(`SELECT count(*)::int AS n FROM users WHERE id = ANY($1::uuid[])`, [[g.lead, g.contributor]]))[0].n, 2);
  } finally {
    await unseed(q, g);
  }
});
