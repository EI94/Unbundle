"use server";

import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getWorkspaceById, updateWorkspaceAiTransformationTeamName } from "@/lib/db/queries/workspaces";
import {
  createUseCase,
  getUseCaseById,
  updateUseCasePortfolioReview,
  updateUseCaseScores,
} from "@/lib/db/queries/use-cases";
import {
  DEFAULT_SCORING_MODEL_CONFIG,
  getOrCreateWorkspaceScoringModel,
  upsertWorkspaceScoringModel,
} from "@/lib/db/queries/scoring-model";
import { streamText, generateObject } from "ai";
import { anthropic } from "@ai-sdk/anthropic";

export async function updateAiTransformationTeamNameAction(
  workspaceId: string,
  formData: FormData
) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const raw = String(formData.get("aiTransformationTeamName") ?? "").trim();
  await updateWorkspaceAiTransformationTeamName(workspaceId, raw.length ? raw : null);
  revalidatePath(`/dashboard/${workspaceId}/portfolio`);
}

export async function updateScoringModelAction(workspaceId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const impactFlagEnabled = String(formData.get("impactFlagEnabled") ?? "") === "on";

  const num = (k: string, fallback: number) => {
    const v = Number(formData.get(k));
    return Number.isFinite(v) ? v : fallback;
  };

  const current = await getOrCreateWorkspaceScoringModel(workspaceId);
  const base = current.config ?? DEFAULT_SCORING_MODEL_CONFIG;

  const config = {
    ...base,
    thresholds: {
      highImpact: num("threshold_highImpact", base.thresholds.highImpact),
      highFeasibility: num(
        "threshold_highFeasibility",
        base.thresholds.highFeasibility
      ),
      midImpact: num("threshold_midImpact", base.thresholds.midImpact),
    },
    weights: {
      ...base.weights,
      overall: {
        impact: num("weight_overallImpact", base.weights.overall.impact),
        feasibility: num(
          "weight_overallFeasibility",
          base.weights.overall.feasibility
        ),
        esgWhenEnabled: num(
          "weight_overallEsg",
          base.weights.overall.esgWhenEnabled
        ),
      },
    },
  } as typeof base;

  await upsertWorkspaceScoringModel({
    workspaceId,
    impactFlagEnabled,
    config,
    updatedByUserId: session.user.id,
  });

  revalidatePath(`/dashboard/${workspaceId}/portfolio`);
  revalidatePath(`/dashboard/${workspaceId}/use-cases`);
}

const submitSchema = z.object({
  portfolioKind: z.enum(["best_practice", "use_case_ai"]),
  title: z.string().min(3),
  problem: z.string().min(3),
  flowDescription: z.string().min(3),
  expectedImpact: z.string().min(3),
  humanInTheLoop: z.string().min(3),
  dataRequirements: z.string().min(3),
  guardrails: z.string().optional(),
  urgency: z.string().optional(),
});

export async function createPortfolioSubmissionAction(workspaceId: string, formData: FormData) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const parsed = submitSchema.safeParse({
    portfolioKind: String(formData.get("portfolioKind") ?? ""),
    title: String(formData.get("title") ?? "").trim(),
    problem: String(formData.get("problem") ?? "").trim(),
    flowDescription: String(formData.get("flowDescription") ?? "").trim(),
    expectedImpact: String(formData.get("expectedImpact") ?? "").trim(),
    humanInTheLoop: String(formData.get("humanInTheLoop") ?? "").trim(),
    dataRequirements: String(formData.get("dataRequirements") ?? "").trim(),
    guardrails: String(formData.get("guardrails") ?? "").trim() || undefined,
    urgency: String(formData.get("urgency") ?? "").trim() || undefined,
  });
  if (!parsed.success) {
    throw new Error("Compila tutti i campi richiesti.");
  }

  const kind = parsed.data.portfolioKind;
  const useCase = await createUseCase({
    workspaceId,
    title: parsed.data.title,
    description: parsed.data.problem,
    businessCase: parsed.data.expectedImpact,
    portfolioKind: kind,
    status: "proposed",
    source: "web_proposed",
    proposedBy: session.user.email ?? session.user.id,
    flowDescription: parsed.data.flowDescription,
    humanInTheLoop: parsed.data.humanInTheLoop,
    guardrails: kind === "use_case_ai" ? parsed.data.guardrails ?? null : null,
    dataRequirements: parsed.data.dataRequirements,
    timeline: kind === "use_case_ai" ? (parsed.data.urgency ?? null) : null,
    submittedAt: new Date(),
    portfolioReviewStatus: "needs_inputs",
  });

  revalidatePath(`/dashboard/${workspaceId}/portfolio`);
  redirect(`/dashboard/${workspaceId}/portfolio?thanks=1&created=${useCase.id}`);
}

