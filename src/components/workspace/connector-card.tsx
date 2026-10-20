import { Cable } from "lucide-react";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { getConnectorIntegrationTokens, getConnectorSettings } from "@/lib/db/queries/workspace-integrations";
import { CONNECTOR_TOKEN_ROTATION_NOTE, CONNECTOR_TOKEN_TTL_DAYS, CONNECTOR_TOKEN_WARNING_DAYS } from "@/lib/connector/auth";
import { isConnectorRouteEnabled } from "@/lib/connector/config";
import {
  CONNECTOR_TOKEN_DEFAULT_LABEL,
  canManageConnectorSettings,
  connectorSettingsView,
  shouldShowConnectorCard,
  type ConnectorSettingsView,
} from "@/lib/connector/settings-view";
import { logSafeError } from "@/lib/log/safe-error";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { ConnectorCardPanel } from "./connector-card-panel";

/**
 * Impostazioni › Integrazioni › «Connettore Claude» (PIANO-LAVORI §3.5, K7r; prompt WP7
 * ridotto): slug, prefisso, nome visualizzato, versione della guida, interruttore di
 * sospensione, indirizzo da copiare, regole d'accesso in sola lettura e token del
 * connettore (crea, revoca, scadenza con avviso, «esposto, da revocare»).
 *
 * Componente server, montato con una riga nella pagina delle impostazioni: controlla da
 * sé chi guarda e non mostra nulla a chi non gestisce le integrazioni del workspace, né
 * dove il connettore non è configurato (una riga di D6 senza guida non basta) e non
 * restano token attivi da revocare.
 * Le parti della scheda dello use case (nota pubblica, nascondi, doppione, oscura) sono
 * dell'hub (H3b, H4b).
 */
export async function ConnectorCard({ workspaceId }: { workspaceId: string }) {
  const session = await requireSession();
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!canManageConnectorSettings(access)) return null;

  let view: ConnectorSettingsView;
  try {
    const [settings, tokens] = await Promise.all([getConnectorSettings(workspaceId), getConnectorIntegrationTokens(workspaceId)]);
    view = connectorSettingsView(settings, tokens);
  } catch (error) {
    // Un guasto della scheda non deve fermare il resto delle impostazioni.
    logSafeError("connector-settings", "load_failed", error);
    return (
      <SettingsSection
        id="connettore-claude"
        icon={Cable}
        iconClassName="bg-orange-500/10 text-orange-400"
        title="Connettore Claude"
        description="Non riesco a leggere la configurazione del connettore. Ricarica la pagina tra poco."
      />
    );
  }
  if (!shouldShowConnectorCard(view)) return null;

  return (
    <ConnectorCardPanel
      workspaceId={workspaceId}
      view={view}
      routeEnabled={isConnectorRouteEnabled(process.env)}
      policy={{ ttlDays: CONNECTOR_TOKEN_TTL_DAYS, warningDays: CONNECTOR_TOKEN_WARNING_DAYS, rotationNote: CONNECTOR_TOKEN_ROTATION_NOTE }}
      defaultLabel={CONNECTOR_TOKEN_DEFAULT_LABEL}
    />
  );
}
