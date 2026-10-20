/**
 * Firme (DESIGN §4.5, §3.11, WP9): un solo costruttore dei testi e delle
 * impronte, per il link di approvazione (`/r`, il firmatario designato dal
 * cliente) e per la pagina `/firme` (l'account di chi guarda). Così il link e
 * l'app mostrano le stesse decisioni, con gli stessi testi e le stesse impronte.
 *
 * - Ogni firma porta il suo testo canonico e l'impronta (`textHash`): «Ho letto e
 *   approvo» vale solo sul testo letto. Per deroghe e ripieghi l'impronta è la
 *   stessa dei comandi interni (`signedTextHash`), per il via allo sviluppo
 *   quella della proposta, per la scheda privacy quella delle prove.
 * - Le impronte si calcolano dai dati, mai dalle righe mostrate: i testi visibili
 *   si possono riscrivere (DESIGN §4.1), le impronte no. Un test a istantanea le
 *   fissa.
 * - Titoli e righe senza chiavi, articoli, sigle o codici del via: li legge il
 *   cliente (`copy-guard`). Per Lateral Space impronta e testo confermato stanno
 *   in `technical`, che la pagina mostra solo dentro «Dettagli tecnici».
 * - Ordine: via allo sviluppo, «non si applica», partenze senza risposta e
 *   soluzioni provvisorie, scheda privacy, accessi ai dati personali (A1 di §4.5).
 *
 * Modulo puro (lato server: usa `node:crypto` per le impronte). I componenti
 * del browser ne importano solo i tipi.
 */
import { blockerEvidenceHash, type BlockerEvidence } from "../blockers.ts";
import { signatureSideOf, type SignatureSide } from "../permissions.ts";
import type { ApprovalKind, ApprovalView } from "../public-view.ts";
import { sha256Hex, stableStringify } from "../snapshot.ts";
import { rowBool, rowDate, rowJson, rowNumber, rowObject, rowString, rowStringArray, type Row } from "../sql/readiness.ts";
import type { Approval } from "../types.ts";
import type { CaseRole } from "../vocab.ts";
import { readableText } from "./description.ts";
import { formatDateIt } from "./format.ts";
import { ROLE_LABEL, dayWithArticle } from "./labels.ts";

export interface PendingApprovalRows {
  na: readonly Row[];
  waiversAndFallbacks: readonly Row[];
  gates: readonly Row[];
  a8: readonly Row[];
  zone: readonly Row[];
}

/** Chi firma una decisione: il cliente (link, responsabile del cliente, approvatore privacy) o Lateral Space. */
export type SignerSide = SignatureSide;

/**
 * Una firma da mostrare, nell'elenco (A1) e una alla volta (A2). Estende la
 * firma del link (`ApprovalView`, invariata per l'API di `/r`) con i testi di
 * §4.5 e il lato di chi firma.
 */
export interface ApprovalStep extends ApprovalView {
  side: SignerSide;
  /** L'altro lato ha già firmato; per un accesso ai dati personali vale la proposta di Lateral Space. */
  otherSideSigned: boolean;
  /** Seconda riga nell'elenco: il titolo della domanda o della decisione, mai la chiave. */
  summary: string;
  /** Frase prima del testo canonico (solo il via allo sviluppo). */
  intro: string | null;
  /** Righe chiuse sotto «Dettagli». */
  details: string[];
  /** La domanda della firma («non si applica», partenza senza risposta, soluzione provvisoria). */
  itemId: string | null;
  /** Titolo della domanda o nome della persona. */
  subject: string | null;
  /** Solo per chi firma per Lateral Space: impronta e testo confermato, in «Dettagli tecnici». */
  technical: string[];
}

function approvalsOf(raw: unknown): Approval[] {
  const list = rowJson<unknown[]>(raw);
  return Array.isArray(list) ? (list.filter((a) => a && typeof a === "object" && typeof (a as Approval).ruolo === "string") as Approval[]) : [];
}

function sides(approvals: readonly Approval[]): { ls: boolean; cliente: boolean } {
  return {
    ls: approvals.some((a) => signatureSideOf(a.ruolo) === "ls"),
    cliente: approvals.some((a) => signatureSideOf(a.ruolo) === "cliente"),
  };
}

function textHash(value: unknown): string {
  return sha256Hex(stableStringify(value));
}

/** Impronta della proposta NA mostrata al firmatario: voce, motivo, data della proposta. */
export function naApprovalHash(i: { itemId: string; reason: string; proposedAt: Date }): string {
  return textHash({ kind: "na", item: i.itemId.toLowerCase(), reason: i.reason, proposed_at: i.proposedAt.toISOString() });
}

