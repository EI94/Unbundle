-- Area «Use case» (docs/use-case/DESIGN.md §10).
--
-- Un record per idea, qualunque sia il canale. Questa migrazione aggiunge:
--   - su use_cases: origine (dal basso o dall'alto), AI Lab, «Quando» (solo per
--     gli approvati), data di revisione (solo per i rimandati), valore e costo
--     del team (importo oppure fascia, mai entrambi), suggerimento dell'AI e un
--     contatore di versione per il controllo delle scritture concorrenti;
--   - la Storia senza testi (use_case_events), con un trigger che registra ogni
--     creazione, da qualunque canale, senza dire chi ha proposto;
--   - le richieste idempotenti del MCP del team (use_case_mcp_requests);
--   - il proprietario dei token personali (workspace_integration_tokens.owner_user_id);
--   - gli indici delle viste (nessun indice su proposed_by né su actor_user_id);
--   - se le tabelle dei Casi d'uso esistono, l'indice unico tra dossier e scheda.
--
-- Scritta a mano, idempotente e solo additiva. Si applica con:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0020_use_case_hub.sql
-- Gli stessi statement, nello stesso ordine, sono in src/lib/db/use-case-hub-ddl.ts
-- per il self-heal (ensureDbSchema), tranne l'ultimo blocco (indice unico dei
-- dossier, §10.4), che sta solo qui. Nessuna estensione viene creata.
--
-- Prima di applicarla a un database con i dossier: `use-case-admin dossier-dups`
-- deve mostrare zero doppioni. Altrimenti l'ultimo blocco si ferma e, con
-- --single-transaction, la migrazione intera non si applica.
--
-- Compatibile con il codice di oggi: ogni colonna nuova è nullable o ha un
-- default; status, portfolio_review_status, category e i 12 stati restano. I
-- nuovi valori di source (manual, team_mcp, activity_mapping) non cambiano lo
-- schema. Le fasce del costo di un workspace (D15) non chiedono colonne: stanno
-- in workspace_scoring_models.config.costBands; cost_band resta l'indice 1-5.

-- 0. Le colonne che il trigger della versione (punto 2) legge. PL/pgSQL non
--    controlla i campi di NEW e OLD quando crea la funzione: con una colonna
--    mancante la migrazione passerebbe e poi ogni UPDATE di use_cases fallirebbe.
--    a) intake e public_note nascono con la 0019: senza, la 0020 si ferma qui.
--       Nel self-heal non scatta mai: il DDL del connettore viene prima.
DO $$ BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'use_cases' AND column_name IN ('intake', 'public_note')
  ) < 2 THEN
    RAISE EXCEPTION 'use_cases: manca la 0019 (intake, public_note). Applica prima drizzle/0019_connettore_mcp.sql.';
  END IF;
END $$;
--    b) sustainability_impact: le migrazioni 0000-0019 non la creano, la aggiunge
--       il self-heal di oggi (ensure-schema.ts), quindi nei database dell'app c'è già.
ALTER TABLE use_cases ADD COLUMN IF NOT EXISTS sustainability_impact text;

-- 1. use_cases: origine, AI Lab, Quando, revisione, valore e costo del team,
--    suggerimento AI, versione. target_quarter come 2027-Q1 (NULL = «Più avanti»).
ALTER TABLE use_cases
  ADD COLUMN IF NOT EXISTS origin varchar(20) NOT NULL DEFAULT 'adoption'
    CONSTRAINT use_cases_origin_check CHECK (origin IN ('adoption', 'transformation')),
  ADD COLUMN IF NOT EXISTS ai_lab varchar(120),
  ADD COLUMN IF NOT EXISTS target_quarter varchar(7)
    CONSTRAINT use_cases_target_quarter_check CHECK (target_quarter IS NULL OR target_quarter ~ '^[0-9]{4}-Q[1-4]$'),
  ADD COLUMN IF NOT EXISTS review_by date,
  ADD COLUMN IF NOT EXISTS value_eur_year integer
    CONSTRAINT use_cases_value_eur_year_check CHECK (value_eur_year IS NULL OR value_eur_year BETWEEN 0 AND 1000000000),
  ADD COLUMN IF NOT EXISTS cost_eur_once integer
    CONSTRAINT use_cases_cost_eur_once_check CHECK (cost_eur_once IS NULL OR cost_eur_once BETWEEN 0 AND 100000000),
  ADD COLUMN IF NOT EXISTS cost_band smallint
    CONSTRAINT use_cases_cost_band_check CHECK (cost_band IS NULL OR cost_band BETWEEN 1 AND 5),
  ADD COLUMN IF NOT EXISTS ai_suggestion jsonb
    CONSTRAINT use_cases_ai_suggestion_check CHECK (ai_suggestion IS NULL OR jsonb_typeof(ai_suggestion) = 'object'),
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;

