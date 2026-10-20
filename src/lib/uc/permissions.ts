/**
 * Permessi e quattro occhi della sezione «Casi d'uso» (PIANO §3.3, D11, D44,
 * D45).
 *
 * - Chi ha risposto (in una qualsiasi versione) non valida.
 * - Il dato si valida solo se l'ha dato o confermato chi lo possiede.
 * - «Non applicabile», deroghe, ripieghi e gate richiedono una firma di
 *   Lateral Space e una del cliente.
 *
 * Modulo puro: import relativi `.ts`, nessun accesso a DB o ambiente. I comandi
 * ricalcolano qui i permessi a ogni azione, con lo stato letto dal database.
 */
import { caseRoleAllowedFor, emailDomain } from "./lateral-space.ts";
import { fail, ok, type Actor, type Approval, type ItemSnapshot, type Result, type UserContext } from "./types.ts";
import {
  CLIENT_CASE_ROLES,
  LS_CASE_ROLES,
  PERSONAL_PRIVACY_CLASSES,
  type AnswerKind,
  type BlockerStatus,
  type CaseRole,
  type PrivacyClass,
  type ResponseType,
  type ValueVisibility,
} from "./vocab.ts";

// ── Chi agisce ────────────────────────────────────────────────────────

/**
 * Classi di attore usate dalle tabelle di transizione: sistema, referente dal
 * link, ls_lead, ls_analista e firma del cliente (utente `owner_cliente`
 * oppure link di approvazione dell'Owner designato).
 */
export type ActorClass = "sistema" | "referente" | "ls_lead" | "ls_analista" | "cliente";

/**
 * Classi dell'attore. Se si passa `user`, i ruoli si ricalcolano adesso: un
 * ruolo `ls_*` vale solo per un utente Lateral Space, `owner_cliente` solo per
 * gli altri (D36).
 */
export function actorClasses(actor: Actor, user?: UserContext | null): Set<ActorClass> {
  const out = new Set<ActorClass>();
  switch (actor.type) {
    case "sistema":
      out.add("sistema");
      break;
    case "referente":
      out.add("referente");
      break;
    case "owner_link":
      if (actor.designation === "owner") out.add("cliente");
      break;
    case "utente": {
      if (user && user.userId !== actor.userId) return out;
      const valid = (role: CaseRole) => actor.roles.includes(role) && (!user || caseRoleAllowedFor(user, role));
      if (valid("ls_lead")) out.add("ls_lead");
      if (valid("ls_analista")) out.add("ls_analista");
      if (valid("owner_cliente")) out.add("cliente");
      break;
    }
  }
  return out;
}

// ── Validazione: guardie 1–10 ─────────────────────────────────────────

/** Risposte che non sono un dato da validare. */
const NOT_VALIDATABLE: readonly AnswerKind[] = ["non_so", "delega", "proposta_na"];

/**
 * Tipi base il cui valore è già testo da confermare: per loro una risposta
 * senza `value_normalized` resta validabile (guardia 10).
 */
export const TEXTUAL_RESPONSE_TYPES: readonly ResponseType[] = ["testo", "conferma_regola", "conferma_formula", "file", "tabella"];

/**
 * Il ruolo del titolare del dato è soddisfatto? Vale il ruolo di chi ha risposto
 * (`acting_role_key` della richiesta, ereditato nelle deleghe) oppure di chi ha
 * confermato.
 */
export function ownerRoleSatisfied(item: Pick<ItemSnapshot, "ownerRoleKey" | "responderRoleKey" | "confirmedByRoleKey">): boolean {
  if (!item.ownerRoleKey) return true;
  return item.responderRoleKey === item.ownerRoleKey || item.confirmedByRoleKey === item.ownerRoleKey;
}

/**
 * Può `actorUserId` validare la voce adesso (righe 16 e 18)? Tutte le guardie:
 *
 * 1. ruolo `ls_lead` o `ls_analista` (ricalcolato con `user`, se passato);
 * 2. non ha risposto in nessuna versione della voce;
 * 3. c'è una risposta corrente che è un dato (non «Non lo so», delega, proposta NA);
 * 4. nessun controllo automatico in errore;
 * 5. il dato viene da un contatto o è confermato da un contatto; per le voci must
 *    con titolare, dal ruolo titolare;
 * 6. `conferma_regola` con titolare: confermata dal ruolo titolare;
 * 7. periodo di validità presente se richiesto;
 * 8. nessun chiarimento aperto;
 * 9. non ha copiato un link della richiesta da cui viene la risposta;
 * 10. il valore è tipizzato.
 */
