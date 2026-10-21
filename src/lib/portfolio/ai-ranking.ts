import { anthropic } from "@ai-sdk/anthropic";
import { generateObject, jsonSchema } from "ai";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { useCases, type UseCase, type Workspace } from "@/lib/db/schema";
import {
  getOrCreateWorkspaceScoringModel,
  type ScoringModelConfig,
  type ScoringModelRow,
} from "@/lib/db/queries/scoring-model";
import { getPortfolioContributionsByWorkspace, getUseCaseById } from "@/lib/db/queries/use-cases";
import { aiMayWriteSuggestion, deriveUseCasePortfolioMetrics, replaceAiRationale, type AiSuggestionKind } from "@/lib/db/use-case-scoring";
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
import { recordAiSuggestion, type WriteContext } from "@/lib/use-cases/service";
import type { ScoringVersion } from "@/lib/use-cases/valuation";

/*
 * Auto-ranking dell'AI (docs/use-case/DESIGN.md §7.6, §9.2; PIANO-LAVORI H3a). Il ramo lo
 * sceglie `scoringVersion` del modello del workspace:
 * - v1: il comportamento di oggi, identico (punteggi in `custom_scores`, stato `in_review`,
 *   motivazione nelle note, `reviewed_by` di chi chiama), più la scrittura di `ai_suggestion`
 *   con il servizio, così i dati per il passaggio alla v2 sono pronti;
 * - v2: l'AI scrive solo `ai_suggestion` (`recordAiSuggestion`, servizio dell'area), mai
 *   `custom_scores`, `reviewed_by`, `reviewed_at`, `review_notes`; cambia lo stato solo da
 *   `needs_inputs` senza persona a `in_review` (lo decide il servizio); scrive solo le schede
 *   ammesse da `aiMayWriteSuggestion` (invio solo su schede intatte, ricalibrazione senza le
 *   valutate e le archiviate). `reviewedBy`, `noteLabel` e `onlyIfUntouched` non contano.
 */

export type GeneratedPortfolioScores = PortfolioScoreSuggestion & { model: string };

export async function generatePortfolioScoresWithAi(params: {
  workspaceName: string;
  useCase: UseCase;
  config: ScoringModelConfig;
  esgEnabled: boolean;
}): Promise<GeneratedPortfolioScores> {
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
    model: modelId,
  };
}

/** Il percorso dall'etichetta delle note di oggi, per i chiamanti che passano solo quella. */
const KIND_BY_LABEL: Readonly<Record<string, AiSuggestionKind>> = {
  "Auto-ranking AI": "auto",
  "Suggerimento AI": "suggerimento",
  "Ricalibrazione AI": "ricalibrazione",
};

function kindOf(params: { kind?: AiSuggestionKind; noteLabel?: string }): AiSuggestionKind {
  return params.kind ?? KIND_BY_LABEL[params.noteLabel ?? "Auto-ranking AI"] ?? "auto";
}

/** L'AI che scrive tramite il servizio: nella Storia è «ai», mai una persona. */
function aiContext(workspaceId: string): WriteContext {
  return { workspaceId, actor: { userId: null, role: null, isLateralSpace: false, kind: "ai" }, channel: "ai" };
}

export interface AiScoringParams {
  workspaceId: string;
  useCaseId: string;
  /** Solo v1: chi firma `reviewed_by`, come oggi. In v2 l'AI non lo scrive mai. */
  reviewedBy?: string | null;
  /** Solo v1: l'etichetta del blocco della motivazione nelle note. */
  noteLabel?: string;
  /**
   * Solo v1: il servizio di invio valuta solo una segnalazione ancora intatta e scrive
   * punteggi e stato in un solo UPDATE condizionato, così una revisione arrivata nel
   * frattempo non viene sovrascritta. In v2 vale per ogni invio (`aiMayWriteSuggestion`).
   */
  onlyIfUntouched?: boolean;
  /** Il percorso dell'AI; senza, dall'etichetta (`Auto-ranking AI` → `auto`, …). */
  kind?: AiSuggestionKind;
}

export interface AiScoringResult {
  /** La scheda riletta dopo la scrittura (o com'era, se l'AI non l'ha scritta). */
  useCase: UseCase;
  version: ScoringVersion;
  /**
   * Falso quando la scheda non era da scrivere (l'AI non è stata chiamata) o, in v2, quando è
   * cambiata mentre il modello rispondeva (il suggerimento non si salva).
   */
  written: boolean;
}

/**
 * v1 e `ai_suggestion`: dopo il comportamento di oggi l'AI scrive anche la sua copia, con il
 * servizio. Un errore qui non cambia nulla di ciò che la v1 ha già scritto: si registra e basta.
 */
async function recordV1Suggestion(workspaceId: string, useCaseId: string, kind: AiSuggestionKind, suggestion: GeneratedPortfolioScores) {
  try {
    const result = await recordAiSuggestion(aiContext(workspaceId), useCaseId, {
      kind,
      scores: suggestion.customScores,
      rationale: suggestion.rationale,
      model: suggestion.model,
    });
    if (!result.ok) logSafeError("portfolio/ai-ranking", "v1_suggestion_not_recorded", { name: "ServiceError", code: result.error }, { useCaseId });
  } catch (error) {
    logSafeError("portfolio/ai-ranking", "v1_suggestion_not_recorded", error, { useCaseId });
  }
}

