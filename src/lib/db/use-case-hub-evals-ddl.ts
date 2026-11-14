/**
 * Rilascio 8.2a «Banco di prova ed evals»: DDL del self-heal della 0036 (docs/rilascio-8/BANCO-DI-PROVA.md §4.1).
 *
 * Sono gli stessi statement di `drizzle/0036_evals.sql`, nello stesso ordine, dopo le due righe di apertura del file
 * (`lock_timeout` e l'advisory lock {@link EVALS_ADVISORY_LOCK}, che il self-heal prende da sé in `runEvalsDdl`):
 * 1. controllo che la 0035 ci sia (il rilascio 8.1b);
 * 2. `use_case_eval_runs`: un banco di prova (le evals di un ruolo rifatte con ogni modello approvato) o le evals con i
 *    modelli di oggi, per use case: livello, ramo, commit, versione del modello, i modelli per ruolo, modelli finti,
 *    caso in costruzione, quante prove. Il ruolo c'è solo per il banco. **Nessuna colonna sulla persona** che lo
 *    lancia (art. 15.4): si legge per caso e per ruolo, mai per persona;
 * 3. `use_case_eval_results`: l'esito di ogni modello (uno per le evals, da 1 a 12 per il banco): qualità (superate /
 *    totali), prove, soglie, gruppi, costo per 1.000 esecuzioni, tempi, token medi, errori. Un modello una volta sola
 *    per esecuzione; la riga resta nel caso e nel workspace della sua esecuzione (chiave esterna su tutti e tre);
 * 4. il CHECK dei tipi della campanella allargato con `banco_consiglio` ed `evals_in_calo`, sotto l'advisory lock della
 *    0025.
 *
 * Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK più stretto. Il codice di prima
 * ignora le tabelle nuove e non scrive mai i tipi nuovi. Il DDL uc (0018) non cambia.
 *
 * Le regole dei campi sono quelle del modulo puro del banco (`use-cases/factory/benchmark.ts`: modello, ruolo,
 * livello) e della 0031/0032 (ramo, versione del modello): la CLI, l'API e il database dicono la stessa cosa.
 *
 * `src/lib/db/use-case-hub-evals-ddl.test.ts` controlla che la migrazione li contenga tutti, nello stesso ordine, che i
 * CHECK siano le regole qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo moduli puri; lo caricano anche gli script di verifica.
 */
import { ALERTS_ADVISORY_LOCK, NOTIFICATION_KINDS_CHECK_NAME, notificationKindsWideningDdl } from "./use-case-hub-alerts-ddl.ts";
import { CLI_LIMITS } from "./use-case-hub-cli-ddl.ts";
import { USE_CASE_NOTIFICATION_KINDS_0034 } from "./use-case-hub-proposals-ddl.ts";
import { TASK_LIMITS } from "./use-case-hub-tasks-ddl.ts";
import { BENCH_MAX_RESULTS, LEVEL_RE, MODEL_ID_RE, ROLE_RE, type EvalRunKind } from "../use-cases/factory/benchmark.ts";

// ─── Vocabolario ─────────────────────────────────────────────────────

/** Che cosa è un'esecuzione: il banco di un ruolo, o le evals con i modelli di oggi. */
export const EVAL_RUN_KINDS = ["banco", "evals"] as const satisfies readonly EvalRunKind[];

/** I tipi nuovi della campanella della 0036 (al massimo 16 caratteri). */
export const EVAL_NOTICE_KINDS = ["banco_consiglio", "evals_in_calo"] as const;
export type EvalNoticeKind = (typeof EVAL_NOTICE_KINDS)[number];

/** I tipi della campanella dopo la 0036: quelli della 0034 (la 0035 non ne aggiunge) più i due del banco e delle evals. */
export const USE_CASE_NOTIFICATION_KINDS_0036 = [...USE_CASE_NOTIFICATION_KINDS_0034, ...EVAL_NOTICE_KINDS] as const;
export type UseCaseNoticeKind0036 = (typeof USE_CASE_NOTIFICATION_KINDS_0036)[number];

