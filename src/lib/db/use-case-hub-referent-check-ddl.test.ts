import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  ANSWER_COMMENT_CHECK_NAME,
  MISSING_REFERENTS_FOR_CHECK_MESSAGE,
  REFERENT_CHECK_ADDED_COLUMNS,
  REFERENT_CHECK_ADVISORY_LOCK,
  REFERENT_CHECK_CONFIRMS,
  REFERENT_CHECK_ESTIMATES,
  REFERENT_CHECK_INDEXES,
  REFERENT_CHECK_LIMITS,
  REFERENT_CHECK_NAMED_CONSTRAINTS,
  REFERENT_CHECK_OUTCOMES,
  REFERENT_CHECK_SWEEP_SQL,
  REFERENT_CHECK_TABLES,
  USE_CASE_REFERENT_CHECK_DDL,
  USE_CASE_REFERENT_CHECK_PROBE_SQL,
} from "./use-case-hub-referent-check-ddl.ts";
import { REFERENT_BENEFITS_ADDED_COLUMNS } from "./use-case-hub-referent-benefits-ddl.ts";
import { VALUE_MODEL_LIMITS } from "../use-cases/value-model.ts";
import * as schema from "./schema.ts";

// Migrazione 0026 e self-heal: «Referente in un tocco». Le prove sul database stanno in
// src/lib/db/use-case-hub-referent-check.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0026_use_case_referent_check.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");
const runbook = readFileSync(new URL("../../../docs/casi-duso/RUNBOOK.md", import.meta.url), "utf8");
const base = readFileSync(new URL("./queries/use-case-referent-base.ts", import.meta.url), "utf8");
const doctor = readFileSync(new URL("../../../scripts/use-case-admin/doctor.ts", import.meta.url), "utf8");

/** SQL senza le righe di commento `--`, con gli spazi compressi. */
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-referent-check-ddl'));"];

const table = () => {
  const found = USE_CASE_REFERENT_CHECK_DDL.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS use_case_referent_checks ("));
  assert.ok(found, "manca la tabella");
  return found;
};

function ddlColumns(statement: string): string[] {
  return statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|smallint|timestamptz|integer|char|boolean|jsonb|date|numeric)\b/)?.[1])
    .filter((n): n is string => Boolean(n));
}

function checkList(statement: string, constraint: string): string[] {
  const at = statement.indexOf(`CONSTRAINT ${constraint} CHECK`);
  assert.notEqual(at, -1, `manca ${constraint}`);
  const list = statement.slice(at).match(/IN \(([^)]*)\)/)?.[1] ?? "";
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

test("0026: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "lock_timeout e advisory lock in testa");
  assert.equal(REFERENT_CHECK_ADVISORY_LOCK, "unbundle:use-case-referent-check-ddl");
  let cursor = 0;
  for (const statement of USE_CASE_REFERENT_CHECK_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...USE_CASE_REFERENT_CHECK_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.doesNotMatch(migration, /CREATE\s+EXTENSION/i);
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0026_use_case_referent_check\.sql/);
});

