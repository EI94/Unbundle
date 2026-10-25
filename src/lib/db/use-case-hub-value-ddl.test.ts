import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ITEM_STATUSES } from "../uc/vocab.ts";
import { USE_CASE_HUB_DDL, VERSIONED_USE_CASE_COLUMNS } from "./use-case-hub-ddl.ts";
import {
  MISSING_0020_MESSAGE,
  USE_CASE_NEED_AVAILABILITIES,
  USE_CASE_NEED_COLUMNS,
  USE_CASE_NEED_KINDS,
  USE_CASE_NEED_OWNER_SIDES,
  USE_CASE_NEED_REQUIREMENT_STATUSES,
  USE_CASE_NEED_STEP_STATUSES,
  USE_CASE_NEED_TYPES,
  USE_CASE_VALUE_DDL,
  USE_CASE_VALUE_PROBE_SQL,
} from "./use-case-hub-value-ddl.ts";
import type { UseCase, UseCaseNeed } from "./schema.ts";
import type { ValueModel } from "../use-cases/value-model.ts";

// Migrazione 0022 e self-heal: benefici e «Cosa serve» (spec del 25/10/2026). Le prove sul
// database stanno in use-case-hub-value.integration.test.ts e in
// scripts/use-case-test/schema-check.mjs.

