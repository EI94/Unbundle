import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  DECISION_SOURCES,
  FACTORY_ADVISORY_LOCK,
  FACTORY_DDL,
  FACTORY_FRAMEWORKS,
  FACTORY_INDEXES,
  FACTORY_NAMED_CONSTRAINTS,
  FACTORY_PROBE_SQL,
  FACTORY_ROLLBACK_SWEEP_SQL,
  FACTORY_TABLES,
  MISSING_PROGRAM_FOR_FACTORY_MESSAGE,
  PACKAGE_FILES,
  PACKAGE_SOURCES,
  PROJECT_STATUSES,
  SETUP_TOPICS,
  USE_CASE_NOTIFICATION_KINDS_0030,
} from "./use-case-hub-factory-ddl.ts";
import { ALERTS_ADVISORY_LOCK } from "./use-case-hub-alerts-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0029 } from "./use-case-hub-program-ddl.ts";
import * as schema from "./schema.ts";

// Migrazione 0030 e self-heal: progetto, decisioni e pacchetto dell'Agent Factory (rilascio 8.0a). Le prove
// sul database stanno in src/lib/db/use-case-hub-factory.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0030_agent_factory.sql", import.meta.url), "utf8");
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-factory-ddl'));"];

const tableOf = (name: string) => {
  const found = FACTORY_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`));
  assert.ok(found, `manca la tabella ${name}`);
  return found;
};

function ddlColumns(statement: string): string[] {
  return statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|smallint|timestamptz|integer|bigint|double|boolean|jsonb|date|numeric)\b/)?.[1])
    .filter((n): n is string => Boolean(n));
}

function checkList(statement: string, constraint: string): string[] {
  const at = statement.indexOf(`CONSTRAINT ${constraint} CHECK`);
  assert.notEqual(at, -1, `manca ${constraint}`);
  const list = statement.slice(at).match(/IN \(([^)]*)\)/)?.[1] ?? "";
  return [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

test("0030: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "lock_timeout e advisory lock in testa");
  assert.equal(FACTORY_ADVISORY_LOCK, "unbundle:use-case-factory-ddl");
  let cursor = 0;
  for (const statement of FACTORY_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...FACTORY_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.doesNotMatch(migration, /CREATE\s+EXTENSION/i);
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0030_agent_factory\.sql/);
  assert.match(migration, /In produzione la applica il self-heal dell'app al primo avvio dopo il deploy/);
});

test("controllo iniziale: senza la 0029 si ferma con il suo messaggio", () => {
  const guard = FACTORY_DDL[0];
  assert.match(guard, /^DO \$\$ BEGIN\s+IF to_regclass\('public\.program_settings'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(guard.includes(`'${MISSING_PROGRAM_FOR_FACTORY_MESSAGE}'`));
  assert.doesNotMatch(MISSING_PROGRAM_FOR_FACTORY_MESSAGE, /[%']/);
});

test("solo aggiunte: niente dati scritti, niente colonne cambiate; il solo DROP è il CHECK della campanella; il DDL uc non si tocca", () => {
  const widen = FACTORY_DDL[FACTORY_DDL.length - 1];
  for (const statement of FACTORY_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|ALTER\s+COLUMN|ADD\s+COLUMN|\bRENAME\b|DROP\s+(TABLE|COLUMN|INDEX)/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    assert.doesNotMatch(statement, /\buc_[a-z_]+/, "nessuna tabella uc: il DDL uc (0018) non cambia");
    if (statement !== widen) assert.doesNotMatch(statement, /DROP\s+CONSTRAINT/i);
    // Niente `?`, `?&`, `?|`: alcuni driver li leggono come segnaposto.
    if (statement !== widen) assert.doesNotMatch(statement, /\?/);
  }
  assert.match(widen, /DROP CONSTRAINT IF EXISTS use_case_notifications_kind_check/);
  assert.match(widen, /NOT VALID/);
  assert.equal(FACTORY_DDL[FACTORY_DDL.length - 2], `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`, "sotto il lock della 0025");
});

test("i tipi della campanella: quelli della 0029, nello stesso ordine, più i tre dell'Agent Factory, tutti entro 16 caratteri", () => {
  assert.deepEqual(USE_CASE_NOTIFICATION_KINDS_0030, [...USE_CASE_NOTIFICATION_KINDS_0029, "progetto_appr", "strumento_nuovo", "pacchetto_nuovo"]);
  const widen = FACTORY_DDL[FACTORY_DDL.length - 1];
  for (const kind of USE_CASE_NOTIFICATION_KINDS_0030) {
    assert.ok(widen.includes(`'${kind}'`), kind);
    assert.ok(kind.length <= 16, `${kind} entra in kind varchar(16)`);
  }
  assert.deepEqual(FACTORY_ROLLBACK_SWEEP_SQL, ["DELETE FROM use_case_notifications WHERE kind IN ('progetto_appr', 'strumento_nuovo', 'pacchetto_nuovo');"]);
});

test("i CHECK sono gli elenchi del vocabolario", () => {
  assert.deepEqual(checkList(tableOf("use_case_packages"), "use_case_packages_source_check"), [...PACKAGE_SOURCES]);
  const projects = tableOf("use_case_projects");
  assert.deepEqual(checkList(projects, "use_case_projects_status_check"), [...PROJECT_STATUSES]);
  assert.deepEqual(checkList(projects, "use_case_projects_framework_check"), [...FACTORY_FRAMEWORKS]);
  const decisions = tableOf("use_case_decisions");
  assert.deepEqual(checkList(decisions, "use_case_decisions_topic_key_check"), [...SETUP_TOPICS]);
  assert.deepEqual(checkList(decisions, "use_case_decisions_source_check"), [...DECISION_SOURCES]);
  for (const topic of SETUP_TOPICS) assert.ok(topic.length <= 16, `${topic} entra in topic_key varchar(16)`);
  for (const file of PACKAGE_FILES) assert.ok(tableOf("use_case_packages").includes(`coalesce(jsonb_typeof(files -> '${file}'), 'assente') = 'string'`), file);
});

test("le regole del progetto stanno anche nel database: una versione aperta e una approvata, e l'AI Board se ci sono strumenti nuovi", () => {
  const projects = tableOf("use_case_projects");
  assert.match(projects, /CONSTRAINT use_case_projects_ai_board_check CHECK \(status <> 'approvato' OR jsonb_array_length\(new_tools\) = 0 OR ai_board_ok_at IS NOT NULL\)/);
  assert.match(projects, /CONSTRAINT use_case_projects_approved_check CHECK \(status <> 'approvato' OR approved_at IS NOT NULL\)/);
  assert.ok(FACTORY_DDL.includes("CREATE UNIQUE INDEX IF NOT EXISTS use_case_projects_open_unique ON use_case_projects (use_case_id) WHERE status IN ('in_corso', 'da_approvare');"));
  assert.ok(FACTORY_DDL.includes("CREATE UNIQUE INDEX IF NOT EXISTS use_case_projects_approved_unique ON use_case_projects (use_case_id) WHERE status = 'approvato';"));
  // L'autore può restare vuoto: se la persona viene cancellata, la decisione resta (ON DELETE SET NULL, nessun CHECK).
  assert.doesNotMatch(tableOf("use_case_decisions"), /author_check/);
  assert.match(projects, /revision integer NOT NULL DEFAULT 1 CONSTRAINT use_case_projects_revision_check CHECK \(revision >= 1\)/);
  // L'impronta del pacchetto non è unica: una scheda che torna com'era fa una versione nuova.
  assert.ok(FACTORY_DDL.includes("CREATE INDEX IF NOT EXISTS use_case_packages_hash_idx ON use_case_packages (use_case_id, content_hash);"));
});

test("ogni tabella si cancella con il suo workspace e con il suo use case", () => {
  for (const name of FACTORY_TABLES) {
    assert.match(tableOf(name), /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/, name);
    assert.match(tableOf(name), /use_case_id uuid NOT NULL REFERENCES use_cases\(id\) ON DELETE CASCADE/, name);
  }
});

test("la sonda copre ogni tabella, ogni indice, ogni vincolo con nome e i tipi nuovi della campanella", () => {
  for (const name of FACTORY_TABLES) assert.ok(FACTORY_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
  for (const name of FACTORY_INDEXES) {
    assert.ok(FACTORY_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
    assert.ok(FACTORY_DDL.some((s) => s.includes(` ${name} ON `)), `l'indice ${name} è nel DDL`);
  }
  const all = FACTORY_DDL.join("\n");
  const named = [...all.matchAll(/CONSTRAINT ([a-z_]+) (CHECK|PRIMARY KEY)/g)].map((m) => m[1]).filter((n) => n.startsWith("use_case_packages") || n.startsWith("use_case_projects") || n.startsWith("use_case_decisions"));
  assert.deepEqual([...named].sort(), [...FACTORY_NAMED_CONSTRAINTS].sort());
  assert.ok(FACTORY_PROBE_SQL.includes(`) = ${FACTORY_NAMED_CONSTRAINTS.length}`));
  assert.ok(FACTORY_PROBE_SQL.includes("position('''pacchetto_nuovo''' IN pg_get_constraintdef(c.oid)) > 0"));
});

