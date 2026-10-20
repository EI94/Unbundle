/**
 * Le 23 righe obbligatorie di `docs/use-case/DESIGN.md` §3.5, con il solo codice per il
 * cliente. Le usa `status.test.ts`; la fase della pagina «Use case» (`phase.test.ts`,
 * H1c) le riprende riga per riga, così connettore e pagina non possono divergere.
 *
 * `context` descrive il resto della scheda (tipo, trimestre, stato del dossier) e il
 * giorno di riferimento per chi calcola la fase: `connectorStatus` non lo legge. Le
 * righe 7, 8, 9 e 11 dipendono dalla data (data di revisione futura o passata,
 * trimestre futuro o passato): la fase usa `context.today`, mai l'orologio, così la
 * tabella vale anche dopo quelle date. Dati sintetici (codici XX-…).
 */
import type { ConnectorStatusCode, UseCaseStatusInput } from "./status.ts";

export interface StatusTableRow {
  /** Numero della riga in DESIGN §3.5. */
  n: number;
  /** Input in breve, come nella tabella. */
  label: string;
  input: UseCaseStatusInput;
  /** Resto della scheda, per la fase (H1c). Non entra nello stato del connettore. */
  context: {
    portfolioKind: "use_case_ai" | "best_practice" | null;
    /** `AAAA-Qn` oppure null. */
    targetQuarter: string | null;
    /** Stato del dossier collegato (`uc_cases.status`) oppure null. */
    dossierStatus: string | null;
    /** Giorno di riferimento `AAAA-MM-GG` (Europe/Rome), uguale per tutte le righe: `STATUS_TABLE_TODAY`. */
    today: string;
  };
  statusCode: ConnectorStatusCode;
}

const PERSON = "00000000-0000-4000-8000-0000000000b1";
const NOTE = "Manca il volume mensile delle richieste: puoi indicarlo?";
/** Il giorno su cui è scritta la tabella (Europe/Rome). */
export const STATUS_TABLE_TODAY = "2026-10-14";
/** Data di revisione dopo `STATUS_TABLE_TODAY` (riga 7) e prima (riga 8). */
export const STATUS_TABLE_FUTURE = "2027-01-14";
export const STATUS_TABLE_PAST = "2026-09-01";

const base: UseCaseStatusInput = {
  status: "proposed",
  portfolioReviewStatus: "needs_inputs",
  reviewedBy: null,
  publicNote: null,
  intake: null,
  reviewBy: null,
  linkedCaseCode: null,
};

const plain = {
  portfolioKind: "use_case_ai",
  targetQuarter: null,
  dossierStatus: null,
  today: STATUS_TABLE_TODAY,
} as const;

function row(
  n: number,
  label: string,
  input: Partial<UseCaseStatusInput>,
  statusCode: ConnectorStatusCode,
  context: Partial<StatusTableRow["context"]> = {}
): StatusTableRow {
  return { n, label, input: { ...base, ...input }, context: { ...plain, ...context }, statusCode };
}

export const STATUS_TABLE_ROWS: readonly StatusTableRow[] = Object.freeze([
  row(1, "proposed, needs_inputs, nessuna persona", {}, "RICEVUTA"),
  row(2, "draft (Activity mapping), needs_inputs", { status: "draft" }, "RICEVUTA", { portfolioKind: null }),
  row(3, "proposed, in_review", { portfolioReviewStatus: "in_review" }, "IN_VALUTAZIONE"),
  row(
    4,
    "in_review con possibleDuplicateOf",
    { portfolioReviewStatus: "in_review", intake: { possibleDuplicateOf: "XX-0007" } },
    "POSSIBILE_DOPPIONE"
  ),
  row(5, "needs_inputs, persona e nota pubblica", { reviewedBy: PERSON, publicNote: NOTE }, "SERVONO_INFORMAZIONI"),
  row(6, "scored, nessuna data", { portfolioReviewStatus: "scored" }, "VALUTATA"),
  row(7, "in_review, review_by futura", { portfolioReviewStatus: "in_review", reviewBy: STATUS_TABLE_FUTURE }, "VALUTATA"),
  row(8, "scored, review_by passata", { portfolioReviewStatus: "scored", reviewBy: STATUS_TABLE_PAST }, "VALUTATA"),
  row(9, "accepted, target_quarter = 2027-Q1", { status: "accepted", portfolioReviewStatus: "scored" }, "APPROVATA", {
    targetQuarter: "2027-Q1",
  }),
  row(10, "accepted, nessun trimestre", { status: "accepted", portfolioReviewStatus: "scored" }, "APPROVATA"),
  row(
    11,
    "accepted, trimestre passato, nessun dossier",
    { status: "accepted", portfolioReviewStatus: "scored" },
    "APPROVATA",
    { targetQuarter: "2026-Q3" }
  ),
  row(
    12,
    "accepted con dossier raccolta",
    { status: "accepted", portfolioReviewStatus: "scored", linkedCaseCode: "XX-CASO-01" },
    "AVVIATA_COME_CASO",
    { targetQuarter: "2026-Q4", dossierStatus: "raccolta" }
  ),
  row(
    13,
    "caso orfano dopo la scheda madre: accepted, dossier in_sviluppo",
    { status: "accepted", portfolioReviewStatus: "in_review", linkedCaseCode: "XX-CASO-02" },
    "AVVIATA_COME_CASO",
    { dossierStatus: "in_sviluppo" }
  ),
  row(14, "in_progress, nessun dossier", { status: "in_progress", portfolioReviewStatus: "scored" }, "IN_SVILUPPO"),
  row(15, "implemented, use_case_ai", { status: "implemented", portfolioReviewStatus: "scored" }, "REALIZZATA"),
  row(16, "implemented, best_practice", { status: "implemented", portfolioReviewStatus: "scored" }, "REALIZZATA", {
    portfolioKind: "best_practice",
  }),
  row(17, "rejected", { status: "rejected", portfolioReviewStatus: "scored", publicNote: NOTE }, "NON_AVVIATA"),
  row(18, "Riapri da 17: proposed, in_review", { portfolioReviewStatus: "in_review", publicNote: NOTE }, "IN_VALUTAZIONE"),
  row(
    19,
    "archived, duplicato, duplicateOfCode",
    { portfolioReviewStatus: "archived", intake: { archiveReason: "duplicato", duplicateOfCode: "XX-0007" } },
    "DOPPIONE"
  ),
  row(20, "archived, motivo superato", { portfolioReviewStatus: "archived", intake: { archiveReason: "superato" } }, "ARCHIVIATA"),
  row(
    21,
    "implemented e archived",
    { status: "implemented", portfolioReviewStatus: "archived", intake: { archiveReason: "superato" } },
    "ARCHIVIATA"
  ),
  row(
    22,
    "accepted, archived",
    { status: "accepted", portfolioReviewStatus: "archived", intake: { archiveReason: "ritirato" } },
    "ARCHIVIATA"
  ),
  row(
    23,
    "Serve info, poi Non avviare, poi Riapri: proposed, in_review, persona e nota pubblica ancora presenti",
    { portfolioReviewStatus: "in_review", reviewedBy: PERSON, publicNote: NOTE },
    "IN_VALUTAZIONE"
  ),
]);
