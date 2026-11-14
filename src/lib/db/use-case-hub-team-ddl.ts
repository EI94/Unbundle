/**
 * Rilascio 8.1b «Il team di Lateral Space per cliente»: DDL del self-heal della 0035.
 *
 * Sono gli stessi statement di `drizzle/0035_team_workspace.sql`, nello stesso ordine, dopo le due righe di apertura
 * del file (`lock_timeout` e l'advisory lock {@link WORKSPACE_TEAM_ADVISORY_LOCK}, che il self-heal prende da sé in
 * `runWorkspaceTeamDdl`):
 * 1. `use_case_workspace_team`: le persone di Lateral Space che costruiscono in tutti i casi di un workspace (cliente),
 *    con il ruolo che hanno nei casi. Chi è qui entra nel team di ogni dossier aperto e di quelli che si apriranno;
 *    per un caso solo resta il team del dossier. Una riga per persona e workspace. È composizione del team (chi può
 *    lavorare dove), mai una misura delle persone.
 *
 * Nessun dato scritto, nessuna colonna cambiata, nessuna tabella tolta. Il DDL uc (0018) non cambia: i ruoli nei casi
 * restano in `uc_case_members`, scritti dai comandi dei casi (`addCaseMember`, `removeCaseMember`).
 *
 * `src/lib/db/use-case-hub-team-ddl.test.ts` controlla che la migrazione li contenga tutti, nello stesso ordine, che
 * il CHECK sia l'elenco qui sotto e che la sonda copra ogni oggetto.
 * Modulo puro.
 */

/** I ruoli di un caso che si danno per workspace: quelli di chi costruisce (Lateral Space). */
export const WORKSPACE_TEAM_ROLES = ["ls_lead", "ls_analista", "ls_sviluppatore"] as const;
export type WorkspaceTeamRole = (typeof WORKSPACE_TEAM_ROLES)[number];

/** La chiave dell'advisory lock della 0035: la stessa nel file e in `runWorkspaceTeamDdl`. */
export const WORKSPACE_TEAM_ADVISORY_LOCK = "unbundle:use-case-workspace-team-ddl";

const quoted = (values: readonly string[]) => values.map((value) => `'${value}'`).join(", ");

/** Gli statement della 0035 dopo le due righe di apertura, nell'ordine del file. */
export const WORKSPACE_TEAM_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS use_case_workspace_team (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role varchar(16) NOT NULL CONSTRAINT use_case_workspace_team_role_check CHECK (role IN (${quoted(WORKSPACE_TEAM_ROLES)})),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT use_case_workspace_team_pkey PRIMARY KEY (id),
  CONSTRAINT use_case_workspace_team_unique UNIQUE (workspace_id, user_id)
);`,
];

// ─── Sonda ───────────────────────────────────────────────────────────

export const WORKSPACE_TEAM_TABLES = ["use_case_workspace_team"] as const;

export const WORKSPACE_TEAM_NAMED_CONSTRAINTS = ["use_case_workspace_team_role_check", "use_case_workspace_team_pkey", "use_case_workspace_team_unique"] as const;

/** Vera solo se la tabella della 0035 e i suoi vincoli con nome ci sono. */
export const WORKSPACE_TEAM_PROBE_SQL = `(
  to_regclass('public.use_case_workspace_team') IS NOT NULL
  AND (
    SELECT count(*) FROM pg_constraint
    WHERE conrelid = to_regclass('public.use_case_workspace_team')
      AND conname IN (${quoted(WORKSPACE_TEAM_NAMED_CONSTRAINTS)})
  ) = ${WORKSPACE_TEAM_NAMED_CONSTRAINTS.length}
)`;
