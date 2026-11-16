"use server";

import { requireSession } from "@/lib/auth/redirect-to-login";
import { revalidatePath } from "next/cache";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { getStrategicGoalsByWorkspace } from "@/lib/db/queries/workspaces";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { classifyActivitiesBatch, skippedClassificationsText } from "@/lib/ai/classify";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { recordClassifications } from "@/lib/mappatura/complete";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

export async function runClassificationAction(workspaceId: string) {
  const session = await requireSession();

  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) throw new Error("Workspace non trovato");
  if (!canReviewWorkspacePortfolio(access.role)) {
    throw new Error("Non hai i permessi per classificare le attivita.");
  }
  const { workspace } = access;

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
    return { classified: 0, skipped: 0, skippedText: "", total: allActivities.length };
  }

  // Le classificazioni riuscite si scrivono; quelle rifiutate o fallite restano da fare (si riprovano con un altro clic).
  const results = await classifyActivitiesBatch(unclassified, {
    companyValueThesis: org?.companyValueThesis,
    goals,
  });

  // (Mappatura board) Lo stream e la confidenza come sempre, più la proposta, il motivo e il potenziale sulla board:
  // ogni istruzione porta il workspace, e un'attività di un altro workspace non si tocca.
  await recordClassifications(await getAppUcExecutor(), workspaceId, results);

  revalidatePath(`/dashboard/${workspaceId}`);

  const skipped = unclassified.length - results.size;
  return {
    classified: results.size,
    skipped,
    skippedText: skippedClassificationsText(skipped),
    total: allActivities.length,
  };
}
