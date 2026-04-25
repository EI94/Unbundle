import { addMonths, endOfMonth, format } from "date-fns";
import type { UseCase } from "@/lib/db/schema";
import type { ScoringModelConfig } from "@/lib/db/queries/scoring-model";
import { readUseCaseRawKpiScore } from "@/lib/db/use-case-scoring";

export type SustainabilityBand = "green" | "yellow" | "red" | "neutral";

export type PortfolioWaveItem = {
  useCase: UseCase;
  efficiencyScore: number;
  profitabilityScore: number;
  effortScore: number;
  sustainabilityScore: number | null;
  sustainabilityBand: SustainabilityBand;
  estimatedCost: number;
  estimatedValue: number;
  estimatedNetValue: number;
  priorityScore: number;
};

export type PortfolioWave = {
  id: string;
  index: number;
  label: string;
  startDate: Date;
  endDate: Date;
  startLabel: string;
  endLabel: string;
  budget: number;
  budgetUsed: number;
  remainingBudget: number;
  totalEstimatedValue: number;
  totalEstimatedNetValue: number;
  avgSustainabilityScore: number | null;
  items: PortfolioWaveItem[];
  isOverBudget: boolean;
};

function firstKpiId(
  config: ScoringModelConfig,
  dimension: "impact" | "feasibility" | "esg",
  preferredIds: string[]
) {
  const ids = config.dimensions[dimension].map((kpi) => kpi.id);
  return preferredIds.find((id) => ids.includes(id)) ?? ids[0] ?? null;
}

function readPreferredScore(
  useCase: UseCase,
  config: ScoringModelConfig,
  dimension: "impact" | "feasibility" | "esg",
  preferredIds: string[]
) {
  const kpiId = firstKpiId(config, dimension, preferredIds);
  if (!kpiId) return 0;
  return readUseCaseRawKpiScore(useCase, dimension, kpiId);
}

export function getSustainabilityBand(score: number | null | undefined): SustainabilityBand {
  if (typeof score !== "number" || !Number.isFinite(score) || score <= 0) {
    return "neutral";
  }
  if (score >= 3.7) return "green";
  if (score >= 2.6) return "yellow";
  return "red";
}

export function estimateImplementationCost(effortScore: number) {
  if (effortScore >= 4.5) return 250_000;
  if (effortScore >= 3.5) return 130_000;
  if (effortScore >= 2.5) return 65_000;
  if (effortScore >= 1.5) return 25_000;
  return 10_000;
}

function estimateEfficiencyValue(efficiencyScore: number) {
  if (efficiencyScore >= 4.5) return 300_000;
  if (efficiencyScore >= 3.5) return 120_000;
  if (efficiencyScore >= 2.5) return 45_000;
  if (efficiencyScore >= 1.5) return 15_000;
  return 5_000;
}

function estimateProfitabilityValue(profitabilityScore: number) {
  if (profitabilityScore >= 4.5) return 700_000;
  if (profitabilityScore >= 3.5) return 300_000;
  if (profitabilityScore >= 2.5) return 120_000;
  if (profitabilityScore >= 1.5) return 40_000;
  return 10_000;
}

export function buildWaveCandidate(
  useCase: UseCase,
  config: ScoringModelConfig,
  esgEnabled: boolean
): PortfolioWaveItem {
  const efficiencyScore = readPreferredScore(useCase, config, "impact", [
    "efficiency",
    "time",
    "economic",
  ]);
  const profitabilityScore = readPreferredScore(useCase, config, "impact", [
    "profitability",
    "economic",
    "quality",
  ]);
  const effortScore = readPreferredScore(useCase, config, "feasibility", [
    "effort",
    "workflow",
    "tech",
  ]);
  const environmentalScore = esgEnabled
    ? readPreferredScore(useCase, config, "esg", ["environmental"])
    : 0;
  const socialScore = esgEnabled
    ? readPreferredScore(useCase, config, "esg", ["social"])
    : 0;
  const sustainabilityScore = esgEnabled
    ? (environmentalScore + socialScore) / 2
    : null;
  const estimatedCost = estimateImplementationCost(effortScore || 1);
  const estimatedValue =
    estimateEfficiencyValue(efficiencyScore || 1) +
    estimateProfitabilityValue(profitabilityScore || 1);
  const estimatedNetValue = estimatedValue - estimatedCost;
  const priorityScore =
    (useCase.overallScore ?? 0) * 10 +
    profitabilityScore * 2 +
    efficiencyScore * 1.5 +
    (sustainabilityScore ?? 0);

  return {
    useCase,
    efficiencyScore,
    profitabilityScore,
    effortScore,
    sustainabilityScore,
    sustainabilityBand: getSustainabilityBand(sustainabilityScore),
    estimatedCost,
    estimatedValue,
    estimatedNetValue,
    priorityScore,
  };
}

