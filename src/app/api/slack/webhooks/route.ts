import { handleSlackWebhookPost } from "@/lib/slack/slack-webhook-post";

export const maxDuration = 120;

export async function POST(request: Request) {
  return handleSlackWebhookPost(request);
}
