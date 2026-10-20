import test from "node:test";
import assert from "node:assert/strict";
import {
  cronWorkspaceFilterOf,
  dispatchAcrossWorkspaces,
  expiringRequestsSql,
  openCasesSql,
  reminderCandidatesSql,
  sharedMailer,
  staleItemsSql,
  weeklyLsRecipientsSql,
  weeklyOwnerRecipientsSql,
} from "../db/queries/uc-cron.ts";
import { CASE_CONTACT_COLUMNS, PURGE_CASE_TABLES, casePrefixes, orphanContactsSql, retainedFilesSql, unreachableRetainedFilesSql } from "../db/queries/uc-retention.ts";
import { UC_TABLE_NAMES } from "./ddl.ts";
import { DISPATCH_BATCH_LIMIT, RATE_LIMIT_CODE, type DispatchSummary, type MailResult, type OutgoingEmail } from "./notify/dispatch.ts";

const A = "0f8e2a64-1b7c-4d3e-9a5f-6c2b1d0e9f8a";
const B = "7c1d9e2f-3a4b-4c5d-8e6f-0a1b2c3d4e5f";
const NOW = new Date("2026-10-14T08:00:00Z");

test("a cron round runs on the operator workspace, inside the switched-on list", () => {
  assert.equal(cronWorkspaceFilterOf({}), null);
  assert.equal(cronWorkspaceFilterOf({ workspaceIds: null }), null);
  assert.deepEqual(cronWorkspaceFilterOf({ workspaceIds: [A, B] }), [A, B]);
  assert.deepEqual(cronWorkspaceFilterOf({ workspaceIds: [] }), []);
  assert.equal(cronWorkspaceFilterOf({ workspaceId: A }), A);
  assert.equal(cronWorkspaceFilterOf({ workspaceId: A.toUpperCase(), workspaceIds: [A] }), A.toUpperCase());
  // An operator workspace that is switched off gets nothing.
  assert.deepEqual(cronWorkspaceFilterOf({ workspaceId: A, workspaceIds: [B] }), []);
});

test("every cron query takes the list as one ANY filter, and an empty list matches nothing", () => {
  const builders = [
    (f: string | string[] | null) => expiringRequestsSql(NOW, 500, f),
    (f: string | string[] | null) => reminderCandidatesSql(2000, f),
    (f: string | string[] | null) => weeklyOwnerRecipientsSql(f),
    (f: string | string[] | null) => weeklyLsRecipientsSql(f),
    (f: string | string[] | null) => staleItemsSql(NOW, 10_000, f),
    (f: string | string[] | null) => openCasesSql(2000, f),
  ];
  for (const build of builders) {
    const all = build(null);
    assert.ok(!all.text.includes("c.workspace_id = "), "no filter for every workspace");
    const one = build(A);
    assert.match(one.text, /c\.workspace_id = \$\d+::uuid/);
    assert.ok(one.params.includes(A));
    const list = build([A, B]);
    assert.match(list.text, /c\.workspace_id = ANY\(\$\d+::uuid\[\]\)/);
    assert.ok(list.params.some((p) => Array.isArray(p) && p.length === 2));
    assert.match(build([]).text, / AND false/);
  }
  assert.throws(() => openCasesSql(10, ["non-un-uuid"]), /Workspace non valido/);
  assert.throws(() => openCasesSql(10, "non-un-uuid"), /Workspace non valido/);
});

const C = "3b9c5d1e-7f2a-4e6b-9c8d-1a2b3c4d5e6f";

/** A fake dispatch: each workspace has `due` emails and sends at most `limit` of them. */
function fakeQueue(due: Record<string, number>, o: { rateLimitAt?: string } = {}) {
  const calls: { workspaceId: string; limit: number }[] = [];
  let limited = false;
  const send = async (workspaceId: string, limit: number): Promise<DispatchSummary> => {
    calls.push({ workspaceId, limit });
    const n = Math.min(limit, due[workspaceId] ?? 0);
    if (o.rateLimitAt === workspaceId && n > 0) {
      limited = true;
      return { bell: 0, sent: n - 1, failed: 1, held: 0, cancelled: 0, notConfigured: 0 };
    }
    return { bell: 1, sent: n, failed: 0, held: 0, cancelled: 0, notConfigured: 0 };
  };
  return { calls, send, rateLimited: () => limited };
}

test("the dispatch of a cron round shares one batch across the switched-on workspaces", async () => {
  const busy = fakeQueue({ [A]: 40, [B]: 40 });
  const both = await dispatchAcrossWorkspaces([A, B], busy.send, { limit: DISPATCH_BATCH_LIMIT, timeLeft: () => true, rateLimited: busy.rateLimited });
  assert.deepEqual(busy.calls, [
    { workspaceId: A, limit: 25 },
    { workspaceId: B, limit: 25 },
  ]);
  assert.equal(both.summary.sent, 50, "never more than one batch per round, whatever the number of workspaces");
  assert.equal(both.summary.bell, 2);
  assert.equal(both.deferred, false);

  // What a quiet workspace does not use goes to the next ones.
  const quiet = fakeQueue({ [A]: 3, [B]: 80, [C]: 80 });
  const three = await dispatchAcrossWorkspaces([A, B, C], quiet.send, { limit: 50, timeLeft: () => true, rateLimited: quiet.rateLimited });
  assert.deepEqual(quiet.calls.map((c) => c.limit), [17, 24, 23]);
  assert.equal(three.summary.sent, 50);

  // Budget spent: the last workspaces wait for the next round.
  const greedy = fakeQueue({ [A]: 1, [B]: 49, [C]: 9 });
  await dispatchAcrossWorkspaces([A, B, C], greedy.send, { limit: 2, timeLeft: () => true, rateLimited: greedy.rateLimited });
  assert.deepEqual(greedy.calls.map((c) => c.workspaceId), [A, B]);
});

