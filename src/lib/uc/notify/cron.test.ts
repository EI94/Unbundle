import test from "node:test";
import assert from "node:assert/strict";
import type { UcExecutor, UcRow } from "../../db/uc-executor.ts";
import {
  expiredRequestItemsReleaseSql,
  expiredRequestNotificationsCancelSql,
  expiringRequestsSql,
  overdueItemsSql,
  reminderCandidatesSql,
  reminderStatements,
  reminderStep,
  requestExpireSql,
  rowToExpiringRequest,
  staleItemsSql,
  weeklyStatements,
  type ReminderCandidate,
} from "../../db/queries/uc-cron.ts";
import {
  claimDueSql,
  dispatchDue,
  holdUnconfiguredSql,
  markBellReadSql,
  markCancelledSql,
  markFailedSql,
  markHeldSql,
  markInAppDeliveredSql,
  markSentStatements,
  unreadBellSql,
  unreadForUser,
} from "../../db/queries/uc-notifications-dispatch.ts";
import type { UcStatement } from "../sql/statement.ts";
import type { ClaimedNotification } from "./dispatch.ts";

// Pure tests for the cron plan (src/lib/db/queries/uc-cron.ts) and the SQL of the
// queue (src/lib/db/queries/uc-notifications-dispatch.ts): what each step decides,
// which guards each statement carries and that no token, name or value ends up in
// a queued row. The statements run against Postgres in notifications.integration.test.ts.

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const REQ = "33333333-3333-4333-8333-333333333333";
const CONTACT = "44444444-4444-4444-8444-444444444444";
const OWNER = "55555555-5555-4555-8555-555555555555";
const USER = "77777777-7777-4777-8777-777777777777";
const NOTIF = "88888888-8888-4888-8888-888888888888";
// Monday 12 October 2026, 11:30 in Rome.
const NOW = new Date("2026-10-12T09:30:00Z");
const EVENING = new Date("2026-10-12T17:30:00Z");

function candidate(over: Partial<ReminderCandidate> = {}): ReminderCandidate {
  return {
    requestId: REQ,
    caseId: CASE,
    workspaceId: WS,
    caseCode: "UC-PROVA",
    caseStatus: "raccolta",
    status: "inviata",
    purpose: "raccolta",
    // Tuesday 6 October: 4 working days before NOW.
    sentAt: new Date("2026-10-06T08:00:00Z"),
    expiresAt: new Date("2026-11-05T08:00:00Z"),
    reminderCount: 0,
    escalatedAt: null,
    contactId: CONTACT,
    contactReachable: true,
    ownerContactId: OWNER,
    ownerReachable: true,
    ...over,
  };
}

/** Parametri come testo: i jsonb restano JSON leggibile (`"case_code":"UC-1"`). */
const params = (s: UcStatement) => s.params.map((p) => (typeof p === "string" ? p : JSON.stringify(p))).join(" | ");

test("reminder step: first and second reminder on Italian working days, inside the Rome window", () => {
  assert.deepEqual(reminderStep(candidate(), NOW), { kind: "promemoria", reminder: 1 });
  assert.equal(reminderStep(candidate({ sentAt: new Date("2026-10-08T08:00:00Z") }), NOW), null, "only 2 working days");
  assert.equal(reminderStep(candidate(), EVENING), null, "after 18:00 in Rome");
  assert.equal(reminderStep(candidate(), new Date("2026-10-17T09:30:00Z")), null, "Saturday");
  // Sent on Thursday 1 October: Sunday 4 October is a holiday anyway, 7 working days by Monday 12.
  assert.deepEqual(reminderStep(candidate({ sentAt: new Date("2026-10-01T08:00:00Z"), reminderCount: 1 }), NOW), { kind: "promemoria", reminder: 2 });
  assert.equal(reminderStep(candidate({ reminderCount: 1 }), NOW), null);
});

