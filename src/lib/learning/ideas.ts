import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { learningIdeaDrafts } from "./schema";
import { requireLearningEnrollment, learningWriteGuard } from "./server";
import { createLearningPortfolioUseCase } from "@/lib/db/queries/use-cases";
import { emptyIdeaFields, ideaFieldsSchema, ideaPortfolioFields, validateIdeaSubmission } from "./idea-contract";
import type { IdeaFields } from "./idea-contract";

export type IdeaDTO = { id: string; revision: number; fields: IdeaFields; status: string; resultingUseCaseId: string | null; savedAt: string };
function dto(row: typeof learningIdeaDrafts.$inferSelect): IdeaDTO {
  return { id: row.id, revision: row.revision, fields: ideaFieldsSchema.parse(row.fields), status: row.status, resultingUseCaseId: row.resultingUseCaseId, savedAt: row.updatedAt.toISOString() };
}
async function own(workspaceId: string, programId: string, mutable = false) {
  const context = await requireLearningEnrollment(workspaceId, programId, mutable);
  const condition = and(eq(learningIdeaDrafts.workspaceId, workspaceId), eq(learningIdeaDrafts.programId, programId), eq(learningIdeaDrafts.userId, context.userId), eq(learningIdeaDrafts.enrollmentId, context.enrollment.id));
  return { ...context, condition };
}
export async function getMyLearningIdea(workspaceId: string, programId: string) {
  const context = await own(workspaceId, programId);
  const [row] = await db.select().from(learningIdeaDrafts).where(context.condition).limit(1);
  return row ? dto(row) : null;
}
export async function saveMyLearningIdea(workspaceId: string, programId: string, expectedRevision: number | null, input: unknown) {
  const context = await own(workspaceId, programId, true);
  const fields = ideaFieldsSchema.parse(input);
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
  const [row] = await db.update(learningIdeaDrafts).set({ fields, revision: sql`${learningIdeaDrafts.revision} + 1`, updatedAt: new Date() }).where(and(context.condition, eq(learningIdeaDrafts.status, "draft"), eq(learningIdeaDrafts.revision, expectedRevision), learningWriteGuard(context))).returning();
  if (!row) throw new Error("conflict");
  return dto(row);
}
export async function submitMyLearningIdea(workspaceId: string, programId: string, draftId: string, expectedRevision: number, idempotencyKey: string) {
  const context = await own(workspaceId, programId);
  const scoped = and(context.condition, eq(learningIdeaDrafts.id, draftId));
  const [before] = await db.select().from(learningIdeaDrafts).where(scoped).limit(1);
  if (!before) throw new Error("forbidden");
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
