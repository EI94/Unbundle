import { and, eq, desc, isNotNull } from "drizzle-orm";
import { db } from "..";
import {
  useCases,
  useCaseKrLinks,
  type NewUseCase,
  type UseCase,
} from "../schema";
import { deriveUseCasePortfolioMetrics } from "../use-case-scoring";
import { getWorkspaceById } from "./workspaces";
import { getOrCreateWorkspaceScoringModel } from "./scoring-model";
import { ensureDbSchema } from "../ensure-schema";
import {
  isAllowedStatusTransition,
  type UseCaseCategoryValue,
} from "@/lib/use-case-lifecycle";

export async function createUseCase(data: NewUseCase) {
  await ensureDbSchema();
  const workspace = await getWorkspaceById(data.workspaceId);
  const model = await getOrCreateWorkspaceScoringModel(data.workspaceId);
  const derived = deriveUseCasePortfolioMetrics(data, {
    model: {
      impactFlagEnabled: model.impactFlagEnabled,
      config: model.resolvedConfig,
    },
    esgEnabled: workspace?.esgEnabled === true,
  });

  const [useCase] = await db
    .insert(useCases)
    .values({
      ...data,
      ...derived,
    })
    .returning();
  return useCase;
}

export async function getUseCasesByWorkspace(workspaceId: string) {
  await ensureDbSchema();
  return db
    .select()
    .from(useCases)
    .where(eq(useCases.workspaceId, workspaceId))
    .orderBy(desc(useCases.overallScore));
}

export async function getPortfolioContributionsByWorkspace(workspaceId: string) {
  await ensureDbSchema();
  return db
    .select()
    .from(useCases)
    .where(and(eq(useCases.workspaceId, workspaceId), isNotNull(useCases.portfolioKind)))
    .orderBy(desc(useCases.createdAt));
}

export async function getUseCaseById(id: string) {
  await ensureDbSchema();
  const [useCase] = await db
    .select()
    .from(useCases)
    .where(eq(useCases.id, id))
    .limit(1);
  return useCase ?? null;
}

export async function updateUseCase(id: string, data: Partial<NewUseCase>) {
  const [useCase] = await db
    .update(useCases)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(useCases.id, id))
    .returning();
  return useCase;
}

export async function updateUseCasePortfolioReview(
  useCaseId: string,
  workspaceId: string,
  patch: Partial<Pick<NewUseCase, "impactFlag" | "portfolioReviewStatus" | "reviewNotes">> & {
    reviewedBy?: string | null;
    reviewedAt?: Date | null;
    submittedAt?: Date | null;
  }
) {
  const existing = await getUseCaseById(useCaseId);
  if (!existing || existing.workspaceId !== workspaceId) return null;

  const [row] = await db
    .update(useCases)
    .set({
      impactFlag: patch.impactFlag ?? existing.impactFlag,
      portfolioReviewStatus:
        patch.portfolioReviewStatus ?? existing.portfolioReviewStatus,
      reviewNotes: patch.reviewNotes ?? existing.reviewNotes,
      reviewedBy: patch.reviewedBy ?? existing.reviewedBy,
      reviewedAt: patch.reviewedAt ?? existing.reviewedAt,
      submittedAt: patch.submittedAt ?? existing.submittedAt,
      updatedAt: new Date(),
    })
    .where(eq(useCases.id, useCaseId))
    .returning();
  return row;
}

type LegacyScoreKey =
  | "impactEconomic"
  | "impactTime"
  | "impactQuality"
  | "impactCoordination"
  | "impactSocial"
  | "feasibilityData"
  | "feasibilityWorkflow"
  | "feasibilityRisk"
  | "feasibilityTech"
  | "feasibilityTeam"
  | "esgEnvironmental"
  | "esgSocial"
  | "esgGovernance";

export type UseCaseScoresPatch = Partial<Pick<NewUseCase, LegacyScoreKey>>;

/**
 * Aggiorna solo i punteggi (1–5 / ESG), ricalcola metriche aggregate e `category`.
 */
export async function updateUseCaseScores(
  useCaseId: string,
  workspaceId: string,
  patch: UseCaseScoresPatch
) {
  const existing = await getUseCaseById(useCaseId);
  if (!existing || existing.workspaceId !== workspaceId) return null;

  const workspace = await getWorkspaceById(workspaceId);
  const model = await getOrCreateWorkspaceScoringModel(workspaceId);
  const merged = { ...existing, ...patch };
  const derived = deriveUseCasePortfolioMetrics(merged, {
    model: {
      impactFlagEnabled: model.impactFlagEnabled,
      config: model.resolvedConfig,
    },
    esgEnabled: workspace?.esgEnabled === true,
  });

  const [row] = await db
    .update(useCases)
    .set({
      ...patch,
      ...derived,
      updatedAt: new Date(),
    })
    .where(eq(useCases.id, useCaseId))
    .returning();
  return row;
}

