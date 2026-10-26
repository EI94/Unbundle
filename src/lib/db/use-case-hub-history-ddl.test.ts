import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { USE_CASE_EVENT_FIELDS, USE_CASE_HUB_DDL, USE_CASE_NEEDS_EVENT_FIELD, type UseCaseEventField } from "./use-case-hub-ddl.ts";
import {
  FIELDS_CHECK_NAME,
  FIELDS_NOT_VALIDATED_WARNING,
  HISTORY_ADVISORY_LOCK,
  HISTORY_LOCK_TIMEOUT,
  MISSING_EVENTS_MESSAGE,
  USE_CASE_EVENT_FIELDS_0023,
  USE_CASE_HISTORY_DDL,
  USE_CASE_HISTORY_PROBE_SQL,
} from "./use-case-hub-history-ddl.ts";

// Migrazione 0023 e self-heal: «Cosa serve» nella Storia. Le prove sul database (due volte, un
// database come in produzione con righe, mai restringere, self-heal) stanno in
// use-case-hub-history.integration.test.ts e in scripts/use-case-test/schema-check.mjs.

const migration = readFileSync(new URL("../../../drizzle/0023_use_case_needs_history.sql", import.meta.url), "utf8");
const migration0020 = readFileSync(new URL("../../../drizzle/0020_use_case_hub.sql", import.meta.url), "utf8");
const ensureSchema = readFileSync(new URL("./ensure-schema.ts", import.meta.url), "utf8");

/** SQL senza le righe di commento `--`, con gli spazi compressi. */
function normalize(sql: string) {
  return sql
    .split("\n")
    .filter((line) => !line.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ")
    .trim();
}

/** Una funzione di primo livello di `source`, dalla firma alla prima `}` a inizio riga. */
function topLevelFunction(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `manca: ${signature}`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `fine non trovata: ${signature}`);
  return source.slice(start, end + 2);
}

const block = USE_CASE_HISTORY_DDL[0];

test("0023: lo statement del self-heal, identico, e nient'altro", () => {
  assert.equal(USE_CASE_HISTORY_DDL.length, 1);
  assert.ok(migration.includes(block), "il testo della migrazione differisce dal DDL");
  assert.equal(normalize(migration), normalize(block));
});

test("l'elenco: quello della 0020 più cosa_serve; la 0020 non cambia", () => {
  assert.equal(USE_CASE_NEEDS_EVENT_FIELD, "cosa_serve");
  assert.deepEqual(USE_CASE_EVENT_FIELDS_0023, [...USE_CASE_EVENT_FIELDS, "cosa_serve"]);
  assert.ok(!(USE_CASE_EVENT_FIELDS as readonly string[]).includes("cosa_serve"), "l'elenco della 0020 resta quello applicato");
  const list = `ARRAY[${USE_CASE_EVENT_FIELDS_0023.map((name) => `'${name}'`).join(", ")}]::text[]`;
  assert.ok(block.includes(`wanted text[] := ${list};`));
  // Il DDL della 0020 (self-heal e file) crea ancora la Storia con il suo elenco: la 0023 lo allarga dopo.
  const table = USE_CASE_HUB_DDL.find((statement) => statement.startsWith("CREATE TABLE IF NOT EXISTS use_case_events"));
  assert.ok(table && !table.includes("cosa_serve"));
  assert.ok(!migration0020.includes("cosa_serve"));
  // Lo controlla tsc: il campo nuovo è un nome della Storia.
  const field: UseCaseEventField = "cosa_serve";
  assert.equal(field, USE_CASE_NEEDS_EVENT_FIELD);
});

