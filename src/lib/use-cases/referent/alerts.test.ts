import test from "node:test";
import assert from "node:assert/strict";
import { romeLocalToUtc } from "../../uc/calendar.ts";
import type { MailResult, OutgoingEmail, UcMailer } from "../../uc/notify/dispatch.ts";
import {
  alertSchedule,
  cardLink,
  isStaleAlert,
  planRequesterAlert,
  renderRequesterAlert,
  runRequesterAlertDispatch,
  type AlertFacts,
  type AlertItemFacts,
  type ClaimedAlert,
  type RequesterAlertInput,
  type RequesterAlertStore,
} from "./alerts.ts";

// L'avviso per email a chi ha chiesto (SPEC §P2.7). Dati inventati.
const at = (d: string, h: number, m = 0) => romeLocalToUtc(d, h, m);
const ENV = { RESEND_API_KEY: "re_test", UC_EMAIL_FROM: "Lateral Space via Unbundle <test@example.test>", NEXT_PUBLIC_APP_URL: "http://localhost:3000" };
const ORIGIN = "http://localhost:3000";
const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const UC1 = "3f2a9c1e-0000-4000-8000-0000000000b1";
const UC2 = "3f2a9c1e-0000-4000-8000-0000000000b2";
const REFERENT = { name: "Mario Rossi", email: "mario.rossi@topjet.it", answer: "Circa venti fatture al giorno", file: "fatture-ottobre.xlsx" };

test("alertSchedule: oggi nella finestra, altrimenti le 9 del prossimo giorno lavorativo", () => {
  const tue = alertSchedule(at("2026-11-03", 10));
  assert.deepEqual([tue.today, tue.inWindow, tue.nextDay], ["2026-11-03", true, "2026-11-04"]);
  assert.equal(alertSchedule(at("2026-11-03", 17, 59)).inWindow, true);
  const fri = alertSchedule(at("2026-11-06", 18));
  assert.deepEqual([fri.inWindow, fri.nextDay, fri.nextAt.toISOString()], [false, "2026-11-09", at("2026-11-09", 9).toISOString()]);
  assert.equal(alertSchedule(at("2026-11-07", 11)).nextDay, "2026-11-09", "sabato → lunedì");
  assert.equal(alertSchedule(at("2026-12-31", 19)).nextDay, "2027-01-04", "31/12 → il primo giorno lavorativo dopo Capodanno e il weekend");
  const early = alertSchedule(at("2026-11-02", 7));
  assert.deepEqual([early.inWindow, early.nextDay, early.nextAt.toISOString()], [false, "2026-11-02", at("2026-11-02", 9).toISOString()]);
});

test("isStaleAlert: più di 2 giorni lavorativi dopo due_at", () => {
  assert.equal(isStaleAlert(at("2026-11-06", 10), at("2026-11-10", 10)), false);
  assert.equal(isStaleAlert(at("2026-11-06", 10), at("2026-11-11", 10)), true);
});

test("cardLink: solo uuid e https (http in locale), al capitolo «Cosa serve»", () => {
  assert.equal(cardLink(ORIGIN, WS.toUpperCase(), UC1), `${ORIGIN}/dashboard/${WS}/use-cases/${UC1}?capitolo=cosa-serve`);
  assert.equal(cardLink("https://app.example.test/x?y", WS, UC1), `https://app.example.test/dashboard/${WS}/use-cases/${UC1}?capitolo=cosa-serve`);
  assert.throws(() => cardLink(ORIGIN, "x", UC1));
  assert.throws(() => cardLink("http://app.example.test", WS, UC1));
  assert.throws(() => cardLink("https://u:p@app.example.test", WS, UC1));
});

