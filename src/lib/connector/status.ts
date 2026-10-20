/**
 * Stato di una segnalazione per chi la segue tramite Claude (connettore MCP, WP3).
 *
 * Funzione pura condivisa: la usano gli strumenti del connettore (`get_contribution_status`,
 * `find_similar_contributions`) e la fase della pagina «Use case» (`phaseOfUseCase` in
 * `src/lib/use-cases/phase.ts`), che non ha regole sue sulla fase. Specifica:
 * `docs/use-case/DESIGN.md` §3.5, decisione D10 del 14/10/2026.
 *
 * Precedenza: vince la prima condizione che si applica, nell'ordine di
 * `CONNECTOR_STATUS_PRECEDENCE`. Due scelte di D10:
 *  - una scheda rimandata (`review_by` presente) il cliente la legge «Valutata»;
 *  - «Approvata» vale qualunque sia il trimestre (`target_quarter` non conta).
 * Dopo «Riapri» (`rejected → proposed`, `portfolio_review_status` a `in_review` o
 * `scored`) la scheda torna IN_VALUTAZIONE o VALUTATA, mai SERVONO_INFORMAZIONI con la
 * nota vecchia: quella richiede `needs_inputs`.
 *
 * Nessun import: il modulo gira con `node --test` e non tocca il database.
 */

export type ConnectorStatusCode =
  | "RICEVUTA"
  | "IN_VALUTAZIONE"
  | "POSSIBILE_DOPPIONE"
  | "SERVONO_INFORMAZIONI"
  | "VALUTATA"
  | "APPROVATA"
  | "AVVIATA_COME_CASO"
  | "IN_SVILUPPO"
  | "REALIZZATA"
  | "NON_AVVIATA"
  | "DOPPIONE"
  | "ARCHIVIATA";

export type UseCaseLifecycleStatus = "draft" | "proposed" | "accepted" | "in_progress" | "implemented" | "rejected";
export type UseCaseReviewStatus = "needs_inputs" | "in_review" | "scored" | "archived";

export interface UseCaseStatusInput {
  status: UseCaseLifecycleStatus;
  portfolioReviewStatus: UseCaseReviewStatus;
  /** `use_cases.reviewed_by`: una persona ha messo mano alla revisione. */
  reviewedBy: string | null;
  publicNote: string | null;
  /** `use_cases.intake` (jsonb): si leggono solo questi tre campi tecnici. */
  intake: { possibleDuplicateOf?: string; archiveReason?: string; duplicateOfCode?: string } | null;
  /** `use_cases.review_by` (migrazione 0020); assente prima della 0020. */
  reviewBy?: string | null;
  /** Codice del dossier collegato (`uc_cases.code`), solo con UC_ENABLED e to_regclass. */
  linkedCaseCode?: string | null;
}

export interface ConnectorStatus {
  statusCode: ConnectorStatusCode;
  statusLabel: string;
}

/** La prima condizione che si applica vince (D10). */
export const CONNECTOR_STATUS_PRECEDENCE: readonly ConnectorStatusCode[] = Object.freeze([
  "DOPPIONE",
  "ARCHIVIATA",
  "REALIZZATA",
  "NON_AVVIATA",
  "AVVIATA_COME_CASO",
  "IN_SVILUPPO",
  "APPROVATA",
  "VALUTATA",
  "SERVONO_INFORMAZIONI",
  "POSSIBILE_DOPPIONE",
  "IN_VALUTAZIONE",
  "RICEVUTA",
] as const);

/** Motivo d'archivio che fa di una scheda archiviata un doppione. */
export const DUPLICATE_ARCHIVE_REASON = "duplicato";

/** Codice di una segnalazione (`use_cases.code`), come nel contratto. */
const SUBMISSION_CODE = /^[A-Z]{2,4}-[0-9]{4,5}$/;

