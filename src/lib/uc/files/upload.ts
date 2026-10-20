/**
 * Regole pure del caricamento dei file (PIANO §6.1–6.3, §6.6, §6.7; D20, D24, D43).
 *
 * - **Zona** = classe privacy della voce: `personale*` va nella zona
 *   personale (cifrata, solo modalità server ≤ 4 MB), `escluso_sanitario` non
 *   ammette file, il resto e i documenti del caso vanno nella zona standard.
 * - **Zona personale chiusa** finché il blocco `a8` non è sciolto, oppure senza
 *   `UC_PERSONAL_ZONE_KEY` o senza lo store personale.
 * - **Richiesta di caricamento**: dichiarazione «nessun dato sanitario» spuntata,
 *   estensione ammessa, dimensione entro il limite della modalità.
 * - **Esito**: `inspectFile` (tipo dal contenuto, intestazioni, termini
 *   sanitari) più la scansione del testo estratto (§3.10). Nel testo dei
 *   documenti: preferenze discriminatorie e codici fiscali o date di nascita
 *   fanno rifiutare il file (fuori dalla zona personale aperta); nomi e
 *   contatti restano un avviso, perché una prova scritta (l'email del cliente
 *   che indica una persona) li contiene per forza.
 * - **Lettura**: chi può scaricare o aprire per la revisione (§6.7).
 *
 * `scan_findings` ed eventi portano solo categorie, conteggi e codici: mai il
 * contenuto, mai i termini trovati vicino a un nome.
 *
 * Modulo puro.
 */
import { fail, ok, type Result } from "../types.ts";
import type { ScanCategory, ScanResult } from "../text/scan.ts";
import {
  HEALTH_PRIVACY_CLASS,
  LS_CASE_ROLES,
  PERSONAL_PRIVACY_CLASSES,
  type BlockerStatus,
  type CaseRole,
  type FilePersonalData,
  type ItemStatus,
  type PrivacyClass,
  type StorageZone,
  type ValueVisibility,
} from "../vocab.ts";
import { safeFileName } from "./filename.ts";
import type { InspectReport, ScanFindings } from "./inspect.ts";
import type { MaskedPreview } from "./mask.ts";
import { kindFromFileName, SNIFF_MESSAGES, UC_FILE_TYPES, UC_UPLOAD_LIMITS, type UcFileKind } from "./sniff.ts";

// ── Modalità e zone ───────────────────────────────────────────────────

/**
 * `server`: il file passa dalla funzione (multipart, ≤ 4 MB), obbligatoria
 * per la zona personale e usata dal harness. `client`: caricamento diretto su
 * Vercel Blob privato (≤ 20 MB), solo zona standard e solo con Blob configurato.
 */
export const UPLOAD_MODES = ["server", "client"] as const;
export type UploadMode = (typeof UPLOAD_MODES)[number];

/** Zona di archivio della classe privacy; null per i dati sanitari (mai file). */
export function zoneForClass(privacyClass: PrivacyClass | null | undefined): StorageZone | null {
  if (!privacyClass) return "standard";
  if (privacyClass === HEALTH_PRIVACY_CLASS) return null;
  return (PERSONAL_PRIVACY_CLASSES as readonly string[]).includes(privacyClass) ? "personale" : "standard";
}

export interface ZoneState {
  /** Stato del blocco `a8` del caso (null se il caso non ne ha uno). */
  a8Status: BlockerStatus | null;
  /** `UC_PERSONAL_ZONE_KEY` valida. */
  zoneKeyConfigured: boolean;
  /** Archivio della zona standard (Vercel Blob o cartella locale). */
  standardStoreConfigured: boolean;
  /** Archivio separato della zona personale. */
  personalStoreConfigured: boolean;
}

/** La zona personale è aperta: `a8` sciolto, chiave e archivio separato configurati. */
export function personalZoneOpen(s: ZoneState): boolean {
  return s.a8Status === "sciolto" && s.zoneKeyConfigured && s.personalStoreConfigured;
}