test("reminder step: escalation to the Owner after two reminders, else the Lateral Space bell", () => {
  const late = { sentAt: new Date("2026-09-25T08:00:00Z"), reminderCount: 2 };
  assert.deepEqual(reminderStep(candidate(late), NOW), { kind: "segnalazione_owner", ownerContactId: OWNER });
  assert.deepEqual(reminderStep(candidate({ ...late, ownerContactId: null }), NOW), { kind: "owner_da_indicare" });
  assert.deepEqual(reminderStep(candidate({ ...late, ownerReachable: false }), NOW), { kind: "owner_da_indicare" });
  assert.deepEqual(reminderStep(candidate({ ...late, ownerContactId: CONTACT }), NOW), { kind: "owner_da_indicare" }, "never escalate to the referent");
  assert.equal(reminderStep(candidate({ ...late, escalatedAt: new Date("2026-10-09T08:00:00Z") }), NOW), null, "no third reminder");
});

test("reminder step: nothing for paused or closed cases, approval links or dead links; no email means no reminder", () => {
  assert.equal(reminderStep(candidate({ caseStatus: "sospeso" }), NOW), null);
  assert.equal(reminderStep(candidate({ caseStatus: "chiuso" }), NOW), null);
  assert.equal(reminderStep(candidate({ purpose: "approvazioni" }), NOW), null);
  assert.equal(reminderStep(candidate({ status: "completata" }), NOW), null);
  assert.equal(reminderStep(candidate({ expiresAt: new Date("2026-10-12T09:00:00Z") }), NOW), null);
  assert.deepEqual(reminderStep(candidate({ contactReachable: false }), NOW), { kind: "senza_email" });
});

test("reminder rows: deduplicated per request, no token, no names; the bell goes only to Lateral Space members", () => {
  const [first] = reminderStatements(candidate(), { kind: "promemoria", reminder: 1 });
  assert.match(first.text, /ON CONFLICT \(dedupe_key\) DO NOTHING/);
  assert.ok(first.params.includes(`promemoria_1:${REQ}`));
  assert.ok(first.params.includes("promemoria_1"));
  assert.ok(params(first).includes('"case_code":"UC-PROVA"'));
  const [owner] = reminderStatements(candidate(), { kind: "segnalazione_owner", ownerContactId: OWNER });
  assert.ok(owner.params.includes(`owner:${REQ}`) && owner.params.includes(OWNER));
  const [bell] = reminderStatements(candidate(), { kind: "owner_da_indicare" });
  assert.match(bell.text, /FROM uc_cases c\s+JOIN \(SELECT DISTINCT case_id, user_id FROM uc_case_members WHERE role IN \('ls_lead', 'ls_analista', 'ls_sviluppatore'\)\)/);
  assert.ok(bell.params.includes(`owner_da_indicare:${REQ}`));
  assert.deepEqual(reminderStatements(candidate(), { kind: "senza_email" }), []);
  const strange = reminderStatements(candidate({ caseCode: "nome cliente" }), { kind: "promemoria", reminder: 2 })[0];
  assert.ok(!params(strange).includes("nome cliente"), "only a valid case code goes in the payload");
  for (const s of [first, owner, bell, strange]) assert.ok(!params(s).includes("ucr_"));
});

test("weekly rows: one email per Owner, email and bell per Lateral Space member, keyed by ISO week", () => {
  const rows = weeklyStatements(WS, { contacts: [OWNER], users: [USER] }, NOW, "2026-W42");
  assert.equal(rows.length, 3);
  assert.ok(rows[0].params.includes(`riepilogo:${WS}:2026-W42:c-${OWNER}`));
  assert.ok(rows[1].params.includes(`riepilogo:${WS}:2026-W42:u-${USER}`) && rows[1].params.includes("email"));
  assert.ok(rows[2].params.includes(`riepilogo_ls:${WS}:2026-W42:${USER}`) && rows[2].params.includes("in_app"));
  assert.ok(rows.every((r) => params(r).includes('"week":"2026-W42"')));
});

