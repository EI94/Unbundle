import test from "node:test";
import assert from "node:assert/strict";
import {
  DISPATCH_BATCH_LIMIT,
  HOLD_CASE_SUSPENDED,
  RATE_LIMIT_CODE,
  emailOrigin,
  emailReplyTo,
  idempotencyKeyFor,
  isPlainAddress,
  mailResultFromError,
  planDelivery,
  runDispatch,
  ucEmailConfig,
  type AfterSent,
  type ClaimedNotification,
  type DeliveryFacts,
  type DeliveryRequestFacts,
  type DispatchStore,
  type MailResult,
  type OutgoingEmail,
  type UcMailer,
} from "./dispatch.ts";

// Pure tests for the dispatch engine (PIANO §7.1): configuration, the decision
// for each queued row (send, hold, cancel) and the dispatch loop on a fake store
// and a fake mailer. No network, no database. The same engine runs against the
// harness in notifications.integration.test.ts.

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444";
const OWNER = "55555555-5555-4555-8555-555555555555";
const COLLEAGUE = "66666666-6666-4666-8666-666666666666";
const USER = "77777777-7777-4777-8777-777777777777";
const NOTIF = "88888888-8888-4888-8888-888888888888";
const TOKEN_ID = "99999999-9999-4999-8999-999999999999";
const TOKEN = "ucr_" + "Ab3_-".repeat(6) + "xy";
// Monday 12 October 2026, 11:30 in Rome: inside the send window.
const NOW = new Date("2026-10-12T09:30:00Z");
// Saturday: outside the window.
const SATURDAY = new Date("2026-10-17T09:30:00Z");
const EXPIRES = new Date("2026-11-01T09:00:00Z");
const LS = ["ls.test"];
const ENV = { RESEND_API_KEY: "re_test", UC_EMAIL_FROM: "Lateral Space via Unbundle <casi@mittente.test>", NEXT_PUBLIC_APP_URL: "https://app.unbundle.test" };
const OPTS = { origin: "https://app.unbundle.test", lsDomains: LS, now: NOW };

function claimed(over: Partial<ClaimedNotification> = {}): ClaimedNotification {
  return {
    id: NOTIF,
    workspaceId: WS,
    caseId: CASE,
    requestId: REQ,
    recipientContactId: CONTACT,
    recipientUserId: null,
    templateKey: "richiesta_inviata",
    payload: {},
    attempts: 0,
    dedupeKey: `richiesta:${REQ}:0:2026-10-12`,
    ...over,
  };
}

function request(over: Partial<DeliveryRequestFacts> = {}): DeliveryRequestFacts {
  return {
    id: REQ,
    purpose: "raccolta",
    status: "inviata",
    contactId: CONTACT,
    delegatedByContactId: null,
    live: true,
    sentAt: new Date("2026-10-01T08:00:00Z"),
    expiresAt: EXPIRES,
    reminderCount: 0,
    escalatedAt: null,
    openItems: 4,
    minutes: 12,
    message: null,
    roleLabel: "Controllo di gestione",
    ...over,
  };
}

