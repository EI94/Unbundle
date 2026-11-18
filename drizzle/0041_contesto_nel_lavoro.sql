-- Rilascio 9b «Contesto nel lavoro» (docs/contesto/RILASCIO-9b-COSTRUZIONE.md §3).
-- Il contesto entra nel lavoro: le risposte del referente come fonte, le richieste di «Cosa serve» a cui risponde una
-- call, la CLI come porta, due avvisi nuovi in campanella.
--
-- Questa migrazione:
--   - allarga con lo stesso nome tre CHECK della 0038: context_sources.kind (+ risposta),
--     context_sources.origin (+ rispondi), context_events.channel (+ cli, rispondi);
--   - crea context_need_links: un fatto che risponde a una richiesta di «Cosa serve»;
--   - aggiunge l'indice dei fatti da verificare;
--   - allarga use_case_notifications_kind_check con contesto_nuovo e dalla_call (sotto il lock della 0025).
-- Nessuna tabella tolta, nessuna colonna cambiata, nessun CHECK più stretto: il codice di prima ignora i valori e la
-- tabella nuovi. Scritta a mano, idempotente. In produzione la applica il self-heal al primo avvio dopo il deploy: gli
-- stessi statement, nello stesso ordine, sono in src/lib/db/context-work-ddl.ts (ensureDbSchema, dopo la 0040,
-- ENSURE_VERSION 35). Solo come strada di riserva, a mano:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0041_contesto_nel_lavoro.sql

SELECT set_config('lock_timeout', '3s', true);
SELECT pg_advisory_xact_lock(hashtext('unbundle:context-work-ddl'));

DO $$ BEGIN
  IF to_regclass('public.context_sources') IS NULL OR to_regclass('public.use_case_needs') IS NULL THEN
    RAISE EXCEPTION 'contesto nel lavoro: manca la 0038. Applica prima drizzle/0038_contesto.sql.';
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'context_sources_kind_check' AND conrelid = 'public.context_sources'::regclass
                 AND position('''risposta''' IN pg_get_constraintdef(oid)) > 0) THEN
    ALTER TABLE context_sources DROP CONSTRAINT IF EXISTS context_sources_kind_check;
    ALTER TABLE context_sources ADD CONSTRAINT context_sources_kind_check CHECK (kind IN ('appunti', 'trascrizione', 'documento', 'risposta'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'context_sources_origin_check' AND conrelid = 'public.context_sources'::regclass
                 AND position('''rispondi''' IN pg_get_constraintdef(oid)) > 0) THEN
    ALTER TABLE context_sources DROP CONSTRAINT IF EXISTS context_sources_origin_check;
    ALTER TABLE context_sources ADD CONSTRAINT context_sources_origin_check CHECK (origin IN ('web', 'granola', 'claude', 'cli', 'rispondi'));
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'context_events_channel_check' AND conrelid = 'public.context_events'::regclass
                 AND position('''cli''' IN pg_get_constraintdef(oid)) > 0 AND position('''rispondi''' IN pg_get_constraintdef(oid)) > 0) THEN
    ALTER TABLE context_events DROP CONSTRAINT IF EXISTS context_events_channel_check;
    ALTER TABLE context_events ADD CONSTRAINT context_events_channel_check CHECK (channel IN ('web', 'claude', 'granola', 'cron', 'cli', 'rispondi'));
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS context_need_links (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  need_id uuid NOT NULL REFERENCES use_case_needs(id) ON DELETE CASCADE,
  proposal_id uuid REFERENCES context_proposals(id) ON DELETE SET NULL,
  fact_id uuid REFERENCES context_facts(id) ON DELETE CASCADE,
  status varchar(9) NOT NULL DEFAULT 'proposta' CONSTRAINT context_need_links_status_check CHECK (status IN ('proposta', 'aperta', 'usata', 'scartata')),
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT context_need_links_pkey PRIMARY KEY (id),
  CONSTRAINT context_need_links_fact_check CHECK (status IN ('proposta', 'scartata') OR fact_id IS NOT NULL),
  CONSTRAINT context_need_links_decided_check CHECK ((status IN ('usata', 'scartata')) = (decided_at IS NOT NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS context_need_links_proposal_unique ON context_need_links (proposal_id) WHERE proposal_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS context_need_links_fact_unique ON context_need_links (need_id, fact_id) WHERE fact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS context_need_links_open_idx ON context_need_links (workspace_id, need_id) WHERE status = 'aperta';

CREATE INDEX IF NOT EXISTS context_facts_to_check_idx ON context_facts (workspace_id) WHERE needs_check AND status = 'attivo';

SELECT pg_advisory_xact_lock(hashtext('unbundle:use-case-alerts-ddl'));

DO $$
DECLARE
  wanted text[] := ARRAY['risposte', 'documenti', 'senza_risposta', 'complete', 'pronto', 'fornitori', 'domanda', 'da_rivedere', 'progetto_appr', 'strumento_nuovo', 'pacchetto_nuovo', 'progetto_ok', 'modifica_chiesta', 'ok_decaduto', 'domanda_agente', 'compito_chiesto', 'compito_passato', 'compito_fermo', 'compiti_pronti', 'pr_da_rivedere', 'compito_proposto', 'banco_consiglio', 'evals_in_calo', 'contesto_nuovo', 'dalla_call']::text[];
  current_def text;
  current_valid boolean;
  allowed text[];
BEGIN
  -- Mai in coda dietro una transazione lunga: ogni lock aspetta al massimo 3s, poi ci si ferma.
  PERFORM set_config('lock_timeout', '3s', true);
  SELECT pg_get_constraintdef(c.oid), c.convalidated INTO current_def, current_valid
    FROM pg_constraint c
   WHERE c.conrelid = 'public.use_case_notifications'::regclass AND c.conname = 'use_case_notifications_kind_check';
  -- Mai restringere: ai tipi voluti seguono quelli che il vincolo di adesso ammette già.
  allowed := wanted || coalesce((
    SELECT array_agg(found.name ORDER BY found.first_at)
      FROM (SELECT r.m[1] AS name, min(r.n) AS first_at
              FROM regexp_matches(coalesce(current_def, ''), '''([a-z0-9_]+)''::', 'g') WITH ORDINALITY AS r(m, n)
             GROUP BY r.m[1]) AS found
     WHERE found.name <> ALL (wanted)
  ), '{}'::text[]);
  IF current_def IS NULL
     OR EXISTS (SELECT 1 FROM unnest(wanted) AS w(name) WHERE position(quote_literal(w.name) || '::' IN current_def) = 0) THEN
    ALTER TABLE use_case_notifications DROP CONSTRAINT IF EXISTS use_case_notifications_kind_check;
    EXECUTE 'ALTER TABLE use_case_notifications ADD CONSTRAINT use_case_notifications_kind_check CHECK (kind IN ('
      || (SELECT string_agg(quote_literal(a.name), ', ' ORDER BY a.n) FROM unnest(allowed) WITH ORDINALITY AS a(name, n))
      || ')) NOT VALID';
    current_valid := false;
  END IF;
  IF NOT current_valid THEN
    IF EXISTS (SELECT 1 FROM use_case_notifications n WHERE NOT (n.kind = ANY (allowed))) THEN
      RAISE WARNING 'use_case_notifications: righe con tipi fuori elenco, use_case_notifications_kind_check resta NOT VALID (vale per le righe nuove).';
    ELSE
      ALTER TABLE use_case_notifications VALIDATE CONSTRAINT use_case_notifications_kind_check;
    END IF;
  END IF;
END $$;
