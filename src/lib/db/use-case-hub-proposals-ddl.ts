/**
 * Rilascio 8.1b «Proposte di compito»: DDL del self-heal della 0034 (docs/rilascio-8/RILASCIO-8.1-COSTRUZIONE.md §2, 8.1b).
 *
 * Sono gli stessi statement di `drizzle/0034_proposte.sql`, nello stesso ordine, dopo le due righe di apertura del
 * file (`lock_timeout` e l'advisory lock {@link PROPOSALS_ADVISORY_LOCK}, che il self-heal prende da sé in
 * `runProposalsDdl`):
 * 1. controllo che la 0033 ci sia (le PR e gli eventi di GitHub);
 * 2. `use_case_task_proposals`: le proposte di compito di uno use case, da un'issue di GitHub o da un commento
 *    `/compito` (e, più avanti, da Slack). Una persona del team la accetta (nasce il compito T-n) o la scarta.
 *    Il titolo, il collegamento all'origine, un'area e, se lo smistatore lo dice, il compito che c'è già.
 *    **Nessuna colonna sulla persona** che propone o decide (art. 15.4); la chiave dell'origine è unica per use case,
 *    così un evento ripetuto non propone due volte;
 * 3. il CHECK dei tipi della campanella allargato con `compito_proposto`, sotto l'advisory lock della 0025.
 *
 * Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto. Il codice di prima
 * ignora la tabella nuova e non scrive mai il tipo nuovo. Il DDL uc (0018) non cambia.
 *
 * `src/lib/db/use-case-hub-proposals-ddl.test.ts` controlla che la migrazione li contenga tutti, nello stesso ordine,
 * che i CHECK siano gli elenchi qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo moduli DDL puri; lo caricano anche gli script di verifica.
 */
import { ALERTS_ADVISORY_LOCK, NOTIFICATION_KINDS_CHECK_NAME, notificationKindsWideningDdl } from "./use-case-hub-alerts-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0033 } from "./use-case-hub-github-ddl.ts";
import { TASK_LIMITS } from "./use-case-hub-tasks-ddl.ts";

// ─── Vocabolario ─────────────────────────────────────────────────────

/** Da dove arriva una proposta. */
export const PROPOSAL_SOURCES = ["github", "slack"] as const;
export type ProposalSource = (typeof PROPOSAL_SOURCES)[number];

/** Lo stato di una proposta: da decidere, accettata (è nato il compito), scartata. */
export const PROPOSAL_STATUSES = ["proposta", "accettata", "scartata"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];

/** Il tipo nuovo della campanella della 0034 (al massimo 16 caratteri). */
export const PROPOSAL_NOTICE_KINDS = ["compito_proposto"] as const;
export type ProposalNoticeKind = (typeof PROPOSAL_NOTICE_KINDS)[number];

/** I tipi della campanella dopo la 0034: quelli della 0033 più `compito_proposto`. */
export const USE_CASE_NOTIFICATION_KINDS_0034 = [...USE_CASE_NOTIFICATION_KINDS_0033, ...PROPOSAL_NOTICE_KINDS] as const;
export type UseCaseNoticeKind0034 = (typeof USE_CASE_NOTIFICATION_KINDS_0034)[number];

/** I limiti delle colonne (li controlla anche l'app, prima di scrivere). */
export const PROPOSAL_LIMITS = Object.freeze({
  title: TASK_LIMITS.title,
  area: TASK_LIMITS.area,
  link: 300,
  externalKey: 200,
});

/** La chiave dell'advisory lock della 0034: la stessa nel file e in `runProposalsDdl`. */
export const PROPOSALS_ADVISORY_LOCK = "unbundle:use-case-proposals-ddl";

/** Errore della 0034 su un database senza la 0033. */
export const MISSING_GITHUB_FOR_PROPOSALS_MESSAGE = "proposte: manca la 0033. Applica prima drizzle/0033_github.sql.";

// ─── Composizione del testo SQL ──────────────────────────────────────

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const L = PROPOSAL_LIMITS;
const nonBlank = (column: string) => `length(btrim(${column})) > 0`;

