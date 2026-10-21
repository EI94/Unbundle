/**
 * Area «Use case»: DDL del self-heal (docs/use-case/DESIGN.md §10.1-10.3).
 *
 * Sono gli stessi statement di `drizzle/0020_use_case_hub.sql`, nello stesso ordine:
 * controllo che la 0019 ci sia, colonne di `use_cases` e vincolo «importo o fascia»,
 * trigger della versione, Storia senza testi con il trigger di creazione, richieste
 * idempotenti del MCP del team, proprietario dei token personali, indici delle viste.
 * La migrazione ha in più,
 * in coda, il blocco dell'indice unico tra dossier e scheda (`USE_CASE_HUB_UC_INDEX_SQL`,
 * §10.4): non entra nel self-heal, perché le tabelle uc possono non esserci e un doppione
 * deve fermare la migrazione, non le richieste dell'app (§10.2).
 * `src/lib/db/use-case-hub-ddl.test.ts` controlla che la migrazione li contenga tutti,
 * nello stesso ordine, e che la sonda copra ogni oggetto.
 *
 * Tutti idempotenti e solo additivi: `ensureDbSchema()` li applica in una sola
 * transazione sui database che non hanno ricevuto la migrazione (anteprime, rami Neon).
 * Ogni colonna nuova è nullable o ha un default: il codice di oggi continua a scrivere.
 * Le fasce del costo di un workspace (D15) non chiedono colonne: stanno in
 * `workspace_scoring_models.config.costBands`; `cost_band` resta l'indice 1-5.
 *
 * Gli elenchi qui sotto sono la fonte dei CHECK e dei trigger: il testo SQL si compone
 * da loro. Modulo puro, senza import: lo caricano anche gli script di verifica con Node.
 */

// ─── Elenchi chiusi della Storia (§10.3) ─────────────────────────────

/** Chi ha agito. `actor_user_id` solo con `persona`: la creazione non registra chi propone. */
export const USE_CASE_EVENT_ACTOR_KINDS = ["persona", "proponente", "sistema", "ai"] as const;
export type UseCaseEventActorKind = (typeof USE_CASE_EVENT_ACTOR_KINDS)[number];

/** Canali della Storia: quelli del servizio più `altro`, per un `source` che il trigger non conosce. */
export const USE_CASE_EVENT_CHANNELS = [
  "pagina",
  "mcp_team",
  "connettore",
  "rest",
  "slack",
  "web",
  "corsi",
  "ai_readiness",
  "activity_mapping",
  "script",
  "ai",
  "altro",
] as const;
export type UseCaseEventChannel = (typeof USE_CASE_EVENT_CHANNELS)[number];

export const USE_CASE_EVENT_ACTIONS = [
  "creato",
  "modificato",
  "valutato",
  "suggerimento_ai",
  "decisione",
  "quando",
  "visibilita",
  "oscurato",
  "realizzazione_avviata",
] as const;
export type UseCaseEventAction = (typeof USE_CASE_EVENT_ACTIONS)[number];

/**
 * Nomi dei campi toccati da una scrittura. Un elenco chiuso, nessun testo libero: il
 * CHECK impedisce di salvare un valore, così «Oscura testo» resta vero.
 */
export const USE_CASE_EVENT_FIELDS = [
  "titolo",
  "problema",
  "come_funziona",
  "chi_controlla",
  "limiti",
  "impatto_atteso",
  "dati",
  "area",
  "ai_lab",
  "origine",
  "tipo",
  "nota_pubblica",
  "valore",
  "costo",
  "kpi",
  "quando",
  "revisione",
  "visibilita",
  "possibile_doppione",
  "intake",
] as const;
export type UseCaseEventField = (typeof USE_CASE_EVENT_FIELDS)[number];

/**
 * Canale della riga `creato` per ogni valore di `use_cases.source` (§10.3). `NULL` vale
 * come `activity_mapping`; ogni altro valore dà `altro`.
 */
export const CREATED_EVENT_CHANNEL = {
  web_proposed: "web",
  slack_proposed: "slack",
  claude_mcp: "rest",
  claude_connector: "connettore",
  learning: "corsi",
  ai_readiness_assessment: "ai_readiness",
  activity_mapping: "activity_mapping",
  manual: "pagina",
  team_mcp: "mcp_team",
} as const satisfies Record<string, UseCaseEventChannel>;

