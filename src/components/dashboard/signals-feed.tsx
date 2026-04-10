"use client";

import { useState, useTransition } from "react";
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
} from "lucide-react";
import { markSignalAsRead, markAllSignalsRead } from "@/lib/actions/intelligence";
import type { WeeklySignal } from "@/lib/db/schema";
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
};

export function SignalsFeed({ signals: initialSignals, workspaceId }: SignalsFeedProps) {
  const [signals, setSignals] = useState(initialSignals);
  const [isPending, startTransition] = useTransition();

  const unreadCount = signals.filter((s) => !s.isRead).length;

  const handleMarkRead = (signalId: string) => {
    setSignals((prev) =>
      prev.map((s) => (s.id === signalId ? { ...s, isRead: true } : s))
    );
    startTransition(async () => {
      await markSignalAsRead(signalId);
    });
  };

  const handleMarkAllRead = () => {
    setSignals((prev) => prev.map((s) => ({ ...s, isRead: true })));
    startTransition(async () => {
      await markAllSignalsRead(workspaceId);
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
                          {signal.title}
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