const migration = readFileSync(new URL("../../../drizzle/0022_use_case_value.sql", import.meta.url), "utf8");
const migration0020 = readFileSync(new URL("../../../drizzle/0020_use_case_hub.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");
const schemaTs = readFileSync(new URL("./schema.ts", import.meta.url), "utf8");

/** SQL senza le righe di commento `--`, con gli spazi compressi. */
function normalize(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

const at = (needle: string) => USE_CASE_VALUE_DDL.findIndex((statement) => statement.includes(needle));

/** Una funzione di primo livello di `source`, dalla firma alla prima `}` a inizio riga. */
function topLevelFunction(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `manca: ${signature}`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `fine non trovata: ${signature}`);
  return source.slice(start, end + 2);
}

test("0022: gli statement del self-heal, nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  let cursor = 0;
  for (const statement of USE_CASE_VALUE_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = USE_CASE_VALUE_DDL.reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
});

test("la funzione del trigger è identica, spazi compresi: parità di pg_get_functiondef", () => {
  const statement = USE_CASE_VALUE_DDL.find((s) => s.startsWith("CREATE OR REPLACE FUNCTION use_cases_value_model_version()"));
  assert.ok(statement);
  assert.ok(migration.includes(statement), "il testo della migrazione differisce dal DDL");
});

test("ordine: controllo della 0020, colonna, funzione e trigger, esigenze, legami", () => {
  assert.ok(USE_CASE_VALUE_DDL[0].includes(`RAISE EXCEPTION '${MISSING_0020_MESSAGE}';`));
  const column = at("ADD COLUMN IF NOT EXISTS value_model");
  const fn = at("FUNCTION use_cases_value_model_version");
  const trigger = at("TRIGGER use_cases_value_model_version");
  const needs = at("CREATE TABLE IF NOT EXISTS use_case_needs");
  const needsIdx = at("use_case_needs_workspace_idx");
  const links = at("CREATE TABLE IF NOT EXISTS use_case_need_links");
  const linksIdx = at("use_case_need_links_use_case_idx");
  assert.deepEqual([column, fn, trigger, needs, needsIdx, links, linksIdx], [1, 2, 3, 4, 5, 6, 7]);
  assert.equal(USE_CASE_VALUE_DDL.length, 8);
  // Viene prima di tutto il resto, anche nella migrazione.
  assert.ok(normalize(migration).startsWith(normalize(USE_CASE_VALUE_DDL[0])));
});

test("senza la 0020 la 0022 si ferma: il trigger nuovo scrive version", () => {
  const guard = USE_CASE_VALUE_DDL[0];
  assert.match(migration0020, /ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1/);
  assert.match(guard, /^DO \$\$ BEGIN\s+IF NOT EXISTS \(\s+SELECT 1 FROM information_schema\.columns\s+WHERE table_schema = 'public' AND table_name = 'use_cases' AND column_name = 'version'\s+\) THEN\s+RAISE EXCEPTION/);
  assert.doesNotMatch(guard, /CREATE|ALTER|INSERT|UPDATE|DELETE|DROP/);
  assert.doesNotMatch(MISSING_0020_MESSAGE, /[%']/);
});

test("DDL idempotente, solo additivo, senza estensioni né scritture di dati", () => {
  for (const statement of USE_CASE_VALUE_DDL) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|DROP\s+(TABLE|INDEX|COLUMN|TRIGGER|FUNCTION|CONSTRAINT|NOT NULL|DEFAULT)/i);
    assert.doesNotMatch(statement, /^\s*(UPDATE|DELETE|INSERT)\b/i);
    assert.doesNotMatch(statement, /ALTER COLUMN|RENAME/i);
    if (/^CREATE (TABLE|UNIQUE INDEX|INDEX)/.test(statement)) assert.match(statement, /IF NOT EXISTS/);
    for (const add of statement.match(/ADD COLUMN[^,;]*/g) ?? []) assert.match(add, /ADD COLUMN IF NOT EXISTS/);
    for (const index of statement.match(/CREATE (UNIQUE )?INDEX[^;]*/g) ?? []) assert.match(index, /IF NOT EXISTS/);
    if (/^CREATE (OR REPLACE )?(FUNCTION|TRIGGER)/.test(statement)) assert.match(statement, /^CREATE OR REPLACE/);
    assert.doesNotMatch(statement, /ADD CONSTRAINT/);
  }
  assert.doesNotMatch(migration, /CREATE\s+EXTENSION/i);
});

test("la funzione della 0020 non cambia; il trigger nuovo è separato e parte dopo", () => {
  // Nessuno statement della 0022 tocca la funzione o il trigger della 0020.
  assert.ok(!USE_CASE_VALUE_DDL.some((s) => /use_cases_bump_version/.test(s)));
  assert.ok(!(VERSIONED_USE_CASE_COLUMNS as readonly string[]).includes("value_model"));
  assert.ok(!USE_CASE_HUB_DDL.some((s) => /value_model/.test(s)));
  // I trigger BEFORE UPDATE della stessa tabella partono in ordine di nome.
  assert.ok("use_cases_bump_version" < "use_cases_value_model_version");
  const fn = USE_CASE_VALUE_DDL[at("FUNCTION use_cases_value_model_version")];
  assert.match(fn, /IF NEW\.value_model IS DISTINCT FROM OLD\.value_model THEN\s+NEW\.version := OLD\.version \+ 1;\s+END IF;\s+RETURN NEW;/);
  assert.match(USE_CASE_VALUE_DDL[at("TRIGGER use_cases_value_model_version")], /BEFORE UPDATE OF value_model ON use_cases\s+FOR EACH ROW EXECUTE FUNCTION use_cases_value_model_version\(\);/);
  assert.match(USE_CASE_VALUE_DDL[at("ADD COLUMN IF NOT EXISTS value_model")], /value_model jsonb\s+CONSTRAINT use_cases_value_model_check CHECK \(value_model IS NULL OR jsonb_typeof\(value_model\) = 'object'\);$/);
});

test("esigenze: colonne della spec, vocabolari chiusi, stato secondo il tipo, chiave unica per workspace", () => {
  assert.deepEqual(USE_CASE_NEED_TYPES, ["requisito", "passo"]);
  assert.deepEqual(USE_CASE_NEED_KINDS, ["accesso", "dato", "documento", "regola", "decisione", "persona", "contratto", "altro"]);
  assert.deepEqual(USE_CASE_NEED_OWNER_SIDES, ["cliente", "lateral_space", "fornitore", "insieme"]);
  assert.deepEqual(USE_CASE_NEED_REQUIREMENT_STATUSES, ITEM_STATUSES);
  assert.equal(USE_CASE_NEED_REQUIREMENT_STATUSES.length, 8);
  assert.deepEqual(USE_CASE_NEED_STEP_STATUSES, ["proposta", "confermata", "fatta"]);
  assert.deepEqual(USE_CASE_NEED_AVAILABILITIES, ["subito", "dopo_a8"]);
  const table = USE_CASE_VALUE_DDL[at("CREATE TABLE IF NOT EXISTS use_case_needs")];
  const columns = table
    .slice(table.indexOf("(") + 1, table.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_]+) [a-z]/)?.[1])
    .filter((name): name is string => Boolean(name) && name !== "CONSTRAINT" && name !== "OR");
  assert.deepEqual(columns, [...USE_CASE_NEED_COLUMNS]);
  assert.match(table, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  assert.match(table, /\(type = 'requisito' AND status IN \('da_chiedere', 'chiesta', 'mancante', 'parziale', 'in_verifica', 'validata', 'non_applicabile', 'bloccata'\)\)\s+OR \(type = 'passo' AND status IN \('proposta', 'confermata', 'fatta'\)\)/);
  assert.match(table, /CONSTRAINT use_case_needs_import_key_unique UNIQUE \(workspace_id, import_key\)/);
  assert.match(table, /CONSTRAINT use_case_needs_archive_check CHECK \(archive_reason IS NULL OR archived_at IS NOT NULL\)/);
  assert.match(table, /owner_side IS NULL OR owner_side IN/);
  assert.match(table, /availability IS NULL OR availability IN/);
  assert.match(USE_CASE_VALUE_DDL[at("use_case_needs_workspace_idx")], /ON use_case_needs \(workspace_id, type, sort_order\);/);
});

