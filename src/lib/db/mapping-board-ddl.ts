/**
 * «Mappatura board»: DDL del self-heal della 0039 (docs/mappatura/MAPPATURA-BOARD-PIANO.md §3.2, §3.4).
 *
 * Sono gli stessi statement di `drizzle/0039_mapping_board.sql`, nello stesso ordine, dopo le due righe di apertura del
 * file (`lock_timeout` e l'advisory lock {@link MAPPING_BOARD_ADVISORY_LOCK}, che il self-heal prende da sé in
 * `runMappingBoardDdl`):
 * 1. controllo che `activities` e `departments` ci siano (drizzle/0000);
 * 2. due indici unici per le chiavi esterne composte (`departments (id, workspace_id)`, `activities (id, department_id,
 *    workspace_id)`) e due indici su `activities` (unità, workspace), che oggi non ne ha;
 * 3. `mapping_boards`: una riga per unità, con la revisione della board, la frase di sintesi e quando è stata completata;
 * 4. `mapping_processes`: i processi di un'unità (le righe della mappa), in ordine;
 * 5. `mapping_steps`: una riga per attività, con quello che la board aggiunge (processo, posizione, chi, eccezione, nome
 *    della decisione, attrito, stato, origine, la proposta del classificatore);
 * 6. `mapping_notes`: le note di un passo per corsia e i punti di analisi della board (senza passo);
 * 7. `mapping_votes`: i voti di ogni persona su un processo.
 *
 * Nessun dato scritto, nessuna colonna aggiunta, cambiata o tolta nelle tabelle di prima: `activities`, `departments` e
 * `activity_dependencies` restano come sono, e il codice di prima ignora le tabelle nuove.
 *
 * Lo scope sta nel database: un processo, una nota e un voto appartengono sempre al workspace della loro unità; la riga
 * di un passo e le sue note all'unità e al workspace della loro attività (chiavi esterne composte).
 * `ON DELETE SET NULL (process_id)` chiede PostgreSQL 15 (produzione 17, cluster di test 16).
 *
 * I limiti vengono da `MAPPING_LIMITS` e dal vocabolario di `../mappatura/vocab.ts`: `mapping-board-ddl.test.ts`
 * controlla che la migrazione contenga questi statement, nello stesso ordine e nient'altro, che i CHECK siano le regole
 * qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo il vocabolario; lo caricano anche gli script di verifica.
 */
import { FRICTIONS, LANES, MAPPING_LIMITS, NOTE_STATUSES, ORIGINS, STEP_STATUSES, STREAMS } from "../mappatura/vocab.ts";

/** La chiave dell'advisory lock della 0039: la stessa nel file e in `runMappingBoardDdl`. */
export const MAPPING_BOARD_ADVISORY_LOCK = "unbundle:mapping-board-ddl";

/** Errore della 0039 su un database senza le tabelle di partenza. */
export const MISSING_ACTIVITIES_FOR_BOARD_MESSAGE = "mapping_board: mancano le tabelle activities e departments (drizzle/0000).";

/** Il titolo dell'occupazione O*NET che il match restituisce (`mapping_steps.onet_title`), al massimo. */
export const ONET_TITLE_MAX = 200;

// ─── Composizione del testo SQL ──────────────────────────────────────

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
/** La larghezza di un `varchar` che tiene ogni parola dell'elenco. */
const widest = (values: readonly string[]) => Math.max(...values.map((value) => value.length));
const L = MAPPING_LIMITS;
/** Un testo facoltativo: assente, oppure con almeno un carattere che non sia uno spazio, entro `max`. */
const optionalText = (column: string, max: number) => `${column} IS NULL OR length(btrim(${column})) BETWEEN 1 AND ${max}`;
const FRICTION_MIN = Math.min(...FRICTIONS);
const FRICTION_MAX = Math.max(...FRICTIONS);

/** Le larghezze dei `varchar` che tengono una parola del vocabolario (le controlla il test del DDL). */
export const MAPPING_BOARD_WIDTHS = Object.freeze({
  stepStatus: 12,
  origin: 10,
  stream: 13,
  lane: 8,
  noteStatus: 8,
});
for (const [name, width, words] of [
  ["stepStatus", MAPPING_BOARD_WIDTHS.stepStatus, STEP_STATUSES],
  ["origin", MAPPING_BOARD_WIDTHS.origin, ORIGINS],
  ["stream", MAPPING_BOARD_WIDTHS.stream, STREAMS],
  ["lane", MAPPING_BOARD_WIDTHS.lane, LANES],
  ["noteStatus", MAPPING_BOARD_WIDTHS.noteStatus, NOTE_STATUSES],
] as const) {
  if (widest(words) > width) throw new Error(`mapping-board-ddl: una parola di ${name} non entra in varchar(${width})`);
}
const W = MAPPING_BOARD_WIDTHS;

