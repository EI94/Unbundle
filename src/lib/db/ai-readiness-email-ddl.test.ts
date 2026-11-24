import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  AIR_EMAIL_ADDED_COLUMNS,
  AIR_EMAIL_ADVISORY_LOCK,
  AIR_EMAIL_DDL,
  AIR_EMAIL_INDEXES,
  AIR_EMAIL_KINDS,
  AIR_EMAIL_NAMED_CONSTRAINTS,
  AIR_EMAIL_PROBE_SQL,
  AIR_EMAIL_STATUSES,
  AIR_EMAIL_SWITCH_COLUMN,
  AIR_EMAIL_TABLE,
} from "./ai-readiness-email-ddl.ts";
import * as schema from "./schema.ts";

// Migrazione 0044 e self-heal: le email dell'AI Readiness (la scelta della persona in `workspace_bell_state` e la coda
// `ai_readiness_alert_emails`). Le prove sul database (la 0044 due volte, il self-heal due volte, la coda, l'invio) stanno
// in src/lib/db/queries/ai-readiness-email.integration.test.ts. ENSURE_VERSION 38.

const migration = readFileSync(new URL("../../../drizzle/0044_avvisi_ai_readiness.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");
const doctor = readFileSync(new URL("../../../scripts/use-case-admin/doctor.ts", import.meta.url), "utf8");

const normalize = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();

function topLevelFunction(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `manca: ${signature}`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `fine non trovata: ${signature}`);
  return source.slice(start, end + 2);
}

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:ai-readiness-email-ddl'));"];
const table = AIR_EMAIL_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${AIR_EMAIL_TABLE} (`)) ?? "";
const ddlColumns = (statement: string) =>
  statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|timestamptz|smallint)\b/)?.[1])
    .filter((n): n is string => Boolean(n));
const checkList = (statement: string, name: string) =>
  [...(new RegExp(`CONSTRAINT ${name} CHECK \\([a-z_]+ IN \\(([^)]*)\\)\\)`).exec(statement)?.[1] ?? "").matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

test("0044: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "il file comincia con lock_timeout e l'advisory lock");
  assert.equal(AIR_EMAIL_ADVISORY_LOCK, "unbundle:ai-readiness-email-ddl");
  let cursor = 0;
  for (const statement of AIR_EMAIL_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...AIR_EMAIL_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0044_avvisi_ai_readiness\.sql/);
  assert.match(migration, /dopo la 0043, ENSURE_VERSION 38/);
  assert.match(migration, /mai drizzle-kit, mai db:push/);
});

test("solo aggiunte: nessuna riscrittura, nessun dato, nessun CHECK di prima toccato; il messaggio d'errore senza apostrofi", () => {
  for (const statement of AIR_EMAIL_DDL) {
    assert.doesNotMatch(statement, /\bDROP\b|\bRENAME\b|CREATE\s+EXTENSION|ALTER\s+COLUMN|\bTYPE\b/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i, "nessun dato scritto");
    assert.doesNotMatch(statement, /\buc_[a-z_]+/, "il DDL uc (0018) non cambia");
    assert.doesNotMatch(statement, /use_case_alert_emails|use_case_notifications/, "la 0025 e la 0024 restano come sono");
  }
  // Il controllo dei prerequisiti: la 0024 e le tabelle dell'AI Readiness, prima di tutto.
  assert.match(AIR_EMAIL_DDL[0], /to_regclass\('public\.workspace_bell_state'\) IS NULL OR to_regclass\('public\.ai_readiness_assessments'\) IS NULL/);
  assert.match(AIR_EMAIL_DDL[0], /RAISE EXCEPTION '[^']*';/, "un solo letterale, chiuso: nessun apostrofo dentro");
  // Un solo ALTER, la colonna della scelta, con un default costante: nessuna riscrittura della tabella.
  assert.deepEqual(
    AIR_EMAIL_DDL.filter((s) => /^ALTER\b/.test(s)),
    [`ALTER TABLE workspace_bell_state ADD COLUMN IF NOT EXISTS ${AIR_EMAIL_SWITCH_COLUMN} boolean NOT NULL DEFAULT true;`],
  );
  assert.deepEqual(AIR_EMAIL_ADDED_COLUMNS, { workspace_bell_state: [AIR_EMAIL_SWITCH_COLUMN] });
});

test("la coda: la rilevazione, la persona, i due tipi, gli stati delle altre code; si cancella con il workspace, la rilevazione e la persona", () => {
  assert.match(table, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(table, /assessment_id uuid NOT NULL REFERENCES ai_readiness_assessments\(id\) ON DELETE CASCADE/);
  assert.match(table, /recipient_user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.deepEqual(checkList(table, "ai_readiness_alert_emails_kind_check"), [...AIR_EMAIL_KINDS]);
  assert.deepEqual([...AIR_EMAIL_KINDS], ["risposte", "risultati"]);
  assert.deepEqual(checkList(table, "ai_readiness_alert_emails_status_check"), [...AIR_EMAIL_STATUSES]);
  assert.match(table, /CONSTRAINT ai_readiness_alert_emails_attempts_check CHECK \(attempts BETWEEN 0 AND 3\)/);
  assert.match(table, /CONSTRAINT ai_readiness_alert_emails_sent_check CHECK \(\(status = 'inviata'\) = \(sent_at IS NOT NULL\)\)/);
  assert.deepEqual(ddlColumns(table), [
    "id",
    "workspace_id",
    "assessment_id",
    "recipient_user_id",
    "kind",
    "status",
    "hold_reason",
    "cancel_reason",
    "last_error_code",
    "attempts",
    "counts_from",
    "counted_until",
    "scheduled_at",
    "lease_until",
    "attempt_started_at",
    "sent_at",
    "created_at",
    "updated_at",
  ]);
  // Nessun testo: solo id, stati, istanti e codici. Mai un nome, un'email, una risposta.
  assert.doesNotMatch(table, /\b(name|title|email|body|answers|payload)\b/);
});

test("gli indici: una riga in attesa per rilevazione, persona e tipo; «risultati» una volta sola per rilevazione e persona", () => {
  const index = (name: string) => AIR_EMAIL_DDL.find((s) => s.includes(` ${name}\n`) || s.includes(` ${name} `)) ?? "";
  assert.match(index("ai_readiness_alert_emails_pending_unique"), /^CREATE UNIQUE INDEX IF NOT EXISTS ai_readiness_alert_emails_pending_unique\s+ON ai_readiness_alert_emails \(assessment_id, recipient_user_id, kind\) WHERE status IN \('in_coda', 'errore'\);$/);
  assert.match(index("ai_readiness_alert_emails_results_once"), /^CREATE UNIQUE INDEX IF NOT EXISTS ai_readiness_alert_emails_results_once\s+ON ai_readiness_alert_emails \(assessment_id, recipient_user_id\) WHERE kind = 'risultati';$/);
  assert.match(index("ai_readiness_alert_emails_due_idx"), /\(scheduled_at\) WHERE status IN \('in_coda', 'errore'\);$/);
  for (const name of AIR_EMAIL_INDEXES) assert.ok(index(name), name);
});

test("la sonda: la colonna della scelta, la tabella, ogni indice e ogni vincolo con nome", () => {
  assert.match(AIR_EMAIL_PROBE_SQL, /a\.attrelid = to_regclass\('public\.workspace_bell_state'\) AND a\.attname = 'ai_readiness_emails' AND NOT a\.attisdropped/);
  assert.ok(AIR_EMAIL_PROBE_SQL.includes(`to_regclass('public.${AIR_EMAIL_TABLE}') IS NOT NULL`));
  for (const name of AIR_EMAIL_INDEXES) {
    assert.ok(AIR_EMAIL_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
    assert.ok(AIR_EMAIL_DDL.some((s) => s.includes(`INDEX IF NOT EXISTS ${name}`)), name);
  }
  for (const name of AIR_EMAIL_NAMED_CONSTRAINTS) {
    assert.ok(table.includes(`CONSTRAINT ${name} `) && AIR_EMAIL_PROBE_SQL.includes(`'${name}'`), name);
  }
  assert.ok(AIR_EMAIL_PROBE_SQL.includes(`) = ${AIR_EMAIL_NAMED_CONSTRAINTS.length}`));
});

test("ensure-schema: versione 38, la 0044 dopo la 0043, saltata in anteprima, non fatale, con il suo lock, il nuovo tentativo e la sonda in AND", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 38, "ENSURE_VERSION almeno 38");
  assert.match(ensureSchema, /import \{ AIR_EMAIL_ADVISORY_LOCK, AIR_EMAIL_DDL, AIR_EMAIL_PROBE_SQL \} from "\.\/ai-readiness-email-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const caseOnly = runOnce.indexOf("await runCaseOnlyDdlSafely();");
  const ours = runOnce.indexOf("await runAirEmailDdlSafely();");
  assert.ok(caseOnly > 0 && ours > caseOnly, "la 0044 dopo la 0043");
  assert.ok(!runOnce.includes("await runAirEmailDdl();"), "la 0044 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runAirEmailDdlSafely(): Promise<void> {");
  // Mai da un'anteprima di Vercel: le anteprime usano il database di produzione.
  assert.match(safe, /^async function runAirEmailDdlSafely\(\): Promise<void> \{\s+if \(process\.env\.VERCEL_ENV === "preview"\) return;/);
  assert.match(safe, /try \{\s+await runAirEmailDdl\(\);\s+airEmailDdlFailedAt = null;\s+\} catch \(err\) \{\s+airEmailDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  assert.match(safe, /0044 self-heal failed/);
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(
    ensure,
    /if \(airEmailDdlFailedAt !== null && Date\.now\(\) - airEmailDdlFailedAt >= REFERENTS_DDL_RETRY_MS\) \{\s+airEmailDdlFailedAt = Date\.now\(\);\s+ensurePromise = ensurePromise\.then\(runAirEmailDdlSafely\);/,
  );
  const runner = topLevelFunction(ensureSchema, "export async function runAirEmailDdl(statements: readonly string[] = AIR_EMAIL_DDL): Promise<void> {");
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") > 0);
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") < runner.indexOf("pg_advisory_xact_lock(hashtext('${AIR_EMAIL_ADVISORY_LOCK}'))"));
  assert.match(runner, /client\.transaction\(\[/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(CASE_ONLY_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(AIR_EMAIL_PROBE_SQL\)\}/);
});

test("Drizzle: la tabella come il DDL, e la scelta in fondo a workspace_bell_state", () => {
  assert.equal(getTableName(schema.aiReadinessAlertEmails), AIR_EMAIL_TABLE);
  assert.deepEqual(Object.values(getTableColumns(schema.aiReadinessAlertEmails)).map((c) => c.name), ddlColumns(table));
  const bell = Object.values(getTableColumns(schema.workspaceBellState)).map((c) => c.name);
  assert.equal(bell.at(-1), AIR_EMAIL_SWITCH_COLUMN);
  assert.equal(schema.workspaceBellState.aiReadinessEmails.default, true);
  assert.equal(schema.workspaceBellState.aiReadinessEmails.notNull, true);
});

test("use-case-admin doctor dice migrazione0044, solo da leggere", () => {
  assert.match(doctor, /import \{ AIR_EMAIL_PROBE_SQL \} from "\.\.\/\.\.\/src\/lib\/db\/ai-readiness-email-ddl\.ts";/);
  assert.match(doctor, /const m0044 = \(await ctx\.db\.read\(`SELECT \$\{AIR_EMAIL_PROBE_SQL\} AS ok`\)\)\[0\]\?\.ok === true;/);
  assert.match(doctor, /migrazione0044: m0044,/);
});

test("RUNBOOK §10.26: la 0044 la applica l'app, mai da un'anteprima, a mano solo di riserva, il ritorno indietro con le email in coda", () => {
  const runbook = readFileSync(new URL("../../../docs/casi-duso/RUNBOOK.md", import.meta.url), "utf8");
  const heading = "### 10.26 Le email dell'AI Readiness (0044)";
  assert.ok(runbook.includes(heading), "manca §10.26");
  const section = runbook.slice(runbook.indexOf(heading));
  const next = section.indexOf("\n### ", heading.length);
  const own = next === -1 ? section : section.slice(0, next);
  assert.match(own, /`ENSURE_VERSION` 38/);
  assert.match(own, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0044_avvisi_ai_readiness\.sql/);
  assert.match(own, /Mai drizzle-kit, mai `db:push`/);
  assert.match(own, /`migrazione0044: true`/);
  assert.match(own, /non parte da un'anteprima \(`VERCEL_ENV=preview`\)/);
  assert.match(own, /\*\*Ritorno indietro:\*\*/);
  // Il passo SQL facoltativo del ritorno indietro: annulla solo le righe in attesa, mai quelle inviate.
  const sql = (/```sql\n([\s\S]*?)```/.exec(own)?.[1] ?? "").replace(/^ {3}/gm, "");
  assert.match(sql, /^UPDATE ai_readiness_alert_emails SET status = 'annullata', cancel_reason = 'ritorno_indietro'/);
  assert.match(sql, /WHERE status IN \('in_coda', 'errore'\);\n$/);
});