export function canValidate(item: ItemSnapshot, actorUserId: string, roles: readonly CaseRole[], user?: UserContext | null): Result<void> {
  // 1
  const lsRole = (["ls_lead", "ls_analista"] as const).some(
    (r) => roles.includes(r) && (!user || (user.userId === actorUserId && caseRoleAllowedFor(user, r))),
  );
  if (!lsRole) return fail("ruolo_non_ammesso", "Solo il Responsabile del caso o un analista di Lateral Space possono validare.");
  const answer = item.currentAnswer;
  // 2
  if (item.answerResponderUserIds.includes(actorUserId) || answer?.responderUserId === actorUserId) {
    return fail("stessa_persona", "Hai inserito tu una risposta su questa voce: deve validarla un'altra persona.");
  }
  // 3
  if (!answer) return fail("risposta_assente", "Non c'è ancora una risposta da validare.");
  if (NOT_VALIDATABLE.includes(answer.kind)) {
    return fail("risposta_non_validabile", "Questa risposta non è un dato da validare.");
  }
  // 4
  if (item.lastAutoCheckError) return fail("controllo_automatico_errore", "Un controllo automatico ha trovato un errore: va corretto prima.");
  // 5
  if (!answer.responderContactId && !item.confirmedByContactId) {
    return fail("conferma_titolare_mancante", "Il dato va confermato da chi lo possiede: chiedi una conferma al referente.");
  }
  if (item.priority === "must" && !ownerRoleSatisfied(item)) {
    return fail("ruolo_titolare_diverso", "Il dato va confermato dal ruolo che lo possiede: chiedi una conferma al referente giusto.");
  }
  // 6
  if (item.responseType === "conferma_regola" && !ownerRoleSatisfied(item)) {
    return fail("ruolo_titolare_diverso", "La regola va confermata dal ruolo che la possiede.");
  }
  // 7
  if (item.requiresValidityPeriod && !answer.validFrom) {
    return fail("validita_mancante", "Manca la data da cui vale il dato.");
  }
  // 8
  if (item.openClarification) return fail("chiarimento_aperto", "C'è un chiarimento ancora aperto.");
  // 9
  if (item.currentAnswerTokenIssuerUserIds.includes(actorUserId)) {
    return fail("link_copiato_da_te", "Hai copiato tu il link da cui è arrivata la risposta: deve validarla un'altra persona.");
  }
  // 10
  const textual = item.responseType !== null && TEXTUAL_RESPONSE_TYPES.includes(item.responseType);
  if (!answer.typed && !textual) {
    return fail("valore_non_tipizzato", "Il valore è scritto a parole: va inserito nel formato richiesto prima di validarlo.");
  }
  return ok(undefined);
}

// ── Firme di «non applicabile» ────────────────────────────────────────

/**
 * Stato delle due firme NA: Lateral Space (ls_lead) e cliente (utente o link).
 * Con `designatedOwnerContactId` passato (anche `null`), la firma dal link vale
 * solo se il contatto è ancora l'Owner designato: un cambio di designazione
 * annulla le firme in attesa (§3.3).
 */
export function naSignatures(item: Pick<ItemSnapshot, "na">, designatedOwnerContactId?: string | null): { ls: boolean; client: boolean; complete: boolean } {
  const ls = Boolean(item.na.lsUserId);
  const link = Boolean(item.na.clientContactId) && (designatedOwnerContactId === undefined || designatedOwnerContactId === item.na.clientContactId);
  const client = Boolean(item.na.clientUserId) || link;
  return { ls, client, complete: ls && client };
}

/**
 * Firma NA dal link di un contatto che non è più l'Owner designato, su una NA
 * ancora in attesa: va cancellata (`na_approved_by_contact_id = null`) nello
 * stesso batch del cambio di designazione o dell'email. Null se non c'è niente da fare.
 */
export function staleNaLinkSignaturePatch(item: Pick<ItemSnapshot, "na">, designatedOwnerContactId: string | null): { naApprovedByContactId: null } | null {
  const contactId = item.na.clientContactId;
  if (!contactId || item.na.approvedAt || contactId === designatedOwnerContactId) return null;
  return { naApprovedByContactId: null };
}

// ── Chi è Lateral Space e quali ruoli può avere (D36) ─────────────────

const isLsRole = (role: CaseRole) => (LS_CASE_ROLES as readonly string[]).includes(role);
const isClientRole = (role: CaseRole) => (CLIENT_CASE_ROLES as readonly string[]).includes(role);

