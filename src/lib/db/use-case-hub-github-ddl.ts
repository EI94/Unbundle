/**
 * Rilascio 8.1b «GitHub»: DDL del self-heal della 0033 (docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2, 8.1b).
 *
 * Sono gli stessi statement di `drizzle/0033_github.sql`, nello stesso ordine, dopo le due righe di apertura del
 * file (`lock_timeout` e l'advisory lock {@link GITHUB_ADVISORY_LOCK}, che il self-heal prende da sé in `runGithubDdl`):
 * 1. controllo che la 0032 ci sia (il rilascio 8.1a);
 * 2. `use_case_github_deliveries`: gli eventi di GitHub già ricevuti, per l'id della consegna. Un evento ripetuto
 *    (GitHub lo rimanda, o qualcuno lo rimanda a mano) non conta due volte. Solo l'evento, il repository e l'esito,
 *    mai il contenuto; si tengono 30 giorni (il cron dei dossier li toglie);
 * 3. `use_case_pull_requests`: le pull request dei repository della fabbrica che appartengono a un caso (il ramo
 *    `<id>/…`), con il compito quando il ramo è `<id>/t-<n>`. Stato, bozza, quando si apre, si unisce o si chiude;
 *    `gh_updated_at` è l'ora di GitHub dell'ultimo evento applicato (un evento più vecchio non cambia niente),
 *    `changed_at` quando stato o bozza sono cambiati davvero (solo allora si muove il compito).
 *    **Nessuna colonna sulla persona** che la apre: si legge per caso, mai per persona (art. 15.4);
 * 4. il CHECK dei tipi della campanella allargato con `pr_da_rivedere`, sotto l'advisory lock della 0025.
 *
 * Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto. Il codice della
 * 8.1a ignora le tabelle nuove e non scrive mai il tipo nuovo. Il DDL uc (0018) non cambia.
 *
 * `src/lib/db/use-case-hub-github-ddl.test.ts` controlla che la migrazione li contenga tutti, nello stesso ordine,
 * che i CHECK siano gli elenchi qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo moduli DDL puri; lo caricano anche gli script di verifica.
 */
import { ALERTS_ADVISORY_LOCK, NOTIFICATION_KINDS_CHECK_NAME, notificationKindsWideningDdl } from "./use-case-hub-alerts-ddl.ts";
import { TASK_LIMITS, USE_CASE_NOTIFICATION_KINDS_0032 } from "./use-case-hub-tasks-ddl.ts";

// ─── Vocabolario ─────────────────────────────────────────────────────

/** Lo stato di una pull request: aperta, unita, chiusa senza unirla. */
export const PULL_REQUEST_STATES = ["aperta", "unita", "chiusa"] as const;
export type PullRequestState = (typeof PULL_REQUEST_STATES)[number];

/** Che cosa ha fatto Unbundle con un evento: l'ha applicato a un caso, o non riguardava nessun caso. */
export const GITHUB_DELIVERY_OUTCOMES = ["applicato", "ignorato"] as const;
export type GithubDeliveryOutcome = (typeof GITHUB_DELIVERY_OUTCOMES)[number];

/** Il tipo nuovo della campanella della 0033 (al massimo 16 caratteri). */
export const GITHUB_NOTICE_KINDS = ["pr_da_rivedere"] as const;
export type GithubNoticeKind = (typeof GITHUB_NOTICE_KINDS)[number];

/** I tipi della campanella dopo la 0033: quelli della 0032 più `pr_da_rivedere`. */
export const USE_CASE_NOTIFICATION_KINDS_0033 = [...USE_CASE_NOTIFICATION_KINDS_0032, ...GITHUB_NOTICE_KINDS] as const;
export type UseCaseNoticeKind0033 = (typeof USE_CASE_NOTIFICATION_KINDS_0033)[number];

/** I limiti delle colonne (li controlla anche l'app, prima di scrivere). */
export const GITHUB_LIMITS = Object.freeze({
  deliveryId: 64,
  event: 40,
  repo: TASK_LIMITS.repo,
  branch: TASK_LIMITS.branch,
  prNumberMax: 999_999_999,
});

/** Quanti giorni si tengono gli eventi ricevuti. */
export const GITHUB_DELIVERY_RETENTION_DAYS = 30;

/** La chiave dell'advisory lock della 0033: la stessa nel file e in `runGithubDdl`. */
export const GITHUB_ADVISORY_LOCK = "unbundle:use-case-github-ddl";

/** Errore della 0033 su un database senza la 0032. */
export const MISSING_TASKS_FOR_GITHUB_MESSAGE = "github: manca la 0032. Applica prima drizzle/0032_compiti.sql.";

// ─── Composizione del testo SQL ──────────────────────────────────────

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const L = GITHUB_LIMITS;
const REPO_RE = "'^[A-Za-z0-9][A-Za-z0-9-]{0,38}/[A-Za-z0-9._-]{1,100}$'";

