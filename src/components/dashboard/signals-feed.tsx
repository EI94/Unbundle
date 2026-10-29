"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  AlertTriangle,
  TrendingUp,
  Lightbulb,
  RefreshCw,
  CheckCircle2,
  Bell,
  Eye,
  Clock,
  Inbox,
  CalendarClock,
} from "lucide-react";
import { markSignalAsRead, markAllSignalsRead } from "@/lib/actions/intelligence";
import type { WeeklySignal } from "@/lib/db/schema";
import { HUB_SIGNAL_LABEL, hubSignalHref } from "@/lib/use-cases/digest";
import { formatDistanceToNow } from "date-fns";
import { it } from "date-fns/locale";

interface SignalsFeedProps {
  signals: WeeklySignal[];
  workspaceId: string;
}

const signalConfig: Record<
  string,
  { icon: typeof AlertTriangle; color: string; label: string }
> = {
  risk_alert: { icon: AlertTriangle, color: "text-red-500", label: "Rischio" },
  new_use_case_opportunity: {
    icon: Lightbulb,
    color: "text-amber-500",
    label: "Opportunita'",
  },
  new_task_detected: {
    icon: TrendingUp,
    color: "text-blue-500",
    label: "Nuova Attivita'",
  },
  classification_change: {
    icon: RefreshCw,
    color: "text-purple-500",
    label: "Riclassificazione",
  },
  new_benchmark: {
    icon: TrendingUp,
    color: "text-green-500",
    label: "Benchmark",
  },
  progress_update: {
    icon: CheckCircle2,
    color: "text-emerald-500",
    label: "Avanzamento",
  },
  // I segnali delle schede: arrivano solo ai revisori (la pagina li legge con il ruolo, D4,
  // docs/use-case/DESIGN.md §11). I riepiloghi dell'area portano alla loro vista (§14.3).
  new_portfolio_item: {
    icon: Lightbulb,
    color: "text-amber-500",
    label: "Nuovo use case",
  },
  use_case_digest: {
    icon: Inbox,
    color: "text-sky-500",
    label: HUB_SIGNAL_LABEL.use_case_digest,
  },
  use_case_quarter: {
    icon: CalendarClock,
    color: "text-sky-500",
    label: HUB_SIGNAL_LABEL.use_case_quarter,
  },
};

/** Il messaggio quando la scrittura non parte (rete assente): lo stesso delle action. */
const READ_FAILED = "Non riesco a segnarlo come letto. Riprova.";
const READ_ALL_FAILED = "Non riesco a segnarli come letti. Riprova.";

/**
 * I segnali di Intelligence, letti per persona (SPEC §P2.4): il «letto» è di chi clicca. Dopo ogni
 * scrittura le action rileggono la pagina (`refresh()`), e qui la lista segue i dati nuovi; se la
 * scrittura non riesce le righe tornano com'erano e un toast lo dice.
 */
export function SignalsFeed({ signals: initialSignals, workspaceId }: SignalsFeedProps) {
  const [signals, setSignals] = useState(initialSignals);
  const [serverSignals, setServerSignals] = useState(initialSignals);
  const [isPending, startTransition] = useTransition();

  // La pagina riletta (le action di qui, o la campanella) porta la lista vera: quella locale la segue,
  // nello stesso rendering e non in un effetto dopo.
  if (serverSignals !== initialSignals) {
    setServerSignals(initialSignals);
    setSignals(initialSignals);
  }

  const unreadCount = signals.filter((s) => !s.isRead).length;

  const handleMarkRead = (signalId: string) => {
    const previous = signals;
    setSignals((prev) =>
      prev.map((s) => (s.id === signalId ? { ...s, isRead: true } : s))
    );
    startTransition(async () => {
      const result = await markSignalAsRead(workspaceId, signalId).catch(() => ({ ok: false as const, code: "riprova" as const, message: READ_FAILED }));
      if (!result.ok) {
        setSignals(previous);
        toast.error(result.message);
      }
    });
  };

  const handleMarkAllRead = () => {
    const previous = signals;
    setSignals((prev) => prev.map((s) => ({ ...s, isRead: true })));
    startTransition(async () => {
      const result = await markAllSignalsRead(workspaceId).catch(() => ({ ok: false as const, code: "riprova" as const, message: READ_ALL_FAILED }));
      if (!result.ok) {
        setSignals(previous);
        toast.error(result.message);
      }
    });
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-4">
        <div className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          <CardTitle className="text-lg">Segnali Intelligence</CardTitle>
          {unreadCount > 0 && (
            <Badge variant="destructive" className="text-xs">
              {unreadCount} nuovi
            </Badge>
          )}
        </div>
        {unreadCount > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={isPending}
          >
            <Eye className="mr-2 h-3 w-3" />
            Segna tutti letti
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {signals.length === 0 ? (
          <div className="flex flex-col items-center py-8 text-center text-muted-foreground">
            <Bell className="mb-3 h-10 w-10 opacity-40" />
            <p className="text-sm">Nessun segnale ancora.</p>
            <p className="text-xs">
              I segnali vengono generati automaticamente ogni settimana.
            </p>
          </div>
        ) : (
          <ScrollArea className="h-[500px] pr-4">
            <div className="space-y-3">
              {signals.map((signal) => {
                const config = signalConfig[signal.signalType] ?? {
                  icon: Bell,
                  color: "text-muted-foreground",
                  label: signal.signalType,
                };
                const Icon = config.icon;
                const href = hubSignalHref(workspaceId, signal.signalType);

                return (
                  <div
                    key={signal.id}
                    className={`group relative rounded-lg border p-4 transition-colors ${
                      signal.isRead
                        ? "border-border bg-background"
                        : "border-primary/20 bg-primary/5"
                    }`}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted ${config.color}`}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary" className="text-xs">
                            {config.label}
                          </Badge>
                          <span className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Clock className="h-3 w-3" />
                            {formatDistanceToNow(new Date(signal.createdAt), {
                              addSuffix: true,
                              locale: it,
                            })}
                          </span>
                          {!signal.isRead && (
                            <div className="h-2 w-2 rounded-full bg-primary" />
                          )}
                        </div>
                        <h4 className="mt-1 text-sm font-medium">
                          {href ? (
                            <Link href={href} className="underline-offset-2 hover:underline">
                              {signal.title}
                            </Link>
                          ) : (
                            signal.title
                          )}
                        </h4>
                        {signal.description && (
                          <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
                            {signal.description}
                          </p>
                        )}
                      </div>
                      {!signal.isRead && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                          onClick={() => handleMarkRead(signal.id)}
                        >
                          <Eye className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
