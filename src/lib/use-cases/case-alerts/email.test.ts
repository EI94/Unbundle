import test from "node:test";
import assert from "node:assert/strict";
import { romeLocalToUtc } from "../../uc/calendar.ts";
import type { MailResult, OutgoingEmail, UcMailer } from "../../uc/notify/dispatch.ts";
import {
  planCaseAlert,
  renderReadyAlert,
  renderSuppliersAlert,
  runCaseAlertDispatch,
  type CaseAlertFacts,
  type CaseAlertStore,
  type ClaimedCaseAlert,
  type ReadyItemFacts,
} from "./email.ts";

// Le email di «Pronto da avviare» (0025): il piano di ogni riga, il testo parola per parola, il motore
// con un mailer finto. Dati inventati; nessuna email parte.
const at = (d: string, h: number, m = 0) => romeLocalToUtc(d, h, m);
const ENV = {
  RESEND_API_KEY: "re_test_finto",
  UC_EMAIL_FROM: "Lateral Space via Unbundle <avvisi@notifiche.example.test>",
  UC_EMAIL_REPLY_TO: "persona@example.test",
  NEXT_PUBLIC_APP_URL: "http://localhost:3000",
};
const ORIGIN = "http://localhost:3000";
const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const UC1 = "3f2a9c1e-0000-4000-8000-0000000000b1";
const UC2 = "3f2a9c1e-0000-4000-8000-0000000000b2";
const UC3 = "3f2a9c1e-0000-4000-8000-0000000000b3";

const claimed = (over: Partial<ClaimedCaseAlert> = {}): ClaimedCaseAlert => ({
  id: "c1",
  workspaceId: WS,
  recipientUserId: "3f2a9c1e-0000-4000-8000-0000000000aa",
  kind: "pronto",
  sendOn: "2026-11-02",
  scheduledAt: at("2026-11-02", 9),
  dueAt: at("2026-11-02", 9),
  attempts: 0,
  ...over,
});
const item = (over: Partial<ReadyItemFacts> = {}): ReadyItemFacts => ({ useCaseId: UC1, code: "TJ-0004", title: "Fatture fornitori", quarter: "2027-Q1", stillReady: true, unread: true, ...over });
const facts = (over: Partial<CaseAlertFacts> = {}): CaseAlertFacts => ({
  company: "TopJet",
  readyNoticesOn: true,
  referentsOn: true,
  clientNoticesOn: true,
  subprocessorsAuthorized: true,
  recipient: { email: "lead@lateralspace.ai", verified: true, lateralSpace: true, reviewer: true, canDeclare: false },
  items: [item()],
  suppliersRowUnread: false,
  ...over,
});
const plan = (f: CaseAlertFacts, e: ClaimedCaseAlert = claimed(), env: Record<string, string | undefined> = ENV, now = at("2026-11-02", 10)) => planCaseAlert(e, f, { env, origin: ORIGIN, now });

test("piano: configurazione, funzione, autorizzazione, nell'ordine; poi età, destinatario, voci", () => {
  assert.deepEqual(plan(facts(), claimed(), { ...ENV, RESEND_API_KEY: undefined }), { action: "hold", reason: "email_non_configurata" });
  assert.deepEqual(plan(facts({ readyNoticesOn: false, subprocessorsAuthorized: false })), { action: "hold", reason: "funzione_spenta" });
  assert.deepEqual(plan(facts({ subprocessorsAuthorized: false })), { action: "hold", reason: "sub_responsabili_mancanti" });
  assert.deepEqual(plan(facts(), claimed({ dueAt: at("2026-10-28", 9) }), ENV, at("2026-11-02", 10)), { action: "cancel", reason: "troppo_vecchia" });
  assert.deepEqual(plan(facts({ subprocessorsAuthorized: false }), claimed({ dueAt: at("2026-10-28", 9) })), { action: "hold", reason: "sub_responsabili_mancanti" }, "in attesa prima dell'età: la annulla cancelStale");
});

