-- Area «Use case», «Referente in un tocco» (rilascio 5): la conferma dello use case e la stima del
-- tempo del referente, e le chiusure delle sue domande.
--
-- Questa migrazione aggiunge:
--   - use_case_referent_checks: una riga per ogni richiesta al referente (nasce con la richiesta), con la
--     conferma dello use case («Sì, è così» / «Correggi» e la nota), la stima del tempo («Sì», «È di
--     meno», «È di più» con due numeri facoltativi, o i due numeri senza una stima del team), l'istantanea
--     della stima del team che il referente ha visto, l'invio e la revisione del team;
--   - use_case_referent_request_items.file_required: «Serve un file», scelto da chi chiede;
--   - use_case_need_answers.comment e already_attached: il commento («Chi potrebbe saperlo?») e «È già
--     allegato»;
--   - un solo CHECK nuovo su una tabella che c'era già: il commento solo sulle righe del referente.
-- Nessun DROP, nessun dato scritto, nessuna colonna cambiata. Le altre regole delle colonne nuove stanno
-- nel codice (il codice del rilascio 4 continua a funzionare dopo un ritorno indietro).
-- Scritta a mano, idempotente e solo additiva. Si applica con:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0026_use_case_referent_check.sql
-- Gli stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-referent-check-ddl.ts per il
-- self-heal (ensureDbSchema, dopo la 0025).

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-referent-check-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_referent_requests') IS NULL OR to_regclass('public.use_case_need_answers') IS NULL THEN
    RAISE EXCEPTION 'use_case_referent_check: manca la 0024. Applica prima drizzle/0024_use_case_referents.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS use_case_referent_checks (
  request_id uuid PRIMARY KEY REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  confirm varchar(8) CONSTRAINT use_case_referent_checks_confirm_check CHECK (confirm IS NULL OR confirm IN ('si', 'correggi')),
  confirm_note varchar(1000),
  team_component_key varchar(40),
  team_volume_year numeric(14,2) CONSTRAINT use_case_referent_checks_team_volume_check CHECK (team_volume_year IS NULL OR team_volume_year >= 0),
  team_minutes numeric(12,2) CONSTRAINT use_case_referent_checks_team_minutes_check CHECK (team_minutes IS NULL OR team_minutes >= 0),
  estimate varchar(6) CONSTRAINT use_case_referent_checks_estimate_check CHECK (estimate IS NULL OR estimate IN ('si', 'meno', 'piu')),
  times_per_month numeric(12,2) CONSTRAINT use_case_referent_checks_times_check CHECK (times_per_month IS NULL OR times_per_month BETWEEN 0 AND 8333333),
  minutes_each numeric(10,2) CONSTRAINT use_case_referent_checks_minutes_check CHECK (minutes_each IS NULL OR minutes_each BETWEEN 0 AND 100000),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  correction_done_at timestamptz,
  estimate_outcome varchar(8) CONSTRAINT use_case_referent_checks_outcome_check CHECK (estimate_outcome IS NULL OR estimate_outcome IN ('adottata', 'tenuta')),
  estimate_outcome_at timestamptz,
  purged_at timestamptz,
  CONSTRAINT use_case_referent_checks_note_check CHECK (confirm = 'correggi' OR confirm_note IS NULL),
  CONSTRAINT use_case_referent_checks_team_check CHECK ((team_component_key IS NULL) = (team_volume_year IS NULL) AND (team_volume_year IS NULL) = (team_minutes IS NULL)),
  CONSTRAINT use_case_referent_checks_estimate_team_check CHECK (estimate IS NULL OR team_component_key IS NOT NULL),
  CONSTRAINT use_case_referent_checks_yes_check CHECK (estimate IS DISTINCT FROM 'si' OR (times_per_month IS NULL AND minutes_each IS NULL)),
  CONSTRAINT use_case_referent_checks_submitted_check CHECK (submitted_at IS NULL OR (
    confirm IS NOT NULL AND (confirm = 'si' OR confirm_note IS NOT NULL OR purged_at IS NOT NULL)
    AND ((team_component_key IS NOT NULL AND estimate IS NOT NULL) OR (team_component_key IS NULL AND times_per_month IS NOT NULL AND minutes_each IS NOT NULL)))),
  CONSTRAINT use_case_referent_checks_review_check CHECK ((correction_done_at IS NULL AND estimate_outcome IS NULL) OR submitted_at IS NOT NULL),
  CONSTRAINT use_case_referent_checks_correction_check CHECK (correction_done_at IS NULL OR confirm = 'correggi'),
  CONSTRAINT use_case_referent_checks_outcome_pair_check CHECK ((estimate_outcome IS NULL) = (estimate_outcome_at IS NULL)),
  CONSTRAINT use_case_referent_checks_purged_check CHECK (purged_at IS NULL OR confirm_note IS NULL)
);

CREATE INDEX IF NOT EXISTS use_case_referent_checks_use_case_idx ON use_case_referent_checks (use_case_id);

CREATE INDEX IF NOT EXISTS use_case_referent_checks_workspace_idx ON use_case_referent_checks (workspace_id);

ALTER TABLE use_case_referent_request_items ADD COLUMN IF NOT EXISTS file_required boolean NOT NULL DEFAULT false;

ALTER TABLE use_case_need_answers ADD COLUMN IF NOT EXISTS comment varchar(1000);

ALTER TABLE use_case_need_answers ADD COLUMN IF NOT EXISTS already_attached boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_need_answers'::regclass AND conname = 'use_case_need_answers_comment_check') THEN
    ALTER TABLE use_case_need_answers ADD CONSTRAINT use_case_need_answers_comment_check
      CHECK (comment IS NULL OR source = 'referente') NOT VALID;
    ALTER TABLE use_case_need_answers VALIDATE CONSTRAINT use_case_need_answers_comment_check;
  END IF;
END $$;
