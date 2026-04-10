"use client";

import type { UseCase } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";

const categoryColors: Record<string, string> = {
  quick_win: "bg-green-500",
  strategic_bet: "bg-purple-500",
  capability_builder: "bg-blue-500",
  not_yet: "bg-gray-400",
};

const monthLabels = [
  "Mese 1",
  "Mese 2",
  "Mese 3",
  "Mese 4",
  "Mese 5",
  "Mese 6",
];

interface GanttItem {
  id: string;
  title: string;
  category: string;
  startMonth: number;
  durationMonths: number;
  score: number;
}

function useCaseToGanttItem(uc: UseCase, index: number): GanttItem {
  let startMonth: number;
  let durationMonths: number;

  switch (uc.category) {
    case "quick_win":
      startMonth = Math.floor(index / 3);
      durationMonths = 1;
      break;
    case "capability_builder":
      startMonth = 2 + Math.floor(index / 2);
      durationMonths = 2;
      break;
    case "strategic_bet":
      startMonth = 3 + Math.floor(index / 2);
      durationMonths = 3;
      break;
    default:
      startMonth = 5;
      durationMonths = 1;
  }

  return {
    id: uc.id,
    title: uc.title,
    category: uc.category ?? "not_yet",
    startMonth: Math.min(startMonth, 5),
    durationMonths: Math.min(durationMonths, 6 - startMonth),
    score: uc.overallScore ?? 0,
  };
}

export function GanttChart({ useCases }: { useCases: UseCase[] }) {
  const sorted = [...useCases].sort(
    (a, b) => (a.sequenceOrder ?? 99) - (b.sequenceOrder ?? 99)
  );

  const items = sorted.map((uc, i) => useCaseToGanttItem(uc, i));

  return (
    <div className="overflow-x-auto">
      <div className="min-w-[700px]">
        <div className="grid grid-cols-[250px_repeat(6,1fr)] gap-0 border-b border-border pb-2 mb-3">
          <div className="text-sm font-medium text-muted-foreground">
            Use Case
          </div>
          {monthLabels.map((label) => (
            <div
              key={label}
              className="text-center text-xs font-medium text-muted-foreground"
            >
              {label}
            </div>
          ))}
        </div>

        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[250px_repeat(6,1fr)] gap-0 items-center"
            >
              <div className="pr-3">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <p className="text-xs text-muted-foreground">
                  Score: {item.score.toFixed(1)}
                </p>
              </div>
              {Array.from({ length: 6 }).map((_, monthIdx) => {
                const isActive =
                  monthIdx >= item.startMonth &&
                  monthIdx < item.startMonth + item.durationMonths;
                const isStart = monthIdx === item.startMonth;
                const isEnd =
                  monthIdx === item.startMonth + item.durationMonths - 1;

                return (
                  <div key={monthIdx} className="px-0.5 h-8 flex items-center">
                    {isActive && (
                      <div
                        className={`h-6 w-full ${categoryColors[item.category] ?? "bg-gray-400"} opacity-80 ${
                          isStart ? "rounded-l-md" : ""
                        } ${isEnd ? "rounded-r-md" : ""}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

        <div className="flex gap-4 mt-6 pt-3 border-t border-border">
          {Object.entries(categoryColors).map(([key, color]) => (
            <div key={key} className="flex items-center gap-1.5 text-xs">
              <div className={`h-3 w-6 rounded ${color} opacity-80`} />
              <span className="capitalize">{key.replace(/_/g, " ")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
