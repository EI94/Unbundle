import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import {
  CLIENT_SIDE_SQL,
  FOLLOW_UP_REASONS,
  INFO_DONE_STATUSES,
  MISSING_HUB_MESSAGE,
  REFERENTS_ADVISORY_LOCK,
  REFERENTS_INDEXES,
  REFERENTS_NAMED_CONSTRAINTS,
  REFERENTS_TABLES,
  REFERENT_ANSWER_REMOVE_REASONS,
  REFERENT_EMAIL_TEMPLATES,
  REFERENT_ENTRY_SOURCES,
  REFERENT_EVENT_FIELD,
  REFERENT_FILE_DELETE_REASONS,
  REFERENT_FILE_STATUSES,
  REFERENT_ITEM_STATES,
  REFERENT_REMINDER_KINDS,
  REFERENT_REQUEST_STATUSES,
  REFERENT_REVOKE_REASONS,
  REQUESTER_EMAIL_STATUSES,
  USE_CASE_EVENT_FIELDS_0024,
  USE_CASE_NOTIFICATION_KINDS,
  USE_CASE_REFERENTS_DDL,
  USE_CASE_REFERENTS_PROBE_SQL,
} from "./use-case-hub-referents-ddl.ts";
import { USE_CASE_EVENT_FIELDS_0023, USE_CASE_HISTORY_DDL, eventFieldsProbeSql, eventFieldsWideningDdl } from "./use-case-hub-history-ddl.ts";
import * as schema from "./schema.ts";

// Migrazione 0024 e self-heal: «Chiedi al referente», campanella per persona e avanzamento delle
// informazioni (SPEC chiedi §1, §P2.2). Le prove sul database stanno nelle suite di integrazione di
// src/lib/use-cases/referent e in scripts/use-case-test/schema-check.mjs.

