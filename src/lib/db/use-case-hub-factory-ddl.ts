/**
 * Rilascio 8.0a «Agent Factory: progetto, decisioni e pacchetto»: DDL del self-heal della 0030
 * (docs/rilascio-8/RILASCIO-8.0-PIANO.md §2 e §3).
 *
 * Sono gli stessi statement di `drizzle/0030_agent_factory.sql`, nello stesso ordine, dopo le due righe di
 * apertura del file (`lock_timeout` e l'advisory lock {@link FACTORY_ADVISORY_LOCK}, che il self-heal prende
 * da sé in `runFactoryDdl`):
 * 1. controllo che la 0029 ci sia (il rilascio 7);
 * 2. `use_case_packages`: le versioni del pacchetto di uno use case (k1, k2, …), con i file, l'impronta del
 *    contenuto e da dove vengono (generato da Unbundle o importato, come il k1 di TJ-0049 fatto a mano);
 * 3. `use_case_projects`: le versioni del progetto dell'impostazione (i 10 argomenti con scelta, perché e
 *    alternativa scartata; il framework; gli strumenti nuovi; la stima), con lo stato e le due approvazioni:
 *    il responsabile del caso e, se ci sono strumenti nuovi, l'AI Board;
 * 4. `use_case_decisions`: le decisioni del caso, dall'impostazione o del team, una riga per decisione e mai
 *    cambiata (si aggiunge, non si riscrive);
 * 5. il CHECK dei tipi della campanella allargato con `progetto_appr`, `strumento_nuovo` e `pacchetto_nuovo`,
 *    sotto l'advisory lock della 0025, come la 0028 e la 0029.
 *
 * Le tabelle stanno sullo use case (`use_cases`), non sul dossier (`uc_cases`): così il self-heal della parte
 * principale le crea anche dove la sezione «Casi d'uso» è spenta, e il DDL uc (0018, con l'impronta e il
 * self-heal spento in produzione) non cambia. Il dossier le trova da `portfolio_use_case_id`.
 *
 * Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto. Il codice
 * del rilascio 7 ignora le tabelle nuove e non scrive mai i tipi nuovi.
 *
 * `src/lib/db/use-case-hub-factory-ddl.test.ts` controlla che la migrazione li contenga tutti, nello stesso
 * ordine, che i CHECK siano gli elenchi qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo moduli DDL puri; lo caricano anche gli script di verifica.
 */
import { ALERTS_ADVISORY_LOCK, NOTIFICATION_KINDS_CHECK_NAME, notificationKindsWideningDdl } from "./use-case-hub-alerts-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0029 } from "./use-case-hub-program-ddl.ts";

// ─── Vocabolario ─────────────────────────────────────────────────────

/** I 10 argomenti dell'impostazione (standard 1.1 §3.3, skill «imposta»), nell'ordine del dialogo. */
export const SETUP_TOPICS = [
  "funzionalita",
  "journey",
  "dati",
  "framework",
  "backend",
  "frontend",
  "integrazioni",
  "modelli",
  "osservabilita",
  "evals_autonomia",
] as const;
export type SetupTopic = (typeof SETUP_TOPICS)[number];

/** I framework del catalogo v1 (repository modello, `catalogo/catalogo.yaml`). */
export const FACTORY_FRAMEWORKS = ["codice", "langgraph", "agent_sdk", "cowork", "n8n", "altro"] as const;
export type FactoryFramework = (typeof FACTORY_FRAMEWORKS)[number];

