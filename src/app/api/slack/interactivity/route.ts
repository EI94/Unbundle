import { after } from "next/server";
import {
  decodeContributionReviewValue,
  SLACK_CONTRIBUTION_ACTION_CONFIRM,
  SLACK_CONTRIBUTION_ACTION_EDIT,
} from "@/lib/slack/contribution-review-blocks";
import { verifySlackRequestSignature } from "@/lib/slack/verify-slack-request-signature";
import { slackChatPostMessage } from "@/lib/slack/slack-chat-post";
import { submitSlackContributionDraft } from "@/lib/slack/submit-contribution";
import { getDraftById, getSlackInstallationByTeamId } from "@/lib/db/queries/slack";

export const maxDuration = 60;

function getAppBaseUrl(): string | null {
  const explicit = process.env.NEXT_PUBLIC_APP_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return `https://${vercel.replace(/\/$/, "")}`;
  return null;
}

type SlackBlockActionPayload = {
  type: string;
  user?: { id?: string };
  team?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string; thread_ts?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
};

async function handleBlockActions(payload: SlackBlockActionPayload) {
  const userId = payload.user?.id;
  const teamId = payload.team?.id;
  const channelId = payload.channel?.id;
  const action = payload.actions?.[0];
  if (!userId || !teamId || !channelId || !action?.action_id) return;

  const installation = await getSlackInstallationByTeamId(teamId);
  if (!installation?.botToken) {
    console.error("[slack/interactivity] Nessuna installazione/token per team", teamId);
    return;
  }

  const threadTs = payload.message?.thread_ts ?? payload.message?.ts;
  if (!threadTs) {
    console.error("[slack/interactivity] thread_ts/ts mancante nel payload");
    return;
  }

  const decoded = action.value ? decodeContributionReviewValue(action.value) : null;
  if (!decoded) {
    await slackChatPostMessage({
      botToken: installation.botToken,
      channel: channelId,
      threadTs,
      text: "Azione non valida o payload scaduto. Ricomincia il riepilogo dall'agente.",
    }).catch((e) => console.error("[slack/interactivity] postMessage:", e));
    return;
  }

  const draft = await getDraftById(decoded.d);
  if (!draft || draft.workspaceId !== installation.workspaceId || draft.workspaceId !== decoded.w) {
    await slackChatPostMessage({
      botToken: installation.botToken,
      channel: channelId,
      threadTs,
      text: "Non posso elaborare questa richiesta (workspace o draft non coerenti).",
    }).catch((e) => console.error("[slack/interactivity] postMessage:", e));
    return;
  }

  if (action.action_id === SLACK_CONTRIBUTION_ACTION_EDIT) {
    await slackChatPostMessage({
      botToken: installation.botToken,
      channel: channelId,
      threadTs,
      text:
        "Ok, modifichiamo. Scrivi nel thread *cosa* vuoi cambiare (campo e nuovo testo). " +
        "L'agente aggiornerà il draft.",
    }).catch((e) => console.error("[slack/interactivity] postMessage:", e));
    return;
  }

  if (action.action_id !== SLACK_CONTRIBUTION_ACTION_CONFIRM) return;

  const result = await submitSlackContributionDraft({
    draftId: decoded.d,
    actingSlackUserId: userId,
    expectedWorkspaceId: draft.workspaceId,
  });

  if (result.ok) {
    const base = getAppBaseUrl();
    const reviewUrl = base
      ? `${base}/dashboard/${draft.workspaceId}/portfolio/review/${result.useCaseId}`
      : null;
    await slackChatPostMessage({
      botToken: installation.botToken,
      channel: channelId,
      threadTs,
      text:
        `✅ *Grazie!* Ho registrato il contributo.\n` +
        `Titolo: *${result.title}*\n` +
        (reviewUrl ? `\n_${"Link per la valutazione in Unbundle"}:_ ${reviewUrl}` : ""),
    }).catch((e) => console.error("[slack/interactivity] postMessage:", e));
  } else {
    await slackChatPostMessage({
      botToken: installation.botToken,
      channel: channelId,
      threadTs,
      text: `⚠️ Non è stato possibile inviare: ${result.error}`,
    }).catch((e) => console.error("[slack/interactivity] postMessage:", e));
  }
}

export async function POST(request: Request) {
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!signingSecret) {
    return new Response("Slack non configurato", { status: 500 });
  }

  const rawBody = await request.text();
  const ok = verifySlackRequestSignature({
    signingSecret,
    rawBody,
    requestTimestamp: request.headers.get("x-slack-request-timestamp"),
    requestSignature: request.headers.get("x-slack-signature"),
  });

  if (!ok) {
    return new Response("Invalid signature", { status: 401 });
  }

  let payload: SlackBlockActionPayload;
  try {
    const params = new URLSearchParams(rawBody);
    const raw = params.get("payload");
    if (!raw) return new Response("Missing payload", { status: 400 });
    payload = JSON.parse(raw) as SlackBlockActionPayload;
  } catch {
    return new Response("Bad payload", { status: 400 });
  }

  if (payload.type === "block_actions") {
    after(() =>
      handleBlockActions(payload).catch((e) =>
        console.error("[slack/interactivity] handleBlockActions:", e)
      )
    );
  }

  return new Response("", { status: 200 });
}
