/**
 * DDL delle tabelle `uc_*` (PIANO §2): una sola fonte per la migrazione
 * `drizzle/0018_uc_casi_duso.sql` (scritta da `scripts/uc-write-migration.ts`)
 * e per il self-heal separato `ensureUcSchema()`.
 *
 * Ogni istruzione è idempotente: `CREATE TABLE IF NOT EXISTS`,
 * `CREATE [UNIQUE] INDEX IF NOT EXISTS`, `CREATE OR REPLACE FUNCTION`,
 * `CREATE OR REPLACE TRIGGER` (PG ≥ 14) e vincoli aggiunti dopo dentro
 * `DO $$ … EXCEPTION WHEN duplicate_object …`. I vocabolari sono `text` con
 * CHECK dal nome stabile `<tabella>_<colonna>_chk`, allineate a `vocab.ts` da un
 * blocco che le ricrea (`NOT VALID` + `VALIDATE`) quando i valori cambiano.
 * L'indice unico tra dossier e scheda sta in un blocco `DO` che lo crea solo
 * senza doppioni e altrimenti lo salta con un NOTICE.
 *
 * L'ultima istruzione scrive l'impronta del DDL nel commento di `uc_require`:
 * il probe la confronta e, se il DDL cambia, il self-heal riparte da solo.
 *
 * Modulo puro: importa solo `./vocab.ts`.
 */
import * as V from "./vocab.ts";

// ── Modello ───────────────────────────────────────────────────────────

type VocabName = {
  [K in keyof typeof V]: (typeof V)[K] extends readonly string[] ? K : never;
}[keyof typeof V];

export interface UcColumn {
  readonly name: string;
  /** Tipo SQL: uuid, text, varchar(n), char(n), jsonb, integer, smallint, boolean, timestamptz, date, numeric, bytea. */
  readonly type: string;
  readonly notNull?: boolean;
  readonly default?: string;
  readonly pk?: boolean;
  /** Bersaglio della FK a colonna singola, es. `users (id) ON DELETE SET NULL`. */
  readonly references?: string;
  /** Vocabolario: genera `CONSTRAINT <tabella>_<colonna>_chk CHECK (col IN (…))`. */
  readonly vocab?: VocabName;
}

export interface UcTable {
  readonly name: string;
  readonly columns: readonly UcColumn[];
  /** Vincoli di tabella già scritti, sempre con `CONSTRAINT <nome>`. */
  readonly constraints: readonly string[];
}

export interface UcIndex {
  readonly name: string;
  readonly table: string;
  readonly on: string;
  readonly unique?: boolean;
  readonly where?: string;
}

export interface UcVocabCheck {
  readonly table: string;
  readonly column: string;
  readonly name: string;
  readonly vocab: VocabName;
  readonly values: readonly string[];
}

// ── Aiuti ─────────────────────────────────────────────────────────────

const HEX64 = "'^[0-9a-f]{64}$'";

const id = (): UcColumn => ({ name: "id", type: "uuid", notNull: true, default: "gen_random_uuid()", pk: true });
const createdAt = (): UcColumn => ({ name: "created_at", type: "timestamptz", notNull: true, default: "now()" });
const updatedAt = (): UcColumn => ({ name: "updated_at", type: "timestamptz", notNull: true, default: "now()" });
const ts = (name: string, notNull = false): UcColumn => ({ name, type: "timestamptz", notNull });
const col = (name: string, type: string, extra: Omit<UcColumn, "name" | "type"> = {}): UcColumn => ({ name, type, ...extra });
const nn = (name: string, type: string, def?: string): UcColumn => ({ name, type, notNull: true, default: def });
const jsonArr = (name: string): UcColumn => nn(name, "jsonb", "'[]'::jsonb");
const jsonObj = (name: string): UcColumn => nn(name, "jsonb", "'{}'::jsonb");
const flag = (name: string, def = "false"): UcColumn => nn(name, "boolean", def);
const vocab = (name: string, v: VocabName, opts: { notNull?: boolean; default?: string } = {}): UcColumn => ({
  name,
  type: "text",
  vocab: v,
  notNull: opts.notNull ?? true,
  default: opts.default,
});
/**
 * NO ACTION controllato al commit. Nelle cascate (cancellazione del workspace) un
 * controllo NO ACTION immediato scatta alla fine di ogni istruzione di cascata e
 * fallirebbe secondo l'ordine delle cascate; differito, protegge lo stesso dalle
 * cancellazioni dirette e lascia completare la cascata.
 */
const NO_ACTION = "DEFERRABLE INITIALLY DEFERRED";

/** FK a colonna singola. `onDelete` assente = NO ACTION differita. */
const fk = (name: string, target: string, onDelete?: "CASCADE" | "SET NULL", notNull = false): UcColumn => ({
  name,
  type: "uuid",
  notNull,
  references: `${target} (id) ${onDelete ? `ON DELETE ${onDelete}` : NO_ACTION}`,
});
const userRef = (name: string): UcColumn => fk(name, "users", "SET NULL");
const check = (table: string, suffix: string, expr: string): string => `CONSTRAINT ${table}_${suffix}_chk CHECK (${expr})`;
const hexCheck = (table: string, column: string): string => check(table, `${column}_format`, `${column} ~ ${HEX64}`);

// ── Tabelle, nell'ordine di creazione (PIANO §2.1) ───────────────────

