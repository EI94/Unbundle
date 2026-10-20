-- Connettore MCP organizzativo «Unbundle» (docs/connettore/README.md).
--
-- Le persone di un'organizzazione propongono casi d'uso AI e best practice
-- dialogando con Claude; il connettore li salva nel portafoglio del workspace
-- con un codice leggibile (es. TJ-0012). Questa migrazione aggiunge:
--   - le identità di fase 2 (OAuth), vuote in fase 1;
--   - la configurazione del connettore per workspace (interruttore, prefisso e
--     contatore dei codici, guida, domini e origini ammessi, limiti) e i
--     contatori del limite di richieste in Postgres;
--   - su use_cases: codice, dati raccolti da Claude (intake), nota pubblica,
--     data dell'ultimo cambio di stato, identità di chi propone (fase 2);
--   - l'idempotenza per principal (token:<id> oggi, user:<id> in fase 2).
--
-- Scritta a mano e idempotente. Si applica con:
--   psql --no-psqlrc --single-transaction --set=ON_ERROR_STOP=1 -f drizzle/0019_connettore_mcp.sql
-- Gli stessi statement, nello stesso ordine, sono in src/lib/db/connector-ddl.ts
-- per il self-heal (ensureDbSchema). L'unica estensione è unaccent (punto 9, in coda).
--
-- Compatibile con il codice precedente (expand/contract): principal_key diventa
-- NOT NULL, ma un trigger BEFORE INSERT, creato prima del vincolo, la riempie da
-- integration_token_id quando chi inserisce non la valorizza. Il codice
-- precedente alla 0019 continua quindi a salvare gli invii anche dopo la
-- migrazione (o dopo il self-heal di un'anteprima che usa lo stesso database).

-- 1. Identità del connettore per la fase 2 (login Microsoft, claim oid). Solo MCP:
--    nessun legame con workspace_memberships, nessun accesso alla dashboard.
CREATE TABLE IF NOT EXISTS connector_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider varchar(40) NOT NULL,
  subject varchar(255) NOT NULL,
  email varchar(255),
  display_name varchar(255),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz,
  disabled_at timestamptz,
  CONSTRAINT connector_identities_workspace_provider_subject_key UNIQUE (workspace_id, provider, subject)
);

-- 2. Configurazione del connettore, una riga per workspace. enabled = false
--    sospende tutti i tool. allowed_domains sono domini EMAIL per il login di
--    fase 2; allowed_origins sono gli header Origin HTTP ammessi: due elenchi
--    distinti. limits: 200 invii e 3.000 letture l'ora per organizzazione,
--    1.000 invii al giorno per workspace; 10 invii l'ora per persona in fase 2.
CREATE TABLE IF NOT EXISTS workspace_connector_configs (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  slug varchar(40) NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  code_prefix varchar(4) NOT NULL,
  next_code_seq integer NOT NULL DEFAULT 0,
  identity_mode varchar(20) NOT NULL DEFAULT 'dichiarata',
  auth_mode varchar(20) NOT NULL DEFAULT 'header',
  workspace_display_name varchar(120),
  guide jsonb,
  guide_version varchar(20),
  allowed_domains jsonb NOT NULL DEFAULT '[]'::jsonb,
  allowed_origins jsonb NOT NULL DEFAULT '[]'::jsonb,
  limits jsonb NOT NULL DEFAULT '{"submitsPerHour": 200, "readsPerHour": 3000, "submitsPerDayWorkspace": 1000, "submitsPerHourPerUser": 10}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT workspace_connector_configs_slug_key UNIQUE (slug),
  CONSTRAINT workspace_connector_configs_slug_check CHECK (slug ~ '^[a-z0-9-]{3,40}$'),
  CONSTRAINT workspace_connector_configs_code_prefix_check CHECK (code_prefix ~ '^[A-Z]{2,4}$'),
  CONSTRAINT workspace_connector_configs_next_code_seq_check CHECK (next_code_seq >= 0),
  CONSTRAINT workspace_connector_configs_identity_mode_check CHECK (identity_mode IN ('dichiarata', 'verificata')),
  CONSTRAINT workspace_connector_configs_auth_mode_check CHECK (auth_mode IN ('header', 'oauth')),
  CONSTRAINT workspace_connector_configs_guide_check CHECK (guide IS NULL OR jsonb_typeof(guide) = 'object'),
  CONSTRAINT workspace_connector_configs_allowed_domains_check CHECK (jsonb_typeof(allowed_domains) = 'array'),
  CONSTRAINT workspace_connector_configs_allowed_origins_check CHECK (jsonb_typeof(allowed_origins) = 'array'),
  CONSTRAINT workspace_connector_configs_limits_check CHECK (jsonb_typeof(limits) = 'object')
);

