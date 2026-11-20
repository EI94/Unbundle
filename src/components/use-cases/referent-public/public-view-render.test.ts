import test from "node:test";
import assert from "node:assert/strict";
import type { ReferentAskView, ReferentFileView, ReferentQuestionView, ReferentThreadMessageView } from "../../../lib/use-cases/referent/contract.ts";
import { REFERENT_PRIVACY_NOTICE, REFERENT_PUBLIC_TEXT, privacyNoticeView } from "../../../lib/use-cases/referent/labels.ts";
import {
  counterLabel,
  descriptionClamp,
  expiryLabel,
  fileFromUpload,
  fileRow,
  fileStateLabel,
  filesBlockSubmit,
  finalCardText,
  handledText,
  headerTexts,
  issuesByQuestion,
  noticeOf,
  privacyTexts,
  questionSections,
  screenOf,
  screenUnderNotice,
  sentAnswerView,
  stateCardKindOf,
  stateCardText,
  thanksTexts,
  closeHint,
  commentOffered,
  lastSentOn,
  missingText,
  progressText,
  questionClosed,
  sentCheckLines,
  sentCount,
  sentSummary,
  usableFile,
  anchorLabelOf,
  doubtOf,
  editableText,
  freshReplyIds,
  messagesOf,
  newsEntries,
  newsMissingText,
  newsOf,
  threadActionsOf,
  threadKeyOf,
  threadLineOf,
  threadTargetOf,
  updatedLine,
  writeTargets,
} from "./public-view-render.ts";

// Dalla vista della richiesta a quello che la pagina `/rispondi/<token>` mostra (SPEC §4.4, §P3.7).

const N = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

function question(i: number, over: Partial<ReferentQuestionView> = {}): ReferentQuestionView {
  return { needId: N[i], position: i + 1, title: `Domanda ${i}`, state: "aperta", fileRequired: false, draft: null, answer: null, files: [], ...over };
}

function view(over: Partial<ReferentAskView> = {}): ReferentAskView {
  return {
    state: "aperta",
    privacy: { accepted: true, version: "ucq-2026-11-2", contact: "pierpaolo@lateralspace.ai" },
    company: "Rondine",
    useCase: { code: "RD-0004", title: "Fatture fornitori" },
    requester: { name: "Giulia Neri" },
    message: "Ci serve per la stima di fine mese.",
    expiresOn: "2026-11-26",
    questions: [question(0), question(1)],
    upload: { clientMode: true },
    kind: "domande",
    check: null,
    thread: { followUp: false, open: true, messages: [] },
    ...over,
  };
}

const file = (over: Partial<ReferentFileView> = {}): ReferentFileView => ({
  id: "f1",
  name: "preventivo.pdf",
  sizeBytes: 1200,
  status: "pulito",
  message: null,
  submitted: false,
  ...over,
});

test("(rilascio 10, §3.11) due schede sole: il link che non vale più (sbagliato, revocato, scaduto) e l'errore con «Riprova»", () => {
  for (const access of ["non_valido", "revocato", "scaduto"] as const) assert.equal(stateCardKindOf(access), "gone", access);
  assert.equal(stateCardKindOf("non_disponibile"), "error");
  assert.deepEqual(stateCardText("gone"), { title: "Questo link non vale più.", text: "Rispondi all'email che hai ricevuto: arriva a chi ti ha scritto." });
  // Le stesse parole di `/r` (il kit del referente).
  assert.deepEqual(stateCardText("error"), { title: "Questa pagina non si è caricata.", text: "Le risposte che hai già inviato sono salve." });
  assert.equal(REFERENT_PUBLIC_TEXT.error.retry, "Riprova");
});

test("intestazione: il cliente per la riga in alto, il titolo senza codice, chi chiede e il suo messaggio", () => {
  const h = headerTexts(view());
  assert.deepEqual(h, {
    client: "Rondine",
    title: "Fatture fornitori",
    reference: "Riferimento RD-0004",
    requestedBy: "Giulia Neri ti chiede alcune informazioni.",
    message: { title: "Il messaggio di Giulia Neri", text: "Ci serve per la stima di fine mese." },
  });
  const plain = headerTexts(view({ useCase: { code: null, title: "Fatture" }, message: "   ", company: "  " }));
  assert.equal(plain.title, "Fatture");
  assert.equal(plain.message, null);
  assert.equal(plain.reference, null);
  assert.equal(plain.client, null, "senza il nome del cliente, il marchio da solo");
  assert.equal(headerTexts(view({ company: "  Cliente   Demo " })).client, "Cliente Demo");
});

