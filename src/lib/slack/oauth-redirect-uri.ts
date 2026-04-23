/**
 * Redirect URI OAuth Slack: deve essere **identico** tra
 * `/api/slack/install` (authorize) e `/api/slack/oauth` (token exchange).
 *
 * Usa sempre l'host della richiesta HTTP (es. www vs apex) così non si
 * disallinea con `NEXT_PUBLIC_APP_URL` su Vercel.
 * In Slack → OAuth & Permissions aggiungi ogni host usato in produzione
 * (es. `https://www.theunbundle.com/api/slack/oauth` e `https://theunbundle.com/api/slack/oauth`).
 */
export function slackOAuthRedirectUri(request: Request): string {
  const { origin } = new URL(request.url);
  return `${origin}/api/slack/oauth`;
}
