-- «Mappatura board» (docs/mappatura/MAPPATURA-BOARD-PIANO.md §3). L'activity mapping di un'unità diventa una board:
-- i processi di oggi come righe di passi, con chi li fa, le note per corsia e i voti.
--
-- Questa migrazione aggiunge:
--   - mapping_boards: una riga per unità, con la revisione della board, la frase di sintesi e quando è stata completata;
--   - mapping_processes: i processi di un'unità (le righe della mappa), in ordine;
--   - mapping_steps: una riga per attività, con quello che la board aggiunge (processo, posizione, chi, eccezione, nome
--     della decisione, attrito, stato, origine, la proposta del classificatore);
--   - mapping_notes: le note di un passo per corsia e i punti di analisi della board;
--   - mapping_votes: i voti di ogni persona su un processo;
--   - mapping_applied_ops: le operazioni già applicate (id ed esito, per 30 giorni): un salvataggio rimandato risponde
--     con l'esito di allora e non scrive una seconda volta;
--   - due indici unici (departments, activities) per le chiavi esterne composte, e due indici su activities.
-- Nessun dato scritto, nessuna colonna aggiunta, cambiata o tolta nelle tabelle di prima: activities, departments e
-- activity_dependencies restano come sono, e il codice di prima ignora le tabelle nuove.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy: gli
-- stessi statement, nello stesso ordine, sono in src/lib/db/mapping-board-ddl.ts (ensureDbSchema, dopo la
-- 0038, ENSURE_VERSION 33). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0039_mapping_board.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:mapping-board-ddl'));

