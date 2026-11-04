/**
 * I file di «Chiedi al referente» (SPEC §2.1 `files.ts`, §2.3): le stesse regole dei dossier, nella
 * sola zona standard (niente zona personale, niente immagini).
 *
 * - Percorsi: `uc/q/<ws>/<useCaseId>/<fileId>` in quarantena (al massimo 1 ora), poi
 *   `uc/s/<ws>/<useCaseId>/<fileId>`. Un percorso di un altro workspace o di un'altra scheda non
 *   passa mai (`isReferentBlobPath`).
 * - Esito (`checkReferentFile`: `inspectFile` con `contactsAllowed`, la scansione del testo e
 *   `referentFileDecision`, da `decideUpload` dei dossier): un PDF con poco testo (forse una
 *   scansione) **non si rifiuta**: diventa `in_revisione` e lo controlla una persona di Lateral Space
 *   entro 7 giorni. Dati sanitari, discriminatori, codici fiscali o date di nascita (e, nelle tabelle,
 *   IBAN, documenti d'identità, sesso): rifiutato, l'oggetto si cancella, con un messaggio calmo che
 *   dice il motivo vero. (Rilascio 5.1, decisione del titolare del 04/11/2026) Nomi, email o telefoni
 *   nel file, nel testo come nelle colonne di un CSV o di un XLSX, non chiedono più niente a nessuno:
 *   il file è pulito, `personalWarning` resta solo come fatto del controllo (la colonna
 *   `personal_warning`), mai a schermo e mai da confermare.
 * - Richiesta di caricamento (`referentUploadCheck`): `checkUploadRequest` dei dossier con la zona
 *   standard (estensione, dimensione). (Rilascio 5.1) Senza la dichiarazione dei dossier: l'informativa
 *   lo dice prima, la pagina non chiede più di spuntare niente. I dossier (`/r`) la chiedono come prima.
 *
 * Modulo puro.
 */
import { isUcBlobPath, ucBlobPath } from "../../uc/files/filename.ts";
import { inspectFile, type InspectReport, type ScanFindings } from "../../uc/files/inspect.ts";
import { DELETION_REASONS, checkUploadRequest, decideUpload, textForScan, type UploadRequest } from "../../uc/files/upload.ts";
import { scanText, type ScanResult } from "../../uc/text/scan.ts";
import type { Result } from "../../uc/types.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_PUBLIC_TEXT } from "./labels.ts";

/** Quanto resta un file in quarantena prima di essere abbandonato (= `QUARANTINE_TTL_MS` dei dossier). */
export const PENDING_QUARANTINE_MS = 60 * 60 * 1000;
/** Quanto aspetta un PDF in revisione (= `REVIEW_TTL_MS` dei dossier). */
export const REVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** I codici degli avvisi di nomi, email o telefoni nel file (`personal_warning`): un fatto del controllo, mai un avviso a schermo. */
export const PERSONAL_WARNING_CODES = ["testo_nomi_persona", "testo_contatti", "testo_identificativi"] as const;

export function referentBlobPath(area: "quarantena" | "standard", workspaceId: string, useCaseId: string, fileId: string): string {
  return ucBlobPath(area, workspaceId, useCaseId, fileId);
}

/** Un oggetto della zona standard di questa scheda di questo workspace. */
export function isReferentBlobPath(path: string, workspaceId: string, useCaseId: string): boolean {
  return typeof path === "string" && isUcBlobPath(path, "standard") && path.startsWith(`uc/s/${workspaceId.toLowerCase()}/${useCaseId.toLowerCase()}/`);
}

/** Un oggetto della quarantena di questa scheda di questo workspace. */
export function isReferentQuarantinePath(path: string, workspaceId: string, useCaseId: string): boolean {
  return typeof path === "string" && isUcBlobPath(path, "quarantena") && path.startsWith(`uc/q/${workspaceId.toLowerCase()}/${useCaseId.toLowerCase()}/`);
}

export interface ReferentFileOutcome {
  status: "pulito" | "in_revisione" | "rifiutato";
  /** Motivo del rifiuto (`rejection_reason`), oppure null. */
  reason: string | null;
  /** Per chi ha caricato, in italiano semplice. */
  message: string | null;
  findings: ScanFindings;
  personalWarning: boolean;
}