export const UPLOAD_MESSAGES = {
  archivio_non_configurato: "Archivio file non configurato: per ora il caricamento non è disponibile.",
  zona_personale_chiusa: "La zona personale si apre dopo la scheda privacy: per ora qui non si caricano file.",
  zona_personale_non_configurata: "La zona personale non è configurata: manca la chiave di cifratura o l'archivio separato.",
  valore_sanitario: "Qui non raccogliamo dati sanitari: niente file per questa domanda.",
  dichiarazione_mancante: "Conferma che il file non contiene dati sanitari né dati personali che non ti abbiamo chiesto.",
  nome_mancante: "Scegli un file da caricare.",
  file_vuoto: SNIFF_MESSAGES.file_vuoto,
  estensione_non_ammessa: SNIFF_MESSAGES.estensione_non_ammessa,
  file_troppo_grande_server: "Il file supera il limite di 4 MB. Dividilo, oppure salvalo come CSV o XLSX.",
  file_troppo_grande: "Il file supera il limite di 20 MB. Dividilo in file più piccoli.",
  modalita_server: "Questo file si carica passando dal server (al massimo 4 MB).",
  gia_caricato: "Questo file è già stato caricato per questa domanda: non serve caricarlo di nuovo.",
  testo_discriminatorio:
    "Il file contiene preferenze su genere, età, origine, religione o salute: non le registriamo. L'abbiamo cancellato: toglile e caricalo di nuovo.",
  file_non_trovato: "File non trovato.",
} as const;
export type UploadMessageCode = keyof typeof UPLOAD_MESSAGES;

function failWith<T>(code: UploadMessageCode): Result<T> {
  return fail(code, UPLOAD_MESSAGES[code]);
}

/** La zona si può usare adesso? Codici: `archivio_non_configurato`, `zona_personale_chiusa`, `zona_personale_non_configurata`. */
export function checkZone(zone: StorageZone, s: ZoneState): Result<void> {
  if (zone === "standard") return s.standardStoreConfigured ? ok(undefined) : failWith("archivio_non_configurato");
  if (s.a8Status !== "sciolto") return failWith("zona_personale_chiusa");
  if (!s.zoneKeyConfigured || !s.personalStoreConfigured) return failWith("zona_personale_non_configurata");
  return ok(undefined);
}

/** Limite di dimensione della modalità (la zona personale passa sempre dal server). */
export function maxBytesFor(mode: UploadMode, zone: StorageZone): number {
  return mode === "client" && zone === "standard" ? UC_UPLOAD_LIMITS.clientBlobMaxBytes : UC_UPLOAD_LIMITS.serverMaxBytes;
}

export interface UploadRequest {
  fileName: string;
  /** Tipo atteso dall'estensione (il contenuto si controlla dopo). */
  kind: UcFileKind;
  /** MIME del tipo atteso (per il token di Blob; il valore salvato viene dal contenuto). */
  mime: string;
  maxBytes: number;
}

/**
 * Richiesta di caricamento: nome con un'estensione ammessa, dimensione
 * dichiarata entro il limite della modalità, dichiarazione spuntata. La zona
 * personale ammette solo la modalità server.
 */
export function checkUploadRequest(i: { fileName: unknown; size: unknown; declaration: unknown; mode: UploadMode; zone: StorageZone }): Result<UploadRequest> {
  if (i.declaration !== true) return failWith("dichiarazione_mancante");
  if (typeof i.fileName !== "string" || !i.fileName.trim() || i.fileName.length > 1000) return failWith("nome_mancante");
  if (i.mode === "client" && i.zone === "personale") return failWith("modalita_server");
  const fileName = safeFileName(i.fileName);
  const kind = kindFromFileName(fileName);
  if (!kind) return failWith("estensione_non_ammessa");
  const maxBytes = maxBytesFor(i.mode, i.zone);
  if (typeof i.size !== "number" || !Number.isInteger(i.size) || i.size < 0) return failWith("file_vuoto");
  if (i.size === 0) return failWith("file_vuoto");
  if (i.size > maxBytes) return failWith(maxBytes === UC_UPLOAD_LIMITS.serverMaxBytes ? "file_troppo_grande_server" : "file_troppo_grande");
  return ok({ fileName, kind, mime: UC_FILE_TYPES[kind].mime, maxBytes });
}

// ── Esito del controllo ───────────────────────────────────────────────

export type UploadOutcome = "pulito" | "rifiutato" | "revisione_manuale";

export interface UploadDecision {
  status: UploadOutcome;
  /** Motivo del rifiuto (`uc_files.deletion_reason`, `motivo` dell'evento), oppure null. */
  reason: string | null;
  /** Messaggio per chi ha caricato, in italiano semplice. */
  message: string | null;
  findings: ScanFindings;
  personalData: FilePersonalData;
  /** Anteprima già mascherata (solo zona standard). */
  preview: MaskedPreview | null;
  contentScanned: boolean;
}

/** `deletion_reason` dei file rifiutati, dal motivo di `inspectFile` o della scansione del testo. */
export const DELETION_REASONS: Readonly<Record<string, string>> = {
  sanitario: "contenuto_sanitario",
  dati_personali: "dati_personali",
  dati_particolari: "dati_particolari",
  colonne_vietate: "colonne_vietate",
  file_non_ammesso: "file_non_ammesso",
  file_non_leggibile: "file_non_leggibile",
  testo_scarso: "testo_scarso",
  testo_discriminatorio: "testo_discriminatorio",
};

