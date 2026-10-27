/**
 * I file di «Chiedi al referente» (SPEC §2.1 `files.ts`, §2.3): le stesse regole dei dossier, nella
 * sola zona standard (niente zona personale, niente immagini).
 *
 * - Percorsi: `uc/q/<ws>/<useCaseId>/<fileId>` in quarantena (al massimo 1 ora), poi
 *   `uc/s/<ws>/<useCaseId>/<fileId>`. Un percorso di un altro workspace o di un'altra scheda non
 *   passa mai (`isReferentBlobPath`).
 * - Esito (`referentFileDecision`, da `decideUpload` dei dossier): un PDF con poco testo (forse una
 *   scansione) **non si rifiuta**: diventa `in_revisione` e lo controlla una persona di Lateral Space
 *   entro 7 giorni. Nomi, email o telefoni nel file danno un avviso visibile («Può contenere dati
 *   personali»): il referente deve confermarlo. Dati sanitari, discriminatori, codici fiscali o date
 *   di nascita: rifiutato, l'oggetto si cancella.
 * - Richiesta di caricamento (`referentUploadCheck`): `checkUploadRequest` dei dossier con la zona
 *   standard (dichiarazione, estensione, dimensione).
 *
 * Modulo puro.
 */
import { isUcBlobPath, ucBlobPath } from "../../uc/files/filename.ts";
import type { InspectReport, ScanFindings } from "../../uc/files/inspect.ts";
import { checkUploadRequest, decideUpload, type UploadRequest } from "../../uc/files/upload.ts";
import type { ScanResult } from "../../uc/text/scan.ts";
import type { Result } from "../../uc/types.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_PUBLIC_TEXT } from "./labels.ts";

/** Quanto resta un file in quarantena prima di essere abbandonato (= `QUARANTINE_TTL_MS` dei dossier). */
export const PENDING_QUARANTINE_MS = 60 * 60 * 1000;
/** Quanto aspetta un PDF in revisione (= `REVIEW_TTL_MS` dei dossier). */
export const REVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** I codici degli avvisi che fanno mostrare «Può contenere dati personali». */
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
    return { status: "rifiutato", reason: decision.reason ?? "rifiutato", message: decision.message, findings: decision.findings, personalWarning: false };
  }
  const avvisi = decision.findings.avvisi ?? [];
  const personalWarning = avvisi.some((code) => (PERSONAL_WARNING_CODES as readonly string[]).includes(code));
  if (decision.status === "revisione_manuale") {
    return { status: "in_revisione", reason: null, message: REFERENT_ERROR_MESSAGES.pdf_in_revisione, findings: decision.findings, personalWarning };
  }
  return { status: "pulito", reason: null, message: personalWarning ? REFERENT_PUBLIC_TEXT.fileWarning : null, findings: decision.findings, personalWarning };
}

/** La richiesta di caricamento: dichiarazione, nome con estensione ammessa, dimensione entro il limite. */
export function referentUploadCheck(i: { fileName: unknown; size: unknown; declaration: unknown; mode: "server" | "client" }): Result<UploadRequest> {
  return checkUploadRequest({ ...i, zone: "standard" });
}

/** Il messaggio di un motivo di rifiuto salvato, per chi guarda un file non accettato. */
export function rejectionMessage(reason: string | null): string | null {
  if (!reason) return null;
  if (reason === "revisione_rifiutata") return REFERENT_ERROR_MESSAGES.revisione_rifiutata;
  if (reason === "revisione_scaduta") return REFERENT_ERROR_MESSAGES.revisione_scaduta;
  if (reason === "quarantena_scaduta") return REFERENT_ERROR_MESSAGES.quarantena_scaduta;
  return null;
}
