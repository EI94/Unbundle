/**
 * La lettura di base di ogni pagina del dossier, in un solo giro (DESIGN §7.1
 * P0-5c, budget di P0-5e): la riga dell'accesso (utente, caso del workspace e
 * ruoli di caso salvati) insieme alla testata (caso, scheda madre, prossimo
 * passo e firme in attesa, `uc-header.ts`). Prima erano due giri in fila:
 * l'accesso, poi la testata. Il layout e la pagina della stessa richiesta la
 * fanno una volta (`cache()` di `components/uc/shell/case-data.ts`).
 *
 * Leggere la testata insieme all'accesso non mostra nulla a chi non può: le
 * righe restano sul server, e la pagina risponde 404 se la riga dell'accesso
 * non dà ruoli (`caseAccessFromRow` di `uc-access.ts`). Gli id arrivano già
 * controllati (UUID) e in minuscolo.
 *
 * Modulo senza import dell'app, come `uc-header.ts`: lo usano anche i test di
 * integrazione.
 */
import { cast, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import type { UcExecutor, UcRow } from "../uc-executor.ts";
import { caseHeaderStatements } from "./uc-header.ts";

/** Utente, caso e ruoli di caso salvati, come li legge `caseAccessFromRow`. */
export interface CaseAccessRow {
  userId: string;
  email: string | null;
  emailVerified: Date | string | null;
  /** Null se il caso non c'è, non è di questo workspace o non è pronto (`setup_completed_at`). */
  id: string | null;
  workspaceId: string | null;
  code: string | null;
  title: string | null;
  status: string | null;
  roles: string[] | string | null;
}

/** Utente, caso e ruoli in una sola istruzione (P0-5c). Nessuna riga se l'utente non c'è. */
export function caseAccessRowSql(workspaceId: string, caseId: string, userId: string): UcStatement {
  return toStatement(ucSql`SELECT u.id AS "userId", u.email, u.email_verified AS "emailVerified",
  c.id, c.workspace_id AS "workspaceId", c.code, c.title, c.status,
  CASE WHEN c.id IS NULL THEN NULL ELSE coalesce(
    (SELECT array_agg(m.role ORDER BY m.role) FROM uc_case_members m WHERE m.case_id = c.id AND m.user_id = u.id), '{}') END AS roles
FROM users u
LEFT JOIN uc_cases c ON c.id = ${cast(caseId, "uuid")}
  AND c.workspace_id = ${cast(workspaceId, "uuid")}
  AND c.setup_completed_at IS NOT NULL
WHERE u.id = ${cast(userId, "uuid")}`);
}

export function toCaseAccessRow(row: UcRow | undefined): CaseAccessRow | null {
  return row ? (row as unknown as CaseAccessRow) : null;
}

export interface DossierBaseRows {
  access: CaseAccessRow | null;
  /** Le righe di `caseHeaderStatements`, per `caseHeaderFromRows`. */
  headerRows: UcRow[][];
}

/** Accesso e testata in un batch: una richiesta, una transazione. */
export async function loadDossierBaseRows(executor: UcExecutor, i: { workspaceId: string; caseId: string; userId: string }): Promise<DossierBaseRows> {
  const [accessRows, ...headerRows] = await executor.batch([caseAccessRowSql(i.workspaceId, i.caseId, i.userId), ...caseHeaderStatements(i)]);
  return { access: toCaseAccessRow(accessRows[0]), headerRows };
}