/** Esito di una richiesta idempotente del MCP del team. */
export const USE_CASE_MCP_REQUEST_STATUSES = ["pending", "completed", "failed"] as const;
export type UseCaseMcpRequestStatus = (typeof USE_CASE_MCP_REQUEST_STATUSES)[number];

/**
 * Colonne che una persona modifica: solo un loro cambio fa salire `version` (§10.1).
 * Restano fuori `ai_suggestion`, `overall_*`, `category`, `code`, `updated_at` e
 * `status_changed_at`: l'AI, l'assegnazione del codice e i ricalcoli non creano
 * conflitti finti.
 */
export const VERSIONED_USE_CASE_COLUMNS = [
  "title",
  "description",
  "flow_description",
  "human_in_the_loop",
  "guardrails",
  "business_case",
  "data_requirements",
  "sustainability_impact",
  "origin",
  "portfolio_kind",
  "ai_lab",
  "intake",
  "public_note",
  "custom_scores",
  "value_eur_year",
  "cost_eur_once",
  "cost_band",
  "status",
  "portfolio_review_status",
  "target_quarter",
  "review_by",
] as const;

/**
 * Errore della 0020 su un database senza la 0019: il trigger della versione legge
 * `intake` e `public_note`, che nascono lì.
 */
export const MISSING_0019_MESSAGE =
  "use_cases: manca la 0019 (intake, public_note). Applica prima drizzle/0019_connettore_mcp.sql.";

/** Colonne della 0019 lette dal trigger della versione: la 0020 si ferma se mancano. */
export const COLUMNS_FROM_0019 = ["intake", "public_note"] as const;

/** Errore della 0020 con più dossier sulla stessa scheda (§10.4). */
export const DOSSIER_DUPLICATES_MESSAGE =
  "uc_cases: piu dossier sulla stessa scheda. Esegui use-case-admin dossier-dups prima della 0020.";

// ─── Composizione del testo SQL ──────────────────────────────────────

/** `'a', 'b'`: valori noti, scritti qui sopra (nessun apice dentro). */
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
/** `NEW.title, NEW.description, …`, cinque colonne per riga, allineate dopo `ROW(`. */
const row = (alias: "NEW" | "OLD") => {
  const lines: string[] = [];
  for (let i = 0; i < VERSIONED_USE_CASE_COLUMNS.length; i += 5) {
    lines.push(VERSIONED_USE_CASE_COLUMNS.slice(i, i + 5).map((column) => `${alias}.${column}`).join(", "));
  }
  return lines.join(",\n         ");
};
const createdChannelCases = Object.entries(CREATED_EVENT_CHANNEL)
  .map(([source, channel]) => `      WHEN '${source}' THEN '${channel}'`)
  .join("\n");

