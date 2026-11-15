import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import {
  CONTEXT_ADVISORY_LOCK,
  CONTEXT_DDL,
  CONTEXT_FTS_INDEXES,
  CONTEXT_NAMED_CONSTRAINTS,
  CONTEXT_PROBE_SQL,
  CONTEXT_TABLES,
  CONTEXT_THESIS_COLUMN,
  CONTEXT_UNIQUE_INDEXES,
} from "./context-ddl.ts";
import * as schema from "./schema.ts";
import {
  BASES,
  COMMITMENT_PARTIES,
  COMMITMENT_STATUSES,
  CONTEXT_CHANNELS,
  CONTEXT_EVENT_ACTIONS,
  CONTEXT_LIMITS,
  CONTEXT_SECTIONS,
  CONTEXT_VISIBILITIES,
  ENTITY_TYPES,
  FACT_KINDS,
  FACT_ORIGINS,
  FACT_STATUSES,
  GRANOLA_CONNECTION_STATUSES,
  GRANOLA_DECISIONS,
  PROPOSAL_ISSUES,
  PROPOSAL_KINDS,
  PROPOSAL_STATUSES,
  QUESTION_ORIGINS,
  QUESTION_STATUSES,
  READ_REASONS,
  READ_STATUSES,
  RELATION_VERBS,
  SOURCE_KINDS,
  SOURCE_ORIGINS,
} from "../context/vocab.ts";

// Migrazione 0038 e self-heal: «Contesto», la memoria del cliente (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §2). Le
// prove sul database stanno in src/lib/context/context.integration.test.ts.

const migration = readFileSync(new URL("../../../drizzle/0038_contesto.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");
const doctor = readFileSync(new URL("../../../scripts/use-case-admin/doctor.ts", import.meta.url), "utf8");
const runbook = readFileSync(new URL("../../../docs/casi-duso/RUNBOOK.md", import.meta.url), "utf8");
const ambiente = readFileSync(new URL("../../../docs/casi-duso/AMBIENTE.md", import.meta.url), "utf8");
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:context-ddl'));"];
const tableStatements = CONTEXT_DDL.filter((s) => s.startsWith("CREATE TABLE IF NOT EXISTS "));
const tableName = (statement: string) => statement.match(/^CREATE TABLE IF NOT EXISTS ([a-z_]+) \(/)?.[1] ?? "";
const statementOf = (table: string) => {
  const found = tableStatements.find((s) => tableName(s) === table);
  assert.ok(found, `manca la tabella ${table}`);
  return found;
};
const COLUMN = /^([a-z_][a-z0-9_]*) (uuid|varchar|text|date|char|integer|smallint|boolean|jsonb|timestamptz)\b/;
const ddlColumns = (statement: string) =>
  statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(COLUMN)?.[1])
    .filter((n): n is string => Boolean(n));
const thesisBlock = CONTEXT_DDL.find((s) => s.includes("ALTER TABLE workspaces ADD COLUMN company_value_thesis")) ?? "";

test("0038: le due righe di apertura, poi i 46 statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "il file comincia con lock_timeout e l'advisory lock");
  assert.equal(CONTEXT_ADVISORY_LOCK, "unbundle:context-ddl");
  assert.equal(CONTEXT_DDL.length, 46);
  let cursor = 0;
  for (const statement of CONTEXT_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...CONTEXT_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0038_contesto\.sql/);
  assert.match(migration, /ENSURE_VERSION 32/);
  assert.match(migration, /src\/lib\/db\/context-ddl\.ts/);
});

