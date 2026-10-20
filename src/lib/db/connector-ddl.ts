/**
 * Connettore MCP organizzativo «Unbundle»: DDL del self-heal.
 *
 * Sono gli stessi statement di `drizzle/0019_connettore_mcp.sql`, nello stesso
 * ordine (le chiavi esterne lo impongono): identità di fase 2, configurazione
 * del connettore e limiti di richieste, colonne di `use_cases`, idempotenza per
 * principal di `external_contribution_submissions`, poi indici e trigger. Dopo il
 * via libera di Arresto A la 0019 cambia solo con aggiunte idempotenti in coda
 * (`exposed_at` dei token; profilo e modello delle istruzioni per workspace; estensione
 * `unaccent`, la sua funzione IMMUTABLE e l'indice della ricerca senza accenti), che
 * stanno in coda anche qui.
 *
 * Compatibilità durante il rilascio (expand/contract): il trigger BEFORE INSERT
 * `external_contribution_fill_principal_key`, creato prima del NOT NULL, riempie
 * `principal_key` dal token quando chi inserisce non la conosce (codice
 * precedente alla 0019 ancora in esecuzione sullo stesso database).
 * `src/lib/db/connector-ddl.test.ts` controlla che la migrazione li contenga
 * tutti, nello stesso ordine.
 *
 * Tutti idempotenti: `ensureDbSchema()` li applica in una sola transazione sui
 * database che non hanno ricevuto la migrazione (ambienti gemelli). L'unica estensione
 * è `unaccent` (fidata da PostgreSQL 13: la crea chi ha il privilegio CREATE sul
 * database, anche su Neon).
 * Modulo puro, senza import: lo caricano anche gli script di verifica con Node.
 */

/** Limiti di fase 1 per organizzazione (un solo token) e, in fase 2, per persona. */
export const CONNECTOR_DEFAULT_LIMITS = {
  submitsPerHour: 200,
  readsPerHour: 3000,
  submitsPerDayWorkspace: 1000,
  submitsPerHourPerUser: 10,
} as const;

export type ConnectorLimits = { -readonly [K in keyof typeof CONNECTOR_DEFAULT_LIMITS]: number };

/** Tetto del modello delle istruzioni del server (`instructions_template`, CHECK della colonna). */
export const CONNECTOR_INSTRUCTIONS_TEMPLATE_MAX_CHARS = 2048;

/**
 * Espressione full-text della ricerca dei simili, senza accenti: la stessa nell'indice
 * `use_cases_search_italian_unaccent_idx` e nella query (`tool-queries.ts`), così
 * l'indice si usa. `alias` è il prefisso delle colonne (`"u."`, oppure `""` nell'indice).
 * La query passa dalla stessa funzione: `websearch_to_tsquery('italian',
 * public.connector_unaccent($testo))`.
 */
export function connectorSearchVectorSql(alias: string): string {
  if (!/^([a-z_]+\.)?$/.test(alias)) throw new Error("Alias SQL non valido");
  return `to_tsvector('italian', public.connector_unaccent(coalesce(${alias}title, '') || ' ' || coalesce(${alias}description, '')))`;
}

export const CONNECTOR_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS connector_identities (
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
);`,
  `CREATE TABLE IF NOT EXISTS workspace_connector_configs (
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
);`,
  `CREATE TABLE IF NOT EXISTS connector_rate_limits (
  bucket varchar(120) NOT NULL,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0,
  CONSTRAINT connector_rate_limits_pkey PRIMARY KEY (bucket, window_start)
);`,
  `ALTER TABLE use_cases
  ADD COLUMN IF NOT EXISTS code varchar(20) CONSTRAINT use_cases_code_check CHECK (code IS NULL OR code ~ '^[A-Z]{2,4}-[0-9]{4,5}$'),
  ADD COLUMN IF NOT EXISTS intake jsonb CONSTRAINT use_cases_intake_check CHECK (intake IS NULL OR jsonb_typeof(intake) = 'object'),
  ADD COLUMN IF NOT EXISTS public_note text CONSTRAINT use_cases_public_note_check CHECK (public_note IS NULL OR char_length(public_note) <= 1000),
  ADD COLUMN IF NOT EXISTS status_changed_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_by_user_id uuid REFERENCES connector_identities(id) ON DELETE SET NULL;`,
  `UPDATE use_cases
   SET status_changed_at = COALESCE(submitted_at, created_at) AT TIME ZONE 'UTC'
 WHERE status_changed_at IS NULL;`,
  `ALTER TABLE use_cases ALTER COLUMN status_changed_at SET DEFAULT now();`,
  `ALTER TABLE external_contribution_submissions ADD COLUMN IF NOT EXISTS principal_key varchar(80);`,
  `ALTER TABLE external_contribution_submissions
  ADD COLUMN IF NOT EXISTS reserved_use_case_id uuid,
  ADD COLUMN IF NOT EXISTS attempt integer NOT NULL DEFAULT 1 CONSTRAINT external_contribution_submissions_attempt_check CHECK (attempt >= 1);`,
  `ALTER TABLE external_contribution_submissions ALTER COLUMN integration_token_id DROP NOT NULL;`,
  `CREATE OR REPLACE FUNCTION external_contribution_fill_principal_key() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.principal_key IS NULL AND NEW.integration_token_id IS NOT NULL THEN
    NEW.principal_key := 'token:' || NEW.integration_token_id::text;
  END IF;
  RETURN NEW;
