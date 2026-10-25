import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  COLUMNS_FROM_0019,
  CREATED_EVENT_CHANNEL,
  DOSSIER_DUPLICATES_MESSAGE,
  MISSING_0019_MESSAGE,
  USE_CASE_EVENT_ACTIONS,
  USE_CASE_EVENT_ACTOR_KINDS,
  USE_CASE_EVENT_CHANNELS,
  USE_CASE_EVENT_FIELDS,
  USE_CASE_HUB_DDL,
  USE_CASE_HUB_PROBE_SQL,
  USE_CASE_HUB_UC_INDEX_SQL,
  USE_CASE_MCP_REQUEST_STATUSES,
  VERSIONED_USE_CASE_COLUMNS,
} from "./use-case-hub-ddl.ts";
import { CHANNELS, USE_CASE_SOURCES } from "../use-cases/types.ts";
import type { UseCase, UseCaseAiSuggestion, UseCaseKpiScores } from "./schema.ts";

// Migrazione 0020 e self-heal dell'hub (docs/use-case/DESIGN.md §10.1-10.4,
// docs/use-case/PIANO-LAVORI.md H1a). Le prove sul database stanno in
// use-case-hub.integration.test.ts e in scripts/use-case-test/schema-check.mjs.

const migration = readFileSync(new URL("../../../drizzle/0020_use_case_hub.sql", import.meta.url), "utf8");
const migration0019 = readFileSync(new URL("../../../drizzle/0019_connettore_mcp.sql", import.meta.url), "utf8");
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

const at = (needle: string) => USE_CASE_HUB_DDL.findIndex((statement) => statement.includes(needle));

/** Una funzione di primo livello di `source`, dalla firma alla prima `}` a inizio riga. */
function topLevelFunction(source: string, signature: string) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `manca: ${signature}`);
  const end = source.indexOf("\n}\n", start);
  assert.notEqual(end, -1, `fine non trovata: ${signature}`);
  return source.slice(start, end + 2);
}

test("0020: gli statement del self-heal nello stesso ordine, poi solo il blocco dell'indice dei dossier", () => {
  const body = normalize(migration);
  let cursor = 0;
  for (const statement of [...USE_CASE_HUB_DDL, USE_CASE_HUB_UC_INDEX_SQL]) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  // Nient'altro di eseguibile oltre a questi statement.
  const rest = [...USE_CASE_HUB_DDL, USE_CASE_HUB_UC_INDEX_SQL].reduce(
    (text, statement) => text.replace(normalize(statement), ""),
    body,
  );
  assert.equal(rest.trim(), "");
  // L'indice dei dossier chiude la migrazione e non entra nel self-heal (§10.2).
  assert.ok(body.endsWith(normalize(USE_CASE_HUB_UC_INDEX_SQL)));
  assert.ok(!USE_CASE_HUB_DDL.some((statement) => /uc_cases/.test(statement)));
});

test("i corpi delle funzioni sono identici, spazi compresi: parità di pg_get_functiondef", () => {
  for (const name of ["use_cases_bump_version", "use_cases_created_event"]) {
    const statement = USE_CASE_HUB_DDL.find((s) => s.startsWith(`CREATE OR REPLACE FUNCTION ${name}()`));
    assert.ok(statement, name);
    assert.ok(migration.includes(statement), `${name}: il testo della migrazione differisce dal DDL`);
  }
});

