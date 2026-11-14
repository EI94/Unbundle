import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  EVAL_BRANCH_RE,
  EVAL_COMMIT_RE,
  EVAL_GROUP_RE,
  EVAL_LIMITS,
  EVAL_NOTICE_KINDS,
  EVAL_RUN_KINDS,
  EVAL_VERSION_RE,
  EVALS_ADVISORY_LOCK,
  EVALS_DDL,
  EVALS_INDEXES,
  EVALS_NAMED_CONSTRAINTS,
  EVALS_PROBE_SQL,
  EVALS_ROLLBACK_SWEEP_SQL,
  EVALS_TABLES,
  MISSING_TEAM_FOR_EVALS_MESSAGE,
  USE_CASE_NOTIFICATION_KINDS_0036,
  sqlPattern,
} from "./use-case-hub-evals-ddl.ts";
import { ALERTS_ADVISORY_LOCK } from "./use-case-hub-alerts-ddl.ts";
import { CLI_DDL, CLI_LIMITS } from "./use-case-hub-cli-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0034 } from "./use-case-hub-proposals-ddl.ts";
import { TASKS_DDL } from "./use-case-hub-tasks-ddl.ts";
import { BENCH_MAX_RESULTS, LEVEL_RE, MODEL_ID_RE, ROLE_RE } from "../use-cases/factory/benchmark.ts";
import * as schema from "./schema.ts";

// Migrazione 0036 e self-heal: il banco di prova e le evals (rilascio 8.2a). Le prove sul database stanno in
// src/lib/use-cases/factory/evals.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0036_evals.sql", import.meta.url), "utf8");
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-evals-ddl'));"];
const runs = EVALS_DDL.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS use_case_eval_runs ("))!;
const results = EVALS_DDL.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS use_case_eval_results ("))!;

const ddlColumns = (statement: string) =>
  statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|timestamptz|integer|boolean|jsonb|double precision|numeric)\b/)?.[1])
    .filter((n): n is string => Boolean(n));

/** Il testo di un CHECK con nome, fino alla virgola della colonna o del vincolo. */
function check(statement: string, constraint: string): string {
  const at = statement.indexOf(`CONSTRAINT ${constraint} CHECK (`);
  assert.notEqual(at, -1, `manca ${constraint}`);
  const line = statement.slice(at).split("\n")[0];
  return line.replace(/,$/, "");
}

/** Le regole `~ '…'` di un CHECK. */
const patternsOf = (text: string) => [...text.matchAll(/~ '([^']*)'/g)].map((m) => m[1]);

test("0036: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))));
  assert.equal(EVALS_ADVISORY_LOCK, "unbundle:use-case-evals-ddl");
  let cursor = 0;
  for (const statement of EVALS_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...EVALS_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0036_evals\.sql/);
  assert.match(migration, /ENSURE_VERSION 30/);
});

