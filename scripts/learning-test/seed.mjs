import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createOperationalTestPack } from "./fixture-pack.mjs";
import { parseTrainingPack, trainingPackHash, localDateTimeToUtc } from "../../src/lib/learning/pack.ts";

const requireFromApp = createRequire(resolve("package.json"));
const { Client } = requireFromApp("pg");
const outputDirectory = process.env.LEARNING_TEST_OUTPUT;
if (!outputDirectory?.startsWith("/private/tmp/") && !outputDirectory?.startsWith("/tmp/")) {
  throw new Error("LEARNING_TEST_OUTPUT must be a temporary directory outside Git");
}
const client = new Client({ host: "127.0.0.1", port: 55439, user: "learning_test", database: "unbundle_learning_test" });
await client.connect();
const exists = await client.query("SELECT id FROM organizations WHERE slug = 'learning-test-a'");
if (exists.rowCount) throw new Error("Synthetic fixtures already exist; keep the existing manifest or initialize a new isolated cluster");
const pack = createOperationalTestPack();
parseTrainingPack(pack);
const accounts = {};
const names = ["learner-a", "learner-a2", "learner-b", "learner-b2", "shared", "reviewer-a", "manager-a", "sponsor-a"];
for (const name of names) {
  const response = await fetch("http://127.0.0.1:59099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-only", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: `${name}@learning-test.invalid`, password: "Synthetic-only-4862", returnSecureToken: true }),
  });
  const body = await response.json();
  if (!response.ok || !body.localId) throw new Error(`Synthetic Auth signup failed for ${name}`);
  const id = randomUUID();
  accounts[name] = { id, firebaseUid: body.localId, email: `${name}@learning-test.invalid`, password: "Synthetic-only-4862" };
  await client.query("INSERT INTO users (id,firebase_uid,email,name,email_verified) VALUES ($1,$2,$3,$4,now())", [id, body.localId, accounts[name].email, `Synthetic ${name}`]);
}
const workspaces = {};
for (const letter of ["a", "b"]) {
  const organizationId = randomUUID(), workspaceId = randomUUID(), programId = randomUUID();
  await client.query("INSERT INTO organizations(id,name,slug) VALUES ($1,$2,$3)", [organizationId, `Synthetic Organization ${letter}`, `learning-test-${letter}`]);
  await client.query("INSERT INTO workspaces(id,organization_id,name) VALUES ($1,$2,$3)", [workspaceId, organizationId, `Synthetic Workspace ${letter.toUpperCase()}`]);
  await client.query("INSERT INTO learning_programs(id,workspace_id,family_key,title,content_version,pack_hash,private_pack,feature_enabled,visibility_policy,retention_days,published_by) VALUES ($1,$2,'generic-training',$3,$4,$5,$6,true,'Synthetic tests: assigned reviewers only',90,$7)", [programId, workspaceId, `Synthetic Learning ${letter.toUpperCase()}`, pack.content_version, trainingPackHash(pack), pack, accounts["manager-a"].id]);
  for (const trainingModule of pack.modules) for (const cohort of trainingModule.cohorts) {
    await client.query("INSERT INTO learning_sessions(workspace_id,program_id,module_id,cohort_id,starts_at,ends_at,timezone,status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [workspaceId, programId, trainingModule.id, cohort.id, localDateTimeToUtc(cohort.start_local, cohort.timezone), localDateTimeToUtc(cohort.end_local, cohort.timezone), cohort.timezone, trainingModule.id === "m1" ? "open" : "scheduled"]);
  }
  const learners = letter === "a" ? ["learner-a", "learner-a2", "shared"] : ["learner-b", "learner-b2", "shared"];
  const members = letter === "a" ? [...learners, "reviewer-a", "manager-a", "sponsor-a"] : learners;
  for (const member of members) {
    const role = member === "sponsor-a" ? "exec_sponsor" : member === "manager-a" ? "transformation_lead" : "contributor";
    await client.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,$3)", [workspaceId, accounts[member].id, role]);
  }
  for (const learner of learners) {
    await client.query("INSERT INTO learning_enrollments(workspace_id,program_id,user_id,module_id,cohort_id) VALUES ($1,$2,$3,'m1',$4)", [workspaceId, programId, accounts[learner].id, learner === "learner-a2" ? "m1-cohort-2" : "m1-cohort"]);
  }
  if (letter === "a") for (const [member, capability, cohort] of [
    ["reviewer-a", "review", "m1-cohort"], ["reviewer-a", "aggregate", "m1-cohort"], ["reviewer-a", "export", "m1-cohort"],
    ["manager-a", "manage", null], ["manager-a", "aggregate", null], ["sponsor-a", "aggregate", null],
  ]) {
    await client.query("INSERT INTO learning_grants(workspace_id,program_id,user_id,capability,cohort_id,granted_by) VALUES ($1,$2,$3,$4,$5,$6)", [workspaceId, programId, accounts[member].id, capability, cohort, accounts["manager-a"].id]);
  }
  workspaces[letter] = { organizationId, workspaceId, programId };
}
await client.end();
await mkdir(outputDirectory, { recursive: true });
await writeFile(resolve(outputDirectory, "synthetic-fixtures.json"), JSON.stringify({ accounts, workspaces, contentVersion: pack.content_version }, null, 2), { mode: 0o600 });
console.log("Created 8 synthetic emulator users, 2 workspaces/programs, 6 enrollments and scoped grants. Manifest saved outside Git.");