test("ordine: colonne e vincolo, versione, Storia e trigger di creazione, richieste MCP, token, indici", () => {
  const columns = at("ADD COLUMN IF NOT EXISTS origin");
  const oneSource = at("use_cases_cost_one_source_check");
  const bumpFn = at("FUNCTION use_cases_bump_version");
  const bumpTrigger = at("TRIGGER use_cases_bump_version");
  const events = at("CREATE TABLE IF NOT EXISTS use_case_events");
  const createdFn = at("FUNCTION use_cases_created_event");
  const createdTrigger = at("TRIGGER use_cases_created_event");
  const requests = at("CREATE TABLE IF NOT EXISTS use_case_mcp_requests");
  const owner = at("ADD COLUMN IF NOT EXISTS owner_user_id");
  const views = at("use_cases_workspace_origin_idx");
  // Prima le colonne che il trigger della versione legge: il controllo della 0019, poi
  // quella che le migrazioni 0000-0019 non creano.
  assert.ok(USE_CASE_HUB_DDL[0].includes(`RAISE EXCEPTION '${MISSING_0019_MESSAGE}';`));
  assert.equal(USE_CASE_HUB_DDL[1], "ALTER TABLE use_cases ADD COLUMN IF NOT EXISTS sustainability_impact text;");
  assert.equal(columns, 2);
  assert.ok(columns < oneSource && oneSource < bumpFn && bumpFn < bumpTrigger);
  // La tabella della Storia nasce prima della funzione che ci scrive.
  assert.ok(bumpTrigger < events && events < createdFn && createdFn < createdTrigger);
  assert.ok(createdTrigger < requests && requests < owner && owner < views);
  assert.equal(at("use_cases_workspace_ai_lab_idx"), USE_CASE_HUB_DDL.length - 1);
});

