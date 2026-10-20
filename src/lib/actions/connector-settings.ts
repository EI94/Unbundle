"use server";

/**
 * Azioni della scheda «Connettore Claude» (Impostazioni › Integrazioni, pacchetto K7r):
 * interruttore di sospensione, token nuovo (mostrato una volta sola), revoca.
 *
 * Ogni azione è un endpoint raggiungibile con una POST diretta: rifà da sé il
 * controllo di chi gestisce le integrazioni (`canManageConnectorSettings`, la stessa
 * regola della scheda) e valida gli input con zod. Nei log solo nome e codice
 * dell'errore (`logSafeError`): mai token, nomi o testi.
 */
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { getCollaboratorAccess, type WorkspaceAccess } from "@/lib/workspace-access";
import {
  createConnectorIntegrationToken,
  getConnectorSettings,
  revokeConnectorIntegrationToken,
  setConnectorEnabled,
} from "@/lib/db/queries/workspace-integrations";
import {
  canActivateConnector,
  canManageConnectorSettings,
  connectorEnabledInput,
  connectorFieldErrors,
  connectorTokenCreateInput,
  connectorTokenRevokeInput,
  formatItalianDay,
} from "@/lib/connector/settings-view";
import { logSafeError } from "@/lib/log/safe-error";

export type ConnectorSettingsActionState<Data = unknown> = {
  ok: boolean;
  message?: string | null;
  fieldErrors?: Record<string, string>;
  data?: Data;
};

export type ConnectorEnabledData = { enabled: boolean };

export type CreateConnectorTokenData = {
  tokenId: string;
  /** Il token in chiaro: questa è l'unica volta che esce dal server. */
  token: string;
  tokenPrefix: string;
  label: string;
  expiresOn: string;
};

export type RevokeConnectorTokenData = { tokenId: string };

const NOT_ALLOWED = "Solo gli amministratori dell'organizzazione gestiscono il connettore Claude.";
const NOT_CONFIGURED = "Il connettore non è configurato per questo workspace.";
const NOT_READY =
  "Il connettore non è pronto: mancano la guida, il profilo del cliente o il modello delle istruzioni. Li carica Lateral Space con lo script operatore.";
const FAILED = "Non è stato possibile salvare. Riprova tra poco.";

function fail<Data>(message: string, fieldErrors: Record<string, string> = {}): ConnectorSettingsActionState<Data> {
  return { ok: false, message, fieldErrors };
}

/** Null se chi chiama gestisce le integrazioni del workspace, altrimenti il messaggio da mostrare. */
function accessDenied(access: WorkspaceAccess | null): string | null {
  if (!access) return "Workspace non trovato o non accessibile.";
  return canManageConnectorSettings(access) ? null : NOT_ALLOWED;
}

function revalidateSettings(workspaceId: string) {
  revalidatePath(`/dashboard/${workspaceId}/settings`);
}

/** Sospende o riattiva il connettore per tutta l'organizzazione. */
export async function setConnectorEnabledAction(
  workspaceId: string,
  enabled: boolean
): Promise<ConnectorSettingsActionState<ConnectorEnabledData>> {
  const parsed = connectorEnabledInput.safeParse({ workspaceId, enabled });
  if (!parsed.success) return fail("Richiesta non valida.");
  const session = await requireSession();
  const denied = accessDenied(await getCollaboratorAccess(session.user.id, parsed.data.workspaceId));
  if (denied) return fail(denied);

  try {
    // Si riaccende solo con guida, profilo e modello validi (la query ricontrolla che ci siano
    // nello stesso UPDATE); spegnere si può sempre.
    if (parsed.data.enabled) {
      const settings = await getConnectorSettings(parsed.data.workspaceId);
      if (!settings) return fail(NOT_CONFIGURED);
      if (!canActivateConnector(settings)) return fail(NOT_READY);
    }
    const row = await setConnectorEnabled({ workspaceId: parsed.data.workspaceId, enabled: parsed.data.enabled, updatedBy: session.user.id });
    if (!row) return fail(parsed.data.enabled ? NOT_READY : NOT_CONFIGURED);
    revalidateSettings(parsed.data.workspaceId);
    return {
      ok: true,
      message: row.enabled
        ? "Connettore riattivato: Claude può di nuovo cercare e inviare segnalazioni."
        : "Connettore sospeso: ogni strumento risponde che il servizio è sospeso.",
      data: { enabled: row.enabled },
    };
  } catch (error) {
    logSafeError("connector-settings", "set_enabled_failed", error);
    return fail(FAILED);
  }
}

