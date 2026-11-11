/**
 * Rilascio 8.0b «La CLI e l'MCP»: DDL del self-heal della 0031 (docs/rilascio-8/RILASCIO-8.0b-COSTRUZIONE.md §2).
 *
 * Sono gli stessi statement di `drizzle/0031_cli.sql`, nello stesso ordine, dopo le due righe di apertura del
 * file (`lock_timeout` e l'advisory lock {@link CLI_ADVISORY_LOCK}, che il self-heal prende da sé in `runCliDdl`):
 * 1. controllo che la 0030 ci sia (il rilascio 8.0a);
 * 2. `use_case_cli_logins`: i codici del login dal browser della CLI. Della CLI resta solo l'impronta del suo
 *    codice; il codice da leggere (`ABCD-EFGH`, solo consonanti: niente parole) vale 10 minuti e una volta sola.
 *    Il token che nasce alla consegna sta in `workspace_integration_tokens`, come quello del MCP del team;
 * 3. `use_case_repos`: il repository e la cartella di uno use case (`owner/nome`, `casi/<id>`), con il profilo
 *    del catalogo e il progetto Vercel;
 * 4. `use_case_agent_questions`: le domande per il referente proposte da un coding agent. Non partono mai da
 *    sole: una persona che rivede il caso le aggiunge a «Cosa serve» (poi si chiedono come sempre) o le scarta;
 * 5. `use_case_build_sessions`: la sintesi di una sessione di un coding agent (`ISPIRAZIONE-WARP.md` §4.1):
 *    compito, harness, modello, token, costo, durata, esito, PR. **Nessuna colonna sulla persona**: si legge
 *    per caso e per ricetta. L'impronta dell'id della sessione è unica per use case, così un hook ripetuto non
 *    conta due volte;
 * 6. il CHECK dei tipi della campanella allargato con `domanda_agente`, sotto l'advisory lock della 0025.
 *
 * Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto. Il codice
 * della 8.0a ignora le tabelle nuove e non scrive mai il tipo nuovo. Il DDL uc (0018) non cambia.
 *
 * `src/lib/db/use-case-hub-cli-ddl.test.ts` controlla che la migrazione li contenga tutti, nello stesso ordine,
 * che i CHECK siano gli elenchi qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo moduli DDL puri; lo caricano anche gli script di verifica.
 */
import { ALERTS_ADVISORY_LOCK, NOTIFICATION_KINDS_CHECK_NAME, notificationKindsWideningDdl } from "./use-case-hub-alerts-ddl.ts";
import { FACTORY_FRAMEWORKS, USE_CASE_NOTIFICATION_KINDS_0030 } from "./use-case-hub-factory-ddl.ts";

// ─── Vocabolario ─────────────────────────────────────────────────────

/** Lo stato di un login dal browser. */
export const CLI_LOGIN_STATUSES = ["in_attesa", "confermato", "negato", "consegnato", "scaduto"] as const;
export type CliLoginStatus = (typeof CLI_LOGIN_STATUSES)[number];

/** Le lettere del codice da leggere: solo consonanti senza le ambigue, così non si formano parole (RFC 8628 §6.1). */
export const CLI_USER_CODE_ALPHABET = "BCDFGHJKLMNPQRSTVWXZ";

/** Lo stato di una domanda proposta da un coding agent. */
export const AGENT_QUESTION_STATUSES = ["proposta", "aggiunta", "scartata"] as const;
export type AgentQuestionStatus = (typeof AGENT_QUESTION_STATUSES)[number];

/** Da dove arriva una domanda proposta. */
export const AGENT_QUESTION_CHANNELS = ["cli", "mcp"] as const;
export type AgentQuestionChannel = (typeof AGENT_QUESTION_CHANNELS)[number];

/** Gli harness dei coding agent che mandano la sintesi. */
export const BUILD_HARNESSES = ["claude_code", "codex", "cursor", "altro"] as const;
export type BuildHarness = (typeof BUILD_HARNESSES)[number];

