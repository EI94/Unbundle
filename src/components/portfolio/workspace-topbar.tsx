import { emptyBellPayload } from "@/lib/notifications/bell";
import { loadBellPayload } from "@/lib/notifications/bell-data";
import { NotificationsBell } from "./notifications-bell";

/**
 * La campanella della cornice, componente server (rilascio 10, PROPOSTA-10 §2.1, §3.1): legge la campanella di chi
 * guarda (`loadBellPayload`: segnali letti per persona, righe dei dossier, notifiche degli use case, «visto fino a») e
 * la passa al componente client. Il layout del workspace la mette nella cornice, che la mostra nella testata della
 * barra laterale su desktop e nella barra in alto del telefono (`WorkspaceShell`): la barra in alto su desktop non c'è
 * più. Un errore non ferma la cornice: la campanella parte vuota e si aggiorna da sola. Chi segue solo un corso non la
 * vede (mostra titoli e descrizioni del portfolio).
 */
export async function WorkspaceBell({
  workspaceId,
  role,
  userId = null,
  showNotifications = true,
  useCaseHub = false,
}: {
  workspaceId: string;
  /** Ruolo di chi guarda nel workspace, letto dal layout. */
  role: string | null;
  /** Chi guarda (dalla sessione del layout): la campanella è per persona. */
  userId?: string | null;
  showNotifications?: boolean;
  /** Area «Use case» accesa per il workspace (`isUseCaseHubWorkspace`, letta dal layout): decide i link. */
  useCaseHub?: boolean;
}) {
  if (!showNotifications) return null;
  const initial = await loadBellPayload({ workspaceId, userId: userId ?? null, role, useCaseHub }).catch(() => emptyBellPayload(workspaceId, new Date()));
  return <NotificationsBell workspaceId={workspaceId} initial={initial} />;
}
