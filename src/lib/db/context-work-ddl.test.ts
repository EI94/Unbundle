import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import { CONTEXT_DDL } from "./context-ddl.ts";
import {
  CONTEXT_WORK_ADVISORY_LOCK,
  CONTEXT_WORK_DDL,
  CONTEXT_WORK_INDEXES,
  CONTEXT_WORK_NAMED_CONSTRAINTS,
  CONTEXT_WORK_NOTICE_KINDS,
  CONTEXT_WORK_PROBE_SQL,
  CONTEXT_WORK_ROLL_FORWARD_SQL,
  CONTEXT_WORK_ROLL_FORWARD_STATEMENTS,
  CONTEXT_WORK_ROLLBACK_SWEEP_SQL,
  CONTEXT_WORK_ROLLBACK_SWEEP_STATEMENTS,
  CONTEXT_WORK_TABLE,
  CONTEXT_WORK_WIDENED_CHECKS,
  MISSING_CONTEXT_FOR_WORK_MESSAGE,
  NEED_LINK_STATUSES_0041,
  USE_CASE_NOTIFICATION_KINDS_0041,
} from "./context-work-ddl.ts";
import { ALERTS_ADVISORY_LOCK, notificationKindsWideningDdl } from "./use-case-hub-alerts-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0036 } from "./use-case-hub-evals-ddl.ts";
import { CONTEXT_CHANNELS, LEARNED_SOURCE_PREFIX, NEED_LINK_STATUSES, SOURCE_KINDS, SOURCE_ORIGINS } from "../context/vocab.ts";
import * as schema from "./schema.ts";

// Migrazione 0041 e self-heal: «Contesto nel lavoro» (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §3). Le
// prove sul database stanno in src/lib/context/work/work.integration.test.ts. ENSURE_VERSION 35.