/** I limiti delle colonne (li controlla anche l'app, prima di scrivere). */
export const EVAL_LIMITS = Object.freeze({
  role: 40,
  level: 20,
  branch: CLI_LIMITS.branch,
  commit: 40,
  version: TASK_LIMITS.version,
  model: CLI_LIMITS.model,
  /** I risultati di un banco, al massimo (le evals ne hanno uno). */
  resultsMax: BENCH_MAX_RESULTS,
  /** Le prove di un'esecuzione, al massimo. */
  casesMax: 100_000,
  /** I ruoli in `modelli`, al massimo. */
  modelsMax: 20,
  /** I gruppi di prove di un risultato, al massimo. */
  groupsMax: 20,
  /** Il costo stimato per 1.000 esecuzioni, in USD (6 decimali). */
  costPer1000UsdMax: 10_000_000,
  /** Un giorno, in millisecondi. */
  latencyMsMax: 86_400_000,
  tokensAvgMax: 10_000_000,
  errorsMax: 1_000_000,
});

/** Un ramo git, come nella 0031 e nei compiti. */
export const EVAL_BRANCH_RE = /^[A-Za-z0-9._/-]{1,120}$/;
/** Un commit: da 7 a 40 cifre esadecimali, in minuscolo. */
export const EVAL_COMMIT_RE = /^[0-9a-f]{7,40}$/;
/** La versione del modello dell'Agent Factory, come nella 0032 (`a.b.c`). */
export const EVAL_VERSION_RE = /^[0-9]{1,3}[.][0-9]{1,3}[.][0-9]{1,3}$/;
/** Il nome di un gruppo di prove («regole», «avversari», «casi»): la regola di un ruolo. */
export const EVAL_GROUP_RE = ROLE_RE;

/** La chiave dell'advisory lock della 0036: la stessa nel file e in `runEvalsDdl`. */
export const EVALS_ADVISORY_LOCK = "unbundle:use-case-evals-ddl";

/** Errore della 0036 su un database senza la 0035. */
export const MISSING_TEAM_FOR_EVALS_MESSAGE = "evals: manca la 0035. Applica prima drizzle/0035_team_workspace.sql.";

