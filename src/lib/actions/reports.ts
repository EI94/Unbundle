"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import {
  getWorkspaceById,
  getDepartmentsByWorkspace,
  getStrategicGoalsByWorkspace,
} from "@/lib/db/queries/workspaces";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { db } from "@/lib/db";
import { organizations, reports } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateReport } from "@/lib/ai/generate-report";

export async function generateReportAction(workspaceId: string) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error("Workspace non trovato");

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
