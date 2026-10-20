import { SidebarTrigger } from "@/components/ui/sidebar";
import { auth } from "@/lib/auth";
import { getSignalsByWorkspace } from "@/lib/db/queries/signals";
import type { UcBellItem } from "@/lib/uc/notify/bell";
import { NotificationsBell, type BellSignal } from "./notifications-bell";

function toIso(d: Date | string | null | undefined): string {
  if (d instanceof Date && !Number.isNaN(d.getTime())) return d.toISOString();
  if (typeof d === "string") {
    const t = new Date(d);
    if (!Number.isNaN(t.getTime())) return t.toISOString();
  }
  return new Date(0).toISOString();
}

/**
 * Notifiche dei casi d'uso per la campanella (PIANO §7.1, §5.2): solo con la
 * sezione accesa, le tabelle uc presenti e una persona di Lateral Space membro
 * di un caso (lo controlla `unreadForUser`). Un errore non ferma la barra: la
 * campanella mostra solo i segnali del portafoglio.
 */
async function caseNotifications(workspaceId: string): Promise<UcBellItem[]> {
  if (process.env.UC_ENABLED !== "true") return [];
  try {
    const session = await auth();
    if (!session?.user?.id) return [];
    const { unreadForUser } = await import("@/lib/db/queries/uc-notifications-dispatch");
    return await unreadForUser(session.user.id, { workspaceId, limit: 20 });
  } catch (error) {
    console.error("[uc] campanella dei casi non letta", error instanceof Error ? error.name : "errore");
    return [];
  }
}

/**
 * Topbar server component: carica gli ultimi signal e delega la UI interattiva
 * alla campanella client-side. Viene renderizzato in `dashboard/[workspaceId]/layout`.
 */
export async function WorkspaceTopbar({
  workspaceId,
  showNotifications = true,
}: {
  workspaceId: string;
  showNotifications?: boolean;
}) {
  if (!showNotifications) {
    return (
      <header className="sticky top-0 z-20 flex items-center border-b bg-background/80 px-4 py-2 backdrop-blur md:hidden">
        <SidebarTrigger className="size-11" aria-label="Apri navigazione" title="Apri navigazione" />
      </header>
    );
  }
  const [rows, caseItems] = await Promise.all([getSignalsByWorkspace(workspaceId, 25), caseNotifications(workspaceId)]);
  const signals: BellSignal[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    description: r.description ?? null,
    signalType: r.signalType,
    relatedEntityType: r.relatedEntityType ?? null,
    relatedEntityId: r.relatedEntityId ?? null,
    createdAt: toIso(r.createdAt),
    isRead: r.isRead,
  }));

  return (
    <header className="sticky top-0 z-20 flex items-center justify-between gap-2 md:justify-end border-b bg-background/80 backdrop-blur px-4 py-2">
      <SidebarTrigger className="size-11 md:hidden" aria-label="Apri navigazione" title="Apri navigazione" />
      <NotificationsBell workspaceId={workspaceId} initialSignals={signals} initialCaseNotifications={caseItems} />
    </header>
  );
}
