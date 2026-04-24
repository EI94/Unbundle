"use client";

import { Bell } from "lucide-react";
import Link from "next/link";
import { useState, useTransition } from "react";
import { markSignalReadAction } from "@/lib/actions/portfolio";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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

export function NotificationsBell({
  workspaceId,
  initialSignals,
}: {
  workspaceId: string;
  initialSignals: BellSignal[];
}) {
  const [signals, setSignals] = useState(initialSignals);
  const [, startTransition] = useTransition();
  const unread = signals.filter((s) => !s.isRead).length;

  const onOpen = (s: BellSignal) => {
    if (s.isRead) return;
    setSignals((prev) => prev.map((x) => (x.id === s.id ? { ...x, isRead: true } : x)));
    startTransition(async () => {
      await markSignalReadAction(workspaceId, s.id).catch(() => {});
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
      <DropdownMenuContent align="end" className="w-80 max-h-[70vh] overflow-auto p-2">
        <div className="px-2 py-1 text-xs text-muted-foreground">
          Notifiche workspace
        </div>
        {signals.length === 0 ? (
          <div className="p-3 text-sm text-muted-foreground">
            Nessuna notifica ancora.
          </div>
        ) : (
          <ul className="space-y-1">
            {signals.slice(0, 20).map((s) => {
              const href = hrefFor(workspaceId, s);
              const content = (
                <div
                  className={cn(
                    "rounded-md px-2 py-2 hover:bg-accent cursor-pointer",
                    !s.isRead && "bg-accent/50"
                  )}
                  onClick={() => onOpen(s)}
                >
                  <div className="text-sm font-medium line-clamp-2">{s.title}</div>
                  {s.description && (
                    <div className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                      {s.description}
                    </div>
                  )}
                  <div className="text-[10px] text-muted-foreground mt-1">
                    {new Date(s.createdAt).toLocaleString()}
                  </div>
                </div>
              );
              return (
                <li key={s.id}>
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
