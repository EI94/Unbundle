"use client";

import { useEffect, useRef, useState } from "react";
import { select, zoom, zoomIdentity, zoomTransform, type ZoomBehavior } from "d3";
import { Maximize2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NODE_HEIGHT, NODE_WIDTH, edgeAnchor, wrapLabel } from "@/lib/uc/views/map-layout";
import { MAP_TONE_COLOR, catalogItems, edgeLabelShown, questionCountText, stepItemsByStatus, stepTechKeys, stepTone, type SolutionMapView, type SolutionNodeView } from "@/lib/uc/views/map";
import type { Audience } from "@/lib/uc/views/status-groups";
import type { CaseRole, SemaforoColor } from "@/lib/uc/vocab";
import { StepItem, StepKeysDetails, ToneDot, stepToneText } from "./map-parts";

const TONE_VAR: Readonly<Record<Extract<SemaforoColor, "verde" | "giallo" | "grigio">, { stroke: string; fill: string }>> = {
  verde: { stroke: "var(--uc-verde)", fill: "var(--uc-verde-bg)" },
  giallo: { stroke: "var(--uc-giallo)", fill: "var(--uc-giallo-bg)" },
  grigio: { stroke: "var(--uc-grigio)", fill: "var(--uc-grigio-bg)" },
};

/** Posizioni dei passi calcolate sul server (`layoutGraph`), così server e browser disegnano uguale. */
export interface SolutionLayout {
  positions: Record<string, { x: number; y: number }>;
  width: number;
  height: number;
}

function nodeLabel(n: SolutionNodeView, audience: Audience): string {
  return `${n.label}. ${stepToneText(stepTone(n.items), audience)}. ${questionCountText(catalogItems(n.items).length)}.`;
}

const NO_TITLES: ReadonlyMap<string, string> = new Map();

/**
 * Il pannello del passo scelto: «Passo · Controlli · 54 domande», con i titoli
 * raggruppati per stato; le chiavi senza titolo nei «Dettagli tecnici».
 */
function StepPanel({ workspaceId, caseId, node, audience, roles }: { workspaceId: string; caseId: string; node: SolutionNodeView | null; audience: Audience; roles: readonly CaseRole[] }) {
  if (!node) {
    return (
      <div className="rounded-xl p-4 ring-1 ring-foreground/10">
        <p className="text-sm font-medium">Scegli un passo</p>
        <p className="mt-1 text-sm text-muted-foreground">Le sue domande compaiono qui, raggruppate per stato.</p>
      </div>
    );
  }
  const groups = stepItemsByStatus(node.items, audience);
  return (
    <section aria-live="polite" aria-label={`Passo: ${node.label}`} className="min-w-0 space-y-3 rounded-xl p-4 ring-1 ring-foreground/10">
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">Passo</p>
        <h3 className="text-base font-semibold break-words">{node.label}</h3>
        <p className="text-xs text-muted-foreground">{[node.who, questionCountText(catalogItems(node.items).length)].filter(Boolean).join(" · ")}</p>
      </div>
      {node.description && <p className="text-sm break-words whitespace-pre-line text-muted-foreground">{node.description}</p>}
      {groups.map((g) => (
        <div key={g.label} className="min-w-0 space-y-1">
          <p className="text-xs text-muted-foreground">
            {g.label} · {g.items.length}
          </p>
          <ul className="space-y-0.5">
            {g.items.map((it) => (
              <li key={it.key} className="min-w-0">
                <StepItem workspaceId={workspaceId} caseId={caseId} item={it} audience={audience} />
              </li>
            ))}
          </ul>
        </div>
      ))}
      <StepKeysDetails roles={roles} steps={[{ n: null, label: "Questo passo", keys: stepTechKeys(node.items, [], NO_TITLES) }]} />
    </section>
  );
}

/**
 * «Vista di analisi» della Mappa (DESIGN §3.7.2), per Lateral Space e lo
 * sviluppatore, da 768 px: il grafo della soluzione con lo zoom di d3, i passi
 * nel colore della domanda messa peggio. Le etichette degli archi compaiono
 * solo al passaggio o al focus; il clic su un passo apre il suo pannello
 * («Scegli un passo» finché non se ne sceglie uno). Il focus (anello
 * `ring-3 ring-ring/50`) è distinto dalla selezione (bordo spesso); un passo
 * che riceve il focus fuori vista viene portato in vista.
 */