/** Stessa impronta di `signedTextHash(waiverText(…))` del comando `signWaiver`. */
export function waiverApprovalHash(w: { motivo: string; piano: string; scadenza: string }): string {
  return textHash({ motivo: w.motivo, piano: w.piano, scadenza: w.scadenza });
}

/** Stessa impronta di `signedTextHash(fallbackText(…))` del comando `signFallback`. */
export function fallbackApprovalHash(f: { descrizione: string; valido_per: readonly string[]; da_sostituire_entro: string | null }): string {
  return textHash({ descrizione: f.descrizione, valido_per: [...f.valido_per], da_sostituire_entro: f.da_sostituire_entro });
}

export function zoneApprovalHash(g: { beneficiary_user_id: string; proposed_by_user_id: string; at: string }): string {
  return textHash({ kind: "zona_personale", beneficiary: g.beneficiary_user_id, proposed_by: g.proposed_by_user_id, at: g.at });
}

// ── Testi (DESIGN §4.5, «Titoli e righe riscritti») ───────────────────

/** Lato che deve ancora firmare per chi guarda: prima Lateral Space, poi il cliente. */
interface Pending {
  side: SignerSide;
  otherSideSigned: boolean;
}

function pendingFor(mine: { ls: boolean; cliente: boolean }, signed: { ls: boolean; cliente: boolean }): Pending | null {
  if (mine.ls && !signed.ls) return { side: "ls", otherSideSigned: signed.cliente };
  if (mine.cliente && !signed.cliente) return { side: "cliente", otherSideSigned: signed.ls };
  return null;
}

/** Campi comuni a ogni firma per chi firma da questo lato. */
function common(p: Pending, hash: string): Pick<ApprovalStep, "side" | "otherSideSigned" | "waitingForLs" | "textHash"> {
  // `waitingForLs` resta quello del link: Lateral Space non ha ancora firmato.
  return { side: p.side, otherSideSigned: p.otherSideSigned, waitingForLs: p.side === "ls" || !p.otherSideSigned, textHash: hash };
}

function technical(p: Pending, lines: readonly (string | null)[]): string[] {
  return p.side === "ls" ? lines.filter((l): l is string => !!l) : [];
}

/**
 * Il titolo della domanda di una firma. Al cliente senza chiavi, articoli,
 * sigle o priorità in inglese, come in Domande (`readableText`): finisce in
 * riepilogo, riga «Domanda: …» e nel menu delle firme della testata. Nessuna
 * impronta usa il titolo.
 */
function questionTitle(r: Row, side: SignerSide): string {
  const title = rowString(r.title)?.trim() ?? "";
  return (side === "cliente" ? readableText(title, "cliente") : title) || "Una domanda senza titolo";
}

/** «Entro il 31 gen 2027.» (l'articolo si elide davanti a 1, 8 e 11). */
function untilLine(prefix: string, iso: string | null): string | null {
  const day = formatDateIt(iso);
  return day ? `${prefix} ${dayWithArticle("il", day)}.` : null;
}

/** «245 domande indispensabili su 245 sono a posto.» */
export function gateCountLine(okCount: number | null, required: number | null): string {
  if (okCount === null || required === null) return "Le domande indispensabili sono a posto.";
  const one = okCount === 1;
  return `${okCount} ${one ? "domanda indispensabile" : "domande indispensabili"} su ${required} ${one ? "è" : "sono"} a posto.`;
}

function waiverCountLine(n: number): string {
  if (n <= 0) return "Nessuna domanda parte senza risposta.";
  return n === 1 ? "Una domanda parte senza risposta." : `${n} domande partono senza risposta.`;
}

function roleName(code: string): string {
  const label = (ROLE_LABEL as Readonly<Record<string, string>>)[code];
  const text = label ?? code.replace(/_/g, " ").trim();
  return text ? text.charAt(0).toLowerCase() + text.slice(1) : code;
}

const PERSON_FALLBACK = "Persona di Lateral Space";

