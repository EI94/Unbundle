-- Rilascio 8.0c «Esterni al 100%» (docs/rilascio-8/RILASCIO-8.0c-ESTERNI.md §6).
-- Una persona del cliente costruisce i casi d'uso come una persona di Lateral Space, solo nell'Agent Factory.
--
-- Questa migrazione aggiunge:
--   - use_case_external_builders: le concessioni di «Chi costruisce» a chi viene da fuori Lateral Space. Persona,
--     workspace, e un caso (lo use case) oppure tutti i casi, anche quelli che si apriranno (use_case_id NULL). Una
--     riga «tutti» oppure righe per caso, mai le due insieme: lo garantisce il codice, nella stessa transazione. È
--     composizione del team (chi può lavorare dove), mai una misura delle persone.
-- Il DDL uc (0018) non cambia: nessun ruolo nuovo nei casi, nessun CHECK toccato. use_case_workspace_team (0035) non
-- cambia.
-- Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta: il codice di prima ignora la tabella nuova.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy: gli
-- stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-builders-ddl.ts (ensureDbSchema, dopo la
-- 0036, ENSURE_VERSION 31). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0037_costruttori_esterni.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-external-builders-ddl'));

CREATE TABLE IF NOT EXISTS use_case_external_builders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  use_case_id uuid REFERENCES use_cases(id) ON DELETE CASCADE,
  added_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_external_builders_pkey PRIMARY KEY (id)
);

CREATE UNIQUE INDEX IF NOT EXISTS use_case_external_builders_all_unique
  ON use_case_external_builders (workspace_id, user_id) WHERE use_case_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS use_case_external_builders_case_unique
  ON use_case_external_builders (workspace_id, user_id, use_case_id) WHERE use_case_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS use_case_external_builders_user_idx ON use_case_external_builders (user_id);
