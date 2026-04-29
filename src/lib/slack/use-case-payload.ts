import type { NewUseCase, SlackUseCaseDraft } from "../db/schema";

type SlackPortfolioKind = "best_practice" | "use_case_ai";

export function buildUseCaseDataFromSlackDraft(params: {
  draft: SlackUseCaseDraft;
  actingSlackUserId: string;
  expectedWorkspaceId: string;
  esgEnabled: boolean;
}): NewUseCase {
  const kind = params.draft.contributionKind as SlackPortfolioKind;
  return {
    workspaceId: params.expectedWorkspaceId,
    title: params.draft.title ?? "Contributo senza titolo",
    description: params.draft.problem,
    businessCase: params.draft.expectedImpact,
    portfolioKind: kind,
    status: "proposed",
    source: "slack_proposed",
    proposedBy: params.actingSlackUserId,
    flowDescription: params.draft.flowDescription,
    humanInTheLoop: params.draft.humanInTheLoop,
    guardrails: kind === "use_case_ai" ? params.draft.guardrails : null,
    dataRequirements: params.draft.dataRequirements,
    sustainabilityImpact: params.esgEnabled
      ? params.draft.sustainabilityImpact
      : null,
    timeline: kind === "use_case_ai" ? (params.draft.urgency ?? null) : null,
  };
}
