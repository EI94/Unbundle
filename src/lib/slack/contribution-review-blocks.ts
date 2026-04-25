import type { SlackUseCaseDraft } from "@/lib/db/schema";

export const SLACK_CONTRIBUTION_ACTION_CONFIRM = "unbundle_contribution_confirm";
export const SLACK_CONTRIBUTION_ACTION_EDIT = "unbundle_contribution_edit";

export type ContributionReviewPayload = {
  d: string;
  w: string;
};

export function encodeContributionReviewValue(payload: ContributionReviewPayload): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

export function decodeContributionReviewValue(value: string): ContributionReviewPayload | null {
  try {
    const raw = Buffer.from(value, "base64url").toString("utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    if (typeof o.d !== "string" || typeof o.w !== "string") return null;
    return { d: o.d, w: o.w };
  } catch {
    return null;
  }
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function buildContributionReviewSummaryText(draft: SlackUseCaseDraft): string {
  const kind = draft.contributionKind;
  const lines: string[] = [
    kind === "best_practice"
      ? "*Best Practice* — riepilogo"
      : kind === "use_case_ai"
        ? "*Use Case AI* — riepilogo"
        : "*Contributo* — riepilogo",
    "",
    `*Titolo:* ${draft.title ? truncate(draft.title, 200) : "—"}`,
    `*Problema / prima:* ${draft.problem ? truncate(draft.problem, 400) : "—"}`,
    `*Flusso / dopo:* ${draft.flowDescription ? truncate(draft.flowDescription, 400) : "—"}`,
    `*Human in the loop:* ${draft.humanInTheLoop ? truncate(draft.humanInTheLoop, 300) : "—"}`,
  ];

  if (kind === "use_case_ai") {
    lines.push(`*Guardrail:* ${draft.guardrails ? truncate(draft.guardrails, 300) : "—"}`);
    lines.push(`*Urgenza:* ${draft.urgency ?? "—"}`);
  }

  lines.push(`*Impatto / business case:* ${draft.expectedImpact ? truncate(draft.expectedImpact, 400) : "—"}`);
  lines.push(`*Dati / replicabilità:* ${draft.dataRequirements ? truncate(draft.dataRequirements, 300) : "—"}`);
  if (draft.sustainabilityImpact) {
    lines.push(
      `*Impatto ambientale e sociale:* ${truncate(draft.sustainabilityImpact, 400)}`
    );
  }

  return lines.join("\n");
}

export function buildContributionReviewBlocks(params: {
  draft: SlackUseCaseDraft;
  workspaceId: string;
}): unknown[] {
  const { draft, workspaceId } = params;
  const summary = buildContributionReviewSummaryText(draft);
  const encoded = encodeContributionReviewValue({ d: draft.id, w: workspaceId });

  return [
    {
      type: "section",
      text: { type: "mrkdwn", text: summary },
    },
    {
      type: "actions",
      elements: [
        {
          type: "button",
          text: { type: "plain_text", text: "Conferma invio", emoji: true },
          style: "primary",
          action_id: SLACK_CONTRIBUTION_ACTION_CONFIRM,
          value: encoded,
        },
        {
          type: "button",
          text: { type: "plain_text", text: "Modifica", emoji: true },
          action_id: SLACK_CONTRIBUTION_ACTION_EDIT,
          value: encoded,
        },
      ],
    },
  ];
}