export const UC_TABLES: readonly UcTable[] = [
  {
    name: "uc_templates",
    columns: [
      id(),
      nn("key", "varchar(120)"),
      nn("version", "varchar(20)"),
      nn("language", "varchar(10)", "'it'"),
      nn("name", "varchar(255)"),
      nn("archetype", "varchar(80)"),
      col("industry", "varchar(80)"),
      col("function_area", "varchar(80)"),
      vocab("status", "TEMPLATE_STATUSES", { default: "'bozza'" }),
      nn("definition", "jsonb"),
      nn("definition_hash", "char(64)"),
      fk("restricted_to_workspace_id", "workspaces", "CASCADE"),
      fk("parent_template_id", "uc_templates", "SET NULL"),
      col("changelog", "text"),
      userRef("created_by_user_id"),
      userRef("published_by_user_id"),
      ts("published_at"),
      createdAt(),
      updatedAt(),
    ],
    constraints: [
      check("uc_templates", "key_format", "key ~ '^[a-z0-9_]+(\\.[a-z0-9_]+)+$'"),
      check("uc_templates", "version_format", "version ~ '^[0-9]+\\.[0-9]+\\.[0-9]+(-[0-9A-Za-z.-]+)?$'"),
      hexCheck("uc_templates", "definition_hash"),
      // Un template con contenuti del cliente è sempre riservato al suo workspace.
      check("uc_templates", "confidential_restricted", "coalesce(definition -> 'confidential', 'false'::jsonb) <> 'true'::jsonb OR restricted_to_workspace_id IS NOT NULL"),
    ],
  },
  {
    name: "uc_contacts",
    columns: [
      id(),
      fk("workspace_id", "workspaces", "CASCADE", true),
      nn("display_name", "varchar(255)"),
      col("role_label", "varchar(255)"),
      col("template_role_key", "varchar(80)"),
      col("email", "varchar(320)"),
      col("phone_e164", "varchar(32)"),
      userRef("user_id"),
      vocab("preferred_channel", "CONTACT_CHANNELS", { default: "'email'" }),
      nn("locale", "varchar(10)", "'it'"),
      flag("is_active", "true"),
      col("privacy_notice_version", "varchar(20)"),
      ts("privacy_notice_seen_at"),
      flag("digest_opt_out"),
      ts("anonymized_at"),
      userRef("created_by_user_id"),
      createdAt(),
      updatedAt(),
    ],
    constraints: [check("uc_contacts", "phone_format", "phone_e164 ~ '^\\+[1-9][0-9]{6,14}$'")],
  },
  {
    name: "uc_cases",
    columns: [
      id(),
      fk("workspace_id", "workspaces", "CASCADE", true),
      fk("organization_id", "organizations", "CASCADE", true),
      fk("portfolio_use_case_id", "use_cases", "SET NULL"),
      // NO ACTION (non RESTRICT): la cancellazione del workspace resta possibile (D26).
      fk("template_id", "uc_templates", undefined, true),
      nn("template_version", "varchar(20)"),
      nn("code", "varchar(40)"),
      nn("title", "varchar(255)"),
      col("one_liner", "varchar(500)"),
      jsonObj("description"),
      jsonArr("description_history"),
      vocab("status", "CASE_STATUSES", { default: "'bozza'" }),
      vocab("status_before_suspension", "CASE_STATUSES", { notNull: false }),
      col("suspension_reason", "text"),
      col("closed_reason", "text"),
      ts("status_changed_at"),
      col("perimeter_label", "varchar(255)"),
      jsonArr("contract_refs"),
      col("spec_document_ref", "varchar(255)"),
      jsonArr("levers"),
      userRef("ls_lead_user_id"),
      fk("client_owner_contact_id", "uc_contacts", "SET NULL"),
      col("client_owner_role_label", "varchar(255)"),
      fk("client_privacy_approver_contact_id", "uc_contacts", "SET NULL"),
      jsonObj("signers_designation"),
      vocab("data_mode", "DATA_MODES", { default: "'solo_sintetici'" }),
      flag("ai_environment_approved"),
      col("data_controller_label", "varchar(255)"),
      jsonObj("settings"),
      col("readiness", "jsonb"),
      nn("catalog_version", "integer", "0"),
      nn("catalog_revision", "integer", "0"),
      nn("share_epoch", "integer", "0"),
      ts("setup_completed_at"),
      userRef("created_by_user_id"),
      createdAt(),
      updatedAt(),
      ts("archived_at"),
      ts("closed_at"),
    ],
    constraints: [
      check("uc_cases", "code_format", "code ~ '^[A-Z0-9][A-Z0-9-]{1,39}$'"),
      check("uc_cases", "suspension", "status <> 'sospeso' OR status_before_suspension IS NOT NULL"),
      check("uc_cases", "counters", "catalog_version >= 0 AND catalog_revision >= 0 AND share_epoch >= 0"),
    ],
  },
  {
    name: "uc_case_members",
    columns: [
      id(),
      fk("case_id", "uc_cases", "CASCADE", true),
      fk("user_id", "users", "CASCADE", true),
      vocab("role", "CASE_ROLES"),
      flag("personal_zone_access"),
      col("personal_zone_grant", "jsonb"),
      userRef("added_by_user_id"),
      createdAt(),
    ],
    constraints: [],
  },
  {
    name: "uc_blockers",
    columns: [
      id(),
      fk("workspace_id", "workspaces", "CASCADE", true),
      fk("case_id", "uc_cases", "CASCADE"),
      nn("key", "varchar(60)"),
      nn("label", "text"),
      vocab("status", "BLOCKER_STATUSES", { default: "'attivo'" }),
      jsonObj("scope"),
      col("fallback_allowed", "text"),
      col("evidence", "jsonb"),
      jsonArr("approvals"),
      userRef("resolved_by_user_id"),
      ts("resolved_at"),
      col("notes", "text"),
      createdAt(),
      updatedAt(),
    ],
    constraints: [
      check("uc_blockers", "key_format", "key ~ '^[a-z0-9_]+$'"),
      check("uc_blockers", "sanitario_permanent", "key <> 'sanitario' OR status = 'permanente'"),
    ],
  },
  {
    name: "uc_items",
    columns: [
      id(),
      fk("case_id", "uc_cases", "CASCADE", true),
      nn("key", "varchar(160)"),
      col("template_item_key", "varchar(160)"),
      vocab("kind", "ITEM_KINDS"),
      vocab("section", "ITEM_SECTIONS"),
      fk("parent_item_id", "uc_items", "SET NULL"),
      nn("title", "text"),
      col("explanation", "text"),
      col("why", "text"),
      col("example", "text"),
      col("help", "text"),
      jsonObj("spec"),
      vocab("priority", "PRIORITIES", { notNull: false }),
      jsonArr("serves_for"),
      vocab("privacy_class", "PRIVACY_CLASSES", { default: "'riservato_azienda'" }),
      vocab("value_visibility", "VALUE_VISIBILITY", { default: "'owner_e_ls'" }),
      jsonArr("availability"),
      vocab("perimeter", "PERIMETERS", { notNull: false }),
      jsonArr("levers"),
      vocab("response_type", "RESPONSE_TYPES", { notNull: false }),
      jsonObj("response_config"),
      col("request_module_key", "varchar(80)"),
      flag("in_gate_scope"),
      vocab("status", "ITEM_STATUSES", { default: "'da_chiedere'" }),
      col("status_reason", "varchar(500)"),
      ts("status_changed_at"),
      fk("assignee_contact_id", "uc_contacts", "SET NULL"),
      col("owner_role_key", "varchar(80)"),
      userRef("ls_owner_user_id"),
      ts("due_at"),
      flag("due_is_proposal"),
      // FK composite verso uc_answers(item_id, id), aggiunte dopo la tabella delle risposte.
      col("current_answer_id", "uuid"),
      col("validated_answer_id", "uuid"),
      // Firme e verifiche: senza FK, l'audit non deve perdere chi ha firmato.
      col("validated_by_user_id", "uuid"),
      ts("validated_at"),
      fk("confirmed_by_contact_id", "uc_contacts", "SET NULL"),
      col("na_reason", "text"),
      ts("na_proposed_at"),
      col("na_proposed_by_user_id", "uuid"),
      col("na_proposed_by_contact_id", "uuid"),
      col("na_approved_by_user_id", "uuid"),
      col("na_client_approved_by_user_id", "uuid"),
      col("na_approved_by_contact_id", "uuid"),
      ts("na_approved_at"),
      col("waiver", "jsonb"),
      ts("waiver_approved_at"),
      col("fallback", "jsonb"),
      ts("fallback_approved_at"),
      col("partial_na", "jsonb"),
      col("freshness_days", "integer"),
      ts("stale_at"),
      flag("requires_validity_period"),
      jsonArr("source_refs"),
      flag("ai_proposed"),
      col("shared_item_id", "uuid"),
      nn("sort_order", "integer", "0"),
      userRef("created_by_user_id"),
      createdAt(),
      updatedAt(),
      ts("deleted_at"),
    ],
    constraints: [
      "CONSTRAINT uc_items_case_id_id_key UNIQUE (case_id, id)",
      check("uc_items", "title_length", "char_length(title) <= 600"),
      check("uc_items", "freshness_days_positive", "freshness_days > 0"),
      // Difesa in profondità sulle due firme NA: Lateral Space e cliente (account o link).
      check(
        "uc_items",
        "non_applicabile_signed",
        "status <> 'non_applicabile' OR (na_approved_at IS NOT NULL AND na_approved_by_user_id IS NOT NULL AND (na_client_approved_by_user_id IS NOT NULL OR na_approved_by_contact_id IS NOT NULL))",
      ),
      check("uc_items", "validata_complete", "status <> 'validata' OR (validated_answer_id IS NOT NULL AND validated_by_user_id IS NOT NULL)"),
      check("uc_items", "mancante_reason", "status <> 'mancante' OR status_reason IS NOT NULL"),
    ],
  },
  {
    name: "uc_item_blockers",
    columns: [
      fk("item_id", "uc_items", "CASCADE", true),
      fk("blocker_id", "uc_blockers", "CASCADE", true),
      vocab("origin", "ITEM_BLOCKER_ORIGINS"),
      createdAt(),
    ],
    constraints: ["CONSTRAINT uc_item_blockers_pkey PRIMARY KEY (item_id, blocker_id)"],
  },
  {
    name: "uc_item_links",
    columns: [
      nn("case_id", "uuid"),
      nn("from_item_id", "uuid"),
      nn("to_item_id", "uuid"),
      vocab("relation", "LINK_RELATIONS"),
      col("cardinality", "varchar(40)"),
      col("note", "text"),
    ],
    constraints: [
      "CONSTRAINT uc_item_links_pkey PRIMARY KEY (from_item_id, to_item_id, relation)",
      "CONSTRAINT uc_item_links_from_fkey FOREIGN KEY (case_id, from_item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE",
      "CONSTRAINT uc_item_links_to_fkey FOREIGN KEY (case_id, to_item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE",
      check("uc_item_links", "no_self_link", "from_item_id <> to_item_id"),
    ],
  },
  {
    name: "uc_requests",
    columns: [
      id(),
      fk("case_id", "uc_cases", "CASCADE", true),
      fk("contact_id", "uc_contacts", undefined, true),
      vocab("purpose", "REQUEST_PURPOSES", { default: "'raccolta'" }),
      nn("share_epoch", "integer"),
      col("acting_role_key", "varchar(80)"),
      vocab("status", "REQUEST_STATUSES", { default: "'bozza'" }),
      col("message", "text"),
      vocab("channel", "REQUEST_CHANNELS", { default: "'email'" }),
      fk("delegated_from_request_id", "uc_requests", "SET NULL"),
      fk("delegated_by_contact_id", "uc_contacts", "SET NULL"),
      nn("delegation_depth", "smallint", "0"),
      flag("otp_required"),
      ts("expires_at"),
      ts("sent_at"),
      ts("first_opened_at"),
      ts("completed_at"),
      ts("privacy_ack_at"),
      col("privacy_notice_version", "varchar(20)"),
      nn("reminder_count", "integer", "0"),
      ts("last_reminder_at"),
      ts("next_reminder_at"),
      ts("escalated_at"),
      ts("revoked_at"),
      col("revoked_reason", "text"),
      userRef("created_by_user_id"),
      createdAt(),
      updatedAt(),
    ],
    constraints: [
      "CONSTRAINT uc_requests_case_id_id_key UNIQUE (case_id, id)",
      check("uc_requests", "delegation_depth_range", "delegation_depth BETWEEN 0 AND 2"),
      check("uc_requests", "reminder_count_range", "reminder_count BETWEEN 0 AND 2"),
      check("uc_requests", "expiry_when_sent", "status = 'bozza' OR expires_at IS NOT NULL"),
    ],
  },
  {
    name: "uc_request_tokens",
    columns: [
      id(),
      nn("case_id", "uuid"),
      nn("request_id", "uuid"),
      nn("token_hash", "char(64)"),
      nn("token_prefix", "varchar(12)"),
      vocab("issued_for", "TOKEN_ISSUED_FOR"),
      // Valorizzato solo per «copia», l'unico caso in cui un utente vede il token.
      col("issued_by_user_id", "uuid"),
      createdAt(),
      ts("revoked_at"),
    ],
    constraints: [
      "CONSTRAINT uc_request_tokens_token_hash_key UNIQUE (token_hash)",
      "CONSTRAINT uc_request_tokens_request_fkey FOREIGN KEY (case_id, request_id) REFERENCES uc_requests (case_id, id) ON DELETE CASCADE",
      hexCheck("uc_request_tokens", "token_hash"),
    ],
  },
  {
    name: "uc_request_items",
    columns: [
      nn("case_id", "uuid"),
      nn("request_id", "uuid"),
      nn("item_id", "uuid"),
      vocab("state", "REQUEST_ITEM_STATES", { default: "'da_fare'" }),
      col("draft", "jsonb"),
      ts("draft_updated_at"),
    ],
    constraints: [
      "CONSTRAINT uc_request_items_pkey PRIMARY KEY (request_id, item_id)",
      "CONSTRAINT uc_request_items_request_fkey FOREIGN KEY (case_id, request_id) REFERENCES uc_requests (case_id, id) ON DELETE CASCADE",
      "CONSTRAINT uc_request_items_item_fkey FOREIGN KEY (case_id, item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE",
    ],
  },
  {
    name: "uc_answers",
    columns: [
      id(),
      nn("case_id", "uuid"),
      nn("item_id", "uuid"),
      nn("version", "integer"),
      vocab("kind", "ANSWER_KINDS"),
      col("value", "jsonb"),
      col("value_normalized", "jsonb"),
      col("value_encrypted", "bytea"),
      col("valid_from", "date"),
      col("valid_to", "date"),
      vocab("confidence", "CONFIDENCE", { notNull: false }),
      col("note", "text"),
      vocab("source_kind", "ANSWER_SOURCE_KINDS"),
      col("source_ref", "varchar(500)"),
      vocab("source_basis", "SOURCE_BASIS", { notNull: false }),
      fk("responder_contact_id", "uc_contacts"),
      // Senza FK: un SET NULL sarebbe un UPDATE, vietato su una tabella a sola aggiunta.
      col("responder_user_id", "uuid"),
      col("request_id", "uuid"),
      col("supersedes_answer_id", "uuid"),
      jsonArr("file_ids"),
      col("text_hash", "char(64)"),
      col("ip_hash", "varchar(64)"),
      col("user_agent", "varchar(300)"),
      vocab("device", "ANSWER_DEVICES", { notNull: false }),
      createdAt(),
      ts("erased_at"),
      col("erasure_reason", "varchar(120)"),
    ],
    constraints: [
      "CONSTRAINT uc_answers_item_id_id_key UNIQUE (item_id, id)",
      "CONSTRAINT uc_answers_item_fkey FOREIGN KEY (case_id, item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE",
      `CONSTRAINT uc_answers_request_fkey FOREIGN KEY (case_id, request_id) REFERENCES uc_requests (case_id, id) ${NO_ACTION}`,
      `CONSTRAINT uc_answers_supersedes_fkey FOREIGN KEY (item_id, supersedes_answer_id) REFERENCES uc_answers (item_id, id) ${NO_ACTION}`,
      check("uc_answers", "version_positive", "version > 0"),
      check("uc_answers", "single_value_storage", "NOT (value IS NOT NULL AND value_encrypted IS NOT NULL)"),
      check("uc_answers", "validity_period", "valid_from IS NULL OR valid_to IS NULL OR valid_from <= valid_to"),
      hexCheck("uc_answers", "text_hash"),
    ],
  },
  {
    name: "uc_files",
    columns: [
      id(),
      fk("workspace_id", "workspaces", "CASCADE", true),
      fk("case_id", "uc_cases", "CASCADE", true),
      fk("item_id", "uc_items", "SET NULL"),
      fk("answer_id", "uc_answers", "SET NULL"),
      fk("request_id", "uc_requests", "SET NULL"),
      fk("uploaded_by_contact_id", "uc_contacts", "SET NULL"),
      userRef("uploaded_by_user_id"),
      nn("file_name", "varchar(255)"),
      // Noti solo dopo il caricamento: la riga nasce all'emissione del token (D43).
      col("mime", "varchar(150)"),
      col("size_bytes", "integer"),
      col("sha256", "char(64)"),
      vocab("storage_zone", "STORAGE_ZONES", { default: "'standard'" }),
      col("blob_path", "text"),
      col("quarantine_path", "text"),
      col("encryption_key_ref", "varchar(120)"),
      vocab("personal_data", "FILE_PERSONAL_DATA", { default: "'sconosciuto'" }),
      vocab("privacy_class", "PRIVACY_CLASSES"),
      nn("max_size_bytes", "integer"),
      vocab("scan_status", "SCAN_STATUSES", { default: "'in_quarantena'" }),
      col("scan_findings", "jsonb"),
      col("preview", "jsonb"),
      flag("content_scanned"),
      flag("uploader_declaration"),
      col("reviewed_by_user_id", "uuid"),
      ts("reviewed_at"),
      col("extracted_text", "text"),
      flag("ai_processing_allowed"),
      col("retention_until", "date"),
      ts("deleted_at"),
      col("deletion_reason", "varchar(120)"),
      createdAt(),
    ],
    constraints: [
      check("uc_files", "size_positive", "size_bytes IS NULL OR (size_bytes > 0 AND size_bytes <= max_size_bytes)"),
      check("uc_files", "max_size_positive", "max_size_bytes > 0"),
      hexCheck("uc_files", "sha256"),
      check("uc_files", "clean_complete", "scan_status <> 'pulito' OR (mime IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL)"),
      check("uc_files", "personal_encrypted", "storage_zone = 'standard' OR encryption_key_ref IS NOT NULL OR deleted_at IS NOT NULL"),
      check("uc_files", "reviewer_not_uploader", "reviewed_by_user_id IS NULL OR reviewed_by_user_id IS DISTINCT FROM uploaded_by_user_id"),
      check("uc_files", "no_personal_text", "storage_zone = 'standard' OR extracted_text IS NULL"),
    ],
  },
  {
    name: "uc_datasets",
    columns: [
      id(),
      fk("case_id", "uc_cases", "CASCADE", true),
      fk("item_id", "uc_items", "SET NULL"),
      fk("file_id", "uc_files", "SET NULL"),
      nn("source_key", "varchar(160)"),
      nn("dataset_version", "integer"),
      col("period_from", "date"),
      col("period_to", "date"),
      ts("extracted_at"),
      col("extraction_method", "text"),
      col("timezone", "varchar(64)"),
      col("currency", "char(3)"),
      col("row_count", "integer"),
      col("column_mapping", "jsonb"),
      col("schema", "jsonb"),
      flag("pseudonymized"),
      col("pseudonymization_method", "varchar(120)"),
      vocab("personal_data", "FILE_PERSONAL_DATA", { notNull: false }),
      jsonArr("pii_columns"),
      nn("data_controller_label", "varchar(255)"),
      col("quality", "jsonb"),
      vocab("status", "DATASET_STATUSES", { default: "'ricevuto'" }),
      userRef("validated_by_user_id"),
      ts("validated_at"),
      col("retention_until", "date"),
      createdAt(),
      updatedAt(),
      ts("deleted_at"),
    ],
    constraints: [
      check("uc_datasets", "version_positive", "dataset_version > 0"),
      check("uc_datasets", "row_count_non_negative", "row_count IS NULL OR row_count >= 0"),
      check("uc_datasets", "period", "period_from IS NULL OR period_to IS NULL OR period_from <= period_to"),
    ],
  },
  {
    name: "uc_validations",
    columns: [
      id(),
      nn("case_id", "uuid"),
      nn("item_id", "uuid"),
      col("answer_id", "uuid"),
      fk("dataset_id", "uc_datasets"),
      nn("check_key", "varchar(160)"),
      vocab("kind", "VALIDATION_KINDS"),
      vocab("outcome", "VALIDATION_OUTCOMES"),
      nn("message", "text"),
      col("details", "jsonb"),
      col("by_user_id", "uuid"),
      createdAt(),
    ],
    constraints: [
      "CONSTRAINT uc_validations_item_fkey FOREIGN KEY (case_id, item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE",
      `CONSTRAINT uc_validations_answer_fkey FOREIGN KEY (item_id, answer_id) REFERENCES uc_answers (item_id, id) ${NO_ACTION}`,
    ],
  },
  {
    name: "uc_comments",
    columns: [
      id(),
      nn("case_id", "uuid"),
      nn("item_id", "uuid"),
      userRef("author_user_id"),
      fk("author_contact_id", "uc_contacts", "SET NULL"),
      fk("parent_comment_id", "uc_comments", "SET NULL"),
      nn("body", "text"),
      vocab("visibility", "COMMENT_VISIBILITIES", { default: "'interno_ls'" }),
      vocab("kind", "COMMENT_KINDS", { default: "'commento'" }),
      ts("resolved_at"),
      userRef("resolved_by_user_id"),
      createdAt(),
    ],
    constraints: [
      "CONSTRAINT uc_comments_item_fkey FOREIGN KEY (case_id, item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE",
      check("uc_comments", "body_length", "char_length(body) <= 4000"),
      check("uc_comments", "single_author", "num_nonnulls(author_user_id, author_contact_id) <= 1"),
    ],
  },
  {
    name: "uc_maps",
    columns: [
      id(),
      fk("case_id", "uc_cases", "CASCADE", true),
      nn("version", "integer"),
      vocab("kind", "MAP_KINDS"),
      nn("title", "varchar(255)"),
      nn("graph", "jsonb"),
      col("artifact_blob_path", "text"),
      col("artifact_sha256", "char(64)"),
      vocab("source", "MAP_SOURCES"),
      flag("is_current", "true"),
      userRef("created_by_user_id"),
      createdAt(),
    ],
    constraints: [check("uc_maps", "version_positive", "version > 0"), hexCheck("uc_maps", "artifact_sha256")],
  },
  {
    name: "uc_gate_reviews",
    columns: [
      id(),
      fk("case_id", "uc_cases", "CASCADE", true),
      vocab("gate_key", "GATE_KEYS"),
      nn("computed", "jsonb"),
      nn("catalog_revision", "integer"),
      nn("summary_text_hash", "char(64)"),
      col("catalog_version", "integer"),
      col("catalog_snapshot_path", "text"),
      col("catalog_snapshot_hash", "char(64)"),
      vocab("decision", "GATE_DECISIONS", { default: "'proposto'" }),
      jsonArr("waivers"),
      jsonArr("approvals"),
      fk("written_evidence_file_id", "uc_files", "SET NULL"),
      col("notes", "text"),
      // Senza FK: dopo la decisione la riga non cambia più (trigger uc_gate_review_frozen).
      col("proposed_by_user_id", "uuid"),
      ts("proposed_at"),
      ts("decided_at"),
      createdAt(),
    ],
    constraints: [
      hexCheck("uc_gate_reviews", "summary_text_hash"),
      hexCheck("uc_gate_reviews", "catalog_snapshot_hash"),
    ],
  },
  {
    name: "uc_catalog_versions",
    columns: [
      id(),
      fk("case_id", "uc_cases", "CASCADE", true),
      nn("version", "integer"),
      vocab("reason", "CATALOG_VERSION_REASONS"),
      fk("gate_review_id", "uc_gate_reviews"),
      col("change_note", "text"),
      nn("diff", "jsonb"),
      nn("snapshot", "jsonb"),
      nn("snapshot_hash", "char(64)"),
      col("snapshot_path", "text"),
      nn("approved_by", "jsonb"),
      col("created_by_user_id", "uuid"),
      createdAt(),
    ],
    constraints: [
      "CONSTRAINT uc_catalog_versions_case_version_key UNIQUE (case_id, version)",
      check("uc_catalog_versions", "version_positive", "version > 0"),
      hexCheck("uc_catalog_versions", "snapshot_hash"),
    ],
  },
  {
    name: "uc_model_runs",
    columns: [
      id(),
      fk("case_id", "uc_cases", "CASCADE", true),
      vocab("kind", "MODEL_RUN_KINDS"),
      nn("catalog_version", "integer"),
      jsonArr("dataset_versions"),
      col("code_ref", "varchar(120)"),
      col("parameters_hash", "varchar(64)"),
      col("period_from", "date"),
      col("period_to", "date"),
      col("summary", "jsonb"),
      vocab("status", "PROVISIONAL_STATUSES", { default: "'provvisorio'" }),
      vocab("recorded_by", "RECORDED_BY"),
      userRef("recorded_by_user_id"),
      fk("integration_token_id", "workspace_integration_tokens", "SET NULL"),
      fk("confirmed_by_contact_id", "uc_contacts", "SET NULL"),
      ts("confirmed_at"),
      createdAt(),
    ],
    constraints: [
      `CONSTRAINT uc_model_runs_catalog_version_fkey FOREIGN KEY (case_id, catalog_version) REFERENCES uc_catalog_versions (case_id, version) ${NO_ACTION}`,
      check("uc_model_runs", "period", "period_from IS NULL OR period_to IS NULL OR period_from <= period_to"),
    ],
  },
  {
    name: "uc_kpi_measurements",
    columns: [
      id(),
      nn("case_id", "uuid"),
      nn("item_id", "uuid"),
      vocab("phase", "KPI_PHASES"),
      nn("period_start", "date"),
      nn("period_end", "date"),
      col("value", "numeric"),
      col("unit", "varchar(40)"),
      col("interval_low", "numeric"),
      col("interval_high", "numeric"),
      nn("sample_size", "integer"),
      flag("suppressed"),
      jsonObj("dimension_values"),
      col("method", "text"),
      col("source_ref", "varchar(500)"),
      fk("dataset_id", "uc_datasets", "SET NULL"),
      fk("model_run_id", "uc_model_runs", "SET NULL"),
      col("catalog_version", "integer"),
      vocab("recorded_by", "RECORDED_BY"),
      userRef("recorded_by_user_id"),
      fk("integration_token_id", "workspace_integration_tokens", "SET NULL"),
      vocab("status", "PROVISIONAL_STATUSES", { default: "'provvisorio'" }),
      fk("confirmed_by_contact_id", "uc_contacts", "SET NULL"),
      ts("confirmed_at"),
      createdAt(),
    ],
    constraints: [
      "CONSTRAINT uc_kpi_measurements_item_fkey FOREIGN KEY (case_id, item_id) REFERENCES uc_items (case_id, id) ON DELETE CASCADE",
      // Mai un valore mostrato sotto la soglia minima (art. 15.4).
      check("uc_kpi_measurements", "min_sample", "suppressed OR sample_size >= 5"),
      check("uc_kpi_measurements", "sample_non_negative", "sample_size >= 0"),
      check("uc_kpi_measurements", "period", "period_start <= period_end"),
    ],
  },
  {
    name: "uc_test_cases",
    columns: [
      id(),
      fk("case_id", "uc_cases", "CASCADE", true),
      nn("key", "varchar(60)"),
      vocab("kind", "TEST_CASE_KINDS"),
      nn("input", "jsonb"),
      nn("expected", "jsonb"),
      jsonArr("covers"),
      jsonArr("serve_per"),
      vocab("last_result", "TEST_CASE_RESULTS", { default: "'non_eseguito'" }),
      fk("last_run_id", "uc_model_runs", "SET NULL"),
      fk("approved_by_contact_id", "uc_contacts", "SET NULL"),
      ts("approved_at"),
      userRef("created_by_user_id"),
      createdAt(),
      updatedAt(),
    ],
    constraints: [],
  },
  {
    name: "uc_roi_models",
    columns: [
      id(),
      fk("case_id", "uc_cases", "CASCADE", true),
      nn("version", "integer"),
      vocab("status", "ROI_STATUSES", { default: "'stima'" }),
      vocab("scenario", "ROI_SCENARIOS", { default: "'base'" }),
      nn("currency", "char(3)", "'EUR'"),
      col("implementation_cost", "numeric"),
      col("annual_run_cost", "numeric"),
      col("annual_benefit", "numeric"),
      jsonArr("cost_lines"),
      jsonArr("benefit_lines"),
      col("break_even_months", "numeric"),
      col("value_5y", "numeric"),
      col("discount_rate", "numeric"),
      nn("horizon_years", "integer", "5"),
      jsonArr("assumptions"),
      col("attribution_method", "text"),
      col("baseline_period", "jsonb"),
      col("adoption_rate", "numeric"),
      flag("includes_human_review_time", "true"),
      col("human_review_hours", "numeric"),
      jsonObj("content"),
      fk("approved_by_contact_id", "uc_contacts", "SET NULL"),
      ts("approved_at"),
      createdAt(),
      updatedAt(),
    ],
    constraints: [
      // Il tempo di verifica umana entra sempre nel ROI (art. 9.2).
      check("uc_roi_models", "human_review_included", "includes_human_review_time"),
      check("uc_roi_models", "version_positive", "version > 0"),
      check("uc_roi_models", "horizon_positive", "horizon_years > 0"),
      check("uc_roi_models", "adoption_rate_range", "adoption_rate IS NULL OR (adoption_rate >= 0 AND adoption_rate <= 1)"),
    ],
  },
  {
    name: "uc_milestones",
    columns: [
      id(),
      fk("case_id", "uc_cases", "CASCADE", true),
      nn("key", "varchar(60)"),
      nn("title", "varchar(255)"),
      col("planned_date", "date"),
      col("planned_label", "text"),
      flag("is_proposal"),
      flag("to_confirm"),
      col("owner_label", "varchar(255)"),
      ts("done_at"),
      col("notes", "text"),
      nn("sort_order", "integer", "0"),
      createdAt(),
      updatedAt(),
    ],
    constraints: [],
  },
  {
    name: "uc_notifications",
    columns: [
      id(),
      fk("workspace_id", "workspaces", "CASCADE", true),
      fk("case_id", "uc_cases", "CASCADE"),
      fk("request_id", "uc_requests", "CASCADE"),
      fk("recipient_contact_id", "uc_contacts", "CASCADE"),
      fk("recipient_user_id", "users", "CASCADE"),
      vocab("channel", "NOTIFICATION_CHANNELS"),
      nn("template_key", "varchar(80)"),
      jsonObj("payload"),
      vocab("status", "NOTIFICATION_STATUSES", { default: "'in_coda'" }),
      col("hold_reason", "varchar(60)"),
      nn("attempts", "integer", "0"),
      nn("dedupe_key", "varchar(200)"),
      nn("scheduled_at", "timestamptz", "now()"),
      ts("sent_at"),
      ts("read_at"),
      col("error", "varchar(500)"),
      createdAt(),
    ],
    constraints: [
      "CONSTRAINT uc_notifications_dedupe_key_key UNIQUE (dedupe_key)",
      check("uc_notifications", "in_app_user", "channel <> 'in_app' OR recipient_user_id IS NOT NULL"),
      check("uc_notifications", "attempts_non_negative", "attempts >= 0"),
    ],
  },
  {
    name: "uc_events",
    columns: [
      id(),
      fk("workspace_id", "workspaces", "CASCADE"),
      // Senza FK: l'audit sopravvive alla chiusura e alla cancellazione del caso.
      col("case_id", "uuid"),
      vocab("actor_type", "EVENT_ACTOR_TYPES"),
      col("actor_user_id", "uuid"),
      col("actor_contact_id", "uuid"),
      col("integration_token_id", "uuid"),
      nn("event_type", "varchar(100)"),
      col("target_type", "varchar(40)"),
      col("target_id", "uuid"),
      col("from_state", "varchar(40)"),
      col("to_state", "varchar(40)"),
      jsonObj("payload"),
      col("ip_hash", "varchar(64)"),
      col("user_agent", "varchar(300)"),
      createdAt(),
    ],
    constraints: [check("uc_events", "event_type_format", "event_type ~ '^[a-z_]+\\.[a-z_]+$'")],
  },
  {
    name: "uc_rate_limits",
    columns: [nn("bucket", "varchar(120)"), nn("window_start", "timestamptz"), nn("count", "integer", "0")],
    constraints: ["CONSTRAINT uc_rate_limits_pkey PRIMARY KEY (bucket, window_start)"],
  },
];