test("informativa: prima di tutto finché non è letta; i segnaposto riempiti", () => {
  assert.equal(screenOf(view({ privacy: { accepted: false, version: "ucq-2026-11-2", contact: "x@y.it" } })), "privacy");
  assert.equal(screenOf(view()), "questions");
  const p = privacyTexts(view());
  assert.equal(p.title, "Prima di iniziare");
  assert.equal(p.button, "Iniziamo");
  // (Rilascio 5.1) Corta e calma: una riga e due punti, nessuna parola che spaventa; il resto a un tocco.
  assert.equal(p.lead, "Ti chiediamo del tuo lavoro, non di te.");
  assert.equal(p.summary.length, 2);
  assert.ok(p.summary[0].includes("di Rondine"));
  assert.ok(p.summary[1].endsWith("fino al 26 novembre 2026."));
  assert.ok([p.lead, ...p.summary].every((t) => !/blocc|dati personali|sanitar|nomi|email|telefon/i.test(t)), "niente allarmi sopra");
  assert.equal(p.fullTextLabel, "Leggi l'informativa completa");
  // L'informativa completa resta intera: chi, cosa, chi vede, controllo dei file, quanto, diritti, Garante.
  assert.ok(p.paragraphs.some((t) => t.startsWith("Lateral Space raccoglie queste informazioni per conto di Rondine")));
  assert.ok(p.paragraphs.some((t) => t.startsWith("Giulia Neri e le altre persone di Rondine")));
  assert.ok(p.paragraphs.some((t) => t.includes("controllo automatico")));
  assert.ok(p.paragraphs.some((t) => t.includes("12 mesi")));
  assert.ok(p.paragraphs.some((t) => t.includes("Garante per la protezione dei dati personali")));
  assert.ok(p.paragraphs.some((t) => t.includes("pierpaolo@lateralspace.ai")));
  assert.ok(p.paragraphs.some((t) => t.includes("nomi, email o telefoni") && t.includes("li usiamo solo per questo")));
  assert.ok(!p.paragraphs.some((t) => /il sistema li blocca|blocca/i.test(t)), "il sistema non blocca più nomi, email e telefoni");
  assert.ok(![...p.summary, ...p.paragraphs].some((t) => /\{[A-Za-z]+\}/.test(t)), "nessun segnaposto vuoto");
});

test("(rilascio 10, §3.11) le domande numerate «1», «2» in ordine di posizione, e la fine", () => {
  const sections = questionSections(view({ questions: [question(1, { position: 5 }), question(0, { position: 2 })] }));
  assert.deepEqual(
    sections.map((s) => [s.needId, s.number, s.label]),
    [
      [N[0], 1, undefined],
      [N[1], 2, undefined],
    ],
  );
  assert.equal(screenOf(view({ state: "completata" })), "completed");
  assert.equal(screenOf(view({ state: "vuota", privacy: { accepted: false, version: "v", contact: "c" } })), "empty");
  assert.equal(finalCardText("completed"), "Hai risposto a tutte le domande. Grazie!");
  assert.equal(finalCardText("empty"), "Non ci sono più domande per te. Grazie per la disponibilità.");
});

test("una domanda inviata: «Inviata il 27/10», il testo o «Non ce l'ho», i nomi dei file", () => {
  const sent = question(0, { state: "inviata", answer: { text: "Ogni giorno", dontKnow: false, alreadyAttached: false, comment: null, submittedAt: "2026-10-27T09:00:00.000Z" }, files: [file({ submitted: true })] });
  assert.deepEqual(sentAnswerView(sent, "2026-10-28"), { sentOn: "Inviata il 27/10", text: "Ogni giorno", files: ["preventivo.pdf"] });
  const unknown = question(0, { state: "inviata", answer: { text: null, dontKnow: true, alreadyAttached: false, comment: null, submittedAt: "2025-12-30T09:00:00.000Z" } });
  assert.deepEqual(sentAnswerView(unknown, "2026-10-28"), { sentOn: "Inviata il 30/12/2025", text: "Non lo so", files: [] });
  assert.equal(sentAnswerView(question(0), "2026-10-28"), null);
});

test("(Parte 3) una domanda «gestita»: solo il titolo e «Non serve più: ci ha già pensato il team.»", () => {
  const handled = question(1, { state: "gestita" });
  const sections = questionSections(view({ questions: [question(0), handled] }));
  assert.equal(sections[1].kind, "gestita");
  assert.equal(sections[1].number, 2, "conta come le altre");
  assert.equal(handledText(), "Non serve più: ci ha già pensato il team.");
  assert.equal(sentAnswerView(handled, "2026-10-27"), null, "niente risposta da mostrare");
  // Tutto fatto dal team: la scheda «vuota», poi le domande in sola lettura.
  const allTeam = view({ state: "vuota", questions: [question(0, { state: "gestita" }), question(1, { state: "gestita" })] });
  assert.equal(screenOf(allTeam), "empty");
  assert.deepEqual(questionSections(allTeam).map((s) => s.kind), ["gestita", "gestita"]);
});

test("il contatore compare dai 3.500 caratteri", () => {
  assert.equal(counterLabel(3499), null);
  assert.equal(counterLabel(3500), "3.500 di 4.000 caratteri");
  assert.equal(counterLabel(4000), "4.000 di 4.000 caratteri");
});