function gateStep(r: Row, p: Pending): ApprovalStep {
  const computed = rowObject(r.computed);
  const waivers = rowNumber(rowObject(computed.waivers).used) ?? 0;
  const hasEvidence = rowBool(r.has_evidence);
  const hash = String(r.summary_text_hash ?? "");
  const confirmed = typeof computed.summary_text === "string" ? computed.summary_text : null;
  return {
    kind: "gate",
    targetId: String(r.id),
    designation: "owner",
    title: "Via allo sviluppo",
    summary: "Lateral Space può iniziare a costruire la soluzione.",
    intro:
      p.side === "cliente"
        ? "Con la tua firma Lateral Space inizia a costruire la soluzione con le risposte verificate."
        : "Con le due firme Lateral Space inizia a costruire la soluzione con le risposte verificate.",
    lines: [gateCountLine(rowNumber(computed.ok), rowNumber(computed.required))],
    // Per il cliente sparisce «Prova scritta: non ancora allegata.» (§4.5).
    details: [waiverCountLine(waivers), ...(hasEvidence ? ["Prova scritta allegata."] : p.side === "ls" ? ["Prova scritta: non ancora allegata."] : [])],
    canReject: true,
    itemId: null,
    subject: null,
    technical: technical(p, [confirmed ? `Testo confermato: ${confirmed}` : null, `Impronta del testo: ${hash}`]),
    ...common(p, hash),
  };
}

function naStep(r: Row, p: Pending, na: { reason: string; proposedAt: Date }): ApprovalStep {
  const question = questionTitle(r, p.side);
  const hash = naApprovalHash({ itemId: String(r.id), reason: na.reason, proposedAt: na.proposedAt });
  return {
    kind: "na",
    targetId: String(r.id),
    designation: "owner",
    title: p.side === "cliente" ? "Una domanda che non vale per voi" : "Una domanda che non si applica",
    summary: question,
    intro: null,
    lines: [`Domanda: ${question}`, `Perché non vale: ${na.reason}`, `L'ha proposto: ${rowBool(r.by_referent) ? "il referente" : "Lateral Space"}`],
    details: [],
    canReject: true,
    itemId: String(r.id),
    subject: question,
    technical: technical(p, [`Impronta del testo: ${hash}`]),
    ...common(p, hash),
  };
}

function waiverStep(r: Row, p: Pending, w: { motivo: string; piano: string; scadenza: string }): ApprovalStep {
  const question = questionTitle(r, p.side);
  const hash = waiverApprovalHash(w);
  return {
    kind: "deroga",
    targetId: String(r.id),
    designation: "owner",
    title: "Partire senza una risposta",
    summary: question,
    intro: null,
    lines: [`Domanda: ${question}`, `Perché partire senza: ${w.motivo}`, `Come la chiudiamo: ${w.piano}`, untilLine("Entro", w.scadenza) ?? "Entro una data da indicare."],
    details: [],
    canReject: false,
    itemId: String(r.id),
    subject: question,
    technical: technical(p, [`Impronta del testo: ${hash}`]),
    ...common(p, hash),
  };
}

function fallbackStep(r: Row, p: Pending, f: { descrizione: string; valido_per: string[]; da_sostituire_entro: string | null }): ApprovalStep {
  const question = questionTitle(r, p.side);
  const hash = fallbackApprovalHash(f);
  return {
    kind: "ripiego",
    targetId: String(r.id),
    designation: "owner",
    title: "Una soluzione provvisoria",
    summary: question,
    intro: null,
    lines: [
      `Domanda: ${question}`,
      `Al suo posto usiamo: ${f.descrizione}`,
      untilLine("Da sostituire entro", f.da_sostituire_entro) ?? "Da sostituire appena possibile.",
      "Vale solo per l'avvio dello sviluppo.",
    ],
    details: [],
    canReject: false,
    itemId: String(r.id),
    subject: question,
    technical: technical(p, [`Impronta del testo: ${hash}`]),
    ...common(p, hash),
  };
}

function a8Step(r: Row, p: Pending, evidence: BlockerEvidence, hash: string): ApprovalStep {
  const text = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const doc = text(evidence.documento);
  const version = text(evidence.versione);
  const day = formatDateIt(text(evidence.data));
  const roles = rowStringArray(evidence.approvatori_per_ruolo).map(roleName);
  const names = rowStringArray(r.access_names);
  const yes = (v: unknown) => (v === true ? "sì" : "no");
  return {
    kind: "a8",
    targetId: String(r.id),
    designation: "privacy",
    title: "Scheda privacy del caso",
    summary: doc ? `${doc}${version ? `, versione ${version}` : ""}` : "I dati personali del caso",
    intro: null,
    lines: [
      `Documento: ${[doc ?? "da indicare", version ? `versione ${version}` : null, day ? dayWithArticle("del", day) : null].filter(Boolean).join(", ")}`,
      `L'hanno approvata: ${roles.length ? roles.join(", ") : "da indicare"}`,
      `${p.side === "cliente" ? "La vostra azienda può usare questi dati per il caso" : "Il cliente può usare questi dati per il caso"}: ${yes(evidence.titolo_art_15_2)}`,
      `I dati restano nella regione concordata: ${yes(evidence.regione_dati_verificata)}`,
      `Potranno vederli: ${names.length ? names.join(", ") : "nessuno"}`,
    ],
    details: [],
    canReject: false,
    itemId: null,
    subject: doc,
    technical: technical(p, [`Impronta del testo: ${hash}`]),
    ...common(p, hash),
  };
}

