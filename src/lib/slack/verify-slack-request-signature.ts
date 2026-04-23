import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Verifica `X-Slack-Signature` su body raw (come richiesto da Slack).
 * @see https://api.slack.com/authentication/verifying-requests-from-slack
 */
export function verifySlackRequestSignature(params: {
  signingSecret: string;
  rawBody: string;
  requestTimestamp: string | null;
  requestSignature: string | null;
  /** Tolleranza clock skew in secondi (default 300). */
  maxAgeSeconds?: number;
}): boolean {
  const { signingSecret, rawBody, requestTimestamp, requestSignature } = params;
  const maxAge = params.maxAgeSeconds ?? 300;

  if (!requestTimestamp || !requestSignature) return false;

  const ts = Number(requestTimestamp);
  if (!Number.isFinite(ts)) return false;
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - ts) > maxAge) return false;

  const sigBasestring = `v0:${requestTimestamp}:${rawBody}`;
  const hmac = createHmac("sha256", signingSecret)
    .update(sigBasestring, "utf8")
    .digest("hex");
  const expected = `v0=${hmac}`;

  try {
    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(requestSignature, "utf8");
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}
