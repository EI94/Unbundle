/**
 * Persone e Impostazioni del dossier (DESIGN §3.9, §3.13.3; PIANO §5.1, D40):
 * la lista unica di chi risponde per il cliente, gli stati per persona, le
 * righe «Senza referente», i firmatari del cliente, i membri del caso con i
 * loro ruoli e le etichette di ruoli, canali e designazioni.
 *
 * Ai ruoli del cliente niente statistiche per persona (art. 15.4): nome, ruolo
 * e uno di quattro stati («Da invitare», «Invitato», «Ha finito», «Link
 * scaduto»). Nessun conteggio, nessuna data, nessun ordinamento per tempi o
 * per domande aperte: la lista è sempre in ordine alfabetico.
 *
 * Modulo puro e senza dipendenze di Node: si usa anche nei componenti client.
 */
import type { Block } from "../notify/email-render.ts";
import type { Json } from "../types.ts";
import { CLIENT_CASE_ROLES, LS_CASE_ROLES, type CaseRole, type ContactChannel, type RequestStatus, type SemaforoColor } from "../vocab.ts";
import { formatCountIt } from "./format.ts";
import { dayWithArticle, ROLE_LABEL } from "./labels.ts";

/** Etichette dei ruoli di caso: le stesse di `ROLE_LABEL` (§2.6), una sola fonte. */
export const CASE_ROLE_LABEL: Readonly<Record<CaseRole, string>> = {
  ls_lead: ROLE_LABEL.ls_lead,
  ls_analista: ROLE_LABEL.ls_analista,
  ls_sviluppatore: ROLE_LABEL.ls_sviluppatore,
  owner_cliente: ROLE_LABEL.owner_cliente,
  approvatore_privacy: ROLE_LABEL.approvatore_privacy,
  ai_board: ROLE_LABEL.ai_board,
  osservatore: ROLE_LABEL.osservatore,
};

/** Cosa fa ogni ruolo, in una frase senza codici (suggerimento nel modulo di «Accesso al caso»). */
export const CASE_ROLE_HINT: Readonly<Record<CaseRole, string>> = {
  ls_lead: "Gestisce la realizzazione, invia le domande e firma per Lateral Space.",
  ls_analista: "Verifica le risposte e propone domande.",
  ls_sviluppatore: "Legge il catalogo validato per sviluppare.",
  owner_cliente: "Firma per il cliente il via allo sviluppo e aggiunge altre persone come referenti.",
  approvatore_privacy: "Firma la scheda privacy e l'accesso ai dati personali.",
  ai_board: "Legge Panoramica, Soluzione e Valore.",
  osservatore: "Legge Panoramica, Soluzione e Valore.",
};

/** (8.0c) La riga «Osservatore» di chi costruisce il caso da fuori Lateral Space (una concessione di «Chi costruisce»). */
export const MEMBER_BUILDS_LABEL = "Osservatore · costruisce";

/** (8.0c) La conferma quando si toglie quella riga: da lì la persona non costruisce più questo caso, e i suoi compiti lì tornano da prendere. */
export const MEMBER_BUILDS_REMOVE_TEXT = "Non costruirà più questa realizzazione: i compiti che ha qui tornano da prendere. Per tutte: Agent Factory › Chi costruisce.";

/**
 * (8.0c) La conferma quando si toglie a una persona di Lateral Space l'ultimo ruolo con cui costruisce il caso: anche i
 * suoi compiti lì tornano da prendere (`removeCaseMemberReleasingTasks`).
 */
export const MEMBER_LAST_LS_ROLE_REMOVE_TEXT = "Non costruirà più questa realizzazione: i compiti che ha qui tornano da prendere.";

/** La conferma quando si toglie un ruolo che non cambia chi costruisce il caso. */
export const MEMBER_ROLE_REMOVE_TEXT = "Smette subito di vedere ciò che quel ruolo permetteva. Gli altri ruoli restano.";

/**
 * (8.0c) La conferma di «Togli» nel team del dossier, secondo quello che succede davvero: chi con quel ruolo costruiva
 * il caso e non ne ha un altro per costruirlo lascia i suoi compiti lì. `roles` sono i ruoli della persona nel caso,
 * `buildsFromOutside` dice se la riga «Osservatore» è di chi costruisce da fuori Lateral Space.
 */
export function removeRoleConfirmText(roles: readonly CaseRole[], role: CaseRole, buildsFromOutside: boolean): string {
  if (role === "osservatore" && buildsFromOutside) return MEMBER_BUILDS_REMOVE_TEXT;
  const builds = (r: CaseRole) => (LS_CASE_ROLES as readonly CaseRole[]).includes(r);
  if (builds(role) && !roles.some((r) => r !== role && builds(r))) return MEMBER_LAST_LS_ROLE_REMOVE_TEXT;
  return MEMBER_ROLE_REMOVE_TEXT;
}

/** Ruoli che si possono dare a una persona: Lateral Space o cliente, mai mescolati (D36). */
export function rolesAssignableTo(isLateralSpace: boolean): CaseRole[] {
  return isLateralSpace ? [...LS_CASE_ROLES, "osservatore"] : [...CLIENT_CASE_ROLES, "osservatore"];
}