export const UC_TABLE_NAMES: readonly string[] = UC_TABLES.map((t) => t.name);

// ── Vincoli aggiunti dopo (riferimenti circolari) ────────────────────

/** FK composite: la risposta corrente e quella validata sono risposte della voce stessa. */
const LATE_CONSTRAINTS: readonly { table: string; name: string; definition: string }[] = [
  {
    table: "uc_items",
    name: "uc_items_current_answer_fkey",
    definition: `FOREIGN KEY (id, current_answer_id) REFERENCES uc_answers (item_id, id) ${NO_ACTION}`,
  },
  {
    table: "uc_items",
    name: "uc_items_validated_answer_fkey",
    definition: `FOREIGN KEY (id, validated_answer_id) REFERENCES uc_answers (item_id, id) ${NO_ACTION}`,
  },
];

// ── Indici ────────────────────────────────────────────────────────────

const ix = (table: string, suffix: string, on: string, extra: { unique?: boolean; where?: string } = {}): UcIndex => ({
  name: `${table}_${suffix}_idx`,
  table,
  on,
  ...extra,
});

export const UC_INDEXES: readonly UcIndex[] = [
  ix("uc_templates", "key_version_language", "key, version, language", { unique: true }),
  ix("uc_templates", "status", "status"),
  ix("uc_templates", "restricted_workspace", "restricted_to_workspace_id"),
  ix("uc_templates", "parent", "parent_template_id"),
  ix("uc_templates", "created_by", "created_by_user_id"),
  ix("uc_templates", "published_by", "published_by_user_id"),

  ix("uc_contacts", "workspace_email", "workspace_id, lower(email)", { unique: true, where: "email IS NOT NULL AND anonymized_at IS NULL" }),
  ix("uc_contacts", "workspace", "workspace_id"),
  ix("uc_contacts", "user", "user_id"),
  ix("uc_contacts", "created_by", "created_by_user_id"),

  ix("uc_cases", "workspace_code", "workspace_id, code", { unique: true }),
  ix("uc_cases", "workspace_status", "workspace_id, status"),
  ix("uc_cases", "portfolio_use_case", "portfolio_use_case_id"),
  ix("uc_cases", "organization", "organization_id"),
  ix("uc_cases", "template", "template_id"),
  ix("uc_cases", "ls_lead", "ls_lead_user_id"),
  ix("uc_cases", "client_owner", "client_owner_contact_id"),
  ix("uc_cases", "privacy_approver", "client_privacy_approver_contact_id"),
  ix("uc_cases", "created_by", "created_by_user_id"),

  ix("uc_case_members", "case_user_role", "case_id, user_id, role", { unique: true }),
  ix("uc_case_members", "user", "user_id"),
  ix("uc_case_members", "added_by", "added_by_user_id"),

  ix("uc_blockers", "case_key", "case_id, key", { unique: true, where: "case_id IS NOT NULL" }),
  ix("uc_blockers", "workspace_key", "workspace_id, key", { unique: true, where: "case_id IS NULL" }),
  ix("uc_blockers", "workspace", "workspace_id"),
  ix("uc_blockers", "resolved_by", "resolved_by_user_id"),

  ix("uc_items", "case_key", "case_id, key", { unique: true }),
  ix("uc_items", "case_status", "case_id, status"),
  ix("uc_items", "case_priority", "case_id, priority"),
  ix("uc_items", "assignee", "assignee_contact_id"),
  ix("uc_items", "case_kind", "case_id, kind"),
  ix("uc_items", "case_module", "case_id, request_module_key"),
  ix("uc_items", "parent", "parent_item_id"),
  ix("uc_items", "current_answer", "current_answer_id"),
  ix("uc_items", "validated_answer", "validated_answer_id"),
  ix("uc_items", "stale", "stale_at", { where: "status = 'validata' AND stale_at IS NOT NULL" }),
  ix("uc_items", "ls_owner", "ls_owner_user_id"),
  ix("uc_items", "confirmed_by", "confirmed_by_contact_id"),
  ix("uc_items", "created_by", "created_by_user_id"),

  ix("uc_item_blockers", "blocker", "blocker_id"),

  ix("uc_item_links", "case_to", "case_id, to_item_id"),

  ix("uc_requests", "contact", "contact_id"),
  ix("uc_requests", "delegated_from", "delegated_from_request_id"),
  ix("uc_requests", "delegated_by", "delegated_by_contact_id"),
  ix("uc_requests", "created_by", "created_by_user_id"),
  ix("uc_requests", "next_reminder", "next_reminder_at", { where: "status IN ('inviata', 'aperta', 'in_corso')" }),

  ix("uc_request_tokens", "request", "request_id"),

  // Al massimo una richiesta attiva per voce.
  ix("uc_request_items", "active_item", "item_id", {
    unique: true,
    where: `state IN (${V.ACTIVE_REQUEST_ITEM_STATES.map((s) => `'${s}'`).join(", ")})`,
  }),
  ix("uc_request_items", "item", "item_id"),

  ix("uc_answers", "item_version", "item_id, version", { unique: true }),
  ix("uc_answers", "case_created", "case_id, created_at"),
  ix("uc_answers", "request", "request_id"),
  ix("uc_answers", "responder_contact", "responder_contact_id"),
  ix("uc_answers", "supersedes", "supersedes_answer_id"),

  // Un doppione si riusa solo nella stessa voce e nella stessa zona.
  ix("uc_files", "dedupe", "case_id, item_id, storage_zone, sha256", { unique: true, where: "deleted_at IS NULL AND scan_status <> 'rifiutato'" }),
  ix("uc_files", "case", "case_id"),
  ix("uc_files", "item", "item_id"),
  ix("uc_files", "answer", "answer_id"),
  ix("uc_files", "request", "request_id"),
  ix("uc_files", "retention", "retention_until", { where: "deleted_at IS NULL" }),
  ix("uc_files", "quarantine", "created_at", { where: "scan_status = 'in_quarantena'" }),
  ix("uc_files", "workspace", "workspace_id"),
  ix("uc_files", "uploaded_contact", "uploaded_by_contact_id"),
  ix("uc_files", "uploaded_user", "uploaded_by_user_id"),

  ix("uc_datasets", "case_source_version", "case_id, source_key, dataset_version", { unique: true }),
  ix("uc_datasets", "item", "item_id"),
  ix("uc_datasets", "file", "file_id"),
  ix("uc_datasets", "validated_by", "validated_by_user_id"),

  ix("uc_validations", "item_created", "item_id, created_at"),
  ix("uc_validations", "answer", "answer_id"),
  ix("uc_validations", "dataset", "dataset_id"),

  ix("uc_comments", "item_created", "item_id, created_at"),
  ix("uc_comments", "parent", "parent_comment_id"),
  ix("uc_comments", "open_clarification", "case_id", { where: "kind = 'chiarimento_richiesto' AND resolved_at IS NULL" }),
  ix("uc_comments", "author_user", "author_user_id"),
  ix("uc_comments", "author_contact", "author_contact_id"),
  ix("uc_comments", "resolved_by", "resolved_by_user_id"),

  ix("uc_maps", "case_kind_version", "case_id, kind, version", { unique: true }),
  ix("uc_maps", "current", "case_id, kind", { unique: true, where: "is_current" }),
  ix("uc_maps", "created_by", "created_by_user_id"),

  ix("uc_gate_reviews", "case_gate", "case_id, gate_key"),
  ix("uc_gate_reviews", "open", "case_id, gate_key", { unique: true, where: "decision = 'proposto'" }),
  ix("uc_gate_reviews", "evidence", "written_evidence_file_id"),

  ix("uc_catalog_versions", "gate_review", "gate_review_id"),

  ix("uc_model_runs", "case_version", "case_id, catalog_version"),
  ix("uc_model_runs", "recorded_by", "recorded_by_user_id"),
  ix("uc_model_runs", "token", "integration_token_id"),
  ix("uc_model_runs", "confirmed_by", "confirmed_by_contact_id"),

  ix("uc_kpi_measurements", "case_item_period", "case_id, item_id, period_start"),
  ix("uc_kpi_measurements", "dataset", "dataset_id"),
  ix("uc_kpi_measurements", "model_run", "model_run_id"),
  ix("uc_kpi_measurements", "recorded_by", "recorded_by_user_id"),
  ix("uc_kpi_measurements", "token", "integration_token_id"),
  ix("uc_kpi_measurements", "confirmed_by", "confirmed_by_contact_id"),

  ix("uc_test_cases", "case_key", "case_id, key", { unique: true }),
  ix("uc_test_cases", "last_run", "last_run_id"),
  ix("uc_test_cases", "approved_by", "approved_by_contact_id"),
  ix("uc_test_cases", "created_by", "created_by_user_id"),

  ix("uc_roi_models", "case_version_scenario", "case_id, version, scenario", { unique: true }),
  ix("uc_roi_models", "approved_by", "approved_by_contact_id"),

  ix("uc_milestones", "case_key", "case_id, key", { unique: true }),

  ix("uc_notifications", "status_scheduled", "status, scheduled_at"),
  ix("uc_notifications", "request", "request_id"),
  ix("uc_notifications", "unread", "recipient_user_id, created_at", { where: "channel = 'in_app' AND read_at IS NULL" }),
  ix("uc_notifications", "workspace", "workspace_id"),
  ix("uc_notifications", "case", "case_id"),
  ix("uc_notifications", "recipient_contact", "recipient_contact_id"),
  ix("uc_notifications", "recipient_user", "recipient_user_id"),

  ix("uc_events", "case_created", "case_id, created_at"),
  ix("uc_events", "type", "event_type"),
  ix("uc_events", "workspace_created", "workspace_id, created_at"),

  ix("uc_rate_limits", "window", "window_start"),
];