test("legami: chiave (need_id, use_case_id), cascata da tutte e due le parti, indice per scheda", () => {
  const links = USE_CASE_VALUE_DDL[at("CREATE TABLE IF NOT EXISTS use_case_need_links")];
  assert.match(links, /need_id uuid NOT NULL REFERENCES use_case_needs\(id\) ON DELETE CASCADE/);
  assert.match(links, /use_case_id uuid NOT NULL REFERENCES use_cases\(id\) ON DELETE CASCADE/);
  assert.match(links, /CONSTRAINT use_case_need_links_pkey PRIMARY KEY \(need_id, use_case_id\)/);
  assert.match(USE_CASE_VALUE_DDL[at("use_case_need_links_use_case_idx")], /ON use_case_need_links \(use_case_id\);/);
});

test("nessuna colonna o indice sulle persone: niente conteggi per persona", () => {
  for (const statement of USE_CASE_VALUE_DDL) {
    assert.doesNotMatch(statement, /user_id|proposed_by|actor_/);
  }
});

test("la sonda copre ogni oggetto del DDL", () => {
  const ddl = USE_CASE_VALUE_DDL.join("\n");
  const names = new Set<string>();
  for (const pattern of [
    /CREATE TABLE IF NOT EXISTS (\w+)/g,
    /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+)/g,
    /CREATE OR REPLACE TRIGGER (\w+)/g,
    /CREATE OR REPLACE FUNCTION (\w+)/g,
    /ADD COLUMN IF NOT EXISTS (\w+)/g,
    /CONSTRAINT (\w+)/g,
  ]) {
    for (const match of ddl.matchAll(pattern)) names.add(match[1]);
  }
  assert.equal(names.size, 15, [...names].join(", "));
  for (const name of names) {
    assert.match(USE_CASE_VALUE_PROBE_SQL, new RegExp(`'(public\\.)?${name}(\\(\\))?'`), `la sonda non guarda ${name}`);
  }
  const constraints = new Set([...ddl.matchAll(/CONSTRAINT (\w+)/g)].map((m) => m[1]));
  assert.match(USE_CASE_VALUE_PROBE_SQL, new RegExp(`conname IN \\([^)]*\\)\\s+\\) = ${constraints.size}\\s`));
  assert.match(USE_CASE_VALUE_PROBE_SQL, new RegExp(`\\) = ${USE_CASE_NEED_COLUMNS.length}\\s`));
});

test("ensure-schema: versione 16, DDL della 0022 dopo quello dell'hub, sonda in AND", () => {
  assert.match(ensureSchema, /const ENSURE_VERSION = 16;/);
  assert.match(ensureSchema, /import \{ USE_CASE_VALUE_DDL, USE_CASE_VALUE_PROBE_SQL \} from "\.\/use-case-hub-value-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const hub = runOnce.indexOf("await runUseCaseHubDdl();");
  const value = runOnce.indexOf("await runUseCaseValueDdl();");
  assert.ok(hub > 0 && value > hub, "il DDL della 0022 segue quello dell'hub in runOnce()");
  assert.match(ensureSchema, /AND \$\{sql\.raw\(USE_CASE_HUB_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(USE_CASE_VALUE_PROBE_SQL\)\}/);
  const run = topLevelFunction(ensureSchema, "export async function runUseCaseValueDdl(");
  assert.match(run, /pg_advisory_xact_lock\(hashtext\('unbundle:use-case-value-ddl'\)\)/);
  assert.match(run, /client\.transaction\(/);
});

test("schema.ts: value_model e le due tabelle della 0022, con i default", () => {
  for (const fragment of [
    'valueModel: jsonb("value_model").$type<UseCaseValueModel>()',
    'pgTable(\n  "use_case_needs"',
    'pgTable(\n  "use_case_need_links"',
    'kind: varchar("kind", { length: 20 }).$type<UseCaseNeedKind>().notNull().default("altro")',
    'dueIsProposal: boolean("due_is_proposal").notNull().default(false)',
    'sortOrder: integer("sort_order").notNull().default(0)',
    'unique("use_case_needs_import_key_unique").on(t.workspaceId, t.importKey)',
    'primaryKey({ name: "use_case_need_links_pkey", columns: [t.needId, t.useCaseId] })',
  ]) {
    assert.ok(schemaTs.includes(fragment), fragment);
  }
  // Lo controlla tsc: la colonna ha il tipo dello schema zod, le esigenze le colonne della spec.
  type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
  const shapes: [Same<UseCase["valueModel"], ValueModel | null>, Same<keyof UseCaseNeed, CamelColumns>] = [true, true];
  assert.deepEqual(shapes, [true, true]);
});

type Camel<S extends string> = S extends `${infer A}_${infer B}` ? `${A}${Capitalize<Camel<B>>}` : S;
type CamelColumns = Camel<(typeof USE_CASE_NEED_COLUMNS)[number]>;
