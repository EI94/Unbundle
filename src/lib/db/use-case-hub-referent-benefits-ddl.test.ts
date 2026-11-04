import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  MISSING_CHECK_FOR_BENEFITS_MESSAGE,
  REFERENT_BENEFITS_ADDED_COLUMNS,
  REFERENT_BENEFITS_ADVISORY_LOCK,
  REFERENT_BENEFITS_INDEXES,
  REFERENT_BENEFITS_NAMED_CONSTRAINTS,
  REFERENT_BENEFITS_SWEEP_SQL,
  REFERENT_BENEFITS_TABLES,
  REFERENT_BENEFIT_ANSWERS,
  REFERENT_BENEFIT_KINDS,
  REFERENT_BENEFIT_LIMITS,
  REFERENT_BENEFIT_OUTCOMES,
  SUBMITTED_CHECK_0027,
  SUBMITTED_CHECK_NAME,
  USE_CASE_REFERENT_BENEFITS_DDL,
  USE_CASE_REFERENT_BENEFITS_PROBE_SQL,
} from "./use-case-hub-referent-benefits-ddl.ts";
import { REFERENT_CHECK_LIMITS, USE_CASE_REFERENT_CHECK_DDL } from "./use-case-hub-referent-check-ddl.ts";
import { VALUE_COMPONENTS_MAX, VALUE_COMPONENT_KINDS, VALUE_MODEL_LIMITS } from "../use-cases/value-model.ts";
import { VALUE_EUR_YEAR_MAX } from "../use-cases/amount-limits.ts";
import * as schema from "./schema.ts";

// Migrazione 0027 e self-heal: le risposte del referente per ogni voce di «Benefici e costi». Le prove sul
// database stanno in src/lib/db/use-case-hub-referent-benefits.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0027_use_case_referent_benefits.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");
const runbook = readFileSync(new URL("../../../docs/casi-duso/RUNBOOK.md", import.meta.url), "utf8");
const base = readFileSync(new URL("./queries/use-case-referent-base.ts", import.meta.url), "utf8");
const doctor = readFileSync(new URL("../../../scripts/use-case-admin/doctor.ts", import.meta.url), "utf8");

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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-referent-benefits-ddl'));"];

