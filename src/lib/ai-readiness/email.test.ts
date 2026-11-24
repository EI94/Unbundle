import test from "node:test";
import assert from "node:assert/strict";
import { romeLocalToUtc } from "../uc/calendar.ts";
import type { MailResult, OutgoingEmail, UcMailer } from "../uc/notify/dispatch.ts";
import { EMAIL_BODY_MAX_WORDS, EMAIL_SUBJECT_MAX, emailBodyWords } from "../uc/notify/email-render.ts";
import { checkEmailLink } from "../uc/notify/email-templates.ts";
import { findHubForbiddenIn } from "../use-cases/copy-guard.ts";
import { scanPersonalData } from "../context/scan.ts";
import {
  airEmailBlock,
  airEmailIdempotencyKey,
  airEmailLink,
  airEmailPath,
  airEmailTarget,
  planAirEmail,
  renderAirAnswersEmail,
  renderAirResultsEmail,
  runAirEmailDispatch,
  type AirEmailFacts,
  type AirEmailStore,
  type ClaimedAirEmail,
} from "./email.ts";

// Le email dell'AI Readiness (0044): chi le riceve, il link, il testo parola per parola, il piano di ogni riga e il
// motore con uno store e un mailer finti. Le regole che decide il database (una riga in attesa, una al giorno, i
// risultati una volta, il conteggio) stanno in email-sql.test.ts e nella prova sul database. Dati inventati; nessuna
// email parte.

const at = (d: string, h: number, m = 0) => romeLocalToUtc(d, h, m);
const ENV = {
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <avvisi@notifiche.example.test>",
  UC_EMAIL_REPLY_TO: "persona@example.test",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};
const ORIGIN = "http://localhost:3000";
const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const AS = "3f2a9c1e-0000-4000-8000-0000000000c1";
const USER = "3f2a9c1e-0000-4000-8000-0000000000d1";
// Martedì 24 novembre 2026, nella finestra di Roma.
const NOW = at("2026-11-24", 10);

const LS = { role: "transformation_lead", email: "lead@ls.test", verified: true, lateralSpace: true };
const CLIENT = { role: "exec_sponsor", email: "sponsor@cliente.test", verified: true, lateralSpace: false };

const row = (over: Partial<ClaimedAirEmail> = {}): ClaimedAirEmail => ({
  id: "3f2a9c1e-0000-4000-8000-0000000000e1",
  workspaceId: WS,
  assessmentId: AS,
  recipientUserId: USER,
  kind: "risposte",
  scheduledAt: at("2026-11-23", 15),
  createdAt: at("2026-11-23", 15),
  attempts: 0,
  ...over,
});

const facts = (over: Partial<AirEmailFacts> = {}): AirEmailFacts => ({
  company: "Cliente Demo",
  assessment: { name: "Questionario per tutti", expected: 120, threshold: 5 },
  recipient: { ...LS, switchOn: true },
  workspaceAck: false,
  newAnswers: 12,
  total: 46,
  countedUntil: NOW,
  ...over,
});

const plan = (e: ClaimedAirEmail, f: AirEmailFacts, env: Record<string, string | undefined> = ENV) => planAirEmail(e, f, { env, origin: ORIGIN, now: NOW });

test("chi le riceve: solo chi gestisce il workspace, adesso, con l'email verificata; mai nessun altro ruolo", () => {
  for (const role of ["exec_sponsor", "transformation_lead"]) assert.equal(airEmailBlock({ ...LS, role }, false), null, role);
  for (const role of ["function_lead", "analyst", "contributor", "learner", "esterno_caso", "osservatore", "admin", "", null]) {
    assert.equal(airEmailBlock({ ...LS, role }, true), "non_gestisce", String(role));
  }
  assert.equal(airEmailBlock({ ...LS, verified: false }, true), "email_non_verificata");
  assert.equal(airEmailBlock({ ...LS, email: null }, true), "email_non_verificata");
  assert.equal(airEmailBlock({ ...LS, email: "Nome <lead@ls.test>" }, true), "email_non_verificata", "solo un indirizzo semplice");
});

