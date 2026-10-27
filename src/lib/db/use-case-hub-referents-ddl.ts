/**
 * Area «Use case», «Chiedi al referente» e campanella per persona: DDL del self-heal della 0024.
 *
 * Sono gli stessi statement di `drizzle/0024_use_case_referents.sql`, nello stesso ordine, dopo le
 * due righe di apertura del file (`lock_timeout` e l'advisory lock {@link REFERENTS_ADVISORY_LOCK},
 * che il self-heal prende da sé in `runUseCaseReferentsDdl`):
 * 1. controllo che la 0020 e la 0022 ci siano (le esigenze e la Storia);
 * 2. le richieste ai referenti (`use_case_referent_requests`), le loro domande
 *    (`use_case_referent_request_items`) e i link personali, solo come impronta sha256
 *    (`use_case_referent_tokens`);
 * 3. risposte e allegati di un'esigenza (`use_case_need_answers`, `use_case_need_files`), del
 *    referente (con la richiesta) o del team (senza);
 * 4. la coda delle email ai referenti (`use_case_referent_emails` e `use_case_referent_email_items`);
 * 5. (Parte 2) la campanella per persona (`weekly_signal_reads`, `workspace_bell_state`), le
 *    notifiche degli use case per ogni revisore (`use_case_notifications`), il segno «informazioni
 *    complete» (`use_case_info_state`, con le schede già complete segnate subito) e la coda degli
 *    avvisi per email a chi ha chiesto (`use_case_requester_emails` e i suoi elementi);
 * 6. per ultimo, `richiesta_referente` nell'elenco chiuso dei campi della Storia: il blocco della
 *    0023 (`eventFieldsWideningDdl`) con l'elenco allargato, mai restretto.
 *
 * Nessuna chiave esterna verso le tabelle `uc_*`: `contact_id` è un uuid di `uc_contacts` senza
 * vincolo, perché il self-heal dell'hub non deve mai dipendere dal DDL dei dossier (il self-heal
 * uc è spento in produzione). Tutti idempotenti e solo additivi; l'unica scrittura di dati è il
 * seme di `use_case_info_state`, che si può rifare senza effetti (`ON CONFLICT DO NOTHING`).
 *
 * `src/lib/db/use-case-hub-referents-ddl.test.ts` controlla che la migrazione li contenga tutti,
 * nello stesso ordine, che i CHECK siano gli elenchi qui sotto e che la sonda copra ogni oggetto.
 * Questo modulo è anche la fonte del vocabolario della funzione, come `use-case-hub-value-ddl.ts`
 * lo è per le esigenze. Modulo puro: importa solo `./use-case-hub-history-ddl.ts` e
 * `./use-case-hub-ddl.ts`; lo caricano anche gli script di verifica.
 */
import { USE_CASE_EVENT_FIELDS_0023, eventFieldsProbeSql, eventFieldsWideningDdl } from "./use-case-hub-history-ddl.ts";
import type { UseCaseEventField } from "./use-case-hub-ddl.ts";

// ─── Vocabolario della funzione ──────────────────────────────────────

/** Stato di una richiesta. Non esiste «in corso»: chi ha aperto il link non si vede mai. */
export const REFERENT_REQUEST_STATUSES = ["inviata", "completata", "scaduta", "revocata"] as const;
export type ReferentRequestStatus = (typeof REFERENT_REQUEST_STATUSES)[number];

/** Perché una richiesta è revocata. `sostituita` (Parte 2): «Chiedi di nuovo» su una richiesta viva «Senza risposta». */
export const REFERENT_REVOKE_REASONS = ["revisore", "referente_non_attivo", "cancellazione", "sostituita"] as const;
export type ReferentRevokeReason = (typeof REFERENT_REVOKE_REASONS)[number];

/** Stato salvato di una domanda della richiesta (se è aperta si calcola, `itemIsOpen`). */
export const REFERENT_ITEM_STATES = ["aperta", "risposta", "non_so"] as const;
export type ReferentItemState = (typeof REFERENT_ITEM_STATES)[number];

/** Chi ha scritto una risposta o caricato un file: il referente (con la richiesta) o il team. */
export const REFERENT_ENTRY_SOURCES = ["referente", "revisore"] as const;
export type ReferentEntrySource = (typeof REFERENT_ENTRY_SOURCES)[number];

