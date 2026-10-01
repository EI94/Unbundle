import "server-only";
import { randomUUID } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { learningEnabled, LearningError } from "./server";
import { parseTrainingPack, trainingPackHash, localDateTimeToUtc } from "./pack";
import { learningRetentionEligibility } from "./retention";
import type { PrivateTrainingPack } from "./types";
import type { AdminCatalogDTO, AdminDetailDTO, AdminMutationDTO, AdminPackDTO, AdminProgramDTO, LearningAdminRequest, AdminResponseMap } from "./admin-contract";

type Program = Omit<AdminProgramDTO, "canManageAll" | "managedCohorts">;
type Context = { userId: string; workspaceId: string; program: Program; scopes: (string | null)[] };
const unavailable = () => new LearningError("forbidden", "Gestione non disponibile per questo account o ambito.");
const conflict = () => new LearningError("conflict", "Operazione non applicata: permessi, assegnazioni o stato del corso sono cambiati. Aggiorna e riprova.");
const programColumns = sql`p.id,p.title,p.content_version AS version,p.status,p.feature_enabled AS "featureEnabled",p.visibility_policy AS "visibilityPolicy",p.retention_days AS "retentionDays",p.published_at AS "publishedAt",p.closed_at AS "closedAt"`;
async function rows<T>(query: SQL): Promise<T[]> { return (await db.execute(query)).rows as T[]; }
function instant(value: string | Date): string { return new Date(value).toISOString(); }
function programDTO(program: Program, scopes: (string | null)[]): AdminProgramDTO {
  return { ...program, publishedAt: instant(program.publishedAt), closedAt: program.closedAt ? instant(program.closedAt) : null,
    canManageAll: scopes.includes(null), managedCohorts: scopes.filter((scope): scope is string => scope !== null) };
}
// COALESCE implements exactly the existing organization's membership priority.
function effectiveRole(workspaceId: string, user: SQL): SQL {
  return sql`(SELECT COALESCE((SELECT m.role::text FROM memberships m WHERE m.organization_id=w.organization_id AND m.user_id=${user}),
    (SELECT wm.role::text FROM workspace_memberships wm WHERE wm.workspace_id=w.id AND wm.user_id=${user})) FROM workspaces w WHERE w.id=${workspaceId}::uuid)`;
}
function member(workspaceId: string, user: SQL): SQL { return sql`${effectiveRole(workspaceId,user)} IS NOT NULL`; }
function bootstrap(workspaceId: string, userId: string): SQL { return sql`${effectiveRole(workspaceId,sql`${userId}::uuid`)} IN ('exec_sponsor','transformation_lead')`; }
function manager(ctx: Context, cohort: SQL | null = null, anyScope = false): SQL {
  return sql`${member(ctx.workspaceId,sql`${ctx.userId}::uuid`)} AND EXISTS(SELECT 1 FROM learning_grants admin_authority WHERE admin_authority.workspace_id=${ctx.workspaceId}::uuid
    AND admin_authority.program_id=${ctx.program.id}::uuid AND admin_authority.user_id=${ctx.userId}::uuid AND admin_authority.capability='manage' AND admin_authority.revoked_at IS NULL
    AND ${anyScope ? sql`true` : cohort ? sql`(admin_authority.cohort_id IS NULL OR admin_authority.cohort_id=${cohort})` : sql`admin_authority.cohort_id IS NULL`})`;
}
async function workspaceActor(workspaceId: string) {
  if (!learningEnabled()) throw new LearningError("unavailable", "La formazione non è disponibile in questo ambiente.");
  if (!z.uuid().safeParse(workspaceId).success) throw unavailable();
  const session = await auth();
  if (!session?.user.id) throw new LearningError("unauthenticated", "Accedi nuovamente per gestire la formazione.");
  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) throw unavailable();
  return { userId: session.user.id, access, canCreate: ["exec_sponsor", "transformation_lead"].includes(access.role) };
}
async function requireManager(workspaceId: string, programId: string): Promise<Context> {
  const { userId } = await workspaceActor(workspaceId);
  if (!z.uuid().safeParse(programId).success) throw unavailable();
  const [programs, grants] = await Promise.all([
    rows<Program>(sql`SELECT ${programColumns} FROM learning_programs p WHERE p.workspace_id=${workspaceId}::uuid AND p.id=${programId}::uuid`),
    rows<{cohortId:string|null}>(sql`SELECT cohort_id AS "cohortId" FROM learning_grants WHERE workspace_id=${workspaceId}::uuid AND program_id=${programId}::uuid AND user_id=${userId}::uuid AND capability='manage' AND revoked_at IS NULL`),
  ]);
  if (!programs[0] || !grants.length) throw unavailable();
  return { userId, workspaceId, program: programs[0], scopes: grants.map(g=>g.cohortId) };
}
function scope(ctx: Context, cohortId: string | null) {
  if (!ctx.scopes.includes(null) && (cohortId === null || !ctx.scopes.includes(cohortId))) throw unavailable();
}
function scopedRows(ctx: Context, column: SQL): SQL { return ctx.scopes.includes(null) ? sql`true` : sql`${column} IN (SELECT jsonb_array_elements_text(${JSON.stringify(ctx.scopes)}::jsonb))`; }

