import test from "node:test";
import assert from "node:assert/strict";
import type { NeedFileView, NeedReferentView } from "../../../../lib/use-cases/referent/contract.ts";
import { REFERENT_UI_TEXT } from "../../../../lib/use-cases/referent/labels.ts";
import { EMPTY_NEED_REFERENT_ROWS, needReferentRows } from "./need-referent-view.ts";

// Sotto ogni esigenza: la riga della richiesta, «Senza risposta», risposte e file (SPEC §5.2, §9.3, §P2.10.7).
const T = REFERENT_UI_TEXT;
const file = (over: Partial<NeedFileView>): NeedFileView => ({
  id: "f1",
  name: "procedura.pdf",
  sizeLabel: "1,2 MB",
  dateLabel: "28/10",
  source: "referente",
  authorLabel: "Mario Rossi",
  status: "pulito",
  personalWarning: false,
  href: "/dashboard/ws/use-cases/uc/allegati/f1",
  canDelete: true,
  canReview: false,
  ...over,
});
const view: NeedReferentView = {
  needId: "n1",
  line: "Chiesta a Mario Rossi il 27/10 · Risposta ricevuta il 28/10",
  silent: false,
  answers: [
    { id: "a1", source: "referente", authorLabel: "Mario Rossi", dateLabel: "28/10", text: "Ogni lunedì,\n  circa due ore.", dontKnow: false, canRemove: true },
    { id: "a2", source: "revisore", authorLabel: "Giulia Neri (team)", dateLabel: "29/10", text: null, dontKnow: true, canRemove: false },
  ],
  files: [file({}), file({ id: "f2", name: "scansione.pdf", status: "in_revisione", personalWarning: true, canReview: true, canDelete: false })],
};

test("senza richiesta e senza voci non si mostra niente", () => {
  assert.equal(needReferentRows(null, { canEdit: true, canReviewFiles: false }), EMPTY_NEED_REFERENT_ROWS);
  assert.deepEqual(needReferentRows({ needId: "n", line: null, silent: false, answers: [], files: [] }, { canEdit: true, canReviewFiles: false }), {
    line: null,
    notice: null,
    silentTag: null,
    summary: null,
    answers: [],
    files: [],
  });
});

test("risposte: autore e data, il testo con gli spazi, «Non lo sa»; «Elimina» solo a chi modifica", () => {
  const rows = needReferentRows(view, { canEdit: true, canReviewFiles: false });
  assert.equal(rows.line, view.line);
  assert.deepEqual(
    rows.answers.map((a) => [a.header, a.body, a.dontKnow, a.canRemove]),
    [
      ["Mario Rossi · 28/10", "Ogni lunedì,\n  circa due ore.", false, true],
      ["Giulia Neri (team) · 29/10", T.dontKnowAnswer, true, false],
    ],
  );
  assert.equal(needReferentRows(view, { canEdit: false, canReviewFiles: false }).answers[0].canRemove, false);
});

test("«Risposte e file · n»: conta le voci di questa esigenza; i file «Da controllare» solo a chi li controlla", () => {
  const others = needReferentRows(view, { canEdit: true, canReviewFiles: false });
  assert.equal(others.summary, "Risposte e file · 3");
  assert.deepEqual(others.files.map((f) => f.id), ["f1"]);
  assert.deepEqual(
    [others.files[0].downloadLabel, others.files[0].reviewLabel, others.files[0].personalWarning, others.files[0].canDelete, others.files[0].href],
    [T.fileDownload, null, null, true, "/dashboard/ws/use-cases/uc/allegati/f1"],
  );
  const ls = needReferentRows(view, { canEdit: true, canReviewFiles: true });
  assert.equal(ls.summary, "Risposte e file · 4");
  const review = ls.files.find((f) => f.id === "f2");
  assert.deepEqual(
    [review?.inReview, review?.reviewLabel, review?.downloadLabel, review?.personalWarning, review?.canReview, review?.canDelete],
    [true, T.fileInReview, T.fileDownloadToReview, T.filePersonalWarning, true, false],
  );
});

test("«Senza risposta»: un solo segnale, solo se la riga non lo dice già", () => {
  const silent = { ...view, line: "Chiesta a Mario Rossi il 27/10 · Ultimo promemoria il 05/11", silent: true, answers: [], files: [] };
  assert.equal(needReferentRows(silent, { canEdit: true, canReviewFiles: false }).silentTag, T.silentTag);
  const expired = { ...silent, line: "Link scaduto il 26/11 senza risposta" };
  assert.equal(needReferentRows(expired, { canEdit: true, canReviewFiles: false }).silentTag, null);
  assert.equal(needReferentRows({ ...silent, silent: false }, { canEdit: true, canReviewFiles: false }).silentTag, null);
});

test("nessuna voce parla di tempi o di persone a confronto", () => {
  const rows = needReferentRows(view, { canEdit: true, canReviewFiles: true });
  const texts = [rows.line, rows.summary, ...rows.answers.map((a) => a.header), ...rows.files.map((f) => f.header)].join(" ");
  assert.doesNotMatch(texts, /in ritardo|giorni|classifica|In corso/i);
});

test("una domanda risposta solo con un file: nessuna risposta vuota, il file conta una volta", () => {
  const onlyFile: NeedReferentView = {
    needId: "n2",
    line: null,
    silent: false,
    answers: [{ id: "a3", source: "referente", authorLabel: "Mario Rossi", dateLabel: "27/10", text: null, dontKnow: false, canRemove: true }],
    files: [file({ id: "f3" })],
  };
  const rows = needReferentRows(onlyFile, { canEdit: true, canReviewFiles: false });
  assert.deepEqual(rows.answers, []);
  assert.equal(rows.files.length, 1);
  assert.equal(rows.summary, "Risposte e file · 1");
});

test("un PDF non controllato in tempo: la riga lo dice, anche senza altre voci", () => {
  const rows = needReferentRows({ needId: "n3", line: null, silent: false, answers: [], files: [], reviewExpired: true }, { canEdit: true, canReviewFiles: true });
  assert.equal(rows.notice, T.fileReviewExpired);
  assert.equal(rows.notice, "File non controllato in tempo: chiedi di caricarlo di nuovo.");
  assert.equal(rows.summary, null);
});
