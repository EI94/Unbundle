import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  AGENT_QUESTION_CHANNELS,
  AGENT_QUESTION_STATUSES,
  BUILD_HARNESSES,
  BUILD_OUTCOMES,
  CLI_ADVISORY_LOCK,
  CLI_DDL,
  CLI_INDEXES,
  CLI_LOGIN_STATUSES,
  CLI_NAMED_CONSTRAINTS,
  CLI_PROBE_SQL,
  CLI_ROLLBACK_SWEEP_SQL,
  CLI_TABLES,
  CLI_USER_CODE_ALPHABET,
  MISSING_FACTORY_FOR_CLI_MESSAGE,
  USE_CASE_NOTIFICATION_KINDS_0031,
} from "./use-case-hub-cli-ddl.ts";
import { ALERTS_ADVISORY_LOCK } from "./use-case-hub-alerts-ddl.ts";
import { FACTORY_FRAMEWORKS, USE_CASE_NOTIFICATION_KINDS_0030 } from "./use-case-hub-factory-ddl.ts";
import * as schema from "./schema.ts";

// Migrazione 0031 e self-heal: login della CLI, repository, domande dei coding agent, sintesi delle sessioni
// (rilascio 8.0b). Le prove sul database stanno in src/lib/db/use-case-hub-cli.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0031_cli.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");

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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-cli-ddl'));"];

