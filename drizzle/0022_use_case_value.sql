-- Area «Use case»: modello dei benefici e «Cosa serve».
--
-- Questa migrazione aggiunge:
--   - use_cases.value_model: il modello dei benefici della scheda (8 tipi di ritorno, voci a
--     ore, in euro o qualitative, costi, facilità, piano), NULL quando non c'è. Lo schema del
--     contenuto è uno solo, in src/lib/use-cases/value-model.ts; valore e costo si calcolano
--     in lettura (src/lib/use-cases/value-calc.ts) e non si salvano;
--   - un trigger separato che alza use_cases.version quando cambia value_model. La funzione
--     use_cases_bump_version della 0020 non cambia;
--   - le esigenze del workspace (use_case_needs: requisiti e prossimi passi) e i loro legami
--     con le schede (use_case_need_links). Le esigenze non si cancellano: si archiviano.
--
-- La 0021 è riservata. Scritta a mano, idempotente e solo additiva. Si applica con:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0022_use_case_value.sql
-- Gli stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-value-ddl.ts
-- per il self-heal (ensureDbSchema, dopo il DDL della 0020). Nessuna estensione viene creata.
--
-- Compatibile con il codice di oggi: la colonna nuova è nullable, le tabelle sono nuove. Le
-- ipotesi di calcolo del workspace non chiedono colonne: stanno in
-- workspace_scoring_models.config.valueParams.

-- 1. La colonna che il trigger del punto 3 scrive nasce con la 0020. PL/pgSQL non controlla i
--    campi di NEW e OLD quando crea la funzione: senza la 0020 la migrazione passerebbe e poi
--    ogni UPDATE di value_model fallirebbe. Nel self-heal non scatta mai: la 0020 viene prima.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'use_cases' AND column_name = 'version'
  ) THEN
    RAISE EXCEPTION 'use_cases: manca la 0020 (version). Applica prima drizzle/0020_use_case_hub.sql.';
  END IF;
END $$;

-- 2. Modello dei benefici della scheda; NULL = nessun modello (la scheda resta come oggi).
ALTER TABLE use_cases
  ADD COLUMN IF NOT EXISTS value_model jsonb
    CONSTRAINT use_cases_value_model_check CHECK (value_model IS NULL OR jsonb_typeof(value_model) = 'object');

-- 3. Versione: sale anche quando cambia il modello dei benefici. Trigger e funzione separati
--    da quelli della 0020. I trigger BEFORE UPDATE partono in ordine di nome: prima
--    use_cases_bump_version, poi questo. Una scrittura che cambia value_model e un'altra
--    colonna alza la versione di uno; chi scrive version a mano continua a non cambiarla.
CREATE OR REPLACE FUNCTION use_cases_value_model_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.value_model IS DISTINCT FROM OLD.value_model THEN
    NEW.version := OLD.version + 1;
  END IF;
  RETURN NEW;
END
$$;
CREATE OR REPLACE TRIGGER use_cases_value_model_version
  BEFORE UPDATE OF value_model ON use_cases
  FOR EACH ROW EXECUTE FUNCTION use_cases_value_model_version();

-- 4. Esigenze: requisiti (gli 8 stati delle voci dei dossier) e prossimi passi (proposta,
--    confermata, fatta). import_key è unica per workspace; più righe senza chiave sono
--    ammesse. Un motivo di archiviazione solo con la data di archiviazione.
CREATE TABLE IF NOT EXISTS use_case_needs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  type varchar(12) NOT NULL
    CONSTRAINT use_case_needs_type_check CHECK (type IN ('requisito', 'passo')),
  kind varchar(20) NOT NULL DEFAULT 'altro'
    CONSTRAINT use_case_needs_kind_check CHECK (kind IN ('accesso', 'dato', 'documento', 'regola', 'decisione', 'persona', 'contratto', 'altro')),
  title varchar(300) NOT NULL,
  detail varchar(4000),
  owner_label varchar(120),
  owner_side varchar(20)
    CONSTRAINT use_case_needs_owner_side_check CHECK (owner_side IS NULL OR owner_side IN ('cliente', 'lateral_space', 'fornitore', 'insieme')),
  status varchar(20) NOT NULL,
  availability varchar(12)
    CONSTRAINT use_case_needs_availability_check CHECK (availability IS NULL OR availability IN ('subito', 'dopo_a8')),
  due_on date,
  due_label varchar(80),
  due_is_proposal boolean NOT NULL DEFAULT false,
  for_label varchar(200),
  sort_order integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  import_key varchar(128),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz,
  archived_at timestamptz,
  archive_reason varchar(300),
  CONSTRAINT use_case_needs_status_check CHECK (
    (type = 'requisito' AND status IN ('da_chiedere', 'chiesta', 'mancante', 'parziale', 'in_verifica', 'validata', 'non_applicabile', 'bloccata'))
    OR (type = 'passo' AND status IN ('proposta', 'confermata', 'fatta'))
  ),
  CONSTRAINT use_case_needs_archive_check CHECK (archive_reason IS NULL OR archived_at IS NOT NULL),
  CONSTRAINT use_case_needs_import_key_unique UNIQUE (workspace_id, import_key)
);
CREATE INDEX IF NOT EXISTS use_case_needs_workspace_idx
  ON use_case_needs (workspace_id, type, sort_order);

-- Legami tra esigenze e schede: spariscono con l'una o con l'altra.
CREATE TABLE IF NOT EXISTS use_case_need_links (
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  CONSTRAINT use_case_need_links_pkey PRIMARY KEY (need_id, use_case_id)
);
CREATE INDEX IF NOT EXISTS use_case_need_links_use_case_idx
  ON use_case_need_links (use_case_id);
