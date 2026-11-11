import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";

// Schema della 0031 sul database di prova dell'hub («La CLI e l'MCP», rilascio 8.0b): il file due volte e il
// self-heal due volte non cambiano niente, nemmeno la 0030 di nuovo (che non toglie `domanda_agente` dalla
// campanella); ogni CHECK rifiuta la riga sbagliata; un codice di login vivo è unico; una sessione conta una volta
// sola; le righe si cancellano con il loro use case e con il loro workspace.
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
let ddl: typeof import("./use-case-hub-cli-ddl.ts");
let ensure: typeof import("./ensure-schema.ts");

const migration = readFileSync(new URL("../../../drizzle/0031_cli.sql", import.meta.url), "utf8");
const migration0030 = readFileSync(new URL("../../../drizzle/0030_agent_factory.sql", import.meta.url), "utf8");
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), ws: randomUUID(), other: randomUUID(), useCase: randomUUID(), second: randomUUID(), user: randomUUID() };

const TABLES = ["use_case_cli_logins", "use_case_repos", "use_case_agent_questions", "use_case_build_sessions", "use_case_notifications"];
const HASH = (c: string) => c.repeat(64);

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
  return (await q(`SELECT ${ddl.CLI_PROBE_SQL} AS ok`))[0]?.ok === true;
}

async function rejects(sqlText: string, params: unknown[], constraint: string) {
  await assert.rejects(q(sqlText, params), (error: unknown) => {
    const text = String((error as { message?: unknown })?.message ?? error);
    assert.ok(text.includes(constraint), `atteso ${constraint}, ricevuto: ${text}`);
    return true;
  });
}

const login = (code: string, extra = "") =>
  `INSERT INTO use_case_cli_logins (device_code_hash, user_code, client_label, expires_at${extra ? `, ${extra}` : ""}) VALUES ($1, '${code}', 'CLI di prova · macOS', now() + interval '10 minutes'`;

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  q = (text, params = []) => sql.query(text, params) as Promise<Row[]>;
  ensure = await import("./ensure-schema.ts");
  await ensure.ensureDbSchema();
  ddl = await import("./use-case-hub-cli-ddl.ts");
  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova 0031', $2)`, [ids.org, `org-0031-${suffix}`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, 'Workspace di prova 0031'), ($3, $2, 'Altro workspace 0031')`, [ids.ws, ids.org, ids.other]);
  await q(`INSERT INTO use_cases (id, workspace_id, title) VALUES ($1, $2, 'Scheda di prova 0031'), ($3, $2, 'Seconda scheda 0031')`, [ids.useCase, ids.ws, ids.second]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Persona di prova 0031')`, [ids.user, `prova-0031-${suffix}@example.test`]);
});