function zoneStep(r: Row, p: Pending, g: { beneficiary_user_id: string; proposed_by_user_id: string; at: string }): ApprovalStep {
  const name = rowString(r.name)?.trim() || PERSON_FALLBACK;
  const person = name === PERSON_FALLBACK ? "Una persona di Lateral Space" : `${name} di Lateral Space`;
  const hash = zoneApprovalHash(g);
  return {
    kind: "zona_personale",
    targetId: String(r.user_id),
    designation: "privacy",
    title: "Accesso ai dati personali",
    summary: person,
    intro: null,
    lines: [`${person} potrà vedere i dati personali del caso.`, "Ogni accesso resta registrato.", untilLine("Proposto", g.at) ?? "Proposto da Lateral Space."],
    details: [],
    canReject: false,
    itemId: null,
    subject: name,
    technical: technical(p, [`Impronta del testo: ${hash}`]),
    ...common(p, hash),
  };
}

/** Chi firma per quale lato: per il via e per le domande il responsabile, per la privacy l'approvatore. */
interface Signers {
  lead: boolean;
  owner: boolean;
  privacy: boolean;
}

/**
 * Le firme in attesa di chi firma, dalle righe di `sql/public.ts` (o di
 * `uc-signatures.ts`). `naClientSigned` dice se il cliente ha già firmato un
 * «non si applica»: dal link conta solo il firmatario designato di adesso.
 */
function collectSteps(rows: PendingApprovalRows, who: Signers, naClientSigned: (r: Row) => boolean): ApprovalStep[] {
  const out: ApprovalStep[] = [];
  const owner = { ls: who.lead, cliente: who.owner };
  const privacy = { ls: who.lead, cliente: who.privacy };

  for (const r of rows.gates) {
    const p = pendingFor(owner, sides(approvalsOf(r.approvals)));
    if (p) out.push(gateStep(r, p));
  }
  for (const r of rows.na) {
    const proposedAt = rowDate(r.na_proposed_at);
    const reason = rowString(r.na_reason);
    if (!proposedAt || !reason) continue;
    const p = pendingFor(owner, { ls: rowBool(r.ls_signed), cliente: naClientSigned(r) });
    if (p) out.push(naStep(r, p, { reason, proposedAt }));
  }
  for (const r of rows.waiversAndFallbacks) {
    const waiver = rowObject(r.waiver);
    if (typeof waiver.motivo === "string" && typeof waiver.piano === "string" && typeof waiver.scadenza === "string") {
      const p = pendingFor(owner, sides(approvalsOf(waiver.approvazioni)));
      if (p) out.push(waiverStep(r, p, { motivo: waiver.motivo, piano: waiver.piano, scadenza: waiver.scadenza }));
    }
    const fallback = rowObject(r.fallback);
    if (typeof fallback.descrizione === "string") {
      const p = pendingFor(owner, sides(approvalsOf(fallback.approvazioni)));
      const until = typeof fallback.da_sostituire_entro === "string" ? fallback.da_sostituire_entro : null;
      if (p) out.push(fallbackStep(r, p, { descrizione: fallback.descrizione, valido_per: rowStringArray(fallback.valido_per), da_sostituire_entro: until }));
    }
  }
  for (const r of rows.a8) {
    const evidence = rowObject(r.evidence) as BlockerEvidence;
    if (Object.keys(evidence).length === 0) continue;
    const hash = blockerEvidenceHash(evidence);
    // Vale solo la firma sulle prove di adesso: con prove nuove si firma di nuovo.
    const p = pendingFor(privacy, sides(approvalsOf(r.approvals).filter((a) => a.text_hash === hash)));
    if (p) out.push(a8Step(r, p, evidence, hash));
  }
  for (const r of rows.zone) {
    const grant = rowObject(r.personal_zone_grant);
    const beneficiary = rowString(grant.beneficiary_user_id);
    const proposer = rowString(grant.proposed_by_user_id);
    const at = rowString(grant.at);
    if (!beneficiary || !proposer || !at) continue;
    // Firma solo l'approvatore privacy: la proposta di Lateral Space vale come sua firma.
    const p = pendingFor({ ls: false, cliente: who.privacy }, { ls: true, cliente: sides(approvalsOf(grant.approvals)).cliente });
    if (p) out.push(zoneStep(r, p, { beneficiary_user_id: beneficiary, proposed_by_user_id: proposer, at }));
  }
  return out;
}

