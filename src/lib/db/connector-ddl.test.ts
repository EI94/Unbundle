import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONNECTOR_DDL,
  CONNECTOR_DEFAULT_LIMITS,
  CONNECTOR_INSTRUCTIONS_TEMPLATE_MAX_CHARS,
  CONNECTOR_PROBE_SQL,
  connectorSearchVectorSql,
} from "./connector-ddl.ts";

const migration = readFileSync(new URL("../../../drizzle/0019_connettore_mcp.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");

/** SQL without `--` comment lines, with whitespace collapsed. */
function normalize(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

test("0019 contiene tutti gli statement del self-heal, nello stesso ordine", () => {
  const body = normalize(migration);
  let cursor = 0;
  for (const statement of CONNECTOR_DDL) {
    const at = body.indexOf(normalize(statement), cursor);
    assert.notEqual(at, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = at + normalize(statement).length;
  }
  // Nient'altro di eseguibile oltre agli statement del self-heal.
  const rest = CONNECTOR_DDL.reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
});

test("ordine imposto dalle chiavi esterne: identità, config e limiti, use_cases, submissions, indici, trigger", () => {
  const firstIndex = (needle: string) => CONNECTOR_DDL.findIndex((s) => s.includes(needle));
  const identities = firstIndex("CREATE TABLE IF NOT EXISTS connector_identities");
  const configs = firstIndex("CREATE TABLE IF NOT EXISTS workspace_connector_configs");
  const limits = firstIndex("CREATE TABLE IF NOT EXISTS connector_rate_limits");
  const useCases = firstIndex("ALTER TABLE use_cases\n  ADD COLUMN");
  const submissions = firstIndex("ALTER TABLE external_contribution_submissions ADD COLUMN");
  const indexes = firstIndex("CREATE UNIQUE INDEX");
  const trigger = firstIndex("CREATE OR REPLACE TRIGGER use_cases_status_changed_at");
  assert.ok(identities === 0 && identities < configs && configs < limits && limits < useCases);
  assert.ok(useCases < submissions && submissions < indexes && indexes < trigger);
  // Dopo il trigger solo aggiunte in coda (PIANO-LAVORI §2.5), idempotenti: colonne nuove
  // (anche con un CHECK), l'estensione unaccent, la sua funzione e un indice nuovo.
  for (const tail of CONNECTOR_DDL.slice(trigger + 1)) {
    const additive =
      /^ALTER TABLE [a-z_]+\s+ADD COLUMN IF NOT EXISTS /.test(tail) ||
      /^CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;$/.test(tail) ||
      /^CREATE OR REPLACE FUNCTION public\.connector_unaccent\(text\)/.test(tail) ||
      /^CREATE INDEX IF NOT EXISTS [a-z_]+\s+ON use_cases USING gin/.test(tail);
    assert.ok(additive, tail);
    assert.doesNotMatch(tail, /\b(DROP|RENAME|TYPE|SET NOT NULL|SET DEFAULT|UPDATE|DELETE)\b/i, tail);
  }
});

/** Gli statement aggiunti in coda, nell'ordine (PIANO-LAVORI §2.5). */
const TAIL = [
  "ALTER TABLE workspace_integration_tokens ADD COLUMN IF NOT EXISTS exposed_at timestamp;",
  "ALTER TABLE workspace_connector_configs\n  ADD COLUMN IF NOT EXISTS profile jsonb",
  "CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;",
  "CREATE OR REPLACE FUNCTION public.connector_unaccent(text) RETURNS text",
  "CREATE INDEX IF NOT EXISTS use_cases_search_italian_unaccent_idx",
];

test("aggiunte in coda: nell'ordine, in fondo al self-heal e alla 0019, tutte nel probe", () => {
  const tail = CONNECTOR_DDL.slice(-TAIL.length);
  TAIL.forEach((start, i) => assert.ok(tail[i].startsWith(start), `${i}: ${tail[i].slice(0, 80)}`));
  // Ultimo statement anche nella migrazione: dopo c'è solo il commento.
  const body = normalize(migration);
  assert.ok(body.endsWith(normalize(CONNECTOR_DDL[CONNECTOR_DDL.length - 1])));
  assert.match(CONNECTOR_PROBE_SQL, /table_name = 'workspace_integration_tokens'\s+AND column_name = 'exposed_at'/);
  assert.match(CONNECTOR_PROBE_SQL, /table_name = 'workspace_connector_configs'\s+AND column_name IN \('profile', 'instructions_template'\)/);
  assert.match(CONNECTOR_PROBE_SQL, /to_regprocedure\('public\.connector_unaccent\(text\)'\) IS NOT NULL/);
  assert.match(CONNECTOR_PROBE_SQL, /to_regclass\('public\.use_cases_search_italian_unaccent_idx'\) IS NOT NULL/);
});

test("profilo e istruzioni per workspace: colonne nullable con un CHECK, senza default", () => {
  const columns = CONNECTOR_DDL.find((s) => s.includes("ADD COLUMN IF NOT EXISTS profile jsonb"));
  assert.ok(columns);
  assert.match(columns, /profile jsonb CONSTRAINT workspace_connector_configs_profile_check CHECK \(profile IS NULL OR jsonb_typeof\(profile\) = 'object'\)/);
  assert.match(
    columns,
    new RegExp(`instructions_template text CONSTRAINT workspace_connector_configs_instructions_template_check CHECK \\(instructions_template IS NULL OR char_length\\(instructions_template\\) BETWEEN 1 AND ${CONNECTOR_INSTRUCTIONS_TEMPLATE_MAX_CHARS}\\)`)
  );
  assert.doesNotMatch(columns, /DEFAULT|NOT NULL/);
  assert.equal(CONNECTOR_INSTRUCTIONS_TEMPLATE_MAX_CHARS, 2048);
});

test("ricerca senza accenti: funzione IMMUTABLE con nomi completi, indice e query con la stessa espressione", () => {
  const fn = CONNECTOR_DDL.find((s) => s.includes("FUNCTION public.connector_unaccent"));
  assert.ok(fn);
  assert.match(fn, /LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT/);
  // Nessuna dipendenza dal search_path: dizionario e funzione con lo schema.
  assert.match(fn, /SELECT public\.unaccent\('public\.unaccent'::regdictionary, \$1\)/);
  const index = CONNECTOR_DDL.find((s) => s.includes("use_cases_search_italian_unaccent_idx"));
  assert.ok(index);
  assert.ok(index.includes(`USING gin (${connectorSearchVectorSql("")})`));
  assert.equal(
    connectorSearchVectorSql("u."),
    "to_tsvector('italian', public.connector_unaccent(coalesce(u.title, '') || ' ' || coalesce(u.description, '')))"
  );
  assert.throws(() => connectorSearchVectorSql("u; DROP TABLE x; --"));
  // Il vecchio indice resta.
  assert.ok(CONNECTOR_DDL.some((s) => s.includes("CREATE INDEX IF NOT EXISTS use_cases_search_italian_idx")));
  // L'estensione nasce prima della funzione, la funzione prima dell'indice.
  const at = (needle: string) => CONNECTOR_DDL.findIndex((s) => s.includes(needle));
  assert.ok(at("CREATE EXTENSION IF NOT EXISTS unaccent") < at("FUNCTION public.connector_unaccent"));
  assert.ok(at("FUNCTION public.connector_unaccent") < at("use_cases_search_italian_unaccent_idx"));
});

test("expand/contract: il trigger che riempie principal_key nasce prima del NOT NULL", () => {
  const at = (needle: string) => CONNECTOR_DDL.findIndex((s) => s.includes(needle));
  const fn = at("FUNCTION external_contribution_fill_principal_key");
  const trigger = at("TRIGGER external_contribution_fill_principal_key");
  const notNull = at("principal_key SET NOT NULL");
  assert.ok(at("ADD COLUMN IF NOT EXISTS principal_key") < fn && fn < trigger && trigger < notNull);
  const body = CONNECTOR_DDL[fn];
  assert.match(body, /IF NEW\.principal_key IS NULL AND NEW\.integration_token_id IS NOT NULL THEN/);
  assert.match(body, /NEW\.principal_key := 'token:' \|\| NEW\.integration_token_id::text;/);
  assert.match(CONNECTOR_DDL[trigger], /BEFORE INSERT ON external_contribution_submissions/);
  assert.ok(CONNECTOR_PROBE_SQL.includes("external_contribution_fill_principal_key"));
});

test("presa in carico: id della segnalazione prenotato e numero del tentativo", () => {
  const columns = CONNECTOR_DDL.find((s) => s.includes("reserved_use_case_id"));
  assert.ok(columns);
  // Nullable e senza default: NULL marca le righe del codice precedente (mai riprese).
  assert.match(columns, /ADD COLUMN IF NOT EXISTS reserved_use_case_id uuid,/);
  assert.doesNotMatch(columns, /reserved_use_case_id uuid (NOT NULL|DEFAULT)/);
  assert.match(columns, /ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1/);
  assert.doesNotMatch(columns, /REFERENCES/);
  assert.match(CONNECTOR_PROBE_SQL, /column_name = 'reserved_use_case_id'\s+AND is_nullable = 'YES'\s+AND column_default IS NULL/);
  assert.match(CONNECTOR_PROBE_SQL, /column_name = 'attempt'\s+AND is_nullable = 'NO'/);
});

test("DDL idempotente, senza cancellazioni; l'unica estensione è unaccent", () => {
  const extensions = CONNECTOR_DDL.filter((s) => /CREATE\s+EXTENSION/i.test(s));
  assert.deepEqual(extensions, ["CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;"]);
  for (const statement of CONNECTOR_DDL) {
    assert.doesNotMatch(statement, /DROP\s+(TABLE|INDEX|COLUMN|TRIGGER|FUNCTION|CONSTRAINT|EXTENSION)/i);
    if (/^CREATE (TABLE|UNIQUE INDEX|INDEX)/.test(statement)) assert.match(statement, /IF NOT EXISTS/);
    if (/ADD COLUMN/.test(statement)) {
      for (const add of statement.match(/ADD COLUMN[^,;]*/g) ?? []) assert.match(add, /ADD COLUMN IF NOT EXISTS/);
    }
    if (/^CREATE (OR REPLACE )?(FUNCTION|TRIGGER)/.test(statement)) assert.match(statement, /^CREATE OR REPLACE/);
    if (/^UPDATE/.test(statement)) assert.match(statement, /WHERE [a-z_]+ IS NULL/);
  }
  assert.doesNotMatch(migration, /pg_trgm/i);
  assert.deepEqual(migration.match(/CREATE\s+EXTENSION[^;]*;/gi), ["CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;"]);
});

test("principal_key: backfill dal token prima del NOT NULL; integration_token_id diventa nullable", () => {
  const at = (needle: string) => CONNECTOR_DDL.findIndex((s) => s.includes(needle));
  const add = at("ADD COLUMN IF NOT EXISTS principal_key");
  const dropNotNull = at("integration_token_id DROP NOT NULL");
  const backfill = at("SET principal_key = 'token:' || integration_token_id::text");
  const notNull = at("principal_key SET NOT NULL");
  assert.ok(add >= 0 && add < backfill && dropNotNull < backfill && backfill < notNull);
  assert.ok(CONNECTOR_DDL.some((s) => s.includes("(workspace_id, principal_key, idempotency_key)")));
});

test("status_changed_at: trigger BEFORE UPDATE con IS DISTINCT FROM, backfill senza updated_at", () => {
  const backfill = CONNECTOR_DDL.find((s) => s.includes("SET status_changed_at"));
  assert.ok(backfill);
  assert.match(backfill, /COALESCE\(submitted_at, created_at\) AT TIME ZONE 'UTC'/);
  assert.doesNotMatch(backfill, /updated_at/);
  const fn = CONNECTOR_DDL.find((s) => s.includes("FUNCTION use_cases_touch_status_changed_at"));
  assert.ok(fn);
  assert.match(fn, /NEW\.status IS DISTINCT FROM OLD\.status/);
  assert.match(fn, /NEW\.portfolio_review_status IS DISTINCT FROM OLD\.portfolio_review_status/);
  assert.ok(CONNECTOR_DDL.some((s) => /BEFORE UPDATE ON use_cases/.test(s)));
});

test("codice: CHECK sul formato del contratto e indice unico parziale per workspace", () => {
  assert.ok(CONNECTOR_DDL.some((s) => s.includes("code ~ '^[A-Z]{2,4}-[0-9]{4,5}$'")));
  assert.ok(CONNECTOR_DDL.some((s) => s.includes("ON use_cases (workspace_id, code) WHERE code IS NOT NULL")));
  assert.ok(CONNECTOR_DDL.some((s) => s.includes("code_prefix ~ '^[A-Z]{2,4}$'")));
  assert.ok(CONNECTOR_DDL.some((s) => s.includes("slug ~ '^[a-z0-9-]{3,40}$'")));
});

test("limiti predefiniti uguali nella colonna e nel modulo", () => {
  const config = CONNECTOR_DDL.find((s) => s.includes("CREATE TABLE IF NOT EXISTS workspace_connector_configs"));
  const literal = config?.match(/limits jsonb NOT NULL DEFAULT '([^']+)'::jsonb/)?.[1];
  assert.ok(literal);
  assert.deepEqual(JSON.parse(literal), CONNECTOR_DEFAULT_LIMITS);
  assert.deepEqual(CONNECTOR_DEFAULT_LIMITS, {
    submitsPerHour: 200,
    readsPerHour: 3000,
    submitsPerDayWorkspace: 1000,
    submitsPerHourPerUser: 10,
  });
});

test("ensure-schema: versione 14, DDL del connettore nel self-heal e nel probe", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 14, "ENSURE_VERSION almeno 14 (0019; l'hub la porta a 15)");
  assert.match(ensureSchema, /await runConnectorDdl\(\);/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(CONNECTOR_PROBE_SQL\)\}/);
  for (const name of [
    "connector_identities",
    "workspace_connector_configs",
    "connector_rate_limits",
    "use_cases_workspace_code_idx",
    "external_contribution_principal_idempotency_idx",
    "use_cases_status_changed_at",
  ]) {
    assert.ok(CONNECTOR_PROBE_SQL.includes(name), name);
  }
});
