/**
 * Sotto ogni esigenza del capitolo «Cosa serve»: la riga della richiesta, il segnale «Senza
 * risposta» e le risposte e i file arrivati (SPEC §5.2, §P2.10.7). Modulo puro: decide che cosa si
 * mostra, `need-referent-block.tsx` lo disegna e `need-referent-view.test.ts` lo prova.
 *
 * I numeri contano le voci di questa esigenza, mai le persone (art. 15.4).
 */
import type { ClarifyTarget, NeedAnswerView, NeedFileView, NeedReferentView, NeedTemplateView } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_THREAD_TEXT, REFERENT_UI_TEXT, fillText } from "../../../../lib/use-cases/referent/labels.ts";

const T = REFERENT_UI_TEXT;

export interface NeedAnswerRow {
  id: string;
  /** «Mario Rossi · 27/10», «Giulia Neri (team) · 28/10». */
  header: string;
  /** Il testo così com'è, oppure «Non lo sa». */
  body: string;
  dontKnow: boolean;
  /** (Rilascio 5) «Chi potrebbe saperlo: «…»» con «Non ce l'ho», altrimenti «Commento: «…»»; null senza. */
  comment: string | null;
  canRemove: boolean;
  /** (Rilascio 6) «Chiedi un chiarimento» (o il chiarimento in attesa) su una risposta del referente, solo a chi modifica. */
  clarify: ClarifyTarget | null;
  /** (Rilascio 6) «Aggiornata il 08/11.»: il referente l'ha cambiata dopo «Invia». */
  editedLabel: string | null;
}

export interface NeedFileRow {
  id: string;
  name: string;
  header: string;
  sizeLabel: string | null;
  inReview: boolean;
  /** «Da controllare: PDF con poco testo». */
  reviewLabel: string | null;
  href: string | null;
  /** «Scarica», oppure «Scarica per controllarlo» per un PDF da controllare. */
  downloadLabel: string;
  canDelete: boolean;
  canReview: boolean;
}

/**
 * («File da compilare») Una riga «Da compilare: {nome} · Sostituisci · Togli» sotto l'esigenza, sempre a vista (non
 * dentro «Risposte e file»: non è una risposta e non si conta lì).
 */
export interface NeedTemplateRow {
  id: string;
  /** «Da compilare:». */
  label: string;
  name: string;
  sizeLabel: string | null;
  /** Il nome scarica il file; null quando chi guarda non lo può aprire. */
  href: string | null;
  /** «Da controllare: PDF con poco testo» finché un'altra persona non lo accetta; null altrimenti. */
  reviewLabel: string | null;
  /** «Sostituisci»: solo a chi modifica, e non mentre una versione nuova aspetta il controllo. */
  canReplace: boolean;
  /** «Togli»: solo a chi modifica. */
  canRemove: boolean;
  /** «Accetta il file» / «Rifiuta il file» per un PDF che chi guarda non ha caricato. */
  canReview: boolean;
  /** La versione nuova che aspetta il controllo: «Nuova versione da controllare: PDF con poco testo». */
  pending: { id: string; name: string; sizeLabel: string | null; label: string; href: string | null; downloadLabel: string; canReview: boolean } | null;
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
  /** («File da compilare») Le righe «Da compilare: …»; [] senza file da compilare. */
  templates: NeedTemplateRow[];
}

export const EMPTY_NEED_REFERENT_ROWS: NeedReferentRows = Object.freeze({ line: null, notice: null, silentTag: null, summary: null, answers: [], files: [], templates: [] }) as NeedReferentRows;

/** («File da compilare») La riga di un file da compilare: «Sostituisci» e «Togli» solo a chi modifica «Cosa serve». */
export function templateRow(t: NeedTemplateView, opts: { canEdit: boolean }): NeedTemplateRow {
  const inReview = t.status === "in_revisione";
  return {
    id: t.id,
    label: T.templateLabel,
    name: t.name,
    sizeLabel: t.sizeLabel,
    href: t.href,
    reviewLabel: inReview ? T.fileInReview : null,
    canReplace: opts.canEdit && t.canEdit && t.pending === null,
    canRemove: opts.canEdit && t.canEdit,
    canReview: opts.canEdit && inReview && t.canReview,
    pending:
      opts.canEdit && t.pending
        ? { id: t.pending.id, name: t.pending.name, sizeLabel: t.pending.sizeLabel, label: T.templatePending, href: t.pending.href, downloadLabel: T.fileDownloadToReview, canReview: t.pending.canReview }
        : null,
  };
}

function answerRow(answer: NeedAnswerView, canEdit: boolean): NeedAnswerRow {
  return {
    id: answer.id,
    header: fillText(T.entryHeader, { autore: answer.authorLabel, data: answer.dateLabel }),
    body: answer.text ?? (answer.dontKnow ? T.dontKnowAnswer : answer.alreadyAttached ? T.alreadyAttachedAnswer : ""),
    dontKnow: answer.text === null && (answer.dontKnow || answer.alreadyAttached === true),
    comment: answer.comment ? fillText(answer.dontKnow ? T.whoMightKnow : T.commentLine, { testo: answer.comment }) : null,
    canRemove: canEdit && answer.canRemove,
    clarify: canEdit && answer.source === "referente" ? (answer.clarify ?? null) : null,
    editedLabel: answer.editedLabel ?? null,
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
export function needReferentRows(view: NeedReferentView | null | undefined, opts: { canEdit: boolean; canReviewFiles: boolean; messages?: number }): NeedReferentRows {
  if (!view) return EMPTY_NEED_REFERENT_ROWS;
  const messages = Math.max(0, opts.messages ?? 0);
  // Una risposta senza testo e senza «Non lo so» (la domanda risposta solo con un file) non è una voce: c'è il file.
  const answers = view.answers.filter((answer) => answer.dontKnow || answer.alreadyAttached === true || Boolean(answer.text?.trim()) || Boolean(answer.comment?.trim())).map((answer) => answerRow(answer, opts.canEdit));
  const files = view.files.filter((file) => file.status !== "in_revisione" || opts.canReviewFiles).map((file) => fileRow(file, opts));
  const count = answers.length + files.length;
  const saysSilent = /senza risposta/i.test(view.line ?? "");
  return {
    line: view.line,
    notice: view.reviewExpired ? T.fileReviewExpired : null,
    silentTag: view.silent && !saysSilent ? T.silentTag : null,
    // (Rilascio 6) Senza risposte né file, il filo della domanda (un dubbio del referente): «Messaggi · n».
    summary: count > 0 ? fillText(T.entriesSummary, { n: count }) : messages > 0 ? `${REFERENT_THREAD_TEXT.heading} · ${messages}` : null,
    answers,
    files,
    // («File da compilare») Un PDF da controllare il server lo manda solo a chi modifica «Cosa serve».
    templates: (view.templates ?? []).filter((t) => t.status === "pulito" || opts.canEdit).map((t) => templateRow(t, { canEdit: opts.canEdit })),
  };
}