/**
 * Il ruolo vale per questo utente? `ls_*` solo per utenti Lateral Space,
 * `owner_cliente`, `approvatore_privacy` e `ai_board` solo per gli altri,
 * `osservatore` per entrambi. Si controlla in creazione, in `addMember` e a ogni
 * firma, con `isLateralSpace` ricalcolato: senza `UC_LS_EMAIL_DOMAINS` nessuno è
 * Lateral Space e nessun ruolo `ls_*` è assegnabile.
 */
export function assertRoleAllowed(u: UserContext, role: CaseRole, lsDomains?: readonly string[]): Result<void> {
  if (caseRoleAllowedFor(u, role, lsDomains)) return ok(undefined);
  if (isLsRole(role)) {
    return fail("ruolo_solo_lateral_space", "Questo ruolo è solo per le persone di Lateral Space con email verificata.");
  }
  return fail("ruolo_solo_cliente", "Questo ruolo è solo per le persone del cliente con email verificata.");
}

/** Mai un ruolo `ls_*` e uno del cliente sulla stessa persona. */
export function assertNoRoleConflict(roles: readonly CaseRole[]): Result<void> {
  if (roles.some(isLsRole) && roles.some(isClientRole)) {
    return fail("conflitto_ruoli", "La stessa persona non può avere un ruolo di Lateral Space e uno del cliente.");
  }
  return ok(undefined);
}

/** Tutti i ruoli di un membro: nessun conflitto e ognuno ammesso per l'utente. */
export function assertMemberRoles(u: UserContext, roles: readonly CaseRole[], lsDomains?: readonly string[]): Result<void> {
  const conflict = assertNoRoleConflict(roles);
  if (!conflict.ok) return conflict;
  for (const role of roles) {
    const allowed = assertRoleAllowed(u, role, lsDomains);
    if (!allowed.ok) return allowed;
  }
  return ok(undefined);
}

/** Chi crea un caso: utente Lateral Space con `canReviewWorkspacePortfolio`. Diventa `ls_lead`. */
export function checkCaseCreator(i: { user: UserContext; canReviewWorkspacePortfolio: boolean }): Result<void> {
  if (!i.user.isLateralSpace) return fail("ruolo_solo_lateral_space", "Solo Lateral Space crea i casi d'uso.");
  if (!i.canReviewWorkspacePortfolio) return fail("permesso_mancante", "Serve il permesso di revisione del portafoglio del workspace.");
  return ok(undefined);
}

/**
 * Email di un firmatario del cliente (Owner o approvatore privacy designato):
 * non di un dominio Lateral Space e non uguale all'email di un membro Lateral
 * Space del caso. Si ricontrolla a ogni firma.
 */
export function checkSignerEmail(email: string | null | undefined, lsDomains: readonly string[], lsMemberEmails: readonly string[]): Result<void> {
  const domain = emailDomain(email);
  if (!email || !domain) return fail("email_non_valida", "Il firmatario del cliente deve avere un'email valida.");
  if (lsDomains.includes(domain)) {
    return fail("firmatario_lateral_space", "Il firmatario del cliente non può avere un'email di Lateral Space.");
  }
  const normalized = email.trim().toLowerCase();
  if (lsMemberEmails.some((m) => m.trim().toLowerCase() === normalized)) {
    return fail("firmatario_lateral_space", "Il firmatario del cliente non può essere una persona di Lateral Space del caso.");
  }
  return ok(undefined);
}

/**
 * Email (e account collegato) di un referente del cliente: alla creazione del
 * contatto, al cambio dell'email e all'assegnazione. Il referente è una persona
 * del cliente: con un indirizzo di Lateral Space, o di un membro Lateral Space
 * del caso, Lateral Space risponderebbe «come cliente» e un collega validerebbe
 * (spec ruoli, privacy 13; stessa regola delle deleghe). Senza email il contatto
 * resta ammesso: il link si copia a mano.
 */
export function checkContactEmail(i: {
  email: string | null | undefined;
  /** Account collegato al contatto (`uc_contacts.user_id`), se c'è. */
  user?: Pick<UserContext, "isLateralSpace" | "emailDomain"> | null;
  lsDomains: readonly string[];
  lsMemberEmails: readonly string[];
}): Result<void> {
  const lsMessage = "Il referente è una persona del cliente: non può essere di Lateral Space.";
  if (i.user && (i.user.isLateralSpace || (i.user.emailDomain !== null && i.lsDomains.includes(i.user.emailDomain)))) {
    return fail("referente_lateral_space", lsMessage);
  }
  if (i.email === null || i.email === undefined || i.email.trim() === "") return ok(undefined);
  const domain = emailDomain(i.email);
  if (!domain) return fail("email_non_valida", "Controlla l'indirizzo email del referente.");
  const normalized = i.email.trim().toLowerCase();
  if (i.lsDomains.includes(domain) || i.lsMemberEmails.some((m) => m.trim().toLowerCase() === normalized)) {
    return fail("referente_lateral_space", lsMessage);
  }
  return ok(undefined);
}

