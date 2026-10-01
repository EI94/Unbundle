import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { createOperationalTestPack } from "./fixture-pack.mjs";
import { trainingPackHash, createAttemptOrder } from "../../src/lib/learning/pack.ts";

const output = process.env.LEARNING_TEST_OUTPUT;
if (!output?.startsWith("/private/tmp/") && !output?.startsWith("/tmp/")) throw new Error("Use temporary fixture directory");
const fixtures = JSON.parse(await readFile(resolve(output, "synthetic-fixtures.json"), "utf8"));
const requireFromApp = createRequire(resolve("package.json"));
const { Client } = requireFromApp("pg");
const databaseUrl = "postgresql://learning_test@127.0.0.1:55439/unbundle_learning_test";
const db = new Client({ connectionString: databaseUrl }); await db.connect();
const pack = createOperationalTestPack(), manager = fixtures.accounts["manager-a"].id;
const scoped = {};
await db.query("BEGIN");
const managerMembership = (await db.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,'contributor') ON CONFLICT DO NOTHING RETURNING id", [fixtures.workspaces.b.workspaceId, manager])).rows[0]?.id;
for (const letter of ["a", "b"]) {
  const workspaceId = fixtures.workspaces[letter].workspaceId, programId = randomUUID();
  const userId = fixtures.accounts[letter === "a" ? "learner-a2" : "learner-b2"].id;
  await db.query("INSERT INTO learning_programs(id,workspace_id,family_key,title,content_version,pack_hash,private_pack,status,closed_at,feature_enabled,visibility_policy,retention_days,published_by) VALUES ($1,$2,$3,'Synthetic retention test',$4,$5,$6,'closed',$7,false,'Synthetic test only',1,$8)", [programId, workspaceId, `retention-${programId}`, pack.content_version, trainingPackHash(pack), pack, new Date(Date.now() - (letter === "a" ? 3 * 86400000 : 60000)), manager]);
  await db.query("INSERT INTO learning_sessions(workspace_id,program_id,module_id,cohort_id,starts_at,ends_at,status) VALUES ($1,$2,'m1','retention',now()-interval '4 days',now()-interval '3 days','closed')", [workspaceId, programId]);
  const enrollmentId = (await db.query("INSERT INTO learning_enrollments(workspace_id,program_id,user_id,module_id,cohort_id) VALUES ($1,$2,$3,'m1','retention') RETURNING id", [workspaceId, programId, userId])).rows[0].id;
  await db.query("INSERT INTO learning_grants(workspace_id,program_id,user_id,capability,granted_by) VALUES ($1,$2,$3,'manage',$3)", [workspaceId, programId, manager]);
  const parentId = randomUUID(), childId = randomUUID(), order = createAttemptOrder(pack, "m1-exit-a");
  for (const [id, number, parent] of [[parentId, 1, null], [childId, 2, parentId]]) {
    await db.query("INSERT INTO learning_attempts(id,workspace_id,program_id,enrollment_id,user_id,activity_id,attempt_number,parent_attempt_id,content_version,pack_hash,item_order) VALUES ($1,$2,$3,$4,$5,'m1-exit-a',$6,$7,$8,$9,$10)", [id, workspaceId, programId, enrollmentId, userId, number, parent, pack.content_version, trainingPackHash(pack), order]);
  }
  const useCaseId = randomUUID();
  await db.query("INSERT INTO use_cases(id,workspace_id,title,source) VALUES ($1,$2,'Synthetic retained proposal','learning')", [useCaseId, workspaceId]);
  await db.query("INSERT INTO learning_idea_drafts(id,workspace_id,program_id,enrollment_id,user_id,status,idempotency_key,resulting_use_case_id) VALUES ($6,$1,$2,$3,$4,'submitted',$5,$6)", [workspaceId, programId, enrollmentId, userId, randomUUID(), useCaseId]);
  scoped[letter] = { workspaceId, programId, useCaseId };
}
await db.query("COMMIT");
const env = Object.fromEntries(["PATH", "TMPDIR", "LANG", "LC_ALL", "SHELL", "USER", "HOME"].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
Object.assign(env, { LEARNING_ADMIN_DATABASE_URL: databaseUrl, LEARNING_TEST_DATABASE_URL: databaseUrl, NODE_OPTIONS: `--require=${resolve("scripts/learning-test/local-neon.cjs")}` });
const run = (target, apply = false, actor = manager) => {
  const args = ["--no-warnings", "scripts/learning-retention.ts", "--workspace", target.workspaceId, "--program", target.programId, "--actor", actor, "--environment", "local", "--confirm-database", "127.0.0.1:55439/unbundle_learning_test", ...(apply ? ["--apply", "--confirm-authorized"] : [])];
  const result = spawnSync(process.execPath, args, { cwd: process.cwd(), env, encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
};
const count = async (target, table) => Number((await db.query(`SELECT count(*) n FROM ${table} WHERE workspace_id=$1 AND program_id=$2`, [target.workspaceId, target.programId])).rows[0].n);
const results = [];
async function check(id, title, fn) {
  try { await fn(); results.push({ id, title, status: "PASS" }); } catch (error) { results.push({ id, title, status: "FAIL", error: error.message }); }
  console.log(`${results.at(-1).status} ${id} ${title}`);
}
await check("O03-retention-dry", "Dry run reports eligible counts without deleting", async () => {
  const result = run(scoped.a); assert.equal(result.status, 0, result.stderr); const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.status, "DRY_RUN_READ_ONLY"); assert.deepEqual(parsed.wouldDelete, { attempts: 2, ideaDrafts: 1 });
  assert.equal(await count(scoped.a, "learning_attempts"), 2); assert.equal(await count(scoped.a, "learning_idea_drafts"), 1);
});
await check("O03-retention-scope", "Actor without manager grant cannot delete", async () => {
  assert.notEqual(run(scoped.a, true, fixtures.accounts["sponsor-a"].id).status, 0); assert.equal(await count(scoped.a, "learning_attempts"), 2);
});
await check("O03-retention-date", "Non-expired other-workspace records cannot be deleted", async () => {
  assert.notEqual(run(scoped.b, true).status, 0); assert.equal(await count(scoped.b, "learning_attempts"), 2);
});
await check("O03-retention-apply", "Expired answers and drafts delete atomically; portfolio and other workspace survive", async () => {
  const result = run(scoped.a, true); assert.equal(result.status, 0, result.stderr);
  assert.equal(await count(scoped.a, "learning_attempts"), 0); assert.equal(await count(scoped.a, "learning_idea_drafts"), 0);
  assert.equal(await count(scoped.b, "learning_attempts"), 2); assert.equal(await count(scoped.b, "learning_idea_drafts"), 1);
  assert.equal((await db.query("SELECT id FROM use_cases WHERE id=$1", [scoped.a.useCaseId])).rowCount, 1);
  const audit = await db.query("SELECT metadata FROM learning_audit_events WHERE program_id=$1 AND event_type='retention_purged'", [scoped.a.programId]);
  assert.equal(audit.rowCount, 1); assert.equal(audit.rows[0].metadata.attemptsDeleted, 2); assert.equal(audit.rows[0].metadata.ideaDraftsDeleted, 1);
});
await check("O03-retention-repeat", "Repeated retention is idempotent and keeps enrollment evidence", async () => {
  const result = run(scoped.a, true); assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout); assert.equal(parsed.counts.attemptsDeleted, 0); assert.equal(parsed.counts.ideaDraftsDeleted, 0); assert.equal(await count(scoped.a, "learning_enrollments"), 1);
});
if (managerMembership) await db.query("DELETE FROM workspace_memberships WHERE id=$1", [managerMembership]);
await db.end();
await writeFile(resolve(output, "retention-acceptance.json"), JSON.stringify({ timestamp: new Date().toISOString(), environment: "isolated local PostgreSQL", programs: scoped, results }, null, 2));
if (results.some((row) => row.status === "FAIL")) process.exitCode = 1;