/** Stati di un file: in quarantena, PDF da controllare (Lateral Space), pulito, rifiutato. */
export const REFERENT_FILE_STATUSES = ["in_quarantena", "in_revisione", "pulito", "rifiutato"] as const;
export type ReferentFileStatus = (typeof REFERENT_FILE_STATUSES)[number];

export const REFERENT_FILE_DELETE_REASONS = ["referente", "revisore", "bozza_chiusa", "conservazione", "cancellazione"] as const;
export type ReferentFileDeleteReason = (typeof REFERENT_FILE_DELETE_REASONS)[number];

export const REFERENT_ANSWER_REMOVE_REASONS = ["revisore", "conservazione", "cancellazione"] as const;
export type ReferentAnswerRemoveReason = (typeof REFERENT_ANSWER_REMOVE_REASONS)[number];

/** I tipi di file ammessi (gli stessi dei dossier, niente immagini). */
export const REFERENT_FILE_KINDS = ["pdf", "docx", "xlsx", "pptx", "csv", "tsv", "txt", "md"] as const;

export const REFERENT_EMAIL_TEMPLATES = ["richiesta", "promemoria", "conferma"] as const;
export type ReferentEmailTemplate = (typeof REFERENT_EMAIL_TEMPLATES)[number];

export const REFERENT_EMAIL_STATUSES = ["in_coda", "inviata", "errore", "annullata"] as const;
export type ReferentEmailStatus = (typeof REFERENT_EMAIL_STATUSES)[number];

/** Elementi di un promemoria: il primo, l'ultimo, uno a mano, le domande nuove. */
export const REFERENT_REMINDER_KINDS = ["primo", "ultimo", "manuale", "nuove"] as const;
export type ReferentReminderKind = (typeof REFERENT_REMINDER_KINDS)[number];

export const REFERENT_EMAIL_ITEM_STATES = ["in_coda", "inviata", "tolta"] as const;

export const REFERENT_TOKEN_ISSUED_FOR = ["richiesta", "promemoria"] as const;

/** Il nome della Storia per «Chiedi al referente»: l'unico che la 0024 aggiunge all'elenco. */
export const REFERENT_EVENT_FIELD = "richiesta_referente" as const satisfies UseCaseEventField;
/** I nomi dei campi della Storia dopo la 0024. */
export const USE_CASE_EVENT_FIELDS_0024 = [...USE_CASE_EVENT_FIELDS_0023, REFERENT_EVENT_FIELD] as const;

/** La chiave dell'advisory lock della 0024: la stessa nel file e in `runUseCaseReferentsDdl`. */
export const REFERENTS_ADVISORY_LOCK = "unbundle:use-case-referents-ddl";

/** Quanto aspetta ogni lock della 0024 prima di fermarsi senza cambiare nulla. */
export const REFERENTS_LOCK_TIMEOUT = "3s";

/** Errore della 0024 su un database senza la 0020 o la 0022. */
export const MISSING_HUB_MESSAGE = "use_case_referents: mancano la 0020 o la 0022. Applica prima drizzle/0020_use_case_hub.sql e drizzle/0022_use_case_value.sql.";

// ── Parte 2 ──

export const USE_CASE_NOTIFICATION_KINDS = ["risposte", "documenti", "senza_risposta", "complete"] as const;
export type UseCaseNotificationKind = (typeof USE_CASE_NOTIFICATION_KINDS)[number];

export const FOLLOW_UP_REASONS = ["ultimo_promemoria", "scaduta"] as const;
export type FollowUpReason = (typeof FOLLOW_UP_REASONS)[number];

export const REQUESTER_EMAIL_STATUSES = ["in_coda", "inviata", "errore", "annullata"] as const;
export type RequesterEmailStatus = (typeof REQUESTER_EMAIL_STATUSES)[number];

/** Le parti che rendono un requisito «del cliente» (= `ASKABLE_SIDES` della Parte 1, null compreso). */
export const CLIENT_SIDE_SQL = (alias: string) => `(${alias}.owner_side IS NULL OR ${alias}.owner_side IN ('cliente', 'insieme'))`;

/** Gli stati che chiudono un requisito del cliente per «Informazioni complete». */
export const INFO_DONE_STATUSES = ["validata", "non_applicabile"] as const;

/** Le righe di `use_case_notifications` e degli avvisi a chi ha chiesto più vecchie di così si cancellano (cron). */
export const NOTIFICATION_RETENTION_DAYS = 90;

