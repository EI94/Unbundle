/** O01: real local session + Learning JSON gateway, synthetic users, isolated DB only. */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createOperationalTestPack } from "./fixture-pack.mjs";
import { parseTrainingPack, trainingPackHash, localDateTimeToUtc } from "../../src/lib/learning/pack.ts";

const output = process.env.LEARNING_TEST_OUTPUT;
if (!output?.startsWith("/private/tmp/") && !output?.startsWith("/tmp/")) throw new Error("LEARNING_TEST_OUTPUT must be a temporary directory outside Git");
if (process.env.LEARNING_TEST_ISOLATED !== "true") throw new Error("Explicit LEARNING_TEST_ISOLATED=true required");
const count = Number(process.env.LEARNING_LOAD_USERS ?? 50);
if (!Number.isInteger(count) || count < 50 || count > 100) throw new Error("Use 50–100 synthetic users; no unbounded load");
const runtime = process.env.LEARNING_LOAD_RUNTIME ?? "development";
if (!["development", "production"].includes(runtime)) throw new Error("LEARNING_LOAD_RUNTIME must be development or production");
const origin = "http://127.0.0.1:53100";
const authOrigin = "http://127.0.0.1:59099";
const requireFromApp = createRequire(resolve("package.json"));
const { Client } = requireFromApp("pg");
const database = new Client({ host: "127.0.0.1", port: 55439, user: "learning_test", database: "unbundle_learning_test" });
const runId = randomUUID();
const scope = { workspaceId: randomUUID(), programId: randomUUID() };
const organizationId = randomUUID();
const activityId = "m1-exit-a";
const activityUrl = `${origin}/dashboard/${scope.workspaceId}/learning/${scope.programId}/activities/${activityId}`;
const pack = parseTrainingPack(createOperationalTestPack());
const answers = Object.fromEntries(pack.items.filter(i => i.activity_id === activityId).map(i => [i.id, i.correct_option_ids[0]]));
const accounts = [];
const evidence = {
  timestamp: new Date().toISOString(), runId, test: "O01", userCount: count,
  environment: `Local Next ${runtime === "production" ? "optimized production start" : "dev --webpack"}; Firebase Auth emulator; real Neon/Drizzle SQL through loopback PostgreSQL test transport`, runtime,
  database: "127.0.0.1:55439/unbundle_learning_test", codeCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  workingTreeDirty: !!execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim(),
  sourceHashes: {}, transport: "POST /api/learning same-origin JSON gateway",
  targets: { warmAutosaveP95Ms: 1500, warmObjectiveSubmitP95Ms: 2000 },
  phases: {}, checks: [], status: "RUNNING", cleanup: "NOT_RUN",
  limitations: [
    "Application, emulator and database share one local host; not production infrastructure.",
    "The Neon production HTTP transport is replaced only in the test process by the loopback adapter.",
    "Build compilation is not measured by this harness. Initial page/handler prewarm is recorded separately from warm percentiles; it is not a serverless cold-start measurement.",
    "Session endpoint uses genuine emulator ID tokens. Browser Google/email sign-in UI is not measured.",
  ],
};
for (const path of ["src/lib/learning/server.ts", "src/lib/learning/schema.ts", "src/lib/actions/learning.ts", "src/lib/learning/grading.ts", "src/lib/learning/http.ts", "src/app/api/learning/route.ts", "scripts/learning-test/load.mjs"])
  evidence.sourceHashes[path] = createHash("sha256").update(await readFile(path)).digest("hex");
