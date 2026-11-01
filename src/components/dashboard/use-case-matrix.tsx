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
import type { UseCaseMatrixPoint } from "@/lib/portfolio/use-case-client-rows";

/** I colori delle categorie: token di src/app/theme-viz.css, per i due temi. */
const categoryColors: Record<string, string> = {
  quick_win: "var(--viz-matrix-quick-win)",
  strategic_bet: "var(--viz-matrix-strategic-bet)",
  capability_builder: "var(--viz-matrix-capability-builder)",
  not_yet: "var(--viz-matrix-not-yet)",
};

interface UseCaseMatrixProps {
  useCases: UseCaseMatrixPoint[];
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
          <ReferenceLine x={3.5} stroke="var(--viz-matrix-reference)" strokeDasharray="5 5" />
          <ReferenceLine y={3.5} stroke="var(--viz-matrix-reference)" strokeDasharray="5 5" />
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
