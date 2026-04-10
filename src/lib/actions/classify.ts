"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getActivitiesByWorkspace, updateActivityClassification } from "@/lib/db/queries/activities";
import { getStrategicGoalsByWorkspace, getWorkspaceById } from "@/lib/db/queries/workspaces";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { classifyActivitiesBatch } from "@/lib/ai/classify";

export async function runClassificationAction(workspaceId: string) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error("Workspace non trovato");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1);

  const [allActivities, goals] = await Promise.all([
    getActivitiesByWorkspace(workspaceId),
    getStrategicGoalsByWorkspace(workspaceId),
  ]);

  const unclassified = allActivities.filter((a) => !a.classification);
  if (unclassified.length === 0) {
    return { classified: 0, total: allActivities.length };
  }

  const results = await classifyActivitiesBatch(unclassified, {
    companyValueThesis: org?.companyValueThesis,
    goals,
  });

  for (const [activityId, result] of results) {
    await updateActivityClassification(
      activityId,
      result.classification,
      result.confidenceScore
    );
  }

  revalidatePath(`/dashboard/${workspaceId}`);

  return {
    classified: results.size,
    total: allActivities.length,
  };
}