-- Limite di richieste in Postgres, come uc_rate_limits: una riga per secchio e
-- finestra. Le finestre vecchie si cancellano a campione durante le scritture.
CREATE TABLE IF NOT EXISTS connector_rate_limits (
  bucket varchar(120) NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  CONSTRAINT connector_rate_limits_pkey PRIMARY KEY (bucket, window_start)
);

-- 3. use_cases. code: prefisso, trattino, numero (TJ-0012; oltre 9999 il numero
--    resta intero), unico per workspace. intake: campi raccolti da Claude.
--    public_note: visibile tramite Claude a chi conosce il codice (max 1.000
--    caratteri); review_notes resta interna. status_changed_at: ultimo cambio di
--    status o portfolio_review_status (trigger più sotto). submitted_by_user_id:
--    identità verificata di fase 2.
ALTER TABLE use_cases
  ADD COLUMN IF NOT EXISTS code varchar(20) CONSTRAINT use_cases_code_check CHECK (code IS NULL OR code ~ '^[A-Z]{2,4}-[0-9]{4,5}$'),
  ADD COLUMN IF NOT EXISTS intake jsonb CONSTRAINT use_cases_intake_check CHECK (intake IS NULL OR jsonb_typeof(intake) = 'object'),
  ADD COLUMN IF NOT EXISTS public_note text CONSTRAINT use_cases_public_note_check CHECK (public_note IS NULL OR char_length(public_note) <= 1000),
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid REFERENCES connector_identities(id) ON DELETE SET NULL;

-- Backfill con la data migliore disponibile: invio, poi creazione (mai
-- updated_at, che cambia anche per le modifiche di testo). Le colonne
-- timestamp senza fuso dell'app sono in UTC. Le righe nuove prendono now().
UPDATE use_cases
   SET status_changed_at = COALESCE(submitted_at, created_at) AT TIME ZONE 'UTC'
 WHERE status_changed_at IS NULL;
ALTER TABLE use_cases ALTER COLUMN status_changed_at SET DEFAULT now();

-- 4. Idempotenza per principal: token:<id> in fase 1, user:<id> in fase 2 (senza
--    token di workspace). Il vecchio indice unico con integration_token_id resta.
--    reserved_use_case_id: id della segnalazione deciso alla prima presa in
--    carico e riusato da ogni ripresa, così un nuovo tentativo ritrova la
--    segnalazione già creata invece di crearne una seconda. Il codice nuovo lo
--    scrive sempre; NULL (righe esistenti, o scritte dal codice precedente durante
--    il rilascio) indica una riga che non si riprende mai, perché la segnalazione
--    di quel vecchio tentativo potrebbe esistere già. attempt: numero del
--    tentativo, alzato a ogni ripresa; chiusura e fallimento valgono solo per il
--    tentativo che possiede la riga.
ALTER TABLE external_contribution_submissions ADD COLUMN IF NOT EXISTS principal_key varchar(80);
ALTER TABLE external_contribution_submissions
  ADD COLUMN IF NOT EXISTS reserved_use_case_id uuid,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1 CONSTRAINT external_contribution_submissions_attempt_check CHECK (attempt >= 1);
ALTER TABLE external_contribution_submissions ALTER COLUMN integration_token_id DROP NOT NULL;
-- Il codice precedente inserisce senza principal_key: la si ricava dal token.
CREATE OR REPLACE FUNCTION external_contribution_fill_principal_key() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.principal_key IS NULL AND NEW.integration_token_id IS NOT NULL THEN
    NEW.principal_key := 'token:' || NEW.integration_token_id::text;
  END IF;
  RETURN NEW;
