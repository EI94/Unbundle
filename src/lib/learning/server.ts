import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { learningPrograms, learningEnrollments, learningSessions, learningGrants, learningAttempts, learningAuditEvents } from "./schema";
import { getActivity, createAttemptOrder, getLearnerActivity, getSubmittedCaseExample } from "./pack";
import { validateDraftResponses, validateCompleteness, gradeActivity } from "./grading";
import { csvCell, suppressSmallSplit, m1ReleaseMinutes, type LearningCapability } from "./policy";
import type { AttemptResponses, LearnerActivityDTO, ObjectiveGrade } from "./types";

export type LearningErrorCode = "unavailable" | "unauthenticated" | "forbidden" | "invalid" | "conflict" | "closed" | "technical";
export class LearningError extends Error {
  constructor(public code: LearningErrorCode, message: string, public fieldErrors?: Record<string,string>) { super(message); }
}
export type LearningProgramRow = typeof learningPrograms.$inferSelect;
export type LearningEnrollmentRow = typeof learningEnrollments.$inferSelect;
type AttemptRow = typeof learningAttempts.$inferSelect;
type GrantRow = typeof learningGrants.$inferSelect;
export type AttemptDTO = {
  id: string; userId: string; activityId: string; attemptNumber: number; parentAttemptId: string | null;
  status: "draft" | "submitted"; revision: number; responses: AttemptResponses;
  savedAt: string; submittedAt: string | null; decisionsSubmittedAt: string | null; result: ObjectiveGrade | null;
  activity: LearnerActivityDTO; version: string; contentVersion: string;
  caseExample: ReturnType<typeof getSubmittedCaseExample> | null;
};
export function learningEnabled() { return process.env.LEARNING_ENABLED === "true"; }
function identifier(id: string) { if (!z.uuid().safeParse(id).success) throw new LearningError("forbidden", "Contenuto non disponibile per questo account."); }
async function requireWorkspace(workspaceId: string) {
  if (!learningEnabled()) throw new LearningError("unavailable", "La formazione non è disponibile in questo ambiente.");
  identifier(workspaceId);
  const session = await auth();
  if (!session?.user?.id) throw new LearningError("unauthenticated", "Accesso non confermato. Conserva questa pagina e riprova; se la sessione è terminata, accedi in una nuova scheda.");
  if (!await getWorkspaceAccessForUser(session.user.id, workspaceId)) throw new LearningError("forbidden", "Contenuto non disponibile per questo account.");
  return session.user.id;
}
async function requireProgram(workspaceId: string, programId: string) {
  const userId = await requireWorkspace(workspaceId); identifier(programId);
  const [program] = await db.select().from(learningPrograms).where(and(eq(learningPrograms.workspaceId,workspaceId),eq(learningPrograms.id,programId),eq(learningPrograms.featureEnabled,true)));
  if (!program) throw new LearningError("forbidden", "Contenuto non disponibile per questo account.");
  return { userId, program };
}
export async function requireLearningEnrollment(workspaceId: string, programId: string, mutable = false) {
  const { userId,program } = await requireProgram(workspaceId,programId);
  const [enrollment] = await db.select().from(learningEnrollments).where(and(eq(learningEnrollments.workspaceId,workspaceId),eq(learningEnrollments.programId,programId),eq(learningEnrollments.userId,userId),eq(learningEnrollments.moduleId,"m1"),eq(learningEnrollments.status,"active")));
  if (!enrollment) throw new LearningError("forbidden", "Contenuto non disponibile per questo account.");
  if (mutable) {
    if (program.status !== "published") throw new LearningError("closed", "Il programma è chiuso. Le consegne precedenti restano consultabili.");
    const [session] = await db.select().from(learningSessions).where(and(eq(learningSessions.workspaceId,workspaceId),eq(learningSessions.programId,programId),eq(learningSessions.moduleId,"m1"),eq(learningSessions.cohortId,enrollment.cohortId)));
    // The end of the meeting is not a deadline. An explicit close prevents further writes.
    if (!session || session.status === "closed" || (session.status !== "open" && session.startsAt.getTime() > Date.now())) throw new LearningError("closed", "L'attività non è ancora aperta oppure è stata chiusa dal formatore.");
  }
  return { userId, program, enrollment };
}
async function requireActivityOpen(ctx:Awaited<ReturnType<typeof requireLearningEnrollment>>,activityId:string) {
  if(ctx.program.status!=="published")throw new LearningError("closed","Il programma è chiuso; le consegne precedenti restano consultabili.");
  const [session]=await db.select().from(learningSessions).where(and(eq(learningSessions.workspaceId,ctx.program.workspaceId),eq(learningSessions.programId,ctx.program.id),eq(learningSessions.moduleId,"m1"),eq(learningSessions.cohortId,ctx.enrollment.cohortId)));
  const offset=m1ReleaseMinutes(getActivity(ctx.program.privatePack,activityId));
  if(offset===null || !session || session.status==="closed" || (session.status!=="open" && session.startsAt.getTime()+offset*60_000>Date.now()))throw new LearningError("closed","L'attività sarà aperta dal formatore o nella finestra prevista del tuo turno.");
}
async function grantsFor(workspaceId: string, programId: string, userId: string) {
  return db.select().from(learningGrants).where(and(eq(learningGrants.workspaceId,workspaceId),eq(learningGrants.programId,programId),eq(learningGrants.userId,userId),isNull(learningGrants.revokedAt)));
}
function programDTO(program: LearningProgramRow, grants: GrantRow[], enrollment?: LearningEnrollmentRow) {
  return { id:program.id,title:program.title,version:program.contentVersion,status:program.status,cohortId:enrollment?.cohortId ?? null,
    canReview:grants.some(g=>g.capability==="review"),canAggregate:grants.some(g=>g.capability==="aggregate"),canExport:grants.some(g=>g.capability==="export"),canManage:grants.some(g=>g.capability==="manage") };
}
export async function getLearningHome(workspaceId: string) {
  if (!learningEnabled()) return { enabled:false,programs:[] };
  const userId = await requireWorkspace(workspaceId);
  const programs = await db.select().from(learningPrograms).where(and(eq(learningPrograms.workspaceId,workspaceId),eq(learningPrograms.featureEnabled,true)));
  const visible = await Promise.all(programs.map(async p => {
    const [enrollment] = await db.select().from(learningEnrollments).where(and(eq(learningEnrollments.workspaceId,workspaceId),eq(learningEnrollments.programId,p.id),eq(learningEnrollments.userId,userId),eq(learningEnrollments.moduleId,"m1"),eq(learningEnrollments.status,"active")));
    const grants = await grantsFor(workspaceId,p.id,userId);
    return enrollment || grants.length ? programDTO(p,grants,enrollment) : null;
  }));
  return {enabled:true,programs:visible.filter(p=>p!==null)};
}
export async function hasLearningForWorkspace(workspaceId: string) {
  if (!learningEnabled()) return false;
  try {
    const userId=await requireWorkspace(workspaceId);
    const access=await getWorkspaceAccessForUser(userId,workspaceId);
    if(access && ["exec_sponsor","transformation_lead"].includes(access.role))return true;
    const [managed]=await db.select({id:learningGrants.id}).from(learningGrants).where(and(eq(learningGrants.workspaceId,workspaceId),eq(learningGrants.userId,userId),eq(learningGrants.capability,"manage"),isNull(learningGrants.revokedAt))).limit(1);
    return !!managed || (await getLearningHome(workspaceId)).programs.length>0;
  } catch { return false; }
}
async function ownAttempts(ctx: Awaited<ReturnType<typeof requireLearningEnrollment>>) {
  return db.select().from(learningAttempts).where(and(eq(learningAttempts.workspaceId,ctx.program.workspaceId),eq(learningAttempts.programId,ctx.program.id),eq(learningAttempts.enrollmentId,ctx.enrollment.id),eq(learningAttempts.userId,ctx.userId))).orderBy(learningAttempts.createdAt);
}
function summary(row: AttemptRow) {
  return {id:row.id,activityId:row.activityId,attemptNumber:row.attemptNumber,status:row.status,submittedAt:row.submittedAt?.toISOString() ?? null,
    result:row.status === "submitted" && row.result ? {correct:row.result.correct,total:row.result.total,status:row.result.status,essentialErrors:row.result.essential_errors.length}:null};
}
export async function getLearningProgram(workspaceId: string,programId: string) {
  const {userId,program} = await requireProgram(workspaceId,programId);
  const grants = await grantsFor(workspaceId,programId,userId);
  const [enrollment] = await db.select().from(learningEnrollments).where(and(eq(learningEnrollments.workspaceId,workspaceId),eq(learningEnrollments.programId,programId),eq(learningEnrollments.userId,userId),eq(learningEnrollments.moduleId,"m1"),eq(learningEnrollments.status,"active")));
  if (!enrollment && !grants.length) throw new LearningError("forbidden","Contenuto non disponibile per questo account.");
  const attempts = enrollment ? await ownAttempts({userId,program,enrollment}) : [];
  const sessions = await db.select().from(learningSessions).where(and(eq(learningSessions.workspaceId,workspaceId),eq(learningSessions.programId,programId))).orderBy(learningSessions.startsAt);
  const reviewers = enrollment ? await db.select({name:users.name,email:users.email}).from(learningGrants).innerJoin(users,eq(learningGrants.userId,users.id)).where(and(eq(learningGrants.workspaceId,workspaceId),eq(learningGrants.programId,programId),eq(learningGrants.capability,"review"),isNull(learningGrants.revokedAt),sql`(${learningGrants.cohortId} IS NULL OR ${learningGrants.cohortId} = ${enrollment.cohortId})`)) : [];
  const caseAttempt=attempts.filter(a=>a.activityId==="m1-case" && a.status==="submitted").at(-1);
  const finalAttempt=attempts.filter(a=>(a.activityId==="m1-exit-a" || a.activityId==="m1-exit-b") && a.status==="submitted").at(-1);
  const m1Completed=!!caseAttempt && !!finalAttempt;
  const m1Outcome=m1Completed ? (caseAttempt.result?.status==="consolidated" && finalAttempt.result?.status==="consolidated" ? "consolidated":"needs_practice") : null;
  return {...programDTO(program,grants,enrollment),visibilityPolicy:program.visibilityPolicy,retentionDays:program.retentionDays,
    modules:program.privatePack.modules.map(m=>({id:m.id,title:m.title,subtitle:m.subtitle,objective:m.objective,completionStatus:m.id==="m1"?(m1Completed?"completed":attempts.length?"in_progress":"not_started"):"not_started",learningOutcome:m.id==="m1"?m1Outcome:null,status:m.id==="m1" && enrollment ? program.status : "scheduled",
      activities:program.privatePack.activities.filter(a=>a.module_id===m.id && a.purpose!=="retake").map(a=>{
        const row=attempts.filter(t=>t.activityId===a.id).at(-1); return {id:a.id,title:a.title,kind:a.type,status:row?.status ?? (m.id==="m1"?"available":"scheduled"),attemptId:row?.id ?? null,result:row?summary(row).result:null};
      })})),
    sessions:sessions.map(s=>({id:s.id,moduleId:s.moduleId,cohortId:s.cohortId,assigned:!!enrollment && s.moduleId===enrollment.moduleId && s.cohortId===enrollment.cohortId,startsAt:s.startsAt.toISOString(),endsAt:s.endsAt.toISOString(),timezone:s.timezone,status:s.status})),
    reviewers:reviewers.map(r=>`${r.name || "Formatore"} · ${r.email}`),history:attempts.map(summary)};
}
function attemptDTO(row: AttemptRow,program: LearningProgramRow): AttemptDTO {
  if (row.contentVersion!==program.contentVersion || row.packHash!==program.packHash) throw new LearningError("technical","La versione del contenuto richiede una verifica tecnica. La bozza è conservata.");
  return {id:row.id,userId:row.userId,activityId:row.activityId,attemptNumber:row.attemptNumber,parentAttemptId:row.parentAttemptId,status:row.status as "draft"|"submitted",revision:row.revision,responses:row.responses,
    savedAt:row.updatedAt.toISOString(),decisionsSubmittedAt:row.decisionsSubmittedAt?.toISOString()??null,submittedAt:row.submittedAt?.toISOString()??null,result:row.status==="submitted"?row.result:null,
    activity:getLearnerActivity(program.privatePack,row.activityId,row.itemOrder),version:row.contentVersion,contentVersion:row.contentVersion,
    caseExample:row.status==="submitted" || row.decisionsSubmittedAt?getSubmittedCaseExample(program.privatePack,row.activityId):null};
}
function ensureM1(program:LearningProgramRow,activityId:string) {
  const activity=program.privatePack.activities.find(a=>a.id===activityId);
  if (!activity || activity.module_id!=="m1" || !activity.item_ids?.length) throw new LearningError("closed","Questa attività non è ancora disponibile.");
  return activity;
}
export async function getLearningActivity(workspaceId:string,programId:string,activityId:string) {
  const ctx=await requireLearningEnrollment(workspaceId,programId); const activity=ensureM1(ctx.program,activityId);
  const rows=(await ownAttempts(ctx)).filter(a=>a.activityId===activityId); const latest=rows.at(-1);
  if(latest?.status!=="submitted")await requireActivityOpen(ctx,activityId);
  if(activity.purpose==="retake" && !latest) throw new LearningError("forbidden","Avvia il recupero dal feedback della tua verifica.");
  return {userId:ctx.userId,program:{id:ctx.program.id,title:ctx.program.title,version:ctx.program.contentVersion},activity:getLearnerActivity(ctx.program.privatePack,activityId,latest?.itemOrder ?? createAttemptOrder(ctx.program.privatePack,activityId)),attempt:latest?attemptDTO(latest,ctx.program):null,history:rows.map(summary)};
}
async function requireOwnAttempt(workspaceId:string,programId:string,attemptId:string,mutable=false) {
  identifier(attemptId); const ctx=await requireLearningEnrollment(workspaceId,programId,mutable);
  const [attempt]=await db.select().from(learningAttempts).where(and(eq(learningAttempts.workspaceId,workspaceId),eq(learningAttempts.programId,programId),eq(learningAttempts.enrollmentId,ctx.enrollment.id),eq(learningAttempts.userId,ctx.userId),eq(learningAttempts.id,attemptId)));
  if(!attempt) throw new LearningError("forbidden","Contenuto non disponibile per questo account.");
  ensureM1(ctx.program,attempt.activityId); if(mutable)await requireActivityOpen(ctx,attempt.activityId); return {...ctx,attempt};
}
export async function getLearningAttempt(workspaceId:string,programId:string,attemptId:string) {
  const ctx=await requireOwnAttempt(workspaceId,programId,attemptId); return attemptDTO(ctx.attempt,ctx.program);
}
// Recheck mutable authorization in the database statement, including current membership.
// Shared program/enrollment/session locks let learner writes run together, while
// admin transactions lock the program first and then recheck on a fresh snapshot.
// A stale cohort context must not write after the learner's assignment is moved.
export function learningWriteGuard(ctx:Awaited<ReturnType<typeof requireLearningEnrollment>>,activityId?:string):SQL {
  const releaseMinutes=activityId?(m1ReleaseMinutes(getActivity(ctx.program.privatePack,activityId))??100000000):0;
  return sql`EXISTS (SELECT 1 FROM learning_programs p JOIN learning_enrollments e ON e.program_id=p.id AND e.workspace_id=p.workspace_id
    JOIN learning_sessions s ON s.workspace_id=e.workspace_id AND s.program_id=e.program_id AND s.module_id=e.module_id AND s.cohort_id=e.cohort_id
    JOIN workspaces w ON w.id=p.workspace_id
    WHERE p.workspace_id=${ctx.program.workspaceId}::uuid AND p.id=${ctx.program.id}::uuid AND p.feature_enabled=true AND p.status='published'
      AND e.id=${ctx.enrollment.id}::uuid AND e.user_id=${ctx.userId}::uuid AND e.cohort_id=${ctx.enrollment.cohortId} AND e.status='active'
      AND (s.status='open' OR (s.status='scheduled' AND s.starts_at+(${releaseMinutes} * interval '1 minute')<=now()))
      AND (EXISTS(SELECT 1 FROM memberships m WHERE m.organization_id=w.organization_id AND m.user_id=${ctx.userId}::uuid)
        OR EXISTS(SELECT 1 FROM workspace_memberships wm WHERE wm.workspace_id=w.id AND wm.user_id=${ctx.userId}::uuid))
      FOR SHARE OF p,e,s)`;
}
export async function startLearningAttempt(input:{workspaceId:string;programId:string;activityId:string;expectedVersion:string;expectedUserId:string}) {
  const ctx=await requireLearningEnrollment(input.workspaceId,input.programId,true);
  if(ctx.userId.toLowerCase()!==input.expectedUserId.toLowerCase())throw new LearningError("forbidden","L’account connesso è cambiato. Nessuna attività è stata aperta: riapri il percorso con l’account corretto.");
  const activity=ensureM1(ctx.program,input.activityId);
  await requireActivityOpen(ctx,input.activityId);
  if(ctx.program.contentVersion!==input.expectedVersion) throw new LearningError("conflict","Il programma è stato aggiornato. Ricarica prima di iniziare.");
  if(activity.purpose==="retake") throw new LearningError("forbidden","Avvia il recupero dal feedback della tua verifica.");
  const id=randomUUID(),order=createAttemptOrder(ctx.program.privatePack,input.activityId);
  await db.execute(sql`WITH inserted AS (
    INSERT INTO learning_attempts(id,workspace_id,program_id,enrollment_id,user_id,activity_id,attempt_number,content_version,pack_hash,item_order)
    SELECT ${id}::uuid,${input.workspaceId}::uuid,${input.programId}::uuid,${ctx.enrollment.id}::uuid,${ctx.userId}::uuid,${activity.id},1,${ctx.program.contentVersion},${ctx.program.packHash},${JSON.stringify(order)}::jsonb
    WHERE ${learningWriteGuard(ctx,activity.id)} ON CONFLICT (workspace_id,program_id,enrollment_id,activity_id,attempt_number) DO NOTHING RETURNING id
  ) INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type)
    SELECT ${input.workspaceId}::uuid,${input.programId}::uuid,${ctx.userId}::uuid,id,'attempt_started' FROM inserted`);
  const own=(await ownAttempts(ctx)).filter(a=>a.activityId===activity.id).at(-1);
  if(!own) throw new LearningError("closed","L'attività non è disponibile; nessun tentativo avviato.");
  return attemptDTO(own,ctx.program);
}
export async function saveLearningDraft(input:{workspaceId:string;programId:string;attemptId:string;expectedRevision:number;responses:unknown}) {
  const ctx=await requireOwnAttempt(input.workspaceId,input.programId,input.attemptId,true);
  if(ctx.attempt.status!=="draft") throw new LearningError("closed","La consegna è già inviata e non può essere modificata.");
  if(ctx.attempt.revision!==input.expectedRevision) throw new LearningError("conflict","Un'altra scheda ha aggiornato la bozza. Conserva le tue modifiche e ricarica la versione salvata.");
  let responses:AttemptResponses;
  try { responses=validateDraftResponses(ctx.program.privatePack,ctx.attempt.activityId,input.responses); } catch { throw new LearningError("invalid","Controlla le risposte e la lunghezza dei campi."); }
  if(ctx.attempt.decisionsSubmittedAt && JSON.stringify(Object.entries(responses.answers).sort()) !== JSON.stringify(Object.entries(ctx.attempt.responses.answers).sort())) throw new LearningError("closed","Le decisioni individuali sono già inviate; puoi completare la riflessione e indicare la modalità.");
  const rows=await db.update(learningAttempts).set({responses,revision:sql`${learningAttempts.revision}+1`,updatedAt:sql`now()`}).where(and(eq(learningAttempts.workspaceId,input.workspaceId),eq(learningAttempts.programId,input.programId),eq(learningAttempts.id,input.attemptId),eq(learningAttempts.enrollmentId,ctx.enrollment.id),eq(learningAttempts.userId,ctx.userId),eq(learningAttempts.status,"draft"),eq(learningAttempts.revision,input.expectedRevision),learningWriteGuard(ctx,ctx.attempt.activityId))).returning();
  if(!rows[0]) throw new LearningError("conflict","Salvataggio non confermato. Conserva le modifiche e ricarica la versione server.");
  return attemptDTO(rows[0],ctx.program);
}
export async function submitLearningAttempt(input:{workspaceId:string;programId:string;attemptId:string;expectedRevision:number;idempotencyKey:string}) {
  identifier(input.idempotencyKey);
  // Receipt retries also work after the program/session is closed.
  const ctx=await requireOwnAttempt(input.workspaceId,input.programId,input.attemptId);
  if(ctx.attempt.status==="submitted") {
    if(ctx.attempt.idempotencyKey===input.idempotencyKey) return attemptDTO(ctx.attempt,ctx.program);
    throw new LearningError("conflict","La consegna è già stata inviata. Riapri il feedback.");
  }
  await requireLearningEnrollment(input.workspaceId,input.programId,true);
  await requireActivityOpen(ctx,ctx.attempt.activityId);
  if(ctx.attempt.revision!==input.expectedRevision) throw new LearningError("conflict","La bozza è cambiata. Ricarica prima di confermare l'invio.");
  if(getActivity(ctx.program.privatePack,ctx.attempt.activityId).type==="case_review" && !ctx.attempt.decisionsSubmittedAt) throw new LearningError("invalid","Invia prima le decisioni individuali e consulta l’esempio preparato oppure usa l’assistente autorizzato.");
  let result:ObjectiveGrade;
  try {validateCompleteness(ctx.program.privatePack,ctx.attempt.activityId,ctx.attempt.responses);result=gradeActivity(ctx.program.privatePack,ctx.attempt.activityId,ctx.attempt.responses);} catch {throw new LearningError("invalid","Completa tutte le domande, i campi richiesti e la modalità prima dell'invio.");}
  // Grade exactly the pinned, persisted revision; one conditional write freezes result + answers.
  // Audit is part of the SAME SQL statement. Neon HTTP needs no interactive transaction.
  await db.execute(sql`WITH submitted AS (
    UPDATE learning_attempts SET status='submitted', result=${JSON.stringify(result)}::jsonb, submitted_at=now(),updated_at=now(),revision=revision+1,idempotency_key=${input.idempotencyKey}::uuid
    WHERE workspace_id=${input.workspaceId}::uuid AND program_id=${input.programId}::uuid AND id=${input.attemptId}::uuid AND enrollment_id=${ctx.enrollment.id}::uuid AND user_id=${ctx.userId}::uuid
      AND status='draft' AND revision=${input.expectedRevision} AND ${learningWriteGuard(ctx,ctx.attempt.activityId)} RETURNING id
  ) INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type)
    SELECT ${input.workspaceId}::uuid,${input.programId}::uuid,${ctx.userId}::uuid,id,'attempt_submitted' FROM submitted`);
  const current=await requireOwnAttempt(input.workspaceId,input.programId,input.attemptId);
  if(current.attempt.status!=="submitted" || current.attempt.idempotencyKey!==input.idempotencyKey) throw new LearningError("conflict","Invio non confermato: la bozza è cambiata o l'attività è stata chiusa. Conserva le modifiche e ricarica.");
  return attemptDTO(current.attempt,current.program);
}
export async function startLearningRetake(input:{workspaceId:string;programId:string;parentAttemptId:string}) {
  const ctx=await requireOwnAttempt(input.workspaceId,input.programId,input.parentAttemptId,true);
  if(ctx.attempt.status!=="submitted") throw new LearningError("invalid","Invia prima la verifica per aprire il recupero.");
  const parentActivity=getActivity(ctx.program.privatePack,ctx.attempt.activityId);
  const nextId=parentActivity.retake_activity_id ?? (parentActivity.purpose==="practice" || parentActivity.purpose==="retake" ? parentActivity.id : null);
  if(!nextId) throw new LearningError("invalid","Questa attività non prevede un recupero.");
  ensureM1(ctx.program,nextId); const nextNumber=ctx.attempt.attemptNumber+1,id=randomUUID(),order=createAttemptOrder(ctx.program.privatePack,nextId);
  await db.execute(sql`WITH inserted AS (
    INSERT INTO learning_attempts(id,workspace_id,program_id,enrollment_id,user_id,activity_id,attempt_number,parent_attempt_id,content_version,pack_hash,item_order)
    SELECT ${id}::uuid,${input.workspaceId}::uuid,${input.programId}::uuid,${ctx.enrollment.id}::uuid,${ctx.userId}::uuid,${nextId},${nextNumber},${input.parentAttemptId}::uuid,${ctx.program.contentVersion},${ctx.program.packHash},${JSON.stringify(order)}::jsonb
    WHERE ${learningWriteGuard(ctx,nextId)} ON CONFLICT DO NOTHING RETURNING id
  ) INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type)
    SELECT ${input.workspaceId}::uuid,${input.programId}::uuid,${ctx.userId}::uuid,id,'retake_started' FROM inserted`);
  const row=(await ownAttempts(ctx)).find(a=>a.parentAttemptId===input.parentAttemptId);
  if(!row) throw new LearningError("conflict","Il recupero non è stato avviato. Ricarica e riprova.");
  return attemptDTO(row,ctx.program);
}
async function requireCapability(workspaceId:string,programId:string,capability:LearningCapability) {
  const ctx=await requireProgram(workspaceId,programId); const grants=(await grantsFor(workspaceId,programId,ctx.userId)).filter(g=>g.capability===capability);
  if(!grants.length) throw new LearningError("forbidden","Non sei autorizzato a questa vista della formazione.");
  return {...ctx,grants};
}
function scopeCondition(grants:GrantRow[]) {
  return grants.some(g=>g.cohortId===null) ? sql`true` : sql`${learningEnrollments.cohortId} IN (${sql.join(grants.map(g=>sql`${g.cohortId}`),sql`,`)})`;
}
async function scopedProgress(ctx:Awaited<ReturnType<typeof requireCapability>>) {
  const rows=await db.select({enrollment:learningEnrollments,name:users.name,email:users.email}).from(learningEnrollments).innerJoin(users,eq(learningEnrollments.userId,users.id)).where(and(eq(learningEnrollments.workspaceId,ctx.program.workspaceId),eq(learningEnrollments.programId,ctx.program.id),eq(learningEnrollments.moduleId,"m1"),eq(learningEnrollments.status,"active"),scopeCondition(ctx.grants)));
  return Promise.all(rows.map(async r=>({userId:r.enrollment.userId,name:r.name??"Partecipante",email:r.email,cohortId:r.enrollment.cohortId,
    attempts:(await ownAttempts({userId:r.enrollment.userId,program:ctx.program,enrollment:r.enrollment})).map(summary)})));
}
export async function getLearningManage(workspaceId:string,programId:string) {
  const ctx=await requireCapability(workspaceId,programId,"review");
  return {program:programDTO(ctx.program,await grantsFor(workspaceId,programId,ctx.userId)),participants:await scopedProgress(ctx)};
}
export async function getLearningLive(workspaceId:string,programId:string) {
  const ctx=await requireCapability(workspaceId,programId,"aggregate");
  // Fixed grant scope, no user-controlled cohort/activity/date filters or raw text.
  const rows=await scopedProgress(ctx); const minimum=5;
  if(rows.length<minimum) return {program:{id:ctx.program.id,title:ctx.program.title},minimum,suppressed:true,enrolled:null,activities:[]};
  const activities=ctx.program.privatePack.activities.filter(a=>a.module_id==="m1" && a.purpose!=="retake").map(a=>{
    const attempts=rows.flatMap(r=>{const first=r.attempts.find(t=>t.activityId===a.id && t.status==="submitted"); return first?[first]:[];});
    const consolidated=attempts.filter(t=>t.result?.status==="consolidated" || t.result?.status==="formative_completed").length;
    const submitted=suppressSmallSplit(rows.length,attempts.length,minimum);
    return {id:a.id,title:a.title,submitted,consolidated:submitted===null?null:suppressSmallSplit(attempts.length,consolidated,minimum),suppressed:submitted===null || attempts.length<minimum};
  });
  return {program:{id:ctx.program.id,title:ctx.program.title},minimum,suppressed:false,enrolled:rows.length,activities};
}
export async function exportLearningCsv(workspaceId:string,programId:string) {
  const ctx=await requireCapability(workspaceId,programId,"export");
  const rows=await scopedProgress(ctx);
  // Audit must succeed before any CSV is returned; export grant is independent from review.
  await db.insert(learningAuditEvents).values({workspaceId,programId,actorId:ctx.userId,resourceId:programId,eventType:"named_export",metadata:{participants:rows.length,cohorts:ctx.grants.map(g=>g.cohortId)}});
  const header=["Partecipante","Email","Coorte","Attività","Tentativo","Consegna","Esito","Corrette","Totale"];
  const csv=[header,...rows.flatMap(r=>r.attempts.map(a=>[r.name,r.email,r.cohortId,a.activityId,a.attemptNumber,a.status,a.result?.status??"",a.result?.correct??"",a.result?.total??""]))].map(row=>row.map(csvCell).join(",")).join("\r\n");
  return {filename:`formazione-${programId}.csv`,csv:`\uFEFF${csv}`};
}