export async function updateUseCaseCustomScores(
  useCaseId: string,
  workspaceId: string,
  customScores: NonNullable<UseCase["customScores"]>
) {
  const existing = await getUseCaseById(useCaseId);
  if (!existing || existing.workspaceId !== workspaceId) return null;

  const workspace = await getWorkspaceById(workspaceId);
  const model = await getOrCreateWorkspaceScoringModel(workspaceId);
  const merged = { ...existing, customScores };
  const derived = deriveUseCasePortfolioMetrics(merged, {
    model: {
      impactFlagEnabled: model.impactFlagEnabled,
      config: model.resolvedConfig,
    },
    esgEnabled: workspace?.esgEnabled === true,
  });

  const [row] = await db
    .update(useCases)
    .set({
      customScores,
      ...derived,
      updatedAt: new Date(),
    })
    .where(eq(useCases.id, useCaseId))
    .returning();
  return row;
}

export async function recomputeUseCasePortfolioMetrics(
  useCaseId: string,
  workspaceId: string
) {
  const existing = await getUseCaseById(useCaseId);
  if (!existing || existing.workspaceId !== workspaceId) return null;

  const workspace = await getWorkspaceById(workspaceId);
  const model = await getOrCreateWorkspaceScoringModel(workspaceId);
  const derived = deriveUseCasePortfolioMetrics(existing, {
    model: {
      impactFlagEnabled: model.impactFlagEnabled,
      config: model.resolvedConfig,
    },
    esgEnabled: workspace?.esgEnabled === true,
  });

  const [row] = await db
    .update(useCases)
    .set({
      ...derived,
      updatedAt: new Date(),
    })
    .where(eq(useCases.id, useCaseId))
    .returning();
  return row;
}

export async function recomputePortfolioMetricsByWorkspace(workspaceId: string) {
  const contributions = await getPortfolioContributionsByWorkspace(workspaceId);
  const updated: UseCase[] = [];
  for (const item of contributions) {
    const row = await recomputeUseCasePortfolioMetrics(item.id, workspaceId);
    if (row) updated.push(row);
  }
  return updated;
}

export type UpdateUseCaseMutationResult =
  | { ok: true; useCase: UseCase }
  | { ok: false; error: string };

export async function updateUseCaseStatus(
  useCaseId: string,
  workspaceId: string,
  nextStatus: UseCase["status"]
): Promise<UpdateUseCaseMutationResult> {
  const existing = await getUseCaseById(useCaseId);
  if (!existing || existing.workspaceId !== workspaceId) {
    return { ok: false, error: "Use case non trovato" };
  }
  if (existing.status === nextStatus) {
    return { ok: true, useCase: existing };
  }
  if (!isAllowedStatusTransition(existing.status, nextStatus)) {
    return {
      ok: false,
      error: `Transizione non consentita: da "${existing.status}" a "${nextStatus}".`,
    };
  }
  const row = await updateUseCase(useCaseId, { status: nextStatus });
  if (!row) return { ok: false, error: "Aggiornamento fallito" };
  return { ok: true, useCase: row };
}

export async function updateUseCaseWaveCategory(
  useCaseId: string,
  workspaceId: string,
  category: UseCaseCategoryValue
): Promise<UpdateUseCaseMutationResult> {
  const existing = await getUseCaseById(useCaseId);
  if (!existing || existing.workspaceId !== workspaceId) {
    return { ok: false, error: "Use case non trovato" };
  }
  const row = await updateUseCase(useCaseId, { category });
  if (!row) return { ok: false, error: "Aggiornamento fallito" };
  return { ok: true, useCase: row };
}

export async function linkUseCaseToKR(
  useCaseId: string,
  keyResultId: string,
  contributionDescription?: string,
  leverType?: string
) {
  await db.insert(useCaseKrLinks).values({
    useCaseId,
    keyResultId,
    contributionDescription,
    leverType,
  });
}

export async function getUseCaseKRLinks(useCaseId: string) {
  return db
    .select()
    .from(useCaseKrLinks)
    .where(eq(useCaseKrLinks.useCaseId, useCaseId));
}