// ── Indice unico tra dossier e scheda (docs/use-case/DESIGN.md §10.4) ──

/** Nome fisso dell'indice unico tra dossier e scheda: lo stesso della 0020 della pagina Use case e di `doctor.ts`. */
export const UC_UNIQUE_DOSSIER_INDEX = "uc_cases_portfolio_use_case_unique_idx";

/**
 * Doppioni: righe di `uc_cases` sulla stessa scheda, **complete e incomplete**
 * (una creazione fallita può lasciare una riga con `setup_completed_at NULL`).
 * Stessa condizione della 0020, di `use-case-admin dossier-dups` e di `uc-doctor`.
 */
export const UC_DOSSIER_DUPLICATES_CONDITION =
  "SELECT 1 FROM uc_cases WHERE portfolio_use_case_id IS NOT NULL GROUP BY portfolio_use_case_id HAVING count(*) > 1";

/**
 * L'indice ha un nome nuovo: `CREATE … IF NOT EXISTS` non trasformerebbe in unico
 * `uc_cases_portfolio_use_case_idx`, che resta (si toglie in fase 6). Il DDL uc si
 * applica in una sola transazione (`runUcOnce`): un `CREATE UNIQUE INDEX` fallito
 * per un doppione spegnerebbe tutta la sezione. Quindi si crea solo senza doppioni;
 * altrimenti un NOTICE e si va avanti: la sonda dice `unique_index` falso ma
 * `current` vero, la sezione resta disponibile (anche con il self-heal spento), il
 * self-heal riprova al prossimo avvio a freddo e `uc-doctor` segnala i doppioni. Il lock SHARE (lo
 * stesso di `CREATE INDEX`), preso solo se l'indice manca, ferma le scritture su
 * `uc_cases` tra il controllo e la creazione.
 *
 * Su un database nuovo `uc_cases` è vuota e l'indice nasce subito. Una prova che
 * semina doppioni dopo la 0018 (per esempio lo stato prima della 0020) imita una
 * 0018 di prima di questo indice: `DROP INDEX IF EXISTS
 * uc_cases_portfolio_use_case_unique_idx` dopo le migrazioni, prima dei doppioni.
 */
