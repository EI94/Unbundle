/**
 * Ripiego single-tenant: workspace usato quando Slack OAuth non passa `state`
 * (es. “Add to Slack” dalla Slack App Directory senza passare da Unbundle).
 * In multi-tenant preferisci `/install/slack` o Integrazioni → Installa su Slack.
 *
 * Opzionale su Vercel: `SLACK_DEFAULT_WORKSPACE_ID=<uuid>` (URL `/dashboard/<uuid>/...`).
 * Compat: `SLACK_OAUTH_FALLBACK_WORKSPACE_ID`.
 */
export function getSlackDefaultWorkspaceId(): string {
  return (
    process.env.SLACK_DEFAULT_WORKSPACE_ID?.trim() ||
    process.env.SLACK_OAUTH_FALLBACK_WORKSPACE_ID?.trim() ||
    ""
  );
}