test("idempotente e sicuro: tocca solo il CHECK della Storia, mai i dati, mai restringe", () => {
  assert.match(block, /^DO \$\$\nDECLARE/);
  assert.match(block, /END \$\$;$/);
  // Senza la Storia si ferma, prima di tutto il resto.
  assert.ok(block.indexOf(`RAISE EXCEPTION '${MISSING_EVENTS_MESSAGE}';`) < block.indexOf("ALTER TABLE"));
  assert.doesNotMatch(MISSING_EVENTS_MESSAGE, /[%']/);
  assert.doesNotMatch(FIELDS_NOT_VALIDATED_WARNING, /[%']/);
  // Si sostituisce solo con un nome mancante; dentro quel ramo DROP IF EXISTS e ADD NOT VALID.
  const replace = block.slice(block.indexOf("IF current_def IS NULL"), block.indexOf("current_valid := false;"));
  assert.match(replace, /position\(quote_literal\(w\.name\) \|\| '::text' IN current_def\) = 0\) THEN/);
  assert.match(replace, new RegExp(`ALTER TABLE use_case_events DROP CONSTRAINT IF EXISTS ${FIELDS_CHECK_NAME};`));
  assert.match(replace, new RegExp(`ADD CONSTRAINT ${FIELDS_CHECK_NAME} CHECK \\(fields <@ ARRAY\\['`));
  assert.match(replace, /\]::text\[\]\) NOT VALID';/);
  assert.match(replace, /FROM unnest\(allowed\) WITH ORDINALITY/, "il vincolo nuovo usa l'elenco con i nomi già ammessi");
  // I nomi già ammessi restano, dopo quelli voluti.
  assert.match(block, /allowed := wanted \|\| coalesce\(/);
  assert.match(block, /WHERE found\.name <> ALL \(wanted\)/);
  // VALIDATE solo se nessuna riga esce dall'elenco; altrimenti un WARNING, non un errore.
  const validate = block.slice(block.indexOf("IF NOT current_valid THEN"));
  assert.match(validate, /IF EXISTS \(SELECT 1 FROM use_case_events e WHERE NOT \(e\.fields <@ allowed\)\) THEN\s+RAISE WARNING/);
  assert.match(validate, new RegExp(`ELSE\\s+ALTER TABLE use_case_events VALIDATE CONSTRAINT ${FIELDS_CHECK_NAME};`));
  // Nient'altro: nessuna tabella, colonna, dato o estensione.
  assert.doesNotMatch(block, /CREATE\s+(EXTENSION|TABLE|INDEX)|DROP\s+(TABLE|INDEX|COLUMN|TRIGGER|FUNCTION|NOT NULL|DEFAULT)|ALTER COLUMN|RENAME/i);
  assert.doesNotMatch(block, /^\s*(UPDATE|DELETE|INSERT)\b/im);
  assert.doesNotMatch(block, /\b(UPDATE|DELETE FROM|INSERT INTO)\s+use_case_events\b/i);
  assert.equal(block.match(/ALTER TABLE/g)?.length, 3, "DROP, ADD (in EXECUTE) e VALIDATE del solo vincolo");
  assert.doesNotMatch(migration, /CREATE\s+EXTENSION/i);
});

test("prima di tutto lock_timeout e l'advisory lock del self-heal: mai in coda, mai insieme al self-heal", () => {
  assert.equal(HISTORY_LOCK_TIMEOUT, "3s");
  assert.equal(HISTORY_ADVISORY_LOCK, "unbundle:use-case-history-ddl");
  const body = block.slice(block.indexOf("BEGIN\n"));
  const timeout = body.indexOf(`PERFORM set_config('lock_timeout', '${HISTORY_LOCK_TIMEOUT}', true);`);
  const lock = body.indexOf(`PERFORM pg_advisory_xact_lock(hashtext('${HISTORY_ADVISORY_LOCK}'));`);
  assert.ok(timeout > 0, "lock_timeout locale alla transazione (set_config con is_local = true)");
  assert.ok(lock > timeout, "l'advisory lock dopo il timeout: anche la sua attesa ha un limite");
  // Prima di ogni altra istruzione: il controllo della 0020, il catalogo e gli ALTER TABLE vengono dopo.
  assert.ok(lock < body.indexOf("IF to_regclass('public.use_case_events') IS NULL THEN"));
  assert.ok(lock < body.indexOf("FROM pg_constraint c"));
  assert.ok(lock < body.indexOf("ALTER TABLE"));
  // Nel file, con gli stessi valori (il file è il blocco, verificato sopra).
  assert.ok(migration.includes("PERFORM set_config('lock_timeout', '3s', true);"));
  assert.ok(migration.includes("PERFORM pg_advisory_xact_lock(hashtext('unbundle:use-case-history-ddl'));"));
  assert.doesNotMatch(block, /SET\s+(SESSION\s+)?lock_timeout|set_config\('lock_timeout', '[^']*', false\)/i, "mai per la sessione: il limite finisce con la transazione");
});

test("la sonda guarda lo stesso elenco e lo stesso vincolo, con la stessa regola", () => {
  const list = `ARRAY[${USE_CASE_EVENT_FIELDS_0023.map((name) => `'${name}'`).join(", ")}]::text[]`;
  assert.ok(USE_CASE_HISTORY_PROBE_SQL.includes(`unnest(${list})`));
  assert.ok(USE_CASE_HISTORY_PROBE_SQL.includes(`c.conname = '${FIELDS_CHECK_NAME}'`));
  assert.ok(USE_CASE_HISTORY_PROBE_SQL.includes("c.conrelid = to_regclass('public.use_case_events')"), "senza la Storia la sonda è falsa, non un errore");
  assert.ok(USE_CASE_HISTORY_PROBE_SQL.includes("position(quote_literal(w.name) || '::text' IN pg_get_constraintdef(c.oid)) = 0"));
  assert.doesNotMatch(USE_CASE_HISTORY_PROBE_SQL, /convalidated/, "un vincolo NOT VALID non fa ripartire il self-heal a ogni avvio");
});

test("ensure-schema: versione 17, DDL della 0023 dopo quello della 0022, sonda in AND", () => {
  assert.match(ensureSchema, /const ENSURE_VERSION = 17;/);
  assert.match(ensureSchema, /import \{ USE_CASE_HISTORY_DDL, USE_CASE_HISTORY_PROBE_SQL \} from "\.\/use-case-hub-history-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const hub = runOnce.indexOf("await runUseCaseHubDdl();");
  const value = runOnce.indexOf("await runUseCaseValueDdl();");
  const history = runOnce.indexOf("await runUseCaseHistoryDdl();");
  assert.ok(hub > 0 && value > hub && history > value, "0020, 0022, 0023 in quest'ordine in runOnce()");
  assert.match(ensureSchema, /AND \$\{sql\.raw\(USE_CASE_VALUE_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(USE_CASE_HISTORY_PROBE_SQL\)\}/);
  const run = topLevelFunction(ensureSchema, "export async function runUseCaseHistoryDdl(");
  assert.match(run, /client\.transaction\(/);
  // Nella transazione del self-heal: prima il timeout, poi l'advisory lock (lo stesso del blocco), poi il blocco.
  const timeout = run.indexOf(`client.query("SELECT set_config('lock_timeout', '${HISTORY_LOCK_TIMEOUT}', true)")`);
  const lock = run.indexOf(`client.query("SELECT pg_advisory_xact_lock(hashtext('${HISTORY_ADVISORY_LOCK}'))")`);
  const statements = run.indexOf("...statements.map(");
  assert.ok(timeout > 0 && lock > timeout && statements > lock, "set_config, advisory lock, blocco: in quest'ordine");
});