/** Gli statement della 0039 dopo le due righe di apertura, nell'ordine del file; i limiti vengono da MAPPING_LIMITS. */
export const MAPPING_BOARD_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.activities') IS NULL OR to_regclass('public.departments') IS NULL THEN
    RAISE EXCEPTION '${MISSING_ACTIVITIES_FOR_BOARD_MESSAGE}';
  END IF;
END $$;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS departments_scope_unique ON departments (id, workspace_id);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS activities_scope_unique ON activities (id, department_id, workspace_id);`,
  `CREATE INDEX IF NOT EXISTS activities_department_idx ON activities (department_id);`,
  `CREATE INDEX IF NOT EXISTS activities_workspace_idx ON activities (workspace_id);`,
  `CREATE TABLE IF NOT EXISTS mapping_boards (
  department_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CONSTRAINT mapping_boards_revision_check CHECK (revision >= 0),
  headline varchar(${L.headline}) CONSTRAINT mapping_boards_headline_check CHECK (${optionalText("headline", L.headline)}),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_boards_pkey PRIMARY KEY (department_id),
  CONSTRAINT mapping_boards_unit_fkey FOREIGN KEY (department_id, workspace_id) REFERENCES departments (id, workspace_id) ON DELETE CASCADE
);`,
  `CREATE TABLE IF NOT EXISTS mapping_processes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  name varchar(${L.processName}) NOT NULL CONSTRAINT mapping_processes_name_check CHECK (length(btrim(name)) BETWEEN 1 AND ${L.processName}),
  owner varchar(${L.owner}) CONSTRAINT mapping_processes_owner_check CHECK (${optionalText("owner", L.owner)}),
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_processes_pkey PRIMARY KEY (id),
  CONSTRAINT mapping_processes_scope_unique UNIQUE (id, department_id, workspace_id),
  CONSTRAINT mapping_processes_unit_fkey FOREIGN KEY (department_id, workspace_id) REFERENCES departments (id, workspace_id) ON DELETE CASCADE
);`,
  `CREATE INDEX IF NOT EXISTS mapping_processes_unit_idx ON mapping_processes (department_id, position);`,
  `CREATE TABLE IF NOT EXISTS mapping_steps (
  activity_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  process_id uuid,
  position double precision NOT NULL DEFAULT 0,
  who jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT mapping_steps_who_check CHECK (jsonb_typeof(who) = 'array' AND jsonb_array_length(who) <= ${L.who}),
  exception_text text CONSTRAINT mapping_steps_exception_check CHECK (${optionalText("exception_text", L.exception)}),
  decision_label varchar(${L.decisionLabel}) CONSTRAINT mapping_steps_decision_label_check CHECK (${optionalText("decision_label", L.decisionLabel)}),
  friction_level smallint CONSTRAINT mapping_steps_friction_check CHECK (friction_level IS NULL OR friction_level BETWEEN ${FRICTION_MIN} AND ${FRICTION_MAX}),
  status varchar(${W.stepStatus}) NOT NULL DEFAULT 'da_validare' CONSTRAINT mapping_steps_status_check CHECK (status IN (${quoted(STEP_STATUSES)})),
  origin varchar(${W.origin}) NOT NULL DEFAULT 'prima' CONSTRAINT mapping_steps_origin_check CHECK (origin IN (${quoted(ORIGINS)})),
  proposed_stream varchar(${W.stream}) CONSTRAINT mapping_steps_proposed_check CHECK (proposed_stream IS NULL OR proposed_stream IN (${quoted(STREAMS)})),
  classification_reason text CONSTRAINT mapping_steps_reason_check CHECK (classification_reason IS NULL OR length(classification_reason) <= ${L.description}),
  ai_potential text CONSTRAINT mapping_steps_potential_check CHECK (ai_potential IS NULL OR length(ai_potential) <= ${L.description}),
  onet_title varchar(${ONET_TITLE_MAX}),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_steps_pkey PRIMARY KEY (activity_id),
  CONSTRAINT mapping_steps_activity_fkey FOREIGN KEY (activity_id, department_id, workspace_id) REFERENCES activities (id, department_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT mapping_steps_process_fkey FOREIGN KEY (process_id, department_id, workspace_id) REFERENCES mapping_processes (id, department_id, workspace_id) ON DELETE SET NULL (process_id)
);`,
  `CREATE INDEX IF NOT EXISTS mapping_steps_unit_idx ON mapping_steps (department_id, process_id, position);`,
  `CREATE TABLE IF NOT EXISTS mapping_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  activity_id uuid,
  lane varchar(${W.lane}) NOT NULL CONSTRAINT mapping_notes_lane_check CHECK (lane IN (${quoted(LANES)})),
  title varchar(${L.noteTitle}) CONSTRAINT mapping_notes_title_check CHECK (${optionalText("title", L.noteTitle)}),
  body text NOT NULL CONSTRAINT mapping_notes_body_check CHECK (length(btrim(body)) BETWEEN 1 AND ${L.note}),
  status varchar(${W.noteStatus}) NOT NULL DEFAULT 'validato' CONSTRAINT mapping_notes_status_check CHECK (status IN (${quoted(NOTE_STATUSES)})),
  origin varchar(${W.origin}) NOT NULL DEFAULT 'board' CONSTRAINT mapping_notes_origin_check CHECK (origin IN (${quoted(ORIGINS)})),
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_notes_pkey PRIMARY KEY (id),
  CONSTRAINT mapping_notes_unit_fkey FOREIGN KEY (department_id, workspace_id) REFERENCES departments (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT mapping_notes_step_fkey FOREIGN KEY (activity_id, department_id, workspace_id) REFERENCES activities (id, department_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT mapping_notes_scope_check CHECK ((lane = 'analisi') = (activity_id IS NULL)),
  CONSTRAINT mapping_notes_title_lane_check CHECK (title IS NULL OR lane = 'analisi')
);`,
  `CREATE INDEX IF NOT EXISTS mapping_notes_step_idx ON mapping_notes (activity_id, lane, position);`,
  `CREATE INDEX IF NOT EXISTS mapping_notes_unit_idx ON mapping_notes (department_id) WHERE activity_id IS NULL;`,
  `CREATE TABLE IF NOT EXISTS mapping_votes (
  process_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  votes smallint NOT NULL CONSTRAINT mapping_votes_votes_check CHECK (votes BETWEEN 0 AND ${L.votes}),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_votes_pkey PRIMARY KEY (process_id, user_id),
  CONSTRAINT mapping_votes_process_fkey FOREIGN KEY (process_id, department_id, workspace_id) REFERENCES mapping_processes (id, department_id, workspace_id) ON DELETE CASCADE
);`,
  `CREATE INDEX IF NOT EXISTS mapping_votes_user_idx ON mapping_votes (user_id);`,
];

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0039. */
export const MAPPING_BOARD_TABLES = ["mapping_boards", "mapping_processes", "mapping_steps", "mapping_notes", "mapping_votes"] as const;

/** Gli indici della 0039, per nome (oltre alle chiavi primarie e ai vincoli UNIQUE): i primi quattro sulle tabelle di prima. */
export const MAPPING_BOARD_INDEXES = [
  "departments_scope_unique",
  "activities_scope_unique",
  "activities_department_idx",
  "activities_workspace_idx",
  "mapping_processes_unit_idx",
  "mapping_steps_unit_idx",
  "mapping_notes_step_idx",
  "mapping_notes_unit_idx",
  "mapping_votes_user_idx",
] as const;

/** I 34 vincoli con nome delle cinque tabelle (pkey, fkey composte, check, unique). */
export const MAPPING_BOARD_NAMED_CONSTRAINTS: readonly string[] = [
  "mapping_boards_revision_check",
  "mapping_boards_headline_check",
  "mapping_boards_pkey",
  "mapping_boards_unit_fkey",
  "mapping_processes_name_check",
  "mapping_processes_owner_check",
  "mapping_processes_pkey",
  "mapping_processes_scope_unique",
  "mapping_processes_unit_fkey",
  "mapping_steps_who_check",
  "mapping_steps_exception_check",
  "mapping_steps_decision_label_check",
  "mapping_steps_friction_check",
  "mapping_steps_status_check",
  "mapping_steps_origin_check",
  "mapping_steps_proposed_check",
  "mapping_steps_reason_check",
  "mapping_steps_potential_check",
  "mapping_steps_pkey",
  "mapping_steps_activity_fkey",
  "mapping_steps_process_fkey",
  "mapping_notes_lane_check",
  "mapping_notes_title_check",
  "mapping_notes_body_check",
  "mapping_notes_status_check",
  "mapping_notes_origin_check",
  "mapping_notes_pkey",
  "mapping_notes_unit_fkey",
  "mapping_notes_step_fkey",
  "mapping_notes_scope_check",
  "mapping_notes_title_lane_check",
  "mapping_votes_votes_check",
  "mapping_votes_pkey",
  "mapping_votes_process_fkey",
];

/** Vera solo con tutto il DDL della 0039: tabelle, indici, vincoli con nome. Per ensureDbSchema() e mappingStoreReady(). */
export const MAPPING_BOARD_PROBE_SQL = `(
  ${MAPPING_BOARD_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${MAPPING_BOARD_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${MAPPING_BOARD_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(MAPPING_BOARD_NAMED_CONSTRAINTS)})
  ) = ${MAPPING_BOARD_NAMED_CONSTRAINTS.length}
)`;
