import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createOperationalTestPack } from "./fixture-pack.mjs";
import { localDateTimeToUtc, trainingPackHash } from "../../src/lib/learning/pack.ts";

export const uxOrigin = "http://127.0.0.1:53100";
export const uxAuthOrigin = "http://127.0.0.1:59099";
export function uxOutput() {
  if (process.env.LEARNING_TEST_ISOLATED !== "true") throw new Error("Set LEARNING_TEST_ISOLATED=true for this synthetic-only harness");
  const output = process.env.LEARNING_TEST_OUTPUT;
  if (!output || !["/private/tmp/", "/tmp/"].some(prefix => output.startsWith(prefix))) throw new Error("Use a temporary output directory outside Git");
  return resolve(output);
}
export async function uxDatabase() {
  uxOutput();
  const { Client } = createRequire(resolve("package.json"))("pg");
  const db = new Client({host:"127.0.0.1",port:55439,user:"learning_test",database:"unbundle_learning_test",connectionTimeoutMillis:5000,statement_timeout:15000});
  await db.connect(); return db;
}
export async function uxCookie(account) {
  const response=await fetch(`${uxAuthOrigin}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=local-only`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email:account.email,password:account.password,returnSecureToken:true}),signal:AbortSignal.timeout(15000)});
  const identity=await response.json(); assert.equal(response.status,200,"Synthetic emulator sign-in failed");
  const session=await fetch(`${uxOrigin}/api/auth/session`,{method:"POST",headers:{origin:uxOrigin,"content-type":"application/json"},body:JSON.stringify({idToken:identity.idToken}),signal:AbortSignal.timeout(30000)});
  assert.equal(session.status,200,"Application session exchange failed"); const cookie=session.headers.get("set-cookie"); assert.ok(cookie?.startsWith("__session="));return cookie;
}
export async function createUxFixture(db, label="HTTP") {
  uxOutput(); const id=randomUUID(),accounts={},workspaces={},survey={templateId:randomUUID(),assessmentId:randomUUID(),respondentId:randomUUID(),responseId:randomUUID()};
  for(const name of ["admin","admin-second","scoped","reviewer","aggregate","learner","learner-two","outsider"]) {
    const email=`ux-${name}-${id}@learning-test.invalid`,password=randomBytes(24).toString("base64url");
    const response=await fetch(`${uxAuthOrigin}/identitytoolkit.googleapis.com/v1/accounts:signUp?key=local-only`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({email,password,returnSecureToken:true}),signal:AbortSignal.timeout(15000)});
    const identity=await response.json();assert.equal(response.status,200,"Synthetic account creation failed");
    accounts[name]={id:randomUUID(),firebaseUid:identity.localId,email,password};
  }
  const pack=createOperationalTestPack();pack.content_version=`ux-${id}`;
  const settings={title:`Synthetic UX ${label}`,visibilityPolicy:"Only assigned reviewers may inspect individually submitted responses.",retentionDays:90};
  await db.query("BEGIN");
  try {
    for(const [name,account] of Object.entries(accounts)) await db.query("INSERT INTO users(id,firebase_uid,email,name,email_verified) VALUES($1,$2,$3,$4,now())",[account.id,account.firebaseUid,account.email,`Synthetic UX ${name}`]);
    for(const letter of ["a","b"]) {
      const organizationId=randomUUID(),workspaceId=randomUUID(),programId=randomUUID();
      await db.query("INSERT INTO organizations(id,name,slug) VALUES($1,$2,$3)",[organizationId,`Synthetic UX ${label}`,`ux-${organizationId}`]);
      await db.query("INSERT INTO workspaces(id,organization_id,name) VALUES($1,$2,$3)",[workspaceId,organizationId,`Synthetic UX ${label} ${letter}`]);
      const members=letter==="a"?Object.keys(accounts).filter(name=>name!=="outsider"):["outsider"];
      for(const name of members) await db.query("INSERT INTO workspace_memberships(workspace_id,user_id,role) VALUES($1,$2,$3)",[workspaceId,accounts[name].id,name.startsWith("admin")?"transformation_lead":"contributor"]);
      const publisher=letter==="a"?accounts.admin.id:accounts.outsider.id;
      await db.query("INSERT INTO learning_programs(id,workspace_id,family_key,title,content_version,pack_hash,private_pack,feature_enabled,visibility_policy,retention_days,published_by) VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10)",[programId,workspaceId,pack.client_pack,settings.title,pack.content_version,trainingPackHash(pack),pack,settings.visibilityPolicy,settings.retentionDays,publisher]);
      const sessions=[];
      for(const courseModule of pack.modules) for(const cohort of courseModule.cohorts) {
        const sessionId=randomUUID();sessions.push({id:sessionId,moduleId:courseModule.id,cohortId:cohort.id});
        await db.query("INSERT INTO learning_sessions(id,workspace_id,program_id,module_id,cohort_id,starts_at,ends_at,timezone,status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)",[sessionId,workspaceId,programId,courseModule.id,cohort.id,localDateTimeToUtc(cohort.start_local,cohort.timezone),localDateTimeToUtc(cohort.end_local,cohort.timezone),cohort.timezone,courseModule.id==="m1"?"open":"scheduled"]);
      }
      const enrollments={};
      for(const name of letter==="a"?["learner","learner-two"]:["outsider"]) {
        const enrollmentId=randomUUID(),cohortId=name==="learner-two"?"m1-cohort-2":"m1-cohort";enrollments[name]={id:enrollmentId,cohortId};
        await db.query("INSERT INTO learning_enrollments(id,workspace_id,program_id,user_id,module_id,cohort_id) VALUES($1,$2,$3,$4,'m1',$5)",[enrollmentId,workspaceId,programId,accounts[name].id,cohortId]);
      }
      for(const [name,capability,cohortId] of letter==="a"?[["admin","manage",null],["admin-second","manage",null],["scoped","manage","m1-cohort"],["reviewer","review","m1-cohort"],["reviewer","export","m1-cohort"],["aggregate","aggregate",null]]:[["outsider","manage",null]]) {
        await db.query("INSERT INTO learning_grants(workspace_id,program_id,user_id,capability,cohort_id,granted_by) VALUES($1,$2,$3,$4,$5,$6)",[workspaceId,programId,accounts[name].id,capability,cohortId,publisher]);
      }
      workspaces[letter]={organizationId,workspaceId,programId,sessions,enrollments};
    }
    const a=workspaces.a;
    await db.query("INSERT INTO ai_readiness_assessment_templates(id,name,version,pillars,sections,questions,scoring_schema) VALUES($1,'Synthetic preservation fixture',$2,'[]','[]','[]','{}')",[survey.templateId,id]);
    await db.query("INSERT INTO ai_readiness_assessments(id,organization_id,workspace_id,template_id,name,anonymous_mode) VALUES($1,$2,$3,$4,'Synthetic preservation fixture',true)",[survey.assessmentId,a.organizationId,a.workspaceId,survey.templateId]);
    await db.query("INSERT INTO ai_readiness_respondents(id,assessment_id,organization_id,workspace_id,invite_token_hash,pseudonymous_id) VALUES($1,$2,$3,$4,$5,$6)",[survey.respondentId,survey.assessmentId,a.organizationId,a.workspaceId,randomBytes(32).toString("hex"),randomUUID()]);
    await db.query("INSERT INTO ai_readiness_responses(id,assessment_id,respondent_id,pseudonymous_id,answers) SELECT $1,$2,id,pseudonymous_id,$3::jsonb FROM ai_readiness_respondents WHERE id=$4",[survey.responseId,survey.assessmentId,JSON.stringify([{questionId:"synthetic-preservation",value:"unchanged anonymous response"}]),survey.respondentId]);
    await db.query("COMMIT");
  } catch(error) { await db.query("ROLLBACK"); throw error; }
  return {id,accounts,workspaces,settings,pack,survey,createdAt:new Date().toISOString()};
}