/** (8.0c) Sotto il modulo, quando la persona scelta costruisce il caso da fuori: perché i ruoli del cliente sono spenti. */
export const MEMBER_BUILDS_CLIENT_ROLE_TEXT = "Costruisce questa realizzazione: non può avere anche un ruolo del cliente.";

/**
 * I ruoli da offrire a una persona in «Accesso al caso»: quelli che può avere e non ha già. (8.0c) A chi costruisce il
 * caso da fuori (`buildsCase`) i ruoli del cliente si vedono spenti: `addCaseMember` li rifiuta (`conflitto_ruoli`).
 */
export function roleChoicesFor(isLateralSpace: boolean, held: ReadonlySet<CaseRole>, buildsCase: boolean): { role: CaseRole; disabled: boolean }[] {
  return rolesAssignableTo(isLateralSpace)
    .filter((role) => !held.has(role))
    .map((role) => ({ role, disabled: buildsCase && (CLIENT_CASE_ROLES as readonly CaseRole[]).includes(role) }));
}

export const CONTACT_CHANNEL_LABEL: Readonly<Record<ContactChannel, string>> = {
  email: "Email",
  whatsapp_manuale: "WhatsApp (link copiato a mano)",
  entrambi: "Email e WhatsApp",
};

/** Cosa firma il firmatario designato: la riga di «Firme del cliente». */
export const DESIGNATION_LABEL: Readonly<Record<"owner" | "privacy", string>> = {
  owner: "Via allo sviluppo",
  privacy: "Privacy",
};

/** Suffisso grigio accanto al ruolo nella lista di Persone. */
export const DESIGNATION_SUFFIX: Readonly<Record<"owner" | "privacy", string>> = {
  owner: "firma il via",
  privacy: "firma la privacy",
};

export interface MemberRowInput {
  userId: string;
  role: CaseRole;
  name: string | null;
  email: string | null;
  isLateralSpace: boolean;
  personalZoneAccess: boolean;
  personalZoneGrant: Json | null;
}

export type PersonalZoneMemberState = "attiva" | "in_attesa" | "no";

export interface MemberView {
  userId: string;
  name: string;
  email: string | null;
  isLateralSpace: boolean;
  roles: CaseRole[];
  personalZone: PersonalZoneMemberState;
  /** Chi ha proposto l'accesso in attesa (per non far firmare il proponente a se stesso). */
  grantProposedBy: string | null;
}

const ROLE_ORDER: readonly CaseRole[] = ["ls_lead", "ls_analista", "ls_sviluppatore", "owner_cliente", "approvatore_privacy", "ai_board", "osservatore"];

function grantProposer(grant: Json | null): string | null {
  if (!grant || typeof grant !== "object" || Array.isArray(grant)) return null;
  const by = (grant as Record<string, Json>).proposed_by_user_id;
  return typeof by === "string" ? by : null;
}

/**
 * Una riga per persona con tutti i suoi ruoli, in ordine: prima Lateral Space,
 * poi il cliente, per nome. `withEmail = false` toglie le email (ruoli del cliente).
 */
export function groupMembers(rows: readonly MemberRowInput[], opts: { withEmail: boolean }): MemberView[] {
  const by = new Map<string, MemberView>();
  for (const r of rows) {
    const cur = by.get(r.userId) ?? {
      userId: r.userId,
      name: r.name?.trim() || r.email || "Persona senza nome",
      email: opts.withEmail ? r.email : null,
      isLateralSpace: r.isLateralSpace,
      roles: [],
      personalZone: "no" as PersonalZoneMemberState,
      grantProposedBy: null,
    };
    if (!cur.roles.includes(r.role)) cur.roles.push(r.role);
    if (r.personalZoneAccess) cur.personalZone = "attiva";
    else if (r.personalZoneGrant && cur.personalZone === "no") {
      cur.personalZone = "in_attesa";
      cur.grantProposedBy = grantProposer(r.personalZoneGrant);
    }
    by.set(r.userId, cur);
  }
  for (const m of by.values()) m.roles.sort((a, b) => ROLE_ORDER.indexOf(a) - ROLE_ORDER.indexOf(b));
  return [...by.values()].sort((a, b) => Number(b.isLateralSpace) - Number(a.isLateralSpace) || a.name.localeCompare(b.name, "it"));
}

export const PERSONAL_ZONE_MEMBER_LABEL: Readonly<Record<PersonalZoneMemberState, string>> = {
  attiva: "Accesso alla zona personale",
  in_attesa: "Accesso in attesa della firma privacy",
  no: "",
};

/** «Lateral Space» o «Cliente», dal dominio dell'email verificata. */
export function sideLabel(isLateralSpace: boolean): string {
  return isLateralSpace ? "Lateral Space" : "Cliente";
}

// ── Richieste ─────────────────────────────────────────────────────────

/** Riga di una richiesta quando la sua email resta in coda: il link si copia e si manda a mano. */
export const EMAIL_NOT_CONFIGURED_TEXT = "Email non inviata: copia il link e mandalo tu.";

/** Riga sotto la lista di Persone quando le email non partono (§3.9.1). */
export const EMAIL_OFF_TEXT = "Le email non partono ancora: copia i link e mandali tu.";

