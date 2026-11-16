import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns, getTableName } from "drizzle-orm";
import {
  MAPPING_BOARD_ADVISORY_LOCK,
  MAPPING_BOARD_DDL,
  MAPPING_BOARD_INDEXES,
  MAPPING_BOARD_NAMED_CONSTRAINTS,
  MAPPING_BOARD_PROBE_SQL,
  MAPPING_BOARD_TABLES,
  MAPPING_BOARD_WIDTHS,
  MISSING_ACTIVITIES_FOR_BOARD_MESSAGE,
  ONET_TITLE_MAX,
} from "./mapping-board-ddl.ts";
import { BOARD_LANE, FRICTIONS, LANES, MAPPING_LIMITS, NOTE_STATUSES, OP_OUTCOMES, ORIGINS, STEP_LANES, STEP_STATUSES, STREAMS } from "../mappatura/vocab.ts";
import * as schema from "./schema.ts";

// Migrazione 0039 e self-heal: la board dell'activity mapping (docs/mappatura/MAPPATURA-BOARD-PIANO.md §3.2–§3.4). Le
// prove sul database stanno in src/lib/mappatura/mapping-ddl.integration.test.ts.
// Nel rilascio insieme alla 0037 (8.0c, ENSURE_VERSION 31) e alla 0038 (9a, 32) la 0039 è rinumerata (piano §3.4, §11):
// ENSURE_VERSION 33 in ensure-schema.ts, nell'intestazione del file SQL e qui; in runOnce() la 0039 viene dopo la 0038.

const migration = readFileSync(new URL("../../../drizzle/0039_mapping_board.sql", import.meta.url), "utf8");
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

const PRELUDE = ["SELECT set_config('lock_timeout', '3s', true);", "SELECT pg_advisory_xact_lock(hashtext('unbundle:mapping-board-ddl'));"];
const table = (name: string) => {
  const statement = MAPPING_BOARD_DDL.find((s) => s.startsWith(`CREATE TABLE IF NOT EXISTS ${name} (`));
  assert.ok(statement, `manca la tabella ${name}`);
  return statement;
};
const boards = table("mapping_boards");
const processes = table("mapping_processes");
const steps = table("mapping_steps");
const notes = table("mapping_notes");
const votes = table("mapping_votes");
const applied = table("mapping_applied_ops");

const ddlColumns = (statement: string) =>
  statement
    .slice(statement.indexOf("(") + 1, statement.lastIndexOf(")"))
    .split("\n")
    .map((line) => line.trim().match(/^([a-z_][a-z0-9_]*) (uuid|varchar|text|timestamptz|smallint|bigint|jsonb|double precision)\b/)?.[1])
    .filter((n): n is string => Boolean(n));

/** Il testo di un CHECK con nome, fino alla virgola della colonna o del vincolo. */
function check(statement: string, constraint: string): string {
  const at = statement.indexOf(`CONSTRAINT ${constraint} CHECK (`);
  assert.notEqual(at, -1, `manca ${constraint}`);
  return statement.slice(at).split("\n")[0].replace(/,$/, "");
}

const inList = (values: readonly string[]) => `(${values.map((value) => `'${value}'`).join(", ")})`;

test("0039: le due righe di apertura, poi gli statement del self-heal nello stesso ordine, e nient'altro", () => {
  const body = normalize(migration);
  assert.ok(body.startsWith(normalize(PRELUDE.join("\n"))));
  assert.equal(MAPPING_BOARD_ADVISORY_LOCK, "unbundle:mapping-board-ddl");
  let cursor = 0;
  for (const statement of MAPPING_BOARD_DDL) {
    const found = body.indexOf(normalize(statement), cursor);
    assert.notEqual(found, -1, `manca o è fuori ordine: ${statement.slice(0, 80)}`);
    cursor = found + normalize(statement).length;
  }
  const rest = [...PRELUDE, ...MAPPING_BOARD_DDL].reduce((text, statement) => text.replace(normalize(statement), ""), body);
  assert.equal(rest.trim(), "");
  assert.match(migration, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0039_mapping_board\.sql/);
  assert.match(migration, /dopo la\s+-- 0038, ENSURE_VERSION 33/);
});

