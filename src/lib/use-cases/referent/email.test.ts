import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { EMAIL_BODY_MAX_WORDS, EMAIL_SUBJECT_MAX, UC_EMAIL_LOGO_PATH, emailBodyWords, emailBrand } from "../../uc/notify/email-render.ts";
import { checkReferentLink, labelOfUseCase, linkLine, renderReferentEmail, titleOfUseCase, whatIsACaseLine, type ReminderEntry } from "./email.ts";

// Le email di «Chiedi al referente», parola per parola (SPEC §7). Dati inventati. (Rilascio 5.1) Fuori
// dalla dashboard «caso d'uso», mai «use case»; l'oggetto comincia sempre con l'azienda. (Rilascio 10,
// §3.12, D6) Il modello unico: l'oggetto al massimo di 55 caratteri con il titolo e mai il codice, il corpo
// al massimo di 60 parole, il marchio una volta (niente piè di pagina), l'indirizzo in chiaro solo nel
// testo semplice, il codice in piccolo in fondo («Riferimento RD-0004»).
const TOKEN = `ucq_${"A".repeat(32)}`;
const LINK = `https://app.example.test/rispondi/${TOKEN}`;
const LINK2 = `https://app.example.test/rispondi/ucq_${"B".repeat(32)}`;
const EXPIRES = new Date("2026-11-26T10:00:00Z");
const UC = { code: "RD-0004", title: "Fatture fornitori" };
const has = (text: string, line: string) => assert.ok(text.includes(line), `manca «${line}» in:\n${text}`);
const CODE = /\b[A-Z]{2,4}-\d{4}\b/;

