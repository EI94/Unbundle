import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CLI_DDL } from "./use-case-hub-cli-ddl.ts";
import { EVALS_DDL } from "./use-case-hub-evals-ddl.ts";
import {
  CI_EVAL_RUN_COLUMNS,
  CI_EVAL_RUN_CONSTRAINTS,
  CI_KEY_HASH_RE,
  CI_KEY_LIMITS,
  CI_KEY_PREFIX_RE,
  CI_KEY_REVOKED_REASONS,
  CI_KEYS_ADVISORY_LOCK,
  CI_KEYS_DDL,
  CI_KEYS_INDEXES,
  CI_KEYS_NAMED_CONSTRAINTS,
  CI_KEYS_PROBE_SQL,
  CI_KEYS_TABLE,
  CI_REPO_RE,
  CI_RUN_URL_RE,
  EVAL_RUN_SOURCES,
  MISSING_EVALS_FOR_CI_KEYS_MESSAGE,
} from "./use-case-hub-ci-keys-ddl.ts";

// Migrazione 0042 e self-heal: «Le evals dalla CI» (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.8): le chiavi
// della CI e la fonte delle evals. Le prove sul database stanno in src/lib/db/queries/use-case-ci-keys.integration.test.ts.
// ENSURE_VERSION 36.

const migration = readFileSync(new URL("../../../drizzle/0042_chiavi_ci.sql", import.meta.url), "utf8");
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-ci-keys-ddl'));"];
const keys = CI_KEYS_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${CI_KEYS_TABLE} (`)) ?? "";
const runConstraints = CI_KEYS_DDL.find((s) => s.startsWith("DO $$ BEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_constraint")) ?? "";

const ddlColumns = (statement: string) =>
  statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|char|timestamptz)\b/)?.[1])
    .filter((n): n is string => Boolean(n));

/** Il testo di un CHECK con nome, fino alla virgola della colonna o del vincolo. */
function check(statement: string, constraint: string): string {
  const at = statement.indexOf(`CONSTRAINT ${constraint} CHECK (`);
  assert.notEqual(at, -1, `manca ${constraint}`);
  return statement.slice(at).split("\n")[0].replace(/,$/, "");
}

test("0042: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "il file comincia con lock_timeout e l'advisory lock");
  assert.equal(CI_KEYS_ADVISORY_LOCK, "unbundle:use-case-ci-keys-ddl");
  let cursor = 0;
  for (const statement of CI_KEYS_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...CI_KEYS_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0042_chiavi_ci\.sql/);
  assert.match(migration, /dopo la 0041, ENSURE_VERSION 36/);
});

test("solo aggiunte: il controllo della 0036, poi tabella, indici, tre colonne e vincoli cercati per nome; niente di più stretto", () => {
  assert.match(CI_KEYS_DDL[0], /IF to_regclass\('public\.use_case_eval_runs'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(CI_KEYS_DDL[0].includes(`'${MISSING_EVALS_FOR_CI_KEYS_MESSAGE}'`));
  for (const statement of CI_KEYS_DDL) {
    assert.doesNotMatch(statement, /\bDROP\b|\bRENAME\b|\bTRUNCATE\b|\bINSERT\b|\bUPDATE\b|\bDELETE FROM\b|ALTER COLUMN|SET NOT NULL|\bTYPE\b|CREATE\s+EXTENSION|CREATE\s+(OR REPLACE\s+)?(FUNCTION|TRIGGER)/i);
  }
  const alters = CI_KEYS_DDL.filter((s) => s.startsWith("ALTER TABLE"));
  assert.deepEqual(alters, [
    "ALTER TABLE use_case_eval_runs ADD COLUMN IF NOT EXISTS source varchar(3) NOT NULL DEFAULT 'cli';",
    "ALTER TABLE use_case_eval_runs ADD COLUMN IF NOT EXISTS ci_key_id uuid;",
    "ALTER TABLE use_case_eval_runs ADD COLUMN IF NOT EXISTS ci_run_url varchar(300);",
  ]);
  // Ogni vincolo delle evals si aggiunge solo se il suo nome non c'è: la 0042 due volte non cambia niente.
  for (const c of CI_EVAL_RUN_CONSTRAINTS) {
    assert.ok(
      runConstraints.includes(
        `IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_eval_runs'::regclass AND conname = '${c.name}') THEN\n    ALTER TABLE use_case_eval_runs ADD CONSTRAINT ${c.name} ${c.definition};`,
      ),
      c.name,
    );
  }
  assert.equal((runConstraints.match(/ADD CONSTRAINT/g) ?? []).length, CI_EVAL_RUN_CONSTRAINTS.length);
  const indexes = CI_KEYS_DDL.map((s) => s.match(/^CREATE INDEX IF NOT EXISTS (\w+) ON/)?.[1]).filter(Boolean);
  assert.deepEqual(indexes, [...CI_KEYS_INDEXES]);
  const tables = CI_KEYS_DDL.map((s) => s.match(/^CREATE TABLE IF NOT EXISTS (\w+) \(/)?.[1]).filter(Boolean);
  assert.deepEqual(tables, [CI_KEYS_TABLE]);
  // Le chiavi vive di un repository, senza badare alle maiuscole: l'indice che serve al lock e alla rotazione.
  assert.ok(CI_KEYS_DDL.includes("CREATE INDEX IF NOT EXISTS use_case_ci_keys_repo_idx ON use_case_ci_keys (workspace_id, lower(repo)) WHERE revoked_at IS NULL;"));
  assert.ok(CI_KEYS_DDL.includes("CREATE INDEX IF NOT EXISTS use_case_eval_runs_ci_key_idx ON use_case_eval_runs (ci_key_id) WHERE ci_key_id IS NOT NULL;"));
});