export const UC_UNIQUE_DOSSIER_INDEX_DDL = `DO $uc$
BEGIN
  IF to_regclass('public.${UC_UNIQUE_DOSSIER_INDEX}') IS NULL THEN
    LOCK TABLE uc_cases IN SHARE MODE;
    IF EXISTS (${UC_DOSSIER_DUPLICATES_CONDITION}) THEN
      RAISE NOTICE 'uc_cases: piu dossier sulla stessa scheda (righe complete e incomplete). Indice ${UC_UNIQUE_DOSSIER_INDEX} non creato: esegui use-case-admin dossier-dups.';
    ELSE
      CREATE UNIQUE INDEX IF NOT EXISTS ${UC_UNIQUE_DOSSIER_INDEX}
        ON uc_cases (portfolio_use_case_id) WHERE portfolio_use_case_id IS NOT NULL;
    END IF;
  END IF;
END
$uc$`;

// ── Vocabolari → CHECK ────────────────────────────────────────────────

export const UC_VOCAB_CHECKS: readonly UcVocabCheck[] = UC_TABLES.flatMap((table) =>
  table.columns
    .filter((c): c is UcColumn & { vocab: VocabName } => c.vocab !== undefined)
    .map((c) => ({
      table: table.name,
      column: c.name,
      name: `${table.name}_${c.name}_chk`,
      vocab: c.vocab,
      values: V[c.vocab] as readonly string[],
    })),
);