function clean(m: { subject: string; text: string; html: string }) {
  for (const part of [m.subject, m.text, m.html]) {
    assert.doesNotMatch(part, /\buse[\s-]*cases?\b|\btoken\b|\bMCP\b|\bworkflow\b/i);
    assert.doesNotMatch(part, /utm_/i);
    assert.doesNotMatch(part, /Non ce l'ho/, "(rilascio 10, D5) «Non lo so», mai «Non ce l'ho»");
  }
  assert.match(m.subject, /^Rondine: /, "l'oggetto comincia con l'azienda");
  assert.ok(m.subject.length <= EMAIL_SUBJECT_MAX, `oggetto di ${m.subject.length} caratteri: ${m.subject}`);
  assert.doesNotMatch(m.subject, CODE, "(D6) mai il codice nell'oggetto");
  assert.ok(!m.text.includes("Lateral Space via Unbundle"), "(rilascio 10) il marchio una volta: niente piè di pagina");
  // (Rilascio 10, §3.12) L'indirizzo in chiaro solo nel testo semplice: nell'HTML c'è solo come href del pulsante.
  for (const url of m.text.match(/https:\/\/\S+/g) ?? []) {
    assert.equal(m.html.split(url).length - 1, m.html.split(`href="${url}"`).length - 1, `l'indirizzo è solo nel pulsante: ${url}`);
  }
}

/** Un'email di un caso d'uso solo, senza il messaggio di chi chiede: al massimo 60 parole. */
function short(m: { text: string; subject: string }) {
  const words = emailBodyWords(m.text);
  assert.ok(words <= EMAIL_BODY_MAX_WORDS, `${words} parole: ${m.subject}\n${m.text}`);
}

test("(rilascio 10) che cos'è un caso d'uso, nella prima frase", () => {
  assert.equal(whatIsACaseLine("Rondine"), "un lavoro che Rondine vuole semplificare con l'AI");
  assert.equal(whatIsACaseLine(""), "un lavoro che la tua azienda vuole semplificare con l'AI");
});

test("{UC}: il titolo senza codice; il codice e il titolo restano per chi li usa; al massimo 120 caratteri", () => {
  assert.equal(titleOfUseCase(UC), "Fatture fornitori");
  assert.equal(labelOfUseCase(UC), "RD-0004 · Fatture fornitori");
  assert.equal(labelOfUseCase({ code: null, title: "Fatture fornitori" }), "Fatture fornitori");
  assert.ok(titleOfUseCase({ code: null, title: "x".repeat(300) }).length <= 120);
});

test("(rilascio 10) la riga piccola: il link è solo tuo e fino a quando vale, il dubbio con una risposta", () => {
  assert.equal(linkLine(EXPIRES, true), "Il link è solo tuo e vale fino al 26 novembre. Per un dubbio, rispondi qui.");
  assert.equal(linkLine(EXPIRES, false), "Il link è solo tuo e vale fino al 26 novembre.");
  assert.equal(linkLine(new Date("2026-12-08T10:00:00Z"), false), "Il link è solo tuo e vale fino all'8 dicembre.");
  assert.equal(linkLine(new Date("2026-12-11T10:00:00Z"), false), "Il link è solo tuo e vale fino all'11 dicembre.");
});

test("richiesta: oggetto e testo, con e senza messaggio e risposta all'email", () => {
  const one = renderReferentEmail({ template: "richiesta", company: "Rondine", useCase: UC, requesterName: "Giulia Neri", questions: 1, message: null, expiresAt: EXPIRES, link: LINK, replyToKnown: true });
  // (Rilascio 5, §8.4) Solo domande: l'oggetto e la prima riga non dicono «sei il referente».
  assert.equal(one.subject, "Rondine: una domanda su «Fatture fornitori»");
  has(one.text, "Buongiorno,");
  has(one.text, "Giulia Neri ti fa una domanda sul caso d'uso «Fatture fornitori», un lavoro che Rondine vuole semplificare con l'AI.");
  has(one.text, "Bastano pochi minuti. Se non sai, scegli «Non lo so». Se hai un documento utile, allegalo.");
  assert.doesNotMatch(one.text, /dati personali|togli nomi/, "(rilascio 5.1) niente allarmi sui dati personali");
  has(one.text, `Apri le domande: ${LINK}`);
  has(one.text, "Il link è solo tuo e vale fino al 26 novembre. Per un dubbio, rispondi qui.");
  has(one.text, "Riferimento RD-0004");
  clean(one);
  short(one);
  const many = renderReferentEmail({ template: "richiesta", company: "Rondine", useCase: UC, requesterName: "Giulia Neri", questions: 6, message: "Grazie in anticipo!", expiresAt: EXPIRES, link: LINK, replyToKnown: false });
  assert.equal(many.subject, "Rondine: 6 domande su «Fatture fornitori»");
  has(many.text, "Giulia Neri ti fa 6 domande sul caso d'uso «Fatture fornitori»");
  has(many.text, "Grazie in anticipo!");
  has(many.text, "Il link è solo tuo e vale fino al 26 novembre.");
  assert.ok(!many.text.includes("rispondi qui"));
  clean(many);
  // Senza codice, niente riga di riferimento.
  assert.ok(!renderReferentEmail({ template: "richiesta", company: "Rondine", useCase: { code: null, title: "Ordini" }, requesterName: "Giulia Neri", questions: 1, message: null, expiresAt: EXPIRES, link: LINK, replyToKnown: true }).text.includes("Riferimento"));
});

function entry(over: Partial<ReminderEntry> = {}): ReminderEntry {
  return { useCase: UC, requesterName: "Giulia Neri", kind: "primo", openQuestions: 1, newQuestions: 0, expiresAt: EXPIRES, link: LINK, ...over };
}

test("promemoria con una voce: primo, manuale, ultimo, nuove", () => {
  const primo = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry()], replyToKnown: true, replyName: "Giulia Neri" });
  assert.equal(primo.subject, "Rondine: promemoria su «Fatture fornitori»");
  has(primo.text, "ti ricordiamo che Giulia Neri aspetta le tue risposte sul caso d'uso «Fatture fornitori»: c'è ancora una domanda aperta.");
  has(primo.text, "Quello che hai già scritto è salvato: riprendi da lì.");
  has(primo.text, `Riprendi: ${LINK}`);
  has(primo.text, "Il link è solo tuo e vale fino al 26 novembre. Per un dubbio, rispondi qui.");
  clean(primo);
  short(primo);
  const manuale = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "manuale", openQuestions: 3 })], replyToKnown: false, replyName: null });
  assert.equal(manuale.subject, "Rondine: promemoria su «Fatture fornitori»");
  has(manuale.text, "ci sono ancora 3 domande aperte.");
  has(manuale.text, "Il link è solo tuo e vale fino al 26 novembre.");
  const ultimo = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "ultimo", openQuestions: 2 })], replyToKnown: true, replyName: "Giulia Neri" });
  assert.equal(ultimo.subject, "Rondine: ultimo promemoria su «Fatture fornitori»");
  // (Rilascio 10, §3.12) Un solo «Riprendi», e l'ultimo promemoria ricorda «Non lo so».
  has(ultimo.text, "È l'ultimo promemoria: se non sai qualcosa, scegli «Non lo so».");
  assert.ok(!ultimo.text.includes("riprendi da lì"));
  const nuove = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "nuove", newQuestions: 2, openQuestions: 4 })], replyToKnown: true, replyName: "Giulia Neri" });
  assert.equal(nuove.subject, "Rondine: nuove domande su «Fatture fornitori»");
  has(nuove.text, "Giulia Neri ha aggiunto 2 domande sul caso d'uso «Fatture fornitori»: le trovi insieme alle altre, con lo stesso link.");
  has(nuove.text, "Apri le domande");
  const nuova = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "nuove", newQuestions: 1 })], replyToKnown: false, replyName: null });
  has(nuova.text, "Giulia Neri ha aggiunto una domanda sul caso d'uso");
  for (const m of [manuale, ultimo, nuove, nuova]) {
    clean(m);
    short(m);
  }
  // Mai due nomi per lo stesso pulsante.
  for (const m of [primo, manuale, ultimo]) assert.ok(!m.text.includes("Riprendi le domande"), m.subject);
});

