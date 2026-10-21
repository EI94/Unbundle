"use server";

import { requireSession } from "@/lib/auth/redirect-to-login";
import { revalidatePath } from "next/cache";
import {
  updateUseCaseStatus,
  updateUseCaseWaveCategory,
} from "@/lib/db/queries/use-cases";
import { viewerFromSession } from "@/lib/db/queries/use-case-hub";
import type { UseCase } from "@/lib/db/schema";
import {
  toUseCaseLifecycleState,
  type UseCaseLifecycleState,
} from "@/lib/portfolio/use-case-client-rows";
import type { UseCaseCategoryValue } from "@/lib/use-case-lifecycle";
import { db } from "@/lib/db";
import { workspaces as workspacesTable } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateUseCases } from "@/lib/ai/generate-use-cases";
import { proposeFromActivityMapping, writeContextFor } from "@/lib/use-cases/create-flow";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import {
  canManageWorkspaceSettings,
  canReviewWorkspacePortfolio,
} from "@/lib/workspace-permissions";

/**
 * «Genera Use Cases» della pagina di oggi. Passa dal servizio dell'area
 * (docs/use-case/DESIGN.md §8.5, §9.2): le proposte nascono bozze `activity_mapping`
 * «AI Transformation», nascoste ai colleghi e mai approvate, anche nei workspace con l'area
 * spenta. Come prima basta un'attività classificata; risposta ed errori restano quelli del
 * pulsante di oggi.
 */
export async function generateUseCasesAction(workspaceId: string) {
  const session = await requireSession();

  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) throw new Error("Workspace non trovato");
  if (!canReviewWorkspacePortfolio(access.role)) {
    throw new Error("Non hai i permessi per generare use case.");
  }

  const writer = {
    userId: session.user.id,
    role: access.role,
    isLateralSpace: viewerFromSession(session.user, access.role).isLateralSpace,
  };
  const result = await proposeFromActivityMapping(
    writeContextFor(workspaceId, writer, "activity_mapping"),
    { generate: generateUseCases },
    { rule: "almeno_una" }
  );
  if (!result.ok) throw new Error(result.message);

  revalidatePath(`/dashboard/${workspaceId}`);
  return { generated: result.created.length };
}

export async function toggleEsgAction(workspaceId: string, enabled: boolean) {
  const session = await requireSession();

  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) throw new Error("Workspace non trovato");
  if (!canManageWorkspaceSettings(access.role)) {
    throw new Error("Non hai i permessi per modificare ESG.");
  }

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
): Promise<{ useCase: UseCaseLifecycleState }> {
  const session = await requireSession();

  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) throw new Error("Workspace non trovato");
  if (!canReviewWorkspacePortfolio(access.role)) {
    throw new Error("Non hai i permessi per modificare use case.");
  }

  const result = await updateUseCaseStatus(useCaseId, workspaceId, nextStatus);
  if (!result.ok) throw new Error(result.error);

  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId}`);
  // Solo stato e quadrante: la riga intera porterebbe al browser chi propone e l'intake.
  return { useCase: toUseCaseLifecycleState(result.useCase) };
}

export async function setUseCaseWaveCategoryAction(
  workspaceId: string,
  useCaseId: string,
  category: UseCaseCategoryValue
): Promise<{ useCase: UseCaseLifecycleState }> {
  const session = await requireSession();

  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) throw new Error("Workspace non trovato");
  if (!canReviewWorkspacePortfolio(access.role)) {
    throw new Error("Non hai i permessi per modificare use case.");
  }

  const result = await updateUseCaseWaveCategory(
    useCaseId,
    workspaceId,
    category
  );
  if (!result.ok) throw new Error(result.error);

  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases/${useCaseId}`);
  // Solo stato e quadrante: la riga intera porterebbe al browser chi propone e l'intake.
  return { useCase: toUseCaseLifecycleState(result.useCase) };
}
