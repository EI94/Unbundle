import test from "node:test";
import assert from "node:assert/strict";
import { renderReadyAlert, renderSuppliersAlert } from "../../use-cases/case-alerts/email.ts";
import { renderRequesterAlert } from "../../use-cases/referent/alerts.ts";
import { renderReferentEmail, type ReminderEntry } from "../../use-cases/referent/email.ts";
import { findHubForbidden } from "../../use-cases/copy-guard.ts";
import { EMAIL_BODY_MAX_WORDS, EMAIL_SUBJECT_MAX, emailBodyWords, emailBrand, emailSubject, type RenderedEmail } from "./email-render.ts";
import { renderEmail, type EmailInput } from "./email-templates.ts";

// (Rilascio 10, §3.12, D6) Il modello unico delle email, su tutti i modelli: l'oggetto al massimo di 55
// caratteri, «{Cliente}: {cosa} «{Titolo}»» e mai il codice; il corpo di un caso d'uso solo al massimo di
// 60 parole (senza il messaggio di chi chiede); il marchio una volta (mittente e intestazione, niente piè
// di pagina); l'indirizzo in chiaro solo nel testo semplice. Dati inventati, codici XX-00NN.

const WS = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const CASE_ID = "16fd2706-8baf-433b-82eb-8c7fada847da";
const UC_ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const ORIGIN = "https://app.example.test";
const RISPONDI = `${ORIGIN}/rispondi/ucq_${"A".repeat(32)}`;
const R = `${ORIGIN}/r/ucr_${"A".repeat(32)}`;
const PROJECT = `${ORIGIN}/dashboard/${WS}/casi-duso/${CASE_ID}/progetto`;
const EXPIRES = new Date("2026-12-08T10:00:00Z");
const UC = { code: "XX-0024", title: "Preventivi ai clienti" };
const LONG = { code: "XX-0025", title: "Riconciliazione degli incassi con l'estratto conto della banca" };
const CODE = /\bXX-\d{4}\b/;

const entry = (over: Partial<ReminderEntry> = {}): ReminderEntry => ({
  useCase: UC,
  requesterName: "Giulia Neri",
  kind: "primo",
  openQuestions: 2,
  newQuestions: 0,
  expiresAt: EXPIRES,
  link: RISPONDI,
  ...over,
});

const caseRef = { clientName: "Cliente Demo", caseTitle: "Smistamento delle richieste" };