test("the dispatch stops after a rate limit and when the cron runs out of time", async () => {
  const limited = fakeQueue({ [A]: 10, [B]: 10 }, { rateLimitAt: A });
  const r1 = await dispatchAcrossWorkspaces([A, B], limited.send, { limit: 50, timeLeft: () => true, rateLimited: limited.rateLimited });
  assert.deepEqual(limited.calls.map((c) => c.workspaceId), [A], "no attempt burnt on the next workspace");
  assert.equal(r1.summary.failed, 1);

  const late = fakeQueue({ [A]: 10, [B]: 10 });
  const r2 = await dispatchAcrossWorkspaces([A, B], late.send, { limit: 50, timeLeft: () => false, rateLimited: late.rateLimited });
  assert.deepEqual(late.calls.map((c) => c.workspaceId), [A], "the first workspace still gets its share, as the single call did");
  assert.equal(r2.deferred, true);
});

test("one mailer per round: pacing carries over between workspaces and a rate limit is seen outside", async () => {
  const at: number[] = [];
  let answer: MailResult = { ok: true };
  const inner = {
    async send(): Promise<MailResult> {
      at.push(Date.now());
      return answer;
    },
  };
  const email: OutgoingEmail = { from: "a@b.test", to: "c@d.test", subject: "s", text: "t", html: "h" };
  const shared = sharedMailer(inner, 40);
  await shared.mailer.send(email, { idempotencyKey: "k1" });
  await shared.mailer.send(email, { idempotencyKey: "k2" });
  assert.ok(at[1] - at[0] >= 35, `paced: ${at[1] - at[0]} ms`);
  assert.equal(shared.rateLimited(), false);
  answer = { ok: false, code: "errore_invio", ambiguous: true };
  await shared.mailer.send(email, { idempotencyKey: "k3" });
  assert.equal(shared.rateLimited(), false);
  answer = { ok: false, code: RATE_LIMIT_CODE, ambiguous: false };
  await shared.mailer.send(email, { idempotencyKey: "k4" });
  assert.equal(shared.rateLimited(), true);
});

test("retention: closed cases, 30 days after closure in Rome, written proofs kept", () => {
  const s = retainedFilesSql(NOW, { workspaceId: A });
  assert.match(s.text, /c\.status = 'chiuso'/);
  assert.match(s.text, /f\.deleted_at IS NULL/);
  assert.match(s.text, /coalesce\(f\.retention_until/);
  assert.match(s.text, /AT TIME ZONE 'Europe\/Rome'/);
  assert.match(s.text, /signers_designation/);
  assert.match(s.text, /written_evidence_file_id/);
  assert.match(s.text, /c\.workspace_id = \$\d+::uuid/);
  assert.ok(s.params.includes(30));
  assert.doesNotMatch(retainedFilesSql(NOW).text, /AND c\.workspace_id = \$/);
  // Only rows whose stores are configured use up the night's limit; the others are counted apart.
  const personalOff = retainedFilesSql(NOW, { zones: ["standard"] });
  assert.match(personalOff.text, /f\.storage_zone = ANY\(\$\d+::text\[\]\)/);
  assert.ok(personalOff.params.some((p) => Array.isArray(p) && p.length === 1 && p[0] === "standard"));
  assert.doesNotMatch(retainedFilesSql(NOW).text, /storage_zone = ANY/);
  assert.match(unreachableRetainedFilesSql(NOW, { zones: [] }).text, /AND NOT \(\(f\.blob_path IS NULL OR/);
});

test("purge covers every uc table of a case except the audit, and the case store prefixes", () => {
  for (const table of PURGE_CASE_TABLES) assert.ok(UC_TABLE_NAMES.includes(table), table);
  assert.ok(!PURGE_CASE_TABLES.includes("uc_events"), "the audit survives the case");
  for (const table of ["uc_items", "uc_answers", "uc_files", "uc_requests", "uc_request_tokens", "uc_notifications", "uc_catalog_versions", "uc_validations"]) {
    assert.ok(PURGE_CASE_TABLES.includes(table), table);
  }
  assert.deepEqual(casePrefixes(A.toUpperCase(), B), { standard: [`uc/q/${A}/${B}/`, `uc/s/${A}/${B}/`], personale: [`uc/p/${A}/${B}/`] });
  assert.throws(() => casePrefixes("x", B), /non valido/);
});

test("purge: the links between a referent and a case come from the DDL, the audit excluded", () => {
  const columns = CASE_CONTACT_COLUMNS.map((c) => `${c.table}.${c.column}`);
  for (const column of [
    "uc_cases.client_owner_contact_id",
    "uc_cases.client_privacy_approver_contact_id",
    "uc_items.assignee_contact_id",
    "uc_requests.contact_id",
    "uc_answers.responder_contact_id",
    "uc_notifications.recipient_contact_id",
  ]) {
    assert.ok(columns.includes(column), column);
  }
  assert.ok(!columns.some((c) => c.startsWith("uc_events.") || c.startsWith("uc_contacts.")), "the audit would keep every referent forever");
  const s = orphanContactsSql(A, B);
  assert.match(s.text, /signers_designation/);
  assert.match(s.text, /k\.anonymized_at IS NULL/);
  assert.match(s.text, /e\.actor_contact_id/);
  assert.throws(() => orphanContactsSql("x", B), /non valido/);
});
