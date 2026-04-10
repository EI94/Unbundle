"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getActivitiesByWorkspace, updateActivity } from "@/lib/db/queries/activities";
import { matchActivitiesToOnet } from "@/lib/ai/onet-matching";

export async function runOnetMatchingAction(workspaceId: string) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const activities = await getActivitiesByWorkspace(workspaceId);
  const unmatched = activities.filter((a) => !a.onetTaskId);

  if (unmatched.length === 0) {
    return { matched: 0, total: activities.length };
  }

  const batchSize = 10;
  let totalMatched = 0;

  for (let i = 0; i < unmatched.length; i += batchSize) {
    const batch = unmatched.slice(i, i + batchSize);
    const matches = await matchActivitiesToOnet(batch);

    for (const match of matches) {
      await updateActivity(match.activityId, {
        onetTaskId: match.suggestedOnetCode,
        aiExposureScore: match.aiExposureEstimate,
      });
      totalMatched++;
    }
  }

  revalidatePath(`/dashboard/${workspaceId}`);
  return { matched: totalMatched, total: activities.length };
}
