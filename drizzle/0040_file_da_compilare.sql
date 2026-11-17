-- Area «Use case», «File da compilare»: il team allega a una o più esigenze di «Cosa serve» un file che il
-- referente scarica dal suo link, compila e ricarica con il caricamento di oggi. Il file da compilare non è una
-- risposta: non cambia lo stato dell'esigenza, non manda «Nuovi documenti» né avvisi.
--
-- Questa migrazione aggiunge:
--   - use_case_template_files: i file da compilare di uno use case, una riga per versione caricata
--     («Sostituisci» ne aggiunge una con replaces_id), con la stessa catena dei file di «Cosa serve»
--     (quarantena, tipo dal contenuto, controllo del testo, PDF con poco testo «in_revisione»);
--   - use_case_template_links: un file legato a N esigenze dello stesso use case;
--   - use_case_template_downloads: il primo download di ogni versione per ogni richiesta, solo per scrivere
--     una volta sola «scaricato dal referente» nella Storia (nessuna data, nessun dato della persona).
-- Nessun dato scritto, nessuna colonna aggiunta, cambiata o tolta nelle tabelle di prima: use_case_need_files e
-- le altre tabelle di «Chiedi al referente» restano come sono, e il codice di prima ignora le tabelle nuove.
-- La chiave esterna di replaces_id usa ON DELETE SET NULL (replaces_id): chiede PostgreSQL 15 (produzione 17).
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy: gli
-- stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-template-files-ddl.ts (ensureDbSchema,
-- dopo la 0039, ENSURE_VERSION 34). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0040_file_da_compilare.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-template-files-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_referent_requests') IS NULL OR to_regclass('public.use_case_needs') IS NULL THEN
    RAISE EXCEPTION 'use_case_template_files: manca la 0024. Applica prima drizzle/0024_use_case_referents.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS use_case_template_files (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  replaces_id uuid,
  uploaded_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  file_name varchar(255) NOT NULL,
  kind varchar(8) CONSTRAINT use_case_template_files_kind_check CHECK (kind IS NULL OR kind IN ('pdf', 'docx', 'xlsx', 'pptx', 'csv', 'tsv', 'txt', 'md')),
  mime varchar(120),
  size_bytes integer CONSTRAINT use_case_template_files_size_check CHECK (size_bytes IS NULL OR size_bytes > 0),
  max_bytes integer NOT NULL CONSTRAINT use_case_template_files_max_bytes_check CHECK (max_bytes > 0 AND max_bytes <= 20971520),
  sha256 char(64) CONSTRAINT use_case_template_files_sha256_check CHECK (sha256 IS NULL OR sha256 ~ '^[0-9a-f]{64}$'),
  upload_mode varchar(6) NOT NULL CONSTRAINT use_case_template_files_mode_check CHECK (upload_mode IN ('server', 'client')),
  scan_status varchar(14) NOT NULL DEFAULT 'in_quarantena' CONSTRAINT use_case_template_files_scan_check CHECK (scan_status IN ('in_quarantena', 'in_revisione', 'pulito', 'rifiutato')),
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
  deleted_reason varchar(14) CONSTRAINT use_case_template_files_deleted_reason_check CHECK (deleted_reason IS NULL OR deleted_reason IN ('tolto', 'sostituito', 'cancellazione')),
  CONSTRAINT use_case_template_files_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_template_files_scope_unique UNIQUE (id, workspace_id, use_case_id),
  CONSTRAINT use_case_template_files_replaces_fkey FOREIGN KEY (replaces_id, workspace_id, use_case_id) REFERENCES use_case_template_files (id, workspace_id, use_case_id) ON DELETE SET NULL (replaces_id),
  CONSTRAINT use_case_template_files_replaces_check CHECK (replaces_id IS NULL OR replaces_id <> id),
  CONSTRAINT use_case_template_files_clean_check CHECK (scan_status <> 'pulito' OR deleted_at IS NOT NULL OR (blob_path IS NOT NULL AND sha256 IS NOT NULL AND checked_at IS NOT NULL)),
  CONSTRAINT use_case_template_files_review_check CHECK (scan_status <> 'in_revisione' OR deleted_at IS NOT NULL OR (blob_path IS NOT NULL AND quarantine_path IS NULL AND sha256 IS NOT NULL)),
  CONSTRAINT use_case_template_files_rejected_check CHECK (scan_status <> 'rifiutato' OR (rejection_reason IS NOT NULL AND blob_path IS NULL)),
  CONSTRAINT use_case_template_files_deleted_check CHECK ((deleted_at IS NULL) = (deleted_reason IS NULL)),
  CONSTRAINT use_case_template_files_reviewed_check CHECK (reviewed_by_user_id IS NULL OR reviewed_at IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS use_case_template_files_use_case_idx ON use_case_template_files (use_case_id, created_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS use_case_template_files_workspace_idx ON use_case_template_files (workspace_id);
CREATE INDEX IF NOT EXISTS use_case_template_files_replaces_idx ON use_case_template_files (replaces_id) WHERE replaces_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS use_case_template_files_pending_idx ON use_case_template_files (created_at) WHERE scan_status IN ('in_quarantena', 'in_revisione') AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS use_case_template_files_gc_idx ON use_case_template_files (deleted_at) WHERE deleted_at IS NOT NULL AND (blob_path IS NOT NULL OR quarantine_path IS NOT NULL);

CREATE TABLE IF NOT EXISTS use_case_template_links (
  file_id uuid NOT NULL,
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  CONSTRAINT use_case_template_links_pkey PRIMARY KEY (file_id, need_id),
  CONSTRAINT use_case_template_links_file_fkey FOREIGN KEY (file_id, workspace_id, use_case_id) REFERENCES use_case_template_files (id, workspace_id, use_case_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS use_case_template_links_need_idx ON use_case_template_links (need_id, use_case_id);

CREATE TABLE IF NOT EXISTS use_case_template_downloads (
  file_id uuid NOT NULL REFERENCES use_case_template_files(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES use_case_referent_requests(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  CONSTRAINT use_case_template_downloads_pkey PRIMARY KEY (file_id, request_id)
);
CREATE INDEX IF NOT EXISTS use_case_template_downloads_request_idx ON use_case_template_downloads (request_id);
