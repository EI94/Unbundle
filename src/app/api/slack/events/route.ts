import {
  handleSlackWebhookPost,
  slackWebhookMaxDuration,
} from "@/lib/slack/slack-webhook-post";

/** Alias URL per Slack Event Subscriptions (stesso comportamento di `/api/slack/webhooks`). */
export const maxDuration = slackWebhookMaxDuration;

export async function POST(request: Request) {
  return handleSlackWebhookPost(request);
}
