/**
 * Dipendenze dell'app per l'ingresso del connettore e per il limite di richieste:
 * Postgres tramite le query di `workspace-integrations.ts` e il client Neon
 * condiviso, Slack per l'avviso di un token esposto. La rotta MCP le passa a
 * `gateConnectorRequest` e a `consumeConnectorRateLimit`; i test unitari usano
 * dipendenze finte, quelli d'integrazione queste, sul database locale di prova.
 */
import { db } from "@/lib/db";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import { getSlackInstallationByWorkspace } from "@/lib/db/queries/slack";
import {
  authenticateConnectorIntegrationToken,
  getConnectorConfigBySlug,
  markIntegrationTokenExposed,
} from "@/lib/db/queries/workspace-integrations";
import { alertExposedToken, type ExposedTokenAlertDeps } from "./exposed-token-alert";
import type { ConnectorGateDeps } from "./gate";
import type { SqlExecutor } from "./rate-limit";

/**
 * Canale admin di Slack del workspace (`slack_installations.notify_channel_id`), lo
 * stesso degli avvisi sui nuovi contributi. Il client di Slack si carica solo se
 * il workspace ha un canale.
 */
export const appExposedTokenAlertDeps: ExposedTokenAlertDeps = {
  async findAdminChannel(workspaceId) {
    const installation = await getSlackInstallationByWorkspace(workspaceId);
    if (!installation?.notifyChannelId || !installation.botToken) return null;
    return { channelId: installation.notifyChannelId, botToken: installation.botToken };
  },
  async post(target, text) {
    const { getSlackAdapter } = await import("@/lib/slack/bot");
    const adapter = getSlackAdapter();
    await adapter.withBotToken(target.botToken, async () => {
      await adapter.postChannelMessage(`slack:${target.channelId}`, text);
    });
  },
};

/**
 * Dipendenze di `gateConnectorRequest`; l'ambiente è quello del processo. Un token
 * nell'indirizzo, se valido, si segna «esposto» sulla sua riga e, solo la prima
 * volta, si avvisa Lateral Space nel canale admin di Slack.
 */
export function appConnectorGateDeps(
  env: Readonly<Record<string, string | undefined>> = process.env,
  alertDeps: ExposedTokenAlertDeps = appExposedTokenAlertDeps
): ConnectorGateDeps {
  return {
    env,
    loadConfig: getConnectorConfigBySlug,
    authenticateToken: authenticateConnectorIntegrationToken,
    async markTokenExposed(tokenHash) {
      const exposed = await markIntegrationTokenExposed(tokenHash);
      if (exposed) await alertExposedToken(exposed, alertDeps);
      return exposed;
    },
  };
}

/** Esecutore SQL del limite di richieste (`connector_rate_limits`), dopo il self-heal. */
export const appRateLimitExecutor: SqlExecutor = async (text, params) => {
  await ensureDbSchema();
  return (await db.$client.query(text, params)) as Array<Record<string, unknown>>;
};
