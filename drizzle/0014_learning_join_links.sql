-- Iscrizione a un corso tramite link generato dal formatore.
--
-- Prima di questo, assegnare un corso richiedeva che la persona fosse gia'
-- membro del workspace: il formatore copiava a mano un invito, aspettava
-- l'accettazione e solo allora poteva assegnare il turno. Per un'aula di venti
-- persone non e' praticabile.
--
-- Un link punta a UNA riga di learning_sessions, cioe' a una lezione precisa:
-- "un link per ogni lezione" diventa un vincolo del database invece di un
-- predicato ricalcolato a ogni uso.

CREATE TABLE IF NOT EXISTS learning_join_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  program_id uuid NOT NULL,
  module_id text NOT NULL DEFAULT 'm1',
  cohort_id text NOT NULL,
  -- Solo l'impronta: il token in chiaro esiste una volta sola, nella risposta
  -- che lo crea, e non viene mai ripersistito.
  token_hash varchar(64) NOT NULL UNIQUE CHECK (length(token_hash) = 64),
  label text,
  -- Un link non puo' concedere piu' di 'learner'. I ruoli che aprono
  -- l'importazione dei pacchetti non sono nemmeno rappresentabili qui.
  role member_role NOT NULL DEFAULT 'learner' CHECK (role = 'learner'),
  max_uses integer NOT NULL CHECK (max_uses BETWEEN 1 AND 500),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0 AND used_count <= max_uses),
  -- L'interruttore che il formatore apre a inizio lezione e chiude alla fine.
  -- Riduce la finestra di esposizione molto piu' di una scadenza lontana.
  door_open boolean NOT NULL DEFAULT false,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  idempotency_key uuid,
  CONSTRAINT learning_join_links_idempotency UNIQUE (workspace_id, program_id, idempotency_key),
  -- Bersaglio della chiave esterna composita delle riscossioni.
  CONSTRAINT learning_join_links_scoped UNIQUE (workspace_id, program_id, id),
  CONSTRAINT learning_join_links_session FOREIGN KEY (workspace_id, program_id, module_id, cohort_id)
    REFERENCES learning_sessions (workspace_id, program_id, module_id, cohort_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS learning_join_links_cohort_idx
  ON learning_join_links (workspace_id, program_id, cohort_id);

-- Registro di chi e' entrato da quale link, modellato su
-- workspace_invitation_acceptances. Lo UNIQUE su (link, persona) fa si' che
-- riaprire lo stesso link non consumi un secondo posto, e rende la richiesta
-- di riapertura del turno auto-limitata a una per persona senza rate limiting.
CREATE TABLE IF NOT EXISTS learning_join_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  program_id uuid NOT NULL,
  link_id uuid NOT NULL,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL,
  email_snapshot text NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('enrolled', 'already_enrolled', 'moved', 'kept_other_cohort')),
  reopen_requested_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learning_join_redemptions_once UNIQUE (link_id, user_id),
  CONSTRAINT learning_join_redemptions_link FOREIGN KEY (workspace_id, program_id, link_id)
    REFERENCES learning_join_links (workspace_id, program_id, id) ON DELETE CASCADE,
  -- Una riscossione non puo' esistere senza l'iscrizione reale della persona
  -- giusta: learning_enrollments ha un unique su (workspace, program, id, user).
  CONSTRAINT learning_join_redemptions_enrollment FOREIGN KEY (workspace_id, program_id, enrollment_id, user_id)
    REFERENCES learning_enrollments (workspace_id, program_id, id, user_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS learning_join_redemptions_link_idx
  ON learning_join_redemptions (workspace_id, program_id, link_id);

-- La richiesta di riapertura del turno e' l'unico campo che il partecipante
-- puo' cambiare su una riga esistente: tutto il resto e' immutabile.
CREATE OR REPLACE FUNCTION learning_preserve_redemption() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.id := OLD.id;
  NEW.workspace_id := OLD.workspace_id;
  NEW.program_id := OLD.program_id;
  NEW.link_id := OLD.link_id;
  NEW.user_id := OLD.user_id;
  NEW.enrollment_id := OLD.enrollment_id;
  NEW.email_snapshot := OLD.email_snapshot;
  NEW.created_at := OLD.created_at;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS learning_redemption_immutable ON learning_join_redemptions;
CREATE TRIGGER learning_redemption_immutable BEFORE UPDATE ON learning_join_redemptions
  FOR EACH ROW EXECUTE FUNCTION learning_preserve_redemption();