const tableOf = (name: string) => {
  const found = CLI_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`));
  assert.ok(found, `manca la tabella ${name}`);
  return found;
};

function ddlColumns(statement: string): string[] {
  return statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|char|smallint|timestamptz|integer|bigint|boolean|jsonb|date|numeric)\b/)?.[1])
    .filter((n): n is string => Boolean(n));
}

function checkList(statement: string, constraint: string): string[] {
  const at = statement.indexOf(`CONSTRAINT ${constraint} CHECK`);
  assert.notEqual(at, -1, `manca ${constraint}`);
  const list = statement.slice(at).match(/IN \(([^)]*)\)/)?.[1] ?? "";
  return [...list.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]);
}

test("0031: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "lock_timeout e advisory lock in testa");
  assert.equal(CLI_ADVISORY_LOCK, "unbundle:use-case-cli-ddl");
  let cursor = 0;
  for (const statement of CLI_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...CLI_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0031_cli\.sql/);
  assert.match(migration, /In produzione la applica il self-heal dell'app al primo avvio dopo il deploy/);
});

test("controllo iniziale: senza la 0030 si ferma con il suo messaggio", () => {
  assert.match(CLI_DDL[0], /^DO \$\$ BEGIN\s+IF to_regclass\('public\.use_case_projects'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(CLI_DDL[0].includes(`'${MISSING_FACTORY_FOR_CLI_MESSAGE}'`));
  assert.doesNotMatch(MISSING_FACTORY_FOR_CLI_MESSAGE, /[%']/);
});

test("solo aggiunte: niente dati scritti, niente colonne cambiate; il solo DROP è il CHECK della campanella; il DDL uc non si tocca", () => {
  const widen = CLI_DDL[CLI_DDL.length - 1];
  for (const statement of CLI_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|ALTER\s+COLUMN|ADD\s+COLUMN|\bRENAME\b|DROP\s+(TABLE|COLUMN|INDEX)/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO|TRUNCATE)\b/i);
    assert.doesNotMatch(statement, /\buc_[a-z_]+/, "nessuna tabella uc: il DDL uc (0018) non cambia");
    if (statement !== widen) assert.doesNotMatch(statement, /DROP\s+CONSTRAINT/i);
    // Niente `?`: alcuni driver lo leggono come segnaposto.
    if (statement !== widen) assert.doesNotMatch(statement, /\?/);
  }
  assert.match(widen, /DROP CONSTRAINT IF EXISTS use_case_notifications_kind_check/);
  assert.equal(CLI_DDL[CLI_DDL.length - 2], `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`, "sotto il lock della 0025");
});

test("i tipi della campanella: quelli della 0030, nello stesso ordine, più domanda_agente, entro 16 caratteri", () => {
  assert.deepEqual(USE_CASE_NOTIFICATION_KINDS_0031, [...USE_CASE_NOTIFICATION_KINDS_0030, "domanda_agente"]);
  const widen = CLI_DDL[CLI_DDL.length - 1];
  for (const kind of USE_CASE_NOTIFICATION_KINDS_0031) {
    assert.ok(widen.includes(`'${kind}'`), kind);
    assert.ok(kind.length <= 16, `${kind} entra in kind varchar(16)`);
  }
  assert.deepEqual(CLI_ROLLBACK_SWEEP_SQL, ["DELETE FROM use_case_notifications WHERE kind IN ('domanda_agente');"]);
});

test("i CHECK sono gli elenchi del vocabolario; il codice da leggere usa solo consonanti", () => {
  assert.deepEqual(checkList(tableOf("use_case_cli_logins"), "use_case_cli_logins_status_check"), [...CLI_LOGIN_STATUSES]);
  assert.deepEqual(checkList(tableOf("use_case_repos"), "use_case_repos_profile_check"), [...FACTORY_FRAMEWORKS]);
  assert.deepEqual(checkList(tableOf("use_case_agent_questions"), "use_case_agent_questions_status_check"), [...AGENT_QUESTION_STATUSES]);
  assert.deepEqual(checkList(tableOf("use_case_agent_questions"), "use_case_agent_questions_channel_check"), [...AGENT_QUESTION_CHANNELS]);
  assert.deepEqual(checkList(tableOf("use_case_build_sessions"), "use_case_build_sessions_harness_check"), [...BUILD_HARNESSES]);
  assert.deepEqual(checkList(tableOf("use_case_build_sessions"), "use_case_build_sessions_outcome_check"), [...BUILD_OUTCOMES]);
  assert.doesNotMatch(CLI_USER_CODE_ALPHABET, /[AEIOUY01]/, "niente vocali né cifre che si confondono");
  assert.equal(new Set(CLI_USER_CODE_ALPHABET).size, CLI_USER_CODE_ALPHABET.length);
  assert.ok(tableOf("use_case_cli_logins").includes(`user_code ~ '^[${CLI_USER_CODE_ALPHABET}]{4}-[${CLI_USER_CODE_ALPHABET}]{4}$'`));
});

test("le regole stanno anche nel database: un codice vivo è unico, il login confermato ha persona e workspace, la sessione non ha persona", () => {
  assert.ok(CLI_DDL.includes("CREATE UNIQUE INDEX IF NOT EXISTS use_case_cli_logins_code_live_unique ON use_case_cli_logins (user_code) WHERE status IN ('in_attesa', 'confermato');"));
  assert.match(tableOf("use_case_cli_logins"), /device_code_hash char\(64\) NOT NULL/);
  assert.match(tableOf("use_case_cli_logins"), /CONSTRAINT use_case_cli_logins_confirmed_check CHECK \(status NOT IN \('confermato', 'consegnato'\) OR \(workspace_id IS NOT NULL AND user_id IS NOT NULL AND decided_at IS NOT NULL\)\)/);
  assert.match(tableOf("use_case_agent_questions"), /CONSTRAINT use_case_agent_questions_decided_check CHECK \(status = 'proposta' OR decided_at IS NOT NULL\)/);
  const sessions = tableOf("use_case_build_sessions");
  assert.doesNotMatch(sessions, /user_id|author|actor|proposed|submitted/, "nessuna colonna sulla persona");
  assert.match(sessions, /CONSTRAINT use_case_build_sessions_unique UNIQUE \(use_case_id, session_key\)/);
  assert.ok(sessions.includes("pr_url IS NULL OR pr_url ~ '^https://github\\.com/"), "la PR solo su GitHub");
  // Niente colonne sul proponente (art. 15.4): chi ha proposto una domanda è il suo autore, come per le decisioni.
  assert.doesNotMatch(tableOf("use_case_agent_questions"), /proposed_by|submitted_by/);
});

test("ogni tabella con un caso si cancella con il suo workspace e con il suo use case", () => {
  for (const name of ["use_case_repos", "use_case_agent_questions", "use_case_build_sessions"]) {
    assert.match(tableOf(name), /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/, name);
    assert.match(tableOf(name), /use_case_id uuid NOT NULL REFERENCES use_cases\(id\) ON DELETE CASCADE/, name);
  }
  assert.match(tableOf("use_case_cli_logins"), /workspace_id uuid REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(tableOf("use_case_cli_logins"), /token_id uuid REFERENCES workspace_integration_tokens\(id\) ON DELETE SET NULL/);
});

test("la sonda copre ogni tabella, ogni indice, ogni vincolo con nome e il tipo nuovo della campanella", () => {
  for (const name of CLI_TABLES) assert.ok(CLI_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
  for (const name of CLI_INDEXES) {
    assert.ok(CLI_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
    assert.ok(CLI_DDL.some((s) => s.includes(` ${name} ON `)), `l'indice ${name} è nel DDL`);
  }
  const all = CLI_DDL.join("\n");
  const named = [...all.matchAll(/CONSTRAINT ([a-z_]+) (CHECK|PRIMARY KEY|UNIQUE)/g)].map((m) => m[1]).filter((n) => CLI_TABLES.some((t) => n.startsWith(t)));
  assert.deepEqual([...named].sort(), [...CLI_NAMED_CONSTRAINTS].sort());
  assert.ok(CLI_PROBE_SQL.includes(`) = ${CLI_NAMED_CONSTRAINTS.length}`));
  assert.ok(CLI_PROBE_SQL.includes("position('''domanda_agente''' IN pg_get_constraintdef(c.oid)) > 0"));
});