/** Riga di una richiesta con il dossier in pausa: il link si apre ancora, senza risposte nuove. */
export const PAUSED_LINK_TEXT = "Realizzazione in pausa: il link si apre in sola lettura.";

/** Promemoria automatici previsti per ogni richiesta (3 e 7 giorni lavorativi). */
export const REMINDERS_PLANNED = 2;

/** Colore dello stato di una richiesta; per i ruoli del cliente «In attesa» è sempre giallo. */
export const REQUEST_STATUS_TONE: Readonly<Record<RequestStatus, SemaforoColor>> = {
  bozza: "grigio",
  inviata: "giallo",
  aperta: "giallo",
  in_corso: "giallo",
  completata: "verde",
  scaduta: "rosso",
  revocata: "grigio",
};

export interface RequestDetailLike {
  channel: "email" | "link_manuale";
  sentAt: string | null;
  expiresAt: string | null;
  reminderCount: number;
  nextReminderAt: string | null;
  escalated: boolean;
  activeLinks: number;
  live: boolean;
  emailQueued: boolean;
  emailHoldReason: string | null;
  contactHasEmail: boolean;
  delegatedFromRequestId: string | null;
  delegationDepth: number;
  needsApproval: boolean;
  /**
   * Il link si apre: vale anche con il dossier in pausa, in sola lettura
   * (`requestVisibleSql`). `live` invece chiede anche un dossier non in pausa.
   */
  visible: boolean;
}

/** «il 3 ott» con l'articolo giusto, da un giorno già formattato. */
function onDay(day: string): string {
  return dayWithArticle("il", day);
}

/**
 * La riga del tempo di una richiesta, solo per Lateral Space (§3.9.1): «Inviata
 * il 3 ott · scade il 2 nov · promemoria 1 di 2 (il prossimo il 10 ott)». Le
 * date arrivano già come giorni di Roma («3 ott»). «Scade» finché il link si
 * apre (anche in pausa); il prossimo promemoria solo con il link vivo.
 */
export function requestTimeline(d: RequestDetailLike, day: (iso: string | null) => string | null): string {
  const sent = day(d.sentAt);
  if (!sent) return d.needsApproval ? "Delega da approvare: la persona ha un dominio nuovo." : "Bozza: non ancora inviata.";
  const parts = [`Inviata ${onDay(sent)}${d.channel === "link_manuale" ? " con un link copiato a mano" : ""}`];
  const expires = day(d.expiresAt);
  if (expires) parts.push(`${d.visible ? "scade" : "scaduta"} ${onDay(expires)}`);
  const made = Math.max(0, Math.min(d.reminderCount, REMINDERS_PLANNED));
  const next = day(d.nextReminderAt);
  parts.push(`promemoria ${made} di ${REMINDERS_PLANNED}${next && made < REMINDERS_PLANNED && d.live ? ` (il prossimo ${onDay(next)})` : ""}`);
  return parts.join(" · ");
}

/**
 * Righe di dettaglio di una richiesta, solo per Lateral Space: il tempo
 * (`requestTimeline`), segnalazione al responsabile del cliente, deleghe, link
 * e email in partenza. Le date arrivano già come testo di Roma.
 */
export function requestDetailLines(d: RequestDetailLike, fmt: (iso: string | null) => string | null): string[] {
  const out: string[] = [requestTimeline(d, fmt)];
  if (d.escalated) out.push("Segnalata al responsabile del cliente.");
  if (d.delegatedFromRequestId) out.push(d.delegationDepth > 1 ? "Delega di una delega." : "Delega da un'altra persona.");
  if (d.live) out.push(d.activeLinks > 0 ? "Link attivo" : "Link attivo, da copiare");
  else if (d.visible) out.push(PAUSED_LINK_TEXT);
  if (d.emailQueued && d.emailHoldReason === "email_non_configurata") out.push(EMAIL_NOT_CONFIGURED_TEXT);
  else if (d.emailQueued) out.push("In partenza");
  if (!d.contactHasEmail && d.live) out.push("Senza email: il link si copia e si manda a mano.");
  return out;
}

export interface SignerCandidateLike {
  id: string;
  isActive: boolean;
  anonymized: boolean;
  hasEmail: boolean;
}

/** Referenti che si possono designare firmatari: attivi, non anonimizzati, con l'email (il link di approvazione parte solo per email). */
export function signerCandidates<T extends SignerCandidateLike>(contacts: readonly T[]): T[] {
  return contacts.filter((c) => c.isActive && !c.anonymized && c.hasEmail);
}

// ── Lista unica di Persone (§3.9) ─────────────────────────────────────

export type PeopleAudience = "lateral_space" | "cliente";

/** Stato di una persona per Lateral Space. */
export type LsPersonStatus = "delega" | "link_attivo" | "link_scaduto" | "da_inviare" | "ha_finito" | "nessuno";
/** Stato di una persona per il cliente (§3.9.3, §9.1 punto 8): mai «In corso». */
export type ClientPersonStatus = "da_invitare" | "invitato" | "ha_finito" | "link_scaduto";