const migration = readFileSync(new URL("../../../drizzle/0024_use_case_referents.sql", import.meta.url), "utf8");
const migration0023 = readFileSync(new URL("../../../drizzle/0023_use_case_needs_history.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");
const vercel = JSON.parse(readFileSync(new URL("../../../vercel.json", import.meta.url), "utf8")) as {
  crons: { path: string; schedule: string }[];
  git: { deploymentEnabled: Record<string, boolean> };
};

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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-referents-ddl'));"];

const tableStatement = (name: string) => {
  const found = USE_CASE_REFERENTS_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`));
  assert.ok(found, `manca la tabella ${name}`);
  return found;
};

/** Le colonne di un CREATE TABLE, nell'ordine (le righe `CONSTRAINT` escluse). */
function ddlColumns(name: string): string[] {
  const statement = tableStatement(name);
  return statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|smallint|timestamptz|integer|char|boolean|jsonb|date)\b/)?.[1])
    .filter((name): name is string => Boolean(name));
}

/** `IN ('a', 'b')` del vincolo `name` nella tabella. */
function checkList(statement: string, constraint: string): string[] {
  const at = statement.indexOf(`CONSTRAINT ${constraint} CHECK`);
  assert.notEqual(at, -1, `manca ${constraint}`);
  const list = statement.slice(at).match(/IN \(([^)]*)\)/)?.[1] ?? "";
  return [...list.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
}

test("0024: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "lock_timeout e advisory lock in testa");
  let cursor = 0;
  for (const statement of USE_CASE_REFERENTS_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...USE_CASE_REFERENTS_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.doesNotMatch(migration, /CREATE\s+EXTENSION/i);
});

test("il blocco della Storia: quello della 0023 con richiesta_referente, identico byte per byte e ultimo", () => {
  assert.equal(REFERENT_EVENT_FIELD, "richiesta_referente");
  assert.deepEqual(USE_CASE_EVENT_FIELDS_0024, [...USE_CASE_EVENT_FIELDS_0023, "richiesta_referente"]);
  // Il refactor della 0023 non cambia un byte: il file della 0023 contiene il blocco generato.
  assert.equal(USE_CASE_HISTORY_DDL[0], eventFieldsWideningDdl(USE_CASE_EVENT_FIELDS_0023));
  assert.ok(migration0023.includes(eventFieldsWideningDdl(USE_CASE_EVENT_FIELDS_0023)));
  const last = USE_CASE_REFERENTS_DDL[USE_CASE_REFERENTS_DDL.length - 1];
  assert.equal(last, eventFieldsWideningDdl(USE_CASE_EVENT_FIELDS_0024));
  assert.ok(migration.includes(last), "il file contiene il blocco espanso, identico");
  assert.match(last, /PERFORM pg_advisory_xact_lock\(hashtext\('unbundle:use-case-history-ddl'\)\);/);
  assert.ok(last.includes("'cosa_serve', 'richiesta_referente']::text[]"));
});

test("controllo iniziale: senza 0020 o 0022 si ferma con il suo messaggio", () => {
  const guard = USE_CASE_REFERENTS_DDL[0];
  assert.match(guard, /^DO \$\$ BEGIN\s+IF to_regclass\('public\.use_case_needs'\) IS NULL OR to_regclass\('public\.use_case_events'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(guard.includes(`'${MISSING_HUB_MESSAGE}'`));
  assert.doesNotMatch(MISSING_HUB_MESSAGE, /[%']/);
});

test("idempotente e solo additivo: niente DROP, niente estensioni, l'unica scrittura è il seme", () => {
  const dml: string[] = [];
  for (const statement of USE_CASE_REFERENTS_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|DROP\s+(TABLE|INDEX|COLUMN|TRIGGER|FUNCTION|NOT NULL|DEFAULT)/i);
    if (/^CREATE (TABLE|UNIQUE INDEX|INDEX)/.test(statement)) assert.match(statement, /IF NOT EXISTS/);
    if (/^\s*(UPDATE|DELETE|INSERT)\b/i.test(statement)) dml.push(statement);
  }
  assert.equal(dml.length, 1);
  assert.match(dml[0], /^INSERT INTO use_case_info_state/);
  assert.match(dml[0], /ON CONFLICT \(use_case_id\) DO NOTHING;$/);
  // Il seme: le schede con ogni requisito del cliente a posto, segnate subito.
  assert.ok(dml[0].includes(CLIENT_SIDE_SQL("n")));
  assert.ok(dml[0].includes(`HAVING bool_and(n.status IN (${INFO_DONE_STATUSES.map((s) => `'${s}'`).join(", ")}))`));
  // Prima di tutto c'è il controllo, poi le tabelle; il blocco della Storia per ultimo, il seme subito prima.
  assert.equal(USE_CASE_REFERENTS_DDL.indexOf(dml[0]), USE_CASE_REFERENTS_DDL.length - 2);
});

test("nessuna chiave esterna verso le tabelle uc_*: il self-heal dell'hub non dipende dai dossier", () => {
  for (const statement of USE_CASE_REFERENTS_DDL) assert.doesNotMatch(statement, /REFERENCES uc_/);
  assert.match(tableStatement("use_case_referent_requests"), /\n  contact_id uuid NOT NULL,\n/);
  assert.match(tableStatement("use_case_referent_emails"), /\n  contact_id uuid NOT NULL,\n/);
  // Ogni tabella porta il workspace con la cascata.
  for (const name of REFERENTS_TABLES) {
    assert.match(tableStatement(name), /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/, name);
  }
});

test("i CHECK sono gli elenchi del vocabolario", () => {
  const requests = tableStatement("use_case_referent_requests");
  assert.deepEqual(checkList(requests, "use_case_referent_requests_status_check"), [...REFERENT_REQUEST_STATUSES]);
  assert.deepEqual(checkList(requests, "use_case_referent_requests_revoked_reason_check"), [...REFERENT_REVOKE_REASONS]);
  assert.ok(REFERENT_REVOKE_REASONS.includes("sostituita"));
  assert.deepEqual(checkList(tableStatement("use_case_referent_request_items"), "use_case_referent_request_items_state_check"), [...REFERENT_ITEM_STATES]);
  const answers = tableStatement("use_case_need_answers");
  assert.deepEqual(checkList(answers, "use_case_need_answers_source_check"), [...REFERENT_ENTRY_SOURCES]);
  assert.deepEqual(checkList(answers, "use_case_need_answers_removed_reason_check"), [...REFERENT_ANSWER_REMOVE_REASONS]);
  const files = tableStatement("use_case_need_files");
  assert.deepEqual(checkList(files, "use_case_need_files_scan_check"), [...REFERENT_FILE_STATUSES]);
  assert.deepEqual(checkList(files, "use_case_need_files_deleted_reason_check"), [...REFERENT_FILE_DELETE_REASONS]);
  assert.deepEqual(checkList(tableStatement("use_case_referent_emails"), "use_case_referent_emails_template_check"), [...REFERENT_EMAIL_TEMPLATES]);
  assert.deepEqual(checkList(tableStatement("use_case_referent_email_items"), "use_case_referent_email_items_kind_check"), [...REFERENT_REMINDER_KINDS]);
  const notifications = tableStatement("use_case_notifications");
  assert.deepEqual(checkList(notifications, "use_case_notifications_kind_check"), [...USE_CASE_NOTIFICATION_KINDS]);
  assert.deepEqual(checkList(notifications, "use_case_notifications_follow_up_check"), [...FOLLOW_UP_REASONS]);
  assert.deepEqual(checkList(tableStatement("use_case_requester_emails"), "use_case_requester_emails_status_check"), [...REQUESTER_EMAIL_STATUSES]);
  assert.deepEqual(checkList(tableStatement("use_case_requester_email_items"), "use_case_requester_email_items_follow_up_check"), [...FOLLOW_UP_REASONS]);
});

test("il token si salva solo come impronta; nessun «in corso»", () => {
  const tokens = tableStatement("use_case_referent_tokens");
  assert.match(tokens, /token_hash char\(64\) NOT NULL\s+CONSTRAINT use_case_referent_tokens_hash_check CHECK \(token_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(tokens, /recipient_hash char\(64\) NOT NULL/);
  assert.doesNotMatch(tokens, /token_prefix|\btoken varchar|\btoken text/);
  assert.ok(!(REFERENT_REQUEST_STATUSES as readonly string[]).includes("in_corso"));
});

test("la sonda copre ogni tabella, indice e vincolo con nome, le colonne della Parte 2 e la Storia", () => {
  const ddl = USE_CASE_REFERENTS_DDL.join("\n");
  const tables = [...ddl.matchAll(/CREATE TABLE IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(tables, [...REFERENTS_TABLES]);
  const indexes = [...ddl.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(indexes, [...REFERENTS_INDEXES]);
  // Il blocco della Storia (l'ultimo) tocca solo il vincolo della 0020: la sonda lo guarda a parte.
  const tablesDdl = USE_CASE_REFERENTS_DDL.slice(0, -1).join("\n");
  const constraints = [...new Set([...tablesDdl.matchAll(/CONSTRAINT (\w+)/g)].map((m) => m[1]))];
  assert.deepEqual([...constraints].sort(), [...REFERENTS_NAMED_CONSTRAINTS].sort());
  for (const name of [...tables, ...indexes]) assert.ok(USE_CASE_REFERENTS_PROBE_SQL.includes(`'public.${name}'`), `la sonda non guarda ${name}`);
  for (const name of constraints) assert.ok(USE_CASE_REFERENTS_PROBE_SQL.includes(`'${name}'`), `la sonda non guarda ${name}`);
  assert.match(USE_CASE_REFERENTS_PROBE_SQL, new RegExp(`\\) = ${REFERENTS_NAMED_CONSTRAINTS.length}\\s`));
  assert.ok(USE_CASE_REFERENTS_PROBE_SQL.includes("('use_case_notifications', 'unknowns')"));
  assert.ok(USE_CASE_REFERENTS_PROBE_SQL.includes("('use_case_requester_email_items', 'unknowns')"));
  assert.ok(USE_CASE_REFERENTS_PROBE_SQL.includes("('use_case_requester_emails', 'due_at')"));
  assert.ok(USE_CASE_REFERENTS_PROBE_SQL.includes("'''sostituita'''"), "il CHECK delle revoche con sostituita");
  assert.ok(USE_CASE_REFERENTS_PROBE_SQL.includes(eventFieldsProbeSql(USE_CASE_EVENT_FIELDS_0024)));
});

test("ensure-schema: versione 18, la 0024 dopo la 0023, con timeout e lock, e la sonda in AND", () => {
  assert.match(ensureSchema, /const ENSURE_VERSION = 18;/);
  assert.match(ensureSchema, /import \{ USE_CASE_REFERENTS_DDL, USE_CASE_REFERENTS_PROBE_SQL \} from "\.\/use-case-hub-referents-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const history = runOnce.indexOf("await runUseCaseHistoryDdl();");
  const referents = runOnce.indexOf("await runUseCaseReferentsDdl();");
  assert.ok(history > 0 && referents > history, "0023 poi 0024");
  assert.match(ensureSchema, /AND \$\{sql\.raw\(USE_CASE_HISTORY_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(USE_CASE_REFERENTS_PROBE_SQL\)\}/);
  const run = topLevelFunction(ensureSchema, "export async function runUseCaseReferentsDdl(");
  const timeout = run.indexOf(`client.query("SELECT set_config('lock_timeout', '3s', true)")`);
  const lock = run.indexOf(`client.query("SELECT pg_advisory_xact_lock(hashtext('${REFERENTS_ADVISORY_LOCK}'))")`);
  const statements = run.indexOf("...statements.map(");
  assert.ok(timeout > 0 && lock > timeout && statements > lock);
  assert.match(run, /client\.transaction\(/);
});

const DRIZZLE_TABLES: Record<(typeof REFERENTS_TABLES)[number], PgTable> = {
  use_case_referent_requests: schema.useCaseReferentRequests,
  use_case_referent_request_items: schema.useCaseReferentRequestItems,
  use_case_referent_tokens: schema.useCaseReferentTokens,
  use_case_need_answers: schema.useCaseNeedAnswers,
  use_case_need_files: schema.useCaseNeedFiles,
  use_case_referent_emails: schema.useCaseReferentEmails,
  use_case_referent_email_items: schema.useCaseReferentEmailItems,
  weekly_signal_reads: schema.weeklySignalReads,
  workspace_bell_state: schema.workspaceBellState,
  use_case_notifications: schema.useCaseNotifications,
  use_case_info_state: schema.useCaseInfoState,
  use_case_requester_emails: schema.useCaseRequesterEmails,
  use_case_requester_email_items: schema.useCaseRequesterEmailItems,
};

test("schema.ts: le colonne Drizzle sono le colonne del DDL, nello stesso ordine", () => {
  for (const name of REFERENTS_TABLES) {
    const table = DRIZZLE_TABLES[name];
    assert.equal(getTableName(table), name);
    const columns = Object.values(getTableColumns(table)).map((column) => column.name);
    assert.deepEqual(columns, ddlColumns(name), name);
  }
  // Le colonne aggiunte dalla Parte 2.
  assert.ok(ddlColumns("use_case_notifications").includes("unknowns"));
  assert.ok(ddlColumns("use_case_requester_email_items").includes("unknowns"));
  assert.ok(ddlColumns("use_case_requester_emails").includes("due_at"));
});

test("vercel.json: il cron dei referenti nei giorni feriali e niente anteprime del ramo", () => {
  const cron = vercel.crons.find((c) => c.path === "/api/cron/use-case-referents");
  assert.ok(cron);
  assert.equal(cron.schedule, "0 9 * * 1-5");
  assert.equal(vercel.git.deploymentEnabled["feat/chiedi-al-referente"], false);
});