/** Assegnazione di voci a un contatto: attivo, non anonimizzato e del cliente (`checkContactEmail`). */
export function checkAssignee(i: {
  contact: { email: string | null; isActive: boolean; anonymized: boolean; user?: Pick<UserContext, "isLateralSpace" | "emailDomain"> | null };
  lsDomains: readonly string[];
  lsMemberEmails: readonly string[];
}): Result<void> {
  if (!i.contact.isActive || i.contact.anonymized) return fail("contatto_non_attivo", "Il contatto non è attivo.");
  return checkContactEmail({ email: i.contact.email, user: i.contact.user, lsDomains: i.lsDomains, lsMemberEmails: i.lsMemberEmails });
}

// ── Firme (NA, deroghe, ripieghi, gate, A.8, zona personale) ──────────

/**
 * Cosa si firma. La firma del cliente è dell'Owner (`owner_cliente`), salvo A.8,
 * zona personale e abbassamento della classe privacy, che firma l'approvatore
 * privacy. La firma di Lateral Space è sempre di `ls_lead`.
 */
export type SignaturePurpose =
  | "na"
  | "deroga"
  | "ripiego"
  | "parziale_na"
  | "gate"
  | "chiusura"
  | "a8"
  | "zona_personale"
  | "classe_privacy";

const PRIVACY_PURPOSES: readonly SignaturePurpose[] = ["a8", "zona_personale", "classe_privacy"];

/** Ruolo del cliente che firma per questo scopo. */
export function clientSignerRole(purpose: SignaturePurpose): "owner_cliente" | "approvatore_privacy" {
  return PRIVACY_PURPOSES.includes(purpose) ? "approvatore_privacy" : "owner_cliente";
}

export type Signer =
  /** Firma da account: i ruoli si ricalcolano con `user`. */
  | { kind: "account"; user: UserContext; roles: readonly CaseRole[] }
  /**
   * Firma dal link di approvazione, inviato solo per email al contatto designato.
   * `ipHash`: impronta con chiave dell'IP da cui si firma (mai l'IP), registrata nella firma.
   */
  | { kind: "link"; contactId: string; designation: "owner" | "privacy"; email: string | null; ipHash?: string | null };

export interface SignatureContext {
  lsDomains: readonly string[];
  /** Email dei membri Lateral Space del caso. */
  lsMemberEmails: readonly string[];
  /** Contatti designati con prova (`uc_cases.signers_designation`). */
  designated: { owner: string | null; privacy: string | null };
}

export type SignatureSide = "ls" | "cliente";

/** Lato di una firma già registrata. */
export function signatureSideOf(ruolo: CaseRole): SignatureSide | null {
  if (ruolo === "ls_lead") return "ls";
  if (ruolo === "owner_cliente" || ruolo === "approvatore_privacy") return "cliente";
  return null;
}

/** Per chi firma il firmatario, adesso? Ricalcola dominio, ruoli e designazione. */
export function signatureRole(signer: Signer, purpose: SignaturePurpose, ctx: SignatureContext): Result<{ side: SignatureSide; ruolo: CaseRole }> {
  const clientRole = clientSignerRole(purpose);
  if (signer.kind === "link") {
    const needed = clientRole === "approvatore_privacy" ? "privacy" : "owner";
    if (signer.designation !== needed) return fail("firmatario_non_ammesso", "Questo link non serve per questa firma.");
    if (!ctx.designated[needed] || ctx.designated[needed] !== signer.contactId) {
      return fail("firmatario_non_designato", "Il firmatario non è più quello designato dal cliente.");
    }
    const email = checkSignerEmail(signer.email, ctx.lsDomains, ctx.lsMemberEmails);
    if (!email.ok) return email;
    return ok({ side: "cliente", ruolo: clientRole });
  }
  const conflict = assertNoRoleConflict(signer.roles);
  if (!conflict.ok) return conflict;
  if (signer.roles.includes("ls_lead")) {
    const allowed = assertRoleAllowed(signer.user, "ls_lead", ctx.lsDomains);
    return allowed.ok ? ok({ side: "ls", ruolo: "ls_lead" }) : allowed;
  }
  if (signer.roles.includes(clientRole)) {
    // Firma del cliente da account: email verificata e dominio fuori da UC_LS_EMAIL_DOMAINS (D16, D36).
    const allowed = assertRoleAllowed(signer.user, clientRole, ctx.lsDomains);
    return allowed.ok ? ok({ side: "cliente", ruolo: clientRole }) : allowed;
  }
  return fail(
    "firmatario_non_ammesso",
    clientRole === "approvatore_privacy"
      ? "Firmano solo il Responsabile del caso e l'approvatore privacy del cliente."
      : "Firmano solo il Responsabile del caso e l'Owner del cliente.",
  );
}

