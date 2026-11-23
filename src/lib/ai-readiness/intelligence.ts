import { readinessPillarText } from "../programma/text.ts";
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

/** (Rilascio 10, ondata 7b) Un punteggio come lo scrive la dashboard: una cifra decimale, con la virgola. */
function scoreText(value: number | null | undefined) {
  const score = round(value);
  return score == null ? "non ancora calcolato" : score.toFixed(1).replace(".", ",");
}

function safeLower(...values: Array<string | null | undefined>) {
  return values.filter(Boolean).join(" ").toLowerCase();
}

/** (Ondata 7b) Il nome dell'area in italiano («Contesto»), mai il titolo inglese salvato nel modello. */
function getPillarTitle(template: AiReadinessTemplateDefinition, id: string | null) {
  void template;
  return id ? readinessPillarText(id) : "da capire";
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
      description: "Proposte, vendite, assistenza e servizi su misura per i clienti.",
      keywords: ["cliente", "clienti", "sales", "vend", "proposal", "proposta", "offerta", "marketing", "crm"],
    },
    {
      id: "operations",
      label: "Attività operative e consegne",
      description: "Processi operativi, passaggi di mano, pianificazione, consegne e avanzamento dei progetti.",
      keywords: ["process", "tracking", "project", "delivery", "operat", "flusso", "pianific", "task", "ticket"],
    },
    {
      id: "reporting",
      label: "Report e documenti",
      description: "Report, sintesi, documenti, analisi e contenuti ricorrenti.",
      keywords: ["report", "document", "word", "slide", "present", "analisi", "knowledge", "contenut", "ricerca"],
    },
    {
      id: "risk_compliance",
      label: "Rischi, conformità e controlli",
      description: "Controlli, regole, privacy, sicurezza, qualità e conformità.",
      keywords: ["risk", "compliance", "privacy", "sicurezza", "controll", "qualita", "policy", "legal"],
    },
    {
      id: "people",
      label: "Persone e adozione",
      description: "Personale, formazione, inserimento dei nuovi, cambiamento e collaborazione.",
      keywords: ["hr", "people", "formazione", "training", "onboarding", "adoption", "collabor", "dipendent"],
    },
  ];
  return (
    rules.find((rule) => rule.keywords.some((keyword) => text.includes(keyword))) ??
    {
      id: "productivity",
      label: "Produttività generale",
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
      "Dire quali strumenti AI si usano e dove: dati raggiungibili, controlli di sicurezza, un ambiente sicuro per provare.",
    context:
      "Mettere in un posto solo il contesto che serve: processi, regole, documenti e chi è responsabile dei dati importanti.",
    workflow:
      "Ridisegnare due o tre processi pilota, con i passaggi, il controllo umano e criteri chiari per dire che funzionano.",
    adoption:
      "Accompagnare un referente per funzione, con un appuntamento fisso ogni settimana e la raccolta di ciò che frena.",
    use_cases:
      "Raccogliere, valutare e decidere gli use case in un modo solo, per non avere iniziative isolate.",
  };
  return actions[pillarId ?? ""] ?? "Raccogliere più risposte e scegliere le prime cose da fare.";
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
      title: "Prima tappa: le basi",
      horizon: "Primi 90 giorni",
      focus: `Rafforzare l'area più debole: ${bottleneckTitle}.`,
      actions: [
        bottleneckAction(params.dashboard.bottleneckPillar),
        "Indicare chi decide, le regole sulla privacy e i criteri minimi per approvare una prova con l'AI.",
        "Ricalcolare i risultati ogni due settimane, finché le risposte non bastano.",
      ],
      successMetric: "Indice di prontezza più alto di 0,3 e risposte sopra la soglia.",
      linkedClusterIds: [],
    },
    {
      id: "wave-2-quick-wins",
      title: "Seconda tappa: i primi risultati",
      horizon: "Da 3 a 6 mesi",
      focus:
        quickClusters.length > 0
          ? `Mettere in uso ${quickClusters.slice(0, 2).map((cluster) => cluster.label.toLowerCase()).join(" e ")}.`
          : "Scegliere due use case facili da realizzare.",
      actions: [
        "Per i migliori use case: chi li segue, quanto lavoro chiedono, i rischi e come si misura il risultato.",
        "Portare gli use case scelti in Unbundle, per valutarli e pianificarli.",
        "Misurare l'uso vero: persone attive, tempo risparmiato, qualità del risultato e problemi.",
      ],
      successMetric: "Due use case approvati, almeno uno in prova e il risultato misurato.",
      linkedClusterIds: quickClusters.slice(0, 3).map((cluster) => cluster.id),
    },
    {
      id: "wave-3-scale",
      title: "Terza tappa: estendere",
      horizon: "Da 6 a 12 mesi",
      focus:
        strategicClusters.length > 0
          ? `Estendere a ${strategicClusters.slice(0, 2).map((cluster) => cluster.label.toLowerCase()).join(" e ")}.`
          : "Rendere riutilizzabile quello che ha funzionato.",
      actions: [
        "Scrivere guide ripetibili: istruzioni, regole, dati, ruoli, controlli e piano del cambiamento.",
        "Usare il contesto, i processi e gli use case per scegliere i flussi che contano di più.",
        "Portare gli insight approvati nel programma e nel report per la direzione.",
      ],
      successMetric: "Tappe approvate, use case in ordine di priorità e revisioni a cadenza fissa.",
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
      reason: "Il confronto è spento nelle impostazioni della rilevazione.",
      referenceName: REFERENCE_BENCHMARK.name,
      overallDelta: null,
      pillarDeltas: {},
    };
  }
  if (!params.dashboard.aggregationThresholdMet) {
    return {
      enabled: false,
      reason: "Servono più risposte prima del confronto.",
      referenceName: REFERENCE_BENCHMARK.name,
      overallDelta: null,
      pillarDeltas: {},
    };
  }
  if (params.benchmarkConsentCount < params.aggregationThreshold) {
    return {
      enabled: false,
      reason: "Troppo poche persone hanno dato il consenso al confronto.",
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
        "Nessuna risposta di una persona, nessuna email, nessun nome e nessun identificativo pseudonimo.",
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
        "Servono più risposte per la sintesi",
        `Le risposte sono ${input.dashboard.responseCount} su ${input.aggregationThreshold} necessarie. Si leggono solo dati insieme e affidabili: servono altre risposte prima del confronto, dei team e dei risultati per area.`,
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
      "Sintesi",
      `Indice di prontezza ${scoreText(input.dashboard.overallScore)} su 5. Il vincolo principale è ${bottleneckTitle}: la priorità è portare gli use case in tappe concrete, con regole chiare, privacy e controllo umano.`,
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
      `Area più debole: ${bottleneckTitle}`,
      `${bottleneckTitle} è l'area da affrontare per prima: senza, anche gli use case più promettenti rischiano di restare prove isolate.`,
      {
        weakestPillars: weakest,
        recommendedAction: bottleneckAction(input.dashboard.bottleneckPillar),
      }
    ),
    insightBase(
      "use_case",
      "Gruppi di use case",
      clusters.length > 0
        ? `Gli use case proposti formano ${clusters.length === 1 ? "un gruppo" : `${clusters.length} gruppi`}. Il più frequente è «${clusters[0]?.label}», con ${clusters[0]?.count === 1 ? "uno use case" : `${clusters[0]?.count ?? 0} use case`}.`
        : "Il questionario non ha ancora proposto use case: si raccolgono anche dalla dashboard o da Slack.",
      {
        clusters,
        unlinkedUseCaseCount: input.useCases.filter((item) => !item.linkedUseCaseId).length,
      }
    ),
    insightBase(
      "roadmap",
      "Tappe suggerite",
      "Tre tappe: prima le basi e le regole, poi i primi risultati misurabili, infine quello che ha funzionato esteso agli altri team.",
      { waves: roadmap }
    ),
    insightBase(
      "adoption",
      "Adozione: dall'interesse alle abitudini",
      "La prontezza cresce quando i team vedono casi concreti, misure chiare e un aiuto: servono un referente per funzione e revisioni a cadenza fissa.",
      {
        teamCount: input.dashboard.units.length,
        unitsAboveThreshold: input.dashboard.units.filter((unit) => unit.aggregationThresholdMet).length,
        suggestedCadence: "revisione settimanale degli use case e ricalcolo ogni due settimane",
      }
    ),
    insightBase(
      "benchmark",
      benchmark.enabled ? "Confronto disponibile" : "Confronto non ancora disponibile",
      benchmark.enabled
        ? `Il confronto con il riferimento è attivo: differenza complessiva ${scoreText(benchmark.overallDelta)}.`
        : benchmark.reason ?? "Confronto non disponibile.",
      { benchmark }
    ),
  ];
}
