-- Rilascio 8.0a «Agent Factory»: progetto, decisioni e pacchetto di uno use case (docs/rilascio-8/RILASCIO-8.0-PIANO.md).
-- L'impostazione del caso si segue da Unbundle: le scelte dei 10 argomenti, le decisioni e il pacchetto versionato.
--
-- Questa migrazione aggiunge:
--   - use_case_packages: le versioni del pacchetto (k1, k2, …) con PACCHETTO.md, BRIEF.md e VERSIONE, l'impronta
--     del contenuto e da dove vengono (generato da Unbundle o importato, come il k1 di TJ-0049 fatto a mano);
--   - use_case_projects: le versioni del progetto (i 10 argomenti con scelta, perché e alternativa scartata, il
--     framework, gli strumenti nuovi, la stima), una sola aperta e una sola approvata per use case, con l'ok del
--     responsabile e, se ci sono strumenti nuovi, dell'AI Board;
--   - use_case_decisions: le decisioni del caso, dall'impostazione o del team, che si aggiungono e non si riscrivono;
--   - il CHECK dei tipi della campanella (use_case_notifications_kind_check) allargato con «progetto_appr»,
--     «strumento_nuovo» e «pacchetto_nuovo», con lo stesso nome (NOT VALID poi VALIDATE, che non può fallire), sotto
--     l'advisory lock della 0025.
-- Le tabelle stanno sullo use case, non sul dossier: il DDL uc (0018) non cambia.
-- Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto: il codice del
-- rilascio 7 ignora le tabelle nuove e non scrive mai i valori nuovi.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy: gli
-- stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-factory-ddl.ts (ensureDbSchema, dopo la
-- 0029, ENSURE_VERSION 24). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0030_agent_factory.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-factory-ddl'));

DO $$ BEGIN
  IF to_regclass('public.program_settings') IS NULL THEN
    RAISE EXCEPTION 'factory: manca la 0029. Applica prima drizzle/0029_program.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS use_case_packages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version integer NOT NULL CONSTRAINT use_case_packages_version_check CHECK (version BETWEEN 1 AND 9999),
  content_hash varchar(64) NOT NULL CONSTRAINT use_case_packages_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  files jsonb NOT NULL CONSTRAINT use_case_packages_files_check CHECK (jsonb_typeof(files) = 'object' AND coalesce(jsonb_typeof(files -> 'PACCHETTO.md'), 'assente') = 'string' AND coalesce(jsonb_typeof(files -> 'BRIEF.md'), 'assente') = 'string' AND coalesce(jsonb_typeof(files -> 'VERSIONE'), 'assente') = 'string'),
  source varchar(10) NOT NULL CONSTRAINT use_case_packages_source_check CHECK (source IN ('generato', 'importato')),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT use_case_packages_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_packages_size_check CHECK (octet_length(files::text) <= 200000)
);

CREATE UNIQUE INDEX IF NOT EXISTS use_case_packages_version_unique ON use_case_packages (use_case_id, version);

CREATE INDEX IF NOT EXISTS use_case_packages_hash_idx ON use_case_packages (use_case_id, content_hash);

CREATE INDEX IF NOT EXISTS use_case_packages_workspace_idx ON use_case_packages (workspace_id);

CREATE TABLE IF NOT EXISTS use_case_projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version integer NOT NULL CONSTRAINT use_case_projects_version_check CHECK (version BETWEEN 1 AND 999),
  status varchar(12) NOT NULL DEFAULT 'in_corso' CONSTRAINT use_case_projects_status_check CHECK (status IN ('in_corso', 'da_approvare', 'approvato', 'superato')),
  revision integer NOT NULL DEFAULT 1 CONSTRAINT use_case_projects_revision_check CHECK (revision >= 1),
  topics jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT use_case_projects_topics_check CHECK (jsonb_typeof(topics) = 'object'),
  framework varchar(10) CONSTRAINT use_case_projects_framework_check CHECK (framework IS NULL OR framework IN ('codice', 'langgraph', 'agent_sdk', 'cowork', 'n8n', 'altro')),
  new_tools jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT use_case_projects_new_tools_check CHECK (jsonb_typeof(new_tools) = 'array' AND jsonb_array_length(new_tools) <= 20),
  estimate_hours numeric(8,1) CONSTRAINT use_case_projects_hours_check CHECK (estimate_hours IS NULL OR estimate_hours BETWEEN 0 AND 100000),
  monthly_cost_eur numeric(12,2) CONSTRAINT use_case_projects_cost_check CHECK (monthly_cost_eur IS NULL OR monthly_cost_eur BETWEEN 0 AND 10000000),
  standard_version varchar(10),
  catalog_version varchar(10),
  package_version integer CONSTRAINT use_case_projects_package_check CHECK (package_version IS NULL OR package_version BETWEEN 1 AND 9999),
  submitted_at timestamptz,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ai_board_ok_at timestamptz,
  ai_board_ok_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ai_board_note varchar(300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT use_case_projects_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_projects_approved_check CHECK (status <> 'approvato' OR approved_at IS NOT NULL),
  CONSTRAINT use_case_projects_submitted_check CHECK (status <> 'da_approvare' OR submitted_at IS NOT NULL),
  CONSTRAINT use_case_projects_ai_board_check CHECK (status <> 'approvato' OR jsonb_array_length(new_tools) = 0 OR ai_board_ok_at IS NOT NULL)
);