test("gli stati dei file e «in revisione»; (rilascio 5.1) niente più da confermare", () => {
  assert.equal(fileStateLabel(file({ status: "in_quarantena" })), "Controllo in corso…");
  assert.equal(fileStateLabel(file()), "Allegato");
  assert.equal(fileStateLabel(file({ status: "in_revisione" })), "Lo controlla il team prima di usarlo: puoi inviare lo stesso");
  assert.equal(fileStateLabel(file({ status: "rifiutato", message: REFERENT_PUBLIC_TEXT.fileRejected.sanitario })), `Non accettato. ${REFERENT_PUBLIC_TEXT.fileRejected.sanitario}`);
  assert.equal(fileStateLabel(file({ status: "rifiutato", message: null })), "Non accettato");

  const review = fileRow(file({ status: "in_revisione" }));
  assert.deepEqual(Object.keys(review).sort(), ["id", "name", "removable", "state", "tone"], "nessuna conferma nella riga");
  assert.equal(review.tone, "attenzione");
  assert.equal(review.removable, true);
  assert.equal(fileRow(file({ submitted: true })).removable, false, "un file inviato non si toglie");
  assert.equal(fileRow(file({ status: "rifiutato" })).removable, false, "un file rifiutato è già cancellato");

  assert.equal(filesBlockSubmit([file()]), null);
  assert.equal(filesBlockSubmit([file({ status: "in_revisione" })]), null, "un PDF in revisione si invia lo stesso");
  assert.equal(filesBlockSubmit([file({ status: "in_quarantena" })]), "file_in_controllo");
  assert.equal(filesBlockSubmit([file({ status: "in_quarantena", submitted: true })]), null);

  // Una risposta del server del rilascio 5 (con l'avviso) arriva a schermo senza l'avviso.
  const up = fileFromUpload({ fileId: "f9", fileName: "a.xlsx", sizeBytes: 10, status: "in_revisione", usable: true, message: "m", ...({ warning: "x", needsConfirmation: true } as object) });
  assert.deepEqual(up, { id: "f9", name: "a.xlsx", sizeBytes: 10, status: "in_revisione", message: "m", submitted: false });
});

test("invio: la frase con la data, il ringraziamento, le domande che restano", () => {
  assert.equal(expiryLabel("2026-11-26"), "26 novembre 2026");
  // (Rilascio 5) Si invia solo con tutto chiuso: «Grazie, è tutto.», senza pulsanti.
  assert.deepEqual(thanksTexts({ submitted: 2, open: 0, state: "completata" }, view()), {
    title: "Grazie, è tutto.",
    seen: "Giulia Neri lo vede subito.",
    remaining: null,
    back: null,
  });
  assert.equal(thanksTexts({ submitted: 1, open: 1, state: "aperta" }, view()).remaining, "Resta una domanda: puoi rispondere quando vuoi, entro il 26 novembre 2026.");
  const many = thanksTexts({ submitted: 1, open: 3, state: "aperta" }, view());
  assert.equal(many.remaining, "Restano 3 domande: puoi rispondere quando vuoi, entro il 26 novembre 2026.");
  assert.equal(many.back, "Torna alle domande");
});

test("i problemi dell'invio vanno sulle loro domande, la prima da mostrare è nell'ordine della pagina", () => {
  const r = issuesByQuestion(
    [
      { code: "testo_contatti", message: "Togli email e telefoni.", field: N[1].toUpperCase() },
      { code: "testo_salute", message: "Niente dati sanitari.", field: N[0] },
      { code: "testo_salute", message: "Niente dati sanitari.", field: N[0] },
      { code: "x", message: "Generale." },
    ],
    [N[0], N[1]],
  );
  assert.deepEqual([...r.byNeed.entries()], [
    [N[1], ["Togli email e telefoni."]],
    [N[0], ["Niente dati sanitari."]],
  ]);
  assert.equal(r.first, N[0]);
  assert.deepEqual(r.general, ["Generale."]);
});

test("la pagina usa solo i campi del contratto: un campo in più nella vista non arriva a schermo", () => {
  const leaky = { ...view(), proposedBy: "proponente@rondine.it", reviewNotes: "NOTA-RISERVATA", valueEurYear: 98765 } as ReferentAskView;
  const shown = JSON.stringify([headerTexts(leaky), privacyTexts(leaky), questionSections(leaky).map((s) => [s.number, s.title]), writeTargets(leaky), sentSummary(leaky)]);
  for (const secret of ["proponente@rondine.it", "NOTA-RISERVATA", "98765"]) assert.ok(!shown.includes(secret), secret);
});

// ─── Rilascio 5: le chiusure (§3.6, §7.5, §7.6) ──────────────────────

