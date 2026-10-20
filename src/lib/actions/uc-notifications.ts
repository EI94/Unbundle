"use server";

import { requireWorkspaceAccess } from "@/lib/auth/require-workspace";
import { isUcEnabledFor } from "@/lib/db/queries/uc-access";
import { markBellRead } from "@/lib/db/queries/uc-notifications-dispatch";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { ucFailure, type UcActionResult } from "./uc-action-context";
import { UUID } from "@/lib/uc/ids";

/**
 * Campanella dei dossier (DESIGN §3.13.4): «letta» su una riga `in_app` della
 * persona (una riga di risposte raggruppate si segna tutta), oppure «Segna come
 * lette» su tutte le sue notifiche del workspace. Si toccano solo le righe con
 * `recipient_user_id` uguale a chi chiede: nessuna notifica di altri, nessun
 * `weekly_signals`. Solo con la sezione accesa per il workspace (P0-1). Non è
 * un'azione da registrare nell'audit: non cambia il dossier.
 */

async function markRead(userId: string, workspaceId: string, notificationId: string | null): Promise<UcActionResult<{ updated: number }>> {
  if (!isUcEnabledFor(workspaceId)) return ucFailure("disattivata", "Sezione non disponibile.");
  try {
    const executor = await getAppUcExecutor();
    const updated = await markBellRead(executor, { userId, workspaceId, notificationId });
    return { ok: true, data: { updated } };
  } catch (error) {
    console.error("[uc] notifica non segnata come letta", error instanceof Error ? error.name : "errore");
    return ucFailure("non_disponibile", "Non è stato possibile aggiornare le notifiche. Riprova.");
  }
}

/** Segna letta una riga della campanella dei dossier della persona. */
export async function markUcNotificationReadAction(workspaceId: string, notificationId: string): Promise<UcActionResult<{ updated: number }>> {
  const { session } = await requireWorkspaceAccess(workspaceId);
  if (typeof notificationId !== "string" || !UUID.test(notificationId)) return ucFailure("dati_non_validi", "Notifica non valida.");
  return markRead(session.user.id, workspaceId, notificationId);
}

/** «Segna come lette»: tutte le notifiche dei dossier della persona in questo workspace. */
export async function markAllUcNotificationsReadAction(workspaceId: string): Promise<UcActionResult<{ updated: number }>> {
  const { session } = await requireWorkspaceAccess(workspaceId);
  return markRead(session.user.id, workspaceId, null);
}
