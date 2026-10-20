/**
 * Pagina Privacy del caso (DESIGN §3.10; PIANO §5.1, §3.3, §3.5, §6.6; D32,
 * D46): la scheda privacy a due firme (blocco `a8`), modalità dei dati,
 * domande per riservatezza e zona dei dati personali (solo metadati). Gli altri
 * blocchi stanno in Panoramica › Blocchi.
 *
 * Le prove dei blocchi contengono solo codici, date, ruoli e id di file o di
 * persone di Lateral Space: mai nomi del cliente. La pagina mostra i nomi dei
 * file e delle persone partendo dagli id.
 *
 * Nessun articolo e nessuna sigla nei testi (`copy-guard`): «A.8» resta solo
 * nell'etichetta del documento del modulo di Lateral Space.
 *
 * Modulo puro (l'impronta delle prove usa lo SHA-256 in JavaScript di `gates.ts`).
 */
import { blockerEvidenceHash, checkBlockerEvidence, type BlockerEvidence } from "../blockers.ts";
import { fail, ok, type Json, type Result } from "../types.ts";
import { PRIVACY_CLASSES, type BlockerStatus, type DataMode, type PrivacyClass, type SemaforoColor } from "../vocab.ts";
import { PRIVACY_LABEL, blockerLabel } from "./labels.ts";
import type { PersonalZoneMemberState } from "./people.ts";
import { BLOCKER_STATUS_LABEL, blockerResolver } from "./progress.ts";

export const A8_KEY = "a8";

export interface BlockerRowInput {
  id: string;
  key: string;
  label: string;
  status: BlockerStatus;
  items: number;
  evidence: Record<string, Json> | null;
  approvals: readonly Json[];
  resolvedAt: string | null;
  fallbackAllowed: string | null;
}

export interface SignatureInfo {
  at: string;
  metodo: string;
}

export interface BlockerView {
  id: string;
  key: string;
  label: string;
  status: BlockerStatus;
  statusLabel: string;
  tone: SemaforoColor;
  items: number;
  resolver: string;
  resolvedAt: string | null;
  fallbackAllowed: string | null;
  /** Prove registrate, già leggibili (etichetta, valore). */
  evidence: [string, string][];
  /** Solo `a8`: firme sulle prove registrate e chi manca. */
  a8: { evidenceComplete: boolean; ls: SignatureInfo | null; cliente: SignatureInfo | null; waitingFor: "lateral_space" | "cliente" | null } | null;
}

const STATUS_TONE: Readonly<Record<BlockerStatus, SemaforoColor>> = { attivo: "lucchetto", sciolto: "verde", permanente: "rosso" };

export interface EvidenceLookups {
  files?: ReadonlyMap<string, string>;
  people?: ReadonlyMap<string, string>;
  roles?: Readonly<Record<string, string>>;
}

function yesNo(v: unknown): string | null {
  return v === true ? "Sì" : v === false ? "No" : null;
}

function dateIt(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : v;
}

function list(v: unknown, map: (s: string) => string): string | null {
  if (!Array.isArray(v)) return null;
  const items = v.filter((x): x is string => typeof x === "string").map(map);
  return items.length ? items.join(", ") : "Nessuno";
}

/**
 * Prove registrate in righe leggibili («Cosa approvi»: documento, versione,
 * regioni dei dati, chi accede); le chiavi sconosciute non si mostrano. Nessun
 * articolo nelle etichette.
 */
export function evidenceRows(evidence: Readonly<Record<string, Json>> | null, lookups: EvidenceLookups = {}): [string, string][] {
  if (!evidence) return [];
  const rows: [string, string | null][] = [
    ["Documento", typeof evidence.documento === "string" ? evidence.documento : null],
    ["Versione", typeof evidence.versione === "string" ? evidence.versione : null],
    ["Approvata il", dateIt(evidence.data)],
    ["Descrizione", typeof evidence.descrizione === "string" ? evidence.descrizione : null],
    ["Chi l'ha approvata", list(evidence.approvatori_per_ruolo, (r) => lookups.roles?.[r] ?? r)],
    ["File firmato", typeof evidence.file_id === "string" ? (lookups.files?.get(evidence.file_id) ?? "File del caso") : null],
    ["Titolo per usare i dati", yesNo(evidence.titolo_art_15_2)],
    ["Regioni dei dati verificate", yesNo(evidence.regione_dati_verificata)],
    ["Chi accede ai dati personali", list(evidence.accesso_zona_personale, (u) => lookups.people?.get(u) ?? "Persona di Lateral Space")],
  ];
  return rows.filter((r): r is [string, string] => r[1] !== null);
}

