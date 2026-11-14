import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  GITHUB_ADVISORY_LOCK,
  GITHUB_DDL,
  GITHUB_DELIVERY_OUTCOMES,
  GITHUB_INDEXES,
  GITHUB_NAMED_CONSTRAINTS,
  GITHUB_NOTICE_KINDS,
  GITHUB_PROBE_SQL,
  GITHUB_ROLLBACK_SWEEP_SQL,
  GITHUB_TABLES,
  MISSING_TASKS_FOR_GITHUB_MESSAGE,
  PULL_REQUEST_STATES,
  USE_CASE_NOTIFICATION_KINDS_0033,
} from "./use-case-hub-github-ddl.ts";
import { ALERTS_ADVISORY_LOCK } from "./use-case-hub-alerts-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0032 } from "./use-case-hub-tasks-ddl.ts";
import * as schema from "./schema.ts";

// Migrazione 0033 e self-heal: gli eventi di GitHub ricevuti e le pull request dei casi (rilascio 8.1b). Le prove
// sul database stanno in src/lib/db/use-case-hub-github.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0033_github.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");

function normalize(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

function topLevelFunction(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `manca: ${signature}`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `fine non trovata: ${signature}`);
  return source.slice(start, end + 2);
}

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-github-ddl'));"];

const tableOf = (name: string) => {
  const found = GITHUB_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`));
  assert.ok(found, `manca la tabella ${name}`);
  return found;
};

function ddlColumns(statement: string): string[] {
  return statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|char|smallint|timestamptz|integer|bigint|boolean|jsonb|date|numeric)\b/)?.[1])
    .filter((n): n is string => Boolean(n));
}

function checkList(statement: string, constraint: string): string[] {
  const at = statement.indexOf(`CONSTRAINT ${constraint} CHECK`);
  assert.notEqual(at, -1, `manca ${constraint}`);
  const list = statement.slice(at).match(/IN \(([^)]*)\)/)?.[1] ?? "";
  return [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

test("0033: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "lock_timeout e advisory lock in testa");
  assert.equal(GITHUB_ADVISORY_LOCK, "unbundle:use-case-github-ddl");
  let cursor = 0;
  for (const statement of GITHUB_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...GITHUB_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0033_github\.sql/);
  assert.match(migration, /In produzione la applica il self-heal dell'app al primo avvio dopo il deploy/);
});

test("controllo iniziale: senza la 0032 si ferma con il suo messaggio", () => {
  assert.match(GITHUB_DDL[0], /^DO \$\$ BEGIN\s+IF to_regclass\('public\.use_case_tasks'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(GITHUB_DDL[0].includes(`'${MISSING_TASKS_FOR_GITHUB_MESSAGE}'`));
  assert.doesNotMatch(MISSING_TASKS_FOR_GITHUB_MESSAGE, /[%']/);
});

test("solo aggiunte: niente dati scritti, niente colonne cambiate; il solo DROP è il CHECK della campanella; il DDL uc non si tocca", () => {
  const widen = GITHUB_DDL[GITHUB_DDL.length - 1];
  for (const statement of GITHUB_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|ALTER\s+COLUMN|ADD\s+COLUMN|\bRENAME\b|DROP\s+(TABLE|COLUMN|INDEX)/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    assert.doesNotMatch(statement, /\buc_[a-z_]+/, "nessuna tabella uc: il DDL uc (0018) non cambia");
    if (statement !== widen) assert.doesNotMatch(statement, /DROP\s+CONSTRAINT/i);
    if (statement !== widen) assert.doesNotMatch(statement, /\?/);
  }
  assert.match(widen, /DROP CONSTRAINT IF EXISTS use_case_notifications_kind_check/);
  assert.equal(GITHUB_DDL[GITHUB_DDL.length - 2], `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`, "sotto il lock della 0025");
});

test("i tipi della campanella: quelli della 0032, nello stesso ordine, più pr_da_rivedere, entro 16 caratteri", () => {
  assert.deepEqual(USE_CASE_NOTIFICATION_KINDS_0033, [...USE_CASE_NOTIFICATION_KINDS_0032, "pr_da_rivedere"]);
  const widen = GITHUB_DDL[GITHUB_DDL.length - 1];
  for (const kind of USE_CASE_NOTIFICATION_KINDS_0033) {
    assert.ok(widen.includes(`'${kind}'`), kind);
    assert.ok(kind.length <= 16, `${kind} entra in kind varchar(16)`);
  }
  assert.deepEqual(GITHUB_ROLLBACK_SWEEP_SQL, [`DELETE FROM use_case_notifications WHERE kind IN (${GITHUB_NOTICE_KINDS.map((k) => `'${k}'`).join(", ")});`]);
});

test("i CHECK sono gli elenchi del vocabolario", () => {
  assert.deepEqual(checkList(tableOf("use_case_pull_requests"), "use_case_pull_requests_state_check"), [...PULL_REQUEST_STATES]);
  assert.deepEqual(checkList(tableOf("use_case_github_deliveries"), "use_case_github_deliveries_outcome_check"), [...GITHUB_DELIVERY_OUTCOMES]);
});

test("le regole stanno anche nel database: una PR per numero e repository, unita solo con la data, mai una persona", () => {
  const prs = tableOf("use_case_pull_requests");
  assert.match(prs, /CONSTRAINT use_case_pull_requests_unique UNIQUE \(workspace_id, repo, number\)/);
  assert.match(prs, /CONSTRAINT use_case_pull_requests_merged_check CHECK \(\(state = 'unita'\) = \(merged_at IS NOT NULL\)\)/);
  assert.match(prs, /task_id uuid REFERENCES use_case_tasks\(id\) ON DELETE SET NULL/);
  assert.match(tableOf("use_case_github_deliveries"), /CONSTRAINT use_case_github_deliveries_pkey PRIMARY KEY \(delivery_id\)/);
  // Art. 15.4: nessuna colonna su chi apre, unisce o manda; nessun indice su una persona.
  for (const name of GITHUB_TABLES) assert.doesNotMatch(tableOf(name), /\b(proposed_by|submitted_by|author|actor|sender|user_id|login)\w*/, name);
  assert.deepEqual(GITHUB_DDL.filter((s) => /^CREATE (UNIQUE )?INDEX/.test(s) && /user/.test(s)), []);
  // Degli eventi solo evento, repository ed esito: mai il contenuto.
  assert.deepEqual(ddlColumns(tableOf("use_case_github_deliveries")), ["delivery_id", "event", "repo", "outcome", "received_at"]);
});

test("le pull request si cancellano con il workspace e con lo use case; il compito, se sparisce, le lascia", () => {
  const prs = tableOf("use_case_pull_requests");
  assert.match(prs, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(prs, /use_case_id uuid NOT NULL REFERENCES use_cases\(id\) ON DELETE CASCADE/);
});

test("la sonda copre ogni tabella, ogni indice, ogni vincolo con nome e il tipo nuovo della campanella", () => {
  for (const name of GITHUB_TABLES) assert.ok(GITHUB_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
  for (const name of GITHUB_INDEXES) {
    assert.ok(GITHUB_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
    assert.ok(GITHUB_DDL.some((s) => s.includes(` ${name} ON `)), `l'indice ${name} è nel DDL`);
  }
  const all = GITHUB_DDL.join("\n");
  const named = [...all.matchAll(/CONSTRAINT ([a-z_]+) (CHECK|PRIMARY KEY|UNIQUE)/g)].map((m) => m[1]).filter((n) => GITHUB_TABLES.some((t) => n.startsWith(t)));
  assert.deepEqual([...named].sort(), [...GITHUB_NAMED_CONSTRAINTS].sort());
  assert.ok(GITHUB_PROBE_SQL.includes(`) = ${GITHUB_NAMED_CONSTRAINTS.length}`));
  assert.ok(GITHUB_PROBE_SQL.includes("position('''pr_da_rivedere''' IN pg_get_constraintdef(c.oid)) > 0"));
});

