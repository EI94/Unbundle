import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { UC_EMAIL_LOGO_PATH, emailBrand } from "../../uc/notify/email-render.ts";
import { checkReferentLink, labelOfUseCase, renderReferentEmail, whatIsACaseLine, type ReminderEntry } from "./email.ts";

// Le email di «Chiedi al referente», parola per parola (SPEC §7). Dati inventati. (Rilascio 5.1) Fuori
// dalla dashboard «caso d'uso», mai «use case»; l'oggetto comincia sempre con l'azienda.
const TOKEN = `ucq_${"A".repeat(32)}`;
const LINK = `https://app.example.test/rispondi/${TOKEN}`;
const LINK2 = `https://app.example.test/rispondi/ucq_${"B".repeat(32)}`;
const EXPIRES = new Date("2026-11-26T10:00:00Z");
const UC = { code: "TJ-0004", title: "Fatture fornitori" };
const has = (text: string, line: string) => assert.ok(text.includes(line), `manca «${line}» in:\n${text}`);

function clean(m: { subject: string; text: string; html: string }) {
  for (const part of [m.subject, m.text, m.html]) {
    assert.doesNotMatch(part, /\buse[\s-]*cases?\b|\btoken\b|\bMCP\b|\bworkflow\b/i);
    assert.doesNotMatch(part, /utm_/i);
  }
  assert.match(m.subject, /^TopJet: /, "l'oggetto comincia con l'azienda");
  assert.match(m.subject, /cas[oi] d'uso/, "l'oggetto nomina il caso d'uso");
  has(m.text, "Lateral Space via Unbundle.");
}

const MEANING = "Un caso d'uso è un'attività di lavoro che TopJet sta valutando di semplificare con l'intelligenza artificiale.";

test("(rilascio 5.1) che cos'è un caso d'uso, in una riga", () => {
  assert.equal(whatIsACaseLine("TopJet"), MEANING);
  assert.equal(whatIsACaseLine(""), "Un caso d'uso è un'attività di lavoro che la tua azienda sta valutando di semplificare con l'intelligenza artificiale.");
});

test("{UC}: codice e titolo, o il solo titolo; al massimo 120 caratteri", () => {
  assert.equal(labelOfUseCase(UC), "TJ-0004 · Fatture fornitori");
  assert.equal(labelOfUseCase({ code: null, title: "Fatture fornitori" }), "Fatture fornitori");
  assert.ok(labelOfUseCase({ code: null, title: "x".repeat(300) }).length <= 120);
});

test("richiesta: oggetto e testo, con e senza messaggio e risposta all'email", () => {
  const one = renderReferentEmail({ template: "richiesta", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", questions: 1, message: null, expiresAt: EXPIRES, link: LINK, replyToKnown: true });
  // (Rilascio 5, §8.4) Solo domande: l'oggetto e la prima riga non dicono più «sei il referente».
  assert.equal(one.subject, "TopJet: alcune domande sul caso d'uso «TJ-0004 · Fatture fornitori»");
  has(one.text, "Buongiorno,");
  has(one.text, "Giulia Neri ti chiede alcune informazioni sul caso d'uso «TJ-0004 · Fatture fornitori».");
  has(one.text, MEANING);
  has(one.text, "È una domanda sola.");
  has(one.text, "Bastano pochi minuti, anche dal telefono. Se un'informazione non ce l'hai, scegli «Non ce l'ho». Se hai un documento utile, allegalo.");
  assert.doesNotMatch(one.text, /dati personali|togli nomi/, "(rilascio 5.1) niente allarmi sui dati personali");
  has(one.text, "Apri le domande");
  has(one.text, LINK);
  has(one.text, "Il link scade il 26 novembre 2026.");
  has(one.text, "Il link è solo tuo: non inoltrarlo. Per un dubbio rispondi a questa email: arriva a Giulia Neri.");
  clean(one);
  const many = renderReferentEmail({ template: "richiesta", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", questions: 6, message: "Grazie in anticipo!", expiresAt: EXPIRES, link: LINK, replyToKnown: false });
  has(many.text, "Le domande sono 6.");
  has(many.text, "Grazie in anticipo!");
  has(many.text, "Il link è solo tuo: non inoltrarlo.");
  assert.ok(!many.text.includes("arriva a Giulia Neri"));
  clean(many);
});

function entry(over: Partial<ReminderEntry> = {}): ReminderEntry {
  return { useCase: UC, requesterName: "Giulia Neri", kind: "primo", openQuestions: 1, newQuestions: 0, expiresAt: EXPIRES, link: LINK, ...over };
}

test("promemoria con una voce: primo, manuale, ultimo, nuove", () => {
  const primo = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry()], replyToKnown: true, replyName: "Giulia Neri" });
  assert.equal(primo.subject, "TopJet: promemoria sul caso d'uso «TJ-0004 · Fatture fornitori»");
  has(primo.text, "ti ricordiamo che Giulia Neri aspetta le tue risposte sul caso d'uso «TJ-0004 · Fatture fornitori»: c'è ancora una domanda aperta.");
  has(primo.text, "Quello che hai già scritto è salvato: riparti da dove eri rimasto.");
  has(primo.text, "Riprendi le domande");
  has(primo.text, "Il link scade il 26 novembre 2026.");
  has(primo.text, "Il link è solo tuo: non inoltrarlo. Per un dubbio rispondi a questa email: arriva a Giulia Neri.");
  clean(primo);
  const manuale = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry({ kind: "manuale", openQuestions: 3 })], replyToKnown: false, replyName: null });
  assert.equal(manuale.subject, "TopJet: promemoria sul caso d'uso «TJ-0004 · Fatture fornitori»");
  has(manuale.text, "ci sono ancora 3 domande aperte.");
  has(manuale.text, "Il link è solo tuo: non inoltrarlo.");
  const ultimo = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry({ kind: "ultimo", openQuestions: 2 })], replyToKnown: true, replyName: "Giulia Neri" });
  assert.equal(ultimo.subject, "TopJet: ultimo promemoria sul caso d'uso «TJ-0004 · Fatture fornitori»");
  has(ultimo.text, "È l'ultimo promemoria che ti mandiamo. Se non hai le informazioni, scegli «Non ce l'ho»: anche questa è una risposta utile.");
  assert.ok(!ultimo.text.includes("riparti da dove eri rimasto"));
  const nuove = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry({ kind: "nuove", newQuestions: 2, openQuestions: 4 })], replyToKnown: true, replyName: "Giulia Neri" });
  assert.equal(nuove.subject, "TopJet: nuove domande sul caso d'uso «TJ-0004 · Fatture fornitori»");
  has(nuove.text, "Giulia Neri ha aggiunto 2 domande sul caso d'uso «TJ-0004 · Fatture fornitori»: le trovi insieme alle altre, con lo stesso link.");
  has(nuove.text, "Apri le domande");
  const nuova = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry({ kind: "nuove", newQuestions: 1 })], replyToKnown: false, replyName: null });
  has(nuova.text, "Giulia Neri ha aggiunto una domanda sul caso d'uso");
  for (const m of [manuale, ultimo, nuove, nuova]) clean(m);
});