export function SolutionGraph({
  workspaceId,
  caseId,
  map,
  layout,
  audience,
  roles,
}: {
  workspaceId: string;
  caseId: string;
  map: SolutionMapView;
  layout: SolutionLayout;
  audience: Audience;
  /** Per i «Dettagli tecnici» del pannello del passo. */
  roles: readonly CaseRole[];
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const groupRef = useRef<SVGGElement>(null);
  const zoomRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const selected = map.nodes.find((n) => n.id === selectedId) ?? null;
  const markerId = `uc-arrow-${map.version}`;

  useEffect(() => {
    const svg = svgRef.current;
    const g = groupRef.current;
    if (!svg || !g) return;
    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on("zoom", (event) => {
        g.setAttribute("transform", event.transform.toString());
      });
    zoomRef.current = behavior;
    const s = select(svg);
    s.call(behavior);
    s.on("dblclick.zoom", null);
    return () => {
      s.on(".zoom", null);
    };
  }, []);

  const zoomBy = (k: number) => {
    if (svgRef.current && zoomRef.current) select(svgRef.current).call(zoomRef.current.scaleBy, k);
  };
  const reset = () => {
    if (svgRef.current && zoomRef.current) select(svgRef.current).call(zoomRef.current.transform, zoomIdentity);
  };
  /** Il passo con il focus fuori dalla parte visibile del grafo torna al centro. */
  const bringIntoView = (id: string) => {
    const svg = svgRef.current;
    const p = layout.positions[id];
    if (!svg || !zoomRef.current || !p) return;
    const [x, y] = zoomTransform(svg).apply([p.x, p.y]);
    const mx = NODE_WIDTH / 2;
    const my = NODE_HEIGHT / 2;
    if (x - mx < 0 || y - my < 0 || x + mx > layout.width || y + my > layout.height) select(svg).call(zoomRef.current.translateTo, p.x, p.y);
  };

  return (
    <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,20rem)]">
      <div className="relative min-w-0 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <Button size="icon-sm" variant="outline" onClick={() => zoomBy(1.25)} aria-label="Avvicina">
            <Plus aria-hidden />
          </Button>
          <Button size="icon-sm" variant="outline" onClick={() => zoomBy(0.8)} aria-label="Allontana">
            <Minus aria-hidden />
          </Button>
          <Button size="icon-sm" variant="outline" onClick={reset} aria-label="Adatta allo spazio">
            <Maximize2 aria-hidden />
          </Button>
        </div>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${layout.width} ${layout.height}`}
          preserveAspectRatio="xMidYMid meet"
          style={{ aspectRatio: `${layout.width} / ${Math.max(layout.height, layout.width / 3)}` }}
          className="block max-h-[70vh] min-h-72 w-full cursor-grab touch-none active:cursor-grabbing"
          role="group"
          aria-label={`${map.title}: ${map.nodes.length} passi. Usa Tab per scorrere i passi e Invio per aprirli.`}
        >
          <defs>
            <marker id={markerId} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--muted-foreground)" />
            </marker>
          </defs>
          <g ref={groupRef}>
            {map.edges.map((e, i) => {
              const a = layout.positions[e.from];
              const b = layout.positions[e.to];
              if (!a || !b) return null;
              const start = edgeAnchor(a, b);
              const end = edgeAnchor(b, a);
              const mid = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
              const shown = edgeLabelShown(e, { hover: hoverId, focus: focusId });
              // Gli archi del passo scelto si distinguono con un tratto più deciso, senza etichetta.
              const ofSelected = selectedId !== null && (e.from === selectedId || e.to === selectedId);
              return (
                <g key={`${e.from}-${e.to}-${i}`} className="group/edge">
                  <line x1={start.x} y1={start.y} x2={end.x} y2={end.y} stroke="transparent" strokeWidth={14} />
                  <line
                    x1={start.x}
                    y1={start.y}
                    x2={end.x}
                    y2={end.y}
                    stroke={ofSelected ? "var(--foreground)" : "var(--muted-foreground)"}
                    strokeOpacity={shown || ofSelected ? 0.9 : 0.55}
                    strokeWidth={ofSelected ? 2.2 : 1.4}
                    markerEnd={`url(#${markerId})`}
                  />
                  {e.label && (
                    <text
                      x={mid.x}
                      y={mid.y - 5}
                      textAnchor="middle"
                      fontSize={10}
                      aria-hidden={!shown}
                      className={shown ? "fill-foreground opacity-100" : "fill-foreground opacity-0 transition-opacity group-hover/edge:opacity-100"}
                    >
                      {e.label.length > 28 ? `${e.label.slice(0, 27)}…` : e.label}
                    </text>
                  )}
                </g>
              );
            })}
            {map.nodes.map((n) => {
              const p = layout.positions[n.id];
              if (!p) return null;
              const tone = stepTone(n.items);
              const color = tone ? TONE_VAR[MAP_TONE_COLOR[tone] as "verde" | "giallo" | "grigio"] : null;
              const lines = wrapLabel(n.label, 22);
              const isSelected = n.id === selectedId;
              const count = catalogItems(n.items).length;
              return (
                <g
                  key={n.id}
                  transform={`translate(${p.x - NODE_WIDTH / 2}, ${p.y - NODE_HEIGHT / 2})`}
                  role="button"
                  tabIndex={0}
                  aria-pressed={isSelected}
                  aria-label={nodeLabel(n, audience)}
                  className="group/node cursor-pointer outline-none"
                  onClick={() => setSelectedId(isSelected ? null : n.id)}
                  onMouseEnter={() => setHoverId(n.id)}
                  onMouseLeave={() => setHoverId((cur) => (cur === n.id ? null : cur))}
                  onFocus={() => {
                    setFocusId(n.id);
                    bringIntoView(n.id);
                  }}
                  onBlur={() => setFocusId((cur) => (cur === n.id ? null : cur))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setSelectedId(isSelected ? null : n.id);
                    }
                  }}
                >
                  {/* Anello del focus, fuori dal bordo: diverso dalla selezione (bordo spesso). */}
                  <rect
                    x={-5}
                    y={-5}
                    width={NODE_WIDTH + 10}
                    height={NODE_HEIGHT + 10}
                    rx={14}
                    fill="none"
                    stroke="var(--ring)"
                    strokeOpacity={0.5}
                    strokeWidth={3}
                    className="opacity-0 group-focus-visible/node:opacity-100"
                  />
                  <rect
                    width={NODE_WIDTH}
                    height={NODE_HEIGHT}
                    rx={10}
                    fill={color ? color.fill : "transparent"}
                    stroke={isSelected ? "var(--foreground)" : color ? color.stroke : "var(--muted-foreground)"}
                    strokeWidth={isSelected ? 3 : 1.5}
                    strokeDasharray={color ? undefined : "5 4"}
                  />
                  <text x={NODE_WIDTH / 2} y={NODE_HEIGHT / 2 - (lines.length - 1) * 7 - 6} textAnchor="middle" className="fill-foreground" fontSize={13} fontWeight={500}>
                    {lines.map((l, i) => (
                      <tspan key={i} x={NODE_WIDTH / 2} dy={i === 0 ? 0 : 14}>
                        {l}
                      </tspan>
                    ))}
                  </text>
                  <text x={NODE_WIDTH / 2} y={NODE_HEIGHT - 9} textAnchor="middle" className="fill-muted-foreground" fontSize={10}>
                    {count === 0 ? "nessuna domanda" : questionCountText(count)}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="min-w-0 self-start">
        {selected && (
          <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <ToneDot tone={stepTone(selected.items)} />
            {stepToneText(stepTone(selected.items), audience)}
          </p>
        )}
        <StepPanel workspaceId={workspaceId} caseId={caseId} node={selected} audience={audience} roles={roles} />
      </div>
    </div>
  );
}