export const LS_PERSON_STATUS: Readonly<Record<LsPersonStatus, { label: string; tone: SemaforoColor }>> = {
  delega: { label: "Delega da approvare", tone: "giallo" },
  link_attivo: { label: "Link attivo", tone: "blu" },
  link_scaduto: { label: "Link scaduto", tone: "rosso" },
  da_inviare: { label: "Da inviare", tone: "grigio" },
  ha_finito: { label: "Ha finito", tone: "verde" },
  nessuno: { label: "–", tone: "grigio" },
};

export const CLIENT_PERSON_STATUS: Readonly<Record<ClientPersonStatus, { label: string; tone: SemaforoColor }>> = {
  da_invitare: { label: "Da invitare", tone: "grigio" },
  invitato: { label: "Invitato", tone: "blu" },
  ha_finito: { label: "Ha finito", tone: "verde" },
  link_scaduto: { label: "Link scaduto", tone: "rosso" },
};

/** Una richiesta come la vede la lista: solo le richieste di raccolta contano per lo stato. */
export interface PersonRequestLike {
  id: string;
  contactId: string;
  purpose: "raccolta" | "approvazioni";
  status: RequestStatus;
  /** Solo per Lateral Space (null per i ruoli del cliente). */
  detail: (RequestDetailLike & { openItems: number }) | null;
  actions: { send: boolean; copyLink: boolean; remind: boolean; revoke: boolean; extend: boolean; approveDelegation: boolean };
}

const WAITING: readonly RequestStatus[] = ["inviata", "aperta", "in_corso"];

/**
 * Stato di una persona per Lateral Space, dalle sue richieste di raccolta (la
 * più recente per prima) e dalle domande assegnate ancora da inviare:
 * delega da approvare, poi link attivo, link scaduto, da inviare, ha finito.
 * Con il dossier in pausa un link in attesa resta «Link attivo»: si apre
 * ancora, in sola lettura, e non è scaduto.
 */
export function lsPersonStatus(requests: readonly PersonRequestLike[], unsent: number): LsPersonStatus {
  const own = requests.filter((r) => r.purpose === "raccolta" && r.status !== "revocata");
  if (own.some((r) => r.detail?.needsApproval)) return "delega";
  if (own.some((r) => WAITING.includes(r.status) && (r.detail?.live || r.detail?.visible))) return "link_attivo";
  const latest = own.find((r) => r.status !== "bozza");
  // Scaduta anche prima del giro notturno che cambia lo stato: in attesa ma non più apribile (in pausa resta apribile).
  const expired = latest !== undefined && (latest.status === "scaduta" || (WAITING.includes(latest.status) && latest.detail !== null && !latest.detail.visible));
  if (expired) return "link_scaduto";
  if (unsent > 0 || own.some((r) => r.status === "bozza")) return "da_inviare";
  if (latest?.status === "completata") return "ha_finito";
  return "nessuno";
}

/**
 * Stato di una persona per il cliente: «Invitato» con un link in attesa,
 * altrimenti l'esito dell'ultima richiesta partita («Ha finito», «Link
 * scaduto»), oppure «Da invitare». Bozze, revoche e link di approvazione non
 * contano: sono lavoro di Lateral Space.
 */
export function clientPersonStatus(requests: readonly Pick<PersonRequestLike, "purpose" | "status">[]): ClientPersonStatus {
  const sent = requests.filter((r) => r.purpose === "raccolta" && (WAITING.includes(r.status) || r.status === "completata" || r.status === "scaduta"));
  if (sent.some((r) => WAITING.includes(r.status))) return "invitato";
  const latest = sent[0];
  if (latest?.status === "completata") return "ha_finito";
  if (latest?.status === "scaduta") return "link_scaduto";
  return "da_invitare";
}

/** Un referente come lo legge la lista (`uc-people-view.ts`). I conteggi solo per Lateral Space. */
export interface PersonContactLike {
  id: string;
  displayName: string;
  roleLabel: string | null;
  templateRoleKey: string | null;
  email: string | null;
  phone: string | null;
  /** Canale preferito salvato (solo per Lateral Space, che lo modifica). */
  preferredChannel: string | null;
  hasEmail: boolean;
  isActive: boolean;
  anonymized: boolean;
  /** Ha domande, richieste o una firma in questo dossier. */
  involved: boolean;
  /** Solo per Lateral Space (null per il cliente). */
  counts: { assigned: number; open: number; unsent: number } | null;
}

/** Il ruolo di una persona: come lo chiamano, poi il ruolo dello schema, senza ripetizioni. */
export function personRoleText(c: Pick<PersonContactLike, "roleLabel" | "templateRoleKey">, roleLabels: Readonly<Record<string, string>>): string | null {
  const parts = [c.roleLabel?.trim() || null, c.templateRoleKey ? (roleLabels[c.templateRoleKey] ?? null) : null].filter((x): x is string => !!x);
  const unique = parts.filter((x, i) => parts.findIndex((y) => y.toLowerCase() === x.toLowerCase()) === i);
  return unique.length ? unique.join(" · ") : null;
}

