/**
 * Autorizzazione ai sub-responsabili di Lateral Space (GDPR art. 28, par. 2):
 * lettura dello stato e dichiarazione, su `uc_subprocessor_acks`.
 *
 * Modulo senza import dell'app (`@/…`, `server-only`), come `uc-cases.ts`:
 * l'esecutore arriva da fuori (app: `await getAppUcExecutor()` dopo
 * `ensureUcAvailable()`; test: un esecutore sul database del harness). Il
 * ruolo nel workspace si ricalcola qui dal database, con la stessa regola di
 * `getWorkspaceAccessForUser` (`src/lib/workspace-access.ts`): prima il ruolo
 * nell'organizzazione del workspace, poi quello nel workspace.
 */
import { userContextFrom } from "../../uc/lateral-space.ts";
import { SUBPROCESSORS_VERSION, checkSubprocessorDeclaration, subprocessorsRecordText } from "../../uc/legal/subprocessors.ts";
import { isUuid } from "../../uc/ids.ts";
import { rowDate, rowString } from "../../uc/sql/readiness.ts";
import { cast, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import { fail, ok, type Result } from "../../uc/types.ts";
import type { UcExecutor, UcRow } from "../uc-executor.ts";

export interface SubprocessorAck {
  listVersion: string;
  declaredAt: Date;
  declaredByName: string;
  declaredByRole: string;
}

function ackStatement(workspaceId: string, version: string): UcStatement {
  return toStatement(ucSql`SELECT a.list_version, a.declared_at, a.declared_by_role,
  coalesce(nullif(btrim(u.name), ''), u.email) AS declared_by_name
FROM uc_subprocessor_acks a
JOIN users u ON u.id = a.declared_by_user_id
WHERE a.workspace_id = ${cast(workspaceId, "uuid")} AND a.list_version = ${cast(version, "text")}
ORDER BY a.declared_at
LIMIT 1`);
}

function toAck(row: UcRow | undefined): SubprocessorAck | null {
  const declaredAt = rowDate(row?.declared_at);
  if (!row || !declaredAt) return null;
  return {
    listVersion: rowString(row.list_version) ?? "",
    declaredAt,
    declaredByName: rowString(row.declared_by_name) ?? "",
    declaredByRole: rowString(row.declared_by_role) ?? "",
  };
}

/** L'autorizzazione del workspace per la versione corrente dell'elenco, se c'è. */
export async function loadSubprocessorAck(executor: UcExecutor, workspaceId: string): Promise<SubprocessorAck | null> {
  if (!isUuid(workspaceId)) return null;
  const [rows] = await executor.batch([ackStatement(workspaceId, SUBPROCESSORS_VERSION)]);
  return toAck(rows[0]);
}

const NOT_FOUND = "Workspace non trovato o non accessibile.";

/**
 * Registra l'autorizzazione. Rifiuta chi non è una persona del cliente con un
 * ruolo ammesso, una versione dell'elenco diversa da quella corrente e la
 * casella non spuntata. Dichiarare di nuovo la stessa versione riesce senza
 * aggiungere righe (`created: false`).
 */
export async function declareSubprocessors(
  executor: UcExecutor,
  i: { workspaceId: string; userId: string; lsDomains: readonly string[]; listVersion: unknown; confirmed: unknown },
): Promise<Result<{ ack: SubprocessorAck; created: boolean }>> {
  if (!isUuid(i.workspaceId) || !isUuid(i.userId)) return fail("non_trovato", NOT_FOUND);
  const [[row]] = await executor.batch([
    toStatement(ucSql`SELECT u.id, u.email, u.email_verified, w.name AS workspace_name,
  coalesce(
    (SELECT m.role::text FROM memberships m WHERE m.user_id = u.id AND m.organization_id = w.organization_id LIMIT 1),
    (SELECT wm.role::text FROM workspace_memberships wm WHERE wm.user_id = u.id AND wm.workspace_id = w.id LIMIT 1)
  ) AS workspace_role
FROM users u CROSS JOIN workspaces w
WHERE u.id = ${cast(i.userId, "uuid")} AND w.id = ${cast(i.workspaceId, "uuid")}`),
  ]);
  const workspaceRole = rowString(row?.workspace_role);
  if (!row || !workspaceRole) return fail("non_trovato", NOT_FOUND);

  const user = userContextFrom(
    { id: String(row.id), email: rowString(row.email), emailVerified: (row.email_verified as Date | string | null) ?? null },
    i.lsDomains,
  );
  const check = checkSubprocessorDeclaration({ user, workspaceRole, lsDomains: i.lsDomains, listVersion: i.listVersion, confirmed: i.confirmed });
  if (!check.ok) return check;

  const [inserted, current] = await executor.batch([
    toStatement(ucSql`INSERT INTO uc_subprocessor_acks (workspace_id, list_version, statement_text, declared_by_user_id, declared_by_role)
VALUES (${cast(i.workspaceId, "uuid")}, ${cast(SUBPROCESSORS_VERSION, "text")}, ${cast(subprocessorsRecordText(rowString(row.workspace_name)), "text")},
  ${cast(i.userId, "uuid")}, ${cast(workspaceRole, "text")})
ON CONFLICT (workspace_id, list_version) DO NOTHING
RETURNING id`),
    ackStatement(i.workspaceId, SUBPROCESSORS_VERSION),
  ]);
  const ack = toAck(current[0]);
  if (!ack) return fail("non_disponibile", "Autorizzazione non registrata. Riprova.");
  return ok({ ack, created: inserted.length > 0 });
}