/**
 * Aggiunge una firma all'elenco. Una firma per lato; la stessa persona non firma
 * due volte. Con `expectedTextHash` la firma vale solo sul testo atteso (es. il
 * riepilogo del gate). `complete` quando ci sono il lato Lateral Space e quello
 * del cliente.
 */
export function addSignature(i: {
  purpose: SignaturePurpose;
  approvals: readonly Approval[];
  signer: Signer;
  ctx: SignatureContext;
  now: Date;
  textHash?: string | null;
  expectedTextHash?: string | null;
  ipHash?: string | null;
}): Result<{ approvals: Approval[]; approval: Approval; complete: boolean; side: SignatureSide }> {
  const role = signatureRole(i.signer, i.purpose, i.ctx);
  if (!role.ok) return role;
  const { side, ruolo } = role.value;
  if (i.approvals.some((a) => signatureSideOf(a.ruolo) === side)) {
    return fail("firma_gia_presente", side === "ls" ? "Lateral Space ha già firmato." : "Il cliente ha già firmato.");
  }
  const signerUserId = i.signer.kind === "account" ? i.signer.user.userId : null;
  const signerContactId = i.signer.kind === "link" ? i.signer.contactId : null;
  if (i.approvals.some((a) => (signerUserId && a.user_id === signerUserId) || (signerContactId && a.contact_id === signerContactId))) {
    return fail("stessa_persona", "La stessa persona non può mettere le due firme.");
  }
  if (i.expectedTextHash !== undefined && i.expectedTextHash !== null && i.textHash !== i.expectedTextHash) {
    return fail("testo_cambiato", "Il testo da firmare è cambiato: rileggi e firma di nuovo.");
  }
  const approval: Approval = {
    ruolo,
    user_id: signerUserId,
    contact_id: signerContactId,
    at: i.now.toISOString(),
    text_hash: i.textHash ?? null,
    metodo: i.signer.kind === "account" ? "account" : "link",
    ip_hash: i.ipHash ?? (i.signer.kind === "link" ? (i.signer.ipHash ?? null) : null),
    email_domain: i.signer.kind === "link" ? emailDomain(i.signer.email) : null,
  };
  const approvals = [...i.approvals, approval];
  const sides = new Set(approvals.map((a) => signatureSideOf(a.ruolo)));
  return ok({ approvals, approval, complete: sides.has("ls") && sides.has("cliente"), side });
}

/**
 * Le due firme di uno scopo sono complete? Serve una firma `ls_lead` e una del
 * ruolo del cliente giusto per lo scopo (`clientSignerRole`), da due persone
 * diverse. Si usa sulle firme già salvate (deroghe, ripieghi, blocchi, gate).
 */
export function approvalsComplete(approvals: readonly Approval[], purpose: SignaturePurpose): { ls: boolean; cliente: boolean; complete: boolean } {
  const clientRole = clientSignerRole(purpose);
  const ls = approvals.filter((a) => a.ruolo === "ls_lead" && Boolean(a.user_id));
  const client = approvals.filter((a) => a.ruolo === clientRole && Boolean(a.user_id || a.contact_id));
  const distinct = ls.some((l) => client.some((c) => !c.user_id || c.user_id !== l.user_id));
  return { ls: ls.length > 0, cliente: client.length > 0, complete: ls.length > 0 && client.length > 0 && distinct };
}

/** Colonne NA che una firma scrive su `uc_items`. */
export interface NaSignaturePatch {
  naApprovedByUserId?: string;
  naClientApprovedByUserId?: string;
  /** `null`: firma dal link di un contatto non più designato, tolta. */
  naApprovedByContactId?: string | null;
}

/**
 * Firma di una proposta NA: LS in `na_approved_by_user_id`, cliente da account
 * in `na_client_approved_by_user_id`, cliente dal link in
 * `na_approved_by_contact_id`. Con `complete` il comando applica la transizione
 * `na_approvata` (righe 4, 12, 22, 29, 32).
 */
