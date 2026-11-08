import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  MISSING_BENEFITS_FOR_THREAD_MESSAGE,
  REFERENT_SUGGESTION_STATUSES,
  REFERENT_THREAD_ADDED_COLUMNS,
  REFERENT_THREAD_ADVISORY_LOCK,
  REFERENT_THREAD_ANCHORS,
  REFERENT_THREAD_COLUMN_CONSTRAINTS,
  REFERENT_THREAD_INDEXES,
  REFERENT_THREAD_KINDS,
  REFERENT_THREAD_KINDS_BY_SIDE,
  REFERENT_THREAD_LIMITS,
  REFERENT_THREAD_NAMED_CONSTRAINTS,
  REFERENT_THREAD_REMOVE_REASONS,
  REFERENT_THREAD_SIDES,
  REFERENT_THREAD_SWEEP_SQL,
  REFERENT_THREAD_TABLES,
  REQUESTER_NEWS_CHECK_0028,
  REQUESTER_NEWS_CHECK_NAME,
  USE_CASE_NOTIFICATION_KINDS_0028,
  USE_CASE_REFERENT_THREAD_DDL,
  USE_CASE_REFERENT_THREAD_PROBE_SQL,
} from "./use-case-hub-referent-thread-ddl.ts";
import { ALERTS_ADVISORY_LOCK, USE_CASE_NOTIFICATION_KINDS_0025 } from "./use-case-hub-alerts-ddl.ts";
import { USE_CASE_REFERENTS_DDL } from "./use-case-hub-referents-ddl.ts";
import { VALUE_MODEL_LIMITS } from "../use-cases/value-model.ts";
import * as schema from "./schema.ts";

// Migrazione 0028 e self-heal: il filo con il referente. Le prove sul database stanno in
// src/lib/db/use-case-hub-referent-thread.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0028_use_case_referent_thread.sql", import.meta.url), "utf8");
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-referent-thread-ddl'));"];