/** Come è finita una sessione. */
export const BUILD_OUTCOMES = ["pr", "commit", "nessuna_modifica", "interrotta", "errore"] as const;
export type BuildOutcome = (typeof BUILD_OUTCOMES)[number];

/** I tipi nuovi della campanella della 0031 (al massimo 16 caratteri). */
export const CLI_NOTICE_KINDS = ["domanda_agente"] as const;

/** I tipi della campanella dopo la 0031: quelli della 0030 più `domanda_agente`. */
export const USE_CASE_NOTIFICATION_KINDS_0031 = [...USE_CASE_NOTIFICATION_KINDS_0030, ...CLI_NOTICE_KINDS] as const;
export type UseCaseNoticeKind0031 = (typeof USE_CASE_NOTIFICATION_KINDS_0031)[number];

/** I limiti delle colonne (li controlla anche l'app, prima di scrivere). */
export const CLI_LIMITS = Object.freeze({
  /** Quanto vale un codice di login. */
  loginMinutes: 10,
  clientLabel: 80,
  repo: 140,
  folder: 120,
  vercelProject: 100,
  question: 500,
  questionReason: 300,
  taskRef: 12,
  model: 80,
  branch: 120,
  prUrl: 300,
  /** Una sessione dura al massimo una settimana. */
  durationSecondsMax: 7 * 24 * 3600,
  tokensMax: 10_000_000_000,
  costUsdMax: 100_000,
});

/** La chiave dell'advisory lock della 0031: la stessa nel file e in `runCliDdl`. */
export const CLI_ADVISORY_LOCK = "unbundle:use-case-cli-ddl";

/** Quanto aspetta ogni lock della 0031 prima di fermarsi senza cambiare nulla. */
export const CLI_LOCK_TIMEOUT = "3s";

/** Errore della 0031 su un database senza la 0030. */
export const MISSING_FACTORY_FOR_CLI_MESSAGE = "cli: manca la 0030. Applica prima drizzle/0030_agent_factory.sql.";

// ─── Composizione del testo SQL ──────────────────────────────────────

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const L = CLI_LIMITS;
const nonBlank = (column: string) => `length(btrim(${column})) > 0`;
const codeLetters = `[${CLI_USER_CODE_ALPHABET}]`;

