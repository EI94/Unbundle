import test from "node:test";
import assert from "node:assert/strict";
import type { ReferentAskView, ReferentFileView, ReferentQuestionView } from "../../../lib/use-cases/referent/contract.ts";
import { REFERENT_PUBLIC_TEXT } from "../../../lib/use-cases/referent/labels.ts";
import {
  attachHelp,
  counterLabel,
  expiryLabel,
  fileFromUpload,
  fileRow,
  fileStateLabel,
  filesBlockSubmit,
  finalCardText,
  handledText,
  headerTexts,
  issuesByQuestion,
  privacyTexts,
  questionSections,
  screenOf,
  sentAnswerView,
  stateCardKindOf,
  stateCardText,
  submitHint,
  thanksTexts,
  closeHint,
  commentOffered,
  doneCountText,
  lastSentOn,
  missingText,
  questionClosed,
  questionsHeading,
  savesItselfText,
  sentCheckLines,
  usableFile,
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
    company: "TopJet",
    useCase: { code: "TJ-0004", title: "Fatture fornitori" },
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

test("le schede dei link che non si possono usare", () => {
  assert.equal(stateCardKindOf("non_valido"), "invalid");
  assert.equal(stateCardKindOf("revocato"), "revoked");
  assert.equal(stateCardKindOf("scaduto"), "expired");
  assert.equal(stateCardKindOf("non_disponibile"), "unavailable");
  assert.deepEqual(stateCardText("invalid"), { title: "Link non valido", text: "Questo link non è più valido. Chiedi a chi te l'ha mandato un link nuovo." });
  assert.equal(stateCardText("revoked").title, "Link revocato");
  assert.equal(stateCardText("expired").title, "Link scaduto");
  assert.equal(stateCardText("unavailable").title, "Non disponibile");
});

test("intestazione: azienda, «CODICE · Titolo», chi chiede e il suo messaggio", () => {
  const h = headerTexts(view());
  assert.deepEqual(h, {
    company: "TopJet",
    title: "TJ-0004 · Fatture fornitori",
    requestedBy: "Giulia Neri ti chiede alcune informazioni.",
    message: { title: "Il messaggio di Giulia Neri", text: "Ci serve per la stima di fine mese." },
  });
  const plain = headerTexts(view({ useCase: { code: null, title: "Fatture" }, message: "   ", company: "" }));
  assert.equal(plain.title, "Fatture");
  assert.equal(plain.message, null);
  assert.equal(plain.company, "la tua azienda");
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
  assert.ok(p.summary[0].includes("di TopJet"));
  assert.ok(p.summary[1].endsWith("fino al 26 novembre 2026."));
  assert.ok([p.lead, ...p.summary].every((t) => !/blocc|dati personali|sanitar|nomi|email|telefon/i.test(t)), "niente allarmi sopra");
  assert.equal(p.fullTextLabel, "Leggi l'informativa completa");
  // L'informativa completa resta intera: chi, cosa, chi vede, controllo dei file, quanto, diritti, Garante.
  assert.ok(p.paragraphs.some((t) => t.startsWith("Lateral Space raccoglie queste informazioni per conto di TopJet")));
  assert.ok(p.paragraphs.some((t) => t.startsWith("Giulia Neri e le altre persone di TopJet")));
  assert.ok(p.paragraphs.some((t) => t.includes("controllo automatico")));
  assert.ok(p.paragraphs.some((t) => t.includes("12 mesi")));
  assert.ok(p.paragraphs.some((t) => t.includes("Garante per la protezione dei dati personali")));
  assert.ok(p.paragraphs.some((t) => t.includes("pierpaolo@lateralspace.ai")));
  assert.ok(p.paragraphs.some((t) => t.includes("nomi, email o telefoni") && t.includes("li usiamo solo per questo")));
  assert.ok(!p.paragraphs.some((t) => /il sistema li blocca|blocca/i.test(t)), "il sistema non blocca più nomi, email e telefoni");
  assert.ok(![...p.summary, ...p.paragraphs].some((t) => /\{[A-Za-z]+\}/.test(t)), "nessun segnaposto vuoto");
});

test("«Domanda n di m» in ordine di posizione, e la fine", () => {
  const sections = questionSections(view({ questions: [question(1, { position: 5 }), question(0, { position: 2 })] }));
  assert.deepEqual(
    sections.map((s) => [s.needId, s.label]),
    [
      [N[0], "Domanda 1 di 2"],
      [N[1], "Domanda 2 di 2"],
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
  assert.deepEqual(sentAnswerView(unknown, "2026-10-28"), { sentOn: "Inviata il 30/12/2025", text: "Non ce l'ho", files: [] });
  assert.equal(sentAnswerView(question(0), "2026-10-28"), null);
});

test("(Parte 3) una domanda «gestita»: solo il titolo e «Non serve più: ci ha già pensato il team.»", () => {
  const handled = question(1, { state: "gestita" });
  const sections = questionSections(view({ questions: [question(0), handled] }));
  assert.equal(sections[1].kind, "gestita");
  assert.equal(sections[1].label, "Domanda 2 di 2", "conta come le altre");
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

test("la riga d'aiuto dei file: 20 MB con il caricamento diretto, 4 MB senza", () => {
  assert.equal(attachHelp(true), "PDF, Word, Excel, PowerPoint, CSV o testo. Fino a 20 MB. Niente foto.");
  assert.equal(attachHelp(false), "PDF, Word, Excel, PowerPoint, CSV o testo. Fino a 4 MB. Niente foto.");
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
  assert.equal(submitHint(view()), "Invii solo le domande a cui hai risposto. Le altre restano qui: puoi tornare con lo stesso link fino al 26 novembre 2026.");
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
  const leaky = { ...view(), proposedBy: "proponente@topjet.it", reviewNotes: "NOTA-RISERVATA", valueEurYear: 98765 } as ReferentAskView;
  const shown = JSON.stringify([headerTexts(leaky), privacyTexts(leaky), questionSections(leaky).map((s) => [s.label, s.title]), submitHint(leaky)]);
  for (const secret of ["proponente@topjet.it", "NOTA-RISERVATA", "98765"]) assert.ok(!shown.includes(secret), secret);
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
  assert.equal(questionsHeading(1), "Una domanda");
  assert.equal(questionsHeading(5), "5 domande");
  assert.equal(doneCountText(3, 5), "3 di 5 fatte");
  assert.equal(missingText([4]), "Manca ancora la domanda 4.");
  assert.equal(missingText([6, 2, 4]), "Mancano ancora le domande 2, 4 e 6.");
  assert.equal(missingText([2, 3]), "Mancano ancora le domande 2 e 3.");
  assert.equal(closeHint(false), "Per chiudere: rispondi, allega un file o scegli «Non ce l'ho».");
  assert.equal(closeHint(true), "Per chiudere: allega il file o scegli «Non ce l'ho».");
  assert.equal(savesItselfText(view()), "Si salva da solo: puoi tornare fino al 26 novembre 2026.");
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