const tableOf = (name: string) => {
  const found = USE_CASE_REFERENT_THREAD_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`));
  assert.ok(found, `manca la tabella ${name}`);
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

test("0028: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "lock_timeout e advisory lock in testa");
  assert.equal(REFERENT_THREAD_ADVISORY_LOCK, "unbundle:use-case-referent-thread-ddl");
  let cursor = 0;
  for (const statement of USE_CASE_REFERENT_THREAD_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...USE_CASE_REFERENT_THREAD_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.doesNotMatch(migration, /CREATE\s+EXTENSION/i);
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0028_use_case_referent_thread\.sql/);
  assert.match(migration, /In produzione la applica il self-heal dell'app al primo avvio dopo il deploy/);
});

test("controllo iniziale: senza la 0027 si ferma con il suo messaggio", () => {
  const guard = USE_CASE_REFERENT_THREAD_DDL[0];
  assert.match(guard, /^DO \$\$ BEGIN\s+IF to_regclass\('public\.use_case_referent_check_benefits'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(guard.includes(`'${MISSING_BENEFITS_FOR_THREAD_MESSAGE}'`));
  assert.doesNotMatch(MISSING_BENEFITS_FOR_THREAD_MESSAGE, /[%']/);
});

test("solo aggiunte: niente dati scritti, niente colonne cambiate; i soli DROP sono i due CHECK allargati con lo stesso nome", () => {
  const widenNews = USE_CASE_REFERENT_THREAD_DDL.find((s) => s.includes(REQUESTER_NEWS_CHECK_NAME))!;
  const widenKinds = USE_CASE_REFERENT_THREAD_DDL[USE_CASE_REFERENT_THREAD_DDL.length - 1];
  for (const statement of USE_CASE_REFERENT_THREAD_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|ALTER\s+COLUMN|\bRENAME\b|DROP\s+(TABLE|COLUMN|INDEX)/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    if (/^CREATE (TABLE|UNIQUE INDEX|INDEX)/.test(statement)) assert.match(statement, /IF NOT EXISTS/);
    if (/^ALTER TABLE/.test(statement)) assert.match(statement, /^ALTER TABLE \w+ ADD COLUMN IF NOT EXISTS \w+ (timestamptz|boolean NOT NULL DEFAULT false|smallint NOT NULL DEFAULT 0 CONSTRAINT \w+ CHECK \(\w+ BETWEEN 0 AND \d+\));$/);
    if (statement !== widenNews && statement !== widenKinds) assert.doesNotMatch(statement, /\bDROP\b/i);
  }
  // Le novità a chi ha chiesto: solo quando la definizione non nomina ancora `questions`, la condizione di prima in OR.
  assert.match(widenNews, /PERFORM set_config\('lock_timeout', '3s', true\);/);
  assert.match(widenNews, /AND pg_get_constraintdef\(oid\) LIKE '%questions%'\) THEN/);
  const drop = widenNews.indexOf(`DROP CONSTRAINT IF EXISTS ${REQUESTER_NEWS_CHECK_NAME};`);
  const add = widenNews.indexOf(`ADD CONSTRAINT ${REQUESTER_NEWS_CHECK_NAME} CHECK (`);
  const validate = widenNews.indexOf(`VALIDATE CONSTRAINT ${REQUESTER_NEWS_CHECK_NAME};`);
  assert.ok(drop > 0 && add > drop && validate > add, "DROP, ADD … NOT VALID, VALIDATE");
  const before = USE_CASE_REFERENTS_DDL.join("\n").match(new RegExp(`CONSTRAINT ${REQUESTER_NEWS_CHECK_NAME} CHECK \\((.*)\\)\\n`))?.[1];
  assert.equal(before, "answers > 0 OR unknowns > 0 OR documents > 0 OR follow_up IS NOT NULL", "la regola della 0024");
  assert.equal(REQUESTER_NEWS_CHECK_0028, `${before} OR questions > 0`);
  // I tipi della campanella: il blocco della 0025 (mai restringe) con «domanda», sotto il lock della 0025.
  assert.deepEqual([...USE_CASE_NOTIFICATION_KINDS_0028], [...USE_CASE_NOTIFICATION_KINDS_0025, "domanda"]);
  assert.equal(USE_CASE_REFERENT_THREAD_DDL[USE_CASE_REFERENT_THREAD_DDL.length - 2], `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`);
  assert.match(widenKinds, /wanted text\[\] := ARRAY\['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori', 'domanda'\]::text\[\];/);
  assert.match(widenKinds, /Mai restringere|WHERE found\.name <> ALL \(wanted\)/);
});

test("i CHECK sono gli elenchi del vocabolario; la forma dell'ancora, chi scrive che cosa, il testo che si svuota", () => {
  const m = tableOf("use_case_referent_messages");
  assert.deepEqual(checkList(m, "use_case_referent_messages_anchor_check"), [...REFERENT_THREAD_ANCHORS]);
  assert.deepEqual([...REFERENT_THREAD_ANCHORS], ["domanda", "beneficio", "generale"]);
  assert.deepEqual(checkList(m, "use_case_referent_messages_side_check"), [...REFERENT_THREAD_SIDES]);
  assert.deepEqual(checkList(m, "use_case_referent_messages_kind_check"), [...REFERENT_THREAD_KINDS]);
  assert.deepEqual([...REFERENT_THREAD_KINDS], ["chiarimento", "dubbio", "risposta", "aggiunta"]);
  assert.deepEqual(checkList(m, "use_case_referent_messages_removed_reason_check"), [...REFERENT_THREAD_REMOVE_REASONS]);
  assert.deepEqual([...REFERENT_THREAD_KINDS_BY_SIDE.team], ["chiarimento", "risposta"]);
  assert.deepEqual([...REFERENT_THREAD_KINDS_BY_SIDE.referente], ["dubbio", "risposta", "aggiunta"]);
  assert.ok(normalize(m).includes(normalize(`CONSTRAINT use_case_referent_messages_shape_check CHECK (
    (anchor = 'domanda' AND need_id IS NOT NULL AND component_key IS NULL)
    OR (anchor = 'beneficio' AND component_key IS NOT NULL AND need_id IS NULL)
    OR (anchor = 'generale' AND need_id IS NULL AND component_key IS NULL))`)));
  assert.match(m, /CONSTRAINT use_case_referent_messages_author_check CHECK \(side = 'team' OR author_user_id IS NULL\)/, "il referente non ha un account sulla riga");
  assert.match(m, /CONSTRAINT use_case_referent_messages_reply_check CHECK \(\(kind = 'risposta'\) = \(reply_to_id IS NOT NULL\)\)/);
  assert.match(m, /CONSTRAINT use_case_referent_messages_body_check CHECK \(\(removed_at IS NULL\) = \(body IS NOT NULL\)/);
  assert.match(m, new RegExp(`body varchar\\(${REFERENT_THREAD_LIMITS.body}\\),`));
  assert.match(m, /request_id uuid NOT NULL REFERENCES use_case_referent_requests\(id\) ON DELETE CASCADE/);
  assert.equal(REFERENT_THREAD_LIMITS.key, VALUE_MODEL_LIMITS.key);
  assert.doesNotMatch(m, /contact_id|email/, "nessun referente sulla riga: è quello della richiesta (art. 15.4)");
  const s = tableOf("use_case_referent_suggestions");
  assert.deepEqual(checkList(s, "use_case_referent_suggestions_status_check"), [...REFERENT_SUGGESTION_STATUSES]);
  assert.deepEqual([...REFERENT_SUGGESTION_STATUSES], ["da_fare", "proposta", "nessuna", "usata", "scartata", "errore"]);
  assert.match(s, new RegExp(`body varchar\\(${REFERENT_THREAD_LIMITS.suggestion}\\),`));
  assert.match(s, /CONSTRAINT use_case_referent_suggestions_attempts_check CHECK \(attempts BETWEEN 0 AND 3\)/);
  assert.match(s, /CONSTRAINT use_case_referent_suggestions_body_check CHECK \(\(status IN \('proposta', 'usata', 'scartata'\)\) = \(body IS NOT NULL\)/);
  assert.doesNotMatch(s, /contact_id|email|removed_/, "le proposte si cancellano, non si svuotano");
});

test("la sonda copre le tabelle, gli indici, ogni vincolo con nome, ogni colonna nuova e i due CHECK allargati", () => {
  const ddl = USE_CASE_REFERENT_THREAD_DDL.join("\n");
  const tables = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, [...REFERENT_THREAD_TABLES]);
  const indexes = [...ddl.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(indexes, [...REFERENT_THREAD_INDEXES]);
  const constraints = [...new Set(REFERENT_THREAD_TABLES.flatMap((t) => [...tableOf(t).matchAll(/CONSTRAINT (\w+)/g)].map((m) => m[1])))];
  assert.deepEqual([...constraints].sort(), [...REFERENT_THREAD_NAMED_CONSTRAINTS].sort());
  for (const name of [...tables, ...indexes]) assert.ok(USE_CASE_REFERENT_THREAD_PROBE_SQL.includes(`'public.${name}'`), `la sonda non guarda ${name}`);
  for (const name of constraints) assert.ok(USE_CASE_REFERENT_THREAD_PROBE_SQL.includes(`'${name}'`), `la sonda non guarda ${name}`);
  const added = [...ddl.matchAll(/ALTER TABLE (\w+) ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => [m[1], m[2]]);
  assert.deepEqual(added, Object.entries(REFERENT_THREAD_ADDED_COLUMNS).flatMap(([t, cols]) => cols.map((c) => [t, c])));
  for (const [t, cols] of Object.entries(REFERENT_THREAD_ADDED_COLUMNS)) {
    assert.ok(USE_CASE_REFERENT_THREAD_PROBE_SQL.includes(`table_name = '${t}' AND column_name IN (${cols.map((c) => `'${c}'`).join(", ")})`), `la sonda non guarda le colonne di ${t}`);
  }
  const columnConstraints = [...ddl.matchAll(/ADD COLUMN IF NOT EXISTS \w+ [^;]*CONSTRAINT (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(columnConstraints, Object.values(REFERENT_THREAD_COLUMN_CONSTRAINTS).flat());
  for (const name of columnConstraints) assert.ok(USE_CASE_REFERENT_THREAD_PROBE_SQL.includes(`'${name}'`), `la sonda non guarda ${name}`);
  assert.ok(USE_CASE_REFERENT_THREAD_PROBE_SQL.includes(`conname = '${REQUESTER_NEWS_CHECK_NAME}'`));
  assert.ok(USE_CASE_REFERENT_THREAD_PROBE_SQL.includes("pg_get_constraintdef(oid) LIKE '%questions%'"));
  assert.ok(USE_CASE_REFERENT_THREAD_PROBE_SQL.includes("position('''domanda''' IN pg_get_constraintdef(c.oid)) > 0"));
});

test("ensure-schema: versione 22, la 0028 dopo la 0027, non fatale, con timeout e lock, e la sonda in AND", () => {
  assert.match(ensureSchema, /const ENSURE_VERSION = 22;/);
  assert.match(ensureSchema, /import \{ USE_CASE_REFERENT_THREAD_DDL, USE_CASE_REFERENT_THREAD_PROBE_SQL \} from "\.\/use-case-hub-referent-thread-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const benefits = runOnce.indexOf("await runUseCaseReferentBenefitsDdlSafely();");
  const thread = runOnce.indexOf("await runUseCaseReferentThreadDdlSafely();");
  assert.ok(benefits > 0 && thread > benefits, "0027 poi 0028");
  assert.ok(!runOnce.includes("await runUseCaseReferentThreadDdl();"), "la 0028 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runUseCaseReferentThreadDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runUseCaseReferentThreadDdl\(\);\s+referentThreadDdlFailedAt = null;\s+\} catch \(err\) \{\s+referentThreadDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  assert.match(safe, /0028 self-heal failed, the app keeps serving without «Chiedi al referente» \(apply drizzle\/0028 by hand\):/);
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(ensure, /Date\.now\(\) - referentThreadDdlFailedAt >= REFERENTS_DDL_RETRY_MS/);
  assert.match(ensure, /ensurePromise = ensurePromise\.then\(runUseCaseReferentThreadDdlSafely\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(USE_CASE_REFERENT_BENEFITS_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(USE_CASE_REFERENT_THREAD_PROBE_SQL\)\}/);
  const run = topLevelFunction(ensureSchema, "export async function runUseCaseReferentThreadDdl(");
  const timeout = run.indexOf(`client.query("SELECT set_config('lock_timeout', '3s', true)")`);
  const lock = run.indexOf(`client.query("SELECT pg_advisory_xact_lock(hashtext('${REFERENT_THREAD_ADVISORY_LOCK}'))")`);
  const statements = run.indexOf("...statements.map(");
  assert.ok(timeout > 0 && lock > timeout && statements > lock);
  assert.match(run, /client\.transaction\(/);
  assert.match(ensureSchema, /In produzione\s+\* la applica questo self-heal, al primo avvio dopo il deploy, come la 0027 \(RUNBOOK §10\.15\)/);
});

test("referentStoreReady e il doctor guardano la sonda della 0028", () => {
  assert.match(base, /import \{ USE_CASE_REFERENT_THREAD_PROBE_SQL \} from "@\/lib\/db\/use-case-hub-referent-thread-ddl";/);
  const ready = topLevelFunction(base, "export async function referentStoreReady(): Promise<boolean> {");
  assert.match(ready, /AND \$\{raw\(USE_CASE_REFERENT_BENEFITS_PROBE_SQL\)\}\s+AND \$\{raw\(USE_CASE_REFERENT_THREAD_PROBE_SQL\)\}\) AS ok/);
  assert.match(doctor, /SELECT \$\{USE_CASE_REFERENT_THREAD_PROBE_SQL\} AS ok/);
  assert.match(doctor, /migrazione0028: m0028,/);
});

test("la pulizia: gli stessi statement del RUNBOOK §10.15, carattere per carattere; solo le richieste cancellate", () => {
  assert.ok(runbook.includes("### 10.15"), "manca §10.15");
  const section = runbook.slice(runbook.indexOf("### 10.15"));
  const block = /```sql\n([\s\S]*?)```/.exec(section.slice(section.indexOf("Ritorno indietro, mentre il codice di prima è in produzione")))?.[1] ?? "";
  assert.equal(block, `${REFERENT_THREAD_SWEEP_SQL.join("\n")}\n`);
  assert.equal(REFERENT_THREAD_SWEEP_SQL.length, 2);
  for (const s of REFERENT_THREAD_SWEEP_SQL) {
    assert.doesNotMatch(s, /\bDROP\b|\bTRUNCATE\b/);
    assert.match(s, /r\.purged_at IS NOT NULL/);
  }
  assert.match(section, /ENSURE_VERSION` 22/);
  assert.match(section, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0028_use_case_referent_thread\.sql/);
  assert.match(section, /`migrazione0028: true`/);
});