const table = () => {
  const found = USE_CASE_REFERENT_BENEFITS_DDL.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS use_case_referent_check_benefits ("));
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

/** La condizione dell'invio della 0026, com'è scritta nella sua tabella. */
function submittedCheck0026(): string {
  const t = USE_CASE_REFERENT_CHECK_DDL.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS use_case_referent_checks ("))!;
  const at = t.indexOf(`CONSTRAINT ${SUBMITTED_CHECK_NAME} CHECK (`);
  assert.notEqual(at, -1);
  let depth = 0;
  const start = t.indexOf("(", at);
  for (let i = start; i < t.length; i++) {
    if (t[i] === "(") depth++;
    if (t[i] === ")") depth--;
    if (depth === 0) return t.slice(start + 1, i);
  }
  throw new Error("CHECK non chiuso");
}

test("0027: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "lock_timeout e advisory lock in testa");
  assert.equal(REFERENT_BENEFITS_ADVISORY_LOCK, "unbundle:use-case-referent-benefits-ddl");
  let cursor = 0;
  for (const statement of USE_CASE_REFERENT_BENEFITS_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...USE_CASE_REFERENT_BENEFITS_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.doesNotMatch(migration, /CREATE\s+EXTENSION/i);
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0027_use_case_referent_benefits\.sql/);
});

test("controllo iniziale: senza la 0026 si ferma con il suo messaggio", () => {
  const guard = USE_CASE_REFERENT_BENEFITS_DDL[0];
  assert.match(guard, /^DO \$\$ BEGIN\s+IF to_regclass\('public\.use_case_referent_checks'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(guard.includes(`'${MISSING_CHECK_FOR_BENEFITS_MESSAGE}'`));
  assert.doesNotMatch(MISSING_CHECK_FOR_BENEFITS_MESSAGE, /[%']/);
});

test("idempotente; l'unico statement non additivo allarga il CHECK dell'invio, con lo stesso nome, solo una volta", () => {
  const widen = USE_CASE_REFERENT_BENEFITS_DDL[USE_CASE_REFERENT_BENEFITS_DDL.length - 1];
  for (const statement of USE_CASE_REFERENT_BENEFITS_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|ALTER\s+COLUMN|\bRENAME\b|\bTYPE\b\s|DROP\s+(TABLE|COLUMN|INDEX)/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    if (/^CREATE (TABLE|UNIQUE INDEX|INDEX)/.test(statement)) assert.match(statement, /IF NOT EXISTS/);
    if (/^ALTER TABLE/.test(statement)) assert.match(statement, /^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+ boolean NOT NULL DEFAULT false;$/);
    if (statement !== widen) assert.doesNotMatch(statement, /\bDROP\b/i);
  }
  assert.equal(USE_CASE_REFERENT_BENEFITS_DDL.filter((s) => /\bDROP\b/i.test(s)).length, 1, "un solo DROP");
  assert.match(widen, /PERFORM set_config\('lock_timeout', '3s', true\);/);
  // Solo quando la definizione non nomina ancora `benefits`: una seconda volta non fa niente.
  assert.match(widen, new RegExp(`IF NOT EXISTS \\(SELECT 1 FROM pg_constraint WHERE conrelid = 'public\\.use_case_referent_checks'::regclass AND conname = '${SUBMITTED_CHECK_NAME}'\\s+AND pg_get_constraintdef\\(oid\\) LIKE '%benefits%'\\) THEN`));
  const drop = widen.indexOf(`ALTER TABLE use_case_referent_checks DROP CONSTRAINT IF EXISTS ${SUBMITTED_CHECK_NAME};`);
  const add = widen.indexOf(`ALTER TABLE use_case_referent_checks ADD CONSTRAINT ${SUBMITTED_CHECK_NAME} CHECK (`);
  const validate = widen.indexOf(`ALTER TABLE use_case_referent_checks VALIDATE CONSTRAINT ${SUBMITTED_CHECK_NAME};`);
  assert.ok(drop > 0 && add > drop && validate > add, "DROP, ADD … NOT VALID, VALIDATE");
  assert.match(widen, /\) NOT VALID;/);
  // La condizione nuova è quella della 0026 con `benefits` in OR: ogni riga di prima resta valida.
  const before = normalize(submittedCheck0026());
  const after = normalize(SUBMITTED_CHECK_0027);
  const legacyEstimate = "(team_component_key IS NOT NULL AND estimate IS NOT NULL) OR (team_component_key IS NULL AND times_per_month IS NOT NULL AND minutes_each IS NOT NULL)";
  assert.ok(before.includes(`AND (${legacyEstimate})`), "la regola della 0026");
  assert.equal(after, before.replace(`AND (${legacyEstimate})`, `AND (benefits OR ${legacyEstimate})`));
});

test("i CHECK sono gli elenchi del vocabolario e i limiti del modello del valore", () => {
  const t = table();
  assert.deepEqual(checkList(t, "use_case_referent_check_benefits_kind_check"), [...REFERENT_BENEFIT_KINDS]);
  assert.deepEqual([...REFERENT_BENEFIT_KINDS], [...VALUE_COMPONENT_KINDS]);
  assert.deepEqual(checkList(t, "use_case_referent_check_benefits_answer_check"), [...REFERENT_BENEFIT_ANSWERS]);
  assert.deepEqual([...REFERENT_BENEFIT_ANSWERS], ["si", "meno", "piu", "no", "non_so"]);
  assert.deepEqual(checkList(t, "use_case_referent_check_benefits_outcome_check"), [...REFERENT_BENEFIT_OUTCOMES]);
  assert.deepEqual([...REFERENT_BENEFIT_OUTCOMES], ["adottata", "tenuta"]);
  assert.equal(REFERENT_BENEFIT_LIMITS.components, VALUE_COMPONENTS_MAX);
  assert.equal(REFERENT_BENEFIT_LIMITS.key, VALUE_MODEL_LIMITS.key);
  assert.equal(REFERENT_BENEFIT_LIMITS.label, VALUE_MODEL_LIMITS.label);
  assert.equal(REFERENT_BENEFIT_LIMITS.eurYearMax, VALUE_EUR_YEAR_MAX);
  assert.equal(REFERENT_BENEFIT_LIMITS.timesPerMonthMax, REFERENT_CHECK_LIMITS.timesPerMonthMax);
  assert.equal(REFERENT_BENEFIT_LIMITS.minutesEachMax, REFERENT_CHECK_LIMITS.minutesEachMax);
  assert.match(t, /position smallint NOT NULL CONSTRAINT use_case_referent_check_benefits_position_check CHECK \(position BETWEEN 1 AND 6\)/);
  assert.match(t, /eur_year numeric\(14,2\) CONSTRAINT use_case_referent_check_benefits_eur_check CHECK \(eur_year IS NULL OR eur_year BETWEEN 0 AND 1000000000\)/);
  assert.match(t, /comment varchar\(500\),/);
  assert.match(t, /request_id uuid NOT NULL REFERENCES use_case_referent_checks\(request_id\) ON DELETE CASCADE/);
  assert.match(t, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(t, /CONSTRAINT use_case_referent_check_benefits_pkey PRIMARY KEY \(request_id, component_key\)/);
  assert.doesNotMatch(t, /REFERENCES uc_|_by_user_id|contact_id|email/, "nessuna persona sulla riga (art. 15.4)");
  // (Decisione del titolare del 04/11/2026) «Non so» vale su ogni voce, anche a ore senza i numeri del team;
  // «Sì» / «È di meno» / «È di più» solo su una cifra del team, «Sì» / «No» solo senza cifra.
  assert.ok(
    normalize(t).includes(
      normalize(`CONSTRAINT use_case_referent_check_benefits_form_check CHECK (answer IS NULL
    OR answer = 'non_so'
    OR (answer IN ('si', 'meno', 'piu') AND ((kind = 'ore' AND team_volume_year > 0 AND team_minutes > 0) OR (kind = 'euro' AND team_eur_year > 0)))
    OR (answer IN ('si', 'no') AND (kind = 'qualitativo' OR (kind = 'euro' AND team_eur_year = 0)))),`),
    ),
    "il CHECK della forma",
  );
  // I numeri solo con «È di meno» / «È di più», o senza risposta su una voce a ore senza i numeri del team: mai con «Non so».
  assert.ok(
    normalize(t).includes(
      normalize(`CONSTRAINT use_case_referent_check_benefits_numbers_check CHECK ((times_per_month IS NULL AND minutes_each IS NULL AND eur_year IS NULL)
    OR (answer IS NOT NULL AND answer IN ('meno', 'piu'))
    OR (answer IS NULL AND kind = 'ore' AND NOT (team_volume_year > 0 AND team_minutes > 0))),`),
    ),
    "il CHECK dei numeri",
  );
});

test("la sonda copre la tabella, l'indice, ogni vincolo con nome, la colonna nuova e il CHECK allargato", () => {
  const ddl = USE_CASE_REFERENT_BENEFITS_DDL.join("\n");
  const tables = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, [...REFERENT_BENEFITS_TABLES]);
  const indexes = [...ddl.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(indexes, [...REFERENT_BENEFITS_INDEXES]);
  const constraints = [...new Set([...table().matchAll(/CONSTRAINT (\w+)/g)].map((m) => m[1]))];
  assert.deepEqual([...constraints].sort(), [...REFERENT_BENEFITS_NAMED_CONSTRAINTS].sort());
  for (const name of [...tables, ...indexes]) assert.ok(USE_CASE_REFERENT_BENEFITS_PROBE_SQL.includes(`'public.${name}'`), `la sonda non guarda ${name}`);
  for (const name of constraints) assert.ok(USE_CASE_REFERENT_BENEFITS_PROBE_SQL.includes(`'${name}'`), `la sonda non guarda ${name}`);
  assert.match(USE_CASE_REFERENT_BENEFITS_PROBE_SQL, new RegExp(`\\) = ${REFERENT_BENEFITS_NAMED_CONSTRAINTS.length}\\s`));
  const added = [...ddl.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(added, Object.entries(REFERENT_BENEFITS_ADDED_COLUMNS).flatMap(([t, cols]) => cols.map((c) => [t, c])));
  assert.ok(USE_CASE_REFERENT_BENEFITS_PROBE_SQL.includes("table_name = 'use_case_referent_checks' AND column_name = 'benefits'"));
  assert.ok(USE_CASE_REFERENT_BENEFITS_PROBE_SQL.includes(`conname = '${SUBMITTED_CHECK_NAME}'`));
  assert.ok(USE_CASE_REFERENT_BENEFITS_PROBE_SQL.includes("pg_get_constraintdef(oid) LIKE '%benefits%'"));
});

test("ensure-schema: versione 21, la 0027 dopo la 0026, non fatale, con timeout e lock, e la sonda in AND", () => {
  assert.match(ensureSchema, /const ENSURE_VERSION = 21;/);
  assert.match(ensureSchema, /import \{ USE_CASE_REFERENT_BENEFITS_DDL, USE_CASE_REFERENT_BENEFITS_PROBE_SQL \} from "\.\/use-case-hub-referent-benefits-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const check = runOnce.indexOf("await runUseCaseReferentCheckDdlSafely();");
  const benefits = runOnce.indexOf("await runUseCaseReferentBenefitsDdlSafely();");
  assert.ok(check > 0 && benefits > check, "0026 poi 0027");
  assert.ok(!runOnce.includes("await runUseCaseReferentBenefitsDdl();"), "la 0027 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runUseCaseReferentBenefitsDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runUseCaseReferentBenefitsDdl\(\);\s+referentBenefitsDdlFailedAt = null;\s+\} catch \(err\) \{\s+referentBenefitsDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  assert.match(safe, /0027 self-heal failed, the app keeps serving without «Referente in un tocco» \(apply drizzle\/0027 by hand\):/);
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(ensure, /Date\.now\(\) - referentBenefitsDdlFailedAt >= REFERENTS_DDL_RETRY_MS/);
  assert.match(ensure, /ensurePromise = ensurePromise\.then\(runUseCaseReferentBenefitsDdlSafely\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(USE_CASE_REFERENT_CHECK_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(USE_CASE_REFERENT_BENEFITS_PROBE_SQL\)\}/);
  const run = topLevelFunction(ensureSchema, "export async function runUseCaseReferentBenefitsDdl(");
  const timeout = run.indexOf(`client.query("SELECT set_config('lock_timeout', '3s', true)")`);
  const lock = run.indexOf(`client.query("SELECT pg_advisory_xact_lock(hashtext('${REFERENT_BENEFITS_ADVISORY_LOCK}'))")`);
  const statements = run.indexOf("...statements.map(");
  assert.ok(timeout > 0 && lock > timeout && statements > lock);
  assert.match(run, /client\.transaction\(/);
});

test("referentStoreReady e il doctor guardano la sonda della 0027", () => {
  assert.match(base, /import \{ USE_CASE_REFERENT_BENEFITS_PROBE_SQL \} from "@\/lib\/db\/use-case-hub-referent-benefits-ddl";/);
  const ready = topLevelFunction(base, "export async function referentStoreReady(): Promise<boolean> {");
  assert.match(ready, /AND \$\{raw\(USE_CASE_REFERENT_BENEFITS_PROBE_SQL\)\}\) AS ok/);
  assert.match(doctor, /SELECT \$\{USE_CASE_REFERENT_BENEFITS_PROBE_SQL\} AS ok/);
  assert.match(doctor, /migrazione0027: m0027,/);
});

test("la pulizia: gli stessi tre statement del RUNBOOK §10.10 punto 6, carattere per carattere", () => {
  const section = runbook.slice(runbook.indexOf("### 10.10"));
  assert.ok(runbook.includes("### 10.10"), "manca §10.10");
  const block = /```sql\n([\s\S]*?)```/.exec(section.slice(section.indexOf("6. Ritorno indietro")))?.[1] ?? "";
  assert.equal(block, `${REFERENT_BENEFITS_SWEEP_SQL.join("\n")}\n`);
  assert.equal(REFERENT_BENEFITS_SWEEP_SQL.length, 3);
  for (const s of REFERENT_BENEFITS_SWEEP_SQL) assert.doesNotMatch(s, /\bDROP\b|\bTRUNCATE\b/);
  // Solo le bozze delle richieste finite senza invio si cancellano; le risposte inviate restano.
  assert.match(REFERENT_BENEFITS_SWEEP_SQL[1], /c\.submitted_at IS NULL AND r\.status <> 'inviata'/);
  assert.match(section, /ENSURE_VERSION` 21/);
  assert.match(section, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0027_use_case_referent_benefits\.sql/);
});

test("schema.ts: le colonne Drizzle sono le colonne del DDL, nello stesso ordine", () => {
  assert.equal(getTableName(schema.useCaseReferentCheckBenefits), "use_case_referent_check_benefits");
  const columns = Object.values(getTableColumns(schema.useCaseReferentCheckBenefits)).map((column) => column.name);
  assert.deepEqual(columns, ddlColumns(table()));
  const checks = Object.values(getTableColumns(schema.useCaseReferentChecks)).map((c) => c.name);
  assert.deepEqual(checks.slice(-1), [...REFERENT_BENEFITS_ADDED_COLUMNS.use_case_referent_checks]);
});