function facts(over: Partial<DeliveryFacts> = {}): DeliveryFacts {
  return {
    clientName: "Cliente prova",
    case: { id: CASE, code: "UC-PROVA", title: "Caso di prova", status: "raccolta", ownerContactId: OWNER, designated: { owner: OWNER, privacy: null } },
    recipient: { kind: "contact", id: CONTACT, email: "referente@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false },
    request: request(),
    ...over,
  };
}

function sendPlan(n: ClaimedNotification, f: DeliveryFacts) {
  const plan = planDelivery(n, f, OPTS);
  assert.equal(plan.action, "send", plan.action === "send" ? "" : `${plan.action}: ${plan.reason}`);
  return plan as Extract<ReturnType<typeof planDelivery>, { action: "send" }>;
}

test("email configuration: key, sender and public origin are all needed", () => {
  assert.deepEqual(ucEmailConfig({}), { ok: false, missing: ["RESEND_API_KEY", "UC_EMAIL_FROM", "NEXT_PUBLIC_APP_URL"] });
  assert.deepEqual(ucEmailConfig({ ...ENV, RESEND_API_KEY: "  " }), { ok: false, missing: ["RESEND_API_KEY"] });
  assert.deepEqual(ucEmailConfig({ ...ENV, UC_EMAIL_FROM: "a@b.test, c@d.test" }), { ok: false, missing: ["UC_EMAIL_FROM"] });
  assert.deepEqual(ucEmailConfig({ ...ENV, UC_EMAIL_FROM: "Nome\r\nBcc: x@y.test <a@b.test>" }), { ok: false, missing: ["UC_EMAIL_FROM"] });
  const ok = ucEmailConfig(ENV);
  assert.ok(ok.ok);
  assert.deepEqual(ok.config, { apiKey: "re_test", from: ENV.UC_EMAIL_FROM, origin: "https://app.unbundle.test" });
  assert.ok(ucEmailConfig({ ...ENV, UC_EMAIL_FROM: "casi@mittente.test" }).ok, "a bare address is a valid sender");
});

test("reply-to: UC_EMAIL_REPLY_TO only as one plain address, lower case; anything else is ignored", () => {
  assert.equal(emailReplyTo({ UC_EMAIL_REPLY_TO: " Risposte@Mittente.TEST " }), "risposte@mittente.test");
  assert.equal(emailReplyTo({}), null, "missing");
  assert.equal(emailReplyTo({ UC_EMAIL_REPLY_TO: "   " }), null, "blank");
  for (const bad of [
    "Nome <risposte@mittente.test>",
    "risposte@mittente.test, altro@esterno.test",
    "risposte@mittente.test;altro@esterno.test",
    "risposte@mittente.test\r\nBcc: altro@esterno.test",
    "risposte@mittente.test\nBcc: altro@esterno.test",
    "\"Nome\" risposte@mittente.test",
    "risposte",
    "@mittente.test",
    "risposte@",
    "risposte@mittente",
  ]) {
    assert.equal(emailReplyTo({ UC_EMAIL_REPLY_TO: bad }), null, JSON.stringify(bad));
  }
  // The configuration carries it only when valid; it never makes email «not configured».
  const withReply = ucEmailConfig({ ...ENV, UC_EMAIL_REPLY_TO: "Risposte@Mittente.test" });
  assert.ok(withReply.ok);
  assert.equal(withReply.config.replyTo, "risposte@mittente.test");
  const invalid = ucEmailConfig({ ...ENV, UC_EMAIL_REPLY_TO: "Nome <risposte@mittente.test>" });
  assert.ok(invalid.ok, "an invalid reply-to does not switch email off");
  assert.equal("replyTo" in invalid.config, false);
});

test("email origin: never a preview URL, https only (http only on loopback), no credentials", () => {
  assert.equal(emailOrigin({ NEXT_PUBLIC_APP_URL: "https://www.unbundle.test/qualcosa?x=1" }), "https://www.unbundle.test");
  assert.equal(emailOrigin({ APP_URL: "app.unbundle.test" }), "https://app.unbundle.test");
  assert.equal(emailOrigin({ VERCEL_PROJECT_PRODUCTION_URL: "prod.unbundle.test" }), "https://prod.unbundle.test");
  assert.equal(emailOrigin({ VERCEL_URL: "anteprima-123.vercel.app" }), null, "the per-deployment URL is not used");
  assert.equal(emailOrigin({ NEXT_PUBLIC_APP_URL: "http://app.unbundle.test" }), null);
  assert.equal(emailOrigin({ NEXT_PUBLIC_APP_URL: "http://127.0.0.1:53110" }), "http://127.0.0.1:53110");
  assert.equal(emailOrigin({ NEXT_PUBLIC_APP_URL: "https://u:p@app.unbundle.test", APP_URL: "https://altro.unbundle.test" }), "https://altro.unbundle.test");
  assert.equal(emailOrigin({ NEXT_PUBLIC_APP_URL: "not a url" }), null);
});

test("recipient addresses: one plain address, nothing that could add a recipient", () => {
  assert.equal(isPlainAddress("referente@cliente.test"), true);
  for (const bad of [null, undefined, "", "a@b", "Nome <a@b.test>", "a@b.test, c@d.test", "a@b.test\r\nBcc: c@d.test", "a b@c.test"]) {
    assert.equal(isPlainAddress(bad), false, String(bad));
  }
});

test("provider errors become codes; network and 5xx are ambiguous, 4xx are not", () => {
  assert.deepEqual(mailResultFromError(null), { ok: true });
  assert.deepEqual(mailResultFromError({ name: "validation_error", statusCode: 422, message: "a@b.test is invalid" }), { ok: false, code: "validation_error", ambiguous: false });
  assert.deepEqual(mailResultFromError({ name: "rate_limit_exceeded", statusCode: 429 }), { ok: false, code: "rate_limit_exceeded", ambiguous: false });
  assert.deepEqual(mailResultFromError({ name: "application_error", statusCode: null }), { ok: false, code: "application_error", ambiguous: true });
  assert.deepEqual(mailResultFromError({ name: "internal_server_error", statusCode: 500 }), { ok: false, code: "internal_server_error", ambiguous: true });
  const weird = mailResultFromError({ name: "Errore con spazi e a@b.test" });
  assert.deepEqual(weird, { ok: false, code: "errore_invio", ambiguous: true }, "a provider message never becomes the code");
});

test("idempotency key: one per attempt, so a retry after an error can still go", () => {
  assert.equal(idempotencyKeyFor("promemoria_1:abc", 1), "promemoria_1:abc:a1");
  assert.notEqual(idempotencyKeyFor("k", 1), idempotencyKeyFor("k", 2));
});

test("request email: link issued at send time for the same live request and referent", () => {
  const plan = sendPlan(claimed(), facts());
  assert.equal(plan.to, "referente@cliente.test");
  assert.deepEqual(plan.link, { requestId: REQ, issuedFor: "invio" });
  assert.equal(plan.after, null);
  const input = plan.build(`https://app.unbundle.test/r/${TOKEN}`);
  assert.equal(input.template, "richiesta_inviata");
  assert.ok(input.template === "richiesta_inviata" && input.questions === 4 && input.minutes === 12);
  assert.throws(() => plan.build(null), /link/);
  const upper = planDelivery(claimed(), facts({ recipient: { kind: "contact", id: CONTACT, email: "Referente@Cliente.TEST", reachable: true, digestOptOut: false, lateralSpace: false } }), OPTS);
  assert.ok(upper.action === "send" && upper.to === "referente@cliente.test");
});

test("request email: cancelled when it no longer makes sense", () => {
  const cases: [string, ClaimedNotification, DeliveryFacts][] = [
    ["destinatario_non_raggiungibile", claimed(), facts({ recipient: { kind: "contact", id: CONTACT, email: "referente@cliente.test", reachable: false, digestOptOut: false, lateralSpace: false } })],
    ["destinatario_non_raggiungibile", claimed(), facts({ recipient: { kind: "contact", id: CONTACT, email: null, reachable: true, digestOptOut: false, lateralSpace: false } })],
    ["destinatario_non_raggiungibile", claimed(), facts({ recipient: null })],
    ["caso_assente", claimed(), facts({ case: null })],
    ["caso_chiuso", claimed(), facts({ case: { ...facts().case!, status: "chiuso" } })],
    ["richiesta_non_viva", claimed(), facts({ request: request({ live: false }) })],
    ["richiesta_assente", claimed(), facts({ request: null })],
    ["richiesta_non_ammessa", claimed(), facts({ request: request({ purpose: "approvazioni" }) })],
    ["destinatario_cambiato", claimed(), facts({ request: request({ contactId: COLLEAGUE }) })],
    ["nessuna_domanda_aperta", claimed(), facts({ request: request({ openItems: 0 }) })],
    ["destinatario_lateral_space", claimed(), facts({ recipient: { kind: "contact", id: CONTACT, email: "persona@ls.test", reachable: true, digestOptOut: false, lateralSpace: false } })],
    ["modello_non_previsto", claimed({ templateKey: "risposta_ricevuta" }), facts()],
    ["modello_non_previsto", claimed({ templateKey: "scadenza_vicina" }), facts()],
  ];
  for (const [reason, n, f] of cases) assert.deepEqual(planDelivery(n, f, OPTS), { action: "cancel", reason }, reason);
});

test("a suspended case holds the queue with a clear reason", () => {
  assert.deepEqual(planDelivery(claimed(), facts({ case: { ...facts().case!, status: "sospeso" } }), OPTS), { action: "hold", reason: HOLD_CASE_SUSPENDED });
});

test("reminders: only the expected one, with a fresh token and the next reminder date", () => {
  const first = sendPlan(claimed({ templateKey: "promemoria_1" }), facts());
  assert.deepEqual(first.link, { requestId: REQ, issuedFor: "promemoria" });
  assert.equal(first.after?.kind, "promemoria");
  const after = first.after as Extract<AfterSent, { kind: "promemoria" }>;
  assert.equal(after.reminder, 1);
  // Sent on 1 October: the second reminder is due 7 working days later, at 9:00 in Rome.
  assert.equal(after.nextReminderAt?.toISOString(), "2026-10-12T07:00:00.000Z");
  const second = sendPlan(claimed({ templateKey: "promemoria_2" }), facts({ request: request({ reminderCount: 1 }) }));
  assert.equal((second.after as Extract<AfterSent, { kind: "promemoria" }>).reminder, 2);
  assert.deepEqual(planDelivery(claimed({ templateKey: "promemoria_1" }), facts({ request: request({ reminderCount: 1 }) }), OPTS), { action: "cancel", reason: "promemoria_gia_fatto" });
  assert.deepEqual(planDelivery(claimed({ templateKey: "promemoria_2" }), facts({ request: request({ status: "completata" }) }), OPTS), { action: "cancel", reason: "richiesta_completata" });
  assert.deepEqual(planDelivery(claimed({ templateKey: "promemoria_1" }), facts({ request: request({ openItems: 0 }) }), OPTS), { action: "cancel", reason: "nessuna_domanda_aperta" });
});

test("Owner escalation: after two reminders, to the case Owner, never to the referent or to Lateral Space", () => {
  const n = claimed({ templateKey: "segnalazione_owner", recipientContactId: OWNER });
  const ownerFacts = (over: Partial<DeliveryFacts> = {}) =>
    facts({
      recipient: { kind: "contact", id: OWNER, email: "owner@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false },
      request: request({ reminderCount: 2 }),
      openItemList: [{ key: "q.costi.01", title: "Costo orario" }],
      ...over,
    });
  const plan = sendPlan(n, ownerFacts());
  assert.equal(plan.link, null, "no referent link in the Owner email");
  assert.deepEqual(plan.after, { kind: "segnalazione" });
  const input = plan.build(null);
  assert.ok(input.template === "segnalazione_owner" && input.items.length === 1 && input.roleLabel === "Controllo di gestione");
  assert.deepEqual(planDelivery(n, ownerFacts({ request: request({ reminderCount: 1 }) }), OPTS), { action: "cancel", reason: "promemoria_mancanti" });
  assert.deepEqual(planDelivery(n, ownerFacts({ request: request({ reminderCount: 2, escalatedAt: NOW }) }), OPTS), { action: "cancel", reason: "gia_segnalata" });
  assert.deepEqual(
    planDelivery(n, ownerFacts({ case: { ...facts().case!, ownerContactId: COLLEAGUE, designated: { owner: COLLEAGUE, privacy: null } } }), OPTS),
    { action: "cancel", reason: "owner_cambiato" },
  );
  assert.deepEqual(
    planDelivery(n, ownerFacts({ recipient: { kind: "contact", id: OWNER, email: "owner@ls.test", reachable: true, digestOptOut: false, lateralSpace: false } }), OPTS),
    { action: "cancel", reason: "destinatario_lateral_space" },
  );
  const self = claimed({ templateKey: "segnalazione_owner", recipientContactId: CONTACT });
  assert.deepEqual(planDelivery(self, facts({ request: request({ reminderCount: 2 }) }), OPTS), { action: "cancel", reason: "destinatario_cambiato" });
});

test("delegation: the colleague gets a delegation link, the delegating referent only a confirmation", () => {
  const delegated = request({ contactId: COLLEAGUE, delegatedByContactId: CONTACT, openItems: 2, message: "Puoi rispondere tu?" });
  const colleague = sendPlan(
    claimed({ templateKey: "delega", recipientContactId: COLLEAGUE }),
    facts({ request: delegated, recipient: { kind: "contact", id: COLLEAGUE, email: "collega@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false } }),
  );
  assert.deepEqual(colleague.link, { requestId: REQ, issuedFor: "delega" });
  const colleagueInput = colleague.build(`https://app.unbundle.test/r/${TOKEN}`);
  assert.ok(colleagueInput.template === "delega" && colleagueInput.audience === "collega" && colleagueInput.questions === 2);
  const delegating = sendPlan(claimed({ templateKey: "delega", payload: { items: 3 } }), facts({ request: delegated }));
  assert.equal(delegating.link, null, "the confirmation carries no link");
  const confirmation = delegating.build(null);
  assert.ok(confirmation.template === "delega" && confirmation.audience === "delegante" && confirmation.questions === 3);
  const stranger = claimed({ templateKey: "delega", recipientContactId: OWNER });
  assert.deepEqual(
    planDelivery(stranger, facts({ request: delegated, recipient: { kind: "contact", id: OWNER, email: "owner@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false } }), OPTS),
    { action: "cancel", reason: "destinatario_cambiato" },
  );
});

test("approval links: only by email to the designated signer, never to Lateral Space", () => {
  const n = claimed({ templateKey: "richiesta_approvazione", recipientContactId: OWNER, payload: { designation: "owner" } });
  const approval = (over: Partial<DeliveryFacts> = {}) =>
    facts({
      recipient: { kind: "contact", id: OWNER, email: "owner@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false },
      request: request({ purpose: "approvazioni", contactId: OWNER }),
      approvals: { pending: 2, signer: { ok: true, value: undefined } },
      ...over,
    });
  const plan = sendPlan(n, approval());
  assert.deepEqual(plan.link, { requestId: REQ, issuedFor: "invio" });
  const input = plan.build(`https://app.unbundle.test/r/${TOKEN}`);
  assert.ok(input.template === "richiesta_approvazione" && input.pending === 2 && input.designation === "owner");
  assert.deepEqual(planDelivery({ ...n, payload: { designation: "privacy" } }, approval(), OPTS), { action: "cancel", reason: "firmatario_cambiato" });
  assert.deepEqual(planDelivery({ ...n, payload: {} }, approval(), OPTS), { action: "cancel", reason: "firmatario_cambiato" });
  assert.deepEqual(
    planDelivery(n, approval({ approvals: { pending: 1, signer: { ok: false, code: "firmatario_lateral_space", message: "" } } }), OPTS),
    { action: "cancel", reason: "firmatario_non_ammesso" },
  );
  assert.deepEqual(planDelivery(n, approval({ approvals: { pending: 0, signer: { ok: true, value: undefined } } }), OPTS), { action: "cancel", reason: "nessuna_firma_in_attesa" });
  assert.deepEqual(planDelivery(n, approval({ request: request({ purpose: "raccolta", contactId: OWNER }) }), OPTS), { action: "cancel", reason: "richiesta_non_ammessa" });
});

test("clarification: a fresh link to the referent of the answer", () => {
  const plan = sendPlan(claimed({ templateKey: "chiarimento", payload: { item_id: TOKEN_ID } }), facts({ itemTitle: "Costo orario" }));
  assert.deepEqual(plan.link, { requestId: REQ, issuedFor: "invio" });
  const input = plan.build(`https://app.unbundle.test/r/${TOKEN}`);
  assert.ok(input.template === "chiarimento" && input.itemTitle === "Costo orario");
});

test("weekly summary: the Owner gets bar and missing items without internal links; Lateral Space gets case links", () => {
  const summary = { caseId: CASE, code: "UC-PROVA", title: "Caso di prova", total: 10, counts: { validata: 4, chiesta: 6 }, greenPct: 40, g1: { required: 8, ok: 3 }, redItems: [{ key: "q.a.01", title: "Voce" }], nextMilestone: null };
  const ownerN = claimed({ templateKey: "riepilogo_settimanale", caseId: null, requestId: null, recipientContactId: OWNER, payload: { week: "2026-W42" } });
  const ownerFacts = facts({ case: null, request: null, recipient: { kind: "contact", id: OWNER, email: "owner@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false }, weekly: { cases: [summary] } });
  const owner = sendPlan(ownerN, ownerFacts).build(null);
  assert.ok(owner.template === "riepilogo_settimanale" && owner.audience === "owner" && owner.week === "2026-W42");
  assert.equal(owner.cases[0].link, null);
  assert.equal(owner.cases[0].redItems?.length, 1);
  assert.deepEqual(planDelivery(ownerN, { ...ownerFacts, recipient: { ...ownerFacts.recipient!, digestOptOut: true } }, OPTS), { action: "cancel", reason: "riepilogo_disattivato" });
  assert.deepEqual(planDelivery(ownerN, { ...ownerFacts, weekly: { cases: [] } }, OPTS), { action: "cancel", reason: "nessun_caso" });

  const lsN = claimed({ templateKey: "riepilogo_settimanale", caseId: null, requestId: null, recipientContactId: null, recipientUserId: USER, payload: { week: "2026-W42" } });
  const lsFacts = facts({ case: null, request: null, recipient: { kind: "user", id: USER, email: "lead@ls.test", reachable: true, digestOptOut: false, lateralSpace: true }, weekly: { cases: [summary] } });
  const ls = sendPlan(lsN, lsFacts).build(null);
  assert.ok(ls.template === "riepilogo_settimanale" && ls.audience === "ls");
  assert.equal(ls.cases[0].link, `https://app.unbundle.test/dashboard/${WS}/casi-duso/${CASE}`);
  assert.equal(ls.cases[0].redItems, undefined, "Lateral Space gets counts, not the Owner's list");
  assert.deepEqual(planDelivery(lsN, { ...lsFacts, recipient: { ...lsFacts.recipient!, lateralSpace: false } }, OPTS), { action: "cancel", reason: "destinatario_non_lateral_space" });
});

// ── Dispatch loop on a fake store ─────────────────────────────────────

interface FakeStore extends DispatchStore {
  log: string[];
  issued: string[];
  revoked: string[];
  sent: { n: ClaimedNotification; after: AfterSent }[];
  failed: { id: string; code: string }[];
  held: { id: string; reason: string }[];
  cancelled: { id: string; reason: string }[];
  claims: { caseId: string | null; workspaceId: string | null; limit: number; includeWindowed: boolean }[];
}

function fakeStore(rows: ClaimedNotification[], factsFor: (n: ClaimedNotification) => DeliveryFacts, o: { issue?: "ok" | "non_viva" } = {}): FakeStore {
  const s: FakeStore = {
    log: [],
    issued: [],
    revoked: [],
    sent: [],
    failed: [],
    held: [],
    cancelled: [],
    claims: [],
    async markInAppDelivered() {
      s.log.push("in_app");
      return 2;
    },
    async holdUnconfigured() {
      s.log.push("hold_unconfigured");
      return rows.length;
    },
    async claimDue(i) {
      s.log.push("claim");
      s.claims.push(i);
      return rows.slice(0, i.limit);
    },
    async loadFacts(n) {
      return factsFor(n);
    },
    async issueToken(i) {
      if (o.issue === "non_viva") return { ok: false, code: "richiesta_non_viva" };
      s.issued.push(`${i.requestId}:${i.issuedFor}`);
      return { ok: true, token: TOKEN, tokenId: TOKEN_ID };
    },
    async revokeToken(i) {
      s.revoked.push(i.tokenId);
    },
    async markSent(n, after) {
      s.sent.push({ n, after });
    },
    async markFailed(n, code) {
      s.failed.push({ id: n.id, code });
    },
    async markHeld(n, reason) {
      s.held.push({ id: n.id, reason });
    },
    async markCancelled(n, reason) {
      s.cancelled.push({ id: n.id, reason });
    },
  };
  return s;
}

function fakeMailer(results: MailResult[] = []): UcMailer & { emails: { email: OutgoingEmail; key: string }[] } {
  const emails: { email: OutgoingEmail; key: string }[] = [];
  return {
    emails,
    async send(email, options) {
      emails.push({ email, key: options.idempotencyKey });
      return results.shift() ?? { ok: true };
    },
  };
}

test("without email configuration the bell is delivered and emails stay queued with a reason", async () => {
  const store = fakeStore([claimed()], () => facts());
  const mailer = fakeMailer();
  const summary = await runDispatch(store, { env: {}, lsDomains: LS, now: NOW, mailer, sendIntervalMs: 0 });
  assert.deepEqual(store.log, ["in_app", "hold_unconfigured"]);
  assert.deepEqual(summary, { bell: 2, sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 1 });
  assert.equal(mailer.emails.length, 0);
  assert.equal(store.issued.length, 0, "no token without an email to carry it");
});

test("configured: the token is issued at send time and goes only into the email", async () => {
  const rows = [claimed(), claimed({ id: TOKEN_ID, templateKey: "segnalazione_owner", recipientContactId: OWNER, attempts: 1, dedupeKey: `owner:${REQ}` })];
  const store = fakeStore(rows, (n) =>
    n.templateKey === "segnalazione_owner"
      ? facts({ recipient: { kind: "contact", id: OWNER, email: "owner@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false }, request: request({ reminderCount: 2 }), openItemList: [] })
      : facts(),
  );
  const mailer = fakeMailer();
  const summary = await runDispatch(store, { env: ENV, lsDomains: LS, now: NOW, mailer, sendIntervalMs: 0 });
  assert.deepEqual(summary, { bell: 2, sent: 2, failed: 0, held: 0, cancelled: 0, notConfigured: 0 });
  assert.deepEqual(store.claims, [{ caseId: null, workspaceId: null, limit: DISPATCH_BATCH_LIMIT, includeWindowed: true }]);
  assert.deepEqual(store.issued, [`${REQ}:invio`], "the Owner email needs no token");
  const [request0, owner] = mailer.emails;
  assert.equal(request0.email.from, ENV.UC_EMAIL_FROM);
  assert.equal(request0.email.to, "referente@cliente.test");
  assert.ok(request0.email.text.includes(`https://app.unbundle.test/r/${TOKEN}`));
  assert.ok(request0.email.html.includes(`https://app.unbundle.test/r/${TOKEN}`));
  assert.equal(request0.key, `richiesta:${REQ}:0:2026-10-12:a1`);
  assert.equal(owner.key, `owner:${REQ}:a2`);
  assert.ok(!owner.email.text.includes("/r/"), "no referent link to the Owner");
  assert.deepEqual(store.sent.map((x) => x.after), [null, { kind: "segnalazione" }]);
});

test("reply-to on dossier emails: UC_EMAIL_REPLY_TO when valid, no header when missing or invalid", async () => {
  const run = async (env: Record<string, string>) => {
    const rows = [claimed(), claimed({ id: TOKEN_ID, templateKey: "segnalazione_owner", recipientContactId: OWNER, dedupeKey: `owner:${REQ}` })];
    const store = fakeStore(rows, (n) =>
      n.templateKey === "segnalazione_owner"
        ? facts({ recipient: { kind: "contact", id: OWNER, email: "owner@cliente.test", reachable: true, digestOptOut: false, lateralSpace: false }, request: request({ reminderCount: 2 }), openItemList: [] })
        : facts(),
    );
    const mailer = fakeMailer();
    await runDispatch(store, { env, lsDomains: LS, now: NOW, mailer, sendIntervalMs: 0 });
    assert.equal(mailer.emails.length, 2);
    return mailer.emails.map((x) => x.email);
  };
  for (const email of await run({ ...ENV, UC_EMAIL_REPLY_TO: "Risposte@LS.test" })) assert.equal(email.replyTo, "risposte@ls.test");
  for (const env of [ENV, { ...ENV, UC_EMAIL_REPLY_TO: "risposte@ls.test\r\nBcc: x@y.test" }, { ...ENV, UC_EMAIL_REPLY_TO: "a@b.test, c@d.test" }]) {
    for (const email of await run(env)) assert.equal("replyTo" in email, false, "no reply-to header");
  }
});

test("outside the Rome window reminders and summaries are not even claimed", async () => {
  const store = fakeStore([], () => facts());
  await runDispatch(store, { env: ENV, lsDomains: LS, now: SATURDAY, mailer: fakeMailer(), sendIntervalMs: 0, caseId: CASE, workspaceId: WS, limit: 5 });
  assert.deepEqual(store.claims, [{ caseId: CASE, workspaceId: WS, limit: 5, includeWindowed: false }]);
});

test("a certain failure revokes the new token; an uncertain one keeps it valid", async () => {
  const certain = fakeStore([claimed()], () => facts());
  const s1 = await runDispatch(certain, { env: ENV, lsDomains: LS, now: NOW, mailer: fakeMailer([{ ok: false, code: "validation_error", ambiguous: false }]), sendIntervalMs: 0 });
  assert.equal(s1.failed, 1);
  assert.deepEqual(certain.revoked, [TOKEN_ID]);
  assert.deepEqual(certain.failed, [{ id: NOTIF, code: "validation_error" }]);

  const uncertain = fakeStore([claimed()], () => facts());
  await runDispatch(uncertain, { env: ENV, lsDomains: LS, now: NOW, mailer: fakeMailer([{ ok: false, code: "application_error", ambiguous: true }]), sendIntervalMs: 0 });
  assert.deepEqual(uncertain.revoked, [], "the email may have left: its link must work");
  assert.deepEqual(uncertain.failed, [{ id: NOTIF, code: "application_error" }]);
});

test("a provider rate limit stops the round; the other rows wait for the lease", async () => {
  const rows = [claimed(), claimed({ id: TOKEN_ID }), claimed({ id: USER })];
  const store = fakeStore(rows, () => facts());
  const mailer = fakeMailer([{ ok: true }, { ok: false, code: RATE_LIMIT_CODE, ambiguous: false }]);
  const summary = await runDispatch(store, { env: ENV, lsDomains: LS, now: NOW, mailer, sendIntervalMs: 0 });
  assert.equal(mailer.emails.length, 2);
  assert.deepEqual([summary.sent, summary.failed], [1, 1]);
  assert.deepEqual(store.failed, [{ id: TOKEN_ID, code: RATE_LIMIT_CODE }]);
});

test("sends are paced so the provider limit is respected", async () => {
  const rows = [claimed(), claimed({ id: TOKEN_ID }), claimed({ id: USER })];
  const store = fakeStore(rows, () => facts());
  const times: number[] = [];
  const mailer: UcMailer = {
    async send() {
      times.push(Date.now());
      return { ok: true };
    },
  };
  await runDispatch(store, { env: ENV, lsDomains: LS, now: NOW, mailer, sendIntervalMs: 40 });
  assert.equal(times.length, 3);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 35, `gap ${times[i] - times[i - 1]} ms`);
});

test("hold, cancel, dead request and unreadable facts are recorded without sending", async () => {
  const suspended = fakeStore([claimed()], () => facts({ case: { ...facts().case!, status: "sospeso" } }));
  const mailer = fakeMailer();
  assert.equal((await runDispatch(suspended, { env: ENV, lsDomains: LS, now: NOW, mailer, sendIntervalMs: 0 })).held, 1);
  assert.deepEqual(suspended.held, [{ id: NOTIF, reason: HOLD_CASE_SUSPENDED }]);

  const closed = fakeStore([claimed()], () => facts({ case: { ...facts().case!, status: "chiuso" } }));
  assert.equal((await runDispatch(closed, { env: ENV, lsDomains: LS, now: NOW, mailer, sendIntervalMs: 0 })).cancelled, 1);
  assert.deepEqual(closed.cancelled, [{ id: NOTIF, reason: "caso_chiuso" }]);

  const dead = fakeStore([claimed()], () => facts(), { issue: "non_viva" });
  assert.equal((await runDispatch(dead, { env: ENV, lsDomains: LS, now: NOW, mailer, sendIntervalMs: 0 })).cancelled, 1);
  assert.deepEqual(dead.cancelled, [{ id: NOTIF, reason: "richiesta_non_viva" }], "the database clock decides at send time");

  const broken = fakeStore([claimed()], () => {
    throw new Error("rete");
  });
  assert.equal((await runDispatch(broken, { env: ENV, lsDomains: LS, now: NOW, mailer, sendIntervalMs: 0 })).failed, 1);
  assert.deepEqual(broken.failed, [{ id: NOTIF, code: "dati_non_letti" }]);
  assert.equal(mailer.emails.length, 0);
});

test("a text that cannot be rendered revokes the token and never reaches the mailer", async () => {
  const store = fakeStore([claimed()], () => facts());
  const original = store.issueToken.bind(store);
  store.issueToken = async (i) => {
    const r = await original(i);
    return r.ok ? { ...r, token: "non-un-token" } : r;
  };
  const mailer = fakeMailer();
  const summary = await runDispatch(store, { env: ENV, lsDomains: LS, now: NOW, mailer, sendIntervalMs: 0 });
  assert.equal(summary.failed, 1);
  assert.deepEqual(store.revoked, [TOKEN_ID]);
  assert.deepEqual(store.failed, [{ id: NOTIF, code: "testo_non_valido" }]);
  assert.equal(mailer.emails.length, 0);
});