test("promemoria con più voci: un blocco per caso d'uso, il suo link, chi chiede", () => {
  const two = renderReferentEmail({
    template: "promemoria",
    company: "Rondine",
    entries: [entry({ openQuestions: 2 }), entry({ useCase: { code: null, title: "Ordini clienti" }, requesterName: "Luca Verdi", kind: "ultimo", link: LINK2 })],
    replyToKnown: false,
    replyName: null,
  });
  assert.equal(two.subject, "Rondine: promemoria su 2 casi d'uso");
  has(two.text, "ti ricordiamo che aspettiamo la tua risposta su 2 casi d'uso di Rondine. Quello che hai già scritto è salvato.");
  has(two.text, "«Fatture fornitori», chiede Giulia Neri: 2 domande aperte, entro il 26 novembre.");
  has(two.text, "«Ordini clienti», chiede Luca Verdi: una domanda aperta, entro il 26 novembre.");
  has(two.text, "È l'ultimo promemoria per questo caso d'uso.");
  has(two.text, LINK);
  has(two.text, LINK2);
  has(two.text, "I link sono solo tuoi.");
  assert.ok(!two.text.includes("rispondi qui"), "chi chiede è diverso: niente «rispondi qui»");
  clean(two);
  const same = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry(), entry({ kind: "nuove", newQuestions: 1, link: LINK2 })], replyToKnown: true, replyName: "Giulia Neri" });
  has(same.text, "una domanda aperta, con domande nuove, entro il 26 novembre.");
  has(same.text, "I link sono solo tuoi. Per un dubbio, rispondi qui.");
  // (Rilascio 10, §3.12) Un pulsante solo per voce: «Riprendi».
  assert.equal(same.text.split("Riprendi:").length - 1, 2);
});

