-- Rilascio 8.2a «Banco di prova ed evals» (docs/rilascio-8/BANCO-DI-PROVA.md §4.1).
-- «unbundle banco» rifà le evals di un ruolo con ogni modello approvato; «unbundle eval --invia» manda le evals con i
-- modelli di oggi. Unbundle tiene l'esito per caso e per ruolo, mai per persona.
--
-- Questa migrazione aggiunge:
--   - use_case_eval_runs: un banco di prova (con il ruolo) o le evals (senza), per use case: livello, ramo, commit,
--     versione del modello, i modelli per ruolo, modelli finti, caso in costruzione, quante prove. Nessuna colonna su
--     chi lo lancia (art. 15.4);
--   - use_case_eval_results: l'esito di ogni modello (uno per le evals, da 1 a 12 per il banco): qualità, prove superate
--     e totali, soglie, gruppi, costo per 1.000 esecuzioni, tempi p50 e p95, token medi, errori. Un modello una volta
--     sola per esecuzione, sempre nel caso e nel workspace della sua esecuzione;
--   - il CHECK dei tipi della campanella (use_case_notifications_kind_check) allargato con «banco_consiglio» ed
--     «evals_in_calo», con lo stesso nome (NOT VALID poi VALIDATE, che non può fallire), sotto l'advisory lock della 0025.
-- Il DDL uc (0018) non cambia.
-- Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto: il codice di prima
-- ignora le tabelle nuove e non scrive mai i tipi nuovi.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy: gli
-- stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-evals-ddl.ts (ensureDbSchema, dopo la
-- 0035, ENSURE_VERSION 30). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0036_evals.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-evals-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_workspace_team') IS NULL THEN
    RAISE EXCEPTION 'evals: manca la 0035. Applica prima drizzle/0035_team_workspace.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS use_case_eval_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(6) NOT NULL CONSTRAINT use_case_eval_runs_kind_check CHECK (kind IN ('banco', 'evals')),
  role varchar(40) CONSTRAINT use_case_eval_runs_role_check CHECK (role IS NULL OR role ~ '^[a-z][a-z0-9_-]{0,39}$'),
  level varchar(20) NOT NULL CONSTRAINT use_case_eval_runs_level_check CHECK (level ~ '^[a-z_]{1,20}$'),
  branch varchar(120) CONSTRAINT use_case_eval_runs_branch_check CHECK (branch IS NULL OR branch ~ '^[A-Za-z0-9._/-]{1,120}$'),
  commit_sha varchar(40) CONSTRAINT use_case_eval_runs_commit_check CHECK (commit_sha IS NULL OR commit_sha ~ '^[0-9a-f]{7,40}$'),
  template_version varchar(20) CONSTRAINT use_case_eval_runs_version_check CHECK (template_version IS NULL OR template_version ~ '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$'),
  models jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT use_case_eval_runs_models_check CHECK (jsonb_typeof(models) = 'object'),
  fake_models boolean NOT NULL DEFAULT false,
  in_construction boolean NOT NULL DEFAULT false,
  cases_total integer NOT NULL CONSTRAINT use_case_eval_runs_cases_check CHECK (cases_total BETWEEN 1 AND 100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_eval_runs_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_eval_runs_scope_unique UNIQUE (id, use_case_id, workspace_id),
  CONSTRAINT use_case_eval_runs_role_kind_check CHECK ((kind = 'banco') = (role IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS use_case_eval_runs_case_idx ON use_case_eval_runs (use_case_id, kind, created_at);

CREATE INDEX IF NOT EXISTS use_case_eval_runs_workspace_idx ON use_case_eval_runs (workspace_id, kind, created_at);

CREATE TABLE IF NOT EXISTS use_case_eval_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  model varchar(80) NOT NULL CONSTRAINT use_case_eval_results_model_check CHECK (model ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,79}$'),
  current boolean NOT NULL DEFAULT false,
  quality double precision NOT NULL CONSTRAINT use_case_eval_results_quality_check CHECK (quality >= 0 AND quality <= 1),
  passed integer NOT NULL,
  total integer NOT NULL CONSTRAINT use_case_eval_results_total_check CHECK (total BETWEEN 1 AND 100000),
  thresholds_met boolean NOT NULL,
  groups jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT use_case_eval_results_groups_check CHECK (jsonb_typeof(groups) = 'object'),
  cost_per_1000_usd numeric(14,6) CONSTRAINT use_case_eval_results_cost_check CHECK (cost_per_1000_usd IS NULL OR cost_per_1000_usd BETWEEN 0 AND 10000000),
  latency_p50_ms integer CONSTRAINT use_case_eval_results_p50_check CHECK (latency_p50_ms IS NULL OR latency_p50_ms BETWEEN 0 AND 86400000),
  latency_p95_ms integer CONSTRAINT use_case_eval_results_p95_check CHECK (latency_p95_ms IS NULL OR latency_p95_ms BETWEEN 0 AND 86400000),
  tokens_in_avg integer CONSTRAINT use_case_eval_results_tokens_in_check CHECK (tokens_in_avg IS NULL OR tokens_in_avg BETWEEN 0 AND 10000000),
  tokens_out_avg integer CONSTRAINT use_case_eval_results_tokens_out_check CHECK (tokens_out_avg IS NULL OR tokens_out_avg BETWEEN 0 AND 10000000),
  errors integer NOT NULL DEFAULT 0 CONSTRAINT use_case_eval_results_errors_check CHECK (errors BETWEEN 0 AND 1000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_eval_results_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_eval_results_unique UNIQUE (run_id, model),
  CONSTRAINT use_case_eval_results_run_fkey FOREIGN KEY (run_id, use_case_id, workspace_id) REFERENCES use_case_eval_runs (id, use_case_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT use_case_eval_results_passed_check CHECK (passed >= 0 AND passed <= total),
  CONSTRAINT use_case_eval_results_latency_check CHECK (latency_p50_ms IS NULL OR latency_p95_ms IS NULL OR latency_p50_ms <= latency_p95_ms)
);

CREATE INDEX IF NOT EXISTS use_case_eval_results_case_idx ON use_case_eval_results (use_case_id);

CREATE INDEX IF NOT EXISTS use_case_eval_results_workspace_idx ON use_case_eval_results (workspace_id);

SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-alerts-ddl'));

DO $$
DECLARE
  wanted text[] := ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori', 'domanda', 'da_rivedere', 'progetto_appr', 'strumento_nuovo', 'pacchetto_nuovo', 'progetto_ok', 'modifica_chiesta', 'ok_decaduto', 'domanda_agente', 'compito_chiesto', 'compito_passato', 'compito_fermo', 'compiti_pronti', 'pr_da_rivedere', 'compito_proposto', 'banco_consiglio', 'evals_in_calo']::text[];
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