test("46 statement: 2 blocchi DO, 17 tabelle, 22 indici, 5 indici unici; il primo controlla che la 0037 ci sia", () => {
  const count = (prefix: string) => CONTEXT_DDL.filter((s) => s.startsWith(prefix)).length;
  assert.equal(count("DO $$ BEGIN"), 2);
  assert.equal(count("CREATE TABLE IF NOT EXISTS "), 17);
  assert.equal(count("CREATE INDEX IF NOT EXISTS "), 22);
  assert.equal(count("CREATE UNIQUE INDEX IF NOT EXISTS "), 5);
  assert.match(CONTEXT_DDL[0], /to_regclass\('public\.use_case_external_builders'\) IS NULL/);
  assert.match(CONTEXT_DDL[0], /RAISE EXCEPTION 'contesto: manca la 0037/);
  assert.deepEqual(tableStatements.map(tableName), [...CONTEXT_TABLES]);
});

test("solo aggiunte: niente DROP, TRUNCATE, DELETE, estensioni; ALTER TABLE e UPDATE solo nel blocco della tesi, dentro IF NOT EXISTS; nessuna tabella uc", () => {
  for (const statement of CONTEXT_DDL) {
    assert.doesNotMatch(statement, /\bDROP\b|\bTRUNCATE\b|\bDELETE FROM\b|\bRENAME\b|CREATE\s+EXTENSION|\bINSERT INTO\b/i, statement.slice(0, 60));
    assert.doesNotMatch(statement, /\buc_[a-z_]+/, "il DDL uc non cambia");
    if (statement !== thesisBlock) assert.doesNotMatch(statement, /\bALTER\b|\bUPDATE\b/, statement.slice(0, 60));
  }
  assert.ok(thesisBlock, "il blocco della tesi c'è");
  assert.equal(CONTEXT_DDL.filter((s) => /\bALTER TABLE\b/.test(s)).length, 1);
  assert.equal(thesisBlock.match(/\bALTER TABLE\b/g)?.length, 1);
  assert.equal(thesisBlock.match(/\bUPDATE\b/g)?.length, 1);
  // Riempie solo quando crea la colonna: una volta sola, anche se il self-heal ripassa.
  const guard = thesisBlock.indexOf("IF NOT EXISTS (");
  const alter = thesisBlock.indexOf("ALTER TABLE workspaces ADD COLUMN company_value_thesis jsonb;");
  const update = thesisBlock.indexOf("UPDATE workspaces w");
  const endIf = thesisBlock.indexOf("END IF;");
  assert.ok(guard > 0 && guard < alter && alter < update && update < endIf, "IF NOT EXISTS, poi ALTER, poi UPDATE, poi END IF");
  assert.match(thesisBlock, /column_name = 'company_value_thesis'/);
  // La regola: un solo workspace, oppure l'unico con un messaggio di Discovery a non più di 10 minuti dal salvataggio.
  assert.match(thesisBlock, /\(SELECT count\(\*\) FROM workspaces x WHERE x\.organization_id = o\.id\) = 1/);
  assert.match(thesisBlock, /CASE WHEN count\(DISTINCT c\.workspace_id\) = 1 THEN/);
  assert.match(thesisBlock, /c\.type = 'leadership_setup'/);
  assert.match(thesisBlock, /BETWEEN o\.updated_at - interval '10 minutes' AND o\.updated_at \+ interval '10 minutes'/);
  // L'organizzazione non si tocca: resta il valore di partenza.
  assert.doesNotMatch(thesisBlock, /UPDATE organizations|ALTER TABLE organizations/);
});

test("ogni tabella si cancella con il workspace o con la persona; la storia non ha chiavi esterne sui fatti", () => {
  for (const statement of tableStatements) {
    const name = tableName(statement);
    if (name === "context_granola_clients") continue; // un cliente OAuth registrato: non è di un workspace né di una persona
    assert.match(
      statement,
      /(workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE|user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE)/,
      `${name}: si cancella con il workspace o con la persona`,
    );
  }
  const events = statementOf("context_events");
  for (const column of ["source_id uuid,", "fact_id uuid,", "commitment_id uuid,", "question_id uuid,"]) assert.ok(events.includes(`\n  ${column}`), column);
  // Togliere un appunto lascia i fatti «senza fonte»; togliere un documento toglie la sua fonte.
  assert.match(statementOf("context_facts"), /source_id uuid REFERENCES context_sources\(id\) ON DELETE SET NULL/);
  assert.match(statementOf("context_sources"), /document_id uuid REFERENCES uploaded_documents\(id\) ON DELETE CASCADE/);
  assert.match(statementOf("context_proposals"), /source_id uuid NOT NULL REFERENCES context_sources\(id\) ON DELETE CASCADE/);
  // Gli appunti sono sempre «Solo Lateral Space».
  assert.match(statementOf("context_sources"), /CONSTRAINT context_sources_notes_ls_check CHECK \(kind = 'documento' OR visibility = 'ls'\)/);
  // Nessuna colonna su una persona negli impegni e nelle domande.
  for (const table of ["context_commitments", "context_questions"]) assert.doesNotMatch(statementOf(table), /user_id/, table);
});

/** I valori di un CHECK `colonna IN ('a', 'b')` con quel nome. */
function checkValues(table: string, constraint: string): string[] {
  const match = statementOf(table).match(new RegExp(`CONSTRAINT ${constraint} CHECK \\((?:[a-z_]+ IS NULL OR )?[a-z_]+ IN \\(([^)]+)\\)\\)`));
  assert.ok(match, `${table}: manca ${constraint}`);
  return match[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
}

test("i CHECK elencano gli stessi valori del vocabolario", () => {
  const pairs: Array<[string, string, readonly string[]]> = [
    ["context_sources", "context_sources_kind_check", SOURCE_KINDS],
    ["context_sources", "context_sources_origin_check", SOURCE_ORIGINS],
    ["context_sources", "context_sources_visibility_check", CONTEXT_VISIBILITIES],
    ["context_sources", "context_sources_read_status_check", READ_STATUSES],
    ["context_facts", "context_facts_kind_check", FACT_KINDS],
    ["context_facts", "context_facts_section_check", CONTEXT_SECTIONS],
    ["context_facts", "context_facts_basis_check", BASES],
    ["context_facts", "context_facts_visibility_check", CONTEXT_VISIBILITIES],
    ["context_facts", "context_facts_status_check", FACT_STATUSES],
    ["context_facts", "context_facts_origin_check", FACT_ORIGINS],
    ["context_entities", "context_entities_type_check", ENTITY_TYPES],
    ["context_relations", "context_relations_verb_check", RELATION_VERBS],
    ["context_commitments", "context_commitments_party_check", COMMITMENT_PARTIES],
    ["context_commitments", "context_commitments_status_check", COMMITMENT_STATUSES],
    ["context_commitments", "context_commitments_visibility_check", CONTEXT_VISIBILITIES],
    ["context_commitments", "context_commitments_origin_check", FACT_ORIGINS],
    ["context_questions", "context_questions_status_check", QUESTION_STATUSES],
    ["context_questions", "context_questions_visibility_check", CONTEXT_VISIBILITIES],
    ["context_questions", "context_questions_origin_check", QUESTION_ORIGINS],
    ["context_proposals", "context_proposals_kind_check", PROPOSAL_KINDS],
    ["context_proposals", "context_proposals_basis_check", BASES],
    ["context_proposals", "context_proposals_section_check", CONTEXT_SECTIONS],
    ["context_proposals", "context_proposals_visibility_check", CONTEXT_VISIBILITIES],
    ["context_proposals", "context_proposals_party_check", COMMITMENT_PARTIES],
    ["context_proposals", "context_proposals_status_check", PROPOSAL_STATUSES],
    ["context_events", "context_events_channel_check", CONTEXT_CHANNELS],
    ["context_granola_connections", "context_granola_connections_status_check", GRANOLA_CONNECTION_STATUSES],
    ["context_granola_meetings", "context_granola_meetings_decision_check", GRANOLA_DECISIONS],
  ];
  for (const [table, constraint, values] of pairs) assert.deepEqual(checkValues(table, constraint), [...values], constraint);
  // I codici liberi stanno dentro la forma del loro CHECK e dentro la colonna.
  for (const reason of READ_REASONS) assert.match(reason, /^[a-z_]{2,16}$/, reason);
  for (const issue of PROPOSAL_ISSUES) assert.match(issue, /^[a-z_]{2,16}$/, issue);
  for (const action of CONTEXT_EVENT_ACTIONS) assert.match(action, /^[a-z_]{3,24}$/, action);
  // I limiti del codice sono quelli delle colonne.
  assert.match(statementOf("context_sources"), new RegExp(`body_chars BETWEEN 0 AND ${CONTEXT_LIMITS.bodyMax}\\b`));
  assert.match(statementOf("context_sources"), new RegExp(`title varchar\\(${CONTEXT_LIMITS.titleMax}\\)`));
  assert.match(statementOf("context_sources"), new RegExp(`participants varchar\\(${CONTEXT_LIMITS.participantsMax}\\)`));
  assert.match(statementOf("context_sources"), new RegExp(`parts_total BETWEEN 1 AND ${CONTEXT_LIMITS.partsMax}\\b`));
  assert.match(statementOf("context_facts"), new RegExp(`statement varchar\\(${CONTEXT_LIMITS.statementMax}\\)`));
  assert.match(statementOf("context_facts"), new RegExp(`quote varchar\\(${CONTEXT_LIMITS.quoteMax}\\)`));
  assert.match(statementOf("context_proposals"), new RegExp(`statement varchar\\(${CONTEXT_LIMITS.proposalStatementMax}\\)`));
  assert.match(statementOf("context_commitments"), new RegExp(`role_label varchar\\(${CONTEXT_LIMITS.roleLabelMax}\\)`));
  assert.match(statementOf("context_questions"), new RegExp(`question varchar\\(${CONTEXT_LIMITS.questionMax}\\)`));
  assert.match(statementOf("context_briefs"), new RegExp(`jsonb_array_length\\(lines\\) BETWEEN 1 AND ${CONTEXT_LIMITS.briefLines}\\b`));
});

test("la sonda: le 17 tabelle, i 5 indici unici, i 4 indici GIN, le 19 chiavi e la colonna della tesi", () => {
  assert.equal(CONTEXT_TABLES.length, 17);
  assert.equal(CONTEXT_UNIQUE_INDEXES.length, 5);
  assert.equal(CONTEXT_FTS_INDEXES.length, 4);
  assert.equal(CONTEXT_NAMED_CONSTRAINTS.length, 19);
  for (const name of [...CONTEXT_TABLES, ...CONTEXT_UNIQUE_INDEXES, ...CONTEXT_FTS_INDEXES]) {
    assert.ok(CONTEXT_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
  }
  for (const index of CONTEXT_UNIQUE_INDEXES) assert.ok(CONTEXT_DDL.some((s) => s.startsWith(`CREATE UNIQUE INDEX IF NOT EXISTS ${index} `)), index);
  for (const index of CONTEXT_FTS_INDEXES) {
    const statement = CONTEXT_DDL.find((s) => s.startsWith(`CREATE INDEX IF NOT EXISTS ${index} `));
    assert.ok(statement, index);
    assert.match(statement, /USING gin \(to_tsvector\('italian', /, `${index}: la ricerca è in italiano`);
  }
  assert.deepEqual(
    CONTEXT_DDL.filter((s) => /USING gin/.test(s)).map((s) => s.match(/^CREATE INDEX IF NOT EXISTS ([a-z_]+)/)?.[1]),
    [...CONTEXT_FTS_INDEXES],
  );
  const named = tableStatements.flatMap((s) => [...s.matchAll(/CONSTRAINT ([a-z_]+) (?:PRIMARY KEY|UNIQUE)/g)].map((m) => m[1]));
  assert.deepEqual(named, [...CONTEXT_NAMED_CONSTRAINTS], "ogni chiave primaria e ogni vincolo unico, nell'ordine del file");
  for (const name of CONTEXT_NAMED_CONSTRAINTS) assert.ok(CONTEXT_PROBE_SQL.includes(`'${name}'`), name);
  assert.ok(CONTEXT_PROBE_SQL.includes(") = 19"));
  assert.equal(CONTEXT_THESIS_COLUMN, "company_value_thesis");
  assert.ok(CONTEXT_PROBE_SQL.includes("table_name = 'workspaces' AND column_name = 'company_value_thesis'"));
});

test("ensure-schema: versione 32, la 0038 dopo la 0037, non fatale, con timeout e lock, la sonda in AND e il nuovo tentativo", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 32, "ENSURE_VERSION almeno 32");
  assert.match(ensureSchema, /import \{ CONTEXT_DDL, CONTEXT_PROBE_SQL \} from "\.\/context-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const builders = runOnce.indexOf("await runExternalBuildersDdlSafely();");
  const context = runOnce.indexOf("await runContextDdlSafely();");
  assert.ok(builders > 0 && context > builders, "0037 poi 0038");
  assert.ok(!runOnce.includes("await runContextDdl();"), "la 0038 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runContextDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runContextDdl\(\);\s+contextDdlFailedAt = null;\s+\} catch \(err\) \{\s+contextDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe));
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(
    ensure,
    /if \(contextDdlFailedAt !== null && Date\.now\(\) - contextDdlFailedAt >= REFERENTS_DDL_RETRY_MS\) \{\s+contextDdlFailedAt = Date\.now\(\);\s+ensurePromise = ensurePromise\.then\(runContextDdlSafely\);/,
  );
  assert.match(ensureSchema, /AND \$\{sql\.raw\(EXTERNAL_BUILDERS_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(CONTEXT_PROBE_SQL\)\}/);
  const runner = topLevelFunction(ensureSchema, "export async function runContextDdl(statements: readonly string[] = CONTEXT_DDL): Promise<void> {");
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") > 0);
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") < runner.indexOf(`pg_advisory_xact_lock(hashtext('${CONTEXT_ADVISORY_LOCK}'))`));
});

test("le colonne Drizzle di ogni tabella sono quelle del DDL, nello stesso ordine, con le stesse lunghezze", () => {
  const drizzleTables = new Map<string, PgTable>();
  for (const value of Object.values(schema) as unknown[]) {
    if (is(value, PgTable)) drizzleTables.set(getTableName(value), value);
  }
  for (const statement of tableStatements) {
    const name = tableName(statement);
    const table = drizzleTables.get(name);
    assert.ok(table, `manca la tabella Drizzle di ${name}`);
    const columns = Object.values(getTableColumns(table));
    assert.deepEqual(columns.map((c) => c.name), ddlColumns(statement), name);
    for (const column of columns) {
      const line = statement.split("\n").find((l) => l.trim().startsWith(`${column.name} `)) ?? "";
      assert.equal(column.notNull, /\bNOT NULL\b/.test(line), `${name}.${column.name}: NOT NULL`);
      const length = line.match(/ (?:varchar|char)\((\d+)\)/)?.[1];
      if (length) assert.equal((column as unknown as { length?: number }).length, Number(length), `${name}.${column.name}: lunghezza`);
    }
  }
  // La tesi per workspace non è nella tabella Drizzle `workspaces`: senza la 0038 il resto dell'app non se ne accorge.
  assert.equal(Object.values(getTableColumns(schema.workspaces)).some((c) => c.name === "company_value_thesis"), false);
  assert.equal(Object.values(getTableColumns(schema.organizations)).some((c) => c.name === "company_value_thesis"), true, "quella dell'organizzazione resta");
});

test("il doctor guarda la sonda della 0038", () => {
  assert.match(doctor, /import \{ CONTEXT_PROBE_SQL \} from "\.\.\/\.\.\/src\/lib\/db\/context-ddl\.ts";/);
  assert.match(doctor, /SELECT \$\{CONTEXT_PROBE_SQL\} AS ok/);
  assert.match(doctor, /migrazione0038: m0038,/);
});

test("RUNBOOK §10.19: la 0038 la applica il self-heal al primo avvio, il file a mano è la riserva, il doctor dopo il deploy, il ritorno indietro senza database", () => {
  assert.ok(runbook.includes("### 10.19 Rilascio 9a: «Contesto» (0038)"), "manca §10.19");
  const section = runbook.slice(runbook.indexOf("### 10.19 Rilascio 9a"));
  assert.match(section, /`ENSURE_VERSION` 32/);
  assert.match(section, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0038_contesto\.sql/);
  assert.match(section, /`migrazione0038: true`/);
  assert.match(section, /Mai drizzle-kit, mai `db:push`/);
  assert.match(section, /Ritorno indietro: un passo su Vercel \(Promote del deploy di prima\), niente sul database/);
  assert.match(section, /Il DDL uc della 0018 e la sua impronta non cambiano/);
  assert.match(section, /`CONTEXT_TOKEN_KEY`/);
});

test("AMBIENTE: le tre variabili nuove, senza valori", () => {
  for (const name of ["CONTEXT_TOKEN_KEY", "CONTEXT_GRANOLA", "CONTEXT_GRANOLA_CLIENT"]) {
    assert.ok(ambiente.split("\n").some((line) => line.startsWith(`| \`${name}\` |`)), `${name} ha la sua riga`);
  }
  assert.match(ambiente, /`UC_SECRET`, `UC_PERSONAL_ZONE_KEY`, `CONTEXT_TOKEN_KEY`, `CRON_SECRET`: `openssl rand -base64 32`/);
});