function versionOf(modelRow: { resolvedConfig: ScoringModelConfig }): ScoringVersion {
  return modelRow.resolvedConfig.scoringVersion === 2 ? 2 : 1;
}

/**
 * La scrittura della v1 vale solo se il workspace è ancora in v1, controllato nello stesso
 * statement: il modello non è in v2 (`config.scoringVersion` uguale al numero 2, come lo legge
 * `normalizeScoringConfig`) e la scheda non ha la copia `v1Backup`, che `scoring-v2 --apply`
 * scrive su ogni scheda nella sua transazione. La copia copre anche un UPDATE partito prima del
 * commit di `--apply` e fermo sulla riga: Postgres ricontrolla le condizioni sulla riga nuova,
 * mentre il modello lo leggerebbe com'era all'inizio dello statement.
 */
const STILL_SCORING_V1 = sql`NOT EXISTS (SELECT 1 FROM workspace_scoring_models m
    WHERE m.workspace_id = ${useCases.workspaceId} AND m.config -> 'scoringVersion' = '2'::jsonb)
  AND ${useCases.aiSuggestion} -> 'v1Backup' IS NULL`;

/**
 * v1, il comportamento di oggi in un solo UPDATE: punteggi dell'AI in `custom_scores` con gli
 * aggregati della v1, stato `in_review`, motivazione nelle note, `reviewed_by` e `reviewed_at`
 * (i valori di `updateUseCasePortfolioReviewAndCustomScores`, e per chi non passa
 * `onlyIfUntouched` di `updateUseCaseCustomScores` più `updateUseCasePortfolioReview`). Scrive
 * solo se il workspace è ancora in v1 (`STILL_SCORING_V1`) e, con `onlyIfUntouched`, se la
 * scheda è ancora intatta. `null` se non scrive.
 */
async function writeV1Scores(params: {
  useCase: UseCase;
  workspace: Workspace;
  model: ScoringModelRow;
  suggestion: GeneratedPortfolioScores;
  noteLabel: string;
  reviewedBy: string | null | undefined;
  onlyIfUntouched: boolean;
}): Promise<UseCase | null> {
  const { useCase, workspace, model, suggestion } = params;
  const existing = await getUseCaseById(useCase.id);
  if (!existing || existing.workspaceId !== useCase.workspaceId) return null;
  const derived = deriveUseCasePortfolioMetrics(
    { ...existing, customScores: suggestion.customScores },
    { model: { impactFlagEnabled: model.impactFlagEnabled, config: model.resolvedConfig }, esgEnabled: workspace.esgEnabled === true },
  );
  const now = new Date();
  const [row] = await db
    .update(useCases)
    .set({
      customScores: suggestion.customScores,
      ...derived,
      portfolioReviewStatus: "in_review",
      reviewNotes: replaceAiRationale(useCase.reviewNotes, suggestion.rationale, params.noteLabel),
      // Come oggi: con `onlyIfUntouched` chi chiama o chi c'era alla lettura; senza, chi chiama o chi c'è adesso.
      reviewedBy: params.reviewedBy ?? (params.onlyIfUntouched ? useCase.reviewedBy : existing.reviewedBy),
      reviewedAt: now,
      updatedAt: now,
    })
    .where(
      params.onlyIfUntouched
        ? and(eq(useCases.id, useCase.id), eq(useCases.portfolioReviewStatus, "needs_inputs"), isNull(useCases.reviewedAt), STILL_SCORING_V1)
        : and(eq(useCases.id, useCase.id), STILL_SCORING_V1),
    )
    .returning();
  return row ?? null;
}

/**
 * v2: il servizio scrive solo `ai_suggestion` e gli aggregati, e porta «in valutazione» solo una
 * scheda ricevuta senza persona. Scrive solo la scheda letta prima della chiamata al modello: se
 * nel frattempo una persona l'ha cambiata (valutata, archiviata, modificata), il suggerimento
 * non si salva (`expectedVersion` e `aiMayWriteSuggestion` sulla riga riletta).
 */
async function writeV2Suggestion(workspaceId: string, useCase: UseCase, kind: AiSuggestionKind, suggestion: GeneratedPortfolioScores): Promise<AiScoringResult> {
  const result = await recordAiSuggestion(
    aiContext(workspaceId),
    useCase.id,
    { kind, scores: suggestion.customScores, rationale: suggestion.rationale, model: suggestion.model },
    { expectedVersion: useCase.version },
  );
  if (!result.ok) throw new Error(`Suggerimento AI non salvato (${result.error}).`);
  const current = await getUseCaseById(useCase.id);
  if (!current) throw new Error("Use case non trovato dopo auto-ranking.");
  return { useCase: current, version: 2, written: result.value.written };
}

