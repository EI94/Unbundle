import { after } from "next/server";
import { getBot } from "@/lib/slack/bot";

export const slackWebhookMaxDuration = 120;

/**
 * Handler condiviso per eventi Slack (URL primaria e alias `/api/slack/events`).
 */
export function handleSlackWebhookPost(request: Request) {
  const bot = getBot();
  return bot.webhooks.slack(request, {
    waitUntil: (task) => after(() => task),
  });
}