test("ensure-schema: versione 25, la 0031 dopo la 0030, non fatale, con timeout e lock, e la sonda in AND", () => {
  assert.match(ensureSchema, /const ENSURE_VERSION = 25;/);
  assert.match(ensureSchema, /import \{ CLI_DDL, CLI_PROBE_SQL \} from "\.\/use-case-hub-cli-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const factory = runOnce.indexOf("await runFactoryDdlSafely();");
  const cli = runOnce.indexOf("await runCliDdlSafely();");
  assert.ok(factory > 0 && cli > factory, "0030 poi 0031");
  assert.ok(!runOnce.includes("await runCliDdl();"), "la 0031 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runCliDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runCliDdl\(\);\s+cliDdlFailedAt = null;\s+\} catch \(err\) \{\s+cliDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(ensure, /Date\.now\(\) - cliDdlFailedAt >= REFERENTS_DDL_RETRY_MS/);
  assert.match(ensure, /ensurePromise = ensurePromise\.then\(runCliDdlSafely\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(FACTORY_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(CLI_PROBE_SQL\)\}/);
  const runner = topLevelFunction(ensureSchema, "export async function runCliDdl(statements: readonly string[] = CLI_DDL): Promise<void> {");
  const timeout = runner.indexOf("set_config('lock_timeout', '3s', true)");
  const lock = runner.indexOf(`pg_advisory_xact_lock(hashtext('${CLI_ADVISORY_LOCK}'))`);
  const statements = runner.indexOf("...statements.map");
  assert.ok(timeout > 0 && lock > timeout && statements > lock, "timeout, lock, poi gli statement");
});

test("le colonne Drizzle sono quelle del DDL, nello stesso ordine", () => {
  const tables = [schema.useCaseCliLogins, schema.useCaseRepos, schema.useCaseAgentQuestions, schema.useCaseBuildSessions];
  assert.deepEqual(tables.map((t) => getTableName(t)), [...CLI_TABLES]);
  for (const table of tables) {
    const drizzle = Object.values(getTableColumns(table)).map((column) => column.name);
    assert.deepEqual(drizzle, ddlColumns(tableOf(getTableName(table))), getTableName(table));
  }
});