test("controllo iniziale: senza la 0024 si ferma con il suo messaggio", () => {
  const guard = USE_CASE_REFERENT_CHECK_DDL[0];
  assert.match(guard, /^DO \$\$ BEGIN\s+IF to_regclass\('public\.use_case_referent_requests'\) IS NULL OR to_regclass\('public\.use_case_need_answers'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(guard.includes(`'${MISSING_REFERENTS_FOR_CHECK_MESSAGE}'`));
  assert.doesNotMatch(MISSING_REFERENTS_FOR_CHECK_MESSAGE, /[%']/);
});

test("idempotente e solo additivo: niente DROP, nessun dato scritto, nessuna colonna cambiata", () => {
  for (const statement of USE_CASE_REFERENT_CHECK_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|\bDROP\b|ALTER\s+COLUMN|\bRENAME\b|\bTYPE\b\s/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    if (/^CREATE (TABLE|UNIQUE INDEX|INDEX)/.test(statement)) assert.match(statement, /IF NOT EXISTS/);
    if (/^ALTER TABLE/.test(statement)) assert.match(statement, /^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+ (boolean NOT NULL DEFAULT false|varchar\(1000\));$/);
  }
  // L'unico CHECK nuovo su una tabella che c'era già: il commento solo del referente, NOT VALID poi VALIDATE.
  const last = USE_CASE_REFERENT_CHECK_DDL[USE_CASE_REFERENT_CHECK_DDL.length - 1];
  assert.match(last, /PERFORM set_config\('lock_timeout', '3s', true\);/);
  assert.ok(last.includes(`conname = '${ANSWER_COMMENT_CHECK_NAME}'`));
  assert.match(last, /ADD CONSTRAINT use_case_need_answers_comment_check\s+CHECK \(comment IS NULL OR source = 'referente'\) NOT VALID;/);
  assert.match(last, /VALIDATE CONSTRAINT use_case_need_answers_comment_check;/);
  const othersOnOldTables = USE_CASE_REFERENT_CHECK_DDL.filter((s) => /ADD CONSTRAINT/.test(s));
  assert.equal(othersOnOldTables.length, 1, "un solo vincolo aggiunto a una tabella esistente");
});

test("i CHECK sono gli elenchi del vocabolario e i limiti di §3.3", () => {
  const t = table();
  assert.deepEqual(checkList(t, "use_case_referent_checks_confirm_check"), [...REFERENT_CHECK_CONFIRMS]);
  assert.deepEqual(checkList(t, "use_case_referent_checks_estimate_check"), [...REFERENT_CHECK_ESTIMATES]);
  assert.deepEqual(checkList(t, "use_case_referent_checks_outcome_check"), [...REFERENT_CHECK_OUTCOMES]);
  assert.deepEqual([...REFERENT_CHECK_CONFIRMS], ["si", "correggi"]);
  assert.deepEqual([...REFERENT_CHECK_ESTIMATES], ["si", "meno", "piu"]);
  assert.deepEqual([...REFERENT_CHECK_OUTCOMES], ["adottata", "tenuta"]);
  assert.match(t, /times_per_month numeric\(12,2\) CONSTRAINT use_case_referent_checks_times_check CHECK \(times_per_month IS NULL OR times_per_month BETWEEN 0 AND 8333333\)/);
  assert.match(t, /minutes_each numeric\(10,2\) CONSTRAINT use_case_referent_checks_minutes_check CHECK \(minutes_each IS NULL OR minutes_each BETWEEN 0 AND 100000\)/);
  // × 12 resta dentro il volume massimo del modello, i minuti sono quelli del modello.
  assert.ok(REFERENT_CHECK_LIMITS.timesPerMonthMax * 12 <= VALUE_MODEL_LIMITS.volumeYearMax);
  assert.equal(REFERENT_CHECK_LIMITS.minutesEachMax, VALUE_MODEL_LIMITS.minutesPerUnitMax);
  assert.match(t, /request_id uuid PRIMARY KEY REFERENCES use_case_referent_requests\(id\) ON DELETE CASCADE/);
  assert.match(t, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(t, /use_case_id uuid NOT NULL REFERENCES use_cases\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(t, /REFERENCES uc_|_by_user_id|contact_id/, "nessuna persona sulla riga (art. 15.4, D54)");
});

test("la sonda copre la tabella, ogni indice e vincolo con nome, le tre colonne e il CHECK del commento", () => {
  const ddl = USE_CASE_REFERENT_CHECK_DDL.join("\n");
  const tables = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, [...REFERENT_CHECK_TABLES]);
  const indexes = [...ddl.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(indexes, [...REFERENT_CHECK_INDEXES]);
  const constraints = [...new Set([...table().matchAll(/CONSTRAINT (\w+)/g)].map((m) => m[1]))];
  assert.deepEqual([...constraints].sort(), [...REFERENT_CHECK_NAMED_CONSTRAINTS].sort());
  for (const name of [...tables, ...indexes]) assert.ok(USE_CASE_REFERENT_CHECK_PROBE_SQL.includes(`'public.${name}'`), `la sonda non guarda ${name}`);
  for (const name of constraints) assert.ok(USE_CASE_REFERENT_CHECK_PROBE_SQL.includes(`'${name}'`), `la sonda non guarda ${name}`);
  assert.match(USE_CASE_REFERENT_CHECK_PROBE_SQL, new RegExp(`\\) = ${REFERENT_CHECK_NAMED_CONSTRAINTS.length}\\s`));
  const added = [...ddl.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(
    added,
    Object.entries(REFERENT_CHECK_ADDED_COLUMNS).flatMap(([t, cols]) => cols.map((c) => [t, c])),
  );
  for (const [t, c] of added) {
    assert.ok(USE_CASE_REFERENT_CHECK_PROBE_SQL.includes(`'${t}'`), t);
    assert.ok(USE_CASE_REFERENT_CHECK_PROBE_SQL.includes(`'${c}'`), c);
  }
  assert.match(USE_CASE_REFERENT_CHECK_PROBE_SQL, /\) = 3\s/);
  assert.ok(USE_CASE_REFERENT_CHECK_PROBE_SQL.includes(`conname = '${ANSWER_COMMENT_CHECK_NAME}'`));
});

test("ensure-schema: versione 20 (o dopo), la 0026 dopo la 0025, non fatale, con timeout e lock, e la sonda in AND", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 20, "ENSURE_VERSION almeno 20 (la 0027 la porta a 21)");
  assert.match(ensureSchema, /import \{ USE_CASE_REFERENT_CHECK_DDL, USE_CASE_REFERENT_CHECK_PROBE_SQL \} from "\.\/use-case-hub-referent-check-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const alerts = runOnce.indexOf("await runUseCaseAlertsDdlSafely();");
  const check = runOnce.indexOf("await runUseCaseReferentCheckDdlSafely();");
  assert.ok(alerts > 0 && check > alerts, "0025 poi 0026");
  assert.ok(!runOnce.includes("await runUseCaseReferentCheckDdl();"), "la 0026 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runUseCaseReferentCheckDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runUseCaseReferentCheckDdl\(\);\s+referentCheckDdlFailedAt = null;\s+\} catch \(err\) \{\s+referentCheckDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  assert.match(safe, /0026 self-heal failed, the app keeps serving without «Referente in un tocco» \(apply drizzle\/0026 by hand\):/);
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(ensure, /Date\.now\(\) - referentCheckDdlFailedAt >= REFERENTS_DDL_RETRY_MS/);
  assert.match(ensure, /ensurePromise = ensurePromise\.then\(runUseCaseReferentCheckDdlSafely\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(USE_CASE_ALERTS_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(USE_CASE_REFERENT_CHECK_PROBE_SQL\)\}/);
  const run = topLevelFunction(ensureSchema, "export async function runUseCaseReferentCheckDdl(");
  const timeout = run.indexOf(`client.query("SELECT set_config('lock_timeout', '3s', true)")`);
  const lock = run.indexOf(`client.query("SELECT pg_advisory_xact_lock(hashtext('${REFERENT_CHECK_ADVISORY_LOCK}'))")`);
  const statements = run.indexOf("...statements.map(");
  assert.ok(timeout > 0 && lock > timeout && statements > lock);
  assert.match(run, /client\.transaction\(/);
});

test("referentStoreReady e il doctor guardano la sonda della 0026", () => {
  assert.match(base, /import \{ USE_CASE_REFERENT_CHECK_PROBE_SQL \} from "@\/lib\/db\/use-case-hub-referent-check-ddl";/);
  const ready = topLevelFunction(base, "export async function referentStoreReady(): Promise<boolean> {");
  assert.match(ready, /AND \$\{raw\(USE_CASE_REFERENT_CHECK_PROBE_SQL\)\}\s/);
  assert.match(doctor, /SELECT \$\{USE_CASE_REFERENT_CHECK_PROBE_SQL\} AS ok/);
  assert.match(doctor, /migrazione0026: m0026,/);
});

test("la pulizia: gli stessi tre statement del RUNBOOK §10.9 punto 6, carattere per carattere", () => {
  const section = runbook.slice(runbook.indexOf("### 10.9"));
  assert.ok(section.length > 0, "manca §10.9");
  const block = /```sql\n([\s\S]*?)```/.exec(section.slice(section.indexOf("6. Ritorno indietro")))?.[1] ?? "";
  assert.equal(block, `${REFERENT_CHECK_SWEEP_SQL.join("\n")}\n`);
  assert.equal(REFERENT_CHECK_SWEEP_SQL.length, 3);
  for (const s of REFERENT_CHECK_SWEEP_SQL) {
    assert.match(s, /^UPDATE /);
    assert.doesNotMatch(s, /\bDELETE\b|\bDROP\b/);
  }
  // Il conteggio prima del ritorno indietro (punto 5) è solo un numero.
  assert.match(section, /SELECT count\(\*\) FROM use_case_referent_requests r JOIN use_case_referent_checks c ON c\.request_id = r\.id WHERE r\.status = 'inviata' AND c\.submitted_at IS NULL;/);
  assert.match(section, /ENSURE_VERSION` 20/);
});

test("schema.ts: le colonne Drizzle sono le colonne del DDL, nello stesso ordine", () => {
  assert.equal(getTableName(schema.useCaseReferentChecks), "use_case_referent_checks");
  const columns = Object.values(getTableColumns(schema.useCaseReferentChecks)).map((column) => column.name);
  // (0027) Dopo le colonne della 0026, quella della 0027 (`benefits`).
  assert.deepEqual(columns, [...ddlColumns(table()), ...REFERENT_BENEFITS_ADDED_COLUMNS.use_case_referent_checks]);
  const items = Object.values(getTableColumns(schema.useCaseReferentRequestItems)).map((c) => c.name);
  assert.deepEqual(items.slice(-1), [...REFERENT_CHECK_ADDED_COLUMNS.use_case_referent_request_items]);
  const answers = Object.values(getTableColumns(schema.useCaseNeedAnswers)).map((c) => c.name);
  assert.deepEqual(answers.slice(-2), [...REFERENT_CHECK_ADDED_COLUMNS.use_case_need_answers]);
});
