-- Casi d'uso (uc_*): tabelle, vincoli, indici e trigger.
-- GENERATO da scripts/uc-write-migration.ts a partire da src/lib/uc/ddl.ts: non modificare a mano.
-- Idempotente. Si applica con:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0018_uc_casi_duso.sql
-- Impronta: uc-ddl:c5264e3eb553a3e87d43efc93b86fd89

CREATE OR REPLACE FUNCTION uc_require(ok boolean, code text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'uc:%', code;
  END IF;
  RETURN true;
END
$$;

CREATE OR REPLACE FUNCTION uc_guard_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF TG_TABLE_NAME IN ('uc_answers', 'uc_validations') THEN
      IF NOT EXISTS (SELECT 1 FROM uc_items WHERE id = OLD.item_id) THEN
        RETURN OLD;
      END IF;
    ELSIF TG_TABLE_NAME = 'uc_catalog_versions' THEN
      IF NOT EXISTS (SELECT 1 FROM uc_cases WHERE id = OLD.case_id) THEN
        RETURN OLD;
      END IF;
    ELSIF TG_TABLE_NAME = 'uc_events' THEN
      IF OLD.workspace_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id) THEN
        RETURN OLD;
      END IF;
    ELSIF TG_TABLE_NAME = 'uc_subprocessor_acks' THEN
      IF NOT EXISTS (SELECT 1 FROM workspaces WHERE id = OLD.workspace_id) THEN
        RETURN OLD;
      END IF;
    END IF;
    RAISE EXCEPTION 'uc:sola_aggiunta' USING DETAIL = TG_TABLE_NAME || ': cancellazione non ammessa';
  END IF;
  IF TG_TABLE_NAME = 'uc_answers' THEN
    IF OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL AND NEW.erasure_reason IS NOT NULL
       AND NEW.value IS NULL AND NEW.value_normalized IS NULL AND NEW.value_encrypted IS NULL AND NEW.note IS NULL
       AND (to_jsonb(NEW) - ARRAY['value', 'value_normalized', 'value_encrypted', 'note', 'erased_at', 'erasure_reason']) = (to_jsonb(OLD) - ARRAY['value', 'value_normalized', 'value_encrypted', 'note', 'erased_at', 'erasure_reason'])
    THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'uc:sola_aggiunta' USING DETAIL = TG_TABLE_NAME || ': modifica non ammessa';
END
$$;

CREATE OR REPLACE FUNCTION uc_template_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('pubblicato', 'ritirato') AND (
       ROW(NEW.key, NEW.version, NEW.language, NEW.definition, NEW.definition_hash)
         IS DISTINCT FROM ROW(OLD.key, OLD.version, OLD.language, OLD.definition, OLD.definition_hash)
       OR NEW.status NOT IN ('pubblicato', 'ritirato')
       OR (OLD.status = 'ritirato' AND NEW.status <> 'ritirato'))
  THEN
    RAISE EXCEPTION 'uc:template_pubblicato_immutabile';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION uc_gate_review_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.decision <> 'proposto' THEN
    IF OLD.written_evidence_file_id IS NOT NULL AND NEW.written_evidence_file_id IS NULL
       AND (to_jsonb(NEW) - 'written_evidence_file_id') = (to_jsonb(OLD) - 'written_evidence_file_id')
    THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'uc:gate_deciso_immutabile';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION uc_answers_no_personal_plaintext() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.value IS NOT NULL OR NEW.value_normalized IS NOT NULL OR NEW.value_encrypted IS NOT NULL)
     AND EXISTS (SELECT 1 FROM uc_items i WHERE i.id = NEW.item_id AND i.privacy_class = 'escluso_sanitario')
  THEN
    RAISE EXCEPTION 'uc:valore_sanitario';
  END IF;
  IF (NEW.value IS NOT NULL OR NEW.value_normalized IS NOT NULL)
     AND EXISTS (SELECT 1 FROM uc_items i WHERE i.id = NEW.item_id AND i.privacy_class IN ('personale', 'personale_equipaggio'))
  THEN
    RAISE EXCEPTION 'uc:valore_personale_in_chiaro';
  END IF;
  RETURN NEW;
END
$$;

CREATE OR REPLACE FUNCTION uc_item_blockers_keep() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM uc_items WHERE id = OLD.item_id)
     OR NOT EXISTS (SELECT 1 FROM uc_blockers WHERE id = OLD.blocker_id)
  THEN
    RETURN OLD;
  END IF;
  IF EXISTS (SELECT 1 FROM uc_blockers WHERE id = OLD.blocker_id AND status IN ('attivo', 'permanente')) THEN
    RAISE EXCEPTION 'uc:blocco_attivo';
  END IF;
  RETURN OLD;
END
$$;

