import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, jsonSchema } from "ai";
import type { UseCase } from "@/lib/db/schema";
import {
  getOrCreateWorkspaceScoringModel,
  type ScoringModelConfig,
} from "@/lib/db/queries/scoring-model";
import { getPortfolioContributionsByWorkspace, getUseCaseById, updateUseCaseCustomScores, updateUseCasePortfolioReview, updateUseCasePortfolioReviewAndCustomScores } from "@/lib/db/queries/use-cases";
import { isUntouchedUseCase } from "@/lib/portfolio/review-state";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import {
  buildPortfolioScoreRequest,
  compactPortfolioScoreObject,
  portfolioRankingCallSettings,
  resolvePortfolioRankingModel,
  type PortfolioScoreSuggestion,
} from "@/lib/portfolio/ai-ranking-contract";
import { logSafeError } from "@/lib/log/safe-error";

export async function generatePortfolioScoresWithAi(params: {
  workspaceName: string;
  useCase: UseCase;
  config: ScoringModelConfig;
  esgEnabled: boolean;
}): Promise<PortfolioScoreSuggestion> {
  const { config, esgEnabled, useCase, workspaceName } = params;
  const request = buildPortfolioScoreRequest({
    workspaceName,
    useCase,
    config,
    esgEnabled,
  });

  // Modello configurabile (PORTFOLIO_RANKING_MODEL). Lo schema inviato al modello
  // usa solo costrutti ammessi dagli output strutturati; la risposta si rivalida
  // con lo schema zod completo (punteggi interi 1-5, rationale non vuota).
  const modelId = resolvePortfolioRankingModel();
  const result = await generateObject({
    model: anthropic(modelId),
    schema: jsonSchema<Record<string, unknown>>(request.jsonSchema),
    prompt: request.prompt,
    ...portfolioRankingCallSettings(modelId),
  });

  const object = request.schema.parse(result.object) as {
    impact: Record<string, number | null>;
    feasibility: Record<string, number | null>;
    esg?: Record<string, number | null>;
    rationale: string;
  };

  return {
    customScores: compactPortfolioScoreObject({
      impact: object.impact,
      feasibility: object.feasibility,
      esg: esgEnabled ? object.esg ?? {} : {},
    }, config),
    rationale: object.rationale,
  };
}

const AI_RATIONALE_LABELS = [
  "Auto-ranking AI",
  "Suggerimento AI",
  "Ricalibrazione AI",
];

function replaceAiRationale(
  existing: string | null | undefined,
  rationale: string,
  label: string
) {
  const aiBlockPattern = new RegExp(
    `(^|\\n\\n)(${AI_RATIONALE_LABELS.join("|")}):[\\s\\S]*?(?=\\n\\n(?:${AI_RATIONALE_LABELS.join("|")}):|$)`,
    "g"
  );
  const cleaned = existing?.replace(aiBlockPattern, "").trim();
  const stamped = `${label}:\n${rationale.trim()}`;
  return cleaned ? `${cleaned}\n\n${stamped}` : stamped;
}

export async function autoScorePortfolioUseCase(params: {
  workspaceId: string;
  useCaseId: string;
  reviewedBy?: string | null;
  noteLabel?: string;
  /**
   * Servizio di invio: valuta solo una segnalazione ancora intatta e scrive
   * punteggi e stato in un solo UPDATE condizionato, così una revisione arrivata
   * nel frattempo non viene sovrascritta. Ricalibrazione e azioni manuali non lo
   * passano: per loro nulla cambia.
   */
  onlyIfUntouched?: boolean;
}) {
  const [workspace, modelRow, useCase] = await Promise.all([
    getWorkspaceById(params.workspaceId),
    getOrCreateWorkspaceScoringModel(params.workspaceId),
    getUseCaseById(params.useCaseId),
  ]);

  if (!workspace || !useCase || useCase.workspaceId !== params.workspaceId) {
    throw new Error("Use case portfolio non trovato per auto-ranking.");
  }
  if (params.onlyIfUntouched && !isUntouchedUseCase(useCase)) return useCase;

  const config = modelRow.resolvedConfig;
  const suggestion = await generatePortfolioScoresWithAi({
    workspaceName: workspace.name,
    useCase,
    config,
    esgEnabled: workspace.esgEnabled === true,
  });

  if (params.onlyIfUntouched) {
    await updateUseCasePortfolioReviewAndCustomScores({
      useCaseId: useCase.id,
      workspaceId: params.workspaceId,
      customScores: suggestion.customScores,
      portfolioReviewStatus: "in_review",
      reviewNotes: replaceAiRationale(
        useCase.reviewNotes,
        suggestion.rationale,
        params.noteLabel ?? "Auto-ranking AI"
      ),
      reviewedBy: params.reviewedBy ?? useCase.reviewedBy,
      reviewedAt: new Date(),
      workspace,
      model: modelRow,
      onlyIfUntouched: true,
    });
    const current = await getUseCaseById(useCase.id);
    if (!current) throw new Error("Use case non trovato dopo auto-ranking.");
    return current;
  }

  await updateUseCaseCustomScores(
    useCase.id,
    params.workspaceId,
    suggestion.customScores
  );
  await updateUseCasePortfolioReview(useCase.id, params.workspaceId, {
    portfolioReviewStatus: "in_review",
    reviewNotes: replaceAiRationale(
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
  let failed = 0;

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
      failed += 1;
      logSafeError("portfolio/ai-ranking", "recalibrate_item_failed", error, { useCaseId: item.id });
    }
  }

  return { updated, failed, total: items.length };
}
