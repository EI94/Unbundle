/**
 * Sotto ogni esigenza del capitolo «Cosa serve»: la riga della richiesta, il segnale «Senza
 * risposta» e le risposte e i file arrivati (SPEC §5.2, §P2.10.7). Modulo puro: decide che cosa si
 * mostra, `need-referent-block.tsx` lo disegna e `need-referent-view.test.ts` lo prova.
 *
 * I numeri contano le voci di questa esigenza, mai le persone (art. 15.4).
 */
import type { NeedAnswerView, NeedFileView, NeedReferentView } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_UI_TEXT, fillText } from "../../../../lib/use-cases/referent/labels.ts";

const T = REFERENT_UI_TEXT;

export interface NeedAnswerRow {
  id: string;
  /** «Mario Rossi · 27/10», «Giulia Neri (team) · 28/10». */
  header: string;
  /** Il testo così com'è, oppure «Non lo sa». */
  body: string;
  dontKnow: boolean;
  canRemove: boolean;
}

export interface NeedFileRow {
  id: string;
  name: string;
  header: string;
  sizeLabel: string | null;
  inReview: boolean;
  /** «Da controllare: PDF con poco testo». */
  reviewLabel: string | null;
  personalWarning: string | null;
  href: string | null;
  /** «Scarica», oppure «Scarica per controllarlo» per un PDF da controllare. */
  downloadLabel: string;
  canDelete: boolean;
  canReview: boolean;
}

export interface NeedReferentRows {
  line: string | null;
  /** «File non controllato in tempo: chiedi di caricarlo di nuovo.», oppure null. */
  notice: string | null;
  /** Il segnale «Senza risposta», solo se la riga non lo dice già: un solo segnale per esigenza. */
  silentTag: string | null;
  /** «Risposte e file · {n}», oppure null senza voci. */
  summary: string | null;
  answers: NeedAnswerRow[];
  files: NeedFileRow[];
}

export const EMPTY_NEED_REFERENT_ROWS: NeedReferentRows = Object.freeze({ line: null, notice: null, silentTag: null, summary: null, answers: [], files: [] }) as NeedReferentRows;

function answerRow(answer: NeedAnswerView, canEdit: boolean): NeedAnswerRow {
  return {
    id: answer.id,
    header: fillText(T.entryHeader, { autore: answer.authorLabel, data: answer.dateLabel }),
    body: answer.text ?? (answer.dontKnow ? T.dontKnowAnswer : ""),
    dontKnow: answer.text === null && answer.dontKnow,
    canRemove: canEdit && answer.canRemove,
  };
}

function fileRow(file: NeedFileView, opts: { canEdit: boolean; canReviewFiles: boolean }): NeedFileRow {
  const inReview = file.status === "in_revisione";
  return {
    id: file.id,
    name: file.name,
    header: fillText(T.entryHeader, { autore: file.authorLabel, data: file.dateLabel }),
    sizeLabel: file.sizeLabel,
    inReview,
    reviewLabel: inReview ? T.fileInReview : null,
    personalWarning: file.personalWarning ? T.filePersonalWarning : null,
    href: file.href,
    downloadLabel: inReview ? T.fileDownloadToReview : T.fileDownload,
    canDelete: opts.canEdit && file.canDelete,
    canReview: inReview && opts.canReviewFiles && file.canReview,
  };
}

/**
 * Le righe di un'esigenza. I file «Da controllare» solo a chi li controlla (i revisori che modificano
 * «Cosa serve», `canReviewFiles`): il server non li manda agli altri, e qui non si mostrano comunque.
 */
export function needReferentRows(view: NeedReferentView | null | undefined, opts: { canEdit: boolean; canReviewFiles: boolean }): NeedReferentRows {
  if (!view) return EMPTY_NEED_REFERENT_ROWS;
  // Una risposta senza testo e senza «Non lo so» (la domanda risposta solo con un file) non è una voce: c'è il file.
  const answers = view.answers.filter((answer) => answer.dontKnow || Boolean(answer.text?.trim())).map((answer) => answerRow(answer, opts.canEdit));
  const files = view.files.filter((file) => file.status !== "in_revisione" || opts.canReviewFiles).map((file) => fileRow(file, opts));
  const count = answers.length + files.length;
  const saysSilent = /senza risposta/i.test(view.line ?? "");
  return {
    line: view.line,
    notice: view.reviewExpired ? T.fileReviewExpired : null,
    silentTag: view.silent && !saysSilent ? T.silentTag : null,
    summary: count > 0 ? fillText(T.entriesSummary, { n: count }) : null,
    answers,
    files,
  };
}
