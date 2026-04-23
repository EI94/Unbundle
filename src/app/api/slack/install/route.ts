import { NextResponse } from "next/server";

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
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) {
    return NextResponse.json(
      { error: "SLACK_CLIENT_ID non configurato" },
      { status: 500 }
    );
  }

  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json(
      { error: "workspaceId richiesto" },
      { status: 400 }
    );
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const redirectUri = `${baseUrl}/api/slack/oauth`;

  const installUrl = new URL("https://slack.com/oauth/v2/authorize");
  installUrl.searchParams.set("client_id", clientId);
  installUrl.searchParams.set("scope", SLACK_SCOPES);
  installUrl.searchParams.set("redirect_uri", redirectUri);
  installUrl.searchParams.set("state", workspaceId);

  return NextResponse.redirect(installUrl.toString());
}