test("ensure-schema: versione 27, la 0033 dopo la 0032, non fatale, con timeout e lock, e la sonda in AND", () => {
  assert.match(ensureSchema, /const ENSURE_VERSION = 27;/);
  assert.match(ensureSchema, /import \{ GITHUB_DDL, GITHUB_PROBE_SQL \} from "\.\/use-case-hub-github-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const tasks = runOnce.indexOf("await runTasksDdlSafely();");
  const github = runOnce.indexOf("await runGithubDdlSafely();");
  assert.ok(tasks > 0 && github > tasks, "0032 poi 0033");
  assert.ok(!runOnce.includes("await runGithubDdl();"), "la 0033 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runGithubDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runGithubDdl\(\);\s+githubDdlFailedAt = null;\s+\} catch \(err\) \{\s+githubDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(ensure, /Date\.now\(\) - githubDdlFailedAt >= REFERENTS_DDL_RETRY_MS/);
  assert.match(ensure, /ensurePromise = ensurePromise\.then\(runGithubDdlSafely\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(TASKS_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(GITHUB_PROBE_SQL\)\}/);
  const runner = topLevelFunction(ensureSchema, "export async function runGithubDdl(statements: readonly string[] = GITHUB_DDL): Promise<void> {");
  const timeout = runner.indexOf("set_config('lock_timeout', '3s', true)");
  const lock = runner.indexOf(`pg_advisory_xact_lock(hashtext('${GITHUB_ADVISORY_LOCK}'))`);
  const statements = runner.indexOf("...statements.map");
  assert.ok(timeout > 0 && lock > timeout && statements > lock, "timeout, lock, poi gli statement");
});

test("le colonne Drizzle sono quelle del DDL, nello stesso ordine", () => {
  const tables = [schema.useCaseGithubDeliveries, schema.useCasePullRequests];
  assert.deepEqual(tables.map((t) => getTableName(t)), [...GITHUB_TABLES]);
  for (const table of tables) {
    const drizzle = Object.values(getTableColumns(table)).map((column) => column.name);
    assert.deepEqual(drizzle, ddlColumns(tableOf(getTableName(table))), getTableName(table));
  }
});