function percentile(sorted, ratio) { return sorted.length ? Math.round(sorted[Math.ceil(sorted.length * ratio) - 1] * 10) / 10 : null; }
function metrics(samples) {
  const times = samples.filter(s => s.ok).map(s => s.elapsedMs).sort((a, b) => a - b);
  return { requests: samples.length, succeeded: times.length, failed: samples.length - times.length, p50Ms: percentile(times, .5), p95Ms: percentile(times, .95), maxMs: times.length ? Math.round(times.at(-1) * 10) / 10 : null,
    errors: [...new Set(samples.filter(s => !s.ok).map(s => s.error))] };
}
async function timed(operation) {
  const started = performance.now();
  try { const value = await operation(); return { ok: true, elapsedMs: performance.now() - started, value }; }
  catch (error) { return { ok: false, elapsedMs: performance.now() - started, error: error.message }; }
}
async function session(account) {
  const response = await fetch(`${origin}/api/auth/session`, { method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ idToken: account.idToken }), signal: AbortSignal.timeout(60_000) });
  const cookie = response.headers.get("set-cookie");
  await response.text();
  if (!response.ok || !cookie?.startsWith("__session=")) throw new Error(`Session endpoint status ${response.status}`);
  account.cookie = cookie.split(";")[0];
}
async function action(account, exportedName, input) {
  const response = await fetch(`${origin}/api/learning`, { method: "POST", redirect: "error", signal: AbortSignal.timeout(60_000),
    headers: { "content-type": "application/json", accept: "application/json", origin, cookie: account.cookie }, body: JSON.stringify({operation: exportedName, input}) });
  const result = await response.json();
  if (!response.ok || !result?.ok) throw new Error(`${exportedName}: HTTP ${response.status}, ${result?.code ?? "missing receipt"}`);
  return result.data;
}
async function wave(name, operation) {
  const started = performance.now();
  const samples = await Promise.all(accounts.map(a => timed(() => operation(a))));
  evidence.phases[name] = { ...metrics(samples), wallMs: Math.round(performance.now() - started), concurrency: count };
  console.log(`${name}: ${samples.filter(s => s.ok).length}/${count} confirmed; p95 ${evidence.phases[name].p95Ms} ms`);
  return samples;
}
async function check(name, operation) {
  try { await operation(); evidence.checks.push({ name, status: "PASS" }); }
  catch (error) { evidence.checks.push({ name, status: "FAIL", error: error.message }); }
}
await mkdir(output, { recursive: true });
await database.connect();
try {
  // No production env, emails, invitations or real customer pack is used.
  for (let index = 0; index < count; index++) {
    const response = await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-only`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: `load-${runId}-${index}@learning-test.invalid`, password: randomUUID(), returnSecureToken: true }), signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    if (!response.ok || !body.localId || !body.idToken) throw new Error(`Emulator synthetic signup failed at ${index}`);
    const account = { id: randomUUID(), firebaseUid: body.localId, idToken: body.idToken, cookie: null, attempt: null, key: randomUUID() };
    accounts.push(account);
    await database.query("INSERT INTO users(id,firebase_uid,email,name,email_verified) VALUES($1,$2,$3,$4,now())", [account.id, body.localId, `load-${runId}-${index}@learning-test.invalid`, `Synthetic load ${index + 1}`]);
  }
  await database.query("INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)", [organizationId, "Synthetic load organization", `load-${runId}`]);
  await database.query("INSERT INTO workspaces(id,organization_id,name) VALUES($1,$2,$3)", [scope.workspaceId, organizationId, "Synthetic load workspace"]);
  await database.query("INSERT INTO learning_programs(id,workspace_id,family_key,title,content_version,pack_hash,private_pack,feature_enabled,visibility_policy,retention_days,published_by) VALUES($1,$2,'synthetic-load','Synthetic load program',$3,$4,$5,true,'Synthetic load only: scoped reviewer policy',1,$6)", [scope.programId, scope.workspaceId, pack.content_version, trainingPackHash(pack), pack, accounts[0].id]);
  const cohort = pack.modules.find(m => m.id === "m1").cohorts[0];
  await database.query("INSERT INTO learning_sessions(workspace_id,program_id,module_id,cohort_id,starts_at,ends_at,timezone,status) VALUES($1,$2,'m1',$3,$4,$5,$6,'open')", [scope.workspaceId, scope.programId, cohort.id, localDateTimeToUtc(cohort.start_local, cohort.timezone), localDateTimeToUtc(cohort.end_local, cohort.timezone), cohort.timezone]);
  for (const account of accounts) {
    await database.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,'contributor')", [scope.workspaceId, account.id]);
    await database.query("INSERT INTO learning_enrollments(workspace_id,program_id,user_id,module_id,cohort_id) VALUES($1,$2,$3,'m1',$4)", [scope.workspaceId, scope.programId, account.id, cohort.id]);
  }
  evidence.phases.prewarmSession = metrics([await timed(() => session(accounts[0]))]);
  const prewarmPage = await timed(async () => {
    const response = await fetch(activityUrl, { headers: { cookie: accounts[0].cookie }, signal: AbortSignal.timeout(60_000) });
    const text = await response.text(); assert.equal(response.status, 200); assert.ok(!text.includes("PRIVATE_FEEDBACK_MARKER"));
  });
  evidence.phases.prewarmPageNotColdCompile = metrics([prewarmPage]);
  assert.ok(prewarmPage.ok, prewarmPage.error);
  // Exercise all handlers once outside the measured waves. The practice checkpoint
  // is separate from the 50 final attempts whose integrity is checked below.
  const warmup = await timed(async () => {
    let a = await action(accounts[0], "startLearningAttempt", { ...scope, activityId: "m1-check", expectedVersion: pack.content_version });
    const checkAnswers = Object.fromEntries(pack.items.filter(i => i.activity_id === "m1-check").map(i => [i.id, i.correct_option_ids[0]]));
    a = await action(accounts[0], "saveLearningDraft", { ...scope, attemptId: a.id, expectedRevision: a.revision, responses: { answers: checkAnswers, fields: {} } });
    await action(accounts[0], "submitLearningAttempt", { ...scope, attemptId: a.id, expectedRevision: a.revision, idempotencyKey: randomUUID() });
  });
  evidence.phases.prewarmHandlers = metrics([warmup]); assert.ok(warmup.ok, warmup.error);
  const sessions = await wave("sessionConcurrent", session);
  assert.ok(sessions.every(s => s.ok), "Some synthetic sessions failed; dependent wave cannot run");
  const started = await wave("startConcurrent", async a => { a.attempt = await action(a, "startLearningAttempt", { ...scope, activityId, expectedVersion: pack.content_version }); });
  assert.ok(started.every(s => s.ok), "Some starts failed; dependent wave cannot run");
  const autosaveSamples = [];
  for (let round = 0; round < 3; round++) {
    const responseAnswers = round === 0 ? Object.fromEntries(Object.entries(answers).slice(0, 4)) : { ...answers };
    if (round === 1) { const first = pack.items.find(i => i.activity_id === activityId); responseAnswers[first.id] = first.options.find(o => !first.correct_option_ids.includes(o.id)).id; }
    const saves = await wave(`autosaveRound${round + 1}`, async a => {
      a.attempt = await action(a, "saveLearningDraft", { ...scope, attemptId: a.attempt.id, expectedRevision: a.attempt.revision, responses: { answers: responseAnswers, fields: {} } });
    });
    autosaveSamples.push(...saves); assert.ok(saves.every(s => s.ok), `Autosave round ${round + 1} failed; no false submit`);
  }
  evidence.phases.autosaveWarmCombined = { ...metrics(autosaveSamples), concurrency: count, rounds: 3 };
  const submitted = await wave("objectiveSubmitConcurrent", async a => {
    a.submitInput = { ...scope, attemptId: a.attempt.id, expectedRevision: a.attempt.revision, idempotencyKey: a.key };
    a.attempt = await action(a, "submitLearningAttempt", a.submitInput);
    assert.equal(a.attempt.status, "submitted"); assert.equal(a.attempt.result.correct, 8); assert.equal(a.attempt.result.status, "consolidated");
  });
  assert.ok(submitted.every(s => s.ok), "Some submissions lack a confirmed receipt");
  const progressUrl = `${origin}/dashboard/${scope.workspaceId}/learning/${scope.programId}/progress`;
  const progress = async a => {
    const response = await fetch(progressUrl, { headers: { cookie: a.cookie }, signal: AbortSignal.timeout(60_000) });
    const text = await response.text(); assert.equal(response.status, 200); assert.ok(text.includes(a.attempt.id), "Own confirmed attempt must appear in progress");
  };
  const progressPrewarm = await timed(() => progress(accounts[0]));
  evidence.phases.prewarmProgress = metrics([progressPrewarm]); assert.ok(progressPrewarm.ok, progressPrewarm.error);
  const dashboards = await wave("progressDashboardConcurrent", progress);
  await check("all 50 learner progress dashboards show their confirmed own attempt", async () => assert.ok(dashboards.every(s => s.ok)));
  const retries = await wave("lostAckRetryConcurrent", async a => { const receipt = await action(a, "submitLearningAttempt", a.submitInput); assert.deepEqual(receipt, a.attempt); });
  await check("50 final receipts each have one immutable attempt, one audit and original owner", async () => {
    const rows = (await database.query(`SELECT a.id,a.user_id,a.status,a.revision,a.result,a.idempotency_key,a.responses,
      (SELECT count(*)::int FROM learning_audit_events ev WHERE ev.resource_id=a.id AND ev.event_type='attempt_submitted') audits
      FROM learning_attempts a WHERE a.workspace_id=$1 AND a.program_id=$2 AND a.activity_id=$3`, [scope.workspaceId, scope.programId, activityId])).rows;
    assert.equal(rows.length, count); assert.equal(new Set(rows.map(r => r.user_id)).size, count);
    for (const account of accounts) {
      const row = rows.find(r => r.user_id === account.id); assert.ok(row); assert.equal(row.id, account.attempt.id);
      assert.equal(row.status, "submitted"); assert.equal(row.revision, 5); assert.equal(row.result.correct, 8); assert.equal(row.result.total, 8);
      assert.equal(row.audits, 1); assert.equal(row.idempotency_key, account.key); assert.deepEqual(row.responses.answers, answers);
    }
    evidence.integrity = { expectedFinalAttempts: count, finalAttempts: rows.length, uniqueOwners: new Set(rows.map(r => r.user_id)).size, submissionsAudits: rows.reduce((sum, r) => sum + r.audits, 0), persistedRevision: 5 };
  });
  await check("all retry receipts match the original confirmed submission", async () => assert.ok(retries.every(s => s.ok)));
  await check("warm autosave p95 under 1500 ms", async () => assert.ok(evidence.phases.autosaveWarmCombined.p95Ms < 1500, `Measured ${evidence.phases.autosaveWarmCombined.p95Ms} ms`));
  await check("warm objective submission p95 under 2000 ms", async () => assert.ok(evidence.phases.objectiveSubmitConcurrent.p95Ms < 2000, `Measured ${evidence.phases.objectiveSubmitConcurrent.p95Ms} ms`));
  evidence.status = evidence.checks.every(c => c.status === "PASS") ? "PASS_LOCAL_WARM_ONLY" : "FAIL";
} catch (error) {
  evidence.status = "FAIL"; evidence.checks.push({ name: "load harness completion", status: "FAIL", error: error.message });
} finally {
  try {
    await database.query("DELETE FROM learning_attempts WHERE workspace_id=$1 AND program_id=$2", [scope.workspaceId, scope.programId]);
    await database.query("DELETE FROM learning_enrollments WHERE workspace_id=$1 AND program_id=$2", [scope.workspaceId, scope.programId]);
    await database.query("DELETE FROM workspaces WHERE id=$1 AND organization_id=$2", [scope.workspaceId, organizationId]);
    await database.query("DELETE FROM organizations WHERE id=$1", [organizationId]);
    await database.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [accounts.map(a => a.id)]);
    for (const account of accounts) {
      const response = await fetch(`${authOrigin}/identitytoolkit.googleapis.com/v1/accounts:delete?key=local-only`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idToken: account.idToken }), signal: AbortSignal.timeout(15_000) });
      assert.ok(response.ok, "Synthetic Auth account cleanup failed");
    }
    evidence.cleanup = "PASS_OWN_SYNTHETIC_FIXTURES_REMOVED";
  } catch (error) { evidence.cleanup = `FAIL: ${error.message}`; evidence.status = "FAIL"; }
  await database.end();
  await writeFile(resolve(output, runtime === "production" ? "load-production-results.json" : "load-results.json"), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ status: evidence.status, checks: evidence.checks, cleanup: evidence.cleanup }, null, 2));
}
if (evidence.status !== "PASS_LOCAL_WARM_ONLY") process.exitCode = 1;