test("(rilascio 5) una domanda è chiusa da un testo, un file, «Non ce l'ho» o «È già allegato»; su «Serve un file» il testo no", () => {
  const open = question(0);
  const needs = question(0, { fileRequired: true });
  const none = { text: "", dontKnow: false, alreadyAttached: false, files: [] };
  assert.equal(questionClosed(open, none), false);
  assert.equal(questionClosed(open, null), false);
  assert.equal(questionClosed(open, { ...none, text: "  " }), false);
  assert.equal(questionClosed(open, { ...none, text: "Ogni giorno" }), true);
  assert.equal(questionClosed(needs, { ...none, text: "Ogni giorno" }), false, "«Serve un file»: il testo non basta");
  assert.equal(questionClosed(needs, { ...none, dontKnow: true }), true);
  assert.equal(questionClosed(needs, { ...none, alreadyAttached: true }), true);
  assert.equal(questionClosed(needs, { ...none, files: [file({ status: "pulito" })] }), true);
  assert.equal(questionClosed(needs, { ...none, files: [file({ status: "in_quarantena" })] }), false, "il controllo non è finito");
  assert.equal(questionClosed(needs, { ...none, files: [file({ status: "rifiutato" })] }), false);
  assert.equal(questionClosed(question(0, { state: "gestita" }), null), true);
  assert.equal(questionClosed(question(0, { state: "inviata" }), null), true);
  assert.equal(usableFile(file({ status: "in_revisione" })), true);
});

test("(rilascio 5) il commento solo con una chiusura senza testo; i testi della lista, del conteggio, di quello che manca", () => {
  assert.equal(commentOffered({ dontKnow: false, alreadyAttached: false, files: [] }), false);
  assert.equal(commentOffered({ dontKnow: true, alreadyAttached: false, files: [] }), true);
  assert.equal(commentOffered({ dontKnow: false, alreadyAttached: true, files: [] }), true);
  assert.equal(commentOffered({ dontKnow: false, alreadyAttached: false, files: [file({ status: "pulito" })] }), true);
  assert.equal(missingText([4]), "Manca ancora la domanda 4.");
  assert.equal(missingText([6, 2, 4]), "Mancano ancora le domande 2, 4 e 6.");
  assert.equal(missingText([2, 3]), "Mancano ancora le domande 2 e 3.");
  assert.equal(closeHint(false), "Per chiudere: rispondi, allega un file o scegli «Non lo so».");
  assert.equal(closeHint(true), "Per chiudere: allega il file o scegli «Non lo so».");
});

test("(rilascio 10, §3.11) un solo numero, nella barra, con il salvataggio accanto: «2 di 5 · salvato»", () => {
  assert.equal(progressText(2, 5, []), "2 di 5 · salvato");
  assert.equal(progressText(2, 5, ["saved", "saved"]), "2 di 5 · salvato");
  assert.equal(progressText(2, 5, ["saved", "saving"]), "2 di 5 · salvataggio…");
  assert.equal(progressText(2, 5, ["saving", "error"]), "2 di 5", "un salvataggio non riuscito lo dice la domanda");
  assert.equal(progressText(2, 5, ["held"]), "2 di 5", "in attesa dell'informativa niente «salvato»");
  assert.equal(progressText(1, 3, ["saved"], { unsent: true }), "1 di 3", "una risposta a un chiarimento parte solo con «Invia»");
  for (const text of [progressText(0, 1, []), progressText(3, 3, ["saving"])]) assert.match(text, /^\d+ di \d+( · (salvato|salvataggio…))?$/);
});

