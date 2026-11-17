import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REFERENT_LIMITS } from "../use-cases/referent/contract.ts";
import { USE_CASE_REFERENTS_DDL } from "./use-case-hub-referents-ddl.ts";
import {
  MISSING_REFERENTS_FOR_TEMPLATES_MESSAGE,
  TEMPLATE_DELETED_REASONS,
  TEMPLATE_FILES_ADVISORY_LOCK,
  TEMPLATE_FILES_DDL,
  TEMPLATE_FILES_INDEXES,
  TEMPLATE_FILES_NAMED_CONSTRAINTS,
  TEMPLATE_FILES_PROBE_SQL,
  TEMPLATE_FILES_TABLES,
  TEMPLATE_FILE_KINDS,
  TEMPLATE_MAX_BYTES,
  TEMPLATE_SCAN_STATUSES,
} from "./use-case-hub-template-files-ddl.ts";

// Migrazione 0040 e self-heal: «File da compilare» (i file che il team allega alle esigenze per il referente). Una
// tabella a parte da use_case_need_files: un file da compilare non è una risposta. ENSURE_VERSION 34.

const migration = readFileSync(new URL("../../../drizzle/0040_file_da_compilare.sql", import.meta.url), "utf8");
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-template-files-ddl'));"];
const table = (name: string) => {
  const statement = TEMPLATE_FILES_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`));
  assert.ok(statement, `manca la tabella ${name}`);
  return statement;
};
const files = table("use_case_template_files");
const links = table("use_case_template_links");
const downloads = table("use_case_template_downloads");

const ddlColumns = (statement: string) =>
  statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|text|timestamptz|integer|char|boolean|jsonb)\b/)?.[1])
    .filter((n): n is string => Boolean(n));

/** Il testo di un CHECK con nome, fino alla virgola della colonna o del vincolo. */
function check(statement: string, constraint: string): string {
  const at = statement.indexOf(`CONSTRAINT ${constraint} CHECK (`);
  assert.notEqual(at, -1, `manca ${constraint}`);
  return statement.slice(at).split("\n")[0].replace(/,$/, "");
}

const inList = (values: readonly string[]) => `(${values.map((value) => `'${value}'`).join(", ")})`;

test("0040: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))));
  assert.equal(TEMPLATE_FILES_ADVISORY_LOCK, "unbundle:use-case-template-files-ddl");
  let cursor = 0;
  for (const statement of TEMPLATE_FILES_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...TEMPLATE_FILES_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0040_file_da_compilare\.sql/);
  assert.match(migration, /dopo la 0039, ENSURE_VERSION 34/);
});

test("solo aggiunte: il controllo della 0024, poi CREATE … IF NOT EXISTS; nessuna tabella di prima toccata", () => {
  assert.match(TEMPLATE_FILES_DDL[0], /IF to_regclass\('public\.use_case_referent_requests'\) IS NULL OR to_regclass\('public\.use_case_needs'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(TEMPLATE_FILES_DDL[0].includes(`'${MISSING_REFERENTS_FOR_TEMPLATES_MESSAGE}'`));
  for (const statement of TEMPLATE_FILES_DDL.slice(1)) {
    assert.match(statement, /^CREATE (TABLE|INDEX) IF NOT EXISTS use_case_template_/, statement.slice(0, 70));
  }
  for (const statement of TEMPLATE_FILES_DDL) {
    assert.doesNotMatch(statement, /\bALTER\b|\bDROP\b|\bRENAME\b|\bTRUNCATE\b|\bINSERT\b|\bUPDATE\b|\bDELETE FROM\b|CREATE\s+EXTENSION|CREATE\s+(OR REPLACE\s+)?(FUNCTION|TRIGGER)/i);
  }
  // Le tabelle e gli indici della sonda sono esattamente quelli creati.
  const tables = TEMPLATE_FILES_DDL.map((s) => s.match(/^CREATE TABLE IF NOT EXISTS (\w+) \(/)?.[1]).filter(Boolean);
  assert.deepEqual(tables, [...TEMPLATE_FILES_TABLES]);
  const indexes = TEMPLATE_FILES_DDL.map((s) => s.match(/^CREATE INDEX IF NOT EXISTS (\w+) ON/)?.[1]).filter(Boolean);
  assert.deepEqual(indexes, [...TEMPLATE_FILES_INDEXES]);
});

test("i vincoli con nome sono tutti nella sonda, e la sonda non ne cerca altri", () => {
  const named = TEMPLATE_FILES_DDL.flatMap((s) => [...s.matchAll(/CONSTRAINT (\w+) /g)].map((m) => m[1]));
  assert.deepEqual([...named].sort(), [...TEMPLATE_FILES_NAMED_CONSTRAINTS].sort());
  assert.equal(new Set(TEMPLATE_FILES_NAMED_CONSTRAINTS).size, TEMPLATE_FILES_NAMED_CONSTRAINTS.length);
  for (const name of [...TEMPLATE_FILES_TABLES, ...TEMPLATE_FILES_INDEXES]) assert.ok(TEMPLATE_FILES_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
  for (const name of TEMPLATE_FILES_NAMED_CONSTRAINTS) assert.ok(TEMPLATE_FILES_PROBE_SQL.includes(`'${name}'`), name);
  assert.ok(TEMPLATE_FILES_PROBE_SQL.includes(`) = ${TEMPLATE_FILES_NAMED_CONSTRAINTS.length}`));
});

test("la stessa catena dei file di «Cosa serve»: tipi, stati, limiti e i quattro CHECK di coerenza", () => {
  const needFiles = USE_CASE_REFERENTS_DDL.find((s) => s.startsWith("CREATE TABLE IF NOT EXISTS use_case_need_files ("));
  assert.ok(needFiles);
  assert.equal(check(files, "use_case_template_files_kind_check"), `CONSTRAINT use_case_template_files_kind_check CHECK (kind IS NULL OR kind IN ${inList(TEMPLATE_FILE_KINDS)})`);
  assert.equal(check(files, "use_case_template_files_scan_check"), `CONSTRAINT use_case_template_files_scan_check CHECK (scan_status IN ${inList(TEMPLATE_SCAN_STATUSES)})`);
  assert.equal(check(files, "use_case_template_files_deleted_reason_check"), `CONSTRAINT use_case_template_files_deleted_reason_check CHECK (deleted_reason IS NULL OR deleted_reason IN ${inList(TEMPLATE_DELETED_REASONS)})`);
  assert.deepEqual([...TEMPLATE_DELETED_REASONS], ["tolto", "sostituito", "cancellazione"]);
  // Il massimo è quello del caricamento diretto dei file del referente e del team.
  assert.equal(TEMPLATE_MAX_BYTES, REFERENT_LIMITS.clientMaxBytes);
  for (const suffix of ["kind", "scan", "clean", "review", "rejected", "deleted", "reviewed", "sha256", "mode", "findings", "quarantine_path", "blob_path", "size", "max_bytes"]) {
    const ours = check(files, `use_case_template_files_${suffix}_check`).replace(/use_case_template_files_/g, "X_");
    const theirs = check(needFiles, `use_case_need_files_${suffix}_check`).replace(/use_case_need_files_/g, "X_");
    assert.equal(ours, theirs, suffix);
  }
  // Nessuna colonna della persona oltre a chi carica e chi controlla; nessuna richiesta, nessuna esigenza nella riga.
  assert.deepEqual(ddlColumns(files), [
    "id",
    "workspace_id",
    "use_case_id",
    "replaces_id",
    "uploaded_by_user_id",
    "file_name",
    "kind",
    "mime",
    "size_bytes",
    "max_bytes",
    "sha256",
    "upload_mode",
    "scan_status",
    "rejection_reason",
    "findings",
    "personal_warning",
    "quarantine_path",
    "blob_path",
    "created_at",
    "checked_at",
    "reviewed_at",
    "reviewed_by_user_id",
    "deleted_at",
    "deleted_reason",
  ]);
});

test("lo scope sta nel database: workspace e use case in ogni riga, il legame con la chiave composta del suo file", () => {
  for (const statement of [files, links, downloads]) {
    assert.match(statement, /\n {2}workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE,/);
  }
  assert.match(files, /CONSTRAINT use_case_template_files_scope_unique UNIQUE \(id, workspace_id, use_case_id\)/);
  assert.match(files, /FOREIGN KEY \(replaces_id, workspace_id, use_case_id\) REFERENCES use_case_template_files \(id, workspace_id, use_case_id\) ON DELETE SET NULL \(replaces_id\)/);
  assert.match(links, /FOREIGN KEY \(file_id, workspace_id, use_case_id\) REFERENCES use_case_template_files \(id, workspace_id, use_case_id\) ON DELETE CASCADE/);
  assert.match(links, /need_id uuid NOT NULL REFERENCES use_case_needs\(id\) ON DELETE CASCADE/);
  assert.match(links, /PRIMARY KEY \(file_id, need_id\)/);
  // Il primo download: una riga per versione e richiesta, senza una data e senza un dato della persona.
  assert.deepEqual(ddlColumns(downloads), ["file_id", "request_id", "workspace_id"]);
  assert.match(downloads, /PRIMARY KEY \(file_id, request_id\)/);
  assert.match(downloads, /request_id uuid NOT NULL REFERENCES use_case_referent_requests\(id\) ON DELETE CASCADE/);
});

test("ensure-schema: ENSURE_VERSION 34, la 0040 dopo la 0039, non bloccante, con il suo lock e nella sonda", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 34);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const mapping = runOnce.indexOf("await runMappingBoardDdlSafely();");
  const ours = runOnce.indexOf("await runTemplateFilesDdlSafely();");
  assert.ok(mapping > 0 && ours > mapping, "la 0040 dopo la 0039");
  const safe = topLevelFunction(ensureSchema, "async function runTemplateFilesDdlSafely(): Promise<void> {");
  assert.match(safe, /templateFilesDdlFailedAt = Date\.now\(\);/);
  assert.match(safe, /0040 self-heal failed/);
  const run = topLevelFunction(ensureSchema, "export async function runTemplateFilesDdl(");
  assert.match(run, /lock_timeout', '3s'/);
  assert.match(run, /TEMPLATE_FILES_ADVISORY_LOCK/);
  assert.match(ensureSchema, /AND \$\{sql\.raw\(TEMPLATE_FILES_PROBE_SQL\)\}/);
  assert.match(ensureSchema, /templateFilesDdlFailedAt !== null && Date\.now\(\) - templateFilesDdlFailedAt >= REFERENTS_DDL_RETRY_MS/);
  assert.match(doctor, /migrazione0040: m0040,/);
});

test("RUNBOOK §10.21: la 0040 la applica l'app, a mano solo di riserva, e il ritorno indietro", () => {
  const runbook = readFileSync(new URL("../../../docs/casi-duso/RUNBOOK.md", import.meta.url), "utf8");
  assert.ok(runbook.includes("### 10.21 «File da compilare» (0040)"), "manca §10.21");
  const section = runbook.slice(runbook.indexOf("### 10.21 «File da compilare» (0040)"));
  assert.match(section, /`ENSURE_VERSION` 34/);
  assert.match(section, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0040_file_da_compilare\.sql/);
  assert.match(section, /Mai drizzle-kit, mai `db:push`/);
  assert.match(section, /`migrazione0040: true`/);
  assert.match(section, /\*\*Ritorno indietro:\*\*/);
  for (const name of TEMPLATE_FILES_TABLES) assert.ok(section.includes(`\`${name}\``), name);
  // Il numero del codice e quello del documento sono lo stesso.
  assert.equal(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]), 34);
});
