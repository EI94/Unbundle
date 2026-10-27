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
} from "./public-view-render.ts";

// Dalla vista della richiesta a quello che la pagina `/rispondi/<token>` mostra (SPEC §4.4, §P3.7).

const N = ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"];

function question(i: number, over: Partial<ReferentQuestionView> = {}): ReferentQuestionView {
  return { needId: N[i], position: i + 1, title: `Domanda ${i}`, state: "aperta", draft: null, answer: null, files: [], ...over };
}

function view(over: Partial<ReferentAskView> = {}): ReferentAskView {
  return {
    state: "aperta",
    privacy: { accepted: true, version: "ucq-2026-10-1", contact: "pierpaolo@lateralspace.ai" },
    company: "TopJet",
    useCase: { code: "TJ-0004", title: "Fatture fornitori" },
    requester: { name: "Giulia Neri" },
    message: "Ci serve per la stima di fine mese.",
    expiresOn: "2026-11-26",
    questions: [question(0), question(1)],
    upload: { clientMode: true },
    ...over,
  };
}

const file = (over: Partial<ReferentFileView> = {}): ReferentFileView => ({
  id: "f1",
  name: "preventivo.pdf",
  sizeBytes: 1200,
  status: "pulito",
  message: null,
  warning: null,
  needsConfirmation: false,
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
  assert.equal(screenOf(view({ privacy: { accepted: false, version: "ucq-2026-10-1", contact: "x@y.it" } })), "privacy");
  assert.equal(screenOf(view()), "questions");
  const p = privacyTexts(view());
  assert.equal(p.title, "Prima di iniziare");
  assert.equal(p.button, "Ho letto, iniziamo");
  assert.equal(p.summary.length, 3);
  assert.ok(p.summary[1].includes("le persone di TopJet"));
  assert.ok(p.summary[2].endsWith("fino al 26 novembre 2026."));
  assert.ok(p.paragraphs.some((t) => t.startsWith("Giulia Neri e le altre persone di TopJet")));
  assert.ok(p.paragraphs.some((t) => t.includes("pierpaolo@lateralspace.ai")));
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

test("una domanda inviata: «Inviata il 27/10», il testo o «Non lo so», i nomi dei file", () => {
  const sent = question(0, { state: "inviata", answer: { text: "Ogni giorno", dontKnow: false, submittedAt: "2026-10-27T09:00:00.000Z" }, files: [file({ submitted: true })] });
  assert.deepEqual(sentAnswerView(sent, "2026-10-28"), { sentOn: "Inviata il 27/10", text: "Ogni giorno", files: ["preventivo.pdf"] });
  const unknown = question(0, { state: "inviata", answer: { text: null, dontKnow: true, submittedAt: "2025-12-30T09:00:00.000Z" } });
  assert.deepEqual(sentAnswerView(unknown, "2026-10-28"), { sentOn: "Inviata il 30/12/2025", text: "Non lo so", files: [] });
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

test("gli stati dei file, «in revisione» e la conferma", () => {
  assert.equal(fileStateLabel(file({ status: "in_quarantena" })), "Controllo in corso…");
  assert.equal(fileStateLabel(file()), "Allegato");
  assert.equal(fileStateLabel(file({ status: "in_revisione" })), "Lo controlla il team prima di usarlo: puoi inviare lo stesso");
  assert.equal(fileStateLabel(file({ status: "rifiutato", message: "Contiene dati sanitari." })), "Non accettato: Contiene dati sanitari.");
  assert.equal(fileStateLabel(file({ status: "rifiutato", message: null })), "Non accettato");

  const warned = fileRow(file({ status: "in_revisione", warning: "testo_contatti", needsConfirmation: true }));
  assert.deepEqual(warned.confirm, { warning: REFERENT_PUBLIC_TEXT.fileWarning, keep: "Servono, lo lascio" });
  assert.equal(warned.tone, "attenzione");
  assert.equal(warned.removable, true);
  assert.equal(fileRow(file({ submitted: true })).removable, false, "un file inviato non si toglie");
  assert.equal(fileRow(file({ status: "rifiutato" })).removable, false, "un file rifiutato è già cancellato");
  assert.equal(fileRow(file({ needsConfirmation: true, submitted: true })).confirm, null);

  assert.equal(filesBlockSubmit([file()]), null);
  assert.equal(filesBlockSubmit([file({ status: "in_revisione" })]), null, "un PDF in revisione si invia lo stesso");
  assert.equal(filesBlockSubmit([file({ status: "in_quarantena" })]), "file_in_controllo");
  assert.equal(filesBlockSubmit([file({ needsConfirmation: true })]), "file_da_confermare");
  assert.equal(filesBlockSubmit([file({ needsConfirmation: true, status: "rifiutato" })]), null);

  const up = fileFromUpload({ fileId: "f9", fileName: "a.xlsx", sizeBytes: 10, status: "in_revisione", usable: true, message: "m", warning: null, needsConfirmation: false });
  assert.deepEqual(up, { id: "f9", name: "a.xlsx", sizeBytes: 10, status: "in_revisione", message: "m", warning: null, needsConfirmation: false, submitted: false });
});

test("invio: la frase con la data, il ringraziamento, le domande che restano", () => {
  assert.equal(expiryLabel("2026-11-26"), "26 novembre 2026");
  assert.equal(submitHint(view()), "Invii solo le domande a cui hai risposto. Le altre restano qui: puoi tornare con lo stesso link fino al 26 novembre 2026.");
  assert.deepEqual(thanksTexts({ submitted: 2, open: 0, state: "completata" }, view()), {
    title: "Grazie, abbiamo ricevuto le tue risposte.",
    seen: "Giulia Neri le vede subito.",
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
