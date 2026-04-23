import { after } from "next/server";
import { getBot } from "@/lib/slack/bot";

/**
 * Handler condiviso per eventi Slack (URL primaria e alias `/api/slack/events`).
 * Le route devono esportare `maxDuration` come letterale (requisito Next.js 16).
 */
export function handleSlackWebhookPost(request: Request) {
  const bot = getBot();
  return bot.webhooks.slack(request, {
    waitUntil: (task) => after(() => task),
  });
}
