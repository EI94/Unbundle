import { after } from "next/server";
import { getBot } from "@/lib/slack/bot";

export const maxDuration = 120;

export async function POST(request: Request) {
  const bot = getBot();
  return bot.webhooks.slack(request, {
    waitUntil: (task) => after(() => task),
  });
}