test("solo aggiunte: il controllo iniziale, poi CREATE … IF NOT EXISTS; nessuna colonna toccata nelle tabelle di prima", () => {
  assert.match(MAPPING_BOARD_DDL[0], /IF to_regclass\('public\.activities'\) IS NULL OR to_regclass\('public\.departments'\) IS NULL THEN\s+RAISE EXCEPTION/);
  assert.ok(MAPPING_BOARD_DDL[0].includes(`'${MISSING_ACTIVITIES_FOR_BOARD_MESSAGE}'`));
  for (const statement of MAPPING_BOARD_DDL.slice(1)) {
    assert.match(statement, /^CREATE (TABLE|INDEX|UNIQUE INDEX) IF NOT EXISTS /, statement.slice(0, 60));
  }
  for (const statement of MAPPING_BOARD_DDL) {
    assert.doesNotMatch(statement, /\bALTER\b|\bDROP\b|\bRENAME\b|\bTRUNCATE\b|CREATE\s+EXTENSION|CREATE\s+(OR REPLACE\s+)?(FUNCTION|TRIGGER)/i);
    assert.doesNotMatch(statement, /\b(UPDATE|DELETE FROM|INSERT INTO)\b/);
    assert.doesNotMatch(statement, /\buc_[a-z_]+|use_case/, "né il DDL uc né quello degli use case cambiano");
  }
  // Sulle tabelle di prima solo quattro indici: mai una colonna in activities, departments o activity_dependencies.
  const onOld = MAPPING_BOARD_DDL.filter((s) => / ON (activities|departments|activity_dependencies) /.test(s));
  assert.deepEqual(
    onOld.map((s) => s.match(/IF NOT EXISTS ([a-z_]+) ON ([a-z_]+) \(([a-z_, ]+)\)/)?.slice(1)),
    [
      ["departments_scope_unique", "departments", "id, workspace_id"],
      ["activities_scope_unique", "activities", "id, department_id, workspace_id"],
      ["activities_department_idx", "activities", "department_id"],
      ["activities_workspace_idx", "activities", "workspace_id"],
    ],
  );
  assert.ok(onOld.slice(0, 2).every((s) => s.startsWith("CREATE UNIQUE INDEX")));
  // Gli indici unici vengono prima delle tabelle che li usano come chiave esterna.
  const position = (needle: string) => MAPPING_BOARD_DDL.findIndex((s) => s.includes(needle));
  assert.ok(position("departments_scope_unique ON") < position("CREATE TABLE IF NOT EXISTS mapping_boards"));
  assert.ok(position("activities_scope_unique ON") < position("CREATE TABLE IF NOT EXISTS mapping_steps"));
  assert.ok(position("CREATE TABLE IF NOT EXISTS mapping_processes") < position("CREATE TABLE IF NOT EXISTS mapping_steps"));
  assert.ok(position("CREATE TABLE IF NOT EXISTS mapping_processes") < position("CREATE TABLE IF NOT EXISTS mapping_votes"));
});