test("destinatario: solo un revisore di Lateral Space verificato, ricontrollato adesso (mai il cliente)", () => {
  const bad = [
    null,
    { email: "lead@lateralspace.ai", verified: false, lateralSpace: true, reviewer: true, canDeclare: false },
    { email: "lead@lateralspace.ai", verified: true, lateralSpace: false, reviewer: true, canDeclare: true },
    { email: "lead@lateralspace.ai", verified: true, lateralSpace: true, reviewer: false, canDeclare: false },
    { email: "Nome <lead@lateralspace.ai>", verified: true, lateralSpace: true, reviewer: true, canDeclare: false },
    { email: null, verified: true, lateralSpace: true, reviewer: true, canDeclare: false },
  ];
  for (const recipient of bad) assert.deepEqual(plan(facts({ recipient })), { action: "cancel", reason: "destinatario_non_valido" }, JSON.stringify(recipient));
});

test("voci: solo gli use case ancora pronti e con la riga ancora non letta; nessuna → annullata", () => {
  assert.deepEqual(plan(facts({ items: [item({ stillReady: false })] })), { action: "cancel", reason: "nessuna_voce" });
  assert.deepEqual(plan(facts({ items: [item({ unread: false })] })), { action: "cancel", reason: "nessuna_voce" });
  assert.deepEqual(plan(facts({ items: [] })), { action: "cancel", reason: "nessuna_voce" });
  const p = plan(facts({ items: [item(), item({ useCaseId: UC2, stillReady: false }), item({ useCaseId: UC3, code: "TJ-0009", title: "Ordini" }), item()] }));
  assert.equal(p.action, "send");
  if (p.action !== "send") return;
  assert.deepEqual(p.useCaseIds, [UC1, UC3], "senza doppioni, nell'ordine");
  assert.equal(p.to, "lead@lateralspace.ai");
  // (Rilascio 5.1) In cima il marchio, dall'origine pubblica dell'app.
  assert.equal((p.rendered.html.match(/<img src="http:\/\/localhost:3000\/email\/unbundle-u\.png"/g) ?? []).length, 1);
  // Un tipo che questo motore non sa scrivere si annulla.
  assert.deepEqual(plan(facts(), claimed({ kind: "altro" as never })), { action: "cancel", reason: "nessuna_voce" });
});

const suppliers = (over: Partial<CaseAlertFacts> = {}) =>
  facts({
    subprocessorsAuthorized: false,
    recipient: { email: "responsabile@topjet.example", verified: true, lateralSpace: false, reviewer: true, canDeclare: true },
    items: [],
    suppliersRowUnread: true,
    ...over,
  });
const supplier = claimed({ kind: "fornitori" });

test("«Autorizza i fornitori»: configurazione, funzione, interruttore del cliente, ok dato, età, chi può dare l'ok, riga già aperta", () => {
  assert.deepEqual(plan(suppliers(), supplier, { ...ENV, RESEND_API_KEY: undefined }), { action: "hold", reason: "email_non_configurata" });
  assert.deepEqual(plan(suppliers({ referentsOn: false }), supplier), { action: "hold", reason: "funzione_spenta" });
  assert.deepEqual(plan(suppliers({ clientNoticesOn: false }), supplier), { action: "cancel", reason: "avvisi_cliente_spenti" });
  assert.deepEqual(plan(suppliers({ subprocessorsAuthorized: true }), supplier), { action: "cancel", reason: "autorizzazione_data" });
  assert.deepEqual(plan(suppliers(), claimed({ kind: "fornitori", dueAt: at("2026-10-28", 9) })), { action: "cancel", reason: "troppo_vecchia" });
  for (const recipient of [null, { email: "lead@lateralspace.ai", verified: true, lateralSpace: true, reviewer: true, canDeclare: false }, { email: "Nome <r@topjet.example>", verified: true, lateralSpace: false, reviewer: true, canDeclare: true }]) {
    assert.deepEqual(plan(suppliers({ recipient }), supplier), { action: "cancel", reason: "destinatario_non_valido" }, JSON.stringify(recipient));
  }
  assert.deepEqual(plan(suppliers({ suppliersRowUnread: false }), supplier), { action: "cancel", reason: "gia_vista" });
  const p = plan(suppliers(), supplier);
  assert.equal(p.action, "send");
  if (p.action !== "send") return;
  assert.equal(p.to, "responsabile@topjet.example");
  assert.deepEqual(p.useCaseIds, []);
  // Senza l'ok non resta in attesa: è proprio l'email che chiede l'ok.
  assert.equal(plan(suppliers({ readyNoticesOn: false }), supplier).action, "send");
});

