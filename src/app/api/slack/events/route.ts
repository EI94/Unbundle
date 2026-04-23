import { handleSlackWebhookPost } from "@/lib/slack/slack-webhook-post";

/** Alias URL per Slack Event Subscriptions (stesso comportamento di `/api/slack/webhooks`). */
export const maxDuration = 120;

export async function POST(request: Request) {
  return handleSlackWebhookPost(request);
}
