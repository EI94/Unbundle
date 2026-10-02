import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { learningIdeaDrafts } from "./schema";
import { requireLearningEnrollment, learningWriteGuard, LearningError } from "./server";
import { createLearningPortfolioUseCase } from "@/lib/db/queries/use-cases";
import { emptyIdeaFields, ideaFieldsSchema, ideaPortfolioFields, validateIdeaSubmission } from "./idea-contract";
import type { IdeaFields, IdeaSaveRequest, IdeaSubmitRequest } from "./idea-contract";

export type IdeaDTO = { id: string; revision: number; fields: IdeaFields; status: string; resultingUseCaseId: string | null; savedAt: string };
function dto(row: typeof learningIdeaDrafts.$inferSelect): IdeaDTO {
  return { id: row.id, revision: row.revision, fields: ideaFieldsSchema.parse(row.fields), status: row.status, resultingUseCaseId: row.resultingUseCaseId, savedAt: row.updatedAt.toISOString() };
}
async function own(workspaceId: string, programId: string, mutable = false, expectedUserId?: string) {
  const context = await requireLearningEnrollment(workspaceId, programId, mutable);
  // The supplied identity is only a precondition. Authority always comes from auth().
  // A stale tab must never save its old author's text into the newly signed-in user's draft.
  if (expectedUserId !== undefined && context.userId.toLowerCase() !== expectedUserId.toLowerCase()) {
    throw new LearningError("forbidden", "L’account connesso è cambiato. Nessuna modifica è stata inviata: riapri il percorso con l’account corretto.");
  }
  const condition = and(eq(learningIdeaDrafts.workspaceId, workspaceId), eq(learningIdeaDrafts.programId, programId), eq(learningIdeaDrafts.userId, context.userId), eq(learningIdeaDrafts.enrollmentId, context.enrollment.id));
  return { ...context, condition };
}
export async function getMyLearningIdea(workspaceId: string, programId: string) {
  const context = await own(workspaceId, programId);
  const [row] = await db.select().from(learningIdeaDrafts).where(context.condition).limit(1);
  return row ? dto(row) : null;
}
export async function saveMyLearningIdea(input: IdeaSaveRequest) {
  const { workspaceId, programId, expectedUserId, draftId, expectedRevision } = input;
  const context = await own(workspaceId, programId, true, expectedUserId);
  if ((draftId === null) !== (expectedRevision === null)) throw new LearningError("invalid", "Identifica la bozza e la revisione da salvare.");
  const fields = ideaFieldsSchema.parse(input.fields);
  if (expectedRevision === null) {
    const result = await db.execute(sql`INSERT INTO learning_idea_drafts(workspace_id,program_id,enrollment_id,user_id,fields)
      SELECT ${workspaceId}::uuid,${programId}::uuid,${context.enrollment.id}::uuid,${context.userId}::uuid,${JSON.stringify(fields)}::jsonb
      WHERE ${learningWriteGuard(context)} ON CONFLICT DO NOTHING RETURNING id`);
    if (result.rows.length) {
      const [row] = await db.select().from(learningIdeaDrafts).where(context.condition).limit(1);
      if (row) return dto(row);
    }
    throw new Error("conflict");
  }
  const [row] = await db.update(learningIdeaDrafts).set({ fields, revision: sql`${learningIdeaDrafts.revision} + 1`, updatedAt: new Date() }).where(and(context.condition, eq(learningIdeaDrafts.id, draftId!), eq(learningIdeaDrafts.status, "draft"), eq(learningIdeaDrafts.revision, expectedRevision), learningWriteGuard(context))).returning();
  if (!row) throw new Error("conflict");
  return dto(row);
}
export async function submitMyLearningIdea(input: IdeaSubmitRequest) {
  const { workspaceId, programId, expectedUserId, draftId, expectedRevision, idempotencyKey } = input;
  const context = await own(workspaceId, programId, false, expectedUserId);
  const scoped = and(context.condition, eq(learningIdeaDrafts.id, draftId));
  const [before] = await db.select().from(learningIdeaDrafts).where(scoped).limit(1);
  if (!before) throw new LearningError("forbidden", "Proposta non disponibile per questo account.");
  if (before.status === "submitted") return dto(before);
  await requireLearningEnrollment(workspaceId, programId, true);
  const fields = validateIdeaSubmission(before.fields);
  if (before.status === "draft") {
    const [locked] = await db.update(learningIdeaDrafts).set({ status: "promoting", idempotencyKey, revision: sql`${learningIdeaDrafts.revision} + 1`, updatedAt: new Date() }).where(and(scoped, eq(learningIdeaDrafts.status, "draft"), eq(learningIdeaDrafts.revision, expectedRevision), learningWriteGuard(context))).returning();
    if (!locked) throw new Error("conflict");
  }
  // A promoting record is frozen. Retrying it resumes the same reserved UUID.
  await createLearningPortfolioUseCase({ id: before.id, workspaceId, ...ideaPortfolioFields(fields), proposedBy: context.userId, submittedAt: new Date() }, learningWriteGuard(context));
  const [existing] = await db.select().from(learningIdeaDrafts).where(scoped).limit(1);
  if (existing?.status !== "submitted") throw new Error("technical");
  return dto(existing);
}

export { emptyIdeaFields };