test("promemoria con più voci: un blocco per caso d'uso, il suo link, chi chiede", () => {
  const two = renderReferentEmail({
    template: "promemoria",
    company: "TopJet",
    entries: [entry({ openQuestions: 2 }), entry({ useCase: { code: null, title: "Ordini clienti" }, requesterName: "Luca Verdi", kind: "ultimo", link: LINK2 })],
    replyToKnown: false,
    replyName: null,
  });
  assert.equal(two.subject, "TopJet: promemoria su 2 casi d'uso");
  has(two.text, "ti ricordiamo che ci sono ancora domande aperte su 2 casi d'uso di TopJet. Quello che hai già scritto è salvato.");
  has(two.text, "«TJ-0004 · Fatture fornitori», chiede Giulia Neri: 2 domande aperte.");
  has(two.text, "«Ordini clienti», chiede Luca Verdi: una domanda aperta.");
  has(two.text, "Il link scade il 26 novembre 2026. È l'ultimo promemoria per questo caso d'uso.");
  has(two.text, LINK);
  has(two.text, LINK2);
  has(two.text, "I link sono solo tuoi: non inoltrarli.");
  assert.ok(!two.text.includes("arriva a"), "chi chiede è diverso: nessun nome per la risposta");
  clean(two);
  const same = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry(), entry({ kind: "nuove", newQuestions: 1, link: LINK2 })], replyToKnown: true, replyName: "Giulia Neri" });
  has(same.text, "una domanda aperta, con domande nuove.");
  has(same.text, "I link sono solo tuoi: non inoltrarli. Per un dubbio rispondi a questa email: arriva a Giulia Neri.");
});

