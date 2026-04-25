"use client";

import { useEffect, useRef, useState } from "react";
import type { UseCase } from "@/lib/db/schema";
import type { ScoringModelConfig } from "@/lib/db/queries/scoring-model";
import { ReviewForm } from "@/components/portfolio/review-form";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { RotateCcw } from "lucide-react";

type MatrixItem = Pick<
  UseCase,
  | "id"
  | "title"
  | "description"
  | "businessCase"
  | "flowDescription"
  | "humanInTheLoop"
  | "guardrails"
  | "dataRequirements"
  | "sustainabilityImpact"
  | "overallImpactScore"
  | "overallFeasibilityScore"
  | "overallEsgScore"
  | "overallScore"
  | "portfolioKind"
  | "portfolioReviewStatus"
  | "customScores"
  | "reviewNotes"
  | "updatedAt"
>;

type DragState = {
  id: string;
  originX: number;
  originY: number;
};

const kindLabels: Record<string, string> = {
  best_practice: "Best Practice",
  use_case_ai: "Use Case AI",
};

const reviewStatusLabels: Record<string, string> = {
  needs_inputs: "Dati mancanti",
  in_review: "In review",
  scored: "Valutato",
  archived: "Archiviato",
};

const sustainabilityPalette = {
  neutral: {
    fill: "#64748b",
    soft: "rgba(100, 116, 139, 0.14)",
    stroke: "#475569",
  },
  red: {
    fill: "#ef4444",
    soft: "rgba(239, 68, 68, 0.16)",
    stroke: "#b91c1c",
  },
  yellow: {
    fill: "#f59e0b",
    soft: "rgba(245, 158, 11, 0.18)",
    stroke: "#b45309",
  },
  green: {
    fill: "#22c55e",
    soft: "rgba(34, 197, 94, 0.18)",
    stroke: "#15803d",
  },
} as const;

function clampThresh(n: number, fallback: number) {
  if (typeof n !== "number" || !Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(5, n));
}

function clampScore(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(5, n));
}

function getSustainabilityBand(
  score: number | null | undefined,
  esgEnabled: boolean
): keyof typeof sustainabilityPalette {
  if (!esgEnabled || typeof score !== "number" || !Number.isFinite(score) || score <= 0) {
    return "neutral";
  }
  if (score >= 3.7) return "green";
  if (score >= 2.6) return "yellow";
  return "red";
}