END
$$;`,
  `CREATE OR REPLACE TRIGGER external_contribution_fill_principal_key
  BEFORE INSERT ON external_contribution_submissions
  FOR EACH ROW EXECUTE FUNCTION external_contribution_fill_principal_key();`,
  `UPDATE external_contribution_submissions
   SET principal_key = 'token:' || integration_token_id::text
 WHERE principal_key IS NULL AND integration_token_id IS NOT NULL;`,
  `ALTER TABLE external_contribution_submissions ALTER COLUMN principal_key SET NOT NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_cases_workspace_code_idx
  ON use_cases (workspace_id, code) WHERE code IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS use_cases_search_italian_idx
  ON use_cases USING gin (to_tsvector('italian', coalesce(title, '') || ' ' || coalesce(description, '')));`,
  `CREATE UNIQUE INDEX IF NOT EXISTS external_contribution_principal_idempotency_idx
  ON external_contribution_submissions (workspace_id, principal_key, idempotency_key);`,
  `CREATE INDEX IF NOT EXISTS connector_rate_limits_window_idx
  ON connector_rate_limits (window_start);`,
  `CREATE OR REPLACE FUNCTION use_cases_touch_status_changed_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.portfolio_review_status IS DISTINCT FROM OLD.portfolio_review_status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END
$$;`,
  `CREATE OR REPLACE TRIGGER use_cases_status_changed_at
  BEFORE UPDATE ON use_cases
  FOR EACH ROW EXECUTE FUNCTION use_cases_touch_status_changed_at();`,
  // Aggiunte in coda alla 0019 (PIANO-LAVORI §2.5), dopo il blocco originale.
  // Token arrivato dentro un indirizzo: «esposto, da revocare» sulla riga del token.
  `ALTER TABLE workspace_integration_tokens ADD COLUMN IF NOT EXISTS exposed_at timestamp;`,
  // K8, decisione 1 dell'arresto B: profilo del cliente (enum, testi dei tool, riga
  // «fuori Foundation») e modello delle istruzioni del server, per workspace.
  `ALTER TABLE workspace_connector_configs
  ADD COLUMN IF NOT EXISTS profile jsonb CONSTRAINT workspace_connector_configs_profile_check CHECK (profile IS NULL OR jsonb_typeof(profile) = 'object'),
  ADD COLUMN IF NOT EXISTS instructions_template text CONSTRAINT workspace_connector_configs_instructions_template_check CHECK (instructions_template IS NULL OR char_length(instructions_template) BETWEEN 1 AND ${CONNECTOR_INSTRUCTIONS_TEMPLATE_MAX_CHARS});`,
  // K8, decisione del 19/10/2026: ricerca che non distingue gli accenti («qualita» trova
  // «qualità»). Estensione unaccent, funzione IMMUTABLE che la avvolge (un indice vuole
  // funzioni IMMUTABLE; unaccent è solo STABLE) e indice GIN sulla nuova espressione. Il
  // vecchio indice resta: aggiunte soltanto.
  `CREATE EXTENSION IF NOT EXISTS unaccent WITH SCHEMA public;`,
  `CREATE OR REPLACE FUNCTION public.connector_unaccent(text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE STRICT
AS $$ SELECT public.unaccent('public.unaccent'::regdictionary, $1) $$;`,
  `CREATE INDEX IF NOT EXISTS use_cases_search_italian_unaccent_idx
  ON use_cases USING gin (${connectorSearchVectorSql("")});`,
];

/**
 * Espressione booleana per il probe di `ensureDbSchema()`: vera solo se tutto il
 * DDL del connettore è presente (tabelle, colonne, nullabilità, indici, trigger).
 */
export const CONNECTOR_PROBE_SQL = `(
  to_regclass('public.connector_identities') IS NOT NULL
  AND to_regclass('public.workspace_connector_configs') IS NOT NULL
  AND to_regclass('public.connector_rate_limits') IS NOT NULL
  AND to_regclass('public.use_cases_workspace_code_idx') IS NOT NULL
  AND to_regclass('public.use_cases_search_italian_idx') IS NOT NULL
  AND to_regclass('public.external_contribution_principal_idempotency_idx') IS NOT NULL
  AND to_regclass('public.connector_rate_limits_window_idx') IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'use_cases'
      AND column_name IN ('code', 'intake', 'public_note', 'status_changed_at', 'submitted_by_user_id')
    GROUP BY table_name
    HAVING count(*) = 5
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'external_contribution_submissions'
      AND column_name = 'principal_key'
      AND is_nullable = 'NO'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'external_contribution_submissions'
      AND column_name = 'integration_token_id'
      AND is_nullable = 'YES'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'external_contribution_submissions'
      AND column_name = 'reserved_use_case_id'
      AND is_nullable = 'YES'
      AND column_default IS NULL
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'external_contribution_submissions'
      AND column_name = 'attempt'
      AND is_nullable = 'NO'
  )
  AND EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'external_contribution_submissions'
      AND t.tgname = 'external_contribution_fill_principal_key'
      AND NOT t.tgisinternal
  )
  AND EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'use_cases'
      AND t.tgname = 'use_cases_status_changed_at'
      AND NOT t.tgisinternal
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_integration_tokens'
      AND column_name = 'exposed_at'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_connector_configs'
      AND column_name IN ('profile', 'instructions_template')
    GROUP BY table_name
    HAVING count(*) = 2
  )
  AND to_regprocedure('public.connector_unaccent(text)') IS NOT NULL
  AND to_regclass('public.use_cases_search_italian_unaccent_idx') IS NOT NULL
)`;