/** Freeze individual case choices BEFORE releasing the prepared example. */
export async function submitLearningDecisions(input:{workspaceId:string;programId:string;attemptId:string;expectedRevision:number}) {
  const ctx=await requireOwnAttempt(input.workspaceId,input.programId,input.attemptId,true);
  const activity=getActivity(ctx.program.privatePack,ctx.attempt.activityId);
  if(activity.type!=="case_review")throw new LearningError("invalid","Questa attività non prevede questa fase.");
  if(ctx.attempt.decisionsSubmittedAt)return attemptDTO(ctx.attempt,ctx.program);
  if(ctx.attempt.status!=="draft" || ctx.attempt.revision!==input.expectedRevision)throw new LearningError("conflict","La bozza è cambiata. Ricarica prima di inviare le decisioni.");
  const answers=ctx.attempt.responses.answers;
  if(!activity.item_ids || Object.keys(answers).length!==activity.item_ids.length || activity.item_ids.some(id=>!answers[id]))throw new LearningError("invalid","Rispondi a tutte le decisioni individuali prima di continuare.");
  validateDraftResponses(ctx.program.privatePack,activity.id,ctx.attempt.responses);
  await db.execute(sql`WITH changed AS (UPDATE learning_attempts SET decisions_submitted_at=now(),updated_at=now(),revision=revision+1
    WHERE workspace_id=${input.workspaceId}::uuid AND program_id=${input.programId}::uuid AND id=${input.attemptId}::uuid AND enrollment_id=${ctx.enrollment.id}::uuid AND user_id=${ctx.userId}::uuid
      AND status='draft' AND decisions_submitted_at IS NULL AND revision=${input.expectedRevision} AND ${learningWriteGuard(ctx,ctx.attempt.activityId)} RETURNING id)
    INSERT INTO learning_audit_events(workspace_id,program_id,actor_id,resource_id,event_type)
    SELECT ${input.workspaceId}::uuid,${input.programId}::uuid,${ctx.userId}::uuid,id,'individual_decisions_submitted' FROM changed`);
  const current=await requireOwnAttempt(input.workspaceId,input.programId,input.attemptId);
  if(!current.attempt.decisionsSubmittedAt)throw new LearningError("conflict","Invio delle decisioni non confermato. Conserva le modifiche e ricarica.");
  return attemptDTO(current.attempt,current.program);
}

/** Reviewers may inspect submitted evidence only. Draft text stays with its author. */
export async function getLearningReviewAttempt(workspaceId:string,programId:string,attemptId:string) {
  identifier(attemptId);const ctx=await requireCapability(workspaceId,programId,"review");
  const [row]=await db.select({attempt:learningAttempts,name:users.name,email:users.email}).from(learningAttempts)
    .innerJoin(learningEnrollments,and(eq(learningEnrollments.workspaceId,learningAttempts.workspaceId),eq(learningEnrollments.programId,learningAttempts.programId),eq(learningEnrollments.id,learningAttempts.enrollmentId),eq(learningEnrollments.userId,learningAttempts.userId)))
    .innerJoin(users,eq(users.id,learningAttempts.userId))
    .where(and(eq(learningAttempts.workspaceId,workspaceId),eq(learningAttempts.programId,programId),eq(learningAttempts.id,attemptId),eq(learningAttempts.status,"submitted"),eq(learningEnrollments.status,"active"),scopeCondition(ctx.grants)));
  if(!row)throw new LearningError("forbidden","Consegna non disponibile nel tuo perimetro di revisione.");
  return {participant:{name:row.name??"Partecipante",email:row.email},attempt:attemptDTO(row.attempt,ctx.program)};
}
