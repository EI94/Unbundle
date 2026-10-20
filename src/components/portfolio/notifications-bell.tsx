"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { markSignalReadAction } from "@/lib/actions/portfolio";
import { markAllUcNotificationsReadAction, markUcNotificationReadAction } from "@/lib/actions/uc-notifications";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { UcBellItem } from "@/lib/uc/notify/bell";
import { cn } from "@/lib/utils";

export type BellSignal = {
  id: string;
  title: string;
  description: string | null;
  signalType: string;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  createdAt: string;
  isRead: boolean;
};

function hrefFor(workspaceId: string, s: BellSignal): string | null {
  if (
    s.signalType === "new_portfolio_item" &&
    s.relatedEntityType === "use_case" &&
    s.relatedEntityId
  ) {
    return `/dashboard/${workspaceId}/portfolio/review/${s.relatedEntityId}`;
  }
  return null;
}

/**
 * Una riga della campanella: un segnale del portafoglio (`weekly_signals`) o una
 * notifica dei casi d'uso (`uc_notifications`, solo per Lateral Space). Le due
 * fonti restano separate anche nel «letto»: un segnale si segna con
 * `markSignalReadAction`, una notifica uc con `markUcNotificationReadAction`.
 */
type BellEntry =
  | { source: "signal"; key: string; signal: BellSignal; createdAt: string; isRead: boolean }
  | { source: "uc_case"; key: string; item: UcBellItem; createdAt: string; isRead: boolean };

function entriesOf(signals: BellSignal[], caseItems: UcBellItem[], readCase: ReadonlySet<string>): BellEntry[] {
  const all: BellEntry[] = [
    ...signals.map((s): BellEntry => ({ source: "signal", key: `s:${s.id}`, signal: s, createdAt: s.createdAt, isRead: s.isRead })),
    ...caseItems.map((n): BellEntry => ({ source: "uc_case", key: `uc:${n.id}`, item: n, createdAt: n.createdAt, isRead: readCase.has(n.id) })),
  ];
  return all.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
}

export function NotificationsBell({
  workspaceId,
  initialSignals,
  initialCaseNotifications = [],
}: {
  workspaceId: string;
  initialSignals: BellSignal[];
  /** Notifiche non lette dei casi d'uso (campanella di Lateral Space). */
  initialCaseNotifications?: UcBellItem[];
}) {
  const [signals, setSignals] = useState(initialSignals);
  const [caseItems] = useState(initialCaseNotifications);
  const [readCase, setReadCase] = useState<ReadonlySet<string>>(() => new Set());
  const [, startTransition] = useTransition();
  const entries = entriesOf(signals, caseItems, readCase);
  const unread = entries.filter((e) => !e.isRead).length;
  const unreadCase = caseItems.filter((n) => !readCase.has(n.id)).length;

  const onOpenSignal = (s: BellSignal) => {
    if (s.isRead) return;
    setSignals((prev) => prev.map((x) => (x.id === s.id ? { ...x, isRead: true } : x)));
    startTransition(async () => {
      await markSignalReadAction(workspaceId, s.id).catch(() => {});
    });
  };

  const onOpenCase = (n: UcBellItem) => {
    if (readCase.has(n.id)) return;
    setReadCase((prev) => new Set(prev).add(n.id));
    startTransition(async () => {
      await markUcNotificationReadAction(workspaceId, n.id).catch(() => {});
    });
  };

  const onReadAllCases = () => {
    setReadCase(new Set(caseItems.map((n) => n.id)));
    startTransition(async () => {
      await markAllUcNotificationsReadAction(workspaceId).catch(() => {});
    });
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="relative inline-flex items-center justify-center h-9 w-9 rounded-md border hover:bg-accent"
        aria-label="Notifiche"
      >
        <Bell className="h-4 w-4" />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-[1rem] rounded-full bg-red-500 text-[10px] font-medium text-white flex items-center justify-center px-1">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)] max-h-[70vh] overflow-auto p-2">
        <div className="flex items-center justify-between gap-2 px-2 py-1 text-xs text-muted-foreground">
          <span>Notifiche workspace</span>
          {unreadCase > 0 && (
            <button type="button" className="underline-offset-2 hover:underline" onClick={onReadAllCases}>
              Segna lette quelle dei casi d&apos;uso
            </button>
          )}
        </div>
        {entries.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            Nessuna notifica ancora.
          </div>
        ) : (
          <ul className="space-y-1">
            {entries.slice(0, 40).map((e) => {
              const href = e.source === "signal" ? hrefFor(workspaceId, e.signal) : e.item.href;
              const title = e.source === "signal" ? e.signal.title : e.item.title;
              const description = e.source === "signal" ? e.signal.description : e.item.description;
              const content = (
                <div
                  className={cn(
                    "rounded-md px-2 py-2 hover:bg-accent cursor-pointer",
                    !e.isRead && "bg-accent/50"
                  )}
                  onClick={() => (e.source === "signal" ? onOpenSignal(e.signal) : onOpenCase(e.item))}
                >
                  {e.source === "uc_case" && (
                    <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Casi d&apos;uso
                    </div>
                  )}
                  <div className="text-sm font-medium line-clamp-2">{title}</div>
                  {description && (
                    <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {description}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {new Date(e.createdAt).toLocaleString()}
                  </div>
                </div>
              );
              return (
                <li key={e.key}>
                  {href ? <Link href={href}>{content}</Link> : content}
                </li>
              );
            })}
          </ul>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
