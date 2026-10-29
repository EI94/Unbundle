import { NextResponse, type NextRequest } from "next/server";
import {
  SLACK_WORKSPACE_CONTEXT_COOKIE,
  SLACK_WORKSPACE_CONTEXT_MAX_AGE,
} from "@/lib/slack/workspace-context-cookie";
import { safeInternalCallbackUrl } from "@/lib/navigation/safe-callback-url";
import {
  isSessionCookieExpired,
  SESSION_COOKIE_NAME,
  STALE_SESSION_PARAM,
  STALE_SESSION_VALUE,
} from "@/lib/auth/session-signal";
import { legacyRouteRedirect, stubLogEntry } from "@/lib/use-cases/legacy-routes";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";

const SESSION_COOKIE = SESSION_COOKIE_NAME;

function nextWithPath(req: NextRequest) {
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-unbundle-pathname", req.nextUrl.pathname);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const sessionCookie = req.cookies.get(SESSION_COOKIE)?.value;
  // Un cookie scaduto/malformato è riconoscibile senza roundtrip (claim exp,
  // non è una verifica di firma: serve solo a cancellarlo, mai a dare accesso)
  // e va trattato come assenza di sessione, altrimenti /login ↔ /dashboard
  // rimbalzano all'infinito.
  const cookieExpired =
    sessionCookie != null && isSessionCookieExpired(sessionCookie);
  const hasSession = sessionCookie != null && !cookieExpired;
  const cleanup = (res: NextResponse) => {
    if (cookieExpired) res.cookies.delete(SESSION_COOKIE);
    return res;
  };

  const isAuthPage = pathname === "/login" || pathname === "/register";
  const isProtected = pathname.startsWith("/dashboard");
  const isInstallSlack =
    pathname === "/install/slack" || pathname === "/install/slack/";

  if ((isProtected || isInstallSlack) && !hasSession) {
    // Anche i vecchi link di revisione arrivati su Slack passano dal login:
    // generare qui un link pubblico lo darebbe a chiunque conosca due ID.
    const loginUrl = new URL("/login", req.url);
    loginUrl.searchParams.set("callbackUrl", pathname.replace(/\/$/, "") || "/");
    if (cookieExpired) {
      loginUrl.searchParams.set(STALE_SESSION_PARAM, STALE_SESSION_VALUE);
    }
    return cleanup(NextResponse.redirect(loginUrl));
  }

  if (isAuthPage && hasSession) {
    // Cookie presente ma sessione rifiutata lato server (revocata o utente
    // eliminato): mostra il login e cancella il cookie, altrimenti il
    // rimbalzo /login → /dashboard → /login diventa un loop infinito.
    if (
      req.nextUrl.searchParams.get(STALE_SESSION_PARAM) === STALE_SESSION_VALUE
    ) {
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
  // «Avvia la realizzazione» senza uno use case (docs/use-case/DESIGN.md §2.3, §2.4; PIANO-LAVORI
  // H6a): con l'area «Use case» accesa si sceglie lo use case nella Panoramica. Qui e non in pagina,
  // che sta sotto `casi-duso/loading.tsx` (un 307 lì sarebbe un 200 con una meta refresh). Solo
  // l'interruttore del workspace, senza database; la pagina ricontrolla chi può avviare.
  if (dashWs?.[1] && hasSession && /^\/dashboard\/[^/]+\/casi-duso\/nuovo\/?$/.test(pathname) && isUseCaseHubWorkspace(dashWs[1])) {
    const legacy = legacyRouteRedirect(pathname.replace(/\/$/, ""), req.nextUrl.searchParams);
    if (legacy) {
      console.info(JSON.stringify(stubLogEntry(legacy.from)));
      return NextResponse.redirect(new URL(legacy.to, req.url), 307);
    }
  }
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

  return cleanup(nextWithPath(req));
}

export const config = {
  matcher: ["/dashboard/:path*", "/login", "/register", "/install/slack"],
};