// ─── Composizione del testo SQL ──────────────────────────────────────

/** `'a', 'b'`: valori noti, scritti qui sopra (nessun apice dentro). */
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** Gli statement della 0024 dopo le due righe di apertura, nell'ordine del file. */
export const USE_CASE_REFERENTS_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_needs') IS NULL OR to_regclass('public.use_case_events') IS NULL THEN
    RAISE EXCEPTION '${MISSING_HUB_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS use_case_referent_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  requester_name varchar(120) NOT NULL,
  message varchar(1000),
  status varchar(12) NOT NULL DEFAULT 'inviata'
    CONSTRAINT use_case_referent_requests_status_check CHECK (status IN (${quoted(REFERENT_REQUEST_STATUSES)})),
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
    CONSTRAINT use_case_referent_requests_revoked_reason_check CHECK (revoked_reason IS NULL OR revoked_reason IN (${quoted(REFERENT_REVOKE_REASONS)})),
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
);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_requests_use_case_idx
  ON use_case_referent_requests (use_case_id, created_at DESC);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_requests_workspace_idx
  ON use_case_referent_requests (workspace_id, status);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_requests_live_idx
  ON use_case_referent_requests (expires_at) WHERE status = 'inviata';`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_case_referent_requests_live_unique
  ON use_case_referent_requests (use_case_id, contact_id) WHERE status = 'inviata';`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_requests_contact_idx
  ON use_case_referent_requests (contact_id);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_requests_retention_idx
  ON use_case_referent_requests (workspace_id) WHERE status <> 'inviata' AND purged_at IS NULL;`,
  `CREATE TABLE IF NOT EXISTS use_case_referent_request_items (
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  position smallint NOT NULL
    CONSTRAINT use_case_referent_request_items_position_check CHECK (position BETWEEN 1 AND 20),
  question varchar(300) NOT NULL,
  state varchar(10) NOT NULL DEFAULT 'aperta'
    CONSTRAINT use_case_referent_request_items_state_check CHECK (state IN (${quoted(REFERENT_ITEM_STATES)})),
  added_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  CONSTRAINT use_case_referent_request_items_pkey PRIMARY KEY (request_id, need_id),
  CONSTRAINT use_case_referent_request_items_position_unique UNIQUE (request_id, position),
  CONSTRAINT use_case_referent_request_items_answered_check CHECK ((state = 'aperta') = (answered_at IS NULL))
);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_request_items_need_idx
  ON use_case_referent_request_items (need_id);`,
  `CREATE TABLE IF NOT EXISTS use_case_referent_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL
    CONSTRAINT use_case_referent_tokens_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  recipient_hash char(64) NOT NULL
    CONSTRAINT use_case_referent_tokens_recipient_check CHECK (recipient_hash ~ '^[0-9a-f]{64}$'),
  issued_for varchar(12) NOT NULL
    CONSTRAINT use_case_referent_tokens_issued_for_check CHECK (issued_for IN (${quoted(REFERENT_TOKEN_ISSUED_FOR)})),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CONSTRAINT use_case_referent_tokens_hash_unique UNIQUE (token_hash)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_tokens_request_idx
  ON use_case_referent_tokens (request_id);`,
  `CREATE TABLE IF NOT EXISTS use_case_need_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  request_id uuid REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  source varchar(10) NOT NULL
    CONSTRAINT use_case_need_answers_source_check CHECK (source IN (${quoted(REFERENT_ENTRY_SOURCES)})),
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
    CONSTRAINT use_case_need_answers_removed_reason_check CHECK (removed_reason IS NULL OR removed_reason IN (${quoted(REFERENT_ANSWER_REMOVE_REASONS)})),
  CONSTRAINT use_case_need_answers_request_check CHECK ((source = 'referente') = (request_id IS NOT NULL)),
  CONSTRAINT use_case_need_answers_author_check CHECK (source = 'revisore' OR author_user_id IS NULL),
  CONSTRAINT use_case_need_answers_submitted_check CHECK ((status = 'inviata') = (submitted_at IS NOT NULL)),
  CONSTRAINT use_case_need_answers_reviewer_sent_check CHECK (source = 'referente' OR status = 'inviata'),
  CONSTRAINT use_case_need_answers_dont_know_check CHECK (NOT dont_know OR body IS NULL),
  CONSTRAINT use_case_need_answers_removed_check CHECK ((removed_at IS NULL) = (removed_reason IS NULL) AND (removed_at IS NULL OR body IS NULL))
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_case_need_answers_request_unique
  ON use_case_need_answers (request_id, need_id) WHERE request_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS use_case_need_answers_need_idx
  ON use_case_need_answers (need_id, submitted_at);`,
  `CREATE INDEX IF NOT EXISTS use_case_need_answers_workspace_idx
  ON use_case_need_answers (workspace_id);`,
  `CREATE TABLE IF NOT EXISTS use_case_need_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  request_id uuid REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  source varchar(10) NOT NULL
    CONSTRAINT use_case_need_files_source_check CHECK (source IN (${quoted(REFERENT_ENTRY_SOURCES)})),
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  file_name varchar(255) NOT NULL,
  kind varchar(8)
    CONSTRAINT use_case_need_files_kind_check CHECK (kind IS NULL OR kind IN (${quoted(REFERENT_FILE_KINDS)})),
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
    CONSTRAINT use_case_need_files_scan_check CHECK (scan_status IN (${quoted(REFERENT_FILE_STATUSES)})),
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
    CONSTRAINT use_case_need_files_deleted_reason_check CHECK (deleted_reason IS NULL OR deleted_reason IN (${quoted(REFERENT_FILE_DELETE_REASONS)})),
  CONSTRAINT use_case_need_files_request_check CHECK ((source = 'referente') = (request_id IS NOT NULL)),
  CONSTRAINT use_case_need_files_uploader_check CHECK (source = 'revisore' OR uploaded_by_user_id IS NULL),
  CONSTRAINT use_case_need_files_clean_check CHECK (scan_status <> 'pulito' OR deleted_at IS NOT NULL OR (blob_path IS NOT NULL AND sha256 IS NOT NULL AND checked_at IS NOT NULL)),
  CONSTRAINT use_case_need_files_review_check CHECK (scan_status <> 'in_revisione' OR deleted_at IS NOT NULL OR (blob_path IS NOT NULL AND quarantine_path IS NULL AND sha256 IS NOT NULL)),
  CONSTRAINT use_case_need_files_rejected_check CHECK (scan_status <> 'rifiutato' OR (rejection_reason IS NOT NULL AND blob_path IS NULL)),
  CONSTRAINT use_case_need_files_deleted_check CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL)),
  CONSTRAINT use_case_need_files_warning_check CHECK (warning_confirmed_at IS NULL OR personal_warning),
  CONSTRAINT use_case_need_files_reviewed_check CHECK (reviewed_by_user_id IS NULL OR reviewed_at IS NOT NULL)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_need_files_need_idx
  ON use_case_need_files (need_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS use_case_need_files_request_idx
  ON use_case_need_files (request_id) WHERE request_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS use_case_need_files_workspace_idx
  ON use_case_need_files (workspace_id);`,
  `CREATE INDEX IF NOT EXISTS use_case_need_files_pending_idx
  ON use_case_need_files (created_at) WHERE scan_status IN ('in_quarantena', 'in_revisione') AND deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS use_case_need_files_gc_idx
  ON use_case_need_files (deleted_at) WHERE deleted_at IS NOT NULL AND (blob_path IS NOT NULL OR quarantine_path IS NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS use_case_referent_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  contact_id uuid NOT NULL,
  request_id uuid REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  template varchar(14) NOT NULL
    CONSTRAINT use_case_referent_emails_template_check CHECK (template IN (${quoted(REFERENT_EMAIL_TEMPLATES)})),
  status varchar(10) NOT NULL DEFAULT 'in_coda'
    CONSTRAINT use_case_referent_emails_status_check CHECK (status IN (${quoted(REFERENT_EMAIL_STATUSES)})),
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
);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_emails_due_idx
  ON use_case_referent_emails (scheduled_at) WHERE status IN ('in_coda', 'errore');`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_emails_request_idx
  ON use_case_referent_emails (request_id, created_at DESC) WHERE request_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_emails_contact_idx
  ON use_case_referent_emails (contact_id, created_at DESC);`,
  `CREATE TABLE IF NOT EXISTS use_case_referent_email_items (
  email_id uuid NOT NULL REFERENCES use_case_referent_emails(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(8) NOT NULL
    CONSTRAINT use_case_referent_email_items_kind_check CHECK (kind IN (${quoted(REFERENT_REMINDER_KINDS)})),
  state varchar(8) NOT NULL DEFAULT 'in_coda'
    CONSTRAINT use_case_referent_email_items_state_check CHECK (state IN (${quoted(REFERENT_EMAIL_ITEM_STATES)})),
  drop_reason varchar(40),
  new_questions smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_referent_email_items_new_check CHECK (new_questions BETWEEN 0 AND 20 AND (kind = 'nuove') = (new_questions > 0)),
  token_id uuid REFERENCES use_case_referent_tokens(id) ON DELETE SET NULL,
  CONSTRAINT use_case_referent_email_items_pkey PRIMARY KEY (email_id, request_id),
  CONSTRAINT use_case_referent_email_items_drop_check CHECK ((state = 'tolta') = (drop_reason IS NOT NULL))
);`,
  `CREATE INDEX IF NOT EXISTS use_case_referent_email_items_request_idx
  ON use_case_referent_email_items (request_id, kind);`,
  // ── Parte 2: campanella per persona, notifiche degli use case, avvisi a chi ha chiesto ──
  `CREATE TABLE IF NOT EXISTS weekly_signal_reads (
  signal_id uuid NOT NULL REFERENCES weekly_signals(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT weekly_signal_reads_pkey PRIMARY KEY (signal_id, user_id)
);`,
  `CREATE INDEX IF NOT EXISTS weekly_signal_reads_user_idx
  ON weekly_signal_reads (user_id, workspace_id);`,
  `CREATE TABLE IF NOT EXISTS workspace_bell_state (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  seen_at timestamptz,
  referent_emails boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT workspace_bell_state_pkey PRIMARY KEY (workspace_id, user_id)
);`,
  `CREATE TABLE IF NOT EXISTS use_case_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind varchar(16) NOT NULL
    CONSTRAINT use_case_notifications_kind_check CHECK (kind IN (${quoted(USE_CASE_NOTIFICATION_KINDS)})),
  rome_day date NOT NULL,
  answers smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_notifications_answers_check CHECK (answers BETWEEN 0 AND 999),
  unknowns smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_notifications_unknowns_check CHECK (unknowns BETWEEN 0 AND 999),
  documents smallint NOT NULL DEFAULT 0
    CONSTRAINT use_case_notifications_documents_check CHECK (documents BETWEEN 0 AND 999),
  follow_up varchar(18)
    CONSTRAINT use_case_notifications_follow_up_check CHECK (follow_up IS NULL OR follow_up IN (${quoted(FOLLOW_UP_REASONS)})),
  first_event_at timestamptz NOT NULL DEFAULT now(),
  last_event_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz,
  CONSTRAINT use_case_notifications_unique UNIQUE (recipient_user_id, use_case_id, kind, rome_day),
  CONSTRAINT use_case_notifications_follow_up_kind_check CHECK ((kind = 'senza_risposta') = (follow_up IS NOT NULL)),
  CONSTRAINT use_case_notifications_counts_check CHECK (kind IN ('risposte', 'documenti') OR (answers = 0 AND unknowns = 0 AND documents = 0)),
  CONSTRAINT use_case_notifications_unknowns_kind_check CHECK (kind = 'risposte' OR unknowns = 0),
  CONSTRAINT use_case_notifications_events_check CHECK (last_event_at >= first_event_at)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_notifications_recipient_idx
  ON use_case_notifications (recipient_user_id, workspace_id, last_event_at DESC);`,
  `CREATE INDEX IF NOT EXISTS use_case_notifications_use_case_idx
  ON use_case_notifications (use_case_id);`,
  `CREATE INDEX IF NOT EXISTS use_case_notifications_gc_idx
  ON use_case_notifications (last_event_at);`,
  `CREATE TABLE IF NOT EXISTS use_case_info_state (
  use_case_id uuid PRIMARY KEY REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  complete_since timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);`,
  `CREATE TABLE IF NOT EXISTS use_case_requester_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  recipient_user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  send_on date NOT NULL,
  status varchar(10) NOT NULL DEFAULT 'in_coda'
    CONSTRAINT use_case_requester_emails_status_check CHECK (status IN (${quoted(REQUESTER_EMAIL_STATUSES)})),
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
);`,
  `CREATE INDEX IF NOT EXISTS use_case_requester_emails_due_idx
  ON use_case_requester_emails (scheduled_at) WHERE status IN ('in_coda', 'errore');`,
  `CREATE INDEX IF NOT EXISTS use_case_requester_emails_gc_idx
  ON use_case_requester_emails (created_at);`,
  `CREATE TABLE IF NOT EXISTS use_case_requester_email_items (
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
    CONSTRAINT use_case_requester_email_items_follow_up_check CHECK (follow_up IS NULL OR follow_up IN (${quoted(FOLLOW_UP_REASONS)})),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_requester_email_items_pkey PRIMARY KEY (email_id, request_id),
  CONSTRAINT use_case_requester_email_items_news_check CHECK (answers > 0 OR unknowns > 0 OR documents > 0 OR follow_up IS NOT NULL)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_requester_email_items_request_idx
  ON use_case_requester_email_items (request_id);`,
  // Le schede già complete al momento della migrazione: nessun avviso «Informazioni complete» per
  // dati vecchi. Idempotente (ON CONFLICT DO NOTHING).
  `INSERT INTO use_case_info_state (use_case_id, workspace_id, complete_since)
SELECT l.use_case_id, n.workspace_id, now()
FROM use_case_needs n
JOIN use_case_need_links l ON l.need_id = n.id
JOIN use_cases u ON u.id = l.use_case_id AND u.workspace_id = n.workspace_id
WHERE n.type = 'requisito' AND n.archived_at IS NULL
  AND ${CLIENT_SIDE_SQL("n")}
GROUP BY l.use_case_id, n.workspace_id
HAVING bool_and(n.status IN (${quoted(INFO_DONE_STATUSES)}))
ON CONFLICT (use_case_id) DO NOTHING;`,
  // La Storia: 'richiesta_referente' nell'elenco chiuso dei campi (stesso blocco della 0023, stesso
  // advisory lock 'unbundle:use-case-history-ddl', mai restringere). Resta l'ultimo statement.
  eventFieldsWideningDdl(USE_CASE_EVENT_FIELDS_0024),
];

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0024 (Parte 1 e Parte 2). */
export const REFERENTS_TABLES = [
  "use_case_referent_requests",
  "use_case_referent_request_items",
  "use_case_referent_tokens",
  "use_case_need_answers",
  "use_case_need_files",
  "use_case_referent_emails",
  "use_case_referent_email_items",
  "weekly_signal_reads",
  "workspace_bell_state",
  "use_case_notifications",
  "use_case_info_state",
  "use_case_requester_emails",
  "use_case_requester_email_items",
] as const;

