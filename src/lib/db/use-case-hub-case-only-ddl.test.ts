import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  CASE_ONLY_ADVISORY_LOCK,
  CASE_ONLY_DDL,
  CASE_ONLY_ENUM_VALUE,
  CASE_ONLY_INDEXES,
  CASE_ONLY_INVITES_TABLE,
  CASE_ONLY_NAMED_CONSTRAINTS,
  CASE_ONLY_PROBE_SQL,
} from "./use-case-hub-case-only-ddl.ts";
import { CASE_ONLY_ROLE } from "../auth/case-only.ts";
import * as schema from "./schema.ts";

// Migrazione 0043 e self-heal: «Solo questo use case» (rilascio 8.0d-1 «Porte», docs/rilascio-8/RILASCIO-8.0d-ESTERNI-FASE-2.md
// §2.6, §4.1, §4.2): il valore `esterno_caso` in coda a `member_role` e il caso degli inviti. Le prove sul database stanno
// in src/lib/use-cases/factory/case-only.integration.test.ts (B12). ENSURE_VERSION 37.

const migration = readFileSync(new URL("../../../drizzle/0043_solo_questo_use_case.sql", import.meta.url), "utf8");
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:case-only-ddl'));"];
const table = CASE_ONLY_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${CASE_ONLY_INVITES_TABLE} (`)) ?? "";
const ddlColumns = (statement: string) =>
  statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|timestamptz)\b/)?.[1])
    .filter((n): n is string => Boolean(n));

test("0043: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "il file comincia con lock_timeout e l'advisory lock");
  assert.equal(CASE_ONLY_ADVISORY_LOCK, "unbundle:case-only-ddl");
  let cursor = 0;
  for (const statement of CASE_ONLY_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...CASE_ONLY_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0043_solo_questo_use_case\.sql/);
  assert.match(migration, /dopo la 0042, ENSURE_VERSION 37/);
  assert.match(migration, /mai drizzle-kit, mai db:push/);
  assert.match(migration, /NON SI TOGLIE PIÙ/);
});

test("il valore: `esterno_caso`, aggiunto solo se manca, mai tolto o rinominato", () => {
  assert.equal(CASE_ONLY_ENUM_VALUE, CASE_ONLY_ROLE);
  assert.equal(CASE_ONLY_DDL[0], "ALTER TYPE member_role ADD VALUE IF NOT EXISTS 'esterno_caso';");
  // Senza BEFORE/AFTER: il valore va in coda, come `learner` (0013).
  assert.doesNotMatch(CASE_ONLY_DDL[0], /\b(BEFORE|AFTER)\b/);
  for (const statement of CASE_ONLY_DDL) {
    assert.doesNotMatch(statement, /\bDROP\b|\bRENAME\b|CREATE\s+EXTENSION/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i, "nessun dato scritto");
    assert.doesNotMatch(statement, /\buc_[a-z_]+/, "il DDL uc (0018) non cambia");
    assert.doesNotMatch(statement, /use_case_external_builders/, "la 0037 non cambia");
    assert.doesNotMatch(statement, /\bCHECK\b/, "nessun CHECK toccato");
    // Il valore nuovo non si usa nella stessa transazione che lo aggiunge.
    if (statement !== CASE_ONLY_DDL[0]) assert.doesNotMatch(statement, /esterno_caso/);
  }
  assert.equal(CASE_ONLY_DDL.filter((s) => /^ALTER\b/.test(s)).length, 1, "un solo ALTER: il valore dell'enum");
});

test("use_case_builder_invites: un invito, un caso; si cancella con l'invito, con il workspace e con lo use case", () => {
  assert.match(table, /invitation_id uuid NOT NULL REFERENCES workspace_invitations\(id\) ON DELETE CASCADE/);
  assert.match(table, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(table, /use_case_id uuid NOT NULL REFERENCES use_cases\(id\) ON DELETE CASCADE/);
  assert.match(table, /created_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(table, /CONSTRAINT use_case_builder_invites_pkey PRIMARY KEY \(invitation_id\)/);
  assert.deepEqual(ddlColumns(table), ["invitation_id", "workspace_id", "use_case_id", "created_at"]);
  assert.equal(CASE_ONLY_DDL[2], "CREATE INDEX IF NOT EXISTS use_case_builder_invites_use_case_idx ON use_case_builder_invites (use_case_id);");
});

test("la sonda: il valore in pg_enum per member_role, la tabella, la chiave e l'indice", () => {
  assert.match(CASE_ONLY_PROBE_SQL, /FROM pg_enum e JOIN pg_type t ON t\.oid = e\.enumtypid/);
  assert.match(CASE_ONLY_PROBE_SQL, /t\.typname = 'member_role' AND e\.enumlabel = 'esterno_caso'/);
  assert.match(CASE_ONLY_PROBE_SQL, /ns\.nspname = 'public'/);
  assert.ok(CASE_ONLY_PROBE_SQL.includes(`to_regclass('public.${CASE_ONLY_INVITES_TABLE}') IS NOT NULL`));
  for (const index of CASE_ONLY_INDEXES) {
    assert.ok(CASE_ONLY_PROBE_SQL.includes(`to_regclass('public.${index}') IS NOT NULL`), index);
    assert.ok(CASE_ONLY_DDL.some((s) => s.includes(`CREATE INDEX IF NOT EXISTS ${index}`)), index);
  }
  for (const name of CASE_ONLY_NAMED_CONSTRAINTS) {
    assert.ok(table.includes(`CONSTRAINT ${name} `) && CASE_ONLY_PROBE_SQL.includes(`'${name}'`), name);
  }
  assert.ok(CASE_ONLY_PROBE_SQL.includes(`) = ${CASE_ONLY_NAMED_CONSTRAINTS.length}`));
});

test("ensure-schema: versione 37, la 0043 dopo la 0042, saltata in anteprima, non fatale, con il suo lock, il nuovo tentativo e la sonda in AND", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 37, "ENSURE_VERSION almeno 37");
  assert.match(ensureSchema, /import \{ CASE_ONLY_ADVISORY_LOCK, CASE_ONLY_DDL, CASE_ONLY_PROBE_SQL \} from "\.\/use-case-hub-case-only-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const builders = runOnce.indexOf("await runExternalBuildersDdlSafely();");
  const ciKeys = runOnce.indexOf("await runCiKeysDdlSafely();");
  const ours = runOnce.indexOf("await runCaseOnlyDdlSafely();");
  assert.ok(builders > 0 && ciKeys > builders && ours > ciKeys, "la 0043 dopo la 0037 e dopo la 0042");
  assert.ok(!runOnce.includes("await runCaseOnlyDdl();"), "la 0043 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runCaseOnlyDdlSafely(): Promise<void> {");
  // Mai da un'anteprima di Vercel: le anteprime usano il database di produzione, e il valore non si toglie più.
  assert.match(safe, /^async function runCaseOnlyDdlSafely\(\): Promise<void> \{\s+if \(process\.env\.VERCEL_ENV === "preview"\) return;/);
  assert.match(safe, /try \{\s+await runCaseOnlyDdl\(\);\s+caseOnlyDdlFailedAt = null;\s+\} catch \(err\) \{\s+caseOnlyDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  assert.match(safe, /0043 self-heal failed/);
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(
    ensure,
    /if \(caseOnlyDdlFailedAt !== null && Date\.now\(\) - caseOnlyDdlFailedAt >= REFERENTS_DDL_RETRY_MS\) \{\s+caseOnlyDdlFailedAt = Date\.now\(\);\s+ensurePromise = ensurePromise\.then\(runCaseOnlyDdlSafely\);/,
  );
  const runner = topLevelFunction(ensureSchema, "export async function runCaseOnlyDdl(statements: readonly string[] = CASE_ONLY_DDL): Promise<void> {");
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") > 0);
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") < runner.indexOf("pg_advisory_xact_lock(hashtext('${CASE_ONLY_ADVISORY_LOCK}'))"));
  assert.match(ensureSchema, /AND \$\{sql\.raw\(CI_KEYS_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(CASE_ONLY_PROBE_SQL\)\}/);
});

test("Drizzle: `esterno_caso` in coda a memberRoleEnum, dopo `learner` (l'ordine combacia con le ALTER TYPE), e la tabella come il DDL", () => {
  const values = schema.memberRoleEnum.enumValues;
  assert.deepEqual([...values], ["exec_sponsor", "transformation_lead", "function_lead", "contributor", "analyst", "learner", "esterno_caso"]);
  assert.equal(getTableName(schema.useCaseBuilderInvites), CASE_ONLY_INVITES_TABLE);
  assert.deepEqual(Object.values(getTableColumns(schema.useCaseBuilderInvites)).map((c) => c.name), ddlColumns(table));
});

test("use-case-admin doctor dice migrazione0043, solo da leggere", () => {
  assert.match(doctor, /import \{ CASE_ONLY_PROBE_SQL \} from "\.\.\/\.\.\/src\/lib\/db\/use-case-hub-case-only-ddl\.ts";/);
  assert.match(doctor, /const m0043 = \(await ctx\.db\.read\(`SELECT \$\{CASE_ONLY_PROBE_SQL\} AS ok`\)\)\[0\]\?\.ok === true;/);
  assert.match(doctor, /migrazione0043: m0043,/);
});

test("RUNBOOK §10.25: la 0043 la applica l'app, il valore non si toglie, mai da un'anteprima, a mano solo di riserva, il ritorno indietro", () => {
  const runbook = readFileSync(new URL("../../../docs/casi-duso/RUNBOOK.md", import.meta.url), "utf8");
  const heading = "### 10.25 Rilascio 8.0d-1: «Porte» (0043)";
  assert.ok(runbook.includes(heading), "manca §10.25");
  const section = runbook.slice(runbook.indexOf(heading));
  assert.match(section, /`ENSURE_VERSION` 37/);
  assert.match(section, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0043_solo_questo_use_case\.sql/);
  assert.match(section, /Mai drizzle-kit, mai `db:push`/);
  assert.match(section, /`migrazione0043: true`/);
  assert.match(section, /non parte da un'anteprima \(`VERCEL_ENV=preview`\)/);
  assert.match(section, /\*\*Il valore non si toglie più\.\*\*/);
  assert.match(section, /\*\*Mai più indietro della 8\.0d-1 con persone «Solo questo use case» dentro\*\*/);
});
