import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  FACTORY_REPO_KINDS,
  MISSING_CLI_FOR_TASKS_MESSAGE,
  TASK_NOTE_KINDS,
  TASK_NOTICE_KINDS,
  TASK_SOURCES,
  TASK_STATUSES,
  TASKS_ADVISORY_LOCK,
  TASKS_DDL,
  TASKS_INDEXES,
  TASKS_NAMED_CONSTRAINTS,
  TASKS_PROBE_SQL,
  TASKS_ROLLBACK_SWEEP_SQL,
  TASKS_TABLES,
  USE_CASE_NOTIFICATION_KINDS_0032,
} from "./use-case-hub-tasks-ddl.ts";
import { ALERTS_ADVISORY_LOCK } from "./use-case-hub-alerts-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0031 } from "./use-case-hub-cli-ddl.ts";
import * as schema from "./schema.ts";

// Migrazione 0032 e self-heal: compiti, note di passaggio, repository della fabbrica (rilascio 8.1a). Le prove sul
// database stanno in src/lib/db/use-case-hub-tasks.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0032_compiti.sql", import.meta.url), "utf8");
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-tasks-ddl'));"];

const tableOf = (name: string) => {
  const found = TASKS_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`));
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

test("0032: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "lock_timeout e advisory lock in testa");
  assert.equal(TASKS_ADVISORY_LOCK, "unbundle:use-case-tasks-ddl");
  let cursor = 0;
  for (const statement of TASKS_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...TASKS_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0032_compiti\.sql/);
  assert.match(migration, /In produzione la applica il self-heal dell'app al primo avvio dopo il deploy/);
});

test("controllo iniziale: senza la 0031 si ferma con il suo messaggio", () => {
  assert.match(TASKS_DDL[0], /^DO \$\$ BEGIN\s+IF to_regclass\('public\.use_case_build_sessions'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(TASKS_DDL[0].includes(`'${MISSING_CLI_FOR_TASKS_MESSAGE}'`));
  assert.doesNotMatch(MISSING_CLI_FOR_TASKS_MESSAGE, /[%']/);
});

test("solo aggiunte: niente dati scritti, niente colonne cambiate; il solo DROP è il CHECK della campanella; il DDL uc non si tocca", () => {
  const widen = TASKS_DDL[TASKS_DDL.length - 1];
  for (const statement of TASKS_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|ALTER\s+COLUMN|ADD\s+COLUMN|\bRENAME\b|DROP\s+(TABLE|COLUMN|INDEX)/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    assert.doesNotMatch(statement, /\buc_[a-z_]+/, "nessuna tabella uc: il DDL uc (0018) non cambia");
    if (statement !== widen) assert.doesNotMatch(statement, /DROP\s+CONSTRAINT/i);
    if (statement !== widen) assert.doesNotMatch(statement, /\?/);
  }
  assert.match(widen, /DROP CONSTRAINT IF EXISTS use_case_notifications_kind_check/);
  assert.equal(TASKS_DDL[TASKS_DDL.length - 2], `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`, "sotto il lock della 0025");
});

test("i tipi della campanella: quelli della 0031, nello stesso ordine, più i quattro dei compiti, entro 16 caratteri", () => {
  assert.deepEqual(USE_CASE_NOTIFICATION_KINDS_0032, [...USE_CASE_NOTIFICATION_KINDS_0031, "compito_chiesto", "compito_passato", "compito_fermo", "compiti_pronti"]);
  const widen = TASKS_DDL[TASKS_DDL.length - 1];
  for (const kind of USE_CASE_NOTIFICATION_KINDS_0032) {
    assert.ok(widen.includes(`'${kind}'`), kind);
    assert.ok(kind.length <= 16, `${kind} entra in kind varchar(16)`);
  }
  assert.deepEqual(TASKS_ROLLBACK_SWEEP_SQL, [`DELETE FROM use_case_notifications WHERE kind IN (${TASK_NOTICE_KINDS.map((k) => `'${k}'`).join(", ")});`]);
});

test("i CHECK sono gli elenchi del vocabolario", () => {
  assert.deepEqual(checkList(tableOf("use_case_tasks"), "use_case_tasks_status_check"), [...TASK_STATUSES]);
  assert.deepEqual(checkList(tableOf("use_case_tasks"), "use_case_tasks_source_check"), [...TASK_SOURCES]);
  assert.deepEqual(checkList(tableOf("use_case_task_notes"), "use_case_task_notes_kind_check"), [...TASK_NOTE_KINDS]);
  assert.deepEqual(checkList(tableOf("use_case_factory_repos"), "use_case_factory_repos_kind_check"), [...FACTORY_REPO_KINDS]);
});

test("le regole stanno anche nel database: un riferimento per caso, la PR solo su GitHub, chi chiede solo sulle richieste", () => {
  const tasks = tableOf("use_case_tasks");
  assert.match(tasks, /CONSTRAINT use_case_tasks_ref_unique UNIQUE \(use_case_id, ref\)/);
  assert.ok(tasks.includes("ref ~ '^T-[1-9][0-9]{0,3}$'"));
  assert.ok(tasks.includes("pr_url IS NULL OR pr_url ~ '^https://github\\.com/"), "la PR solo su GitHub");
  assert.match(tasks, /holder_user_id uuid REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.match(tableOf("use_case_task_notes"), /CONSTRAINT use_case_task_notes_requester_check CHECK \(kind = 'richiesta' OR requested_by_user_id IS NULL\)/);
  assert.match(tableOf("use_case_factory_repos"), /CONSTRAINT use_case_factory_repos_unique UNIQUE \(workspace_id, repo\)/);
  // Art. 15.4: nessuna colonna sul proponente, nessun indice su chi ha fatto cosa; l'unico indice su una persona è
  // quello dei compiti aperti di chi guarda («Da fare per te»).
  for (const name of TASKS_TABLES) assert.doesNotMatch(tableOf(name), /\b(proposed_by|submitted_by|author|actor)\w*/, name);
  const personIndexes = TASKS_DDL.filter((s) => /^CREATE (UNIQUE )?INDEX/.test(s) && /user_id/.test(s));
  assert.deepEqual(personIndexes, ["CREATE INDEX IF NOT EXISTS use_case_tasks_open_holder_idx ON use_case_tasks (holder_user_id) WHERE status IN ('in_corso', 'in_revisione');"]);
});

test("ogni tabella si cancella con il suo workspace; compiti e note anche con il loro use case", () => {
  for (const name of TASKS_TABLES) assert.match(tableOf(name), /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/, name);
  for (const name of ["use_case_tasks", "use_case_task_notes"]) assert.match(tableOf(name), /use_case_id uuid NOT NULL REFERENCES use_cases\(id\) ON DELETE CASCADE/, name);
  assert.match(tableOf("use_case_task_notes"), /task_id uuid NOT NULL REFERENCES use_case_tasks\(id\) ON DELETE CASCADE/);
});

test("la sonda copre ogni tabella, ogni indice, ogni vincolo con nome e i tipi nuovi della campanella", () => {
  for (const name of TASKS_TABLES) assert.ok(TASKS_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
  for (const name of TASKS_INDEXES) {
    assert.ok(TASKS_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
    assert.ok(TASKS_DDL.some((s) => s.includes(` ${name} ON `)), `l'indice ${name} è nel DDL`);
  }
  const all = TASKS_DDL.join("\n");
  const named = [...all.matchAll(/CONSTRAINT ([a-z_]+) (CHECK|PRIMARY KEY|UNIQUE)/g)].map((m) => m[1]).filter((n) => TASKS_TABLES.some((t) => n.startsWith(t)));
  assert.deepEqual([...named].sort(), [...TASKS_NAMED_CONSTRAINTS].sort());
  assert.ok(TASKS_PROBE_SQL.includes(`) = ${TASKS_NAMED_CONSTRAINTS.length}`));
  assert.ok(TASKS_PROBE_SQL.includes("position('''compiti_pronti''' IN pg_get_constraintdef(c.oid)) > 0"));
});

