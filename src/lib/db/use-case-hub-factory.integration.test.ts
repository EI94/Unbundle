import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

// Schema della 0030 sul database di prova dell'hub («Agent Factory», rilascio 8.0a): il file due volte e il
// self-heal due volte non cambiano niente, nemmeno la 0029 di nuovo (che non toglie i tre tipi nuovi della
// campanella); ogni CHECK rifiuta la riga sbagliata; una sola versione aperta e una sola approvata del
// progetto; senza l'AI Board un progetto con strumenti nuovi non si approva; le righe si cancellano con il
// loro use case e con il loro workspace.
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
let ddl: typeof import("./use-case-hub-factory-ddl.ts");
let ensure: typeof import("./ensure-schema.ts");

const migration = readFileSync(new URL("../../../drizzle/0030_agent_factory.sql", import.meta.url), "utf8");
const migration0029 = readFileSync(new URL("../../../drizzle/0029_program.sql", import.meta.url), "utf8");
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), other: randomUUID(), useCase: randomUUID(), second: randomUUID(), foreign: randomUUID(), user: randomUUID() };

const TABLES = ["use_case_packages", "use_case_projects", "use_case_decisions", "use_case_notifications"];
const HASH = "a".repeat(64);
const FILES = JSON.stringify({ "PACCHETTO.md": "# Pacchetto di prova", "BRIEF.md": "Brief di prova", VERSIONE: "k1 · prova" });

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
  return (await q(`SELECT ${ddl.FACTORY_PROBE_SQL} AS ok`))[0]?.ok === true;
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
  ddl = await import("./use-case-hub-factory-ddl.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova 0030', $2)`, [ids.org, `org-0030-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova 0030'), ($3, $2, 'Altro workspace 0030')`, [ids.ws, ids.org, ids.other]);
  await q(`INSERT INTO use_cases (id, workspace_id, title) VALUES ($1, $2, 'Scheda di prova 0030'), ($3, $2, 'Seconda scheda 0030'), ($4, $5, 'Scheda di un altro workspace')`, [
    ids.useCase,
    ids.ws,
    ids.second,
    ids.foreign,
    ids.other,
  ]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Persona di prova 0030')`, [ids.user, `prova-0030-${suffix}@example.test`]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM workspaces WHERE id IN ($1, $2)`, [ids.ws, ids.other]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
});

