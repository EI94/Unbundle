import { anthropic } from "@ai-sdk/anthropic";
import { generateObject } from "ai";
import { z } from "zod";
import type { UseCase } from "@/lib/db/schema";
import {
  getOrCreateWorkspaceScoringModel,
  type ScoringKpi,
  type ScoringModelConfig,
} from "@/lib/db/queries/scoring-model";
import { getPortfolioContributionsByWorkspace, getUseCaseById, updateUseCaseCustomScores, updateUseCasePortfolioReview } from "@/lib/db/queries/use-cases";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";

type PortfolioCustomScores = {
  impact: Record<string, number>;
  feasibility: Record<string, number>;
  esg: Record<string, number>;
};

export type PortfolioScoreSuggestion = {
  customScores: PortfolioCustomScores;
  rationale: string;
};

function buildDimSchema(kpis: ScoringKpi[]) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const kpi of kpis) {
    shape[kpi.id] = z.number().int().min(1).max(5);
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
        `  ${direction}`,
        kpi.description ? `  Rubrica: ${kpi.description}` : null,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n");
}

function buildPrompt(params: {
  workspaceName: string;
  useCase: UseCase;
  config: ScoringModelConfig;
  esgEnabled: boolean;
}) {
  const { workspaceName, useCase, config, esgEnabled } = params;

  return [
    "Sei il reviewer AI del portfolio di AI Transformation di Unbundle.",
    "Assegna punteggi interi da 1 a 5 seguendo alla lettera le rubriche qui sotto.",
    "Non inventare dati. Se mancano informazioni, usa valori prudenti e spiegalo nella rationale.",
    "Per KPI con direzione lower_better (es. effort) devi restituire il punteggio grezzo della rubrica: 1 = sforzo minimo, 5 = sforzo molto alto.",
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
    "2. quali dati mancano o sono ambigui,",
    "3. se il contributo sembra piu adatto a quick win, capability builder o strategic bet.",
  ].join("\n");
}

export async function generatePortfolioScoresWithAi(params: {
  workspaceName: string;
  useCase: UseCase;
  config: ScoringModelConfig;
  esgEnabled: boolean;
}): Promise<PortfolioScoreSuggestion> {
  const { config, esgEnabled, useCase, workspaceName } = params;

  const schemaShape: Record<string, z.ZodTypeAny> = {
    impact: buildDimSchema(config.dimensions.impact),
    feasibility: buildDimSchema(config.dimensions.feasibility),
    rationale: z.string().min(30),
  };
  if (esgEnabled) {
    schemaShape.esg = buildDimSchema(config.dimensions.esg);
  }

  const result = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema: z.object(schemaShape),
    prompt: buildPrompt({
      workspaceName,
      useCase,
      config,
      esgEnabled,
    }),
  });

  const object = result.object as {
    impact: Record<string, number>;
    feasibility: Record<string, number>;
    esg?: Record<string, number>;
    rationale: string;
  };

  return {
    customScores: {
      impact: object.impact,
      feasibility: object.feasibility,
      esg: esgEnabled ? object.esg ?? {} : {},
    },
    rationale: object.rationale,
  };
}

function appendAiRationale(
  existing: string | null | undefined,
  rationale: string,
  label: string
) {
  const stamped = `${label}:\n${rationale.trim()}`;
  return existing?.trim() ? `${existing.trim()}\n\n${stamped}` : stamped;
}

export async function autoScorePortfolioUseCase(params: {
  workspaceId: string;
  useCaseId: string;
  reviewedBy?: string | null;
  noteLabel?: string;
}) {
  const [workspace, modelRow, useCase] = await Promise.all([
    getWorkspaceById(params.workspaceId),
    getOrCreateWorkspaceScoringModel(params.workspaceId),
    getUseCaseById(params.useCaseId),
  ]);

  if (!workspace || !useCase || useCase.workspaceId !== params.workspaceId) {
    throw new Error("Use case portfolio non trovato per auto-ranking.");
  }

  const config = modelRow.resolvedConfig;
  const suggestion = await generatePortfolioScoresWithAi({
    workspaceName: workspace.name,
    useCase,
    config,
    esgEnabled: workspace.esgEnabled === true,
  });

  await updateUseCaseCustomScores(useCase.id, params.workspaceId, suggestion.customScores);
  await updateUseCasePortfolioReview(useCase.id, params.workspaceId, {
    portfolioReviewStatus: "in_review",
    reviewNotes: appendAiRationale(
      useCase.reviewNotes,
      suggestion.rationale,
      params.noteLabel ?? "Auto-ranking AI"
    ),
    reviewedBy: params.reviewedBy ?? null,
    reviewedAt: new Date(),
  });

  const updated = await getUseCaseById(useCase.id);
  if (!updated) {
    throw new Error("Use case non trovato dopo auto-ranking.");
  }
  return updated;
}

export async function recalibrateWorkspacePortfolioWithAi(params: {
  workspaceId: string;
  reviewedBy?: string | null;
  noteLabel?: string;
}) {
  const items = await getPortfolioContributionsByWorkspace(params.workspaceId);
  const updated: UseCase[] = [];

  for (const item of items) {
    try {
      const row = await autoScorePortfolioUseCase({
        workspaceId: params.workspaceId,
        useCaseId: item.id,
        reviewedBy: params.reviewedBy ?? null,
        noteLabel: params.noteLabel ?? "Ricalibrazione AI",
      });
      updated.push(row);
    } catch (error) {
      console.error("[portfolio/ai-ranking] recalibrate item failed:", item.id, error);
    }
  }

  return updated;
}