const migration = readFileSync(new URL("../../../drizzle/0041_contesto_nel_lavoro.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");
const doctor = readFileSync(new URL("../../../scripts/use-case-admin/doctor.ts", import.meta.url), "utf8");
const runbook = readFileSync(new URL("../../../docs/casi-duso/RUNBOOK.md", import.meta.url), "utf8");

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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:context-work-ddl'));"];
const links = CONTEXT_WORK_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${CONTEXT_WORK_TABLE} (`)) ?? "";

const COLUMN = /^([a-z_][a-z0-9_]*) (uuid|varchar|integer|timestamptz)\b/;
const ddlColumns = (statement: string) =>
  statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(COLUMN)?.[1])
    .filter((n): n is string => Boolean(n));

/** I valori di un CHECK `colonna IN ('a', 'b')` con quel nome, in uno statement. */
function checkValues(statement: string, constraint: string): string[] {
  const match = statement.match(new RegExp(`CONSTRAINT ${constraint} CHECK \\((?:[a-z_]+ IS NULL OR )?[a-z_]+ IN \\(([^)]+)\\)\\)`));
  assert.ok(match, `manca ${constraint}`);
  return match[1].split(",").map((v) => v.trim().replace(/^'|'$/g, ""));
}

test("0041: le due righe di apertura, poi gli 11 statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))), "il file comincia con lock_timeout e l'advisory lock");
  assert.equal(CONTEXT_WORK_ADVISORY_LOCK, "unbundle:context-work-ddl");
  assert.equal(CONTEXT_WORK_DDL.length, 11);
  let cursor = 0;
  for (const statement of CONTEXT_WORK_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...CONTEXT_WORK_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0041_contesto_nel_lavoro\.sql/);
  assert.match(migration, /dopo la 0040,\s+-- ENSURE_VERSION 35/);
  assert.match(migration, /src\/lib\/db\/context-work-ddl\.ts/);
});

test("11 statement: il controllo della 0038, tre allargamenti, la tabella, quattro indici, il lock della 0025, la campanella", () => {
  const kinds = CONTEXT_WORK_DDL.map((s) =>
    s.startsWith("DO $$ BEGIN\n  IF to_regclass")
      ? "controllo"
      : s.startsWith("DO $$ BEGIN\n  IF NOT EXISTS")
        ? "allargamento"
        : s.startsWith("CREATE TABLE IF NOT EXISTS ")
          ? "tabella"
          : /^CREATE (UNIQUE )?INDEX IF NOT EXISTS /.test(s)
            ? "indice"
            : s.startsWith("SELECT pg_advisory_xact_lock(")
              ? "lock"
              : s.startsWith("DO $$\nDECLARE")
                ? "campanella"
                : "altro",
  );
  assert.deepEqual(kinds, ["controllo", "allargamento", "allargamento", "allargamento", "tabella", "indice", "indice", "indice", "indice", "lock", "campanella"]);
  assert.match(CONTEXT_WORK_DDL[0], /IF to_regclass\('public\.context_sources'\) IS NULL OR to_regclass\('public\.use_case_needs'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(CONTEXT_WORK_DDL[0].includes(`'${MISSING_CONTEXT_FOR_WORK_MESSAGE}'`));
  assert.equal(MISSING_CONTEXT_FOR_WORK_MESSAGE, "contesto nel lavoro: manca la 0038. Applica prima drizzle/0038_contesto.sql.");
  const indexes = CONTEXT_WORK_DDL.map((s) => s.match(/^CREATE (?:UNIQUE )?INDEX IF NOT EXISTS (\w+) ON/)?.[1]).filter(Boolean);
  assert.deepEqual(indexes, [...CONTEXT_WORK_INDEXES]);
});

test("solo aggiunte: niente DROP TABLE, TRUNCATE, DELETE, UPDATE, INSERT, ALTER COLUMN; ogni DROP CONSTRAINT nel suo blocco DO con l'ADD dello stesso nome", () => {
  for (const statement of CONTEXT_WORK_DDL) {
    assert.doesNotMatch(statement, /DROP\s+(TABLE|COLUMN|INDEX)|\bTRUNCATE\b|\bDELETE FROM\b|\bUPDATE\b|\bINSERT INTO\b|ALTER\s+COLUMN|ADD\s+COLUMN|\bRENAME\b|CREATE\s+EXTENSION/i, statement.slice(0, 70));
    assert.doesNotMatch(statement, /\buc_[a-z_]+/, "il DDL uc non cambia");
    for (const dropped of statement.matchAll(/DROP CONSTRAINT IF EXISTS (\w+)/g)) {
      assert.ok(statement.startsWith("DO $$"), `${dropped[1]}: il DROP sta in un blocco DO`);
      assert.ok(new RegExp(`ADD CONSTRAINT ${dropped[1]} CHECK`).test(statement), `${dropped[1]}: rimesso con lo stesso nome nello stesso blocco`);
    }
  }
  // I DROP sono solo quelli dei quattro CHECK allargati.
  const dropped = CONTEXT_WORK_DDL.flatMap((s) => [...s.matchAll(/DROP CONSTRAINT IF EXISTS (\w+)/g)].map((m) => m[1]));
  assert.deepEqual(dropped, ["context_sources_kind_check", "context_sources_origin_check", "context_events_channel_check", "use_case_notifications_kind_check"]);
});

test("i tre CHECK allargati: la lista nuova è quella della 0038 con i valori nuovi in fondo, e il blocco salta se ci sono già", () => {
  const table0038 = (name: string) => CONTEXT_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`)) ?? "";
  assert.deepEqual(
    CONTEXT_WORK_WIDENED_CHECKS.map((c) => [c.constraint, [...c.added]]),
    [
      ["context_sources_kind_check", ["risposta"]],
      ["context_sources_origin_check", ["rispondi"]],
      ["context_events_channel_check", ["cli", "rispondi"]],
    ],
  );
  CONTEXT_WORK_WIDENED_CHECKS.forEach((c, i) => {
    const before = checkValues(table0038(c.table), c.constraint);
    // La lista di prima, tutta e nello stesso ordine, poi i valori nuovi (o già c'erano, come `cli` nell'origine).
    assert.deepEqual([...c.values].slice(0, before.length), before, c.constraint);
    for (const value of c.added) assert.ok(c.values.includes(value), `${c.constraint}: ${value}`);
    assert.deepEqual(new Set(c.values).size, c.values.length, `${c.constraint}: senza doppioni`);
    const block = CONTEXT_WORK_DDL[1 + i];
    assert.ok(block.includes(`ADD CONSTRAINT ${c.constraint} CHECK (${c.column} IN (${c.values.map((v) => `'${v}'`).join(", ")}));`), c.constraint);
    assert.ok(block.includes(`conname = '${c.constraint}' AND conrelid = 'public.${c.table}'::regclass`), c.constraint);
    for (const value of c.added) assert.ok(block.includes(`position('''${value}''' IN pg_get_constraintdef(oid)) > 0`), `${c.constraint}: salta se c'è già ${value}`);
    // Le colonne della 0038 tengono i valori nuovi.
    const width = Number(table0038(c.table).match(new RegExp(`\\n  ${c.column} varchar\\((\\d+)\\)`))?.[1]);
    for (const value of c.values) assert.ok(value.length <= width, `${c.table}.${c.column}: «${value}» sta in varchar(${width})`);
  });
});