/** Lo stato di una versione del progetto. Una sola aperta e una sola approvata per use case. */
export const PROJECT_STATUSES = ["in_corso", "da_approvare", "approvato", "superato"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Da dove viene un pacchetto: generato da Unbundle o importato (il k1 di TJ-0049, fatto a mano). */
export const PACKAGE_SOURCES = ["generato", "importato"] as const;
export type PackageSource = (typeof PACKAGE_SOURCES)[number];

/** Da dove viene una decisione: il dialogo dell'impostazione, il team (`unbundle decide`) o un import. */
export const DECISION_SOURCES = ["impostazione", "team", "importata"] as const;
export type DecisionSource = (typeof DECISION_SOURCES)[number];

/** I file di un pacchetto, sempre questi tre (`casi/<id>/unbundle/` nel repository del caso). */
export const PACKAGE_FILES = ["PACCHETTO.md", "BRIEF.md", "VERSIONE"] as const;
export type PackageFile = (typeof PACKAGE_FILES)[number];

/** La scelta di un argomento nel progetto: cosa, perché, e l'alternativa scartata. */
export interface ProjectTopicChoice {
  scelta: string;
  perche: string | null;
  alternativa: string | null;
}
export type ProjectTopics = Partial<Record<SetupTopic, ProjectTopicChoice>>;

/** Uno strumento nuovo per il cliente (serve l'ok dell'AI Board): il nome e perché serve. */
export interface ProjectNewTool {
  nome: string;
  perche: string | null;
}

/** I tipi della campanella dopo la 0030: quelli della 0029 più i tre dell'Agent Factory (al massimo 16 caratteri). */
export const USE_CASE_NOTIFICATION_KINDS_0030 = [...USE_CASE_NOTIFICATION_KINDS_0029, "progetto_appr", "strumento_nuovo", "pacchetto_nuovo"] as const;
export type UseCaseNoticeKind0030 = (typeof USE_CASE_NOTIFICATION_KINDS_0030)[number];

/** I limiti delle colonne (li controlla anche l'app, prima di scrivere). */
export const FACTORY_LIMITS = Object.freeze({
  packageVersionMax: 9999,
  /** Un pacchetto è testo: PACCHETTO.md, BRIEF.md e VERSIONE insieme, al massimo così. */
  packageBytesMax: 200_000,
  projectVersionMax: 999,
  hoursMax: 100_000,
  monthlyCostEurMax: 10_000_000,
  versionLabel: 10,
  topic: 80,
  choice: 500,
  reason: 1000,
  rejected: 500,
  authorRole: 60,
  aiBoardNote: 300,
  newToolsMax: 20,
});

/** La chiave dell'advisory lock della 0030: la stessa nel file e in `runFactoryDdl`. */
export const FACTORY_ADVISORY_LOCK = "unbundle:use-case-factory-ddl";

/** Quanto aspetta ogni lock della 0030 prima di fermarsi senza cambiare nulla. */
export const FACTORY_LOCK_TIMEOUT = "3s";

/** Errore della 0030 su un database senza la 0029. */
export const MISSING_PROGRAM_FOR_FACTORY_MESSAGE = "factory: manca la 0029. Applica prima drizzle/0029_program.sql.";

// ─── Composizione del testo SQL ──────────────────────────────────────

/** `'a', 'b'`: valori noti, scritti qui sopra (nessun apice dentro). */
const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const L = FACTORY_LIMITS;
const nonBlank = (column: string) => `length(btrim(${column})) > 0`;

/** Gli statement della 0030 dopo le due righe di apertura, nell'ordine del file. */
export const FACTORY_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.program_settings') IS NULL THEN
    RAISE EXCEPTION '${MISSING_PROGRAM_FOR_FACTORY_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS use_case_packages (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version integer NOT NULL CONSTRAINT use_case_packages_version_check CHECK (version BETWEEN 1 AND ${L.packageVersionMax}),
  content_hash varchar(64) NOT NULL CONSTRAINT use_case_packages_hash_check CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  files jsonb NOT NULL CONSTRAINT use_case_packages_files_check CHECK (jsonb_typeof(files) = 'object' AND ${PACKAGE_FILES.map((name) => `coalesce(jsonb_typeof(files -> '${name}'), 'assente') = 'string'`).join(" AND ")}),
  source varchar(10) NOT NULL CONSTRAINT use_case_packages_source_check CHECK (source IN (${quoted(PACKAGE_SOURCES)})),
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT use_case_packages_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_packages_size_check CHECK (octet_length(files::text) <= ${L.packageBytesMax})
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_case_packages_version_unique ON use_case_packages (use_case_id, version);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_case_packages_hash_unique ON use_case_packages (use_case_id, content_hash);`,
  `CREATE INDEX IF NOT EXISTS use_case_packages_workspace_idx ON use_case_packages (workspace_id);`,
  `CREATE TABLE IF NOT EXISTS use_case_projects (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  version integer NOT NULL CONSTRAINT use_case_projects_version_check CHECK (version BETWEEN 1 AND ${L.projectVersionMax}),
  status varchar(12) NOT NULL DEFAULT 'in_corso' CONSTRAINT use_case_projects_status_check CHECK (status IN (${quoted(PROJECT_STATUSES)})),
  topics jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT use_case_projects_topics_check CHECK (jsonb_typeof(topics) = 'object'),
  framework varchar(10) CONSTRAINT use_case_projects_framework_check CHECK (framework IS NULL OR framework IN (${quoted(FACTORY_FRAMEWORKS)})),
  new_tools jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT use_case_projects_new_tools_check CHECK (jsonb_typeof(new_tools) = 'array' AND jsonb_array_length(new_tools) <= ${L.newToolsMax}),
  estimate_hours numeric(8,1) CONSTRAINT use_case_projects_hours_check CHECK (estimate_hours IS NULL OR estimate_hours BETWEEN 0 AND ${L.hoursMax}),
  monthly_cost_eur numeric(12,2) CONSTRAINT use_case_projects_cost_check CHECK (monthly_cost_eur IS NULL OR monthly_cost_eur BETWEEN 0 AND ${L.monthlyCostEurMax}),
  standard_version varchar(${L.versionLabel}),
  catalog_version varchar(${L.versionLabel}),
  package_version integer CONSTRAINT use_case_projects_package_check CHECK (package_version IS NULL OR package_version BETWEEN 1 AND ${L.packageVersionMax}),
  submitted_at timestamptz,
  submitted_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  approved_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ai_board_ok_at timestamptz,
  ai_board_ok_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  ai_board_note varchar(${L.aiBoardNote}),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT use_case_projects_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_projects_approved_check CHECK (status <> 'approvato' OR approved_at IS NOT NULL),
  CONSTRAINT use_case_projects_submitted_check CHECK (status <> 'da_approvare' OR submitted_at IS NOT NULL),
  CONSTRAINT use_case_projects_ai_board_check CHECK (status <> 'approvato' OR jsonb_array_length(new_tools) = 0 OR ai_board_ok_at IS NOT NULL)
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_case_projects_version_unique ON use_case_projects (use_case_id, version);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_case_projects_open_unique ON use_case_projects (use_case_id) WHERE status IN ('in_corso', 'da_approvare');`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_case_projects_approved_unique ON use_case_projects (use_case_id) WHERE status = 'approvato';`,
  `CREATE INDEX IF NOT EXISTS use_case_projects_workspace_idx ON use_case_projects (workspace_id);`,
  `CREATE TABLE IF NOT EXISTS use_case_decisions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  decided_on date NOT NULL,
  topic_key varchar(16) CONSTRAINT use_case_decisions_topic_key_check CHECK (topic_key IS NULL OR topic_key IN (${quoted(SETUP_TOPICS)})),
  topic varchar(${L.topic}) NOT NULL CONSTRAINT use_case_decisions_topic_check CHECK (${nonBlank("topic")}),
  choice varchar(${L.choice}) NOT NULL CONSTRAINT use_case_decisions_choice_check CHECK (${nonBlank("choice")}),
  reason varchar(${L.reason}),
  rejected varchar(${L.rejected}),
  source varchar(12) NOT NULL CONSTRAINT use_case_decisions_source_check CHECK (source IN (${quoted(DECISION_SOURCES)})),
  project_version integer CONSTRAINT use_case_decisions_project_check CHECK (project_version IS NULL OR project_version BETWEEN 1 AND ${L.projectVersionMax}),
  author_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  author_role varchar(${L.authorRole}),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_decisions_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_decisions_author_check CHECK (author_user_id IS NOT NULL OR author_role IS NOT NULL)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_decisions_case_idx ON use_case_decisions (use_case_id, decided_on, created_at);`,
  `CREATE INDEX IF NOT EXISTS use_case_decisions_workspace_idx ON use_case_decisions (workspace_id);`,
  // I tipi della campanella: lo stesso blocco della 0025, sotto il suo advisory lock (file e self-heal della
  // 0025, della 0028, della 0029 e della 0030 uno alla volta sullo stesso vincolo; l'ordine è sempre 0030 poi 0025).
  `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`,
  notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0030),
];