END
$$;
CREATE OR REPLACE TRIGGER external_contribution_fill_principal_key
  BEFORE INSERT ON external_contribution_submissions
  FOR EACH ROW EXECUTE FUNCTION external_contribution_fill_principal_key();
UPDATE external_contribution_submissions
   SET principal_key = 'token:' || integration_token_id::text
 WHERE principal_key IS NULL AND integration_token_id IS NOT NULL;
ALTER TABLE external_contribution_submissions ALTER COLUMN principal_key SET NOT NULL;

-- 5. Indici. La ricerca dei simili usa la stessa espressione full-text italiana.
CREATE UNIQUE INDEX IF NOT EXISTS use_cases_workspace_code_idx
  ON use_cases (workspace_id, code) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS use_cases_search_italian_idx
  ON use_cases USING gin (to_tsvector('italian', coalesce(title, '') || ' ' || coalesce(description, '')));
CREATE UNIQUE INDEX IF NOT EXISTS external_contribution_principal_idempotency_idx
  ON external_contribution_submissions (workspace_id, principal_key, idempotency_key);
CREATE INDEX IF NOT EXISTS connector_rate_limits_window_idx
  ON connector_rate_limits (window_start);

-- 6. status_changed_at si aggiorna solo quando status o portfolio_review_status
--    cambiano davvero, da qualunque percorso (dashboard, auto-ranking, script).
CREATE OR REPLACE FUNCTION use_cases_touch_status_changed_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.portfolio_review_status IS DISTINCT FROM OLD.portfolio_review_status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END
$$;
CREATE OR REPLACE TRIGGER use_cases_status_changed_at
  BEFORE UPDATE ON use_cases
  FOR EACH ROW EXECUTE FUNCTION use_cases_touch_status_changed_at();

-- 7. Aggiunta in coda (WP4): un token arrivato dentro un indirizzo web si considera
--    compromesso e diventa «esposto, da revocare». Lo stato sta sulla riga del
--    token: lo legge la scheda «Connettore Claude» di chi gestisce il workspace e
--    nessun membro lo può spegnere (la campanella, weekly_signals, è di tutto il
--    workspace e si segna letta per tutti). Si scrive una volta sola per token,
--    con un UPDATE condizionato su exposed_at IS NULL. Nessuna revoca automatica.
ALTER TABLE workspace_integration_tokens ADD COLUMN IF NOT EXISTS exposed_at timestamp;

-- 8. Aggiunta in coda (pacchetto K8, decisione 1 dell'arresto B): il profilo del cliente
--    (enum e descrizioni del contratto, titolo e descrizione dei 4 tool, riga «fuori
--    Foundation») e il modello delle istruzioni del server, con il segnaposto
--    {{workspaceName}}, si salvano per workspace. Li scrive solo lo script operatore
--    (scripts/connector-admin.ts profile), come la guida. Senza un profilo valido la rotta
--    risponde 500: nessun valore d'esempio.
ALTER TABLE workspace_connector_configs
  ADD COLUMN IF NOT EXISTS profile jsonb CONSTRAINT workspace_connector_configs_profile_check CHECK (profile IS NULL OR jsonb_typeof(profile) = 'object'),
  ADD COLUMN IF NOT EXISTS instructions_template text CONSTRAINT workspace_connector_configs_instructions_template_check CHECK (instructions_template IS NULL OR char_length(instructions_template) BETWEEN 1 AND 2048);

-- 9. Aggiunta in coda (pacchetto K8, decisione del 19/10/2026): la ricerca dei simili non
--    distingue gli accenti («qualita» trova «qualità»). L'estensione unaccent (fidata da
--    PostgreSQL 13: la crea chi ha il privilegio CREATE sul database) la crea questa
--    migrazione; la funzione IMMUTABLE la avvolge, perché un indice accetta solo funzioni
--    IMMUTABLE e unaccent è STABLE. Nomi completi con lo schema: la funzione non dipende
--    dal search_path. Il vecchio indice use_cases_search_italian_idx resta.
CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;
CREATE OR REPLACE FUNCTION public.connector_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;
CREATE INDEX IF NOT EXISTS use_cases_search_italian_unaccent_idx
  ON use_cases USING gin (to_tsvector('italian', public.connector_unaccent(coalesce(title, '') || ' ' || coalesce(description, ''))));
