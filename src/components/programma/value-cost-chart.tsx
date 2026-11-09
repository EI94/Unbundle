"use client";

import { useRef, useState, type PointerEvent } from "react";
import { formatEuro } from "@/lib/use-cases/format";
import { niceScale } from "@/lib/use-cases/value-charts";
import { monthLabel, monthLongLabel } from "@/lib/use-cases/value-calc";
import type { ViewCurve } from "@/lib/programma/view";
import { PROGRAM_TEXT } from "@/lib/programma/text";
import { cn } from "@/lib/utils";

const T = PROGRAM_TEXT;

/** «812k €», «1,2 mln €»: solo sull'asse, dove serve poco spazio. */
function axisEuro(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  if (abs >= 1e6) return `${(n / 1e6).toLocaleString("it-IT", { maximumFractionDigits: 1 })} mln €`;
  if (abs >= 1e3) return `${Math.round(n / 1e3).toLocaleString("it-IT")}k €`;
  return `${Math.round(n)} €`;
}

/** Il testo del pareggio sotto il titolo. */
export function breakevenText(curve: Pick<ViewCurve, "breakeven">, label: string = T.breakeven): string {
  const b = curve.breakeven;
  if (!b) return T.noBreakeven;
  if (b.kind === "subito") return `${label} subito`;
  if (b.kind === "oltre") return `${label} oltre ${monthLabel(b.month)}`;
  return `${label} · ${monthLabel(b.month)}`;
}

/** «Pareggio a gennaio 2027.» per i lettori di schermo. */
function breakevenSentence(curve: Pick<ViewCurve, "breakeven">): string {
  const b = curve.breakeven;
  if (!b) return T.noBreakeven;
  if (b.kind === "subito") return `${T.breakevenNow}.`;
  if (b.kind === "oltre") return `Pareggio oltre ${monthLongLabel(b.month)}.`;
  return `Pareggio a ${monthLongLabel(b.month)}.`;
}

/**
 * Valore e costo cumulati (decisione del titolare: due linee, mai un netto): fino a oggi linee piene, dopo
 * tratteggiate (previsione); la linea di «oggi»; il pareggio dove il valore raggiunge il costo. Al passaggio
 * del mouse (o toccando) il mese con valore e costo. Per i lettori di schermo una frase con i numeri; la
 * tabella mese per mese sta nel pannello.
 */