test("«Autorizza i fornitori», parola per parola: il link a Impostazioni, nessun dato dei casi d'uso", () => {
  const r = renderSuppliersAlert({ company: "TopJet", link: `${ORIGIN}/dashboard/${WS}/settings#sub-responsabili` });
  assert.equal(r.subject, "TopJet: serve il tuo ok sui fornitori di Lateral Space");
  assert.ok(
    r.text.startsWith(
      [
        "Buongiorno,",
        "per raccogliere le informazioni sui casi d'uso di TopJet, Lateral Space usa alcuni fornitori, per esempio quello delle email. Prima serve l'ok di una persona di TopJet con il tuo ruolo.",
        `Apri Impostazioni › Sub-responsabili: ${ORIGIN}/dashboard/${WS}/settings#sub-responsabili`,
        "Ricevi questa email perché puoi dare questa autorizzazione per TopJet. Quando qualcuno l'avrà data, non ne riceverai altre.",
      ].join("\n\n"),
    ),
    r.text,
  );
  assert.doesNotMatch(r.text + r.html + r.subject, /TJ-\d/i);
  assert.doesNotMatch((r.text + r.html + r.subject).replace(/https?:\/\/[^\s"<]+/g, ""), /\buse[\s-]*cases?\b/i, "(rilascio 5.1) fuori dalla dashboard mai «use case»");
  const p = plan(suppliers(), supplier);
  assert.ok(p.action === "send" && p.rendered.text.includes(`${ORIGIN}/dashboard/${WS}/settings#sub-responsabili`));
  // (Rilascio 5.1) In cima il marchio, dall'origine pubblica dell'app.
  assert.ok(p.action === "send" && p.rendered.html.includes(`<img src="${ORIGIN}/email/unbundle-u.png"`));
});

test("testo con un caso d'uso, parola per parola, con il link a «Realizzazione»", () => {
  const r = renderReadyAlert({ company: "TopJet", entries: [{ useCase: { code: "TJ-0004", title: "Fatture fornitori" }, quarter: "2027-Q1", link: `${ORIGIN}/dashboard/${WS}/use-cases/${UC1}?capitolo=realizzazione` }] });
  assert.equal(r.subject, "TopJet: il caso d'uso «TJ-0004 · Fatture fornitori» è pronto da avviare");
  assert.ok(
    r.text.startsWith(
      [
        "Buongiorno,",
        "il caso d'uso «TJ-0004 · Fatture fornitori» di TopJet è pronto da avviare: è approvato per T1 2027 e non manca niente dal cliente.",
        `Apri il caso d'uso: ${ORIGIN}/dashboard/${WS}/use-cases/${UC1}?capitolo=realizzazione`,
        "Ricevi questa email perché sei di Lateral Space e puoi avviare la realizzazione.",
      ].join("\n\n"),
    ),
    r.text,
  );
  assert.doesNotMatch((r.text + r.html + r.subject).replace(/https?:\/\/[^\s"<]+/g, ""), /\buse[\s-]*cases?\b/i, "(rilascio 5.1) fuori dalla dashboard mai «use case»");
});

test("testo con più casi d'uso: uno per riga, ognuno con il suo link", () => {
  const r = renderReadyAlert({
    company: "TopJet",
    entries: [
      { useCase: { code: "TJ-0004", title: "Fatture fornitori" }, quarter: "2027-Q1", link: `${ORIGIN}/dashboard/${WS}/use-cases/${UC1}?capitolo=realizzazione` },
      { useCase: { code: "TJ-0009", title: "Ordini" }, quarter: "2026-Q4", link: `${ORIGIN}/dashboard/${WS}/use-cases/${UC2}?capitolo=realizzazione` },
      { useCase: { code: null, title: "Senza codice" }, quarter: "2026-Q4", link: `${ORIGIN}/dashboard/${WS}/use-cases/${UC3}?capitolo=realizzazione` },
    ],
  });
  assert.equal(r.subject, "TopJet: 3 casi d'uso pronti da avviare");
  for (const line of ["ci sono 3 casi d'uso di TopJet pronti da avviare: sono approvati e non manca niente dal cliente.", "«TJ-0004 · Fatture fornitori» · T1 2027", "«TJ-0009 · Ordini» · T4 2026", "«Senza codice» · T4 2026"]) {
    assert.ok(r.text.includes(line), line);
  }
  assert.equal(r.text.match(/Apri il caso d'uso: /g)?.length, 3);
  assert.doesNotMatch((r.text + r.html + r.subject).replace(/https?:\/\/[^\s"<]+/g, ""), /\buse[\s-]*cases?\b/i, "(rilascio 5.1) fuori dalla dashboard mai «use case»");
  assert.throws(() => renderReadyAlert({ company: "TopJet", entries: [] }));
});

function fakeStore(rows: ClaimedCaseAlert[], f: CaseAlertFacts) {
  const log: string[] = [];
  const store: CaseAlertStore = {
    async holdUnconfigured() {
      log.push("hold_unconfigured");
      return rows.length;
    },
    async cancelStale() {
      return 0;
    },
    async claimDue() {
      return rows;
    },
    async loadFacts() {
      return f;
    },
    async markSent(e) {
      log.push(`sent:${e.id}`);
    },
    async markFailed(e, c) {
      log.push(`failed:${e.id}:${c}`);
    },
    async markHeld(e, r) {
      log.push(`held:${e.id}:${r}`);
    },
    async markCancelled(e, r) {
      log.push(`cancelled:${e.id}:${r}`);
    },
  };
  return { store, log };
}

function fakeMailer(results: MailResult[] = []): UcMailer & { outbox: Array<{ email: OutgoingEmail; key: string }> } {
  const outbox: Array<{ email: OutgoingEmail; key: string }> = [];
  return {
    outbox,
    async send(email, options) {
      outbox.push({ email, key: options.idempotencyKey });
      return results.shift() ?? { ok: true };
    },
  };
}

test("motore: mittente, reply-to, chiave di idempotenza «ca:<id>:a<tentativo>», solo nella finestra di Roma", async () => {
  const { store, log } = fakeStore([claimed({ id: "c1", attempts: 1 })], facts());
  const mailer = fakeMailer();
  const summary = await runCaseAlertDispatch(store, { env: ENV, now: at("2026-11-02", 10), mailer, sendIntervalMs: 0 });
  assert.deepEqual(summary, { sent: 1, failed: 0, held: 0, cancelled: 0, notConfigured: 0 });
  assert.equal(mailer.outbox.length, 1);
  const sent = mailer.outbox[0];
  assert.equal(sent.email.from, ENV.UC_EMAIL_FROM);
  assert.equal(sent.email.replyTo, "persona@example.test");
  assert.equal(sent.email.to, "lead@lateralspace.ai");
  assert.equal(sent.key, "ca:c1:a2");
  assert.deepEqual(log, ["sent:c1"]);
  // Fuori dalla finestra (sabato, o alle 19) non parte niente.
  for (const now of [at("2026-11-07", 10), at("2026-11-02", 19)]) {
    const other = fakeMailer();
    await runCaseAlertDispatch(fakeStore([claimed()], facts()).store, { env: ENV, now, mailer: other, sendIntervalMs: 0 });
    assert.equal(other.outbox.length, 0);
  }
});

test("motore: senza RESEND_API_KEY restano in coda (email_non_configurata); un errore si conta e il rate limit ferma il giro", async () => {
  const unconfigured = fakeStore([claimed()], facts());
  const none = fakeMailer();
  const s1 = await runCaseAlertDispatch(unconfigured.store, { env: { ...ENV, RESEND_API_KEY: undefined }, now: at("2026-11-02", 10), mailer: none });
  assert.equal(s1.notConfigured, 1);
  assert.deepEqual(unconfigured.log, ["hold_unconfigured"]);
  assert.equal(none.outbox.length, 0);
  const failing = fakeStore([claimed({ id: "x1" }), claimed({ id: "x2" })], facts());
  const limited = fakeMailer([{ ok: false, code: "rate_limit_exceeded", ambiguous: false }]);
  const s2 = await runCaseAlertDispatch(failing.store, { env: ENV, now: at("2026-11-02", 10), mailer: limited, sendIntervalMs: 0 });
  assert.deepEqual([s2.sent, s2.failed], [0, 1]);
  assert.deepEqual(failing.log, ["failed:x1:rate_limit_exceeded"], "si ferma al primo rate limit");
  const held = fakeStore([claimed()], facts({ subprocessorsAuthorized: false }));
  const s3 = await runCaseAlertDispatch(held.store, { env: ENV, now: at("2026-11-02", 10), mailer: fakeMailer(), sendIntervalMs: 0 });
  assert.equal(s3.held, 1);
  assert.deepEqual(held.log, ["held:c1:sub_responsabili_mancanti"]);
});