/** Gli indici della 0024, per nome. */
export const REFERENTS_INDEXES = [
  "use_case_referent_requests_use_case_idx",
  "use_case_referent_requests_workspace_idx",
  "use_case_referent_requests_live_idx",
  "use_case_referent_requests_live_unique",
  "use_case_referent_requests_contact_idx",
  "use_case_referent_requests_retention_idx",
  "use_case_referent_request_items_need_idx",
  "use_case_referent_tokens_request_idx",
  "use_case_need_answers_request_unique",
  "use_case_need_answers_need_idx",
  "use_case_need_answers_workspace_idx",
  "use_case_need_files_need_idx",
  "use_case_need_files_request_idx",
  "use_case_need_files_workspace_idx",
  "use_case_need_files_pending_idx",
  "use_case_need_files_gc_idx",
  "use_case_referent_emails_due_idx",
  "use_case_referent_emails_request_idx",
  "use_case_referent_emails_contact_idx",
  "use_case_referent_email_items_request_idx",
  "weekly_signal_reads_user_idx",
  "use_case_notifications_recipient_idx",
  "use_case_notifications_use_case_idx",
  "use_case_notifications_gc_idx",
  "use_case_requester_emails_due_idx",
  "use_case_requester_emails_gc_idx",
  "use_case_requester_email_items_request_idx",
] as const;

