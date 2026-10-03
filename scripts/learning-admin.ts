#!/usr/bin/env node
/** Explicit operator CLI. Dry run is the default; never loads .env or runs DDL. */
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import { parseTrainingPack, localDateTimeToUtc } from "../src/lib/learning/pack.ts";
import { z } from "zod";

const args=process.argv.slice(2), command=args.shift();
const values=new Map<string,string>();
for(let i=0;i<args.length;i++) { const key=args[i]; if(!key.startsWith("--") || values.has(key)) throw new Error("Invalid or duplicate option"); values.set(key,args[i+1] && !args[i+1].startsWith("--")?args[++i]:"true"); }
const flag=(key:string)=>values.get(`--${key}`)==="true";
const value=(key:string)=>{const v=values.get(`--${key}`);if(!v || v==="true")throw new Error(`Missing --${key}`);return v;};
const uuid=(key:string)=>z.uuid().parse(value(key));
const allowed=["import","enable","disable","close","session","enroll","grant","revoke-grant"];
if(!command || !allowed.includes(command)) throw new Error(`Command must be ${allowed.join(", ")}`);
const workspaceId=uuid("workspace"),actorId=uuid("actor"),apply=flag("apply");
const programId=command==="import"?randomUUID():uuid("program");
const prepared=command==="import"?(()=>{
  const raw=readFileSync(value("file"),"utf8");
  if(Buffer.byteLength(raw)>5_000_000)throw new Error("Private pack exceeds 5 MB");
  const pack=parseTrainingPack(JSON.parse(raw));
  const visibility=readFileSync(value("visibility-policy-file"),"utf8").trim();
  if(visibility.length<20 || visibility.length>10_000)throw new Error("Approved visibility policy required (20–10000 characters)");
  const retention=z.coerce.number().int().min(1).max(3650).parse(value("retention-days"));
  const title=z.string().trim().min(1).max(250).parse(value("title"));
  const hash=createHash("sha256").update(JSON.stringify(pack)).digest("hex");
  const sessions=pack.modules.flatMap(m=>m.cohorts.map(c=>({id:randomUUID(),module_id:m.id,cohort_id:c.id,starts_at:localDateTimeToUtc(c.start_local,c.timezone).toISOString(),ends_at:localDateTimeToUtc(c.end_local,c.timezone).toISOString(),timezone:c.timezone})));
  return {pack,visibility,retention,title,hash,sessions};
})():null;
const plan={command,workspaceId,actorId,programId:command==="import"?"generated-on-apply":programId,
  ...(prepared?{version:prepared.pack.content_version,hash:prepared.hash,modules:prepared.pack.modules.length,activities:prepared.pack.activities.length,sessionCount:prepared.sessions.length,featureEnabled:false}:{}),
  ...(command==="enroll"?{userId:uuid("user"),cohort:value("cohort")}:{}),
  ...(command==="grant"?{userId:uuid("user"),capability:z.enum(["manage","review","aggregate","export"]).parse(value("capability")),cohort:value("cohort")}:{}),
  ...(command==="session"?{cohort:value("cohort"),status:z.enum(["scheduled","open","closed"]).parse(value("status"))}:{}),
  ...(command==="revoke-grant"?{grantId:uuid("grant")}:{}),
  apply};
