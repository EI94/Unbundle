import test from "node:test";
import assert from "node:assert/strict";
import { checkReferentLink, labelOfUseCase, renderReferentEmail, type ReminderEntry } from "./email.ts";

// Le email di «Chiedi al referente», parola per parola (SPEC §7). Dati inventati.
const TOKEN = `ucq_${"A".repeat(32)}`;
const LINK = `https://app.example.test/rispondi/${TOKEN}`;
const LINK2 = `https://app.example.test/rispondi/ucq_${"B".repeat(32)}`;
const EXPIRES = new Date("2026-11-26T10:00:00Z");
const UC = { code: "TJ-0004", title: "Fatture fornitori" };
const has = (text: string, line: string) => assert.ok(text.includes(line), `manca «${line}» in:\n${text}`);

function clean(m: { subject: string; text: string; html: string }) {
  for (const part of [m.subject, m.text, m.html]) {
    assert.doesNotMatch(part, /caso d'uso|\btoken\b|\bMCP\b|\bworkflow\b/i);
    assert.doesNotMatch(part, /utm_|<img/i);
  }
  has(m.text, "Lateral Space via Unbundle.");
}

test("{UC}: codice e titolo, o il solo titolo; al massimo 120 caratteri", () => {
  assert.equal(labelOfUseCase(UC), "TJ-0004 · Fatture fornitori");
  assert.equal(labelOfUseCase({ code: null, title: "Fatture fornitori" }), "Fatture fornitori");
  assert.ok(labelOfUseCase({ code: null, title: "x".repeat(300) }).length <= 120);
});

test("richiesta: oggetto e testo, con e senza messaggio e risposta all'email", () => {
  const one = renderReferentEmail({ template: "richiesta", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", questions: 1, message: null, expiresAt: EXPIRES, link: LINK, replyToKnown: true });
  assert.equal(one.subject, "TopJet: Giulia Neri ti chiede alcune informazioni su «TJ-0004 · Fatture fornitori»");
  has(one.text, "Buongiorno,");
  has(one.text, "Giulia Neri ti chiede alcune informazioni sullo use case «TJ-0004 · Fatture fornitori» di TopJet: una domanda.");
  has(one.text, "Bastano pochi minuti e puoi rispondere anche dal telefono. Se non sai una risposta, scegli «Non lo so». Se hai un documento utile, allegalo: prima togli nomi e dati personali.");
  has(one.text, "Apri le domande");
  has(one.text, LINK);
  has(one.text, "Il link scade il 26 novembre 2026.");
  has(one.text, "Il link è personale: non inoltrarlo. Per un dubbio rispondi a questa email: arriva a Giulia Neri.");
  clean(one);
  const many = renderReferentEmail({ template: "richiesta", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", questions: 6, message: "Grazie in anticipo!", expiresAt: EXPIRES, link: LINK, replyToKnown: false });
  has(many.text, "di TopJet: 6 domande.");
  has(many.text, "Grazie in anticipo!");
  has(many.text, "Il link è personale: non inoltrarlo.");
  assert.ok(!many.text.includes("arriva a Giulia Neri"));
  clean(many);
});

function entry(over: Partial<ReminderEntry> = {}): ReminderEntry {
  return { useCase: UC, requesterName: "Giulia Neri", kind: "primo", openQuestions: 1, newQuestions: 0, expiresAt: EXPIRES, link: LINK, ...over };
}

test("promemoria con una voce: primo, manuale, ultimo, nuove", () => {
  const primo = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry()], replyToKnown: true, replyName: "Giulia Neri" });
  assert.equal(primo.subject, "Promemoria: una domanda aperta su «TJ-0004 · Fatture fornitori»");
  has(primo.text, "ti ricordiamo che Giulia Neri aspetta le tue risposte sullo use case «TJ-0004 · Fatture fornitori»: c'è ancora una domanda aperta.");
  has(primo.text, "Quello che hai già scritto è salvato: riparti da dove eri rimasto.");
  has(primo.text, "Riprendi le domande");
  has(primo.text, "Il link scade il 26 novembre 2026.");
  has(primo.text, "Il link è personale: non inoltrarlo. Per un dubbio rispondi a questa email: arriva a Giulia Neri.");
  clean(primo);
  const manuale = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry({ kind: "manuale", openQuestions: 3 })], replyToKnown: false, replyName: null });
  assert.equal(manuale.subject, "Promemoria: 3 domande aperte su «TJ-0004 · Fatture fornitori»");
  has(manuale.text, "ci sono ancora 3 domande aperte.");
  has(manuale.text, "Il link è personale: non inoltrarlo.");
  const ultimo = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry({ kind: "ultimo", openQuestions: 2 })], replyToKnown: true, replyName: "Giulia Neri" });
  assert.equal(ultimo.subject, "Ultimo promemoria: 2 domande aperte su «TJ-0004 · Fatture fornitori»");
  has(ultimo.text, "È l'ultimo promemoria che ti mandiamo. Se non hai le informazioni, scegli «Non lo so»: anche questa è una risposta utile.");
  assert.ok(!ultimo.text.includes("riparti da dove eri rimasto"));
  const nuove = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry({ kind: "nuove", newQuestions: 2, openQuestions: 4 })], replyToKnown: true, replyName: "Giulia Neri" });
  assert.equal(nuove.subject, "Nuove domande su «TJ-0004 · Fatture fornitori»");
  has(nuove.text, "Giulia Neri ha aggiunto 2 domande sullo use case «TJ-0004 · Fatture fornitori»: le trovi insieme alle altre, con lo stesso link.");
  has(nuove.text, "Apri le domande");
  const nuova = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry({ kind: "nuove", newQuestions: 1 })], replyToKnown: false, replyName: null });
  has(nuova.text, "Giulia Neri ha aggiunto una domanda sullo use case");
  for (const m of [manuale, ultimo, nuove, nuova]) clean(m);
});