test("il cancello del cliente: alle persone del cliente solo con l'ok sui sub-responsabili; a Lateral Space sempre", () => {
  assert.equal(airEmailBlock(CLIENT, false), "sub_responsabili_mancanti");
  assert.equal(airEmailBlock(CLIENT, true), null);
  assert.equal(airEmailBlock(LS, false), null);
  // Nel piano: senza l'ok la riga del cliente si annulla, e resta la campanella.
  assert.deepEqual(plan(row(), facts({ recipient: { ...CLIENT, switchOn: true }, workspaceAck: false })), { action: "cancel", reason: "sub_responsabili_mancanti" });
  assert.equal(plan(row(), facts({ recipient: { ...CLIENT, switchOn: true }, workspaceAck: true })).action, "send");
});

test("la scelta della persona: spenta, la riga si annulla; accesa, parte", () => {
  assert.deepEqual(plan(row(), facts({ recipient: { ...LS, switchOn: false } })), { action: "cancel", reason: "email_spenta" });
  assert.deepEqual(plan(row({ kind: "risultati" }), facts({ recipient: { ...LS, switchOn: false } })), { action: "cancel", reason: "email_spenta" });
  assert.equal(plan(row(), facts()).action, "send");
});

test("il link: senza «?» né «#», controllato come gli altri; porta alla scheda giusta dopo l'accesso", () => {
  assert.equal(airEmailPath(WS, AS, "risposte"), `/dashboard/${WS}/ai-readiness/aggiornamenti/${AS}`);
  assert.equal(airEmailPath(WS, AS, "risultati"), `/dashboard/${WS}/ai-readiness/aggiornamenti/${AS}/risultati`);
  for (const kind of ["risposte", "risultati"] as const) {
    const link = airEmailLink(`${ORIGIN}/`, WS, AS, kind);
    assert.equal(link, `${ORIGIN}${airEmailPath(WS, AS, kind)}`);
    assert.doesNotMatch(link, /[?#]/);
    assert.equal(checkEmailLink(link, "dashboard"), link);
  }
  assert.throws(() => airEmailPath("non-un-id", AS, "risposte"));
  assert.throws(() => airEmailPath(WS, "../settings", "risposte"));
  assert.throws(() => checkEmailLink(`${ORIGIN}/dashboard/${WS}/ai-readiness/aggiornamenti/${AS}/altro`, "dashboard"));
  assert.throws(() => checkEmailLink(`${ORIGIN}/dashboard/${WS}/ai-readiness/aggiornamenti/${AS}?scheda=raccolta`, "dashboard"));
  assert.equal(airEmailTarget(WS, AS, "risposte"), `/dashboard/${WS}/ai-readiness?assessment=${AS}&scheda=raccolta#persone`);
  assert.equal(airEmailTarget(WS, AS, "risultati"), `/dashboard/${WS}/ai-readiness?assessment=${AS}`);
});

const LONG = "Una società dal nome particolarmente lungo per provare l'oggetto S.p.A.";

test("i testi: le risposte nuove, solo numeri, in italiano, con calma; l'oggetto al massimo di 55 caratteri", () => {
  const link = airEmailLink(ORIGIN, WS, AS, "risposte");
  const many = renderAirAnswersEmail({ company: "Cliente Demo", assessment: "Questionario per tutti", newAnswers: 12, total: 46, expected: 120, link });
  assert.equal(many.subject, "Cliente Demo: 12 nuove risposte all'AI Readiness");
  assert.equal(
    many.text,
    [
      "Buongiorno,",
      "«Questionario per tutti» ha 12 nuove risposte: ora sono 46 su 120 attese.",
      `Apri la raccolta: ${link}`,
      "Ricevi questa email perché gestisci l'AI Readiness di Cliente Demo. Al massimo una al giorno, solo con i numeri: mai chi ha risposto. Puoi spegnere questi avvisi in «Il tuo account» › «Notifiche via email».",
    ].join("\n\n") + "\n",
  );
  const one = renderAirAnswersEmail({ company: "Cliente Demo", assessment: "Questionario per tutti", newAnswers: 1, total: 1, expected: null, link });
  assert.equal(one.subject, "Cliente Demo: 1 nuova risposta all'AI Readiness");
  assert.ok(one.text.includes("«Questionario per tutti» ha 1 nuova risposta: ora sono 1 in tutto."));
  assert.ok(renderAirAnswersEmail({ company: "Cliente Demo", assessment: "Q", newAnswers: 1200, total: 1500, expected: null, link }).text.includes("1.200 nuove risposte: ora sono 1.500 in tutto."));
  assert.throws(() => renderAirAnswersEmail({ company: "Cliente Demo", assessment: "Q", newAnswers: 0, total: 3, expected: null, link }), "mai un'email senza risposte nuove");
  const long = renderAirAnswersEmail({ company: LONG, assessment: "Q", newAnswers: 12, total: 46, expected: 120, link });
  assert.ok(long.subject.length <= EMAIL_SUBJECT_MAX, long.subject);
  assert.ok(long.subject.endsWith("12 nuove risposte all'AI Readiness"), "l'azione resta intera: si accorcia il nome del cliente");
});

test("i testi: i risultati disponibili, una volta; l'oggetto al massimo di 55 caratteri", () => {
  const link = airEmailLink(ORIGIN, WS, AS, "risultati");
  const results = renderAirResultsEmail({ company: "Cliente Demo", assessment: "Questionario per tutti", total: 5, expected: 40, link });
  assert.equal(results.subject, "Cliente Demo: i risultati dell'AI Readiness ci sono");
  assert.equal(
    results.text,
    [
      "Buongiorno,",
      "«Questionario per tutti» ha 5 risposte su 40 attese: bastano per leggere i risultati per area e per preparare la sintesi.",
      `Apri i risultati: ${link}`,
      "Ricevi questa email perché gestisci l'AI Readiness di Cliente Demo. Questo avviso arriva una volta sola per ogni rilevazione. Puoi spegnere questi avvisi in «Il tuo account» › «Notifiche via email».",
    ].join("\n\n") + "\n",
  );
  assert.ok(renderAirResultsEmail({ company: "Cliente Demo", assessment: "Q", total: 7, expected: null, link }).text.includes("«Q» ha 7 risposte: bastano per leggere"));
  assert.ok(renderAirResultsEmail({ company: LONG, assessment: "Q", total: 5, expected: null, link }).subject.length <= EMAIL_SUBJECT_MAX);
});

test("i testi: brevi, senza codici né persone, neutri, con le parole delle email di fuori", () => {
  const answers = renderAirAnswersEmail({ company: "Cliente Demo", assessment: "Questionario per tutti", newAnswers: 12, total: 46, expected: 120, link: airEmailLink(ORIGIN, WS, AS, "risposte") });
  const results = renderAirResultsEmail({ company: "Cliente Demo", assessment: "Questionario per tutti", total: 5, expected: 40, link: airEmailLink(ORIGIN, WS, AS, "risultati") });
  for (const email of [answers, results]) {
    assert.ok(emailBodyWords(email.text) <= EMAIL_BODY_MAX_WORDS, `${emailBodyWords(email.text)} parole`);
    const visible = email.text.replace(/https?:\/\/\S+/g, "");
    assert.doesNotMatch(visible, /[0-9a-f]{8}-[0-9a-f]{4}-/i, "nessun id in vista");
    assert.doesNotMatch(visible, /\b(ai_readiness|risposte_nuove|risultati_pronti|use case|survey|assessment|threshold)\b/i, "niente chiavi né inglese");
    // Neutro: nessuna desinenza di genere su chi riceve, nessun «o/a».
    assert.doesNotMatch(visible, /\b(caro|cara|gentile|benvenut[oa]|invitat[oa]|iscritt[oa])\b|[a-z]\/[a-z]\b/i);
    assert.deepEqual(findHubForbiddenIn([visible], "esterno").map((m) => m.match), [], "le parole delle email di fuori");
    assert.deepEqual(scanPersonalData(visible.replace(/«[^»]*»/g, "")), { ok: true }, "nessun dato personale");
    assert.doesNotMatch(email.html, /<img(?![^>]*unbundle-u\.png)/, "nessuna immagine oltre al marchio, nessun pixel");
  }
});

test("il piano: configurazione, età, rilevazione, destinatario, scelta, poi il contenuto", () => {
  assert.deepEqual(plan(row(), facts(), { ...ENV, RESEND_API_KEY: undefined }), { action: "hold", reason: "email_non_configurata" });
  // Più di due giorni lavorativi in attesa: troppo vecchia (lunedì → venerdì).
  assert.deepEqual(plan(row({ createdAt: at("2026-11-18", 15) }), facts()), { action: "cancel", reason: "troppo_vecchia" });
  assert.equal(plan(row({ createdAt: at("2026-11-20", 15) }), facts()).action, "send", "venerdì → martedì: un giorno lavorativo in mezzo");
  assert.deepEqual(plan(row(), facts({ assessment: null })), { action: "cancel", reason: "rilevazione_assente" });
  assert.deepEqual(plan(row(), facts({ recipient: null })), { action: "cancel", reason: "destinatario_non_valido" });
  assert.deepEqual(plan(row(), facts({ recipient: { ...LS, role: "analyst", switchOn: true } })), { action: "cancel", reason: "non_gestisce" });
  assert.deepEqual(plan(row(), facts({ newAnswers: 0 })), { action: "cancel", reason: "nessuna_risposta_nuova" });
  assert.deepEqual(plan(row({ kind: "risultati" }), facts({ total: 4 })), { action: "cancel", reason: "sotto_la_soglia" });
  const sent = plan(row(), facts());
  assert.equal(sent.action, "send");
  if (sent.action === "send") {
    assert.equal(sent.to, "lead@ls.test");
    assert.equal(sent.countedUntil, NOW, "la prossima email conta da qui");
    assert.ok(sent.rendered.subject.endsWith("12 nuove risposte all'AI Readiness"));
  }
  const results = plan(row({ kind: "risultati" }), facts({ newAnswers: 0, total: 5 }));
  assert.equal(results.action, "send", "i risultati partono anche senza risposte nuove");
  if (results.action === "send") assert.ok(results.rendered.text.includes(`/aggiornamenti/${AS}/risultati`));
});

/** Uno store finto: le righe in coda, che cosa il motore ha fatto, e le risposte del mailer. */
function fakeStore(rows: ClaimedAirEmail[], f: AirEmailFacts | ((e: ClaimedAirEmail) => AirEmailFacts) = facts()) {
  const log: string[] = [];
  const state = new Map(rows.map((r) => [r.id, { status: "in_coda" as string, attempts: r.attempts, marked: false }]));
  const store: AirEmailStore = {
    async holdUnconfigured() {
      log.push("hold-unconfigured");
      return rows.length;
    },
    async cancelStale() {
      return 0;
    },
    async claimDue() {
      log.push("claim");
      return rows.filter((r) => ["in_coda", "errore"].includes(state.get(r.id)!.status) && !state.get(r.id)!.marked);
    },
    async loadFacts(e) {
      return typeof f === "function" ? f(e) : f;
    },
    async beginAttempt(e) {
      const s = state.get(e.id)!;
      if (s.marked) return null;
      s.marked = true;
      s.attempts++;
      log.push(`begin:${e.id.slice(-2)}:${s.attempts}`);
      return s.attempts;
    },
    async markSent(e) {
      state.get(e.id)!.status = "inviata";
      log.push(`sent:${e.id.slice(-2)}`);
    },
    async markFailed(e, code) {
      const s = state.get(e.id)!;
      s.status = "errore";
      s.marked = false;
      log.push(`failed:${e.id.slice(-2)}:${code}`);
    },
    async markUncertain(e, code) {
      state.get(e.id)!.status = "annullata";
      log.push(`uncertain:${e.id.slice(-2)}:${code}`);
    },
    async markRetry(e, code) {
      log.push(`retry:${e.id.slice(-2)}:${code}`);
    },
    async markHeld(e, reason) {
      log.push(`held:${e.id.slice(-2)}:${reason}`);
    },
    async markCancelled(e, reason) {
      state.get(e.id)!.status = "annullata";
      log.push(`cancelled:${e.id.slice(-2)}:${reason}`);
    },
  };
  return { store, log, state };
}

function fakeMailer(results: Array<MailResult | Error> = []) {
  const outbox: Array<{ mail: OutgoingEmail; key: string }> = [];
  const mailer: UcMailer = {
    async send(mail, options) {
      outbox.push({ mail, key: options.idempotencyKey });
      const next = results.shift() ?? ({ ok: true } as const);
      if (next instanceof Error) throw next;
      return next;
    },
  };
  return { mailer, outbox };
}

const ROW_A = row({ id: "3f2a9c1e-0000-4000-8000-0000000000e1" });
const ROW_B = row({ id: "3f2a9c1e-0000-4000-8000-0000000000e2", kind: "risultati" });

test("il motore: parte con la chiave del tentativo, segna il tentativo prima di Resend, poi «inviata»", async () => {
  const { store, log } = fakeStore([ROW_A]);
  const { mailer, outbox } = fakeMailer();
  const summary = await runAirEmailDispatch(store, { env: ENV, now: NOW, mailer, sendIntervalMs: 0 });
  assert.deepEqual(summary, { sent: 1, failed: 0, held: 0, cancelled: 0, notConfigured: 0 });
  assert.deepEqual(log, ["claim", "begin:e1:1", "sent:e1"]);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].key, airEmailIdempotencyKey(ROW_A.id, 1));
  assert.equal(outbox[0].mail.to, "lead@ls.test");
  assert.equal(outbox[0].mail.replyTo, "persona@example.test");
});