const quoteList = (values: readonly string[]): string => values.map((v) => `'${v.replace(/'/g, "''")}'`).join(", ");

// ── Funzioni e trigger (PIANO §2.4) ──────────────────────────────────

const PERSONAL_CLASSES_SQL = quoteList(V.PERSONAL_PRIVACY_CLASSES);
const ERASABLE_ANSWER_FIELDS = "ARRAY['value', 'value_normalized', 'value_encrypted', 'note', 'erased_at', 'erasure_reason']";

/** Firme delle funzioni per il probe (`to_regprocedure`). */
export const UC_FUNCTIONS: readonly string[] = [
  "uc_require(boolean,text)",
  "uc_guard_append_only()",
  "uc_template_immutable()",
  "uc_gate_review_frozen()",
  "uc_answers_no_personal_plaintext()",
  "uc_item_blockers_keep()",
];

/** Tabelle a sola aggiunta. */
export const UC_APPEND_ONLY_TABLES: readonly string[] = ["uc_answers", "uc_validations", "uc_events", "uc_catalog_versions"];

export const UC_TRIGGERS: readonly { name: string; table: string; timing: string; fn: string }[] = [
  ...UC_APPEND_ONLY_TABLES.map((table) => ({
    name: `${table}_append_only`,
    table,
    timing: "BEFORE UPDATE OR DELETE",
    fn: "uc_guard_append_only",
  })),
  { name: "uc_templates_immutable", table: "uc_templates", timing: "BEFORE UPDATE", fn: "uc_template_immutable" },
  { name: "uc_gate_reviews_frozen", table: "uc_gate_reviews", timing: "BEFORE UPDATE", fn: "uc_gate_review_frozen" },
  { name: "uc_answers_no_personal_plaintext", table: "uc_answers", timing: "BEFORE INSERT", fn: "uc_answers_no_personal_plaintext" },
  { name: "uc_item_blockers_keep", table: "uc_item_blockers", timing: "BEFORE DELETE", fn: "uc_item_blockers_keep" },
];

