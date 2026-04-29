import type { Message, Thread } from "chat";
import {
  getLatestOpenDraftForSlackConversation,
  getOrCreateDraft,
  updateDraft,
} from "@/lib/db/queries/slack";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import type { NewSlackUseCaseDraft, SlackUseCaseDraft } from "@/lib/db/schema";
import {
  getMissingSlackDraftFields,
  submitSlackContributionDraft,
} from "./submit-contribution";
import {
  detectContributionKind,
  normalizeDraftFieldValue,
  questionForSlackDraftField,
  requiredSlackDraftFields,
  resolveSlackDraftThreadTs,
  sanitizeSlackBotText,
  slackDraftFieldLabel,
  stripSlackMention,
  truncate,
  validateSlackDraftAnswer,
  type SlackDraftField,
  type SlackPortfolioKind,
} from "./use-case-agent-utils";
import { tryBuildPortfolioShareUrl } from "@/lib/portfolio/share-link";

const SLACK_CHANNEL_CONVERSATION_WINDOW_MS = 8 * 60 * 60 * 1000;

function isWrittenConfirmation(text: string) {
  return /^(confermo|ok|va bene|s[ìi]|si|procedi|invia|salva|sottometti)\b/i.test(
    text.trim()
  );
}

function requiredFields(kind: SlackPortfolioKind, esgEnabled: boolean) {
  return requiredSlackDraftFields(kind, esgEnabled);
}

function draftValue(draft: SlackUseCaseDraft, field: SlackDraftField) {
  return draft[field];
}

function firstMissingField(
  draft: SlackUseCaseDraft,
  kind: SlackPortfolioKind,
  esgEnabled: boolean
) {
  return requiredFields(kind, esgEnabled).find((field) => {
    const value = draftValue(draft, field);
    return !value || String(value).trim().length === 0;
  });
}

function savedAck(field: SlackDraftField, kind: SlackPortfolioKind, value: string) {
  if (field === "title") return `Perfetto, titolo registrato: ${value}.`;
  return `Perfetto, ho registrato il campo ${slackDraftFieldLabel(field, kind)}.`;
}

function routeQuestion() {
  return (
    "Ciao, raccolgo il tuo contributo per il portfolio Unbundle.\n\n" +
    "Vuoi condividere una best practice che avete gia migliorato con l'AI, " +
    "oppure vuoi segnalare un'idea per applicare l'AI a un processo, servizio o prodotto?"
  );
}

function completionSummary(draft: SlackUseCaseDraft, kind: SlackPortfolioKind) {
  const heading =
    kind === "best_practice"
      ? "Ho raccolto la best practice."
      : "Ho raccolto lo use case AI.";
  const lines = [
    heading,
    `Titolo: ${draft.title ?? "-"}`,
    `Problema: ${truncate(draft.problem ?? "-", 180)}`,
    `Impatto: ${truncate(draft.expectedImpact ?? "-", 180)}`,
  ];
  if (draft.sustainabilityImpact) {
    lines.push(
      `Impatto ambientale e sociale: ${truncate(draft.sustainabilityImpact, 180)}`
    );
  }
  return lines.join("\n");
}

function appBaseUrl() {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return null;
}

async function post(thread: Thread, text: string) {
  await thread.post(sanitizeSlackBotText(text));
}

function questionForDraft(
  draft: SlackUseCaseDraft,
  field: SlackDraftField,
  kind: SlackPortfolioKind
) {
  return questionForSlackDraftField(field, kind, {
    title: draft.title,
    problem: draft.problem,
    flowDescription: draft.flowDescription,
    humanInTheLoop: draft.humanInTheLoop,
    guardrails: draft.guardrails,
    expectedImpact: draft.expectedImpact,
    dataRequirements: draft.dataRequirements,
    urgency: draft.urgency,
    sustainabilityImpact: draft.sustainabilityImpact,
  });
}

async function submitCompletedDraft(params: {
  thread: Thread;
  draft: SlackUseCaseDraft;
  kind: SlackPortfolioKind;
  slackUserId: string;
  workspaceId: string;
}) {
  const result = await submitSlackContributionDraft({
    draftId: params.draft.id,
    actingSlackUserId: params.slackUserId,
    expectedWorkspaceId: params.workspaceId,
  });

  if (!result.ok) {
    console.error("[slack/use-case-agent] submit failed:", {
      draftId: params.draft.id,
      workspaceId: params.workspaceId,
      error: result.error,
    });
    await post(
      params.thread,
      "Ho raccolto tutte le informazioni, ma non sono riuscito a registrare il contributo nel portfolio. " +
        "Il draft resta salvato: scrivi 'confermo' tra poco e riprovo l'invio."
    );
    return;
  }

  const base = appBaseUrl();
  const reviewUrl = base
    ? tryBuildPortfolioShareUrl(base, params.workspaceId, result.useCaseId)
    : null;
  await post(
    params.thread,
    `${completionSummary(params.draft, params.kind)}\n\n` +
      "Grazie, ho registrato il contributo nel portfolio Unbundle. " +
      "Ora il team lo vede in Raccolta e ranking." +
      (reviewUrl ? `\nScheda Unbundle: ${reviewUrl}` : "")
  );
}