export const USE_CASE_HUB_DDL: readonly string[] = [
  // 0. Le colonne che il trigger della versione legge. PL/pgSQL non controlla i campi di
  //    NEW e OLD quando crea la funzione: con una colonna mancante il DDL passerebbe e poi
  //    ogni UPDATE di use_cases fallirebbe.
  //    a) intake e public_note nascono con la 0019: senza, la 0020 si ferma. Nel self-heal
  //       non scatta mai, perché runConnectorDdl() viene prima.
  `DO $$ BEGIN
  IF (
    SELECT count(*) FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'use_cases' AND column_name IN (${quoted(COLUMNS_FROM_0019)})
  ) < ${COLUMNS_FROM_0019.length} THEN
    RAISE EXCEPTION '${MISSING_0019_MESSAGE}';
  END IF;
END $$;`,
  //    b) sustainability_impact: le migrazioni 0000-0019 non la creano, la aggiunge il
  //       self-heal di oggi, quindi nei database dell'app c'è già.
  `ALTER TABLE use_cases ADD COLUMN IF NOT EXISTS sustainability_impact text;`,
  // 1. use_cases: origine, AI Lab, Quando, revisione, valore e costo del team, suggerimento AI, versione.
  `ALTER TABLE use_cases
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
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;`,
  // Importo e fascia non insieme (DO per l'idempotenza del vincolo di tabella).
  `DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.use_cases'::regclass AND conname = 'use_cases_cost_one_source_check'
  ) THEN
    ALTER TABLE use_cases ADD CONSTRAINT use_cases_cost_one_source_check
      CHECK (cost_eur_once IS NULL OR cost_band IS NULL);
  END IF;
END $$;`,
  // 2. Versione: sale solo quando cambia una colonna che una persona modifica.
  `CREATE OR REPLACE FUNCTION use_cases_bump_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(${row("NEW")})
     IS DISTINCT FROM
     ROW(${row("OLD")}) THEN
    NEW.version := OLD.version + 1;
  ELSE
    NEW.version := OLD.version;
  END IF;
  RETURN NEW;
END
$$;`,
  `CREATE OR REPLACE TRIGGER use_cases_bump_version
  BEFORE UPDATE ON use_cases
  FOR EACH ROW EXECUTE FUNCTION use_cases_bump_version();`,
  // 3. Storia senza testi (§10.3) e trigger di creazione.
  `CREATE TABLE IF NOT EXISTS use_case_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT now(),
  actor_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  actor_kind varchar(12) NOT NULL
    CONSTRAINT use_case_events_actor_kind_check CHECK (actor_kind IN (${quoted(USE_CASE_EVENT_ACTOR_KINDS)})),
  channel varchar(20) NOT NULL
    CONSTRAINT use_case_events_channel_check CHECK (channel IN (${quoted(USE_CASE_EVENT_CHANNELS)})),
  action varchar(30) NOT NULL
    CONSTRAINT use_case_events_action_check CHECK (action IN (${quoted(USE_CASE_EVENT_ACTIONS)})),
  fields text[] NOT NULL DEFAULT '{}'
    CONSTRAINT use_case_events_fields_check CHECK (fields <@ ARRAY[${quoted(USE_CASE_EVENT_FIELDS)}]::text[]),
  phase_before varchar(40),
  phase_after varchar(40),
  CONSTRAINT use_case_events_actor_check CHECK (actor_user_id IS NULL OR actor_kind = 'persona')
);`,
  `CREATE INDEX IF NOT EXISTS use_case_events_use_case_idx
  ON use_case_events (use_case_id, at DESC);`,
  `CREATE OR REPLACE FUNCTION use_cases_created_event() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO use_case_events (workspace_id, use_case_id, actor_user_id, actor_kind, channel, action)
  VALUES (
    NEW.workspace_id,
    NEW.id,
    NULL,
    CASE WHEN coalesce(NEW.source, 'activity_mapping') = 'activity_mapping' THEN 'sistema' ELSE 'proponente' END,
    CASE coalesce(NEW.source, 'activity_mapping')
${createdChannelCases}
      ELSE 'altro'
    END,
    'creato'
  );
  RETURN NULL;
END
$$;`,
  `CREATE OR REPLACE TRIGGER use_cases_created_event
  AFTER INSERT ON use_cases
  FOR EACH ROW EXECUTE FUNCTION use_cases_created_event();`,
  // 4. Richieste idempotenti del MCP del team.
  `CREATE TABLE IF NOT EXISTS use_case_mcp_requests (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  principal_key varchar(80) NOT NULL,
  idempotency_key varchar(128) NOT NULL,
  tool varchar(40) NOT NULL,
  request_hash varchar(128) NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'pending'
    CONSTRAINT use_case_mcp_requests_status_check CHECK (status IN (${quoted(USE_CASE_MCP_REQUEST_STATUSES)})),
  result jsonb,
  reserved_ids uuid[],
  attempt integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_mcp_requests_pkey PRIMARY KEY (workspace_id, principal_key, idempotency_key)
);`,
  // 5. Token personali del MCP del team.
  `ALTER TABLE workspace_integration_tokens
  ADD COLUMN IF NOT EXISTS owner_user_id uuid REFERENCES users(id) ON DELETE CASCADE;`,
  `CREATE INDEX IF NOT EXISTS workspace_integration_tokens_owner_idx
  ON workspace_integration_tokens (owner_user_id) WHERE owner_user_id IS NOT NULL;`,
  // 6. Indici per le viste. Nessun indice su proposed_by.
  `CREATE INDEX IF NOT EXISTS use_cases_workspace_origin_idx
  ON use_cases (workspace_id, origin);`,
  `CREATE INDEX IF NOT EXISTS use_cases_workspace_quarter_idx
  ON use_cases (workspace_id, target_quarter) WHERE target_quarter IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS use_cases_workspace_review_by_idx
  ON use_cases (workspace_id, review_by) WHERE review_by IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS use_cases_workspace_ai_lab_idx
  ON use_cases (workspace_id, ai_lab) WHERE ai_lab IS NOT NULL;`,
];