after(async () => {
  if (!enabled) return;
  await q(`DELETE FROM use_case_cli_logins WHERE client_label = 'CLI di prova · macOS'`);
  await q(`DELETE FROM workspaces WHERE id IN ($1, $2)`, [ids.ws, ids.other]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
});

test("lo schema della 0031 c'è; il file due volte, il self-heal due volte, la 0030 di nuovo non cambiano niente", opts, async () => {
  const [row] = await q(`SELECT current_database() AS db`);
  assert.equal(row.db, process.env.UC_TEST_PG_DB);
  assert.equal(await probe(), true);
  const first = await schemaSnapshot();
  await q(migration);
  await q(migration);
  assert.equal(await schemaSnapshot(), first, "il file due volte");
  await ensure.runCliDdl();
  await ensure.runCliDdl();
  assert.equal(await schemaSnapshot(), first, "il self-heal due volte");
  await q(migration0030);
  await ensure.runFactoryDdl();
  assert.equal(await schemaSnapshot(), first, "la 0030 di nuovo non toglie domanda_agente");
  const [kinds] = await q(`SELECT pg_get_constraintdef(oid) AS def, convalidated FROM pg_constraint WHERE conname = 'use_case_notifications_kind_check'`);
  assert.match(String(kinds.def), /'ok_decaduto'[\s\S]*'domanda_agente'/);
  assert.equal(kinds.convalidated, true);
});

test("su un database senza la 0031 il self-heal la crea (in una transazione annullata)", opts, async () => {
  const marker = `prova-0031-annullata-${suffix}`;
  const text = [
    `DROP TABLE use_case_build_sessions, use_case_agent_questions, use_case_repos, use_case_cli_logins;`,
    `DELETE FROM use_case_notifications WHERE kind = 'domanda_agente';`,
    `DO $$ BEGIN IF ${ddl.CLI_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora vera'; END IF; END $$;`,
    ...ddl.CLI_DDL,
    `DO $$ BEGIN IF NOT ${ddl.CLI_PROBE_SQL} THEN RAISE EXCEPTION 'sonda ancora falsa'; END IF; END $$;`,
    `DO $$ BEGIN RAISE EXCEPTION '${marker}'; END $$;`,
  ].join("\n");
  await assert.rejects(q(text), (error: unknown) => String((error as { message?: unknown })?.message ?? error).includes(marker));
  assert.equal(await probe(), true, "annullata: tutto come prima");
});

test("i codici di login: solo consonanti, uno solo vivo con lo stesso codice, confermato solo con persona e workspace", opts, async () => {
  await rejects(`${login("ABCD-EFGH")})`, [HASH("1")], "use_case_cli_logins_code_check");
  await rejects(`${login("BCDF-GHJK")})`.replace("$1", "'non-esadecimale'"), [], "use_case_cli_logins_device_check");
  await q(`${login("BCDF-GHJK")})`, [HASH("2")]);
  await rejects(`${login("BCDF-GHJK")})`, [HASH("3")], "use_case_cli_logins_code_live_unique");
  await rejects(`${login("BCDF-GHJK")})`, [HASH("2")], "use_case_cli_logins_device_unique");
  await rejects(`${login("ZZZZ-ZZZZ", "status")}, 'confermato')`, [HASH("4")], "use_case_cli_logins_confirmed_check");
  await rejects(`${login("ZZZZ-ZZZB", "status")}, 'altro')`, [HASH("5")], "use_case_cli_logins_status_check");
  // Usato o scaduto, lo stesso codice si può dare di nuovo.
  await q(`UPDATE use_case_cli_logins SET status = 'scaduto' WHERE device_code_hash = $1`, [HASH("2")]);
  await q(`${login("BCDF-GHJK")})`, [HASH("6")]);
  await q(
    `${login("BCDF-GHJL", "status, workspace_id, user_id, decided_at, delivered_at")}, 'consegnato', $2, $3, now(), now())`,
    [HASH("7"), ids.ws, ids.user],
  );
});

test("repository, domande e sessioni: i CHECK rifiutano la riga sbagliata", opts, async () => {
  const repo = `INSERT INTO use_case_repos (use_case_id, workspace_id, repo, folder, profile) VALUES ($1, $2, $3, $4, $5)`;
  await rejects(repo, [ids.useCase, ids.ws, "solo-nome", "casi/px-0001", null], "use_case_repos_repo_check");
  await rejects(repo, [ids.useCase, ids.ws, "Prova/repo-di-prova", "../fuori", null], "use_case_repos_folder_check");
  await rejects(repo, [ids.useCase, ids.ws, "Prova/repo-di-prova", "casi/px-0001", "zapier"], "use_case_repos_profile_check");
  await q(repo, [ids.useCase, ids.ws, "Prova/repo-di-prova", "casi/px-0001", "codice"]);
  await rejects(repo, [ids.useCase, ids.ws, "Prova/repo-di-prova", "casi/px-0001", "n8n"], "use_case_repos_unique");

  const question = `INSERT INTO use_case_agent_questions (use_case_id, workspace_id, question, channel, status, decided_at) VALUES ($1, $2, $3, $4, $5, $6)`;
  await rejects(question, [ids.useCase, ids.ws, "   ", "cli", "proposta", null], "use_case_agent_questions_question_check");
  await rejects(question, [ids.useCase, ids.ws, "Chi approva le eccezioni?", "web", "proposta", null], "use_case_agent_questions_channel_check");
  await rejects(question, [ids.useCase, ids.ws, "Chi approva le eccezioni?", "cli", "aggiunta", null], "use_case_agent_questions_decided_check");
  await q(question, [ids.useCase, ids.ws, "Chi approva le eccezioni?", "mcp", "proposta", null]);

  const session = `INSERT INTO use_case_build_sessions (use_case_id, workspace_id, session_key, task_ref, harness, input_tokens, duration_seconds, outcome, pr_url, ended_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`;
  await rejects(session, [ids.useCase, ids.ws, HASH("a"), "compito 3", "claude_code", 10, 60, "pr", null], "use_case_build_sessions_task_check");
  await rejects(session, [ids.useCase, ids.ws, HASH("a"), "T-3", "vim", 10, 60, "pr", null], "use_case_build_sessions_harness_check");
  await rejects(session, [ids.useCase, ids.ws, HASH("a"), "T-3", "claude_code", -1, 60, "pr", null], "use_case_build_sessions_input_check");
  await rejects(session, [ids.useCase, ids.ws, HASH("a"), "T-3", "claude_code", 10, 60, "pr", "https://example.test/pull/1"], "use_case_build_sessions_pr_check");
  await rejects(session, [ids.useCase, ids.ws, HASH("a"), "T-3", "claude_code", 10, 999_999, "pr", null], "use_case_build_sessions_duration_check");
  await q(session, [ids.useCase, ids.ws, HASH("a"), "T-3", "claude_code", 10, 60, "pr", "https://github.com/Prova/repo-di-prova/pull/12"]);
  await rejects(session, [ids.useCase, ids.ws, HASH("a"), "T-4", "codex", 5, 30, "commit", null], "use_case_build_sessions_unique");
  // La stessa sessione su un altro use case è un'altra riga.
  await q(session, [ids.second, ids.ws, HASH("a"), null, "codex", 5, 30, "nessuna_modifica", null]);
});

test("tutto si cancella con lo use case; il login con il suo workspace", opts, async () => {
  await q(`DELETE FROM use_cases WHERE id = $1`, [ids.useCase]);
  for (const table of ["use_case_repos", "use_case_agent_questions", "use_case_build_sessions"]) {
    const [row] = await q(`SELECT count(*)::int AS n FROM ${table} WHERE use_case_id = $1`, [ids.useCase]);
    assert.equal(row.n, 0, table);
  }
  await q(`DELETE FROM workspaces WHERE id = $1`, [ids.ws]);
  const [logins] = await q(`SELECT count(*)::int AS n FROM use_case_cli_logins WHERE workspace_id = $1`, [ids.ws]);
  assert.equal(logins.n, 0);
});