-- Importo e fascia non insieme (DO per l'idempotenza del vincolo di tabella).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.use_cases'::regclass AND conname = 'use_cases_cost_one_source_check'
  ) THEN
    ALTER TABLE use_cases ADD CONSTRAINT use_cases_cost_one_source_check
      CHECK (cost_eur_once IS NULL OR cost_band IS NULL);
  END IF;
END $$;

-- 2. Versione: sale solo quando cambia una colonna che una persona modifica, da
--    qualunque percorso. Non sale per ai_suggestion, overall_*, category, code,
--    updated_at, status_changed_at: l'AI, l'assegnazione del codice e i ricalcoli
--    non creano conflitti finti. Chi scrive version a mano non la cambia.
CREATE OR REPLACE FUNCTION use_cases_bump_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.title, NEW.description, NEW.flow_description, NEW.human_in_the_loop, NEW.guardrails,
         NEW.business_case, NEW.data_requirements, NEW.sustainability_impact, NEW.origin, NEW.portfolio_kind,
         NEW.ai_lab, NEW.intake, NEW.public_note, NEW.custom_scores, NEW.value_eur_year,
         NEW.cost_eur_once, NEW.cost_band, NEW.status, NEW.portfolio_review_status, NEW.target_quarter,
         NEW.review_by)
     IS DISTINCT FROM
     ROW(OLD.title, OLD.description, OLD.flow_description, OLD.human_in_the_loop, OLD.guardrails,
         OLD.business_case, OLD.data_requirements, OLD.sustainability_impact, OLD.origin, OLD.portfolio_kind,
         OLD.ai_lab, OLD.intake, OLD.public_note, OLD.custom_scores, OLD.value_eur_year,
         OLD.cost_eur_once, OLD.cost_band, OLD.status, OLD.portfolio_review_status, OLD.target_quarter,
         OLD.review_by) THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END
$$;
CREATE OR REPLACE TRIGGER use_cases_bump_version
  BEFORE UPDATE ON use_cases
  FOR EACH ROW EXECUTE FUNCTION use_cases_bump_version();

-- 3. Storia (§10.3): nessuna colonna di testo libero. fields è un elenco chiuso
--    (il CHECK impedisce di salvare un valore); phase_before e phase_after sono
--    codici (es. da_valutare.nuova). actor_user_id solo per le azioni di persone
--    del team, nessun indice su di esso: niente viste aggregate per persona.
CREATE TABLE IF NOT EXISTS use_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_kind varchar(12) NOT NULL
    CONSTRAINT use_case_events_actor_kind_check CHECK (actor_kind IN ('persona', 'proponente', 'sistema', 'ai')),
  channel varchar(20) NOT NULL
    CONSTRAINT use_case_events_channel_check CHECK (channel IN ('pagina', 'mcp_team', 'connettore', 'rest', 'slack', 'web', 'corsi', 'ai_readiness', 'activity_mapping', 'script', 'ai', 'altro')),
  action varchar(30) NOT NULL
    CONSTRAINT use_case_events_action_check CHECK (action IN ('creato', 'modificato', 'valutato', 'suggerimento_ai', 'decisione', 'quando', 'visibilita', 'oscurato', 'realizzazione_avviata')),
  fields text[] NOT NULL DEFAULT '{}'
    CONSTRAINT use_case_events_fields_check CHECK (fields <@ ARRAY['titolo', 'problema', 'come_funziona', 'chi_controlla', 'limiti', 'impatto_atteso', 'dati', 'area', 'ai_lab', 'origine', 'tipo', 'nota_pubblica', 'valore', 'costo', 'kpi', 'quando', 'revisione', 'visibilita', 'possibile_doppione', 'intake']::text[]),
  phase_before varchar(40),
  phase_after varchar(40),
  CONSTRAINT use_case_events_actor_check CHECK (actor_user_id IS NULL OR actor_kind = 'persona')
);
CREATE INDEX IF NOT EXISTS use_case_events_use_case_idx
  ON use_case_events (use_case_id, at DESC);