async function setup() {
  const output=uxOutput();await mkdir(output,{recursive:true,mode:0o700});
  const manifest=resolve(output,"ux-browser-fixtures.private.json");
  try { await readFile(manifest); throw new Error("Browser fixture already exists; do not overwrite live browser work"); }
  catch(error) { if(error.code!=="ENOENT")throw error; }
  const db=await uxDatabase();let fixture;try {fixture=await createUxFixture(db,"Browser");} finally {await db.end();}
  await writeFile(manifest,JSON.stringify(fixture,null,2),{mode:0o600});
  const base=`${uxOrigin}/dashboard/${fixture.workspaces.a.workspaceId}/learning/${fixture.workspaces.a.programId}`;
  await writeFile(resolve(output,"ux-browser-urls.json"),JSON.stringify({program:base,activity:`${base}/activities/m1-check`,ideas:`${base}/ideas`,admin:`${base}/admin`,helper:"http://127.0.0.1:53102/as/learner?view=activity"},null,2),{mode:0o600});
  console.log("Created independent synthetic browser fixture. Private manifest and token-free URLs saved outside Git.");
}
async function serveLogin() {
  const fixture=JSON.parse(await readFile(resolve(uxOutput(),"ux-browser-fixtures.private.json"),"utf8"));
  createServer(async(request,response)=>{
    try {
      const url=new URL(request.url,"http://127.0.0.1:53102");const name=url.pathname.replace(/^\/as\//,"");
      if(request.method!=="GET" || request.headers.host!=="127.0.0.1:53102" || !Object.hasOwn(fixture.accounts,name)) {response.writeHead(404);response.end();return;}
      const workspace=fixture.workspaces[name==="outsider"?"b":"a"],base=`/dashboard/${workspace.workspaceId}/learning`;
      const views={activity:`${base}/${workspace.programId}/activities/m1-check`,case:`${base}/${workspace.programId}/activities/m1-case`,exit:`${base}/${workspace.programId}/activities/m1-exit-a`,ideas:`${base}/${workspace.programId}/ideas`,program:`${base}/${workspace.programId}`,admin:`${base}/${workspace.programId}/admin`,catalog:`${base}/admin`,review:`${base}/${workspace.programId}/manage`,live:`${base}/${workspace.programId}/live`};
      const view=url.searchParams.get("view")??(name.startsWith("admin")||name==="scoped"?"admin":name==="reviewer"?"review":name==="aggregate"?"live":"activity");
      if(!Object.hasOwn(views,view)) {response.writeHead(400);response.end("Unknown synthetic view");return;}
      // Authentication only: this handler never creates accounts, memberships or grants.
      const cookie=await uxCookie(fixture.accounts[name]);response.writeHead(302,{"set-cookie":cookie,location:uxOrigin+views[view],"cache-control":"no-store"});response.end();
    }catch {response.writeHead(502,{"cache-control":"no-store"});response.end("Synthetic session unavailable");}
  }).listen(53102,"127.0.0.1",()=>console.log("Synthetic authentication-only helper ready on 127.0.0.1:53102"));
}
if(import.meta.url===pathToFileURL(resolve(process.argv[1]??"")).href) {
  if(process.argv[2]==="--setup")await setup();else if(process.argv[2]==="--serve-login")await serveLogin();else throw new Error("Use --setup or --serve-login");
}
