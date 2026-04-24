import { getSignalsByWorkspace } from "@/lib/db/queries/signals";
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
 * Topbar server component: carica gli ultimi signal e delega la UI interattiva
 * alla campanella client-side. Viene renderizzato in `dashboard/[workspaceId]/layout`.
 */
export async function WorkspaceTopbar({ workspaceId }: { workspaceId: string }) {
  const rows = await getSignalsByWorkspace(workspaceId, 25);
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
    <header className="sticky top-0 z-20 flex items-center justify-end gap-2 border-b bg-background/80 backdrop-blur px-4 py-2">
      <NotificationsBell workspaceId={workspaceId} initialSignals={signals} />
    </header>
  );
}
