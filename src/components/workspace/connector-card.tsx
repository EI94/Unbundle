import "server-only";
import { getConnectorIntegrationTokens, getConnectorSettings } from "@/lib/db/queries/workspace-integrations";
import { CONNECTOR_TOKEN_ROTATION_NOTE, CONNECTOR_TOKEN_TTL_DAYS, CONNECTOR_TOKEN_WARNING_DAYS } from "@/lib/connector/auth";
import { isConnectorRouteEnabled } from "@/lib/connector/config";
import {
  CONNECTOR_TOKEN_DEFAULT_LABEL,
  canManageConnectorSettings,
  connectorSettingsView,
  shouldShowConnectorCard,
  type ConnectorSettingsAccess,
  type ConnectorSettingsView,
} from "@/lib/connector/settings-view";
import { logSafeError } from "@/lib/log/safe-error";
import { ConnectorCardPanel } from "./connector-card-panel";

/**
 * Collegamenti › «Claude per l'organizzazione» (prima «Connettore Claude», PIANO-LAVORI §3.5, K7r; rilascio 10, ondata
 * 6b): la riga e il suo pannello. Slug, prefisso, nome visualizzato, versione della guida, regole d'accesso e limiti
 * stanno nei «Dettagli tecnici» del pannello; in vista l'interruttore di sospensione, gli avvisi e i token del
 * connettore (crea, revoca, scadenza con avviso, «esposto, da revocare»).
 *
 * Solo a chi gestisce le integrazioni del workspace (`canManageConnectorSettings`), e solo dove il connettore è
 * configurato o restano token attivi da revocare. Le parti della scheda dello use case (nota pubblica, nascondi,
 * doppione, oscura) sono dell'hub (H3b, H4b).
 */
export type ConnectorRow = { kind: "hidden" } | { kind: "error" } | { kind: "ready"; view: ConnectorSettingsView };

/** Lo stato del connettore per chi guarda: nascosto, non leggibile (lo dice la riga), o pronto. */
export async function loadConnectorRow(workspaceId: string, access: ConnectorSettingsAccess | null | undefined): Promise<ConnectorRow> {
  if (!canManageConnectorSettings(access)) return { kind: "hidden" };
  try {
    const [settings, tokens] = await Promise.all([getConnectorSettings(workspaceId), getConnectorIntegrationTokens(workspaceId)]);
    const view = connectorSettingsView(settings, tokens);
    return shouldShowConnectorCard(view) ? { kind: "ready", view } : { kind: "hidden" };
  } catch (error) {
    // Un guasto della scheda non deve fermare il resto delle impostazioni.
    logSafeError("connector-settings", "load_failed", error);
    return { kind: "error" };
  }
}

/** Il pannello del connettore, pronto: la parte interattiva con le regole del server e dell'ambiente. */
export function ConnectorPanel({ workspaceId, view, lead }: { workspaceId: string; view: ConnectorSettingsView; lead: string }) {
  return (
    <ConnectorCardPanel
      workspaceId={workspaceId}
      view={view}
      lead={lead}
      routeEnabled={isConnectorRouteEnabled(process.env)}
      policy={{ ttlDays: CONNECTOR_TOKEN_TTL_DAYS, warningDays: CONNECTOR_TOKEN_WARNING_DAYS, rotationNote: CONNECTOR_TOKEN_ROTATION_NOTE }}
      defaultLabel={CONNECTOR_TOKEN_DEFAULT_LABEL}
    />
  );
}
