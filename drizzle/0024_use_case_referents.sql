-- Area «Use case»: «Chiedi al referente», campanella per persona e avanzamento delle informazioni.
--
-- Questa migrazione aggiunge:
--   - use_case_referent_requests: una richiesta a un referente del cliente (uc_contacts) per uno
--     use case, con le sue date, lo stato e la versione;
--   - use_case_referent_request_items: le domande della richiesta (le esigenze di «Cosa serve»),
--     con il testo com'era all'invio;
--   - use_case_referent_tokens: i link personali, solo come impronta sha256, con l'impronta
--     dell'indirizzo a cui sono partiti;
--   - use_case_need_answers e use_case_need_files: risposte e allegati di un'esigenza, del
--     referente (con la richiesta) o del team (senza);
--   - use_case_referent_emails e use_case_referent_email_items: la coda delle email (richiesta,
--     promemoria anche per più use case, conferma);
--   - 'richiesta_referente' nell'elenco chiuso dei campi della Storia.
--   - weekly_signal_reads e workspace_bell_state: la campanella per persona (chi ha letto quale
--     segnale, fin dove ha visto la campanella, se vuole gli avvisi per email);
--   - use_case_notifications: le notifiche degli use case per ogni revisore (risposte, documenti,
--     nessuna risposta, informazioni complete), una riga per persona, use case, tipo e giorno;
--   - use_case_info_state: quando uno use case ha tutte le informazioni del cliente (per avvisare
--     una volta sola), con le schede già complete segnate subito;
--   - use_case_requester_emails e use_case_requester_email_items: gli avvisi per email a chi ha
--     chiesto, al massimo uno al giorno per persona e workspace.
-- Nessuna chiave esterna verso le tabelle uc_*: contact_id è un uuid di uc_contacts senza vincolo.
-- La 0021 è riservata. Scritta a mano, idempotente e solo additiva. Si applica con:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0024_use_case_referents.sql
-- Gli stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-referents-ddl.ts per
-- il self-heal (ensureDbSchema, dopo la 0023).

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-referents-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_needs') IS NULL OR to_regclass('public.use_case_events') IS NULL THEN
    RAISE EXCEPTION 'use_case_referents: mancano la 0020 o la 0022. Applica prima drizzle/0020_use_case_hub.sql e drizzle/0022_use_case_value.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS use_case_referent_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  requester_name varchar(120) NOT NULL,
  message varchar(1000),
  status varchar(12) NOT NULL DEFAULT 'inviata'
    CONSTRAINT use_case_referent_requests_status_check CHECK (status IN ('inviata', 'completata', 'scaduta', 'revocata')),
  privacy_notice_version varchar(20),
  privacy_accepted_at timestamptz,
  reminder_count smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_referent_requests_reminders_check CHECK (reminder_count BETWEEN 0 AND 2),
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  last_email_at timestamptz,
  last_reminder_at timestamptz,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  expired_at timestamptz,
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  revoked_reason varchar(24)
    CONSTRAINT use_case_referent_requests_revoked_reason_check CHECK (revoked_reason IS NULL OR revoked_reason IN ('revisore', 'referente_non_attivo', 'cancellazione', 'sostituita')),
  drafts_cleared_at timestamptz,
  purged_at timestamptz,
  previous_request_id uuid REFERENCES use_case_referent_requests(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 1,
  CONSTRAINT use_case_referent_requests_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT use_case_referent_requests_revoked_check CHECK ((status = 'revocata') = (revoked_at IS NOT NULL) AND (revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT use_case_referent_requests_completed_check CHECK (status <> 'completata' OR completed_at IS NOT NULL),
  CONSTRAINT use_case_referent_requests_expired_check CHECK (status <> 'scaduta' OR expired_at IS NOT NULL),
  CONSTRAINT use_case_referent_requests_privacy_check CHECK ((privacy_accepted_at IS NULL) = (privacy_notice_version IS NULL)),
  CONSTRAINT use_case_referent_requests_purged_check CHECK (purged_at IS NULL OR (status <> 'inviata' AND message IS NULL))
);
CREATE INDEX IF NOT EXISTS use_case_referent_requests_use_case_idx
  ON use_case_referent_requests (use_case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS use_case_referent_requests_workspace_idx
  ON use_case_referent_requests (workspace_id, status);
CREATE INDEX IF NOT EXISTS use_case_referent_requests_live_idx
  ON use_case_referent_requests (expires_at) WHERE status = 'inviata';
CREATE UNIQUE INDEX IF NOT EXISTS use_case_referent_requests_live_unique
  ON use_case_referent_requests (use_case_id, contact_id) WHERE status = 'inviata';
CREATE INDEX IF NOT EXISTS use_case_referent_requests_contact_idx
  ON use_case_referent_requests (contact_id);
CREATE INDEX IF NOT EXISTS use_case_referent_requests_retention_idx
  ON use_case_referent_requests (workspace_id) WHERE status <> 'inviata' AND purged_at IS NULL;

CREATE TABLE IF NOT EXISTS use_case_referent_request_items (
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position smallint NOT NULL
    CONSTRAINT use_case_referent_request_items_position_check CHECK (position BETWEEN 1 AND 20),
  question varchar(300) NOT NULL,
  state varchar(10) NOT NULL DEFAULT 'aperta'
    CONSTRAINT use_case_referent_request_items_state_check CHECK (state IN ('aperta', 'risposta', 'non_so')),
  added_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  CONSTRAINT use_case_referent_request_items_pkey PRIMARY KEY (request_id, need_id),
  CONSTRAINT use_case_referent_request_items_position_unique UNIQUE (request_id, position),
  CONSTRAINT use_case_referent_request_items_answered_check CHECK ((state = 'aperta') = (answered_at IS NULL))
);
CREATE INDEX IF NOT EXISTS use_case_referent_request_items_need_idx
  ON use_case_referent_request_items (need_id);

CREATE TABLE IF NOT EXISTS use_case_referent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL
    CONSTRAINT use_case_referent_tokens_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  recipient_hash char(64) NOT NULL
    CONSTRAINT use_case_referent_tokens_recipient_check CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  issued_for varchar(12) NOT NULL
    CONSTRAINT use_case_referent_tokens_issued_for_check CHECK (issued_for IN ('richiesta', 'promemoria')),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT use_case_referent_tokens_hash_unique UNIQUE (token_hash)
);
CREATE INDEX IF NOT EXISTS use_case_referent_tokens_request_idx
  ON use_case_referent_tokens (request_id);

CREATE TABLE IF NOT EXISTS use_case_need_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  request_id uuid REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  source varchar(10) NOT NULL
    CONSTRAINT use_case_need_answers_source_check CHECK (source IN ('referente', 'revisore')),
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  body varchar(4000),
  dont_know boolean NOT NULL DEFAULT false,
  status varchar(8) NOT NULL DEFAULT 'bozza'
    CONSTRAINT use_case_need_answers_status_check CHECK (status IN ('bozza', 'inviata')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  removed_at timestamptz,
  removed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  removed_reason varchar(14)
    CONSTRAINT use_case_need_answers_removed_reason_check CHECK (removed_reason IS NULL OR removed_reason IN ('revisore', 'conservazione', 'cancellazione')),
  CONSTRAINT use_case_need_answers_request_check CHECK ((source = 'referente') = (request_id IS NOT NULL)),
  CONSTRAINT use_case_need_answers_author_check CHECK (source = 'revisore' OR author_user_id IS NULL),
  CONSTRAINT use_case_need_answers_submitted_check CHECK ((status = 'inviata') = (submitted_at IS NOT NULL)),
  CONSTRAINT use_case_need_answers_reviewer_sent_check CHECK (source = 'referente' OR status = 'inviata'),
  CONSTRAINT use_case_need_answers_dont_know_check CHECK (NOT dont_know OR body IS NULL),
  CONSTRAINT use_case_need_answers_removed_check CHECK ((removed_at IS NULL) = (removed_reason IS NULL) AND (removed_at IS NULL OR body IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS use_case_need_answers_request_unique
  ON use_case_need_answers (request_id, need_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS use_case_need_answers_need_idx
  ON use_case_need_answers (need_id, submitted_at);
CREATE INDEX IF NOT EXISTS use_case_need_answers_workspace_idx
  ON use_case_need_answers (workspace_id);

CREATE TABLE IF NOT EXISTS use_case_need_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  request_id uuid REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  source varchar(10) NOT NULL
    CONSTRAINT use_case_need_files_source_check CHECK (source IN ('referente', 'revisore')),
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  file_name varchar(255) NOT NULL,
  kind varchar(8)
    CONSTRAINT use_case_need_files_kind_check CHECK (kind IS NULL OR kind IN ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv', 'txt', 'md')),
  mime varchar(120),
  size_bytes integer
    CONSTRAINT use_case_need_files_size_check CHECK (size_bytes IS NULL OR size_bytes > 0),
  max_bytes integer NOT NULL
    CONSTRAINT use_case_need_files_max_bytes_check CHECK (max_bytes > 0 AND max_bytes <= 20971520),
  sha256 char(64)
    CONSTRAINT use_case_need_files_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  upload_mode varchar(6) NOT NULL
    CONSTRAINT use_case_need_files_mode_check CHECK (upload_mode IN ('server', 'client')),
  scan_status varchar(14) NOT NULL DEFAULT 'in_quarantena'
    CONSTRAINT use_case_need_files_scan_check CHECK (scan_status IN ('in_quarantena', 'in_revisione', 'pulito', 'rifiutato')),
  rejection_reason varchar(40),
  findings jsonb NOT NULL DEFAULT '{}'::jsonb
    CONSTRAINT use_case_need_files_findings_check CHECK (jsonb_typeof(findings) = 'object'),
  personal_warning boolean NOT NULL DEFAULT false,
  warning_confirmed_at timestamptz,
  quarantine_path varchar(300)
    CONSTRAINT use_case_need_files_quarantine_path_check CHECK (quarantine_path IS NULL OR quarantine_path ~ '^uc/q/'),
  blob_path varchar(300)
    CONSTRAINT use_case_need_files_blob_path_check CHECK (blob_path IS NULL OR blob_path ~ '^uc/s/'),
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  submitted_at timestamptz,
  deleted_at timestamptz,
  deleted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_reason varchar(14)
    CONSTRAINT use_case_need_files_deleted_reason_check CHECK (deleted_reason IS NULL OR deleted_reason IN ('referente', 'revisore', 'bozza_chiusa', 'conservazione', 'cancellazione')),
  CONSTRAINT use_case_need_files_request_check CHECK ((source = 'referente') = (request_id IS NOT NULL)),
  CONSTRAINT use_case_need_files_uploader_check CHECK (source = 'revisore' OR uploaded_by_user_id IS NULL),
  CONSTRAINT use_case_need_files_clean_check CHECK (scan_status <> 'pulito' OR deleted_at IS NOT NULL OR (blob_path IS NOT NULL AND sha256 IS NOT NULL AND checked_at IS NOT NULL)),
  CONSTRAINT use_case_need_files_review_check CHECK (scan_status <> 'in_revisione' OR deleted_at IS NOT NULL OR (blob_path IS NOT NULL AND quarantine_path IS NULL AND sha256 IS NOT NULL)),
  CONSTRAINT use_case_need_files_rejected_check CHECK (scan_status <> 'rifiutato' OR (rejection_reason IS NOT NULL AND blob_path IS NULL)),
  CONSTRAINT use_case_need_files_deleted_check CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL)),
  CONSTRAINT use_case_need_files_warning_check CHECK (warning_confirmed_at IS NULL OR personal_warning),
  CONSTRAINT use_case_need_files_reviewed_check CHECK (reviewed_by_user_id IS NULL OR reviewed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS use_case_need_files_need_idx
  ON use_case_need_files (need_id, created_at);
CREATE INDEX IF NOT EXISTS use_case_need_files_request_idx
  ON use_case_need_files (request_id) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS use_case_need_files_workspace_idx
  ON use_case_need_files (workspace_id);
CREATE INDEX IF NOT EXISTS use_case_need_files_pending_idx
  ON use_case_need_files (created_at) WHERE scan_status IN ('in_quarantena', 'in_revisione') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS use_case_need_files_gc_idx
  ON use_case_need_files (deleted_at) WHERE deleted_at IS NOT NULL AND (blob_path IS NOT NULL OR quarantine_path IS NOT NULL);

CREATE TABLE IF NOT EXISTS use_case_referent_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  request_id uuid REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  template varchar(14) NOT NULL
    CONSTRAINT use_case_referent_emails_template_check CHECK (template IN ('richiesta', 'promemoria', 'conferma')),
  status varchar(10) NOT NULL DEFAULT 'in_coda'
    CONSTRAINT use_case_referent_emails_status_check CHECK (status IN ('in_coda', 'inviata', 'errore', 'annullata')),
  hold_reason varchar(40),
  cancel_reason varchar(40),
  last_error_code varchar(60),
  attempts smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_referent_emails_attempts_check CHECK (attempts BETWEEN 0 AND 3),
  due_at timestamptz NOT NULL DEFAULT now(),
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  sent_at timestamptz,
  token_id uuid REFERENCES use_case_referent_tokens(id) ON DELETE SET NULL,
  dedupe_key varchar(120) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_referent_emails_dedupe_unique UNIQUE (dedupe_key),
  CONSTRAINT use_case_referent_emails_sent_check CHECK ((status = 'inviata') = (sent_at IS NOT NULL)),
  CONSTRAINT use_case_referent_emails_request_check CHECK ((template = 'promemoria') = (request_id IS NULL))
);
CREATE INDEX IF NOT EXISTS use_case_referent_emails_due_idx
  ON use_case_referent_emails (scheduled_at) WHERE status IN ('in_coda', 'errore');
CREATE INDEX IF NOT EXISTS use_case_referent_emails_request_idx
  ON use_case_referent_emails (request_id, created_at DESC) WHERE request_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS use_case_referent_emails_contact_idx
  ON use_case_referent_emails (contact_id, created_at DESC);

CREATE TABLE IF NOT EXISTS use_case_referent_email_items (
  email_id uuid NOT NULL REFERENCES use_case_referent_emails(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(8) NOT NULL
    CONSTRAINT use_case_referent_email_items_kind_check CHECK (kind IN ('primo', 'ultimo', 'manuale', 'nuove')),
  state varchar(8) NOT NULL DEFAULT 'in_coda'
    CONSTRAINT use_case_referent_email_items_state_check CHECK (state IN ('in_coda', 'inviata', 'tolta')),
  drop_reason varchar(40),
  new_questions smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_referent_email_items_new_check CHECK (new_questions BETWEEN 0 AND 20 AND (kind = 'nuove') = (new_questions > 0)),
  token_id uuid REFERENCES use_case_referent_tokens(id) ON DELETE SET NULL,
  CONSTRAINT use_case_referent_email_items_pkey PRIMARY KEY (email_id, request_id),
  CONSTRAINT use_case_referent_email_items_drop_check CHECK ((state = 'tolta') = (drop_reason IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS use_case_referent_email_items_request_idx
  ON use_case_referent_email_items (request_id, kind);

-- Parte 2: la campanella per persona, le notifiche degli use case per ogni revisore, il segno
-- «informazioni complete» e gli avvisi per email a chi ha chiesto.
CREATE TABLE IF NOT EXISTS weekly_signal_reads (
  signal_id uuid NOT NULL REFERENCES weekly_signals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_signal_reads_pkey PRIMARY KEY (signal_id, user_id)
);
CREATE INDEX IF NOT EXISTS weekly_signal_reads_user_idx
  ON weekly_signal_reads (user_id, workspace_id);

CREATE TABLE IF NOT EXISTS workspace_bell_state (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at timestamptz,
  referent_emails boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_bell_state_pkey PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS use_case_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL
    CONSTRAINT use_case_notifications_kind_check CHECK (kind IN ('risposte', 'documenti', 'senza_risposta', 'complete')),
  rome_day date NOT NULL,
  answers smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_notifications_answers_check CHECK (answers BETWEEN 0 AND 999),
  unknowns smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_notifications_unknowns_check CHECK (unknowns BETWEEN 0 AND 999),
  documents smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_notifications_documents_check CHECK (documents BETWEEN 0 AND 999),
  follow_up varchar(18)
    CONSTRAINT use_case_notifications_follow_up_check CHECK (follow_up IS NULL OR follow_up IN ('ultimo_promemoria', 'scaduta')),
  first_event_at timestamptz NOT NULL DEFAULT now(),
  last_event_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT use_case_notifications_unique UNIQUE (recipient_user_id, use_case_id, kind, rome_day),
  CONSTRAINT use_case_notifications_follow_up_kind_check CHECK ((kind = 'senza_risposta') = (follow_up IS NOT NULL)),
  CONSTRAINT use_case_notifications_counts_check CHECK (kind IN ('risposte', 'documenti') OR (answers = 0 AND unknowns = 0 AND documents = 0)),
  CONSTRAINT use_case_notifications_unknowns_kind_check CHECK (kind = 'risposte' OR unknowns = 0),
  CONSTRAINT use_case_notifications_events_check CHECK (last_event_at >= first_event_at)
);
CREATE INDEX IF NOT EXISTS use_case_notifications_recipient_idx
  ON use_case_notifications (recipient_user_id, workspace_id, last_event_at DESC);
CREATE INDEX IF NOT EXISTS use_case_notifications_use_case_idx
  ON use_case_notifications (use_case_id);
CREATE INDEX IF NOT EXISTS use_case_notifications_gc_idx
  ON use_case_notifications (last_event_at);

CREATE TABLE IF NOT EXISTS use_case_info_state (
  use_case_id uuid PRIMARY KEY REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  complete_since timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS use_case_requester_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  send_on date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'in_coda'
    CONSTRAINT use_case_requester_emails_status_check CHECK (status IN ('in_coda', 'inviata', 'errore', 'annullata')),
  hold_reason varchar(40),
  cancel_reason varchar(40),
  last_error_code varchar(60),
  attempts smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_requester_emails_attempts_check CHECK (attempts BETWEEN 0 AND 3),
  scheduled_at timestamptz NOT NULL,
  due_at timestamptz NOT NULL,
  lease_until timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_requester_emails_day_unique UNIQUE (workspace_id, recipient_user_id, send_on),
  CONSTRAINT use_case_requester_emails_sent_check CHECK ((status = 'inviata') = (sent_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS use_case_requester_emails_due_idx
  ON use_case_requester_emails (scheduled_at) WHERE status IN ('in_coda', 'errore');
CREATE INDEX IF NOT EXISTS use_case_requester_emails_gc_idx
  ON use_case_requester_emails (created_at);

CREATE TABLE IF NOT EXISTS use_case_requester_email_items (
  email_id uuid NOT NULL REFERENCES use_case_requester_emails(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  answers smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_requester_email_items_answers_check CHECK (answers BETWEEN 0 AND 999),
  unknowns smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_requester_email_items_unknowns_check CHECK (unknowns BETWEEN 0 AND 999),
  documents smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_requester_email_items_documents_check CHECK (documents BETWEEN 0 AND 999),
  follow_up varchar(18)
    CONSTRAINT use_case_requester_email_items_follow_up_check CHECK (follow_up IS NULL OR follow_up IN ('ultimo_promemoria', 'scaduta')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_requester_email_items_pkey PRIMARY KEY (email_id, request_id),
  CONSTRAINT use_case_requester_email_items_news_check CHECK (answers > 0 OR unknowns > 0 OR documents > 0 OR follow_up IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS use_case_requester_email_items_request_idx
  ON use_case_requester_email_items (request_id);

-- Le schede già complete al momento della migrazione: nessun avviso «Informazioni complete» per
-- dati vecchi. Idempotente (ON CONFLICT DO NOTHING).
INSERT INTO use_case_info_state (use_case_id, workspace_id, complete_since)
SELECT l.use_case_id, n.workspace_id, now()
FROM use_case_needs n
JOIN use_case_need_links l ON l.need_id = n.id
JOIN use_cases u ON u.id = l.use_case_id AND u.workspace_id = n.workspace_id
WHERE n.type = 'requisito' AND n.archived_at IS NULL
  AND (n.owner_side IS NULL OR n.owner_side IN ('cliente', 'insieme'))
GROUP BY l.use_case_id, n.workspace_id
HAVING bool_and(n.status IN ('validata', 'non_applicabile'))
ON CONFLICT (use_case_id) DO NOTHING;

-- La Storia: 'richiesta_referente' nell'elenco chiuso dei campi (stesso blocco della 0023,
-- stesso advisory lock 'unbundle:use-case-history-ddl', mai restringere).
DO $$
DECLARE
  wanted text[] := ARRAY['titolo', 'problema', 'come_funziona', 'chi_controlla', 'limiti', 'impatto_atteso', 'dati', 'area', 'ai_lab', 'origine', 'tipo', 'nota_pubblica', 'valore', 'costo', 'kpi', 'quando', 'revisione', 'visibilita', 'possibile_doppione', 'intake', 'cosa_serve', 'richiesta_referente']::text[];
  current_def text;
  current_valid boolean;
  allowed text[];
BEGIN
  -- Mai in coda dietro una transazione lunga: ogni lock aspetta al massimo 3s, poi ci si ferma.
  PERFORM set_config('lock_timeout', '3s', true);
  -- Lo stesso advisory lock del self-heal: file e self-heal uno alla volta.
  PERFORM pg_advisory_xact_lock(hashtext('unbundle:use-case-history-ddl'));
  IF to_regclass('public.use_case_events') IS NULL THEN
    RAISE EXCEPTION 'use_case_events: manca la 0020. Applica prima drizzle/0020_use_case_hub.sql.';
  END IF;
  SELECT pg_get_constraintdef(c.oid), c.convalidated INTO current_def, current_valid
    FROM pg_constraint c
   WHERE c.conrelid = 'public.use_case_events'::regclass AND c.conname = 'use_case_events_fields_check';
  -- Mai restringere: ai nomi voluti seguono quelli che il vincolo di adesso ammette già.
  allowed := wanted || coalesce((
    SELECT array_agg(found.name ORDER BY found.first_at)
      FROM (SELECT r.m[1] AS name, min(r.n) AS first_at
              FROM regexp_matches(coalesce(current_def, ''), '''([a-z0-9_]+)''::text', 'g') WITH ORDINALITY AS r(m, n)
             GROUP BY r.m[1]) AS found
     WHERE found.name <> ALL (wanted)
  ), '{}'::text[]);
  IF current_def IS NULL
     OR EXISTS (SELECT 1 FROM unnest(wanted) AS w(name) WHERE position(quote_literal(w.name) || '::text' IN current_def) = 0) THEN
    ALTER TABLE use_case_events DROP CONSTRAINT IF EXISTS use_case_events_fields_check;
    EXECUTE 'ALTER TABLE use_case_events ADD CONSTRAINT use_case_events_fields_check CHECK (fields <@ ARRAY['
      || (SELECT string_agg(quote_literal(a.name), ', ' ORDER BY a.n) FROM unnest(allowed) WITH ORDINALITY AS a(name, n))
      || ']::text[]) NOT VALID';
    current_valid := false;
  END IF;
  IF NOT current_valid THEN
    IF EXISTS (SELECT 1 FROM use_case_events e WHERE NOT (e.fields <@ allowed)) THEN
      RAISE WARNING 'use_case_events: righe con campi fuori elenco, use_case_events_fields_check resta NOT VALID (vale per le righe nuove).';
    ELSE
      ALTER TABLE use_case_events VALIDATE CONSTRAINT use_case_events_fields_check;
    END IF;
  END IF;
END $$;
