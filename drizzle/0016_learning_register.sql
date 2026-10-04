-- Registro della formazione in materia di IA (Reg. UE 2024/1689, art. 4).
--
-- Il registro non è una tabella da tenere aggiornata a mano: si ricava dai
-- fatti che la piattaforma già registra (turni, iscrizioni, ingressi dal link,
-- consegne, materiali con impronta, versione del contenuto). Così non può
-- divergere da ciò che è successo. Queste tabelle aggiungono solo ciò che la
-- piattaforma non può sapere da sola.

-- Dati dell'azienda che solo l'azienda conosce, e che un controllo chiede.
CREATE TABLE IF NOT EXISTS learning_register_settings (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  organization_legal_name text CHECK (organization_legal_name IS NULL OR length(organization_legal_name) <= 300),
  register_owner text CHECK (register_owner IS NULL OR length(register_owner) <= 300),
  -- Ruolo ai sensi dell'AI Act, dichiarato dall'azienda: non lo stabilisce chi forma.
  ai_act_role text CHECK (ai_act_role IS NULL OR ai_act_role IN ('deployer', 'provider', 'both')),
  ai_systems text[] NOT NULL DEFAULT '{}',
  -- L'art. 4 chiede misure che tengano conto del contesto d'uso e delle
  -- persone su cui i sistemi incidono: lo scrive l'azienda.
  use_context text CHECK (use_context IS NULL OR length(use_context) <= 4000),
  -- Chi ha tenuto la formazione e con quale qualifica.
  trainers text CHECK (trainers IS NULL OR length(trainers) <= 2000),
  -- Un corso può servire più società dello stesso gruppo: ognuna, riconosciuta
  -- dal dominio email dei partecipanti, ha la propria ragione sociale e il
  -- proprio registro. {"topjet.aero": "TopJet S.r.l."}
  company_names jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(company_names) = 'object'),
  other_initiatives text CHECK (other_initiatives IS NULL OR length(other_initiatives) <= 4000),
  updated_by uuid REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Presenze registrate dal formatore per chi ha partecipato senza usare la
-- piattaforma (telefono scarico, nessun account). Non si modificano: si
-- annullano, una volta, con il motivo. Così il registro mostra anche le
-- correzioni invece di nasconderle.
CREATE TABLE IF NOT EXISTS learning_register_manual_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  program_id uuid NOT NULL,
  module_id text NOT NULL,
  cohort_id text NOT NULL,
  person_name text NOT NULL CHECK (length(person_name) BETWEEN 2 AND 200),
  person_email text CHECK (person_email IS NULL OR length(person_email) <= 254),
  note text CHECK (note IS NULL OR length(note) <= 1000),
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz,
  voided_by uuid REFERENCES users(id),
  void_reason text CHECK (void_reason IS NULL OR length(void_reason) BETWEEN 3 AND 500),
  CONSTRAINT learning_register_manual_session FOREIGN KEY (workspace_id, program_id, module_id, cohort_id)
    REFERENCES learning_sessions (workspace_id, program_id, module_id, cohort_id) ON DELETE CASCADE,
  CONSTRAINT learning_register_manual_void_complete CHECK (
    (voided_at IS NULL AND voided_by IS NULL AND void_reason IS NULL)
    OR (voided_at IS NOT NULL AND voided_by IS NOT NULL AND void_reason IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS learning_register_manual_program_idx
  ON learning_register_manual_entries (workspace_id, program_id);

CREATE OR REPLACE FUNCTION learning_register_manual_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.voided_at IS NOT NULL THEN
    RAISE EXCEPTION 'presenza già annullata: non si modifica';
  END IF;
  -- L'unica modifica ammessa è l'annullamento: tutto il resto resta com'era.
  NEW.id := OLD.id; NEW.workspace_id := OLD.workspace_id; NEW.program_id := OLD.program_id;
  NEW.module_id := OLD.module_id; NEW.cohort_id := OLD.cohort_id; NEW.person_name := OLD.person_name;
  NEW.person_email := OLD.person_email; NEW.note := OLD.note; NEW.recorded_by := OLD.recorded_by;
  NEW.recorded_at := OLD.recorded_at;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS learning_register_manual_immutable ON learning_register_manual_entries;
CREATE TRIGGER learning_register_manual_immutable BEFORE UPDATE ON learning_register_manual_entries
  FOR EACH ROW EXECUTE FUNCTION learning_register_manual_append_only();

-- Ogni esportazione lascia la propria impronta SHA-256. Un file mostrato a un
-- ispettore si può confrontare con questo elenco: se l'impronta coincide, il
-- file è esattamente quello prodotto dalla piattaforma in quel momento.
CREATE TABLE IF NOT EXISTS learning_register_exports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  format text NOT NULL CHECK (format IN ('pdf', 'xlsx')),
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  size_bytes integer NOT NULL CHECK (size_bytes > 0),
  participant_count integer NOT NULL CHECK (participant_count >= 0),
  -- Copia di una sola società (dominio email), oppure di tutto il workspace.
  company_domain text CHECK (company_domain IS NULL OR company_domain ~ '^[a-z0-9.-]+\.[a-z]{2,}$'),
  generated_by uuid NOT NULL REFERENCES users(id),
  generated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS learning_register_exports_workspace_idx
  ON learning_register_exports (workspace_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS learning_register_exports_sha_idx
  ON learning_register_exports (sha256);

CREATE OR REPLACE FUNCTION learning_register_exports_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'il registro delle esportazioni non si modifica';
END $$;

DROP TRIGGER IF EXISTS learning_register_exports_immutable ON learning_register_exports;
CREATE TRIGGER learning_register_exports_immutable BEFORE UPDATE ON learning_register_exports
  FOR EACH ROW EXECUTE FUNCTION learning_register_exports_frozen();

-- Aggiunta dopo la prima applicazione: idempotente.
ALTER TABLE learning_register_settings ADD COLUMN IF NOT EXISTS ai_act_role text
  CHECK (ai_act_role IS NULL OR ai_act_role IN ('deployer', 'provider', 'both'));
