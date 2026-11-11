-- Rilascio 8.0b «La CLI e l'MCP» (docs/rilascio-8/RILASCIO-8.0b-COSTRUZIONE.md).
-- La CLI di Unbundle e l'MCP del caso per chi costruisce gli agenti con i coding agent.
--
-- Questa migrazione aggiunge:
--   - use_case_cli_logins: i codici del login dal browser della CLI (della CLI resta solo l'impronta; il codice da
--     leggere vale 10 minuti e una volta sola). Il token che nasce sta in workspace_integration_tokens;
--   - use_case_repos: il repository e la cartella di uno use case, con il profilo del catalogo;
--   - use_case_agent_questions: le domande per il referente proposte da un coding agent, che non partono mai da
--     sole (una persona le aggiunge a «Cosa serve» o le scarta);
--   - use_case_build_sessions: la sintesi di una sessione di un coding agent (compito, harness, modello, token,
--     costo, durata, esito, PR), senza nessuna colonna sulla persona;
--   - il CHECK dei tipi della campanella (use_case_notifications_kind_check) allargato con «domanda_agente», con lo
--     stesso nome (NOT VALID poi VALIDATE, che non può fallire), sotto l'advisory lock della 0025.
-- Il DDL uc (0018) non cambia.
-- Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto: il codice della
-- 8.0a ignora le tabelle nuove e non scrive mai il tipo nuovo.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy: gli
-- stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-cli-ddl.ts (ensureDbSchema, dopo la
-- 0030, ENSURE_VERSION 25). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0031_cli.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-cli-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_projects') IS NULL THEN
    RAISE EXCEPTION 'cli: manca la 0030. Applica prima drizzle/0030_agent_factory.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS use_case_cli_logins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_code_hash char(64) NOT NULL CONSTRAINT use_case_cli_logins_device_check CHECK (device_code_hash ~ '^[0-9a-f]{64}$'),
  user_code varchar(9) NOT NULL CONSTRAINT use_case_cli_logins_code_check CHECK (user_code ~ '^[BCDFGHJKLMNPQRSTVWXZ]{4}-[BCDFGHJKLMNPQRSTVWXZ]{4}$'),
  status varchar(12) NOT NULL DEFAULT 'in_attesa' CONSTRAINT use_case_cli_logins_status_check CHECK (status IN ('in_attesa', 'confermato', 'negato', 'consegnato', 'scaduto')),
  client_label varchar(80) NOT NULL CONSTRAINT use_case_cli_logins_label_check CHECK (length(btrim(client_label)) > 0),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  token_id uuid REFERENCES workspace_integration_tokens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  delivered_at timestamptz,
  CONSTRAINT use_case_cli_logins_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_cli_logins_device_unique UNIQUE (device_code_hash),
  CONSTRAINT use_case_cli_logins_confirmed_check CHECK (status NOT IN ('confermato', 'consegnato') OR (workspace_id IS NOT NULL AND user_id IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT use_case_cli_logins_delivered_check CHECK (status <> 'consegnato' OR delivered_at IS NOT NULL),
  CONSTRAINT use_case_cli_logins_expiry_check CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS use_case_cli_logins_code_live_unique ON use_case_cli_logins (user_code) WHERE status IN ('in_attesa', 'confermato');

CREATE INDEX IF NOT EXISTS use_case_cli_logins_created_idx ON use_case_cli_logins (created_at);

CREATE TABLE IF NOT EXISTS use_case_repos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo varchar(140) NOT NULL CONSTRAINT use_case_repos_repo_check CHECK (repo ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'),
  folder varchar(120) NOT NULL CONSTRAINT use_case_repos_folder_check CHECK (folder ~ '^casi/[a-z0-9][a-z0-9-]{0,40}$'),
  profile varchar(10) CONSTRAINT use_case_repos_profile_check CHECK (profile IS NULL OR profile IN ('codice', 'langgraph', 'agent_sdk', 'cowork', 'n8n', 'altro')),
  vercel_project varchar(100) CONSTRAINT use_case_repos_vercel_check CHECK (vercel_project IS NULL OR vercel_project ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_repos_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_repos_unique UNIQUE (use_case_id, repo, folder)
);

CREATE INDEX IF NOT EXISTS use_case_repos_workspace_idx ON use_case_repos (workspace_id);

CREATE TABLE IF NOT EXISTS use_case_agent_questions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question varchar(500) NOT NULL CONSTRAINT use_case_agent_questions_question_check CHECK (length(btrim(question)) > 0),
  reason varchar(300),
  status varchar(10) NOT NULL DEFAULT 'proposta' CONSTRAINT use_case_agent_questions_status_check CHECK (status IN ('proposta', 'aggiunta', 'scartata')),
  channel varchar(4) NOT NULL CONSTRAINT use_case_agent_questions_channel_check CHECK (channel IN ('cli', 'mcp')),
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  need_id uuid REFERENCES use_case_needs(id) ON DELETE SET NULL,
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_agent_questions_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_agent_questions_decided_check CHECK (status = 'proposta' OR decided_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS use_case_agent_questions_case_idx ON use_case_agent_questions (use_case_id, status, created_at);

CREATE INDEX IF NOT EXISTS use_case_agent_questions_workspace_idx ON use_case_agent_questions (workspace_id);

CREATE TABLE IF NOT EXISTS use_case_build_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_key char(64) NOT NULL CONSTRAINT use_case_build_sessions_key_check CHECK (session_key ~ '^[0-9a-f]{64}$'),
  task_ref varchar(12) CONSTRAINT use_case_build_sessions_task_check CHECK (task_ref IS NULL OR task_ref ~ '^T-[0-9]{1,4}$'),
  harness varchar(12) NOT NULL CONSTRAINT use_case_build_sessions_harness_check CHECK (harness IN ('claude_code', 'codex', 'cursor', 'altro')),
  model varchar(80) CONSTRAINT use_case_build_sessions_model_check CHECK (model IS NULL OR model ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,79}$'),
  input_tokens bigint NOT NULL DEFAULT 0 CONSTRAINT use_case_build_sessions_input_check CHECK (input_tokens BETWEEN 0 AND 10000000000),
  output_tokens bigint NOT NULL DEFAULT 0 CONSTRAINT use_case_build_sessions_output_check CHECK (output_tokens BETWEEN 0 AND 10000000000),
  cache_tokens bigint NOT NULL DEFAULT 0 CONSTRAINT use_case_build_sessions_cache_check CHECK (cache_tokens BETWEEN 0 AND 10000000000),
  cost_usd numeric(12,4) CONSTRAINT use_case_build_sessions_cost_check CHECK (cost_usd IS NULL OR cost_usd BETWEEN 0 AND 100000),
  duration_seconds integer NOT NULL CONSTRAINT use_case_build_sessions_duration_check CHECK (duration_seconds BETWEEN 0 AND 604800),
  outcome varchar(16) NOT NULL CONSTRAINT use_case_build_sessions_outcome_check CHECK (outcome IN ('pr', 'commit', 'nessuna_modifica', 'interrotta', 'errore')),
  pr_url varchar(300) CONSTRAINT use_case_build_sessions_pr_check CHECK (pr_url IS NULL OR pr_url ~ '^https://github\.com/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}/pull/[0-9]{1,9}$'),
  branch varchar(120),
  ended_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_build_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_build_sessions_unique UNIQUE (use_case_id, session_key)
);

CREATE INDEX IF NOT EXISTS use_case_build_sessions_case_idx ON use_case_build_sessions (use_case_id, ended_at);

CREATE INDEX IF NOT EXISTS use_case_build_sessions_workspace_idx ON use_case_build_sessions (workspace_id);

SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-alerts-ddl'));

DO $$
DECLARE
  wanted text[] := ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori', 'domanda', 'da_rivedere', 'progetto_appr', 'strumento_nuovo', 'pacchetto_nuovo', 'progetto_ok', 'modifica_chiesta', 'ok_decaduto', 'domanda_agente']::text[];
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