CREATE UNIQUE INDEX IF NOT EXISTS use_case_projects_version_unique ON use_case_projects (use_case_id, version);

CREATE UNIQUE INDEX IF NOT EXISTS use_case_projects_open_unique ON use_case_projects (use_case_id) WHERE status IN ('in_corso', 'da_approvare');

CREATE UNIQUE INDEX IF NOT EXISTS use_case_projects_approved_unique ON use_case_projects (use_case_id) WHERE status = 'approvato';

CREATE INDEX IF NOT EXISTS use_case_projects_workspace_idx ON use_case_projects (workspace_id);

CREATE TABLE IF NOT EXISTS use_case_decisions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  decided_on date NOT NULL,
  topic_key varchar(16) CONSTRAINT use_case_decisions_topic_key_check CHECK (topic_key IS NULL OR topic_key IN ('funzionalita', 'journey', 'dati', 'framework', 'backend', 'frontend', 'integrazioni', 'modelli', 'osservabilita', 'evals_autonomia')),
  topic varchar(80) NOT NULL CONSTRAINT use_case_decisions_topic_check CHECK (length(btrim(topic)) > 0),
  choice varchar(500) NOT NULL CONSTRAINT use_case_decisions_choice_check CHECK (length(btrim(choice)) > 0),
  reason varchar(1000),
  rejected varchar(500),
  source varchar(12) NOT NULL CONSTRAINT use_case_decisions_source_check CHECK (source IN ('impostazione', 'team', 'importata')),
  project_version integer CONSTRAINT use_case_decisions_project_check CHECK (project_version IS NULL OR project_version BETWEEN 1 AND 999),
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_role varchar(60),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_decisions_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS use_case_decisions_case_idx ON use_case_decisions (use_case_id, decided_on, created_at);

CREATE INDEX IF NOT EXISTS use_case_decisions_workspace_idx ON use_case_decisions (workspace_id);

SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-alerts-ddl'));

DO $$
DECLARE
  wanted text[] := ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori', 'domanda', 'da_rivedere', 'progetto_appr', 'strumento_nuovo', 'pacchetto_nuovo']::text[];
  current_def text;
  current_valid boolean;
  allowed text[];
BEGIN
  -- Mai in coda dietro una transazione lunga: ogni lock aspetta al massimo 3s, poi ci si ferma.
  PERFORM set_config('lock_timeout', '3s', true);
  SELECT pg_get_constraintdef(c.oid), c.convalidated INTO current_def, current_valid
    FROM pg_constraint c
   WHERE c.conrelid = 'public.use_case_notifications'::regclass AND c.conname = 'use_case_notifications_kind_check';
  -- Mai restringere: ai tipi voluti seguono quelli che il vincolo di adesso ammette già.
  allowed := wanted || coalesce((
    SELECT array_agg(found.name ORDER BY found.first_at)
      FROM (SELECT r.m[1] AS name, min(r.n) AS first_at
              FROM regexp_matches(coalesce(current_def, ''), '''([a-z0-9_]+)''::', 'g') WITH ORDINALITY AS r(m, n)
             GROUP BY r.m[1]) AS found
     WHERE found.name <> ALL (wanted)
  ), '{}'::text[]);
  IF current_def IS NULL
     OR EXISTS (SELECT 1 FROM unnest(wanted) AS w(name) WHERE position(quote_literal(w.name) || '::' IN current_def) = 0) THEN
    ALTER TABLE use_case_notifications DROP CONSTRAINT IF EXISTS use_case_notifications_kind_check;
    EXECUTE 'ALTER TABLE use_case_notifications ADD CONSTRAINT use_case_notifications_kind_check CHECK (kind IN ('
      || (SELECT string_agg(quote_literal(a.name), ', ' ORDER BY a.n) FROM unnest(allowed) WITH ORDINALITY AS a(name, n))
      || ')) NOT VALID';
    current_valid := false;
  END IF;
  IF NOT current_valid THEN
    IF EXISTS (SELECT 1 FROM use_case_notifications n WHERE NOT (n.kind = ANY (allowed))) THEN
      RAISE WARNING 'use_case_notifications: righe con tipi fuori elenco, use_case_notifications_kind_check resta NOT VALID (vale per le righe nuove).';
    ELSE
      ALTER TABLE use_case_notifications VALIDATE CONSTRAINT use_case_notifications_kind_check;
    END IF;
  END IF;
END $$;
