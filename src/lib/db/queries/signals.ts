import { eq, desc, and } from "drizzle-orm";
import { db } from "..";
import { weeklySignals } from "../schema";

export async function getSignalsByWorkspace(
  workspaceId: string,
  limit = 50
) {
  return db
    .select()
    .from(weeklySignals)
    .where(eq(weeklySignals.workspaceId, workspaceId))
    .orderBy(desc(weeklySignals.createdAt))
    .limit(limit);
}

export async function getUnreadSignals(workspaceId: string) {
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

export async function markSignalRead(signalId: string) {
  await db
    .update(weeklySignals)
    .set({ isRead: true })
    .where(eq(weeklySignals.id, signalId));
}
