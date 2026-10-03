import { eq, desc, and } from "drizzle-orm";
import { db } from "..";
import { weeklySignals } from "../schema";
import { ensureDbSchema } from "../ensure-schema";

export async function getSignalsByWorkspace(
  workspaceId: string,
  limit = 50
) {
  await ensureDbSchema();
  return db
    .select()
    .from(weeklySignals)
    .where(eq(weeklySignals.workspaceId, workspaceId))
    .orderBy(desc(weeklySignals.createdAt))
    .limit(limit);
}

export async function getUnreadSignals(workspaceId: string) {
  await ensureDbSchema();
  return db
    .select()
    .from(weeklySignals)
    .where(
      and(
        eq(weeklySignals.workspaceId, workspaceId),
        eq(weeklySignals.isRead, false)
      )
    )
    .orderBy(desc(weeklySignals.createdAt));
}

export async function markSignalRead(workspaceId: string, signalId: string) {
  await ensureDbSchema();
  await db
    .update(weeklySignals)
    .set({ isRead: true })
    .where(
      and(
        eq(weeklySignals.id, signalId),
        eq(weeklySignals.workspaceId, workspaceId)
      )
    );
}
