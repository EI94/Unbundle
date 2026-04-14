import { ScrollArea } from "@/components/ui/scroll-area";
import type { Activity } from "@/lib/db/schema";
import { Clock, Wrench, AlertTriangle } from "lucide-react";

const STREAM_CONFIG: Record<
  string,
  { label: string; color: string; textColor: string }
> = {
  automate: {
    label: "Automate",
    color: "bg-green-500/10 border-green-500/20",
    textColor: "text-green-400",
  },
  differentiate: {
    label: "Differentiate",
    color: "bg-violet-500/10 border-violet-500/20",
    textColor: "text-violet-400",
  },
  innovate: {
    label: "Innovate",
    color: "bg-amber-500/10 border-amber-500/20",
    textColor: "text-amber-400",
  },
};

const workTypeLabels: Record<string, string> = {
  enrichment: "Enrichment",
  detection: "Detection",
  interpretation: "Interpretation",
  delivery: "Delivery",
};

function normalizeStream(c: string | null): string | null {
  if (!c) return null;
  const map: Record<string, string> = {
    automatable: "automate",
    augmentable: "differentiate",
    differentiating: "differentiate",
    emerging_opportunity: "innovate",
    blocked_by_system: "automate",
    blocked_by_governance: "automate",
  };
  return map[c] ?? c;
}

export function ActivitySidebar({
  activities,
}: {
  activities: Activity[];
}) {
  const total = activities.length;
  const withStream = activities.filter((a) => a.classification);
  const streamCounts = {
    automate: activities.filter(
      (a) => normalizeStream(a.classification) === "automate"
    ).length,
    differentiate: activities.filter(
      (a) => normalizeStream(a.classification) === "differentiate"
    ).length,
    innovate: activities.filter(
      (a) => normalizeStream(a.classification) === "innovate"
    ).length,
  };

  return (
    <div className="w-80 border-l border-border bg-muted/20">
      <ScrollArea className="h-full">
        <div className="p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-medium">
              Attivit&agrave; mappate
            </h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {total}
            </span>
          </div>

          {withStream.length > 0 && (
            <div className="flex gap-3 mt-2 mb-4">
              {Object.entries(streamCounts).map(
                ([stream, count]) =>
                  count > 0 && (
                    <div
                      key={stream}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${
                          stream === "automate"
                            ? "bg-green-500"
                            : stream === "differentiate"
                              ? "bg-violet-500"
                              : "bg-amber-500"
                        }`}
                      />
                      <span className="text-muted-foreground tabular-nums">
                        {count}
                      </span>
                    </div>
                  )
              )}
            </div>
          )}

          {total === 0 ? (
            <div className="mt-8 text-center">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Le attivit&agrave; appariranno qui man mano che vengono
                salvate durante la conversazione.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {activities.map((act) => {
                const stream = normalizeStream(act.classification);
                const cfg = stream ? STREAM_CONFIG[stream] : null;

                return (
                  <div
                    key={act.id}
                    className={`rounded-lg p-3 text-sm border transition-colors ${
                      cfg
                        ? `${cfg.color}`
                        : "bg-card border-border/50"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-medium text-xs leading-snug">
                        {act.title}
                      </p>
                      {cfg && (
                        <span
                          className={`shrink-0 text-[10px] font-medium tracking-wide uppercase ${cfg.textColor}`}
                        >
                          {cfg.label}
                        </span>
                      )}
                    </div>

                    {act.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
                        {act.description}
                      </p>
                    )}

                    <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground">
                      {act.workType && (
                        <span className="text-muted-foreground/70">
                          {workTypeLabels[act.workType] ?? act.workType}
                        </span>
                      )}
                      {act.timeSpentHoursWeek && (
                        <span className="flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {act.timeSpentHoursWeek}h/sett
                        </span>
                      )}
                      {act.toolsUsed && act.toolsUsed.length > 0 && (
                        <span className="flex items-center gap-0.5">
                          <Wrench className="h-3 w-3" />
                          {act.toolsUsed.length}
                        </span>
                      )}
                      {act.painPoints && (
                        <span className="flex items-center gap-0.5 text-amber-500">
                          <AlertTriangle className="h-3 w-3" />
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
