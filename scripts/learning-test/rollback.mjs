import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = process.env.LEARNING_TEST_OUTPUT;
if (!output?.startsWith("/private/tmp/") && !output?.startsWith("/tmp/")) throw new Error("Use temporary output outside Git");
const baseline = process.argv.includes("--baseline");
if (process.argv.slice(2).some((arg) => arg !== "--baseline")) throw new Error("Only --baseline is supported");
const fixture = JSON.parse(await readFile(resolve(output, "synthetic-fixtures.json"), "utf8"));
const requireFromApp = createRequire(resolve("package.json"));
const { Client } = requireFromApp("pg");
const database = new Client({ host: "127.0.0.1", port: 55439, user: "learning_test", database: "unbundle_learning_test" });
await database.connect();
const workspace = fixture.workspaces.b, origin = baseline ? "http://127.0.0.1:53104" : "http://127.0.0.1:53103";
const base = `${origin}/dashboard/${workspace.workspaceId}`;
const login = await fetch("http://127.0.0.1:53102/as/learner-b2", { redirect: "manual" });
assert.equal(login.status, 302);
const cookie = login.headers.get("set-cookie").split(";")[0];
async function state() {
  const rows = {};
  for (const table of ["learning_programs", "learning_enrollments", "learning_sessions", "learning_grants", "learning_attempts", "learning_audit_events", "learning_idea_drafts", "use_cases"]) {
    rows[table] = (await database.query(`SELECT count(*)::int count, md5(COALESCE(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) digest FROM ${table} t WHERE workspace_id=ANY($1::uuid[])`, [[fixture.workspaces.a.workspaceId, workspace.workspaceId]])).rows[0];
  }
  rows.ai_readiness_responses = (await database.query("SELECT count(*)::int count, md5(COALESCE(string_agg(to_jsonb(t)::text,'|' ORDER BY id),'')) digest FROM ai_readiness_responses t")).rows[0];
  return rows;
}
const before = await state(), results = [];
async function check(id, title, run) {
  try { await run(); results.push({ id, title, status: "PASS" }); }
  catch (error) { results.push({ id, title, status: "FAIL", error: error.message }); }
  console.log(`${results.at(-1).status} ${id} ${title}${results.at(-1).error ? `: ${results.at(-1).error}` : ""}`);
}
if (!baseline) await check("R03-global-flag", "Global flag off blocks direct learning actions and hides navigation", async () => {
  const home = await fetch(base, { headers: { cookie }, redirect: "manual" }); assert.equal(home.status, 200);
  assert.ok(!(await home.text()).includes(`href="/dashboard/${workspace.workspaceId}/learning"`));
  const learning = await fetch(`${base}/learning`, { headers: { cookie }, redirect: "manual" }); assert.equal(learning.status, 200);
  assert.ok((await learning.text()).includes("La formazione non è ancora attiva"));
  const response = await fetch(`${origin}/api/learning`, {
    method: "POST", headers: { cookie, origin, "content-type": "application/json" },
    body: JSON.stringify({ operation: "startLearningAttempt", input: { expectedUserId: fixture.accounts["learner-b2"].id, workspaceId: workspace.workspaceId, programId: workspace.programId, activityId: "m1-check", expectedVersion: fixture.contentVersion } }),
  });
  assert.equal(response.status, 503);
  const result = await response.json(); assert.equal(result.ok, false); assert.equal(result.code, "unavailable");
});
if (baseline) await check("O04-old-route", "Previous application build has no learning route or navigation", async () => {
  const response = await fetch(`${base}/learning`, { headers: { cookie }, redirect: "manual" }); assert.equal(response.status, 404);
  const home = await fetch(base, { headers: { cookie }, redirect: "manual" }); assert.equal(home.status, 200);
  assert.ok(!(await home.text()).includes(`href="/dashboard/${workspace.workspaceId}/learning"`));
});
await check(baseline ? "O04-existing-routes" : "R03-existing-routes", "Existing workspace, portfolio and readiness pages render with additive learning schema retained", async () => {
  for (const route of ["", "portfolio", "ai-readiness"]) {
    const response = await fetch(route ? `${base}/${route}` : base, { headers: { cookie }, redirect: "manual" }); assert.equal(response.status, 200, route);
  }
});
await check(baseline ? "O04-data" : "R03-data", "Probe preserves exact two-workspace training/portfolio and all anonymous response rows", async () => {
  assert.deepEqual(await state(), before);
});
await database.end();
await writeFile(resolve(output, baseline ? "rollback-baseline.json" : "rollback-global-flag.json"), JSON.stringify({ timestamp: new Date().toISOString(), environment: baseline ? "Previous e63a2a719410af77982c85522dad6339975f869e build on local53104, retaining additive schema" : "Optimized local server on53103 with LEARNING_ENABLED=false", results, scope: "Synthetic workspaces A/B and all isolated readiness responses; production/provider rollback remains separate", before }, null, 2));
if (results.some((row) => row.status === "FAIL")) process.exitCode = 1;
