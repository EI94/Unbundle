-- Rilascio 8.1b «Il team di Lateral Space per cliente» (docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md, 8.1b).
-- Chi costruisce in tutti i casi di un cliente: entra nel team di ogni dossier aperto e di quelli che si apriranno.
--
-- Questa migrazione aggiunge:
--   - use_case_workspace_team: le persone di Lateral Space del team di un workspace (cliente), con il ruolo che hanno
--     nei casi. Una riga per persona e workspace. I ruoli nei casi restano in uc_case_members (DDL uc invariato).
-- Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta: il codice di prima ignora la tabella nuova.
-- Scritta a mano, idempotente. In produzione la applica il self-heal dell'app al primo avvio dopo il deploy: gli
-- stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-team-ddl.ts (ensureDbSchema, dopo la 0034,
-- ENSURE_VERSION 29). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0035_team_workspace.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-workspace-team-ddl'));

CREATE TABLE IF NOT EXISTS use_case_workspace_team (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL CONSTRAINT use_case_workspace_team_role_check CHECK (role IN ('ls_lead', 'ls_analista', 'ls_sviluppatore')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_workspace_team_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_workspace_team_unique UNIQUE (workspace_id, user_id)
);