/**
 * Valuta una scheda con l'AI, nel ramo della versione del workspace. Chi può essere scritto lo
 * dice la versione letta prima della chiamata al modello; come si scrive, la versione riletta
 * dopo: se `scoring-v2 --apply` (o `--revert`) arriva mentre il modello risponde, la scrittura
 * segue la versione nuova. La scrittura della v1 ricontrolla la versione nello stesso statement
 * (`STILL_SCORING_V1`): se `--apply` arriva tra la rilettura e l'UPDATE, la v1 non scrive e
 * l'AI scrive come la v2. Così un auto-ranking partito in v1 non scrive `custom_scores`, note e
 * `reviewed_by` in un workspace appena passato alla v2 (§7.6 regole 3 e 5).
 */
export async function scorePortfolioUseCaseWithAi(params: AiScoringParams): Promise<AiScoringResult> {
  const [workspace, modelRow, useCase] = await Promise.all([
    getWorkspaceById(params.workspaceId),
    getOrCreateWorkspaceScoringModel(params.workspaceId),
    getUseCaseById(params.useCaseId),
  ]);

  if (!workspace || !useCase || useCase.workspaceId !== params.workspaceId) {
    throw new Error("Use case portfolio non trovato per auto-ranking.");
  }
  const kind = kindOf(params);
  const config = modelRow.resolvedConfig;
  const readVersion = versionOf(modelRow);
  if (readVersion === 2 && !aiMayWriteSuggestion(useCase, kind)) return { useCase, version: readVersion, written: false };
  if (readVersion === 1 && params.onlyIfUntouched && !isUntouchedUseCase(useCase)) return { useCase, version: readVersion, written: false };

  const suggestion = await generatePortfolioScoresWithAi({
    workspaceName: workspace.name,
    useCase,
    config,
    esgEnabled: workspace.esgEnabled === true,
  });
  const writeModel = await getOrCreateWorkspaceScoringModel(params.workspaceId);
  if (versionOf(writeModel) === 2) return writeV2Suggestion(params.workspaceId, useCase, kind, suggestion);

  // v1: il comportamento di oggi. `onlyIfUntouched` lo ricontrolla l'UPDATE condizionato.
  const updated = await writeV1Scores({
    useCase,
    workspace,
    model: writeModel,
    suggestion,
    noteLabel: params.noteLabel ?? "Auto-ranking AI",
    reviewedBy: params.reviewedBy,
    onlyIfUntouched: params.onlyIfUntouched === true,
  });
  if (!updated) {
    // Il workspace è passato alla v2 tra la rilettura del modello e l'UPDATE: si scrive come la v2.
    if (versionOf(await getOrCreateWorkspaceScoringModel(params.workspaceId)) === 2) {
      return writeV2Suggestion(params.workspaceId, useCase, kind, suggestion);
    }
    const current = await getUseCaseById(useCase.id);
    if (!current) throw new Error("Use case non trovato dopo auto-ranking.");
    return { useCase: current, version: 1, written: false };
  }
  await recordV1Suggestion(params.workspaceId, useCase.id, kind, suggestion);
  const current = await getUseCaseById(useCase.id);
  if (!current) throw new Error("Use case non trovato dopo auto-ranking.");
  return { useCase: current, version: 1, written: true };
}

/** La scheda dopo l'auto-ranking (forma di sempre, per invio web, Slack e REST). */
export async function autoScorePortfolioUseCase(params: AiScoringParams): Promise<UseCase> {
  return (await scorePortfolioUseCaseWithAi(params)).useCase;
}

/**
 * Ricalibra con l'AI i contributi del workspace. In v1 tutti, come oggi; in v2 solo quelli
 * ancora da valutare: le schede valutate e le archiviate restano come sono (`skipped`), come
 * quelle che una persona cambia mentre il modello risponde.
 */
export async function recalibrateWorkspacePortfolioWithAi(params: {
  workspaceId: string;
  reviewedBy?: string | null;
  noteLabel?: string;
}) {
  const [items, modelRow] = await Promise.all([
    getPortfolioContributionsByWorkspace(params.workspaceId),
    getOrCreateWorkspaceScoringModel(params.workspaceId),
  ]);
  const eligible =
    modelRow.resolvedConfig.scoringVersion === 2
      ? items.filter((item) => aiMayWriteSuggestion(item, "ricalibrazione"))
      : items;
  const updated: UseCase[] = [];
  let failed = 0;
  let unwritten = 0;

  for (const item of eligible) {
    try {
      const result = await scorePortfolioUseCaseWithAi({
        workspaceId: params.workspaceId,
        useCaseId: item.id,
        reviewedBy: params.reviewedBy ?? null,
        noteLabel: params.noteLabel ?? "Ricalibrazione AI",
        kind: "ricalibrazione",
      });
      if (result.written) updated.push(result.useCase);
      else unwritten += 1;
    } catch (error) {
      failed += 1;
      logSafeError("portfolio/ai-ranking", "recalibrate_item_failed", error, { useCaseId: item.id });
    }
  }

  return { updated, failed, total: eligible.length, skipped: items.length - eligible.length + unwritten };
}
