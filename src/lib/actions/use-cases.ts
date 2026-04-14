"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { getStrategicGoalsByWorkspace, getWorkspaceById } from "@/lib/db/queries/workspaces";
import { createUseCase } from "@/lib/db/queries/use-cases";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateUseCases } from "@/lib/ai/generate-use-cases";

export async function generateUseCasesAction(workspaceId: string) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error("Workspace non trovato");

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1);

  const [activities, goals] = await Promise.all([
    getActivitiesByWorkspace(workspaceId),
    getStrategicGoalsByWorkspace(workspaceId),
  ]);

  const classifiedActivities = activities.filter((a) => a.classification);
  if (classifiedActivities.length === 0) {
    throw new Error(
      "Nessuna attività classificata. Esegui prima la classificazione."
    );
  }

  const generatedUseCases = await generateUseCases(classifiedActivities, {
    companyValueThesis: org?.companyValueThesis,
    goals,
  });

  const savedUseCases = [];
  for (let i = 0; i < generatedUseCases.length; i++) {
    const uc = generatedUseCases[i];
    const saved = await createUseCase({
      workspaceId,
      title: uc.title,
      description: uc.description,
      businessCase: uc.businessCase,
      impactEconomic: uc.impactEconomic,
      impactTime: uc.impactTime,
      impactQuality: uc.impactQuality,
      impactCoordination: uc.impactCoordination,
      impactSocial: uc.impactSocial,
      esgEnvironmental: uc.esgEnvironmental,
      esgSocial: uc.esgSocial,
      esgGovernance: uc.esgGovernance,
      feasibilityData: uc.feasibilityData,
      feasibilityWorkflow: uc.feasibilityWorkflow,
      feasibilityRisk: uc.feasibilityRisk,
      feasibilityTech: uc.feasibilityTech,
      feasibilityTeam: uc.feasibilityTeam,
      requirements: uc.requirements,
      dataDependencies: uc.dataDependencies,
      relatedActivityIds: uc.relatedActivityIds,
      timeline: uc.timeline,
      sequenceOrder: i + 1,
    });
    savedUseCases.push(saved);
  }

  revalidatePath(`/dashboard/${workspaceId}`);
  return { generated: savedUseCases.length };
}
