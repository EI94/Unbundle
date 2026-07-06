import { NextResponse, type NextRequest } from "next/server";
import {
  SLACK_WORKSPACE_CONTEXT_COOKIE,
  SLACK_WORKSPACE_CONTEXT_MAX_AGE,
} from "@/lib/slack/workspace-context-cookie";
import { safeInternalCallbackUrl } from "@/lib/navigation/safe-callback-url";
import {
  buildPortfolioSharePath,
  parsePortfolioReviewPath,
} from "@/lib/portfolio/share-link";

const SESSION_COOKIE = "__session";

function nextWithPath(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-unbundle-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

function signedPortfolioShareUrl(req: NextRequest, workspaceId: string, useCaseId: string) {
  try {
    return new URL(buildPortfolioSharePath(workspaceId, useCaseId), req.url);
  } catch {
    return null;
  }
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = req.cookies.has(SESSION_COOKIE);
  const reviewPath = parsePortfolioReviewPath(pathname);

  const isAuthPage = pathname === "/login" || pathname === "/register";
  const isProtected = pathname.startsWith("/dashboard");
  const isInstallSlack =
    pathname === "/install/slack" || pathname === "/install/slack/";

  if ((isProtected || isInstallSlack) && !hasSession) {
    if (reviewPath) {
      const shareUrl = signedPortfolioShareUrl(
        req,
        reviewPath.workspaceId,
        reviewPath.useCaseId
      );
      if (shareUrl) return NextResponse.redirect(shareUrl);
    }

    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname.replace(/\/$/, "") || "/");
    return NextResponse.redirect(loginUrl);
  }

  if (isAuthPage && hasSession) {
    // Cookie presente ma sessione rifiutata lato server (revocata o utente
    // eliminato): mostra il login e cancella il cookie, altrimenti il
    // rimbalzo /login → /dashboard → /login diventa un loop infinito.
    if (req.nextUrl.searchParams.get("session") === "stale") {
      const res = nextWithPath(req);
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    const raw = req.nextUrl.searchParams.get("callbackUrl");
    const safe = safeInternalCallbackUrl(raw);
    if (safe) {
      return NextResponse.redirect(new URL(safe, req.url));
    }
    return NextResponse.redirect(new URL("/dashboard", req.url));
  }

  const dashWs = pathname.match(/^\/dashboard\/([0-9a-f-]{36})/i);
  if (dashWs?.[1] && hasSession) {
    const res = nextWithPath(req);
    res.cookies.set(SLACK_WORKSPACE_CONTEXT_COOKIE, dashWs[1], {
      path: "/",
      maxAge: SLACK_WORKSPACE_CONTEXT_MAX_AGE,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
    });
    return res;
  }

  return nextWithPath(req);
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/register", "/install/slack"],
};
