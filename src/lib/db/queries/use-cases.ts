import { eq, desc } from "drizzle-orm";
import { db } from "..";
import {
  useCases,
  useCaseKrLinks,
  type NewUseCase,
} from "../schema";

export async function createUseCase(data: NewUseCase) {
  const impactScores = [
    data.impactEconomic ?? 0,
    data.impactTime ?? 0,
    data.impactQuality ?? 0,
    data.impactCoordination ?? 0,
    data.impactSocial ?? 0,
  ];
  const feasibilityScores = [
    data.feasibilityData ?? 0,
    data.feasibilityWorkflow ?? 0,
    data.feasibilityRisk ?? 0,
    data.feasibilityTech ?? 0,
    data.feasibilityTeam ?? 0,
  ];

  const overallImpact =
    impactScores.reduce((a, b) => a + b, 0) / impactScores.length;
  const overallFeasibility =
    feasibilityScores.reduce((a, b) => a + b, 0) / feasibilityScores.length;

  const hasEsg =
    (data.esgEnvironmental ?? 0) > 0 ||
    (data.esgSocial ?? 0) > 0 ||
    (data.esgGovernance ?? 0) > 0;

  let overallEsg: number | null = null;
  let overallScore: number;

  if (hasEsg) {
    const esgScores = [
      data.esgEnvironmental ?? 0,
      data.esgSocial ?? 0,
      data.esgGovernance ?? 0,
    ];
    overallEsg = esgScores.reduce((a, b) => a + b, 0) / esgScores.length;
    overallScore = (overallImpact + overallFeasibility + overallEsg) / 3;
  } else {
    overallScore = (overallImpact + overallFeasibility) / 2;
  }

  let category: "quick_win" | "strategic_bet" | "capability_builder" | "not_yet";
  if (overallImpact >= 3.5 && overallFeasibility >= 3.5) {
    category = "quick_win";
  } else if (overallImpact >= 3.5 && overallFeasibility < 3.5) {
    category = "strategic_bet";
  } else if (overallImpact >= 2.5) {
    category = "capability_builder";
  } else {
    category = "not_yet";
  }

  const [useCase] = await db
    .insert(useCases)
    .values({
      ...data,
      overallEsgScore: overallEsg,
      overallImpactScore: overallImpact,
      overallFeasibilityScore: overallFeasibility,
      overallScore,
      category,
    })
    .returning();
  return useCase;
}

export async function getUseCasesByWorkspace(workspaceId: string) {
  return db
    .select()
    .from(useCases)
    .where(eq(useCases.workspaceId, workspaceId))
    .orderBy(desc(useCases.overallScore));
}

export async function getUseCaseById(id: string) {
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