function signatureOf(approvals: readonly Json[], ruolo: string, hash: string): SignatureInfo | null {
  for (const a of approvals) {
    if (!a || typeof a !== "object" || Array.isArray(a)) continue;
    const r = a as Record<string, Json>;
    if (r.ruolo === ruolo && r.text_hash === hash) return { at: String(r.at ?? ""), metodo: String(r.metodo ?? "") };
  }
  return null;
}

/** Vista di un blocco per la pagina Privacy. */
export function blockerView(b: BlockerRowInput, lookups: EvidenceLookups = {}): BlockerView {
  let a8: BlockerView["a8"] = null;
  if (b.key === A8_KEY) {
    const checked = b.evidence ? checkBlockerEvidence(A8_KEY, b.evidence) : null;
    if (checked?.ok) {
      const hash = blockerEvidenceHash(checked.value);
      const ls = signatureOf(b.approvals, "ls_lead", hash);
      const cliente = signatureOf(b.approvals, "approvatore_privacy", hash);
      a8 = { evidenceComplete: true, ls, cliente, waitingFor: b.status !== "attivo" ? null : ls && !cliente ? "cliente" : cliente && !ls ? "lateral_space" : null };
    } else {
      a8 = { evidenceComplete: false, ls: null, cliente: null, waitingFor: null };
    }
  }
  return {
    id: b.id,
    key: b.key,
    label: b.label || blockerLabel(b.key),
    status: b.status,
    statusLabel: BLOCKER_STATUS_LABEL[b.status] ?? b.status,
    tone: STATUS_TONE[b.status],
    items: b.items,
    resolver: blockerResolver(b.key),
    resolvedAt: b.resolvedAt,
    fallbackAllowed: b.fallbackAllowed,
    evidence: evidenceRows(b.evidence, lookups),
    a8,
  };
}

// ── Moduli delle prove ────────────────────────────────────────────────

export interface A8FormInput {
  documento: string;
  versione: string;
  data: string;
  approvatori: readonly string[];
  fileId: string;
  titolo: boolean;
  regione: boolean;
  accesso: readonly string[];
}

/** Prove della scheda A.8 dal modulo, controllate come le controlla il server. */
export function buildA8Evidence(f: A8FormInput): Result<BlockerEvidence> {
  const evidence: Record<string, Json> = {
    documento: f.documento.trim(),
    versione: f.versione.trim(),
    data: f.data.trim(),
    approvatori_per_ruolo: [...new Set(f.approvatori)],
    file_id: f.fileId.trim(),
    titolo_art_15_2: f.titolo,
    regione_dati_verificata: f.regione,
    accesso_zona_personale: [...new Set(f.accesso)],
  };
  return checkBlockerEvidence(A8_KEY, evidence);
}

export interface BlockerFormInput {
  fileId: string;
  data: string;
  descrizione: string;
}

/** Quali campi chiede il modulo di scioglimento di un blocco (non `a8`). */
export function blockerFormFields(key: string): { file: "obbligatorio" | "facoltativo" | "no"; data: boolean; descrizione: "obbligatoria" | "facoltativa" | "no" } {
  switch (key) {
    case "decisione_board":
    case "fuori_foundation":
      return { file: "obbligatorio", data: true, descrizione: "no" };
    case "costi_art_8_4":
      return { file: "obbligatorio", data: true, descrizione: "no" };
    case "accesso_sistema":
      return { file: "facoltativo", data: true, descrizione: "obbligatoria" };
    default:
      return { file: "facoltativo", data: true, descrizione: "facoltativa" };
  }
}

/** Prove di un blocco (non `a8`) dal modulo: solo i campi compilati, poi il controllo del server. */
export function buildBlockerEvidence(key: string, f: BlockerFormInput): Result<BlockerEvidence> {
  if (key === A8_KEY) return fail("dati_non_validi", "La scheda privacy ha il suo modulo.");
  const evidence: Record<string, Json> = {};
  if (f.fileId.trim()) evidence.file_id = f.fileId.trim();
  if (f.data.trim()) evidence.data = f.data.trim();
  if (f.descrizione.trim()) evidence.descrizione = f.descrizione.trim();
  const checked = checkBlockerEvidence(key, evidence);
  return checked.ok ? ok(checked.value) : checked;
}

