/**
 * Rilascio 8.2b «Le evals dalla CI»: DDL del self-heal della 0042 (docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.8).
 *
 * Sono gli stessi statement di `drizzle/0042_chiavi_ci.sql`, nello stesso ordine, dopo le due righe di apertura del file
 * (`lock_timeout` e l'advisory lock {@link CI_KEYS_ADVISORY_LOCK}, che il self-heal prende da sé in `runCiKeysDdl`):
 * 1. il controllo che la 0036 ci sia (le evals);
 * 2. `use_case_ci_keys`: le chiavi della CI, una per repository (D1; `use_case_id` resta per la chiave di un caso solo,
 *    più avanti). Della chiave restano solo l'impronta SHA-256 e il prefisso da mostrare (`ub_ci_ab12`); la riga dice chi
 *    l'ha creata e quando, chi l'ha revocata, quando e perché, l'ultimo uso, l'avviso a 14 giorni e la chiave che
 *    sostituisce (la catena delle rotazioni). Nessuna lettura raggruppa o ordina per persona;
 * 3. i tre indici della tabella: le chiavi non revocate di un repository, la catena delle rotazioni, il caso;
 * 4. in `use_case_eval_runs` tre colonne nuove: `source` (`cli`, il valore di oggi per tutte le righe, oppure `ci`),
 *    `ci_key_id` (la chiave che ha scritto l'esecuzione) e `ci_run_url` (l'esecuzione su GitHub). I vincoli in un blocco
 *    `DO` che li cerca per nome: la chiave esterna (ON DELETE SET NULL), la fonte, l'indirizzo, e niente chiave né
 *    indirizzo per una riga della CLI;
 * 5. l'indice delle esecuzioni di una chiave (dopo una chiave esposta si sa che cosa ha scritto).
 *
 * Solo aggiunte: nessuna tabella tolta, nessuna colonna cambiata, nessun dato scritto, nessun CHECK più stretto, nessun
 * tipo nuovo nella campanella; il DDL uc (0018) non cambia. Il codice di prima non legge le colonne nuove e scrive le
 * evals con la fonte di default, `cli`, che vale anche per loro.
 *
 * `src/lib/db/use-case-hub-ci-keys-ddl.test.ts` controlla che la migrazione contenga questi statement, nello stesso ordine
 * e nient'altro, che i CHECK siano le regole qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro: importa solo moduli DDL puri; lo caricano anche gli script di verifica (il doctor).
 */
import { sqlPattern } from "./use-case-hub-evals-ddl.ts";

// ─── Vocabolario ─────────────────────────────────────────────────────

/** La chiave dell'advisory lock della 0042: la stessa nel file e in `runCiKeysDdl`. */
export const CI_KEYS_ADVISORY_LOCK = "unbundle:use-case-ci-keys-ddl";

/** Errore della 0042 su un database senza la 0036. */
export const MISSING_EVALS_FOR_CI_KEYS_MESSAGE = "chiavi della CI: manca la 0036. Applica prima drizzle/0036_evals.sql.";

/**
 * Perché una chiave della CI è stata revocata (`use_case_ci_keys.revoked_reason`, al massimo 12 caratteri):
 * - `a_mano`: «Revoca la chiave», o il comando dell'operatore;
 * - `ruotata`: il primo invio con la chiave nuova di una rotazione revoca la vecchia;
 * - `esposta`: la chiave è arrivata dentro un indirizzo web;
 * - `senza_casi`: il repository non ha più casi registrati nel workspace.
 */
export const CI_KEY_REVOKED_REASONS = ["a_mano", "ruotata", "esposta", "senza_casi"] as const;
export type CiKeyRevokedReason = (typeof CI_KEY_REVOKED_REASONS)[number];

/** Da dove arriva un'esecuzione delle evals o del banco (`use_case_eval_runs.source`): la CLI di una persona, o la CI. */
export const EVAL_RUN_SOURCES = ["cli", "ci"] as const;
export type EvalRunSource = (typeof EVAL_RUN_SOURCES)[number];

