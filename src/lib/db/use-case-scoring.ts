import type { UseCase } from "@/lib/db/schema";

export type UseCaseCategory =
  | "quick_win"
  | "strategic_bet"
  | "capability_builder"
  | "not_yet";

export type DerivedUseCaseScores = {
  overallEsgScore: number | null;
  overallImpactScore: number;
  overallFeasibilityScore: number;
  overallScore: number;
  category: UseCaseCategory;
};

/** Input parziale (insert `NewUseCase` o merge su riga esistente). */
export type ScoreSource = Partial<
  Pick<
    UseCase,
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
    | "esgGovernance"
  >
>;

/**
 * Calcola impatto/fattibilità/ESG complessivi e `category` (wave) come in `createUseCase`.
 * Valori mancanti contano come 0 (stesso comportamento dell'insert storico).
 */
export function deriveUseCasePortfolioMetrics(
  data: ScoreSource
): DerivedUseCaseScores {
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

  let category: UseCaseCategory;
  if (overallImpact >= 3.5 && overallFeasibility >= 3.5) {
    category = "quick_win";
  } else if (overallImpact >= 3.5 && overallFeasibility < 3.5) {
    category = "strategic_bet";
  } else if (overallImpact >= 2.5) {
    category = "capability_builder";
  } else {
    category = "not_yet";
  }

  return {
    overallEsgScore: overallEsg,
    overallImpactScore: overallImpact,
    overallFeasibilityScore: overallFeasibility,
    overallScore,
    category,
  };
}