test("(rilascio 5) dopo l'invio: «Hai risposto il …», la conferma e la stima in sola lettura, «Non ce l'ho», «È già allegato», il commento", () => {
  const sent = (over: Partial<NonNullable<ReferentQuestionView["answer"]>>) =>
    question(0, { state: "inviata", answer: { text: null, dontKnow: false, alreadyAttached: false, comment: null, submittedAt: "2026-11-03T09:00:00.000Z", ...over } });
  assert.deepEqual(sentAnswerView(sent({ alreadyAttached: true, comment: "È nel file della domanda 2." }), "2026-11-04"), {
    sentOn: "Inviata il 03/11",
    text: "È già allegato",
    files: [],
    comment: "Commento: È nel file della domanda 2.",
  });
  assert.deepEqual(sentAnswerView(sent({ dontKnow: true, comment: "l'ufficio acquisti" }), "2026-11-04")?.comment, "Chi potrebbe saperlo: l'ufficio acquisti");
  const check = (draft: Partial<NonNullable<ReferentAskView["check"]>["draft"]>, submittedAt: string | null = "2026-11-03T10:00:00.000Z"): ReferentAskView["check"] => ({
    description: null,
    benefits: null,
    draft: { confirm: "si", note: null, estimate: "si", timesPerMonth: null, minutesEach: null, stale: false, savedAt: null, ...draft },
    submittedAt,
  });
  const done = view({ state: "completata", kind: "referente", check: check({}), questions: [sent({ text: "Ogni giorno" })] });
  assert.equal(lastSentOn(done), "2026-11-03T10:00:00.000Z");
  assert.equal(finalCardText("completed", done, "2026-11-04"), "Hai risposto il 03/11. Grazie!");
  assert.equal(finalCardText("completed"), "Hai risposto a tutte le domande. Grazie!");
  // Una richiesta inviata con la stima del tempo del rilascio 5: si legge come allora.
  assert.deepEqual(sentCheckLines(done), { useCase: "Il caso d'uso: sì, è così.", note: null, time: "Il tempo: sì.", numbers: null, benefits: [] });
  assert.deepEqual(sentCheckLines(view({ check: check({ confirm: "correggi", note: "Anche via PEC", estimate: "meno", timesPerMonth: 200, minutesEach: 1.5 }) })), {
    useCase: "Il caso d'uso: da correggere.",
    note: "Anche via PEC",
    time: "Il tempo: è di meno.",
    numbers: "200 volte al mese, 1,5 minuti ogni volta.",
    benefits: [],
  });
  // (Rilascio 5.1) Inviata per beneficio: una riga per voce, con il commento.
  const rowDraft = (d: Partial<NonNullable<NonNullable<NonNullable<ReferentAskView["check"]>["benefits"]>[number]["draft"]>>) => ({ answer: null, timesPerMonth: null, minutesEach: null, eurYear: null, comment: null, stale: false, ...d });
  const perBenefit = view({
    check: {
      ...check({ estimate: null })!,
      benefits: [
        { key: "tempo-1", form: "ore", label: "Controllo delle fatture", team: { kind: "ore", volumeYear: 3000, minutes: 12, eurYear: null }, draft: rowDraft({ answer: "piu", timesPerMonth: 300 }) },
        { key: "costi-1", form: "euro", label: "Meno solleciti", team: { kind: "euro", volumeYear: null, minutes: null, eurYear: 4000 }, draft: rowDraft({ answer: "si" }) },
        { key: "qualita-1", form: "fatto", label: "Meno errori", team: { kind: "qualitativo", volumeYear: null, minutes: null, eurYear: null }, draft: rowDraft({ answer: "no", comment: "Solo a fine mese." }) },
      ],
    },
  });
  assert.deepEqual(sentCheckLines(perBenefit), {
    useCase: "Il caso d'uso: sì, è così.",
    note: null,
    time: null,
    numbers: null,
    benefits: [
      { key: "tempo-1", line: "Controllo delle fatture: è di più. 300 volte al mese, 12 minuti ogni volta.", comment: null },
      { key: "costi-1", line: "Meno solleciti: sì.", comment: null },
      { key: "qualita-1", line: "Meno errori: no.", comment: "Commento: Solo a fine mese." },
    ],
  });
  assert.equal(sentCheckLines(view({ check: check({ estimate: null, timesPerMonth: 20, minutesEach: 30 }) }))?.time, "Il tempo:");
  assert.equal(sentCheckLines(view({ check: check({}, null) })), null, "solo dopo l'invio");
});

// ─── (Rilascio 6) Il filo con il team ────────────────────────────────

const msg = (over: Partial<ReferentThreadMessageView> & Pick<ReferentThreadMessageView, "id" | "side" | "kind">): ReferentThreadMessageView => ({
  anchor: "domanda",
  needId: N[0],
  componentKey: null,
  text: "Testo",
  createdAt: "2026-11-09T10:00:00.000Z",
  replyTo: null,
  waiting: false,
  fresh: false,
  ...over,
});
const sentQuestion = (i: number, over: Partial<ReferentQuestionView> = {}) =>
  question(i, { state: "inviata", answer: { text: `Risposta ${i}`, dontKnow: false, alreadyAttached: false, comment: null, submittedAt: "2026-11-03T10:00:00.000Z", editedAt: null }, editable: true, ...over });
const followUpView = (messages: ReferentThreadMessageView[], over: Partial<ReferentAskView> = {}) =>
  view({ state: "completata", questions: [sentQuestion(0), sentQuestion(1)], thread: { followUp: true, open: true, messages }, ...over });

test("(rilascio 6) la schermata: «Da completare» dopo il primo invio con una novità; l'informativa solo per scrivere", () => {
  const clar = msg({ id: "c1", side: "team", kind: "chiarimento", waiting: true, text: "Al mese o all'anno?" });
  assert.equal(screenOf(followUpView([])), "completed", "niente di nuovo: la sola lettura");
  assert.equal(screenOf(followUpView([clar])), "news");
  assert.equal(screenOf(followUpView([{ ...clar, waiting: false }])), "completed", "un chiarimento già risposto");
  // Una risposta del team da leggere non chiede l'informativa; un chiarimento sì.
  const reply = msg({ id: "r1", side: "team", kind: "risposta", fresh: true, replyTo: "d1" });
  const old = { privacy: { accepted: false, version: "ucq-2026-11-2", contact: "x@example.test" } };
  assert.equal(screenOf(followUpView([reply], old)), "news");
  assert.equal(screenOf(followUpView([clar], old)), "privacy");
  // Domande nuove: «Da completare»; prima del primo invio le domande come nel rilascio 5.1.
  const newQ = followUpView([], { state: "aperta", questions: [sentQuestion(0), question(1, { followUp: true })] });
  assert.equal(screenOf(newQ), "news");
  assert.equal(screenOf(view({ thread: { followUp: false, open: true, messages: [reply] } })), "questions");
});