/** Ogni modello, con un caso d'uso solo e senza il messaggio di chi chiede. */
function singleCaseEmails(): Array<[string, RenderedEmail]> {
  const brand = emailBrand(ORIGIN);
  const referent = (label: string, m: RenderedEmail): [string, RenderedEmail] => [label, m];
  const dossier: EmailInput[] = [
    { ...caseRef, template: "richiesta_inviata", questions: 5, minutes: 12, expiresAt: EXPIRES, link: R },
    { ...caseRef, template: "promemoria_1", questions: 3, minutes: 7, expiresAt: EXPIRES, link: R },
    { ...caseRef, template: "promemoria_2", questions: 3, minutes: 7, expiresAt: EXPIRES, link: R },
    { ...caseRef, template: "segnalazione_owner", roleLabel: "Commerciale", items: [{ key: "q.esempio.01", title: "Volumi" }] },
    { ...caseRef, template: "chiarimento", itemTitle: "Volumi del mese", expiresAt: EXPIRES, link: R },
    { ...caseRef, template: "delega", audience: "collega", fromRoleLabel: "Operativo", questions: 2, minutes: 4, expiresAt: EXPIRES, link: R },
    { ...caseRef, template: "delega", audience: "delegante", questions: 2 },
    { ...caseRef, template: "richiesta_approvazione", designation: "privacy", pending: 1, expiresAt: EXPIRES, link: R },
    { template: "riepilogo_settimanale", audience: "owner", clientName: "Cliente Demo", week: "2026-W47", cases: [{ code: "XX-0012", title: "Smistamento delle richieste", total: 40, counts: {}, greenPct: 45, g1: null, nextMilestone: { title: "Via allo sviluppo", label: "12 dicembre", isProposal: false, toConfirm: false } }] },
    { ...caseRef, template: "progetto_da_approvare", version: 2, link: PROJECT, tools: 1 },
    { ...caseRef, template: "strumento_da_approvare", version: 2, link: PROJECT },
    { ...caseRef, template: "pacchetto_aggiornato", version: 3, link: PROJECT },
    { ...caseRef, template: "modifica_richiesta", version: 2, link: PROJECT },
    { ...caseRef, template: "domanda_proposta", version: null, link: `${ORIGIN}/dashboard/${WS}/use-cases/${UC_ID}/proposte` },
    { ...caseRef, template: "compito_chiesto", ref: "T-3", link: PROJECT },
    { ...caseRef, template: "compito_passato", ref: "T-3", link: PROJECT },
    { ...caseRef, template: "compito_fermo", ref: "T-3", link: PROJECT },
    { ...caseRef, template: "compito_fermo", ref: "T-3", link: PROJECT, responsabile: true },
    { ...caseRef, template: "compiti_pronti", ref: null, link: PROJECT },
    { ...caseRef, template: "pr_da_rivedere", ref: "T-3", repo: "Esempio/agente-prova", pr: 12, link: PROJECT },
    { ...caseRef, template: "compito_proposto", link: PROJECT },
    { ...caseRef, template: "banco_consiglio", role: "lettura", model: "Claude Haiku 5.5", link: PROJECT },
    { ...caseRef, template: "evals_in_calo", alert: "in_calo", quality: "91%", drop: 0.064, link: PROJECT },
    { template: "cli_collegata", clientName: "Cliente Demo", connectedAt: new Date("2026-11-11T09:30:00Z"), expiresAt: new Date("2027-02-08T09:30:00Z"), link: `${ORIGIN}/dashboard/${WS}/settings` },
    { template: "team_aggiunto", clientName: "Cliente Demo", cases: 3, link: `${ORIGIN}/dashboard/${WS}/agent-factory` },
    { template: "team_tolto", clientName: "Cliente Demo" },
  ];
  return [
    referent("richiesta al referente", renderReferentEmail({ template: "richiesta", kind: "referente", company: "Cliente Demo", useCase: UC, requesterName: "Giulia Neri", questions: 5, message: null, expiresAt: EXPIRES, link: RISPONDI, replyToKnown: true }, brand)),
    referent("domande", renderReferentEmail({ template: "richiesta", company: "Cliente Demo", useCase: UC, requesterName: "Giulia Neri", questions: 3, message: null, expiresAt: EXPIRES, link: RISPONDI, replyToKnown: true }, brand)),
    referent("promemoria", renderReferentEmail({ template: "promemoria", company: "Cliente Demo", entries: [entry()], replyToKnown: true, replyName: "Giulia Neri" }, brand)),
    referent("ultimo promemoria", renderReferentEmail({ template: "promemoria", company: "Cliente Demo", entries: [entry({ kind: "ultimo" })], replyToKnown: true, replyName: "Giulia Neri" }, brand)),
    referent("conferma da inviare", renderReferentEmail({ template: "promemoria", company: "Cliente Demo", entries: [entry({ checkPending: true })], replyToKnown: true, replyName: "Giulia Neri" }, brand)),
    referent("nuove domande", renderReferentEmail({ template: "promemoria", company: "Cliente Demo", entries: [entry({ kind: "nuove", newQuestions: 2 })], replyToKnown: true, replyName: "Giulia Neri" }, brand)),
    referent("chiarimento", renderReferentEmail({ template: "promemoria", company: "Cliente Demo", entries: [entry({ kind: "nuove", newQuestions: 1, clarifications: 1 })], replyToKnown: true, replyName: "Giulia Neri" }, brand)),
    referent("conferma", renderReferentEmail({ template: "conferma", company: "Cliente Demo", useCase: UC, requesterName: "Giulia Neri", submitted: 3, openQuestions: 1, expiresAt: EXPIRES }, brand)),
    referent("avviso a chi ha chiesto", renderRequesterAlert({ company: "Cliente Demo", entries: [{ useCase: UC, answers: 2, unknowns: 1, documents: 1, followUp: null, link: `${ORIGIN}/dashboard/${WS}/use-cases/${UC_ID}?capitolo=cosa-serve` }] }, brand)),
    referent("pronto da avviare", renderReadyAlert({ company: "Cliente Demo", entries: [{ useCase: UC, quarter: "2027-Q1", link: `${ORIGIN}/dashboard/${WS}/use-cases/${UC_ID}?capitolo=realizzazione` }] }, brand)),
    referent("fornitori", renderSuppliersAlert({ company: "Cliente Demo", link: `${ORIGIN}/dashboard/${WS}/settings#sub-responsabili` }, brand)),
    ...dossier.map((input): [string, RenderedEmail] => [input.template, renderEmail(input, brand)]),
  ];
}

