-- Rilascio 8.1b «GitHub» (docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md, 8.1b).
-- Gli eventi di GitHub (webhook firmato dell'organizzazione o dell'app) aggiornano da soli lo stato dei compiti.
--
-- Questa migrazione aggiunge:
--   - use_case_github_deliveries: gli eventi già ricevuti, per l'id della consegna, così un evento ripetuto non conta
--     due volte. Solo evento, repository ed esito, mai il contenuto; si tengono 30 giorni;
--   - use_case_pull_requests: le pull request dei repository della fabbrica che appartengono a un caso (ramo <id>/…),
--     con il compito quando il ramo è <id>/t-<n>. Nessuna colonna su chi la apre: si legge per caso (art. 15.4);
--   - il CHECK dei tipi della campanella (use_case_notifications_kind_check) allargato con «pr_da_rivedere», con lo
--     stesso nome (NOT VALID poi VALIDATE, che non può fallire), sotto l'advisory lock della 0025.
-- Il DDL uc (0018) non cambia.
-- Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto: il codice della
-- 8.1a ignora le tabelle nuove e non scrive mai il tipo nuovo.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy: gli
-- stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-github-ddl.ts (ensureDbSchema, dopo la
-- 0032, ENSURE_VERSION 27). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0033_github.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-github-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_tasks') IS NULL THEN
    RAISE EXCEPTION 'github: manca la 0032. Applica prima drizzle/0032_compiti.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS use_case_github_deliveries (
  delivery_id varchar(64) NOT NULL CONSTRAINT use_case_github_deliveries_id_check CHECK (delivery_id ~ '^[A-Za-z0-9-]{1,64}$'),
  event varchar(40) NOT NULL CONSTRAINT use_case_github_deliveries_event_check CHECK (event ~ '^[a-z_]{1,40}$'),
  repo varchar(140) CONSTRAINT use_case_github_deliveries_repo_check CHECK (repo IS NULL OR repo ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'),
  outcome varchar(10) NOT NULL CONSTRAINT use_case_github_deliveries_outcome_check CHECK (outcome IN ('applicato', 'ignorato')),
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_github_deliveries_pkey PRIMARY KEY (delivery_id)
);

CREATE INDEX IF NOT EXISTS use_case_github_deliveries_received_idx ON use_case_github_deliveries (received_at);

CREATE TABLE IF NOT EXISTS use_case_pull_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id uuid REFERENCES use_case_tasks(id) ON DELETE SET NULL,
  repo varchar(140) NOT NULL CONSTRAINT use_case_pull_requests_repo_check CHECK (repo ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'),
  number integer NOT NULL CONSTRAINT use_case_pull_requests_number_check CHECK (number BETWEEN 1 AND 999999999),
  branch varchar(120) NOT NULL CONSTRAINT use_case_pull_requests_branch_check CHECK (length(btrim(branch)) > 0),
  state varchar(8) NOT NULL DEFAULT 'aperta' CONSTRAINT use_case_pull_requests_state_check CHECK (state IN ('aperta', 'unita', 'chiusa')),
  draft boolean NOT NULL DEFAULT false,
  opened_at timestamptz NOT NULL,
  merged_at timestamptz,
  closed_at timestamptz,
  gh_updated_at timestamptz,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_pull_requests_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_pull_requests_unique UNIQUE (workspace_id, repo, number),
  CONSTRAINT use_case_pull_requests_merged_check CHECK ((state = 'unita') = (merged_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS use_case_pull_requests_case_idx ON use_case_pull_requests (use_case_id, state);

CREATE INDEX IF NOT EXISTS use_case_pull_requests_workspace_idx ON use_case_pull_requests (workspace_id);

CREATE INDEX IF NOT EXISTS use_case_pull_requests_task_idx ON use_case_pull_requests (task_id) WHERE task_id IS NOT NULL;

SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-alerts-ddl'));

DO $$
DECLARE
  wanted text[] := ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori', 'domanda', 'da_rivedere', 'progetto_appr', 'strumento_nuovo', 'pacchetto_nuovo', 'progetto_ok', 'modifica_chiesta', 'ok_decaduto', 'domanda_agente', 'compito_chiesto', 'compito_passato', 'compito_fermo', 'compiti_pronti', 'pr_da_rivedere']::text[];
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