/** Gli statement della 0033 dopo le due righe di apertura, nell'ordine del file. */
export const GITHUB_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_tasks') IS NULL THEN
    RAISE EXCEPTION '${MISSING_TASKS_FOR_GITHUB_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS use_case_github_deliveries (
  delivery_id varchar(${L.deliveryId}) NOT NULL CONSTRAINT use_case_github_deliveries_id_check CHECK (delivery_id ~ '^[A-Za-z0-9-]{1,${L.deliveryId}}$'),
  event varchar(${L.event}) NOT NULL CONSTRAINT use_case_github_deliveries_event_check CHECK (event ~ '^[a-z_]{1,${L.event}}$'),
  repo varchar(${L.repo}) CONSTRAINT use_case_github_deliveries_repo_check CHECK (repo IS NULL OR repo ~ ${REPO_RE}),
  outcome varchar(10) NOT NULL CONSTRAINT use_case_github_deliveries_outcome_check CHECK (outcome IN (${quoted(GITHUB_DELIVERY_OUTCOMES)})),
  received_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_github_deliveries_pkey PRIMARY KEY (delivery_id)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_github_deliveries_received_idx ON use_case_github_deliveries (received_at);`,
  `CREATE TABLE IF NOT EXISTS use_case_pull_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  task_id uuid REFERENCES use_case_tasks(id) ON DELETE SET NULL,
  repo varchar(${L.repo}) NOT NULL CONSTRAINT use_case_pull_requests_repo_check CHECK (repo ~ ${REPO_RE}),
  number integer NOT NULL CONSTRAINT use_case_pull_requests_number_check CHECK (number BETWEEN 1 AND ${L.prNumberMax}),
  branch varchar(${L.branch}) NOT NULL CONSTRAINT use_case_pull_requests_branch_check CHECK (length(btrim(branch)) > 0),
  state varchar(8) NOT NULL DEFAULT 'aperta' CONSTRAINT use_case_pull_requests_state_check CHECK (state IN (${quoted(PULL_REQUEST_STATES)})),
  draft boolean NOT NULL DEFAULT false,
  opened_at timestamptz NOT NULL,
  merged_at timestamptz,
  closed_at timestamptz,
  gh_updated_at timestamptz,
  changed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_pull_requests_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_pull_requests_unique UNIQUE (workspace_id, repo, number),
  CONSTRAINT use_case_pull_requests_merged_check CHECK ((state = 'unita') = (merged_at IS NOT NULL))
);`,
  `CREATE INDEX IF NOT EXISTS use_case_pull_requests_case_idx ON use_case_pull_requests (use_case_id, state);`,
  `CREATE INDEX IF NOT EXISTS use_case_pull_requests_workspace_idx ON use_case_pull_requests (workspace_id);`,
  `CREATE INDEX IF NOT EXISTS use_case_pull_requests_task_idx ON use_case_pull_requests (task_id) WHERE task_id IS NOT NULL;`,
  // I tipi della campanella: lo stesso blocco della 0025, sotto il suo advisory lock (l'ordine è sempre 0033 poi 0025).
  `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`,
  notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0033),
];

// ─── Pulizia (RUNBOOK, ritorno alla 8.1a) ────────────────────────────

/** Dopo un ritorno indietro alla 8.1a: il codice di prima non conosce `pr_da_rivedere`. Idempotente. */
export const GITHUB_ROLLBACK_SWEEP_SQL: readonly string[] = Object.freeze([`DELETE FROM use_case_notifications WHERE kind IN (${quoted(GITHUB_NOTICE_KINDS)});`]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0033. */
export const GITHUB_TABLES = ["use_case_github_deliveries", "use_case_pull_requests"] as const;

/** Gli indici della 0033, per nome (oltre alle chiavi primarie e ai vincoli UNIQUE). */
export const GITHUB_INDEXES = [
  "use_case_github_deliveries_received_idx",
  "use_case_pull_requests_case_idx",
  "use_case_pull_requests_workspace_idx",
  "use_case_pull_requests_task_idx",
] as const;

/** I vincoli con nome delle tabelle nuove, per la sonda. */
export const GITHUB_NAMED_CONSTRAINTS = [
  "use_case_github_deliveries_id_check",
  "use_case_github_deliveries_event_check",
  "use_case_github_deliveries_repo_check",
  "use_case_github_deliveries_outcome_check",
  "use_case_github_deliveries_pkey",
  "use_case_pull_requests_repo_check",
  "use_case_pull_requests_number_check",
  "use_case_pull_requests_branch_check",
  "use_case_pull_requests_state_check",
  "use_case_pull_requests_pkey",
  "use_case_pull_requests_unique",
  "use_case_pull_requests_merged_check",
] as const;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`, di `githubStoreReady` e del doctor: vera solo se tutto il
 * DDL della 0033 è presente (le due tabelle, i loro indici e vincoli con nome, `pr_da_rivedere` nella campanella).
 */
export const GITHUB_PROBE_SQL = `(
  ${GITHUB_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${GITHUB_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${GITHUB_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(GITHUB_NAMED_CONSTRAINTS)})
  ) = ${GITHUB_NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_notifications') AND c.conname = '${NOTIFICATION_KINDS_CHECK_NAME}'
      AND position('''${GITHUB_NOTICE_KINDS[GITHUB_NOTICE_KINDS.length - 1]}''' IN pg_get_constraintdef(c.oid)) > 0
  )
)`;
