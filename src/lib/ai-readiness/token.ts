import { createHash, randomBytes } from "crypto";

export function createInviteToken() {
  return `air_${randomBytes(24).toString("base64url")}`;
}

export function hashInviteToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function createPseudonymousId(seed: string) {
  return createHash("sha256")
    .update(`ai-readiness:${seed}`)
    .digest("hex")
    .slice(0, 24);
}
