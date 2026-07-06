import test from "node:test";
import assert from "node:assert/strict";
import { AI_READINESS_SYSTEM_TEMPLATE } from "./default-template.ts";
import {
  buildBenchmarkComparison,
  buildUseCaseClusters,
  generateAiReadinessIntelligence,
} from "./intelligence.ts";
import type { AiReadinessDashboard } from "./types.ts";

const dashboard: AiReadinessDashboard = {
  responseCount: 8,
  invitedCount: 10,
  startedCount: 8,
  completedCount: 8,
  overallScore: 3.1,
  bottleneckPillar: "context",
  confidence: 0.9,
  aggregationThresholdMet: true,
  pillarScores: {
    technology: 3.4,
    context: 2.5,
    workflow: 3.2,
    adoption: 3,
    use_cases: 3.5,
  },
  sectionScores: {},
  units: [
    {
      unit: "Operations",
      respondentCount: 5,
      aggregationThresholdMet: true,
      overallScore: 3.2,
      bottleneckPillar: "context",
      pillarScores: { context: 2.4 },
    },
  ],
};

const useCases = [
  {
    id: "uc-1",
    title: "Automated project tracking",
    currentProcess: "Project manager aggiornano task e stato a mano.",
    painPoint: "Troppi handoff e reporting manuale.",
    desiredOutcome: "Dashboard di avanzamento aggiornata automaticamente.",
    frequency: "settimanale",
    estimatedBeneficiaries: 60,
    dataNeeded: "Task e stato progetti",
    humanInLoop: "Responsabile progetto valida",
    riskLevel: "medio",
    impactEstimate: "meno tempo su report",
    feasibilityScore: null,
    strategicValueScore: null,
  },
  {
    id: "uc-2",
    title: "Proposal generation per clienti",
    currentProcess: "Proposte commerciali standardizzate.",
    painPoint: "Poca personalizzazione.",
    desiredOutcome: "Prime bozze tailor made.",
    frequency: "giornaliera",
    estimatedBeneficiaries: 20,
    dataNeeded: "CRM e materiali cliente",
    humanInLoop: "Sales owner approva",
    riskLevel: "basso",
    impactEstimate: "migliore qualita proposta",
    feasibilityScore: null,
    strategicValueScore: null,
  },
];

test("intelligence returns only needs-data insight below privacy threshold", () => {
  const insights = generateAiReadinessIntelligence({
    assessmentId: "assessment",
    workspaceId: "workspace",
    template: AI_READINESS_SYSTEM_TEMPLATE,
    dashboard: { ...dashboard, responseCount: 2, aggregationThresholdMet: false },
    useCases,
    privacyConfig: { allowBenchmarking: true },
    aggregationThreshold: 5,
    benchmarkConsentCount: 2,
  });

  assert.equal(insights.length, 1);
  assert.equal(insights[0]?.insightType, "risk");
  assert.equal(insights[0]?.evidence.status, "needs_data");
  assert.equal(JSON.stringify(insights).includes("persona@azienda.com"), false);
});

test("use case clustering is deterministic and does not invent financial impact", () => {
  const clusters = buildUseCaseClusters(useCases);

  assert.equal(clusters.length, 2);
  assert.equal(clusters.some((cluster) => cluster.id === "operations"), true);
  assert.equal(clusters.some((cluster) => cluster.id === "commercial"), true);
  assert.equal(JSON.stringify(clusters).includes("EUR"), false);
});

test("benchmark is privacy gated and enabled only with consent and threshold", () => {
  const disabled = buildBenchmarkComparison({
    dashboard,
    privacyConfig: { allowBenchmarking: false },
    benchmarkConsentCount: 8,
    aggregationThreshold: 5,
  });
  assert.equal(disabled.enabled, false);

  const enabled = buildBenchmarkComparison({
    dashboard,
    privacyConfig: { allowBenchmarking: true },
    benchmarkConsentCount: 8,
    aggregationThreshold: 5,
  });
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.overallDelta, -0.1);
  assert.equal(enabled.pillarDeltas.context, -0.5);
});

test("full intelligence includes roadmap, clusters, and human review metadata", () => {
  const insights = generateAiReadinessIntelligence({
    assessmentId: "assessment",
    workspaceId: "workspace",
    template: AI_READINESS_SYSTEM_TEMPLATE,
    dashboard,
    useCases,
    privacyConfig: { allowBenchmarking: true },
    aggregationThreshold: 5,
    benchmarkConsentCount: 8,
  });
  const roadmap = insights.find((insight) => insight.insightType === "roadmap");
  const useCaseInsight = insights.find((insight) => insight.insightType === "use_case");

  assert.ok(roadmap);
  assert.equal(Array.isArray(roadmap.evidence.waves), true);
  assert.equal((roadmap.evidence.waves as unknown[]).length, 3);
  assert.ok(useCaseInsight);
  assert.equal(useCaseInsight.validationStatus, "draft");
  assert.equal(useCaseInsight.humanValidated, false);
  assert.equal(useCaseInsight.promptVersion, "ai-readiness-intelligence-v1");
});
