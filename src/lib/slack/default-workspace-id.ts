/**
 * Workspace Unbundle usato quando Slack OAuth non passa `state`
 * (es. pulsante “Add to Slack” dalla Slack API).
 *
 * Imposta su Vercel: `SLACK_DEFAULT_WORKSPACE_ID=<uuid>`
 * (lo stesso UUID che vedi nell’URL `/dashboard/<uuid>/...`).
 *
 * Compat: `SLACK_OAUTH_FALLBACK_WORKSPACE_ID` se già presente.
 */
export function getSlackDefaultWorkspaceId(): string {
  return (
    process.env.SLACK_DEFAULT_WORKSPACE_ID?.trim() ||
    process.env.SLACK_OAUTH_FALLBACK_WORKSPACE_ID?.trim() ||
    ""
  );
}
