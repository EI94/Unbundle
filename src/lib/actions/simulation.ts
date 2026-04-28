"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { getDepartmentsByWorkspace } from "@/lib/db/queries/workspaces";
import { db } from "@/lib/db";
import { organizations, simulations } from "@/lib/db/schema";
import { eq, desc } from "drizzle-orm";
import { generateSimulation, type SimulationResult } from "@/lib/ai/generate-simulation";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

export async function generateSimulationAction(
  workspaceId: string
): Promise<SimulationResult> {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) throw new Error("Workspace non trovato");
  if (!canReviewWorkspacePortfolio(access.role)) {
    throw new Error("Non hai i permessi per generare simulazioni.");
  }
  const { workspace } = access;

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

  const result = await generateSimulation({
    useCases,
    activities,
    departments,
    companyValueThesis: org?.companyValueThesis,
  });

  await db.insert(simulations).values({
    workspaceId,
    content: result,
  });

  return result;
}

export async function getLatestSimulation(
  workspaceId: string
): Promise<SimulationResult | null> {
  const [latest] = await db
    .select()
    .from(simulations)
    .where(eq(simulations.workspaceId, workspaceId))
    .orderBy(desc(simulations.generatedAt))
    .limit(1);

  return (latest?.content as SimulationResult) ?? null;
}
