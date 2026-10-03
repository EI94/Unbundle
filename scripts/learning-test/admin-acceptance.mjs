import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { generateKeyPairSync, randomUUID, createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createOperationalTestPack } from "./fixture-pack.mjs";

const output = process.env.LEARNING_TEST_OUTPUT;
if (!output?.startsWith("/private/tmp/") && !output?.startsWith("/tmp/")) throw new Error("Use temporary output outside Git");
const requireFromApp = createRequire(resolve("package.json"));
const { Client } = requireFromApp("pg");
const connect = async () => {
  const db = new Client({ host: "127.0.0.1", port: 55439, user: "learning_test", database: "unbundle_learning_test" });
  await db.connect(); return db;
};
const manifestPath = resolve(output, "admin-fixtures.json");
const origin = "http://127.0.0.1:53100";
const mode = process.argv[2];
if (mode && !["--setup", "--serve-login"].includes(mode)) throw new Error("Use --setup, --serve-login or no argument for tests");

async function setup() {
  const previous = JSON.parse(await readFile(resolve(output, "synthetic-fixtures.json"), "utf8"));
  let existing;
  try { existing = JSON.parse(await readFile(manifestPath, "utf8")); } catch { /* New test namespace. */ }
  process.env.FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:59099";
  const { initializeApp, cert } = requireFromApp("firebase-admin/app");
  const { getAuth } = requireFromApp("firebase-admin/auth");
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });
  const app = initializeApp({ projectId: "demo-unbundle-learning", credential: cert({ projectId: "demo-unbundle-learning", clientEmail: "local-test@demo-unbundle-learning.iam.gserviceaccount.com", privateKey }) });
  const auth = getAuth(app);
  const accounts = existing?.accounts ?? { ...previous.accounts };
  const addedNames = ["admin-bootstrap", "admin-other", "admin-second", "admin-org", "course-manager", "cohort-manager", "student-one", "student-two", "student-foreign", "viewer"];
  if (!existing) for (const name of addedNames) accounts[name] = { id: randomUUID(), firebaseUid: `admin-test-${randomUUID()}`, email: `${name}-${randomUUID()}@learning-test.invalid`, password: "Synthetic-only-Admin-2026" };
  for (const account of Object.values(accounts)) {
    try { await auth.getUser(account.firebaseUid); }
    catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
      await auth.createUser({ uid: account.firebaseUid, email: account.email, password: account.password, emailVerified: true });
    }
  }
  if (existing) { console.log("Restored existing synthetic emulator UIDs; database fixtures unchanged."); return; }
  const db = await connect(), workspaces = {};
  await db.query("BEGIN");
  try {
    for (const name of addedNames) {
      const account = accounts[name];
      await db.query("INSERT INTO users(id,firebase_uid,email,name,email_verified) VALUES ($1,$2,$3,$4,now())", [account.id, account.firebaseUid, account.email, `Synthetic ${name}`]);
    }
    for (const letter of ["a", "b"]) {
      const organizationId = randomUUID(), workspaceId = randomUUID();
      await db.query("INSERT INTO organizations(id,name,slug) VALUES ($1,$2,$3)", [organizationId, `Synthetic Admin ${letter.toUpperCase()}`, `admin-test-${organizationId}`]);
      await db.query("INSERT INTO workspaces(id,organization_id,name) VALUES ($1,$2,$3)", [workspaceId, organizationId, `Synthetic Admin ${letter.toUpperCase()}`]);
      const members = letter === "a" ? ["admin-bootstrap", "admin-second", "course-manager", "cohort-manager", "student-one", "student-two", "viewer"] : ["admin-other", "student-foreign"];
      for (const name of members) await db.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,$3)", [workspaceId, accounts[name].id, name.startsWith("admin-") ? "transformation_lead" : name === "viewer" ? "analyst" : "contributor"]);
      if (letter === "a") await db.query("INSERT INTO memberships(organization_id,user_id,role) VALUES ($1,$2,'exec_sponsor')", [organizationId, accounts["admin-org"].id]);
      workspaces[letter] = { organizationId, workspaceId };
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  finally { await db.end(); }
  const fixture = { accounts, workspaces, previousWorkspaces: previous.workspaces, createdAt: new Date().toISOString() };
  await writeFile(manifestPath, JSON.stringify(fixture, null, 2), { mode: 0o600 });
  const pack = createOperationalTestPack(); pack.content_version = "2026-10-02.admin-ui";
  await writeFile(resolve(output, "generic-admin-pack.json"), JSON.stringify(pack, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ createdSyntheticAccounts: addedNames.length, restoredPreviousAccounts: Object.keys(previous.accounts).length, workspaces, privateManifest: "outside Git", genericPack: "generic-admin-pack.json" }));
}

