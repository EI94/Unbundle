import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveUseCasePortfolioMetrics,
  normalizeKpiScoreForAggregation,
} from "./use-case-scoring.ts";
import type { ScoringModelConfig } from "./queries/scoring-model.ts";

const config: ScoringModelConfig = {
  dimensions: {
    impact: [
      { id: "efficiency", label: "Efficienza", weight: 3, direction: "higher_better" },
      { id: "profitability", label: "Profittabilita", weight: 1, direction: "higher_better" },
    ],
    feasibility: [
      { id: "effort", label: "Effort", weight: 1, direction: "lower_better" },
    ],
    esg: [
      { id: "environmental", label: "Ambientale", weight: 1, direction: "higher_better" },
      { id: "social", label: "Sociale", weight: 1, direction: "higher_better" },
    ],
  },
  overall: { impact: 0.5, feasibility: 0.3, esg: 0.2 },
  thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
};

test("normalizza i KPI lower_better mantenendo la scala grezza per input e AI", () => {
  assert.equal(
    normalizeKpiScoreForAggregation(1, {
      id: "effort",
      label: "Effort",
      weight: 1,
      direction: "lower_better",
    }),
    5
  );
  assert.equal(
    normalizeKpiScoreForAggregation(5, {
      id: "effort",
      label: "Effort",
      weight: 1,
      direction: "lower_better",
    }),
    1
  );
});

test("applica i pesi KPI, poi rinormalizza i pesi globali quando ESG e disattivato", () => {
  const metrics = deriveUseCasePortfolioMetrics(
    {
      customScores: {
        impact: { efficiency: 5, profitability: 1 },
        feasibility: { effort: 1 },
        esg: { environmental: 5, social: 5 },
      },
    },
    {
      model: { impactFlagEnabled: false, config },
      esgEnabled: false,
    }
  );

  assert.equal(metrics.overallImpactScore, 4);
  assert.equal(metrics.overallFeasibilityScore, 5);
  assert.equal(metrics.overallEsgScore, null);
  assert.equal(Number(metrics.overallScore.toFixed(3)), 4.375);
  assert.equal(metrics.category, "quick_win");
});

test("non ricostruisce la profitability da colonne legacy quando manca il valore manuale", () => {
  const metrics = deriveUseCasePortfolioMetrics(
    {
      impactEconomic: 5,
      impactTime: 5,
      impactQuality: 5,
      customScores: {
        impact: { efficiency: 5 },
        feasibility: { effort: 1 },
      },
    },
    {
      model: { impactFlagEnabled: false, config },
      esgEnabled: false,
    }
  );

  assert.equal(metrics.overallImpactScore, 3.75);
  assert.equal(metrics.overallFeasibilityScore, 5);
});

test("usa la profitability solo quando il reviewer la compila manualmente", () => {
  const metrics = deriveUseCasePortfolioMetrics(
    {
      customScores: {
        impact: { efficiency: 5, profitability: 4 },
        feasibility: { effort: 1 },
      },
    },
    {
      model: { impactFlagEnabled: false, config },
      esgEnabled: false,
    }
  );

  assert.equal(metrics.overallImpactScore, 4.75);
  assert.equal(metrics.overallFeasibilityScore, 5);
});

test("include ESG nel ranking e usa le soglie custom per la categoria", () => {
  const metrics = deriveUseCasePortfolioMetrics(
    {
      customScores: {
        impact: { efficiency: 3, profitability: 3 },
        feasibility: { effort: 4 },
        esg: { environmental: 5, social: 3 },
      },
    },
    {
      model: {
        impactFlagEnabled: false,
        config: {
          ...config,
          thresholds: { highImpact: 4.5, highFeasibility: 4.5, midImpact: 3 },
        },
      },
      esgEnabled: true,
    }
  );

  assert.equal(metrics.overallImpactScore, 3);
  assert.equal(metrics.overallFeasibilityScore, 2);
  assert.equal(metrics.overallEsgScore, 4);
  assert.equal(Number(metrics.overallScore.toFixed(1)), 2.9);
  assert.equal(metrics.category, "capability_builder");
});