test("senza la 0019 la 0020 si ferma: il trigger della versione legge intake e public_note", () => {
  const guard = USE_CASE_HUB_DDL[0];
  assert.deepEqual(COLUMNS_FROM_0019, ["intake", "public_note"]);
  // Sono colonne che il trigger legge, e nascono con la 0019.
  for (const column of COLUMNS_FROM_0019) {
    assert.ok((VERSIONED_USE_CASE_COLUMNS as readonly string[]).includes(column), column);
    assert.match(migration0019, new RegExp(`ADD COLUMN IF NOT EXISTS ${column} `), column);
  }
  assert.match(
    guard,
    /^DO \$\$ BEGIN\s+IF \(\s+SELECT count\(\*\) FROM information_schema\.columns\s+WHERE table_schema = 'public' AND table_name = 'use_cases' AND column_name IN \('intake', 'public_note'\)\s+\) < 2 THEN\s+RAISE EXCEPTION/,
  );
  // Solo un controllo: niente scritture, niente oggetti nuovi.
  assert.doesNotMatch(guard, /CREATE|ALTER|INSERT|UPDATE|DELETE|DROP/);
  assert.doesNotMatch(MISSING_0019_MESSAGE, /[%']/);
  // Viene prima di tutto il resto, anche nella migrazione.
  assert.ok(normalize(migration).startsWith(normalize(guard)));
});

test("DDL idempotente, solo additivo, senza estensioni", () => {
  for (const statement of [...USE_CASE_HUB_DDL, USE_CASE_HUB_UC_INDEX_SQL]) {
    assert.doesNotMatch(statement, /CREATE\s+EXTENSION|DROP\s+(TABLE|INDEX|COLUMN|TRIGGER|FUNCTION|CONSTRAINT|NOT NULL|DEFAULT)/i);
    assert.doesNotMatch(statement, /^\s*(UPDATE|DELETE|INSERT)\b/i);
    assert.doesNotMatch(statement, /ALTER COLUMN|RENAME/i);
    if (/^CREATE (TABLE|UNIQUE INDEX|INDEX)/.test(statement)) assert.match(statement, /IF NOT EXISTS/);
    for (const add of statement.match(/ADD COLUMN[^,;]*/g) ?? []) assert.match(add, /ADD COLUMN IF NOT EXISTS/);
    for (const index of statement.match(/CREATE (UNIQUE )?INDEX[^;]*/g) ?? []) assert.match(index, /IF NOT EXISTS/);
    if (/^CREATE (OR REPLACE )?(FUNCTION|TRIGGER)/.test(statement)) assert.match(statement, /^CREATE OR REPLACE/);
    // Un vincolo di tabella aggiunto a una tabella che esiste già sta in un DO con il controllo.
    if (/ADD CONSTRAINT/.test(statement)) assert.match(statement, /^DO \$\$ BEGIN\s+IF NOT EXISTS \(\s+SELECT 1 FROM pg_constraint/);
  }
  assert.doesNotMatch(migration, /CREATE\s+EXTENSION/i);
});

test("nessun NOT NULL senza default sulle tabelle che esistono già: il codice di oggi scrive ancora", () => {
  for (const statement of USE_CASE_HUB_DDL.filter((s) => s.startsWith("ALTER TABLE"))) {
    for (const add of statement.split(/,\n\s*ADD COLUMN/)) {
      if (/NOT NULL/.test(add)) assert.match(add, /NOT NULL DEFAULT/, add);
    }
  }
});

test("importo e fascia mai insieme; CHECK su origine, trimestre, importi, fascia e suggerimento", () => {
  const columns = USE_CASE_HUB_DDL[at("ADD COLUMN IF NOT EXISTS origin")];
  assert.match(columns, /origin varchar\(20\) NOT NULL DEFAULT 'adoption'\s+CONSTRAINT use_cases_origin_check CHECK \(origin IN \('adoption', 'transformation'\)\)/);
  assert.match(columns, /target_quarter ~ '\^\[0-9\]\{4\}-Q\[1-4\]\$'/);
  assert.match(columns, /cost_band IS NULL OR cost_band BETWEEN 1 AND 5/);
  assert.match(columns, /value_eur_year IS NULL OR value_eur_year BETWEEN 0 AND 1000000000/);
  assert.match(columns, /cost_eur_once IS NULL OR cost_eur_once BETWEEN 0 AND 100000000/);
  assert.match(columns, /jsonb_typeof\(ai_suggestion\) = 'object'/);
  assert.match(columns, /version integer NOT NULL DEFAULT 1;$/);
  assert.match(USE_CASE_HUB_DDL[at("use_cases_cost_one_source_check")], /CHECK \(cost_eur_once IS NULL OR cost_band IS NULL\)/);
});

test("versione: sale per le colonne che una persona modifica, mai per AI, codice e ricalcoli", () => {
  const fn = USE_CASE_HUB_DDL[at("FUNCTION use_cases_bump_version")];
  const [newRow, oldRow] = [...fn.matchAll(/ROW\(([^)]*)\)/g)].map((m) => m[1].split(",").map((c) => c.trim()));
  assert.deepEqual(newRow, VERSIONED_USE_CASE_COLUMNS.map((c) => `NEW.${c}`));
  assert.deepEqual(oldRow, VERSIONED_USE_CASE_COLUMNS.map((c) => `OLD.${c}`));
  for (const column of [
    "ai_suggestion",
    "overall_impact_score",
    "overall_feasibility_score",
    "overall_esg_score",
    "overall_score",
    "category",
    "code",
    "updated_at",
    "status_changed_at",
    "version",
    "proposed_by",
  ]) {
    assert.ok(!(VERSIONED_USE_CASE_COLUMNS as readonly string[]).includes(column), column);
  }
  // Le colonne di DESIGN §10.1, nello stesso ordine.
  assert.deepEqual(VERSIONED_USE_CASE_COLUMNS, [
    "title", "description", "flow_description", "human_in_the_loop", "guardrails",
    "business_case", "data_requirements", "sustainability_impact", "origin",
    "portfolio_kind", "ai_lab", "intake", "public_note", "custom_scores",
    "value_eur_year", "cost_eur_once", "cost_band", "status",
    "portfolio_review_status", "target_quarter", "review_by",
  ]);
  assert.match(fn, /IS DISTINCT FROM/);
  assert.match(fn, /NEW\.version := OLD\.version \+ 1;\s+ELSE\s+NEW\.version := OLD\.version;/);
  assert.match(USE_CASE_HUB_DDL[at("TRIGGER use_cases_bump_version")], /BEFORE UPDATE ON use_cases\s+FOR EACH ROW/);
});

test("Storia: elenchi chiusi uguali a DESIGN §10.3 e ai tipi dell'area, nessun testo libero", () => {
  assert.deepEqual(USE_CASE_EVENT_ACTOR_KINDS, ["persona", "proponente", "sistema", "ai"]);
  assert.deepEqual(USE_CASE_EVENT_CHANNELS, [...CHANNELS, "altro"]);
  assert.deepEqual(USE_CASE_EVENT_ACTIONS, [
    "creato", "modificato", "valutato", "suggerimento_ai", "decisione", "quando", "visibilita", "oscurato", "realizzazione_avviata",
  ]);
  assert.deepEqual(USE_CASE_EVENT_FIELDS, [
    "titolo", "problema", "come_funziona", "chi_controlla", "limiti", "impatto_atteso", "dati", "area", "ai_lab",
    "origine", "tipo", "nota_pubblica", "valore", "costo", "kpi", "quando", "revisione", "visibilita",
    "possibile_doppione", "intake",
  ]);
  const table = USE_CASE_HUB_DDL[at("CREATE TABLE IF NOT EXISTS use_case_events")];
  const columns = table
    .slice(table.indexOf("(") + 1, table.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_]+) ([a-z]+(\(\d+\))?(\[\])?)/))
    .filter((m): m is RegExpMatchArray => m !== null && m[1] !== "CONSTRAINT");
  // Nessuna colonna text libera: `fields` è text[] con il CHECK, il resto varchar corti, uuid e date.
  for (const [, name, type] of columns) {
    assert.notEqual(type, "text", `${name}: colonna di testo libero`);
    if (type === "text[]") assert.equal(name, "fields");
  }
  assert.deepEqual(columns.map((m) => m[1]), [
    "id", "workspace_id", "use_case_id", "at", "actor_user_id", "actor_kind", "channel", "action", "fields", "phase_before", "phase_after",
  ]);
  assert.match(table, /CONSTRAINT use_case_events_actor_check CHECK \(actor_user_id IS NULL OR actor_kind = 'persona'\)/);
  assert.match(table, /actor_user_id uuid REFERENCES users\(id\) ON DELETE SET NULL/);
  assert.match(table, /use_case_id uuid NOT NULL REFERENCES use_cases\(id\) ON DELETE CASCADE/);
});

