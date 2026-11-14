import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

// Schema della 0032 sul database di prova dell'hub («Lavoro in parallelo», rilascio 8.1a):
// - il file due volte, il self-heal due volte, la 0031 di nuovo non cambiano niente (la 0031 non toglie i tipi dei
//   compiti dalla campanella);
// - su un database senza la 0032 il self-heal la crea;
// - ogni CHECK rifiuta la riga sbagliata; un riferimento T-n è unico per use case;
// - chi chiede sta solo sulle richieste; le righe si cancellano con lo use case e con il workspace; chi ha un
//   compito, se sparisce, lascia il compito senza persona.
//
// - Con scripts/use-case-test/run-db-tests.mjs (HUB_TEST_ISOLATED=true, database hub_<id> su 127.0.0.1).
//   Dati sintetici, creati e cancellati qui.
const url = process.env.DATABASE_URL;
const enabled = process.env.HUB_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Hub DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if (!/^\/hub_[a-z0-9][a-z0-9_]{0,39}$/.test(parsed.pathname)) {
    throw new Error("Run this suite only on a package database hub_<id>");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type Row = Record<string, unknown>;
let q: (text: string, params?: unknown[]) => Promise<Row[]>;
let ddl: typeof import("./use-case-hub-tasks-ddl.ts");
let ensure: typeof import("./ensure-schema.ts");

const migration = readFileSync(new URL("../../../drizzle/0032_compiti.sql", import.meta.url), "utf8");
const migration0031 = readFileSync(new URL("../../../drizzle/0031_cli.sql", import.meta.url), "utf8");
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), other: randomUUID(), useCase: randomUUID(), second: randomUUID(), user: randomUUID(), asker: randomUUID() };

const TABLES = ["use_case_tasks", "use_case_task_notes", "use_case_factory_repos", "use_case_notifications"];

