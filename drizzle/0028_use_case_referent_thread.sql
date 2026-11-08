-- Area «Use case», rilascio 6 «Il filo con il referente»: domande e chiarimenti dopo il primo invio, senza una chat.
-- Ogni scambio resta attaccato alla domanda, alla voce di «Benefici e costi» o a «Generale» della richiesta;
-- il referente usa sempre lo stesso link.
--
-- Questa migrazione aggiunge:
--   - use_case_referent_messages: il filo di una richiesta (chi scrive, team o referente; il tipo:
--     chiarimento, dubbio, risposta, aggiunta; il testo; quando l'altra parte l'ha visto e l'ha gestito);
--     la cancellazione dei dati e la conservazione di 12 mesi ne svuotano il testo;
--   - use_case_referent_suggestions: le domande che l'AI propone al team dopo una risposta del referente
--     (mai al referente), con il loro stato;
--   - colonne con un default: reopened_at e renewed_at sulle richieste, follow_up sulle domande («Nuove
--     domande»), edited_at sulle risposte, clarifications e replies sulle voci delle email al referente,
--     questions sulle voci delle email a chi ha chiesto;
--   - due CHECK allargati con lo stesso nome (NOT VALID poi VALIDATE, che non può fallire: la condizione
--     nuova è quella di prima in OR o l'elenco di prima più un nome): le novità delle email a chi ha chiesto
--     (use_case_requester_email_items_news_check, con questions > 0) e i tipi della campanella
--     (use_case_notifications_kind_check, con «domanda», sotto l'advisory lock della 0025).
-- Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto: il codice
-- del rilascio 5.1 ignora tabelle e colonne nuove e non scrive mai i valori nuovi.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy
-- (RUNBOOK §10.15): gli stessi statement, nello stesso ordine, sono in
-- src/lib/db/use-case-hub-referent-thread-ddl.ts (ensureDbSchema, dopo la 0027, ENSURE_VERSION 22). Solo come
-- strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0028_use_case_referent_thread.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-referent-thread-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_referent_check_benefits') IS NULL THEN
    RAISE EXCEPTION 'use_case_referent_thread: manca la 0027. Applica prima drizzle/0027_use_case_referent_benefits.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS use_case_referent_messages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  anchor varchar(10) NOT NULL CONSTRAINT use_case_referent_messages_anchor_check CHECK (anchor IN ('domanda', 'beneficio', 'generale')),
  need_id uuid REFERENCES use_case_needs(id) ON DELETE CASCADE,
  component_key varchar(40),
  side varchar(10) NOT NULL CONSTRAINT use_case_referent_messages_side_check CHECK (side IN ('team', 'referente')),
  kind varchar(12) NOT NULL CONSTRAINT use_case_referent_messages_kind_check CHECK (kind IN ('chiarimento', 'dubbio', 'risposta', 'aggiunta')),
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  reply_to_id uuid REFERENCES use_case_referent_messages(id) ON DELETE CASCADE,
  body varchar(1000),
  created_at timestamptz NOT NULL DEFAULT now(),
  seen_at timestamptz,
  handled_at timestamptz,
  handled_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  removed_at timestamptz,
  removed_reason varchar(14) CONSTRAINT use_case_referent_messages_removed_reason_check CHECK (removed_reason IS NULL OR removed_reason IN ('conservazione', 'cancellazione')),
  CONSTRAINT use_case_referent_messages_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_referent_messages_shape_check CHECK (
    (anchor = 'domanda' AND need_id IS NOT NULL AND component_key IS NULL)
    OR (anchor = 'beneficio' AND component_key IS NOT NULL AND need_id IS NULL)
    OR (anchor = 'generale' AND need_id IS NULL AND component_key IS NULL)),
  CONSTRAINT use_case_referent_messages_side_kind_check CHECK ((side = 'team' AND kind IN ('chiarimento', 'risposta'))
    OR (side = 'referente' AND kind IN ('dubbio', 'risposta', 'aggiunta'))),
  CONSTRAINT use_case_referent_messages_author_check CHECK (side = 'team' OR author_user_id IS NULL),
  CONSTRAINT use_case_referent_messages_reply_check CHECK ((kind = 'risposta') = (reply_to_id IS NOT NULL)),
  CONSTRAINT use_case_referent_messages_body_check CHECK ((removed_at IS NULL) = (body IS NOT NULL) AND (body IS NULL OR length(btrim(body)) > 0)),
  CONSTRAINT use_case_referent_messages_removed_check CHECK ((removed_at IS NULL) = (removed_reason IS NULL)),
  CONSTRAINT use_case_referent_messages_handled_check CHECK (handled_by_user_id IS NULL OR handled_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS use_case_referent_messages_request_idx ON use_case_referent_messages (request_id, created_at);

CREATE INDEX IF NOT EXISTS use_case_referent_messages_use_case_idx ON use_case_referent_messages (use_case_id);

CREATE INDEX IF NOT EXISTS use_case_referent_messages_workspace_idx ON use_case_referent_messages (workspace_id);

CREATE INDEX IF NOT EXISTS use_case_referent_messages_open_idx ON use_case_referent_messages (request_id) WHERE handled_at IS NULL AND removed_at IS NULL;

CREATE TABLE IF NOT EXISTS use_case_referent_suggestions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  anchor varchar(10) NOT NULL CONSTRAINT use_case_referent_suggestions_anchor_check CHECK (anchor IN ('domanda', 'beneficio', 'generale')),
  need_id uuid REFERENCES use_case_needs(id) ON DELETE CASCADE,
  component_key varchar(40),
  source_at timestamptz NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'da_fare' CONSTRAINT use_case_referent_suggestions_status_check CHECK (status IN ('da_fare', 'proposta', 'nessuna', 'usata', 'scartata', 'errore')),
  body varchar(300),
  model varchar(100),
  attempts smallint NOT NULL DEFAULT 0 CONSTRAINT use_case_referent_suggestions_attempts_check CHECK (attempts BETWEEN 0 AND 3),
  lease_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT use_case_referent_suggestions_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_referent_suggestions_shape_check CHECK (
    (anchor = 'domanda' AND need_id IS NOT NULL AND component_key IS NULL)
    OR (anchor = 'beneficio' AND component_key IS NOT NULL AND need_id IS NULL)
    OR (anchor = 'generale' AND need_id IS NULL AND component_key IS NULL)),
  CONSTRAINT use_case_referent_suggestions_body_check CHECK ((status IN ('proposta', 'usata', 'scartata')) = (body IS NOT NULL) AND (body IS NULL OR length(btrim(body)) > 0)),
  CONSTRAINT use_case_referent_suggestions_decided_check CHECK ((status IN ('usata', 'scartata')) = (decided_at IS NOT NULL) AND (decided_by_user_id IS NULL OR decided_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS use_case_referent_suggestions_target_unique ON use_case_referent_suggestions (request_id, anchor, coalesce(need_id::text, ''), coalesce(component_key, ''), source_at);

CREATE INDEX IF NOT EXISTS use_case_referent_suggestions_use_case_idx ON use_case_referent_suggestions (use_case_id);

CREATE INDEX IF NOT EXISTS use_case_referent_suggestions_workspace_idx ON use_case_referent_suggestions (workspace_id);

CREATE INDEX IF NOT EXISTS use_case_referent_suggestions_pending_idx ON use_case_referent_suggestions (created_at) WHERE status IN ('da_fare', 'errore');

ALTER TABLE use_case_referent_requests ADD COLUMN IF NOT EXISTS reopened_at timestamptz;

ALTER TABLE use_case_referent_requests ADD COLUMN IF NOT EXISTS renewed_at timestamptz;

ALTER TABLE use_case_referent_request_items ADD COLUMN IF NOT EXISTS follow_up boolean NOT NULL DEFAULT false;

ALTER TABLE use_case_need_answers ADD COLUMN IF NOT EXISTS edited_at timestamptz;

ALTER TABLE use_case_referent_email_items ADD COLUMN IF NOT EXISTS clarifications smallint NOT NULL DEFAULT 0 CONSTRAINT use_case_referent_email_items_clarifications_check CHECK (clarifications BETWEEN 0 AND 20);

ALTER TABLE use_case_referent_email_items ADD COLUMN IF NOT EXISTS replies smallint NOT NULL DEFAULT 0 CONSTRAINT use_case_referent_email_items_replies_check CHECK (replies BETWEEN 0 AND 20);

ALTER TABLE use_case_requester_email_items ADD COLUMN IF NOT EXISTS questions smallint NOT NULL DEFAULT 0 CONSTRAINT use_case_requester_email_items_questions_check CHECK (questions BETWEEN 0 AND 999);

DO $$ BEGIN
  PERFORM set_config('lock_timeout', '3s', true);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_requester_email_items'::regclass AND conname = 'use_case_requester_email_items_news_check'
      AND pg_get_constraintdef(oid) LIKE '%questions%') THEN
    ALTER TABLE use_case_requester_email_items DROP CONSTRAINT IF EXISTS use_case_requester_email_items_news_check;
    ALTER TABLE use_case_requester_email_items ADD CONSTRAINT use_case_requester_email_items_news_check CHECK (answers > 0 OR unknowns > 0 OR documents > 0 OR follow_up IS NOT NULL OR questions > 0) NOT VALID;
    ALTER TABLE use_case_requester_email_items VALIDATE CONSTRAINT use_case_requester_email_items_news_check;
  END IF;
END $$;

SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-alerts-ddl'));

DO $$
DECLARE
  wanted text[] := ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori', 'domanda']::text[];
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
