"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { formatQuality } from "@/lib/use-cases/factory/benchmark";
import { cn } from "@/lib/utils";
import {
  EVAL_TEXT,
  LABEL_FONT,
  benchLabels,
  benchSummary,
  costScale,
  labelPriority,
  marksText,
  nearestPoint,
  pointDetails,
  pointLabel,
  qualityScale,
  type BenchRow,
  type PlacedLabel,
} from "./eval-format";

/** Il riquadro prima di misurarlo: quello del telefono più stretto (375 px). Misurato, le etichette si rifanno. */
const DEFAULT_BOX = Object.freeze({ w: 244, h: 224 });
/** Il margine dentro il riquadro, in pixel: i punti sui bordi, con il loro anello, restano interi. */
const PAD = 16;
/** Il raggio del pallino con l'anello del colore della scheda, e quello del cerchio del modello di oggi. */
const DOT_R = 7;
const CURRENT_R = 11;
/** Il puntatore prende il punto più vicino entro questa distanza: nessuno deve centrare un pallino di 10 px. */
const HIT_PX = 28;
/** La larghezza del riquadro con i numeri di un punto. */
const TIP_W = 208;

/** Una frazione del riquadro (0–1) in CSS, dentro il margine: `PAD + f × (lato − 2 × PAD)`, più `px`. */
const at = (f: number, px = 0) => `calc(${(f * 100).toFixed(3)}% + ${(PAD * (1 - 2 * f) + px).toFixed(2)}px)`;

interface Plotted {
  row: BenchRow;
  /** Da sinistra, da 0 a 1. */
  fx: number;
  /** Dall'alto, da 0 a 1. */
  fy: number;
}

/**
 * Il grafico del banco di un ruolo (BANCO-DI-PROVA.md §4.2): qualità in verticale, costo per 1.000 esecuzioni in
 * orizzontale, un punto per modello con il suo nome accanto. Il modello di oggi ha il cerchio e «oggi»; la frontiera
 * (nessun altro la batte su qualità e costo insieme) è una linea sottile tra i suoi punti; i modelli sotto soglia sono
 * vuoti e grigi. Il più bravo, il più efficiente e il più economico lo dicono le etichette, il riquadro e la tabella.
 *
 * Un colore solo (`uc-serie-1`) e il grigio di «Altro», validati insieme sulla card nei due temi; il resto sono i
 * token del testo. Il riquadro con i numeri compare al passaggio del mouse (il punto più vicino), al tocco e con il
 * fuoco della tastiera (ogni punto è un pulsante con tutto nel nome); Esc lo chiude. Per i lettori di schermo una frase
 * con i segni; la tabella sotto ha ogni numero. I modelli senza costo non hanno un punto: sono elencati sotto.
 * Niente librerie di grafici; nessun dato su chi ha lanciato il banco.
 */