export async function getLearningAdminCatalog(workspaceId: string): Promise<AdminCatalogDTO> {
  const actor = await workspaceActor(workspaceId);
  const programs = await rows<Program & {scopes:(string|null)[]}>(sql`SELECT ${programColumns},
    (SELECT jsonb_agg(g.cohort_id) FROM learning_grants g WHERE g.workspace_id=p.workspace_id AND g.program_id=p.id AND g.user_id=${actor.userId}::uuid AND g.capability='manage' AND g.revoked_at IS NULL) AS scopes
    FROM learning_programs p WHERE p.workspace_id=${workspaceId}::uuid AND EXISTS(SELECT 1 FROM learning_grants g WHERE g.workspace_id=p.workspace_id AND g.program_id=p.id AND g.user_id=${actor.userId}::uuid AND g.capability='manage' AND g.revoked_at IS NULL) ORDER BY p.published_at DESC`);
  return { canCreate:actor.canCreate,canManage:programs.length>0,programs:programs.map(({scopes,...p})=>programDTO(p,scopes)) };
}
export async function getLearningAdminDetail(workspaceId: string, programId: string): Promise<AdminDetailDTO> {
  const ctx = await requireManager(workspaceId, programId);
  const [members,sessions,enrollments,grants,audit,counts] = await Promise.all([
    rows<AdminDetailDTO["members"][number]>(sql`SELECT u.id,u.name,u.email,COALESCE(m.role,wm.role)::text AS role,CASE WHEN m.user_id IS NOT NULL THEN 'organization' ELSE 'workspace' END AS source
      FROM workspaces w JOIN users u ON ${member(workspaceId,sql`u.id`)} LEFT JOIN memberships m ON m.organization_id=w.organization_id AND m.user_id=u.id
      LEFT JOIN workspace_memberships wm ON wm.workspace_id=w.id AND wm.user_id=u.id WHERE w.id=${workspaceId}::uuid
      AND NOT EXISTS(SELECT 1 FROM learning_enrollments e WHERE e.workspace_id=w.id AND e.program_id=${programId}::uuid AND e.user_id=u.id AND NOT (${scopedRows(ctx,sql`e.cohort_id`)}))
      ORDER BY u.name NULLS LAST,u.email`),
    rows<AdminDetailDTO["sessions"][number]>(sql`SELECT id,module_id AS "moduleId",cohort_id AS "cohortId",starts_at AS "startsAt",ends_at AS "endsAt",timezone,status FROM learning_sessions s WHERE workspace_id=${workspaceId}::uuid AND program_id=${programId}::uuid AND ${scopedRows(ctx,sql`s.cohort_id`)} ORDER BY starts_at`),
    rows<AdminDetailDTO["enrollments"][number]>(sql`SELECT e.id,e.user_id AS "userId",u.name,u.email,e.module_id AS "moduleId",e.cohort_id AS "cohortId",e.status,
      (EXISTS(SELECT 1 FROM learning_attempts a WHERE a.workspace_id=e.workspace_id AND a.program_id=e.program_id AND a.enrollment_id=e.id) OR EXISTS(SELECT 1 FROM learning_idea_drafts d WHERE d.workspace_id=e.workspace_id AND d.program_id=e.program_id AND d.enrollment_id=e.id)) AS "hasWork"
      FROM learning_enrollments e JOIN users u ON u.id=e.user_id WHERE e.workspace_id=${workspaceId}::uuid AND e.program_id=${programId}::uuid AND ${scopedRows(ctx,sql`e.cohort_id`)} ORDER BY u.name NULLS LAST,u.email`),
    rows<AdminDetailDTO["grants"][number]>(sql`SELECT g.id,g.user_id AS "userId",u.name,u.email,g.capability,g.cohort_id AS "cohortId",g.granted_at AS "grantedAt",g.revoked_at AS "revokedAt"
      FROM learning_grants g JOIN users u ON u.id=g.user_id WHERE g.workspace_id=${workspaceId}::uuid AND g.program_id=${programId}::uuid AND ${scopedRows(ctx,sql`g.cohort_id`)} ORDER BY g.granted_at DESC`),
    rows<AdminDetailDTO["audit"][number]>(sql`SELECT a.id,a.event_type AS "eventType",u.name AS "actorName",a.resource_id AS "resourceId",a.created_at AS "createdAt",a.metadata->>'cohortId' AS "cohortId"
      FROM learning_audit_events a JOIN users u ON u.id=a.actor_id WHERE a.workspace_id=${workspaceId}::uuid AND a.program_id=${programId}::uuid
      AND a.event_type IN ('program_imported','program_settings_changed','program_enabled','program_disabled','program_closed','program_reopened','session_status_changed','learner_enrolled','enrollment_changed','grant_created','grant_revoked','retention_purged')
      AND ${scopedRows(ctx,sql`a.metadata->>'cohortId'`)} ORDER BY a.created_at DESC LIMIT 100`),
    ctx.scopes.includes(null) ? rows<{attempts:number;ideaDrafts:number}>(sql`SELECT (SELECT count(*)::int FROM learning_attempts WHERE workspace_id=${workspaceId}::uuid AND program_id=${programId}::uuid) AS attempts,
      (SELECT count(*)::int FROM learning_idea_drafts WHERE workspace_id=${workspaceId}::uuid AND program_id=${programId}::uuid) AS "ideaDrafts"`) : Promise.resolve([]),
  ]);
  const eligibility=learningRetentionEligibility({status:ctx.program.status,closedAt:ctx.program.closedAt?new Date(ctx.program.closedAt):null,retentionDays:ctx.program.retentionDays});
  return {program:programDTO(ctx.program,ctx.scopes),members,sessions:sessions.map(s=>({...s,startsAt:instant(s.startsAt),endsAt:instant(s.endsAt)})),enrollments,
    grants:grants.map(g=>({...g,grantedAt:instant(g.grantedAt),revokedAt:g.revokedAt?instant(g.revokedAt):null})),audit:audit.map(a=>({...a,createdAt:instant(a.createdAt)})),
    retention:counts[0]?{...counts[0],eligible:eligibility.eligible,purgeAfter:eligibility.expiresAt?.toISOString()??null}:null};
}
function privatePack(raw: unknown): PrivateTrainingPack {
  try { if (Buffer.byteLength(JSON.stringify(raw) ?? "") > 5_000_000) throw new Error(); return parseTrainingPack(raw); }
  catch { throw new LearningError("invalid", "Pacchetto non valido. Controlla formato, riferimenti, date e versione; nessun contenuto è stato importato."); }
}
function packDTO(pack: PrivateTrainingPack): AdminPackDTO {
  return {version:pack.content_version,hash:trainingPackHash(pack),activityCount:pack.activities.length,itemCount:pack.items.length,sessionCount:pack.modules.reduce((n,m)=>n+m.cohorts.length,0),
    modules:pack.modules.map(m=>({id:m.id,title:m.title,sessions:m.cohorts.map(c=>({cohortId:c.id,startsAt:localDateTimeToUtc(c.start_local,c.timezone).toISOString(),endsAt:localDateTimeToUtc(c.end_local,c.timezone).toISOString(),timezone:c.timezone}))}))};
}
// Neon HTTP supports a non-interactive transactional batch. The second statement
// takes a fresh READ COMMITTED snapshot after the program row lock has been acquired.
async function mutate(ctx: Context, query: SQL): Promise<number> {
  const results = await db.batch([
    db.execute(sql`SELECT p.id FROM learning_programs p WHERE p.workspace_id=${ctx.workspaceId}::uuid AND p.id=${ctx.program.id}::uuid AND ${manager(ctx,null,true)} FOR UPDATE OF p`),
    db.execute(query),
  ]);
  const changed = Number((results[1].rows[0] as {changed?:unknown}|undefined)?.changed ?? -1);
  if (changed < 0) throw conflict();
  return changed;
}
function audit(ctx:Context,event:string,cohortId:SQL=sql`NULL`):SQL {
  return sql`INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type,metadata)
    SELECT ${ctx.workspaceId}::uuid,${ctx.program.id}::uuid,${ctx.userId}::uuid,id,${event},jsonb_build_object('cohortId',${cohortId}) FROM changed RETURNING id`;
}
const result = (programId:string,changed:number,message="Operazione registrata."):AdminMutationDTO => ({programId,changed,message});