// ── Dati del caso ─────────────────────────────────────────────────────

export const DATA_MODE_LABEL: Readonly<Record<DataMode, { label: string; help: string }>> = {
  solo_sintetici: { label: "Solo dati sintetici", help: "Si sviluppa e si prova con dati inventati. Nessun dato personale reale entra nel caso." },
  pseudonimizzati: { label: "Dati pseudonimizzati", help: "I dati reali entrano senza nomi né identificativi diretti, dopo la scheda privacy firmata." },
  reali: { label: "Dati reali", help: "I dati reali entrano nella zona cifrata dei dati personali, solo dopo la scheda privacy firmata." },
};

export function dataModeView(mode: string): { label: string; help: string } {
  return DATA_MODE_LABEL[mode as DataMode] ?? { label: mode, help: "" };
}

/** Voci per classe privacy, dalla più restrittiva, con le etichette (anche quelle a zero). */
export function privacyClassRows(counts: Readonly<Partial<Record<PrivacyClass, number>>>): { key: PrivacyClass; label: string; count: number }[] {
  return PRIVACY_CLASSES.map((k) => ({ key: k, label: PRIVACY_LABEL[k], count: counts[k] ?? 0 }));
}

/**
 * «Domande per riservatezza» (solo Lateral Space): per classe, le domande ai
 * referenti e tutto il catalogo. Lo zero non si mostra: le classi senza nulla
 * spariscono.
 */
export function privacyQuestionRows(counts: {
  all: Readonly<Partial<Record<PrivacyClass, number>>>;
  questions: Readonly<Partial<Record<PrivacyClass, number>>>;
}): { key: PrivacyClass; label: string; questions: number; all: number }[] {
  return privacyClassRows(counts.all)
    .map((r) => ({ key: r.key, label: r.label, questions: counts.questions[r.key] ?? 0, all: r.count }))
    .filter((r) => r.all > 0 || r.questions > 0);
}

/**
 * Stato della zona dei dati personali in poche parole: «2 persone con
 * accesso» quando è aperta, altrimenti perché è chiusa. Senza la chiave
 * della zona il motivo tecnico lo legge solo Lateral Space (`lsViewer`); il
 * cliente legge che la zona si apre quando Lateral Space la attiva.
 */
export function personalZoneState(i: { a8Status: BlockerStatus | null; keyConfigured: boolean; activeMembers: number; lsViewer: boolean }): { open: boolean; text: string } {
  if (i.a8Status !== "sciolto") return { open: false, text: "Chiusa: si apre dopo la scheda privacy firmata." };
  if (!i.keyConfigured) {
    return {
      open: false,
      text: i.lsViewer ? "Chiusa: la scheda privacy è firmata, ma manca la chiave nella configurazione." : "Chiusa: si apre dopo l'attivazione da parte di Lateral Space.",
    };
  }
  if (i.activeMembers === 0) return { open: true, text: "Aperta, nessuno ha ancora accesso." };
  return { open: true, text: i.activeMembers === 1 ? "1 persona con accesso" : `${i.activeMembers} persone con accesso` };
}

/**
 * La riga in cima al riquadro «Scheda privacy» (DESIGN §3.10): cosa manca,
 * in parole semplici e senza sigle. `waiting` dice da chi si aspetta qualcosa.
 */
export function privacyCardStatus(view: BlockerView): { text: string; tone: SemaforoColor; waiting: "lateral_space" | "cliente" | null } {
  if (view.status === "sciolto") return { text: "Firmata da Lateral Space e dal cliente: i dati personali reali possono entrare.", tone: "verde", waiting: null };
  const a8 = view.a8;
  if (!a8 || !a8.evidenceComplete) return { text: "Lateral Space non ha ancora registrato la scheda firmata.", tone: "lucchetto", waiting: "lateral_space" };
  if (a8.ls && !a8.cliente) return { text: "Manca la firma del cliente.", tone: "giallo", waiting: "cliente" };
  if (a8.cliente && !a8.ls) return { text: "Manca la firma di Lateral Space.", tone: "giallo", waiting: "lateral_space" };
  return { text: "Mancano le firme di Lateral Space e del cliente.", tone: "giallo", waiting: "lateral_space" };
}

