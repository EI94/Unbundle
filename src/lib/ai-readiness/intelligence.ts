import type {
  AiReadinessBenchmarkComparison,
  AiReadinessDashboard,
  AiReadinessInsightType,
  AiReadinessRoadmapWave,
  AiReadinessTemplateDefinition,
  AiReadinessUseCaseCluster,
} from "./types";

export const AI_READINESS_INTELLIGENCE_PROMPT_VERSION =
  "ai-readiness-intelligence-v1";
export const AI_READINESS_INTELLIGENCE_MODEL =
  "unbundle-readiness-intelligence-rules-v1";

const REFERENCE_BENCHMARK = {
  name: "Unbundle AI Readiness reference v1",
  overall: 3.2,
  pillars: {
    technology: 3.1,
    context: 3.0,
    workflow: 3.2,
    adoption: 3.1,
    use_cases: 3.3,
  } as Record<string, number>,
};

export type AiReadinessIntelligenceUseCase = {
  id: string;
  title: string;
  currentProcess: string | null;
  painPoint: string | null;
  desiredOutcome: string | null;
  frequency: string | null;
  estimatedBeneficiaries: number | null;
  dataNeeded: string | null;
  humanInLoop: string | null;
  riskLevel: string | null;
  impactEstimate: string | null;
  feasibilityScore: number | null;
  strategicValueScore: number | null;
  linkedUseCaseId?: string | null;
};

export type GeneratedAiReadinessInsight = {
  scopeType: string;
  scopeKey: string;
  insightType: AiReadinessInsightType;
  title: string;
  body: string;
  evidence: Record<string, unknown>;
  aiGenerated: boolean;
  humanValidated: boolean;
  validationStatus: "draft";
  model: string;
  promptVersion: string;
  inputScope: Record<string, unknown>;
};

type IntelligenceInput = {
  assessmentId: string;
  workspaceId: string;
  template: AiReadinessTemplateDefinition;
  dashboard: AiReadinessDashboard;
  useCases: AiReadinessIntelligenceUseCase[];
  privacyConfig: Record<string, unknown> | null;
  aggregationThreshold: number;
  benchmarkConsentCount: number;
};

function round(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function scoreText(value: number | null | undefined) {
  const score = round(value);
  return score == null ? "N/D" : score.toFixed(2);
}

function safeLower(...values: Array<string | null | undefined>) {
  return values.filter(Boolean).join(" ").toLowerCase();
}

function getPillarTitle(template: AiReadinessTemplateDefinition, id: string | null) {
  if (!id) return "N/D";
  return template.pillars.find((pillar) => pillar.id === id)?.title ?? id;
}

function getWeakestPillars(
  dashboard: AiReadinessDashboard,
  template: AiReadinessTemplateDefinition
) {
  return template.pillars
    .map((pillar) => ({
      id: pillar.id,
      title: pillar.title,
      score: dashboard.pillarScores[pillar.id] ?? null,
    }))
    .filter((item) => typeof item.score === "number")
    .map((item) => ({ ...item, score: item.score as number }))
    .sort((a, b) => a.score - b.score)
    .slice(0, 2);
}

function clusterForUseCase(item: AiReadinessIntelligenceUseCase) {
  const text = safeLower(
    item.title,
    item.currentProcess,
    item.painPoint,
    item.desiredOutcome,
    item.dataNeeded
  );
  const rules = [
    {
      id: "commercial",
      label: "Commerciale e clienti",
      description: "Proposte, vendite, customer operations e personalizzazione cliente.",
      keywords: ["cliente", "clienti", "sales", "vend", "proposal", "proposta", "offerta", "marketing", "crm"],
    },
    {
      id: "operations",
      label: "Operations e delivery",
      description: "Processi operativi, handoff, pianificazione, delivery e project tracking.",
      keywords: ["process", "tracking", "project", "delivery", "operat", "flusso", "pianific", "task", "ticket"],
    },
    {
      id: "reporting",
      label: "Reporting e knowledge work",
      description: "Report, sintesi, documenti, analisi e contenuti ricorrenti.",
      keywords: ["report", "document", "word", "slide", "present", "analisi", "knowledge", "contenut", "ricerca"],
    },
    {
      id: "risk_compliance",
      label: "Risk, compliance e controllo",
      description: "Controlli, policy, privacy, sicurezza, qualita e compliance.",
      keywords: ["risk", "compliance", "privacy", "sicurezza", "controll", "qualita", "policy", "legal"],
    },
    {
      id: "people",
      label: "People e adoption",
      description: "HR, formazione, onboarding, change management e collaborazione.",
      keywords: ["hr", "people", "formazione", "training", "onboarding", "adoption", "collabor", "dipendent"],
    },
  ];
  return (
    rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword))) ??
    {
      id: "productivity",
      label: "Produttivita generale",
      description: "Automazioni trasversali e miglioramento del lavoro quotidiano.",
      keywords: [],
    }
  );
}

