import { ScrollArea } from "@/components/ui/scroll-area";
import type { Activity } from "@/lib/db/schema";
import { Clock, Wrench, AlertTriangle, Brain } from "lucide-react";

const STREAM_CONFIG: Record<
  string,
  { label: string; color: string; dotColor: string; textColor: string }
> = {
  automate: {
    label: "Automate",
    color: "bg-green-500/10 border-green-500/20",
    dotColor: "bg-green-500",
    textColor: "text-green-400",
  },
  differentiate: {
    label: "Differentiate",
    color: "bg-violet-500/10 border-violet-500/20",
    dotColor: "bg-violet-500",
    textColor: "text-violet-400",
  },
  innovate: {
    label: "Innovate",
    color: "bg-amber-500/10 border-amber-500/20",
    dotColor: "bg-amber-500",
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

function AiExposureBar({ score }: { score: number }) {
  const pct = Math.round(score * 100);
  const color =
    pct >= 30
      ? "bg-green-500"
      : pct >= 15
        ? "bg-amber-500"
        : "bg-muted-foreground/30";

  return (
    <div className="flex items-center gap-1.5" title={`AI Exposure: ${pct}%`}>
      <Brain className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
      <div className="h-1 w-12 rounded-full bg-muted-foreground/10 overflow-hidden">
        <div
          className={`h-full rounded-full ${color} transition-all`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {pct}%
      </span>
    </div>
  );
}

export function ActivitySidebar({
  activities,
}: {
  activities: Activity[];
}) {
  const total = activities.length;
  const hasClassification = activities.some((a) => a.classification);

  const streamGroups: Record<string, Activity[]> = {
    automate: [],
    differentiate: [],
    innovate: [],
    unclassified: [],
  };

  for (const act of activities) {
    const stream = normalizeStream(act.classification);
    if (stream && streamGroups[stream]) {
      streamGroups[stream].push(act);
    } else {
      streamGroups.unclassified.push(act);
    }
  }

  const totalHours = activities.reduce(
    (sum, a) => sum + (a.timeSpentHoursWeek ?? 0),
    0
  );

  return (
    <div className="w-80 border-l border-border bg-muted/20">
      <ScrollArea className="h-full">
        <div className="p-4">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-medium">Attivit&agrave; mappate</h3>
            <span className="text-xs text-muted-foreground tabular-nums">
              {total}
            </span>
          </div>

          {totalHours > 0 && (
            <p className="text-xs text-muted-foreground mb-3">
              {totalHours} ore/settimana totali
            </p>
          )}

          {hasClassification && (
            <div className="flex gap-3 mb-4">
              {(["automate", "differentiate", "innovate"] as const).map(
                (stream) =>
                  streamGroups[stream].length > 0 && (
                    <div
                      key={stream}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      <span
                        className={`h-2 w-2 rounded-full ${STREAM_CONFIG[stream].dotColor}`}
                      />
                      <span className="text-muted-foreground tabular-nums">
                        {streamGroups[stream].length}
                      </span>
                    </div>
                  )
              )}
            </div>
          )}

          {total === 0 ? (
            <div className="mt-8 text-center">
              <p className="text-xs text-muted-foreground leading-relaxed">
                Le attivit&agrave; appariranno qui man mano che vengono salvate
                durante la conversazione.
              </p>
            </div>
          ) : hasClassification ? (
            <div className="space-y-5">
              {(["automate", "differentiate", "innovate", "unclassified"] as const).map(
                (stream) => {
                  const acts = streamGroups[stream];
                  if (acts.length === 0) return null;
                  const cfg =
                    stream !== "unclassified" ? STREAM_CONFIG[stream] : null;

                  return (
                    <div key={stream}>
                      <div className="flex items-center gap-2 mb-2">
                        {cfg && (
                          <span
                            className={`h-2 w-2 rounded-full ${cfg.dotColor}`}
                          />
                        )}
                        <span
                          className={`text-xs font-medium ${cfg?.textColor ?? "text-muted-foreground"}`}
                        >
                          {cfg?.label ?? "Non classificate"}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({acts.length})
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {acts.map((act) => (
                          <ActivityCard key={act.id} act={act} cfg={cfg} />
                        ))}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              {activities.map((act) => (
                <ActivityCard key={act.id} act={act} cfg={null} />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

function ActivityCard({
  act,
  cfg,
}: {
  act: Activity;
  cfg: (typeof STREAM_CONFIG)[string] | null;
}) {
  return (
    <div
      className={`rounded-lg p-3 text-sm border transition-colors ${
        cfg ? `${cfg.color}` : "bg-card border-border/50"
      }`}
    >
      <p className="font-medium text-xs leading-snug">{act.title}</p>

      {act.description && (
        <p className="text-xs text-muted-foreground line-clamp-2 mt-1">
          {act.description}
        </p>
      )}

      <div className="flex items-center gap-3 mt-2 text-xs text-muted-foreground flex-wrap">
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

      {act.aiExposureScore != null && act.aiExposureScore > 0 && (
        <div className="mt-2">
          <AiExposureBar score={act.aiExposureScore} />
        </div>
      )}

      {act.onetTaskId && (
        <p
          className="mt-1 text-[10px] text-muted-foreground/50 font-mono"
          title={`O*NET SOC: ${act.onetTaskId}`}
        >
          O*NET {act.onetTaskId}
        </p>
      )}
    </div>
  );
}