/** I vincoli con nome della 0024 (`CONSTRAINT <nome>`), per la sonda. */
export const REFERENTS_NAMED_CONSTRAINTS = [
  "use_case_referent_requests_status_check",
  "use_case_referent_requests_reminders_check",
  "use_case_referent_requests_revoked_reason_check",
  "use_case_referent_requests_expiry_check",
  "use_case_referent_requests_revoked_check",
  "use_case_referent_requests_completed_check",
  "use_case_referent_requests_expired_check",
  "use_case_referent_requests_privacy_check",
  "use_case_referent_requests_purged_check",
  "use_case_referent_request_items_position_check",
  "use_case_referent_request_items_state_check",
  "use_case_referent_request_items_pkey",
  "use_case_referent_request_items_position_unique",
  "use_case_referent_request_items_answered_check",
  "use_case_referent_tokens_hash_check",
  "use_case_referent_tokens_recipient_check",
  "use_case_referent_tokens_issued_for_check",
  "use_case_referent_tokens_hash_unique",
  "use_case_need_answers_source_check",
  "use_case_need_answers_status_check",
  "use_case_need_answers_removed_reason_check",
  "use_case_need_answers_request_check",
  "use_case_need_answers_author_check",
  "use_case_need_answers_submitted_check",
  "use_case_need_answers_reviewer_sent_check",
  "use_case_need_answers_dont_know_check",
  "use_case_need_answers_removed_check",
  "use_case_need_files_source_check",
  "use_case_need_files_kind_check",
  "use_case_need_files_size_check",
  "use_case_need_files_max_bytes_check",
  "use_case_need_files_sha256_check",
  "use_case_need_files_mode_check",
  "use_case_need_files_scan_check",
  "use_case_need_files_findings_check",
  "use_case_need_files_quarantine_path_check",
  "use_case_need_files_blob_path_check",
  "use_case_need_files_deleted_reason_check",
  "use_case_need_files_request_check",
  "use_case_need_files_uploader_check",
  "use_case_need_files_clean_check",
  "use_case_need_files_review_check",
  "use_case_need_files_rejected_check",
  "use_case_need_files_deleted_check",
  "use_case_need_files_warning_check",
  "use_case_need_files_reviewed_check",
  "use_case_referent_emails_template_check",
  "use_case_referent_emails_status_check",
  "use_case_referent_emails_attempts_check",
  "use_case_referent_emails_dedupe_unique",
  "use_case_referent_emails_sent_check",
  "use_case_referent_emails_request_check",
  "use_case_referent_email_items_kind_check",
  "use_case_referent_email_items_state_check",
  "use_case_referent_email_items_new_check",
  "use_case_referent_email_items_pkey",
  "use_case_referent_email_items_drop_check",
  "weekly_signal_reads_pkey",
  "workspace_bell_state_pkey",
  "use_case_notifications_kind_check",
  "use_case_notifications_answers_check",
  "use_case_notifications_unknowns_check",
  "use_case_notifications_documents_check",
  "use_case_notifications_follow_up_check",
  "use_case_notifications_unique",
  "use_case_notifications_follow_up_kind_check",
  "use_case_notifications_counts_check",
  "use_case_notifications_unknowns_kind_check",
  "use_case_notifications_events_check",
  "use_case_requester_emails_status_check",
  "use_case_requester_emails_attempts_check",
  "use_case_requester_emails_day_unique",
  "use_case_requester_emails_sent_check",
  "use_case_requester_email_items_answers_check",
  "use_case_requester_email_items_unknowns_check",
  "use_case_requester_email_items_documents_check",
  "use_case_requester_email_items_follow_up_check",
  "use_case_requester_email_items_pkey",
  "use_case_requester_email_items_news_check",
] as const;

