import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { getSlackDefaultWorkspaceId } from "@/lib/slack/default-workspace-id";
import {
  SLACK_WORKSPACE_CONTEXT_COOKIE,
  isUuid,
} from "@/lib/slack/workspace-context-cookie";
import { userHasWorkspaceAccess } from "@/lib/slack/install-access";
import { getWorkspacesForUser } from "@/lib/db/queries/workspaces";

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function pickWorkspaceHtml(
  base: string,
  items: { id: string; name: string; organizationName: string }[]
) {
  const rows = items
    .map(
      (w) => `<li style="margin:0.75rem 0">
<a href="${base}/api/slack/install?workspaceId=${encodeURIComponent(w.id)}" style="color:#a78bfa;font-weight:500">${escapeHtml(w.name)}</a>
<span style="color:#888;font-size:0.85rem"> — ${escapeHtml(w.organizationName)}</span>
</li>`
    )
    .join("");
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:36rem;line-height:1.5;background:#0a0a0a;color:#eee">
<h1 style="font-size:1.25rem">Collega Slack</h1>
<p style="color:#aaa">Scegli il workspace Unbundle da associare all’app Slack. Poi autorizza l’installazione su Slack.</p>
<ul style="list-style:none;padding:0;margin:1rem 0">${rows}</ul>
<p style="margin-top:1.5rem"><a href="${base}/dashboard" style="color:#888">Torna alla dashboard</a></p>
</body></html>`;
}

function noWorkspaceHtml(base: string) {
  return `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:34rem;line-height:1.5;background:#0a0a0a;color:#eee">
<h1 style="font-size:1.25rem">Nessun workspace</h1>
<p style="color:#aaa">Crea prima un workspace in Unbundle, poi torna qui o apri <strong>Integrazioni</strong> dal menu del workspace.</p>
<p><a href="${base}/dashboard" style="color:#a78bfa">Vai alla dashboard</a></p>
</body></html>`;
}

/**
 * Entry point “Add to Slack” / link condiviso: reindirizza a OAuth con `state` = workspace corretto.
 * Usa: query `workspaceId`, cookie ultimo workspace, un solo workspace dell’utente, oppure env legacy.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ??
    `${url.protocol}//${url.host}`;

  const session = await auth();
  if (!session?.user?.id) {
    const login = new URL("/login", base);
    login.searchParams.set("callbackUrl", "/install/slack");
    return NextResponse.redirect(login);
  }

  const userId = session.user.id;
  const q = url.searchParams.get("workspaceId")?.trim() ?? "";
  const cookieStore = await cookies();
  const fromCookie =
    cookieStore.get(SLACK_WORKSPACE_CONTEXT_COOKIE)?.value?.trim() ?? "";

  const candidates: string[] = [];
  if (isUuid(q)) candidates.push(q);
  if (isUuid(fromCookie) && fromCookie !== q) candidates.push(fromCookie);

  for (const id of candidates) {
    if (await userHasWorkspaceAccess(userId, id)) {
      return NextResponse.redirect(
        `${base}/api/slack/install?workspaceId=${encodeURIComponent(id)}`
      );
    }
  }

  const envFallback = getSlackDefaultWorkspaceId().trim();
  if (isUuid(envFallback) && (await userHasWorkspaceAccess(userId, envFallback))) {
    return NextResponse.redirect(
      `${base}/api/slack/install?workspaceId=${encodeURIComponent(envFallback)}`
    );
  }

  const all = await getWorkspacesForUser(userId);
  if (all.length === 0) {
    return new NextResponse(noWorkspaceHtml(base), {
      status: 404,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  if (all.length === 1) {
    const only = all[0]!;
    return NextResponse.redirect(
      `${base}/api/slack/install?workspaceId=${encodeURIComponent(only.id)}`
    );
  }

  return new NextResponse(pickWorkspaceHtml(base, all), {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