export async function savePortfolioReviewAction(
  workspaceId: string,
  useCaseId: string,
  formData: FormData
) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const reviewStatus = String(formData.get("portfolioReviewStatus") ?? "").trim();
  const impactFlag = String(formData.get("impactFlag") ?? "") === "on";
  const reviewNotes = String(formData.get("reviewNotes") ?? "").trim() || null;

  const toScore = (k: string) => {
    const v = Number(formData.get(k));
    if (!Number.isFinite(v)) return undefined;
    return Math.max(0, Math.min(5, v));
  };

  const patch = {
    impactEconomic: toScore("impactEconomic"),
    impactTime: toScore("impactTime"),
    impactQuality: toScore("impactQuality"),
    impactCoordination: toScore("impactCoordination"),
    impactSocial: toScore("impactSocial"),
    feasibilityData: toScore("feasibilityData"),
    feasibilityWorkflow: toScore("feasibilityWorkflow"),
    feasibilityRisk: toScore("feasibilityRisk"),
    feasibilityTech: toScore("feasibilityTech"),
    feasibilityTeam: toScore("feasibilityTeam"),
    esgEnvironmental: toScore("esgEnvironmental"),
    esgSocial: toScore("esgSocial"),
    esgGovernance: toScore("esgGovernance"),
  };

  await updateUseCaseScores(useCaseId, workspaceId, patch);
  await updateUseCasePortfolioReview(useCaseId, workspaceId, {
    impactFlag,
    portfolioReviewStatus: reviewStatus as never,
    reviewNotes,
    reviewedBy: session.user.id,
    reviewedAt: new Date(),
  });

  revalidatePath(`/dashboard/${workspaceId}/portfolio`);
  revalidatePath(`/dashboard/${workspaceId}/portfolio/review/${useCaseId}`);
}

export async function suggestPortfolioScoresWithAiAction(
  workspaceId: string,
  useCaseId: string
) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const [workspace, model, useCase] = await Promise.all([
    getWorkspaceById(workspaceId),
    getOrCreateWorkspaceScoringModel(workspaceId),
    getUseCaseById(useCaseId),
  ]);
  if (!workspace || !useCase || useCase.workspaceId !== workspaceId) {
    throw new Error("Use case non trovato");
  }

  const includeEsg =
    workspace.esgEnabled === true && model.impactFlagEnabled === true;

  const schema = z.object({
    impactEconomic: z.number().min(0).max(5),
    impactTime: z.number().min(0).max(5),
    impactQuality: z.number().min(0).max(5),
    impactCoordination: z.number().min(0).max(5),
    impactSocial: z.number().min(0).max(5),
    feasibilityData: z.number().min(0).max(5),
    feasibilityWorkflow: z.number().min(0).max(5),
    feasibilityRisk: z.number().min(0).max(5),
    feasibilityTech: z.number().min(0).max(5),
    feasibilityTeam: z.number().min(0).max(5),
    esgEnvironmental: z.number().min(0).max(5).optional(),
    esgSocial: z.number().min(0).max(5).optional(),
    esgGovernance: z.number().min(0).max(5).optional(),
    rationale: z.string().min(20),
  });

  const prompt = [
    "Sei un reviewer di AI Transformation. Devi proporre punteggi 0–5 per le dimensioni di impatto e fattibilità.",
    "Regola: non inventare numeri casuali; usa una scala coerente e motivazioni brevi e verificabili.",
    "Se mancano info, usa valori conservativi (2–3) e spiega cosa manca nella rationale.",
    "",
    `Workspace: ${workspace.name}`,
    `Tipo: ${useCase.portfolioKind ?? "use_case"}`,
    `Titolo: ${useCase.title}`,
    `Problema/descrizione: ${useCase.description ?? ""}`,
    `Flusso: ${useCase.flowDescription ?? ""}`,
    `Human-in-the-loop: ${useCase.humanInTheLoop ?? ""}`,
    `Guardrail: ${useCase.guardrails ?? ""}`,
    `Business case / impatto atteso: ${useCase.businessCase ?? ""}`,
    `Dati necessari: ${useCase.dataRequirements ?? ""}`,
    "",
    `ESG: ${includeEsg ? "CONSIDERA anche esgEnvironmental/esgSocial/esgGovernance (0–5)" : "NON compilare punteggi ESG"}`,
  ].join("\n");

  const result = await generateObject({
    model: anthropic("claude-sonnet-4-20250514"),
    schema,
    prompt,
  });

  const o = result.object;
  await updateUseCaseScores(useCaseId, workspaceId, {
    impactEconomic: o.impactEconomic,
    impactTime: o.impactTime,
    impactQuality: o.impactQuality,
    impactCoordination: o.impactCoordination,
    impactSocial: o.impactSocial,
    feasibilityData: o.feasibilityData,
    feasibilityWorkflow: o.feasibilityWorkflow,
    feasibilityRisk: o.feasibilityRisk,
    feasibilityTech: o.feasibilityTech,
    feasibilityTeam: o.feasibilityTeam,
    esgEnvironmental: includeEsg ? (o.esgEnvironmental ?? 0) : undefined,
    esgSocial: includeEsg ? (o.esgSocial ?? 0) : undefined,
    esgGovernance: includeEsg ? (o.esgGovernance ?? 0) : undefined,
  });

  await updateUseCasePortfolioReview(useCaseId, workspaceId, {
    reviewNotes: (useCase.reviewNotes ?? "") +
      (useCase.reviewNotes ? "\n\n" : "") +
      `Suggerimento AI:\n${o.rationale}`,
    reviewedBy: session.user.id,
    reviewedAt: new Date(),
  });

  revalidatePath(`/dashboard/${workspaceId}/portfolio/review/${useCaseId}`);
}