test("il motore: un esito incerto non si ripete mai, nemmeno al giro dopo; un errore certo si riprova", async () => {
  const uncertain = fakeStore([ROW_A]);
  const first = fakeMailer([{ ok: false, code: "timeout", ambiguous: true }]);
  const s1 = await runAirEmailDispatch(uncertain.store, { env: ENV, now: NOW, mailer: first.mailer, sendIntervalMs: 0 });
  assert.deepEqual(s1, { sent: 0, failed: 0, held: 0, cancelled: 1, notConfigured: 0 });
  assert.deepEqual(uncertain.log, ["claim", "begin:e1:1", "uncertain:e1:timeout"]);
  const again = fakeMailer();
  await runAirEmailDispatch(uncertain.store, { env: ENV, now: NOW, mailer: again.mailer, sendIntervalMs: 0 });
  assert.equal(again.outbox.length, 0, "mai una seconda volta");

  // Un'eccezione del mailer conta come esito incerto.
  const thrown = fakeStore([ROW_A]);
  await runAirEmailDispatch(thrown.store, { env: ENV, now: NOW, mailer: fakeMailer([new Error("rete")]).mailer, sendIntervalMs: 0 });
  assert.deepEqual(thrown.log, ["claim", "begin:e1:1", "uncertain:e1:errore_invio"]);

  const definite = fakeStore([ROW_A]);
  const failing = fakeMailer([{ ok: false, code: "validation_error", ambiguous: false }]);
  const s2 = await runAirEmailDispatch(definite.store, { env: ENV, now: NOW, mailer: failing.mailer, sendIntervalMs: 0 });
  assert.equal(s2.failed, 1);
  assert.deepEqual(definite.log, ["claim", "begin:e1:1", "failed:e1:validation_error"]);
  const retry = fakeMailer();
  await runAirEmailDispatch(definite.store, { env: ENV, now: NOW, mailer: retry.mailer, sendIntervalMs: 0 });
  assert.deepEqual(retry.outbox.map((o) => o.key), [airEmailIdempotencyKey(ROW_A.id, 2)], "un tentativo nuovo, con la sua chiave");
});

