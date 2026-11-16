/**
 * Rilascio 8.0c «Esterni al 100%»: DDL del self-heal della 0037 (docs/rilascio-8/RILASCIO-8.0c-ESTERNI.md §6).
 *
 * Sono gli stessi statement di `drizzle/0037_costruttori_esterni.sql`, nello stesso ordine, dopo le due righe di
 * apertura del file (`lock_timeout` e l'advisory lock {@link EXTERNAL_BUILDERS_ADVISORY_LOCK}, che il self-heal prende
 * da sé in `runExternalBuildersDdl`):
 * 1. `use_case_external_builders`: le concessioni di «Chi costruisce» a chi viene da fuori Lateral Space. Persona,
 *    workspace, e un caso (lo use case) oppure tutti i casi, anche quelli che si apriranno (`use_case_id` NULL);
 * 2. un indice unico per la riga «tutti» di una persona in un workspace;
 * 3. un indice unico per la riga di un caso;
 * 4. un indice sulla persona (l'uscita dal workspace, le e-mail di chi costruisce).
 *
 * Una riga «tutti» oppure righe per caso, mai le due insieme: lo garantisce il codice (`use-case-builders.ts`), nella
 * stessa transazione. È composizione del team, mai una misura delle persone. La tabella la legge e la scrive solo
 * `src/lib/db/queries/use-case-builders.ts` (un predicato solo, §7).
 *
 * Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta, nessun CHECK toccato. Il DDL uc (0018) non
 * cambia; `use_case_workspace_team` (0035) non cambia.
 *
 * `src/lib/db/use-case-hub-builders-ddl.test.ts` controlla che la migrazione li contenga tutti, nello stesso ordine, e
 * che la sonda copra la tabella, la chiave e i due indici unici.
 * Modulo puro.
 */

/** La chiave dell'advisory lock della 0037: la stessa nel file e in `runExternalBuildersDdl`. */
export const EXTERNAL_BUILDERS_ADVISORY_LOCK = "unbundle:use-case-external-builders-ddl";

/** Gli statement della 0037 dopo le due righe di apertura, nell'ordine del file. */
export const EXTERNAL_BUILDERS_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS use_case_external_builders (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  use_case_id uuid REFERENCES use_cases(id) ON DELETE CASCADE,
  added_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_external_builders_pkey PRIMARY KEY (id)
);`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_case_external_builders_all_unique
  ON use_case_external_builders (workspace_id, user_id) WHERE use_case_id IS NULL;`,
  `CREATE UNIQUE INDEX IF NOT EXISTS use_case_external_builders_case_unique
  ON use_case_external_builders (workspace_id, user_id, use_case_id) WHERE use_case_id IS NOT NULL;`,
  `CREATE INDEX IF NOT EXISTS use_case_external_builders_user_idx ON use_case_external_builders (user_id);`,
];

// ─── Sonda ───────────────────────────────────────────────────────────

export const EXTERNAL_BUILDERS_TABLE = "use_case_external_builders";

/** I due indici unici che la sonda cerca: senza, «una riga per persona» non varrebbe. */
export const EXTERNAL_BUILDERS_UNIQUE_INDEXES = ["use_case_external_builders_all_unique", "use_case_external_builders_case_unique"] as const;

export const EXTERNAL_BUILDERS_NAMED_CONSTRAINTS = ["use_case_external_builders_pkey"] as const;

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * Vera solo se la tabella della 0037, la sua chiave e i due indici unici ci sono. Finché è falsa, nessuno è
 * sviluppatore esterno: il predicato vale `false` (si chiude, non si apre).
 */
export const EXTERNAL_BUILDERS_PROBE_SQL = `(
  to_regclass('public.${EXTERNAL_BUILDERS_TABLE}') IS NOT NULL
  AND ${EXTERNAL_BUILDERS_UNIQUE_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('public.${EXTERNAL_BUILDERS_TABLE}')
      AND conname IN (${quoted(EXTERNAL_BUILDERS_NAMED_CONSTRAINTS)})
  ) = ${EXTERNAL_BUILDERS_NAMED_CONSTRAINTS.length}
)`;