test("conferma: grazie, quante restano, niente frase difensiva", () => {
  const one = renderReferentEmail({ template: "conferma", company: "Rondine", useCase: UC, requesterName: "Giulia Neri", submitted: 1, openQuestions: 0, expiresAt: EXPIRES });
  assert.equal(one.subject, "Rondine: grazie per «Fatture fornitori»");
  has(one.text, "grazie: abbiamo ricevuto la tua risposta sul caso d'uso «Fatture fornitori» e l'abbiamo passata a Giulia Neri.");
  // (Rilascio 10, §3.12) Via «In questa email non ci sono le tue risposte.».
  assert.ok(!one.text.includes("In questa email"));
  assert.ok(!one.text.includes("Resta"));
  const more = renderReferentEmail({ template: "conferma", company: "Rondine", useCase: UC, requesterName: "Giulia Neri", submitted: 3, openQuestions: 2, expiresAt: EXPIRES });
  has(more.text, "abbiamo ricevuto le tue risposte sul caso d'uso «Fatture fornitori» e le abbiamo passate a Giulia Neri.");
  has(more.text, "Restano 2 domande: puoi rispondere con lo stesso link entro il 26 novembre.");
  const last = renderReferentEmail({ template: "conferma", company: "Rondine", useCase: UC, requesterName: "Giulia Neri", submitted: 1, openQuestions: 1, expiresAt: EXPIRES });
  has(last.text, "Resta una domanda: puoi rispondere con lo stesso link entro il 26 novembre.");
  assert.ok(!more.html.includes("/rispondi/"), "la conferma non ha link");
  for (const m of [one, more, last]) {
    clean(m);
    short(m);
  }
});

test("il link: https (http solo in locale), nessun parametro o frammento, solo /rispondi/ucq_…", () => {
  assert.equal(checkReferentLink(LINK), LINK);
  assert.equal(checkReferentLink(`http://localhost:3000/rispondi/${TOKEN}`), `http://localhost:3000/rispondi/${TOKEN}`);
  for (const bad of [
    `http://app.example.test/rispondi/${TOKEN}`,
    `${LINK}?utm_source=x`,
    `${LINK}#x`,
    `https://u:p@app.example.test/rispondi/${TOKEN}`,
    `https://app.example.test/r/${TOKEN}`,
    `https://app.example.test/rispondi/ucr_${"A".repeat(32)}`,
    "non un link",
  ]) {
    assert.throws(() => checkReferentLink(bad), bad);
  }
});

test("(rilascio 5; rilascio 10, §9.9) richiesta al referente: «conferma», le stime, una domanda o più, «Inizia», «Non lo so»", () => {
  const base = { template: "richiesta" as const, kind: "referente" as const, company: "Rondine", useCase: UC, requesterName: "Giulia Neri", message: null, expiresAt: EXPIRES, link: LINK, replyToKnown: true };
  const zero = renderReferentEmail({ ...base, questions: 0 });
  // (Rilascio 10, §9.9, D6) L'oggetto del prototipo: il cliente, «conferma», il titolo; mai il codice.
  assert.equal(zero.subject, "Rondine: conferma «Fatture fornitori»");
  assert.equal(
    zero.text,
    [
      "Buongiorno,",
      "Giulia Neri ti ha indicato come referente del caso d'uso «Fatture fornitori», un lavoro che Rondine vuole semplificare con l'AI.",
      "Bastano pochi minuti: confermi la descrizione e alcune stime. Se non sai, scegli «Non lo so».",
      `Inizia: ${LINK}`,
      "Il link è solo tuo e vale fino al 26 novembre. Per un dubbio, rispondi qui.",
      "Riferimento RD-0004",
    ].join("\n\n") + "\n",
  );
  assert.ok(!zero.text.includes("Apri le domande"));
  clean(zero);
  short(zero);
  has(renderReferentEmail({ ...base, questions: 1 }).text, "Bastano pochi minuti: confermi la descrizione, alcune stime e una domanda.");
  const many = renderReferentEmail({ ...base, questions: 5, message: "Grazie!", replyToKnown: false });
  has(many.text, "Bastano pochi minuti: confermi la descrizione, alcune stime e 5 domande.");
  has(many.text, "Grazie!");
  has(many.text, "Il link è solo tuo e vale fino al 26 novembre.");
  clean(many);
  short(renderReferentEmail({ ...base, questions: 5 }));
  // Senza `kind`, la richiesta di sole domande.
  has(renderReferentEmail({ ...base, kind: undefined, questions: 2 }).text, "Giulia Neri ti fa 2 domande sul caso d'uso «Fatture fornitori»");
});