async function schemaSnapshot(): Promise<string> {
  const list = TABLES.map((t) => `'${t}'`).join(", ");
  const columns = await q(
    `SELECT table_name, column_name, data_type, is_nullable, column_default FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name IN (${list}) ORDER BY table_name, ordinal_position`,
  );
  const constraints = await q(
    `SELECT conrelid::regclass::text AS t, conname, pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint
     WHERE conrelid IN (${TABLES.map((t) => `'public.${t}'::regclass`).join(", ")}) ORDER BY 1, 2`,
  );
  const indexes = await q(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND tablename IN (${list}) ORDER BY 1`);
  return JSON.stringify({ columns, constraints, indexes });
}

async function probe(): Promise<boolean> {
  return (await q(`SELECT ${ddl.TASKS_PROBE_SQL} AS ok`))[0]?.ok === true;
}

async function rejects(sqlText: string, params: unknown[], constraint: string) {
  await assert.rejects(q(sqlText, params), (error: unknown) => {
    const text = String((error as { message?: unknown })?.message ?? error);
    assert.ok(text.includes(constraint), `atteso ${constraint}, ricevuto: ${text}`);
    return true;
  });
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("./ensure-schema.ts");
  await ensure.ensureDbSchema();
  ddl = await import("./use-case-hub-tasks-ddl.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova 0032', $2)`, [ids.org, `org-0032-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova 0032'), ($3, $2, 'Altro workspace 0032')`, [ids.ws, ids.org, ids.other]);
  await q(`INSERT INTO use_cases (id, workspace_id, title) VALUES ($1, $2, 'Scheda di prova 0032'), ($3, $2, 'Seconda scheda 0032')`, [ids.useCase, ids.ws, ids.second]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Persona di prova 0032'), ($3, $4, 'Chi chiede 0032')`, [ids.user, `prova-0032-${suffix}@example.test`, ids.asker, `chiede-0032-${suffix}@example.test`]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1, $2)`, [ids.ws, ids.other]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id IN ($1, $2)`, [ids.user, ids.asker]);
});

test("lo schema della 0032 c'è; il file due volte, il self-heal due volte, la 0031 di nuovo non cambiano niente", opts, async () => {
  const [row] = await q(`SELECT current_database() AS db`);
  assert.equal(row.db, process.env.UC_TEST_PG_DB);
  assert.equal(await probe(), true);
  const first = await schemaSnapshot();
  await q(migration);
  await q(migration);
  assert.equal(await schemaSnapshot(), first, "il file due volte");
  await ensure.runTasksDdl();
  await ensure.runTasksDdl();
  assert.equal(await schemaSnapshot(), first, "il self-heal due volte");
  await q(migration0031);
  await ensure.runCliDdl();
  assert.equal(await schemaSnapshot(), first, "la 0031 di nuovo non toglie i tipi dei compiti");
  const [kinds] = await q(`SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conname = 'use_case_notifications_kind_check'`);
  assert.match(String(kinds.def), /'domanda_agente'[\s\S]*'compito_chiesto'[\s\S]*'compiti_pronti'/);
  assert.equal(kinds.convalidated, true);
});

test("su un database senza la 0032 il self-heal la crea (in una transazione annullata)", opts, async () => {
  const marker = `prova-0032-annullata-${suffix}`;
  const text = [
    // (0033, 0034) Le pull request e le proposte dipendono dai compiti: vanno via anche loro, nella stessa transazione annullata.
    `DROP TABLE IF EXISTS use_case_task_proposals, use_case_pull_requests;`,
    `DROP TABLE use_case_task_notes, use_case_tasks, use_case_factory_repos;`,
    `DELETE FROM use_case_notifications WHERE kind IN (${ddl.TASK_NOTICE_KINDS.map((k) => `'${k}'`).join(", ")});`,
    `DO $$ BEGIN IF ${ddl.TASKS_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora vera'; END IF; END $$;`,
    ...ddl.TASKS_DDL,
    `DO $$ BEGIN IF NOT ${ddl.TASKS_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora falsa'; END IF; END $$;`,
    `DO $$ BEGIN RAISE EXCEPTION '${marker}'; END $$;`,
  ].join("\n");
  await assert.rejects(q(text), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(marker));
  assert.equal(await probe(), true, "annullata: tutto come prima");
});

test("compiti: i CHECK rifiutano la riga sbagliata; T-n è unico per use case", opts, async () => {
  const task = `INSERT INTO use_case_tasks (use_case_id, workspace_id, ref, title, areas, estimate_hours, status, pr_url, source)
    VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)`;
  const ok = (ref: string) => [ids.useCase, ids.ws, ref, "Ingresso e richiesta normalizzata", '["casi/px-0001/src/ingresso.ts"]', 8, "da_fare", null, "progetto"];
  await rejects(task, [...ok("T-0").slice(0, 2), "T-0", ...ok("T-0").slice(3)], "use_case_tasks_ref_check");
  await rejects(task, [...ok("compito 1").slice(0, 2), "compito 1", ...ok("x").slice(3)], "use_case_tasks_ref_check");
  await rejects(task, [ids.useCase, ids.ws, "T-1", "   ", "[]", 8, "da_fare", null, "progetto"], "use_case_tasks_title_check");
  await rejects(task, [ids.useCase, ids.ws, "T-1", "Titolo", '{"a":1}', 8, "da_fare", null, "progetto"], "use_case_tasks_areas_check");
  await rejects(task, [ids.useCase, ids.ws, "T-1", "Titolo", JSON.stringify(Array.from({ length: 21 }, (_, i) => `a${i}`)), 8, "da_fare", null, "progetto"], "use_case_tasks_areas_check");
  await rejects(task, [ids.useCase, ids.ws, "T-1", "Titolo", "[]", -1, "da_fare", null, "progetto"], "use_case_tasks_hours_check");
  await rejects(task, [ids.useCase, ids.ws, "T-1", "Titolo", "[]", 8, "fermo", null, "progetto"], "use_case_tasks_status_check");
  await rejects(task, [ids.useCase, ids.ws, "T-1", "Titolo", "[]", 8, "da_fare", "https://example.test/pull/1", "progetto"], "use_case_tasks_pr_check");
  await rejects(task, [ids.useCase, ids.ws, "T-1", "Titolo", "[]", 8, "da_fare", null, "email"], "use_case_tasks_source_check");
  await q(task, ok("T-1"));
  await rejects(task, ok("T-1"), "use_case_tasks_ref_unique");
  // Lo stesso riferimento su un altro use case è un altro compito.
  await q(task, [ids.second, ids.ws, "T-1", "Altro compito", "[]", null, "da_fare", null, "cli"]);
  await q(`UPDATE use_case_tasks SET status = 'in_corso', holder_user_id = $3, taken_at = now(), pr_url = 'https://github.com/Prova/repo-di-prova/pull/7' WHERE use_case_id = $1 AND ref = $2`, [ids.useCase, "T-1", ids.user]);
});

test("note: il testo non è vuoto; chi chiede sta solo sulle richieste; repository della fabbrica unici per workspace", opts, async () => {
  const [t] = await q(`SELECT id FROM use_case_tasks WHERE use_case_id = $1 AND ref = 'T-1'`, [ids.useCase]);
  const note = `INSERT INTO use_case_task_notes (task_id, use_case_id, workspace_id, kind, body, requested_by_user_id) VALUES ($1, $2, $3, $4, $5, $6)`;
  await rejects(note, [t.id, ids.useCase, ids.ws, "passaggio", "  ", null], "use_case_task_notes_body_check");
  await rejects(note, [t.id, ids.useCase, ids.ws, "commento", "Testo", null], "use_case_task_notes_kind_check");
  await rejects(note, [t.id, ids.useCase, ids.ws, "passaggio", "Fatto: l'ingresso.", ids.asker], "use_case_task_notes_requester_check");
  await q(note, [t.id, ids.useCase, ids.ws, "passaggio", "Fatto: l'ingresso. Da fare: la coda. Dubbi: nessuno.", null]);
  await q(note, [t.id, ids.useCase, ids.ws, "richiesta", "Posso prenderlo io?", ids.asker]);

  const repo = `INSERT INTO use_case_factory_repos (workspace_id, repo, kind, template_version, common_version) VALUES ($1, $2, $3, $4, $5)`;
  await rejects(repo, [ids.ws, "solo-nome", "famiglia", null, null], "use_case_factory_repos_repo_check");
  await rejects(repo, [ids.ws, "Prova/repo-di-prova", "personale", null, null], "use_case_factory_repos_kind_check");
  await rejects(repo, [ids.ws, "Prova/repo-di-prova", "famiglia", "1.2", null], "use_case_factory_repos_template_check");
  await rejects(repo, [ids.ws, "Prova/repo-di-prova", "famiglia", "1.2.0", "v1"], "use_case_factory_repos_common_check");
  await q(repo, [ids.ws, "Prova/repo-di-prova", "famiglia", "1.2.0", null]);
  await rejects(repo, [ids.ws, "Prova/repo-di-prova", "comune", null, null], "use_case_factory_repos_unique");
  await q(repo, [ids.other, "Prova/repo-di-prova", "famiglia", null, null]);
});

test("chi sparisce lascia il compito senza persona; tutto si cancella con lo use case e con il workspace", opts, async () => {
  await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
  const [t] = await q(`SELECT holder_user_id, status FROM use_case_tasks WHERE use_case_id = $1 AND ref = 'T-1'`, [ids.useCase]);
  assert.deepEqual(t, { holder_user_id: null, status: "in_corso" });
  await q(`DELETE FROM use_cases WHERE id = $1`, [ids.useCase]);
  for (const table of ["use_case_tasks", "use_case_task_notes"]) {
    const [row] = await q(`SELECT count(*)::int AS n FROM ${table} WHERE use_case_id = $1`, [ids.useCase]);
    assert.equal(row.n, 0, table);
  }
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  for (const table of ["use_case_tasks", "use_case_task_notes", "use_case_factory_repos"]) {
    const [row] = await q(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = $1`, [ids.ws]);
    assert.equal(row.n, 0, table);
  }
});