/**
 * 7. Dossier: indice unico tra dossier e scheda (§10.4), solo se le tabelle uc esistono.
 * Ultimo blocco della 0020, fuori dal self-heal. Conta ogni riga con
 * `portfolio_use_case_id`, completa o no: una riga incompleta è un doppione.
 * Con un doppione la migrazione si ferma tutta (si applica in una sola transazione).
 */
export const USE_CASE_HUB_UC_INDEX_SQL = `DO $$ BEGIN
  IF to_regclass('public.uc_cases') IS NOT NULL THEN
    IF EXISTS (
      SELECT 1 FROM uc_cases
       WHERE portfolio_use_case_id IS NOT NULL
       GROUP BY portfolio_use_case_id
      HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION '${DOSSIER_DUPLICATES_MESSAGE}';
    END IF;
    CREATE UNIQUE INDEX IF NOT EXISTS uc_cases_portfolio_use_case_unique_idx
      ON uc_cases (portfolio_use_case_id) WHERE portfolio_use_case_id IS NOT NULL;
  END IF;
END $$;`;

/** Colonne di `use_cases` aggiunte dal DDL (statement 0 e 1), per la sonda. */
const NEW_USE_CASE_COLUMNS = [
  "sustainability_impact",
  "origin",
  "ai_lab",
  "target_quarter",
  "review_by",
  "value_eur_year",
  "cost_eur_once",
  "cost_band",
  "ai_suggestion",
  "version",
] as const;

/** Vincoli con nome del DDL, per la sonda. */
const NAMED_CONSTRAINTS = [
  "use_cases_origin_check",
  "use_cases_target_quarter_check",
  "use_cases_value_eur_year_check",
  "use_cases_cost_eur_once_check",
  "use_cases_cost_band_check",
  "use_cases_ai_suggestion_check",
  "use_cases_cost_one_source_check",
  "use_case_events_actor_kind_check",
  "use_case_events_channel_check",
  "use_case_events_action_check",
  "use_case_events_fields_check",
  "use_case_events_actor_check",
  "use_case_mcp_requests_status_check",
  "use_case_mcp_requests_pkey",
] as const;

const triggerOnUseCases = (name: string) => `EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'use_cases'
      AND t.tgname = '${name}'
      AND NOT t.tgisinternal
  )`;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`: vera solo se tutto il DDL
 * dell'hub è presente (colonne, vincoli, tabelle, indici, funzioni, trigger). Senza,
 * un database con la 0019 e senza la 0020 sembrerebbe aggiornato e Drizzle
 * chiederebbe colonne che non ci sono (§10.2).
 */
export const USE_CASE_HUB_PROBE_SQL = `(
  to_regclass('public.use_case_events') IS NOT NULL
  AND to_regclass('public.use_case_mcp_requests') IS NOT NULL
  AND to_regclass('public.use_case_events_use_case_idx') IS NOT NULL
  AND to_regclass('public.workspace_integration_tokens_owner_idx') IS NOT NULL
  AND to_regclass('public.use_cases_workspace_origin_idx') IS NOT NULL
  AND to_regclass('public.use_cases_workspace_quarter_idx') IS NOT NULL
  AND to_regclass('public.use_cases_workspace_review_by_idx') IS NOT NULL
  AND to_regclass('public.use_cases_workspace_ai_lab_idx') IS NOT NULL
  AND to_regprocedure('public.use_cases_bump_version()') IS NOT NULL
  AND to_regprocedure('public.use_cases_created_event()') IS NOT NULL
  AND (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'use_cases'
      AND column_name IN (${quoted(NEW_USE_CASE_COLUMNS)})
  ) = ${NEW_USE_CASE_COLUMNS.length}
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'workspace_integration_tokens'
      AND column_name = 'owner_user_id'
  )
  AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'use_case_mcp_requests'
      AND column_name = 'reserved_ids'
  )
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (to_regclass('public.use_cases'), to_regclass('public.use_case_events'), to_regclass('public.use_case_mcp_requests'))
      AND conname IN (${quoted(NAMED_CONSTRAINTS)})
  ) = ${NAMED_CONSTRAINTS.length}
  AND ${triggerOnUseCases("use_cases_bump_version")}
  AND ${triggerOnUseCases("use_cases_created_event")}
)`;