DO $$ BEGIN
  IF to_regclass('public.activities') IS NULL OR to_regclass('public.departments') IS NULL THEN
    RAISE EXCEPTION 'mapping_board: mancano le tabelle activities e departments (drizzle/0000).';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS departments_scope_unique ON departments (id, workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS activities_scope_unique ON activities (id, department_id, workspace_id);

CREATE INDEX IF NOT EXISTS activities_department_idx ON activities (department_id);

CREATE INDEX IF NOT EXISTS activities_workspace_idx ON activities (workspace_id);

CREATE TABLE IF NOT EXISTS mapping_boards (
  department_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  revision bigint NOT NULL DEFAULT 0 CONSTRAINT mapping_boards_revision_check CHECK (revision >= 0),
  headline varchar(300) CONSTRAINT mapping_boards_headline_check CHECK (headline IS NULL OR length(btrim(headline)) BETWEEN 1 AND 300),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_boards_pkey PRIMARY KEY (department_id),
  CONSTRAINT mapping_boards_unit_fkey FOREIGN KEY (department_id, workspace_id) REFERENCES departments (id, workspace_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS mapping_processes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  name varchar(120) NOT NULL CONSTRAINT mapping_processes_name_check CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  owner varchar(200) CONSTRAINT mapping_processes_owner_check CHECK (owner IS NULL OR length(btrim(owner)) BETWEEN 1 AND 200),
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_processes_pkey PRIMARY KEY (id),
  CONSTRAINT mapping_processes_scope_unique UNIQUE (id, department_id, workspace_id),
  CONSTRAINT mapping_processes_unit_fkey FOREIGN KEY (department_id, workspace_id) REFERENCES departments (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS mapping_processes_unit_idx ON mapping_processes (department_id, position);

CREATE TABLE IF NOT EXISTS mapping_steps (
  activity_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  process_id uuid,
  position double precision NOT NULL DEFAULT 0,
  who jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT mapping_steps_who_check CHECK (jsonb_typeof(who) = 'array' AND jsonb_array_length(who) <= 12),
  exception_text text CONSTRAINT mapping_steps_exception_check CHECK (exception_text IS NULL OR length(btrim(exception_text)) BETWEEN 1 AND 2000),
  decision_label varchar(60) CONSTRAINT mapping_steps_decision_label_check CHECK (decision_label IS NULL OR length(btrim(decision_label)) BETWEEN 1 AND 60),
  friction_level smallint CONSTRAINT mapping_steps_friction_check CHECK (friction_level IS NULL OR friction_level BETWEEN 0 AND 3),
  status varchar(12) NOT NULL DEFAULT 'da_validare' CONSTRAINT mapping_steps_status_check CHECK (status IN ('da_validare', 'confermato')),
  origin varchar(10) NOT NULL DEFAULT 'prima' CONSTRAINT mapping_steps_origin_check CHECK (origin IN ('chat', 'documenti', 'board', 'prima')),
  proposed_stream varchar(13) CONSTRAINT mapping_steps_proposed_check CHECK (proposed_stream IS NULL OR proposed_stream IN ('automate', 'differentiate', 'innovate')),
  classification_reason text CONSTRAINT mapping_steps_reason_check CHECK (classification_reason IS NULL OR length(classification_reason) <= 2000),
  ai_potential text CONSTRAINT mapping_steps_potential_check CHECK (ai_potential IS NULL OR length(ai_potential) <= 2000),
  onet_title varchar(200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_steps_pkey PRIMARY KEY (activity_id),
  CONSTRAINT mapping_steps_activity_fkey FOREIGN KEY (activity_id, department_id, workspace_id) REFERENCES activities (id, department_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT mapping_steps_process_fkey FOREIGN KEY (process_id, department_id, workspace_id) REFERENCES mapping_processes (id, department_id, workspace_id) ON DELETE SET NULL (process_id)
);

CREATE INDEX IF NOT EXISTS mapping_steps_unit_idx ON mapping_steps (department_id, process_id, position);

CREATE TABLE IF NOT EXISTS mapping_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  activity_id uuid,
  lane varchar(8) NOT NULL CONSTRAINT mapping_notes_lane_check CHECK (lane IN ('attivita', 'attriti', 'dati', 'tempi', 'idee', 'analisi')),
  title varchar(120) CONSTRAINT mapping_notes_title_check CHECK (title IS NULL OR length(btrim(title)) BETWEEN 1 AND 120),
  body text NOT NULL CONSTRAINT mapping_notes_body_check CHECK (length(btrim(body)) BETWEEN 1 AND 2000),
  status varchar(8) NOT NULL DEFAULT 'validato' CONSTRAINT mapping_notes_status_check CHECK (status IN ('ipotesi', 'validato', 'fonte')),
  origin varchar(10) NOT NULL DEFAULT 'board' CONSTRAINT mapping_notes_origin_check CHECK (origin IN ('chat', 'documenti', 'board', 'prima')),
  position double precision NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_notes_pkey PRIMARY KEY (id),
  CONSTRAINT mapping_notes_unit_fkey FOREIGN KEY (department_id, workspace_id) REFERENCES departments (id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT mapping_notes_step_fkey FOREIGN KEY (activity_id, department_id, workspace_id) REFERENCES activities (id, department_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT mapping_notes_scope_check CHECK ((lane = 'analisi') = (activity_id IS NULL)),
  CONSTRAINT mapping_notes_title_lane_check CHECK (title IS NULL OR lane = 'analisi')
);

CREATE INDEX IF NOT EXISTS mapping_notes_step_idx ON mapping_notes (activity_id, lane, position);

CREATE INDEX IF NOT EXISTS mapping_notes_unit_idx ON mapping_notes (department_id) WHERE activity_id IS NULL;

CREATE TABLE IF NOT EXISTS mapping_votes (
  process_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  votes smallint NOT NULL CONSTRAINT mapping_votes_votes_check CHECK (votes BETWEEN 0 AND 99),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_votes_pkey PRIMARY KEY (process_id, user_id),
  CONSTRAINT mapping_votes_process_fkey FOREIGN KEY (process_id, department_id, workspace_id) REFERENCES mapping_processes (id, department_id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS mapping_votes_user_idx ON mapping_votes (user_id);

CREATE TABLE IF NOT EXISTS mapping_applied_ops (
  op_id uuid NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  department_id uuid NOT NULL,
  outcome varchar(8) NOT NULL CONSTRAINT mapping_applied_ops_outcome_check CHECK (outcome IN ('ok', 'conflict', 'gone', 'limit', 'linked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mapping_applied_ops_pkey PRIMARY KEY (op_id),
  CONSTRAINT mapping_applied_ops_unit_fkey FOREIGN KEY (department_id, workspace_id) REFERENCES departments (id, workspace_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS mapping_applied_ops_unit_idx ON mapping_applied_ops (department_id, created_at);
