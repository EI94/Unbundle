-- Rilascio 8.2b «Le evals dalla CI» (docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.8).
-- Dopo ogni unione su main la CI di GitHub manda a Unbundle le evals dei casi del repository, con la chiave della CI:
-- è del repository, non di una persona. Lateral Space la crea, la ruota e la revoca dall'Agent Factory.
--
-- Questa migrazione aggiunge:
--   - use_case_ci_keys: le chiavi della CI, una per repository (use_case_id resta per la chiave di un caso solo, più
--     avanti). Solo l'impronta SHA-256 e il prefisso da mostrare (ub_ci_ab12), mai la chiave; chi l'ha creata e quando,
--     chi l'ha revocata, quando e perché (a_mano, ruotata, esposta, senza_casi), l'ultimo uso, l'avviso a 14 giorni e
--     la chiave che sostituisce;
--   - use_case_eval_runs.source (cli, il valore di tutte le righe di oggi, oppure ci), ci_key_id (la chiave che ha
--     scritto l'esecuzione, ON DELETE SET NULL) e ci_run_url (l'esecuzione su GitHub), con i vincoli cercati per nome.
-- Nessun dato scritto, nessuna colonna cambiata, nessun CHECK più stretto, nessun tipo nuovo nella campanella: il codice
-- di prima non legge la tabella e le colonne nuove, e scrive le evals con la fonte di default, cli. Il DDL uc (0018) non
-- cambia. Al massimo due chiavi vive per repository: lo garantisce il codice, sotto un advisory lock per workspace e
-- repository.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy (mai da
-- un'anteprima): gli stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-ci-keys-ddl.ts
-- (ensureDbSchema, dopo la 0041, ENSURE_VERSION 36). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0042_chiavi_ci.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-ci-keys-ddl'));

DO $$ BEGIN
  IF to_regclass('public.use_case_eval_runs') IS NULL THEN
    RAISE EXCEPTION 'chiavi della CI: manca la 0036. Applica prima drizzle/0036_evals.sql.';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS use_case_ci_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo varchar(140) NOT NULL CONSTRAINT use_case_ci_keys_repo_check CHECK (repo ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'),
  use_case_id uuid REFERENCES use_cases(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL CONSTRAINT use_case_ci_keys_hash_check CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  token_prefix varchar(16) NOT NULL CONSTRAINT use_case_ci_keys_prefix_check CHECK (token_prefix ~ '^ub_ci_[A-Za-z0-9_-]{4}$'),
  replaces_key_id uuid REFERENCES use_case_ci_keys(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  reminded_at timestamptz,
  revoked_at timestamptz,
  revoked_reason varchar(12) CONSTRAINT use_case_ci_keys_reason_check CHECK (revoked_reason IS NULL OR revoked_reason IN ('a_mano', 'ruotata', 'esposta', 'senza_casi')),
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT use_case_ci_keys_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_ci_keys_hash_unique UNIQUE (token_hash),
  CONSTRAINT use_case_ci_keys_revoked_check CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT use_case_ci_keys_revoked_by_check CHECK (revoked_by_user_id IS NULL OR revoked_at IS NOT NULL),
  CONSTRAINT use_case_ci_keys_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT use_case_ci_keys_replaces_check CHECK (replaces_key_id IS NULL OR replaces_key_id <> id)
);

CREATE INDEX IF NOT EXISTS use_case_ci_keys_repo_idx ON use_case_ci_keys (workspace_id, lower(repo)) WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS use_case_ci_keys_replaces_idx ON use_case_ci_keys (replaces_key_id) WHERE replaces_key_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS use_case_ci_keys_use_case_idx ON use_case_ci_keys (use_case_id) WHERE use_case_id IS NOT NULL;

ALTER TABLE use_case_eval_runs ADD COLUMN IF NOT EXISTS source varchar(3) NOT NULL DEFAULT 'cli';

ALTER TABLE use_case_eval_runs ADD COLUMN IF NOT EXISTS ci_key_id uuid;

ALTER TABLE use_case_eval_runs ADD COLUMN IF NOT EXISTS ci_run_url varchar(300);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_eval_runs'::regclass AND conname = 'use_case_eval_runs_source_check') THEN
    ALTER TABLE use_case_eval_runs ADD CONSTRAINT use_case_eval_runs_source_check CHECK (source IN ('cli', 'ci'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_eval_runs'::regclass AND conname = 'use_case_eval_runs_ci_key_fkey') THEN
    ALTER TABLE use_case_eval_runs ADD CONSTRAINT use_case_eval_runs_ci_key_fkey FOREIGN KEY (ci_key_id) REFERENCES use_case_ci_keys (id) ON DELETE SET NULL;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_eval_runs'::regclass AND conname = 'use_case_eval_runs_ci_url_check') THEN
    ALTER TABLE use_case_eval_runs ADD CONSTRAINT use_case_eval_runs_ci_url_check CHECK (ci_run_url IS NULL OR ci_run_url ~ '^https://github[.]com/[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}/actions/runs/[0-9]{1,20}$');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_eval_runs'::regclass AND conname = 'use_case_eval_runs_ci_check') THEN
    ALTER TABLE use_case_eval_runs ADD CONSTRAINT use_case_eval_runs_ci_check CHECK (source = 'ci' OR (ci_key_id IS NULL AND ci_run_url IS NULL));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS use_case_eval_runs_ci_key_idx ON use_case_eval_runs (ci_key_id) WHERE ci_key_id IS NOT NULL;
