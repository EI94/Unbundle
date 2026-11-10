import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  GOAL_CHECKIN_KINDS,
  MISSING_THREAD_FOR_PROGRAM_MESSAGE,
  PROGRAM_ADVISORY_LOCK,
  PROGRAM_CASE_COST_MODES,
  PROGRAM_DDL,
  PROGRAM_FACT_SOURCES,
  PROGRAM_INDEXES,
  PROGRAM_KPI_DIRECTIONS,
  PROGRAM_KPI_KINDS,
  PROGRAM_KPI_SOURCES,
  PROGRAM_KPI_VALUE_SOURCES,
  PROGRAM_NAMED_CONSTRAINTS,
  PROGRAM_PROBE_SQL,
  PROGRAM_ROLLBACK_SWEEP_SQL,
  PROGRAM_SNAPSHOT_KINDS,
  PROGRAM_TABLES,
  USE_CASE_NOTIFICATION_KINDS_0029,
} from "./use-case-hub-program-ddl.ts";
import { ALERTS_ADVISORY_LOCK } from "./use-case-hub-alerts-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0028 } from "./use-case-hub-referent-thread-ddl.ts";
import * as schema from "./schema.ts";

// Migrazione 0029 e self-heal: la pagina «Programma» (rilascio 7). Le prove sul database stanno in
// src/lib/db/use-case-hub-program.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0029_program.sql", import.meta.url), "utf8");
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-program-ddl'));"];

const tableOf = (name: string) => {
  const found = PROGRAM_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`));
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
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

test("0029: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "lock_timeout e advisory lock in testa");
  assert.equal(PROGRAM_ADVISORY_LOCK, "unbundle:use-case-program-ddl");
  let cursor = 0;
  for (const statement of PROGRAM_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...PROGRAM_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.doesNotMatch(migration, /CREATE\s+EXTENSION/i);
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0029_program\.sql/);
  assert.match(migration, /In produzione la applica il self-heal dell'app al primo avvio dopo il deploy/);
});

test("controllo iniziale: senza la 0028 si ferma con il suo messaggio", () => {
  const guard = PROGRAM_DDL[0];
  assert.match(guard, /^DO \$\$ BEGIN\s+IF to_regclass\('public\.use_case_referent_messages'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(guard.includes(`'${MISSING_THREAD_FOR_PROGRAM_MESSAGE}'`));
  assert.doesNotMatch(MISSING_THREAD_FOR_PROGRAM_MESSAGE, /[%']/);
});

test("solo aggiunte: niente dati scritti, niente colonne cambiate né aggiunte a tabelle che c'erano; il solo DROP è il CHECK della campanella", () => {
  const widen = PROGRAM_DDL[PROGRAM_DDL.length - 1];
  for (const statement of PROGRAM_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|ALTER\s+COLUMN|ADD\s+COLUMN|\bRENAME\b|DROP\s+(TABLE|COLUMN|INDEX)/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    if (statement !== widen) assert.doesNotMatch(statement, /DROP\s+CONSTRAINT/i);
  }
  assert.match(widen, /DROP CONSTRAINT IF EXISTS use_case_notifications_kind_check/);
  assert.match(widen, /NOT VALID/);
  assert.equal(PROGRAM_DDL[PROGRAM_DDL.length - 2], `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`, "sotto il lock della 0025");
  // strategic_goals non cambia: le sue letture di oggi leggono tutte le colonne.
  assert.ok(!PROGRAM_DDL.some((s) => /ALTER TABLE strategic_goals/i.test(s)));
});

test("i tipi della campanella: quelli della 0028, nello stesso ordine, più «da_rivedere»", () => {
  assert.deepEqual(USE_CASE_NOTIFICATION_KINDS_0029, [...USE_CASE_NOTIFICATION_KINDS_0028, "da_rivedere"]);
  const widen = PROGRAM_DDL[PROGRAM_DDL.length - 1];
  for (const kind of USE_CASE_NOTIFICATION_KINDS_0029) assert.ok(widen.includes(`'${kind}'`), kind);
  assert.ok("da_rivedere".length <= 16, "entra in kind varchar(16)");
  assert.deepEqual(PROGRAM_ROLLBACK_SWEEP_SQL, ["DELETE FROM use_case_notifications WHERE kind = 'da_rivedere';"]);
});

test("i CHECK sono gli elenchi del vocabolario", () => {
  const settings = tableOf("program_settings");
  assert.deepEqual(checkList(settings, "program_settings_employees_source_check"), [...PROGRAM_FACT_SOURCES]);
  assert.deepEqual(checkList(settings, "program_settings_revenue_source_check"), [...PROGRAM_FACT_SOURCES]);
  assert.deepEqual(checkList(tableOf("program_case_costs"), "program_case_costs_mode_check"), [...PROGRAM_CASE_COST_MODES]);
  assert.deepEqual(checkList(tableOf("program_snapshots"), "program_snapshots_kind_check"), [...PROGRAM_SNAPSHOT_KINDS]);
  const kpis = tableOf("program_kpis");
  assert.deepEqual(checkList(kpis, "program_kpis_kind_check"), [...PROGRAM_KPI_KINDS]);
  assert.deepEqual(checkList(kpis, "program_kpis_source_check"), [...PROGRAM_KPI_SOURCES]);
  assert.deepEqual(checkList(kpis, "program_kpis_direction_check"), [...PROGRAM_KPI_DIRECTIONS]);
  assert.deepEqual(checkList(tableOf("program_kpi_values"), "program_kpi_values_source_check"), [...PROGRAM_KPI_VALUE_SOURCES]);
  assert.deepEqual(checkList(tableOf("strategic_goal_checkins"), "strategic_goal_checkins_kind_check"), [...GOAL_CHECKIN_KINDS]);
});

test("ogni tabella si cancella con il suo workspace; lo sviluppo con il suo use case, i valori con il loro KPI", () => {
  for (const name of PROGRAM_TABLES) {
    assert.match(tableOf(name), /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/, name);
  }
  assert.match(tableOf("program_case_costs"), /use_case_id uuid NOT NULL REFERENCES use_cases\(id\) ON DELETE CASCADE/);
  assert.match(tableOf("program_kpi_values"), /kpi_id uuid NOT NULL REFERENCES program_kpis\(id\) ON DELETE CASCADE/);
  assert.match(tableOf("strategic_goal_checkins"), /goal_id uuid NOT NULL REFERENCES strategic_goals\(id\) ON DELETE CASCADE/);
  assert.match(tableOf("program_kpis"), /key_result_id uuid REFERENCES strategic_goals\(id\) ON DELETE SET NULL/);
});

test("la sonda copre ogni tabella, ogni indice, ogni vincolo con nome e «da_rivedere»", () => {
  for (const name of PROGRAM_TABLES) assert.ok(PROGRAM_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
  for (const name of PROGRAM_INDEXES) {
    assert.ok(PROGRAM_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
    assert.ok(PROGRAM_DDL.some((s) => s.includes(` ${name} ON `)), `l'indice ${name} è nel DDL`);
  }
  const all = PROGRAM_DDL.join("\n");
  const named = [...all.matchAll(/CONSTRAINT ([a-z_]+) (CHECK|PRIMARY KEY)/g)].map((m) => m[1]).filter((n) => n.startsWith("program_") || n.startsWith("strategic_goal_checkins"));
  assert.deepEqual([...named].sort(), [...PROGRAM_NAMED_CONSTRAINTS].sort());
  assert.ok(PROGRAM_PROBE_SQL.includes(`) = ${PROGRAM_NAMED_CONSTRAINTS.length}`));
  assert.ok(PROGRAM_PROBE_SQL.includes("position('''da_rivedere''' IN pg_get_constraintdef(c.oid)) > 0"));
});

