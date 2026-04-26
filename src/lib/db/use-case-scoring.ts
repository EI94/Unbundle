import type { UseCase } from "@/lib/db/schema";
import type { ScoringModelConfig, ScoringKpi } from "@/lib/db/queries/scoring-model";

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

/** Alias esposto per retrocompatibilità degli import esterni. */
export type UseCaseScoringModel = {
  impactFlagEnabled: boolean;
  config: ScoringModelConfig;
};

/**
 * Input usato per calcolare i punteggi. Contiene sia le colonne storiche
 * (sub-dimensioni hardcoded) sia i `customScores` jsonb (KPI custom).
 */
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
    | "customScores"
  >
>;

/**
 * Legge il punteggio per un KPI combinando:
 * 1) `customScores[dim][kpiId]` (nuova via)
 * 2) mapping 1:1 con le colonne legacy per i kpiId storici (economic/time/data/...)
 */
export function readUseCaseRawKpiScore(
  data: ScoreSource,
  dimension: "impact" | "feasibility" | "esg",
  kpiId: string
): number {
  const custom = data.customScores?.[dimension]?.[kpiId];
  if (typeof custom === "number" && Number.isFinite(custom)) return clamp05(custom);

  if (dimension === "impact" && kpiId === "efficiency") {
    return (
      averageLegacyColumns(data, ["impactTime", "impactQuality"]) ??
      averageLegacyColumns(data, ["impactCoordination", "impactSocial"]) ??
      readLegacyColumn(data, "impactEconomic") ??
      0
    );
  }

  if (dimension === "impact" && kpiId === "profitability") {
    return (
      readLegacyColumn(data, "impactEconomic") ??
      averageLegacyColumns(data, ["impactQuality", "impactTime"]) ??
      0
    );
  }

  if (dimension === "feasibility" && kpiId === "effort") {
    const legacyFeasibility = averageLegacyColumns(data, [
      "feasibilityData",
      "feasibilityWorkflow",
      "feasibilityTech",
      "feasibilityTeam",
    ]);
    return legacyFeasibility === null ? 0 : clamp05(6 - legacyFeasibility);
  }

  const legacyMap: Record<string, keyof ScoreSource | undefined> = {
    // impact
    economic: "impactEconomic",
    time: "impactTime",
    quality: "impactQuality",
    coordination: "impactCoordination",
    social: dimension === "esg" ? "esgSocial" : "impactSocial",
    // feasibility
    data: "feasibilityData",
    workflow: "feasibilityWorkflow",
    risk: "feasibilityRisk",
    tech: "feasibilityTech",
    team: "feasibilityTeam",
    // esg
    environmental: "esgEnvironmental",
    governance: "esgGovernance",
  };
  const col = legacyMap[kpiId];
  if (!col) return 0;
  const value = data[col];
  return typeof value === "number" && Number.isFinite(value) ? clamp05(value) : 0;
}

function clamp05(v: number) {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(5, v));
}

function readLegacyColumn(data: ScoreSource, col: keyof ScoreSource) {
  const value = data[col];
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? clamp05(value)
    : null;
}

function averageLegacyColumns(data: ScoreSource, cols: (keyof ScoreSource)[]) {
  const values = cols
    .map((col) => readLegacyColumn(data, col))
    .filter((value): value is number => value !== null);
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function normalizeKpiScoreForAggregation(score: number, kpi: ScoringKpi) {
  const raw = clamp05(score);
  if (kpi.direction === "lower_better") {
    return raw === 0 ? 0 : clamp05(6 - raw);
  }
  return raw;
}

function weightedAvg(
  kpis: ScoringKpi[],
  getScore: (kpi: ScoringKpi) => number
) {
  if (kpis.length === 0) return 0;
  const denom = kpis.reduce((s, k) => s + Math.max(0, k.weight ?? 1), 0);
  if (denom <= 0) return 0;
  const num = kpis.reduce(
    (s, k) => s + getScore(k) * Math.max(0, k.weight ?? 1),
    0
  );
  return num / denom;
}

/**
 * Calcola impatto/fattibilità/ESG complessivi + categoria di matrice usando
 * il modello KPI custom e il flag ESG del workspace.
 *
 * ESG entra nel ranking **solo se** `esgEnabled === true`.
 */
export function deriveUseCasePortfolioMetrics(
  data: ScoreSource,
  opts?: {
    model?: UseCaseScoringModel | null;
    esgEnabled?: boolean;
  }
): DerivedUseCaseScores {
  const config = opts?.model?.config;
  const impactKpis = config?.dimensions.impact ?? [];
  const feasibilityKpis = config?.dimensions.feasibility ?? [];
  const esgKpis = config?.dimensions.esg ?? [];

  const overallImpact = weightedAvg(impactKpis, (kpi) =>
    normalizeKpiScoreForAggregation(
      readUseCaseRawKpiScore(data, "impact", kpi.id),
      kpi
    )
  );
  const overallFeasibility = weightedAvg(feasibilityKpis, (kpi) =>
    normalizeKpiScoreForAggregation(
      readUseCaseRawKpiScore(data, "feasibility", kpi.id),
      kpi
    )
  );

  const esgEnabled = opts?.esgEnabled === true;
  const overallEsg = esgEnabled
    ? weightedAvg(esgKpis, (kpi) =>
        normalizeKpiScoreForAggregation(
          readUseCaseRawKpiScore(data, "esg", kpi.id),
          kpi
        )
      )
    : null;

  const ow = config?.overall ?? { impact: 0.5, feasibility: 0.5, esg: 0.2 };
  const wImpactRaw = Math.max(0, ow.impact);
  const wFeasibilityRaw = Math.max(0, ow.feasibility);
  const wEsgRaw = esgEnabled && overallEsg !== null ? Math.max(0, ow.esg ?? 0) : 0;
  const sum = wImpactRaw + wFeasibilityRaw + wEsgRaw;
  const wi = sum > 0 ? wImpactRaw / sum : 0.5;
  const wf = sum > 0 ? wFeasibilityRaw / sum : 0.5;
  const we = sum > 0 ? wEsgRaw / sum : 0;

  const overallScore =
    overallImpact * wi + overallFeasibility * wf + (overallEsg ?? 0) * we;

  const hi = config?.thresholds.highImpact ?? 3.5;
  const hf = config?.thresholds.highFeasibility ?? 3.5;
  const mi = config?.thresholds.midImpact ?? 2.5;
  let category: UseCaseCategory;
  if (overallImpact >= hi && overallFeasibility >= hf) category = "quick_win";
  else if (overallImpact >= hi && overallFeasibility < hf) category = "strategic_bet";
  else if (overallImpact >= mi) category = "capability_builder";
  else category = "not_yet";

  return {
    overallEsgScore: overallEsg,
    overallImpactScore: overallImpact,
    overallFeasibilityScore: overallFeasibility,
    overallScore,
    category,
  };
}
