-- Rilascio 7 «Programma»: la pagina che riassume il programma di trasformazione AI-native, per i revisori.
-- Valore e costo restano su due linee; i costi di Lateral Space (canone di supporto e, a volte, lo sviluppo di
-- uno use case) entrano nella linea dei costi.
--
-- Questa migrazione aggiunge:
--   - program_settings: una riga per workspace con dipendenti e ricavo (dalla chat di Discovery o a mano), il
--     canone di supporto al mese con il suo periodo, la percentuale dello sviluppo, i pesi dell'indice
--     AI-native, le decisioni per la leadership e il giorno dell'ultimo SAL;
--   - program_case_costs: lo sviluppo di Lateral Space di uno use case, a percentuale o a importo fisso;
--   - program_snapshots: le fotografie dei numeri aggregati, una al mese e una per SAL chiuso;
--   - program_kpis e program_kpi_values: i KPI attivati e i loro valori scritti a mano o dal Brain;
--   - strategic_goal_checkins: base e aggiornamenti dei risultati chiave (strategic_goals non cambia);
--   - il CHECK dei tipi della campanella (use_case_notifications_kind_check) allargato con «da_rivedere»,
--     con lo stesso nome (NOT VALID poi VALIDATE, che non può fallire), sotto l'advisory lock della 0025.
-- Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto: il codice
-- del rilascio 6 ignora tabelle e colonne nuove e non scrive mai i valori nuovi.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy
-- (RUNBOOK §10.16): gli stessi statement, nello stesso ordine, sono in
-- src/lib/db/use-case-hub-program-ddl.ts (ensureDbSchema, dopo la 0028, ENSURE_VERSION 23). Solo come
-- strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0029_program.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-program-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_referent_messages') IS NULL THEN
    RAISE EXCEPTION 'program: manca la 0028. Applica prima drizzle/0028_use_case_referent_thread.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS program_settings (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  employees integer CONSTRAINT program_settings_employees_check CHECK (employees IS NULL OR employees BETWEEN 1 AND 10000000),
  employees_source varchar(10) CONSTRAINT program_settings_employees_source_check CHECK (employees_source IS NULL OR employees_source IN ('discovery', 'manuale')),
  revenue_eur bigint CONSTRAINT program_settings_revenue_check CHECK (revenue_eur IS NULL OR revenue_eur BETWEEN 1 AND 1000000000000),
  revenue_source varchar(10) CONSTRAINT program_settings_revenue_source_check CHECK (revenue_source IS NULL OR revenue_source IN ('discovery', 'manuale')),
  support_month_eur numeric(12,2) CONSTRAINT program_settings_support_check CHECK (support_month_eur IS NULL OR support_month_eur BETWEEN 0 AND 10000000),
  support_from varchar(7) CONSTRAINT program_settings_support_from_check CHECK (support_from IS NULL OR support_from ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  support_to varchar(7) CONSTRAINT program_settings_support_to_check CHECK (support_to IS NULL OR support_to ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  dev_pct numeric(5,2) CONSTRAINT program_settings_dev_pct_check CHECK (dev_pct IS NULL OR dev_pct BETWEEN 0 AND 100),
  index_weights jsonb CONSTRAINT program_settings_index_weights_check CHECK (index_weights IS NULL OR jsonb_typeof(index_weights) = 'object'),
  leadership_asks jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT program_settings_asks_check CHECK (jsonb_typeof(leadership_asks) = 'array'),
  last_sal_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT program_settings_pkey PRIMARY KEY (workspace_id),
  CONSTRAINT program_settings_sources_check CHECK ((employees IS NULL) = (employees_source IS NULL) AND (revenue_eur IS NULL) = (revenue_source IS NULL)),
  CONSTRAINT program_settings_support_range_check CHECK (support_from IS NULL OR support_to IS NULL OR support_to >= support_from)
);

CREATE TABLE IF NOT EXISTS program_case_costs (
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  mode varchar(12) NOT NULL CONSTRAINT program_case_costs_mode_check CHECK (mode IN ('percentuale', 'importo')),
  amount_eur numeric(12,2) CONSTRAINT program_case_costs_amount_check CHECK (amount_eur IS NULL OR amount_eur BETWEEN 0 AND 100000000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT program_case_costs_pkey PRIMARY KEY (use_case_id),
  CONSTRAINT program_case_costs_shape_check CHECK ((mode = 'importo') = (amount_eur IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS program_case_costs_workspace_idx ON program_case_costs (workspace_id);

CREATE TABLE IF NOT EXISTS program_snapshots (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(4) NOT NULL CONSTRAINT program_snapshots_kind_check CHECK (kind IN ('mese', 'sal')),
  period varchar(10) NOT NULL,
  metrics jsonb NOT NULL CONSTRAINT program_snapshots_metrics_check CHECK (jsonb_typeof(metrics) = 'object'),
  taken_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT program_snapshots_pkey PRIMARY KEY (id),
  CONSTRAINT program_snapshots_period_check CHECK ((kind = 'mese' AND period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$') OR (kind = 'sal' AND period ~ '^[0-9]{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$'))
);

CREATE UNIQUE INDEX IF NOT EXISTS program_snapshots_period_unique ON program_snapshots (workspace_id, kind, period);

CREATE TABLE IF NOT EXISTS program_kpis (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key varchar(40) NOT NULL CONSTRAINT program_kpis_key_check CHECK (key ~ '^[a-z][a-z0-9_]{1,39}$'),
  label varchar(120) NOT NULL CONSTRAINT program_kpis_label_check CHECK (length(btrim(label)) > 0),
  unit varchar(16) NOT NULL DEFAULT '',
  kind varchar(10) NOT NULL CONSTRAINT program_kpis_kind_check CHECK (kind IN ('risultato', 'iniziativa')),
  source varchar(10) NOT NULL CONSTRAINT program_kpis_source_check CHECK (source IN ('automatico', 'manuale', 'formula')),
  formula varchar(300),
  base_value double precision,
  target_value double precision,
  direction varchar(3) NOT NULL DEFAULT 'su' CONSTRAINT program_kpis_direction_check CHECK (direction IN ('su', 'giu')),
  key_result_id uuid REFERENCES strategic_goals(id) ON DELETE SET NULL,
  position smallint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT program_kpis_pkey PRIMARY KEY (id),
  CONSTRAINT program_kpis_formula_check CHECK ((source = 'formula') = (formula IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS program_kpis_key_unique ON program_kpis (workspace_id, key);

CREATE TABLE IF NOT EXISTS program_kpi_values (
  kpi_id uuid NOT NULL REFERENCES program_kpis(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period varchar(7) NOT NULL CONSTRAINT program_kpi_values_period_check CHECK (period ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  value double precision NOT NULL,
  source varchar(7) NOT NULL DEFAULT 'manuale' CONSTRAINT program_kpi_values_source_check CHECK (source IN ('manuale', 'brain')),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT program_kpi_values_pkey PRIMARY KEY (kpi_id, period)
);

CREATE INDEX IF NOT EXISTS program_kpi_values_workspace_idx ON program_kpi_values (workspace_id);

CREATE TABLE IF NOT EXISTS strategic_goal_checkins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  goal_id uuid NOT NULL REFERENCES strategic_goals(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(13) NOT NULL CONSTRAINT strategic_goal_checkins_kind_check CHECK (kind IN ('base', 'aggiornamento')),
  value double precision NOT NULL,
  recorded_on date NOT NULL,
  note varchar(300),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  recorded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT strategic_goal_checkins_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS strategic_goal_checkins_goal_idx ON strategic_goal_checkins (goal_id, recorded_on);

CREATE INDEX IF NOT EXISTS strategic_goal_checkins_workspace_idx ON strategic_goal_checkins (workspace_id);

CREATE UNIQUE INDEX IF NOT EXISTS strategic_goal_checkins_base_unique ON strategic_goal_checkins (goal_id) WHERE kind = 'base';

SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-alerts-ddl'));

DO $$
DECLARE
  wanted text[] := ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori', 'domanda', 'da_rivedere']::text[];
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