test("la tabella delle chiavi: solo impronta e prefisso, chi e quando, la catena delle rotazioni; il workspace cancella tutto", () => {
  assert.deepEqual(ddlColumns(keys), [
    "id",
    "workspace_id",
    "repo",
    "use_case_id",
    "token_hash",
    "token_prefix",
    "replaces_key_id",
    "created_by_user_id",
    "created_at",
    "expires_at",
    "last_used_at",
    "reminded_at",
    "revoked_at",
    "revoked_reason",
    "revoked_by_user_id",
  ]);
  assert.ok(!/\b(token|secret|key|chiave)\s+(text|varchar)/i.test(keys), "mai una colonna con la chiave");
  assert.match(keys, /\n {2}workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE,/);
  assert.match(keys, /\n {2}use_case_id uuid REFERENCES use_cases\(id\) ON DELETE CASCADE,/);
  assert.match(keys, /\n {2}replaces_key_id uuid REFERENCES use_case_ci_keys\(id\) ON DELETE SET NULL,/);
  assert.match(keys, /\n {2}created_by_user_id uuid REFERENCES users\(id\) ON DELETE SET NULL,/);
  assert.match(keys, /\n {2}revoked_by_user_id uuid REFERENCES users\(id\) ON DELETE SET NULL,/);
  assert.match(keys, /CONSTRAINT use_case_ci_keys_hash_unique UNIQUE \(token_hash\)/);
  assert.equal(check(keys, "use_case_ci_keys_revoked_check"), "CONSTRAINT use_case_ci_keys_revoked_check CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))");
  assert.equal(check(keys, "use_case_ci_keys_expiry_check"), "CONSTRAINT use_case_ci_keys_expiry_check CHECK (expires_at > created_at)");
  assert.equal(
    check(keys, "use_case_ci_keys_reason_check"),
    `CONSTRAINT use_case_ci_keys_reason_check CHECK (revoked_reason IS NULL OR revoked_reason IN (${CI_KEY_REVOKED_REASONS.map((r) => `'${r}'`).join(", ")}))`,
  );
  assert.deepEqual([...CI_KEY_REVOKED_REASONS], ["a_mano", "ruotata", "esposta", "senza_casi"]);
  for (const reason of CI_KEY_REVOKED_REASONS) assert.ok(reason.length <= CI_KEY_LIMITS.reason, reason);
});

