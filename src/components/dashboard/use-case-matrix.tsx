"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Label,
} from "recharts";
import type { UseCase } from "@/lib/db/schema";

const categoryColors: Record<string, string> = {
  quick_win: "#22c55e",
  strategic_bet: "#8b5cf6",
  capability_builder: "#3b82f6",
  not_yet: "#94a3b8",
};

interface UseCaseMatrixProps {
  useCases: UseCase[];
  onSelect?: (id: string) => void;
}

export function UseCaseMatrix({ useCases, onSelect }: UseCaseMatrixProps) {
  const data = useCases.map((uc) => ({
    id: uc.id,
    title: uc.title,
    x: uc.overallFeasibilityScore ?? 0,
    y: uc.overallImpactScore ?? 0,
    category: uc.category ?? "not_yet",
    fill: categoryColors[uc.category ?? "not_yet"],
  }));

  return (
    <div className="h-[400px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ScatterChart
          margin={{ top: 20, right: 20, bottom: 40, left: 40 }}
        >
          <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
          <XAxis
            type="number"
            dataKey="x"
            domain={[0, 5]}
            tickCount={6}
            name="Fattibilita'"
          >
            <Label value="Fattibilita'" position="bottom" offset={20} />
          </XAxis>
          <YAxis
            type="number"
            dataKey="y"
            domain={[0, 5]}
            tickCount={6}
            name="Impatto"
          >
            <Label
              value="Impatto"
              angle={-90}
              position="left"
              offset={20}
            />
          </YAxis>
          <ReferenceLine x={3.5} stroke="#666" strokeDasharray="5 5" />
          <ReferenceLine y={3.5} stroke="#666" strokeDasharray="5 5" />
          <Tooltip
            content={({ payload }) => {
              if (!payload?.length) return null;
              const item = payload[0].payload as (typeof data)[0];
              return (
                <div className="rounded-lg border bg-background p-3 shadow-lg text-sm">
                  <p className="font-medium">{item.title}</p>
                  <p className="text-muted-foreground">
                    Impatto: {item.y.toFixed(1)} | Fattibilita&apos;:{" "}
                    {item.x.toFixed(1)}
                  </p>
                </div>
              );
            }}
          />
          <Scatter
            data={data}
            onClick={(_, __, entry) => {
              if (entry && typeof entry === "object" && "id" in entry) {
                onSelect?.(entry.id as string);
              }
            }}
            cursor="pointer"
          />
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
