/**
 * Rilascio 8.0d-1 «Porte»: DDL del self-heal della 0043 (docs/rilascio-8/RILASCIO-8.0d-ESTERNI-FASE-2.md §4.1, §4.2).
 *
 * Sono gli stessi statement di `drizzle/0043_solo_questo_use_case.sql`, nello stesso ordine, dopo le due righe di
 * apertura del file (`lock_timeout` e l'advisory lock {@link CASE_ONLY_ADVISORY_LOCK}, che il self-heal prende da sé in
 * `runCaseOnlyDdl`):
 * 1. il valore `esterno_caso` in coda all'enum `member_role` («Solo questo use case»). **Non si toglie più:** PostgreSQL
 *    non ha un comando per togliere un valore da un enum. Per questo mai da un'anteprima di Vercel, e il codice dalla
 *    8.0d-1 in poi lo tiene chiuso per default (`workspaceDoor`, src/lib/auth/case-only.ts). Il valore non si usa nella
 *    stessa transazione che lo aggiunge (e qui non si usa);
 * 2. `use_case_builder_invites`: il caso di un invito «Solo questo use case» (un invito, un caso). Chi invita e quando
 *    stanno già nell'invito e poi nella concessione (0037);
 * 3. l'indice sullo use case (gli inviti in attesa di un caso).
 *
 * Solo aggiunte: cambia il catalogo di PostgreSQL e nasce una tabella; nessuna riscrittura, nessun dato, nessuna colonna
 * cambiata, nessun CHECK toccato. Il DDL uc (0018) e la sua impronta non cambiano; `use_case_external_builders` (0037)
 * non cambia. Il codice di prima ignora il valore e la tabella.
 *
 * `src/lib/db/use-case-hub-case-only-ddl.test.ts` controlla che la migrazione contenga questi statement, nello stesso
 * ordine e nient'altro, che la sonda copra il valore, la tabella, la chiave e l'indice, e che l'enum di Drizzle abbia il
 * valore in coda.
 * Modulo puro.
 */

/** La chiave dell'advisory lock della 0043: la stessa nel file e in `runCaseOnlyDdl`. */
export const CASE_ONLY_ADVISORY_LOCK = "unbundle:case-only-ddl";

/** Il valore dell'enum `member_role` che la 0043 aggiunge (`CASE_ONLY_ROLE` di src/lib/auth/case-only.ts). */
export const CASE_ONLY_ENUM_VALUE = "esterno_caso";

/** La tabella nuova della 0043. */
export const CASE_ONLY_INVITES_TABLE = "use_case_builder_invites";

/** Gli statement della 0043 dopo le due righe di apertura, nell'ordine del file. */
export const CASE_ONLY_DDL: readonly string[] = Object.freeze([
  `ALTER TYPE member_role ADD VALUE IF NOT EXISTS '${CASE_ONLY_ENUM_VALUE}';`,
  `CREATE TABLE IF NOT EXISTS ${CASE_ONLY_INVITES_TABLE} (
  invitation_id uuid NOT NULL REFERENCES workspace_invitations(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  use_case_id uuid NOT NULL REFERENCES use_cases(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_builder_invites_pkey PRIMARY KEY (invitation_id)
);`,
  `CREATE INDEX IF NOT EXISTS use_case_builder_invites_use_case_idx ON ${CASE_ONLY_INVITES_TABLE} (use_case_id);`,
]);

// ─── Sonda ───────────────────────────────────────────────────────────

/** L'indice della 0043. */
export const CASE_ONLY_INDEXES = ["use_case_builder_invites_use_case_idx"] as const;

/** I vincoli con nome della 0043. */
export const CASE_ONLY_NAMED_CONSTRAINTS = ["use_case_builder_invites_pkey"] as const;

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/**
 * Vera solo con tutta la 0043: il valore `esterno_caso` in `pg_enum` per `member_role`, la tabella, la chiave e l'indice.
 * Per `ensureDbSchema()`, le scritture di «Solo questo use case» (l'accettazione di un invito) e il doctor. Finché è
 * falsa si chiude, non si apre: nessuno è «Solo questo use case», e l'accettazione di un suo invito risponde «riprova
 * tra qualche minuto».
 */
export const CASE_ONLY_PROBE_SQL = `(
  EXISTS (
    SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid JOIN pg_namespace ns ON ns.oid = t.typnamespace
    WHERE ns.nspname = 'public' AND t.typname = 'member_role' AND e.enumlabel = '${CASE_ONLY_ENUM_VALUE}'
  )
  AND to_regclass('public.${CASE_ONLY_INVITES_TABLE}') IS NOT NULL
  AND ${CASE_ONLY_INDEXES.map((name) => `to_regclass('public.${name}') IS NOT NULL`).join("\n  AND ")}
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('public.${CASE_ONLY_INVITES_TABLE}')
      AND conname IN (${quoted(CASE_ONLY_NAMED_CONSTRAINTS)})
  ) = ${CASE_ONLY_NAMED_CONSTRAINTS.length}
)`;