test("i CHECK nascono da MAPPING_LIMITS e dal vocabolario", () => {
  const L = MAPPING_LIMITS;
  assert.match(check(boards, "mapping_boards_revision_check"), /CHECK \(revision >= 0\)$/);
  assert.ok(boards.includes(`headline varchar(${L.headline}) CONSTRAINT mapping_boards_headline_check CHECK (headline IS NULL OR length(btrim(headline)) BETWEEN 1 AND ${L.headline})`));
  assert.ok(processes.includes(`name varchar(${L.processName}) NOT NULL CONSTRAINT mapping_processes_name_check CHECK (length(btrim(name)) BETWEEN 1 AND ${L.processName})`));
  assert.ok(processes.includes(`owner varchar(${L.owner}) CONSTRAINT mapping_processes_owner_check CHECK (owner IS NULL OR length(btrim(owner)) BETWEEN 1 AND ${L.owner})`));
  assert.equal(check(steps, "mapping_steps_who_check"), `CONSTRAINT mapping_steps_who_check CHECK (jsonb_typeof(who) = 'array' AND jsonb_array_length(who) <= ${L.who})`);
  assert.equal(check(steps, "mapping_steps_exception_check"), `CONSTRAINT mapping_steps_exception_check CHECK (exception_text IS NULL OR length(btrim(exception_text)) BETWEEN 1 AND ${L.exception})`);
  assert.ok(steps.includes(`decision_label varchar(${L.decisionLabel}) CONSTRAINT mapping_steps_decision_label_check CHECK (decision_label IS NULL OR length(btrim(decision_label)) BETWEEN 1 AND ${L.decisionLabel})`));
  assert.equal(check(steps, "mapping_steps_friction_check"), `CONSTRAINT mapping_steps_friction_check CHECK (friction_level IS NULL OR friction_level BETWEEN ${FRICTIONS[0]} AND ${FRICTIONS[FRICTIONS.length - 1]})`);
  assert.deepEqual([...FRICTIONS], [0, 1, 2, 3]);
  assert.equal(check(steps, "mapping_steps_status_check"), `CONSTRAINT mapping_steps_status_check CHECK (status IN ${inList(STEP_STATUSES)})`);
  assert.equal(check(steps, "mapping_steps_origin_check"), `CONSTRAINT mapping_steps_origin_check CHECK (origin IN ${inList(ORIGINS)})`);
  assert.equal(check(steps, "mapping_steps_proposed_check"), `CONSTRAINT mapping_steps_proposed_check CHECK (proposed_stream IS NULL OR proposed_stream IN ${inList(STREAMS)})`);
  assert.equal(check(steps, "mapping_steps_reason_check"), `CONSTRAINT mapping_steps_reason_check CHECK (classification_reason IS NULL OR length(classification_reason) <= ${L.description})`);
  assert.equal(check(steps, "mapping_steps_potential_check"), `CONSTRAINT mapping_steps_potential_check CHECK (ai_potential IS NULL OR length(ai_potential) <= ${L.description})`);
  assert.ok(steps.includes(`onet_title varchar(${ONET_TITLE_MAX}),`));
  assert.equal(check(notes, "mapping_notes_lane_check"), `CONSTRAINT mapping_notes_lane_check CHECK (lane IN ${inList(LANES)})`);
  assert.deepEqual([...LANES], [...STEP_LANES, BOARD_LANE]);
  assert.ok(notes.includes(`title varchar(${L.noteTitle}) CONSTRAINT mapping_notes_title_check CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND ${L.noteTitle})`));
  assert.equal(check(notes, "mapping_notes_body_check"), `CONSTRAINT mapping_notes_body_check CHECK (length(btrim(body)) BETWEEN 1 AND ${L.note})`);
  assert.equal(check(notes, "mapping_notes_status_check"), `CONSTRAINT mapping_notes_status_check CHECK (status IN ${inList(NOTE_STATUSES)})`);
  assert.equal(check(notes, "mapping_notes_origin_check"), `CONSTRAINT mapping_notes_origin_check CHECK (origin IN ${inList(ORIGINS)})`);
  assert.equal(check(votes, "mapping_votes_votes_check"), `CONSTRAINT mapping_votes_votes_check CHECK (votes BETWEEN 0 AND ${L.votes})`);
  assert.equal(check(applied, "mapping_applied_ops_outcome_check"), `CONSTRAINT mapping_applied_ops_outcome_check CHECK (outcome IN ${inList(OP_OUTCOMES)})`);
  // Un punto di analisi è una nota senza passo, e solo lui ha un titolo.
  assert.ok(notes.includes(`CONSTRAINT mapping_notes_scope_check CHECK ((lane = '${BOARD_LANE}') = (activity_id IS NULL))`));
  assert.ok(notes.includes(`CONSTRAINT mapping_notes_title_lane_check CHECK (title IS NULL OR lane = '${BOARD_LANE}')`));
  // I valori predefiniti sono parole del vocabolario.
  assert.ok(steps.includes("status varchar(12) NOT NULL DEFAULT 'da_validare'") && STEP_STATUSES.includes("da_validare"));
  assert.ok(steps.includes("origin varchar(10) NOT NULL DEFAULT 'prima'") && ORIGINS.includes("prima"));
  assert.ok(notes.includes("status varchar(8) NOT NULL DEFAULT 'validato'") && NOTE_STATUSES.includes("validato"));
  assert.ok(notes.includes("origin varchar(10) NOT NULL DEFAULT 'board'") && ORIGINS.includes("board"));
  // Ogni parola entra nella sua colonna.
  const widest = (words: readonly string[]) => Math.max(...words.map((word) => word.length));
  assert.ok(widest(STEP_STATUSES) <= MAPPING_BOARD_WIDTHS.stepStatus && steps.includes(`status varchar(${MAPPING_BOARD_WIDTHS.stepStatus})`));
  assert.ok(widest(ORIGINS) <= MAPPING_BOARD_WIDTHS.origin && steps.includes(`origin varchar(${MAPPING_BOARD_WIDTHS.origin})`) && notes.includes(`origin varchar(${MAPPING_BOARD_WIDTHS.origin})`));
  assert.ok(widest(STREAMS) <= MAPPING_BOARD_WIDTHS.stream && steps.includes(`proposed_stream varchar(${MAPPING_BOARD_WIDTHS.stream})`));
  assert.ok(widest(LANES) <= MAPPING_BOARD_WIDTHS.lane && notes.includes(`lane varchar(${MAPPING_BOARD_WIDTHS.lane})`));
  assert.ok(widest(NOTE_STATUSES) <= MAPPING_BOARD_WIDTHS.noteStatus && notes.includes(`status varchar(${MAPPING_BOARD_WIDTHS.noteStatus})`));
  assert.ok(widest(OP_OUTCOMES) <= MAPPING_BOARD_WIDTHS.outcome && applied.includes(`outcome varchar(${MAPPING_BOARD_WIDTHS.outcome}) NOT NULL`));
});

