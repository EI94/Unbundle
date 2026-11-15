import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  EXTERNAL_BUILDERS_ADVISORY_LOCK,
  EXTERNAL_BUILDERS_DDL,
  EXTERNAL_BUILDERS_NAMED_CONSTRAINTS,
  EXTERNAL_BUILDERS_PROBE_SQL,
  EXTERNAL_BUILDERS_UNIQUE_INDEXES,
} from "./use-case-hub-builders-ddl.ts";
import * as schema from "./schema.ts";

// Migrazione 0037 e self-heal: le concessioni di «Chi costruisce» a chi viene da fuori (rilascio 8.0c). Le prove sul
// database stanno in src/lib/use-cases/factory/external-builders.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0037_costruttori_esterni.sql", import.meta.url), "utf8");
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-external-builders-ddl'));"];
const table = EXTERNAL_BUILDERS_DDL[0];
const ddlColumns = (statement: string) =>
  statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|timestamptz)\b/)?.[1])
    .filter((n): n is string => Boolean(n));

test("0037: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))));
  assert.equal(EXTERNAL_BUILDERS_ADVISORY_LOCK, "unbundle:use-case-external-builders-ddl");
  let cursor = 0;
  for (const statement of EXTERNAL_BUILDERS_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...EXTERNAL_BUILDERS_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0037_costruttori_esterni\.sql/);
  assert.match(migration, /ENSURE_VERSION 31/);
});

test("solo aggiunte: niente ALTER, DROP, dati scritti; il DDL uc e il team di Lateral Space non cambiano", () => {
  for (const statement of EXTERNAL_BUILDERS_DDL) {
    assert.doesNotMatch(statement, /\bALTER\b|\bDROP\b|\bRENAME\b|CREATE\s+EXTENSION/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    assert.doesNotMatch(statement, /\buc_[a-z_]+/, "il DDL uc non cambia");
    assert.doesNotMatch(statement, /use_case_workspace_team/, "il team di Lateral Space (0035) non cambia");
    assert.doesNotMatch(statement, /\bCHECK\b/, "nessun CHECK: i ruoli della fabbrica vivono solo nel codice");
  }
});

test("una riga «tutti» o una per caso; si cancella con il workspace, con la persona e con lo use case", () => {
  assert.match(table, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(table, /user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  assert.match(table, /use_case_id uuid REFERENCES use_cases\(id\) ON DELETE CASCADE,/, "NULL: tutti i casi, anche i nuovi");
  assert.match(table, /added_by_user_id uuid REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.deepEqual(ddlColumns(table), ["id", "workspace_id", "user_id", "use_case_id", "added_by_user_id", "created_at"]);
  assert.match(EXTERNAL_BUILDERS_DDL[1], /UNIQUE INDEX IF NOT EXISTS use_case_external_builders_all_unique\s+ON use_case_external_builders \(workspace_id, user_id\) WHERE use_case_id IS NULL;/);
  assert.match(EXTERNAL_BUILDERS_DDL[2], /UNIQUE INDEX IF NOT EXISTS use_case_external_builders_case_unique\s+ON use_case_external_builders \(workspace_id, user_id, use_case_id\) WHERE use_case_id IS NOT NULL;/);
  assert.match(EXTERNAL_BUILDERS_DDL[3], /INDEX IF NOT EXISTS use_case_external_builders_user_idx ON use_case_external_builders \(user_id\)/);
});

test("la sonda: la tabella, la chiave e i due indici unici", () => {
  assert.ok(EXTERNAL_BUILDERS_PROBE_SQL.includes("to_regclass('public.use_case_external_builders') IS NOT NULL"));
  for (const index of EXTERNAL_BUILDERS_UNIQUE_INDEXES) {
    assert.ok(EXTERNAL_BUILDERS_PROBE_SQL.includes(`to_regclass('public.${index}') IS NOT NULL`), index);
    assert.ok(EXTERNAL_BUILDERS_DDL.some((s) => s.includes(`CREATE UNIQUE INDEX IF NOT EXISTS ${index}`)), index);
  }
  for (const name of EXTERNAL_BUILDERS_NAMED_CONSTRAINTS) {
    assert.ok(table.includes(`CONSTRAINT ${name} `) && EXTERNAL_BUILDERS_PROBE_SQL.includes(`'${name}'`), name);
  }
  assert.ok(EXTERNAL_BUILDERS_PROBE_SQL.includes(`) = ${EXTERNAL_BUILDERS_NAMED_CONSTRAINTS.length}`));
});

test("ensure-schema: versione 31, la 0037 dopo la 0036, non fatale, con timeout e lock, la sonda in AND e il nuovo tentativo", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 31, "ENSURE_VERSION almeno 31");
  assert.match(ensureSchema, /import \{ EXTERNAL_BUILDERS_DDL, EXTERNAL_BUILDERS_PROBE_SQL \} from "\.\/use-case-hub-builders-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const evals = runOnce.indexOf("await runEvalsDdlSafely();");
  const builders = runOnce.indexOf("await runExternalBuildersDdlSafely();");
  assert.ok(evals > 0 && builders > evals, "0036 poi 0037");
  assert.ok(!runOnce.includes("await runExternalBuildersDdl();"), "la 0037 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runExternalBuildersDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runExternalBuildersDdl\(\);\s+externalBuildersDdlFailedAt = null;\s+\} catch \(err\) \{\s+externalBuildersDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe));
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(
    ensure,
    /if \(externalBuildersDdlFailedAt !== null && Date\.now\(\) - externalBuildersDdlFailedAt >= REFERENTS_DDL_RETRY_MS\) \{\s+externalBuildersDdlFailedAt = Date\.now\(\);\s+ensurePromise = ensurePromise\.then\(runExternalBuildersDdlSafely\);/,
  );
  assert.match(ensureSchema, /AND \$\{sql\.raw\(EVALS_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(EXTERNAL_BUILDERS_PROBE_SQL\)\}/);
  const runner = topLevelFunction(ensureSchema, "export async function runExternalBuildersDdl(statements: readonly string[] = EXTERNAL_BUILDERS_DDL): Promise<void> {");
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") > 0);
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") < runner.indexOf(`pg_advisory_xact_lock(hashtext('${EXTERNAL_BUILDERS_ADVISORY_LOCK}'))`));
});

test("le colonne Drizzle sono quelle del DDL, nello stesso ordine", () => {
  assert.equal(getTableName(schema.useCaseExternalBuilders), "use_case_external_builders");
  assert.deepEqual(Object.values(getTableColumns(schema.useCaseExternalBuilders)).map((c) => c.name), ddlColumns(table));
});
