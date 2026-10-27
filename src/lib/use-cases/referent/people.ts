/**
 * Ruoli che si sovrappongono (SPEC Parte 3, §P3.1): chi è, in Unbundle, il referente di un contatto.
 *
 * Un referente è una riga di `uc_contacts`. Il contatto porta a una persona di Unbundle in due modi,
 * in quest'ordine: il collegamento esplicito `uc_contacts.user_id`, oppure, senza collegamento, un
 * account con la stessa email **verificata**. Della persona si legge solo il ruolo effettivo nel
 * workspace (prima l'organizzazione, poi il workspace: come `getWorkspaceAccessForUser`).
 *
 * A cosa serve, e a niente altro:
 * - sapere se il referente è un revisore del workspace adesso (`reviewer`): solo così l'email al
 *   referente aggiunge il link alla scheda (`teamAccess`, che vuole anche l'email verificata uguale a
 *   quella del contatto) e il selettore mostra «Fa parte del team»;
 * - sapere chi agisce quando risponde dal link (`userId`), per non mandargli la notifica di quello
 *   che ha fatto lui;
 * - riconoscere chi chiede a se stesso.
 *
 * Essere referente non dà accesso a niente: quello che una persona vede dipende solo dal suo ruolo.
 * Nessun dato dei corsi entra qui. Si ricalcola a ogni invio e a ogni notifica, mai
 * salvato: un ruolo cambiato o un'appartenenza tolta valgono subito.
 *
 * Art. 15.4: nessun ORDER BY, GROUP BY o conteggio; una riga per contatto. Modulo puro.
 */
import { cast, raw, toStatement, ucSql, type UcStatement } from "../../uc/sql/statement.ts";
import { canReviewWorkspacePortfolio } from "../../workspace-permissions.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(value: string, what: string): string {
  if (typeof value !== "string" || !UUID.test(value)) throw new Error(`Id non valido (${what})`);
  return value.toLowerCase();
}

/** Quello che il database dice della persona di un contatto (o di un'email), letto adesso. */
export interface ReferentPersonFacts {
  /** L'account: `uc_contacts.user_id`, oppure l'account con la stessa email verificata; null senza account. */
  userId: string | null;
  /** Il ruolo effettivo nel workspace (organizzazione, poi workspace); null se non è membro. */
  role: string | null;
  /** L'account ha l'email verificata uguale (senza maiuscole e spazi) a quella del contatto. */
  verifiedEmailMatch: boolean;
}

/** Le decisioni che ne seguono. Mai salvate, mai mostrate oltre a «Fa parte del team». */
export interface ReferentPerson {
  userId: string | null;
  /** Un ruolo da revisore (`PORTFOLIO_REVIEWER_ROLES`) nel workspace, adesso. */
  reviewer: boolean;
  /** Revisore con l'email verificata uguale a quella del contatto: l'email può portare il link alla scheda. */
  teamAccess: boolean;
}

export const NO_PERSON: ReferentPerson = Object.freeze({ userId: null, reviewer: false, teamAccess: false });

export function referentPersonOf(f: ReferentPersonFacts | null | undefined): ReferentPerson {
  if (!f || !f.userId || !UUID.test(f.userId)) return NO_PERSON;
  const reviewer = canReviewWorkspacePortfolio(f.role);
  return { userId: f.userId.toLowerCase(), reviewer, teamAccess: reviewer && f.verifiedEmailMatch };
}

/** Chi chiede ha scelto se stesso: niente email, risponde direttamente in «Cosa serve». */
export function isSelfRequest(person: ReferentPerson, requesterUserId: string | null | undefined): boolean {
  return Boolean(person.userId && requesterUserId && person.userId === requesterUserId.toLowerCase());
}

/** Il ruolo effettivo di `userColumn` nel workspace `workspaceColumn` (prima l'organizzazione). */
function effectiveRole(userColumn: string, workspaceColumn: string) {
  return raw(`coalesce(
      (SELECT pm.role::text FROM memberships pm JOIN workspaces pw ON pw.organization_id = pm.organization_id
        WHERE pw.id = ${workspaceColumn} AND pm.user_id = ${userColumn} LIMIT 1),
      (SELECT pwm.role::text FROM workspace_memberships pwm WHERE pwm.workspace_id = ${workspaceColumn} AND pwm.user_id = ${userColumn} LIMIT 1)
    )`);
}

/**
 * Una riga per contatto (`contact_id`, `user_id`, `role`, `email_match`), anche senza account. Solo
 * contatti del workspace; l'account collegato vince sull'email.
 */
export function contactPeopleSql(workspaceId: string, contactIds: readonly string[]): UcStatement {
  const ids = contactIds.map((x) => uuid(x, "referente"));
  return toStatement(ucSql`SELECT c.id::text AS contact_id, p.user_id::text AS user_id, p.role, coalesce(p.email_match, false) AS email_match
FROM uc_contacts c
LEFT JOIN LATERAL (
  SELECT pu.id AS user_id,
    (pu.email_verified IS NOT NULL AND c.email IS NOT NULL AND lower(btrim(pu.email)) = lower(btrim(c.email))) AS email_match,
    ${effectiveRole("pu.id", "c.workspace_id")} AS role
  FROM users pu
  WHERE (c.user_id IS NOT NULL AND pu.id = c.user_id)
     OR (c.user_id IS NULL AND c.email IS NOT NULL AND pu.email_verified IS NOT NULL AND lower(btrim(pu.email)) = lower(btrim(c.email)))
  LIMIT 1
) p ON true
WHERE c.workspace_id = ${cast(uuid(workspaceId, "workspace"), "uuid")} AND c.id = ANY(${cast(ids, "uuid[]")})`);
}

/** La persona di un'email non ancora tra i contatti (il referente nuovo): solo un account con quell'email verificata. */
export function emailPersonSql(workspaceId: string, email: string): UcStatement {
  return toStatement(ucSql`SELECT pu.id::text AS user_id, ${effectiveRole("pu.id", "pw0.id")} AS role, true AS email_match
FROM users pu JOIN workspaces pw0 ON pw0.id = ${cast(uuid(workspaceId, "workspace"), "uuid")}
WHERE pu.email_verified IS NOT NULL AND lower(btrim(pu.email)) = lower(btrim(${cast(email, "text")}))
LIMIT 1`);
}

/** Una riga del database → i fatti. */
export function personFactsOf(row: Readonly<Record<string, unknown>> | undefined): ReferentPersonFacts | null {
  if (!row) return null;
  const userId = typeof row.user_id === "string" && UUID.test(row.user_id) ? row.user_id.toLowerCase() : null;
  const role = typeof row.role === "string" && row.role ? row.role : null;
  return { userId, role, verifiedEmailMatch: row.email_match === true || row.email_match === "t" };
}