test("lo scope sta nel database: chiavi esterne composte, tutto si cancella con il workspace, l'unità e l'attività", () => {
  for (const t of [boards, processes, steps, notes, votes, applied]) {
    assert.match(t, /workspace_id uuid NOT NULL REFERENCES workspaces\(id\) ON DELETE CASCADE/);
  }
  // Le operazioni applicate: una per id, nell'unità e nel workspace di chi le ha salvate; vanno con l'unità.
  assert.ok(applied.includes("CONSTRAINT mapping_applied_ops_pkey PRIMARY KEY (op_id)"));
  assert.ok(applied.includes("CONSTRAINT mapping_applied_ops_unit_fkey FOREIGN KEY (department_id, workspace_id) REFERENCES departments (id, workspace_id) ON DELETE CASCADE"));
  assert.ok(MAPPING_BOARD_DDL.includes("CREATE INDEX IF NOT EXISTS mapping_applied_ops_unit_idx ON mapping_applied_ops (department_id, created_at);"));
  assert.ok(boards.includes("CONSTRAINT mapping_boards_unit_fkey FOREIGN KEY (department_id, workspace_id) REFERENCES departments (id, workspace_id) ON DELETE CASCADE"));
  assert.ok(processes.includes("CONSTRAINT mapping_processes_unit_fkey FOREIGN KEY (department_id, workspace_id) REFERENCES departments (id, workspace_id) ON DELETE CASCADE"));
  assert.ok(processes.includes("CONSTRAINT mapping_processes_scope_unique UNIQUE (id, department_id, workspace_id)"));
  assert.ok(steps.includes("CONSTRAINT mapping_steps_activity_fkey FOREIGN KEY (activity_id, department_id, workspace_id) REFERENCES activities (id, department_id, workspace_id) ON DELETE CASCADE"));
  // Un processo che sparisce lascia il passo, senza processo: solo `process_id` va a NULL, non l'unità né il workspace.
  assert.ok(steps.includes("CONSTRAINT mapping_steps_process_fkey FOREIGN KEY (process_id, department_id, workspace_id) REFERENCES mapping_processes (id, department_id, workspace_id) ON DELETE SET NULL (process_id)"));
  assert.ok(notes.includes("CONSTRAINT mapping_notes_unit_fkey FOREIGN KEY (department_id, workspace_id) REFERENCES departments (id, workspace_id) ON DELETE CASCADE"));
  assert.ok(notes.includes("CONSTRAINT mapping_notes_step_fkey FOREIGN KEY (activity_id, department_id, workspace_id) REFERENCES activities (id, department_id, workspace_id) ON DELETE CASCADE"));
  assert.ok(votes.includes("CONSTRAINT mapping_votes_process_fkey FOREIGN KEY (process_id, department_id, workspace_id) REFERENCES mapping_processes (id, department_id, workspace_id) ON DELETE CASCADE"));
  assert.ok(votes.includes("CONSTRAINT mapping_votes_pkey PRIMARY KEY (process_id, user_id)"));
  // Nessuna colonna sulla persona, tranne nei voti (ognuno i suoi).
  for (const t of [boards, processes, steps, notes, applied]) assert.doesNotMatch(t, /\b\w*(_by|author|actor|user_id|email|person)\w*\b/i);
  assert.match(votes, /user_id uuid NOT NULL REFERENCES users\(id\) ON DELETE CASCADE/);
  // Le posizioni sono double precision: uno spostamento scrive «tra quei due» e poi si rinumera.
  for (const t of [processes, steps, notes]) assert.match(t, /position double precision NOT NULL DEFAULT 0/);
});

