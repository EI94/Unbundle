import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  MISSING_GITHUB_FOR_PROPOSALS_MESSAGE,
  PROPOSAL_NOTICE_KINDS,
  PROPOSAL_SOURCES,
  PROPOSAL_STATUSES,
  PROPOSALS_ADVISORY_LOCK,
  PROPOSALS_DDL,
  PROPOSALS_INDEXES,
  PROPOSALS_NAMED_CONSTRAINTS,
  PROPOSALS_PROBE_SQL,
  PROPOSALS_ROLLBACK_SWEEP_SQL,
  PROPOSALS_TABLES,
  USE_CASE_NOTIFICATION_KINDS_0034,
} from "./use-case-hub-proposals-ddl.ts";
import { ALERTS_ADVISORY_LOCK } from "./use-case-hub-alerts-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0033 } from "./use-case-hub-github-ddl.ts";
import * as schema from "./schema.ts";

// Migrazione 0034 e self-heal: le proposte di compito (rilascio 8.1b). Le prove sul database stanno in
// src/lib/use-cases/factory/github-webhook.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0034_proposte.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");

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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-proposals-ddl'));"];
const table = PROPOSALS_DDL.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS use_case_task_proposals ("))!;

const ddlColumns = (statement: string) =>
  statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|timestamptz|integer|boolean|jsonb)\b/)?.[1])
    .filter((n): n is string => Boolean(n));

function checkList(statement: string, constraint: string): string[] {
  const at = statement.indexOf(`CONSTRAINT ${constraint} CHECK`);
  assert.notEqual(at, -1, `manca ${constraint}`);
  const list = statement.slice(at).match(/IN \(([^)]*)\)/)?.[1] ?? "";
  return [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

test("0034: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))));
  assert.equal(PROPOSALS_ADVISORY_LOCK, "unbundle:use-case-proposals-ddl");
  let cursor = 0;
  for (const statement of PROPOSALS_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...PROPOSALS_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0034_proposte\.sql/);
});

test("controllo iniziale: senza la 0033 si ferma; solo aggiunte; il solo DROP è il CHECK della campanella", () => {
  assert.match(PROPOSALS_DDL[0], /IF to_regclass\('public\.use_case_pull_requests'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(PROPOSALS_DDL[0].includes(`'${MISSING_GITHUB_FOR_PROPOSALS_MESSAGE}'`));
  const widen = PROPOSALS_DDL[PROPOSALS_DDL.length - 1];
  for (const statement of PROPOSALS_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|ALTER\s+COLUMN|ADD\s+COLUMN|\bRENAME\b|DROP\s+(TABLE|COLUMN|INDEX)/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    assert.doesNotMatch(statement, /\buc_[a-z_]+/);
    if (statement !== widen) assert.doesNotMatch(statement, /DROP\s+CONSTRAINT/i);
  }
  assert.equal(PROPOSALS_DDL[PROPOSALS_DDL.length - 2], `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`);
});

test("i tipi della campanella: quelli della 0033 più compito_proposto, entro 16 caratteri", () => {
  assert.deepEqual(USE_CASE_NOTIFICATION_KINDS_0034, [...USE_CASE_NOTIFICATION_KINDS_0033, "compito_proposto"]);
  const widen = PROPOSALS_DDL[PROPOSALS_DDL.length - 1];
  for (const kind of USE_CASE_NOTIFICATION_KINDS_0034) {
    assert.ok(widen.includes(`'${kind}'`), kind);
    assert.ok(kind.length <= 16, kind);
  }
  assert.deepEqual(PROPOSALS_ROLLBACK_SWEEP_SQL, [`DELETE FROM use_case_notifications WHERE kind IN (${PROPOSAL_NOTICE_KINDS.map((k) => `'${k}'`).join(", ")});`]);
});

test("le regole nel database: vocabolari, una proposta per origine, decisa solo con la data, mai una persona", () => {
  assert.deepEqual(checkList(table, "use_case_task_proposals_source_check"), [...PROPOSAL_SOURCES]);
  assert.deepEqual(checkList(table, "use_case_task_proposals_status_check"), [...PROPOSAL_STATUSES]);
  assert.match(table, /CONSTRAINT use_case_task_proposals_unique UNIQUE \(use_case_id, external_key\)/);
  assert.match(table, /CONSTRAINT use_case_task_proposals_decided_check CHECK \(\(status = 'proposta'\) = \(decided_at IS NULL\)\)/);
  assert.match(table, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(table, /use_case_id uuid NOT NULL REFERENCES use_cases\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(table, /\b(proposed_by|submitted_by|decided_by|author|actor|user_id|login)\w*/, "art. 15.4");
  assert.deepEqual(PROPOSALS_DDL.filter((s) => /^CREATE (UNIQUE )?INDEX/.test(s) && /user/.test(s)), []);
});

test("la sonda copre la tabella, gli indici, ogni vincolo con nome e il tipo nuovo", () => {
  for (const name of [...PROPOSALS_TABLES, ...PROPOSALS_INDEXES]) assert.ok(PROPOSALS_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
  const named = [...PROPOSALS_DDL.join("\n").matchAll(/CONSTRAINT ([a-z_]+) (CHECK|PRIMARY KEY|UNIQUE)/g)].map((m) => m[1]).filter((n) => n.startsWith("use_case_task_proposals"));
  assert.deepEqual([...named].sort(), [...PROPOSALS_NAMED_CONSTRAINTS].sort());
  assert.ok(PROPOSALS_PROBE_SQL.includes("position('''compito_proposto''' IN pg_get_constraintdef(c.oid)) > 0"));
});

test("ensure-schema: versione 28, la 0034 dopo la 0033, non fatale, con timeout e lock, e la sonda in AND", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 28, "ENSURE_VERSION almeno 28 (la 0035 la porta a 29)");
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const github = runOnce.indexOf("await runGithubDdlSafely();");
  const proposals = runOnce.indexOf("await runProposalsDdlSafely();");
  assert.ok(github > 0 && proposals > github);
  const safe = topLevelFunction(ensureSchema, "async function runProposalsDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runProposalsDdl\(\);\s+proposalsDdlFailedAt = null;\s+\} catch \(err\) \{\s+proposalsDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe));
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(ensure, /ensurePromise = ensurePromise\.then\(runProposalsDdlSafely\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(GITHUB_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(PROPOSALS_PROBE_SQL\)\}/);
  const runner = topLevelFunction(ensureSchema, "export async function runProposalsDdl(statements: readonly string[] = PROPOSALS_DDL): Promise<void> {");
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") < runner.indexOf(`pg_advisory_xact_lock(hashtext('${PROPOSALS_ADVISORY_LOCK}'))`));
});

test("le colonne Drizzle sono quelle del DDL, nello stesso ordine", () => {
  assert.equal(getTableName(schema.useCaseTaskProposals), "use_case_task_proposals");
  assert.deepEqual(Object.values(getTableColumns(schema.useCaseTaskProposals)).map((c) => c.name), ddlColumns(table));
});