const claimed = (over: Partial<ClaimedAlert> = {}): ClaimedAlert => ({
  id: "a1",
  workspaceId: WS,
  recipientUserId: "3f2a9c1e-0000-4000-8000-0000000000aa",
  sendOn: "2026-11-05",
  scheduledAt: at("2026-11-05", 10),
  dueAt: at("2026-11-05", 10),
  attempts: 0,
  ...over,
});
const item = (over: Partial<AlertItemFacts> = {}): AlertItemFacts => ({
  requestId: "r1",
  useCaseId: UC1,
  code: "TJ-0004",
  title: "Fatture fornitori",
  createdAt: at("2026-11-02", 10),
  answers: 2,
  unknowns: 0,
  documents: 0,
  followUp: null,
  requestPurged: false,
  ...over,
});
const facts = (over: Partial<AlertFacts> = {}): AlertFacts => ({
  company: "TopJet",
  featureOn: true,
  subprocessorsAuthorized: true,
  recipient: { email: "giulia.neri@topjet.it", verified: true, reviewer: true, alertsOn: true },
  items: [item()],
  ...over,
});
const NOW = at("2026-11-05", 10, 30);
const plan = (f: AlertFacts, e = claimed()) => planRequesterAlert(e, f, { env: ENV, origin: ORIGIN, now: NOW });

test("piano: nell'ordine di §P2.7.3", () => {
  assert.deepEqual(planRequesterAlert(claimed(), facts(), { env: {}, origin: ORIGIN, now: NOW }), { action: "hold", reason: "email_non_configurata" });
  assert.deepEqual(plan(facts({ featureOn: false })), { action: "hold", reason: "funzione_spenta" });
  assert.deepEqual(plan(facts({ subprocessorsAuthorized: false })), { action: "hold", reason: "sub_responsabili_mancanti" });
  // La staleness guarda due_at, mai scheduled_at (che i tentativi spostano).
  assert.deepEqual(plan(facts(), claimed({ dueAt: at("2026-10-30", 10), scheduledAt: at("2026-11-05", 10) })), { action: "cancel", reason: "troppo_vecchia" });
  assert.deepEqual(plan(facts({ recipient: null })), { action: "cancel", reason: "destinatario_non_valido" });
  assert.deepEqual(plan(facts({ recipient: { email: "g@topjet.it", verified: false, reviewer: true, alertsOn: true } })), { action: "cancel", reason: "destinatario_non_valido" });
  assert.deepEqual(plan(facts({ recipient: { email: "g@topjet.it", verified: true, reviewer: false, alertsOn: true } })), { action: "cancel", reason: "destinatario_non_valido" });
  assert.deepEqual(plan(facts({ recipient: { email: "g@topjet.it", verified: true, reviewer: true, alertsOn: false } })), { action: "cancel", reason: "avvisi_spenti" });
  assert.deepEqual(plan(facts({ items: [item({ requestPurged: true })] })), { action: "cancel", reason: "nessuna_voce" });
  const ok = plan(facts({ items: [item({ requestId: "r2", createdAt: at("2026-11-03", 10), documents: 1, answers: 0, followUp: "ultimo_promemoria" }), item(), item({ requestId: "r3", requestPurged: true })] }));
  assert.equal(ok.action, "send");
  if (ok.action === "send") {
    assert.deepEqual(ok.sentRequestIds, ["r1", "r2"]);
    assert.deepEqual(ok.dropped, [{ requestId: "r3", reason: "dati_cancellati" }]);
    assert.equal(ok.input.entries.length, 1, "due richieste sulla stessa scheda si uniscono");
    assert.deepEqual([ok.input.entries[0].answers, ok.input.entries[0].documents, ok.input.entries[0].followUp], [2, 1, "ultimo_promemoria"]);
  }
  const both = plan(facts({ items: [item({ followUp: "ultimo_promemoria", answers: 0 }), item({ requestId: "r2", followUp: "scaduta", answers: 0 })] }));
  assert.ok(both.action === "send" && both.input.entries[0].followUp === "scaduta", "«scaduta» vince");
});

test("piano: un seguito non più vero si toglie all'invio (risposta arrivata, chiesto di nuovo)", () => {
  // Ultimo promemoria, poi il referente ha risposto a tutto: la frase cade, la voce senza altro esce.
  assert.deepEqual(plan(facts({ items: [item({ answers: 0, followUp: "ultimo_promemoria", stillWaiting: false })] })), { action: "cancel", reason: "nessuna_voce" });
  // Nella stessa riga anche le risposte: restano, senza «restano domande senza risposta».
  const mixed = plan(facts({ items: [item({ answers: 1, followUp: "ultimo_promemoria", stillWaiting: false })] }));
  assert.ok(mixed.action === "send" && mixed.input.entries[0].followUp === null && mixed.input.entries[0].answers === 1);
  if (mixed.action === "send") assert.doesNotMatch(renderRequesterAlert(mixed.input).text, /senza risposta/);
  // Ancora vero: resta.
  const waiting = plan(facts({ items: [item({ answers: 0, followUp: "scaduta", stillWaiting: true })] }));
  assert.ok(waiting.action === "send" && waiting.input.entries[0].followUp === "scaduta");
});