test("i tre CHECK allargati elencano gli stessi valori del vocabolario, nello stesso ordine", () => {
  const byConstraint = new Map(CONTEXT_WORK_WIDENED_CHECKS.map((c) => [c.constraint, [...c.values]]));
  assert.deepEqual(byConstraint.get("context_sources_kind_check"), [...SOURCE_KINDS]);
  assert.deepEqual(byConstraint.get("context_sources_origin_check"), [...SOURCE_ORIGINS]);
  assert.deepEqual(byConstraint.get("context_events_channel_check"), [...CONTEXT_CHANNELS]);
});

test("la campanella: i tipi della 0036 più contesto_nuovo e dalla_call, entro 16 caratteri, sotto il lock della 0025, e la pulizia del ritorno indietro", () => {
  assert.deepEqual([...CONTEXT_WORK_NOTICE_KINDS], ["contesto_nuovo", "dalla_call"]);
  assert.deepEqual(USE_CASE_NOTIFICATION_KINDS_0041, [...USE_CASE_NOTIFICATION_KINDS_0036, "contesto_nuovo", "dalla_call"]);
  for (const kind of USE_CASE_NOTIFICATION_KINDS_0041) assert.ok(kind.length <= 16, kind);
  // Il lock della 0025 è il penultimo, l'allargamento della campanella l'ultimo: lo stesso blocco della 0025.
  assert.equal(CONTEXT_WORK_DDL[CONTEXT_WORK_DDL.length - 2], `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`);
  assert.equal(CONTEXT_WORK_DDL[CONTEXT_WORK_DDL.length - 1], notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0041));
});

test("il ritorno indietro: la campanella nuova via, e «superate» le proposte aperte delle risposte e delle cose imparate; idempotente", () => {
  assert.equal(CONTEXT_WORK_ROLLBACK_SWEEP_SQL, CONTEXT_WORK_ROLLBACK_SWEEP_STATEMENTS.join("\n"), "un testo solo da incollare");
  assert.deepEqual(CONTEXT_WORK_ROLLBACK_SWEEP_STATEMENTS, [
    "DELETE FROM use_case_notifications WHERE kind IN ('contesto_nuovo', 'dalla_call');",
    "UPDATE context_proposals p SET status = 'superata', decided_at = now(), updated_at = now(), version = p.version + 1 FROM context_sources s WHERE s.id = p.source_id AND s.workspace_id = p.workspace_id AND p.status = 'aperta' AND (s.kind = 'risposta' OR (s.origin = 'cli' AND s.external_id LIKE 'impara:%'));",
  ]);
  // Il prefisso delle cose imparate è quello del vocabolario; solo le proposte aperte (una seconda volta non cambia niente).
  assert.ok(CONTEXT_WORK_ROLLBACK_SWEEP_SQL.includes(`s.external_id LIKE '${LEARNED_SOURCE_PREFIX}%'`));
  for (const statement of CONTEXT_WORK_ROLLBACK_SWEEP_STATEMENTS) assert.doesNotMatch(statement, /\b(DROP|TRUNCATE|ALTER)\b/, statement);
});

