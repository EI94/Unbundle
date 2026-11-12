/**
 * Rilascio 8.1a «Lavoro in parallelo»: DDL del self-heal della 0032 (docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2).
 *
 * Sono gli stessi statement di `drizzle/0032_compiti.sql`, nello stesso ordine, dopo le due righe di apertura del
 * file (`lock_timeout` e l'advisory lock {@link TASKS_ADVISORY_LOCK}, che il self-heal prende da sé in `runTasksDdl`):
 * 1. controllo che la 0031 ci sia (il rilascio 8.0b);
 * 2. `use_case_tasks`: i compiti di uno use case (T-1, T-2, …), nati dal progetto. Unbundle ne è la fonte:
 *    `casi/<id>/progetto/compiti.md` nel repository è uno specchio. Un compito ha una persona alla volta (chi lo
 *    ha preso), che si vede sul compito ma **non si conta mai per persona** (art. 15.4);
 * 3. `use_case_task_notes`: le note di passaggio e le richieste di un compito. Di una richiesta si tiene chi la
 *    fa, perché chi ha il compito possa passarglielo; di una nota di passaggio solo il testo;
 * 4. `use_case_factory_repos`: i repository della fabbrica di un workspace (di famiglia o comuni del cliente),
 *    con la versione del modello e del comune che hanno. Un repository è di più use case: la versione sta qui,
 *    non in `use_case_repos`;
 * 5. il CHECK dei tipi della campanella allargato con i quattro tipi dei compiti, sotto l'advisory lock della 0025.
 *
 * Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto. Il codice della
 * 8.0b ignora le tabelle nuove e non scrive mai i tipi nuovi. Il DDL uc (0018) non cambia.
 *
 * `src/lib/db/use-case-hub-tasks-ddl.test.ts` controlla che la migrazione li contenga tutti, nello stesso ordine,
 * che i CHECK siano gli elenchi qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo moduli DDL puri; lo caricano anche gli script di verifica.
 */
import { ALERTS_ADVISORY_LOCK, NOTIFICATION_KINDS_CHECK_NAME, notificationKindsWideningDdl } from "./use-case-hub-alerts-ddl.ts";
import { CLI_LIMITS, USE_CASE_NOTIFICATION_KINDS_0031 } from "./use-case-hub-cli-ddl.ts";
import { FACTORY_LIMITS } from "./use-case-hub-factory-ddl.ts";

// ─── Vocabolario ─────────────────────────────────────────────────────

/**
 * Lo stato di un compito. `in_corso`: qualcuno l'ha preso; `in_revisione`: c'è la pull request; `fatto`: unita;
 * `annullato`: non serve più (si tiene, non si cancella).
 */