async function cookieFor(account) {
  const signIn = await fetch("http://127.0.0.1:59099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: account.email, password: account.password, returnSecureToken: true }),
  });
  const identity = await signIn.json(); assert.equal(signIn.status, 200, "Synthetic login failed");
  const response = await fetch(`${origin}/api/auth/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ idToken: identity.idToken }) });
  assert.equal(response.status, 200, "Real session endpoint rejected synthetic token");
  const cookie = response.headers.get("set-cookie"); assert.ok(cookie?.startsWith("__session=")); return cookie;
}

async function serveLogin() {
  const fixture = JSON.parse(await readFile(manifestPath, "utf8"));
  createServer(async (request, response) => {
    try {
      const name = new URL(request.url, "http://127.0.0.1:53102").pathname.replace(/^\/as\//, "");
      const account = fixture.accounts[name];
      if (!account || request.method !== "GET" || request.headers.host !== "127.0.0.1:53102") { response.writeHead(404); response.end(); return; }
      const cookie = await cookieFor(account);
      const isPrevious = Object.hasOwn(fixture.previousWorkspaces, "a") && ["learner-a", "learner-a2", "learner-b", "learner-b2", "manager-a", "reviewer-a", "sponsor-a", "shared"].includes(name);
      const workspace = isPrevious ? fixture.previousWorkspaces[name.startsWith("learner-b") ? "b" : "a"] : fixture.workspaces[name === "admin-other" || name === "student-foreign" ? "b" : "a"];
      const suffix = isPrevious ? `/${workspace.programId}${name === "reviewer-a" ? "/manage" : name === "sponsor-a" ? "/live" : ""}` : workspace.programId && ["student-one", "student-two", "course-manager"].includes(name) ? `/${workspace.programId}${name === "course-manager" ? "/manage" : ""}` : "/admin";
      response.writeHead(302, { "set-cookie": cookie, location: `${origin}/dashboard/${workspace.workspaceId}/learning${suffix}`, "cache-control": "no-store" }); response.end();
    } catch { response.writeHead(502, { "cache-control": "no-store" }); response.end("Synthetic session unavailable. Check local test services."); }
  }).listen(53102, "127.0.0.1", () => console.log("Synthetic admin login helper ready on127.0.0.1:53102/as/admin-bootstrap"));
}

async function runAcceptance() {
  const fixture = JSON.parse(await readFile(manifestPath, "utf8"));
  const accounts = fixture.accounts, db = await connect(), evidence = [], cookies = {};
  let clientScan;
  const runId = randomUUID(), runtime = process.env.LEARNING_TEST_RUNTIME === "production" ? "production" : "development";
  const workspaces = {};
  for (const name of ["admin-bootstrap", "admin-second", "admin-org", "course-manager", "cohort-manager", "student-one", "student-two", "student-foreign", "viewer", "admin-other"]) cookies[name] = (await cookieFor(accounts[name])).split(";")[0];
  await db.query("BEGIN");
  try {
    for (const letter of ["a", "b"]) {
      const organizationId = randomUUID(), workspaceId = randomUUID();
      await db.query("INSERT INTO organizations(id,name,slug) VALUES ($1,$2,$3)", [organizationId, "Synthetic Admin HTTP", `admin-http-${organizationId}`]);
      await db.query("INSERT INTO workspaces(id,organization_id,name) VALUES ($1,$2,'Synthetic Admin HTTP')", [workspaceId, organizationId]);
      const members = letter === "a" ? ["admin-bootstrap", "admin-second", "course-manager", "cohort-manager", "student-one", "student-two", "viewer"] : ["admin-other", "student-foreign"];
      for (const name of members) await db.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES ($1,$2,$3)", [workspaceId, accounts[name].id, name.startsWith("admin-") ? "transformation_lead" : name === "viewer" ? "analyst" : "contributor"]);
      if (letter === "a") await db.query("INSERT INTO memberships(organization_id,user_id,role) VALUES ($1,$2,'exec_sponsor')", [organizationId, accounts["admin-org"].id]);
      workspaces[letter] = { organizationId, workspaceId };
    }
    await db.query("COMMIT");
  } catch (error) { await db.query("ROLLBACK"); throw error; }
  const a = workspaces.a, b = workspaces.b;
  const pack = createOperationalTestPack(); pack.content_version = `admin-http-${runId}`;
  const settings = { title: "Synthetic administration course", visibilityPolicy: "Only explicit course reviewers can access individual results.", retentionDays: 90 };
  const cohort = "m1-cohort", otherCohort = "m1-cohort-2";
  const scope = (w=a) => ({ workspaceId: w.workspaceId, programId: w.programId });
  async function request(name, operation, input, options = {}) {
    if (!options.learner && operation === "settings" && !Object.hasOwn(input,"expectedSettings")) {
      const row=(await db.query('SELECT title,visibility_policy AS "visibilityPolicy",retention_days AS "retentionDays" FROM learning_programs WHERE workspace_id=$1 AND id=$2',[input.workspaceId,input.programId])).rows[0];
      input={...input,expectedSettings:row??settings};
    }
    if(options.learner && operation==="startLearningAttempt") input={expectedUserId:accounts[name]?.id,...input};
    const headers = { "content-type": "application/json", origin, ...(cookies[name] ? { cookie: cookies[name] } : {}), ...options.headers };
    for (const key of options.omitHeaders ?? []) delete headers[key];
    const response = await fetch(`${origin}${options.learner ? "/api/learning" : "/api/learning/admin"}`, { method: "POST", headers, body: options.body ?? JSON.stringify({ operation, input, ...(!options.learner ? { expectedUserId: Object.hasOwn(options, "expectedUserId") ? options.expectedUserId : accounts[name]?.id ?? accounts["admin-bootstrap"].id } : {}) }), redirect: "manual" });
    const text = await response.text(); let result;
    try { result = JSON.parse(text); } catch { /* Assertion below catches a non-JSON response. */ }
    return { status: response.status, result, text, location: response.headers.get("location"), cache: response.headers.get("cache-control") };
  }
  function good(response) { assert.equal(response.status,200, `${response.status}:${response.result?.code ?? "non-JSON"}`); assert.equal(response.result?.ok,true); return response.result.data; }
  function denied(response, codes = ["forbidden", "conflict", "closed"]) { assert.equal(response.result?.ok,false); assert.ok(codes.includes(response.result.code), `Unexpected denial: ${response.status}:${response.result?.code}`); assert.equal(response.location,null); }
  async function check(id, title, run) {
    const started = performance.now();
    try { await run(); evidence.push({ id, title, status: "PASS", elapsedMs: Math.round(performance.now()-started) }); }
    catch (error) { evidence.push({ id, title, status: "FAIL", error: String(error.message).slice(0,800) }); }
    console.log(`${evidence.at(-1).status} ${id} ${title}${evidence.at(-1).error ? `: ${evidence.at(-1).error}` : ""}`);
  }
  const detail = async (name="admin-bootstrap", w=a) => good(await request(name,"detail",scope(w)));
  const grant = async (name, capability, cohortId=null) => good(await request("admin-bootstrap","grant",{...scope(),userId:accounts[name].id,capability,cohortId}));
  const memberDelete = async name => db.query("DELETE FROM workspace_memberships WHERE workspace_id=$1 AND user_id=$2",[a.workspaceId,accounts[name].id]);
  const memberRestore = async (name,role="contributor") => db.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[a.workspaceId,accounts[name].id,role]);
  await check("ADMIN-01", "Anonymous admin request is recoverable JSON, not redirect or cache", async()=>{const r=await request("none","catalog",{workspaceId:a.workspaceId});assert.equal(r.status,401);denied(r,["unauthenticated"]);assert.ok(r.cache.includes("no-store"));});
  await check("ADMIN-02", "Missing/foreign Origin and spoofed forwarded host are rejected", async()=>{for(const options of [{omitHeaders:["origin"]},{headers:{origin:"https://foreign.invalid"}},{headers:{origin:"https://foreign.invalid","x-forwarded-host":"foreign.invalid"}}]){const r=await request("admin-bootstrap","catalog",{workspaceId:a.workspaceId},options);assert.equal(r.status,403);denied(r);}});
  await check("ADMIN-03", "Malformed JSON, unknown operation, extra fields and media fail closed", async()=>{for(const [body,type,status] of [["{","application/json",400],[JSON.stringify({expectedUserId:accounts["admin-bootstrap"].id,operation:"unknown",input:{}}),"application/json",422],[JSON.stringify({expectedUserId:accounts["admin-bootstrap"].id,operation:"catalog",input:{workspaceId:a.workspaceId},role:"manager"}),"application/json",422],["{}","text/plain",415]]){const r=await request("admin-bootstrap","catalog",{}, {body,headers:{"content-type":type}});assert.equal(r.status,status);assert.equal(r.result?.ok,false);}});
  await check("ADMIN-04", "Upload larger than five MiB is rejected before import", async()=>{const r=await request("admin-bootstrap","inspectPack",{}, {body:JSON.stringify({operation:"inspectPack",input:{workspaceId:a.workspaceId,pack:"x".repeat(5*1024*1024)}})});assert.equal(r.status,413);assert.equal(r.result?.ok,false);});
  await check("ADMIN-05", "Only effective workspace administrator roles may bootstrap", async()=>{for(const name of ["viewer","course-manager"]){const c=good(await request(name,"catalog",{workspaceId:a.workspaceId}));assert.equal(c.canCreate,false);denied(await request(name,"inspectPack",{workspaceId:a.workspaceId,pack}));denied(await request(name,"importPack",{workspaceId:a.workspaceId,pack,...settings}));}for(const name of ["admin-bootstrap","admin-org"]){const c=good(await request(name,"catalog",{workspaceId:a.workspaceId}));assert.equal(c.canCreate,true);assert.deepEqual(c.programs,[]);}});
  await check("ADMIN-06", "Organization membership priority prevents workspace-role elevation", async()=>{await db.query("INSERT INTO memberships(organization_id,user_id,role) VALUES($1,$2,'contributor')",[a.organizationId,accounts["admin-second"].id]);try{assert.equal(good(await request("admin-second","catalog",{workspaceId:a.workspaceId})).canCreate,false);denied(await request("admin-second","importPack",{workspaceId:a.workspaceId,pack,...settings}));}finally{await db.query("DELETE FROM memberships WHERE organization_id=$1 AND user_id=$2",[a.organizationId,accounts["admin-second"].id]);}});
  await check("ADMIN-07", "Pack inspection returns safe metadata and rejects invalid pack", async()=>{const r=await request("admin-bootstrap","inspectPack",{workspaceId:a.workspaceId,pack});const data=good(r);assert.equal(data.itemCount,pack.items.length);assert.equal(data.activityCount,pack.activities.length);assert.ok(!r.text.includes("PRIVATE_")&&!r.text.includes("correct_option_ids"));denied(await request("admin-bootstrap","inspectPack",{workspaceId:a.workspaceId,pack:{invalid:true}}),["invalid"]);});
  await check("ADMIN-08", "Import is atomic, disabled, audited and grants management only", async()=>{const r=good(await request("admin-bootstrap","importPack",{workspaceId:a.workspaceId,pack,...settings}));a.programId=r.programId;assert.equal(r.changed,1);const d=await detail();assert.equal(d.program.featureEnabled,false);assert.equal(d.program.canManageAll,true);assert.equal(d.sessions.length,pack.modules.reduce((n,m)=>n+m.cohorts.length,0));assert.equal(d.grants.length,1);assert.equal(d.grants[0].capability,"manage");assert.equal(d.audit.filter(e=>e.eventType==="program_imported").length,1);assert.ok(!JSON.stringify(d).includes("PRIVATE_")&&!JSON.stringify(d).includes("correct_option_ids"));});
  if(a.programId){
    await check("ADMIN-09", "Workspace administrator without course grant cannot read or manage imported course", async()=>{assert.deepEqual(good(await request("admin-second","catalog",{workspaceId:a.workspaceId})).programs,[]);denied(await request("admin-second","detail",scope()));denied(await request("admin-second","settings",{...scope(),...settings}));});
    await check("ADMIN-10", "Idempotent import preserves immutable content; changed content requires version", async()=>{const same=good(await request("admin-bootstrap","importPack",{workspaceId:a.workspaceId,pack,...settings}));assert.equal(same.programId,a.programId);assert.equal(same.changed,0);const changed=structuredClone(pack);changed.items[0].prompt="Changed synthetic prompt";denied(await request("admin-bootstrap","importPack",{workspaceId:a.workspaceId,pack:changed,...settings}),["conflict"]);const row=(await db.query("SELECT private_pack,pack_hash FROM learning_programs WHERE id=$1",[a.programId])).rows[0];assert.deepEqual(row.private_pack,pack);changed.content_version += ".2";const version=good(await request("admin-bootstrap","importPack",{workspaceId:a.workspaceId,pack:changed,...settings}));assert.notEqual(version.programId,a.programId);assert.deepEqual((await db.query("SELECT private_pack,pack_hash FROM learning_programs WHERE id=$1",[a.programId])).rows[0],row);});
    await check("ADMIN-11", "Last active unscoped manager cannot revoke their own grant", async()=>{const g=(await detail()).grants.find(g=>g.capability==="manage"&&!g.revokedAt);denied(await request("admin-bootstrap","revokeGrant",{...scope(),grantId:g.id}));assert.equal((await detail()).grants.filter(g=>g.capability==="manage"&&!g.revokedAt).length,1);});
    await check("ADMIN-12", "Tenant, program and nested object IDs cannot cross workspace boundary", async()=>{b.programId=good(await request("admin-other","importPack",{workspaceId:b.workspaceId,pack,...settings})).programId;good(await request("admin-other","enroll",{...scope(b),userIds:[accounts["student-foreign"].id],cohortId:cohort}));const d=await detail("admin-other",b);denied(await request("admin-bootstrap","enrollment",{...scope(),enrollmentId:d.enrollments[0].id,status:"revoked",cohortId:cohort}));for(const i of [{workspaceId:a.workspaceId,programId:b.programId},scope(b)])denied(await request("admin-bootstrap","detail",i));denied(await request("admin-bootstrap","session",{...scope(),sessionId:d.sessions[0].id,status:"open"}));denied(await request("admin-bootstrap","revokeGrant",{...scope(),grantId:d.grants[0].id}));assert.equal((await detail("admin-other",b)).sessions[0].status,d.sessions[0].status);});
    await check("ADMIN-13", "Management capability does not imply individual review or CSV export", async()=>{await grant("course-manager","manage");assert.equal((await detail("course-manager")).program.canManageAll,true);const grants=(await db.query("SELECT capability FROM learning_grants WHERE program_id=$1 AND user_id=$2 AND revoked_at IS NULL",[a.programId,accounts["course-manager"].id])).rows;assert.deepEqual(grants.map(g=>g.capability),["manage"]);denied(await request("course-manager","exportLearningCsv",scope(),{learner:true}));good(await request("admin-bootstrap","lifecycle",{...scope(),action:"enable"}));const r=await fetch(`${origin}/dashboard/${a.workspaceId}/learning/${a.programId}/manage`,{headers:{cookie:cookies["course-manager"]},redirect:"manual"});const html=await r.text();assert.ok(!html.includes("Vista nominativa riservata")&&!html.includes("Iscritti nel tuo perimetro"));});
    await check("ADMIN-38", "Admin reads bind the original actor; missing identity is rejected", async()=>{
      for (const [operation,input] of [["catalog",{workspaceId:a.workspaceId}],["detail",scope()]]) {
        const own=good(await request("course-manager",operation,input));assert.equal(own.userId,accounts["course-manager"].id);
        const stale=await request("course-manager",operation,input,{expectedUserId:accounts["admin-bootstrap"].id});
        assert.equal(stale.status,403);denied(stale,["forbidden"]);assert.ok(stale.result.message.includes("account connesso è cambiato"));
        assert.equal((await request("course-manager",operation,input,{expectedUserId:undefined})).status,422);
      }
    });
    await check("ADMIN-39", "Two valid managers cannot execute an old tab mutation under the new actor", async()=>{
      const before=(await db.query("SELECT title,visibility_policy,retention_days,(SELECT count(*)::int FROM learning_audit_events WHERE program_id=$1) AS audits FROM learning_programs WHERE id=$1",[a.programId])).rows[0];
      const stale=await request("course-manager","settings",{...scope(),...settings,title:"Synthetic stale manager intent"},{expectedUserId:accounts["admin-bootstrap"].id});
      assert.equal(stale.status,403);denied(stale,["forbidden"]);
      assert.deepEqual((await db.query("SELECT title,visibility_policy,retention_days,(SELECT count(*)::int FROM learning_audit_events WHERE program_id=$1) AS audits FROM learning_programs WHERE id=$1",[a.programId])).rows[0],before);
      good(await request("course-manager","settings",{...scope(),...settings}));
      const audit=(await db.query("SELECT actor_id FROM learning_audit_events WHERE program_id=$1 AND event_type='program_settings_changed' ORDER BY created_at DESC LIMIT 1",[a.programId])).rows[0];
      assert.equal(audit.actor_id,accounts["course-manager"].id);
    });
    await check("ADMIN-40", "New-course inspection/import rejects a stale actor even when both can bootstrap", async()=>{
      const before=(await db.query("SELECT count(*)::int n FROM learning_programs WHERE workspace_id=$1",[a.workspaceId])).rows[0].n;
      for (const [operation,input] of [["inspectPack",{workspaceId:a.workspaceId,pack}],["importPack",{workspaceId:a.workspaceId,pack,...settings}]]) {
        const r=await request("admin-second",operation,input,{expectedUserId:accounts["admin-bootstrap"].id});assert.equal(r.status,403);denied(r,["forbidden"]);
      }
      assert.equal((await db.query("SELECT count(*)::int n FROM learning_programs WHERE workspace_id=$1",[a.workspaceId])).rows[0].n,before);
      good(await request("admin-second","inspectPack",{workspaceId:a.workspaceId,pack}));
    });
    await check("ADMIN-14", "Scoped manager sees only cohort operations and cannot change global settings or permissions", async()=>{await grant("cohort-manager","manage",cohort);const d=await detail("cohort-manager");assert.equal(d.program.canManageAll,false);assert.deepEqual(d.program.managedCohorts,[cohort]);assert.ok(d.sessions.every(s=>s.cohortId===cohort));assert.equal(d.retention,null);assert.ok(d.grants.every(g=>g.cohortId===cohort));assert.ok(d.audit.every(e=>e.cohortId===cohort));for(const [op,input] of [["settings",{...settings}],["lifecycle",{action:"enable"}],["grant",{userId:accounts.viewer.id,capability:"review",cohortId:null}],["grant",{userId:accounts.viewer.id,capability:"manage",cohortId:cohort}],["grant",{userId:accounts.viewer.id,capability:"review",cohortId:otherCohort}]])denied(await request("cohort-manager",op,{...scope(),...input}));good(await request("cohort-manager","grant",{...scope(),userId:accounts.viewer.id,capability:"review",cohortId:cohort}));denied(await request("viewer","exportLearningCsv",scope(),{learner:true}));});
    await check("ADMIN-15", "Batch enrollment rejects a foreign member without partially enrolling valid members", async()=>{denied(await request("admin-bootstrap","enroll",{...scope(),userIds:[accounts["student-one"].id,accounts["student-foreign"].id],cohortId:cohort}));assert.equal((await detail()).enrollments.length,0);const alias=await request("admin-bootstrap","enroll",{...scope(),userIds:[accounts["student-one"].id,accounts["student-one"].id.toUpperCase()],cohortId:cohort});assert.equal(alias.status,422);assert.equal((await detail()).enrollments.length,0);});
    await check("ADMIN-16", "Valid enrollment batch is atomic and idempotent", async()=>{const input={...scope(),userIds:[accounts["student-one"].id,accounts["student-two"].id],cohortId:cohort};assert.equal(good(await request("admin-bootstrap","enroll",input)).changed,2);assert.equal(good(await request("admin-bootstrap","enroll",input)).changed,0);assert.equal((await detail()).enrollments.length,2);});
    await check("ADMIN-17", "Enrollment may move before work but scoped manager cannot cross cohorts", async()=>{const e=(await detail()).enrollments.find(e=>e.userId===accounts["student-two"].id);denied(await request("cohort-manager","enrollment",{...scope(),enrollmentId:e.id,status:"active",cohortId:otherCohort}));good(await request("admin-bootstrap","enrollment",{...scope(),enrollmentId:e.id,status:"active",cohortId:otherCohort}));assert.ok((await detail("cohort-manager")).enrollments.every(e=>e.cohortId===cohort));});
    await check("ADMIN-18", "Session changes verify object and cohort; M2/M3 cannot open", async()=>{const d=await detail();const s=d.sessions.find(s=>s.moduleId==="m1"&&s.cohortId===cohort);good(await request("cohort-manager","session",{...scope(),sessionId:s.id,status:"open"}));const other=d.sessions.find(s=>s.moduleId==="m1"&&s.cohortId===otherCohort);denied(await request("cohort-manager","session",{...scope(),sessionId:other.id,status:"open"}));good(await request("admin-bootstrap","session",{...scope(),sessionId:other.id,status:"open"}));for(const future of d.sessions.filter(s=>s.moduleId!=="m1"))denied(await request("admin-bootstrap","session",{...scope(),sessionId:future.id,status:"open"}));});
    let attempt;
    await check("ADMIN-19", "Enable permits learner work, which immediately prevents enrollment move", async()=>{good(await request("admin-bootstrap","lifecycle",{...scope(),action:"enable"}));attempt=good(await request("student-one","startLearningAttempt",{...scope(),activityId:"m1-check",expectedVersion:pack.content_version},{learner:true}));const e=(await detail()).enrollments.find(e=>e.userId===accounts["student-one"].id);assert.equal(e.hasWork,true);denied(await request("admin-bootstrap","enrollment",{...scope(),enrollmentId:e.id,status:"active",cohortId:otherCohort}));assert.equal((await detail()).enrollments.find(x=>x.id===e.id).cohortId,cohort);});
    await check("ADMIN-30", "An idea draft alone prevents cohort move without creating an attempt", async()=>{const fields={title:"Synthetic idea",problem:"Synthetic repeated manual task",frequency:"Weekly",inputs:"Fictional cards",desiredOutput:"Draft for review",contact:"Synthetic owner",constraints:"No operational data"};good(await request("student-two","saveLearningIdea",{...scope(),expectedUserId:accounts["student-two"].id,draftId:null,expectedRevision:null,fields},{learner:true}));const e=(await detail()).enrollments.find(e=>e.userId===accounts["student-two"].id);assert.equal(e.hasWork,true);assert.equal((await db.query("SELECT count(*)::int n FROM learning_attempts WHERE enrollment_id=$1",[e.id])).rows[0].n,0);denied(await request("admin-bootstrap","enrollment",{...scope(),enrollmentId:e.id,status:"active",cohortId:cohort}));});
    const ideaFields={title:"Synthetic owner-only idea",problem:"Synthetic repeated manual task",frequency:"Weekly",inputs:"Fictional cards",desiredOutput:"Draft for review",contact:"Synthetic owner",constraints:"No operational data"};
    let ownerOneDraft;
    await check("ADMIN-35", "A new idea from an old tab cannot be created under the newly signed-in account", async()=>{
      const r=await request("student-one","saveLearningIdea",{...scope(),expectedUserId:accounts["student-two"].id,draftId:null,expectedRevision:null,fields:ideaFields},{learner:true});
      assert.equal(r.status,403);denied(r,["forbidden"]);
      assert.equal((await db.query("SELECT count(*)::int n FROM learning_idea_drafts WHERE program_id=$1 AND user_id=$2",[a.programId,accounts["student-one"].id])).rows[0].n,0);
      ownerOneDraft=good(await request("student-one","saveLearningIdea",{...scope(),expectedUserId:accounts["student-one"].id,draftId:null,expectedRevision:null,fields:ideaFields},{learner:true}));
      assert.equal(ownerOneDraft.revision,1);
    });
    await check("ADMIN-36", "Existing idea identity and equal revision cannot cross accounts after session switch", async()=>{
      assert.ok(ownerOneDraft);
      const before=(await db.query("SELECT id,user_id,fields,revision,status FROM learning_idea_drafts WHERE program_id=$1 ORDER BY id",[a.programId])).rows;
      const ownTwo=before.find(row=>row.user_id===accounts["student-two"].id);assert.equal(ownTwo.revision,ownerOneDraft.revision);
      for(const draftId of [ownerOneDraft.id,ownTwo.id]){
        const r=await request("student-two","saveLearningIdea",{...scope(),expectedUserId:accounts["student-one"].id,draftId,expectedRevision:1,fields:{...ideaFields,title:"Synthetic stale owner text"}},{learner:true});
        assert.equal(r.status,403);denied(r,["forbidden"]);
      }
      denied(await request("student-two","saveLearningIdea",{...scope(),expectedUserId:accounts["student-two"].id,draftId:ownerOneDraft.id,expectedRevision:1,fields:ideaFields},{learner:true}),["conflict"]);
      const submit=await request("student-two","submitLearningIdea",{...scope(),expectedUserId:accounts["student-one"].id,draftId:ownTwo.id,expectedRevision:1,idempotencyKey:randomUUID()},{learner:true});
      assert.equal(submit.status,403);denied(submit,["forbidden"]);
      assert.deepEqual((await db.query("SELECT id,user_id,fields,revision,status FROM learning_idea_drafts WHERE program_id=$1 ORDER BY id",[a.programId])).rows,before);
    });
    await check("ADMIN-37", "Returning to the original account saves the same idea with its own object and revision", async()=>{
      assert.ok(ownerOneDraft);
      const saved=good(await request("student-one","saveLearningIdea",{...scope(),expectedUserId:accounts["student-one"].id,draftId:ownerOneDraft.id,expectedRevision:ownerOneDraft.revision,fields:{...ideaFields,title:"Synthetic resumed owner-only idea"}},{learner:true}));
      assert.equal(saved.id,ownerOneDraft.id);assert.equal(saved.revision,2);
      assert.equal((await db.query("SELECT user_id FROM learning_idea_drafts WHERE id=$1",[saved.id])).rows[0].user_id,accounts["student-one"].id);
    });
    await check("ADMIN-20", "Enrollment revoke stops learner writes and reactivation preserves draft", async()=>{assert.ok(attempt);const e=(await detail()).enrollments.find(e=>e.userId===accounts["student-one"].id);good(await request("admin-bootstrap","enrollment",{...scope(),enrollmentId:e.id,status:"revoked",cohortId:cohort}));denied(await request("student-one","saveLearningDraft",{...scope(),attemptId:attempt.id,expectedRevision:attempt.revision,responses:{answers:{},fields:{}}},{learner:true}));good(await request("admin-bootstrap","enrollment",{...scope(),enrollmentId:e.id,status:"active",cohortId:cohort}));assert.equal(good(await request("student-one","startLearningAttempt",{...scope(),activityId:"m1-check",expectedVersion:pack.content_version},{learner:true})).id,attempt.id);});
    await check("ADMIN-21", "Revoked workspace membership immediately removes manager reads and writes", async()=>{await memberDelete("course-manager");try{denied(await request("course-manager","detail",scope()));denied(await request("course-manager","settings",{...scope(),...settings}));}finally{await memberRestore("course-manager");}});
    await check("ADMIN-22", "A manager with revoked membership cannot keep final active manager revocation valid", async()=>{await memberDelete("course-manager");try{const g=(await detail()).grants.find(g=>g.userId===accounts["admin-bootstrap"].id&&g.capability==="manage"&&!g.revokedAt);denied(await request("admin-bootstrap","revokeGrant",{...scope(),grantId:g.id}));}finally{await memberRestore("course-manager");}});
    await check("ADMIN-23", "Concurrent self-revocation leaves exactly one active unscoped manager", async()=>{const d=await detail();const names=["admin-bootstrap","course-manager"];const gs=names.map(n=>d.grants.find(g=>g.userId===accounts[n].id&&g.capability==="manage"&&g.cohortId===null&&!g.revokedAt));const results=await Promise.all(names.map((n,i)=>request(n,"revokeGrant",{...scope(),grantId:gs[i].id})));assert.equal(results.filter(r=>r.result?.ok).length,1);assert.equal(results.filter(r=>!r.result?.ok).length,1);const active=(await db.query("SELECT user_id FROM learning_grants WHERE program_id=$1 AND capability='manage' AND cohort_id IS NULL AND revoked_at IS NULL",[a.programId])).rows;assert.equal(active.length,1);const survivor=names.find(n=>accounts[n].id===active[0].user_id),removed=names.find(n=>n!==survivor);good(await request(survivor,"grant",{...scope(),userId:accounts[removed].id,capability:"manage",cohortId:null}));});
    await check("ADMIN-24", "Explicit review grant revocation removes access without adding other capabilities", async()=>{const before=await fetch(`${origin}/dashboard/${a.workspaceId}/learning/${a.programId}/manage`,{headers:{cookie:cookies.viewer}});const html=await before.text();assert.ok(html.includes(accounts["student-one"].email));assert.ok(!html.includes(accounts["student-two"].email));const g=(await detail()).grants.find(g=>g.userId===accounts.viewer.id&&g.capability==="review"&&!g.revokedAt);good(await request("cohort-manager","revokeGrant",{...scope(),grantId:g.id}));assert.equal((await db.query("SELECT count(*)::int n FROM learning_grants WHERE program_id=$1 AND user_id=$2 AND revoked_at IS NULL",[a.programId,accounts.viewer.id])).rows[0].n,0);});
    await check("ADMIN-31", "Grant targets must be current members and revoke never leaks another cohort", async()=>{denied(await request("admin-bootstrap","grant",{...scope(),userId:accounts["student-foreign"].id,capability:"review",cohortId:cohort}));await grant("viewer","review",otherCohort);const g=(await detail()).grants.find(g=>g.userId===accounts.viewer.id&&g.cohortId===otherCohort&&!g.revokedAt);denied(await request("cohort-manager","revokeGrant",{...scope(),grantId:g.id}));good(await request("admin-bootstrap","revokeGrant",{...scope(),grantId:g.id}));});
    await check("ADMIN-32", "Scoped manager cannot revoke global capability grant", async()=>{await grant("viewer","aggregate",null);const g=(await detail()).grants.find(g=>g.userId===accounts.viewer.id&&g.capability==="aggregate"&&g.cohortId===null&&!g.revokedAt);denied(await request("cohort-manager","revokeGrant",{...scope(),grantId:g.id}));good(await request("admin-bootstrap","revokeGrant",{...scope(),grantId:g.id}));});
    await check("ADMIN-34", "Export-only permission returns scoped CSV without implicit individual-review access", async()=>{await grant("viewer","export",cohort);const page=await fetch(`${origin}/dashboard/${a.workspaceId}/learning/${a.programId}`,{headers:{cookie:cookies.viewer}});assert.equal(page.status,200);await page.text(); // Visible control is verified in the hydrated browser; the session boundary initially hides children.
    const exported=good(await request("viewer","exportLearningCsv",scope(),{learner:true}));assert.ok(exported.csv.includes(accounts["student-one"].email));assert.ok(!exported.csv.includes(accounts["student-two"].email));const review=await fetch(`${origin}/dashboard/${a.workspaceId}/learning/${a.programId}/manage`,{headers:{cookie:cookies.viewer}});assert.ok(!(await review.text()).includes("Vista nominativa riservata"));const g=(await detail()).grants.find(g=>g.userId===accounts.viewer.id&&g.capability==="export"&&!g.revokedAt);good(await request("admin-bootstrap","revokeGrant",{...scope(),grantId:g.id}));denied(await request("viewer","exportLearningCsv",scope(),{learner:true}));});
    await check("ADMIN-25", "Program disable/enable/close/reopen preserves draft and controls writes", async()=>{for(const action of ["disable","enable","close","reopen"]){good(await request("admin-bootstrap","lifecycle",{...scope(),action}));const d=await detail();if(action==="disable"){assert.equal(d.program.featureEnabled,false);denied(await request("student-one","startLearningAttempt",{...scope(),activityId:"m1-check",expectedVersion:pack.content_version},{learner:true}));}if(action==="close"){assert.equal(d.program.status,"closed");assert.ok(d.program.closedAt);denied(await request("student-one","startLearningAttempt",{...scope(),activityId:"m1-check",expectedVersion:pack.content_version},{learner:true}));}if(action==="reopen"){assert.equal(d.program.status,"published");assert.equal(d.program.closedAt,null);assert.equal(good(await request("student-one","startLearningAttempt",{...scope(),activityId:"m1-check",expectedVersion:pack.content_version},{learner:true})).id,attempt.id);}}});
    await check("ADMIN-26", "Session close denies work, open restores same attempt, scheduled is server-timed", async()=>{const s=(await detail()).sessions.find(s=>s.moduleId==="m1"&&s.cohortId===cohort);for(const status of ["closed","scheduled"]){good(await request("admin-bootstrap","session",{...scope(),sessionId:s.id,status}));denied(await request("student-one","startLearningAttempt",{...scope(),activityId:"m1-check",expectedVersion:pack.content_version},{learner:true}));}good(await request("admin-bootstrap","session",{...scope(),sessionId:s.id,status:"open"}));assert.equal(good(await request("student-one","startLearningAttempt",{...scope(),activityId:"m1-check",expectedVersion:pack.content_version},{learner:true})).id,attempt.id);});
    await check("ADMIN-27", "Settings update is audited and DTO excludes answers, grading and private content", async()=>{good(await request("admin-bootstrap","settings",{...scope(),...settings,title:"Synthetic updated course"}));settings.title="Synthetic updated course";const d=await detail();assert.equal(d.program.title,settings.title);assert.ok(d.audit.some(e=>e.eventType==="program_settings_changed"));assert.ok(!JSON.stringify(d).includes("PRIVATE_")&&!JSON.stringify(d).includes("correct_option_ids"));for(const event of d.audit)assert.deepEqual(Object.keys(event).sort(),["id","eventType","actorName","resourceId","createdAt","cohortId"].sort());});
    await check("ADMIN-28", "Purge requires exact confirmation, unscoped manager and elapsed retention", async()=>{const input={...scope(),confirmProgramId:a.programId,confirmTitle:settings.title};denied(await request("admin-bootstrap","purge",{...input,confirmTitle:"wrong"}),["invalid"]);denied(await request("cohort-manager","purge",input));denied(await request("admin-bootstrap","purge",input));good(await request("admin-bootstrap","lifecycle",{...scope(),action:"close"}));denied(await request("admin-bootstrap","purge",input));assert.equal((await db.query("SELECT count(*)::int n FROM learning_attempts WHERE program_id=$1",[a.programId])).rows[0].n,1);});
    await check("ADMIN-29", "Eligible purge deletes only own responses and retains enrollments, audit, other program", async()=>{const otherBefore=(await db.query("SELECT to_jsonb(p) data FROM learning_programs p WHERE id=$1",[b.programId])).rows[0].data;await db.query("UPDATE learning_programs SET closed_at=now()-interval '91 days' WHERE id=$1 AND workspace_id=$2",[a.programId,a.workspaceId]);const input={...scope(),confirmProgramId:a.programId,confirmTitle:settings.title};assert.equal((await detail()).retention.eligible,true);const beforePurge=(await db.query("SELECT (SELECT count(*)::int FROM learning_attempts WHERE program_id=$1)+(SELECT count(*)::int FROM learning_idea_drafts WHERE program_id=$1) n",[a.programId])).rows[0].n;assert.ok(beforePurge>0);assert.equal(good(await request("admin-bootstrap","purge",input)).changed,beforePurge);assert.equal(good(await request("admin-bootstrap","purge",input)).changed,0);assert.equal((await db.query("SELECT count(*)::int n FROM learning_attempts WHERE program_id=$1",[a.programId])).rows[0].n,0);const d=await detail();assert.equal(d.retention.attempts,0);assert.equal(d.retention.ideaDrafts,0);assert.equal(d.enrollments.length,2);assert.ok(d.audit.some(e=>e.eventType==="retention_purged"));assert.deepEqual((await db.query("SELECT to_jsonb(p) data FROM learning_programs p WHERE id=$1",[b.programId])).rows[0].data,otherBefore);});
  }
  if(a.programId) await check("ADMIN-33", "Admin HTML, RSC and browser scripts exclude private grading content", async()=>{
    const markers=["PRIVATE_FEEDBACK_MARKER","PRIVATE_REFERENCE_MARKER","PRIVATE_FACT_MARKER","PRIVATE_BOUNDARY_MARKER","PRIVATE_SOURCE_MARKER","PRIVATE_PROMPT_MARKER","correct_option_ids"];
    const assets=new Set();let htmlBytes=0,rscBytes=0;
    for(const suffix of ["/admin",`/${a.programId}/admin`]){
      const url=`${origin}/dashboard/${a.workspaceId}/learning${suffix}`;
      for(const headers of [{cookie:cookies["admin-bootstrap"]},{cookie:cookies["admin-bootstrap"],RSC:"1"}]){
        const response=await fetch(url,{headers,redirect:"manual"});assert.equal(response.status,200);const text=await response.text();
        for(const marker of markers)assert.ok(!text.includes(marker),`Private marker in admin ${headers.RSC?"RSC":"HTML"}`);
        if(headers.RSC)rscBytes+=Buffer.byteLength(text);else{htmlBytes+=Buffer.byteLength(text);for(const match of text.matchAll(/<script[^>]+src="([^"]+)"/g))assets.add(match[1].replaceAll("&amp;","&"));}
      }
    }
    assert.ok(assets.size>0);const scripts=[];
    for(const asset of assets){const url=new URL(asset,origin);assert.equal(url.origin,origin);const response=await fetch(url);assert.equal(response.status,200);const text=await response.text();for(const marker of markers)assert.ok(!text.includes(marker),"Private marker in admin client script");scripts.push({path:url.pathname,bytes:Buffer.byteLength(text)});}
    clientScan={pages:2,rscRequests:2,htmlBytes,rscBytes,scripts,checkedMarkers:markers};
  });
  const sourceHashes={};for(const path of ["src/lib/learning/admin.ts","src/lib/learning/admin-contract.ts","src/lib/learning/ideas.ts","src/lib/learning/idea-contract.ts","src/components/learning/idea-form.tsx","src/lib/learning/server.ts","src/app/api/learning/admin/route.ts","src/components/learning/admin-program.tsx","src/components/learning/program-overview.tsx"])sourceHashes[path]=createHash("sha256").update(await readFile(path)).digest("hex");
  let codeCommit=null,workingTreeDirty=null;
  try {
    codeCommit=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();
    workingTreeDirty=!!execFileSync("git",["status","--porcelain"],{encoding:"utf8",stdio:["ignore","pipe","ignore"]}).trim();
  } catch { /* A clean runtime copy has no .git; source hashes remain the provenance. */ }
  const report={runId,runtime,clientScan,sourceHashes,codeCommit,workingTreeDirty,createdAt:new Date().toISOString(),source:"runtime files identified by sourceHashes; no production or real accounts",workspaces,totals:{pass:evidence.filter(e=>e.status==="PASS").length,fail:evidence.filter(e=>e.status==="FAIL").length},checks:evidence};
  const path=resolve(output,`admin-acceptance-${runtime}-${runId}.json`);await writeFile(path,JSON.stringify(report,null,2),{mode:0o600});await writeFile(resolve(output,`admin-acceptance-${runtime}-latest.json`),JSON.stringify(report,null,2),{mode:0o600});await db.end();
  console.log(JSON.stringify({evidence:path,...report.totals}));if(report.totals.fail)process.exitCode=1;
}

if (mode === "--setup") await setup();
else if (mode === "--serve-login") await serveLogin();
else await runAcceptance();