test("(rilascio 5) promemoria con la conferma da inviare: oggetto, «la tua conferma», le domande se ci sono, «Riprendi»", () => {
  const zero = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ openQuestions: 0, checkPending: true })], replyToKnown: true, replyName: "Giulia Neri" });
  assert.equal(zero.subject, "Rondine: promemoria su «Fatture fornitori»");
  has(zero.text, "ti ricordiamo che Giulia Neri aspetta la tua conferma sul caso d'uso «Fatture fornitori».");
  has(zero.text, "Quello che hai già scritto è salvato: riprendi da lì.");
  has(zero.text, "Riprendi");
  clean(zero);
  short(zero);
  has(renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ openQuestions: 1, checkPending: true })], replyToKnown: false, replyName: null }).text, "aspetta la tua conferma sul caso d'uso «Fatture fornitori» e una risposta.");
  const last = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "ultimo", openQuestions: 4, checkPending: true })], replyToKnown: false, replyName: null });
  assert.equal(last.subject, "Rondine: ultimo promemoria su «Fatture fornitori»");
  has(last.text, "aspetta la tua conferma sul caso d'uso «Fatture fornitori» e le risposte a 4 domande.");
  has(last.text, "È l'ultimo promemoria: se non sai qualcosa, scegli «Non lo so».");
  const multi = renderReferentEmail({
    template: "promemoria",
    company: "Rondine",
    entries: [entry({ checkPending: true, openQuestions: 2 }), entry({ link: LINK2, useCase: { code: "RD-0005", title: "Ordini" }, checkPending: true, openQuestions: 0 })],
    replyToKnown: false,
    replyName: null,
  });
  has(multi.text, "«Fatture fornitori», chiede Giulia Neri: la tua conferma e 2 domande aperte, entro il 26 novembre.");
  has(multi.text, "«Ordini», chiede Giulia Neri: la tua conferma, entro il 26 novembre.");
  // (Rilascio 5.1) Mai «domande aperte» né «Apri le domande» per una voce che aspetta solo la conferma: «Riprendi».
  has(multi.text, "ti ricordiamo che aspettiamo la tua risposta su 2 casi d'uso di Rondine.");
  assert.ok(!multi.text.includes("Apri le domande"), multi.text);
  assert.equal(multi.text.split("Riprendi").length - 1, 2);
  clean(multi);
  // (Rilascio 10, §3.12) Un solo pulsante, «Riprendi», anche per una voce con le sole domande.
  const mixed = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ openQuestions: 2 }), entry({ link: LINK2, checkPending: true, openQuestions: 0 })], replyToKnown: false, replyName: null });
  assert.equal([mixed.text.split("Apri le domande").length - 1, mixed.text.split("Riprendi").length - 1].join(","), "0,2");
});

// ─── Rilascio 5.1: il marchio in cima alle email ─────────────────────

test("(rilascio 5.1) il marchio: un indirizzo assoluto https del sito (http solo in locale), mai con parametri", () => {
  assert.deepEqual(emailBrand("https://www.theunbundle.com"), { logoUrl: "https://www.theunbundle.com/email/unbundle-u.png" });
  assert.deepEqual(emailBrand("https://www.theunbundle.com/"), { logoUrl: "https://www.theunbundle.com/email/unbundle-u.png" });
  assert.deepEqual(emailBrand("http://127.0.0.1:53915"), { logoUrl: "http://127.0.0.1:53915/email/unbundle-u.png" });
  for (const bad of [null, undefined, "", "http://www.theunbundle.com", "https://u:p@www.theunbundle.com", "non un indirizzo", "ftp://x.test"]) {
    assert.deepEqual(emailBrand(bad), { logoUrl: null }, String(bad));
  }
  assert.equal(UC_EMAIL_LOGO_PATH, "/email/unbundle-u.png");
});