CREATE TABLE IF NOT EXISTS uc_templates (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  key varchar(120) NOT NULL,
  version varchar(20) NOT NULL,
  language varchar(10) NOT NULL DEFAULT 'it',
  name varchar(255) NOT NULL,
  archetype varchar(80) NOT NULL,
  industry varchar(80),
  function_area varchar(80),
  status text NOT NULL DEFAULT 'bozza' CONSTRAINT uc_templates_status_chk CHECK (status IN ('bozza', 'pubblicato', 'ritirato')),
  definition jsonb NOT NULL,
  definition_hash char(64) NOT NULL,
  restricted_to_workspace_id uuid REFERENCES workspaces (id) ON DELETE CASCADE,
  parent_template_id uuid REFERENCES uc_templates (id) ON DELETE SET NULL,
  changelog text,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  published_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_templates_key_format_chk CHECK (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  CONSTRAINT uc_templates_version_format_chk CHECK (version ~ '^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'),
  CONSTRAINT uc_templates_definition_hash_format_chk CHECK (definition_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT uc_templates_confidential_restricted_chk CHECK (coalesce(definition -> 'confidential', 'false'::jsonb) <> 'true'::jsonb OR restricted_to_workspace_id IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS uc_contacts (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  display_name varchar(255) NOT NULL,
  role_label varchar(255),
  template_role_key varchar(80),
  email varchar(320),
  phone_e164 varchar(32),
  user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  preferred_channel text NOT NULL DEFAULT 'email' CONSTRAINT uc_contacts_preferred_channel_chk CHECK (preferred_channel IN ('email', 'whatsapp_manuale', 'entrambi')),
  locale varchar(10) NOT NULL DEFAULT 'it',
  is_active boolean NOT NULL DEFAULT true,
  privacy_notice_version varchar(20),
  privacy_notice_seen_at timestamptz,
  digest_opt_out boolean NOT NULL DEFAULT false,
  anonymized_at timestamptz,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_contacts_phone_format_chk CHECK (phone_e164 ~ '^\+[1-9][0-9]{6,14}$')
);

CREATE TABLE IF NOT EXISTS uc_cases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  portfolio_use_case_id uuid REFERENCES use_cases (id) ON DELETE SET NULL,
  template_id uuid NOT NULL REFERENCES uc_templates (id) DEFERRABLE INITIALLY DEFERRED,
  template_version varchar(20) NOT NULL,
  code varchar(40) NOT NULL,
  title varchar(255) NOT NULL,
  one_liner varchar(500),
  description jsonb NOT NULL DEFAULT '{}'::jsonb,
  description_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  status text NOT NULL DEFAULT 'bozza' CONSTRAINT uc_cases_status_chk CHECK (status IN ('bozza', 'raccolta', 'pronto_sviluppo', 'in_sviluppo', 'backtest', 'collaudo', 'stabilizzazione', 'in_esercizio', 'misura_roi', 'sospeso', 'chiuso')),
  status_before_suspension text CONSTRAINT uc_cases_status_before_suspension_chk CHECK (status_before_suspension IN ('bozza', 'raccolta', 'pronto_sviluppo', 'in_sviluppo', 'backtest', 'collaudo', 'stabilizzazione', 'in_esercizio', 'misura_roi', 'sospeso', 'chiuso')),
  suspension_reason text,
  closed_reason text,
  status_changed_at timestamptz,
  perimeter_label varchar(255),
  contract_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  spec_document_ref varchar(255),
  levers jsonb NOT NULL DEFAULT '[]'::jsonb,
  ls_lead_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  client_owner_contact_id uuid REFERENCES uc_contacts (id) ON DELETE SET NULL,
  client_owner_role_label varchar(255),
  client_privacy_approver_contact_id uuid REFERENCES uc_contacts (id) ON DELETE SET NULL,
  signers_designation jsonb NOT NULL DEFAULT '{}'::jsonb,
  data_mode text NOT NULL DEFAULT 'solo_sintetici' CONSTRAINT uc_cases_data_mode_chk CHECK (data_mode IN ('solo_sintetici', 'pseudonimizzati', 'reali')),
  ai_environment_approved boolean NOT NULL DEFAULT false,
  data_controller_label varchar(255),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness jsonb,
  catalog_version integer NOT NULL DEFAULT 0,
  catalog_revision integer NOT NULL DEFAULT 0,
  share_epoch integer NOT NULL DEFAULT 0,
  setup_completed_at timestamptz,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  closed_at timestamptz,
  CONSTRAINT uc_cases_code_format_chk CHECK (code ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'),
  CONSTRAINT uc_cases_suspension_chk CHECK (status <> 'sospeso' OR status_before_suspension IS NOT NULL),
  CONSTRAINT uc_cases_counters_chk CHECK (catalog_version >= 0 AND catalog_revision >= 0 AND share_epoch >= 0)
);

CREATE TABLE IF NOT EXISTS uc_case_members (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL CONSTRAINT uc_case_members_role_chk CHECK (role IN ('ls_lead', 'ls_analista', 'ls_sviluppatore', 'owner_cliente', 'approvatore_privacy', 'ai_board', 'osservatore')),
  personal_zone_access boolean NOT NULL DEFAULT false,
  personal_zone_grant jsonb,
  added_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uc_blockers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid REFERENCES uc_cases (id) ON DELETE CASCADE,
  key varchar(60) NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'attivo' CONSTRAINT uc_blockers_status_chk CHECK (status IN ('attivo', 'sciolto', 'permanente')),
  scope jsonb NOT NULL DEFAULT '{}'::jsonb,
  fallback_allowed text,
  evidence jsonb,
  approvals jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  resolved_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_blockers_key_format_chk CHECK (key ~ '^[a-z0-9_]+$'),
  CONSTRAINT uc_blockers_sanitario_permanent_chk CHECK (key <> 'sanitario' OR status = 'permanente')
);

CREATE TABLE IF NOT EXISTS uc_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  key varchar(160) NOT NULL,
  template_item_key varchar(160),
  kind text NOT NULL CONSTRAINT uc_items_kind_chk CHECK (kind IN ('entita', 'campo', 'kpi', 'decisione', 'parametro', 'vincolo_rigido', 'vincolo_morbido', 'obiettivo', 'incertezza', 'uscita', 'formula', 'regola', 'fonte', 'controllo_qualita', 'domanda', 'documento')),
  section text NOT NULL CONSTRAINT uc_items_section_chk CHECK (section IN ('kpi', 'modello_dati', 'regole', 'documenti_dataset')),
  parent_item_id uuid REFERENCES uc_items (id) ON DELETE SET NULL,
  title text NOT NULL,
  explanation text,
  why text,
  example text,
  help text,
  spec jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority text CONSTRAINT uc_items_priority_chk CHECK (priority IN ('must', 'should', 'could')),
  serves_for jsonb NOT NULL DEFAULT '[]'::jsonb,
  privacy_class text NOT NULL DEFAULT 'riservato_azienda' CONSTRAINT uc_items_privacy_class_chk CHECK (privacy_class IN ('escluso_sanitario', 'personale_equipaggio', 'personale', 'riservato_azienda', 'nessuna')),
  value_visibility text NOT NULL DEFAULT 'owner_e_ls' CONSTRAINT uc_items_value_visibility_chk CHECK (value_visibility IN ('tutti_i_ruoli_del_caso', 'owner_e_ls', 'solo_ls')),
  availability jsonb NOT NULL DEFAULT '[]'::jsonb,
  perimeter text CONSTRAINT uc_items_perimeter_chk CHECK (perimeter IN ('in_contratto', 'evoluzione')),
  levers jsonb NOT NULL DEFAULT '[]'::jsonb,
  response_type text CONSTRAINT uc_items_response_type_chk CHECK (response_type IN ('numero', 'valuta', 'percentuale', 'durata', 'data', 'intervallo', 'si_no', 'scelta', 'scelta_multipla', 'testo', 'codice', 'tabella', 'file', 'dataset', 'conferma_regola', 'conferma_formula', 'collegamento_sistema', 'data_ora', 'conferma_valore', 'caso_prova')),
  response_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_module_key varchar(80),
  in_gate_scope boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'da_chiedere' CONSTRAINT uc_items_status_chk CHECK (status IN ('da_chiedere', 'chiesta', 'mancante', 'parziale', 'in_verifica', 'validata', 'non_applicabile', 'bloccata')),
  status_reason varchar(500),
  status_changed_at timestamptz,
  assignee_contact_id uuid REFERENCES uc_contacts (id) ON DELETE SET NULL,
  owner_role_key varchar(80),
  ls_owner_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  due_at timestamptz,
  due_is_proposal boolean NOT NULL DEFAULT false,
  current_answer_id uuid,
  validated_answer_id uuid,
  validated_by_user_id uuid,
  validated_at timestamptz,
  confirmed_by_contact_id uuid REFERENCES uc_contacts (id) ON DELETE SET NULL,
  na_reason text,
  na_proposed_at timestamptz,
  na_proposed_by_user_id uuid,
  na_proposed_by_contact_id uuid,
  na_approved_by_user_id uuid,
  na_client_approved_by_user_id uuid,
  na_approved_by_contact_id uuid,
  na_approved_at timestamptz,
  waiver jsonb,
  waiver_approved_at timestamptz,
  fallback jsonb,
  fallback_approved_at timestamptz,
  partial_na jsonb,
  freshness_days integer,
  stale_at timestamptz,
  requires_validity_period boolean NOT NULL DEFAULT false,
  source_refs jsonb NOT NULL DEFAULT '[]'::jsonb,
  ai_proposed boolean NOT NULL DEFAULT false,
  shared_item_id uuid,
  sort_order integer NOT NULL DEFAULT 0,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT uc_items_case_id_id_key UNIQUE (case_id, id),
  CONSTRAINT uc_items_title_length_chk CHECK (char_length(title) <= 600),
  CONSTRAINT uc_items_freshness_days_positive_chk CHECK (freshness_days > 0),
  CONSTRAINT uc_items_non_applicabile_signed_chk CHECK (status <> 'non_applicabile' OR (na_approved_at IS NOT NULL AND na_approved_by_user_id IS NOT NULL AND (na_client_approved_by_user_id IS NOT NULL OR na_approved_by_contact_id IS NOT NULL))),
  CONSTRAINT uc_items_validata_complete_chk CHECK (status <> 'validata' OR (validated_answer_id IS NOT NULL AND validated_by_user_id IS NOT NULL)),
  CONSTRAINT uc_items_mancante_reason_chk CHECK (status <> 'mancante' OR status_reason IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS uc_item_blockers (
  item_id uuid NOT NULL REFERENCES uc_items (id) ON DELETE CASCADE,
  blocker_id uuid NOT NULL REFERENCES uc_blockers (id) ON DELETE CASCADE,
  origin text NOT NULL CONSTRAINT uc_item_blockers_origin_chk CHECK (origin IN ('template', 'scope', 'manuale')),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_item_blockers_pkey PRIMARY KEY (item_id, blocker_id)
);

CREATE TABLE IF NOT EXISTS uc_item_links (
  case_id uuid NOT NULL,
  from_item_id uuid NOT NULL,
  to_item_id uuid NOT NULL,
  relation text NOT NULL CONSTRAINT uc_item_links_relation_chk CHECK (relation IN ('usa', 'deriva_da', 'alimentato_da', 'vincola', 'controlla', 'precisa', 'dipende_da', 'sostituisce')),
  cardinality varchar(40),
  note text,
  CONSTRAINT uc_item_links_pkey PRIMARY KEY (from_item_id, to_item_id, relation),
  CONSTRAINT uc_item_links_from_fkey FOREIGN KEY (case_id, from_item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE,
  CONSTRAINT uc_item_links_to_fkey FOREIGN KEY (case_id, to_item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE,
  CONSTRAINT uc_item_links_no_self_link_chk CHECK (from_item_id <> to_item_id)
);

CREATE TABLE IF NOT EXISTS uc_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  contact_id uuid NOT NULL REFERENCES uc_contacts (id) DEFERRABLE INITIALLY DEFERRED,
  purpose text NOT NULL DEFAULT 'raccolta' CONSTRAINT uc_requests_purpose_chk CHECK (purpose IN ('raccolta', 'approvazioni')),
  share_epoch integer NOT NULL,
  acting_role_key varchar(80),
  status text NOT NULL DEFAULT 'bozza' CONSTRAINT uc_requests_status_chk CHECK (status IN ('bozza', 'inviata', 'aperta', 'in_corso', 'completata', 'scaduta', 'revocata')),
  message text,
  channel text NOT NULL DEFAULT 'email' CONSTRAINT uc_requests_channel_chk CHECK (channel IN ('email', 'link_manuale')),
  delegated_from_request_id uuid REFERENCES uc_requests (id) ON DELETE SET NULL,
  delegated_by_contact_id uuid REFERENCES uc_contacts (id) ON DELETE SET NULL,
  delegation_depth smallint NOT NULL DEFAULT 0,
  otp_required boolean NOT NULL DEFAULT false,
  expires_at timestamptz,
  sent_at timestamptz,
  first_opened_at timestamptz,
  completed_at timestamptz,
  privacy_ack_at timestamptz,
  privacy_notice_version varchar(20),
  reminder_count integer NOT NULL DEFAULT 0,
  last_reminder_at timestamptz,
  next_reminder_at timestamptz,
  escalated_at timestamptz,
  revoked_at timestamptz,
  revoked_reason text,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_requests_case_id_id_key UNIQUE (case_id, id),
  CONSTRAINT uc_requests_delegation_depth_range_chk CHECK (delegation_depth BETWEEN 0 AND 2),
  CONSTRAINT uc_requests_reminder_count_range_chk CHECK (reminder_count BETWEEN 0 AND 2),
  CONSTRAINT uc_requests_expiry_when_sent_chk CHECK (status = 'bozza' OR expires_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS uc_request_tokens (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL,
  request_id uuid NOT NULL,
  token_hash char(64) NOT NULL,
  token_prefix varchar(12) NOT NULL,
  issued_for text NOT NULL CONSTRAINT uc_request_tokens_issued_for_chk CHECK (issued_for IN ('invio', 'promemoria', 'copia', 'delega')),
  issued_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  CONSTRAINT uc_request_tokens_token_hash_key UNIQUE (token_hash),
  CONSTRAINT uc_request_tokens_request_fkey FOREIGN KEY (case_id, request_id) REFERENCES uc_requests (case_id, id) ON DELETE CASCADE,
  CONSTRAINT uc_request_tokens_token_hash_format_chk CHECK (token_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS uc_request_items (
  case_id uuid NOT NULL,
  request_id uuid NOT NULL,
  item_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'da_fare' CONSTRAINT uc_request_items_state_chk CHECK (state IN ('da_fare', 'bozza', 'inviata', 'delegata', 'non_so', 'riassegnata')),
  draft jsonb,
  draft_updated_at timestamptz,
  CONSTRAINT uc_request_items_pkey PRIMARY KEY (request_id, item_id),
  CONSTRAINT uc_request_items_request_fkey FOREIGN KEY (case_id, request_id) REFERENCES uc_requests (case_id, id) ON DELETE CASCADE,
  CONSTRAINT uc_request_items_item_fkey FOREIGN KEY (case_id, item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS uc_answers (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL,
  item_id uuid NOT NULL,
  version integer NOT NULL,
  kind text NOT NULL CONSTRAINT uc_answers_kind_chk CHECK (kind IN ('valore', 'conferma', 'correzione', 'non_so', 'delega', 'proposta_na', 'risposta_chiarimento')),
  value jsonb,
  value_normalized jsonb,
  value_encrypted bytea,
  valid_from date,
  valid_to date,
  confidence text CONSTRAINT uc_answers_confidence_chk CHECK (confidence IN ('certo', 'stima', 'da_verificare')),
  note text,
  source_kind text NOT NULL CONSTRAINT uc_answers_source_kind_chk CHECK (source_kind IN ('referente', 'lateral_space', 'documento', 'sistema', 'import', 'ai_proposta', 'dichiarato_in_call')),
  source_ref varchar(500),
  source_basis text CONSTRAINT uc_answers_source_basis_chk CHECK (source_basis IN ('sistema', 'documento', 'stima_a_memoria', 'calcolo')),
  responder_contact_id uuid REFERENCES uc_contacts (id) DEFERRABLE INITIALLY DEFERRED,
  responder_user_id uuid,
  request_id uuid,
  supersedes_answer_id uuid,
  file_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  text_hash char(64),
  ip_hash varchar(64),
  user_agent varchar(300),
  device text CONSTRAINT uc_answers_device_chk CHECK (device IN ('mobile', 'desktop')),
  created_at timestamptz NOT NULL DEFAULT now(),
  erased_at timestamptz,
  erasure_reason varchar(120),
  CONSTRAINT uc_answers_item_id_id_key UNIQUE (item_id, id),
  CONSTRAINT uc_answers_item_fkey FOREIGN KEY (case_id, item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE,
  CONSTRAINT uc_answers_request_fkey FOREIGN KEY (case_id, request_id) REFERENCES uc_requests (case_id, id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uc_answers_supersedes_fkey FOREIGN KEY (item_id, supersedes_answer_id) REFERENCES uc_answers (item_id, id) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uc_answers_version_positive_chk CHECK (version > 0),
  CONSTRAINT uc_answers_single_value_storage_chk CHECK (NOT (value IS NOT NULL AND value_encrypted IS NOT NULL)),
  CONSTRAINT uc_answers_validity_period_chk CHECK (valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to),
  CONSTRAINT uc_answers_text_hash_format_chk CHECK (text_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS uc_files (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  item_id uuid REFERENCES uc_items (id) ON DELETE SET NULL,
  answer_id uuid REFERENCES uc_answers (id) ON DELETE SET NULL,
  request_id uuid REFERENCES uc_requests (id) ON DELETE SET NULL,
  uploaded_by_contact_id uuid REFERENCES uc_contacts (id) ON DELETE SET NULL,
  uploaded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  file_name varchar(255) NOT NULL,
  mime varchar(150),
  size_bytes integer,
  sha256 char(64),
  storage_zone text NOT NULL DEFAULT 'standard' CONSTRAINT uc_files_storage_zone_chk CHECK (storage_zone IN ('standard', 'personale')),
  blob_path text,
  quarantine_path text,
  encryption_key_ref varchar(120),
  personal_data text NOT NULL DEFAULT 'sconosciuto' CONSTRAINT uc_files_personal_data_chk CHECK (personal_data IN ('no', 'pseudonimizzati', 'identificativi', 'sconosciuto')),
  privacy_class text NOT NULL CONSTRAINT uc_files_privacy_class_chk CHECK (privacy_class IN ('escluso_sanitario', 'personale_equipaggio', 'personale', 'riservato_azienda', 'nessuna')),
  max_size_bytes integer NOT NULL,
  scan_status text NOT NULL DEFAULT 'in_quarantena' CONSTRAINT uc_files_scan_status_chk CHECK (scan_status IN ('in_quarantena', 'pulito', 'rifiutato')),
  scan_findings jsonb,
  preview jsonb,
  content_scanned boolean NOT NULL DEFAULT false,
  uploader_declaration boolean NOT NULL DEFAULT false,
  reviewed_by_user_id uuid,
  reviewed_at timestamptz,
  extracted_text text,
  ai_processing_allowed boolean NOT NULL DEFAULT false,
  retention_until date,
  deleted_at timestamptz,
  deletion_reason varchar(120),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_files_size_positive_chk CHECK (size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= max_size_bytes)),
  CONSTRAINT uc_files_max_size_positive_chk CHECK (max_size_bytes > 0),
  CONSTRAINT uc_files_sha256_format_chk CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  CONSTRAINT uc_files_clean_complete_chk CHECK (scan_status <> 'pulito' OR (mime IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL)),
  CONSTRAINT uc_files_personal_encrypted_chk CHECK (storage_zone = 'standard' OR encryption_key_ref IS NOT NULL OR deleted_at IS NOT NULL),
  CONSTRAINT uc_files_reviewer_not_uploader_chk CHECK (reviewed_by_user_id IS NULL OR reviewed_by_user_id IS DISTINCT FROM uploaded_by_user_id),
  CONSTRAINT uc_files_no_personal_text_chk CHECK (storage_zone = 'standard' OR extracted_text IS NULL)
);

CREATE TABLE IF NOT EXISTS uc_datasets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  item_id uuid REFERENCES uc_items (id) ON DELETE SET NULL,
  file_id uuid REFERENCES uc_files (id) ON DELETE SET NULL,
  source_key varchar(160) NOT NULL,
  dataset_version integer NOT NULL,
  period_from date,
  period_to date,
  extracted_at timestamptz,
  extraction_method text,
  timezone varchar(64),
  currency char(3),
  row_count integer,
  column_mapping jsonb,
  schema jsonb,
  pseudonymized boolean NOT NULL DEFAULT false,
  pseudonymization_method varchar(120),
  personal_data text CONSTRAINT uc_datasets_personal_data_chk CHECK (personal_data IN ('no', 'pseudonimizzati', 'identificativi', 'sconosciuto')),
  pii_columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  data_controller_label varchar(255) NOT NULL,
  quality jsonb,
  status text NOT NULL DEFAULT 'ricevuto' CONSTRAINT uc_datasets_status_chk CHECK (status IN ('ricevuto', 'profilato', 'in_verifica', 'validato', 'rifiutato', 'scaduto')),
  validated_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  validated_at timestamptz,
  retention_until date,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  CONSTRAINT uc_datasets_version_positive_chk CHECK (dataset_version > 0),
  CONSTRAINT uc_datasets_row_count_non_negative_chk CHECK (row_count IS NULL OR row_count >= 0),
  CONSTRAINT uc_datasets_period_chk CHECK (period_from IS NULL OR period_to IS NULL OR period_from <= period_to)
);

CREATE TABLE IF NOT EXISTS uc_validations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL,
  item_id uuid NOT NULL,
  answer_id uuid,
  dataset_id uuid REFERENCES uc_datasets (id) DEFERRABLE INITIALLY DEFERRED,
  check_key varchar(160) NOT NULL,
  kind text NOT NULL CONSTRAINT uc_validations_kind_chk CHECK (kind IN ('automatica', 'umana')),
  outcome text NOT NULL CONSTRAINT uc_validations_outcome_chk CHECK (outcome IN ('ok', 'avviso', 'errore')),
  message text NOT NULL,
  details jsonb,
  by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_validations_item_fkey FOREIGN KEY (case_id, item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE,
  CONSTRAINT uc_validations_answer_fkey FOREIGN KEY (item_id, answer_id) REFERENCES uc_answers (item_id, id) DEFERRABLE INITIALLY DEFERRED
);

CREATE TABLE IF NOT EXISTS uc_comments (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL,
  item_id uuid NOT NULL,
  author_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  author_contact_id uuid REFERENCES uc_contacts (id) ON DELETE SET NULL,
  parent_comment_id uuid REFERENCES uc_comments (id) ON DELETE SET NULL,
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'interno_ls' CONSTRAINT uc_comments_visibility_chk CHECK (visibility IN ('interno_ls', 'condiviso')),
  kind text NOT NULL DEFAULT 'commento' CONSTRAINT uc_comments_kind_chk CHECK (kind IN ('commento', 'chiarimento_richiesto', 'risposta_chiarimento')),
  resolved_at timestamptz,
  resolved_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_comments_item_fkey FOREIGN KEY (case_id, item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE,
  CONSTRAINT uc_comments_body_length_chk CHECK (char_length(body) <= 4000),
  CONSTRAINT uc_comments_single_author_chk CHECK (num_nonnulls(author_user_id, author_contact_id) <= 1)
);

CREATE TABLE IF NOT EXISTS uc_maps (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  version integer NOT NULL,
  kind text NOT NULL CONSTRAINT uc_maps_kind_chk CHECK (kind IN ('processo_as_is', 'processo_to_be', 'flusso_dati', 'sistemi', 'incastri', 'soluzione', 'esempio')),
  title varchar(255) NOT NULL,
  graph jsonb NOT NULL,
  artifact_blob_path text,
  artifact_sha256 char(64),
  source text NOT NULL CONSTRAINT uc_maps_source_chk CHECK (source IN ('template', 'claude', 'manuale', 'import')),
  is_current boolean NOT NULL DEFAULT true,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_maps_version_positive_chk CHECK (version > 0),
  CONSTRAINT uc_maps_artifact_sha256_format_chk CHECK (artifact_sha256 ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS uc_gate_reviews (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  gate_key text NOT NULL CONSTRAINT uc_gate_reviews_gate_key_chk CHECK (gate_key IN ('G1', 'G2', 'G3', 'G4')),
  computed jsonb NOT NULL,
  catalog_revision integer NOT NULL,
  summary_text_hash char(64) NOT NULL,
  catalog_version integer,
  catalog_snapshot_path text,
  catalog_snapshot_hash char(64),
  decision text NOT NULL DEFAULT 'proposto' CONSTRAINT uc_gate_reviews_decision_chk CHECK (decision IN ('proposto', 'approvato', 'respinto', 'approvato_con_riserva')),
  waivers jsonb NOT NULL DEFAULT '[]'::jsonb,
  approvals jsonb NOT NULL DEFAULT '[]'::jsonb,
  written_evidence_file_id uuid REFERENCES uc_files (id) ON DELETE SET NULL,
  notes text,
  proposed_by_user_id uuid,
  proposed_at timestamptz,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_gate_reviews_summary_text_hash_format_chk CHECK (summary_text_hash ~ '^[0-9a-f]{64}$'),
  CONSTRAINT uc_gate_reviews_catalog_snapshot_hash_format_chk CHECK (catalog_snapshot_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS uc_catalog_versions (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  version integer NOT NULL,
  reason text NOT NULL CONSTRAINT uc_catalog_versions_reason_chk CHECK (reason IN ('gate', 'correzione', 'aggiornamento_template')),
  gate_review_id uuid REFERENCES uc_gate_reviews (id) DEFERRABLE INITIALLY DEFERRED,
  change_note text,
  diff jsonb NOT NULL,
  snapshot jsonb NOT NULL,
  snapshot_hash char(64) NOT NULL,
  snapshot_path text,
  approved_by jsonb NOT NULL,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_catalog_versions_case_version_key UNIQUE (case_id, version),
  CONSTRAINT uc_catalog_versions_version_positive_chk CHECK (version > 0),
  CONSTRAINT uc_catalog_versions_snapshot_hash_format_chk CHECK (snapshot_hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS uc_model_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  kind text NOT NULL CONSTRAINT uc_model_runs_kind_chk CHECK (kind IN ('backtest', 'casi_prova', 'esercizio')),
  catalog_version integer NOT NULL,
  dataset_versions jsonb NOT NULL DEFAULT '[]'::jsonb,
  code_ref varchar(120),
  parameters_hash varchar(64),
  period_from date,
  period_to date,
  summary jsonb,
  status text NOT NULL DEFAULT 'provvisorio' CONSTRAINT uc_model_runs_status_chk CHECK (status IN ('provvisorio', 'confermato')),
  recorded_by text NOT NULL CONSTRAINT uc_model_runs_recorded_by_chk CHECK (recorded_by IN ('utente', 'mcp', 'sistema')),
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  integration_token_id uuid REFERENCES workspace_integration_tokens (id) ON DELETE SET NULL,
  confirmed_by_contact_id uuid REFERENCES uc_contacts (id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_model_runs_catalog_version_fkey FOREIGN KEY (case_id, catalog_version) REFERENCES uc_catalog_versions (case_id, version) DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT uc_model_runs_period_chk CHECK (period_from IS NULL OR period_to IS NULL OR period_from <= period_to)
);

CREATE TABLE IF NOT EXISTS uc_kpi_measurements (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL,
  item_id uuid NOT NULL,
  phase text NOT NULL CONSTRAINT uc_kpi_measurements_phase_chk CHECK (phase IN ('baseline', 'backtest', 'esercizio')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  value numeric,
  unit varchar(40),
  interval_low numeric,
  interval_high numeric,
  sample_size integer NOT NULL,
  suppressed boolean NOT NULL DEFAULT false,
  dimension_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  method text,
  source_ref varchar(500),
  dataset_id uuid REFERENCES uc_datasets (id) ON DELETE SET NULL,
  model_run_id uuid REFERENCES uc_model_runs (id) ON DELETE SET NULL,
  catalog_version integer,
  recorded_by text NOT NULL CONSTRAINT uc_kpi_measurements_recorded_by_chk CHECK (recorded_by IN ('utente', 'mcp', 'sistema')),
  recorded_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  integration_token_id uuid REFERENCES workspace_integration_tokens (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'provvisorio' CONSTRAINT uc_kpi_measurements_status_chk CHECK (status IN ('provvisorio', 'confermato')),
  confirmed_by_contact_id uuid REFERENCES uc_contacts (id) ON DELETE SET NULL,
  confirmed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_kpi_measurements_item_fkey FOREIGN KEY (case_id, item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE,
  CONSTRAINT uc_kpi_measurements_min_sample_chk CHECK (suppressed OR sample_size >= 5),
  CONSTRAINT uc_kpi_measurements_sample_non_negative_chk CHECK (sample_size >= 0),
  CONSTRAINT uc_kpi_measurements_period_chk CHECK (period_start <= period_end)
);

CREATE TABLE IF NOT EXISTS uc_test_cases (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  key varchar(60) NOT NULL,
  kind text NOT NULL CONSTRAINT uc_test_cases_kind_chk CHECK (kind IN ('sintetico', 'pseudonimizzato')),
  input jsonb NOT NULL,
  expected jsonb NOT NULL,
  covers jsonb NOT NULL DEFAULT '[]'::jsonb,
  serve_per jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_result text NOT NULL DEFAULT 'non_eseguito' CONSTRAINT uc_test_cases_last_result_chk CHECK (last_result IN ('superato', 'fallito', 'non_eseguito')),
  last_run_id uuid REFERENCES uc_model_runs (id) ON DELETE SET NULL,
  approved_by_contact_id uuid REFERENCES uc_contacts (id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uc_roi_models (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'stima' CONSTRAINT uc_roi_models_status_chk CHECK (status IN ('stima', 'baseline', 'backtest', 'misurato')),
  scenario text NOT NULL DEFAULT 'base' CONSTRAINT uc_roi_models_scenario_chk CHECK (scenario IN ('prudente', 'base', 'ottimistico')),
  currency char(3) NOT NULL DEFAULT 'EUR',
  implementation_cost numeric,
  annual_run_cost numeric,
  annual_benefit numeric,
  cost_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  benefit_lines jsonb NOT NULL DEFAULT '[]'::jsonb,
  break_even_months numeric,
  value_5y numeric,
  discount_rate numeric,
  horizon_years integer NOT NULL DEFAULT 5,
  assumptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  attribution_method text,
  baseline_period jsonb,
  adoption_rate numeric,
  includes_human_review_time boolean NOT NULL DEFAULT true,
  human_review_hours numeric,
  content jsonb NOT NULL DEFAULT '{}'::jsonb,
  approved_by_contact_id uuid REFERENCES uc_contacts (id) ON DELETE SET NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_roi_models_human_review_included_chk CHECK (includes_human_review_time),
  CONSTRAINT uc_roi_models_version_positive_chk CHECK (version > 0),
  CONSTRAINT uc_roi_models_horizon_positive_chk CHECK (horizon_years > 0),
  CONSTRAINT uc_roi_models_adoption_rate_range_chk CHECK (adoption_rate IS NULL OR (adoption_rate >= 0 AND adoption_rate <= 1))
);

CREATE TABLE IF NOT EXISTS uc_milestones (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  case_id uuid NOT NULL REFERENCES uc_cases (id) ON DELETE CASCADE,
  key varchar(60) NOT NULL,
  title varchar(255) NOT NULL,
  planned_date date,
  planned_label text,
  is_proposal boolean NOT NULL DEFAULT false,
  to_confirm boolean NOT NULL DEFAULT false,
  owner_label varchar(255),
  done_at timestamptz,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uc_notifications (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid REFERENCES uc_cases (id) ON DELETE CASCADE,
  request_id uuid REFERENCES uc_requests (id) ON DELETE CASCADE,
  recipient_contact_id uuid REFERENCES uc_contacts (id) ON DELETE CASCADE,
  recipient_user_id uuid REFERENCES users (id) ON DELETE CASCADE,
  channel text NOT NULL CONSTRAINT uc_notifications_channel_chk CHECK (channel IN ('email', 'in_app', 'slack', 'webhook')),
  template_key varchar(80) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'in_coda' CONSTRAINT uc_notifications_status_chk CHECK (status IN ('in_coda', 'inviata', 'errore', 'annullata')),
  hold_reason varchar(60),
  attempts integer NOT NULL DEFAULT 0,
  dedupe_key varchar(200) NOT NULL,
  scheduled_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  read_at timestamptz,
  error varchar(500),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_notifications_dedupe_key_key UNIQUE (dedupe_key),
  CONSTRAINT uc_notifications_in_app_user_chk CHECK (channel <> 'in_app' OR recipient_user_id IS NOT NULL),
  CONSTRAINT uc_notifications_attempts_non_negative_chk CHECK (attempts >= 0)
);

CREATE TABLE IF NOT EXISTS uc_events (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid REFERENCES workspaces (id) ON DELETE CASCADE,
  case_id uuid,
  actor_type text NOT NULL CONSTRAINT uc_events_actor_type_chk CHECK (actor_type IN ('utente', 'referente', 'sistema', 'mcp')),
  actor_user_id uuid,
  actor_contact_id uuid,
  integration_token_id uuid,
  event_type varchar(100) NOT NULL,
  target_type varchar(40),
  target_id uuid,
  from_state varchar(40),
  to_state varchar(40),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip_hash varchar(64),
  user_agent varchar(300),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uc_events_event_type_format_chk CHECK (event_type ~ '^[a-z_]+\.[a-z_]+$')
);

CREATE TABLE IF NOT EXISTS uc_rate_limits (
  bucket varchar(120) NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  CONSTRAINT uc_rate_limits_pkey PRIMARY KEY (bucket, window_start)
);

CREATE TABLE IF NOT EXISTS uc_subprocessor_acks (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
  list_version text NOT NULL,
  statement_text text NOT NULL,
  declared_by_user_id uuid NOT NULL REFERENCES users (id) DEFERRABLE INITIALLY DEFERRED,
  declared_by_role text NOT NULL,
  declared_at timestamptz NOT NULL DEFAULT now()
);

DO $uc$ BEGIN
  ALTER TABLE uc_items ADD CONSTRAINT uc_items_current_answer_fkey FOREIGN KEY (id, current_answer_id) REFERENCES uc_answers (item_id, id) DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN duplicate_object THEN NULL;
END $uc$;

DO $uc$ BEGIN
  ALTER TABLE uc_items ADD CONSTRAINT uc_items_validated_answer_fkey FOREIGN KEY (id, validated_answer_id) REFERENCES uc_answers (item_id, id) DEFERRABLE INITIALLY DEFERRED;
EXCEPTION WHEN duplicate_object THEN NULL;
END $uc$;

DO $uc$
DECLARE
  c record;
  found_values text[];
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('uc_templates', 'status', 'uc_templates_status_chk', ARRAY['bozza', 'pubblicato', 'ritirato']::text[]),
      ('uc_contacts', 'preferred_channel', 'uc_contacts_preferred_channel_chk', ARRAY['email', 'whatsapp_manuale', 'entrambi']::text[]),
      ('uc_cases', 'status', 'uc_cases_status_chk', ARRAY['bozza', 'raccolta', 'pronto_sviluppo', 'in_sviluppo', 'backtest', 'collaudo', 'stabilizzazione', 'in_esercizio', 'misura_roi', 'sospeso', 'chiuso']::text[]),
      ('uc_cases', 'status_before_suspension', 'uc_cases_status_before_suspension_chk', ARRAY['bozza', 'raccolta', 'pronto_sviluppo', 'in_sviluppo', 'backtest', 'collaudo', 'stabilizzazione', 'in_esercizio', 'misura_roi', 'sospeso', 'chiuso']::text[]),
      ('uc_cases', 'data_mode', 'uc_cases_data_mode_chk', ARRAY['solo_sintetici', 'pseudonimizzati', 'reali']::text[]),
      ('uc_case_members', 'role', 'uc_case_members_role_chk', ARRAY['ls_lead', 'ls_analista', 'ls_sviluppatore', 'owner_cliente', 'approvatore_privacy', 'ai_board', 'osservatore']::text[]),
      ('uc_blockers', 'status', 'uc_blockers_status_chk', ARRAY['attivo', 'sciolto', 'permanente']::text[]),
      ('uc_items', 'kind', 'uc_items_kind_chk', ARRAY['entita', 'campo', 'kpi', 'decisione', 'parametro', 'vincolo_rigido', 'vincolo_morbido', 'obiettivo', 'incertezza', 'uscita', 'formula', 'regola', 'fonte', 'controllo_qualita', 'domanda', 'documento']::text[]),
      ('uc_items', 'section', 'uc_items_section_chk', ARRAY['kpi', 'modello_dati', 'regole', 'documenti_dataset']::text[]),
      ('uc_items', 'priority', 'uc_items_priority_chk', ARRAY['must', 'should', 'could']::text[]),
      ('uc_items', 'privacy_class', 'uc_items_privacy_class_chk', ARRAY['escluso_sanitario', 'personale_equipaggio', 'personale', 'riservato_azienda', 'nessuna']::text[]),
      ('uc_items', 'value_visibility', 'uc_items_value_visibility_chk', ARRAY['tutti_i_ruoli_del_caso', 'owner_e_ls', 'solo_ls']::text[]),
      ('uc_items', 'perimeter', 'uc_items_perimeter_chk', ARRAY['in_contratto', 'evoluzione']::text[]),
      ('uc_items', 'response_type', 'uc_items_response_type_chk', ARRAY['numero', 'valuta', 'percentuale', 'durata', 'data', 'intervallo', 'si_no', 'scelta', 'scelta_multipla', 'testo', 'codice', 'tabella', 'file', 'dataset', 'conferma_regola', 'conferma_formula', 'collegamento_sistema', 'data_ora', 'conferma_valore', 'caso_prova']::text[]),
      ('uc_items', 'status', 'uc_items_status_chk', ARRAY['da_chiedere', 'chiesta', 'mancante', 'parziale', 'in_verifica', 'validata', 'non_applicabile', 'bloccata']::text[]),
      ('uc_item_blockers', 'origin', 'uc_item_blockers_origin_chk', ARRAY['template', 'scope', 'manuale']::text[]),
      ('uc_item_links', 'relation', 'uc_item_links_relation_chk', ARRAY['usa', 'deriva_da', 'alimentato_da', 'vincola', 'controlla', 'precisa', 'dipende_da', 'sostituisce']::text[]),
      ('uc_requests', 'purpose', 'uc_requests_purpose_chk', ARRAY['raccolta', 'approvazioni']::text[]),
      ('uc_requests', 'status', 'uc_requests_status_chk', ARRAY['bozza', 'inviata', 'aperta', 'in_corso', 'completata', 'scaduta', 'revocata']::text[]),
      ('uc_requests', 'channel', 'uc_requests_channel_chk', ARRAY['email', 'link_manuale']::text[]),
      ('uc_request_tokens', 'issued_for', 'uc_request_tokens_issued_for_chk', ARRAY['invio', 'promemoria', 'copia', 'delega']::text[]),
      ('uc_request_items', 'state', 'uc_request_items_state_chk', ARRAY['da_fare', 'bozza', 'inviata', 'delegata', 'non_so', 'riassegnata']::text[]),
      ('uc_answers', 'kind', 'uc_answers_kind_chk', ARRAY['valore', 'conferma', 'correzione', 'non_so', 'delega', 'proposta_na', 'risposta_chiarimento']::text[]),
      ('uc_answers', 'confidence', 'uc_answers_confidence_chk', ARRAY['certo', 'stima', 'da_verificare']::text[]),
      ('uc_answers', 'source_kind', 'uc_answers_source_kind_chk', ARRAY['referente', 'lateral_space', 'documento', 'sistema', 'import', 'ai_proposta', 'dichiarato_in_call']::text[]),
      ('uc_answers', 'source_basis', 'uc_answers_source_basis_chk', ARRAY['sistema', 'documento', 'stima_a_memoria', 'calcolo']::text[]),
      ('uc_answers', 'device', 'uc_answers_device_chk', ARRAY['mobile', 'desktop']::text[]),
      ('uc_files', 'storage_zone', 'uc_files_storage_zone_chk', ARRAY['standard', 'personale']::text[]),
      ('uc_files', 'personal_data', 'uc_files_personal_data_chk', ARRAY['no', 'pseudonimizzati', 'identificativi', 'sconosciuto']::text[]),
      ('uc_files', 'privacy_class', 'uc_files_privacy_class_chk', ARRAY['escluso_sanitario', 'personale_equipaggio', 'personale', 'riservato_azienda', 'nessuna']::text[]),
      ('uc_files', 'scan_status', 'uc_files_scan_status_chk', ARRAY['in_quarantena', 'pulito', 'rifiutato']::text[]),
      ('uc_datasets', 'personal_data', 'uc_datasets_personal_data_chk', ARRAY['no', 'pseudonimizzati', 'identificativi', 'sconosciuto']::text[]),
      ('uc_datasets', 'status', 'uc_datasets_status_chk', ARRAY['ricevuto', 'profilato', 'in_verifica', 'validato', 'rifiutato', 'scaduto']::text[]),
      ('uc_validations', 'kind', 'uc_validations_kind_chk', ARRAY['automatica', 'umana']::text[]),
      ('uc_validations', 'outcome', 'uc_validations_outcome_chk', ARRAY['ok', 'avviso', 'errore']::text[]),
      ('uc_comments', 'visibility', 'uc_comments_visibility_chk', ARRAY['interno_ls', 'condiviso']::text[]),
      ('uc_comments', 'kind', 'uc_comments_kind_chk', ARRAY['commento', 'chiarimento_richiesto', 'risposta_chiarimento']::text[]),
      ('uc_maps', 'kind', 'uc_maps_kind_chk', ARRAY['processo_as_is', 'processo_to_be', 'flusso_dati', 'sistemi', 'incastri', 'soluzione', 'esempio']::text[]),
      ('uc_maps', 'source', 'uc_maps_source_chk', ARRAY['template', 'claude', 'manuale', 'import']::text[]),
      ('uc_gate_reviews', 'gate_key', 'uc_gate_reviews_gate_key_chk', ARRAY['G1', 'G2', 'G3', 'G4']::text[]),
      ('uc_gate_reviews', 'decision', 'uc_gate_reviews_decision_chk', ARRAY['proposto', 'approvato', 'respinto', 'approvato_con_riserva']::text[]),
      ('uc_catalog_versions', 'reason', 'uc_catalog_versions_reason_chk', ARRAY['gate', 'correzione', 'aggiornamento_template']::text[]),
      ('uc_model_runs', 'kind', 'uc_model_runs_kind_chk', ARRAY['backtest', 'casi_prova', 'esercizio']::text[]),
      ('uc_model_runs', 'status', 'uc_model_runs_status_chk', ARRAY['provvisorio', 'confermato']::text[]),
      ('uc_model_runs', 'recorded_by', 'uc_model_runs_recorded_by_chk', ARRAY['utente', 'mcp', 'sistema']::text[]),
      ('uc_kpi_measurements', 'phase', 'uc_kpi_measurements_phase_chk', ARRAY['baseline', 'backtest', 'esercizio']::text[]),
      ('uc_kpi_measurements', 'recorded_by', 'uc_kpi_measurements_recorded_by_chk', ARRAY['utente', 'mcp', 'sistema']::text[]),
      ('uc_kpi_measurements', 'status', 'uc_kpi_measurements_status_chk', ARRAY['provvisorio', 'confermato']::text[]),
      ('uc_test_cases', 'kind', 'uc_test_cases_kind_chk', ARRAY['sintetico', 'pseudonimizzato']::text[]),
      ('uc_test_cases', 'last_result', 'uc_test_cases_last_result_chk', ARRAY['superato', 'fallito', 'non_eseguito']::text[]),
      ('uc_roi_models', 'status', 'uc_roi_models_status_chk', ARRAY['stima', 'baseline', 'backtest', 'misurato']::text[]),
      ('uc_roi_models', 'scenario', 'uc_roi_models_scenario_chk', ARRAY['prudente', 'base', 'ottimistico']::text[]),
      ('uc_notifications', 'channel', 'uc_notifications_channel_chk', ARRAY['email', 'in_app', 'slack', 'webhook']::text[]),
      ('uc_notifications', 'status', 'uc_notifications_status_chk', ARRAY['in_coda', 'inviata', 'errore', 'annullata']::text[]),
      ('uc_events', 'actor_type', 'uc_events_actor_type_chk', ARRAY['utente', 'referente', 'sistema', 'mcp']::text[])
    ) AS v(tbl, col, conname, vals)
  LOOP
    found_values := NULL;
    SELECT (SELECT array_agg(m[1] ORDER BY m[1]) FROM regexp_matches(pg_get_constraintdef(k.oid), '''([^'']*)''', 'g') AS m)
      INTO found_values
      FROM pg_constraint k
      WHERE k.conrelid = to_regclass('public.' || c.tbl) AND k.conname = c.conname AND k.convalidated;
    IF found_values IS DISTINCT FROM (SELECT array_agg(x ORDER BY x) FROM unnest(c.vals) AS x) THEN
      EXECUTE format('ALTER TABLE public.%I DROP CONSTRAINT IF EXISTS %I', c.tbl, c.conname);
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK (%I IN (%s)) NOT VALID',
        c.tbl, c.conname, c.col, (SELECT string_agg(quote_literal(x), ', ') FROM unnest(c.vals) AS x));
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', c.tbl, c.conname);
    END IF;
  END LOOP;
END
$uc$;

CREATE UNIQUE INDEX IF NOT EXISTS uc_templates_key_version_language_idx ON uc_templates (key, version, language);

CREATE INDEX IF NOT EXISTS uc_templates_status_idx ON uc_templates (status);

CREATE INDEX IF NOT EXISTS uc_templates_restricted_workspace_idx ON uc_templates (restricted_to_workspace_id);

CREATE INDEX IF NOT EXISTS uc_templates_parent_idx ON uc_templates (parent_template_id);

CREATE INDEX IF NOT EXISTS uc_templates_created_by_idx ON uc_templates (created_by_user_id);

CREATE INDEX IF NOT EXISTS uc_templates_published_by_idx ON uc_templates (published_by_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_contacts_workspace_email_idx ON uc_contacts (workspace_id, lower(email)) WHERE email IS NOT NULL AND anonymized_at IS NULL;

CREATE INDEX IF NOT EXISTS uc_contacts_workspace_idx ON uc_contacts (workspace_id);

CREATE INDEX IF NOT EXISTS uc_contacts_user_idx ON uc_contacts (user_id);

CREATE INDEX IF NOT EXISTS uc_contacts_created_by_idx ON uc_contacts (created_by_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_cases_workspace_code_idx ON uc_cases (workspace_id, code);

CREATE INDEX IF NOT EXISTS uc_cases_workspace_status_idx ON uc_cases (workspace_id, status);

CREATE INDEX IF NOT EXISTS uc_cases_portfolio_use_case_idx ON uc_cases (portfolio_use_case_id);

CREATE INDEX IF NOT EXISTS uc_cases_organization_idx ON uc_cases (organization_id);

CREATE INDEX IF NOT EXISTS uc_cases_template_idx ON uc_cases (template_id);

CREATE INDEX IF NOT EXISTS uc_cases_ls_lead_idx ON uc_cases (ls_lead_user_id);

CREATE INDEX IF NOT EXISTS uc_cases_client_owner_idx ON uc_cases (client_owner_contact_id);

CREATE INDEX IF NOT EXISTS uc_cases_privacy_approver_idx ON uc_cases (client_privacy_approver_contact_id);

CREATE INDEX IF NOT EXISTS uc_cases_created_by_idx ON uc_cases (created_by_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_case_members_case_user_role_idx ON uc_case_members (case_id, user_id, role);

CREATE INDEX IF NOT EXISTS uc_case_members_user_idx ON uc_case_members (user_id);

CREATE INDEX IF NOT EXISTS uc_case_members_added_by_idx ON uc_case_members (added_by_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_blockers_case_key_idx ON uc_blockers (case_id, key) WHERE case_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uc_blockers_workspace_key_idx ON uc_blockers (workspace_id, key) WHERE case_id IS NULL;

CREATE INDEX IF NOT EXISTS uc_blockers_workspace_idx ON uc_blockers (workspace_id);

CREATE INDEX IF NOT EXISTS uc_blockers_resolved_by_idx ON uc_blockers (resolved_by_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_items_case_key_idx ON uc_items (case_id, key);

CREATE INDEX IF NOT EXISTS uc_items_case_status_idx ON uc_items (case_id, status);

CREATE INDEX IF NOT EXISTS uc_items_case_priority_idx ON uc_items (case_id, priority);

CREATE INDEX IF NOT EXISTS uc_items_assignee_idx ON uc_items (assignee_contact_id);

CREATE INDEX IF NOT EXISTS uc_items_case_kind_idx ON uc_items (case_id, kind);

CREATE INDEX IF NOT EXISTS uc_items_case_module_idx ON uc_items (case_id, request_module_key);

CREATE INDEX IF NOT EXISTS uc_items_parent_idx ON uc_items (parent_item_id);

CREATE INDEX IF NOT EXISTS uc_items_current_answer_idx ON uc_items (current_answer_id);

CREATE INDEX IF NOT EXISTS uc_items_validated_answer_idx ON uc_items (validated_answer_id);

CREATE INDEX IF NOT EXISTS uc_items_stale_idx ON uc_items (stale_at) WHERE status = 'validata' AND stale_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS uc_items_ls_owner_idx ON uc_items (ls_owner_user_id);

CREATE INDEX IF NOT EXISTS uc_items_confirmed_by_idx ON uc_items (confirmed_by_contact_id);

CREATE INDEX IF NOT EXISTS uc_items_created_by_idx ON uc_items (created_by_user_id);

CREATE INDEX IF NOT EXISTS uc_item_blockers_blocker_idx ON uc_item_blockers (blocker_id);

CREATE INDEX IF NOT EXISTS uc_item_links_case_to_idx ON uc_item_links (case_id, to_item_id);

CREATE INDEX IF NOT EXISTS uc_requests_contact_idx ON uc_requests (contact_id);

CREATE INDEX IF NOT EXISTS uc_requests_delegated_from_idx ON uc_requests (delegated_from_request_id);

CREATE INDEX IF NOT EXISTS uc_requests_delegated_by_idx ON uc_requests (delegated_by_contact_id);

CREATE INDEX IF NOT EXISTS uc_requests_created_by_idx ON uc_requests (created_by_user_id);

CREATE INDEX IF NOT EXISTS uc_requests_next_reminder_idx ON uc_requests (next_reminder_at) WHERE status IN ('inviata', 'aperta', 'in_corso');

CREATE INDEX IF NOT EXISTS uc_request_tokens_request_idx ON uc_request_tokens (request_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_request_items_active_item_idx ON uc_request_items (item_id) WHERE state IN ('da_fare', 'bozza', 'inviata');

CREATE INDEX IF NOT EXISTS uc_request_items_item_idx ON uc_request_items (item_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_answers_item_version_idx ON uc_answers (item_id, version);

CREATE INDEX IF NOT EXISTS uc_answers_case_created_idx ON uc_answers (case_id, created_at);

CREATE INDEX IF NOT EXISTS uc_answers_request_idx ON uc_answers (request_id);

CREATE INDEX IF NOT EXISTS uc_answers_responder_contact_idx ON uc_answers (responder_contact_id);

CREATE INDEX IF NOT EXISTS uc_answers_supersedes_idx ON uc_answers (supersedes_answer_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_files_dedupe_idx ON uc_files (case_id, item_id, storage_zone, sha256) WHERE deleted_at IS NULL AND scan_status <> 'rifiutato';

CREATE INDEX IF NOT EXISTS uc_files_case_idx ON uc_files (case_id);

CREATE INDEX IF NOT EXISTS uc_files_item_idx ON uc_files (item_id);

CREATE INDEX IF NOT EXISTS uc_files_answer_idx ON uc_files (answer_id);

CREATE INDEX IF NOT EXISTS uc_files_request_idx ON uc_files (request_id);

CREATE INDEX IF NOT EXISTS uc_files_retention_idx ON uc_files (retention_until) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS uc_files_quarantine_idx ON uc_files (created_at) WHERE scan_status = 'in_quarantena';

CREATE INDEX IF NOT EXISTS uc_files_workspace_idx ON uc_files (workspace_id);

CREATE INDEX IF NOT EXISTS uc_files_uploaded_contact_idx ON uc_files (uploaded_by_contact_id);

CREATE INDEX IF NOT EXISTS uc_files_uploaded_user_idx ON uc_files (uploaded_by_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_datasets_case_source_version_idx ON uc_datasets (case_id, source_key, dataset_version);

CREATE INDEX IF NOT EXISTS uc_datasets_item_idx ON uc_datasets (item_id);

CREATE INDEX IF NOT EXISTS uc_datasets_file_idx ON uc_datasets (file_id);

CREATE INDEX IF NOT EXISTS uc_datasets_validated_by_idx ON uc_datasets (validated_by_user_id);

CREATE INDEX IF NOT EXISTS uc_validations_item_created_idx ON uc_validations (item_id, created_at);

CREATE INDEX IF NOT EXISTS uc_validations_answer_idx ON uc_validations (answer_id);

CREATE INDEX IF NOT EXISTS uc_validations_dataset_idx ON uc_validations (dataset_id);

CREATE INDEX IF NOT EXISTS uc_comments_item_created_idx ON uc_comments (item_id, created_at);

CREATE INDEX IF NOT EXISTS uc_comments_parent_idx ON uc_comments (parent_comment_id);

CREATE INDEX IF NOT EXISTS uc_comments_open_clarification_idx ON uc_comments (case_id) WHERE kind = 'chiarimento_richiesto' AND resolved_at IS NULL;

CREATE INDEX IF NOT EXISTS uc_comments_author_user_idx ON uc_comments (author_user_id);

CREATE INDEX IF NOT EXISTS uc_comments_author_contact_idx ON uc_comments (author_contact_id);

CREATE INDEX IF NOT EXISTS uc_comments_resolved_by_idx ON uc_comments (resolved_by_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_maps_case_kind_version_idx ON uc_maps (case_id, kind, version);

CREATE UNIQUE INDEX IF NOT EXISTS uc_maps_current_idx ON uc_maps (case_id, kind) WHERE is_current;

CREATE INDEX IF NOT EXISTS uc_maps_created_by_idx ON uc_maps (created_by_user_id);

CREATE INDEX IF NOT EXISTS uc_gate_reviews_case_gate_idx ON uc_gate_reviews (case_id, gate_key);

CREATE UNIQUE INDEX IF NOT EXISTS uc_gate_reviews_open_idx ON uc_gate_reviews (case_id, gate_key) WHERE decision = 'proposto';

CREATE INDEX IF NOT EXISTS uc_gate_reviews_evidence_idx ON uc_gate_reviews (written_evidence_file_id);

CREATE INDEX IF NOT EXISTS uc_catalog_versions_gate_review_idx ON uc_catalog_versions (gate_review_id);

CREATE INDEX IF NOT EXISTS uc_model_runs_case_version_idx ON uc_model_runs (case_id, catalog_version);

CREATE INDEX IF NOT EXISTS uc_model_runs_recorded_by_idx ON uc_model_runs (recorded_by_user_id);

CREATE INDEX IF NOT EXISTS uc_model_runs_token_idx ON uc_model_runs (integration_token_id);

CREATE INDEX IF NOT EXISTS uc_model_runs_confirmed_by_idx ON uc_model_runs (confirmed_by_contact_id);

CREATE INDEX IF NOT EXISTS uc_kpi_measurements_case_item_period_idx ON uc_kpi_measurements (case_id, item_id, period_start);

CREATE INDEX IF NOT EXISTS uc_kpi_measurements_dataset_idx ON uc_kpi_measurements (dataset_id);

CREATE INDEX IF NOT EXISTS uc_kpi_measurements_model_run_idx ON uc_kpi_measurements (model_run_id);

CREATE INDEX IF NOT EXISTS uc_kpi_measurements_recorded_by_idx ON uc_kpi_measurements (recorded_by_user_id);

CREATE INDEX IF NOT EXISTS uc_kpi_measurements_token_idx ON uc_kpi_measurements (integration_token_id);

CREATE INDEX IF NOT EXISTS uc_kpi_measurements_confirmed_by_idx ON uc_kpi_measurements (confirmed_by_contact_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_test_cases_case_key_idx ON uc_test_cases (case_id, key);

CREATE INDEX IF NOT EXISTS uc_test_cases_last_run_idx ON uc_test_cases (last_run_id);

CREATE INDEX IF NOT EXISTS uc_test_cases_approved_by_idx ON uc_test_cases (approved_by_contact_id);

CREATE INDEX IF NOT EXISTS uc_test_cases_created_by_idx ON uc_test_cases (created_by_user_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_roi_models_case_version_scenario_idx ON uc_roi_models (case_id, version, scenario);

CREATE INDEX IF NOT EXISTS uc_roi_models_approved_by_idx ON uc_roi_models (approved_by_contact_id);

CREATE UNIQUE INDEX IF NOT EXISTS uc_milestones_case_key_idx ON uc_milestones (case_id, key);

CREATE INDEX IF NOT EXISTS uc_notifications_status_scheduled_idx ON uc_notifications (status, scheduled_at);

CREATE INDEX IF NOT EXISTS uc_notifications_request_idx ON uc_notifications (request_id);

CREATE INDEX IF NOT EXISTS uc_notifications_unread_idx ON uc_notifications (recipient_user_id, created_at) WHERE channel = 'in_app' AND read_at IS NULL;

CREATE INDEX IF NOT EXISTS uc_notifications_workspace_idx ON uc_notifications (workspace_id);

CREATE INDEX IF NOT EXISTS uc_notifications_case_idx ON uc_notifications (case_id);

CREATE INDEX IF NOT EXISTS uc_notifications_recipient_contact_idx ON uc_notifications (recipient_contact_id);

CREATE INDEX IF NOT EXISTS uc_notifications_recipient_user_idx ON uc_notifications (recipient_user_id);

CREATE INDEX IF NOT EXISTS uc_events_case_created_idx ON uc_events (case_id, created_at);

CREATE INDEX IF NOT EXISTS uc_events_type_idx ON uc_events (event_type);

CREATE INDEX IF NOT EXISTS uc_events_workspace_created_idx ON uc_events (workspace_id, created_at);

CREATE INDEX IF NOT EXISTS uc_rate_limits_window_idx ON uc_rate_limits (window_start);

CREATE INDEX IF NOT EXISTS uc_subprocessor_acks_workspace_declared_idx ON uc_subprocessor_acks (workspace_id, declared_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS uc_subprocessor_acks_workspace_version_idx ON uc_subprocessor_acks (workspace_id, list_version);

CREATE INDEX IF NOT EXISTS uc_subprocessor_acks_declared_by_idx ON uc_subprocessor_acks (declared_by_user_id);

DO $uc$
BEGIN
  IF to_regclass('public.uc_cases_portfolio_use_case_unique_idx') IS NULL THEN
    LOCK TABLE uc_cases IN SHARE MODE;
    IF EXISTS (SELECT 1 FROM uc_cases WHERE portfolio_use_case_id IS NOT NULL GROUP BY portfolio_use_case_id HAVING count(*) > 1) THEN
      RAISE NOTICE 'uc_cases: piu dossier sulla stessa scheda (righe complete e incomplete). Indice uc_cases_portfolio_use_case_unique_idx non creato: esegui use-case-admin dossier-dups.';
    ELSE
      CREATE UNIQUE INDEX IF NOT EXISTS uc_cases_portfolio_use_case_unique_idx
        ON uc_cases (portfolio_use_case_id) WHERE portfolio_use_case_id IS NOT NULL;
    END IF;
  END IF;
END
$uc$;

CREATE OR REPLACE TRIGGER uc_answers_append_only BEFORE UPDATE OR DELETE ON uc_answers FOR EACH ROW EXECUTE FUNCTION uc_guard_append_only();

CREATE OR REPLACE TRIGGER uc_validations_append_only BEFORE UPDATE OR DELETE ON uc_validations FOR EACH ROW EXECUTE FUNCTION uc_guard_append_only();

CREATE OR REPLACE TRIGGER uc_events_append_only BEFORE UPDATE OR DELETE ON uc_events FOR EACH ROW EXECUTE FUNCTION uc_guard_append_only();

CREATE OR REPLACE TRIGGER uc_catalog_versions_append_only BEFORE UPDATE OR DELETE ON uc_catalog_versions FOR EACH ROW EXECUTE FUNCTION uc_guard_append_only();

CREATE OR REPLACE TRIGGER uc_subprocessor_acks_append_only BEFORE UPDATE OR DELETE ON uc_subprocessor_acks FOR EACH ROW EXECUTE FUNCTION uc_guard_append_only();

CREATE OR REPLACE TRIGGER uc_templates_immutable BEFORE UPDATE ON uc_templates FOR EACH ROW EXECUTE FUNCTION uc_template_immutable();

CREATE OR REPLACE TRIGGER uc_gate_reviews_frozen BEFORE UPDATE ON uc_gate_reviews FOR EACH ROW EXECUTE FUNCTION uc_gate_review_frozen();

CREATE OR REPLACE TRIGGER uc_answers_no_personal_plaintext BEFORE INSERT ON uc_answers FOR EACH ROW EXECUTE FUNCTION uc_answers_no_personal_plaintext();

CREATE OR REPLACE TRIGGER uc_item_blockers_keep BEFORE DELETE ON uc_item_blockers FOR EACH ROW EXECUTE FUNCTION uc_item_blockers_keep();

COMMENT ON FUNCTION uc_require(boolean, text) IS 'uc-ddl:c5264e3eb553a3e87d43efc93b86fd89';
