import { NextResponse } from "next/server";
import { getSlackAdapter } from "@/lib/slack/bot";
import { upsertSlackInstallation } from "@/lib/db/queries/slack";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oauthMissingStateHtml(baseUrl: string) {
  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Installazione Slack</title></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem;line-height:1.5">
<h1>Installazione non completata</h1>
<p>Il collegamento a Slack non include il <strong>progetto Unbundle</strong> da associare (<code>state</code> vuoto o non valido).</p>
<p><strong>Cosa fare:</strong> accedi a Unbundle → apri il <strong>workspace</strong> giusto → <strong>Impostazioni</strong> → clicca <strong>Installa su Slack</strong>. Non usare il solo pulsante “Add to Slack” dalla pagina Slack API senza passare da lì.</p>
<p>Per installare su un altro workspace Slack (es. NATIVA): nella schermata di consenso Slack scegli il <strong>workspace</strong> dal menu in alto a sinistra prima di “Consenti”.</p>
<p><a href="${baseUrl}/dashboard">Vai alla dashboard Unbundle</a></p>
</body></html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { searchParams } = url;
  const code = searchParams.get("code");
  const stateRaw = searchParams.get("state");
  const workspaceId = stateRaw?.trim() ?? "";
  const error = searchParams.get("error");
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ??
    `${url.protocol}//${url.host}`;

  if (error) {
    const ws = workspaceId && UUID_RE.test(workspaceId) ? workspaceId : "";
    return NextResponse.redirect(
      ws
        ? `${baseUrl}/dashboard/${ws}/settings?slack_error=${encodeURIComponent(error)}`
        : `${baseUrl}/dashboard?slack_error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${baseUrl}/dashboard?slack_error=${encodeURIComponent("missing_code")}`
    );
  }

  const fallback = process.env.SLACK_OAUTH_FALLBACK_WORKSPACE_ID?.trim() ?? "";
  const effectiveWorkspaceId =
    workspaceId && UUID_RE.test(workspaceId)
      ? workspaceId
      : fallback && UUID_RE.test(fallback)
        ? fallback
        : "";

  if (!effectiveWorkspaceId) {
    return new NextResponse(oauthMissingStateHtml(baseUrl), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  try {
    const adapter = getSlackAdapter();
    const { teamId, installation } = await adapter.handleOAuthCallback(
      request,
      { redirectUri: `${baseUrl}/api/slack/oauth` }
    );

    await upsertSlackInstallation({
      workspaceId: effectiveWorkspaceId,
      slackTeamId: teamId,
      slackTeamName: installation.teamName ?? null,
      botToken: installation.botToken,
      installedBy: null,
    });

    return NextResponse.redirect(
      `${baseUrl}/dashboard/${effectiveWorkspaceId}/settings?slack=installed`
    );
  } catch (err) {
    console.error("[slack/oauth] OAuth callback error:", err);
    return NextResponse.redirect(
      `${baseUrl}/dashboard/${effectiveWorkspaceId}?slack_error=oauth_failed`
    );
  }
}