/** Modulo della scheda A.8 precompilato dalle prove già registrate (per correggerle). */
export function a8FormFromEvidence(evidence: Readonly<Record<string, Json>> | null): A8FormInput {
  const e = evidence ?? {};
  const s = (v: Json | undefined) => (typeof v === "string" ? v : "");
  const arr = (v: Json | undefined) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return {
    documento: s(e.documento),
    versione: s(e.versione),
    data: s(e.data),
    approvatori: arr(e.approvatori_per_ruolo),
    fileId: s(e.file_id),
    titolo: e.titolo_art_15_2 === true,
    regione: e.regione_dati_verificata === true,
    accesso: arr(e.accesso_zona_personale),
  };
}

export interface SignatureLine {
  role: "ls_lead" | "approvatore_privacy";
  /** «Lateral Space» oppure «Cliente». */
  label: string;
  /** «firmata il 3 ott», «firmata il 3 ott dal link» oppure «da firmare». */
  text: string;
  signed: boolean;
}

/**
 * Le due firme della scheda privacy in parole semplici («Lateral Space ✓
 * firmata il 3 ott», «Cliente ○ da firmare»); le date arrivano già come testo
 * di Roma. Firmano il responsabile Lateral Space e l'approvatore privacy.
 */
export function a8SignatureLines(view: BlockerView, fmt: (iso: string | null) => string | null): SignatureLine[] {
  if (!view.a8) return [];
  const line = (role: SignatureLine["role"], label: string, sig: SignatureInfo | null): SignatureLine => {
    if (!sig) return { role, label, text: "da firmare", signed: false };
    const when = fmt(sig.at);
    return { role, label, text: `firmata${when ? ` il ${when}` : ""}${sig.metodo === "link" ? " dal link" : ""}`, signed: true };
  };
  return [line("ls_lead", "Lateral Space", view.a8.ls), line("approvatore_privacy", "Cliente", view.a8.cliente)];
}

// ── Accessi alla zona dei dati personali ──────────────────────────────

/** Una persona di Lateral Space nel pannello «Zona dei dati personali». */
export interface ZoneMemberRow {
  userId: string;
  name: string;
  state: PersonalZoneMemberState;
  /** Indicato nella scheda privacy tra chi può entrare nella zona dei dati personali. */
  inA8List: boolean;
  /** Chi ha proposto l'accesso in attesa. */
  proposedBy: string | null;
}

/** Chi guarda il pannello della zona. */
export interface ZoneViewer {
  userId: string;
  lead: boolean;
  privacyApprover: boolean;
  /** Può scrivere adesso (non in sola lettura, caso non chiuso). */
  write: boolean;
  /** Il caso è in pausa: si toglie un accesso, ma non se ne propongono né firmano di nuovi. */
  paused: boolean;
}

/**
 * Cosa può fare chi guarda su una riga (DESIGN §3.10, PIANO §6.6): l'accesso
 * lo propone il responsabile Lateral Space (mai per sé e solo a chi è nella
 * scheda privacy), lo attiva la firma dell'approvatore privacy; lo toglie il
 * responsabile, l'approvatore o la persona stessa, anche in pausa. Il server
 * ricontrolla tutto.
 */
export function personalZoneActions(m: ZoneMemberRow, viewer: ZoneViewer): { self: boolean; propose: boolean; sign: boolean; revoke: boolean } {
  const self = m.userId === viewer.userId;
  return {
    self,
    propose: viewer.write && !viewer.paused && viewer.lead && m.state === "no" && m.inA8List && !self,
    sign: viewer.write && !viewer.paused && viewer.privacyApprover && m.state === "in_attesa",
    revoke: viewer.write && m.state !== "no" && (viewer.lead || viewer.privacyApprover || self),
  };
}

/** Chi guarda ha qualcosa da fare nel pannello (proporre, firmare o togliere un accesso). */
export function canManagePersonalZone(members: readonly ZoneMemberRow[], viewer: ZoneViewer): boolean {
  return members.some((m) => {
    const a = personalZoneActions(m, viewer);
    return a.propose || a.sign || a.revoke;
  });
}