export async function handleUseCaseConversation(
  thread: Thread,
  message: Message,
  workspaceId: string,
  opts: { slackTeamId?: string } = {}
) {
  const slackUserId = message.author?.userId ?? "unknown";
  const raw = message.raw as Record<string, string | undefined>;
  const teamId = opts.slackTeamId ?? raw.user_team ?? raw.team_id ?? raw.team ?? "";
  const slackChannelId = raw.channel ?? "";
  const explicitThreadTs = raw.thread_ts?.trim() || null;
  const activeDraft =
    !explicitThreadTs && slackChannelId && teamId && slackUserId !== "unknown"
      ? await getLatestOpenDraftForSlackConversation({
          workspaceId,
          slackUserId,
          slackTeamId: teamId,
          slackChannelId,
          updatedAfter: new Date(Date.now() - SLACK_CHANNEL_CONVERSATION_WINDOW_MS),
        })
      : null;
  const slackThreadRootTs = resolveSlackDraftThreadTs({
    raw,
    activeDraftThreadTs: activeDraft?.slackThreadTs ?? null,
  });
  const userText = stripSlackMention(message.text ?? "");

  const workspace = await getWorkspaceById(workspaceId);
  const esgEnabled = workspace?.esgEnabled === true;
  const slackContextPatch = (): Partial<NewSlackUseCaseDraft> => ({
    reminder24hSentAt: null,
    ...(slackChannelId ? { slackChannelId } : {}),
    ...(slackThreadRootTs ? { slackThreadTs: slackThreadRootTs } : {}),
  });

  let draft = await getOrCreateDraft(
    workspaceId,
    slackUserId,
    teamId,
    slackThreadRootTs || undefined,
    null
  );

  await updateDraft(draft.id, slackContextPatch(), { touchUpdatedAt: false });
  draft = { ...draft, ...slackContextPatch() };

  if (!userText) {
    const kind = draft.contributionKind as SlackPortfolioKind | null;
    const next = kind ? firstMissingField(draft, kind, esgEnabled) : null;
    await post(
      thread,
      next && kind ? questionForDraft(draft, next, kind) : routeQuestion()
    );
    return;
  }

  let kind = draft.contributionKind as SlackPortfolioKind | null;
  if (!kind) {
    kind = detectContributionKind(userText);
    if (!kind) {
      await post(thread, routeQuestion());
      return;
    }

    draft = await updateDraft(draft.id, {
      ...slackContextPatch(),
      contributionKind: kind,
      ...(kind === "best_practice" ? { guardrails: null, urgency: null } : {}),
    });

    await post(
      thread,
      (kind === "best_practice"
        ? "Perfetto. Raccogliamo una best practice."
        : "Perfetto. Raccogliamo un use case AI.") +
        `\n\n${questionForDraft(draft, "title", kind)}`
    );
    return;
  }

  const missingBefore = firstMissingField(draft, kind, esgEnabled);
  if (!missingBefore) {
    if (isWrittenConfirmation(userText)) {
      await submitCompletedDraft({
        thread,
        draft,
        kind,
        slackUserId,
        workspaceId,
      });
      return;
    }

    await post(
      thread,
      "Il contributo è già completo. Scrivi 'confermo' se vuoi reinviare il salvataggio nel portfolio."
    );
    return;
  }

  const validation = validateSlackDraftAnswer(missingBefore, kind, userText);
  if (!validation.ok) {
    console.info("[slack/use-case-agent] answer rejected:", {
      draftId: draft.id,
      workspaceId,
      kind,
      field: missingBefore,
      textLength: userText.length,
    });
    await post(
      thread,
      `${validation.message}\n\n${questionForDraft(draft, missingBefore, kind)}`
    );
    return;
  }

  const normalizedValue = normalizeDraftFieldValue(missingBefore, userText);
  draft = await updateDraft(draft.id, {
    ...slackContextPatch(),
    [missingBefore]: normalizedValue,
  });
  console.info("[slack/use-case-agent] field saved:", {
    draftId: draft.id,
    workspaceId,
    kind,
    field: missingBefore,
  });

  const missing = getMissingSlackDraftFields(draft, kind, { esgEnabled });
  if (missing.length === 0) {
    await submitCompletedDraft({
      thread,
      draft,
      kind,
      slackUserId,
      workspaceId,
    });
    return;
  }

  const nextField = firstMissingField(draft, kind, esgEnabled);
  await post(
    thread,
    `${savedAck(missingBefore, kind, normalizedValue)}\n\n${
      nextField ? questionForDraft(draft, nextField, kind) : ""
    }`
  );
}