/**
 * Firme in attesa del contatto del link, secondo le sue designazioni con prova:
 * responsabile del cliente → via allo sviluppo, «non si applica», partenze senza
 * risposta e soluzioni provvisorie; approvatore privacy → scheda privacy e
 * accessi ai dati personali. Solo quelle in cui manca ancora la firma del cliente.
 */
export function buildApprovals(i: { rows: PendingApprovalRows; contactId: string; designated: { owner: string | null; privacy: string | null } }): ApprovalStep[] {
  const owner = i.designated.owner !== null && i.designated.owner === i.contactId;
  const privacy = i.designated.privacy !== null && i.designated.privacy === i.contactId;
  if (!owner && !privacy) return [];
  return collectSteps(i.rows, { lead: false, owner, privacy }, (r) => {
    const linkSigner = rowString(r.client_contact_id);
    return rowBool(r.client_user_signed) || (linkSigner !== null && linkSigner === i.designated.owner);
  });
}

/**
 * Firme in attesa dell'account di chi guarda, dai suoi ruoli di adesso (già
 * ricalcolati da `requireDossierRole`): il responsabile Lateral Space firma per
 * Lateral Space (via, «non si applica», partenze senza risposta, soluzioni
 * provvisorie, scheda privacy), il responsabile del cliente per il cliente salvo
 * la privacy, l'approvatore privacy la scheda privacy e gli accessi ai dati
 * personali. Per il cliente testi e impronte sono gli stessi del link.
 *
 * Una firma dal link di un contatto non più designato non conta: le righe di
 * `uc-signatures.ts` lo dicono con `client_link_signed`.
 */
export function buildCaseApprovals(i: { rows: PendingApprovalRows; roles: readonly CaseRole[] }): ApprovalStep[] {
  const who = { lead: i.roles.includes("ls_lead"), owner: i.roles.includes("owner_cliente"), privacy: i.roles.includes("approvatore_privacy") };
  if (!who.lead && !who.owner && !who.privacy) return [];
  return collectSteps(i.rows, who, (r) =>
    rowBool(r.client_user_signed) || ("client_link_signed" in r ? rowBool(r.client_link_signed) : rowString(r.client_contact_id) !== null),
  );
}

// ── Chi decide (le action di oggi, adattate a `/firme`) ───────────────

/**
 * Ruoli di caso ammessi per ogni decisione, gli stessi delle action di oggi:
 * `signNaAction`/`rejectNaAction`, `signWaiverAction`, `signFallbackAction`,
 * `signGateAction`/`rejectGateAction`, `resolveBlockerAction`,
 * `signPersonalZoneAccessAction`. Un test lo confronta con i loro sorgenti.
 * «Non approvo» esiste solo dove esiste un comando che respinge.
 */
export const APPROVAL_DECISION_ROLES: Readonly<Record<ApprovalKind, { approvo: readonly CaseRole[]; non_approvo: readonly CaseRole[] }>> = {
  na: { approvo: ["ls_lead", "owner_cliente"], non_approvo: ["ls_lead", "owner_cliente"] },
  deroga: { approvo: ["ls_lead", "owner_cliente"], non_approvo: [] },
  ripiego: { approvo: ["ls_lead", "owner_cliente"], non_approvo: [] },
  gate: { approvo: ["ls_lead", "owner_cliente"], non_approvo: ["ls_lead", "owner_cliente"] },
  a8: { approvo: ["ls_lead", "approvatore_privacy"], non_approvo: [] },
  zona_personale: { approvo: ["approvatore_privacy"], non_approvo: [] },
};

/** Chi può aprire `/firme` e decidere: l'unione dei ruoli qui sopra. */
export const APPROVAL_SIGNER_ROLES: readonly CaseRole[] = ["ls_lead", "owner_cliente", "approvatore_privacy"];

export function approvalDecisionAllowed(kind: ApprovalKind, decision: "approvo" | "non_approvo", roles: readonly CaseRole[]): boolean {
  return APPROVAL_DECISION_ROLES[kind][decision].some((r) => roles.includes(r));
}