test("(rilascio 6) «Da completare»: prima i chiarimenti, poi le domande nuove, poi le risposte del team; i numeri e quello che manca", () => {
  const clar = msg({ id: "c1", side: "team", kind: "chiarimento", waiting: true });
  const reply = msg({ id: "r1", side: "team", kind: "risposta", fresh: true, anchor: "generale", needId: null, replyTo: "d1" });
  const doubt = msg({ id: "d1", side: "referente", kind: "dubbio", anchor: "generale", needId: null, text: "Chi le vede?" });
  const v = followUpView([doubt, clar, reply], { state: "aperta", questions: [sentQuestion(0), question(1, { followUp: true })] });
  const n = newsOf(v);
  assert.deepEqual([n.clarifications.length, n.questions.length, n.replies.length, n.total], [1, 1, 1, 3]);
  assert.deepEqual(
    newsEntries(v).map((e) => [e.kind, e.label, e.anchorLabel, e.position]),
    [
      ["chiarimento", "Chiarimento", "Sulla domanda «Domanda 0»", 1],
      ["domanda", "Nuova domanda", "", 2],
      ["risposta", "Risposta del team", "Sul caso d'uso", 3],
    ],
    "(rilascio 10, §3.11) il tipo senza «1 di 3»: il solo numero sta nella barra",
  );
  assert.equal(newsEntries(followUpView([clar]))[0].label, "Chiarimento");
  assert.equal(newsMissingText([2]), "Manca ancora il punto 2.");
  assert.equal(newsMissingText([3, 1]), "Mancano ancora i punti 1 e 3.");
  assert.equal(doubtOf(v, reply)?.text, "Chi le vede?");
  assert.deepEqual(freshReplyIds(v), ["r1"]);
});

test("(rilascio 6) le righe del filo sotto una risposta, mai chi del team ha scritto; i messaggi di un'ancora sparita in «Generale»", () => {
  const today = "2026-11-09";
  const lines = [
    msg({ id: "1", side: "team", kind: "chiarimento", text: "Quante?" }),
    msg({ id: "2", side: "referente", kind: "risposta", text: "Circa 200." }),
    msg({ id: "3", side: "referente", kind: "dubbio", text: "Anche i resi?" }),
    msg({ id: "4", side: "team", kind: "risposta", text: "Sì." }),
    msg({ id: "5", side: "referente", kind: "aggiunta", text: "Anche la PEC." }),
  ].map((m) => threadLineOf(m, today));
  assert.deepEqual(lines, [
    "Il team ha chiesto: «Quante?» · 09/11",
    "Hai risposto: «Circa 200.» · 09/11",
    "Hai chiesto: «Anche i resi?» · 09/11",
    "Il team ha risposto: «Sì.» · 09/11",
    "Hai aggiunto: «Anche la PEC.» · 09/11",
  ]);
  const gone = msg({ id: "g1", side: "referente", kind: "aggiunta", needId: "99999999-9999-4999-8999-999999999999" });
  const v = followUpView([msg({ id: "a", side: "referente", kind: "aggiunta" }), gone]);
  assert.deepEqual(messagesOf(v, threadKeyOf({ anchor: "domanda", needId: N[0] })).map((m) => m.id), ["a"]);
  assert.deepEqual(messagesOf(v, "g").map((m) => m.id), ["g1"], "un'ancora che non c'è più: con «Generale»");
  const fresh = msg({ id: "f", side: "team", kind: "risposta", fresh: true });
  assert.deepEqual(messagesOf(followUpView([fresh]), `d:${N[0]}`, { withFresh: false }), [], "in «Da completare» la risposta nuova ha la sua scheda");
  assert.equal(anchorLabelOf(v, { anchor: "domanda", needId: N[1] }), "Sulla domanda «Domanda 1»");
  assert.equal(anchorLabelOf(v, { anchor: "generale" }), "Sul caso d'uso");
  assert.equal(anchorLabelOf(view({ questions: [question(0, { title: "x".repeat(80) })] }), { anchor: "domanda", needId: N[0] }), `Sulla domanda «${"x".repeat(59)}…»`);
  assert.deepEqual(threadTargetOf(threadKeyOf({ anchor: "beneficio", componentKey: "tempo-1" })), { anchor: "beneficio", componentKey: "tempo-1" });
  assert.deepEqual(threadTargetOf("g"), { anchor: "generale" });
  for (const line of lines) assert.doesNotMatch(line, /use case|\(team\)/);
});

