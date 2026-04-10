"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import * as d3 from "d3";
import type { Activity } from "@/lib/db/schema";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface WardleyNode {
  id: string;
  title: string;
  x: number;
  y: number;
  classification: string | null;
  workType: string | null;
  department: string;
  timeSpent: number | null;
  aiExposure: number | null;
  confidenceScore: number | null;
}

interface WardleyMapProps {
  activities: (Activity & { departmentName: string })[];
  onNodeClick?: (activityId: string) => void;
}

const classificationColors: Record<string, string> = {
  automatable: "#22c55e",
  augmentable: "#3b82f6",
  differentiating: "#8b5cf6",
  emerging_opportunity: "#f59e0b",
  blocked_by_system: "#ef4444",
  blocked_by_governance: "#f97316",
};

const workTypePositionX: Record<string, number> = {
  delivery: 0.15,
  interpretation: 0.4,
  detection: 0.65,
  enrichment: 0.85,
};

function activityToNode(a: Activity & { departmentName: string }): WardleyNode {
  const baseX = a.workType ? workTypePositionX[a.workType] ?? 0.5 : 0.5;
  const jitterX = (Math.random() - 0.5) * 0.12;

  let baseY = 0.5;
  switch (a.classification) {
    case "differentiating":
      baseY = 0.85;
      break;
    case "emerging_opportunity":
      baseY = 0.75;
      break;
    case "augmentable":
      baseY = 0.55;
      break;
    case "automatable":
      baseY = 0.3;
      break;
    case "blocked_by_system":
    case "blocked_by_governance":
      baseY = 0.15;
      break;
  }
  const jitterY = (Math.random() - 0.5) * 0.1;

  return {
    id: a.id,
    title: a.title,
    x: Math.max(0.05, Math.min(0.95, baseX + jitterX)),
    y: Math.max(0.05, Math.min(0.95, baseY + jitterY)),
    classification: a.classification,
    workType: a.workType,
    department: a.departmentName,
    timeSpent: a.timeSpentHoursWeek,
    aiExposure: a.aiExposureScore,
    confidenceScore: a.confidenceScore,
  };
}

export function WardleyMap({ activities, onNodeClick }: WardleyMapProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showAiExposure, setShowAiExposure] = useState(false);
  const [tooltip, setTooltip] = useState<{
    x: number;
    y: number;
    node: WardleyNode;
  } | null>(null);

  const nodes = activities.map(activityToNode);

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
      .attr("fill", "var(--color-muted)")
      .attr("opacity", 0.3)
      .attr("rx", 8);

    const xLabels = ["Consegna", "Interpretazione", "Rilevazione", "Arricchimento"];
    xLabels.forEach((label, i) => {
      const x = xScale(0.15 + i * 0.25);
      g.append("text")
        .attr("x", x)
        .attr("y", height - 10)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--color-muted-foreground)")
        .attr("font-size", 11)
        .text(label);
    });

    g.append("text")
      .attr("x", width / 2)
      .attr("y", height - 0)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-muted-foreground)")
      .attr("font-size", 12)
      .attr("font-weight", "600")
      .text("Maturita' / Commoditizzazione →");

    g.append("text")
      .attr("transform", `rotate(-90)`)
      .attr("x", -(height / 2))
      .attr("y", 15)
      .attr("text-anchor", "middle")
      .attr("fill", "var(--color-muted-foreground)")
      .attr("font-size", 12)
      .attr("font-weight", "600")
      .text("← Centralita' Strategica");

    const nodeGroup = g
      .selectAll(".node")
      .data(nodes)
      .enter()
      .append("g")
      .attr("class", "node")
      .attr("transform", (d) => `translate(${xScale(d.x)},${yScale(d.y)})`)
      .style("cursor", "pointer")
      .on("click", (_, d) => onNodeClick?.(d.id))
      .on("mouseenter", function (event, d) {
        const rect = container.getBoundingClientRect();
        setTooltip({
          x: event.clientX - rect.left,
          y: event.clientY - rect.top - 10,
          node: d,
        });
        d3.select(this).select("circle").attr("stroke-width", 3);
      })
      .on("mouseleave", function () {
        setTooltip(null);
        d3.select(this).select("circle").attr("stroke-width", 1.5);
      });

    nodeGroup
      .append("circle")
      .attr("r", (d) => {
        if (showAiExposure && d.aiExposure) return 6 + d.aiExposure * 20;
        return d.timeSpent ? Math.max(6, Math.min(18, d.timeSpent)) : 8;
      })
      .attr("fill", (d) => classificationColors[d.classification ?? ""] ?? "#94a3b8")
      .attr("stroke", "var(--color-background)")
      .attr("stroke-width", 1.5)
      .attr("opacity", 0.85);

    if (showLabels) {
      nodeGroup
        .append("text")
        .attr("dy", -12)
        .attr("text-anchor", "middle")
        .attr("fill", "var(--color-foreground)")
        .attr("font-size", 10)
        .text((d) =>
          d.title.length > 20 ? d.title.slice(0, 18) + "..." : d.title
        );
    }
  }, [nodes, showLabels, showAiExposure, onNodeClick]);

  useEffect(() => {
    renderMap();
    const observer = new ResizeObserver(renderMap);
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [renderMap]);

  return (
    <div className="relative" ref={containerRef}>
      <div className="flex items-center gap-6 mb-4">
        <div className="flex items-center gap-2">
          <Switch
            id="labels"
            checked={showLabels}
            onCheckedChange={setShowLabels}
          />
          <Label htmlFor="labels" className="text-sm">
            Etichette
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <Switch
            id="exposure"
            checked={showAiExposure}
            onCheckedChange={setShowAiExposure}
          />
          <Label htmlFor="exposure" className="text-sm">
            AI Exposure (dimensione)
          </Label>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap mb-4">
        {Object.entries(classificationColors).map(([key, color]) => (
          <div key={key} className="flex items-center gap-1.5 text-xs">
            <div
              className="h-3 w-3 rounded-full"
              style={{ backgroundColor: color }}
            />
            <span className="capitalize">{key.replace(/_/g, " ")}</span>
          </div>
        ))}
      </div>

      <svg ref={svgRef} className="w-full" />

      {tooltip && (
        <div
          className="absolute z-50 rounded-lg border bg-background p-3 shadow-lg text-sm pointer-events-none"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            transform: "translate(-50%, -100%)",
          }}
        >
          <p className="font-medium">{tooltip.node.title}</p>
          <p className="text-xs text-muted-foreground">
            Dipartimento: {tooltip.node.department}
          </p>
          {tooltip.node.classification && (
            <Badge variant="outline" className="mt-1 text-xs capitalize">
              {tooltip.node.classification.replace(/_/g, " ")}
            </Badge>
          )}
          {tooltip.node.aiExposure != null && (
            <p className="text-xs mt-1">
              AI Exposure: {(tooltip.node.aiExposure * 100).toFixed(0)}%
            </p>
          )}
        </div>
      )}
    </div>
  );
}