/** Riga della lista per Lateral Space: conteggi, stato, richieste con le loro righe. */
export interface LsPersonRow<R extends PersonRequestLike = PersonRequestLike> {
  kind: "ls";
  id: string;
  name: string;
  roleText: string | null;
  signs: ("owner" | "privacy")[];
  status: LsPersonStatus;
  /** «8 domande · 8 aperte», oppure null senza domande. */
  countsText: string | null;
  /** (Rilascio 10) Le domande aperte, per la riga grigia «ruolo · 8 aperte» (`personLineText`). */
  open: number;
  unsent: number;
  email: string | null;
  phone: string | null;
  preferredChannel: string | null;
  hasEmail: boolean;
  isActive: boolean;
  anonymized: boolean;
  templateRoleKey: string | null;
  roleLabel: string | null;
  /** Le richieste di raccolta della persona, dalla più recente; le revocate in fondo. */
  requests: R[];
}

/**
 * Riga della lista per il cliente (art. 15.4): esattamente nome, ruolo, firma e
 * stato. Niente conteggi, niente date, niente richieste.
 */
export interface ClientPersonRow {
  kind: "cliente";
  id: string;
  name: string;
  roleText: string | null;
  signs: ("owner" | "privacy")[];
  status: ClientPersonStatus;
}

/** «Senza referente»: domande aperte di un ruolo dello schema che non hanno ancora chi risponde. */
export interface UnassignedRoleRow {
  roleKey: string;
  roleLabel: string;
  /** Domande senza referente. */
  questions: number;
  /** Referenti attivi con lo stesso ruolo, da proporre per primi. */
  suggestedContactIds: string[];
}

const plural = (n: number, one: string, many: string) => `${formatCountIt(n)} ${n === 1 ? one : many}`;

/** «8 domande · 8 aperte»; «–» se non ha domande in questo dossier. */
export function personCountsText(counts: { assigned: number; open: number }): string | null {
  if (counts.assigned === 0) return null;
  return `${plural(counts.assigned, "domanda", "domande")} · ${plural(counts.open, "aperta", "aperte")}`;
}

/**
 * Domande assegnate e non ancora partite, quando lo stato non lo dice già
 * («Da inviare»): «3 da inviare» accanto ai conteggi. Serve soprattutto con
 * un link attivo, che non contiene le domande assegnate dopo.
 */
export function personPendingText(row: Pick<LsPersonRow, "status" | "unsent">): string | null {
  if (row.unsent <= 0 || row.status === "da_inviare") return null;
  return `${formatCountIt(row.unsent)} da inviare`;
}

/** C'è qualcosa da far partire da Persone: domande senza referente o referenti con domande non ancora partite. */
export function peopleHaveSendWork(unassigned: readonly unknown[], rows: readonly Pick<LsPersonRow, "status" | "unsent" | "isActive" | "anonymized">[]): boolean {
  return unassigned.length > 0 || rows.some((r) => r.isActive && !r.anonymized && (r.status === "da_inviare" || r.unsent > 0));
}

/** Si vede nella lista: attivo e non anonimizzato, oppure con qualcosa in questo dossier. */
export function personListed(c: Pick<PersonContactLike, "isActive" | "anonymized" | "involved">): boolean {
  return c.involved || (c.isActive && !c.anonymized);
}

function byName<T extends { name: string; anonymized?: boolean; id: string }>(a: T, b: T): number {
  return Number(a.anonymized ?? false) - Number(b.anonymized ?? false) || a.name.localeCompare(b.name, "it", { sensitivity: "base" }) || a.id.localeCompare(b.id);
}

export interface PeopleListInput<R extends PersonRequestLike = PersonRequestLike> {
  contacts: readonly PersonContactLike[];
  /** Richieste del dossier, dalla più recente (ordine della lettura). */
  requests: readonly R[];
  roleLabels: Readonly<Record<string, string>>;
  designated: { owner: string | null; privacy: string | null };
}

function signsOf(id: string, designated: PeopleListInput["designated"]): ("owner" | "privacy")[] {
  const out: ("owner" | "privacy")[] = [];
  if (designated.owner === id) out.push("owner");
  if (designated.privacy === id) out.push("privacy");
  return out;
}

/** La lista di Lateral Space, sempre in ordine alfabetico (mai per domande aperte, art. 15.4). */
export function lsPeopleRows<R extends PersonRequestLike>(i: PeopleListInput<R>): LsPersonRow<R>[] {
  const rows: LsPersonRow<R>[] = [];
  for (const c of i.contacts) {
    const signs = signsOf(c.id, i.designated);
    if (!personListed({ ...c, involved: c.involved || signs.length > 0 })) continue;
    const own = i.requests.filter((r) => r.contactId === c.id && r.purpose === "raccolta");
    const ordered = [...own.filter((r) => r.status !== "revocata"), ...own.filter((r) => r.status === "revocata")];
    const counts = c.counts ?? { assigned: 0, open: 0, unsent: 0 };
    rows.push({
      kind: "ls",
      id: c.id,
      name: c.displayName,
      roleText: personRoleText(c, i.roleLabels),
      signs,
      status: lsPersonStatus(ordered, counts.unsent),
      countsText: personCountsText(counts),
      open: counts.open,
      unsent: counts.unsent,
      email: c.email,
      phone: c.phone,
      preferredChannel: c.preferredChannel,
      hasEmail: c.hasEmail,
      isActive: c.isActive,
      anonymized: c.anonymized,
      templateRoleKey: c.templateRoleKey,
      roleLabel: c.roleLabel,
      requests: ordered,
    });
  }
  return rows.sort(byName);
}