const FUNCTION_DDL: readonly string[] = [
  // CAS nei batch a più istruzioni: un'eccezione annulla tutto il batch (PIANO §1.1).
  `CREATE OR REPLACE FUNCTION uc_require(ok boolean, code text) RETURNS boolean
LANGUAGE plpgsql AS $$
BEGIN
  IF ok IS NOT TRUE THEN
    RAISE EXCEPTION 'uc:%', code;
  END IF;
  RETURN true;
END
$$`,
  // Sola aggiunta. DELETE ammessa solo in cascata (la riga padre non esiste più);
  // UPDATE ammesso solo per la cancellazione privacy di una risposta.
  `CREATE OR REPLACE FUNCTION uc_guard_append_only() RETURNS trigger
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
    END IF;
    RAISE EXCEPTION 'uc:sola_aggiunta' USING DETAIL = TG_TABLE_NAME || ': cancellazione non ammessa';
  END IF;
  IF TG_TABLE_NAME = 'uc_answers' THEN
    IF OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL AND NEW.erasure_reason IS NOT NULL
       AND NEW.value IS NULL AND NEW.value_normalized IS NULL AND NEW.value_encrypted IS NULL AND NEW.note IS NULL
       AND (to_jsonb(NEW) - ${ERASABLE_ANSWER_FIELDS}) = (to_jsonb(OLD) - ${ERASABLE_ANSWER_FIELDS})
    THEN
      RETURN NEW;
    END IF;
  END IF;
  RAISE EXCEPTION 'uc:sola_aggiunta' USING DETAIL = TG_TABLE_NAME || ': modifica non ammessa';
END
$$`,
  // Un template pubblicato non cambia più; si può solo ritirare (una volta).
  `CREATE OR REPLACE FUNCTION uc_template_immutable() RETURNS trigger
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
$$`,
  // Una decisione sul gate non si riscrive; resta ammessa la cascata SET NULL sul file di prova.
  `CREATE OR REPLACE FUNCTION uc_gate_review_frozen() RETURNS trigger
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
$$`,
  // Valori personali solo cifrati; nessun valore, nemmeno cifrato, per i dati sanitari.
  `CREATE OR REPLACE FUNCTION uc_answers_no_personal_plaintext() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (NEW.value IS NOT NULL OR NEW.value_normalized IS NOT NULL OR NEW.value_encrypted IS NOT NULL)
     AND EXISTS (SELECT 1 FROM uc_items i WHERE i.id = NEW.item_id AND i.privacy_class = '${V.HEALTH_PRIVACY_CLASS}')
  THEN
    RAISE EXCEPTION 'uc:valore_sanitario';
  END IF;
  IF (NEW.value IS NOT NULL OR NEW.value_normalized IS NOT NULL)
     AND EXISTS (SELECT 1 FROM uc_items i WHERE i.id = NEW.item_id AND i.privacy_class IN (${PERSONAL_CLASSES_SQL}))
  THEN
    RAISE EXCEPTION 'uc:valore_personale_in_chiaro';
  END IF;
  RETURN NEW;
END
$$`,
  // Le righe di un blocco attivo o permanente non si cancellano, salvo cascata.
  `CREATE OR REPLACE FUNCTION uc_item_blockers_keep() RETURNS trigger
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
$$`,
];