export function RankingMatrix({
  workspaceId,
  items,
  thresholds,
  config,
  esgEnabled,
}: {
  workspaceId: string;
  items: MatrixItem[];
  thresholds: { highImpact: number; highFeasibility: number; midImpact: number };
  config: ScoringModelConfig;
  esgEnabled: boolean;
}) {
  const width = 720;
  const height = 430;
  const padL = 56;
  const padR = 24;
  const padT = 24;
  const padB = 46;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const dragMovedRef = useRef(false);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [dragOverrides, setDragOverrides] = useState<Record<string, { x: number; y: number }>>(
    {}
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const safeHighImpact = clampThresh(thresholds.highImpact, 3.5);
  const safeHighFeas = clampThresh(thresholds.highFeasibility, 3.5);

  const toX = (v: number) =>
    padL + ((clampScore(v) / 5) * (width - padL - padR));
  const toY = (v: number) =>
    height - padB - ((clampScore(v) / 5) * (height - padT - padB));

  const fromPoint = (x: number, y: number) => {
    const scaleX = (x - padL) / (width - padL - padR);
    const scaleY = (height - padB - y) / (height - padT - padB);
    return {
      x: Math.max(padL, Math.min(width - padR, x)),
      y: Math.max(padT, Math.min(height - padB, y)),
      feasibility: clampScore(scaleX * 5),
      impact: clampScore(scaleY * 5),
    };
  };

  const hiX = toX(safeHighFeas);
  const hiY = toY(safeHighImpact);

  const positioned = items
    .filter(
      (item) =>
        typeof item.overallImpactScore === "number" &&
        typeof item.overallFeasibilityScore === "number" &&
        (item.overallImpactScore !== 0 || item.overallFeasibilityScore !== 0)
    )
    .map((item) => {
      const override = dragOverrides[item.id];
      const baseX = toX(item.overallFeasibilityScore ?? 0);
      const baseY = toY(item.overallImpactScore ?? 0);
      const band = getSustainabilityBand(item.overallEsgScore, esgEnabled);
      return {
        ...item,
        x: override?.x ?? baseX,
        y: override?.y ?? baseY,
        baseX,
        baseY,
        band,
        palette: sustainabilityPalette[band],
      };
    });

  const selected = positioned.find((item) => item.id === selectedId) ?? null;

  useEffect(() => {
    if (!activeDragId) return;

    const handlePointerMove = (event: PointerEvent) => {
      const svg = svgRef.current;
      const current = dragStateRef.current;
      if (!svg || !current || current.id !== activeDragId) return;

      const rect = svg.getBoundingClientRect();
      const nextX = ((event.clientX - rect.left) / rect.width) * width;
      const nextY = ((event.clientY - rect.top) / rect.height) * height;
      if (
        Math.abs(event.clientX - current.originX) > 4 ||
        Math.abs(event.clientY - current.originY) > 4
      ) {
        dragMovedRef.current = true;
      }
      const clamped = fromPoint(nextX, nextY);
      setDragOverrides((prev) => ({
        ...prev,
        [activeDragId]: { x: clamped.x, y: clamped.y },
      }));
    };

    const handlePointerUp = () => {
      const current = dragStateRef.current;
      if (current && !dragMovedRef.current) {
        setSelectedId(current.id);
      }
      setActiveDragId(null);
      dragStateRef.current = null;
      dragMovedRef.current = false;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [activeDragId]);

  if (positioned.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed p-6 text-sm text-muted-foreground">
        Appena l&apos;AI Transformation team avra contributi valutati, li vedrai qui
        sulla matrice.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-4">
        <div className="rounded-[28px] border bg-linear-to-br from-emerald-500/6 via-background to-amber-500/10 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="text-sm font-semibold">Matrice portfolio interattiva</div>
              <p className="max-w-2xl text-xs text-muted-foreground">
                Cerchi = Use Case AI. Quadrati = Best Practice. I colori riflettono
                l&apos;impatto di sostenibilita. Trascina i punti per fare stress test
                visivi, poi apri il dettaglio per correggere i KPI ufficiali.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDragOverrides({})}
              disabled={Object.keys(dragOverrides).length === 0}
            >
              <RotateCcw className="mr-1 h-3.5 w-3.5" />
              Ripristina layout
            </Button>
          </div>

          <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <LegendShape kind="use_case_ai" label="Use Case AI" />
            <LegendShape kind="best_practice" label="Best Practice" />
            <LegendColor band="green" label="Sustainability alta" />
            <LegendColor band="yellow" label="Sustainability media" />
            <LegendColor band="red" label="Sustainability bassa" />
          </div>
        </div>

        <div className="overflow-hidden rounded-[28px] border bg-background/95 shadow-sm">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${width} ${height}`}
            className="h-auto w-full"
          >
            <defs>
              <linearGradient id="portfolio-bg" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="rgba(16,185,129,0.10)" />
                <stop offset="55%" stopColor="rgba(15,23,42,0.02)" />
                <stop offset="100%" stopColor="rgba(245,158,11,0.10)" />
              </linearGradient>
            </defs>
            <rect x={0} y={0} width={width} height={height} fill="url(#portfolio-bg)" />

            <rect
              x={hiX}
              y={padT}
              width={width - padR - hiX}
              height={hiY - padT}
              fill="rgba(34,197,94,0.10)"
            />
            <rect
              x={padL}
              y={padT}
              width={hiX - padL}
              height={hiY - padT}
              fill="rgba(59,130,246,0.08)"
            />
            <rect
              x={hiX}
              y={hiY}
              width={width - padR - hiX}
              height={height - padB - hiY}
              fill="rgba(245,158,11,0.10)"
            />

            {Array.from({ length: 6 }).map((_, index) => {
              const ratio = index / 5;
              const x = padL + ratio * (width - padL - padR);
              const y = height - padB - ratio * (height - padT - padB);
              return (
                <g key={index}>
                  <line
                    x1={x}
                    y1={padT}
                    x2={x}
                    y2={height - padB}
                    stroke="rgba(148,163,184,0.18)"
                  />
                  <line
                    x1={padL}
                    y1={y}
                    x2={width - padR}
                    y2={y}
                    stroke="rgba(148,163,184,0.18)"
                  />
                  <text
                    x={x}
                    y={height - padB + 18}
                    textAnchor="middle"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {index}
                  </text>
                  <text
                    x={padL - 10}
                    y={y + 4}
                    textAnchor="end"
                    className="fill-muted-foreground text-[10px]"
                  >
                    {index}
                  </text>
                </g>
              );
            })}

            <line
              x1={padL}
              y1={padT}
              x2={padL}
              y2={height - padB}
              stroke="rgba(100,116,139,0.7)"
              strokeWidth={1.5}
            />
            <line
              x1={padL}
              y1={height - padB}
              x2={width - padR}
              y2={height - padB}
              stroke="rgba(100,116,139,0.7)"
              strokeWidth={1.5}
            />

            <line
              x1={hiX}
              y1={padT}
              x2={hiX}
              y2={height - padB}
              strokeDasharray="6 4"
              stroke="rgba(71,85,105,0.8)"
            />
            <line
              x1={padL}
              y1={hiY}
              x2={width - padR}
              y2={hiY}
              strokeDasharray="6 4"
              stroke="rgba(71,85,105,0.8)"
            />

            <text
              x={padL + 6}
              y={padT + 16}
              className="fill-muted-foreground text-[11px]"
            >
              Strategic Bet
            </text>
            <text
              x={hiX + 6}
              y={padT + 16}
              className="fill-muted-foreground text-[11px]"
            >
              Quick Win
            </text>
            <text
              x={padL + 6}
              y={height - padB - 8}
              className="fill-muted-foreground text-[11px]"
            >
              Not Yet
            </text>
            <text
              x={hiX + 6}
              y={height - padB - 8}
              className="fill-muted-foreground text-[11px]"
            >
              Capability Builder
            </text>

            <text
              x={padL - 16}
              y={padT - 4}
              textAnchor="start"
              className="fill-foreground text-[12px] font-medium"
            >
              Impatto
            </text>
            <text
              x={width - padR}
              y={height - 10}
              textAnchor="end"
              className="fill-foreground text-[12px] font-medium"
            >
              Fattibilità →
            </text>

            {positioned.map((item) => {
              const isCircle = item.portfolioKind === "use_case_ai";
              const isActive = activeDragId === item.id || selectedId === item.id;
              const size = isCircle ? 10 : 18;
              return (
                <g
                  key={item.id}
                  className="cursor-pointer"
                  onPointerDown={(event) => {
                    dragStateRef.current = {
                      id: item.id,
                      originX: event.clientX,
                      originY: event.clientY,
                    };
                    dragMovedRef.current = false;
                    setActiveDragId(item.id);
                  }}
                >
                  <circle
                    cx={item.x}
                    cy={item.y}
                    r={isCircle ? 18 : 20}
                    fill={item.palette.soft}
                  />
                  {isCircle ? (
                    <circle
                      cx={item.x}
                      cy={item.y}
                      r={size}
                      fill={item.palette.fill}
                      stroke={isActive ? "#0f172a" : item.palette.stroke}
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                  ) : (
                    <rect
                      x={item.x - size / 2}
                      y={item.y - size / 2}
                      width={size}
                      height={size}
                      rx={4}
                      fill={item.palette.fill}
                      stroke={isActive ? "#0f172a" : item.palette.stroke}
                      strokeWidth={isActive ? 2.5 : 2}
                    />
                  )}
                  <title>{item.title}</title>
                </g>
              );
            })}
          </svg>
        </div>

        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {positioned
            .slice()
            .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0))
            .map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setSelectedId(item.id)}
                className="rounded-2xl border p-4 text-left transition-colors hover:bg-muted/60"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-semibold">{item.title}</span>
                      <Badge variant="secondary" className="text-[10px]">
                        {kindLabels[item.portfolioKind ?? ""] ?? item.portfolioKind}
                      </Badge>
                    </div>
                    <p className="line-clamp-2 text-xs text-muted-foreground">
                      {item.description ?? "Nessuna descrizione disponibile."}
                    </p>
                  </div>
                  <div
                    className="mt-1 h-3 w-3 shrink-0 rounded-full"
                    style={{ backgroundColor: item.palette.fill }}
                  />
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span>Impact {item.overallImpactScore?.toFixed(1) ?? "-"}</span>
                  <span>Feasibility {item.overallFeasibilityScore?.toFixed(1) ?? "-"}</span>
                  <span>Score {item.overallScore?.toFixed(2) ?? "-"}</span>
                </div>
              </button>
            ))}
        </div>
      </div>

      <Dialog open={!!selected} onOpenChange={(open) => !open && setSelectedId(null)}>
        {selected && (
          <DialogContent className="sm:max-w-5xl max-h-[88vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="flex flex-wrap items-center gap-2">
                <span>{selected.title}</span>
                <Badge variant="secondary" className="text-[10px]">
                  {kindLabels[selected.portfolioKind ?? ""] ?? selected.portfolioKind}
                </Badge>
                <Badge variant="outline" className="text-[10px] font-normal">
                  {reviewStatusLabels[selected.portfolioReviewStatus] ??
                    selected.portfolioReviewStatus}
                </Badge>
              </DialogTitle>
              <DialogDescription>
                Apri il dettaglio, rileggi il contributo e correggi i punteggi
                manualmente se non sei d&apos;accordo con il ranking proposto da Claude.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
              <div className="space-y-4">
                <MetricStrip
                  impact={selected.overallImpactScore}
                  feasibility={selected.overallFeasibilityScore}
                  esg={selected.overallEsgScore}
                  total={selected.overallScore}
                  esgEnabled={esgEnabled}
                />

                <div className="rounded-2xl border p-4 space-y-4">
                  <DetailBlock label="Problema / prima" value={selected.description} />
                  <DetailBlock label="Nuovo flusso" value={selected.flowDescription} />
                  <DetailBlock
                    label="Human in the loop"
                    value={selected.humanInTheLoop}
                  />
                  {selected.guardrails && (
                    <DetailBlock label="Guardrail" value={selected.guardrails} />
                  )}
                  <DetailBlock
                    label="Impatto atteso / business case"
                    value={selected.businessCase}
                  />
                  <DetailBlock
                    label="Dati necessari / replicabilita"
                    value={selected.dataRequirements}
                  />
                  {esgEnabled && (
                    <DetailBlock
                      label="Impatto ambientale e sociale"
                      value={selected.sustainabilityImpact}
                    />
                  )}
                  {selected.reviewNotes && (
                    <DetailBlock
                      label="Note reviewer / rationale AI"
                      value={selected.reviewNotes}
                    />
                  )}
                </div>
              </div>

              <div className="rounded-2xl border p-4">
                <div className="mb-4">
                  <div className="text-sm font-semibold">Correggi ranking e parametri</div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    I punteggi qui sotto sono la base ufficiale di ranking. Se vuoi
                    solo riposizionare visivamente un punto, usa il drag sulla matrice.
                  </p>
                </div>
                <ReviewForm
                  key={`${selected.id}:${selected.updatedAt ?? selected.overallScore ?? 0}:${JSON.stringify(selected.customScores ?? {})}`}
                  workspaceId={workspaceId}
                  useCaseId={selected.id}
                  config={config}
                  esgEnabled={esgEnabled}
                  initial={{
                    customScores: selected.customScores ?? {},
                    portfolioReviewStatus: selected.portfolioReviewStatus,
                    reviewNotes: selected.reviewNotes ?? "",
                  }}
                />
              </div>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}

function LegendShape({
  kind,
  label,
}: {
  kind: "use_case_ai" | "best_practice";
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      {kind === "use_case_ai" ? (
        <span className="h-3 w-3 rounded-full bg-slate-700" />
      ) : (
        <span className="h-3 w-3 rounded-[4px] bg-slate-700" />
      )}
      <span>{label}</span>
    </div>
  );
}

function LegendColor({
  band,
  label,
}: {
  band: "green" | "yellow" | "red";
  label: string;
}) {
  return (
    <div className="inline-flex items-center gap-2">
      <span
        className="h-3 w-3 rounded-full"
        style={{ backgroundColor: sustainabilityPalette[band].fill }}
      />
      <span>{label}</span>
    </div>
  );
}

function MetricStrip({
  impact,
  feasibility,
  esg,
  total,
  esgEnabled,
}: {
  impact: number | null | undefined;
  feasibility: number | null | undefined;
  esg: number | null | undefined;
  total: number | null | undefined;
  esgEnabled: boolean;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
      <MetricCard label="Impact" value={impact} />
      <MetricCard label="Feasibility" value={feasibility} />
      {esgEnabled && <MetricCard label="ESG" value={esg} />}
      <MetricCard label="Overall" value={total} />
    </div>
  );
}

function MetricCard({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="rounded-2xl border bg-muted/30 p-3">
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </div>
      <div className="mt-2 text-xl font-semibold tabular-nums">
        {typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "—"}
      </div>
    </div>
  );
}

function DetailBlock({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="space-y-1">
      <div className="text-sm font-medium">{label}</div>
      <div className="whitespace-pre-wrap text-sm text-muted-foreground">
        {value?.trim() ? value : "—"}
      </div>
    </div>
  );
}