test("(rilascio 6) che cosa si fa su una risposta inviata: «Modifica» fino ad «A posto», poi «Aggiungi qualcosa»; «Ho un dubbio» ovunque", () => {
  const v = followUpView([]);
  assert.deepEqual(threadActionsOf(v, { kind: "domanda", question: sentQuestion(0) }), ["edit", "doubt"]);
  assert.deepEqual(threadActionsOf(v, { kind: "domanda", question: sentQuestion(0, { editable: false }) }), ["add", "doubt"]);
  assert.deepEqual(threadActionsOf(v, { kind: "domanda", question: question(0) }), ["doubt"], "una domanda aperta");
  assert.deepEqual(threadActionsOf(v, { kind: "domanda", question: question(0, { state: "gestita" }) }), [], "una domanda a cui ha pensato il team");
  assert.deepEqual(threadActionsOf(v, { kind: "generale" }), ["doubt"], "senza conferma inviata: solo «Ho un dubbio»");
  assert.deepEqual(threadActionsOf(v, { kind: "beneficio" }), [], "nessuna voce inviata");
  const sentCheck = followUpView([], { kind: "referente", check: { description: null, benefits: [], draft: { confirm: "si", note: null, estimate: null, timesPerMonth: null, minutesEach: null, stale: false, savedAt: null }, submittedAt: "2026-11-03T10:00:00.000Z" } });
  assert.deepEqual(threadActionsOf(sentCheck, { kind: "beneficio" }), ["add", "doubt"]);
  assert.deepEqual(threadActionsOf(sentCheck, { kind: "generale" }), ["add", "doubt"]);
  assert.deepEqual(threadActionsOf(followUpView([], { thread: { followUp: true, open: false, messages: [] } }), { kind: "domanda", question: sentQuestion(0) }), [], "un link chiuso: niente");
  assert.equal(editableText(sentQuestion(0)), "Risposta 0");
  assert.equal(editableText(sentQuestion(0, { answer: { text: null, dontKnow: true, alreadyAttached: false, comment: null, submittedAt: "2026-11-03T10:00:00.000Z" } })), "", "mai «Non ce l'ho» nel campo");
  assert.equal(updatedLine(sentQuestion(0, { answer: { text: "x", dontKnow: false, alreadyAttached: false, comment: null, submittedAt: "2026-11-03T10:00:00.000Z", editedAt: "2026-11-08T10:00:00.000Z" } }), "2026-11-09"), "Aggiornata il 08/11.");
  assert.equal(updatedLine(sentQuestion(0), "2026-11-09"), null);
  // «Hai risposto il …»: anche dopo una risposta nel filo.
  assert.equal(lastSentOn(followUpView([msg({ id: "x", side: "referente", kind: "aggiunta", createdAt: "2026-11-09T10:00:00.000Z" })])), "2026-11-09T10:00:00.000Z");
});

// ─── (Rilascio 9b) L'informativa della vista ─────────────────────────

test("(rilascio 9b) il testo da accettare è quello della vista; senza, quello della pagina solo se è della stessa versione", () => {
  const now = REFERENT_PRIVACY_NOTICE.version;
  const values = { company: "Rondine", expires: "26 novembre 2026", requester: "Giulia Neri", contact: "x@y.it" };
  const server = privacyNoticeView(values);
  const contact = { accepted: false, contact: "x@y.it" };
  // Il server nuovo manda il suo testo: la pagina mostra quello, con la sua versione (la prova di «Iniziamo»).
  const next = { ...server, version: "ucq-2027-01-1", lead: "Abbiamo cambiato due cose." };
  assert.deepEqual(noticeOf(view({ privacy: { ...contact, version: next.version, notice: next } })), next);
  assert.deepEqual(noticeOf(view({ privacy: { ...contact, version: now, notice: server } })), server);
  // Un server di prima (nessun testo): il testo di questa pagina, ma solo se la versione è la sua.
  assert.deepEqual(noticeOf(view({ privacy: { ...contact, version: now } })), { version: now, ...privacyTexts(view({ privacy: { ...contact, version: now } })) });
  assert.equal(noticeOf(view({ privacy: { ...contact, version: "ucq-2026-11-2" } })), null, "un'altra versione senza testo: si ricarica");
  // Un testo di un'altra versione non vale per quella da accettare.
  assert.equal(noticeOf(view({ privacy: { ...contact, version: "ucq-2027-01-1", notice: server } })), null);
});

test("(rilascio 9b) la schermata sotto l'informativa: quella che la pagina mostrerebbe con l'informativa letta", () => {
  const unread = { accepted: false, version: "ucq-2026-11-3", contact: "x@y.it" };
  assert.equal(screenOf(view({ privacy: unread })), "privacy");
  assert.equal(screenUnderNotice(view({ privacy: unread })), "questions");
  assert.equal(screenUnderNotice(view()), "questions");
  const clar: ReferentThreadMessageView = { id: "m1", anchor: "generale", needId: null, componentKey: null, side: "team", kind: "chiarimento", text: "Quante?", createdAt: "2026-11-08T10:00:00.000Z", replyTo: null, waiting: true, fresh: false };
  const followUp = view({ state: "completata", privacy: unread, questions: [question(0, { state: "inviata", answer: { text: "Sì", dontKnow: false, alreadyAttached: false, comment: null, submittedAt: "2026-11-05T10:00:00.000Z" } })], thread: { followUp: true, open: true, messages: [clar] } });
  assert.equal(screenOf(followUp), "privacy", "un chiarimento chiede l'informativa");
  assert.equal(screenUnderNotice(followUp), "news");
  assert.equal(screenUnderNotice(view({ state: "completata", privacy: unread, questions: [] })), "completed");
});