export const TASK_STATUSES = ["da_fare", "in_corso", "in_revisione", "fatto", "annullato"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** Da dove nasce un compito. */
export const TASK_SOURCES = ["progetto", "cli", "pagina", "github", "slack"] as const;
export type TaskSource = (typeof TASK_SOURCES)[number];

/** Le note di un compito: il passaggio (fatto, da fare, dubbi, come riprendere) e la richiesta di prenderlo. */
export const TASK_NOTE_KINDS = ["passaggio", "richiesta"] as const;
export type TaskNoteKind = (typeof TASK_NOTE_KINDS)[number];

/** I repository della fabbrica: di una famiglia di agenti, o comune del cliente (i componenti di più famiglie). */
export const FACTORY_REPO_KINDS = ["famiglia", "comune"] as const;
export type FactoryRepoKind = (typeof FACTORY_REPO_KINDS)[number];

/** I tipi nuovi della campanella della 0032 (al massimo 16 caratteri). */
export const TASK_NOTICE_KINDS = ["compito_chiesto", "compito_passato", "compito_fermo", "compiti_pronti"] as const;
export type TaskNoticeKind = (typeof TASK_NOTICE_KINDS)[number];

/** I tipi della campanella dopo la 0032: quelli della 0031 più i quattro dei compiti. */
export const USE_CASE_NOTIFICATION_KINDS_0032 = [...USE_CASE_NOTIFICATION_KINDS_0031, ...TASK_NOTICE_KINDS] as const;
export type UseCaseNoticeKind0032 = (typeof USE_CASE_NOTIFICATION_KINDS_0032)[number];

/** I limiti delle colonne (li controlla anche l'app, prima di scrivere). */
export const TASK_LIMITS = Object.freeze({
  taskRef: CLI_LIMITS.taskRef,
  title: 200,
  /** Le aree di un compito: percorsi nel repository. */
  areasMax: 20,
  area: 160,
  evidence: 300,
  hoursMax: 1000,
  branch: CLI_LIMITS.branch,
  prUrl: CLI_LIMITS.prUrl,
  note: 2000,
  repo: CLI_LIMITS.repo,
  version: 20,
  projectVersionMax: FACTORY_LIMITS.projectVersionMax,
});

/** La chiave dell'advisory lock della 0032: la stessa nel file e in `runTasksDdl`. */
export const TASKS_ADVISORY_LOCK = "unbundle:use-case-tasks-ddl";

/** Quanto aspetta ogni lock della 0032 prima di fermarsi senza cambiare nulla. */
export const TASKS_LOCK_TIMEOUT = "3s";

/** Errore della 0032 su un database senza la 0031. */
export const MISSING_CLI_FOR_TASKS_MESSAGE = "compiti: manca la 0031. Applica prima drizzle/0031_cli.sql.";

// ─── Composizione del testo SQL ──────────────────────────────────────

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const L = TASK_LIMITS;
const nonBlank = (column: string) => `length(btrim(${column})) > 0`;
const semver = (column: string) => `${column} IS NULL OR ${column} ~ '^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$'`;

/** Gli statement della 0032 dopo le due righe di apertura, nell'ordine del file. */
export const TASKS_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_build_sessions') IS NULL THEN
    RAISE EXCEPTION '${MISSING_CLI_FOR_TASKS_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS use_case_tasks (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  ref varchar(${L.taskRef}) NOT NULL CONSTRAINT use_case_tasks_ref_check CHECK (ref ~ '^T-[1-9][0-9]{0,3}$'),
  title varchar(${L.title}) NOT NULL CONSTRAINT use_case_tasks_title_check CHECK (${nonBlank("title")}),
  areas jsonb NOT NULL DEFAULT '[]'::jsonb CONSTRAINT use_case_tasks_areas_check CHECK (jsonb_typeof(areas) = 'array' AND jsonb_array_length(areas) <= ${L.areasMax}),
  estimate_hours numeric(6,1) CONSTRAINT use_case_tasks_hours_check CHECK (estimate_hours IS NULL OR estimate_hours BETWEEN 0 AND ${L.hoursMax}),
  evidence varchar(${L.evidence}),
  status varchar(12) NOT NULL DEFAULT 'da_fare' CONSTRAINT use_case_tasks_status_check CHECK (status IN (${quoted(TASK_STATUSES)})),
  holder_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  taken_at timestamptz,
  last_activity_at timestamptz,
  stale_asked_at timestamptz,
  stale_escalated_at timestamptz,
  branch varchar(${L.branch}),
  pr_url varchar(${L.prUrl}) CONSTRAINT use_case_tasks_pr_check CHECK (pr_url IS NULL OR pr_url ~ '^https://github\\.com/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}/pull/[0-9]{1,9}$'),
  source varchar(10) NOT NULL CONSTRAINT use_case_tasks_source_check CHECK (source IN (${quoted(TASK_SOURCES)})),
  project_version integer CONSTRAINT use_case_tasks_project_check CHECK (project_version IS NULL OR project_version BETWEEN 1 AND ${L.projectVersionMax}),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_tasks_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_tasks_ref_unique UNIQUE (use_case_id, ref)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_tasks_case_idx ON use_case_tasks (use_case_id, status);`,
  `CREATE INDEX IF NOT EXISTS use_case_tasks_workspace_idx ON use_case_tasks (workspace_id);`,
  // «Da fare per te»: i compiti aperti di chi guarda, mai una classifica.
  `CREATE INDEX IF NOT EXISTS use_case_tasks_open_holder_idx ON use_case_tasks (holder_user_id) WHERE status IN ('in_corso', 'in_revisione');`,
  `CREATE TABLE IF NOT EXISTS use_case_task_notes (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL REFERENCES use_case_tasks(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(10) NOT NULL CONSTRAINT use_case_task_notes_kind_check CHECK (kind IN (${quoted(TASK_NOTE_KINDS)})),
  body varchar(${L.note}) NOT NULL CONSTRAINT use_case_task_notes_body_check CHECK (${nonBlank("body")}),
  requested_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_task_notes_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_task_notes_requester_check CHECK (kind = 'richiesta' OR requested_by_user_id IS NULL)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_task_notes_task_idx ON use_case_task_notes (task_id, created_at);`,
  `CREATE INDEX IF NOT EXISTS use_case_task_notes_workspace_idx ON use_case_task_notes (workspace_id);`,
  `CREATE TABLE IF NOT EXISTS use_case_factory_repos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo varchar(${L.repo}) NOT NULL CONSTRAINT use_case_factory_repos_repo_check CHECK (repo ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'),
  kind varchar(10) NOT NULL DEFAULT 'famiglia' CONSTRAINT use_case_factory_repos_kind_check CHECK (kind IN (${quoted(FACTORY_REPO_KINDS)})),
  template_version varchar(${L.version}) CONSTRAINT use_case_factory_repos_template_check CHECK (${semver("template_version")}),
  common_version varchar(${L.version}) CONSTRAINT use_case_factory_repos_common_check CHECK (${semver("common_version")}),
  reported_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_factory_repos_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_factory_repos_unique UNIQUE (workspace_id, repo)
);`,
  // I tipi della campanella: lo stesso blocco della 0025, sotto il suo advisory lock (l'ordine è sempre 0032 poi 0025).
  `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`,
  notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0032),
];

// ─── Pulizia (RUNBOOK, ritorno alla 8.0b) ────────────────────────────

/** Dopo un ritorno indietro alla 8.0b: il codice di prima non conosce i tipi dei compiti. Idempotente. */
export const TASKS_ROLLBACK_SWEEP_SQL: readonly string[] = Object.freeze([`DELETE FROM use_case_notifications WHERE kind IN (${quoted(TASK_NOTICE_KINDS)});`]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0032. */
export const TASKS_TABLES = ["use_case_tasks", "use_case_task_notes", "use_case_factory_repos"] as const;

/** Gli indici della 0032, per nome (oltre alle chiavi primarie e ai vincoli UNIQUE). */
export const TASKS_INDEXES = [
  "use_case_tasks_case_idx",
  "use_case_tasks_workspace_idx",
  "use_case_tasks_open_holder_idx",
  "use_case_task_notes_task_idx",
  "use_case_task_notes_workspace_idx",
] as const;

/** I vincoli con nome delle tabelle nuove, per la sonda. */
export const TASKS_NAMED_CONSTRAINTS = [
  "use_case_tasks_ref_check",
  "use_case_tasks_title_check",
  "use_case_tasks_areas_check",
  "use_case_tasks_hours_check",
  "use_case_tasks_status_check",
  "use_case_tasks_pr_check",
  "use_case_tasks_source_check",
  "use_case_tasks_project_check",
  "use_case_tasks_pkey",
  "use_case_tasks_ref_unique",
  "use_case_task_notes_kind_check",
  "use_case_task_notes_body_check",
  "use_case_task_notes_pkey",
  "use_case_task_notes_requester_check",
  "use_case_factory_repos_repo_check",
  "use_case_factory_repos_kind_check",
  "use_case_factory_repos_template_check",
  "use_case_factory_repos_common_check",
  "use_case_factory_repos_pkey",
  "use_case_factory_repos_unique",
] as const;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`, di `tasksStoreReady` e del doctor: vera solo se tutto il
 * DDL della 0032 è presente (le tre tabelle, i loro indici e vincoli con nome, i tipi dei compiti nella campanella).
 */
export const TASKS_PROBE_SQL = `(
  ${TASKS_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${TASKS_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${TASKS_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(TASKS_NAMED_CONSTRAINTS)})
  ) = ${TASKS_NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_notifications') AND c.conname = '${NOTIFICATION_KINDS_CHECK_NAME}'
      AND position('''${TASK_NOTICE_KINDS[TASK_NOTICE_KINDS.length - 1]}''' IN pg_get_constraintdef(c.oid)) > 0
  )
)`;
