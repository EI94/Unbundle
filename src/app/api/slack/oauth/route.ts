import { NextResponse } from "next/server";
import { getSlackAdapter } from "@/lib/slack/bot";
import { upsertSlackInstallation } from "@/lib/db/queries/slack";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const workspaceId = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    return NextResponse.redirect(
      `${baseUrl}/dashboard/${workspaceId ?? ""}?slack_error=${error}`
    );
  }

  if (!code || !workspaceId) {
    return NextResponse.json(
      { error: "Parametri mancanti (code, state)" },
      { status: 400 }
    );
  }

  try {
    const adapter = getSlackAdapter();
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;

    const { teamId, installation } = await adapter.handleOAuthCallback(
      request,
      { redirectUri: `${baseUrl}/api/slack/oauth` }
    );

    await upsertSlackInstallation({
      workspaceId,
      slackTeamId: teamId,
      slackTeamName: installation.teamName ?? null,
      botToken: installation.botToken,
      installedBy: null,
    });

    return NextResponse.redirect(
      `${baseUrl}/dashboard/${workspaceId}/settings?slack=installed`
    );
  } catch (err) {
    console.error("[slack/oauth] OAuth callback error:", err);
    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
    return NextResponse.redirect(
      `${baseUrl}/dashboard/${workspaceId}?slack_error=oauth_failed`
    );
  }
}