test("lo schema della 0030 c'è; il file due volte, il self-heal due volte, la 0029 di nuovo non cambiano niente", opts, async () => {
  const [row] = await q(`SELECT current_database() AS db`);
  assert.equal(row.db, process.env.UC_TEST_PG_DB);
  assert.equal(await probe(), true);
  const first = await schemaSnapshot();
  await q(migration);
  await q(migration);
  assert.equal(await schemaSnapshot(), first, "il file due volte");
  await ensure.runFactoryDdl();
  await ensure.runFactoryDdl();
  assert.equal(await schemaSnapshot(), first, "il self-heal due volte");
  await q(migration0029);
  await ensure.runProgramDdl();
  assert.equal(await schemaSnapshot(), first, "la 0029 di nuovo non toglie i tipi nuovi");
  const [kinds] = await q(`SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conname = 'use_case_notifications_kind_check'`);
  assert.match(String(kinds.def), /'da_rivedere'[\s\S]*'progetto_appr'[\s\S]*'strumento_nuovo'[\s\S]*'pacchetto_nuovo'/);
  assert.equal(kinds.convalidated, true);
  const uc = await q(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('uc_case_projects', 'uc_decisions', 'uc_case_packages')`);
  assert.equal(uc[0].n, 0, "nessuna tabella uc nuova");
});

test("su un database senza la 0030 il self-heal la crea (in una transazione annullata)", opts, async () => {
  const marker = `prova-0030-annullata-${suffix}`;
  const text = [
    `DROP TABLE use_case_decisions, use_case_projects, use_case_packages;`,
    `DELETE FROM use_case_notifications WHERE kind IN ('progetto_appr', 'strumento_nuovo', 'pacchetto_nuovo');`,
    `DO $$ BEGIN IF ${ddl.FACTORY_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora vera'; END IF; END $$;`,
    ...ddl.FACTORY_DDL,
    `DO $$ BEGIN IF NOT ${ddl.FACTORY_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora falsa'; END IF; END $$;`,
    `DO $$ BEGIN RAISE EXCEPTION '${marker}'; END $$;`,
  ].join("\n");
  await assert.rejects(q(text), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(marker));
  assert.equal(await probe(), true, "annullata: tutto come prima");
});

test("i CHECK del pacchetto: versione, impronta, i tre file come testo, la fonte, una versione e un'impronta per use case", opts, async () => {
  const p = [ids.useCase, ids.ws];
  const insert = `INSERT INTO use_case_packages (use_case_id, workspace_id, version, content_hash, files, source) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`;
  await rejects(insert, [...p, 0, HASH, FILES, "generato"], "use_case_packages_version_check");
  await rejects(insert, [...p, 1, "ABC", FILES, "generato"], "use_case_packages_hash_check");
  await rejects(insert, [...p, 1, HASH, JSON.stringify({ "PACCHETTO.md": "x", "BRIEF.md": "y" }), "generato"], "use_case_packages_files_check");
  await rejects(insert, [...p, 1, HASH, JSON.stringify({ "PACCHETTO.md": "x", "BRIEF.md": "y", VERSIONE: 1 }), "generato"], "use_case_packages_files_check");
  await rejects(insert, [...p, 1, HASH, FILES, "a_mano"], "use_case_packages_source_check");
  await rejects(insert, [...p, 1, HASH, JSON.stringify({ "PACCHETTO.md": "x".repeat(200_001), "BRIEF.md": "y", VERSIONE: "z" }), "generato"], "use_case_packages_size_check");
  await q(insert, [...p, 1, HASH, FILES, "importato"]);
  await rejects(insert, [...p, 1, "b".repeat(64), FILES, "generato"], "use_case_packages_version_unique");
  await q(insert, [...p, 2, "b".repeat(64), FILES, "generato"]);
  await q(insert, [...p, 3, HASH, FILES, "generato"]); // la scheda torna com'era: k3 come k1, e va bene
  await q(insert, [ids.second, ids.ws, 1, HASH, FILES, "generato"]);
});

test("il progetto: stati, framework, strumenti nuovi, una sola versione aperta e una approvata, l'AI Board", opts, async () => {
  const p = [ids.useCase, ids.ws];
  const insert = `INSERT INTO use_case_projects (use_case_id, workspace_id, version, status, framework, new_tools, submitted_at, approved_at, ai_board_ok_at)
    VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz, $8::timestamptz, $9::timestamptz)`;
  const now = new Date().toISOString();
  const tools = JSON.stringify([{ nome: "Neon", perche: "database del caso" }]);
  await rejects(insert, [...p, 1, "chiuso", null, "[]", null, null, null], "use_case_projects_status_check");
  await rejects(insert, [...p, 1, "in_corso", "langchain", "[]", null, null, null], "use_case_projects_framework_check");
  await rejects(insert, [...p, 1, "in_corso", null, "{}", null, null, null], "use_case_projects_new_tools_check");
  await rejects(insert, [...p, 1, "da_approvare", null, "[]", null, null, null], "use_case_projects_submitted_check");
  await rejects(insert, [...p, 1, "approvato", null, "[]", now, null, null], "use_case_projects_approved_check");
  await rejects(insert, [...p, 1, "approvato", "codice", tools, now, now, null], "use_case_projects_ai_board_check");
  await rejects(`INSERT INTO use_case_projects (use_case_id, workspace_id, version, estimate_hours) VALUES ($1, $2, 1, -1)`, p, "use_case_projects_hours_check");
  await rejects(`INSERT INTO use_case_projects (use_case_id, workspace_id, version, topics) VALUES ($1, $2, 1, '[]'::jsonb)`, p, "use_case_projects_topics_check");
  await q(insert, [...p, 1, "approvato", "codice", tools, now, now, now]);
  await rejects(insert, [...p, 2, "approvato", "codice", "[]", now, now, null], "use_case_projects_approved_unique");
  await q(insert, [...p, 2, "in_corso", "codice", "[]", null, null, null]);
  await rejects(insert, [...p, 3, "da_approvare", "codice", "[]", now, null, null], "use_case_projects_open_unique");
  await rejects(insert, [...p, 2, "superato", "codice", "[]", null, null, null], "use_case_projects_version_unique");
  // La versione approvata diventa «superata» quando si approva la nuova, nella stessa transazione.
  await q(`UPDATE use_case_projects SET status = 'superato' WHERE use_case_id = $1 AND version = 1`, [ids.useCase]);
  await q(`UPDATE use_case_projects SET status = 'approvato', submitted_at = now(), approved_at = now() WHERE use_case_id = $1 AND version = 2`, [ids.useCase]);
  const rows = await q(`SELECT version, status FROM use_case_projects WHERE use_case_id = $1 ORDER BY version`, [ids.useCase]);
  assert.deepEqual(rows.map((r) => [r.version, r.status]), [[1, "superato"], [2, "approvato"]]);
});

test("le decisioni: argomento dell'impostazione, testo non vuoto, fonte, un autore o il suo ruolo", opts, async () => {
  const p = [ids.useCase, ids.ws];
  const insert = `INSERT INTO use_case_decisions (use_case_id, workspace_id, decided_on, topic_key, topic, choice, source, author_user_id, author_role)
    VALUES ($1, $2, '2026-11-09', $3, $4, $5, $6, $7, $8)`;
  await rejects(insert, [...p, "prezzo", "Prezzo", "x", "team", ids.user, null], "use_case_decisions_topic_key_check");
  await rejects(insert, [...p, null, "  ", "x", "team", ids.user, null], "use_case_decisions_topic_check");
  await rejects(insert, [...p, null, "Strumenti nuovi", " ", "team", ids.user, null], "use_case_decisions_choice_check");
  await rejects(insert, [...p, null, "Strumenti nuovi", "Neon", "chat", ids.user, null], "use_case_decisions_source_check");
  await q(insert, [...p, "dati", "Dati", "Neon in UE", "importata", null, "responsabile del caso"]);
  await q(insert, [...p, null, "Strumenti nuovi", "Neon e Langfuse approvati", "team", ids.user, null]);
  const rows = await q(`SELECT topic, author_role FROM use_case_decisions WHERE use_case_id = $1 ORDER BY decided_on, created_at`, [ids.useCase]);
  assert.equal(rows.length, 2);
  // Una persona autrice si può cancellare: la decisione resta, senza autore.
  const author = randomUUID();
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Autore di prova 0030')`, [author, `autore-0030-${suffix}@example.test`]);
  await q(insert, [...p, null, "Prova", "Decisione di una persona che poi esce", "team", author, null]);
  await q(`DELETE FROM users WHERE id = $1`, [author]);
  const [kept] = await q(`SELECT count(*)::int AS n FROM use_case_decisions WHERE use_case_id = $1 AND choice = 'Decisione di una persona che poi esce' AND author_user_id IS NULL`, [ids.useCase]);
  assert.equal(kept.n, 1);
});

test("i tipi nuovi della campanella si scrivono; le righe si cancellano con lo use case e con il workspace", opts, async () => {
  await q(`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day) VALUES ($1, $2, $3, 'progetto_appr', current_date), ($1, $2, $3, 'pacchetto_nuovo', current_date)`, [
    ids.ws,
    ids.useCase,
    ids.user,
  ]);
  await rejects(`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day) VALUES ($1, $2, $3, 'progetto', current_date)`, [ids.ws, ids.useCase, ids.user], "use_case_notifications_kind_check");
  await q(`DELETE FROM use_cases WHERE id = $1`, [ids.second]);
  const second = await q(`SELECT count(*)::int AS n FROM use_case_packages WHERE use_case_id = $1`, [ids.second]);
  assert.equal(second[0].n, 0, "con lo use case");
  await q(`DELETE FROM use_cases WHERE id = $1`, [ids.useCase]);
  for (const table of ["use_case_packages", "use_case_projects", "use_case_decisions"]) {
    const [r] = await q(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id = $1`, [ids.ws]);
    assert.equal(r.n, 0, table);
  }
});