test("il repository con la regola di use_case_repos; impronta, prefisso e indirizzo dell'esecuzione con le regole del codice", () => {
  const repos = CLI_DDL.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS use_case_repos (")) ?? "";
  const theirs = repos.match(/CONSTRAINT use_case_repos_repo_check CHECK \(repo ~ '([^']+)'\)/)?.[1];
  assert.ok(theirs, "la regola di use_case_repos");
  assert.ok(keys.includes(`CONSTRAINT use_case_ci_keys_repo_check CHECK (repo ~ '${theirs}')`), "la stessa regola");
  assert.match(repos, /repo varchar\(140\) NOT NULL/);
  assert.match(keys, /repo varchar\(140\) NOT NULL/);
  assert.ok(CI_REPO_RE.test("Voltaen/esempio-rosa") && !CI_REPO_RE.test("esempio-rosa") && !CI_REPO_RE.test("Voltaen/esempio rosa"));
  assert.ok(CI_KEY_HASH_RE.test("a".repeat(64)) && !CI_KEY_HASH_RE.test("A".repeat(64)) && !CI_KEY_HASH_RE.test("a".repeat(63)));
  assert.ok(CI_KEY_PREFIX_RE.test("ub_ci_ab12") && !CI_KEY_PREFIX_RE.test("ub_cli_ab1") && !CI_KEY_PREFIX_RE.test(`ub_ci_${"a".repeat(43)}`));
  const url = "https://github.com/Voltaen/esempio-rosa/actions/runs/12345678901";
  assert.ok(CI_RUN_URL_RE.test(url));
  for (const bad of [
    `${url}/attempts/2`,
    `${url}?x=1`,
    "http://github.com/Voltaen/esempio-rosa/actions/runs/1",
    "https://github.com.evil.test/Voltaen/esempio-rosa/actions/runs/1",
    "https://githubxcom/Voltaen/esempio-rosa/actions/runs/1",
    "https://github.com/Voltaen/esempio-rosa/pull/1",
    "https://github.com/Voltaen/actions/runs/1",
  ]) {
    assert.ok(!CI_RUN_URL_RE.test(bad), bad);
  }
  assert.ok(runConstraints.includes(`ci_run_url ~ '^https://github[.]com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}/actions/runs/[0-9]{1,20}$'`));
});

test("la fonte delle evals: «cli» per le righe di oggi e per il codice di prima; chiave e indirizzo solo per la CI", () => {
  assert.deepEqual([...EVAL_RUN_SOURCES], ["cli", "ci"]);
  assert.ok(EVAL_RUN_SOURCES.every((s) => s.length <= CI_KEY_LIMITS.source));
  const byName = new Map(CI_EVAL_RUN_CONSTRAINTS.map((c) => [c.name, c.definition]));
  assert.equal(byName.get("use_case_eval_runs_source_check"), "CHECK (source IN ('cli', 'ci'))");
  assert.equal(byName.get("use_case_eval_runs_ci_key_fkey"), "FOREIGN KEY (ci_key_id) REFERENCES use_case_ci_keys (id) ON DELETE SET NULL");
  assert.equal(byName.get("use_case_eval_runs_ci_check"), "CHECK (source = 'ci' OR (ci_key_id IS NULL AND ci_run_url IS NULL))");
  // La tabella della 0036 non cambia: le colonne nuove arrivano solo con la 0042.
  const runs = EVALS_DDL.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS use_case_eval_runs (")) ?? "";
  for (const column of CI_EVAL_RUN_COLUMNS) assert.ok(!runs.includes(`\n  ${column} `), column);
});

test("la sonda: la tabella, gli indici, le tre colonne delle evals e ogni vincolo con nome, nessun altro", () => {
  const named = [...keys.matchAll(/CONSTRAINT (\w+) /g)].map((m) => m[1]);
  assert.deepEqual([...named, ...CI_EVAL_RUN_CONSTRAINTS.map((c) => c.name)].sort(), [...CI_KEYS_NAMED_CONSTRAINTS].sort());
  assert.equal(new Set(CI_KEYS_NAMED_CONSTRAINTS).size, CI_KEYS_NAMED_CONSTRAINTS.length);
  assert.ok(CI_KEYS_PROBE_SQL.includes(`to_regclass('public.${CI_KEYS_TABLE}') IS NOT NULL`));
  for (const name of CI_KEYS_INDEXES) assert.ok(CI_KEYS_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
  for (const column of CI_EVAL_RUN_COLUMNS) assert.ok(CI_KEYS_PROBE_SQL.includes(`'${column}'`), column);
  assert.ok(CI_KEYS_PROBE_SQL.includes(`) = ${CI_EVAL_RUN_COLUMNS.length}`));
  for (const name of CI_KEYS_NAMED_CONSTRAINTS) assert.ok(CI_KEYS_PROBE_SQL.includes(`'${name}'`), name);
  assert.ok(CI_KEYS_PROBE_SQL.includes(`) = ${CI_KEYS_NAMED_CONSTRAINTS.length}`));
});

test("ensure-schema: versione 36, la 0042 dopo la 0041, saltata in anteprima, non fatale, con il suo lock, il nuovo tentativo e la sonda in AND", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 36, "ENSURE_VERSION almeno 36");
  assert.match(ensureSchema, /import \{ CI_KEYS_ADVISORY_LOCK, CI_KEYS_DDL, CI_KEYS_PROBE_SQL \} from "\.\/use-case-hub-ci-keys-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const work = runOnce.indexOf("await runContextWorkDdlSafely();");
  const evals = runOnce.indexOf("await runEvalsDdlSafely();");
  const ours = runOnce.indexOf("await runCiKeysDdlSafely();");
  assert.ok(evals > 0 && work > evals && ours > work, "la 0042 dopo la 0036 e dopo la 0041");
  assert.ok(!runOnce.includes("await runCiKeysDdl();"), "la 0042 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runCiKeysDdlSafely(): Promise<void> {");
  // Mai da un'anteprima di Vercel: le anteprime usano il database di produzione.
  assert.match(safe, /^async function runCiKeysDdlSafely\(\): Promise<void> \{\s+if \(process\.env\.VERCEL_ENV === "preview"\) return;/);
  assert.match(safe, /try \{\s+await runCiKeysDdl\(\);\s+ciKeysDdlFailedAt = null;\s+\} catch \(err\) \{\s+ciKeysDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  assert.match(safe, /0042 self-heal failed/);
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(
    ensure,
    /if \(ciKeysDdlFailedAt !== null && Date\.now\(\) - ciKeysDdlFailedAt >= REFERENTS_DDL_RETRY_MS\) \{\s+ciKeysDdlFailedAt = Date\.now\(\);\s+ensurePromise = ensurePromise\.then\(runCiKeysDdlSafely\);/,
  );
  const runner = topLevelFunction(ensureSchema, "export async function runCiKeysDdl(statements: readonly string[] = CI_KEYS_DDL): Promise<void> {");
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") > 0);
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") < runner.indexOf("pg_advisory_xact_lock(hashtext('${CI_KEYS_ADVISORY_LOCK}'))"));
  assert.match(ensureSchema, /AND \$\{sql\.raw\(CONTEXT_WORK_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(CI_KEYS_PROBE_SQL\)\}/);
});

test("use-case-admin doctor dice migrazione0042, solo da leggere", () => {
  assert.match(doctor, /import \{ CI_KEYS_PROBE_SQL \} from "\.\.\/\.\.\/src\/lib\/db\/use-case-hub-ci-keys-ddl\.ts";/);
  assert.match(doctor, /const m0042 = \(await ctx\.db\.read\(`SELECT \$\{CI_KEYS_PROBE_SQL\} AS ok`\)\)\[0\]\?\.ok === true;/);
  assert.match(doctor, /migrazione0042: m0042,/);
});