test("ensure-schema: versione 23, la 0029 dopo la 0028, non fatale, con timeout e lock, e la sonda in AND", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 23, "ENSURE_VERSION almeno 23 (la 0030 la porta a 24)");
  assert.match(ensureSchema, /import \{ PROGRAM_DDL, PROGRAM_PROBE_SQL \} from "\.\/use-case-hub-program-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const thread = runOnce.indexOf("await runUseCaseReferentThreadDdlSafely();");
  const program = runOnce.indexOf("await runProgramDdlSafely();");
  assert.ok(thread > 0 && program > thread, "0028 poi 0029");
  assert.ok(!runOnce.includes("await runProgramDdl();"), "la 0029 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runProgramDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runProgramDdl\(\);\s+programDdlFailedAt = null;\s+\} catch \(err\) \{\s+programDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  assert.match(safe, /0029 self-heal failed, the app keeps serving without «Programma» \(apply drizzle\/0029 by hand\):/);
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(ensure, /Date\.now\(\) - programDdlFailedAt >= REFERENTS_DDL_RETRY_MS/);
  assert.match(ensure, /ensurePromise = ensurePromise\.then\(runProgramDdlSafely\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(USE_CASE_REFERENT_THREAD_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(PROGRAM_PROBE_SQL\)\}/);
  const runner = topLevelFunction(ensureSchema, "export async function runProgramDdl(statements: readonly string[] = PROGRAM_DDL): Promise<void> {");
  const timeout = runner.indexOf("set_config('lock_timeout', '3s', true)");
  const lock = runner.indexOf(`pg_advisory_xact_lock(hashtext('${PROGRAM_ADVISORY_LOCK}'))`);
  const statements = runner.indexOf("...statements.map");
  assert.ok(timeout > 0 && lock > timeout && statements > lock, "timeout, lock, poi gli statement");
});

test("le colonne Drizzle sono quelle del DDL, nello stesso ordine", () => {
  const tables = [schema.programSettings, schema.programCaseCosts, schema.programSnapshots, schema.programKpis, schema.programKpiValues, schema.strategicGoalCheckins];
  assert.deepEqual(tables.map((t) => getTableName(t)), [...PROGRAM_TABLES]);
  for (const table of tables) {
    const drizzle = Object.values(getTableColumns(table)).map((column) => column.name);
    assert.deepEqual(drizzle, ddlColumns(tableOf(getTableName(table))), getTableName(table));
  }
});