test("(rilascio 5.1; rilascio 10, §3.12) in cima all'HTML il marchio con il testo alternativo e «Unbundle»; il testo semplice non cambia", () => {
  const input = { template: "richiesta" as const, kind: "referente" as const, company: "Rondine", useCase: UC, requesterName: "Giulia Neri", questions: 2, message: null, expiresAt: EXPIRES, link: LINK, replyToKnown: true };
  const plain = renderReferentEmail(input);
  const branded = renderReferentEmail(input, emailBrand("https://www.theunbundle.com"));
  assert.equal(branded.subject, plain.subject);
  assert.equal(branded.text, plain.text, "il testo semplice è lo stesso");
  const imgs = branded.html.match(/<img\b[^>]*>/g) ?? [];
  assert.equal(imgs.length, 1, "un'immagine sola");
  assert.match(imgs[0], /src="https:\/\/www\.theunbundle\.com\/email\/unbundle-u\.png"/);
  assert.match(imgs[0], /width="32" height="32"/);
  assert.match(imgs[0], /alt="Unbundle"/);
  assert.doesNotMatch(imgs[0], /\?|utm_/, "nessun parametro: non traccia chi apre");
  const body = branded.html.slice(branded.html.indexOf("<body"));
  assert.ok(body.indexOf("<img") < body.indexOf("Buongiorno,"), "il marchio sta in cima");
  assert.ok(body.indexOf("Unbundle</td>") > body.indexOf("<img"), "accanto, il nome in testo (si legge anche senza immagini)");
  // (Rilascio 10, §3.12) Il marchio una volta: nessun piè di pagina «Lateral Space via Unbundle.».
  assert.ok(!branded.html.includes("Lateral Space via Unbundle"), "niente piè di pagina con il marchio");
  // Senza l'indirizzo pubblico: solo il nome, nessuna immagine.
  const textOnly = renderReferentEmail(input, { logoUrl: null });
  assert.doesNotMatch(textOnly.html, /<img/);
  assert.ok(textOnly.html.includes(">Unbundle</td>"));
  // Ogni email dell'area lo ha, quando la passa il motore.
  const brand = emailBrand("https://www.theunbundle.com");
  for (const m of [
    renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry()], replyToKnown: true, replyName: "Giulia Neri" }, brand),
    renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry(), entry({ link: LINK2 })], replyToKnown: true, replyName: "Giulia Neri" }, brand),
    renderReferentEmail({ template: "conferma", company: "Rondine", useCase: UC, requesterName: "Giulia Neri", submitted: 1, openQuestions: 0, expiresAt: EXPIRES }, brand),
  ]) {
    assert.equal((m.html.match(/<img\b/g) ?? []).length, 1, m.subject);
  }
});

test("(rilascio 5.1) il file del marchio c'è in public/: un PNG 96×96, lo stesso che rifà lo script", () => {
  const png = readFileSync(new URL("../../../../public/email/unbundle-u.png", import.meta.url));
  assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], "firma PNG");
  assert.equal(png.readUInt32BE(16), 96, "larghezza");
  assert.equal(png.readUInt32BE(20), 96, "altezza");
  assert.ok(png.length < 10_000, "leggero");
});