test("trigger di creazione: canale per ogni source di §10.3, proponente o sistema, mai una persona", () => {
  assert.deepEqual(CREATED_EVENT_CHANNEL, {
    web_proposed: "web",
    slack_proposed: "slack",
    claude_mcp: "rest",
    claude_connector: "connettore",
    learning: "corsi",
    ai_readiness_assessment: "ai_readiness",
    activity_mapping: "activity_mapping",
    manual: "pagina",
    team_mcp: "mcp_team",
  });
  // Ogni source dell'area ha il suo canale, e ogni canale è nel CHECK.
  assert.deepEqual(Object.keys(CREATED_EVENT_CHANNEL).sort(), [...USE_CASE_SOURCES].sort());
  for (const channel of Object.values(CREATED_EVENT_CHANNEL)) assert.ok((USE_CASE_EVENT_CHANNELS as readonly string[]).includes(channel));
  const fn = USE_CASE_HUB_DDL[at("FUNCTION use_cases_created_event")];
  for (const [source, channel] of Object.entries(CREATED_EVENT_CHANNEL)) {
    assert.match(fn, new RegExp(`WHEN '${source}' THEN '${channel}'`));
  }
  assert.match(fn, /CASE coalesce\(NEW\.source, 'activity_mapping'\)/);
  assert.match(fn, /ELSE 'altro'\s+END,\s+'creato'/);
  assert.match(fn, /= 'activity_mapping' THEN 'sistema' ELSE 'proponente' END/);
  // actor_user_id sempre NULL alla creazione, e nessun campo sul proponente letto da NEW.
  assert.match(fn, /NEW\.id,\s+NULL,/);
  assert.doesNotMatch(fn, /proposed_by|submitted_by_user_id|NEW\.title|NEW\.description/);
  assert.match(USE_CASE_HUB_DDL[at("TRIGGER use_cases_created_event")], /AFTER INSERT ON use_cases\s+FOR EACH ROW/);
});

