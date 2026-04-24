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

export type UseCaseScoringModel = {
  impactFlagEnabled: boolean;
  /**
   * Se true e `impactFlagEnabled` è ON, includiamo ESG nell'asse Impatto/Ranking
   * solo quando il singolo use case ha `impactFlag === true`.
   */
  includeEsgWhenImpactFlagged: boolean;
  config: {
    weights: {
      impact: Record<
        | "economic"
        | "time"
        | "quality"
        | "coordination"
        | "social",
        number
      >;
      feasibility: Record<"data" | "workflow" | "risk" | "tech" | "team", number>;
      esg: Record<"environmental" | "social" | "governance", number>;
      overall: { impact: number; feasibility: number; esgWhenEnabled: number };
    };
    thresholds: { highImpact: number; highFeasibility: number; midImpact: number };
  };
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
  data: ScoreSource,
  opts?: {
    model?: UseCaseScoringModel | null;
    /** Se false, ESG non viene mai considerato nel ranking anche se presente. */
    esgEnabled?: boolean;
    /** Flag opzionale per il singolo use case. */
    impactFlag?: boolean | null;
  }
): DerivedUseCaseScores {
  const impact = {
    economic: data.impactEconomic ?? 0,
    time: data.impactTime ?? 0,
    quality: data.impactQuality ?? 0,
    coordination: data.impactCoordination ?? 0,
    social: data.impactSocial ?? 0,
  };
  const feasibility = {
    data: data.feasibilityData ?? 0,
    workflow: data.feasibilityWorkflow ?? 0,
    risk: data.feasibilityRisk ?? 0,
    tech: data.feasibilityTech ?? 0,
    team: data.feasibilityTeam ?? 0,
  };
  const esg = {
    environmental: data.esgEnvironmental ?? 0,
    social: data.esgSocial ?? 0,
    governance: data.esgGovernance ?? 0,
  };

  const model = opts?.model ?? null;
  const weights = model?.config.weights;
  const thresholds = model?.config.thresholds;

  const weightedAverage = (values: Record<string, number>, w?: Record<string, number>) => {
    const entries = Object.entries(values);
    const denom = entries.reduce((sum, [k]) => sum + Math.max(0, w?.[k] ?? 1), 0);
    if (denom <= 0) return 0;
    const num = entries.reduce(
      (sum, [k, v]) => sum + (v ?? 0) * Math.max(0, w?.[k] ?? 1),
      0
    );
    return num / denom;
  };

  const overallImpact = weightedAverage(impact, weights?.impact);
  const overallFeasibility = weightedAverage(feasibility, weights?.feasibility);

  const hasEsg =
    esg.environmental > 0 || esg.social > 0 || esg.governance > 0;

  let overallEsg: number | null = null;
  let overallScore: number;

  if (hasEsg) {
    overallEsg = weightedAverage(esg, weights?.esg);
  }

  const esgEnabled = opts?.esgEnabled !== false;
  const impactFlag = opts?.impactFlag ?? null;
  const shouldIncludeEsgInRanking =
    esgEnabled &&
    !!overallEsg &&
    !!model?.impactFlagEnabled &&
    (model.includeEsgWhenImpactFlagged ? impactFlag === true : true);

  const overallW = weights?.overall ?? { impact: 0.5, feasibility: 0.5, esgWhenEnabled: 0.2 };
  const normBase = Math.max(0, overallW.impact) + Math.max(0, overallW.feasibility);
  const normWithEsg =
    normBase + (shouldIncludeEsgInRanking ? Math.max(0, overallW.esgWhenEnabled) : 0);
  const wi = normWithEsg > 0 ? Math.max(0, overallW.impact) / normWithEsg : 0.5;
  const wf = normWithEsg > 0 ? Math.max(0, overallW.feasibility) / normWithEsg : 0.5;
  const we =
    shouldIncludeEsgInRanking && normWithEsg > 0
      ? Math.max(0, overallW.esgWhenEnabled) / normWithEsg
      : 0;

  overallScore =
    overallImpact * wi + overallFeasibility * wf + (overallEsg ?? 0) * we;

  let category: UseCaseCategory;
  const hi = thresholds?.highImpact ?? 3.5;
  const hf = thresholds?.highFeasibility ?? 3.5;
  const mi = thresholds?.midImpact ?? 2.5;
  if (overallImpact >= hi && overallFeasibility >= hf) {
    category = "quick_win";
  } else if (overallImpact >= hi && overallFeasibility < hf) {
    category = "strategic_bet";
  } else if (overallImpact >= mi) {
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