const entry = (over: Partial<RequesterAlertInput["entries"][number]> = {}) => ({
  useCase: { code: "TJ-0004", title: "Fatture fornitori" },
  answers: 0,
  unknowns: 0,
  documents: 0,
  followUp: null,
  link: cardLink(ORIGIN, WS, UC1),
  ...over,
});
const has = (text: string, line: string) => assert.ok(text.includes(line), `manca «${line}» in:\n${text}`);
const FOOTER = "Ricevi questa email perché hai chiesto tu queste informazioni al referente. Per non riceverle più, togli la spunta «Avvisami per email» nella campanella di Unbundle.";

function safe(m: { subject: string; text: string; html: string }) {
  for (const part of [m.subject, m.text, m.html]) {
    for (const secret of Object.values(REFERENT)) assert.ok(!part.includes(secret), secret);
    assert.doesNotMatch(part, /caso d'uso|\btoken\b|\bMCP\b|\bworkflow\b|<img|utm_/i);
  }
  has(m.text, FOOTER);
  has(m.text, "Lateral Space via Unbundle.");
}

test("testo: una scheda con risposte", () => {
  const m = renderRequesterAlert({ company: "TopJet", entries: [entry({ answers: 1 })] });
  assert.equal(m.subject, "Risposte arrivate su «TJ-0004 · Fatture fornitori»");
  has(m.text, "Buongiorno,");
  has(m.text, "ci sono novità sullo use case «TJ-0004 · Fatture fornitori» di TopJet.");
  has(m.text, "«TJ-0004 · Fatture fornitori»: è arrivata 1 risposta.");
  has(m.text, "Da verificare in «Cosa serve».");
  has(m.text, "Apri «Cosa serve»");
  has(m.text, `${ORIGIN}/dashboard/${WS}/use-cases/${UC1}?capitolo=cosa-serve`);
  safe(m);
});

test("testo: solo documenti, solo «Non lo so», risposte e «Non lo so», solo il seguito", () => {
  const docs = renderRequesterAlert({ company: "TopJet", entries: [entry({ documents: 5 })] });
  assert.equal(docs.subject, "Nuovi documenti su «TJ-0004 · Fatture fornitori»");
  has(docs.text, "«TJ-0004 · Fatture fornitori»: ci sono 5 documenti nuovi.");
  const unknown = renderRequesterAlert({ company: "TopJet", entries: [entry({ unknowns: 1 })] });
  assert.equal(unknown.subject, "Il referente non sa rispondere su «TJ-0004 · Fatture fornitori»");
  has(unknown.text, "il referente non ha l'informazione per 1 domanda.");
  has(unknown.text, "Per i «Non lo so» puoi chiedere a un'altra persona.");
  assert.ok(!unknown.text.includes("Da verificare"));
  const mixed = renderRequesterAlert({ company: "TopJet", entries: [entry({ answers: 3, unknowns: 2 })] });
  has(mixed.text, "«TJ-0004 · Fatture fornitori»: sono arrivate 3 risposte e il referente non ha l'informazione per 2 domande.");
  const last = renderRequesterAlert({ company: "TopJet", entries: [entry({ followUp: "ultimo_promemoria" })] });
  assert.equal(last.subject, "Nessuna risposta su «TJ-0004 · Fatture fornitori»");
  has(last.text, "è partito l'ultimo promemoria e restano domande senza risposta.");
  has(last.text, "Puoi chiedere di nuovo o chiedere a un'altra persona.");
  const expired = renderRequesterAlert({ company: "TopJet", entries: [entry({ followUp: "scaduta", unknowns: 1 })] });
  has(expired.text, "il link è scaduto e restano domande senza risposta");
  assert.ok(!expired.text.includes("Per i «Non lo so»"), "con il seguito, solo la sua riga");
  const all = renderRequesterAlert({ company: "TopJet", entries: [entry({ answers: 2, documents: 1, followUp: "ultimo_promemoria" })] });
  has(all.text, "sono arrivate 2 risposte, c'è 1 documento nuovo e è partito l'ultimo promemoria e restano domande senza risposta.");
  for (const m of [docs, unknown, mixed, last, expired, all]) safe(m);
});

test("testo: più schede", () => {
  const m = renderRequesterAlert({ company: "TopJet", entries: [entry({ answers: 1 }), entry({ useCase: { code: null, title: "Ordini clienti" }, documents: 2, link: cardLink(ORIGIN, WS, UC2) })] });
  assert.equal(m.subject, "Novità su 2 use case di TopJet");
  has(m.text, "ci sono novità su 2 use case di TopJet.");
  has(m.text, "«Ordini clienti»: ci sono 2 documenti nuovi.");
  has(m.text, `${ORIGIN}/dashboard/${WS}/use-cases/${UC2}?capitolo=cosa-serve`);
  safe(m);
  assert.throws(() => renderRequesterAlert({ company: "TopJet", entries: [] }));
});

function store(claims: ClaimedAlert[], f: AlertFacts): { store: RequesterAlertStore; log: Record<string, unknown[]> } {
  const log: Record<string, unknown[]> = { sent: [], failed: [], held: [], cancelled: [], claim: [] };
  return {
    log,
    store: {
      async holdUnconfigured() {
        return claims.length;
      },
      async cancelStale() {
        return 0;
      },
      async claimDue(i) {
        log.claim.push(i);
        return claims;
      },
      async loadFacts() {
        return f;
      },
      async markSent(e) {
        log.sent.push(e.id);
      },
      async markFailed(e, c) {
        log.failed.push(`${e.id}:${c}`);
      },
      async markHeld(e, r) {
        log.held.push(`${e.id}:${r}`);
      },
      async markCancelled(e, r) {
        log.cancelled.push(`${e.id}:${r}`);
      },
    },
  };
}

function mailer(results: MailResult[] = []): UcMailer & { outbox: OutgoingEmail[]; keys: string[] } {
  const outbox: OutgoingEmail[] = [];
  const keys: string[] = [];
  return {
    outbox,
    keys,
    async send(m, o) {
      outbox.push(m);
      keys.push(o.idempotencyKey);
      return results.shift() ?? { ok: true };
    },
  };
}

test("motore: invia nella finestra, senza replyTo, con la chiave dell'avviso", async () => {
  const s = store([claimed()], facts());
  const m = mailer();
  const sum = await runRequesterAlertDispatch(s.store, { env: ENV, now: NOW, mailer: m, sendIntervalMs: 0 });
  assert.equal(sum.sent, 1);
  assert.equal(m.outbox[0].to, "giulia.neri@topjet.it");
  assert.equal(m.outbox[0].replyTo, undefined);
  assert.match(m.keys[0], /ra:a1/);
  // Fuori finestra niente si prende.
  const night = store([claimed()], facts());
  const off = await runRequesterAlertDispatch(night.store, { env: ENV, now: at("2026-11-05", 20), mailer: mailer() });
  assert.equal(off.sent, 0);
  assert.deepEqual(night.log.claim, []);
  // Senza configurazione restano in coda.
  const unconfigured = await runRequesterAlertDispatch(store([claimed()], facts()).store, { env: {}, now: NOW, mailer: mailer() });
  assert.equal(unconfigured.notConfigured, 1);
});

test("motore: un fallimento si segna, il limite di Resend ferma il giro", async () => {
  const s = store([claimed({ id: "a1" }), claimed({ id: "a2" })], facts());
  const m = mailer([{ ok: false, code: "rate_limit_exceeded", ambiguous: false }]);
  const sum = await runRequesterAlertDispatch(s.store, { env: ENV, now: NOW, mailer: m, sendIntervalMs: 0 });
  assert.equal(m.outbox.length, 1);
  assert.equal(sum.failed, 1);
  assert.deepEqual(s.log.failed, ["a1:rate_limit_exceeded"]);
});