/** Massimo di testo estratto passato alla scansione (oltre, i documenti si leggono solo per i termini sanitari). */
export const TEXT_SCAN_MAX_CHARS = 300_000;

/** Testo da scansionare (troncato): mai salvato. */
export function textForScan(text: string | null): string {
  return text ? text.slice(0, TEXT_SCAN_MAX_CHARS) : "";
}

function countBy(findings: readonly { category: ScanCategory }[], categories: readonly ScanCategory[]): number {
  return findings.filter((f) => categories.includes(f.category)).length;
}

/**
 * Decide l'esito dal rapporto di `inspectFile` e dalla scansione del testo
 * estratto (`scanText(…, { context: "commento" })`, null se non c'è testo).
 */
export function decideUpload(report: InspectReport, textScan: ScanResult | null, opts: { zone: StorageZone; a8Resolved: boolean }): UploadDecision {
  const personalAllowed = opts.zone === "personale" && opts.a8Resolved;
  const base = { preview: null, contentScanned: report.contentScanned };
  if (report.status === "rifiutato") {
    return {
      ...base,
      status: "rifiutato",
      reason: DELETION_REASONS[report.reason ?? ""] ?? report.reason ?? "rifiutato",
      message: report.message,
      findings: report.findings,
      personalData: report.personalDetected ? "identificativi" : "sconosciuto",
    };
  }
  const blocking = textScan?.blocking ?? [];
  const warnings = textScan?.warnings ?? [];
  const all = [...blocking, ...warnings];
  const health = countBy(blocking, ["sanitario"]);
  if (health > 0) {
    return { ...base, status: "rifiutato", reason: DELETION_REASONS.sanitario, message: "Il file contiene dati sanitari e non possiamo tenerlo: l'abbiamo cancellato. Toglili e caricalo di nuovo.", findings: { categoria: "sanitario", nel_testo: health }, personalData: "sconosciuto" };
  }
  const discriminatory = countBy(blocking, ["discriminatorio"]);
  if (discriminatory > 0) {
    return { ...base, status: "rifiutato", reason: DELETION_REASONS.testo_discriminatorio, message: UPLOAD_MESSAGES.testo_discriminatorio, findings: { codice: "testo_discriminatorio", nel_testo: discriminatory }, personalData: "sconosciuto" };
  }
  const identifiers = countBy(blocking, ["codice_fiscale", "data_nascita"]);
  if (identifiers > 0 && !personalAllowed) {
    return {
      ...base,
      status: "rifiutato",
      reason: DELETION_REASONS.dati_personali,
      message: "Il file contiene dati personali (nomi, email, telefoni, documenti) che qui non possiamo tenere: l'abbiamo cancellato. Usa codici al posto dei nomi e caricalo di nuovo.",
      findings: { categoria: "personale", nel_testo: identifiers },
      personalData: "identificativi",
    };
  }
  const avvisi = [...(report.findings.avvisi ?? [])];
  const names = countBy(all, ["nome_persona"]);
  const contacts = countBy(all, ["contatto"]);
  if (names > 0) avvisi.push("testo_nomi_persona");
  if (contacts > 0) avvisi.push("testo_contatti");
  if (identifiers > 0) avvisi.push("testo_identificativi");
  const findings: ScanFindings = { ...report.findings, ...(avvisi.length > 0 ? { avvisi: [...new Set(avvisi)] } : {}) };
  const personalData: FilePersonalData =
    opts.zone === "personale" ? (report.personalDetected || identifiers > 0 || names > 0 ? "identificativi" : "sconosciuto") : names > 0 || contacts > 0 ? "sconosciuto" : "no";
  if (report.status === "revisione_manuale") {
    return { ...base, status: "revisione_manuale", reason: null, message: report.message, findings: { ...findings, revisione_manuale: true }, personalData, contentScanned: false };
  }
  return { ...base, status: "pulito", reason: null, message: null, findings, personalData, preview: opts.zone === "standard" ? report.preview : null };
}

// ── Chi carica, chi rivede, chi legge ─────────────────────────────────

const LS_ROLES: readonly CaseRole[] = LS_CASE_ROLES;
const isLsRole = (r: CaseRole) => LS_ROLES.includes(r);

/** Carica nella voce o nel caso: Lateral Space (lead, analista); l'Owner del cliente solo documenti del caso (prove scritte). */
export function canUploadTo(roles: readonly CaseRole[], target: { itemId: string | null }): boolean {
  if (roles.includes("ls_lead") || roles.includes("ls_analista")) return true;
  return target.itemId === null && roles.includes("owner_cliente");
}

