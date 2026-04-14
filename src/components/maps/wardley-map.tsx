"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import * as d3 from "d3";
import type { Activity, ValueMapNode } from "@/lib/db/schema";

interface WardleyMapProps {
  activities: (Activity & { departmentName: string })[];
  nodes: ValueMapNode[];
}

const STREAM_CONFIG: Record<
  string,
  { color: string; label: string; description: string }
> = {
  automate: {
    color: "#22c55e",
    label: "Automate",
    description: "Questo lavoro non dovrebbe esistere nella sua forma attuale",
  },
  differentiate: {
    color: "#8b5cf6",
    label: "Differentiate",
    description: "Qui concentrare l'energia umana",
  },
  innovate: {
    color: "#f59e0b",
    label: "Innovate",
    description: "Questo valore prima non esisteva",
  },
};

function normalizeClassification(c: string | null): string | null {
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

export function WardleyMap({ activities, nodes }: WardleyMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    activity: Activity & { departmentName: string };
    node: ValueMapNode;
  } | null>(null);

  const nodeMap = new Map(nodes.map((n) => [n.activityId, n]));

  const renderMap = useCallback(() => {
    if (!svgRef.current || !containerRef.current) return;

    const container = containerRef.current;
    const width = container.clientWidth;
    const height = 500;
    const margin = { top: 30, right: 30, bottom: 50, left: 60 };

    const svg = d3.select(svgRef.current);
    svg.selectAll("*").remove();
    svg.attr("width", width).attr("height", height);

    const xScale = d3
      .scaleLinear()
      .domain([0, 1])
      .range([margin.left, width - margin.right]);

    const yScale = d3
      .scaleLinear()
      .domain([0, 1])
      .range([height - margin.bottom, margin.top]);

    const g = svg.append("g");

    g.append("rect")
      .attr("x", margin.left)
      .attr("y", margin.top)
      .attr("width", width - margin.left - margin.right)
      .attr("height", height - margin.top - margin.bottom)
      .attr("fill", "var(--color-card)")
      .attr("rx", 4);

    const evolutionLabels = [
      { x: 0.125, label: "Genesis" },
      { x: 0.375, label: "Custom" },
      { x: 0.625, label: "Product" },
      { x: 0.875, label: "Utility" },
    ];

    evolutionLabels.forEach(({ x, label }) => {
      g.append("text")
        .attr("x", xScale(x))
        .attr("y", height - 8)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--color-muted-foreground)")
        .attr("font-size", 10)
        .text(label);
    });

    [0.25, 0.5, 0.75].forEach((x) => {
      g.append("line")
        .attr("x1", xScale(x))
        .attr("x2", xScale(x))
        .attr("y1", margin.top)
        .attr("y2", height - margin.bottom)
        .attr("stroke", "var(--color-border)")
        .attr("stroke-dasharray", "4,4")
        .attr("opacity", 0.5);
    });

    g.append("text")
      .attr("x", width / 2)
      .attr("y", height)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-muted-foreground)")
      .attr("font-size", 11)
      .text("Evolution \u2192");

    g.append("text")
      .attr("transform", "rotate(-90)")
      .attr("x", -(height / 2))
      .attr("y", 12)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-muted-foreground)")
      .attr("font-size", 11)
      .text("\u2190 Valore Strategico");

    const mappedActivities = activities
      .map((a) => ({ activity: a, node: nodeMap.get(a.id) }))
      .filter(
        (d): d is { activity: typeof d.activity; node: ValueMapNode } =>
          !!d.node
      );

    const nodeGroup = g
      .selectAll(".node")
      .data(mappedActivities)
      .enter()
      .append("g")
      .attr("class", "node")
      .attr(
        "transform",
        (d) =>
          `translate(${xScale(d.node.xMaturity)},${yScale(d.node.yStrategicValue)})`
      )
      .style("cursor", "pointer")
      .on("mouseenter", function (event, d) {
        const rect = container.getBoundingClientRect();
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - 10,
          activity: d.activity,
          node: d.node,
        });
        d3.select(this).select("circle").attr("stroke-width", 2.5);
      })
      .on("mouseleave", function () {
        setTooltip(null);
        d3.select(this).select("circle").attr("stroke-width", 1);
      });

    nodeGroup
      .append("circle")
      .attr("r", (d) => {
        const hours = d.activity.timeSpentHoursWeek;
        return hours ? Math.max(5, Math.min(16, hours * 1.2)) : 7;
      })
      .attr("fill", (d) => {
        const stream = normalizeClassification(d.activity.classification);
        return STREAM_CONFIG[stream ?? ""]?.color ?? "#64748b";
      })
      .attr("stroke", "var(--color-background)")
      .attr("stroke-width", 1)
      .attr("opacity", 0.9);

    if (showLabels) {
      nodeGroup
        .append("text")
        .attr("dy", -10)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--color-muted-foreground)")
        .attr("font-size", 9)
        .text((d) => {
          const t = d.activity.title;
          return t.length > 22 ? t.slice(0, 20) + "\u2026" : t;
        });
    }
  }, [activities, nodes, nodeMap, showLabels]);

  useEffect(() => {
    renderMap();
    const observer = new ResizeObserver(renderMap);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [renderMap]);

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center gap-4 mb-4">
        <button
          onClick={() => setShowLabels(!showLabels)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showLabels ? "Nascondi etichette" : "Mostra etichette"}
        </button>
      </div>

      <div className="flex gap-6 flex-wrap mb-4">
        {Object.entries(STREAM_CONFIG).map(([key, cfg]) => (
          <div key={key} className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: cfg.color }}
            />
            <div>
              <span className="text-xs font-medium text-foreground">
                {cfg.label}
              </span>
              <span className="text-xs text-muted-foreground ml-1.5 hidden sm:inline">
                {cfg.description}
              </span>
            </div>
          </div>
        ))}
      </div>

      <svg ref={svgRef} className="w-full" />

      {tooltip && (
        <div
          className="absolute z-50 rounded-lg border border-border bg-card p-3 shadow-lg text-sm pointer-events-none max-w-xs"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <p className="font-medium text-xs">{tooltip.activity.title}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {tooltip.activity.departmentName}
          </p>
          <div className="mt-1.5 flex gap-3 text-xs text-muted-foreground">
            <span>
              Evolution: {(tooltip.node.xMaturity * 100).toFixed(0)}%
            </span>
            <span>
              Valore: {(tooltip.node.yStrategicValue * 100).toFixed(0)}%
            </span>
          </div>
          {tooltip.activity.classification && (
            <span
              className="mt-1.5 inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs"
              style={{
                color:
                  STREAM_CONFIG[
                    normalizeClassification(tooltip.activity.classification) ??
                      ""
                  ]?.color,
              }}
            >
              <span
                className="h-1.5 w-1.5 rounded-full"
                style={{
                  backgroundColor:
                    STREAM_CONFIG[
                      normalizeClassification(
                        tooltip.activity.classification
                      ) ?? ""
                    ]?.color,
                }}
              />
              {STREAM_CONFIG[
                normalizeClassification(tooltip.activity.classification) ?? ""
              ]?.label ?? tooltip.activity.classification}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
