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
  classification: "automate" | "differentiate" | "innovate",
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

export async function getDependenciesByDepartment(departmentId: string) {
  const deptActivities = await getActivitiesByDepartment(departmentId);
  const activityIds = deptActivities.map((a) => a.id);
  if (activityIds.length === 0) return [];

  return db
    .select()
    .from(activityDependencies)
    .where(
      sql`${activityDependencies.sourceActivityId} = ANY(${activityIds}) OR ${activityDependencies.targetActivityId} = ANY(${activityIds})`
    );
}

export async function getActivityStats(workspaceId: string) {
  const result = await db
    .select({
      total: sql<number>`count(*)`,
      automate: sql<number>`count(*) filter (where ${activities.classification} = 'automate')`,
      differentiate: sql<number>`count(*) filter (where ${activities.classification} = 'differentiate')`,
      innovate: sql<number>`count(*) filter (where ${activities.classification} = 'innovate')`,
      unclassified: sql<number>`count(*) filter (where ${activities.classification} is null)`,
    })
    .from(activities)
    .where(eq(activities.workspaceId, workspaceId));
  return result[0];
}
