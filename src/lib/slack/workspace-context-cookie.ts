/** Cookie impostato quando navighi in /dashboard/<workspaceId>/… per collegare Slack senza env globali. */
export const SLACK_WORKSPACE_CONTEXT_COOKIE = "unbundle_slack_ws";
export const SLACK_WORKSPACE_CONTEXT_MAX_AGE = 60 * 60 * 24 * 180; // 180 giorni

export const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(s: string | undefined | null): boolean {
  return !!s && UUID_RE.test(s.trim());
}
