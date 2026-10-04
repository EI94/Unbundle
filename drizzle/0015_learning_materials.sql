-- Materiali di un corso: la cartella degli esercizi da scaricare prima della
-- lezione, le slide da rileggere dopo, i documenti per i soli formatori.
--
-- I file stanno nel database e non sullo store Blob: lo store non è mai stato
-- configurato in produzione, e un materiale di corso è piccolo. Il tetto a
-- 4 MB tiene ogni download sotto il limite di 4,5 MB per risposta di una
-- funzione Vercel. Si servono solo dalla rotta autenticata, mai da un URL
-- pubblico: sono materiali interni del cliente.

CREATE TABLE IF NOT EXISTS learning_materials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL,
  program_id uuid NOT NULL,
  -- NULL = materiale dell'intero corso
  module_id text,
  title text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text CHECK (description IS NULL OR length(description) <= 2000),
  kind text NOT NULL CHECK (kind IN ('exercise_files', 'slides', 'document')),
  -- 'trainers': materiale di regia, mai visibile ai partecipanti
  audience text NOT NULL DEFAULT 'learners' CHECK (audience IN ('learners', 'trainers')),
  -- Da scaricare prima della lezione: la pagina lo mette in cima
  download_before boolean NOT NULL DEFAULT false,
  -- Disponibile ai partecipanti solo a lezione conclusa (es. slide che
  -- contengono le soluzioni degli esercizi)
  available_after_session boolean NOT NULL DEFAULT false,
  file_name text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  mime_type text NOT NULL CHECK (length(mime_type) BETWEEN 3 AND 200),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 4000000),
  sha256 text NOT NULL CHECK (length(sha256) = 64),
  content bytea NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT learning_materials_program FOREIGN KEY (workspace_id, program_id)
    REFERENCES learning_programs (workspace_id, id) ON DELETE CASCADE,
  CONSTRAINT learning_materials_size_matches CHECK (octet_length(content) = size_bytes)
);

CREATE INDEX IF NOT EXISTS learning_materials_program_idx
  ON learning_materials (workspace_id, program_id, sort_order);

-- Chi ha scaricato cosa: serve al formatore per sapere, prima di cominciare,
-- quante persone hanno già la cartella degli esercizi.
CREATE TABLE IF NOT EXISTS learning_material_downloads (
  material_id uuid NOT NULL REFERENCES learning_materials(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  first_downloaded_at timestamptz NOT NULL DEFAULT now(),
  last_downloaded_at timestamptz NOT NULL DEFAULT now(),
  download_count integer NOT NULL DEFAULT 1 CHECK (download_count >= 1),
  PRIMARY KEY (material_id, user_id)
);
