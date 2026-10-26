-- Area «Use case»: «Cosa serve» nella Storia degli use case.
--
-- Questa migrazione allarga il CHECK use_case_events_fields_check della 0020 (l'elenco chiuso
-- dei nomi dei campi della Storia) con 'cosa_serve': le scritture delle esigenze della 0022
-- (aggiungere, modificare, collegare, scollegare, archiviare) lasciano una riga nella Storia di
-- ogni use case collegato. La riga non porta testi: azione 'modificato', campo 'cosa_serve' e,
-- in phase_before e phase_after, codici di tipo e stato dell'esigenza
-- (src/lib/use-cases/needs-history.ts).
--
-- La 0021 è riservata. Scritta a mano e idempotente; non cambia né cancella righe. Si applica con:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0023_use_case_needs_history.sql
-- Lo stesso statement è in src/lib/db/use-case-hub-history-ddl.ts per il self-heal
-- (ensureDbSchema, dopo il DDL della 0020 e della 0022). Nessuna estensione viene creata.
--
-- Un solo blocco DO:
--   0. lock_timeout di 3s per il resto della transazione (set_config locale, come SET LOCAL) e poi
--      l'advisory lock del self-heal (hashtext('unbundle:use-case-history-ddl')), così file e
--      self-heal non sostituiscono il CHECK insieme. DROP e ADD CONSTRAINT prendono un ACCESS
--      EXCLUSIVE su use_case_events fino alla fine della transazione, VALIDATE compreso: dietro
--      una transazione lunga metterebbero in coda ogni lettura e scrittura della Storia (anche il
--      trigger «creato» di un nuovo use case). Con il timeout, dopo 3s di attesa di un lock la
--      migrazione si ferma con «canceling statement due to lock timeout» e non cambia nulla: si
--      rilancia; il self-heal riprova al prossimo avvio;
--   1. senza use_case_events (manca la 0020) si ferma con il suo messaggio;
--   2. se il vincolo ammette già ogni nome dell'elenco non lo tocca: una seconda applicazione, o
--      una migrazione futura che lo allarga ancora, restano come sono. Non si restringe mai;
--   3. altrimenti lo sostituisce (DROP CONSTRAINT IF EXISTS, ADD CONSTRAINT ... NOT VALID) con
--      l'elenco più i nomi che il vincolo di prima ammetteva già;
--   4. poi VALIDATE CONSTRAINT, solo se nessuna riga esce dall'elenco. Le righe di oggi stanno
--      tutte nell'elenco della 0020, che è dentro questo; una riga fuori elenco (solo se qualcuno
--      ha tolto il vincolo a mano) non ferma la migrazione: il vincolo resta NOT VALID, vale per
--      ogni riga nuova o modificata, e un WARNING lo dice. NOT VALID serve a questo, non ad
--      accorciare il lock: nella stessa transazione l'ACCESS EXCLUSIVE di DROP e ADD resta.
--
-- Compatibile con il codice di oggi: l'elenco si allarga soltanto, ogni scrittura di prima passa.

DO $$
DECLARE
  wanted text[] := ARRAY['titolo', 'problema', 'come_funziona', 'chi_controlla', 'limiti', 'impatto_atteso', 'dati', 'area', 'ai_lab', 'origine', 'tipo', 'nota_pubblica', 'valore', 'costo', 'kpi', 'quando', 'revisione', 'visibilita', 'possibile_doppione', 'intake', 'cosa_serve']::text[];
  current_def text;
  current_valid boolean;
  allowed text[];
BEGIN
  -- Mai in coda dietro una transazione lunga: ogni lock aspetta al massimo 3s, poi ci si ferma.
  PERFORM set_config('lock_timeout', '3s', true);
  -- Lo stesso advisory lock del self-heal: file e self-heal uno alla volta.
  PERFORM pg_advisory_xact_lock(hashtext('unbundle:use-case-history-ddl'));
  IF to_regclass('public.use_case_events') IS NULL THEN
    RAISE EXCEPTION 'use_case_events: manca la 0020. Applica prima drizzle/0020_use_case_hub.sql.';
  END IF;
  SELECT pg_get_constraintdef(c.oid), c.convalidated INTO current_def, current_valid
    FROM pg_constraint c
   WHERE c.conrelid = 'public.use_case_events'::regclass AND c.conname = 'use_case_events_fields_check';
  -- Mai restringere: ai nomi voluti seguono quelli che il vincolo di adesso ammette già.
  allowed := wanted || coalesce((
    SELECT array_agg(found.name ORDER BY found.first_at)
      FROM (SELECT r.m[1] AS name, min(r.n) AS first_at
              FROM regexp_matches(coalesce(current_def, ''), '''([a-z0-9_]+)''::text', 'g') WITH ORDINALITY AS r(m, n)
             GROUP BY r.m[1]) AS found
     WHERE found.name <> ALL (wanted)
  ), '{}'::text[]);
  IF current_def IS NULL
     OR EXISTS (SELECT 1 FROM unnest(wanted) AS w(name) WHERE position(quote_literal(w.name) || '::text' IN current_def) = 0) THEN
    ALTER TABLE use_case_events DROP CONSTRAINT IF EXISTS use_case_events_fields_check;
    EXECUTE 'ALTER TABLE use_case_events ADD CONSTRAINT use_case_events_fields_check CHECK (fields <@ ARRAY['
      || (SELECT string_agg(quote_literal(a.name), ', ' ORDER BY a.n) FROM unnest(allowed) WITH ORDINALITY AS a(name, n))
      || ']::text[]) NOT VALID';
    current_valid := false;
  END IF;
  IF NOT current_valid THEN
    IF EXISTS (SELECT 1 FROM use_case_events e WHERE NOT (e.fields <@ allowed)) THEN
      RAISE WARNING 'use_case_events: righe con campi fuori elenco, use_case_events_fields_check resta NOT VALID (vale per le righe nuove).';
    ELSE
      ALTER TABLE use_case_events VALIDATE CONSTRAINT use_case_events_fields_check;
    END IF;
  END IF;
END $$;
