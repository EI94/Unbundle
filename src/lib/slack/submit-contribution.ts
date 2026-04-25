import { createUseCase } from "@/lib/db/queries/use-cases";
import {
  getDraftById,
  markDraftSubmittedIfDrafting,
  updateDraft,
} from "@/lib/db/queries/slack";
import type { SlackUseCaseDraft } from "@/lib/db/schema";
import { dispatchNewPortfolioNotifications } from "@/lib/notifications/portfolio-dispatch";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { autoScorePortfolioUseCase } from "@/lib/portfolio/ai-ranking";

type SlackPortfolioKind = "best_practice" | "use_case_ai";

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function getMissingSlackDraftFields(
  draft: SlackUseCaseDraft,
  kind: SlackPortfolioKind,
  opts?: { esgEnabled?: boolean }
): string[] {
  const requiredBp = [
    "title",
    "problem",
    "flowDescription",
    "expectedImpact",
    "humanInTheLoop",
    "dataRequirements",
  ] as const;
  const requiredUc = [
    "title",
    "problem",
    "flowDescription",
    "humanInTheLoop",
    "guardrails",
    "expectedImpact",
    "dataRequirements",
    "urgency",
  ] as const;
  const shared = opts?.esgEnabled ? (["sustainabilityImpact"] as const) : [];

  return kind === "best_practice"
    ? [...requiredBp, ...shared].filter(
        (k) => !isNonEmptyString((draft as Record<string, unknown>)[k])
      )
    : [...requiredUc, ...shared].filter(
        (k) => !isNonEmptyString((draft as Record<string, unknown>)[k])
      );
}

export type SubmitSlackContributionResult =
  | { ok: true; useCaseId: string; title: string }
  | { ok: false; error: string };

/**
 * Submit idempotente e vincolato all'utente Slack: crea `use_cases` e notifica.
 * Usato dal tool LLM e dall'endpoint interactivity.
 */
export async function submitSlackContributionDraft(params: {
  draftId: string;
  actingSlackUserId: string;
  expectedWorkspaceId: string;
}): Promise<SubmitSlackContributionResult> {
  const draft = await getDraftById(params.draftId);
  if (!draft) {
    return { ok: false, error: "Draft non trovato" };
  }

  if (draft.slackUserId !== params.actingSlackUserId) {
    return { ok: false, error: "Non autorizzato su questo draft" };
  }

  if (draft.workspaceId !== params.expectedWorkspaceId) {
    return { ok: false, error: "Workspace non valido per questo draft" };
  }

  if (draft.status !== "drafting") {
    return { ok: false, error: "Questo contributo è già stato inviato" };
  }

  const kind = draft.contributionKind as SlackPortfolioKind | null;
  if (!kind) {
    return { ok: false, error: "Tipologia mancante nel draft" };
  }

  const workspace = await getWorkspaceById(params.expectedWorkspaceId);
  const esgEnabled = workspace?.esgEnabled === true;
  const missing = getMissingSlackDraftFields(draft, kind, { esgEnabled });
  if (missing.length > 0) {
    return { ok: false, error: `Campi mancanti: ${missing.join(", ")}` };
  }

  const locked = await markDraftSubmittedIfDrafting(params.draftId);
  if (!locked) {
    return { ok: false, error: "Invio già in corso o completato" };
  }

  try {
    const createdUseCase = await createUseCase({
      workspaceId: params.expectedWorkspaceId,
      title: draft.title ?? "Contributo senza titolo",
      description: draft.problem,
      businessCase: draft.expectedImpact,
      portfolioKind: kind,
      status: "proposed",
      source: "slack_proposed",
      proposedBy: params.actingSlackUserId,
      flowDescription: draft.flowDescription,
      humanInTheLoop: draft.humanInTheLoop,
      guardrails: kind === "use_case_ai" ? draft.guardrails : null,
      dataRequirements: draft.dataRequirements,
      sustainabilityImpact: esgEnabled ? draft.sustainabilityImpact : null,
      timeline: kind === "use_case_ai" ? (draft.urgency ?? null) : null,
    });

    let useCase = createdUseCase;
    try {
      useCase = await autoScorePortfolioUseCase({
        workspaceId: params.expectedWorkspaceId,
        useCaseId: createdUseCase.id,
        noteLabel: "Auto-ranking Claude",
      });
    } catch (error) {
      console.error("[slack/submit-contribution] autoScorePortfolioUseCase failed:", error);
    }

    await dispatchNewPortfolioNotifications({
      useCase,
      workspaceId: params.expectedWorkspaceId,
      source: "slack",
      slackTeamId: draft.slackTeamId,
    });

    return { ok: true, useCaseId: useCase.id, title: useCase.title };
  } catch (e) {
    console.error("[slack/submit-contribution] createUseCase failed:", e);
    try {
      await updateDraft(params.draftId, {
        status: "drafting",
        submittedAt: null,
      });
    } catch (revertErr) {
      console.error("[slack/submit-contribution] revert draft failed:", revertErr);
    }
    return {
      ok: false,
      error: "Errore durante la creazione del use case. Contatta un admin.",
    };
  }
}