export function ValueCostChart({ curve, compact = false }: { curve: ViewCurve; compact?: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const last = curve.months.length - 1;
  const max = Math.max(0, ...curve.value, ...curve.cost);
  const scale = niceScale(0, max, compact ? 3 : 4);
  const y = (v: number) => ((scale.max - v) / (scale.max - scale.min || 1)) * 100;
  const x = (i: number) => (last > 0 ? (i / last) * 100 : 0);
  const line = (values: readonly number[], from: number, to: number) =>
    values
      .slice(from, to + 1)
      .map((v, k) => `${(k === 0 ? "M" : "L")} ${x(from + k).toFixed(3)} ${y(v).toFixed(3)}`)
      .join(" ");
  const t = curve.today;
  const b = curve.breakeven?.kind === "mese" ? curve.breakeven : null;
  const ticks = compact ? [0, Math.round(last / 2), last] : [0, Math.round(last / 4), Math.round(last / 2), Math.round((3 * last) / 4), last];
  const onMove = (event: PointerEvent<HTMLDivElement>) => {
    const rect = box.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const i = Math.round(((event.clientX - rect.left) / rect.width) * last);
    setHover(Math.max(0, Math.min(last, i)));
  };
  const summary = `A ${monthLongLabel(curve.months[last])}: ${T.value.toLowerCase()} cumulato ${formatEuro(curve.value[last])}, ${T.cost.toLowerCase()} cumulato ${formatEuro(curve.cost[last])}. ${breakevenSentence(curve)}`;
  return (
    <figure data-slot="value-cost-chart" className="min-w-0 space-y-2">
      <p className="sr-only">{summary}</p>
      <div aria-hidden className="grid grid-cols-[3.25rem_minmax(0,1fr)] gap-x-2">
        <div className={cn("relative", compact ? "h-40" : "h-52 sm:h-60")}>
          {scale.ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums" style={{ top: `${y(tick)}%` }}>
              {axisEuro(tick)}
            </span>
          ))}
        </div>
        <div ref={box} className={cn("relative touch-pan-y", compact ? "h-40" : "h-52 sm:h-60")} onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)}>
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            {scale.ticks.map((tick) => (
              <line key={tick} x1="0" x2="100" y1={y(tick)} y2={y(tick)} className={tick === 0 ? "stroke-muted-foreground/60" : "stroke-border/60"} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            ))}
            {t > 0 && t < last ? <line x1={x(t)} x2={x(t)} y1="0" y2="100" className="stroke-muted-foreground/70" strokeWidth="1" strokeDasharray="2 3" vectorEffect="non-scaling-stroke" /> : null}
            <path d={line(curve.cost, 0, t)} className="fill-none stroke-uc-serie-2" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={line(curve.cost, t, last)} className="fill-none stroke-uc-serie-2" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={line(curve.value, 0, t)} className="fill-none stroke-uc-serie-1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            <path d={line(curve.value, t, last)} className="fill-none stroke-uc-serie-1" strokeWidth="2" strokeDasharray="5 4" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
            {hover !== null ? <line x1={x(hover)} x2={x(hover)} y1="0" y2="100" className="stroke-muted-foreground" strokeWidth="1" vectorEffect="non-scaling-stroke" /> : null}
          </svg>
          {t > 0 && t < last ? (
            <span className="absolute top-0 ml-1 text-[11px] text-muted-foreground" style={{ left: `${x(t)}%` }}>
              {T.today}
            </span>
          ) : null}
          {b ? (
            <span className="absolute" style={{ left: `${x(b.index)}%`, top: `${y(curve.value[b.index])}%` }}>
              <span className="absolute size-2.5 -translate-1/2 rounded-full border-2 border-foreground bg-background" />
              <span className={cn("absolute bottom-2 rounded-sm bg-background/85 px-1 text-xs font-semibold whitespace-nowrap", x(b.index) > 70 ? "right-1" : "left-1")}>
                {T.breakeven} · {monthLabel(b.month)}
              </span>
            </span>
          ) : null}
          {hover !== null ? (
            <>
              <span className="absolute size-2 -translate-1/2 rounded-full bg-uc-serie-1 ring-2 ring-background" style={{ left: `${x(hover)}%`, top: `${y(curve.value[hover])}%` }} />
              <span className="absolute size-2 -translate-1/2 rounded-full bg-uc-serie-2 ring-2 ring-background" style={{ left: `${x(hover)}%`, top: `${y(curve.cost[hover])}%` }} />
              <span
                className="pointer-events-none absolute top-2 z-10 min-w-36 rounded-md border bg-popover px-2 py-1.5 text-xs shadow-sm"
                style={x(hover) > 55 ? { right: `${100 - x(hover) + 2}%` } : { left: `${x(hover) + 2}%` }}
              >
                <span className="block font-medium">
                  {monthLongLabel(curve.months[hover])}
                  {hover > t ? ` · ${T.forecast}` : ""}
                </span>
                <span className="block tabular-nums">
                  <span className="text-uc-serie-1">●</span> {T.value} {formatEuro(curve.value[hover])}
                </span>
                <span className="block tabular-nums">
                  <span className="text-uc-serie-2">●</span> {T.cost} {formatEuro(curve.cost[hover])}
                </span>
              </span>
            </>
          ) : null}
        </div>
        <div />
        <div className="relative mt-1 h-4">
          {ticks.map((i) => (
            <span
              key={i}
              className={cn("absolute text-[11px] text-muted-foreground", i === 0 ? "left-0" : i === last ? "right-0" : "-translate-x-1/2")}
              style={i === 0 || i === last ? undefined : { left: `${x(i)}%` }}
            >
              {monthLabel(curve.months[i])}
            </span>
          ))}
        </div>
      </div>
      <figcaption className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded bg-uc-serie-1" />
          {T.value} {formatEuro(curve.value[last])}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-0.5 w-4 rounded bg-uc-serie-2" />
          {T.cost} {formatEuro(curve.cost[last])}
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block w-4 border-t-2 border-dashed border-muted-foreground" />
          {T.forecast}
        </span>
        <span>fino a {monthLabel(curve.months[last])}</span>
      </figcaption>
    </figure>
  );
}
