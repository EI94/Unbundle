import { createHmac, timingSafeEqual } from "crypto";

/**
 * Link pubblici in sola lettura al portfolio, mandati su Slack e ai webhook.
 *
 * v2: il link scade (PORTFOLIO_SHARE_TTL_DAYS) e porta il contatore di revoca
 * del workspace: alzarlo (rimozione di un membro, o «Disattiva i link
 * pubblici») invalida tutti i link già condivisi. I token v1 erano uguali per
 * tutto il workspace, senza scadenza e non revocabili: non sono più accettati.
 * Chi ha un account con accesso al workspace entra comunque dal login.
 */

const SHARE_VERSION = "v2";
export const PORTFOLIO_SHARE_TTL_DAYS = 30;

function getShareSecret() {
  return (
    process.env.PORTFOLIO_SHARE_SECRET?.trim() ||
    process.env.SLACK_SIGNING_SECRET?.trim() ||
    process.env.AUTH_SECRET?.trim() ||
    process.env.NEXTAUTH_SECRET?.trim() ||
    null
  );
}

function sign(secret: string, workspaceId: string, epoch: number, exp: number) {
  return createHmac("sha256", secret)
    .update(`portfolio-share:${SHARE_VERSION}:${workspaceId}:${epoch}:${exp}`)
    .digest("base64url");
}

type ShareOptions = { epoch?: number; now?: number; secret?: string | null };

export function createPortfolioShareToken(
  workspaceId: string,
  { epoch = 0, now = Date.now(), secret = getShareSecret() }: ShareOptions = {}
) {
  if (!secret) {
    throw new Error(
      "PORTFOLIO_SHARE_SECRET or SLACK_SIGNING_SECRET is required to create portfolio share links."
    );
  }
  const exp = Math.floor(now / 1000) + PORTFOLIO_SHARE_TTL_DAYS * 86_400;
  return `${exp}.${sign(secret, workspaceId, epoch, exp)}`;
}

export type ShareTokenCheck = { ok: true; expiresAt: Date } | { ok: false; reason: "invalid" | "expired" };

export function verifyPortfolioShareToken(
  workspaceId: string,
  token: string | null | undefined,
  { epoch = 0, now = Date.now(), secret = getShareSecret() }: ShareOptions = {}
): ShareTokenCheck {
  if (!secret || !token) return { ok: false, reason: "invalid" };
  const match = /^(\d{9,12})\.([A-Za-z0-9_-]{43})$/.exec(token);
  if (!match) return { ok: false, reason: "invalid" };
  const exp = Number(match[1]);
  try {
    const expected = Buffer.from(sign(secret, workspaceId, epoch, exp), "utf8");
    const given = Buffer.from(match[2], "utf8");
    if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
      return { ok: false, reason: "invalid" };
    }
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (exp * 1000 <= now) return { ok: false, reason: "expired" };
  return { ok: true, expiresAt: new Date(exp * 1000) };
}

export function buildPortfolioSharePath(
  workspaceId: string,
  useCaseId: string,
  opts: { token?: string; epoch?: number } = {}
) {
  const token = opts.token ?? createPortfolioShareToken(workspaceId, { epoch: opts.epoch });
  return `/share/portfolio/${encodeURIComponent(workspaceId)}/${encodeURIComponent(
    useCaseId
  )}?token=${encodeURIComponent(token)}`;
}

export function buildPortfolioShareUrl(
  baseUrl: string,
  workspaceId: string,
  useCaseId: string,
  opts: { token?: string; epoch?: number } = {}
) {
  return `${baseUrl.replace(/\/$/, "")}${buildPortfolioSharePath(workspaceId, useCaseId, opts)}`;
}

export function tryBuildPortfolioShareUrl(
  baseUrl: string,
  workspaceId: string,
  useCaseId: string,
  opts: { token?: string; epoch?: number } = {}
) {
  try {
    return buildPortfolioShareUrl(baseUrl, workspaceId, useCaseId, opts);
  } catch {
    return null;
  }
}
