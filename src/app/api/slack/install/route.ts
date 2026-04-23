import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { userHasWorkspaceAccess } from "@/lib/slack/install-access";
import { isUuid } from "@/lib/slack/workspace-context-cookie";
import { slackOAuthRedirectUri } from "@/lib/slack/oauth-redirect-uri";

const SLACK_SCOPES = [
  "app_mentions:read",
  "channels:history",
  "channels:read",
  "chat:write",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "im:write",
  "mpim:history",
  "mpim:read",
  "reactions:read",
  "users:read",
  "users:read.email",
].join(",");

export async function GET(request: Request) {
  const reqUrl = new URL(request.url);
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ??
    reqUrl.origin;

  const session = await auth();
  if (!session?.user?.id) {
    const login = new URL("/login", baseUrl);
    login.searchParams.set(
      "callbackUrl",
      `${reqUrl.pathname}${reqUrl.search}`
    );
    return NextResponse.redirect(login);
  }

  const clientId = process.env.SLACK_CLIENT_ID?.trim();
  if (!clientId) {
    return NextResponse.json(
      { error: "SLACK_CLIENT_ID non configurato" },
      { status: 500 }
    );
  }

  const workspaceId = reqUrl.searchParams.get("workspaceId")?.trim() ?? "";

  if (!isUuid(workspaceId)) {
    return NextResponse.redirect(
      `${baseUrl}/dashboard?slack_error=${encodeURIComponent("invalid_workspace")}`
    );
  }

  const allowed = await userHasWorkspaceAccess(session.user.id, workspaceId);
  if (!allowed) {
    return NextResponse.redirect(
      `${baseUrl}/dashboard?slack_error=${encodeURIComponent("forbidden")}`
    );
  }
  const redirectUri = slackOAuthRedirectUri(request);

  const installUrl = new URL("https://slack.com/oauth/v2/authorize");
  installUrl.searchParams.set("client_id", clientId);
  installUrl.searchParams.set("scope", SLACK_SCOPES);
  installUrl.searchParams.set("redirect_uri", redirectUri);
  installUrl.searchParams.set("state", workspaceId);

  return NextResponse.redirect(installUrl.toString());
}