test("controllo iniziale: senza la 0035 si ferma; solo aggiunte; il solo DROP è il CHECK della campanella", () => {
  assert.match(EVALS_DDL[0], /IF to_regclass\('public\.use_case_workspace_team'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(EVALS_DDL[0].includes(`'${MISSING_TEAM_FOR_EVALS_MESSAGE}'`));
  const widen = EVALS_DDL[EVALS_DDL.length - 1];
  for (const statement of EVALS_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|ALTER\s+COLUMN|ADD\s+COLUMN|\bRENAME\b|DROP\s+(TABLE|COLUMN|INDEX)/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    assert.doesNotMatch(statement, /\buc_[a-z_]+/, "il DDL uc non cambia");
    if (statement !== widen) assert.doesNotMatch(statement, /DROP\s+CONSTRAINT/i);
  }
  assert.equal(EVALS_DDL[EVALS_DDL.length - 2], `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`);
});

test("i tipi della campanella: quelli della 0034 più banco_consiglio ed evals_in_calo, entro 16 caratteri", () => {
  assert.deepEqual([...EVAL_NOTICE_KINDS], ["banco_consiglio", "evals_in_calo"]);
  assert.deepEqual(USE_CASE_NOTIFICATION_KINDS_0036, [...USE_CASE_NOTIFICATION_KINDS_0034, "banco_consiglio", "evals_in_calo"]);
  const widen = EVALS_DDL[EVALS_DDL.length - 1];
  for (const kind of USE_CASE_NOTIFICATION_KINDS_0036) {
    assert.ok(widen.includes(`'${kind}'`), kind);
    assert.ok(kind.length <= 16, kind);
  }
  assert.deepEqual(EVALS_ROLLBACK_SWEEP_SQL, ["DELETE FROM use_case_notifications WHERE kind IN ('banco_consiglio', 'evals_in_calo');"]);
});

test("le regole dei campi sono quelle del modulo del banco, della 0031 (il modello) e della 0032 (la versione)", () => {
  assert.deepEqual([...EVAL_RUN_KINDS], ["banco", "evals"]);
  assert.match(check(runs, "use_case_eval_runs_kind_check"), /CHECK \(kind IN \('banco', 'evals'\)\)$/);
  assert.deepEqual(patternsOf(check(runs, "use_case_eval_runs_role_check")), [sqlPattern(ROLE_RE)]);
  assert.deepEqual(patternsOf(check(runs, "use_case_eval_runs_level_check")), [sqlPattern(LEVEL_RE)]);
  assert.deepEqual(patternsOf(check(runs, "use_case_eval_runs_branch_check")), [sqlPattern(EVAL_BRANCH_RE)]);
  assert.deepEqual(patternsOf(check(runs, "use_case_eval_runs_commit_check")), [sqlPattern(EVAL_COMMIT_RE)]);
  assert.deepEqual(patternsOf(check(runs, "use_case_eval_runs_version_check")), [sqlPattern(EVAL_VERSION_RE)]);
  assert.deepEqual(patternsOf(check(results, "use_case_eval_results_model_check")), [sqlPattern(MODEL_ID_RE)]);
  // Il modello come `use_case_build_sessions.model` (0031), la versione come `use_case_factory_repos` (0032).
  const sessions = CLI_DDL.find((s) => s.includes("CREATE TABLE IF NOT EXISTS use_case_build_sessions"))!;
  assert.deepEqual(patternsOf(check(sessions, "use_case_build_sessions_model_check")), [sqlPattern(MODEL_ID_RE)]);
  const repos = TASKS_DDL.find((s) => s.includes("CREATE TABLE IF NOT EXISTS use_case_factory_repos"))!;
  assert.deepEqual(patternsOf(check(repos, "use_case_factory_repos_template_check")), [sqlPattern(EVAL_VERSION_RE)]);
  assert.equal(EVAL_GROUP_RE, ROLE_RE);
  // Le stesse lunghezze delle colonne della 0031 e la stessa regola: la CLI, l'API e il database dicono lo stesso.
  assert.equal(EVAL_LIMITS.model, CLI_LIMITS.model);
  assert.equal(EVAL_LIMITS.branch, CLI_LIMITS.branch);
  assert.equal(EVAL_LIMITS.resultsMax, BENCH_MAX_RESULTS);
  assert.ok(runs.includes(`role varchar(${EVAL_LIMITS.role})`) && ROLE_RE.test("r".repeat(EVAL_LIMITS.role)) && !ROLE_RE.test("r".repeat(EVAL_LIMITS.role + 1)));
  assert.ok(runs.includes(`level varchar(${EVAL_LIMITS.level})`) && LEVEL_RE.test("l".repeat(EVAL_LIMITS.level)));
  assert.ok(results.includes(`model varchar(${EVAL_LIMITS.model})`) && MODEL_ID_RE.test("m".repeat(EVAL_LIMITS.model)) && !MODEL_ID_RE.test("m".repeat(EVAL_LIMITS.model + 1)));
  assert.ok(runs.includes(`branch varchar(${EVAL_LIMITS.branch})`) && EVAL_BRANCH_RE.test("b".repeat(EVAL_LIMITS.branch)) && !EVAL_BRANCH_RE.test("b".repeat(EVAL_LIMITS.branch + 1)));
  // Una regola con apici o con flag non diventa un CHECK.
  assert.throws(() => sqlPattern(/a'b/));
  assert.throws(() => sqlPattern(/ab/i));
  assert.equal(sqlPattern(/^[a\/b]$/), "^[a/b]$");
});

test("le regole nel database: il ruolo solo per il banco, la qualità da 0 a 1, superate entro le totali, un modello per esecuzione", () => {
  assert.match(runs, /CONSTRAINT use_case_eval_runs_role_kind_check CHECK \(\(kind = 'banco'\) = \(role IS NOT NULL\)\)/);
  assert.match(check(results, "use_case_eval_results_quality_check"), /CHECK \(quality >= 0 AND quality <= 1\)$/);
  assert.match(results, /CONSTRAINT use_case_eval_results_passed_check CHECK \(passed >= 0 AND passed <= total\)/);
  assert.match(check(results, "use_case_eval_results_total_check"), new RegExp(`CHECK \\(total BETWEEN 1 AND ${EVAL_LIMITS.casesMax}\\)$`));
  assert.match(results, /CONSTRAINT use_case_eval_results_unique UNIQUE \(run_id, model\)/);
  assert.match(results, /CONSTRAINT use_case_eval_results_latency_check CHECK \(latency_p50_ms IS NULL OR latency_p95_ms IS NULL OR latency_p50_ms <= latency_p95_ms\)/);
  assert.match(check(runs, "use_case_eval_runs_models_check"), /jsonb_typeof\(models\) = 'object'/);
  assert.match(check(results, "use_case_eval_results_groups_check"), /jsonb_typeof\(groups\) = 'object'/);
  for (const [name, max] of [
    ["use_case_eval_results_cost_check", EVAL_LIMITS.costPer1000UsdMax],
    ["use_case_eval_results_p50_check", EVAL_LIMITS.latencyMsMax],
    ["use_case_eval_results_p95_check", EVAL_LIMITS.latencyMsMax],
    ["use_case_eval_results_tokens_in_check", EVAL_LIMITS.tokensAvgMax],
    ["use_case_eval_results_tokens_out_check", EVAL_LIMITS.tokensAvgMax],
  ] as const) {
    assert.match(check(results, name), new RegExp(`IS NULL OR [a-z0-9_]+ BETWEEN 0 AND ${max}\\)$`), name);
  }
  assert.match(check(results, "use_case_eval_results_errors_check"), new RegExp(`CHECK \\(errors BETWEEN 0 AND ${EVAL_LIMITS.errorsMax}\\)$`));
  // Tutto si cancella con lo use case e con il workspace; un risultato con la sua esecuzione, sempre nel suo caso.
  for (const t of [runs, results]) {
    assert.match(t, /use_case_id uuid NOT NULL REFERENCES use_cases\(id\) ON DELETE CASCADE/);
    assert.match(t, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  }
  assert.match(runs, /CONSTRAINT use_case_eval_runs_scope_unique UNIQUE \(id, use_case_id, workspace_id\)/);
  assert.match(
    results,
    /CONSTRAINT use_case_eval_results_run_fkey FOREIGN KEY \(run_id, use_case_id, workspace_id\) REFERENCES use_case_eval_runs \(id, use_case_id, workspace_id\) ON DELETE CASCADE/,
  );
});

test("art. 15.4: nessuna colonna sulla persona, nessun indice sulla persona", () => {
  for (const t of [runs, results]) {
    assert.doesNotMatch(t, /\b\w*(_by|_by_user_id|author|actor|user_id|login|email|person|persona)\w*\b/i, "art. 15.4");
  }
  assert.deepEqual(EVALS_DDL.filter((s) => /^CREATE (UNIQUE )?INDEX/.test(s) && /user|author|actor/.test(s)), []);
});

test("la sonda copre le tabelle, gli indici, ogni vincolo con nome e i due tipi nuovi", () => {
  for (const name of [...EVALS_TABLES, ...EVALS_INDEXES]) assert.ok(EVALS_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
  const named = [...EVALS_DDL.join("\n").matchAll(/CONSTRAINT ([a-z0-9_]+) (CHECK|PRIMARY KEY|UNIQUE|FOREIGN KEY)/g)].map((m) => m[1]).filter((n) => n.startsWith("use_case_eval_"));
  assert.deepEqual([...named].sort(), [...EVALS_NAMED_CONSTRAINTS].sort());
  assert.equal(new Set(EVALS_NAMED_CONSTRAINTS).size, EVALS_NAMED_CONSTRAINTS.length);
  const indexes = EVALS_DDL.filter((s) => s.startsWith("CREATE INDEX")).map((s) => s.match(/CREATE INDEX IF NOT EXISTS ([a-z_]+) /)?.[1]);
  assert.deepEqual(indexes, [...EVALS_INDEXES]);
  for (const kind of EVAL_NOTICE_KINDS) assert.ok(EVALS_PROBE_SQL.includes(`position('''${kind}''' IN pg_get_constraintdef(c.oid)) > 0`), kind);
});

test("ensure-schema: versione 30, la 0036 dopo la 0035, non fatale, con timeout e lock, la sonda in AND e il nuovo tentativo", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 30, "ENSURE_VERSION almeno 30");
  assert.match(ensureSchema, /import \{ EVALS_DDL, EVALS_PROBE_SQL \} from "\.\/use-case-hub-evals-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const team = runOnce.indexOf("await runWorkspaceTeamDdlSafely();");
  const evals = runOnce.indexOf("await runEvalsDdlSafely();");
  assert.ok(team > 0 && evals > team);
  const safe = topLevelFunction(ensureSchema, "async function runEvalsDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runEvalsDdl\(\);\s+evalsDdlFailedAt = null;\s+\} catch \(err\) \{\s+evalsDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe));
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(ensure, /if \(evalsDdlFailedAt !== null && Date\.now\(\) - evalsDdlFailedAt >= REFERENTS_DDL_RETRY_MS\) \{\s+evalsDdlFailedAt = Date\.now\(\);\s+ensurePromise = ensurePromise\.then\(runEvalsDdlSafely\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(WORKSPACE_TEAM_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(EVALS_PROBE_SQL\)\}/);
  const runner = topLevelFunction(ensureSchema, "export async function runEvalsDdl(statements: readonly string[] = EVALS_DDL): Promise<void> {");
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") > 0);
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") < runner.indexOf(`pg_advisory_xact_lock(hashtext('${EVALS_ADVISORY_LOCK}'))`));
});

test("le colonne Drizzle sono quelle del DDL, nello stesso ordine", () => {
  assert.equal(getTableName(schema.useCaseEvalRuns), "use_case_eval_runs");
  assert.equal(getTableName(schema.useCaseEvalResults), "use_case_eval_results");
  assert.deepEqual(Object.values(getTableColumns(schema.useCaseEvalRuns)).map((c) => c.name), ddlColumns(runs));
  assert.deepEqual(Object.values(getTableColumns(schema.useCaseEvalResults)).map((c) => c.name), ddlColumns(results));
  assert.equal(ddlColumns(runs).length, 14);
  assert.equal(ddlColumns(results).length, 18);
});