/** L'esito del controllo di un file, dal rapporto di `inspectFile` e dalla scansione del testo. */
export function referentFileDecision(report: InspectReport, scan: ScanResult | null): ReferentFileOutcome {
  const decision = decideUpload(report, scan, { zone: "standard", a8Resolved: false });
  if (decision.status === "rifiutato") {
    const reason = decision.reason ?? "rifiutato";
    return { status: "rifiutato", reason, message: rejectionText(reason, decision.findings) ?? decision.message, findings: decision.findings, personalWarning: false };
  }
  const avvisi = decision.findings.avvisi ?? [];
  const personalWarning = avvisi.some((code) => (PERSONAL_WARNING_CODES as readonly string[]).includes(code));
  if (decision.status === "revisione_manuale") {
    return { status: "in_revisione", reason: null, message: REFERENT_ERROR_MESSAGES.pdf_in_revisione, findings: decision.findings, personalWarning };
  }
  return { status: "pulito", reason: null, message: null, findings: decision.findings, personalWarning };
}

/**
 * (Rilascio 5.1) I messaggi calmi dei rifiuti per i dati che qui non teniamo, al posto di quelli dei
 * dossier (che parlano anche di nomi, email e telefoni, che qui passano).
 */
const REFERENT_FILE_REJECTIONS: Readonly<Record<string, string>> = Object.freeze({
  [DELETION_REASONS.sanitario]: REFERENT_PUBLIC_TEXT.fileRejected.sanitario,
  [DELETION_REASONS.dati_personali]: REFERENT_PUBLIC_TEXT.fileRejected.identificativi,
  [DELETION_REASONS.testo_discriminatorio]: REFERENT_PUBLIC_TEXT.fileRejected.discriminatorio,
});

/**
 * Il messaggio calmo di un rifiuto. Per i dati personali dice «codici fiscali o date di nascita» solo se il
 * controllo li ha trovati davvero (nel testo, o tra i termini delle colonne); una colonna di IBAN, di
 * documenti d'identità o del sesso ha il suo messaggio.
 */
function rejectionText(reason: string, findings: ScanFindings): string | null {
  if (reason === DELETION_REASONS.dati_personali && Array.isArray(findings.termini) && findings.termini.length > 0) {
    if (!findings.termini.some((t) => t === "codice fiscale" || t === "data di nascita")) return REFERENT_PUBLIC_TEXT.fileRejected.altriDati;
  }
  return REFERENT_FILE_REJECTIONS[reason] ?? null;
}

/**
 * (Rilascio 5.1) Il controllo di un file del referente o del team, tutto: `inspectFile` nella zona
 * standard con `contactsAllowed` (nomi, email e telefoni nelle tabelle passano), la scansione del testo
 * estratto con le regole dei commenti, poi `referentFileDecision`.
 */
export function checkReferentFile(bytes: Uint8Array, fileName: string, maxBytes: number): { report: InspectReport; outcome: ReferentFileOutcome } {
  const report = inspectFile(bytes, fileName, { zone: "standard", a8Resolved: false, maxBytes, contactsAllowed: true });
  const scan = report.extractedText ? scanText(textForScan(report.extractedText), { context: "commento" }) : null;
  return { report, outcome: referentFileDecision(report, scan) };
}

/**
 * La richiesta di caricamento: nome con estensione ammessa, dimensione entro il limite. (Rilascio
 * 5.1) La dichiarazione dei dossier non serve più: `declaration` si accetta e si ignora, così una
 * pagina aperta prima del rilascio carica come prima.
 */
export function referentUploadCheck(i: { fileName: unknown; size: unknown; declaration?: unknown; mode: "server" | "client" }): Result<UploadRequest> {
  return checkUploadRequest({ fileName: i.fileName, size: i.size, mode: i.mode, declaration: true, zone: "standard" });
}

/** Il messaggio di un motivo di rifiuto salvato, per chi guarda un file non accettato. */
export function rejectionMessage(reason: string | null): string | null {
  if (!reason) return null;
  if (reason === "revisione_rifiutata") return REFERENT_ERROR_MESSAGES.revisione_rifiutata;
  if (reason === "revisione_scaduta") return REFERENT_ERROR_MESSAGES.revisione_scaduta;
  if (reason === "quarantena_scaduta") return REFERENT_ERROR_MESSAGES.quarantena_scaduta;
  return null;
}
