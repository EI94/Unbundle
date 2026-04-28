import { createHmac, timingSafeEqual } from "crypto";

const SHARE_VERSION = "v1";

function getShareSecret() {
  return (
    process.env.PORTFOLIO_SHARE_SECRET?.trim() ||
    process.env.SLACK_SIGNING_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    null
  );
}

function payloadForWorkspace(workspaceId: string) {
  return `portfolio-share:${SHARE_VERSION}:${workspaceId}`;
}

export function createPortfolioShareToken(
  workspaceId: string,
  secret = getShareSecret()
) {
  if (!secret) {
    throw new Error(
      "PORTFOLIO_SHARE_SECRET or SLACK_SIGNING_SECRET is required to create portfolio share links."
    );
  }
  return createHmac("sha256", secret)
    .update(payloadForWorkspace(workspaceId))
    .digest("base64url");
}

export function verifyPortfolioShareToken(
  workspaceId: string,
  token: string | null | undefined,
  secret = getShareSecret()
) {
  if (!secret || !token) return false;
  try {
    const expected = createPortfolioShareToken(workspaceId, secret);
    const expectedBuffer = Buffer.from(expected, "utf8");
    const tokenBuffer = Buffer.from(token, "utf8");
    return (
      expectedBuffer.length === tokenBuffer.length &&
      timingSafeEqual(expectedBuffer, tokenBuffer)
    );
  } catch {
    return false;
  }
}

export function buildPortfolioSharePath(
  workspaceId: string,
  useCaseId: string,
  opts?: { token?: string }
) {
  const token = opts?.token ?? createPortfolioShareToken(workspaceId);
  return `/share/portfolio/${encodeURIComponent(workspaceId)}/${encodeURIComponent(
    useCaseId
  )}?token=${encodeURIComponent(token)}`;
}

export function buildPortfolioShareUrl(
  baseUrl: string,
  workspaceId: string,
  useCaseId: string,
  opts?: { token?: string }
) {
  return `${baseUrl.replace(/\/$/, "")}${buildPortfolioSharePath(
    workspaceId,
    useCaseId,
    opts
  )}`;
}

export function tryBuildPortfolioShareUrl(
  baseUrl: string,
  workspaceId: string,
  useCaseId: string,
  opts?: { token?: string }
) {
  try {
    return buildPortfolioShareUrl(baseUrl, workspaceId, useCaseId, opts);
  } catch {
    return null;
  }
}

export function parsePortfolioReviewPath(pathname: string) {
  const match = pathname.match(
    /^\/dashboard\/([0-9a-f-]{36})\/portfolio\/review\/([0-9a-f-]{36})\/?$/i
  );
  if (!match) return null;
  return { workspaceId: match[1], useCaseId: match[2] };
}