/** Rivede un PDF in quarantena: Lateral Space (lead, analista), mai chi l'ha caricato. */
export function canReviewFile(i: { roles: readonly CaseRole[]; isLateralSpace: boolean; userId: string; uploadedByUserId: string | null }): Result<void> {
  if (!i.isLateralSpace || !(i.roles.includes("ls_lead") || i.roles.includes("ls_analista"))) return fail("attore_non_ammesso", "La revisione la fa una persona di Lateral Space.");
  if (i.uploadedByUserId !== null && i.uploadedByUserId === i.userId) return fail("revisore_uguale", "Il file lo rivede un'altra persona di Lateral Space, non chi l'ha caricato.");
  return ok(undefined);
}

export interface FileAccessFacts {
  zone: StorageZone;
  scanStatus: "in_quarantena" | "pulito" | "rifiutato";
  contentScanned: boolean;
  reviewed: boolean;
  manualReview: boolean;
  deleted: boolean;
  uploadedByUserId: string | null;
  /** Voce del file, oppure null per i documenti del caso. */
  item: { status: ItemStatus; privacyClass: PrivacyClass; valueVisibility: ValueVisibility } | null;
}

/** Il file si può usare (scaricare, allegare a una risposta, trasformare in dataset). */
export function fileUsable(f: Pick<FileAccessFacts, "scanStatus" | "contentScanned" | "reviewed" | "deleted">): boolean {
  return !f.deleted && f.scanStatus === "pulito" && (f.contentScanned || f.reviewed);
}

const VALIDATED: readonly ItemStatus[] = ["validata", "non_applicabile"];
const SEE_CASE: readonly CaseRole[] = ["ls_lead", "ls_analista", "owner_cliente"];

/**
 * Chi apre il file (PIANO §6.7). 404 identico per «assente», «non tuo» e «non
 * utilizzabile»; unica eccezione il PDF in revisione manuale, che si apre per
 * una persona di Lateral Space diversa da chi l'ha caricato (`motivo: revisione`).
 * La zona personale solo a chi ha `personal_zone_access`, con la zona aperta.
 */
export function canReadFile(i: {
  roles: readonly CaseRole[];
  userId: string;
  isLateralSpace: boolean;
  personalZoneAccess: boolean;
  zoneOpen: boolean;
  file: FileAccessFacts;
}): Result<{ motivo: "download" | "revisione" }> {
  const notFound = fail<{ motivo: "download" | "revisione" }>("file_non_trovato", UPLOAD_MESSAGES.file_non_trovato);
  const f = i.file;
  if (f.deleted || f.scanStatus === "rifiutato") return notFound;
  if (f.zone === "personale") {
    if (!fileUsable(f) || !i.isLateralSpace || !i.roles.some(isLsRole) || !i.personalZoneAccess || !i.zoneOpen) return notFound;
    return ok({ motivo: "download" });
  }
  if (!fileUsable(f)) {
    if (!f.manualReview || f.scanStatus !== "in_quarantena") return notFound;
    return canReviewFile({ roles: i.roles, isLateralSpace: i.isLateralSpace, userId: i.userId, uploadedByUserId: f.uploadedByUserId }).ok ? ok({ motivo: "revisione" }) : notFound;
  }
  const seesCase = i.roles.some((r) => SEE_CASE.includes(r));
  if (!f.item) return seesCase ? ok({ motivo: "download" }) : notFound;
  if (f.item.privacyClass === HEALTH_PRIVACY_CLASS) return notFound;
  if (!seesCase) {
    // Lo sviluppatore vede solo il catalogo validato: file delle voci verdi o blu.
    return i.roles.includes("ls_sviluppatore") && VALIDATED.includes(f.item.status) ? ok({ motivo: "download" }) : notFound;
  }
  if (f.item.valueVisibility === "solo_ls" && !i.roles.some(isLsRole)) return notFound;
  return ok({ motivo: "download" });
}

// ── Nome scaricato ────────────────────────────────────────────────────

/** `Content-Disposition` con il nome ripulito (ASCII più `filename*` UTF-8). */
export function attachmentHeader(fileName: string): string {
  const name = safeFileName(fileName);
  const ascii =
    name
      .normalize("NFKD")
      .replace(/[^\x20-\x7e]/g, "")
      .replace(/["\\/;]/g, "_")
      .trim() || "file";
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

/** MIME servito al download: solo i tipi ammessi (riconosciuti dal contenuto), altrimenti binario generico. */
export function servedMime(mime: string | null): string {
  const known = Object.values(UC_FILE_TYPES).map((t) => t.mime as string);
  return mime && known.includes(mime) ? mime : "application/octet-stream";
}