test("il motore: un errore dopo il segno del tentativo non rimette la riga in coda; prima sì", async () => {
  const after = fakeStore([ROW_A]);
  after.store.markSent = async () => {
    throw new Error("database");
  };
  await runAirEmailDispatch(after.store, { env: ENV, now: NOW, mailer: fakeMailer().mailer, sendIntervalMs: 0 });
  assert.ok(!after.log.some((l) => l.startsWith("retry") || l.startsWith("failed")), after.log.join(", "));

  const before = fakeStore([ROW_A]);
  before.store.loadFacts = async () => {
    throw new Error("database");
  };
  const mail = fakeMailer();
  await runAirEmailDispatch(before.store, { env: ENV, now: NOW, mailer: mail.mailer, sendIntervalMs: 0 });
  assert.deepEqual(before.log, ["claim", "retry:e1:errore_lettura"]);
  assert.equal(mail.outbox.length, 0);
});

test("il motore: fuori dalla finestra di Roma niente parte; senza configurazione le righe aspettano; il limite di Resend ferma il giro", async () => {
  const night = fakeStore([ROW_A]);
  const s = await runAirEmailDispatch(night.store, { env: ENV, now: at("2026-11-24", 20), mailer: fakeMailer().mailer, sendIntervalMs: 0 });
  assert.equal(s.sent, 0);
  assert.ok(!night.log.includes("claim"), "nessuna riga presa fuori finestra");
  const sunday = fakeStore([ROW_A]);
  await runAirEmailDispatch(sunday.store, { env: ENV, now: at("2026-11-29", 10), mailer: fakeMailer().mailer, sendIntervalMs: 0 });
  assert.ok(!sunday.log.includes("claim"), "la domenica no");

  const unconfigured = fakeStore([ROW_A]);
  const u = await runAirEmailDispatch(unconfigured.store, { env: { ...ENV, UC_EMAIL_FROM: undefined }, now: NOW, sendIntervalMs: 0 });
  assert.deepEqual(unconfigured.log, ["hold-unconfigured"]);
  assert.equal(u.notConfigured, 1);

  const limited = fakeStore([ROW_A, ROW_B]);
  const mail = fakeMailer([{ ok: false, code: "rate_limit_exceeded", ambiguous: false }]);
  await runAirEmailDispatch(limited.store, { env: ENV, now: NOW, mailer: mail.mailer, sendIntervalMs: 0 });
  assert.equal(mail.outbox.length, 1, "dopo il limite il giro si ferma");
});

test("il motore: la soglia parte con il suo testo; una riga annullata dal piano non tocca Resend", async () => {
  const { store, log } = fakeStore([ROW_B, row({ id: "3f2a9c1e-0000-4000-8000-0000000000e3" })], (e) =>
    e.kind === "risultati" ? facts({ total: 5, newAnswers: 0 }) : facts({ recipient: { ...LS, switchOn: false } }),
  );
  const { mailer, outbox } = fakeMailer();
  await runAirEmailDispatch(store, { env: ENV, now: NOW, mailer, sendIntervalMs: 0 });
  assert.deepEqual(log, ["claim", "begin:e2:1", "sent:e2", "cancelled:e3:email_spenta"]);
  assert.equal(outbox.length, 1);
  assert.equal(outbox[0].mail.subject, "Cliente Demo: i risultati dell'AI Readiness ci sono");
});