test("(rilascio 10, §3.12) ogni oggetto: al massimo 55 caratteri, comincia con il cliente, mai il codice", () => {
  const emails = singleCaseEmails();
  assert.ok(emails.length >= 35, `${emails.length} email`);
  for (const [label, m] of emails) {
    assert.ok(m.subject.length <= EMAIL_SUBJECT_MAX, `${label}: ${m.subject.length} caratteri, «${m.subject}»`);
    assert.doesNotMatch(m.subject, CODE, `${label}: il codice nell'oggetto`);
    assert.doesNotMatch(m.subject, /[\r\n]/, label);
    assert.match(m.subject, /^(Cliente Demo: |Riepilogo dei casi d'uso: )/, `${label}: «${m.subject}»`);
  }
});

test("(rilascio 10, §3.12) ogni corpo di un caso d'uso solo: al massimo 60 parole", () => {
  for (const [label, m] of singleCaseEmails()) {
    const words = emailBodyWords(m.text);
    assert.ok(words <= EMAIL_BODY_MAX_WORDS, `${label}: ${words} parole\n${m.text}`);
  }
});

test("(rilascio 10, §3.12) il marchio una volta: l'intestazione in cima, niente piè di pagina; l'indirizzo in chiaro solo nel testo semplice", () => {
  for (const [label, m] of singleCaseEmails()) {
    assert.ok(!m.text.includes("Lateral Space via Unbundle") && !m.html.includes("Lateral Space via Unbundle"), `${label}: il piè di pagina con il marchio`);
    assert.equal((m.html.match(/<img\b/g) ?? []).length, 1, `${label}: un marchio solo, in cima`);
    assert.ok(m.html.indexOf("<img") < m.html.indexOf("Buongiorno,"), label);
    // Ogni indirizzo del testo semplice nell'HTML sta solo nel pulsante (href), mai in chiaro.
    for (const url of m.text.match(/https?:\/\/\S+/g) ?? []) {
      assert.equal(m.html.split(url).length - 1, m.html.split(`href="${url}"`).length - 1, `${label}: ${url} in chiaro nell'HTML`);
    }
  }
});

test("(rilascio 10, §4.2) fuori dalla dashboard: mai «use case» né le parole vietate; «Non lo so», mai «Non ce l'ho»", () => {
  for (const [label, m] of singleCaseEmails()) {
    // I comandi tra « » per chi costruisce («unbundle login») sono nomi di comandi, non parole del testo.
    const text = `${m.subject}\n${m.text}`.replace(/https?:\/\/\S+/g, "").replace(/«(?:unbundle|npm run) [^»]*»/g, "«…»");
    assert.deepEqual(findHubForbidden(text, "esterno"), [], label);
    assert.doesNotMatch(text, /Non ce l'ho|non sa rispondere|In questa email non ci sono|\bk\d\b/, label);
  }
});

test("(rilascio 10, §3.12) l'oggetto: il titolo per ultimo, accorciato con «…»; poi il nome del cliente, mai sotto 16 caratteri", () => {
  assert.equal(emailSubject("Cliente Demo", "conferma", "Preventivi ai clienti"), "Cliente Demo: conferma «Preventivi ai clienti»");
  const long = emailSubject("Cliente Demo", "ultimo promemoria su", LONG.title);
  assert.ok(long.length <= EMAIL_SUBJECT_MAX, long);
  assert.match(long, /^Cliente Demo: ultimo promemoria su «Riconciliazione[^»]*…»$/);
  const bigCompany = emailSubject("Una ragione sociale molto lunga di prova S.p.A.", "conferma", "Preventivi ai clienti");
  assert.ok(bigCompany.length <= EMAIL_SUBJECT_MAX, bigCompany);
  assert.match(bigCompany, /^Una ragione soci.*: conferma «Preventivi/);
  assert.equal(emailSubject("Cliente Demo", "serve il tuo ok sui fornitori"), "Cliente Demo: serve il tuo ok sui fornitori");
  // Mai uno spazio prima di «…».
  assert.doesNotMatch(emailSubject("Cliente Demo", "nuovo pacchetto per", "Smistamento delle richieste"), / …/);
});
