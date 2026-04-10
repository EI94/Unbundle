import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import type { Activity } from "@/lib/db/schema";
import { Clock, Wrench, AlertTriangle } from "lucide-react";

const workTypeLabels: Record<string, string> = {
  enrichment: "Arricchimento",
  detection: "Rilevazione",
  interpretation: "Interpretazione",
  delivery: "Consegna",
};

const workTypeColors: Record<string, string> = {
  enrichment: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200",
  detection:
    "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200",
  interpretation:
    "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200",
  delivery:
    "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200",
};

export function ActivitySidebar({
  activities,
}: {
  activities: Activity[];
}) {
  const grouped = {
    enrichment: activities.filter((a) => a.workType === "enrichment"),
    detection: activities.filter((a) => a.workType === "detection"),
    interpretation: activities.filter((a) => a.workType === "interpretation"),
    delivery: activities.filter((a) => a.workType === "delivery"),
    unclassified: activities.filter((a) => !a.workType),
  };

  return (
    <div className="w-80 border-l border-border bg-muted/30">
      <ScrollArea className="h-full">
        <div className="p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold">
              Attivita&apos; mappate
            </h3>
            <Badge variant="outline" className="text-xs">
              {activities.length}
            </Badge>
          </div>

          {activities.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">
              Le attivita&apos; appariranno qui durante l&apos;intervista
            </p>
          ) : (
            <div className="space-y-4">
              {Object.entries(grouped).map(([type, acts]) => {
                if (acts.length === 0) return null;
                return (
                  <div key={type}>
                    <div className="flex items-center gap-2 mb-2">
                      <Badge
                        variant="secondary"
                        className={`text-xs ${
                          type !== "unclassified"
                            ? workTypeColors[type] ?? ""
                            : ""
                        }`}
                      >
                        {type === "unclassified"
                          ? "Non classificata"
                          : workTypeLabels[type] ?? type}
                      </Badge>
                      <span className="text-xs text-muted-foreground">
                        ({acts.length})
                      </span>
                    </div>
                    <ul className="space-y-2">
                      {acts.map((act) => (
                        <li
                          key={act.id}
                          className="rounded-lg bg-background p-2.5 text-sm border border-border/50"
                        >
                          <p className="font-medium text-xs">{act.title}</p>
                          {act.description && (
                            <p className="text-xs text-muted-foreground line-clamp-2 mt-0.5">
                              {act.description}
                            </p>
                          )}
                          <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                            {act.timeSpentHoursWeek && (
                              <span className="flex items-center gap-0.5">
                                <Clock className="h-3 w-3" />
                                {act.timeSpentHoursWeek}h/sett
                              </span>
                            )}
                            {act.toolsUsed && act.toolsUsed.length > 0 && (
                              <span className="flex items-center gap-0.5">
                                <Wrench className="h-3 w-3" />
                                {act.toolsUsed.length} tool
                              </span>
                            )}
                            {act.painPoints && (
                              <span className="flex items-center gap-0.5 text-amber-600">
                                <AlertTriangle className="h-3 w-3" />
                                Pain
                              </span>
                            )}
                          </div>
                        </li>
                      ))}
                    </ul>
                    <Separator className="mt-3" />
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