test("la sonda copre le sei tabelle, i dieci indici e i 37 vincoli con nome", () => {
  for (const name of [...MAPPING_BOARD_TABLES, ...MAPPING_BOARD_INDEXES]) assert.ok(MAPPING_BOARD_PROBE_SQL.includes(`to_regclass('public.${name}') IS NOT NULL`), name);
  assert.deepEqual([...MAPPING_BOARD_TABLES], ["mapping_boards", "mapping_processes", "mapping_steps", "mapping_notes", "mapping_votes", "mapping_applied_ops"]);
  const created = MAPPING_BOARD_DDL.map((s) => s.match(/^CREATE TABLE IF NOT EXISTS ([a-z_]+) \(/)?.[1]).filter(Boolean);
  assert.deepEqual(created, [...MAPPING_BOARD_TABLES]);
  const named = [...MAPPING_BOARD_DDL.join("\n").matchAll(/CONSTRAINT ([a-z0-9_]+) (CHECK|PRIMARY KEY|UNIQUE|FOREIGN KEY)/g)].map((m) => m[1]);
  assert.deepEqual([...named].sort(), [...MAPPING_BOARD_NAMED_CONSTRAINTS].sort());
  assert.equal(MAPPING_BOARD_NAMED_CONSTRAINTS.length, 37);
  assert.equal(new Set(MAPPING_BOARD_NAMED_CONSTRAINTS).size, 37);
  for (const name of MAPPING_BOARD_NAMED_CONSTRAINTS) assert.ok(MAPPING_BOARD_PROBE_SQL.includes(`'${name}'`), name);
  assert.ok(MAPPING_BOARD_PROBE_SQL.includes(") = 37"));
  const indexes = MAPPING_BOARD_DDL.filter((s) => /^CREATE (UNIQUE )?INDEX/.test(s)).map((s) => s.match(/INDEX IF NOT EXISTS ([a-z_]+) /)?.[1]);
  assert.deepEqual(indexes, [...MAPPING_BOARD_INDEXES]);
  assert.equal(MAPPING_BOARD_INDEXES.length, 10);
  // L'indice parziale dei punti di analisi.
  assert.ok(MAPPING_BOARD_DDL.includes("CREATE INDEX IF NOT EXISTS mapping_notes_unit_idx ON mapping_notes (department_id) WHERE activity_id IS NULL;"));
});

test("ensure-schema: versione almeno 33, la 0039 dopo la 0036, la 0037 e la 0038, non fatale, con timeout e lock, la sonda in AND e il nuovo tentativo", () => {
  assert.ok(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]) >= 33, "ENSURE_VERSION almeno 33");
  assert.match(ensureSchema, /import \{ MAPPING_BOARD_DDL, MAPPING_BOARD_PROBE_SQL \} from "\.\/mapping-board-ddl\.ts";/);
  const runOnce = topLevelFunction(ensureSchema, "async function runOnce(): Promise<void> {");
  const evals = runOnce.indexOf("await runEvalsDdlSafely();");
  const board = runOnce.indexOf("await runMappingBoardDdlSafely();");
  assert.ok(evals > 0 && board > evals);
  // (Rilascio insieme) Nell'ordine dei numeri: 0037, 0038, 0039; le sonde nello stesso ordine.
  const builders = runOnce.indexOf("await runExternalBuildersDdlSafely();");
  const context = runOnce.indexOf("await runContextDdlSafely();");
  assert.ok(evals < builders && builders < context && context < board, "runOnce: 0036, 0037, 0038, 0039");
  const probes = ["EVALS_PROBE_SQL", "EXTERNAL_BUILDERS_PROBE_SQL", "CONTEXT_PROBE_SQL", "MAPPING_BOARD_PROBE_SQL"].map((name) => ensureSchema.indexOf(`AND \${sql.raw(${name})}`));
  assert.ok(probes.every((at, i) => at > 0 && (i === 0 || at > probes[i - 1])), `schemaLooksCurrent: ${probes.join(", ")}`);
  const safe = topLevelFunction(ensureSchema, "async function runMappingBoardDdlSafely(): Promise<void> {");
  assert.match(safe, /try \{\s+await runMappingBoardDdl\(\);\s+mappingBoardDdlFailedAt = null;\s+\} catch \(err\) \{\s+mappingBoardDdlFailedAt = Date\.now\(\);/);
  assert.ok(!/\bthrow\b/.test(safe));
  assert.ok(safe.includes("0039 self-heal failed, the app keeps serving the mapping read only (apply drizzle/0039 by hand):"));
  const ensure = topLevelFunction(ensureSchema, "export async function ensureDbSchema(): Promise<void> {");
  assert.match(
    ensure,
    /if \(mappingBoardDdlFailedAt !== null && Date\.now\(\) - mappingBoardDdlFailedAt >= REFERENTS_DDL_RETRY_MS\) \{\s+mappingBoardDdlFailedAt = Date\.now\(\);\s+ensurePromise = ensurePromise\.then\(runMappingBoardDdlSafely\);/,
  );
  assert.match(ensureSchema, /AND \$\{sql\.raw\(EVALS_PROBE_SQL\)\}[\s\S]*?AND \$\{sql\.raw\(MAPPING_BOARD_PROBE_SQL\)\}/);
  const runner = topLevelFunction(ensureSchema, "export async function runMappingBoardDdl(statements: readonly string[] = MAPPING_BOARD_DDL): Promise<void> {");
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") > 0);
  assert.ok(runner.indexOf("set_config('lock_timeout', '3s', true)") < runner.indexOf(`pg_advisory_xact_lock(hashtext('${MAPPING_BOARD_ADVISORY_LOCK}'))`));
  assert.match(runner, /client\.transaction\(\[/);
});

test("le colonne Drizzle sono quelle del DDL, nello stesso ordine", () => {
  const pairs = [
    [schema.mappingBoards, boards, "mapping_boards", 7],
    [schema.mappingProcesses, processes, "mapping_processes", 8],
    [schema.mappingSteps, steps, "mapping_steps", 17],
    [schema.mappingNotes, notes, "mapping_notes", 12],
    [schema.mappingVotes, votes, "mapping_votes", 6],
    [schema.mappingAppliedOps, applied, "mapping_applied_ops", 5],
  ] as const;
  for (const [drizzleTable, statement, name, count] of pairs) {
    assert.equal(getTableName(drizzleTable), name);
    assert.deepEqual(Object.values(getTableColumns(drizzleTable)).map((c) => c.name), ddlColumns(statement), name);
    assert.equal(ddlColumns(statement).length, count, name);
  }
  // Le lunghezze dei varchar dello schema sono quelle del DDL.
  const length = (column: unknown) => (column as { length?: number }).length;
  assert.equal(length(schema.mappingBoards.headline), MAPPING_LIMITS.headline);
  assert.equal(length(schema.mappingProcesses.name), MAPPING_LIMITS.processName);
  assert.equal(length(schema.mappingProcesses.owner), MAPPING_LIMITS.owner);
  assert.equal(length(schema.mappingSteps.decisionLabel), MAPPING_LIMITS.decisionLabel);
  assert.equal(length(schema.mappingSteps.onetTitle), ONET_TITLE_MAX);
  assert.equal(length(schema.mappingNotes.title), MAPPING_LIMITS.noteTitle);
  // Nessuna colonna nuova nelle tabelle di prima: la board non ne aggiunge.
  const activityColumns = Object.values(getTableColumns(schema.activities)).map((c) => c.name);
  assert.equal(activityColumns.length, 23);
  assert.ok(!activityColumns.some((name) => /process|position|who|exception|friction|origin|proposed/.test(name)));
  assert.equal(Object.keys(getTableColumns(schema.departments)).length, 8);
  assert.equal(Object.keys(getTableColumns(schema.activityDependencies)).length, 3);
});

test("RUNBOOK §10.20: il rilascio insieme, ENSURE_VERSION 33, la 0037, la 0038 e la 0039 in ordine, la 0039 a mano solo di riserva, il ritorno indietro", () => {
  const runbook = readFileSync(new URL("../../../docs/casi-duso/RUNBOOK.md", import.meta.url), "utf8");
  assert.ok(runbook.includes("### 10.20 Rilascio insieme: 8.0c, 9a e la mappatura come board (0037, 0038, 0039)"), "manca §10.20");
  const section = runbook.slice(runbook.indexOf("### 10.20 Rilascio insieme"));
  assert.match(section, /`ENSURE_VERSION` 33/);
  assert.match(section, /nell'ordine, la 0037, la 0038 e la 0039/);
  assert.match(section, /psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle\/0039_mapping_board\.sql/);
  assert.match(section, /Mai drizzle-kit, mai `db:push`/);
  assert.match(section, /\*\*Ritorno indietro:\*\* un passo su Vercel \(Promote del deploy di prima/);
  for (const table of MAPPING_BOARD_TABLES) assert.ok(section.includes(`\`${table}\``), table);
  // Il numero del codice e quello del documento sono lo stesso.
  assert.equal(Number(ensureSchema.match(/const ENSURE_VERSION = (\d+);/)?.[1]), 33);
});