test("schema.ts: le colonne Drizzle sono le colonne del DDL, nello stesso ordine", () => {
  assert.equal(getTableName(schema.useCaseReferentMessages), "use_case_referent_messages");
  assert.deepEqual(
    Object.values(getTableColumns(schema.useCaseReferentMessages)).map((c) => c.name),
    ddlColumns(tableOf("use_case_referent_messages")),
  );
  assert.equal(getTableName(schema.useCaseReferentSuggestions), "use_case_referent_suggestions");
  assert.deepEqual(
    Object.values(getTableColumns(schema.useCaseReferentSuggestions)).map((c) => c.name),
    ddlColumns(tableOf("use_case_referent_suggestions")),
  );
  const tail = (table: Parameters<typeof getTableColumns>[0], n: number) => Object.values(getTableColumns(table)).map((c) => c.name).slice(-n);
  const added = REFERENT_THREAD_ADDED_COLUMNS;
  assert.deepEqual(tail(schema.useCaseReferentRequests, 2), [...added.use_case_referent_requests]);
  assert.deepEqual(tail(schema.useCaseReferentRequestItems, 1), [...added.use_case_referent_request_items]);
  assert.deepEqual(tail(schema.useCaseNeedAnswers, 1), [...added.use_case_need_answers]);
  assert.deepEqual(tail(schema.useCaseReferentEmailItems, 2), [...added.use_case_referent_email_items]);
  assert.deepEqual(tail(schema.useCaseRequesterEmailItems, 1), [...added.use_case_requester_email_items]);
});