if(!apply) { console.log(JSON.stringify({status:"DRY_RUN_NO_DATABASE_ACCESS",...plan},null,2)); process.exit(0); }
if(!flag("confirm-authorized"))throw new Error("Apply requires --confirm-authorized from the responsible operator");
const databaseUrl=process.env.LEARNING_ADMIN_DATABASE_URL;
if(!databaseUrl)throw new Error("Set LEARNING_ADMIN_DATABASE_URL explicitly; DATABASE_URL/.env are intentionally not used");
const target=new URL(databaseUrl);const fingerprint=`${target.hostname}${target.port?`:${target.port}`:""}${target.pathname}`;
if(value("confirm-database")!==fingerprint)throw new Error("--confirm-database must exactly match hostname[:port]/database");
const environment=z.enum(["local","preview","production"]).parse(value("environment"));
if(environment==="production" && !flag("production-approved"))throw new Error("Production requires explicit responsible approval: --production-approved");
const sql=neon(databaseUrl);
async function member(userId:string) {
  const rows=await sql`SELECT 1 FROM workspaces w WHERE w.id=${workspaceId}::uuid AND (
    EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=w.organization_id AND m.user_id=${userId}::uuid) OR
    EXISTS(SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id=w.id AND wm.user_id=${userId}::uuid))`;
  if(!rows.length)throw new Error("Actor/target has no current workspace membership");
}
await member(actorId);
if(command==="import") {
  if(!prepared || !flag("bootstrap-manager"))throw new Error("Import is an operator bootstrap requiring --bootstrap-manager; actor receives explicit manage only");
  const p=prepared;
  const existing=await sql`SELECT id,pack_hash FROM learning_programs WHERE workspace_id=${workspaceId}::uuid AND family_key=${p.pack.client_pack} AND content_version=${p.pack.content_version}`;
  if(existing[0]) {
    if(existing[0].pack_hash!==p.hash)throw new Error("Same version has a different hash; publish a new content version");
    console.log(JSON.stringify({status:"ALREADY_IMPORTED_IMMUTABLE",programId:existing[0].id,hash:p.hash}));process.exit(0);
  }
  await sql`WITH program AS (
    INSERT INTO learning_programs(id,workspace_id,family_key,title,content_version,pack_hash,private_pack,visibility_policy,retention_days,published_by)
    VALUES (${programId}::uuid,${workspaceId}::uuid,${p.pack.client_pack},${p.title},${p.pack.content_version},${p.hash},${JSON.stringify(p.pack)}::jsonb,${p.visibility},${p.retention},${actorId}::uuid) RETURNING id
  ), sessions AS (
    INSERT INTO learning_sessions(id,workspace_id,program_id,module_id,cohort_id,starts_at,ends_at,timezone)
    SELECT s.id,${workspaceId}::uuid,program.id,s.module_id,s.cohort_id,s.starts_at,s.ends_at,s.timezone FROM program,
      jsonb_to_recordset(${JSON.stringify(p.sessions)}::jsonb) AS s(id uuid,module_id text,cohort_id text,starts_at timestamptz,ends_at timestamptz,timezone text)
  ), grant_added AS (
    INSERT INTO learning_grants(workspace_id,program_id,user_id,capability,granted_by)
    SELECT ${workspaceId}::uuid,id,${actorId}::uuid,'manage',${actorId}::uuid FROM program
  ) INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type)
    SELECT ${workspaceId}::uuid,id,${actorId}::uuid,id,'program_imported' FROM program`;
  console.log(JSON.stringify({status:"IMPORTED_DISABLED",programId,hash:p.hash,sessionCount:p.sessions.length}));process.exit(0);
}
const programs=await sql`SELECT id FROM learning_programs WHERE workspace_id=${workspaceId}::uuid AND id=${programId}::uuid`;
if(!programs.length)throw new Error("Program unavailable in workspace");
const grants=await sql`SELECT cohort_id FROM learning_grants WHERE workspace_id=${workspaceId}::uuid AND program_id=${programId}::uuid AND user_id=${actorId}::uuid AND capability='manage' AND revoked_at IS NULL`;
const cohort=values.get("--cohort");
if(!grants.some(g=>g.cohort_id===null || (cohort && cohort!=="all" && cohort===g.cohort_id))) throw new Error("Explicit manage grant required in the requested scope");
if(command==="enable" || command==="disable" || command==="close") {
  // Program lifecycle affects all cohorts and therefore needs an unscoped manager.
  if(!grants.some(g=>g.cohort_id===null))throw new Error("Program lifecycle requires program-wide manage grant");
  await sql`WITH changed AS (UPDATE learning_programs SET feature_enabled=CASE WHEN ${command==="enable"} THEN true WHEN ${command==="disable"} THEN false ELSE feature_enabled END,
    status=CASE WHEN ${command==="enable"} THEN 'published' WHEN ${command==="close"} THEN 'closed' ELSE status END,
    closed_at=CASE WHEN ${command==="enable"} THEN NULL WHEN ${command==="close"} THEN COALESCE(closed_at,now()) ELSE closed_at END
    WHERE workspace_id=${workspaceId}::uuid AND id=${programId}::uuid RETURNING id)
    INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type)
    SELECT ${workspaceId}::uuid,id,${actorId}::uuid,id,${command==="enable"?"program_enabled":command==="disable"?"program_disabled":"program_closed"} FROM changed`;
} else if(command==="session") {
  const rows=await sql`WITH changed AS (UPDATE learning_sessions SET status=${value("status")}
    WHERE workspace_id=${workspaceId}::uuid AND program_id=${programId}::uuid AND cohort_id=${value("cohort")} RETURNING id)
    INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type)
    SELECT ${workspaceId}::uuid,${programId}::uuid,${actorId}::uuid,id,'session_status_changed' FROM changed RETURNING id`;
  if(!rows.length)throw new Error("Unknown session");
} else if(command==="enroll") {
  const userId=uuid("user"); await member(userId);
  const rows=await sql`WITH inserted AS (INSERT INTO learning_enrollments(workspace_id,program_id,user_id,module_id,cohort_id)
    SELECT ${workspaceId}::uuid,${programId}::uuid,${userId}::uuid,'m1',cohort_id FROM learning_sessions WHERE workspace_id=${workspaceId}::uuid AND program_id=${programId}::uuid AND module_id='m1' AND cohort_id=${value("cohort")}
    ON CONFLICT (workspace_id,program_id,user_id,module_id) DO NOTHING RETURNING id)
    INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type)
    SELECT ${workspaceId}::uuid,${programId}::uuid,${actorId}::uuid,id,'learner_enrolled' FROM inserted RETURNING id`;
  if(!rows.length) {
    const existing=await sql`SELECT cohort_id FROM learning_enrollments WHERE workspace_id=${workspaceId}::uuid AND program_id=${programId}::uuid AND user_id=${userId}::uuid AND module_id='m1' AND status='active'`;
    if(existing[0]?.cohort_id!==value("cohort"))throw new Error("Enrollment already exists in another cohort, is revoked, or cohort is invalid; no reassignment was performed");
  }
} else if(command==="grant") {
  const userId=uuid("user"); await member(userId);const capability=value("capability"),scope=cohort==="all"?null:cohort!;
  if(scope) {const sessions=await sql`SELECT 1 FROM learning_sessions WHERE workspace_id=${workspaceId}::uuid AND program_id=${programId}::uuid AND module_id='m1' AND cohort_id=${scope}`;if(!sessions.length)throw new Error("Unknown M1 cohort");}
  await sql`WITH granted AS (INSERT INTO learning_grants(workspace_id,program_id,user_id,capability,cohort_id,granted_by)
    VALUES (${workspaceId}::uuid,${programId}::uuid,${userId}::uuid,${capability},${scope},${actorId}::uuid) ON CONFLICT DO NOTHING RETURNING id)
    INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type)
    SELECT ${workspaceId}::uuid,${programId}::uuid,${actorId}::uuid,id,'grant_created' FROM granted`;
} else if(command==="revoke-grant") {
  if(!grants.some(g=>g.cohort_id===null))throw new Error("Revocation requires program-wide manage grant");
  await sql`WITH revoked AS (UPDATE learning_grants SET revoked_at=now() WHERE workspace_id=${workspaceId}::uuid AND program_id=${programId}::uuid AND id=${uuid("grant")}::uuid AND revoked_at IS NULL RETURNING id)
    INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type)
    SELECT ${workspaceId}::uuid,${programId}::uuid,${actorId}::uuid,id,'grant_revoked' FROM revoked`;
}
console.log(JSON.stringify({status:"APPLIED",command,workspaceId,programId}));
