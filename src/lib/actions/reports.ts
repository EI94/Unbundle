"use server";

import { requireSession } from "@/lib/auth/redirect-to-login";
import { revalidatePath } from "next/cache";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import {
  getDepartmentsByWorkspace,
  getStrategicGoalsByWorkspace,
} from "@/lib/db/queries/workspaces";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { db } from "@/lib/db";
import { organizations, reports } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateReport } from "@/lib/ai/generate-report";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

export async function generateReportAction(workspaceId: string) {
  const session = await requireSession();

  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) throw new Error("Workspace non trovato");
  if (!canReviewWorkspacePortfolio(access.role)) {
    throw new Error("Non hai i permessi per generare report.");
  }
  const { workspace } = access;

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1);

  const [departments, activities, useCases, goals] = await Promise.all([
    getDepartmentsByWorkspace(workspaceId),
    getActivitiesByWorkspace(workspaceId),
    getUseCasesByWorkspace(workspaceId),
    getStrategicGoalsByWorkspace(workspaceId),
  ]);

  const reportContent = await generateReport({
    companyValueThesis: org?.companyValueThesis,
    departments,
    activities,
    useCases,
    goals,
  });

  const [report] = await db
    .insert(reports)
    .values({
      workspaceId,
      type: "full_report",
      title: `Report Unbundle - ${workspace.name}`,
      content: reportContent,
    })
    .returning();

  revalidatePath(`/dashboard/${workspaceId}/reports`);
  return report;
}
