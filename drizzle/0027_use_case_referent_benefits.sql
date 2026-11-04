-- Area «Use case», rilascio 5.1 «L'impatto, per ogni beneficio»: il referente risponde su ogni voce di
-- «Benefici e costi» (ore, euro, qualitative), non solo sulle ore di lavoro.
--
-- Questa migrazione aggiunge:
--   - use_case_referent_checks.benefits: la conferma ha una risposta per ogni voce (falso: la stima del
--     tempo del rilascio 5, una sola, come prima);
--   - use_case_referent_check_benefits: una riga per voce, con l'istantanea della cifra del team che il
--     referente ha visto, la sua risposta («Sì», «È di meno», «È di più»; «Sì», «No»; «Non so» su ogni
--     voce, anche a ore senza i numeri del team, sempre senza numeri), i suoi numeri facoltativi, un
--     commento breve e l'esito del team;
--   - per ultimo allarga, con lo stesso nome, il CHECK dell'invio della 0026
--     (use_case_referent_checks_submitted_check): una conferma inviata per beneficio non ha la stima del
--     tempo del rilascio 5. È l'unico statement non solo additivo (DROP CONSTRAINT e ADD CONSTRAINT dello
--     stesso nome, NOT VALID poi VALIDATE): la condizione nuova è quella di prima in OR, quindi ogni riga
--     di prima resta valida, e il codice del rilascio 5 non scrive mai benefits.
-- Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta.
-- Scritta a mano, idempotente. Si applica con:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0027_use_case_referent_benefits.sql
-- Gli stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-referent-benefits-ddl.ts per
-- il self-heal (ensureDbSchema, dopo la 0026).

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-referent-benefits-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_referent_checks') IS NULL THEN
    RAISE EXCEPTION 'use_case_referent_benefits: manca la 0026. Applica prima drizzle/0026_use_case_referent_check.sql.';
  END IF;
END $$;

ALTER TABLE use_case_referent_checks ADD COLUMN IF NOT EXISTS benefits boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS use_case_referent_check_benefits (
  request_id uuid NOT NULL REFERENCES use_case_referent_checks(request_id) ON DELETE CASCADE,
  component_key varchar(40) NOT NULL,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position smallint NOT NULL CONSTRAINT use_case_referent_check_benefits_position_check CHECK (position BETWEEN 1 AND 6),
  kind varchar(12) NOT NULL CONSTRAINT use_case_referent_check_benefits_kind_check CHECK (kind IN ('ore', 'euro', 'qualitativo')),
  label varchar(120) NOT NULL,
  team_volume_year numeric(14,2) CONSTRAINT use_case_referent_check_benefits_team_volume_check CHECK (team_volume_year IS NULL OR team_volume_year >= 0),
  team_minutes numeric(12,2) CONSTRAINT use_case_referent_check_benefits_team_minutes_check CHECK (team_minutes IS NULL OR team_minutes >= 0),
  team_eur_year numeric(14,2) CONSTRAINT use_case_referent_check_benefits_team_eur_check CHECK (team_eur_year IS NULL OR team_eur_year >= 0),
  answer varchar(8) CONSTRAINT use_case_referent_check_benefits_answer_check CHECK (answer IS NULL OR answer IN ('si', 'meno', 'piu', 'no', 'non_so')),
  times_per_month numeric(12,2) CONSTRAINT use_case_referent_check_benefits_times_check CHECK (times_per_month IS NULL OR times_per_month BETWEEN 0 AND 8333333),
  minutes_each numeric(10,2) CONSTRAINT use_case_referent_check_benefits_minutes_check CHECK (minutes_each IS NULL OR minutes_each BETWEEN 0 AND 100000),
  eur_year numeric(14,2) CONSTRAINT use_case_referent_check_benefits_eur_check CHECK (eur_year IS NULL OR eur_year BETWEEN 0 AND 1000000000),
  comment varchar(500),
  outcome varchar(8) CONSTRAINT use_case_referent_check_benefits_outcome_check CHECK (outcome IS NULL OR outcome IN ('adottata', 'tenuta')),
  outcome_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_referent_check_benefits_pkey PRIMARY KEY (request_id, component_key),
  CONSTRAINT use_case_referent_check_benefits_shape_check CHECK (
    (kind = 'ore' AND team_volume_year IS NOT NULL AND team_minutes IS NOT NULL AND team_eur_year IS NULL AND eur_year IS NULL)
    OR (kind = 'euro' AND team_eur_year IS NOT NULL AND team_volume_year IS NULL AND team_minutes IS NULL AND times_per_month IS NULL AND minutes_each IS NULL)
    OR (kind = 'qualitativo' AND team_volume_year IS NULL AND team_minutes IS NULL AND team_eur_year IS NULL AND times_per_month IS NULL AND minutes_each IS NULL AND eur_year IS NULL)),
  CONSTRAINT use_case_referent_check_benefits_form_check CHECK (answer IS NULL
    OR answer = 'non_so'
    OR (answer IN ('si', 'meno', 'piu') AND ((kind = 'ore' AND team_volume_year > 0 AND team_minutes > 0) OR (kind = 'euro' AND team_eur_year > 0)))
    OR (answer IN ('si', 'no') AND (kind = 'qualitativo' OR (kind = 'euro' AND team_eur_year = 0)))),
  CONSTRAINT use_case_referent_check_benefits_numbers_check CHECK ((times_per_month IS NULL AND minutes_each IS NULL AND eur_year IS NULL)
    OR (answer IS NOT NULL AND answer IN ('meno', 'piu'))
    OR (answer IS NULL AND kind = 'ore' AND NOT (team_volume_year > 0 AND team_minutes > 0))),
  CONSTRAINT use_case_referent_check_benefits_outcome_pair_check CHECK ((outcome IS NULL) = (outcome_at IS NULL))
);

CREATE INDEX IF NOT EXISTS use_case_referent_check_benefits_workspace_idx ON use_case_referent_check_benefits (workspace_id);

DO $$ BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_referent_checks'::regclass AND conname = 'use_case_referent_checks_submitted_check'
      AND pg_get_constraintdef(oid) LIKE '%benefits%') THEN
    ALTER TABLE use_case_referent_checks DROP CONSTRAINT IF EXISTS use_case_referent_checks_submitted_check;
    ALTER TABLE use_case_referent_checks ADD CONSTRAINT use_case_referent_checks_submitted_check CHECK (submitted_at IS NULL OR (
      confirm IS NOT NULL AND (confirm = 'si' OR confirm_note IS NOT NULL OR purged_at IS NOT NULL)
      AND (benefits OR (team_component_key IS NOT NULL AND estimate IS NOT NULL) OR (team_component_key IS NULL AND times_per_month IS NOT NULL AND minutes_each IS NOT NULL)))) NOT VALID;
    ALTER TABLE use_case_referent_checks VALIDATE CONSTRAINT use_case_referent_checks_submitted_check;
  END IF;
END $$;
