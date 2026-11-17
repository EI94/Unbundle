/**
 * Area «Use case», «File da compilare»: DDL del self-heal della 0040.
 *
 * Sono gli stessi statement di `drizzle/0040_file_da_compilare.sql`, nello stesso ordine, dopo le due righe di
 * apertura del file (`lock_timeout` e l'advisory lock {@link TEMPLATE_FILES_ADVISORY_LOCK}, che il self-heal
 * prende da sé in `runTemplateFilesDdl`):
 * 1. controllo che la 0024 ci sia (esigenze, richieste al referente);
 * 2. `use_case_template_files`: i file da compilare che il team allega alle esigenze di uno use case, una riga
 *    per versione caricata («Sostituisci» ne aggiunge una con `replaces_id`). La stessa catena dei file di
 *    «Cosa serve» (quarantena, tipo dal contenuto, controllo del testo, PDF con poco testo «in_revisione»), ma
 *    in una tabella a parte: un file da compilare non è una risposta e nessuna lettura delle risposte lo vede;
 * 3. `use_case_template_links`: un file legato a N esigenze dello stesso use case (chiave esterna composta:
 *    il legame ha sempre workspace e use case del suo file);
 * 4. `use_case_template_downloads`: il primo download di ogni versione per ogni richiesta, solo per non
 *    scrivere due volte «scaricato dal referente» nella Storia. Nessuna data e nessun dato della persona:
 *    l'ora sta nella riga della Storia.
 * Nessun dato scritto, nessuna colonna aggiunta, cambiata o tolta nelle tabelle di prima; il codice di prima
 * ignora le tabelle nuove. Le righe della Storia usano codici nuovi in `phase_after`, che non ha CHECK.
 *
 * `src/lib/db/use-case-hub-template-files-ddl.test.ts` controlla che la migrazione contenga questi statement,
 * nello stesso ordine e nient'altro, che i CHECK siano le regole qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo il vocabolario della 0024; lo caricano anche gli script di verifica.
 */
import { REFERENT_FILE_KINDS, REFERENT_FILE_STATUSES } from "./use-case-hub-referents-ddl.ts";

/** La chiave dell'advisory lock della 0040: la stessa nel file e in `runTemplateFilesDdl`. */
export const TEMPLATE_FILES_ADVISORY_LOCK = "unbundle:use-case-template-files-ddl";

/** Errore della 0040 su un database senza la 0024. */
export const MISSING_REFERENTS_FOR_TEMPLATES_MESSAGE = "use_case_template_files: manca la 0024. Applica prima drizzle/0024_use_case_referents.sql.";

/** Gli stati del controllo di un file da compilare: gli stessi dei file di «Cosa serve». */
export const TEMPLATE_SCAN_STATUSES = REFERENT_FILE_STATUSES;
export type TemplateScanStatus = (typeof TEMPLATE_SCAN_STATUSES)[number];

/** Perché un file da compilare non c'è più: «Togli» sull'ultima esigenza, una versione nuova, la cancellazione. */
export const TEMPLATE_DELETED_REASONS = ["tolto", "sostituito", "cancellazione"] as const;
export type TemplateDeletedReason = (typeof TEMPLATE_DELETED_REASONS)[number];

/** I tipi ammessi: gli stessi dei file di «Cosa serve» (`use_case_need_files_kind_check`). */
export const TEMPLATE_FILE_KINDS = REFERENT_FILE_KINDS;