test("promemoria con più voci: un blocco per use case, il suo link, chi chiede", () => {
  const two = renderReferentEmail({
    template: "promemoria",
    company: "TopJet",
    entries: [entry({ openQuestions: 2 }), entry({ useCase: { code: null, title: "Ordini clienti" }, requesterName: "Luca Verdi", kind: "ultimo", link: LINK2 })],
    replyToKnown: false,
    replyName: null,
  });
  assert.equal(two.subject, "Promemoria: domande aperte su 2 use case di TopJet");
  has(two.text, "ti ricordiamo che ci sono ancora domande aperte su 2 use case di TopJet. Quello che hai già scritto è salvato.");
  has(two.text, "«TJ-0004 · Fatture fornitori», chiede Giulia Neri: 2 domande aperte.");
  has(two.text, "«Ordini clienti», chiede Luca Verdi: una domanda aperta.");
  has(two.text, "Il link scade il 26 novembre 2026. È l'ultimo promemoria per questo use case.");
  has(two.text, LINK);
  has(two.text, LINK2);
  has(two.text, "I link sono personali: non inoltrarli.");
  assert.ok(!two.text.includes("arriva a"), "chi chiede è diverso: nessun nome per la risposta");
  clean(two);
  const same = renderReferentEmail({ template: "promemoria", company: "TopJet", entries: [entry(), entry({ kind: "nuove", newQuestions: 1, link: LINK2 })], replyToKnown: true, replyName: "Giulia Neri" });
  has(same.text, "una domanda aperta, con domande nuove.");
  has(same.text, "I link sono personali: non inoltrarli. Per un dubbio rispondi a questa email: arriva a Giulia Neri.");
});

test("conferma: grazie, quante restano, nessuna risposta nell'email", () => {
  const one = renderReferentEmail({ template: "conferma", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", submitted: 1, openQuestions: 0, expiresAt: EXPIRES });
  assert.equal(one.subject, "Grazie: risposte ricevute su «TJ-0004 · Fatture fornitori»");
  has(one.text, "grazie: abbiamo ricevuto la tua risposta sullo use case «TJ-0004 · Fatture fornitori» e l'abbiamo passata a Giulia Neri.");
  has(one.text, "In questa email non ci sono le tue risposte.");
  assert.ok(!one.text.includes("Resta"));
  const more = renderReferentEmail({ template: "conferma", company: "TopJet", useCase: UC, requesterName: "Giulia Neri", submitted: 3, openQuestions: 2, expiresAt: EXPIRES });
  has(more.text, "abbiamo ricevuto le tue risposte sullo use case «TJ-0004 · Fatture fornitori» e le abbiamo passate a Giulia Neri.");
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