export function naSignaturePatch(i: { item: Pick<ItemSnapshot, "na">; signer: Signer; ctx: SignatureContext }): Result<{ patch: NaSignaturePatch; side: SignatureSide; complete: boolean }> {
  if (!i.item.na.proposedAt || !i.item.na.reason) return fail("na_non_proposta", "Non c'è una proposta di «non applicabile» da firmare.");
  if (i.item.na.approvedAt) return fail("na_gia_approvata", "La voce è già non applicabile.");
  const role = signatureRole(i.signer, "na", i.ctx);
  if (!role.ok) return role;
  const current = naSignatures(i.item, i.ctx.designated.owner);
  if (role.value.side === "ls") {
    if (current.ls) return fail("firma_gia_presente", "Lateral Space ha già firmato.");
    const userId = i.signer.kind === "account" ? i.signer.user.userId : "";
    if (userId && userId === i.item.na.clientUserId) return fail("stessa_persona", "La stessa persona non può mettere le due firme.");
    return ok({ patch: { naApprovedByUserId: userId }, side: "ls", complete: current.client });
  }
  if (current.client) return fail("firma_gia_presente", "Il cliente ha già firmato.");
  const patch: NaSignaturePatch =
    i.signer.kind === "account" ? { naClientApprovedByUserId: i.signer.user.userId } : { naApprovedByContactId: i.signer.contactId };
  // Una firma dal link di un contatto non più designato si toglie (resta negli eventi).
  if (i.signer.kind === "account" && staleNaLinkSignaturePatch(i.item, i.ctx.designated.owner)) patch.naApprovedByContactId = null;
  return ok({ patch, side: "cliente", complete: current.ls });
}

// ── Firmatari designati dal cliente (D16) ─────────────────────────────

/**
 * Designazione dell'Owner o dell'approvatore privacy come firmatario dal link
 * (`setOwnerContact`, `setPrivacyApproverContact`): la fa ls_lead o
 * `owner_cliente`, con un file di prova del caso (l'email del cliente che indica
 * la persona). Il contatto deve avere un'email non Lateral Space: il link di
 * approvazione parte solo per email.
 */
export function checkSignerDesignation(i: {
  actor: { user: UserContext; roles: readonly CaseRole[] };
  designation: "owner" | "privacy";
  contact: { id: string; email: string | null; isActive: boolean; anonymized: boolean };
  evidenceFileId: string | null;
  ctx: Pick<SignatureContext, "lsDomains" | "lsMemberEmails">;
}): Result<{ designation: "owner" | "privacy"; contactId: string; evidenceFileId: string }> {
  const canDesignate = (["ls_lead", "owner_cliente"] as const).some((r) => i.actor.roles.includes(r) && caseRoleAllowedFor(i.actor.user, r, i.ctx.lsDomains));
  if (!canDesignate) return fail("ruolo_non_ammesso", "Solo il Responsabile del caso o l'Owner del cliente indicano i firmatari.");
  if (!i.evidenceFileId) return fail("prova_mancante", "Carica la prova scritta del cliente che indica la persona.");
  if (!i.contact.isActive || i.contact.anonymized) return fail("contatto_non_attivo", "Il contatto non è attivo.");
  if (!i.contact.email) return fail("email_mancante", "Il firmatario deve avere un'email: il link di approvazione parte solo per email.");
  const email = checkSignerEmail(i.contact.email, i.ctx.lsDomains, i.ctx.lsMemberEmails);
  if (!email.ok) return email;
  return ok({ designation: i.designation, contactId: i.contact.id, evidenceFileId: i.evidenceFileId });
}

/**
 * Un cambio della designazione o dell'email del contatto designato annulla le
 * firme dal link in attesa e revoca i link di approvazione.
 */
export function designationChanged(
  prev: { contactId: string; email: string | null } | null,
  next: { contactId: string; email: string | null } | null,
): boolean {
  if (!prev && !next) return false;
  if (!prev || !next) return true;
  return prev.contactId !== next.contactId || (prev.email ?? "").trim().toLowerCase() !== (next.email ?? "").trim().toLowerCase();
}

/** Firme in attesa senza quelle date dal link del contatto non più designato. */
export function dropLinkApprovals(approvals: readonly Approval[], contactId: string): Approval[] {
  return approvals.filter((a) => a.contact_id !== contactId);
}

// ── Zona personale (D46) ──────────────────────────────────────────────