/**
 * La lista del cliente (art. 15.4): nome, ruolo, firma e uno dei quattro
 * stati, in ordine alfabetico. Le persone anonimizzate non compaiono.
 */
export function clientPeopleRows(i: PeopleListInput): ClientPersonRow[] {
  const rows: ClientPersonRow[] = [];
  for (const c of i.contacts) {
    const signs = signsOf(c.id, i.designated);
    if (c.anonymized || !personListed({ ...c, involved: c.involved || signs.length > 0 })) continue;
    rows.push({
      kind: "cliente",
      id: c.id,
      name: c.displayName,
      roleText: personRoleText(c, i.roleLabels),
      signs,
      status: clientPersonStatus(i.requests.filter((r) => r.contactId === c.id)),
    });
  }
  return rows.sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }) || a.id.localeCompare(b.id));
}

/** Le righe «Senza referente», per nome del ruolo; solo i ruoli con domande senza referente. */
export function unassignedRoleRows(
  groups: readonly { roleKey: string; unassigned: number }[],
  roleLabels: Readonly<Record<string, string>>,
  contacts: readonly Pick<PersonContactLike, "id" | "templateRoleKey" | "isActive" | "anonymized">[],
): UnassignedRoleRow[] {
  return groups
    .filter((g) => g.unassigned > 0)
    .map((g) => ({
      roleKey: g.roleKey,
      roleLabel: roleLabels[g.roleKey] ?? g.roleKey,
      questions: g.unassigned,
      suggestedContactIds: contacts.filter((c) => c.isActive && !c.anonymized && c.templateRoleKey === g.roleKey).map((c) => c.id),
    }))
    .sort((a, b) => a.roleLabel.localeCompare(b.roleLabel, "it"));
}

// ── Invio delle domande (§3.9.2) ──────────────────────────────────────

/** Il pulsante del passo 2: «Invia a 2 referenti», oppure «Prepara 2 link» senza email. */
export function sendButtonText(n: number, emailConfigured: boolean): string {
  if (!emailConfigured) return n === 1 ? "Prepara 1 link" : `Prepara ${n} link`;
  return n === 1 ? "Invia a 1 referente" : `Invia a ${n} referenti`;
}

/**
 * L'esito dell'invio, nel toast (§3.9.2): «Inviate 2 richieste.». Senza email
 * configurata, o se nessuno ha l'email, «Link pronti: copiali dalle righe di
 * Persone.». In un invio misto si copiano solo i link di chi non ha l'email:
 * chi copia un link non verifica le risposte che arrivano da lì, quindi il
 * testo non lo chiede per chi ha già ricevuto l'email.
 */
export function sendOutcomeText(i: { requests: number; manual: number; emailConfigured: boolean; skipped: number }): string {
  const parts: string[] = [];
  const manual = Math.min(Math.max(0, i.manual), i.requests);
  if (!i.emailConfigured || manual >= i.requests) parts.push(i.requests === 1 ? "Link pronto: copialo dalla riga di Persone." : "Link pronti: copiali dalle righe di Persone.");
  else {
    parts.push(i.requests === 1 ? "Inviata 1 richiesta." : `Inviate ${formatCountIt(i.requests)} richieste.`);
    if (manual > 0) parts.push(manual === 1 ? "1 senza email: copia il suo link dalla riga di Persone." : `${formatCountIt(manual)} senza email: copia il loro link dalle righe di Persone.`);
  }
  if (i.skipped > 0) parts.push(i.skipped === 1 ? "1 domanda saltata." : `${formatCountIt(i.skipped)} domande saltate.`);
  return parts.join(" ");
}

/** Il risultato di un'assegnazione come lo legge il toast; `interrupted` e `truncated` solo per le assegnazioni in blocco. */
export interface AssignOutcomeLike {
  assigned: number;
  skipped: readonly { code: string }[];
  skippedTotal: number;
  roleMismatch: number;
  /** Si è fermata a metà: il motivo. Le domande già assegnate restano. */
  interrupted?: string | null;
  /** Le domande erano più del massimo per volta: le altre restano da assegnare. */
  truncated?: boolean;
}

/** Perché una domanda non è passata, in parole di esito (mai i comandi che solo Lateral Space può fare). */
const SKIP_OUTCOME: Readonly<Record<string, (n: string, one: boolean) => string>> = {
  in_richiesta: (n, one) => (one ? "1 resta nel link ancora aperto." : `${n} restano nel link ancora aperto.`),
  gia_assegnata: (n, one) => (one ? "1 ha già un referente." : `${n} hanno già un referente.`),
  senza_ruolo: (n, one) => (one ? "1 non ha un ruolo." : `${n} non hanno un ruolo.`),
  nessun_referente_per_ruolo: (n, one) => (one ? "1 non ha un referente con il suo ruolo." : `${n} non hanno un referente con il loro ruolo.`),
  piu_referenti_per_ruolo: (n, one) => (one ? "1 ha più referenti con il suo ruolo: scegli tu." : `${n} hanno più referenti con il loro ruolo: scegli tu.`),
};

