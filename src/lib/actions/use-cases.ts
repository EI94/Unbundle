"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { getActivitiesByWorkspace } from "@/lib/db/queries/activities";
import { getStrategicGoalsByWorkspace, getWorkspaceById } from "@/lib/db/queries/workspaces";
import {
  createUseCase,
  updateUseCaseStatus,
  updateUseCaseWaveCategory,
} from "@/lib/db/queries/use-cases";
import type { UseCase } from "@/lib/db/schema";
import type { UseCaseCategoryValue } from "@/lib/use-case-lifecycle";
import { db } from "@/lib/db";
import { organizations, workspaces as workspacesTable } from "@/lib/db/schema";
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

  const includeEsg = workspace.esgEnabled === true;

  const generatedUseCases = await generateUseCases(
    classifiedActivities,
    {
      companyValueThesis: org?.companyValueThesis,
      goals,
    },
    includeEsg
  );

  const savedUseCases = [];
  for (let i = 0; i < generatedUseCases.length; i++) {
    const uc = generatedUseCases[i] as Record<string, unknown>;
    const saved = await createUseCase({
      workspaceId,
      title: uc.title as string,
      description: uc.description as string,
      businessCase: uc.businessCase as string,
      portfolioKind: "use_case_ai",
      impactEconomic: uc.impactEconomic as number,
      impactTime: uc.impactTime as number,
      impactQuality: uc.impactQuality as number,
      impactCoordination: uc.impactCoordination as number,
      impactSocial: uc.impactSocial as number,
      esgEnvironmental: includeEsg ? (uc.esgEnvironmental as number) : undefined,
      esgSocial: includeEsg ? (uc.esgSocial as number) : undefined,
      esgGovernance: includeEsg ? (uc.esgGovernance as number) : undefined,
      feasibilityData: uc.feasibilityData as number,
      feasibilityWorkflow: uc.feasibilityWorkflow as number,
      feasibilityRisk: uc.feasibilityRisk as number,
      feasibilityTech: uc.feasibilityTech as number,
      feasibilityTeam: uc.feasibilityTeam as number,
      requirements: uc.requirements as string[],
      dataDependencies: uc.dataDependencies as string[],
      relatedActivityIds: uc.relatedActivityIds as string[],
      timeline: uc.timeline as string,
      sequenceOrder: i + 1,
    });
    savedUseCases.push(saved);
  }

  revalidatePath(`/dashboard/${workspaceId}`);
  return { generated: savedUseCases.length };
}

export async function toggleEsgAction(workspaceId: string, enabled: boolean) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error("Workspace non trovato");

  await db
    .update(workspacesTable)
    .set({ esgEnabled: enabled, updatedAt: new Date() })
    .where(eq(workspacesTable.id, workspaceId));

  revalidatePath(`/dashboard/${workspaceId}`);
}

export async function setUseCaseStatusAction(
  workspaceId: string,
  useCaseId: string,
  nextStatus: UseCase["status"]
) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error("Workspace non trovato");

  const result = await updateUseCaseStatus(useCaseId, workspaceId, nextStatus);
  if (!result.ok) throw new Error(result.error);

  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId}`);
  return { useCase: result.useCase };
}

export async function setUseCaseWaveCategoryAction(
  workspaceId: string,
  useCaseId: string,
  category: UseCaseCategoryValue
) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) throw new Error("Workspace non trovato");

  const result = await updateUseCaseWaveCategory(
    useCaseId,
    workspaceId,
    category
  );
  if (!result.ok) throw new Error(result.error);

  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId}`);
  return { useCase: result.useCase };
}
