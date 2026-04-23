import { after } from "next/server";
import { getBot } from "@/lib/slack/bot";
import { verifySlackRequestSignature } from "./verify-slack-request-signature";

/**
 * Handler condiviso per eventi Slack (URL primaria e alias `/api/slack/events`).
 * `url_verification` deve rispondere in modo **sincrono** con il solo `challenge` in testo
 * piano; delegare al Chat SDK con `after()` fa fallire la verifica Slack.
 * Le route devono esportare `maxDuration` come letterale (requisito Next.js 16).
 */
export async function handleSlackWebhookPost(
  request: Request
): Promise<Response> {
  const rawBody = await request.text();
  const signingSecret = process.env.SLACK_SIGNING_SECRET?.trim();

  if (signingSecret) {
    const ok = verifySlackRequestSignature({
      signingSecret,
      rawBody,
      requestTimestamp: request.headers.get("x-slack-request-timestamp"),
      requestSignature: request.headers.get("x-slack-signature"),
    });
    if (!ok) {
      return new Response("Invalid signature", { status: 401 });
    }
  } else if (process.env.NODE_ENV === "production") {
    return new Response("SLACK_SIGNING_SECRET non configurato", { status: 503 });
  }

  let payload: { type?: string; challenge?: string };
  try {
    payload = JSON.parse(rawBody) as { type?: string; challenge?: string };
  } catch {
    return new Response("Bad JSON", { status: 400 });
  }

  if (
    payload.type === "url_verification" &&
    typeof payload.challenge === "string"
  ) {
    return new Response(payload.challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  const bot = getBot();
  const forwarded = new Request(request.url, {
    method: "POST",
    headers: request.headers,
    body: rawBody,
  });

  return bot.webhooks.slack(forwarded, {
    waitUntil: (task) => after(() => task),
  });
}