/** Gli statement della 0031 dopo le due righe di apertura, nell'ordine del file. */
export const CLI_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_projects') IS NULL THEN
    RAISE EXCEPTION '${MISSING_FACTORY_FOR_CLI_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS use_case_cli_logins (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  device_code_hash char(64) NOT NULL CONSTRAINT use_case_cli_logins_device_check CHECK (device_code_hash ~ '^[0-9a-f]{64}$'),
  user_code varchar(9) NOT NULL CONSTRAINT use_case_cli_logins_code_check CHECK (user_code ~ '^${codeLetters}{4}-${codeLetters}{4}$'),
  status varchar(12) NOT NULL DEFAULT 'in_attesa' CONSTRAINT use_case_cli_logins_status_check CHECK (status IN (${quoted(CLI_LOGIN_STATUSES)})),
  client_label varchar(${L.clientLabel}) NOT NULL CONSTRAINT use_case_cli_logins_label_check CHECK (${nonBlank("client_label")}),
  workspace_id uuid REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  token_id uuid REFERENCES workspace_integration_tokens(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  decided_at timestamptz,
  delivered_at timestamptz,
  CONSTRAINT use_case_cli_logins_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_cli_logins_device_unique UNIQUE (device_code_hash),
  CONSTRAINT use_case_cli_logins_confirmed_check CHECK (status NOT IN ('confermato', 'consegnato') OR (workspace_id IS NOT NULL AND user_id IS NOT NULL AND decided_at IS NOT NULL)),
  CONSTRAINT use_case_cli_logins_delivered_check CHECK (status <> 'consegnato' OR delivered_at IS NOT NULL),
  CONSTRAINT use_case_cli_logins_expiry_check CHECK (expires_at > created_at)
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_case_cli_logins_code_live_unique ON use_case_cli_logins (user_code) WHERE status IN ('in_attesa', 'confermato');`,
  `CREATE INDEX IF NOT EXISTS use_case_cli_logins_created_idx ON use_case_cli_logins (created_at);`,
  `CREATE TABLE IF NOT EXISTS use_case_repos (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo varchar(${L.repo}) NOT NULL CONSTRAINT use_case_repos_repo_check CHECK (repo ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'),
  folder varchar(${L.folder}) NOT NULL CONSTRAINT use_case_repos_folder_check CHECK (folder ~ '^casi/[a-z0-9][a-z0-9-]{0,40}$'),
  profile varchar(10) CONSTRAINT use_case_repos_profile_check CHECK (profile IS NULL OR profile IN (${quoted(FACTORY_FRAMEWORKS)})),
  vercel_project varchar(${L.vercelProject}) CONSTRAINT use_case_repos_vercel_check CHECK (vercel_project IS NULL OR vercel_project ~ '^[a-z0-9][a-z0-9._-]{0,99}$'),
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_repos_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_repos_unique UNIQUE (use_case_id, repo, folder)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_repos_workspace_idx ON use_case_repos (workspace_id);`,
  `CREATE TABLE IF NOT EXISTS use_case_agent_questions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  question varchar(${L.question}) NOT NULL CONSTRAINT use_case_agent_questions_question_check CHECK (${nonBlank("question")}),
  reason varchar(${L.questionReason}),
  status varchar(10) NOT NULL DEFAULT 'proposta' CONSTRAINT use_case_agent_questions_status_check CHECK (status IN (${quoted(AGENT_QUESTION_STATUSES)})),
  channel varchar(4) NOT NULL CONSTRAINT use_case_agent_questions_channel_check CHECK (channel IN (${quoted(AGENT_QUESTION_CHANNELS)})),
  need_id uuid REFERENCES use_case_needs(id) ON DELETE SET NULL,
  decided_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_agent_questions_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_agent_questions_decided_check CHECK (status = 'proposta' OR decided_at IS NOT NULL)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_agent_questions_case_idx ON use_case_agent_questions (use_case_id, status, created_at);`,
  `CREATE INDEX IF NOT EXISTS use_case_agent_questions_workspace_idx ON use_case_agent_questions (workspace_id);`,
  `CREATE TABLE IF NOT EXISTS use_case_build_sessions (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  session_key char(64) NOT NULL CONSTRAINT use_case_build_sessions_key_check CHECK (session_key ~ '^[0-9a-f]{64}$'),
  task_ref varchar(${L.taskRef}) CONSTRAINT use_case_build_sessions_task_check CHECK (task_ref IS NULL OR task_ref ~ '^T-[0-9]{1,4}$'),
  harness varchar(12) NOT NULL CONSTRAINT use_case_build_sessions_harness_check CHECK (harness IN (${quoted(BUILD_HARNESSES)})),
  model varchar(${L.model}) CONSTRAINT use_case_build_sessions_model_check CHECK (model IS NULL OR model ~ '^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,79}$'),
  input_tokens bigint NOT NULL DEFAULT 0 CONSTRAINT use_case_build_sessions_input_check CHECK (input_tokens BETWEEN 0 AND ${L.tokensMax}),
  output_tokens bigint NOT NULL DEFAULT 0 CONSTRAINT use_case_build_sessions_output_check CHECK (output_tokens BETWEEN 0 AND ${L.tokensMax}),
  cache_tokens bigint NOT NULL DEFAULT 0 CONSTRAINT use_case_build_sessions_cache_check CHECK (cache_tokens BETWEEN 0 AND ${L.tokensMax}),
  cost_usd numeric(12,4) CONSTRAINT use_case_build_sessions_cost_check CHECK (cost_usd IS NULL OR cost_usd BETWEEN 0 AND ${L.costUsdMax}),
  duration_seconds integer NOT NULL CONSTRAINT use_case_build_sessions_duration_check CHECK (duration_seconds BETWEEN 0 AND ${L.durationSecondsMax}),
  outcome varchar(16) NOT NULL CONSTRAINT use_case_build_sessions_outcome_check CHECK (outcome IN (${quoted(BUILD_OUTCOMES)})),
  pr_url varchar(${L.prUrl}) CONSTRAINT use_case_build_sessions_pr_check CHECK (pr_url IS NULL OR pr_url ~ '^https://github\\.com/[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}/pull/[0-9]{1,9}$'),
  branch varchar(${L.branch}),
  ended_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_build_sessions_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_build_sessions_unique UNIQUE (use_case_id, session_key)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_build_sessions_case_idx ON use_case_build_sessions (use_case_id, ended_at);`,
  `CREATE INDEX IF NOT EXISTS use_case_build_sessions_workspace_idx ON use_case_build_sessions (workspace_id);`,
  // I tipi della campanella: lo stesso blocco della 0025, sotto il suo advisory lock (l'ordine è sempre 0031 poi 0025).
  `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`,
  notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0031),
];

// ─── Pulizia (RUNBOOK, ritorno alla 8.0a) ────────────────────────────

/** Dopo un ritorno indietro alla 8.0a: il codice di prima non conosce `domanda_agente`. Idempotente. */
export const CLI_ROLLBACK_SWEEP_SQL: readonly string[] = Object.freeze([`DELETE FROM use_case_notifications WHERE kind IN (${quoted(CLI_NOTICE_KINDS)});`]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0031. */
export const CLI_TABLES = ["use_case_cli_logins", "use_case_repos", "use_case_agent_questions", "use_case_build_sessions"] as const;

/** Gli indici della 0031, per nome (oltre alle chiavi primarie e ai vincoli UNIQUE). */
export const CLI_INDEXES = [
  "use_case_cli_logins_code_live_unique",
  "use_case_cli_logins_created_idx",
  "use_case_repos_workspace_idx",
  "use_case_agent_questions_case_idx",
  "use_case_agent_questions_workspace_idx",
  "use_case_build_sessions_case_idx",
  "use_case_build_sessions_workspace_idx",
] as const;

/** I vincoli con nome delle tabelle nuove, per la sonda. */
export const CLI_NAMED_CONSTRAINTS = [
  "use_case_cli_logins_device_check",
  "use_case_cli_logins_code_check",
  "use_case_cli_logins_status_check",
  "use_case_cli_logins_label_check",
  "use_case_cli_logins_pkey",
  "use_case_cli_logins_device_unique",
  "use_case_cli_logins_confirmed_check",
  "use_case_cli_logins_delivered_check",
  "use_case_cli_logins_expiry_check",
  "use_case_repos_repo_check",
  "use_case_repos_folder_check",
  "use_case_repos_profile_check",
  "use_case_repos_vercel_check",
  "use_case_repos_pkey",
  "use_case_repos_unique",
  "use_case_agent_questions_question_check",
  "use_case_agent_questions_status_check",
  "use_case_agent_questions_channel_check",
  "use_case_agent_questions_pkey",
  "use_case_agent_questions_decided_check",
  "use_case_build_sessions_key_check",
  "use_case_build_sessions_task_check",
  "use_case_build_sessions_harness_check",
  "use_case_build_sessions_model_check",
  "use_case_build_sessions_input_check",
  "use_case_build_sessions_output_check",
  "use_case_build_sessions_cache_check",
  "use_case_build_sessions_cost_check",
  "use_case_build_sessions_duration_check",
  "use_case_build_sessions_outcome_check",
  "use_case_build_sessions_pr_check",
  "use_case_build_sessions_pkey",
  "use_case_build_sessions_unique",
] as const;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`, di `cliStoreReady` e del doctor: vera solo se tutto il
 * DDL della 0031 è presente (le quattro tabelle, i loro indici e vincoli con nome, `domanda_agente` nella campanella).
 */
export const CLI_PROBE_SQL = `(
  ${CLI_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${CLI_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${CLI_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(CLI_NAMED_CONSTRAINTS)})
  ) = ${CLI_NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_notifications') AND c.conname = '${NOTIFICATION_KINDS_CHECK_NAME}'
      AND position('''${CLI_NOTICE_KINDS[CLI_NOTICE_KINDS.length - 1]}''' IN pg_get_constraintdef(c.oid)) > 0
  )
)`;
