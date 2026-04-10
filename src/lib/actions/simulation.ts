"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { getWorkspaceById, getDepartmentsByWorkspace } from "@/lib/db/queries/workspaces";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateSimulation, type SimulationResult } from "@/lib/ai/generate-simulation";

export async function generateSimulationAction(
  workspaceId: string
): Promise<SimulationResult> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error("Workspace non trovato");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1);

  const [useCases, activities, departments] = await Promise.all([
    getUseCasesByWorkspace(workspaceId),
    getActivitiesByWorkspace(workspaceId),
    getDepartmentsByWorkspace(workspaceId),
  ]);

  return generateSimulation({
    useCases,
    activities,
    departments,
    companyValueThesis: org?.companyValueThesis,
  });
}