test("ensure-schema: versione 26, la 0032 dopo la 0031, non fatale, con timeout e lock, e la sonda in AND", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 26, "ENSURE_VERSION almeno 26 (la 0033 la porta a 27)");
  assert.match(ensureSchema, /import \{ TASKS_DDL, TASKS_PROBE_SQL \} from "\.\/use-case-hub-tasks-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const cli = runOnce.indexOf("await runCliDdlSafely();");
  const tasks = runOnce.indexOf("await runTasksDdlSafely();");
  assert.ok(cli > 0 && tasks > cli, "0031 poi 0032");
  assert.ok(!runOnce.includes("await runTasksDdl();"), "la 0032 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runTasksDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runTasksDdl\(\);\s+tasksDdlFailedAt = null;\s+\} catch \(err\) \{\s+tasksDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(ensure, /Date\.now\(\) - tasksDdlFailedAt >= REFERENTS_DDL_RETRY_MS/);
  assert.match(ensure, /ensurePromise = ensurePromise\.then\(runTasksDdlSafely\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(CLI_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(TASKS_PROBE_SQL\)\}/);
  const runner = topLevelFunction(ensureSchema, "export async function runTasksDdl(statements: readonly string[] = TASKS_DDL): Promise<void> {");
  const timeout = runner.indexOf("set_config('lock_timeout', '3s', true)");
  const lock = runner.indexOf(`pg_advisory_xact_lock(hashtext('${TASKS_ADVISORY_LOCK}'))`);
  const statements = runner.indexOf("...statements.map");
  assert.ok(timeout > 0 && lock > timeout && statements > lock, "timeout, lock, poi gli statement");
});

test("le colonne Drizzle sono quelle del DDL, nello stesso ordine", () => {
  const tables = [schema.useCaseTasks, schema.useCaseTaskNotes, schema.useCaseFactoryRepos];
  assert.deepEqual(tables.map((t) => getTableName(t)), [...TASKS_TABLES]);
  for (const table of tables) {
    const drizzle = Object.values(getTableColumns(table)).map((column) => column.name);
    assert.deepEqual(drizzle, ddlColumns(tableOf(getTableName(table))), getTableName(table));
  }
});