// ─── Composizione del testo SQL ──────────────────────────────────────

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const L = EVAL_LIMITS;
/** La stessa regola di una RegExp del codice, per `~` in Postgres (le regole qui non hanno apici né barre escape). */
export function sqlPattern(re: RegExp): string {
  const source = re.source.replace(/\\\//g, "/");
  if (re.flags || source.includes("'")) throw new Error(`Regola non adatta a un CHECK: ${re}`);
  return source;
}
const matches = (column: string, re: RegExp, nullable: boolean) => `${nullable ? `${column} IS NULL OR ` : ""}${column} ~ '${sqlPattern(re)}'`;
const between = (column: string, max: number) => `${column} IS NULL OR ${column} BETWEEN 0 AND ${max}`;

/** Gli statement della 0036 dopo le due righe di apertura, nell'ordine del file. */
export const EVALS_DDL: readonly string[] = [
  `DO $$ BEGIN
  IF to_regclass('public.use_case_workspace_team') IS NULL THEN
    RAISE EXCEPTION '${MISSING_TEAM_FOR_EVALS_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS use_case_eval_runs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  kind varchar(6) NOT NULL CONSTRAINT use_case_eval_runs_kind_check CHECK (kind IN (${quoted(EVAL_RUN_KINDS)})),
  role varchar(${L.role}) CONSTRAINT use_case_eval_runs_role_check CHECK (${matches("role", ROLE_RE, true)}),
  level varchar(${L.level}) NOT NULL CONSTRAINT use_case_eval_runs_level_check CHECK (${matches("level", LEVEL_RE, false)}),
  branch varchar(${L.branch}) CONSTRAINT use_case_eval_runs_branch_check CHECK (${matches("branch", EVAL_BRANCH_RE, true)}),
  commit_sha varchar(${L.commit}) CONSTRAINT use_case_eval_runs_commit_check CHECK (${matches("commit_sha", EVAL_COMMIT_RE, true)}),
  template_version varchar(${L.version}) CONSTRAINT use_case_eval_runs_version_check CHECK (${matches("template_version", EVAL_VERSION_RE, true)}),
  models jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT use_case_eval_runs_models_check CHECK (jsonb_typeof(models) = 'object'),
  fake_models boolean NOT NULL DEFAULT false,
  in_construction boolean NOT NULL DEFAULT false,
  cases_total integer NOT NULL CONSTRAINT use_case_eval_runs_cases_check CHECK (cases_total BETWEEN 1 AND ${L.casesMax}),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_eval_runs_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_eval_runs_scope_unique UNIQUE (id, use_case_id, workspace_id),
  CONSTRAINT use_case_eval_runs_role_kind_check CHECK ((kind = 'banco') = (role IS NOT NULL))
);`,
  `CREATE INDEX IF NOT EXISTS use_case_eval_runs_case_idx ON use_case_eval_runs (use_case_id, kind, created_at);`,
  `CREATE INDEX IF NOT EXISTS use_case_eval_runs_workspace_idx ON use_case_eval_runs (workspace_id, kind, created_at);`,
  `CREATE TABLE IF NOT EXISTS use_case_eval_results (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  run_id uuid NOT NULL,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  model varchar(${L.model}) NOT NULL CONSTRAINT use_case_eval_results_model_check CHECK (${matches("model", MODEL_ID_RE, false)}),
  current boolean NOT NULL DEFAULT false,
  quality double precision NOT NULL CONSTRAINT use_case_eval_results_quality_check CHECK (quality >= 0 AND quality <= 1),
  passed integer NOT NULL,
  total integer NOT NULL CONSTRAINT use_case_eval_results_total_check CHECK (total BETWEEN 1 AND ${L.casesMax}),
  thresholds_met boolean NOT NULL,
  groups jsonb NOT NULL DEFAULT '{}'::jsonb CONSTRAINT use_case_eval_results_groups_check CHECK (jsonb_typeof(groups) = 'object'),
  cost_per_1000_usd numeric(14,6) CONSTRAINT use_case_eval_results_cost_check CHECK (${between("cost_per_1000_usd", L.costPer1000UsdMax)}),
  latency_p50_ms integer CONSTRAINT use_case_eval_results_p50_check CHECK (${between("latency_p50_ms", L.latencyMsMax)}),
  latency_p95_ms integer CONSTRAINT use_case_eval_results_p95_check CHECK (${between("latency_p95_ms", L.latencyMsMax)}),
  tokens_in_avg integer CONSTRAINT use_case_eval_results_tokens_in_check CHECK (${between("tokens_in_avg", L.tokensAvgMax)}),
  tokens_out_avg integer CONSTRAINT use_case_eval_results_tokens_out_check CHECK (${between("tokens_out_avg", L.tokensAvgMax)}),
  errors integer NOT NULL DEFAULT 0 CONSTRAINT use_case_eval_results_errors_check CHECK (errors BETWEEN 0 AND ${L.errorsMax}),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_eval_results_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_eval_results_unique UNIQUE (run_id, model),
  CONSTRAINT use_case_eval_results_run_fkey FOREIGN KEY (run_id, use_case_id, workspace_id) REFERENCES use_case_eval_runs (id, use_case_id, workspace_id) ON DELETE CASCADE,
  CONSTRAINT use_case_eval_results_passed_check CHECK (passed >= 0 AND passed <= total),
  CONSTRAINT use_case_eval_results_latency_check CHECK (latency_p50_ms IS NULL OR latency_p95_ms IS NULL OR latency_p50_ms <= latency_p95_ms)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_eval_results_case_idx ON use_case_eval_results (use_case_id);`,
  `CREATE INDEX IF NOT EXISTS use_case_eval_results_workspace_idx ON use_case_eval_results (workspace_id);`,
  // I tipi della campanella: lo stesso blocco della 0025, sotto il suo advisory lock (l'ordine è sempre 0036 poi 0025).
  `SELECT pg_advisory_xact_lock(hashtext('${ALERTS_ADVISORY_LOCK}'));`,
  notificationKindsWideningDdl(USE_CASE_NOTIFICATION_KINDS_0036),
];

// ─── Pulizia (RUNBOOK, ritorno indietro) ─────────────────────────────

/**
 * Dopo un ritorno indietro alla 8.1b: il codice di prima non conosce `banco_consiglio` ed `evals_in_calo` e li
 * mostrerebbe senza testo nella campanella. Idempotente; sul codice nuovo non serve. Le e-mail in coda dei due tipi il
 * codice di prima le annulla da sé (modello non previsto).
 */
export const EVALS_ROLLBACK_SWEEP_SQL: readonly string[] = Object.freeze([`DELETE FROM use_case_notifications WHERE kind IN (${quoted(EVAL_NOTICE_KINDS)});`]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** Le tabelle della 0036. */
export const EVALS_TABLES = ["use_case_eval_runs", "use_case_eval_results"] as const;

/** Gli indici della 0036, per nome (oltre alle chiavi primarie e ai vincoli UNIQUE). */
export const EVALS_INDEXES = ["use_case_eval_runs_case_idx", "use_case_eval_runs_workspace_idx", "use_case_eval_results_case_idx", "use_case_eval_results_workspace_idx"] as const;

/** I vincoli con nome delle tabelle nuove, per la sonda. */
export const EVALS_NAMED_CONSTRAINTS = [
  "use_case_eval_runs_kind_check",
  "use_case_eval_runs_role_check",
  "use_case_eval_runs_level_check",
  "use_case_eval_runs_branch_check",
  "use_case_eval_runs_commit_check",
  "use_case_eval_runs_version_check",
  "use_case_eval_runs_models_check",
  "use_case_eval_runs_cases_check",
  "use_case_eval_runs_pkey",
  "use_case_eval_runs_scope_unique",
  "use_case_eval_runs_role_kind_check",
  "use_case_eval_results_model_check",
  "use_case_eval_results_quality_check",
  "use_case_eval_results_total_check",
  "use_case_eval_results_groups_check",
  "use_case_eval_results_cost_check",
  "use_case_eval_results_p50_check",
  "use_case_eval_results_p95_check",
  "use_case_eval_results_tokens_in_check",
  "use_case_eval_results_tokens_out_check",
  "use_case_eval_results_errors_check",
  "use_case_eval_results_pkey",
  "use_case_eval_results_unique",
  "use_case_eval_results_run_fkey",
  "use_case_eval_results_passed_check",
  "use_case_eval_results_latency_check",
] as const;

/**
 * Espressione booleana per la sonda di `ensureDbSchema()`, di `evalsStoreReady` e del doctor: vera solo se tutto il DDL
 * della 0036 è presente (le tabelle, i loro indici e vincoli con nome, i due tipi nuovi nella campanella).
 */
export const EVALS_PROBE_SQL = `(
  ${EVALS_TABLES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND ${EVALS_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (${EVALS_TABLES.map((name) => `to_regclass('public.${name}')`).join(", ")})
      AND conname IN (${quoted(EVALS_NAMED_CONSTRAINTS)})
  ) = ${EVALS_NAMED_CONSTRAINTS.length}
  AND EXISTS (
    SELECT 1 FROM pg_constraint c
    WHERE c.conrelid = to_regclass('public.use_case_notifications') AND c.conname = '${NOTIFICATION_KINDS_CHECK_NAME}'
      AND ${EVAL_NOTICE_KINDS.map((kind) => `position('''${kind}''' IN pg_get_constraintdef(c.oid)) > 0`).join("\n      AND ")}
  )
)`;