test("(rilascio 6) le novità del filo nell'email al referente: un chiarimento, una risposta del team, più novità; mai il testo dei messaggi", () => {
  const clarification = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "nuove", newQuestions: 1, clarifications: 1, openQuestions: 1 })], replyToKnown: true, replyName: "Giulia Neri" });
  clean(clarification);
  assert.equal(clarification.subject, "Rondine: un chiarimento su «Fatture fornitori»");
  has(clarification.text, "Il team ti chiede un chiarimento sul caso d'uso «Fatture fornitori»: lo trovi con lo stesso link.");
  short(clarification);
  has(clarification.text, "Rispondi");
  const reply = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "nuove", newQuestions: 1, replies: 1, openQuestions: 0 })], replyToKnown: false, replyName: null });
  clean(reply);
  assert.equal(reply.subject, "Rondine: una risposta su «Fatture fornitori»");
  has(reply.text, "Il team ha risposto al tuo dubbio sul caso d'uso «Fatture fornitori»: trovi la risposta con lo stesso link.");
  has(reply.text, "Leggi la risposta");
  const mixed = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "nuove", newQuestions: 3, clarifications: 1, replies: 1 })], replyToKnown: true, replyName: "Giulia Neri" });
  clean(mixed);
  assert.equal(mixed.subject, "Rondine: 3 novità su «Fatture fornitori»");
  has(mixed.text, "Hai 3 novità sul caso d'uso «Fatture fornitori»: le trovi con lo stesso link.");
  // Le domande nuove senza novità del filo: il testo del rilascio 5.1.
  const plain = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "nuove", newQuestions: 2, clarifications: 0, replies: 0 })], replyToKnown: true, replyName: "Giulia Neri" });
  assert.match(plain.subject, /nuove domande su «Fatture fornitori»/);
  // Più casi d'uso: la voce dice «con novità per te».
  const two = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry(), entry({ kind: "nuove", newQuestions: 1, clarifications: 1, link: LINK2 })], replyToKnown: true, replyName: "Giulia Neri" });
  clean(two);
  has(two.text, ", con novità per te, entro il 26 novembre.");
});

test("(rilascio 6) un'email con più novità dice quante nell'oggetto; i promemoria dopo un chiarimento ne parlano, mai «0 domande aperte»", () => {
  const two = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "nuove", newQuestions: 2, clarifications: 1, openQuestions: 1, openClarifications: 1 })], replyToKnown: true, replyName: "Giulia Neri" });
  clean(two);
  assert.equal(two.subject, "Rondine: 2 novità su «Fatture fornitori»");
  has(two.text, "Hai 2 novità sul caso d'uso «Fatture fornitori»: le trovi con lo stesso link.");
  has(two.text, "Apri le novità");
  // Il primo promemoria su una richiesta riaperta per un chiarimento.
  const only = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "primo", openQuestions: 0, openClarifications: 1 })], replyToKnown: true, replyName: "Giulia Neri" });
  clean(only);
  assert.equal(only.subject, "Rondine: promemoria su «Fatture fornitori»");
  has(only.text, "ti ricordiamo che Giulia Neri aspetta la tua risposta a un chiarimento sul caso d'uso «Fatture fornitori».");
  has(only.text, "Riprendi");
  assert.doesNotMatch(only.text, /domande aperte/);
  const both = renderReferentEmail({ template: "promemoria", company: "Rondine", entries: [entry({ kind: "ultimo", openQuestions: 2, openClarifications: 3 })], replyToKnown: false, replyName: null });
  clean(both);
  has(both.text, "ti ricordiamo che Giulia Neri aspetta le tue risposte sul caso d'uso «Fatture fornitori»: ci sono ancora 2 domande aperte, e 3 chiarimenti.");
  has(both.text, "È l'ultimo promemoria: se non sai qualcosa, scegli «Non lo so».");
  // Più casi d'uso: la voce dice il chiarimento; una risposta del team da leggere dice «novità per te».
  const many = renderReferentEmail({
    template: "promemoria",
    company: "Rondine",
    entries: [entry({ kind: "primo", openQuestions: 0, openClarifications: 1 }), entry({ kind: "nuove", newQuestions: 1, replies: 1, openQuestions: 0, link: LINK2, useCase: { code: "RD-0005", title: "Ordini" } })],
    replyToKnown: true,
    replyName: "Giulia Neri",
  });
  clean(many);
  has(many.text, "«Fatture fornitori», chiede Giulia Neri: un chiarimento, entro il 26 novembre.");
  has(many.text, "«Ordini», da Giulia Neri: novità per te, entro il 26 novembre.");
  assert.doesNotMatch(many.text, /0 domande/);
});
