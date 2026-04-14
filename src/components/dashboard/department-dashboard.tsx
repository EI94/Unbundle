import type { Activity } from "@/lib/db/schema";
import { Brain, Clock, AlertTriangle, ArrowRight } from "lucide-react";
import Link from "next/link";

interface DepartmentDashboardProps {
  departmentName: string;
  teamSize: number | null;
  activities: Activity[];
  dependencies: Array<{
    sourceActivityId: string;
    targetActivityId: string;
    dependencyType: string | null;
  }>;
  workspaceId: string;
  departmentId: string;
}

const STREAM_CONFIG = {
  automate: {
    label: "Automate",
    description: "Non dovrebbe esistere cos\u00ec",
    dotColor: "bg-green-500",
    borderColor: "border-green-500/20",
    bgColor: "bg-green-500/5",
    textColor: "text-green-400",
    barColor: "bg-green-500",
  },
  differentiate: {
    label: "Differentiate",
    description: "Concentrare l'energia umana",
    dotColor: "bg-violet-500",
    borderColor: "border-violet-500/20",
    bgColor: "bg-violet-500/5",
    textColor: "text-violet-400",
    barColor: "bg-violet-500",
  },
  innovate: {
    label: "Innovate",
    description: "Valore che prima non esisteva",
    dotColor: "bg-amber-500",
    borderColor: "border-amber-500/20",
    bgColor: "bg-amber-500/5",
    textColor: "text-amber-400",
    barColor: "bg-amber-500",
  },
} as const;

function normalizeStream(c: string | null): keyof typeof STREAM_CONFIG | null {
  if (!c) return null;
  const map: Record<string, keyof typeof STREAM_CONFIG> = {
    automatable: "automate",
    augmentable: "differentiate",
    differentiating: "differentiate",
    emerging_opportunity: "innovate",
    blocked_by_system: "automate",
    blocked_by_governance: "automate",
    automate: "automate",
    differentiate: "differentiate",
    innovate: "innovate",
  };
  return map[c] ?? null;
}