/** I limiti delle colonne nuove (li controlla anche l'app, prima di scrivere). */
export const CI_KEY_LIMITS = Object.freeze({
  /** `owner/nome`, come `use_case_repos.repo`. */
  repo: 140,
  /** `ub_ci_` più 4 caratteri. */
  tokenPrefix: 16,
  reason: 12,
  source: 3,
  /** L'indirizzo dell'esecuzione su GitHub. */
  runUrl: 300,
});

/** Il repository come lo registra la CLI (`owner/nome`): la regola di `use_case_repos_repo_check`. */
export const CI_REPO_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
/** L'impronta SHA-256 di una chiave, in esadecimale minuscolo. */
export const CI_KEY_HASH_RE = /^[0-9a-f]{64}$/;
/** Il prefisso da mostrare: `ub_ci_` e i primi 4 caratteri della parte casuale. */
export const CI_KEY_PREFIX_RE = /^ub_ci_[A-Za-z0-9_-]{4}$/;
/** L'esecuzione di GitHub Actions: `https://github.com/<owner>/<nome>/actions/runs/<numero>`, niente altro. */
export const CI_RUN_URL_RE = /^https:\/\/github[.]com\/[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}\/actions\/runs\/[0-9]{1,20}$/;

// ─── Composizione del testo SQL ──────────────────────────────────────

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");
const L = CI_KEY_LIMITS;

/** Un vincolo di `use_case_eval_runs` aggiunto solo se manca, cercato per nome. */
const addRunConstraintIfMissing = (name: string, definition: string) => `  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.use_case_eval_runs'::regclass AND conname = '${name}') THEN
    ALTER TABLE use_case_eval_runs ADD CONSTRAINT ${name} ${definition};
  END IF;`;

/** I vincoli con nome che la 0042 aggiunge a `use_case_eval_runs`, nell'ordine del blocco `DO`. */
export const CI_EVAL_RUN_CONSTRAINTS: readonly { name: string; definition: string }[] = Object.freeze([
  { name: "use_case_eval_runs_source_check", definition: `CHECK (source IN (${quoted(EVAL_RUN_SOURCES)}))` },
  { name: "use_case_eval_runs_ci_key_fkey", definition: "FOREIGN KEY (ci_key_id) REFERENCES use_case_ci_keys (id) ON DELETE SET NULL" },
  { name: "use_case_eval_runs_ci_url_check", definition: `CHECK (ci_run_url IS NULL OR ci_run_url ~ '${sqlPattern(CI_RUN_URL_RE)}')` },
  { name: "use_case_eval_runs_ci_check", definition: "CHECK (source = 'ci' OR (ci_key_id IS NULL AND ci_run_url IS NULL))" },
]);