function estimateFeasibility(item: AiReadinessIntelligenceUseCase) {
  if (typeof item.feasibilityScore === "number") return item.feasibilityScore;
  const risk = item.riskLevel?.toLowerCase() ?? "";
  if (risk.includes("alto") || risk.includes("high")) return 2.4;
  if (risk.includes("medio") || risk.includes("medium")) return 3.2;
  if (risk.includes("basso") || risk.includes("low")) return 4.1;
  return 3.2;
}

function estimateStrategicValue(item: AiReadinessIntelligenceUseCase) {
  if (typeof item.strategicValueScore === "number") return item.strategicValueScore;
  const beneficiaries = item.estimatedBeneficiaries ?? 0;
  if (beneficiaries >= 200) return 4.6;
  if (beneficiaries >= 50) return 4;
  if (beneficiaries >= 10) return 3.3;
  if (beneficiaries > 0) return 2.7;
  return 3;
}

function average(values: number[]) {
  if (values.length === 0) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export function buildUseCaseClusters(
  useCases: AiReadinessIntelligenceUseCase[]
): AiReadinessUseCaseCluster[] {
  const byCluster = new Map<
    string,
    {
      id: string;
      label: string;
      description: string;
      items: AiReadinessIntelligenceUseCase[];
    }
  >();
  for (const item of useCases) {
    const rule = clusterForUseCase(item);
    const existing =
      byCluster.get(rule.id) ??
      { id: rule.id, label: rule.label, description: rule.description, items: [] };
    existing.items.push(item);
    byCluster.set(rule.id, existing);
  }
  return [...byCluster.values()]
    .map((cluster) => {
      const feasibility = average(cluster.items.map(estimateFeasibility));
      const strategic = average(cluster.items.map(estimateStrategicValue));
      const recommendedPath =
        (feasibility ?? 0) >= 4
          ? "quick_win"
          : (strategic ?? 0) >= 4
            ? "strategic_bet"
            : "capability_builder";
      return {
        id: cluster.id,
        label: cluster.label,
        description: cluster.description,
        count: cluster.items.length,
        titles: cluster.items.slice(0, 5).map((item) => item.title),
        averageFeasibility: feasibility,
        averageStrategicValue: strategic,
        recommendedPath,
      } satisfies AiReadinessUseCaseCluster;
    })
    .sort((a, b) => b.count - a.count || (b.averageStrategicValue ?? 0) - (a.averageStrategicValue ?? 0));
}

function bottleneckAction(pillarId: string | null) {
  const actions: Record<string, string> = {
    technology:
      "Rendere esplicito il target stack AI: dati accessibili, security review e ambiente sicuro per sperimentare.",
    context:
      "Creare una libreria di contesto riusabile: processi, policy, knowledge base e ownership dei dati critici.",
    workflow:
      "Ridisegnare 2-3 workflow pilota con handoff, controllo umano e criteri di accettazione misurabili.",
    adoption:
      "Avviare enablement guidato per champion di funzione, con rituali settimanali e raccolta delle frizioni.",
    use_cases:
      "Normalizzare intake, scoring e review del portfolio use case per evitare iniziative isolate.",
  };
  return actions[pillarId ?? ""] ?? "Completare il campione dati e definire il primo backlog operativo.";
}

export function buildAiReadinessRoadmap(params: {
  dashboard: AiReadinessDashboard;
  template: AiReadinessTemplateDefinition;
  clusters: AiReadinessUseCaseCluster[];
}): AiReadinessRoadmapWave[] {
  const bottleneckTitle = getPillarTitle(params.template, params.dashboard.bottleneckPillar);
  const quickClusters = params.clusters.filter((cluster) => cluster.recommendedPath === "quick_win");
  const strategicClusters = params.clusters.filter((cluster) => cluster.recommendedPath !== "quick_win");

  return [
    {
      id: "wave-1-foundation",
      title: "Wave 1 - Stabilizzare la readiness",
      horizon: "0-90 giorni",
      focus: `Sbloccare il pillar piu debole: ${bottleneckTitle}.`,
      actions: [
        bottleneckAction(params.dashboard.bottleneckPillar),
        "Definire owner, guardrail privacy e criteri minimi per approvare sperimentazioni AI.",
        "Ricalcolare la dashboard ogni 2 settimane fino a superare la soglia dati.",
      ],
      successMetric: "Readiness index +0.3 e soglia aggregazione rispettata.",
      linkedClusterIds: [],
    },
    {
      id: "wave-2-quick-wins",
      title: "Wave 2 - Quick win misurabili",
      horizon: "3-6 mesi",
      focus:
        quickClusters.length > 0
          ? `Portare in produzione ${quickClusters.slice(0, 2).map((cluster) => cluster.label).join(" e ")}.`
          : "Selezionare 2 use case ad alta fattibilita dal portfolio.",
      actions: [
        "Trasformare i migliori use case in backlog con owner, effort, rischi e metriche di outcome.",
        "Connettere i use case selezionati al Portfolio Unbundle per review e wave planning.",
        "Misurare adoption reale: utenti attivi, tempo risparmiato dichiarato, qualita output e incidenti.",
      ],
      successMetric: "2 use case validati, almeno 1 live pilot e metriche di impatto tracciate.",
      linkedClusterIds: quickClusters.slice(0, 3).map((cluster) => cluster.id),
    },
    {
      id: "wave-3-scale",
      title: "Wave 3 - Scalare capability",
      horizon: "6-12 mesi",
      focus:
        strategicClusters.length > 0
          ? `Scalare capability su ${strategicClusters.slice(0, 2).map((cluster) => cluster.label).join(" e ")}.`
          : "Trasformare i pattern validati in capability riusabili.",
      actions: [
        "Creare playbook replicabili: prompt, policy, dati, ruoli, controlli e change plan.",
        "Collegare Discovery, Mapping e Portfolio per dare priorita ai flussi con maggiore leva strategica.",
        "Portare gli insight approvati nel piano di AI Transformation e nel report executive.",
      ],
      successMetric: "Roadmap approvata dal team, portfolio prioritizzato e governance operativa ricorrente.",
      linkedClusterIds: strategicClusters.slice(0, 3).map((cluster) => cluster.id),
    },
  ];
}

export function buildBenchmarkComparison(params: {
  dashboard: AiReadinessDashboard;
  privacyConfig: Record<string, unknown> | null;
  benchmarkConsentCount: number;
  aggregationThreshold: number;
}): AiReadinessBenchmarkComparison {
  if (params.privacyConfig?.allowBenchmarking !== true) {
    return {
      enabled: false,
      reason: "Benchmark disabilitato nella configurazione privacy dell'assessment.",
      referenceName: REFERENCE_BENCHMARK.name,
      overallDelta: null,
      pillarDeltas: {},
    };
  }
  if (!params.dashboard.aggregationThresholdMet) {
    return {
      enabled: false,
      reason: "Servono piu risposte aggregate prima di mostrare un benchmark.",
      referenceName: REFERENCE_BENCHMARK.name,
      overallDelta: null,
      pillarDeltas: {},
    };
  }
  if (params.benchmarkConsentCount < params.aggregationThreshold) {
    return {
      enabled: false,
      reason: "Consenso benchmark insufficiente rispetto alla soglia configurata.",
      referenceName: REFERENCE_BENCHMARK.name,
      overallDelta: null,
      pillarDeltas: {},
    };
  }
  const pillarDeltas: Record<string, number | null> = {};
  for (const [pillarId, reference] of Object.entries(REFERENCE_BENCHMARK.pillars)) {
    const score = params.dashboard.pillarScores[pillarId];
    pillarDeltas[pillarId] =
      typeof score === "number" ? round(score - reference) : null;
  }
  return {
    enabled: true,
    referenceName: REFERENCE_BENCHMARK.name,
    overallDelta:
      typeof params.dashboard.overallScore === "number"
        ? round(params.dashboard.overallScore - REFERENCE_BENCHMARK.overall)
        : null,
    pillarDeltas,
  };
}

export function generateAiReadinessIntelligence(
  input: IntelligenceInput
): GeneratedAiReadinessInsight[] {
  const generatedAt = new Date().toISOString();
  const clusters = buildUseCaseClusters(input.useCases);
  const roadmap = buildAiReadinessRoadmap({
    dashboard: input.dashboard,
    template: input.template,
    clusters,
  });
  const benchmark = buildBenchmarkComparison({
    dashboard: input.dashboard,
    privacyConfig: input.privacyConfig,
    benchmarkConsentCount: input.benchmarkConsentCount,
    aggregationThreshold: input.aggregationThreshold,
  });
  const weakest = getWeakestPillars(input.dashboard, input.template);
  const bottleneckTitle = getPillarTitle(input.template, input.dashboard.bottleneckPillar);
  const inputScope = {
    assessmentId: input.assessmentId,
    workspaceId: input.workspaceId,
    scopeType: "company",
    aggregationThreshold: input.aggregationThreshold,
    responseCount: input.dashboard.responseCount,
    useCaseCount: input.useCases.length,
    generatedAt,
    privacyMode: "aggregated_only",
  };

  const insightBase = (
    insightType: AiReadinessInsightType,
    title: string,
    body: string,
    evidence: Record<string, unknown>
  ): GeneratedAiReadinessInsight => ({
    scopeType: "company",
    scopeKey: "company",
    insightType,
    title,
    body,
    evidence: {
      ...evidence,
      generatedAt,
      privacyGuardrail:
        "No individual respondent answer, email, name, or pseudonymous identifier is included.",
    },
    aiGenerated: true,
    humanValidated: false,
    validationStatus: "draft",
    model: AI_READINESS_INTELLIGENCE_MODEL,
    promptVersion: AI_READINESS_INTELLIGENCE_PROMPT_VERSION,
    inputScope,
  });

  if (!input.dashboard.aggregationThresholdMet) {
    return [
      insightBase(
        "risk",
        "Servono piu risposte prima degli insight completi",
        `Il campione attuale e ${input.dashboard.responseCount}/${input.aggregationThreshold}. Unbundle mantiene visibili solo segnali aggregati affidabili: invita altri respondent prima di usare benchmark, heatmap o diagnosi per area.`,
        {
          status: "needs_data",
          responseCount: input.dashboard.responseCount,
          aggregationThreshold: input.aggregationThreshold,
        }
      ),
    ];
  }

  return [
    insightBase(
      "executive_summary",
      "Sintesi readiness AI",
      `Readiness index ${scoreText(input.dashboard.overallScore)}. Il principale vincolo e ${bottleneckTitle}; la priorita e trasformare il portfolio use case in wave operative senza perdere governance, privacy e controllo umano.`,
      {
        overallScore: input.dashboard.overallScore,
        maturitySignal: scoreText(input.dashboard.overallScore),
        bottleneckPillar: input.dashboard.bottleneckPillar,
        responseCount: input.dashboard.responseCount,
        pillarScores: input.dashboard.pillarScores,
      }
    ),
    insightBase(
      "bottleneck",
      `Bottleneck: ${bottleneckTitle}`,
      `${bottleneckTitle} e il fattore da trattare per primo. Se non viene sbloccato, anche i use case ad alto potenziale rischiano di restare proof of concept isolate.`,
      {
        weakestPillars: weakest,
        recommendedAction: bottleneckAction(input.dashboard.bottleneckPillar),
      }
    ),
    insightBase(
      "use_case",
      "Cluster use case emersi",
      clusters.length > 0
        ? `Sono emersi ${clusters.length} cluster di opportunita. Il cluster piu ricorrente e ${clusters[0]?.label}, con ${clusters[0]?.count ?? 0} proposte.`
        : "Non sono ancora emersi use case dal survey. Il prossimo passo e attivare intake guidato da survey, Slack o Portfolio.",
      {
        clusters,
        unlinkedUseCaseCount: input.useCases.filter((item) => !item.linkedUseCaseId).length,
      }
    ),
    insightBase(
      "roadmap",
      "Roadmap AI Transformation suggerita",
      "La roadmap proposta parte da readiness e governance, passa da quick win misurabili e arriva a capability scalabili collegate al portfolio.",
      { waves: roadmap }
    ),
    insightBase(
      "adoption",
      "Adoption: passare da interesse a rituali",
      "La readiness cresce quando i team vedono casi concreti, metriche chiare e un percorso di supporto. Usa champion di funzione e review cadenzate per evitare iniziative scollegate.",
      {
        teamCount: input.dashboard.units.length,
        unitsAboveThreshold: input.dashboard.units.filter((unit) => unit.aggregationThresholdMet).length,
        suggestedCadence: "weekly portfolio review + bi-weekly readiness recalibration",
      }
    ),
    insightBase(
      "benchmark",
      benchmark.enabled ? "Benchmark disponibile" : "Benchmark non ancora disponibile",
      benchmark.enabled
        ? `Il confronto con ${benchmark.referenceName} e attivo. Delta overall: ${scoreText(benchmark.overallDelta)}.`
        : benchmark.reason ?? "Benchmark non disponibile.",
      { benchmark }
    ),
  ];
}