test("expiry SQL: compare-and-swap on waiting, expired requests of open, unpaused cases", () => {
  const sel = expiringRequestsSql(NOW);
  assert.match(sel.text, /r\.status IN \('inviata', 'aperta', 'in_corso'\)/);
  assert.match(sel.text, /c\.status NOT IN \('chiuso', 'sospeso'\)/);
  assert.ok(sel.params.includes(NOW.toISOString()));
  const cas = requestExpireSql({ id: REQ, caseId: CASE }, NOW);
  assert.match(cas.text, /^WITH uc_cas AS \(UPDATE uc_requests SET status = 'scaduta'/);
  assert.match(cas.text, /uc_require\(count\(\*\) = \$\d+::int, 'conflitto'\)/);
  assert.match(cas.text, /status IN \('inviata', 'aperta', 'in_corso'\) AND revoked_at IS NULL/);
  assert.match(expiredRequestItemsReleaseSql({ id: REQ, caseId: CASE }).text, /SET state = 'riassegnata'[\s\S]*state IN \('da_fare', 'bozza'\)/);
  assert.match(expiredRequestNotificationsCancelSql({ id: REQ, caseId: CASE }).text, /SET status = 'annullata'[\s\S]*status IN \('in_coda', 'errore'\)/);
  const parsed = rowToExpiringRequest({ id: REQ, case_id: CASE, workspace_id: WS, status: "aperta", expires_at: "2026-10-01T00:00:00Z", reminder_count: 1, asked_items: [NOTIF, NOTIF, "x"] });
  assert.deepEqual(parsed?.askedItemIds, [NOTIF], "ids deduplicated and checked");
  assert.equal(rowToExpiringRequest({ id: REQ, case_id: CASE, workspace_id: WS, status: "boh" }), null);
});

test("overdue, stale and candidate SQL carry the rule guards", () => {
  assert.match(overdueItemsSql(NOW).text, /i\.status = 'chiesta'[\s\S]*i\.due_at < \$1::timestamptz AND r\.reminder_count >= 2/);
  assert.match(staleItemsSql(NOW).text, /i\.status = 'validata' AND i\.stale_at IS NOT NULL AND i\.stale_at <= \$1::timestamptz/);
  const candidates = reminderCandidatesSql();
  assert.match(candidates.text, /r\.purpose = 'raccolta'/);
  assert.match(candidates.text, /r\.share_epoch = c\.share_epoch/, "uc_request_live");
  assert.match(candidates.text, /c\.status NOT IN \('chiuso', 'sospeso'\)/);
});

// ── SQL della coda ────────────────────────────────────────────────────

function n(over: Partial<ClaimedNotification> = {}): ClaimedNotification {
  return { id: NOTIF, workspaceId: WS, caseId: CASE, requestId: REQ, recipientContactId: CONTACT, recipientUserId: null, templateKey: "promemoria_1", payload: {}, attempts: 0, dedupeKey: `promemoria_1:${REQ}`, ...over };
}

test("claim: due email rows with a 10-minute lease, skipping paused cases and, outside the window, reminders and summaries", () => {
  const inWindow = claimDueSql({ caseId: null, limit: 50, includeWindowed: true });
  assert.match(inWindow.text, /n\.channel = 'email' AND n\.scheduled_at <= now\(\)/);
  assert.match(inWindow.text, /n\.status = 'in_coda' OR \(n\.status = 'errore' AND n\.attempts < \$1::int\)/);
  assert.match(inWindow.text, /FOR UPDATE OF n SKIP LOCKED/);
  assert.match(inWindow.text, /SET scheduled_at = now\(\) \+ interval '10 minutes'/);
  assert.match(inWindow.text, /NOT \(n\.hold_reason IS NOT DISTINCT FROM 'caso_sospeso' AND c\.status IS NOT DISTINCT FROM 'sospeso'\)/);
  assert.ok(!inWindow.text.includes("template_key <> ALL"));
  const outside = claimDueSql({ caseId: CASE, limit: 1000, includeWindowed: false });
  assert.match(outside.text, /n\.template_key <> ALL\(\$\d+::text\[\]\)/);
  assert.match(outside.text, /AND n\.case_id = \$\d+::uuid/);
  assert.ok(params(outside).includes('["promemoria_1","promemoria_2","segnalazione_owner","riepilogo_settimanale"]'));
  assert.ok(outside.params.includes(200), "at most 200 rows per round");
  assert.throws(() => claimDueSql({ caseId: "x", limit: 1, includeWindowed: true }), /Caso non valido/);
});

test("closing rows: sent with event, failure with retry in 15 minutes, hold and cancel only from the queue", () => {
  const [sent, req] = markSentStatements(n(), { kind: "promemoria", reminder: 1, nextReminderAt: NOW });
  assert.match(sent.text, /SET status = 'inviata', sent_at = now\(\), attempts = attempts \+ 1/);
  assert.match(sent.text, /INSERT INTO uc_events/);
  assert.ok(sent.params.includes("notifica.inviata"));
  assert.match(req.text, /UPDATE uc_requests SET reminder_count = \$1::int[\s\S]*AND reminder_count = \$\d+::int/);
  assert.ok(req.params.includes("richiesta.promemoria"));
  const [, escalated] = markSentStatements(n({ templateKey: "segnalazione_owner" }), { kind: "segnalazione" });
  assert.match(escalated.text, /SET escalated_at = now\(\), next_reminder_at = NULL[\s\S]*escalated_at IS NULL/);
  assert.equal(markSentStatements(n({ templateKey: "richiesta_inviata" }), null).length, 1);
  const failed = markFailedSql(n(), "validation_error");
  assert.match(failed.text, /SET status = 'errore', attempts = attempts \+ 1[\s\S]*interval '15 minutes'/);
  assert.ok(failed.params.includes("notifica.errore") && failed.params.includes("validation_error"));
  assert.ok(markFailedSql(n(), "Errore: a@b.test").params.includes("errore_invio"), "only codes are stored");
  assert.match(markHeldSql(n(), "caso_sospeso").text, /status IN \('in_coda', 'errore'\)/);
  assert.throws(() => markHeldSql(n(), "Motivo libero"));
  assert.match(markCancelledSql(n(), "caso_chiuso").text, /SET status = 'annullata'/);
  assert.match(markInAppDeliveredSql().text, /n\.channel = 'in_app' AND n\.status = 'in_coda'/);
  assert.match(holdUnconfiguredSql({ caseId: CASE }).text, /n\.channel = 'email' AND n\.status = 'in_coda' AND n\.hold_reason IS NULL AND n\.case_id = /);
  assert.match(markInAppDeliveredSql({ workspaceId: WS }).text, /AND n\.workspace_id = \$1::uuid/);
  assert.ok(holdUnconfiguredSql().params.includes("email_non_configurata"));
  assert.throws(() => markInAppDeliveredSql({ workspaceId: "x" }), /Workspace non valido/);
});

test("bell SQL: only the person's in-app rows, unread, while still a Lateral Space member of the case", () => {
  const unread = unreadBellSql({ userId: USER, workspaceId: WS, limit: 500 });
  assert.match(unread.text, /n\.recipient_user_id = \$1::uuid AND n\.channel = 'in_app' AND n\.read_at IS NULL/);
  assert.match(unread.text, /m\.role IN \('ls_lead', 'ls_analista', 'ls_sviluppatore'\)/);
  assert.ok(unread.params.includes(50), "at most 50 rows");
  // Code and title of the dossier and of its parent use case are read now, never from the payload.
  assert.match(unread.text, /LEFT JOIN uc_cases c ON c\.id = n\.case_id\s+LEFT JOIN use_cases u ON u\.id = c\.portfolio_use_case_id/);
  assert.match(unread.text, /to_jsonb\(u\) ->> 'code' AS use_case_code/);
  assert.doesNotMatch(unread.text, /proposed_by/);
  // The day of the answers ends at the next Rome midnight: the day is added to the local time,
  // never to a timestamptz (that follows the session time zone, UTC on Neon, and misses DST days).
  assert.match(unread.text, /a\.created_at < \(\(date_trunc\('day', n\.created_at AT TIME ZONE 'Europe\/Rome'\) \+ interval '1 day'\) AT TIME ZONE 'Europe\/Rome'\)/);
  assert.doesNotMatch(unread.text, /'Europe\/Rome'\) AT TIME ZONE 'Europe\/Rome'\) \+ interval '1 day'/, "never a day added to a timestamptz");
  const enabledOnly = unreadBellSql({ userId: USER, workspaceId: null, limit: 20, workspaceIds: [WS] });
  assert.match(enabledOnly.text, /n\.workspace_id = ANY\(\$\d+::uuid\[\]\)/);
  const read = markBellReadSql({ userId: USER, workspaceId: WS, notificationId: NOTIF });
  assert.match(read.text, /recipient_user_id = \$1::uuid AND workspace_id = \$2::uuid AND channel = 'in_app' AND read_at IS NULL AND \(id = \$3::uuid OR \(template_key = 'risposta_ricevuta'/);
  assert.match(read.text, /t\.recipient_user_id = uc_notifications\.recipient_user_id/, "a grouped row is marked read only for its own recipient");
});

// ── Ingressi dell'app con un esecutore finto ──────────────────────────

function fakeExecutor(answer: (s: UcStatement) => UcRow[]): UcExecutor & { seen: string[] } {
  const seen: string[] = [];
  return {
    seen,
    async batch(statements) {
      return statements.map((s) => {
        seen.push(s.text);
        return answer(s);
      });
    },
  };
}

test("the bell reads nothing with the section off, without uc tables or for people outside Lateral Space", async () => {
  const none = fakeExecutor(() => []);
  assert.deepEqual(await unreadForUser(USER, { executor: none, env: {} }), []);
  assert.deepEqual(await unreadForUser("non-uuid", { executor: none, env: { UC_ENABLED: "true" } }), []);
  assert.equal(none.seen.length, 0);

  // Workspace switch (P0-1): a workspace outside UC_WORKSPACE_IDS reads nothing, not even the guard.
  assert.deepEqual(await unreadForUser(USER, { workspaceId: WS, executor: none, env: { UC_ENABLED: "true", UC_LS_EMAIL_DOMAINS: "ls.test" } }), []);
  assert.deepEqual(await unreadForUser(USER, { executor: none, env: { UC_ENABLED: "true", UC_LS_EMAIL_DOMAINS: "ls.test", UC_WORKSPACE_IDS: "" } }), []);
  assert.equal(none.seen.length, 0);

  const on = { UC_ENABLED: "true", UC_LS_EMAIL_DOMAINS: "ls.test", UC_WORKSPACE_IDS: WS };
  const noTables = fakeExecutor((s) => (s.text.includes("to_regclass") ? [{ ok: false }] : []));
  assert.deepEqual(await unreadForUser(USER, { executor: noTables, env: on }), []);
  assert.equal(noTables.seen.length, 1, "only the to_regclass guard");

  const client = fakeExecutor((s) =>
    s.text.includes("to_regclass") ? [{ ok: true }] : s.text.includes("FROM users") ? [{ id: USER, email: "persona@cliente.test", email_verified: "2026-01-01T00:00:00Z" }] : [],
  );
  assert.deepEqual(await unreadForUser(USER, { workspaceId: WS, executor: client, env: on }), []);
  assert.ok(!client.seen.some((t) => t.includes("FROM uc_notifications")), "a client user never reads the queue");

  const ls = fakeExecutor((s) =>
    s.text.includes("to_regclass")
      ? [{ ok: true }]
      : s.text.includes("FROM users")
        ? [{ id: USER, email: "lead@ls.test", email_verified: "2026-01-01T00:00:00Z" }]
        : s.text.includes("FROM uc_notifications")
          ? [{ id: NOTIF, workspace_id: WS, case_id: CASE, template_key: "gate_pronto", payload: { gate: "G1" }, created_at: "2026-10-12T08:00:00Z" }]
          : [],
  );
  const items = await unreadForUser(USER, { workspaceId: WS, executor: ls, env: on });
  assert.equal(items.length, 1);
  assert.equal(items[0].href, `/dashboard/${WS}/casi-duso/${CASE}/via`);
});

test("dispatch does nothing with the section off or a malformed case id", async () => {
  const exec = fakeExecutor(() => []);
  const empty = { bell: 0, sent: 0, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };
  assert.deepEqual(await dispatchDue({ executor: exec, env: {} }), empty);
  assert.deepEqual(await dispatchDue({ executor: exec, env: { UC_ENABLED: "true" }, caseId: "x" }), empty);
  assert.equal(exec.seen.length, 0);
  const unconfigured = fakeExecutor((s) => (s.text.includes("count(*)::int AS n") ? [{ n: 1 }] : []));
  const summary = await dispatchDue({ executor: unconfigured, env: { UC_ENABLED: "true" }, caseId: CASE });
  assert.deepEqual(summary, { ...empty, bell: 1, notConfigured: 1 });
  assert.ok(!unconfigured.seen.some((t) => t.includes("FOR UPDATE")), "nothing is claimed without email configuration");
});
