import { NextResponse } from "next/server";
import { getSlackAdapter } from "@/lib/slack/bot";
import { upsertSlackInstallation } from "@/lib/db/queries/slack";
import { getSlackDefaultWorkspaceId } from "@/lib/slack/default-workspace-id";
import { slackOAuthRedirectUri } from "@/lib/slack/oauth-redirect-uri";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function oauthMissingStateHtml(baseUrl: string) {
  return `<!DOCTYPE html>
<html lang="it">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/><title>Installazione Slack</title></head>
<body style="font-family:system-ui,sans-serif;max-width:36rem;margin:2rem auto;padding:0 1rem;line-height:1.5">
<h1>Installazione non completata</h1>
<p>Slack non ha restituito il riferimento al workspace Unbundle (<code>state</code> vuoto o non valido). Succede spesso con il pulsante “Add to Slack” fuori da Unbundle.</p>
<p><strong>Cosa fare:</strong> accedi a Unbundle, apri il workspace giusto e vai su <strong>Integrazioni</strong> → <strong>Installa su Slack</strong>, oppure apri <a href="${baseUrl}/install/slack"><code>/install/slack</code></a> (dopo il login scegli il workspace se ne hai più di uno).</p>
<p>Se usi un deploy single-tenant, l’admin può ancora impostare <code>SLACK_DEFAULT_WORKSPACE_ID</code> su Vercel come ripiego.</p>
<p><a href="${baseUrl}/dashboard">Dashboard Unbundle</a></p>
</body></html>`;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const { searchParams } = url;
  const code = searchParams.get("code");
  const stateRaw = searchParams.get("state");
  const workspaceId = stateRaw?.trim() ?? "";
  const error = searchParams.get("error");
  /** Stesso host della richiesta così cookie sessione e www/apex restano coerenti. */
  const appOrigin = url.origin;

  if (error) {
    const ws = workspaceId && UUID_RE.test(workspaceId) ? workspaceId : "";
    return NextResponse.redirect(
      ws
        ? `${appOrigin}/dashboard/${ws}/settings?slack_error=${encodeURIComponent(error)}`
        : `${appOrigin}/dashboard?slack_error=${encodeURIComponent(error)}`
    );
  }

  if (!code) {
    return NextResponse.redirect(
      `${appOrigin}/dashboard?slack_error=${encodeURIComponent("missing_code")}`
    );
  }

  const fallback = getSlackDefaultWorkspaceId();
  const effectiveWorkspaceId =
    workspaceId && UUID_RE.test(workspaceId)
      ? workspaceId
      : fallback && UUID_RE.test(fallback)
        ? fallback
        : "";

  if (!effectiveWorkspaceId) {
    return new NextResponse(oauthMissingStateHtml(appOrigin), {
      status: 400,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const redirectUri = slackOAuthRedirectUri(request);

  try {
    const adapter = getSlackAdapter();
    const { teamId, installation } = await adapter.handleOAuthCallback(
      request,
      { redirectUri }
    );

    await upsertSlackInstallation({
      workspaceId: effectiveWorkspaceId,
      slackTeamId: teamId,
      slackTeamName: installation.teamName ?? null,
      botToken: installation.botToken,
      installedBy: null,
    });

    return NextResponse.redirect(
      `${appOrigin}/dashboard/${effectiveWorkspaceId}/settings?slack=installed`
    );
  } catch (err) {
    console.error("[slack/oauth] OAuth callback error:", err);
    const raw =
      err instanceof Error
        ? err.message
        : typeof err === "object" && err !== null && "message" in err
          ? String((err as { message: unknown }).message)
          : "oauth_failed";
    const safe = raw
      .slice(0, 160)
      .replace(/[^\w\s:./-]/g, " ")
      .trim()
      .replace(/\s+/g, " ");
    const q = safe ? encodeURIComponent(safe) : "oauth_failed";
    return NextResponse.redirect(
      `${appOrigin}/dashboard/${effectiveWorkspaceId}/settings?slack_error=${q}`
    );
  }
}