export function DepartmentDashboard({
  departmentName,
  teamSize,
  activities,
  dependencies,
  workspaceId,
  departmentId,
}: DepartmentDashboardProps) {
  const streamGroups: Record<string, Activity[]> = {
    automate: [],
    differentiate: [],
    innovate: [],
  };

  for (const act of activities) {
    const stream = normalizeStream(act.classification);
    if (stream) {
      streamGroups[stream].push(act);
    }
  }

  const totalHours = activities.reduce(
    (sum, a) => sum + (a.timeSpentHoursWeek ?? 0),
    0
  );

  const activitiesWithExposure = activities.filter(
    (a) => a.aiExposureScore != null && a.aiExposureScore > 0
  );
  const avgExposure =
    activitiesWithExposure.length > 0
      ? activitiesWithExposure.reduce(
          (sum, a) => sum + (a.aiExposureScore ?? 0),
          0
        ) / activitiesWithExposure.length
      : 0;

  const activityMap = new Map(activities.map((a) => [a.id, a]));

  const streamHours: Record<string, number> = {};
  for (const [stream, acts] of Object.entries(streamGroups)) {
    streamHours[stream] = acts.reduce(
      (sum, a) => sum + (a.timeSpentHoursWeek ?? 0),
      0
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-8 lg:p-12 max-w-4xl">
      <div className="mb-8">
        <span className="text-xs text-muted-foreground tracking-wide uppercase">
          Mapping completato
        </span>
        <h1 className="mt-1 text-2xl font-medium tracking-tight">
          {departmentName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {activities.length} attivit&agrave;
          {teamSize ? ` \u00B7 ${teamSize} persone` : ""}
          {totalHours > 0 ? ` \u00B7 ${totalHours} ore/settimana` : ""}
        </p>
      </div>

      {/* Stream Cards */}
      <div className="grid grid-cols-3 gap-3 mb-10">
        {(Object.entries(STREAM_CONFIG) as [keyof typeof STREAM_CONFIG, (typeof STREAM_CONFIG)[keyof typeof STREAM_CONFIG]][]).map(
          ([key, cfg]) => (
            <div
              key={key}
              className={`rounded-lg border ${cfg.borderColor} ${cfg.bgColor} p-4`}
            >
              <div
                className={`text-2xl font-medium tabular-nums ${cfg.textColor}`}
              >
                {streamGroups[key].length}
              </div>
              <p className="text-xs font-medium mt-1">{cfg.label}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {cfg.description}
              </p>
              {streamHours[key] > 0 && (
                <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                  <Clock className="h-3 w-3" />
                  {streamHours[key]} h/sett
                </p>
              )}
            </div>
          )
        )}
      </div>

      {/* AI Exposure Summary */}
      {activitiesWithExposure.length > 0 && (
        <div className="mb-10">
          <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground" />
            AI Exposure
          </h2>
          <div className="rounded-lg border border-border p-4">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs text-muted-foreground">
                Exposure media
              </span>
              <span className="text-sm font-medium tabular-nums">
                {Math.round(avgExposure * 100)}%
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-muted-foreground/10 overflow-hidden mb-4">
              <div
                className="h-full rounded-full bg-foreground/60 transition-all"
                style={{ width: `${Math.round(avgExposure * 100)}%` }}
              />
            </div>
            <div className="space-y-1.5">
              {activitiesWithExposure
                .sort(
                  (a, b) =>
                    (b.aiExposureScore ?? 0) - (a.aiExposureScore ?? 0)
                )
                .slice(0, 5)
                .map((act) => {
                  const pct = Math.round((act.aiExposureScore ?? 0) * 100);
                  const stream = normalizeStream(act.classification);
                  const cfg = stream ? STREAM_CONFIG[stream] : null;
                  return (
                    <div
                      key={act.id}
                      className="flex items-center gap-3 text-xs"
                    >
                      {cfg && (
                        <span
                          className={`h-1.5 w-1.5 rounded-full shrink-0 ${cfg.dotColor}`}
                        />
                      )}
                      <span className="flex-1 truncate">{act.title}</span>
                      <div className="h-1 w-16 rounded-full bg-muted-foreground/10 overflow-hidden shrink-0">
                        <div
                          className={`h-full rounded-full ${cfg?.barColor ?? "bg-muted-foreground/30"}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="tabular-nums text-muted-foreground w-8 text-right">
                        {pct}%
                      </span>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Activities by Stream */}
      <div className="mb-10 space-y-8">
        {(Object.entries(STREAM_CONFIG) as [keyof typeof STREAM_CONFIG, (typeof STREAM_CONFIG)[keyof typeof STREAM_CONFIG]][]).map(
          ([key, cfg]) => {
            const acts = streamGroups[key];
            if (acts.length === 0) return null;
            return (
              <div key={key}>
                <h2 className="text-sm font-medium mb-3 flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${cfg.dotColor}`} />
                  {cfg.label}
                  <span className="text-xs text-muted-foreground font-normal">
                    ({acts.length})
                  </span>
                </h2>
                <div className="space-y-2">
                  {acts.map((act) => {
                    const pct = act.aiExposureScore
                      ? Math.round(act.aiExposureScore * 100)
                      : null;
                    return (
                      <div
                        key={act.id}
                        className={`rounded-lg border ${cfg.borderColor} ${cfg.bgColor} p-4`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium">{act.title}</p>
                            {act.description && (
                              <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                                {act.description}
                              </p>
                            )}
                          </div>
                          {pct != null && (
                            <div className="shrink-0 text-right">
                              <span className="text-xs text-muted-foreground">
                                AI Exposure
                              </span>
                              <div
                                className={`text-sm font-medium tabular-nums ${cfg.textColor}`}
                              >
                                {pct}%
                              </div>
                            </div>
                          )}
                        </div>

                        <div className="flex items-center gap-4 mt-3 text-xs text-muted-foreground flex-wrap">
                          {act.workType && <span>{act.workType}</span>}
                          {act.frequency && <span>{act.frequency}</span>}
                          {act.timeSpentHoursWeek && (
                            <span className="flex items-center gap-0.5">
                              <Clock className="h-3 w-3" />
                              {act.timeSpentHoursWeek}h/sett
                            </span>
                          )}
                          {act.toolsUsed && act.toolsUsed.length > 0 && (
                            <span>{act.toolsUsed.join(", ")}</span>
                          )}
                          {act.painPoints && (
                            <span className="flex items-center gap-0.5 text-amber-500">
                              <AlertTriangle className="h-3 w-3" />
                              {act.painPoints.length > 60
                                ? act.painPoints.slice(0, 57) + "..."
                                : act.painPoints}
                            </span>
                          )}
                          {act.onetTaskId && (
                            <span className="font-mono text-muted-foreground/50">
                              O*NET {act.onetTaskId}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          }
        )}
      </div>

      {/* Dependencies */}
      {dependencies.length > 0 && (
        <div className="mb-10">
          <h2 className="text-sm font-medium mb-3">Dipendenze</h2>
          <div className="space-y-1">
            {dependencies.map((dep, i) => {
              const source = activityMap.get(dep.sourceActivityId);
              const target = activityMap.get(dep.targetActivityId);
              if (!source || !target) return null;
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 text-xs text-muted-foreground rounded-lg border border-border/50 px-3 py-2"
                >
                  <span className="truncate">{source.title}</span>
                  <ArrowRight className="h-3 w-3 shrink-0" />
                  <span className="truncate">{target.title}</span>
                  {dep.dependencyType && (
                    <span className="shrink-0 text-muted-foreground/50">
                      ({dep.dependencyType})
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Reopen chat */}
      <div className="border-t border-border pt-6">
        <Link
          href={`/dashboard/${workspaceId}/mapping/${departmentId}?mode=chat`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          Riapri la conversazione per aggiungere attivit&agrave;
        </Link>
      </div>
    </div>
  );
}