/** Gli statement della 0042 dopo le due righe di apertura, nell'ordine del file. */
export const CI_KEYS_DDL: readonly string[] = Object.freeze([
  `DO $$ BEGIN
  IF to_regclass('public.use_case_eval_runs') IS NULL THEN
    RAISE EXCEPTION '${MISSING_EVALS_FOR_CI_KEYS_MESSAGE}';
  END IF;
END $$;`,
  `CREATE TABLE IF NOT EXISTS use_case_ci_keys (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  repo varchar(${L.repo}) NOT NULL CONSTRAINT use_case_ci_keys_repo_check CHECK (repo ~ '${sqlPattern(CI_REPO_RE)}'),
  use_case_id uuid REFERENCES use_cases(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL CONSTRAINT use_case_ci_keys_hash_check CHECK (token_hash ~ '${sqlPattern(CI_KEY_HASH_RE)}'),
  token_prefix varchar(${L.tokenPrefix}) NOT NULL CONSTRAINT use_case_ci_keys_prefix_check CHECK (token_prefix ~ '${sqlPattern(CI_KEY_PREFIX_RE)}'),
  replaces_key_id uuid REFERENCES use_case_ci_keys(id) ON DELETE SET NULL,
  created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_used_at timestamptz,
  reminded_at timestamptz,
  revoked_at timestamptz,
  revoked_reason varchar(${L.reason}) CONSTRAINT use_case_ci_keys_reason_check CHECK (revoked_reason IS NULL OR revoked_reason IN (${quoted(CI_KEY_REVOKED_REASONS)})),
  revoked_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT use_case_ci_keys_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_ci_keys_hash_unique UNIQUE (token_hash),
  CONSTRAINT use_case_ci_keys_revoked_check CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL)),
  CONSTRAINT use_case_ci_keys_revoked_by_check CHECK (revoked_by_user_id IS NULL OR revoked_at IS NOT NULL),
  CONSTRAINT use_case_ci_keys_expiry_check CHECK (expires_at > created_at),
  CONSTRAINT use_case_ci_keys_replaces_check CHECK (replaces_key_id IS NULL OR replaces_key_id <> id)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_ci_keys_repo_idx ON use_case_ci_keys (workspace_id, lower(repo)) WHERE revoked_at IS NULL;`,
  `CREATE INDEX IF NOT EXISTS use_case_ci_keys_replaces_idx ON use_case_ci_keys (replaces_key_id) WHERE replaces_key_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS use_case_ci_keys_use_case_idx ON use_case_ci_keys (use_case_id) WHERE use_case_id IS NOT NULL;`,
  `ALTER TABLE use_case_eval_runs ADD COLUMN IF NOT EXISTS source varchar(${L.source}) NOT NULL DEFAULT 'cli';`,
  `ALTER TABLE use_case_eval_runs ADD COLUMN IF NOT EXISTS ci_key_id uuid;`,
  `ALTER TABLE use_case_eval_runs ADD COLUMN IF NOT EXISTS ci_run_url varchar(${L.runUrl});`,
  `DO $$ BEGIN
${CI_EVAL_RUN_CONSTRAINTS.map((c) => addRunConstraintIfMissing(c.name, c.definition)).join("\n")}
END $$;`,
  `CREATE INDEX IF NOT EXISTS use_case_eval_runs_ci_key_idx ON use_case_eval_runs (ci_key_id) WHERE ci_key_id IS NOT NULL;`,
]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** La tabella nuova della 0042. */
export const CI_KEYS_TABLE = "use_case_ci_keys";

/** Le colonne nuove di `use_case_eval_runs`. */
export const CI_EVAL_RUN_COLUMNS = ["source", "ci_key_id", "ci_run_url"] as const;

/** Gli indici della 0042, per nome (oltre alla chiave primaria e al vincolo UNIQUE). */
export const CI_KEYS_INDEXES = ["use_case_ci_keys_repo_idx", "use_case_ci_keys_replaces_idx", "use_case_ci_keys_use_case_idx", "use_case_eval_runs_ci_key_idx"] as const;

/** I vincoli con nome della 0042: quelli della tabella nuova e quelli aggiunti a `use_case_eval_runs`. */
export const CI_KEYS_NAMED_CONSTRAINTS: readonly string[] = Object.freeze([
  "use_case_ci_keys_repo_check",
  "use_case_ci_keys_hash_check",
  "use_case_ci_keys_prefix_check",
  "use_case_ci_keys_reason_check",
  "use_case_ci_keys_pkey",
  "use_case_ci_keys_hash_unique",
  "use_case_ci_keys_revoked_check",
  "use_case_ci_keys_revoked_by_check",
  "use_case_ci_keys_expiry_check",
  "use_case_ci_keys_replaces_check",
  ...CI_EVAL_RUN_CONSTRAINTS.map((c) => c.name),
]);

/**
 * Vera solo con tutto il DDL della 0042: la tabella, le tre colonne nuove delle evals, gli indici, i vincoli con nome. Per
 * `ensureDbSchema()`, `ciKeysStoreReady()` e il doctor. Finché è falsa `/api/ci/*` risponde 503, la riga della famiglia
 * dice «Non ancora disponibile» e le letture delle evals non chiedono le colonne nuove.
 */
export const CI_KEYS_PROBE_SQL = `(
  to_regclass('public.${CI_KEYS_TABLE}') IS NOT NULL
  AND ${CI_KEYS_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'use_case_eval_runs' AND column_name IN (${quoted(CI_EVAL_RUN_COLUMNS)})
  ) = ${CI_EVAL_RUN_COLUMNS.length}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid IN (to_regclass('public.${CI_KEYS_TABLE}'), to_regclass('public.use_case_eval_runs'))
      AND conname IN (${quoted(CI_KEYS_NAMED_CONSTRAINTS)})
  ) = ${CI_KEYS_NAMED_CONSTRAINTS.length}
)`;