export function buildPortfolioWavePlan(params: {
  items: UseCase[];
  config: ScoringModelConfig;
  esgEnabled: boolean;
  waveBudget: number;
  waveDurationMonths: number;
  startDate?: Date;
}) {
  const startDate = params.startDate ?? new Date();
  const eligible = params.items
    .filter(
      (item) =>
        !!item.portfolioKind &&
        item.portfolioReviewStatus !== "archived" &&
        typeof item.overallScore === "number" &&
        item.overallScore > 0
    )
    .map((item) => buildWaveCandidate(item, params.config, params.esgEnabled))
    .sort((a, b) => {
      if (b.priorityScore !== a.priorityScore) {
        return b.priorityScore - a.priorityScore;
      }
      if (b.estimatedNetValue !== a.estimatedNetValue) {
        return b.estimatedNetValue - a.estimatedNetValue;
      }
      return a.estimatedCost - b.estimatedCost;
    });

  const waves: PortfolioWave[] = [];

  for (const candidate of eligible) {
    let targetWave =
      waves.find((wave) => wave.budgetUsed + candidate.estimatedCost <= wave.budget) ??
      null;

    if (!targetWave) {
      const index = waves.length;
      const waveStart = addMonths(startDate, index * params.waveDurationMonths);
      const waveEnd = endOfMonth(addMonths(waveStart, params.waveDurationMonths - 1));
      targetWave = {
        id: `wave-${index + 1}`,
        index,
        label: `Wave ${index + 1}`,
        startDate: waveStart,
        endDate: waveEnd,
        startLabel: format(waveStart, "MMM yyyy"),
        endLabel: format(waveEnd, "MMM yyyy"),
        budget: params.waveBudget,
        budgetUsed: 0,
        remainingBudget: params.waveBudget,
        totalEstimatedValue: 0,
        totalEstimatedNetValue: 0,
        avgSustainabilityScore: null,
        items: [],
        isOverBudget: false,
      };
      waves.push(targetWave);
    }

    targetWave.items.push(candidate);
    targetWave.budgetUsed += candidate.estimatedCost;
    targetWave.remainingBudget = targetWave.budget - targetWave.budgetUsed;
    targetWave.totalEstimatedValue += candidate.estimatedValue;
    targetWave.totalEstimatedNetValue += candidate.estimatedNetValue;
    targetWave.isOverBudget = targetWave.remainingBudget < 0;
    const sustainabilityValues = targetWave.items
      .map((item) => item.sustainabilityScore)
      .filter((value): value is number => typeof value === "number");
    targetWave.avgSustainabilityScore =
      sustainabilityValues.length > 0
        ? sustainabilityValues.reduce((sum, value) => sum + value, 0) /
          sustainabilityValues.length
        : null;
  }

  return {
    waves,
    totals: {
      items: eligible.length,
      budget: waves.reduce((sum, wave) => sum + wave.budget, 0),
      budgetUsed: waves.reduce((sum, wave) => sum + wave.budgetUsed, 0),
      estimatedValue: waves.reduce((sum, wave) => sum + wave.totalEstimatedValue, 0),
      estimatedNetValue: waves.reduce(
        (sum, wave) => sum + wave.totalEstimatedNetValue,
        0
      ),
    },
  };
}
