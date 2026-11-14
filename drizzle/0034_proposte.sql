-- Rilascio 8.1b «Proposte di compito» (docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md, 8.1b).
-- Un'issue di GitHub o un commento «/compito» (e, più avanti, Slack) propone un compito; una persona del team decide.
--
-- Questa migrazione aggiunge:
--   - use_case_task_proposals: le proposte di compito di uno use case, con titolo, collegamento all'origine, un'area
--     e, se lo dice lo smistatore, il compito che c'è già. Accettata, nasce il compito T-n; scartata, resta come
--     scartata. Nessuna colonna su chi propone o decide (art. 15.4); la chiave dell'origine è unica per use case;
--   - il CHECK dei tipi della campanella (use_case_notifications_kind_check) allargato con «compito_proposto», con lo
--     stesso nome (NOT VALID poi VALIDATE, che non può fallire), sotto l'advisory lock della 0025.
-- Il DDL uc (0018) non cambia.
-- Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto: il codice di prima
-- ignora la tabella nuova e non scrive mai il tipo nuovo.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy: gli
-- stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-proposals-ddl.ts (ensureDbSchema, dopo la
-- 0033, ENSURE_VERSION 28). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0034_proposte.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-proposals-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_pull_requests') IS NULL THEN
    RAISE EXCEPTION 'proposte: manca la 0033. Applica prima drizzle/0033_github.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS use_case_task_proposals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source varchar(10) NOT NULL CONSTRAINT use_case_task_proposals_source_check CHECK (source IN ('github', 'slack')),
  external_key varchar(200) NOT NULL CONSTRAINT use_case_task_proposals_key_check CHECK (length(btrim(external_key)) > 0),
  title varchar(200) NOT NULL CONSTRAINT use_case_task_proposals_title_check CHECK (length(btrim(title)) > 0),
  area varchar(160),
  link varchar(300) CONSTRAINT use_case_task_proposals_link_check CHECK (link IS NULL OR link ~ '^https://(github\.com|[a-z0-9-]+\.slack\.com)/'),
  existing_task_id uuid REFERENCES use_case_tasks(id) ON DELETE SET NULL,
  status varchar(10) NOT NULL DEFAULT 'proposta' CONSTRAINT use_case_task_proposals_status_check CHECK (status IN ('proposta', 'accettata', 'scartata')),
  task_id uuid REFERENCES use_case_tasks(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_task_proposals_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_task_proposals_unique UNIQUE (use_case_id, external_key),
  CONSTRAINT use_case_task_proposals_decided_check CHECK ((status = 'proposta') = (decided_at IS NULL))
);

CREATE INDEX IF NOT EXISTS use_case_task_proposals_case_idx ON use_case_task_proposals (use_case_id, status);

CREATE INDEX IF NOT EXISTS use_case_task_proposals_workspace_idx ON use_case_task_proposals (workspace_id);

SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-alerts-ddl'));

DO $$
DECLARE
  wanted text[] := ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori', 'domanda', 'da_rivedere', 'progetto_appr', 'strumento_nuovo', 'pacchetto_nuovo', 'progetto_ok', 'modifica_chiesta', 'ok_decaduto', 'domanda_agente', 'compito_chiesto', 'compito_passato', 'compito_fermo', 'compiti_pronti', 'pr_da_rivedere', 'compito_proposto']::text[];
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