/**
 * L'esito di «Assegna», del passo 1 di «Invia le domande» e di «Affida le sue
 * domande a un'altra persona»: «12 domande assegnate. 3 restano nel link
 * ancora aperto.». Lo leggono anche le persone del cliente: niente comandi di
 * Lateral Space, niente chiavi.
 */
export function assignOutcomeText(v: AssignOutcomeLike): string {
  const parts = [v.assigned === 0 ? "Nessuna domanda assegnata." : v.assigned === 1 ? "1 domanda assegnata." : `${formatCountIt(v.assigned)} domande assegnate.`];
  if (v.skippedTotal > 0) {
    const byCode = new Map<string, number>();
    for (const s of v.skipped) byCode.set(s.code, (byCode.get(s.code) ?? 0) + 1);
    // Solo un motivo noto e tutte le saltate nel campione: il conteggio è esatto.
    const [only] = byCode.size === 1 ? [...byCode.keys()] : [];
    const text = only && SKIP_OUTCOME[only] && v.skipped.length === v.skippedTotal ? SKIP_OUTCOME[only] : null;
    const n = formatCountIt(v.skippedTotal);
    parts.push(text ? text(n, v.skippedTotal === 1) : v.skippedTotal === 1 ? "1 saltata." : `${n} saltate.`);
  }
  if (v.interrupted) {
    const why = v.interrupted.trim().replace(/[.:;]?$/, ".");
    parts.push(`Le altre no: ${why.charAt(0).toLowerCase()}${why.slice(1)}`);
  }
  else if (v.truncated) parts.push("Erano troppe in una volta: ripeti per le altre.");
  if (v.roleMismatch > 0) parts.push("Il referente ha un altro ruolo: per le domande indispensabili servirà la conferma di chi ha il dato.");
  return parts.join(" ");
}

/** «35 minuti», «1 ora», «3 ore e 45 minuti»: come il referente legge la durata nel suo link. */
function durationText(minutes: number): string {
  const n = Math.max(1, Math.round(minutes));
  if (n < 60) return plural(n, "minuto", "minuti");
  const h = Math.floor(n / 60);
  const m = n % 60;
  const hours = h === 1 ? "1 ora" : `${formatCountIt(h)} ore`;
  return m === 0 ? hours : `${hours} e ${plural(m, "minuto", "minuti")}`;
}

/** La riga di una persona nel passo 2: «44 domande · circa 35 minuti · link valido 30 giorni · email». */
export function sendGroupText(g: { questions: number; minutes: number; channel: "email" | "link_manuale" }, emailConfigured: boolean): string {
  const how = g.channel === "email" && emailConfigured ? "email" : "link da copiare";
  return `${plural(g.questions, "domanda", "domande")} · circa ${durationText(g.minutes)} · link valido 30 giorni · ${how}`;
}

// ── (Rilascio 10, §3.5) Persone in due gruppi ─────────────────────────

/**
 * I testi di Persone (rilascio 10, §3.5 e §3.17 dell'audit): due gruppi, «Rispondono per il cliente» (i referenti, con i
 * firmatari come chip) e «Nella realizzazione» (gli account e chi costruisce, prima in Impostazioni del caso); un solo
 * «Invia le domande»; il nuovo referente con tre campi più «Altro». Genere neutro: «un'altra persona», mai «un collega».
 */
export const PEOPLE_TEXT = {
  clientGroup: "Rispondono per il cliente",
  caseGroup: "Nella realizzazione",
  send: "Invia le domande",
  add: "Aggiungi",
  emptyTitle: "Nessun referente",
  emptyBody: "Aggiungi chi risponde per il cliente: ognuno riceve un link con le sue domande.",
  emptyAction: "Aggiungi un referente",
  unassigned: "Senza referente",
  assign: "Affida a…",
  /** «Vedi tutti (5)»: le righe oltre le prime tre. */
  showAll: (n: number) => `Vedi tutti (${formatCountIt(n)})`,
  showFewer: "Mostra meno",
  /** Il «⋯» di una riga: chi firma per il cliente. */
  designate: "Firma per il cliente…",
  changeSigner: { owner: "Cambia chi firma il via…", privacy: "Cambia chi firma la privacy…" },
  indicate: "Indica",
  /** Il «⋯» di una riga, per chi ha domande da far partire. */
  sendOne: "Invia le sue domande",
  sendOneLink: "Prepara il suo link",
  resend: "Reinvia",
  sendNew: "Invia le nuove domande",
  sendNewLink: "Prepara il link delle nuove domande",
  affida: "Affida le sue domande a un'altra persona",
  affidaTitle: (name: string) => `Affida le domande di ${name}`,
  affidaBody: "Le sue domande ancora aperte passano alla persona che scegli. Quelle in un link ancora aperto restano dove sono.",
  assignTitle: (role: string) => `Chi risponde per ${role}`,
  assignBody: "Le domande di questo ruolo ancora senza referente vanno alla persona che scegli. Le invia Lateral Space.",
  choosePerson: "Persona",
  /** «Nella realizzazione». */
  addMember: "Aggiungi una persona",
  addMemberTitle: "Aggiungi una persona alla realizzazione",
  addMemberBody: "Una persona del workspace con un account. Il ruolo dice che cosa vede e che cosa fa.",
  memberWho: "Persona del workspace",
  memberRole: "Ruolo nella realizzazione",
  removeRole: (role: string) => `Togli il ruolo ${role}…`,
  memberMenu: (name: string) => `Altre azioni per ${name}`,
  noMembers: "Ancora nessuno.",
  /** Il nuovo referente: tre campi più «Altro». */
  more: "Altro",
  contactName: "Nome e cognome",
  contactEmail: "Email",
  contactEmailHint: "Una persona del cliente, non di Lateral Space.",
  contactRole: "Per quali domande",
  contactRoleHint: "Le domande di questo ruolo le riceve per prime.",
  contactLabel: "Come lo chiamate (facoltativo)",
  contactPhone: "Telefono (facoltativo)",
  contactChannel: "Canale preferito",
  contactActive: "Referente attivo",
  contactActiveHint: "Si possono mandargli domande.",
} as const;