export interface PersonalZoneGrant {
  proposed_by_user_id: string;
  beneficiary_user_id: string;
  at: string;
  approvals: Approval[];
}

/**
 * Proposta di accesso alla zona personale: la fa ls_lead per un'altra persona
 * di Lateral Space del caso, solo con `a8` sciolto e se la persona è indicata
 * nelle prove A.8 (`evidence.accesso_zona_personale`). Diventa attiva con la
 * firma dell'approvatore privacy (`checkPersonalZoneSignature`).
 */
export function checkPersonalZoneProposal(i: {
  proposer: { user: UserContext; roles: readonly CaseRole[] };
  beneficiary: { user: UserContext; roles: readonly CaseRole[] };
  a8Status: BlockerStatus | null;
  a8EvidenceUserIds: readonly string[];
  now: Date;
}): Result<{ grant: PersonalZoneGrant }> {
  if (!(i.proposer.roles.includes("ls_lead") && caseRoleAllowedFor(i.proposer.user, "ls_lead"))) {
    return fail("ruolo_non_ammesso", "Solo il Responsabile del caso propone l'accesso alla zona personale.");
  }
  if (i.proposer.user.userId === i.beneficiary.user.userId) {
    return fail("autoconcessione", "Nessuno si concede da solo l'accesso alla zona personale.");
  }
  if (i.a8Status !== "sciolto") return fail("a8_non_sciolto", "La zona personale resta chiusa finché la scheda A.8 non è approvata.");
  if (!i.a8EvidenceUserIds.includes(i.beneficiary.user.userId)) {
    return fail("non_nella_scheda_a8", "La persona non è indicata nella scheda A.8.");
  }
  const lsMember = i.beneficiary.roles.some((r) => isLsRole(r) && caseRoleAllowedFor(i.beneficiary.user, r));
  if (!lsMember) return fail("ruolo_non_ammesso", "L'accesso alla zona personale è solo per le persone di Lateral Space del caso.");
  return ok({
    grant: { proposed_by_user_id: i.proposer.user.userId, beneficiary_user_id: i.beneficiary.user.userId, at: i.now.toISOString(), approvals: [] },
  });
}

/** Firma dell'approvatore privacy sulla concessione: con questa `personal_zone_access` diventa vero. */
export function checkPersonalZoneSignature(i: {
  grant: PersonalZoneGrant;
  signer: Signer;
  ctx: SignatureContext;
  a8Status: BlockerStatus | null;
  now: Date;
  ipHash?: string | null;
}): Result<{ grant: PersonalZoneGrant; approval: Approval; active: boolean }> {
  if (i.a8Status !== "sciolto") return fail("a8_non_sciolto", "La zona personale resta chiusa finché la scheda A.8 non è approvata.");
  const role = signatureRole(i.signer, "zona_personale", i.ctx);
  if (!role.ok) return role;
  if (role.value.side !== "cliente") return fail("firmatario_non_ammesso", "L'accesso lo conferma l'approvatore privacy del cliente.");
  if (i.signer.kind === "account" && (i.signer.user.userId === i.grant.beneficiary_user_id || i.signer.user.userId === i.grant.proposed_by_user_id)) {
    return fail("stessa_persona", "Chi propone o riceve l'accesso non lo conferma.");
  }
  const added = addSignature({ purpose: "zona_personale", approvals: i.grant.approvals, signer: i.signer, ctx: i.ctx, now: i.now, ipHash: i.ipHash });
  if (!added.ok) return added;
  return ok({ grant: { ...i.grant, approvals: added.value.approvals }, approval: added.value.approval, active: true });
}

/**
 * Può questa persona vedere adesso i valori della zona personale? Serve un ruolo
 * `ls_*` che valga ancora (dominio ricalcolato), `personal_zone_access` attivo e
 * il blocco `a8` sciolto: con `a8` riattivato la zona si richiude per tutti.
 */
export function personalZoneAllowed(i: { user: UserContext; roles: readonly CaseRole[]; personalZoneAccess: boolean; a8Status: BlockerStatus | null }): boolean {
  if (!i.personalZoneAccess || i.a8Status !== "sciolto") return false;
  return i.roles.some((r) => isLsRole(r) && caseRoleAllowedFor(i.user, r));
}

// ── Matrice delle azioni (MVP) ────────────────────────────────────────