test("il ritorno in avanti: prima le citazioni delle risposte di una richiesta cancellata dal codice di prima, poi le fonti lette vuote", () => {
  assert.equal(CONTEXT_WORK_ROLL_FORWARD_SQL, CONTEXT_WORK_ROLL_FORWARD_STATEMENTS.join("\n"));
  const [purge, proposals, ...rest] = CONTEXT_WORK_ROLL_FORWARD_STATEMENTS;
  const purged = "SELECT s.id FROM context_sources s JOIN use_case_referent_requests r ON r.workspace_id = s.workspace_id AND r.id::text = s.external_id WHERE s.origin = 'rispondi' AND s.kind = 'risposta' AND r.purged_at IS NOT NULL";
  // La fonte non si legge più (con la riga di storia, come la cancellazione del codice nuovo), solo una volta.
  assert.match(purge, /^WITH purged AS \(UPDATE context_sources s SET text_purged_at = now\(\), /);
  assert.ok(purge.includes(`WHERE s.text_purged_at IS NULL AND s.id IN (${purged}) RETURNING s.id, s.workspace_id)`));
  assert.ok(purge.endsWith("INSERT INTO context_events (workspace_id, action, channel, source_id) SELECT workspace_id, 'testo_cancellato', 'rispondi', id FROM purged;"));
  assert.equal(proposals, `UPDATE context_proposals p SET status = 'superata', decided_at = now(), quote = NULL, updated_at = now(), version = p.version + 1 WHERE p.status = 'aperta' AND p.source_id IN (${purged});`);
  assert.deepEqual(rest.slice(0, 4), ["context_proposals", "context_facts", "context_commitments", "context_questions"].map((table) => `UPDATE ${table} x SET quote = NULL WHERE x.quote IS NOT NULL AND x.source_id IN (${purged});`));
  // Per ultimo, le fonti lette vuote dal codice di prima tornano da leggere: non quelle cancellate qui sopra.
  assert.deepEqual(rest.slice(4), ["UPDATE context_sources SET read_status = 'da_leggere', read_reason = NULL, read_attempts = 0 WHERE origin = 'rispondi' AND read_reason = 'vuoto' AND text_purged_at IS NULL;"]);
  for (const statement of CONTEXT_WORK_ROLL_FORWARD_STATEMENTS) assert.doesNotMatch(statement, /\b(DELETE|DROP|TRUNCATE|ALTER)\b/, statement);
});

test("context_need_links: le colonne e i CHECK del piano; si cancella con il workspace, con l'esigenza e con il fatto", () => {
  assert.ok(links, "manca la tabella");
  assert.deepEqual(ddlColumns(links), ["id", "workspace_id", "need_id", "proposal_id", "fact_id", "status", "decided_by_user_id", "decided_at", "version", "created_at", "updated_at"]);
  assert.match(links, /\n {2}workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE,/);
  assert.match(links, /\n {2}need_id uuid NOT NULL REFERENCES use_case_needs\(id\) ON DELETE CASCADE,/);
  assert.match(links, /\n {2}proposal_id uuid REFERENCES context_proposals\(id\) ON DELETE SET NULL,/);
  assert.match(links, /\n {2}fact_id uuid REFERENCES context_facts\(id\) ON DELETE CASCADE,/);
  assert.match(links, /\n {2}decided_by_user_id uuid REFERENCES users\(id\) ON DELETE SET NULL,/);
  assert.deepEqual(checkValues(links, "context_need_links_status_check"), [...NEED_LINK_STATUSES]);
  assert.deepEqual([...NEED_LINK_STATUSES_0041], [...NEED_LINK_STATUSES]);
  assert.match(links, /status varchar\(9\) NOT NULL DEFAULT 'proposta'/);
  for (const status of NEED_LINK_STATUSES) assert.ok(status.length <= 9, status);
  // `aperta` e `usata` hanno sempre un fatto; `usata` e `scartata` sempre una data della decisione.
  assert.match(links, /CONSTRAINT context_need_links_fact_check CHECK \(status IN \('proposta', 'scartata'\) OR fact_id IS NOT NULL\)/);
  assert.match(links, /CONSTRAINT context_need_links_decided_check CHECK \(\(status IN \('usata', 'scartata'\)\) = \(decided_at IS NOT NULL\)\)/);
  // Una proposta un legame; un fatto una volta per richiesta; i legami aperti; i fatti da verificare.
  assert.ok(CONTEXT_WORK_DDL.includes("CREATE UNIQUE INDEX IF NOT EXISTS context_need_links_proposal_unique ON context_need_links (proposal_id) WHERE proposal_id IS NOT NULL;"));
  assert.ok(CONTEXT_WORK_DDL.includes("CREATE UNIQUE INDEX IF NOT EXISTS context_need_links_fact_unique ON context_need_links (need_id, fact_id) WHERE fact_id IS NOT NULL;"));
  assert.ok(CONTEXT_WORK_DDL.includes("CREATE INDEX IF NOT EXISTS context_need_links_open_idx ON context_need_links (workspace_id, need_id) WHERE status = 'aperta';"));
  assert.ok(CONTEXT_WORK_DDL.includes("CREATE INDEX IF NOT EXISTS context_facts_to_check_idx ON context_facts (workspace_id) WHERE needs_check AND status = 'attivo';"));
  // Nessuna colonna di testo: il fatto e l'esigenza si leggono dove sono.
  assert.doesNotMatch(links, /\b(text|statement|title|quote)\b/);
});

test("la sonda: la tabella con la sua chiave e i suoi CHECK, i quattro indici, i tre CHECK con i valori nuovi, la campanella", () => {
  assert.ok(CONTEXT_WORK_PROBE_SQL.includes(`to_regclass('public.${CONTEXT_WORK_TABLE}') IS NOT NULL`));
  for (const index of CONTEXT_WORK_INDEXES) assert.ok(CONTEXT_WORK_PROBE_SQL.includes(`to_regclass('public.${index}') IS NOT NULL`), index);
  const named = [...links.matchAll(/CONSTRAINT (\w+) /g)].map((m) => m[1]);
  assert.deepEqual([...named].sort(), [...CONTEXT_WORK_NAMED_CONSTRAINTS].sort(), "ogni vincolo con nome della tabella");
  for (const name of CONTEXT_WORK_NAMED_CONSTRAINTS) assert.ok(CONTEXT_WORK_PROBE_SQL.includes(`'${name}'`), name);
  assert.ok(CONTEXT_WORK_PROBE_SQL.includes(`) = ${CONTEXT_WORK_NAMED_CONSTRAINTS.length}`));
  for (const c of CONTEXT_WORK_WIDENED_CHECKS) {
    assert.ok(CONTEXT_WORK_PROBE_SQL.includes(`c.conrelid = to_regclass('public.${c.table}') AND c.conname = '${c.constraint}'`), c.constraint);
    for (const value of c.added) assert.ok(CONTEXT_WORK_PROBE_SQL.includes(`position('''${value}''' IN pg_get_constraintdef(c.oid)) > 0`), value);
  }
  assert.ok(CONTEXT_WORK_PROBE_SQL.includes("c.conrelid = to_regclass('public.use_case_notifications') AND c.conname = 'use_case_notifications_kind_check'"));
  for (const kind of CONTEXT_WORK_NOTICE_KINDS) assert.ok(CONTEXT_WORK_PROBE_SQL.includes(`position('''${kind}''' IN pg_get_constraintdef(c.oid)) > 0`), kind);
});

test("ensure-schema: versione 35, la 0041 dopo la 0040, saltata in anteprima, non fatale, con il suo lock, il nuovo tentativo e la sonda in AND", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 35, "ENSURE_VERSION almeno 35");
  assert.match(ensureSchema, /import \{ CONTEXT_WORK_ADVISORY_LOCK, CONTEXT_WORK_DDL, CONTEXT_WORK_PROBE_SQL \} from "\.\/context-work-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const templates = runOnce.indexOf("await runTemplateFilesDdlSafely();");
  const ours = runOnce.indexOf("await runContextWorkDdlSafely();");
  assert.ok(templates > 0 && ours > templates, "la 0041 dopo la 0040");
  assert.ok(!runOnce.includes("await runContextWorkDdl();"), "la 0041 passa solo dalla versione che non lancia");
  const safe = topLevelFunction(ensureSchema, "async function runContextWorkDdlSafely(): Promise<void> {");
  // Mai da un'anteprima di Vercel: le anteprime usano il database di produzione.
  assert.match(safe, /^async function runContextWorkDdlSafely\(\): Promise<void> \{\s+if \(process\.env\.VERCEL_ENV === "preview"\) return;/);
  assert.match(safe, /try \{\s+await runContextWorkDdl\(\);\s+contextWorkDdlFailedAt = null;\s+\} catch \(err\) \{\s+contextWorkDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe), "nessun rilancio");
  assert.match(safe, /0041 self-heal failed/);
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(
    ensure,
    /if \(contextWorkDdlFailedAt !== null && Date\.now\(\) - contextWorkDdlFailedAt >= REFERENTS_DDL_RETRY_MS\) \{\s+contextWorkDdlFailedAt = Date\.now\(\);\s+ensurePromise = ensurePromise\.then\(runContextWorkDdlSafely\);/,
  );
  const runner = topLevelFunction(ensureSchema, "export async function runContextWorkDdl(statements: readonly string[] = CONTEXT_WORK_DDL): Promise<void> {");
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") > 0);
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") < runner.indexOf("pg_advisory_xact_lock(hashtext('${CONTEXT_WORK_ADVISORY_LOCK}'))"));
  assert.match(ensureSchema, /AND \$\{sql\.raw\(TEMPLATE_FILES_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(CONTEXT_WORK_PROBE_SQL\)\}/);
});

test("le colonne Drizzle di contextNeedLinks sono quelle del DDL, nello stesso ordine, con NOT NULL e lunghezze", () => {
  assert.equal(getTableName(schema.contextNeedLinks), CONTEXT_WORK_TABLE);
  const columns = Object.values(getTableColumns(schema.contextNeedLinks));
  assert.deepEqual(columns.map((c) => c.name), ddlColumns(links));
  for (const column of columns) {
    const line = links.split("\n").find((l) => l.trim().startsWith(`${column.name} `)) ?? "";
    assert.equal(column.notNull, /\bNOT NULL\b/.test(line), `${column.name}: NOT NULL`);
    const length = line.match(/ varchar\((\d+)\)/)?.[1];
    if (length) assert.equal((column as unknown as { length?: number }).length, Number(length), `${column.name}: lunghezza`);
  }
  // La campanella accetta i tipi nuovi anche nello schema (il tipo della colonna `kind`).
  const kind = getTableColumns(schema.useCaseNotifications).kind as unknown as { length?: number };
  assert.equal(kind.length, 16);
});

test("il doctor guarda la sonda della 0041", () => {
  assert.match(doctor, /import \{ CONTEXT_WORK_PROBE_SQL \} from "\.\.\/\.\.\/src\/lib\/db\/context-work-ddl\.ts";/);
  assert.match(doctor, /const m0041 = \(await ctx\.db\.read\(`SELECT \$\{CONTEXT_WORK_PROBE_SQL\} AS ok`\)\)\[0\]\?\.ok === true;/);
  assert.match(doctor, /migrazione0041: m0041,/);
});

test("RUNBOOK §10.22: la 0041 la applica l'app, a mano solo di riserva, il ritorno indietro con la pulizia; §7.2 «Cerca una persona»", () => {
  const title = "### 10.22 Rilascio 9b: «Contesto nel lavoro» (0041)";
  assert.ok(runbook.includes(title), "manca §10.22");
  const section = runbook.slice(runbook.indexOf(title));
  assert.match(section, /`ENSURE_VERSION` 35/);
  assert.match(section, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0041_contesto_nel_lavoro\.sql/);
  assert.match(section, /`migrazione0041: true`/);
  assert.match(section, /Mai drizzle-kit, mai `db:push`/);
  assert.match(section, /\*\*Ritorno indietro:\*\*/);
  // Gli statement nei blocchi di codice del RUNBOOK (rientrati nella lista), uno per riga, uguali a quelli del modulo.
  for (const statement of CONTEXT_WORK_ROLLBACK_SWEEP_STATEMENTS) assert.ok(section.includes(`\n   ${statement}\n`), statement);
  const back = section.slice(section.indexOf("**Ritorno indietro:**"), section.indexOf("**Dopo il deploy, a mano**"));
  assert.match(back, /1\. Prima del Promote: `CONTEXT_WORK_ROLLBACK_SWEEP_SQL`/);
  assert.match(back, /3\. Subito dopo il Promote, di nuovo `CONTEXT_WORK_ROLLBACK_SWEEP_SQL`/);
  assert.match(back, /isClientSource/, "dice perché le proposte delle risposte e delle cose imparate diventano «superate»");
  for (const statement of CONTEXT_WORK_ROLL_FORWARD_STATEMENTS) assert.ok(section.includes(`\n   ${statement}\n`), statement);
  assert.match(back, /Al ritorno in avanti \(subito dopo il deploy nuovo\): `CONTEXT_WORK_ROLL_FORWARD_SQL`/);
  assert.ok(section.includes(`\`${CONTEXT_WORK_TABLE}\``));
  // Il numero del codice non torna mai sotto quello del documento (la 0042, «Le evals dalla CI», lo porta a 36).
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 35);
  const people = runbook.slice(runbook.indexOf("### 7.2 "), runbook.indexOf("### 7.3 "));
  assert.match(people, /«Contesto» › «Appunti» › «Cerca una persona», con il nome e con l'e-mail; «Togli … da tutto»/);
  assert.match(people, /si cancellano solo su richiesta esplicita/);
  // Il pacchetto non si rifà da solo: `CONTESTO.md` nel repository del caso tiene il testo vecchio.
  assert.match(people, /Dopo «Togli … da tutto», per ogni use case con un dossier i cui fatti sono cambiati, premere «Aggiorna il pacchetto»/);
  assert.match(people, /`CONTESTO\.md` nel repository del caso tiene il testo vecchio fino al pacchetto successivo/);
});