/** I testi del pannello «Invia le domande» (rilascio 10, §3.5); i passi e «Controlla e invia» sono quelli di «Chiedi al referente». */
export const SEND_TEXT = {
  title: "Invia le domande",
  loading: "Preparo l'elenco…",
  nothing: "Non c'è niente da inviare: le domande assegnate sono già partite o aspettano una risposta.",
  notRequestable: (n: number) => `${n === 1 ? "1 domanda non si può inviare adesso" : `${formatCountIt(n)} domande non si possono inviare adesso`}: bloccate, già partite o senza referente.`,
  /** Sotto l'email: chi altro la riceve. */
  others: (n: number) => (n === 1 ? "Anche l'altra persona riceve la stessa email, con le sue domande." : `Anche le altre ${formatCountIt(n)} persone ricevono la stessa email, con le loro domande.`),
  /** Nessuno dei scelti riceve l'email: il link si copia a mano. */
  noEmail: "Chi hai scelto non ha l'email: il link si copia dalla sua riga in Persone.",
  moreQuestions: (n: number) => (n === 1 ? "E un'altra." : `E altre ${formatCountIt(n)}.`),
} as const;

/** La riga grigia di un referente per Lateral Space (§3.17 dell'audit): il ruolo e «8 aperte»; lo zero non si dice. */
export function personLineText(row: Pick<LsPersonRow, "roleText"> & { open: number }): string | null {
  const open = row.open > 0 ? plural(row.open, "aperta", "aperte") : null;
  return [row.roleText, open].filter(Boolean).join(" · ") || null;
}

/** La riga riassuntiva dei firmatari, solo se manca qualcuno (§3.17 dell'audit); null se ci sono tutti e due. */
export function signersMissingText(designated: { owner: string | null; privacy: string | null }): string | null {
  if (!designated.owner && !designated.privacy) return "Manca chi firma per il cliente.";
  if (!designated.owner) return "Manca chi firma il via per il cliente.";
  if (!designated.privacy) return "Manca chi firma la privacy per il cliente.";
  return null;
}

/** Che cosa fa scegliere «Indica» della riga riassuntiva: la sola firma che manca, oppure nulla (si sceglie nel dialogo). */
export function missingDesignation(designated: { owner: string | null; privacy: string | null }): "owner" | "privacy" | null {
  if (!designated.owner && designated.privacy) return "owner";
  if (designated.owner && !designated.privacy) return "privacy";
  return null;
}

/** Al massimo tre righe in vista, poi «Vedi tutti (N)» (rilascio 10, §1 regola 4). */
export const PEOPLE_ROWS_SHOWN = 3;

/** Le righe da mostrare: le prime tre, o tutte dopo «Vedi tutti». */
export function shownRows<T>(rows: readonly T[], all: boolean): T[] {
  return all ? [...rows] : rows.slice(0, PEOPLE_ROWS_SHOWN);
}

/**
 * L'email vera di «Invia le domande» (rilascio 10, §3.5: come «Chiedi al referente»), nei blocchi dell'anteprima: dal
 * testo semplice di `renderEmail` (lo stesso modello dell'invio, `email-render.ts`), un blocco per paragrafo. Il
 * paragrafo «Apri le domande: <link>» diventa il pulsante, con la sola etichetta; le righe «> » una citazione, le righe
 * «- » un elenco, i paragrafi dopo il pulsante la riga piccola.
 */
export function emailPreviewParts(rendered: { subject: string; text: string }): { subject: string; blocks: Block[] } {
  const blocks: Block[] = [];
  let afterLink = false;
  for (const chunk of rendered.text.trim().split(/\n{2,}/)) {
    const lines = chunk.split("\n");
    const link = lines.length === 1 ? /^(.+?): (https?:\/\/\S+)$/.exec(chunk) : null;
    if (link) {
      blocks.push({ link: { href: link[2], label: link[1] } });
      afterLink = true;
    } else if (lines.every((l) => l.startsWith(">"))) blocks.push({ quote: lines.map((l) => l.replace(/^> ?/, "")).join("\n") });
    else if (lines.every((l) => l.startsWith("- "))) blocks.push({ list: lines.map((l) => l.slice(2)) });
    else blocks.push(afterLink ? { small: chunk } : { p: chunk });
  }
  return { subject: rendered.subject, blocks };
}
