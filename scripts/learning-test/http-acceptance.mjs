import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createOperationalTestPack } from "./fixture-pack.mjs";
import { trainingPackHash } from "../../src/lib/learning/pack.ts";

const output = process.env.LEARNING_TEST_OUTPUT;
if (!output?.startsWith("/private/tmp/") && !output?.startsWith("/tmp/")) throw new Error("Use a temporary fixture directory");
const fixture = JSON.parse(await readFile(resolve(output, "synthetic-fixtures.json"), "utf8"));
const requireFromApp = createRequire(resolve("package.json"));
const { Client } = requireFromApp("pg");
const database = new Client({ host: "127.0.0.1", port: 55439, user: "learning_test", database: "unbundle_learning_test" });
await database.connect();
const origin = "http://127.0.0.1:53100";
const runtime = process.env.LEARNING_TEST_RUNTIME === "production" ? "production" : "development";
const workspaceA = fixture.workspaces.a, workspaceB = fixture.workspaces.b;
const base = (workspace) => `${origin}/dashboard/${workspace.workspaceId}/learning/${workspace.programId}`;
const sessions = {};
for (const name of ["learner-b", "learner-b2", "learner-a2", "shared", "reviewer-a", "manager-a", "sponsor-a"]) {
  const response = await fetch(`http://127.0.0.1:53102/as/${name}`, { redirect: "manual" });
  assert.equal(response.status, 302, `Synthetic login failed for ${name}`);
  sessions[name] = response.headers.get("set-cookie").split(";")[0];
}
// Each run uses a fresh learner for mutating checks, so previous receipts remain
// intact and the suite can be replayed without deleting submitted evidence.
const runUserId = randomUUID();
const runEmail = `http-${runUserId}@learning-test.invalid`;
const signup = await fetch("http://127.0.0.1:59099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-only", {
  method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: runEmail, password: "Synthetic-only-4862", returnSecureToken: true }),
});
const identity = await signup.json(); assert.equal(signup.status, 200);
await database.query("INSERT INTO users(id,firebase_uid,email,name) VALUES ($1,$2,$3,'Synthetic HTTP learner')", [runUserId, identity.localId, runEmail]);
await database.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'contributor')", [workspaceB.workspaceId, runUserId]);
await database.query("INSERT INTO learning_enrollments(workspace_id,program_id,user_id,module_id,cohort_id) VALUES ($1,$2,$3,'m1','m1-cohort')", [workspaceB.workspaceId, workspaceB.programId, runUserId]);
const login = await fetch(`${origin}/api/auth/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: identity.idToken }) });
assert.equal(login.status, 200); sessions["learner-b"] = login.headers.get("set-cookie").split(";")[0];
const page = async (name, url, extraHeaders = {}) => {
  const response = await fetch(url, { headers: { ...(sessions[name] ? { cookie: sessions[name] } : {}), ...extraHeaders }, redirect: "manual" });
  return { status: response.status, location: response.headers.get("location"), text: await response.text() };
};
const activityUrl = `${base(workspaceB)}/activities/m1-exit-a`;
await page("learner-b", activityUrl);
await page("reviewer-a", `${base(workspaceA)}/manage`);
async function action(name, exportedName, input, options = {}) {
  const response = await fetch(`${origin}/api/learning`, {
    method: "POST", redirect: "manual",
    headers: { "content-type": "application/json", origin: options.origin ?? origin, ...(sessions[name] ? { cookie: sessions[name] } : {}) },
    body: JSON.stringify({ operation: exportedName, input }),
  });
  const text = await response.text();
  let result;
  try { result = JSON.parse(text); } catch { /* A non-JSON response must fail the caller's assertions. */ }
  return { status: response.status, result, text, location: response.headers.get("location"), cacheControl: response.headers.get("cache-control") };
}
const scope = (workspace) => ({ workspaceId: workspace.workspaceId, programId: workspace.programId });
const evidence = [];
async function check(id, title, run) {
  const started = performance.now();
  try { await run(); evidence.push({ id, title, status: "PASS", elapsedMs: Math.round(performance.now() - started) }); }
  catch (error) { evidence.push({ id, title, status: "FAIL", error: error.message }); }
  console.log(`${evidence.at(-1).status} ${id} ${title}${evidence.at(-1).error ? `: ${evidence.at(-1).error}` : ""}`);
}
const correct = (activity) => Object.fromEntries(createOperationalTestPack().items.filter((item) => item.activity_id === activity).map((item) => [item.id, item.correct_option_ids[0]]));
let attempt;
await check("A01-partial", "Unauthenticated activity redirects to login preserving callback", async () => {
  const result = await page("none", activityUrl);
  assert.equal(result.status, 307); assert.ok(result.location.includes("callbackUrl="));
  assert.ok(decodeURIComponent(result.location).includes(new URL(activityUrl).pathname));
});
await check("G04-html", "Pre-submit HTML and RSC omit private grading markers", async () => {
  for (const headers of [{}, { RSC: "1" }]) {
    const result = await page("learner-b", activityUrl, headers); assert.equal(result.status, 200);
    assert.ok(!result.text.includes("PRIVATE_")); assert.ok(!result.text.includes("correct_option_ids"));
  }
});
await check("A02-program", "Foreign workspace/program combination is denied", async () => {
  const result = await action("learner-b", "startLearningAttempt", { ...scope(workspaceA), activityId: "m1-exit-a", expectedVersion: fixture.contentVersion });
  assert.equal(result.result?.ok, false); assert.equal(result.result?.code, "forbidden");
});
await check("A09", "Server Action rejects forged identity/score/role fields", async () => {
  const result = await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-exit-a", expectedVersion: fixture.contentVersion, userId: fixture.accounts.shared.id, score: 8, role: "manager" });
  assert.equal(result.result?.ok, false); assert.equal(result.result?.code, "invalid");
});
await check("A10-origin", "Cross-origin direct action is rejected", async () => {
  const result = await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-exit-a", expectedVersion: fixture.contentVersion }, { origin: "https://invalid.test" });
  assert.equal(result.status, 403); assert.notEqual(result.result?.ok, true);
});
await check("gateway-session", "Missing session returns recoverable JSON without redirect or caching", async () => {
  const result = await action("none", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion });
  assert.equal(result.status, 401); assert.equal(result.result?.code, "unauthenticated"); assert.equal(result.location, null); assert.ok(result.cacheControl.includes("no-store"));
});
await check("gateway-origin", "Missing Origin is rejected even with a valid cookie", async () => {
  const response = await fetch(`${origin}/api/learning`, { method: "POST", headers: { "content-type": "application/json", cookie: sessions["learner-b"] }, body: JSON.stringify({ operation: "startLearningAttempt", input: {} }), redirect: "manual" });
  assert.equal(response.status, 403); assert.equal(response.headers.get("location"), null); assert.equal((await response.json()).ok, false);
});
await check("gateway-input", "Gateway rejects wrong media, malformed JSON, unknown operation and envelope extras", async () => {
  for (const [contentType, body, status] of [
    ["text/plain", "{}", 415], ["application/json", "{", 400],
    ["application/json", JSON.stringify({ operation: "unknown", input: {} }), 400],
    ["application/json", JSON.stringify({ operation: "startLearningAttempt", input: {}, role: "manager" }), 400],
  ]) {
    const response = await fetch(`${origin}/api/learning`, { method: "POST", headers: { origin, "content-type": contentType, cookie: sessions["learner-b"] }, body, redirect: "manual" });
    assert.equal(response.status, status); assert.equal((await response.json()).ok, false);
  }
});
await check("gateway-size", "Gateway enforces 64 KiB body limit before parsing", async () => {
  const response = await fetch(`${origin}/api/learning`, { method: "POST", headers: { origin, "content-type": "application/json", cookie: sessions["learner-b"] }, body: JSON.stringify({ operation: "startLearningAttempt", input: { padding: "x".repeat(70_000) } }), redirect: "manual" });
  assert.equal(response.status, 413); assert.equal((await response.json()).ok, false);
});
await check("D01-start", "Authenticated direct action starts a persisted private attempt", async () => {
  const result = await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-exit-a", expectedVersion: fixture.contentVersion });
  assert.equal(result.result?.ok, true, result.result?.message); attempt = result.result.data;
  assert.equal(attempt.status, "draft"); assert.ok(!result.text.includes("PRIVATE_"));
});
if (attempt) {
  await check("A03", "Another learner in the same workspace cannot modify this attempt", async () => {
    const result = await action("learner-b2", "saveLearningDraft", { ...scope(workspaceB), attemptId: attempt.id, expectedRevision: attempt.revision, responses: { answers: correct("m1-exit-a"), fields: {} } });
    assert.equal(result.result?.ok, false); assert.equal(result.result?.code, "forbidden");
    const feedback = await page("learner-b2", `${base(workspaceB)}/attempts/${attempt.id}`); assert.ok(feedback.status === 404 || !feedback.text.includes("Generic prompt"));
  });
  await check("D03", "Concurrent drafts permit one revision and explicitly reject the stale writer", async () => {
    const input = { ...scope(workspaceB), attemptId: attempt.id, expectedRevision: attempt.revision, responses: { answers: correct("m1-exit-a"), fields: {} } };
    const results = await Promise.all([action("learner-b", "saveLearningDraft", input), action("learner-b", "saveLearningDraft", input)]);
    assert.equal(results.filter((row) => row.result?.ok).length, 1);
    assert.equal(results.filter((row) => row.result?.code === "conflict").length, 1);
    attempt = results.find((row) => row.result?.ok).result.data;
  });
  await check("D01-resume", "Server persisted responses/revision/order survive a new session", async () => {
    const login = await fetch(`${origin}/api/auth/session`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: identity.idToken }) });
    sessions["learner-b"] = login.headers.get("set-cookie").split(";")[0];
    const resumed = await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-exit-a", expectedVersion: fixture.contentVersion });
    assert.deepEqual(resumed.result.data.responses, attempt.responses); assert.equal(resumed.result.data.revision, attempt.revision);
    assert.deepEqual(resumed.result.data.activity.items, attempt.activity.items);
  });
  await check("D05-G01", "Concurrent idempotent submit yields one 8/8 receipt and one audit event", async () => {
    const key = randomUUID(); const input = { ...scope(workspaceB), attemptId: attempt.id, expectedRevision: attempt.revision, idempotencyKey: key };
    const submitted = await Promise.all(Array.from({ length: 5 }, () => action("learner-b", "submitLearningAttempt", input)));
    assert.ok(submitted.every((row) => row.result?.ok), submitted.map((row) => row.result?.code).join(","));
    assert.ok(submitted.every((row) => row.result.data.result.correct === 8 && row.result.data.result.status === "consolidated"));
    attempt = submitted[0].result.data;
    const retried = await action("learner-b", "submitLearningAttempt", input); assert.deepEqual(retried.result.data, attempt);
    const count = await database.query("SELECT count(*)::int n FROM learning_audit_events WHERE resource_id=$1 AND event_type='attempt_submitted'", [attempt.id]); assert.equal(count.rows[0].n, 1);
    const row = await database.query("SELECT status,result,revision,idempotency_key FROM learning_attempts WHERE id=$1", [attempt.id]); assert.equal(row.rows[0].status, "submitted"); assert.equal(row.rows[0].idempotency_key, key);
  });
  await check("D06", "Submitted attempt rejects further edits", async () => {
    const result = await action("learner-b", "saveLearningDraft", { ...scope(workspaceB), attemptId: attempt.id, expectedRevision: attempt.revision, responses: { answers: {}, fields: {} } });
    assert.equal(result.result?.ok, false); assert.equal(result.result?.code, "closed");
  });
  await check("G07", "Retake creates a distinct immutable-history record", async () => {
    const result = await action("learner-b", "startLearningRetake", { ...scope(workspaceB), parentAttemptId: attempt.id });
    assert.equal(result.result?.ok, true); assert.notEqual(result.result.data.id, attempt.id); assert.equal(result.result.data.parentAttemptId, attempt.id); assert.equal(result.result.data.activityId, "m1-exit-b");
    const rows = await database.query("SELECT status FROM learning_attempts WHERE id=$1", [attempt.id]); assert.equal(rows.rows[0].status, "submitted");
  });
  await check("G02", "Retake with 7/8 and one essential error remains needs_practice", async () => {
    const retake = (await action("learner-b", "startLearningRetake", { ...scope(workspaceB), parentAttemptId: attempt.id })).result.data;
    const answers = correct("m1-exit-b"); answers["retake-q7"] = "unsure";
    const saved = await action("learner-b", "saveLearningDraft", { ...scope(workspaceB), attemptId: retake.id, expectedRevision: retake.revision, responses: { answers, fields: {} } });
    assert.equal(saved.result?.ok, true);
    const result = await action("learner-b", "submitLearningAttempt", { ...scope(workspaceB), attemptId: retake.id, expectedRevision: saved.result.data.revision, idempotencyKey: randomUUID() });
    assert.equal(result.result?.ok, true); assert.equal(result.result.data.result.correct, 7); assert.equal(result.result.data.result.status, "needs_practice");
    assert.deepEqual(result.result.data.result.essential_errors, ["retake-q7"]);
  });
}
await check("D07", "Incomplete answers cannot be submitted", async () => {
  const started = await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion });
  assert.equal(started.result?.ok, true);
  const result = await action("learner-b", "submitLearningAttempt", { ...scope(workspaceB), attemptId: started.result.data.id, expectedRevision: started.result.data.revision, idempotencyKey: randomUUID() });
  assert.equal(result.result?.ok, false); assert.equal(result.result?.code, "invalid");
  const row = await database.query("SELECT status,result FROM learning_attempts WHERE id=$1", [started.result.data.id]); assert.equal(row.rows[0].status, "draft"); assert.equal(row.rows[0].result, null);
});
await check("P02-case", "Case locks individual decisions before reference/reflection and creates no portfolio entry", async () => {
  const before = (await database.query("SELECT count(*)::int n FROM use_cases WHERE workspace_id=$1", [workspaceB.workspaceId])).rows[0].n;
  await page("learner-b", `${base(workspaceB)}/activities/m1-case`);
  const started = (await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-case", expectedVersion: fixture.contentVersion })).result.data;
  assert.ok(started); assert.equal(started.caseExample, null);
  const saved = (await action("learner-b", "saveLearningDraft", { ...scope(workspaceB), attemptId: started.id, expectedRevision: started.revision, responses: { answers: correct("m1-case"), fields: {} } })).result.data;
  const premature = await action("learner-b", "submitLearningAttempt", { ...scope(workspaceB), attemptId: started.id, expectedRevision: saved.revision, idempotencyKey: randomUUID() }); assert.equal(premature.result?.ok, false);
  const locked = (await action("learner-b", "submitLearningDecisions", { ...scope(workspaceB), attemptId: started.id, expectedRevision: saved.revision })).result.data;
  assert.ok(locked.decisionsSubmittedAt); assert.ok(locked.caseExample.referenceOutput.includes("PRIVATE_REFERENCE_MARKER"));
  const changed = await action("learner-b", "saveLearningDraft", { ...scope(workspaceB), attemptId: started.id, expectedRevision: locked.revision, responses: { answers: { ...correct("m1-case"), "case-q0": "unsure" }, fields: {} } }); assert.equal(changed.result?.ok, false);
  const reflected = (await action("learner-b", "saveLearningDraft", { ...scope(workspaceB), attemptId: started.id, expectedRevision: locked.revision, responses: { answers: correct("m1-case"), fields: { reflection: "The proposed action requires a verified source." }, mode: "review_reference_output" } })).result.data;
  const result = await action("learner-b", "submitLearningAttempt", { ...scope(workspaceB), attemptId: started.id, expectedRevision: reflected.revision, idempotencyKey: randomUUID() }); assert.equal(result.result?.ok, true); assert.equal(result.result.data.result.correct, 6);
  assert.equal((await database.query("SELECT count(*)::int n FROM use_cases WHERE workspace_id=$1", [workspaceB.workspaceId])).rows[0].n, before);
});
await check("D09", "Closed program keeps submitted feedback readable but rejects new writes", async () => {
  await database.query("UPDATE learning_programs SET status='closed',closed_at=now() WHERE id=$1", [workspaceB.programId]);
  try {
    const closed = await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion }); assert.equal(closed.result?.ok, false); assert.equal(closed.result?.code, "closed");
    assert.equal((await page("learner-b", `${base(workspaceB)}/attempts/${attempt.id}`)).status, 200);
  } finally { await database.query("UPDATE learning_programs SET status='published',closed_at=NULL WHERE id=$1", [workspaceB.programId]); }
});
await check("P01-P03-P04", "Voluntary idea promotes once without LLM and rejects another author", async () => {
  const ideaUrl = `${base(workspaceB)}/ideas`; await page("learner-b", ideaUrl);
  const fields = { title: "Synthetic process improvement", problem: "The fictional checklist repeats manual work.", frequency: "Weekly", inputs: "Invented cards", desiredOutput: "A draft checklist for human review", contact: "Synthetic owner", constraints: "No execution or operational data" };
  const saved = await action("learner-b", "saveLearningIdea", { ...scope(workspaceB), expectedRevision: null, fields }, { url: ideaUrl }); assert.equal(saved.result?.ok, true);
  const draft = saved.result.data; const key = randomUUID(); const input = { ...scope(workspaceB), draftId: draft.id, expectedRevision: draft.revision, idempotencyKey: key };
  assert.equal((await action("learner-b2", "submitLearningIdea", input, { url: ideaUrl })).result?.ok, false);
  const responses = await Promise.all(Array.from({ length: 4 }, () => action("learner-b", "submitLearningIdea", input, { url: ideaUrl })));
  assert.ok(responses.some((row) => row.result?.ok));
  const retry = await action("learner-b", "submitLearningIdea", input, { url: ideaUrl }); assert.equal(retry.result?.ok, true); assert.equal(retry.result.data.resultingUseCaseId, draft.id);
  const rows = await database.query("SELECT source,title,description,business_case FROM use_cases WHERE id=$1 AND workspace_id=$2", [draft.id, workspaceB.workspaceId]); assert.equal(rows.rowCount, 1); assert.equal(rows.rows[0].source, "learning"); assert.ok(!JSON.stringify(rows.rows[0]).includes("PRIVATE_"));
});
await check("A04", "Reviewer sees only assigned cohort and cannot access other workspace", async () => {
  const own = await page("reviewer-a", `${base(workspaceA)}/manage`); assert.equal(own.status, 200);
  assert.ok(!own.text.includes("learner-a2@learning-test.invalid"));
  const other = await page("reviewer-a", `${base(workspaceB)}/manage`); assert.ok(other.status === 404 || !other.text.includes("learner-b@learning-test.invalid"));
});
await check("A05", "Sponsor and manager without review grant cannot view named results", async () => {
  for (const name of ["sponsor-a", "manager-a"]) {
    const result = await page(name, `${base(workspaceA)}/manage`); assert.ok(result.status === 404 || !result.text.includes("learner-a@learning-test.invalid"));
  }
});
await check("U04", "Named export requires scope, audits download and neutralizes formula whitespace", async () => {
  const reviewerId = fixture.accounts["reviewer-a"].id;
  const denied = await action("sponsor-a", "exportLearningCsv", scope(workspaceA)); assert.equal(denied.result?.ok, false);
  await database.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'contributor')", [workspaceB.workspaceId, reviewerId]);
  const grant = (await database.query("INSERT INTO learning_grants(workspace_id,program_id,user_id,capability,cohort_id,granted_by) VALUES ($1,$2,$3,'export','m1-cohort',$3) RETURNING id", [workspaceB.workspaceId, workspaceB.programId, reviewerId])).rows[0].id;
  await database.query("UPDATE users SET name=$1 WHERE id=$2", [" \t=1+2", runUserId]);
  try {
    const exported = await action("reviewer-a", "exportLearningCsv", scope(workspaceB)); assert.equal(exported.result?.ok, true);
    assert.ok(exported.result.data.csv.includes("' \t=1+2")); assert.ok(!exported.result.data.csv.includes("PRIVATE_"));
    const audits = await database.query("SELECT count(*)::int n FROM learning_audit_events WHERE program_id=$1 AND actor_id=$2 AND event_type='named_export'", [workspaceB.programId, reviewerId]); assert.ok(audits.rows[0].n > 0);
  } finally {
    await database.query("UPDATE users SET name='Synthetic HTTP learner' WHERE id=$1", [runUserId]);
    await database.query("DELETE FROM learning_grants WHERE id=$1", [grant]);
    await database.query("DELETE FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2", [workspaceB.workspaceId, reviewerId]);
  }
});
await check("U05", "Sponsor aggregate suppresses group below minimum and includes no names", async () => {
  const result = await page("sponsor-a", `${base(workspaceA)}/live`); assert.equal(result.status, 200);
  assert.ok(!result.text.includes("learner-a@learning-test.invalid")); assert.ok(!result.text.includes("PRIVATE_"));
});
await check("A07", "One account in two workspaces has separate program histories", async () => {
  const a = await page("shared", base(workspaceA)); const b = await page("shared", base(workspaceB));
  assert.equal(a.status, 200); assert.equal(b.status, 200); assert.ok(!b.text.includes(attempt?.id ?? "not-an-id"));
});
await check("A06", "Revocation takes effect on next action and preserves existing records", async () => {
  const user = fixture.accounts["learner-b2"].id;
  await database.query("DELETE FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2", [workspaceB.workspaceId, user]);
  try {
    const result = await action("learner-b2", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion });
    assert.equal(result.result?.ok, false); assert.equal(result.result?.code, "forbidden");
  } finally { await database.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'contributor')", [workspaceB.workspaceId, user]); }
});
await check("R04", "Workspace-specific feature flag blocks writes and preserves other program", async () => {
  await database.query("UPDATE learning_programs SET feature_enabled=false WHERE id=$1", [workspaceB.programId]);
  try {
    const result = await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion });
    assert.equal(result.result?.ok, false); assert.equal(result.result?.code, "forbidden");
    assert.equal((await page("shared", base(workspaceA))).status, 200);
  } finally { await database.query("UPDATE learning_programs SET feature_enabled=true WHERE id=$1", [workspaceB.programId]); }
});
await check("A04-detail", "Reviewer direct detail URL denies another cohort and another workspace", async () => {
  let second = (await action("learner-a2", "startLearningAttempt", { ...scope(workspaceA), activityId: "m1-check", expectedVersion: fixture.contentVersion })).result.data;
  if (second.status === "draft") {
    second = (await action("learner-a2", "saveLearningDraft", { ...scope(workspaceA), attemptId: second.id, expectedRevision: second.revision, responses: { answers: correct("m1-check"), fields: {} } })).result.data;
    second = (await action("learner-a2", "submitLearningAttempt", { ...scope(workspaceA), attemptId: second.id, expectedRevision: second.revision, idempotencyKey: randomUUID() })).result.data;
  }
  assert.equal(second.status, "submitted");
  for (const [workspace, id] of [[workspaceA, second.id], [workspaceB, attempt.id]]) {
    const result = await page("reviewer-a", `${base(workspace)}/manage/${id}`);
    assert.ok(!result.text.includes("PRIVATE_FEEDBACK_MARKER")); assert.ok(!result.text.includes("Evidenze ·"));
  }
  const ownExport = await action("reviewer-a", "exportLearningCsv", scope(workspaceA)); assert.equal(ownExport.result?.ok, true);
  assert.ok(!ownExport.result.data.csv.includes("learner-a2@learning-test.invalid"));
  const foreignExport = await action("reviewer-a", "exportLearningCsv", scope(workspaceB)); assert.equal(foreignExport.result?.code, "forbidden");
});
await check("A06-read-save", "Revoked learner membership denies existing receipt read and draft save", async () => {
  const draft = (await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion })).result.data;
  await database.query("DELETE FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2", [workspaceB.workspaceId, runUserId]);
  try {
    const saved = await action("learner-b", "saveLearningDraft", { ...scope(workspaceB), attemptId: draft.id, expectedRevision: draft.revision, responses: draft.responses });
    assert.equal(saved.result?.code, "forbidden");
    const receipt = await page("learner-b", `${base(workspaceB)}/attempts/${attempt.id}`);
    assert.ok(!receipt.text.includes("PRIVATE_FEEDBACK_MARKER")); assert.ok(!receipt.text.includes("Generic prompt"));
  } finally { await database.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'contributor')", [workspaceB.workspaceId, runUserId]); }
});
await check("A06-export", "Revoked reviewer membership denies list and named export despite retained grants", async () => {
  const user = fixture.accounts["reviewer-a"].id;
  const allowed = await action("reviewer-a", "exportLearningCsv", scope(workspaceA)); assert.equal(allowed.result?.ok, true);
  await database.query("DELETE FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2", [workspaceA.workspaceId, user]);
  try {
    const denied = await action("reviewer-a", "exportLearningCsv", scope(workspaceA)); assert.equal(denied.result?.code, "forbidden");
    const list = await page("reviewer-a", `${base(workspaceA)}/manage`); assert.ok(!list.text.includes("learner-a@learning-test.invalid"));
  } finally { await database.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'contributor')", [workspaceA.workspaceId, user]); }
});
await check("D08", "Publishing a new version preserves previous draft answers, order and content", async () => {
  const started = (await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion })).result.data;
  const partialAnswers = Object.fromEntries(Object.entries(correct("m1-check")).slice(0, 2));
  const saved = await action("learner-b", "saveLearningDraft", { ...scope(workspaceB), attemptId: started.id, expectedRevision: started.revision, responses: { answers: partialAnswers, fields: {} } });
  assert.equal(saved.result?.ok, true, `Partial draft save rejected: ${saved.result?.code}`);
  const prior = saved.result.data;
  assert.equal(Object.keys(prior.responses.answers).length, 2);
  const pack = createOperationalTestPack(); pack.content_version = `version-${randomUUID()}`;
  pack.items.find((item) => item.activity_id === "m1-check").prompt = "NEW_VERSION_ONLY_MARKER";
  const programId = randomUUID(), next = { ...workspaceB, programId };
  await database.query("INSERT INTO learning_programs(id,workspace_id,family_key,title,content_version,pack_hash,private_pack,feature_enabled,visibility_policy,retention_days,published_by) SELECT $1,workspace_id,family_key,'Synthetic version test',$2,$3,$4,true,visibility_policy,retention_days,published_by FROM learning_programs WHERE id=$5", [programId, pack.content_version, trainingPackHash(pack), pack, workspaceB.programId]);
  await database.query("INSERT INTO learning_sessions(workspace_id,program_id,module_id,cohort_id,starts_at,ends_at,timezone,status) SELECT workspace_id,$1,module_id,cohort_id,starts_at,ends_at,timezone,status FROM learning_sessions WHERE program_id=$2", [programId, workspaceB.programId]);
  await database.query("INSERT INTO learning_enrollments(workspace_id,program_id,user_id,module_id,cohort_id) VALUES ($1,$2,$3,'m1','m1-cohort')", [workspaceB.workspaceId, programId, runUserId]);
  const updated = await action("learner-b", "startLearningAttempt", { ...scope(next), activityId: "m1-check", expectedVersion: pack.content_version });
  assert.equal(updated.result?.ok, true); assert.ok(updated.result.data.activity.items.some((item) => item.prompt === "NEW_VERSION_ONLY_MARKER"));
  const resumed = await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion });
  assert.equal(resumed.result?.ok, true); assert.deepEqual(resumed.result.data, prior);
  const staleVersion = await action("learner-b", "startLearningAttempt", { ...scope(next), activityId: "m1-check", expectedVersion: fixture.contentVersion }); assert.equal(staleVersion.result?.code, "conflict");
});
await check("D09-future", "Server time denies future scheduled activity start and existing draft save", async () => {
  const rows = (await database.query("SELECT id,starts_at,ends_at,status FROM learning_sessions WHERE program_id=$1 AND module_id='m1'", [workspaceB.programId])).rows;
  const draft = (await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion })).result.data;
  await database.query("UPDATE learning_sessions SET starts_at=now()+interval '1 day',ends_at=now()+interval '2 days',status='scheduled' WHERE program_id=$1 AND module_id='m1'", [workspaceB.programId]);
  try {
    const started = await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion }); assert.equal(started.result?.code, "closed");
    const saved = await action("learner-b", "saveLearningDraft", { ...scope(workspaceB), attemptId: draft.id, expectedRevision: draft.revision, responses: draft.responses }); assert.equal(saved.result?.code, "closed");
    const forged = await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion, now: "2099-01-01T00:00:00Z" }); assert.equal(forged.result?.code, "invalid");
  } finally { for (const row of rows) await database.query("UPDATE learning_sessions SET starts_at=$2,ends_at=$3,status=$4 WHERE id=$1", [row.id, row.starts_at, row.ends_at, row.status]); }
});
await check("D09-archived", "Archived program denies writes and retains old feedback", async () => {
  await database.query("UPDATE learning_programs SET status='archived' WHERE id=$1", [workspaceB.programId]);
  try {
    const started = await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion }); assert.equal(started.result?.code, "closed");
    const receipt = await page("learner-b", `${base(workspaceB)}/attempts/${attempt.id}`); assert.equal(receipt.status, 200); assert.ok(receipt.text.includes("PRIVATE_FEEDBACK_MARKER"));
  } finally { await database.query("UPDATE learning_programs SET status='published' WHERE id=$1", [workspaceB.programId]); }
});
await check("O02-atomic", "Failure inside submission audit rolls back result and allows a safe retry", async () => {
  const started = (await action("learner-b", "startLearningAttempt", { ...scope(workspaceB), activityId: "m1-check", expectedVersion: fixture.contentVersion })).result.data;
  const saved = (await action("learner-b", "saveLearningDraft", { ...scope(workspaceB), attemptId: started.id, expectedRevision: started.revision, responses: { answers: correct("m1-check"), fields: {} } })).result.data;
  const key = randomUUID(); const input = { ...scope(workspaceB), attemptId: started.id, expectedRevision: saved.revision, idempotencyKey: key };
  await database.query("CREATE OR REPLACE FUNCTION learning_test_fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Synthetic atomicity failure'; END $$");
  await database.query(`CREATE TRIGGER learning_test_fail_audit BEFORE INSERT ON learning_audit_events FOR EACH ROW WHEN (NEW.resource_id = '${started.id}'::uuid AND NEW.event_type = 'attempt_submitted') EXECUTE FUNCTION learning_test_fail_audit()`);
  try {
    const result = await action("learner-b", "submitLearningAttempt", input); assert.equal(result.result?.ok, false); assert.equal(result.result?.code, "technical");
    const row = await database.query("SELECT status,result,revision FROM learning_attempts WHERE id=$1", [started.id]); assert.equal(row.rows[0].status, "draft"); assert.equal(row.rows[0].result, null); assert.equal(row.rows[0].revision, saved.revision);
  } finally { await database.query("DROP TRIGGER learning_test_fail_audit ON learning_audit_events"); await database.query("DROP FUNCTION learning_test_fail_audit()"); }
  assert.equal((await action("learner-b", "submitLearningAttempt", input)).result?.ok, true);
});
await database.end();
await writeFile(resolve(output, runtime === "production" ? "http-acceptance-production.json" : "http-acceptance.json"), JSON.stringify({ timestamp: new Date().toISOString(), environment: `local PostgreSQL + Firebase Auth emulator + real Next ${runtime} JSON gateway + shared Server Action validation/DAL`, results: evidence }, null, 2));
console.log(JSON.stringify({ passed: evidence.filter((row) => row.status === "PASS").length, failed: evidence.filter((row) => row.status === "FAIL").length }));
if (evidence.some((row) => row.status === "FAIL")) process.exitCode = 1;
