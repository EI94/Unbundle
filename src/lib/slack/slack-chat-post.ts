type SlackPostMessageResponse = {
  ok: boolean;
  error?: string;
  ts?: string;
};

/**
 * chat.postMessage (Web API) con token workspace.
 */
export async function slackChatPostMessage(params: {
  botToken: string;
  channel: string;
  text: string;
  threadTs?: string;
  blocks?: unknown[];
}): Promise<SlackPostMessageResponse> {
  const res = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${params.botToken}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({
      channel: params.channel,
      thread_ts: params.threadTs,
      text: params.text,
      blocks: params.blocks,
    }),
  });

  const json = (await res.json()) as SlackPostMessageResponse;
  if (!json.ok) {
    throw new Error(json.error ?? "Slack chat.postMessage failed");
  }
  return json;
}