-- Trigger di creazione: una riga «creato» per ogni nuovo use case, con il canale
-- dedotto da source, actor_kind «proponente» («sistema» per Activity mapping) e
-- actor_user_id NULL: la Storia non registra chi propone. Copre tutti i canali
-- senza toccare il loro codice. Le altre righe le scrive solo il servizio.
CREATE OR REPLACE FUNCTION use_cases_created_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO use_case_events (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action)
  VALUES (
    NEW.workspace_id,
    NEW.id,
    NULL,
    CASE WHEN coalesce(NEW.source, 'activity_mapping') = 'activity_mapping' THEN 'sistema' ELSE 'proponente' END,
    CASE coalesce(NEW.source, 'activity_mapping')
      WHEN 'web_proposed' THEN 'web'
      WHEN 'slack_proposed' THEN 'slack'
      WHEN 'claude_mcp' THEN 'rest'
      WHEN 'claude_connector' THEN 'connettore'
      WHEN 'learning' THEN 'corsi'
      WHEN 'ai_readiness_assessment' THEN 'ai_readiness'
      WHEN 'activity_mapping' THEN 'activity_mapping'
      WHEN 'manual' THEN 'pagina'
      WHEN 'team_mcp' THEN 'mcp_team'
      ELSE 'altro'
    END,
    'creato'
  );
  RETURN NULL;
END
$$;
CREATE OR REPLACE TRIGGER use_cases_created_event
  AFTER INSERT ON use_cases
  FOR EACH ROW EXECUTE FUNCTION use_cases_created_event();

-- 4. Richieste idempotenti del MCP del team. result: solo id, codici e versioni.
--    reserved_ids (create_use_cases): id decisi alla presa in carico e riusati a
--    ogni ripresa, così un nuovo tentativo non crea doppioni.
CREATE TABLE IF NOT EXISTS use_case_mcp_requests (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  principal_key varchar(80) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  tool varchar(40) NOT NULL,
  request_hash varchar(128) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CONSTRAINT use_case_mcp_requests_status_check CHECK (status IN ('pending', 'completed', 'failed')),
  result jsonb,
  reserved_ids uuid[],
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_mcp_requests_pkey PRIMARY KEY (workspace_id, principal_key, idempotency_key)
);

-- 5. Token personali del MCP del team: valgono quanto la persona che li possiede
--    e spariscono con lei. I token di workspace di oggi restano senza proprietario.
ALTER TABLE workspace_integration_tokens
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS workspace_integration_tokens_owner_idx
  ON workspace_integration_tokens (owner_user_id) WHERE owner_user_id IS NOT NULL;

-- 6. Indici per le viste. Nessun indice su proposed_by.
CREATE INDEX IF NOT EXISTS use_cases_workspace_origin_idx
  ON use_cases (workspace_id, origin);
CREATE INDEX IF NOT EXISTS use_cases_workspace_quarter_idx
  ON use_cases (workspace_id, target_quarter) WHERE target_quarter IS NOT NULL;
CREATE INDEX IF NOT EXISTS use_cases_workspace_review_by_idx
  ON use_cases (workspace_id, review_by) WHERE review_by IS NOT NULL;
CREATE INDEX IF NOT EXISTS use_cases_workspace_ai_lab_idx
  ON use_cases (workspace_id, ai_lab) WHERE ai_lab IS NOT NULL;

-- 7. Dossier: indice unico tra dossier e scheda (§10.4), solo se le tabelle uc
--    esistono. Il vecchio indice uc_cases_portfolio_use_case_idx non è unico e,
--    con lo stesso nome, IF NOT EXISTS non lo cambierebbe: serve un nome nuovo.
--    Conta ogni riga con portfolio_use_case_id, completa o no: una creazione
--    fallita può lasciare una riga incompleta, ed è un doppione anche lei.
--    Il vecchio indice resta (si toglie nella pulizia).
DO $$ BEGIN
  IF to_regclass('public.uc_cases') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM uc_cases
       WHERE portfolio_use_case_id IS NOT NULL
       GROUP BY portfolio_use_case_id
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'uc_cases: piu dossier sulla stessa scheda. Esegui use-case-admin dossier-dups prima della 0020.';
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS uc_cases_portfolio_use_case_unique_idx
      ON uc_cases (portfolio_use_case_id) WHERE portfolio_use_case_id IS NOT NULL;
  END IF;
END $$;