// ── Resa SQL ──────────────────────────────────────────────────────────

function renderColumn(table: string, c: UcColumn): string {
  let out = `  ${c.name} ${c.type}`;
  if (c.notNull) out += " NOT NULL";
  if (c.default !== undefined) out += ` DEFAULT ${c.default}`;
  if (c.pk) out += " PRIMARY KEY";
  if (c.references) out += ` REFERENCES ${c.references}`;
  if (c.vocab) out += ` CONSTRAINT ${table}_${c.name}_chk CHECK (${c.name} IN (${quoteList(V[c.vocab] as readonly string[])}))`;
  return out;
}

function renderTable(t: UcTable): string {
  const lines = [...t.columns.map((c) => renderColumn(t.name, c)), ...t.constraints.map((c) => `  ${c}`)];
  return `CREATE TABLE IF NOT EXISTS ${t.name} (\n${lines.join(",\n")}\n)`;
}

function renderIndex(i: UcIndex): string {
  return `CREATE ${i.unique ? "UNIQUE " : ""}INDEX IF NOT EXISTS ${i.name} ON ${i.table} (${i.on})${i.where ? ` WHERE ${i.where}` : ""}`;
}

function renderLateConstraint(c: { table: string; name: string; definition: string }): string {
  return `DO $uc$ BEGIN
  ALTER TABLE ${c.table} ADD CONSTRAINT ${c.name} ${c.definition};
EXCEPTION WHEN duplicate_object THEN NULL;
END $uc$`;
}

/** Riallinea le CHECK dei vocabolari a `vocab.ts` quando i valori sono cambiati. */
function renderVocabSync(): string {
  const rows = UC_VOCAB_CHECKS.map((c) => `      ('${c.table}', '${c.column}', '${c.name}', ARRAY[${quoteList(c.values)}]::text[])`).join(",\n");
  return `DO $uc$
DECLARE
  c record;
  found_values text[];
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
${rows}
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
$uc$`;
}

function renderTrigger(t: (typeof UC_TRIGGERS)[number]): string {
  return `CREATE OR REPLACE TRIGGER ${t.name} ${t.timing} ON ${t.table} FOR EACH ROW EXECUTE FUNCTION ${t.fn}()`;
}

/** Impronta deterministica (cyrb53 doppio, 32 cifre esadecimali). Rileva un DDL cambiato, non è crittografia. */
function fingerprint(text: string): string {
  const half = (seed: number): string => {
    let h1 = 0xdeadbeef ^ seed;
    let h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
      const ch = text.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
  };
  return half(0) + half(0x9e3779b9);
}

const BODY: readonly string[] = [
  ...FUNCTION_DDL,
  ...UC_TABLES.map(renderTable),
  ...LATE_CONSTRAINTS.map(renderLateConstraint),
  renderVocabSync(),
  ...UC_INDEXES.map(renderIndex),
  UC_UNIQUE_DOSSIER_INDEX_DDL,
  ...UC_TRIGGERS.map(renderTrigger),
];

/** Impronta del DDL, scritta nel commento di `uc_require` come ultima istruzione. */
export const UC_DDL_FINGERPRINT: string = fingerprint(BODY.join("\n;\n"));
export const UC_DDL_MARKER = `uc-ddl:${UC_DDL_FINGERPRINT}`;

/** Le istruzioni, nell'ordine, ciascuna idempotente. */
export const UC_DDL: readonly string[] = Object.freeze([
  ...BODY,
  `COMMENT ON FUNCTION uc_require(boolean, text) IS '${UC_DDL_MARKER}'`,
]);

// ── Probe ─────────────────────────────────────────────────────────────

/** Colonne aggiunte nel tempo: il probe le controlla una per una. */
export const UC_ADDITIVE_COLUMNS: readonly (readonly [string, string])[] = [
  ["uc_items", "in_gate_scope"],
  ["uc_cases", "catalog_revision"],
  ["uc_notifications", "read_at"],
];

/**
 * Una sola query, due colonne (docs/use-case/DESIGN.md §10.4):
 * - `current`: il DB è allineato a questo DDL (tabelle, funzioni, trigger,
 *   colonne, vocabolari, impronta), quindi la sezione può servire;
 * - `unique_index`: c'è l'indice unico tra dossier e scheda. Il DDL lo salta
 *   finché c'è un doppione: con `current` vero la sezione resta disponibile, anche
 *   con il self-heal spento, e il self-heal acceso riprova a ogni avvio a freddo.
 */
export const UC_PROBE_SQL: string = `SELECT (
  (SELECT count(*) FROM unnest(ARRAY[${quoteList(UC_TABLE_NAMES)}]::text[]) AS t(name)
     WHERE to_regclass('public.' || t.name) IS NOT NULL) = ${UC_TABLE_NAMES.length}
  AND (SELECT count(*) FROM unnest(ARRAY[${quoteList(UC_FUNCTIONS)}]::text[]) AS f(sig)
     WHERE to_regprocedure('public.' || f.sig) IS NOT NULL) = ${UC_FUNCTIONS.length}
  AND (SELECT count(*) FROM pg_trigger tg
     JOIN pg_class rel ON rel.oid = tg.tgrelid
     JOIN pg_namespace ns ON ns.oid = rel.relnamespace
     WHERE ns.nspname = 'public' AND NOT tg.tgisinternal
       AND (rel.relname::text, tg.tgname::text) IN (${UC_TRIGGERS.map((t) => `('${t.table}', '${t.name}')`).join(", ")})) = ${UC_TRIGGERS.length}
  AND (SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public'
       AND (table_name::text, column_name::text) IN (${UC_ADDITIVE_COLUMNS.map(([t, c]) => `('${t}', '${c}')`).join(", ")})) = ${UC_ADDITIVE_COLUMNS.length}
  AND NOT EXISTS (
    SELECT 1 FROM (VALUES
${UC_VOCAB_CHECKS.map((c) => `      ('${c.table}', '${c.name}', ARRAY[${quoteList(c.values)}]::text[])`).join(",\n")}
    ) AS v(tbl, conname, vals)
    WHERE NOT EXISTS (
      SELECT 1 FROM pg_constraint k
      WHERE k.conrelid = to_regclass('public.' || v.tbl) AND k.conname = v.conname AND k.convalidated
        AND (SELECT array_agg(m[1] ORDER BY m[1]) FROM regexp_matches(pg_get_constraintdef(k.oid), '''([^'']*)''', 'g') AS m)
          = (SELECT array_agg(x ORDER BY x) FROM unnest(v.vals) AS x)))
  AND coalesce(obj_description(to_regprocedure('public.uc_require(boolean,text)'), 'pg_proc'), '') = '${UC_DDL_MARKER}'
) AS current,
  to_regclass('public.${UC_UNIQUE_DOSSIER_INDEX}') IS NOT NULL AS unique_index`;

/**
 * Vera se ci sono doppioni (`UC_DOSSIER_DUPLICATES_CONDITION`). Si legge solo con
 * `current` vero e `unique_index` falso, per dire nel log il rimedio giusto:
 * `dossier-dups` se ci sono doppioni, altrimenti riapplicare la 0018.
 */
export const UC_DOSSIER_DUPLICATES_SQL = `SELECT EXISTS (${UC_DOSSIER_DUPLICATES_CONDITION}) AS duplicates`;

// ── Migrazione ────────────────────────────────────────────────────────

export const UC_MIGRATION_FILE = "drizzle/0018_uc_casi_duso.sql";

/** Testo del file di migrazione: generato, non modificare a mano. */
export function renderUcMigration(): string {
  const header = [
    "-- Casi d'uso (uc_*): tabelle, vincoli, indici e trigger.",
    "-- GENERATO da scripts/uc-write-migration.ts a partire da src/lib/uc/ddl.ts: non modificare a mano.",
    "-- Idempotente. Si applica con:",
    "--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0018_uc_casi_duso.sql",
    `-- Impronta: ${UC_DDL_MARKER}`,
  ].join("\n");
  return `${header}\n\n${UC_DDL.join(";\n\n")};\n`;
}
