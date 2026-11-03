import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  ALERTS_ADVISORY_LOCK,
  ALERTS_INDEXES,
  ALERTS_NAMED_CONSTRAINTS,
  ALERTS_TABLES,
  CASE_ALERT_EMAIL_STATUSES,
  CASE_ALERT_KINDS,
  CASE_ALERTS_TABLES_PRESENT_SQL,
  MISSING_REFERENTS_MESSAGE,
  ROME_QUARTER_NOW_SQL,
  USE_CASE_ALERTS_DDL,
  USE_CASE_ALERTS_PROBE_SQL,
  USE_CASE_NOTIFICATION_KINDS_0025,
  notificationKindsWideningDdl,
  readyCardPredicate,
} from "./use-case-hub-alerts-ddl.ts";
import { CLIENT_SIDE_SQL, USE_CASE_NOTIFICATION_KINDS } from "./use-case-hub-referents-ddl.ts";
import * as schema from "./schema.ts";

// Migrazione 0025 e self-heal: «Pronto da avviare» e «Autorizza i fornitori». Le prove sul database
// stanno in src/lib/use-cases/case-alerts/*.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0025_use_case_alerts.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");

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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-alerts-ddl'));"];

const tableStatement = (name: string) => {
  const found = USE_CASE_ALERTS_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`));
  assert.ok(found, `manca la tabella ${name}`);
  return found;
};

function ddlColumns(name: string): string[] {
  const statement = tableStatement(name);
  return statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|smallint|timestamptz|integer|char|boolean|jsonb|date)\b/)?.[1])
    .filter((n): n is string => Boolean(n));
}

function checkList(statement: string, constraint: string): string[] {
  const at = statement.indexOf(`CONSTRAINT ${constraint} CHECK`);
  assert.notEqual(at, -1, `manca ${constraint}`);
  const list = statement.slice(at).match(/IN \(([^)]*)\)/)?.[1] ?? "";
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

test("0025: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "lock_timeout e advisory lock in testa");
  assert.equal(ALERTS_ADVISORY_LOCK, "unbundle:use-case-alerts-ddl");
  let cursor = 0;
  for (const statement of USE_CASE_ALERTS_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...USE_CASE_ALERTS_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.doesNotMatch(migration, /CREATE\s+EXTENSION/i);
});

test("controllo iniziale: senza la 0024 si ferma con il suo messaggio", () => {
  const guard = USE_CASE_ALERTS_DDL[0];
  assert.match(guard, /^DO \$\$ BEGIN\s+IF to_regclass\('public\.use_case_notifications'\) IS NULL OR to_regclass\('public\.use_case_info_state'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(guard.includes(`'${MISSING_REFERENTS_MESSAGE}'`));
  assert.doesNotMatch(MISSING_REFERENTS_MESSAGE, /[%']/);
});

test("i tipi: quelli della 0024 com'erano, più «pronto» e «fornitori»; il blocco allarga e non restringe", () => {
  assert.deepEqual([...USE_CASE_NOTIFICATION_KINDS], ["risposte", "documenti", "senza_risposta", "complete"], "l'elenco della 0024 non cambia");
  assert.deepEqual([...CASE_ALERT_KINDS], ["pronto", "fornitori"]);
  assert.deepEqual([...USE_CASE_NOTIFICATION_KINDS_0025], [...USE_CASE_NOTIFICATION_KINDS, "pronto", "fornitori"]);
  const block = USE_CASE_ALERTS_DDL[1];
  assert.equal(block, notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0025));
  assert.ok(block.includes("ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori']::text[]"));
  assert.match(block, /PERFORM set_config\('lock_timeout', '3s', true\);/);
  // Mai restringere: i nomi che il vincolo ammette già si tengono, dopo quelli voluti.
  assert.match(block, /allowed := wanted \|\| coalesce\(/);
  assert.ok(block.includes("regexp_matches(coalesce(current_def, ''), '''([a-z0-9_]+)''::', 'g')"), "i nomi di adesso, scritti 'nome'::character varying");
  assert.match(block, /DROP CONSTRAINT IF EXISTS use_case_notifications_kind_check;/);
  assert.match(block, /\) NOT VALID';/);
  assert.match(block, /VALIDATE CONSTRAINT use_case_notifications_kind_check;/);
});

test("idempotente e solo additivo: niente DROP di oggetti, l'unica scrittura è il seme, per ultimo", () => {
  const writes: string[] = [];
  for (const statement of USE_CASE_ALERTS_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|DROP\s+(TABLE|INDEX|COLUMN|TRIGGER|FUNCTION|NOT NULL|DEFAULT)/i);
    if (/^CREATE (TABLE|UNIQUE INDEX|INDEX)/.test(statement)) assert.match(statement, /IF NOT EXISTS/);
    if (/\b(UPDATE|DELETE FROM|INSERT INTO)\b/.test(statement)) writes.push(statement);
  }
  assert.equal(writes.length, 1);
  const seed = writes[0];
  assert.equal(USE_CASE_ALERTS_DDL.indexOf(seed), USE_CASE_ALERTS_DDL.length - 1);
  assert.equal(seed.match(/INSERT INTO use_case_ready_state \(use_case_id, workspace_id, ready_since, ready_quarter\)/g)?.length, 2, "con e senza i dossier");
  assert.equal(seed.match(/ON CONFLICT \(use_case_id\) DO NOTHING/g)?.length, 2);
  assert.match(seed, /IF to_regclass\('public\.uc_cases'\) IS NOT NULL THEN/);
  // Il seme usa la stessa regola della lettura (`readyNowSql`), con il trimestre di adesso a Roma.
  for (const dossiers of [true, false]) {
    const predicate = readyCardPredicate("u", { fromQuarter: ROME_QUARTER_NOW_SQL, dossiers });
    assert.ok(normalize(seed).includes(normalize(predicate)), `regola con dossiers=${dossiers}`);
  }
});

test("la regola in SQL: approvato, non archiviato, «Da costruire», trimestre, dossier, informazioni del cliente", () => {
  const p = readyCardPredicate("u", { fromQuarter: "'2026-Q4'", dossiers: true });
  assert.match(p, /u\.status = 'accepted'/);
  assert.match(p, /u\.portfolio_review_status IS DISTINCT FROM 'archived'/);
  assert.match(p, /u\.portfolio_kind IS DISTINCT FROM 'best_practice'/);
  assert.match(p, /u\.target_quarter IS NOT NULL AND u\.target_quarter >= '2026-Q4'/);
  assert.match(p, /uc_cases rc WHERE rc\.portfolio_use_case_id = u\.id AND rc\.workspace_id = u\.workspace_id AND rc\.setup_completed_at IS NOT NULL/);
  assert.ok(p.includes(CLIENT_SIDE_SQL("rn")));
  assert.match(p, /rn\.status NOT IN \('validata', 'non_applicabile'\)/);
  assert.doesNotMatch(readyCardPredicate("u", { fromQuarter: "'2026-Q4'", dossiers: false }), /uc_cases/);
  assert.match(readyCardPredicate("u", { fromQuarter: "'2026-Q4'", toQuarter: "'2027-Q1'", dossiers: false }), /u\.target_quarter <= '2027-Q1'/);
  assert.throws(() => readyCardPredicate("u; DROP", { fromQuarter: "'2026-Q4'", dossiers: false }));
  assert.throws(() => readyCardPredicate("u", { fromQuarter: "now()", dossiers: false }));
});

test("i CHECK sono gli elenchi del vocabolario; ogni tabella porta il workspace con la cascata", () => {
  const emails = tableStatement("use_case_alert_emails");
  assert.deepEqual(checkList(emails, "use_case_alert_emails_kind_check"), [...CASE_ALERT_KINDS]);
  assert.deepEqual(checkList(emails, "use_case_alert_emails_status_check"), [...CASE_ALERT_EMAIL_STATUSES]);
  assert.match(emails, /CONSTRAINT use_case_alert_emails_day_unique UNIQUE \(workspace_id, recipient_user_id, kind, send_on\)/);
  assert.match(tableStatement("use_case_ready_state"), /CHECK \(\(ready_since IS NULL\) = \(ready_quarter IS NULL\)\)/);
  for (const name of ALERTS_TABLES) {
    assert.match(tableStatement(name), /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/, name);
    assert.doesNotMatch(tableStatement(name), /REFERENCES uc_/, name);
    assert.doesNotMatch(tableStatement(name), /actor_user_id/, name);
  }
});

test("la sonda copre ogni tabella, indice e vincolo con nome, e il CHECK dei tipi", () => {
  const ddl = USE_CASE_ALERTS_DDL.join("\n");
  const tables = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, [...ALERTS_TABLES]);
  const indexes = [...ddl.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(indexes, [...ALERTS_INDEXES]);
  const tablesDdl = USE_CASE_ALERTS_DDL.filter((s) => s.startsWith("CREATE TABLE")).join("\n");
  const constraints = [...new Set([...tablesDdl.matchAll(/CONSTRAINT (\w+)/g)].map((m) => m[1]))];
  assert.deepEqual([...constraints].sort(), [...ALERTS_NAMED_CONSTRAINTS].sort());
  for (const name of [...tables, ...indexes]) assert.ok(USE_CASE_ALERTS_PROBE_SQL.includes(`'public.${name}'`), `la sonda non guarda ${name}`);
  for (const name of constraints) assert.ok(USE_CASE_ALERTS_PROBE_SQL.includes(`'${name}'`), `la sonda non guarda ${name}`);
  assert.match(USE_CASE_ALERTS_PROBE_SQL, new RegExp(`\\) = ${ALERTS_NAMED_CONSTRAINTS.length}\\s`));
  assert.ok(USE_CASE_ALERTS_PROBE_SQL.includes("'use_case_notifications_kind_check'"));
  assert.ok(USE_CASE_ALERTS_PROBE_SQL.includes("ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori']::text[]"));
  for (const name of ALERTS_TABLES) assert.ok(CASE_ALERTS_TABLES_PRESENT_SQL.includes(`'public.${name}'`));
  assert.ok(CASE_ALERTS_TABLES_PRESENT_SQL.includes("'''pronto'''") && CASE_ALERTS_TABLES_PRESENT_SQL.includes("'''fornitori'''"));
});

test("ensure-schema: versione 19 o dopo, la 0025 dopo la 0024, non fatale, con timeout e lock, e la sonda in AND", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 19, "ENSURE_VERSION almeno 19 (la 0026 la porta a 20)");
  assert.match(ensureSchema, /import \{ USE_CASE_ALERTS_DDL, USE_CASE_ALERTS_PROBE_SQL \} from "\.\/use-case-hub-alerts-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const referents = runOnce.indexOf("await runUseCaseReferentsDdlSafely();");
  const alerts = runOnce.indexOf("await runUseCaseAlertsDdlSafely();");
  assert.ok(referents > 0 && alerts > referents, "0024 poi 0025");
  assert.ok(!runOnce.includes("await runUseCaseAlertsDdl();"), "la 0025 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runUseCaseAlertsDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runUseCaseAlertsDdl\(\);\s+alertsDdlFailedAt = null;\s+\} catch \(err\) \{\s+alertsDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(ensure, /Date\.now\(\) - alertsDdlFailedAt >= REFERENTS_DDL_RETRY_MS/);
  assert.match(ensure, /ensurePromise = ensurePromise\.then\(runUseCaseAlertsDdlSafely\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(USE_CASE_REFERENTS_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(USE_CASE_ALERTS_PROBE_SQL\)\}/);
  const run = topLevelFunction(ensureSchema, "export async function runUseCaseAlertsDdl(");
  const timeout = run.indexOf(`client.query("SELECT set_config('lock_timeout', '3s', true)")`);
  const lock = run.indexOf(`client.query("SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'))")`);
  const statements = run.indexOf("...statements.map(");
  assert.ok(timeout > 0 && lock > timeout && statements > lock);
  assert.match(run, /client\.transaction\(/);
});

const DRIZZLE_TABLES: Record<(typeof ALERTS_TABLES)[number], PgTable> = {
  use_case_ready_state: schema.useCaseReadyState,
  use_case_alert_emails: schema.useCaseAlertEmails,
  use_case_alert_email_items: schema.useCaseAlertEmailItems,
};

test("schema.ts: le colonne Drizzle sono le colonne del DDL, nello stesso ordine", () => {
  for (const name of ALERTS_TABLES) {
    const table = DRIZZLE_TABLES[name];
    assert.equal(getTableName(table), name);
    const columns = Object.values(getTableColumns(table)).map((column) => column.name);
    assert.deepEqual(columns, ddlColumns(name), name);
  }
});
