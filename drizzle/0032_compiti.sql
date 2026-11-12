-- Rilascio 8.1a «Lavoro in parallelo» (docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md).
-- I compiti degli use case in Unbundle, le note di passaggio e i repository della fabbrica di un workspace.
--
-- Questa migrazione aggiunge:
--   - use_case_tasks: i compiti di uno use case (T-1, T-2, …), nati dal progetto. Unbundle ne è la fonte; nel
--     repository casi/<id>/progetto/compiti.md è uno specchio. Chi ha un compito si vede sul compito, ma non si
--     conta mai per persona (art. 15.4);
--   - use_case_task_notes: le note di passaggio e le richieste di un compito (di una richiesta si tiene chi la fa);
--   - use_case_factory_repos: i repository della fabbrica di un workspace (di famiglia o comuni del cliente), con
--     la versione del modello e del comune che hanno;
--   - il CHECK dei tipi della campanella (use_case_notifications_kind_check) allargato con «compito_chiesto»,
--     «compito_passato», «compito_fermo» e «compiti_pronti», con lo stesso nome (NOT VALID poi VALIDATE, che non
--     può fallire), sotto l'advisory lock della 0025.
-- Il DDL uc (0018) non cambia.
-- Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto: il codice della
-- 8.0b ignora le tabelle nuove e non scrive mai i tipi nuovi.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy: gli
-- stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-tasks-ddl.ts (ensureDbSchema, dopo la
-- 0031, ENSURE_VERSION 26). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0032_compiti.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-tasks-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_build_sessions') IS NULL THEN
    RAISE EXCEPTION 'compiti: manca la 0031. Applica prima drizzle/0031_cli.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS use_case_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ref varchar(12) NOT NULL CONSTRAINT use_case_tasks_ref_check CHECK (ref ~ '^T-[1-9][0-9]{0,3}$'),
  title varchar(200) NOT NULL CONSTRAINT use_case_tasks_title_check CHECK (length(btrim(title)) > 0),
  areas jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT use_case_tasks_areas_check CHECK (jsonb_typeof(areas) = 'array' AND jsonb_array_length(areas) <= 20),
  estimate_hours numeric(6,1) CONSTRAINT use_case_tasks_hours_check CHECK (estimate_hours IS NULL OR estimate_hours BETWEEN 0 AND 1000),
  evidence varchar(300),
  status varchar(12) NOT NULL DEFAULT 'da_fare' CONSTRAINT use_case_tasks_status_check CHECK (status IN ('da_fare', 'in_corso', 'in_revisione', 'fatto', 'annullato')),
  holder_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  taken_at timestamptz,
  last_activity_at timestamptz,
  stale_asked_at timestamptz,
  stale_escalated_at timestamptz,
  branch varchar(120),
  pr_url varchar(300) CONSTRAINT use_case_tasks_pr_check CHECK (pr_url IS NULL OR pr_url ~ '^https://github\.com/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}/pull/[0-9]{1,9}$'),
  source varchar(10) NOT NULL CONSTRAINT use_case_tasks_source_check CHECK (source IN ('progetto', 'cli', 'pagina', 'github', 'slack')),
  project_version integer CONSTRAINT use_case_tasks_project_check CHECK (project_version IS NULL OR project_version BETWEEN 1 AND 999),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_tasks_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_tasks_ref_unique UNIQUE (use_case_id, ref)
);

CREATE INDEX IF NOT EXISTS use_case_tasks_case_idx ON use_case_tasks (use_case_id, status);

CREATE INDEX IF NOT EXISTS use_case_tasks_workspace_idx ON use_case_tasks (workspace_id);

CREATE INDEX IF NOT EXISTS use_case_tasks_open_holder_idx ON use_case_tasks (holder_user_id) WHERE status IN ('in_corso', 'in_revisione');

CREATE TABLE IF NOT EXISTS use_case_task_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES use_case_tasks(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL CONSTRAINT use_case_task_notes_kind_check CHECK (kind IN ('passaggio', 'richiesta')),
  body varchar(2000) NOT NULL CONSTRAINT use_case_task_notes_body_check CHECK (length(btrim(body)) > 0),
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_task_notes_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_task_notes_requester_check CHECK (kind = 'richiesta' OR requested_by_user_id IS NULL)
);

CREATE INDEX IF NOT EXISTS use_case_task_notes_task_idx ON use_case_task_notes (task_id, created_at);

CREATE INDEX IF NOT EXISTS use_case_task_notes_workspace_idx ON use_case_task_notes (workspace_id);

CREATE TABLE IF NOT EXISTS use_case_factory_repos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo varchar(140) NOT NULL CONSTRAINT use_case_factory_repos_repo_check CHECK (repo ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'),
  kind varchar(10) NOT NULL DEFAULT 'famiglia' CONSTRAINT use_case_factory_repos_kind_check CHECK (kind IN ('famiglia', 'comune')),
  template_version varchar(20) CONSTRAINT use_case_factory_repos_template_check CHECK (template_version IS NULL OR template_version ~ '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$'),
  common_version varchar(20) CONSTRAINT use_case_factory_repos_common_check CHECK (common_version IS NULL OR common_version ~ '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$'),
  reported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_factory_repos_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_factory_repos_unique UNIQUE (workspace_id, repo)
);

SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-alerts-ddl'));

DO $$
DECLARE
  wanted text[] := ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori', 'domanda', 'da_rivedere', 'progetto_appr', 'strumento_nuovo', 'pacchetto_nuovo', 'progetto_ok', 'modifica_chiesta', 'ok_decaduto', 'domanda_agente', 'compito_chiesto', 'compito_passato', 'compito_fermo', 'compiti_pronti']::text[];
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
