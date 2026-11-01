-- Area «Use case»: «Pronto da avviare» per Lateral Space e «Autorizza i fornitori» per il cliente.
--
-- Questa migrazione aggiunge:
--   - 'pronto' e 'fornitori' nell'elenco chiuso dei tipi di use_case_notifications (lo stesso blocco
--     della Storia della 0023: allarga, mai restringe);
--   - use_case_ready_state: da quando uno use case è pronto da avviare e per quale trimestre, per
--     avvisare una volta per passaggio, con gli use case già pronti segnati subito;
--   - use_case_alert_emails e use_case_alert_email_items: la coda delle email dei due avvisi, al
--     massimo una al giorno per persona e tipo, con gli use case di «Pronto da avviare».
-- Scritta a mano, idempotente e solo additiva. Si applica con:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0025_use_case_alerts.sql
-- Gli stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-alerts-ddl.ts per il
-- self-heal (ensureDbSchema, dopo la 0024).

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-alerts-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_notifications') IS NULL OR to_regclass('public.use_case_info_state') IS NULL THEN
    RAISE EXCEPTION 'use_case_alerts: manca la 0024. Applica prima drizzle/0024_use_case_referents.sql.';
  END IF;
END $$;

DO $$
DECLARE
  wanted text[] := ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori']::text[];
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

CREATE TABLE IF NOT EXISTS use_case_ready_state (
  use_case_id uuid PRIMARY KEY REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ready_since timestamptz,
  ready_quarter varchar(7)
    CONSTRAINT use_case_ready_state_quarter_check CHECK (ready_quarter IS NULL OR ready_quarter ~ '^[0-9]{4}-Q[1-4]$'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_ready_state_pair_check CHECK ((ready_since IS NULL) = (ready_quarter IS NULL))
);

CREATE INDEX IF NOT EXISTS use_case_ready_state_workspace_idx
  ON use_case_ready_state (workspace_id) WHERE ready_since IS NOT NULL;

CREATE TABLE IF NOT EXISTS use_case_alert_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL
    CONSTRAINT use_case_alert_emails_kind_check CHECK (kind IN ('pronto', 'fornitori')),
  send_on date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'in_coda'
    CONSTRAINT use_case_alert_emails_status_check CHECK (status IN ('in_coda', 'inviata', 'errore', 'annullata')),
  hold_reason varchar(40),
  cancel_reason varchar(40),
  last_error_code varchar(60),
  attempts smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_alert_emails_attempts_check CHECK (attempts BETWEEN 0 AND 3),
  scheduled_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  lease_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_alert_emails_day_unique UNIQUE (workspace_id, recipient_user_id, kind, send_on),
  CONSTRAINT use_case_alert_emails_sent_check CHECK ((status = 'inviata') = (sent_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS use_case_alert_emails_due_idx
  ON use_case_alert_emails (scheduled_at) WHERE status IN ('in_coda', 'errore');

CREATE INDEX IF NOT EXISTS use_case_alert_emails_workspace_idx
  ON use_case_alert_emails (workspace_id, kind, created_at);

CREATE INDEX IF NOT EXISTS use_case_alert_emails_gc_idx
  ON use_case_alert_emails (created_at);

CREATE TABLE IF NOT EXISTS use_case_alert_email_items (
  email_id uuid NOT NULL REFERENCES use_case_alert_emails(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ready_since timestamptz NOT NULL,
  CONSTRAINT use_case_alert_email_items_pkey PRIMARY KEY (email_id, use_case_id)
);

CREATE INDEX IF NOT EXISTS use_case_alert_email_items_use_case_idx
  ON use_case_alert_email_items (use_case_id);

DO $$ BEGIN
  IF to_regclass('public.uc_cases') IS NOT NULL THEN
    EXECUTE $seed$INSERT INTO use_case_ready_state (use_case_id, workspace_id, ready_since, ready_quarter)
      SELECT u.id, u.workspace_id, now(), u.target_quarter
      FROM use_cases u
      WHERE (u.status = 'accepted'
        AND u.portfolio_review_status IS DISTINCT FROM 'archived'
        AND u.portfolio_kind IS DISTINCT FROM 'best_practice'
        AND u.target_quarter IS NOT NULL AND u.target_quarter >= (to_char(now() AT TIME ZONE 'Europe/Rome', 'YYYY') || '-Q' || to_char(now() AT TIME ZONE 'Europe/Rome', 'Q'))
        AND NOT EXISTS (SELECT 1 FROM uc_cases rc WHERE rc.portfolio_use_case_id = u.id AND rc.workspace_id = u.workspace_id AND rc.setup_completed_at IS NOT NULL)
        AND NOT EXISTS (SELECT 1 FROM use_case_needs rn JOIN use_case_need_links rl ON rl.need_id = rn.id
                        WHERE rl.use_case_id = u.id AND rn.workspace_id = u.workspace_id AND rn.type = 'requisito'
                          AND rn.archived_at IS NULL AND (rn.owner_side IS NULL OR rn.owner_side IN ('cliente', 'insieme')) AND rn.status NOT IN ('validata', 'non_applicabile')))
      ON CONFLICT (use_case_id) DO NOTHING$seed$;
  ELSE
    EXECUTE $seed$INSERT INTO use_case_ready_state (use_case_id, workspace_id, ready_since, ready_quarter)
      SELECT u.id, u.workspace_id, now(), u.target_quarter
      FROM use_cases u
      WHERE (u.status = 'accepted'
        AND u.portfolio_review_status IS DISTINCT FROM 'archived'
        AND u.portfolio_kind IS DISTINCT FROM 'best_practice'
        AND u.target_quarter IS NOT NULL AND u.target_quarter >= (to_char(now() AT TIME ZONE 'Europe/Rome', 'YYYY') || '-Q' || to_char(now() AT TIME ZONE 'Europe/Rome', 'Q'))
        AND NOT EXISTS (SELECT 1 FROM use_case_needs rn JOIN use_case_need_links rl ON rl.need_id = rn.id
                        WHERE rl.use_case_id = u.id AND rn.workspace_id = u.workspace_id AND rn.type = 'requisito'
                          AND rn.archived_at IS NULL AND (rn.owner_side IS NULL OR rn.owner_side IN ('cliente', 'insieme')) AND rn.status NOT IN ('validata', 'non_applicabile')))
      ON CONFLICT (use_case_id) DO NOTHING$seed$;
  END IF;
END $$;