export function BenchChart({ role, rows }: { role: string; rows: readonly BenchRow[] }) {
  const plot = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ w: number; h: number }>(DEFAULT_BOX);
  const [active, setActive] = useState<string | null>(null);
  const priced = rows.filter((row) => row.cost !== null);
  const unpriced = rows.filter((row) => row.cost === null);
  const hasPlot = priced.length > 0;

  // La misura vera del riquadro (cambia con la larghezza della pagina): le etichette si mettono su quella.
  useEffect(() => {
    const element = plot.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;
      const next = { w: Math.round(rect.width), h: Math.round(rect.height) };
      setBox((previous) => (previous.w === next.w && previous.h === next.h ? previous : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasPlot]);

  const summary = benchSummary(role, rows);
  if (!hasPlot) {
    return (
      <figure data-slot="bench-chart" className="min-w-0">
        <p className="sr-only">{summary}</p>
        <p className="rounded-md border border-dashed px-3 py-4 text-sm text-muted-foreground">{EVAL_TEXT.noPrices}</p>
      </figure>
    );
  }

  const xScale = costScale(priced.map((row) => row.cost as number));
  const yScale = qualityScale(priced.map((row) => row.quality));
  // Nell'ordine del grafico, da sinistra: è anche l'ordine dei pulsanti con il Tab.
  const points: Plotted[] = priced
    .map((row) => ({ row, fx: xScale.at(row.cost as number), fy: 1 - yScale.at(row.quality) }))
    .sort((a, b) => a.fx - b.fx || a.fy - b.fy || a.row.label.localeCompare(b.row.label, "it"));
  const inner = { w: Math.max(1, box.w - 2 * PAD), h: Math.max(1, box.h - 2 * PAD) };
  const pixel = (p: Plotted) => ({ x: PAD + p.fx * inner.w, y: PAD + p.fy * inner.h });
  const frontier = points.filter((p) => p.row.frontier);
  const frontierPath = frontier.length >= 2 ? frontier.map((p, i) => `${i === 0 ? "M" : "L"} ${(p.fx * 100).toFixed(3)} ${(p.fy * 100).toFixed(3)}`).join(" ") : null;
  const frontierSegments = frontier.slice(1).map((p, i) => {
    const from = pixel(frontier[i]);
    const to = pixel(p);
    return { x1: from.x, y1: from.y, x2: to.x, y2: to.y };
  });
  const labels = benchLabels(
    [...points].sort((a, b) => labelPriority(a.row, b.row)).map((p) => ({ id: p.row.model, ...pixel(p), r: p.row.current ? CURRENT_R : DOT_R, row: p.row })),
    box,
    frontierSegments,
  );
  const anyFailing = points.some((p) => !p.row.thresholdsMet);
  const anyCurrent = points.some((p) => p.row.current);
  const shown = points.find((p) => p.row.model === active) ?? null;

  const locate = (event: PointerEvent<HTMLDivElement>): string | null => {
    const rect = plot.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0 || rect.height <= 0) return null;
    const w = Math.max(1, rect.width - 2 * PAD);
    const h = Math.max(1, rect.height - 2 * PAD);
    const centers = points.map((p) => ({ id: p.row.model, x: PAD + p.fx * w, y: PAD + p.fy * h }));
    return nearestPoint(centers, event.clientX - rect.left, event.clientY - rect.top, HIT_PX);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Escape") setActive(null);
  };

  let tipStyle: CSSProperties | null = null;
  if (shown) {
    const { x, y } = pixel(shown);
    const width = Math.min(TIP_W, box.w);
    const left = Math.min(Math.max(0, x - width / 2), Math.max(0, box.w - width));
    tipStyle = y > box.h / 2 ? { left, width, bottom: box.h - y + 14 } : { left, width, top: y + 14 };
  }

  return (
    <figure data-slot="bench-chart" aria-label={`Qualità e costo dei modelli, ruolo «${role}»`} className="w-full max-w-2xl min-w-0 space-y-2">
      <p className="sr-only">{summary}</p>
      <div className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-1">
        <div />
        <p aria-hidden className="pb-1 text-[11px] text-muted-foreground">
          {EVAL_TEXT.axisQuality}
        </p>
        <div aria-hidden className="relative h-56 sm:h-72">
          {yScale.ticks.map((tick) => (
            <span key={tick.value} className="absolute right-0 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums" style={{ top: at(1 - tick.at) }}>
              {tick.label}
            </span>
          ))}
        </div>
        <div
          ref={plot}
          data-slot="bench-plot"
          className="relative h-56 touch-pan-y select-none sm:h-72"
          onPointerMove={(event) => {
            if (event.pointerType === "mouse") setActive(locate(event));
          }}
          onPointerDown={(event) => {
            if (event.pointerType !== "mouse") setActive(locate(event));
          }}
          onPointerLeave={(event) => {
            if (event.pointerType === "mouse") setActive(null);
          }}
        >
          {/* Un <svg> non si allarga con `inset`: la misura va data, come il riquadro meno il margine. */}
          <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute overflow-visible" style={{ left: PAD, top: PAD, width: `calc(100% - ${2 * PAD}px)`, height: `calc(100% - ${2 * PAD}px)` }}>
            {yScale.ticks.map((tick) => (
              <line key={`y${tick.value}`} x1="0" x2="100" y1={(1 - tick.at) * 100} y2={(1 - tick.at) * 100} className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {xScale.ticks.map((tick) => (
              <line key={`x${tick.value}`} x1={tick.at * 100} x2={tick.at * 100} y1="0" y2="100" className="stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {frontierPath ? (
              <path data-slot="bench-frontier" d={frontierPath} className="fill-none stroke-uc-serie-1" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            ) : null}
          </svg>
          {points.map((p) => {
            const label = labels.get(p.row.model);
            return label ? <PointLabel key={`label-${p.row.model}`} point={p} label={label} origin={pixel(p)} /> : null;
          })}
          <ul aria-label={`Modelli del ruolo «${role}»`} className="absolute inset-0">
            {points.map((p) => (
              <li key={p.row.model} className="absolute" style={{ left: at(p.fx), top: at(p.fy) }}>
                <button
                  type="button"
                  aria-label={pointLabel(p.row)}
                  data-point={p.row.model}
                  onFocus={() => setActive(p.row.model)}
                  onBlur={() => setActive((current) => (current === p.row.model ? null : current))}
                  onClick={() => setActive(p.row.model)}
                  onKeyDown={onKeyDown}
                  className="absolute flex size-7 -translate-1/2 touch-manipulation items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:size-11"
                >
                  {p.row.current ? <span aria-hidden data-slot="bench-current" className="absolute size-[22px] rounded-full border-[1.5px] border-foreground" /> : null}
                  <span
                    aria-hidden
                    className={cn(
                      "size-2.5 rounded-full ring-2 ring-card motion-safe:transition-transform",
                      p.row.thresholdsMet ? "bg-uc-serie-1" : "border-2 border-uc-serie-altro bg-card",
                      active === p.row.model && "scale-125",
                    )}
                  />
                </button>
              </li>
            ))}
          </ul>
          {shown && tipStyle ? (
            <div aria-hidden data-slot="bench-tooltip" className="pointer-events-none absolute z-20 space-y-0.5 rounded-md border bg-popover px-2.5 py-2 text-xs text-popover-foreground shadow-md" style={tipStyle}>
              <p className="font-medium break-words">{shown.row.label}</p>
              {shown.row.marks.length ? <p className="text-muted-foreground">{marksText(shown.row.marks)}</p> : null}
              {pointDetails(shown.row).map((line, i) => (
                <p key={i} className={cn("tabular-nums", i === 0 && "font-medium")}>
                  {line}
                </p>
              ))}
            </div>
          ) : null}
        </div>
        <div />
        <div aria-hidden className="relative mt-1 h-4">
          {xScale.ticks.map((tick) => (
            <span key={tick.value} className="absolute -translate-x-1/2 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums" style={{ left: at(tick.at) }}>
              {tick.label}
            </span>
          ))}
        </div>
        <div />
        <p aria-hidden className="pt-1 text-right text-[11px] text-muted-foreground">
          {EVAL_TEXT.axisCost}
          {xScale.kind === "logaritmica" ? ` · ${EVAL_TEXT.axisLog}` : ""}
        </p>
      </div>
      <figcaption className="space-y-1 text-xs text-muted-foreground">
        <p data-slot="bench-legend" className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full bg-uc-serie-1" />
            {EVAL_TEXT.legendPassing}
          </span>
          {anyFailing ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full border-2 border-uc-serie-altro bg-card" />
              {EVAL_TEXT.legendFailing}
            </span>
          ) : null}
          {anyCurrent ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="relative flex size-[22px] items-center justify-center">
                <span className="absolute inset-0 rounded-full border-[1.5px] border-foreground" />
                <span className="size-2.5 rounded-full bg-muted-foreground" />
              </span>
              {EVAL_TEXT.legendCurrent}
            </span>
          ) : null}
          {frontierPath ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="inline-block h-0.5 w-4 rounded bg-uc-serie-1" />
              {EVAL_TEXT.legendFrontier}
            </span>
          ) : null}
        </p>
        {unpriced.length ? (
          <p data-slot="bench-unpriced">
            {`${EVAL_TEXT.unknownCost.charAt(0).toUpperCase()}${EVAL_TEXT.unknownCost.slice(1)}: `}
            {unpriced.map((row) => `${row.label} (${formatQuality(row.quality)}${row.thresholdsMet ? "" : `, ${EVAL_TEXT.thresholdsMissed}`})`).join(", ")}.
          </p>
        ) : null}
      </figcaption>
    </figure>
  );
}

/**
 * Il nome (e sotto i segni) accanto a un punto, dove `placePointLabels` l'ha trovato libero: testo con un alone del
 * colore della scheda, così resta leggibile sopra la griglia e la frontiera. Nascosto ai lettori di schermo, che
 * sentono tutto nel nome del pulsante.
 */
function PointLabel({ point, label, origin }: { point: Plotted; label: PlacedLabel; origin: { x: number; y: number } }) {
  const x = label.align === "start" ? 2 : label.align === "end" ? label.w - 2 : label.w / 2;
  const anchor = label.align === "start" ? "start" : label.align === "end" ? "end" : "middle";
  return (
    <svg
      aria-hidden
      data-slot="bench-label"
      width={label.w}
      height={label.h}
      className="pointer-events-none absolute overflow-visible font-mono text-[10px]"
      style={{ left: at(point.fx, label.x - origin.x), top: at(point.fy, label.y - origin.y) }}
    >
      {label.lines.map((line, i) => (
        <text
          key={i}
          x={x}
          y={10 + i * LABEL_FONT.linePx}
          textAnchor={anchor}
          paintOrder="stroke"
          strokeWidth={3}
          strokeLinejoin="round"
          className={cn("stroke-card", i === 0 && point.row.thresholdsMet ? "fill-foreground" : "fill-muted-foreground")}
        >
          {line}
        </text>
      ))}
    </svg>
  );
}