/** Le colonne che la Parte 2 ha aggiunto dopo la prima stesura: la sonda le chiede per nome. */
export const REFERENTS_PROBE_COLUMNS = [
  ["use_case_notifications", "unknowns"],
  ["use_case_requester_email_items", "unknowns"],
  ["use_case_requester_emails", "due_at"],
] as const;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`: vera solo se tutto il DDL della 0024 è
 * presente (tabelle, indici, vincoli con nome, le colonne aggiunte nella Parte 2, il CHECK delle
 * revoche con `sostituita` e il CHECK della Storia con `richiesta_referente`).
 */
export const USE_CASE_REFERENTS_PROBE_SQL = `(
  ${REFERENTS_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${REFERENTS_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${REFERENTS_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(REFERENTS_NAMED_CONSTRAINTS)})
  ) = ${REFERENTS_NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_referent_requests')
      AND c.conname = 'use_case_referent_requests_revoked_reason_check'
      AND position('''sostituita''' IN pg_get_constraintdef(c.oid)) > 0
  )
  AND (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (table_name, column_name) IN (${REFERENTS_PROBE_COLUMNS.map(([t, c]) => `('${t}', '${c}')`).join(", ")})
  ) = ${REFERENTS_PROBE_COLUMNS.length}
  AND ${eventFieldsProbeSql(USE_CASE_EVENT_FIELDS_0024)}
)`;
