import { z } from "zod";
import type { UseCase } from "@/lib/db/schema";
import type { ScoringKpi, ScoringModelConfig } from "@/lib/db/queries/scoring-model";
import { AGENT_RELIABILITY_SYSTEM_PROMPT } from "../ai/agent-reliability.ts";

export type PortfolioCustomScores = {
  impact: Record<string, number>;
  feasibility: Record<string, number>;
  esg: Record<string, number>;
};

type NullableScoreMap = Record<string, number | null | undefined>;

export type PortfolioScoreSuggestion = {
  customScores: PortfolioCustomScores;
  rationale: string;
};

export function isMonetaryKpi(kpi: ScoringKpi) {
  const haystack = `${kpi.id} ${kpi.label} ${kpi.description ?? ""}`.toLowerCase();
  return [
    "profit",
    "profitability",
    "economic",
    "economico",
    "economica",
    "monet",
    "revenue",
    "ricav",
    "fattur",
    "saving",
    "margine",
    "eur",
    "€",
    "costo",
    "cost",
  ].some((token) => haystack.includes(token));
}

function buildDimSchema(kpis: ScoringKpi[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const kpi of kpis) {
    shape[kpi.id] = z.number().int().min(1).max(5).nullable();
  }
  return z.object(shape);
}

function describeKpis(kpis: ScoringKpi[]) {
  return kpis
    .map((kpi) => {
      const direction =
        kpi.direction === "lower_better"
          ? "Il punteggio va restituito sulla scala grezza dove 1 = meglio e 5 = peggio."
          : "Il punteggio va restituito sulla scala grezza dove 5 = meglio.";
      return [
        `- ${kpi.id} (${kpi.label})`,
        `  Peso: ${kpi.weight}`,
        `  Direzione: ${kpi.direction === "lower_better" ? "lower_better" : "higher_better"}`,
        isMonetaryKpi(kpi)
          ? "  KPI economico/monetario: per il momento restituisci sempre null. Non stimare EUR, ricavi, saving, margine o fatturato."
          : null,
        `  ${direction}`,
        kpi.description ? `  Rubrica: ${kpi.description}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

export function buildPortfolioScoreSchema(
  config: ScoringModelConfig,
  esgEnabled: boolean
) {
  const schemaShape: Record<string, z.ZodTypeAny> = {
    impact: buildDimSchema(config.dimensions.impact),
    feasibility: buildDimSchema(config.dimensions.feasibility),
    rationale: z.string().min(30),
  };
  if (esgEnabled) {
    schemaShape.esg = buildDimSchema(config.dimensions.esg);
  }

  return z.object(schemaShape);
}

export function buildPortfolioScorePrompt(params: {
  workspaceName: string;
  useCase: UseCase;
  config: ScoringModelConfig;
  esgEnabled: boolean;
}) {
  const { workspaceName, useCase, config, esgEnabled } = params;

  return [
    AGENT_RELIABILITY_SYSTEM_PROMPT,
    "",
    "Sei il reviewer AI del portfolio di AI Transformation di Unbundle.",
    "Assegna punteggi interi da 1 a 5 seguendo alla lettera le rubriche qui sotto.",
    "Non inventare dati. Se mancano informazioni, usa valori prudenti e spiegalo nella rationale.",
    "Per KPI con direzione lower_better (es. effort) devi restituire il punteggio grezzo della rubrica: 1 = sforzo minimo, 5 = sforzo molto alto.",
    "Per il momento limita la valutazione automatica soprattutto alla fattibilita/effort e agli aspetti non monetari chiaramente descritti.",
    "Non stimare impatto economico in EUR, ricavi, saving, margine o fatturato. Per KPI economici o monetari restituisci sempre null: quei campi devono restare vuoti e compilabili manualmente dal reviewer.",
    "I KPI restituiti come null resteranno vuoti e compilabili manualmente dal reviewer.",
    "",
    `Workspace: ${workspaceName}`,
    `Tipo contributo: ${useCase.portfolioKind ?? "use_case"}`,
    `Titolo: ${useCase.title}`,
    `Problema / prima: ${useCase.description ?? ""}`,
    `Nuovo flusso / as-is -> to-be: ${useCase.flowDescription ?? ""}`,
    `Human in the loop: ${useCase.humanInTheLoop ?? ""}`,
    `Guardrail: ${useCase.guardrails ?? ""}`,
    `Impatto atteso / business case: ${useCase.businessCase ?? ""}`,
    `Dati necessari / replicabilita: ${useCase.dataRequirements ?? ""}`,
    `Urgenza / timeline: ${useCase.timeline ?? ""}`,
    `Impatto ambientale e sociale dichiarato: ${useCase.sustainabilityImpact ?? ""}`,
    "",
    "KPI IMPACT",
    describeKpis(config.dimensions.impact),
    "",
    "KPI FEASIBILITY",
    describeKpis(config.dimensions.feasibility),
    esgEnabled
      ? `\nKPI ESG\n${describeKpis(config.dimensions.esg)}`
      : "\nESG disabilitato: non produrre punteggi ESG.",
    "",
    "Nella rationale spiega:",
    "1. perche hai assegnato i punteggi principali,",
    "2. quali dati mancano o sono ambigui, soprattutto per gli eventuali KPI economici lasciati vuoti,",
    "3. se il contributo sembra piu adatto a quick win, capability builder o strategic bet.",
  ].join("\n");
}

function compactScores(scores: NullableScoreMap | undefined) {
  const compact: Record<string, number> = {};
  if (!scores) return compact;
  for (const [key, value] of Object.entries(scores)) {
    if (typeof value === "number" && Number.isFinite(value)) {
      compact[key] = value;
    }
  }
  return compact;
}

export function compactPortfolioScoreObject(object: {
  impact?: NullableScoreMap;
  feasibility?: NullableScoreMap;
  esg?: NullableScoreMap;
}, config?: ScoringModelConfig) {
  const impact = compactScores(object.impact);
  const feasibility = compactScores(object.feasibility);
  const esg = compactScores(object.esg);

  if (config) {
    for (const kpi of config.dimensions.impact) {
      if (isMonetaryKpi(kpi)) delete impact[kpi.id];
    }
    for (const kpi of config.dimensions.feasibility) {
      if (isMonetaryKpi(kpi)) delete feasibility[kpi.id];
    }
    for (const kpi of config.dimensions.esg) {
      if (isMonetaryKpi(kpi)) delete esg[kpi.id];
    }
  }

  return {
    impact,
    feasibility,
    esg,
  } satisfies PortfolioCustomScores;
}

export function buildPortfolioScoreRequest(params: {
  workspaceName: string;
  useCase: UseCase;
  config: ScoringModelConfig;
  esgEnabled: boolean;
}) {
  return {
    schema: buildPortfolioScoreSchema(params.config, params.esgEnabled),
    prompt: buildPortfolioScorePrompt(params),
  };
}