/** Etichette in italiano del contratto. Per i due doppioni il codice dell'altra si aggiunge da `connectorStatusLabel`. */
export const CONNECTOR_STATUS_LABEL: Readonly<Record<ConnectorStatusCode, string>> = Object.freeze({
  RICEVUTA: "Ricevuta",
  IN_VALUTAZIONE: "In valutazione",
  POSSIBILE_DOPPIONE: "In valutazione (possibile doppione)",
  SERVONO_INFORMAZIONI: "Servono informazioni da te",
  VALUTATA: "Valutata, in attesa di decisione",
  APPROVATA: "Approvata",
  AVVIATA_COME_CASO: "Avviata come caso d'uso",
  IN_SVILUPPO: "In sviluppo",
  REALIZZATA: "Realizzata",
  NON_AVVIATA: "Non avviata per ora",
  DOPPIONE: "Unita a un'altra segnalazione",
  ARCHIVIATA: "Archiviata",
});

function present(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/** Solo un codice nel formato del contratto finisce nell'etichetta: mai testo libero di `intake`. */
function submissionCode(value: unknown): string | null {
  return typeof value === "string" && SUBMISSION_CODE.test(value.trim()) ? value.trim() : null;
}

/**
 * Etichetta per il cliente. «In valutazione (possibile doppione di XX-0007)» e
 * «Unita a XX-0007» portano il codice dell'altra segnalazione quando c'è ed è un codice
 * valido; altrimenti restano generiche.
 */
export function connectorStatusLabel(
  code: ConnectorStatusCode,
  refs: { possibleDuplicateOf?: unknown; duplicateOfCode?: unknown } = {}
): string {
  if (code === "POSSIBILE_DOPPIONE") {
    const other = submissionCode(refs.possibleDuplicateOf);
    return other ? `In valutazione (possibile doppione di ${other})` : CONNECTOR_STATUS_LABEL.POSSIBILE_DOPPIONE;
  }
  if (code === "DOPPIONE") {
    const other = submissionCode(refs.duplicateOfCode);
    return other ? `Unita a ${other}` : CONNECTOR_STATUS_LABEL.DOPPIONE;
  }
  return CONNECTOR_STATUS_LABEL[code];
}

function statusCodeOf(i: UseCaseStatusInput): ConnectorStatusCode {
  const intake = i.intake ?? {};
  const review = i.portfolioReviewStatus;
  // Righe di `docs/use-case/DESIGN.md` §3.5, nell'ordine di CONNECTOR_STATUS_PRECEDENCE.
  if (review === "archived" && intake.archiveReason === DUPLICATE_ARCHIVE_REASON) return "DOPPIONE";
  if (review === "archived") return "ARCHIVIATA";
  if (i.status === "implemented") return "REALIZZATA";
  if (i.status === "rejected") return "NON_AVVIATA";
  if (present(i.linkedCaseCode)) return "AVVIATA_COME_CASO";
  if (i.status === "in_progress") return "IN_SVILUPPO";
  if (i.status === "accepted") return "APPROVATA";
  if ((i.status === "draft" || i.status === "proposed") && (review === "scored" || present(i.reviewBy))) {
    return "VALUTATA";
  }
  if (review === "needs_inputs" && present(i.reviewedBy) && present(i.publicNote)) return "SERVONO_INFORMAZIONI";
  const awaitingReview = review === "in_review" || (review === "needs_inputs" && !present(i.reviewedBy));
  if (awaitingReview && present(intake.possibleDuplicateOf)) return "POSSIBILE_DOPPIONE";
  if (review === "in_review") return "IN_VALUTAZIONE";
  return "RICEVUTA";
}

/** Uno dei 12 stati del contratto, con l'etichetta in italiano. */
export function connectorStatus(i: UseCaseStatusInput): ConnectorStatus {
  const statusCode = statusCodeOf(i);
  return {
    statusCode,
    statusLabel: connectorStatusLabel(statusCode, {
      possibleDuplicateOf: i.intake?.possibleDuplicateOf,
      duplicateOfCode: i.intake?.duplicateOfCode,
    }),
  };
}
