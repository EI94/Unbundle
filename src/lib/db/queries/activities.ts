import { eq, and, sql } from "drizzle-orm";
import { db } from "..";
import {
  activities,
  activityDependencies,
  type NewActivity,
} from "../schema";

export async function createActivity(data: NewActivity) {
  const [activity] = await db.insert(activities).values(data).returning();
  return activity;
}

export async function getActivitiesByDepartment(departmentId: string) {
  return db
    .select()
    .from(activities)
    .where(eq(activities.departmentId, departmentId))
    .orderBy(activities.createdAt);
}

export async function getActivitiesByWorkspace(workspaceId: string) {
  return db
    .select()
    .from(activities)
    .where(eq(activities.workspaceId, workspaceId))
    .orderBy(activities.createdAt);
}

export async function getActivityById(id: string) {
  const [activity] = await db
    .select()
    .from(activities)
    .where(eq(activities.id, id))
    .limit(1);
  return activity ?? null;
}

export async function updateActivity(id: string, data: Partial<NewActivity>) {
  const [activity] = await db
    .update(activities)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(activities.id, id))
    .returning();
  return activity;
}

export async function updateActivityClassification(
  id: string,
  classification: "automatable" | "augmentable" | "differentiating" | "emerging_opportunity" | "blocked_by_system" | "blocked_by_governance",
  confidenceScore: number
) {
  const [activity] = await db
    .update(activities)
    .set({ classification, confidenceScore, updatedAt: new Date() })
    .where(eq(activities.id, id))
    .returning();
  return activity;
}

export async function linkActivityDependency(
  sourceId: string,
  targetId: string,
  type?: string
) {
  await db.insert(activityDependencies).values({
    sourceActivityId: sourceId,
    targetActivityId: targetId,
    dependencyType: type,
  });
}

export async function getActivityStats(workspaceId: string) {
  const result = await db
    .select({
      total: sql<number>`count(*)`,
      automatable: sql<number>`count(*) filter (where ${activities.classification} = 'automatable')`,
      augmentable: sql<number>`count(*) filter (where ${activities.classification} = 'augmentable')`,
      differentiating: sql<number>`count(*) filter (where ${activities.classification} = 'differentiating')`,
      emergingOpportunity: sql<number>`count(*) filter (where ${activities.classification} = 'emerging_opportunity')`,
      blockedBySystem: sql<number>`count(*) filter (where ${activities.classification} = 'blocked_by_system')`,
      blockedByGovernance: sql<number>`count(*) filter (where ${activities.classification} = 'blocked_by_governance')`,
      unclassified: sql<number>`count(*) filter (where ${activities.classification} is null)`,
    })
    .from(activities)
    .where(eq(activities.workspaceId, workspaceId));
  return result[0];
}
