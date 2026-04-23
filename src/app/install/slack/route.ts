import { NextResponse } from "next/server";
import { getSlackDefaultWorkspaceId } from "@/lib/slack/default-workspace-id";

/**
 * Link unico da condividere: reindirizza a OAuth Slack con `state` corretto.
 * Es. `https://www.theunbundle.com/install/slack`
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const base =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ??
    `${url.protocol}//${url.host}`;

  const id = getSlackDefaultWorkspaceId();
  if (!id) {
    return new NextResponse(
      `<!DOCTYPE html>
<html lang="it"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="font-family:system-ui,sans-serif;padding:2rem;max-width:34rem;line-height:1.5">
<h1>Slack — configurazione mancante</h1>
<p>Imposta su Vercel la variabile <code>SLACK_DEFAULT_WORKSPACE_ID</code> con l’UUID del workspace Unbundle da collegare (es. quello in <code>/dashboard/&lt;uuid&gt;/…</code>).</p>
<p>Poi riapri questo link.</p>
<p><a href="${base}/">Torna alla home</a></p>
</body></html>`,
      {
        status: 503,
        headers: { "Content-Type": "text/html; charset=utf-8" },
      }
    );
  }

  return NextResponse.redirect(
    `${base}/api/slack/install?workspaceId=${encodeURIComponent(id)}`
  );
}