test("conferma: grazie, quante restano, nessuna risposta nell'email", () => {
  const one = renderReferentEmail({ template: "conferma", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", submitted: 1, openQuestions: 0, expiresAt: EXPIRES });
  assert.equal(one.subject, "TopJet: grazie per le risposte sul caso d'uso «TJ-0004 · Fatture fornitori»");
  has(one.text, "grazie: abbiamo ricevuto la tua risposta sul caso d'uso «TJ-0004 · Fatture fornitori» e l'abbiamo passata a Giulia Neri.");
  has(one.text, "In questa email non ci sono le tue risposte.");
  assert.ok(!one.text.includes("Resta"));
  const more = renderReferentEmail({ template: "conferma", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", submitted: 3, openQuestions: 2, expiresAt: EXPIRES });
  has(more.text, "abbiamo ricevuto le tue risposte sul caso d'uso «TJ-0004 · Fatture fornitori» e le abbiamo passate a Giulia Neri.");
  has(more.text, "Restano 2 domande: puoi rispondere con lo stesso link entro il 26 novembre 2026.");
  const last = renderReferentEmail({ template: "conferma", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", submitted: 1, openQuestions: 1, expiresAt: EXPIRES });
  has(last.text, "Resta una domanda: puoi rispondere con lo stesso link entro il 26 novembre 2026.");
  assert.ok(!more.html.includes("/rispondi/"), "la conferma non ha link");
  for (const m of [one, more, last]) clean(m);
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

test("(rilascio 5) richiesta al referente: le due cose, una domanda o più, «Inizia», «Non ce l'ho»", () => {
  const base = { template: "richiesta" as const, kind: "referente" as const, company: "TopJet", useCase: UC, requesterName: "Giulia Neri", message: null, expiresAt: EXPIRES, link: LINK, replyToKnown: true };
  const zero = renderReferentEmail({ ...base, questions: 0 });
  // (Rilascio 5.1) L'oggetto dice «caso d'uso», come l'ha chiesto il titolare.
  assert.equal(zero.subject, "TopJet: sei il referente per il caso d'uso «TJ-0004 · Fatture fornitori»");
  has(zero.text, "Buongiorno,");
  has(zero.text, "Giulia Neri ti ha indicato come referente per il caso d'uso «TJ-0004 · Fatture fornitori».");
  has(zero.text, MEANING);
  has(zero.text, "Ti chiediamo due cose: confermare che è descritto bene e aiutarci a stimarne l'impatto.");
  assert.ok(zero.text.indexOf(MEANING) < zero.text.indexOf("Ti chiediamo"), "prima che cos'è, poi cosa chiediamo");
  has(zero.text, "Bastano pochi minuti, anche dal telefono. Se un'informazione non ce l'hai, scegli «Non ce l'ho».");
  has(zero.text, "Inizia");
  has(zero.text, LINK);
  has(zero.text, "Il link scade il 26 novembre 2026.");
  has(zero.text, "Il link è solo tuo: non inoltrarlo. Per un dubbio rispondi a questa email: arriva a Giulia Neri.");
  assert.ok(!zero.text.includes("Apri le domande") && !zero.text.includes("Non lo so"));
  clean(zero);
  has(renderReferentEmail({ ...base, questions: 1 }).text, "Ti chiediamo di confermare che è descritto bene, di aiutarci a stimarne l'impatto e di rispondere a una domanda.");
  const many = renderReferentEmail({ ...base, questions: 5, message: "Grazie!", replyToKnown: false });
  has(many.text, "Ti chiediamo di confermare che è descritto bene, di aiutarci a stimarne l'impatto e di rispondere a 5 domande.");
  has(many.text, "Grazie!");
  has(many.text, "Il link è solo tuo: non inoltrarlo.");
  clean(many);
  // Senza `kind`, i testi del rilascio 4.
  has(renderReferentEmail({ ...base, kind: undefined, questions: 2 }).text, "Le domande sono 2.");
});

test("(rilascio 5) promemoria con la conferma da inviare: oggetto, «la tua conferma», le domande se ci sono, «Riprendi»", () => {
  const zero = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry({ openQuestions: 0, checkPending: true })], replyToKnown: true, replyName: "Giulia Neri" });
  assert.equal(zero.subject, "TopJet: promemoria sul caso d'uso «TJ-0004 · Fatture fornitori»");
  has(zero.text, "ti ricordiamo che Giulia Neri aspetta la tua conferma sul caso d'uso «TJ-0004 · Fatture fornitori».");
  has(zero.text, "Quello che hai già scritto è salvato: riparti da dove eri rimasto.");
  has(zero.text, "Riprendi");
  clean(zero);
  has(renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry({ openQuestions: 1, checkPending: true })], replyToKnown: false, replyName: null }).text, "aspetta la tua conferma sul caso d'uso «TJ-0004 · Fatture fornitori» e una risposta.");
  const last = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry({ kind: "ultimo", openQuestions: 4, checkPending: true })], replyToKnown: false, replyName: null });
  assert.equal(last.subject, "TopJet: ultimo promemoria sul caso d'uso «TJ-0004 · Fatture fornitori»");
  has(last.text, "aspetta la tua conferma sul caso d'uso «TJ-0004 · Fatture fornitori» e le risposte a 4 domande.");
  has(last.text, "È l'ultimo promemoria che ti mandiamo.");
  const multi = renderReferentEmail({
    template: "promemoria",
    company: "TopJet",
    entries: [entry({ checkPending: true, openQuestions: 2 }), entry({ link: LINK2, useCase: { code: "TJ-0005", title: "Ordini" }, checkPending: true, openQuestions: 0 })],
    replyToKnown: false,
    replyName: null,
  });
  has(multi.text, "«TJ-0004 · Fatture fornitori», chiede Giulia Neri: la conferma e 2 domande aperte.");
  has(multi.text, "«TJ-0005 · Ordini», chiede Giulia Neri: la conferma.");
  clean(multi);
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

test("(rilascio 5.1) in cima all'HTML il marchio con il testo alternativo e «Lateral Space via Unbundle»; il testo semplice non cambia", () => {
  const input = { template: "richiesta" as const, kind: "referente" as const, company: "TopJet", useCase: UC, requesterName: "Giulia Neri", questions: 2, message: null, expiresAt: EXPIRES, link: LINK, replyToKnown: true };
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
  assert.ok(body.indexOf("Lateral Space via Unbundle</td>") > body.indexOf("<img"), "accanto, il nome in testo (si legge anche senza immagini)");
  // Senza l'indirizzo pubblico: solo il nome, nessuna immagine.
  const textOnly = renderReferentEmail(input, { logoUrl: null });
  assert.doesNotMatch(textOnly.html, /<img/);
  assert.ok(textOnly.html.includes("Lateral Space via Unbundle</td>"));
  // Ogni email dell'area lo ha, quando la passa il motore.
  const brand = emailBrand("https://www.theunbundle.com");
  for (const m of [
    renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry()], replyToKnown: true, replyName: "Giulia Neri" }, brand),
    renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry(), entry({ link: LINK2 })], replyToKnown: true, replyName: "Giulia Neri" }, brand),
    renderReferentEmail({ template: "conferma", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", submitted: 1, openQuestions: 0, expiresAt: EXPIRES }, brand),
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