// ─── (Rilascio 10, §3.11) Lavoro finito e passo 1 ────────────────────

const sentCheckOf = (benefits: NonNullable<ReferentAskView["check"]>["benefits"]): ReferentAskView["check"] => ({
  description: null,
  benefits,
  draft: { confirm: "si", note: null, estimate: null, timesPerMonth: null, minutesEach: null, stale: false, savedAt: null },
  submittedAt: "2026-11-03T10:00:00.000Z",
});
const BENEFITS: NonNullable<NonNullable<ReferentAskView["check"]>["benefits"]> = [
  { key: "tempo-1", form: "ore", label: "Controllo delle fatture", team: { kind: "ore", volumeYear: 3000, minutes: 12, eurYear: null }, draft: null },
  { key: "qualita-1", form: "fatto", label: "Meno errori.", team: { kind: "qualitativo", volumeYear: null, minutes: null, eurYear: null }, draft: null },
];

test("(rilascio 10, §3.11) «Le tue risposte (n)»: la conferma, ogni stima e ogni domanda chiusa", () => {
  const done = followUpView([], { kind: "referente", check: sentCheckOf(BENEFITS), questions: [sentQuestion(0), sentQuestion(1), question(2, { state: "gestita" })] });
  assert.equal(sentCount(done), 1 + 2 + 3);
  assert.equal(sentSummary(done), "Le tue risposte (6)");
  // La stima del tempo senza modello del valore conta come una riga; senza conferma inviata, solo le domande.
  assert.equal(sentCount(followUpView([], { kind: "referente", check: sentCheckOf(null) })), 1 + 1 + 2);
  assert.equal(sentCount(followUpView([])), 2);
  assert.equal(sentCount(view()), 0, "niente di inviato: zero");
});

test("(rilascio 10, §3.11) «Scrivi al team» con «Su cosa?»: il caso d'uso, le stime, le domande inviate; le regole del filo", () => {
  const done = followUpView([], { kind: "referente", check: sentCheckOf(BENEFITS), questions: [sentQuestion(0), sentQuestion(1, { editable: false }), question(2, { state: "gestita" })] });
  assert.deepEqual(writeTargets(done), [
    { key: "g", label: "Il caso d'uso", kinds: ["add", "doubt"] },
    { key: "b:tempo-1", label: "Controllo delle fatture", kinds: ["add", "doubt"] },
    { key: "b:qualita-1", label: "Meno errori", kinds: ["add", "doubt"] },
    // Una risposta che si modifica ancora: solo «Ho un dubbio» (un'aggiunta la chiuderebbe; «Modifica» sta nella riga).
    { key: `d:${N[0]}`, label: "Domanda 0", kinds: ["doubt"] },
    // Dopo «A posto»: «Aggiungi qualcosa» e «Ho un dubbio»; mai una domanda a cui ha pensato il team.
    { key: `d:${N[1]}`, label: "Domanda 1", kinds: ["add", "doubt"] },
  ]);
  // Una richiesta di sole domande: sul caso d'uso solo «Ho un dubbio», come prima.
  assert.deepEqual(writeTargets(followUpView([]))[0], { key: "g", label: "Il caso d'uso", kinds: ["doubt"] });
  // Il link chiuso: niente da scrivere.
  assert.deepEqual(writeTargets(followUpView([], { thread: { followUp: true, open: false, messages: [] } })), []);
  // Le stime si nominano come in «Novità»: «Sulla voce «…»».
  assert.equal(anchorLabelOf(done, { anchor: "beneficio", componentKey: "qualita-1" }), "Sulla voce «Meno errori»");
});

test("(rilascio 10, §3.11) la descrizione in 6 righe con «Leggi tutto»: al telefono e dai 640 px secondo la lunghezza", () => {
  assert.deepEqual(descriptionClamp(null), { phone: false, wide: false });
  assert.deepEqual(descriptionClamp("Le fatture arrivano per email e si registrano a mano."), { phone: false, wide: false });
  // Circa 300 caratteri: più di 6 righe al telefono (40 a riga), meno di 6 dai 640 px (72 a riga).
  const medium = "Le fatture dei fornitori arrivano per email, per PEC e a volte su carta. ".repeat(4);
  assert.deepEqual(descriptionClamp(medium), { phone: true, wide: false });
  assert.deepEqual(descriptionClamp("x".repeat(600)), { phone: true, wide: true });
  // Gli a capo contano come righe.
  assert.deepEqual(descriptionClamp(["uno", "due", "tre", "quattro", "cinque", "sei", "sette"].join("\n")), { phone: true, wide: true });
});