// ─── Pulizia (RUNBOOK, ritorno al rilascio 7) ────────────────────────

/**
 * Dopo un ritorno indietro al rilascio 7: il codice di prima non conosce i tre tipi nuovi e li scriverebbe
 * senza testo nella campanella. Idempotente; sul codice nuovo non serve.
 */
export const FACTORY_ROLLBACK_SWEEP_SQL: readonly string[] = Object.freeze([
  `DELETE FROM use_case_notifications WHERE kind IN ('progetto_appr', 'strumento_nuovo', 'pacchetto_nuovo');`,
]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0030. */
export const FACTORY_TABLES = ["use_case_packages", "use_case_projects", "use_case_decisions"] as const;

/** Gli indici della 0030, per nome (oltre alle chiavi primarie). */
export const FACTORY_INDEXES = [
  "use_case_packages_version_unique",
  "use_case_packages_hash_unique",
  "use_case_packages_workspace_idx",
  "use_case_projects_version_unique",
  "use_case_projects_open_unique",
  "use_case_projects_approved_unique",
  "use_case_projects_workspace_idx",
  "use_case_decisions_case_idx",
  "use_case_decisions_workspace_idx",
] as const;

/** I vincoli con nome delle tabelle nuove (`CONSTRAINT <nome>`), per la sonda. */
export const FACTORY_NAMED_CONSTRAINTS = [
  "use_case_packages_version_check",
  "use_case_packages_hash_check",
  "use_case_packages_files_check",
  "use_case_packages_source_check",
  "use_case_packages_pkey",
  "use_case_packages_size_check",
  "use_case_projects_version_check",
  "use_case_projects_status_check",
  "use_case_projects_topics_check",
  "use_case_projects_framework_check",
  "use_case_projects_new_tools_check",
  "use_case_projects_hours_check",
  "use_case_projects_cost_check",
  "use_case_projects_package_check",
  "use_case_projects_pkey",
  "use_case_projects_approved_check",
  "use_case_projects_submitted_check",
  "use_case_projects_ai_board_check",
  "use_case_decisions_topic_key_check",
  "use_case_decisions_topic_check",
  "use_case_decisions_choice_check",
  "use_case_decisions_source_check",
  "use_case_decisions_project_check",
  "use_case_decisions_pkey",
  "use_case_decisions_author_check",
] as const;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`, di `factoryStoreReady` e del doctor: vera solo se
 * tutto il DDL della 0030 è presente (le tre tabelle, i loro indici e vincoli con nome, i tre tipi nuovi della
 * campanella).
 */
export const FACTORY_PROBE_SQL = `(
  ${FACTORY_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${FACTORY_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${FACTORY_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(FACTORY_NAMED_CONSTRAINTS)})
  ) = ${FACTORY_NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_notifications') AND c.conname = '${NOTIFICATION_KINDS_CHECK_NAME}'
      AND position('''pacchetto_nuovo''' IN pg_get_constraintdef(c.oid)) > 0
  )
)`;