export async function performLearningAdmin(request: LearningAdminRequest): Promise<AdminResponseMap[LearningAdminRequest["operation"]]> {
  const input = request.input;
  if (request.operation === "catalog") return getLearningAdminCatalog(input.workspaceId);
  if (request.operation === "detail") return getLearningAdminDetail(request.input.workspaceId,request.input.programId);
  if (request.operation === "inspectPack" || request.operation === "importPack") {
    const actor=await workspaceActor(request.input.workspaceId);
    if (!actor.canCreate) throw unavailable();
    const pack=privatePack(request.input.pack), inspection=packDTO(pack);
    if (request.operation === "inspectPack") return inspection;
    const i=request.input,id=randomUUID();
    const sessions=inspection.modules.flatMap(m=>m.sessions.map(s=>({id:randomUUID(),module_id:m.id,cohort_id:s.cohortId,starts_at:s.startsAt,ends_at:s.endsAt,timezone:s.timezone})));
    const batch=await db.batch([
      db.execute(sql`SELECT id FROM workspaces WHERE id=${i.workspaceId}::uuid AND ${bootstrap(i.workspaceId,actor.userId)} FOR UPDATE`),
      db.execute(sql`WITH permitted AS MATERIALIZED(SELECT 1 WHERE ${bootstrap(i.workspaceId,actor.userId)}), existing AS MATERIALIZED(
        SELECT p.id,p.pack_hash FROM learning_programs p WHERE p.workspace_id=${i.workspaceId}::uuid AND p.family_key=${pack.client_pack} AND p.content_version=${pack.content_version}
      ), changed AS(INSERT INTO learning_programs(id,workspace_id,family_key,title,content_version,pack_hash,private_pack,visibility_policy,retention_days,published_by)
        SELECT ${id}::uuid,${i.workspaceId}::uuid,${pack.client_pack},${i.title},${pack.content_version},${inspection.hash},${JSON.stringify(pack)}::jsonb,${i.visibilityPolicy},${i.retentionDays},${actor.userId}::uuid FROM permitted WHERE NOT EXISTS(SELECT 1 FROM existing) RETURNING id
      ), sessions AS(INSERT INTO learning_sessions(id,workspace_id,program_id,module_id,cohort_id,starts_at,ends_at,timezone)
        SELECT s.id,${i.workspaceId}::uuid,c.id,s.module_id,s.cohort_id,s.starts_at,s.ends_at,s.timezone FROM changed c,jsonb_to_recordset(${JSON.stringify(sessions)}::jsonb) AS s(id uuid,module_id text,cohort_id text,starts_at timestamptz,ends_at timestamptz,timezone text)
      ), grants AS(INSERT INTO learning_grants(workspace_id,program_id,user_id,capability,granted_by) SELECT ${i.workspaceId}::uuid,id,${actor.userId}::uuid,'manage',${actor.userId}::uuid FROM changed
      ), audited AS(INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type) SELECT ${i.workspaceId}::uuid,id,${actor.userId}::uuid,id,'program_imported' FROM changed)
      SELECT id,1 AS changed FROM changed UNION ALL SELECT e.id,0 AS changed FROM existing e WHERE e.pack_hash=${inspection.hash} AND EXISTS(SELECT 1 FROM permitted)
        AND EXISTS(SELECT 1 FROM learning_grants g WHERE g.workspace_id=${i.workspaceId}::uuid AND g.program_id=e.id AND g.user_id=${actor.userId}::uuid AND g.capability='manage' AND g.cohort_id IS NULL AND g.revoked_at IS NULL)`),
    ]);
    const imported=batch[1].rows[0] as {id:string;changed:number}|undefined;
    if (!imported) throw new LearningError("conflict","Importazione non applicata. Il corso potrebbe già esistere con contenuti o permessi diversi; usa una nuova versione per modificarne il contenuto.");
    return result(imported.id,Number(imported.changed),imported.changed?"Corso importato e disabilitato. Configura iscrizioni e permessi prima di abilitarlo.":"La stessa versione è già importata; nessun contenuto modificato.");
  }
  const ctx=await requireManager(request.input.workspaceId,request.input.programId);
  const p=ctx.program.id,w=ctx.workspaceId;
  if (request.operation === "settings") {
    scope(ctx,null); const i=request.input;
    return result(p,await mutate(ctx,sql`WITH changed AS(UPDATE learning_programs SET title=${i.title},visibility_policy=${i.visibilityPolicy},retention_days=${i.retentionDays}
      WHERE workspace_id=${w}::uuid AND id=${p}::uuid AND ${manager(ctx)} RETURNING id), audited AS(${audit(ctx,"program_settings_changed")}) SELECT CASE WHEN EXISTS(SELECT 1 FROM changed) THEN (SELECT count(*) FROM audited) ELSE -1 END AS changed`),"Impostazioni del corso salvate.");
  }
  if (request.operation === "lifecycle") {
    scope(ctx,null); const action=request.input.action;
    const event={enable:"program_enabled",disable:"program_disabled",close:"program_closed",reopen:"program_reopened"}[action];
    const message={enable:"Visibilità del corso abilitata. Le attività seguono lo stato del corso e dei turni.",disable:"Corso nascosto ai partecipanti. I dati salvati restano conservati.",close:"Corso chiuso alle nuove risposte. Le consegne restano consultabili se il corso è visibile.",reopen:"Corso riaperto alle nuove risposte. Controlla anche visibilità e apertura dei turni."}[action];
    return result(p,await mutate(ctx,sql`WITH changed AS(UPDATE learning_programs SET
      feature_enabled=CASE WHEN ${action==="enable"} THEN true WHEN ${action==="disable"} THEN false ELSE feature_enabled END,
      status=CASE WHEN ${action==="close"} THEN 'closed' WHEN ${action==="reopen"} THEN 'published' ELSE status END,
      closed_at=CASE WHEN ${action==="close"} THEN COALESCE(closed_at,now()) WHEN ${action==="reopen"} THEN NULL ELSE closed_at END
      WHERE workspace_id=${w}::uuid AND id=${p}::uuid AND ${manager(ctx)} RETURNING id), audited AS(${audit(ctx,event)}) SELECT CASE WHEN EXISTS(SELECT 1 FROM changed) THEN (SELECT count(*) FROM audited) ELSE -1 END AS changed`),message);
  }
  if (request.operation === "session") {
    const i=request.input;
    return result(p,await mutate(ctx,sql`WITH changed AS(UPDATE learning_sessions s SET status=${i.status} WHERE workspace_id=${w}::uuid AND program_id=${p}::uuid AND module_id='m1' AND id=${i.sessionId}::uuid AND ${manager(ctx,sql`s.cohort_id`)} RETURNING id,cohort_id), audited AS(${audit(ctx,"session_status_changed",sql`cohort_id`)}) SELECT CASE WHEN EXISTS(SELECT 1 FROM changed) THEN (SELECT count(*) FROM audited) ELSE -1 END AS changed`),{scheduled:"Turno impostato sull’apertura secondo il programma.",open:"Attività del turno aperte, se il corso è visibile e in corso.",closed:"Nuove risposte del turno sospese. Le consegne salvate restano conservate."}[i.status]);
  }
  if (request.operation === "enroll") {
    const i=request.input;scope(ctx,i.cohortId);
    return result(p,await mutate(ctx,sql`WITH targets AS MATERIALIZED(SELECT jsonb_array_elements_text(${JSON.stringify(i.userIds)}::jsonb)::uuid AS id), permitted AS MATERIALIZED(
      SELECT 1 WHERE ${manager(ctx,sql`${i.cohortId}`)} AND EXISTS(SELECT 1 FROM learning_sessions WHERE workspace_id=${w}::uuid AND program_id=${p}::uuid AND module_id='m1' AND cohort_id=${i.cohortId})
      AND NOT EXISTS(SELECT 1 FROM targets t WHERE NOT (${member(w,sql`t.id`)}))
      AND NOT EXISTS(SELECT 1 FROM learning_enrollments e JOIN targets t ON t.id=e.user_id WHERE e.workspace_id=${w}::uuid AND e.program_id=${p}::uuid AND e.module_id='m1' AND (e.cohort_id<>${i.cohortId} OR e.status<>'active'))
    ), changed AS(INSERT INTO learning_enrollments(workspace_id,program_id,user_id,module_id,cohort_id) SELECT ${w}::uuid,${p}::uuid,t.id,'m1',${i.cohortId} FROM targets t,permitted WHERE true ON CONFLICT(workspace_id,program_id,user_id,module_id) DO NOTHING RETURNING id),
      audited AS(${audit(ctx,"learner_enrolled",sql`${i.cohortId}::text`)}) SELECT CASE WHEN EXISTS(SELECT 1 FROM permitted) THEN (SELECT count(*) FROM audited) ELSE -1 END AS changed`),"Partecipanti assegnati al turno selezionato. Le assegnazioni già presenti sono state mantenute; nessuna email inviata.");
  }
  if (request.operation === "enrollment") {
    const i=request.input;scope(ctx,i.cohortId);
    return result(p,await mutate(ctx,sql`WITH changed AS(UPDATE learning_enrollments e SET status=${i.status},cohort_id=${i.cohortId}
      WHERE e.workspace_id=${w}::uuid AND e.program_id=${p}::uuid AND e.id=${i.enrollmentId}::uuid AND ${manager(ctx,sql`e.cohort_id`)} AND ${manager(ctx,sql`${i.cohortId}`)}
      AND (${i.status}='revoked' OR ${member(w,sql`e.user_id`)})
      AND EXISTS(SELECT 1 FROM learning_sessions s WHERE s.workspace_id=e.workspace_id AND s.program_id=e.program_id AND s.module_id=e.module_id AND s.cohort_id=${i.cohortId})
      AND (e.cohort_id=${i.cohortId} OR (NOT EXISTS(SELECT 1 FROM learning_attempts a WHERE a.workspace_id=e.workspace_id AND a.program_id=e.program_id AND a.enrollment_id=e.id) AND NOT EXISTS(SELECT 1 FROM learning_idea_drafts d WHERE d.workspace_id=e.workspace_id AND d.program_id=e.program_id AND d.enrollment_id=e.id)))
      RETURNING id),audited AS(${audit(ctx,"enrollment_changed",sql`${i.cohortId}::text`)}) SELECT CASE WHEN EXISTS(SELECT 1 FROM changed) THEN (SELECT count(*) FROM audited) ELSE -1 END AS changed`),i.status==="active"?"Assegnazione attiva e turno aggiornato.":"Assegnazione sospesa. I progressi già salvati restano conservati.");
  }
  if (request.operation === "grant") {
    const i=request.input;scope(ctx,i.cohortId);if(i.capability==="manage")scope(ctx,null);
    return result(p,await mutate(ctx,sql`WITH permitted AS MATERIALIZED(SELECT 1 WHERE ${manager(ctx,i.capability==="manage"?null:i.cohortId===null?null:sql`${i.cohortId}`)} AND ${member(w,sql`${i.userId}::uuid`)}
      AND (${i.cohortId}::text IS NULL OR EXISTS(SELECT 1 FROM learning_sessions WHERE workspace_id=${w}::uuid AND program_id=${p}::uuid AND module_id='m1' AND cohort_id=${i.cohortId}))),
      changed AS(INSERT INTO learning_grants(workspace_id,program_id,user_id,capability,cohort_id,granted_by) SELECT ${w}::uuid,${p}::uuid,${i.userId}::uuid,${i.capability},${i.cohortId},${ctx.userId}::uuid FROM permitted WHERE true ON CONFLICT DO NOTHING RETURNING id),
      audited AS(${audit(ctx,"grant_created",sql`${i.cohortId}::text`)}) SELECT CASE WHEN EXISTS(SELECT 1 FROM permitted) THEN (SELECT count(*) FROM audited) ELSE -1 END AS changed`),"Permesso attivo per la persona e i turni selezionati.");
  }
  if (request.operation === "revokeGrant") {
    const i=request.input;
    return result(p,await mutate(ctx,sql`WITH changed AS(UPDATE learning_grants g SET revoked_at=now() WHERE g.workspace_id=${w}::uuid AND g.program_id=${p}::uuid AND g.id=${i.grantId}::uuid AND g.revoked_at IS NULL
      AND ${manager(ctx,sql`g.cohort_id`)} AND (g.capability<>'manage' OR ${manager(ctx)})
      AND (g.capability<>'manage' OR g.cohort_id IS NOT NULL OR EXISTS(SELECT 1 FROM learning_grants other WHERE other.workspace_id=g.workspace_id AND other.program_id=g.program_id AND other.id<>g.id AND other.capability='manage' AND other.cohort_id IS NULL AND other.revoked_at IS NULL AND ${member(w,sql`other.user_id`)}))
      RETURNING id,cohort_id),audited AS(${audit(ctx,"grant_revoked",sql`cohort_id`)}) SELECT CASE WHEN EXISTS(SELECT 1 FROM changed) THEN (SELECT count(*) FROM audited) ELSE -1 END AS changed`),"Permesso revocato. Gli eventuali altri permessi restano attivi.");
  }
  if (request.operation === "purge") {
    scope(ctx,null);const i=request.input;
    if(i.confirmProgramId!==p || i.confirmTitle!==ctx.program.title)throw new LearningError("invalid","Conferma il titolo esatto del corso prima di eliminare le risposte.");
    return result(p,await mutate(ctx,sql`WITH eligible AS MATERIALIZED(SELECT id,retention_days FROM learning_programs WHERE workspace_id=${w}::uuid AND id=${p}::uuid AND title=${i.confirmTitle}
      AND status IN ('closed','archived') AND closed_at IS NOT NULL AND closed_at+retention_days*interval '24 hours'<=now() AND ${manager(ctx)}),
      attempts AS(DELETE FROM learning_attempts a USING eligible e WHERE a.workspace_id=${w}::uuid AND a.program_id=e.id RETURNING a.id),
      ideas AS(DELETE FROM learning_idea_drafts d USING eligible e WHERE d.workspace_id=${w}::uuid AND d.program_id=e.id RETURNING d.id),
      audited AS(INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type,metadata) SELECT ${w}::uuid,id,${ctx.userId}::uuid,id,'retention_purged',jsonb_build_object('attemptsDeleted',(SELECT count(*) FROM attempts),'ideaDraftsDeleted',(SELECT count(*) FROM ideas),'retentionDays',retention_days) FROM eligible RETURNING id)
      SELECT CASE WHEN EXISTS(SELECT 1 FROM audited) THEN (SELECT count(*) FROM attempts)+(SELECT count(*) FROM ideas) ELSE -1 END AS changed`),"Risposte e bozze eliminate secondo la conservazione prevista. Proposte nel portfolio, iscrizioni e audit conservati.");
  }
  throw new LearningError("invalid","Operazione non riconosciuta.");
}