export type CaseAction =
  /** Tutto il caso, senza zona personale. */
  | "vedere_caso"
  /** Descrizione, mappa, KPI, avanzamento, ROI. */
  | "vedere_sintesi"
  | "vedere_catalogo_validato"
  | "vedere_metadati_privacy"
  | "vedere_commenti_interni"
  | "modificare_catalogo"
  | "proporre_voci"
  | "proporre_na"
  | "gestire_membri"
  | "aggiungere_referenti"
  | "assegnare"
  | "inviare_richieste"
  | "revocare_link"
  | "riassegnare"
  | "validare"
  | "esiti_verifica"
  | "firma_ls"
  | "firma_cliente"
  | "proporre_gate"
  | "firmare_a8"
  | "sciogliere_blocco"
  | "prova_decisione_board"
  | "zona_personale"
  | "metadati_zona_personale"
  | "export"
  | "export_validato"
  | "registro"
  | "registro_filtrato";

const LS_ALL: readonly CaseRole[] = ["ls_lead", "ls_analista", "ls_sviluppatore"];

/** Matrice del PIANO §3.3. La zona personale vale solo con `personal_zone_access`. */
export const CASE_ACTION_ROLES: Readonly<Record<CaseAction, readonly CaseRole[]>> = {
  vedere_caso: ["ls_lead", "ls_analista", "owner_cliente"],
  // Descrizione, mappa, KPI, avanzamento e ROI: ls_sviluppatore vede il catalogo validato, l'approvatore privacy i metadati privacy.
  vedere_sintesi: ["ls_lead", "ls_analista", "owner_cliente", "ai_board", "osservatore"],
  vedere_catalogo_validato: ["ls_lead", "ls_analista", "ls_sviluppatore", "owner_cliente"],
  vedere_metadati_privacy: ["ls_lead", "ls_analista", "owner_cliente", "approvatore_privacy"],
  vedere_commenti_interni: ["ls_lead", "ls_analista"],
  modificare_catalogo: ["ls_lead"],
  proporre_voci: ["ls_lead", "ls_analista"],
  proporre_na: ["ls_lead", "ls_analista"],
  gestire_membri: ["ls_lead"],
  aggiungere_referenti: ["ls_lead", "owner_cliente"],
  assegnare: ["ls_lead"],
  inviare_richieste: ["ls_lead"],
  revocare_link: ["ls_lead"],
  riassegnare: ["ls_lead", "owner_cliente"],
  validare: ["ls_lead", "ls_analista"],
  esiti_verifica: ["ls_lead", "ls_analista"],
  firma_ls: ["ls_lead"],
  firma_cliente: ["owner_cliente"],
  proporre_gate: ["ls_lead"],
  firmare_a8: ["approvatore_privacy"],
  sciogliere_blocco: ["ls_lead"],
  prova_decisione_board: ["ai_board"],
  zona_personale: LS_ALL,
  metadati_zona_personale: ["approvatore_privacy"],
  export: ["ls_lead", "ls_analista", "owner_cliente"],
  export_validato: ["ls_lead", "ls_analista", "ls_sviluppatore", "owner_cliente"],
  registro: ["ls_lead"],
  registro_filtrato: ["owner_cliente", "approvatore_privacy"],
};

/** Vero se uno dei ruoli (già ricalcolati) permette l'azione. */
export function can(roles: readonly CaseRole[], action: CaseAction): boolean {
  return roles.some((r) => CASE_ACTION_ROLES[action].includes(r));
}

/**
 * Chi vede il valore di una voce. I dati sanitari mai; quelli personali solo
 * alle persone di Lateral Space con accesso alla zona personale; per il resto
 * vale `value_visibility` [D `owner_e_ls`]. Con `tutti_i_ruoli_del_caso` i ruoli
 * che vedono solo la sintesi o i metadati (osservatore, AI Board, approvatore
 * privacy) vedono soltanto i valori di classe `nessuna`: mai le risposte con dati
 * riservati (spec Osservatore).
 */
export function valueVisibleTo(visibility: ValueVisibility, roles: readonly CaseRole[], privacy: PrivacyClass, personalZoneAccess: boolean): boolean {
  if (privacy === "escluso_sanitario") return false;
  if ((PERSONAL_PRIVACY_CLASSES as readonly string[]).includes(privacy)) {
    return personalZoneAccess && roles.some(isLsRole);
  }
  switch (visibility) {
    case "tutti_i_ruoli_del_caso":
      return roles.some((r) => isLsRole(r) || r === "owner_cliente") || (privacy === "nessuna" && roles.length > 0);
    case "owner_e_ls":
      return roles.some((r) => isLsRole(r) || r === "owner_cliente");
    case "solo_ls":
      return roles.some(isLsRole);
  }
}