/** Crea un token del connettore (90 giorni) e lo restituisce in chiaro una sola volta. */
export async function createConnectorTokenAction(
  workspaceId: string,
  _prev: ConnectorSettingsActionState<CreateConnectorTokenData>,
  formData: FormData
): Promise<ConnectorSettingsActionState<CreateConnectorTokenData>> {
  const label = formData.get("label");
  const parsed = connectorTokenCreateInput.safeParse({ workspaceId, label: typeof label === "string" ? label : undefined });
  if (!parsed.success) {
    const fieldErrors = connectorFieldErrors(parsed.error);
    return fail(fieldErrors.label ? "Controlla il nome del token." : "Richiesta non valida.", fieldErrors.label ? { label: fieldErrors.label } : {});
  }
  const session = await requireSession();
  const denied = accessDenied(await getCollaboratorAccess(session.user.id, parsed.data.workspaceId));
  if (denied) return fail(denied);

  try {
    // Senza configurazione, guida, profilo e modello (una riga di D6 non basta) il token non servirebbe a nulla.
    const settings = await getConnectorSettings(parsed.data.workspaceId);
    if (!settings) return fail(NOT_CONFIGURED);
    if (!canActivateConnector(settings)) return fail(NOT_READY);
    const { token, row } = await createConnectorIntegrationToken({
      workspaceId: parsed.data.workspaceId,
      label: parsed.data.label,
      createdByUserId: session.user.id,
    });
    revalidateSettings(parsed.data.workspaceId);
    return {
      ok: true,
      message: "Token creato. Copialo ora: non sarà più mostrato.",
      data: {
        tokenId: row.id,
        token,
        tokenPrefix: row.tokenPrefix,
        label: row.label,
        expiresOn: formatItalianDay(row.expiresAt) ?? "",
      },
    };
  } catch (error) {
    logSafeError("connector-settings", "create_token_failed", error);
    return fail(FAILED);
  }
}

/** Revoca un token del connettore di questo workspace: il connettore si ferma per chi lo usa. */
export async function revokeConnectorTokenAction(
  workspaceId: string,
  _prev: ConnectorSettingsActionState<RevokeConnectorTokenData>,
  formData: FormData
): Promise<ConnectorSettingsActionState<RevokeConnectorTokenData>> {
  const tokenId = formData.get("tokenId");
  const parsed = connectorTokenRevokeInput.safeParse({ workspaceId, tokenId: typeof tokenId === "string" ? tokenId : undefined });
  if (!parsed.success) return fail("Token non valido.");
  const session = await requireSession();
  const denied = accessDenied(await getCollaboratorAccess(session.user.id, parsed.data.workspaceId));
  if (denied) return fail(denied);

  try {
    const revoked = await revokeConnectorIntegrationToken({ workspaceId: parsed.data.workspaceId, tokenId: parsed.data.tokenId });
    if (!revoked) return fail("Token non trovato o già revocato.");
    revalidateSettings(parsed.data.workspaceId);
    return { ok: true, message: "Token revocato. Claude non può più usarlo.", data: { tokenId: revoked.id } };
  } catch (error) {
    logSafeError("connector-settings", "revoke_token_failed", error);
    return fail(FAILED);
  }
}