test("richieste del MCP del team: chiave per principal, stato chiuso, id riservati", () => {
  const table = USE_CASE_HUB_DDL[at("CREATE TABLE IF NOT EXISTS use_case_mcp_requests")];
  assert.deepEqual(USE_CASE_MCP_REQUEST_STATUSES, ["pending", "completed", "failed"]);
  assert.match(table, /status IN \('pending', 'completed', 'failed'\)/);
  assert.match(table, /reserved_ids uuid\[\],/);
  assert.match(table, /PRIMARY KEY \(workspace_id, principal_key, idempotency_key\)/);
  assert.match(table, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
});

test("token personali: owner_user_id nullable, sparisce con la persona, indice parziale", () => {
  assert.match(USE_CASE_HUB_DDL[at("ADD COLUMN IF NOT EXISTS owner_user_id")], /owner_user_id uuid REFERENCES users\(id\) ON DELETE CASCADE;/);
  assert.match(USE_CASE_HUB_DDL[at("workspace_integration_tokens_owner_idx")], /WHERE owner_user_id IS NOT NULL/);
});

test("art. 15.4: nessun indice su proposed_by né su actor_user_id", () => {
  for (const statement of [...USE_CASE_HUB_DDL, USE_CASE_HUB_UC_INDEX_SQL]) {
    for (const index of statement.match(/CREATE (UNIQUE )?INDEX[^;]*/g) ?? []) {
      assert.doesNotMatch(index, /proposed_by|actor_user_id/, index);
    }
  }
  assert.doesNotMatch(migration.replace(/^--.*$/gm, ""), /INDEX[^;]*(proposed_by|actor_user_id)/);
});

test("indice unico dei dossier: solo con le tabelle uc, doppioni completi e incompleti, nome nuovo", () => {
  const block = USE_CASE_HUB_UC_INDEX_SQL;
  assert.match(block, /IF to_regclass\('public\.uc_cases'\) IS NOT NULL THEN/);
  // Una sola condizione: ogni riga con la scheda, senza filtri su setup_completed_at.
  assert.match(block, /FROM uc_cases\s+WHERE portfolio_use_case_id IS NOT NULL\s+GROUP BY portfolio_use_case_id\s+HAVING count\(\*\) > 1/);
  assert.doesNotMatch(block, /setup_completed_at/);
  assert.ok(block.includes(`RAISE EXCEPTION '${DOSSIER_DUPLICATES_MESSAGE}';`));
  assert.equal(
    DOSSIER_DUPLICATES_MESSAGE,
    "uc_cases: piu dossier sulla stessa scheda. Esegui use-case-admin dossier-dups prima della 0020.",
  );
  assert.doesNotMatch(DOSSIER_DUPLICATES_MESSAGE, /[%']/);
  // Il controllo viene prima dell'indice, e l'indice ha un nome nuovo (quello vecchio non è unico).
  assert.ok(block.indexOf("RAISE EXCEPTION") < block.indexOf("CREATE UNIQUE INDEX"));
  assert.match(block, /CREATE UNIQUE INDEX IF NOT EXISTS uc_cases_portfolio_use_case_unique_idx\s+ON uc_cases \(portfolio_use_case_id\) WHERE portfolio_use_case_id IS NOT NULL;/);
  assert.doesNotMatch(block, /uc_cases_portfolio_use_case_idx\b/);
});

test("la sonda copre ogni oggetto del DDL", () => {
  const ddl = USE_CASE_HUB_DDL.join("\n");
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
  assert.ok(names.size >= 30, `oggetti trovati: ${names.size}`);
  for (const name of names) {
    assert.match(USE_CASE_HUB_PROBE_SQL, new RegExp(`'(public\\.)?${name}(\\(\\))?'`), `la sonda non guarda ${name}`);
  }
  // Ogni colonna aggiunta a use_cases è contata, e il conto è quello giusto.
  const added = USE_CASE_HUB_DDL.filter((s) => s.startsWith("ALTER TABLE use_cases")).flatMap((s) =>
    [...s.matchAll(/ADD COLUMN IF NOT EXISTS (\w+)/g)].map((m) => m[1]),
  );
  assert.match(USE_CASE_HUB_PROBE_SQL, new RegExp(`column_name IN \\(${added.map((c) => `'${c}'`).join(", ")}\\)\\s+\\) = ${added.length}`));
  const constraints = [...ddl.matchAll(/CONSTRAINT (\w+)/g)].map((m) => m[1]);
  assert.match(USE_CASE_HUB_PROBE_SQL, new RegExp(`\\) = ${new Set(constraints).size}\\s+AND EXISTS \\(\\s+SELECT 1 FROM pg_trigger`));
  // L'indice dei dossier non è nella sonda: non entra nel self-heal (§10.2).
  assert.doesNotMatch(USE_CASE_HUB_PROBE_SQL, /uc_cases/);
});

test("ensure-schema: versione almeno 15, DDL dell'hub dopo il connettore, sonda in AND", () => {
  // La 0020 l'ha portata a 15; la 0022 (use-case-hub-value-ddl.test.ts) a 16.
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 15, "ENSURE_VERSION almeno 15");
  assert.match(ensureSchema, /import \{ USE_CASE_HUB_DDL, USE_CASE_HUB_PROBE_SQL \} from "\.\/use-case-hub-ddl\.ts";/);
  const connector = ensureSchema.indexOf("await runConnectorDdl();");
  const hub = ensureSchema.indexOf("await runUseCaseHubDdl();");
  assert.ok(connector > 0 && hub > connector, "il DDL dell'hub segue quello del connettore in runOnce()");
  assert.match(ensureSchema, /AND \$\{sql\.raw\(CONNECTOR_PROBE_SQL\)\}\s+AND \$\{sql\.raw\(USE_CASE_HUB_PROBE_SQL\)\}/);
  assert.match(ensureSchema, /pg_advisory_xact_lock\(hashtext\('unbundle:use-case-hub-ddl'\)\)/);
  // L'indice dei dossier non passa dal self-heal principale: ensure-schema.ts non importa
  // il blocco, e le funzioni della parte principale non toccano uc_cases (il DDL dell'hub
  // nemmeno, primo test). La parte uc (UC_ENSURE_VERSION, DDL uc) è di C11b: qui non si guarda.
  const imports = ensureSchema.split("\n").filter((line) => line.startsWith("import ")).join("\n");
  assert.doesNotMatch(imports, /USE_CASE_HUB_UC_INDEX_SQL/);
  for (const signature of [
    "async function runOnce(): Promise<void> {",
    "export async function runUseCaseHubDdl(",
    "async function schemaLooksCurrent(): Promise<boolean> {",
  ]) {
    assert.doesNotMatch(topLevelFunction(ensureSchema, signature), /USE_CASE_HUB_UC_INDEX_SQL|uc_cases/, signature);
  }
});

test("schema.ts: colonne e tabelle della 0020, con i default; nome del team senza il valore scritto a mano", () => {
  for (const column of [
    'origin: varchar("origin", { length: 20 })',
    'aiLab: varchar("ai_lab", { length: 120 })',
    'targetQuarter: varchar("target_quarter", { length: 7 })',
    'reviewBy: date("review_by", { mode: "string" })',
    'valueEurYear: integer("value_eur_year")',
    'costEurOnce: integer("cost_eur_once")',
    'costBand: smallint("cost_band")',
    'aiSuggestion: jsonb("ai_suggestion")',
    'version: integer("version").notNull().default(1)',
    'ownerUserId: uuid("owner_user_id")',
    'pgTable(\n  "use_case_events"',
    'pgTable(\n  "use_case_mcp_requests"',
  ]) {
    assert.ok(schemaTs.includes(column), column);
  }
  assert.match(schemaTs, /\.\$type<UseCaseOrigin>\(\)\s*\.notNull\(\)\s*\.default\("adoption"\)/);
  // DESIGN §7.6 punti 4-5: la copia v1 ha la forma delle colonne che `--revert` rimette.
  // Lo controlla tsc (npm run typecheck): un tipo diverso non compila.
  type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
  type Backup = NonNullable<UseCaseAiSuggestion["v1Backup"]>;
  const shapes: [
    Same<UseCaseKpiScores | null, UseCase["customScores"]>,
    Same<Backup["customScores"], UseCase["customScores"]>,
    Same<Backup["reviewNotes"], UseCase["reviewNotes"]>,
    Same<Backup["at"], string>,
  ] = [true, true, true, true];
  assert.deepEqual(shapes, [true, true, true, true]);
  // DESIGN §14.2: il valore predefinito sta solo nella costante, anche nei commenti.
  assert.match(schemaTs, /DEFAULT_REVIEW_TEAM_NAME/);
  assert.doesNotMatch(schemaTs, /AI Builder/);
});
