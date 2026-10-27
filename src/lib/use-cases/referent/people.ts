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
import { cast, raw, toStatement, ucSql, type SqlFragment, type UcStatement } from "../../uc/sql/statement.ts";
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
  /** (Referente già iscritto) Ha un ruolo qualsiasi nel workspace, adesso (anche `learner` o `contributor`). */
  member: boolean;
  /**
   * (Referente già iscritto) Membro del workspace che non è revisore (corsista, contributore), con l'email
   * verificata uguale a quella del contatto: l'email al referente dice «Hai già un account Unbundle: per
   * rispondere non serve entrare, basta questo link.». Mai un link alla dashboard; nessun accesso in più.
   */
  accountNotice: boolean;
}

export const NO_PERSON: ReferentPerson = Object.freeze({ userId: null, reviewer: false, teamAccess: false, member: false, accountNotice: false });

export function referentPersonOf(f: ReferentPersonFacts | null | undefined): ReferentPerson {
  if (!f || !f.userId || !UUID.test(f.userId)) return NO_PERSON;
  const reviewer = canReviewWorkspacePortfolio(f.role);
  const member = typeof f.role === "string" && f.role.length > 0;
  return { userId: f.userId.toLowerCase(), reviewer, teamAccess: reviewer && f.verifiedEmailMatch, member, accountNotice: member && !reviewer && f.verifiedEmailMatch };
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

const ALIAS = /^[a-z][a-z0-9_]{0,30}$/;

/**
 * «L'account `user` è la persona del contatto `contact`»: il collegamento esplicito vince; senza
 * collegamento, la stessa email verificata (senza maiuscole e spazi). L'unica regola, usata da
 * `contactPeopleSql` e da `requestReferentUserSql`.
 */
function personMatch(contact: string, user: string): string {
  if (!ALIAS.test(contact) || !ALIAS.test(user)) throw new Error("Alias non valido");
  return `(${contact}.user_id IS NOT NULL AND ${user}.id = ${contact}.user_id)
     OR (${contact}.user_id IS NULL AND ${contact}.email IS NOT NULL AND ${user}.email_verified IS NOT NULL AND lower(btrim(${user}.email)) = lower(btrim(${contact}.email)))`;
}

/**
 * L'account della persona del referente della richiesta con alias `request` (colonne `contact_id` e
 * `workspace_id`), oppure NULL senza account. Letto nella stessa SQL che scrive le righe, quindi al
 * momento dell'evento (mai salvato). Serve a non mandare «Nessuna risposta» (campanella e avviso a
 * chi ha chiesto) alla persona che non ha risposto: un revisore referente non riceve l'avviso della
 * propria richiesta. Per chi non è revisore non cambia niente (non riceve comunque quelle righe).
 */
export function requestReferentUserSql(request: string): SqlFragment {
  if (!ALIAS.test(request)) throw new Error("Alias non valido");
  return raw(`(SELECT rpu.id FROM uc_contacts rpc JOIN users rpu ON ${personMatch("rpc", "rpu")}
  WHERE rpc.id = ${request}.contact_id AND rpc.workspace_id = ${request}.workspace_id LIMIT 1)`);
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
  WHERE ${raw(personMatch("c", "pu"))}
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

// ─── Referente già iscritto (27/10): le persone del workspace nel selettore ─────────────────

/**
 * Chi guarda può già vedere le persone del workspace (Impostazioni › Persone, «Chi ha accesso»)? La
 * pagina delle impostazioni si apre a ogni ruolo tranne `learner` (`requireWorkspacePage`) e lì
 * l'elenco mostra nome ed email di chi ha accesso, tutti tranne i partecipanti ai corsi. Il selettore
 * di «Chiedi al referente» mostra le stesse persone e niente di più, solo a chi le vede già.
 */
export function canSeeWorkspacePeople(role: string | null | undefined): boolean {
  return typeof role === "string" && role.length > 0 && role !== "learner";
}

/**
 * Le persone che il selettore può proporre: account con l'email verificata e un ruolo nel workspace
 * diverso da `learner` (le stesse di «Chi ha accesso»). Un partecipante ai corsi non è nell'elenco:
 * chi guarda non lo vede in Impostazioni, quindi non lo vede nemmeno qui (si riconosce solo quando
 * qualcuno scrive la sua email in «+ Nuovo referente»). Con `userId` una persona sola (il server
 * ricontrolla la scelta). Nessun ORDER BY: l'ordine lo dà `pickerMembersOf`.
 */
export function workspaceMembersSql(workspaceId: string, userId: string | null = null): UcStatement {
  const ws = cast(uuid(workspaceId, "workspace"), "uuid");
  const one = userId === null ? raw("") : ucSql` AND pu.id = ${cast(uuid(userId, "persona"), "uuid")}`;
  return toStatement(ucSql`SELECT m.user_id, m.name, m.email, m.role FROM (
  SELECT pu.id::text AS user_id, pu.name, lower(btrim(pu.email)) AS email, ${effectiveRole("pu.id", "pw0.id")} AS role
  FROM users pu JOIN workspaces pw0 ON pw0.id = ${ws}
  WHERE pu.email_verified IS NOT NULL AND pu.email IS NOT NULL AND btrim(pu.email) <> ''${one}
    AND (EXISTS (SELECT 1 FROM memberships om WHERE om.organization_id = pw0.organization_id AND om.user_id = pu.id)
      OR EXISTS (SELECT 1 FROM workspace_memberships owm WHERE owm.workspace_id = pw0.id AND owm.user_id = pu.id))
) m
WHERE m.role IS NOT NULL AND m.role <> 'learner'`);
}

/** Una persona del workspace letta da `workspaceMembersSql`. */
export interface WorkspaceMemberFacts {
  userId: string;
  name: string | null;
  email: string;
  role: string;
}

export function memberFactsOf(row: Readonly<Record<string, unknown>> | undefined): WorkspaceMemberFacts | null {
  if (!row) return null;
  const userId = typeof row.user_id === "string" && UUID.test(row.user_id) ? row.user_id.toLowerCase() : null;
  const email = typeof row.email === "string" ? row.email.trim().toLowerCase() : "";
  const role = typeof row.role === "string" ? row.role : "";
  if (!userId || !email.includes("@") || !canSeeWorkspacePeople(role)) return null;
  const name = typeof row.name === "string" ? row.name.replace(/\s+/g, " ").trim() : "";
  return { userId, name: name || null, email, role };
}

/**
 * Il nome di una persona per il selettore e per il contatto nuovo: il nome dell'account, oppure la parte
 * dell'email prima della chiocciola (come «Chi ha accesso», che senza nome mostra l'email). 2–255 caratteri.
 */
export function memberDisplayName(m: Pick<WorkspaceMemberFacts, "name" | "email">): string {
  const base = (m.name ?? "").trim();
  const name = base.length >= 2 ? base : m.email.split("@")[0] ?? "";
  return (name.length >= 2 ? name : m.email).slice(0, 255);
}

/** Quello che serve per non proporre due volte la stessa persona: i contatti del workspace. */
export interface PickerDedupe {
  /** Email (minuscole, senza spazi) dei contatti non anonimizzati, attivi o no. */
  contactEmails: ReadonlySet<string>;
  /** Account dei contatti non anonimizzati: `user_id`, oppure l'account trovato con l'email verificata. */
  contactUserIds: ReadonlySet<string>;
}

/**
 * Le persone del selettore, dopo i referenti: una per persona (mai una seconda voce per chi è già un
 * referente, per email o per account), mai chi guarda, mai Lateral Space (`isLateralSpace`), in ordine
 * alfabetico di nome. Art. 15.4: nessun conteggio e nessun ruolo; l'unica informazione in più è
 * «Fa parte del team» per i revisori, la stessa dei referenti.
 */
export function pickerMembersOf(
  members: readonly WorkspaceMemberFacts[],
  o: { viewerUserId: string | null; dedupe: PickerDedupe; isLateralSpace: (m: WorkspaceMemberFacts) => boolean },
): { userId: string; displayName: string; email: string; team: boolean }[] {
  const viewer = o.viewerUserId?.toLowerCase() ?? null;
  const seen = new Set<string>();
  const out: { userId: string; displayName: string; email: string; team: boolean }[] = [];
  for (const m of members) {
    if (seen.has(m.userId) || m.userId === viewer) continue;
    if (o.dedupe.contactUserIds.has(m.userId) || o.dedupe.contactEmails.has(m.email)) continue;
    if (!canSeeWorkspacePeople(m.role) || o.isLateralSpace(m)) continue;
    seen.add(m.userId);
    out.push({ userId: m.userId, displayName: memberDisplayName(m), email: m.email, team: canReviewWorkspacePortfolio(m.role) });
  }
  const collator = new Intl.Collator("it", { sensitivity: "base" });
  return out.sort((a, b) => collator.compare(a.displayName, b.displayName) || (a.userId < b.userId ? -1 : a.userId > b.userId ? 1 : 0));
}

/**
 * Collega un contatto **appena creato dall'hub** al suo account (`uc_contacts.user_id`), solo se manca e
 * solo se l'account ha l'email verificata uguale (senza maiuscole e spazi) a quella del contatto: lo
 * stesso controllo dentro la SQL, così una corsa non collega mai la persona sbagliata. Se non combacia
 * non fa niente (non fallisce): la persona si ritrova comunque all'invio con l'email verificata.
 * Mai su un contatto esistente: i contatti sono condivisi con i dossier e l'hub non li modifica.
 */
export function linkNewContactUserSql(workspaceId: string, contactId: string, userId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_contacts c SET user_id = lu.id, updated_at = now()
FROM users lu
WHERE c.id = ${cast(uuid(contactId, "referente"), "uuid")} AND c.workspace_id = ${cast(uuid(workspaceId, "workspace"), "uuid")}
  AND c.user_id IS NULL AND c.anonymized_at IS NULL AND c.email IS NOT NULL
  AND lu.id = ${cast(uuid(userId, "persona"), "uuid")} AND lu.email_verified IS NOT NULL AND lower(btrim(lu.email)) = lower(btrim(c.email))
RETURNING c.id`);
}

/**
 * «Correggi l'email» di un contatto **solo dell'hub**: il collegamento all'account segue l'indirizzo
 * nuovo. Diventa l'account con quell'email verificata se è membro del workspace, altrimenti NULL; così
 * un collegamento vecchio non porta mai alla persona di prima. Va nel batch dopo l'aggiornamento
 * dell'email e dopo `contactHubOnlySql` (un contatto anche dei dossier non arriva mai qui).
 */
export function relinkCorrectedContactSql(workspaceId: string, contactId: string): UcStatement {
  return toStatement(ucSql`UPDATE uc_contacts c SET user_id = (
    SELECT ru.id FROM users ru
    WHERE ru.email_verified IS NOT NULL AND c.email IS NOT NULL AND lower(btrim(ru.email)) = lower(btrim(c.email))
      AND ${effectiveRole("ru.id", "c.workspace_id")} IS NOT NULL
    LIMIT 1
  ), updated_at = now()
WHERE c.id = ${cast(uuid(contactId, "referente"), "uuid")} AND c.workspace_id = ${cast(uuid(workspaceId, "workspace"), "uuid")} AND c.anonymized_at IS NULL
RETURNING c.id`);
}