/** Gli statement della 0034 dopo le due righe di apertura, nell'ordine del file. */
export const PROPOSALS_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_pull_requests') IS NULL THEN
    RAISE EXCEPTION '${MISSING_GITHUB_FOR_PROPOSALS_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS use_case_task_proposals (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  source varchar(10) NOT NULL CONSTRAINT use_case_task_proposals_source_check CHECK (source IN (${quoted(PROPOSAL_SOURCES)})),
  external_key varchar(${L.externalKey}) NOT NULL CONSTRAINT use_case_task_proposals_key_check CHECK (${nonBlank("external_key")}),
  title varchar(${L.title}) NOT NULL CONSTRAINT use_case_task_proposals_title_check CHECK (${nonBlank("title")}),
  area varchar(${L.area}),
  link varchar(${L.link}) CONSTRAINT use_case_task_proposals_link_check CHECK (link IS NULL OR link ~ '^https://(github\\.com|[a-z0-9-]+\\.slack\\.com)/'),
  existing_task_id uuid REFERENCES use_case_tasks(id) ON DELETE SET NULL,
  status varchar(10) NOT NULL DEFAULT 'proposta' CONSTRAINT use_case_task_proposals_status_check CHECK (status IN (${quoted(PROPOSAL_STATUSES)})),
  task_id uuid REFERENCES use_case_tasks(id) ON DELETE SET NULL,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_task_proposals_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_task_proposals_unique UNIQUE (use_case_id, external_key),
  CONSTRAINT use_case_task_proposals_decided_check CHECK ((status = 'proposta') = (decided_at IS NULL))
);`,
  `CREATE INDEX IF NOT EXISTS use_case_task_proposals_case_idx ON use_case_task_proposals (use_case_id, status);`,
  `CREATE INDEX IF NOT EXISTS use_case_task_proposals_workspace_idx ON use_case_task_proposals (workspace_id);`,
  // I tipi della campanella: lo stesso blocco della 0025, sotto il suo advisory lock (l'ordine è sempre 0034 poi 0025).
  `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`,
  notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0034),
];

// ─── Pulizia (RUNBOOK, ritorno indietro) ─────────────────────────────

/** Dopo un ritorno indietro: il codice di prima non conosce `compito_proposto`. Idempotente. */
export const PROPOSALS_ROLLBACK_SWEEP_SQL: readonly string[] = Object.freeze([`DELETE FROM use_case_notifications WHERE kind IN (${quoted(PROPOSAL_NOTICE_KINDS)});`]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0034. */
export const PROPOSALS_TABLES = ["use_case_task_proposals"] as const;

/** Gli indici della 0034, per nome (oltre alla chiave primaria e al vincolo UNIQUE). */
export const PROPOSALS_INDEXES = ["use_case_task_proposals_case_idx", "use_case_task_proposals_workspace_idx"] as const;

/** I vincoli con nome della tabella nuova, per la sonda. */
export const PROPOSALS_NAMED_CONSTRAINTS = [
  "use_case_task_proposals_source_check",
  "use_case_task_proposals_key_check",
  "use_case_task_proposals_title_check",
  "use_case_task_proposals_link_check",
  "use_case_task_proposals_status_check",
  "use_case_task_proposals_pkey",
  "use_case_task_proposals_unique",
  "use_case_task_proposals_decided_check",
] as const;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`, di `proposalsStoreReady` e del doctor: vera solo se tutto il
 * DDL della 0034 è presente (la tabella, i suoi indici e vincoli con nome, `compito_proposto` nella campanella).
 */
export const PROPOSALS_PROBE_SQL = `(
  ${PROPOSALS_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${PROPOSALS_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${PROPOSALS_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(PROPOSALS_NAMED_CONSTRAINTS)})
  ) = ${PROPOSALS_NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_notifications') AND c.conname = '${NOTIFICATION_KINDS_CHECK_NAME}'
      AND position('''${PROPOSAL_NOTICE_KINDS[PROPOSAL_NOTICE_KINDS.length - 1]}''' IN pg_get_constraintdef(c.oid)) > 0
  )
)`;