/** Il massimo di un file: quello del caricamento diretto (20 MB), come per i file di «Cosa serve». */
export const TEMPLATE_MAX_BYTES = 20 * 1024 * 1024;

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** Gli statement della 0040 dopo le due righe di apertura, nell'ordine del file. */
export const TEMPLATE_FILES_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_referent_requests') IS NULL OR to_regclass('public.use_case_needs') IS NULL THEN
    RAISE EXCEPTION '${MISSING_REFERENTS_FOR_TEMPLATES_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS use_case_template_files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  replaces_id uuid,
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  file_name varchar(255) NOT NULL,
  kind varchar(8) CONSTRAINT use_case_template_files_kind_check CHECK (kind IS NULL OR kind IN (${quoted(TEMPLATE_FILE_KINDS)})),
  mime varchar(120),
  size_bytes integer CONSTRAINT use_case_template_files_size_check CHECK (size_bytes IS NULL OR size_bytes > 0),
  max_bytes integer NOT NULL CONSTRAINT use_case_template_files_max_bytes_check CHECK (max_bytes > 0 AND max_bytes <= ${TEMPLATE_MAX_BYTES}),
  sha256 char(64) CONSTRAINT use_case_template_files_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  upload_mode varchar(6) NOT NULL CONSTRAINT use_case_template_files_mode_check CHECK (upload_mode IN ('server', 'client')),
  scan_status varchar(14) NOT NULL DEFAULT 'in_quarantena' CONSTRAINT use_case_template_files_scan_check CHECK (scan_status IN (${quoted(TEMPLATE_SCAN_STATUSES)})),
  rejection_reason varchar(40),
  findings jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT use_case_template_files_findings_check CHECK (jsonb_typeof(findings) = 'object'),
  personal_warning boolean NOT NULL DEFAULT false,
  quarantine_path varchar(300) CONSTRAINT use_case_template_files_quarantine_path_check CHECK (quarantine_path IS NULL OR quarantine_path ~ '^uc/q/'),
  blob_path varchar(300) CONSTRAINT use_case_template_files_blob_path_check CHECK (blob_path IS NULL OR blob_path ~ '^uc/s/'),
  created_at timestamptz NOT NULL DEFAULT now(),
  checked_at timestamptz,
  reviewed_at timestamptz,
  reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  deleted_at timestamptz,
  deleted_reason varchar(14) CONSTRAINT use_case_template_files_deleted_reason_check CHECK (deleted_reason IS NULL OR deleted_reason IN (${quoted(TEMPLATE_DELETED_REASONS)})),
  CONSTRAINT use_case_template_files_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_template_files_scope_unique UNIQUE (id, workspace_id, use_case_id),
  CONSTRAINT use_case_template_files_replaces_fkey FOREIGN KEY (replaces_id, workspace_id, use_case_id) REFERENCES use_case_template_files (id, workspace_id, use_case_id) ON DELETE SET NULL (replaces_id),
  CONSTRAINT use_case_template_files_replaces_check CHECK (replaces_id IS NULL OR replaces_id <> id),
  CONSTRAINT use_case_template_files_clean_check CHECK (scan_status <> 'pulito' OR deleted_at IS NOT NULL OR (blob_path IS NOT NULL AND sha256 IS NOT NULL AND checked_at IS NOT NULL)),
  CONSTRAINT use_case_template_files_review_check CHECK (scan_status <> 'in_revisione' OR deleted_at IS NOT NULL OR (blob_path IS NOT NULL AND quarantine_path IS NULL AND sha256 IS NOT NULL)),
  CONSTRAINT use_case_template_files_rejected_check CHECK (scan_status <> 'rifiutato' OR (rejection_reason IS NOT NULL AND blob_path IS NULL)),
  CONSTRAINT use_case_template_files_deleted_check CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL)),
  CONSTRAINT use_case_template_files_reviewed_check CHECK (reviewed_by_user_id IS NULL OR reviewed_at IS NOT NULL)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_template_files_use_case_idx ON use_case_template_files (use_case_id, created_at) WHERE deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS use_case_template_files_workspace_idx ON use_case_template_files (workspace_id);`,
  `CREATE INDEX IF NOT EXISTS use_case_template_files_replaces_idx ON use_case_template_files (replaces_id) WHERE replaces_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS use_case_template_files_pending_idx ON use_case_template_files (created_at) WHERE scan_status IN ('in_quarantena', 'in_revisione') AND deleted_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS use_case_template_files_gc_idx ON use_case_template_files (deleted_at) WHERE deleted_at IS NOT NULL AND (blob_path IS NOT NULL OR quarantine_path IS NOT NULL);`,
  `CREATE TABLE IF NOT EXISTS use_case_template_links (
  file_id uuid NOT NULL,
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  CONSTRAINT use_case_template_links_pkey PRIMARY KEY (file_id, need_id),
  CONSTRAINT use_case_template_links_file_fkey FOREIGN KEY (file_id, workspace_id, use_case_id) REFERENCES use_case_template_files (id, workspace_id, use_case_id) ON DELETE CASCADE
);`,
  `CREATE INDEX IF NOT EXISTS use_case_template_links_need_idx ON use_case_template_links (need_id, use_case_id);`,
  `CREATE TABLE IF NOT EXISTS use_case_template_downloads (
  file_id uuid NOT NULL REFERENCES use_case_template_files(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT use_case_template_downloads_pkey PRIMARY KEY (file_id, request_id)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_template_downloads_request_idx ON use_case_template_downloads (request_id);`,
];

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0040. */
export const TEMPLATE_FILES_TABLES = ["use_case_template_files", "use_case_template_links", "use_case_template_downloads"] as const;

/** Gli indici della 0040, per nome (oltre alle chiavi primarie e ai vincoli UNIQUE). */
export const TEMPLATE_FILES_INDEXES = [
  "use_case_template_files_use_case_idx",
  "use_case_template_files_workspace_idx",
  "use_case_template_files_replaces_idx",
  "use_case_template_files_pending_idx",
  "use_case_template_files_gc_idx",
  "use_case_template_links_need_idx",
  "use_case_template_downloads_request_idx",
] as const;

/** I vincoli con nome delle tre tabelle (pkey, unique, fkey composte, check). */
export const TEMPLATE_FILES_NAMED_CONSTRAINTS: readonly string[] = [
  "use_case_template_files_kind_check",
  "use_case_template_files_size_check",
  "use_case_template_files_max_bytes_check",
  "use_case_template_files_sha256_check",
  "use_case_template_files_mode_check",
  "use_case_template_files_scan_check",
  "use_case_template_files_findings_check",
  "use_case_template_files_quarantine_path_check",
  "use_case_template_files_blob_path_check",
  "use_case_template_files_deleted_reason_check",
  "use_case_template_files_pkey",
  "use_case_template_files_scope_unique",
  "use_case_template_files_replaces_fkey",
  "use_case_template_files_replaces_check",
  "use_case_template_files_clean_check",
  "use_case_template_files_review_check",
  "use_case_template_files_rejected_check",
  "use_case_template_files_deleted_check",
  "use_case_template_files_reviewed_check",
  "use_case_template_links_pkey",
  "use_case_template_links_file_fkey",
  "use_case_template_downloads_pkey",
];

/** Vera solo con tutto il DDL della 0040: tabelle, indici, vincoli con nome. Per ensureDbSchema() e templateFilesStoreReady(). */
export const TEMPLATE_FILES_PROBE_SQL = `(
  ${TEMPLATE_FILES_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${TEMPLATE_FILES_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${TEMPLATE_FILES_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(TEMPLATE_FILES_NAMED_CONSTRAINTS)})
  ) = ${TEMPLATE_FILES_NAMED_CONSTRAINTS.length}
)`;