test("ensure-schema: versione 24, la 0030 dopo la 0029, non fatale, con timeout e lock, e la sonda in AND", () => {
  assert.match(ensureSchema, /const ENSURE_VERSION = 24;/);
  assert.match(ensureSchema, /import \{ FACTORY_DDL, FACTORY_PROBE_SQL \} from "\.\/use-case-hub-factory-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const program = runOnce.indexOf("await runProgramDdlSafely();");
  const factory = runOnce.indexOf("await runFactoryDdlSafely();");
  assert.ok(program > 0 && factory > program, "0029 poi 0030");
  assert.ok(!runOnce.includes("await runFactoryDdl();"), "la 0030 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runFactoryDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runFactoryDdl\(\);\s+factoryDdlFailedAt = null;\s+\} catch \(err\) \{\s+factoryDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  assert.match(safe, /0030 self-heal failed, the app keeps serving without «Impostazione» \(apply drizzle\/0030 by hand\):/);
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(ensure, /Date\.now\(\) - factoryDdlFailedAt >= REFERENTS_DDL_RETRY_MS/);
  assert.match(ensure, /ensurePromise = ensurePromise\.then\(runFactoryDdlSafely\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(PROGRAM_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(FACTORY_PROBE_SQL\)\}/);
  const runner = topLevelFunction(ensureSchema, "export async function runFactoryDdl(statements: readonly string[] = FACTORY_DDL): Promise<void> {");
  const timeout = runner.indexOf("set_config('lock_timeout', '3s', true)");
  const lock = runner.indexOf(`pg_advisory_xact_lock(hashtext('${FACTORY_ADVISORY_LOCK}'))`);
  const statements = runner.indexOf("...statements.map");
  assert.ok(timeout > 0 && lock > timeout && statements > lock, "timeout, lock, poi gli statement");
});

test("le colonne Drizzle sono quelle del DDL, nello stesso ordine", () => {
  const tables = [schema.useCasePackages, schema.useCaseProjects, schema.useCaseDecisions];
  assert.deepEqual(tables.map((t) => getTableName(t)), [...FACTORY_TABLES]);
  for (const table of tables) {
    const drizzle = Object.values(getTableColumns(table)).map((column) => column.name);
    assert.deepEqual(drizzle, ddlColumns(tableOf(getTableName(table))), getTableName(table));
  }
});
