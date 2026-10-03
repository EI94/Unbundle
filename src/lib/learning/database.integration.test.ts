import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";

// Opt-in integration suite. A loopback database and an explicit isolated-test marker
// are required; the ordinary unit suite does not contact any database.
const url=process.env.LEARNING_TEST_DATABASE_URL;
const authorized=process.env.LEARNING_TEST_ISOLATED==="true";
if(url && (!authorized || !["127.0.0.1","localhost","[::1]"].includes(new URL(url).hostname))) throw new Error("Learning DB tests require an explicitly isolated loopback database");
const sql=url?neon(url):null;
const ids={org:randomUUID(),w1:randomUUID(),w2:randomUUID(),u1:randomUUID(),u2:randomUUID(),p1:randomUUID(),p2:randomUUID(),e1:randomUUID(),e2:randomUUID(),a1:randomUUID()};
const opts={skip:!sql};
before(async()=>{
  if(!sql)return;
  await sql`INSERT INTO organizations(id,name,slug) VALUES (${ids.org}::uuid,'Learning DB Test',${`learning-test-${ids.org}`})`;
  await sql`INSERT INTO users(id,email) VALUES (${ids.u1}::uuid,${`one-${ids.u1}@example.invalid`}),(${ids.u2}::uuid,${`two-${ids.u2}@example.invalid`})`;
  await sql`INSERT INTO workspaces(id,organization_id,name) VALUES (${ids.w1}::uuid,${ids.org}::uuid,'Synthetic A'),(${ids.w2}::uuid,${ids.org}::uuid,'Synthetic B')`;
  await sql`INSERT INTO learning_programs(id,workspace_id,family_key,title,content_version,pack_hash,private_pack,visibility_policy,retention_days,published_by)
    VALUES (${ids.p1}::uuid,${ids.w1}::uuid,'fixture','Synthetic','v1',${"0".repeat(64)},'{}','Synthetic test policy',1,${ids.u1}::uuid),
      (${ids.p2}::uuid,${ids.w2}::uuid,'fixture','Synthetic','v1',${"0".repeat(64)},'{}','Synthetic test policy',1,${ids.u1}::uuid)`;
  await sql`INSERT INTO learning_sessions(workspace_id,program_id,module_id,cohort_id,starts_at,ends_at)
    VALUES (${ids.w1}::uuid,${ids.p1}::uuid,'m1','a',now(),now()+interval '2 hours'),(${ids.w1}::uuid,${ids.p1}::uuid,'m1','b',now(),now()+interval '2 hours'),(${ids.w2}::uuid,${ids.p2}::uuid,'m1','a',now(),now()+interval '2 hours')`;
  await sql`INSERT INTO learning_enrollments(id,workspace_id,program_id,user_id,module_id,cohort_id)
    VALUES (${ids.e1}::uuid,${ids.w1}::uuid,${ids.p1}::uuid,${ids.u1}::uuid,'m1','a'),(${ids.e2}::uuid,${ids.w2}::uuid,${ids.p2}::uuid,${ids.u2}::uuid,'m1','a')`;
  await sql`INSERT INTO learning_attempts(id,workspace_id,program_id,enrollment_id,user_id,activity_id,attempt_number,content_version,pack_hash,item_order)
    VALUES (${ids.a1}::uuid,${ids.w1}::uuid,${ids.p1}::uuid,${ids.e1}::uuid,${ids.u1}::uuid,'synthetic-check',1,'v1',${"0".repeat(64)},'{"itemIds":["q1"],"optionIds":{"q1":["x","y"]}}')`;
});
after(async()=>{
  if(!sql)return;
  await sql`DELETE FROM learning_idea_drafts WHERE workspace_id IN (${ids.w1}::uuid,${ids.w2}::uuid)`;
  await sql`DELETE FROM learning_attempts WHERE workspace_id IN (${ids.w1}::uuid,${ids.w2}::uuid)`;
  await sql`DELETE FROM learning_enrollments WHERE workspace_id IN (${ids.w1}::uuid,${ids.w2}::uuid)`;
  await sql`DELETE FROM workspaces WHERE id IN (${ids.w1}::uuid,${ids.w2}::uuid)`;
  await sql`DELETE FROM organizations WHERE id=${ids.org}::uuid`;
  await sql`DELETE FROM users WHERE id IN (${ids.u1}::uuid,${ids.u2}::uuid)`;
});
test("database refuses a child program ID from a different workspace",opts,async()=>{
  await assert.rejects(()=>sql!`INSERT INTO learning_sessions(workspace_id,program_id,module_id,cohort_id,starts_at,ends_at) VALUES (${ids.w2}::uuid,${ids.p1}::uuid,'m1','invalid',now(),now()+interval '1 hour')`,/foreign key/i);
});
test("database prevents assigning a second M1 cohort to the same account",opts,async()=>{
  await assert.rejects(()=>sql!`INSERT INTO learning_enrollments(workspace_id,program_id,user_id,module_id,cohort_id) VALUES (${ids.w1}::uuid,${ids.p1}::uuid,${ids.u1}::uuid,'m1','b')`,/unique/i);
});
test("database refuses an attempt with another enrollment owner",opts,async()=>{
  await assert.rejects(()=>sql!`INSERT INTO learning_attempts(workspace_id,program_id,enrollment_id,user_id,activity_id,attempt_number,content_version,pack_hash,item_order) VALUES (${ids.w1}::uuid,${ids.p1}::uuid,${ids.e1}::uuid,${ids.u2}::uuid,'synthetic-other',1,'v1',${"0".repeat(64)},'{}')`,/foreign key/i);
});
test("published private content and pinned attempt order are immutable",opts,async()=>{
  await assert.rejects(()=>sql!`UPDATE learning_programs SET private_pack='{"changed":true}' WHERE id=${ids.p1}::uuid`,/immutable/i);
  await assert.rejects(()=>sql!`UPDATE learning_attempts SET item_order='{}',revision=revision+1 WHERE id=${ids.a1}::uuid`,/immutable/i);
});
test("one portfolio draft per participant prevents duplicate initial starts",opts,async()=>{
  await sql!`INSERT INTO learning_idea_drafts(workspace_id,program_id,enrollment_id,user_id) VALUES (${ids.w1}::uuid,${ids.p1}::uuid,${ids.e1}::uuid,${ids.u1}::uuid)`;
  await assert.rejects(()=>sql!`INSERT INTO learning_idea_drafts(workspace_id,program_id,enrollment_id,user_id) VALUES (${ids.w1}::uuid,${ids.p1}::uuid,${ids.e1}::uuid,${ids.u1}::uuid)`,/unique/i);
});
test("individual decision lock preserves answers while allowing reflection",opts,async()=>{
  await sql!`UPDATE learning_attempts SET responses='{"answers":{"q1":"x"},"fields":{}}',decisions_submitted_at=now(),revision=revision+1 WHERE id=${ids.a1}::uuid`;
  await assert.rejects(()=>sql!`UPDATE learning_attempts SET responses='{"answers":{"q1":"y"},"fields":{}}',revision=revision+1 WHERE id=${ids.a1}::uuid`,/immutable/i);
  await sql!`UPDATE learning_attempts SET responses='{"answers":{"q1":"x"},"fields":{"reflection":"Synthetic reflection"}}',revision=revision+1 WHERE id=${ids.a1}::uuid`;
});
test("submitted answers and results cannot be rewritten, revision must advance",opts,async()=>{
  await assert.rejects(()=>sql!`UPDATE learning_attempts SET revision=revision+2 WHERE id=${ids.a1}::uuid`,/one/i);
  await sql!`UPDATE learning_attempts SET status='submitted',result='{"correct":1,"total":1}',submitted_at=now(),idempotency_key=${randomUUID()}::uuid,revision=revision+1 WHERE id=${ids.a1}::uuid`;
  await assert.rejects(()=>sql!`UPDATE learning_attempts SET result='{"correct":0}',revision=revision+1 WHERE id=${ids.a1}::uuid`,/immutable/i);
  const rows=await sql!`SELECT status,revision,result FROM learning_attempts WHERE id=${ids.a1}::uuid`;
  assert.equal(rows[0].status,"submitted");assert.deepEqual(rows[0].result,{correct:1,total:1});assert.equal(rows[0].revision,4);
});
