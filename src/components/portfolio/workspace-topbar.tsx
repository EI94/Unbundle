import { SidebarTrigger } from "@/components/ui/sidebar";
import { emptyBellPayload } from "@/lib/notifications/bell";
import { loadBellPayload } from "@/lib/notifications/bell-data";
import { NotificationsBell } from "./notifications-bell";

/**
 * Topbar server component: legge la campanella di chi guarda (`loadBellPayload`: segnali letti per
 * persona, righe dei dossier, notifiche degli use case, «visto fino a») e la passa al componente
 * client. Viene renderizzato in `dashboard/[workspaceId]/layout`. Un errore non ferma la barra: la
 * campanella parte vuota e si aggiorna da sola.
 */
export async function WorkspaceTopbar({
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
  if (!showNotifications) {
    return (
      <header className="sticky top-0 z-20 flex items-center border-b bg-background/80 px-4 py-2 backdrop-blur md:hidden">
        <SidebarTrigger className="size-11" aria-label="Apri navigazione" title="Apri navigazione" />
      </header>
    );
  }
  const initial = await loadBellPayload({ workspaceId, userId: userId ?? null, role, useCaseHub }).catch(() => emptyBellPayload(workspaceId, new Date()));

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-2 md:justify-end border-b bg-background/80 backdrop-blur px-4 py-2">
      <SidebarTrigger className="size-11 md:hidden" aria-label="Apri navigazione" title="Apri navigazione" />
      <NotificationsBell workspaceId={workspaceId} initial={initial} />
    </header>
  );
}
