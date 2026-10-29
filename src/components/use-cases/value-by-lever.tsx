"use client";

import { useState, type ReactElement } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { LEVER_META } from "@/components/uc/common/lever-icons";
import { FIGURE_SEPARATOR, formatEuro, qualitativeCountText } from "@/lib/use-cases/format";
import type { GroupLegendEntry, LeverChart, LeverRow, LeverSegment } from "@/lib/use-cases/value-charts";
import { cn } from "@/lib/utils";
import { GroupLegendItems, SLOT_BORDER, SLOT_FILL, SLOT_FILL_SOFT } from "./value-chart-colors";

/** Testi di «Valore per tipo di ritorno» (spec di Pierpaolo, 25/10/2026). */
export const LEVER_CHART_TEXT = Object.freeze({
  title: "Valore per tipo di ritorno",
  intro: "Un segmento per use case, dal più grande. Il tratteggio è da misurare, fuori dal totale.",
  open: "Apri",
  pending: "da misurare",
  outOfTotal: "fuori dal totale",
  perYear: "all'anno",
  pendingLegend: "da misurare",
  upTo: "fino a",
});

/** «XX-0007 Smistamento: 4.043 € all'anno» (con «da misurare, fuori dal totale» per la parte tratteggiata). */
function segmentLabel(segment: LeverSegment, row: LeverRow, pending: boolean): string {
  const name = segment.code ? `${segment.code} ${segment.title}` : segment.title;
  const amount = pending
    ? `${LEVER_CHART_TEXT.pending}, ${LEVER_CHART_TEXT.upTo} ${formatEuro(segment.eur)}, ${LEVER_CHART_TEXT.outOfTotal}`
    : `${formatEuro(segment.eur)} ${LEVER_CHART_TEXT.perYear}`;
  return `${name}: ${amount} · ${row.label}${segment.groupLabel ? ` · ${segment.groupLabel}` : ""}`;
}

export interface ValueByLeverProps {
  chart: LeverChart;
  /** id → il pannello laterale (`?apri=<id>`). */
  hrefs: Readonly<Record<string, string>>;
  /** La legenda dei gruppi; vuota con un colore solo. */
  legend: readonly GroupLegendEntry[];
}

/**
 * «Valore per tipo di ritorno» di «Curva del valore» (menu «⋯»): una riga per ognuno degli 8 tipi, con l'icona di
 * `LEVER_META` e una barra impilata, un segmento per use case dal più grande, colorato per gruppo
 * (con gli agenti nei titoli per l'agente del titolo).
 * Ogni segmento è un bottone: apre un popover con le voci di quel tipo e «Apri». La parte da
 * misurare è tratteggiata e fuori dal totale; «(2 qualitativi)» conta le voci qualitative e apre i
 * loro use case. Tutte le righe usano la stessa scala. Sotto i 768 px un elenco al posto delle barre.
 *
 * Senza recharts né d3, con i token del tema. I segmenti sono bottoni HTML e non rettangoli SVG:
 * ognuno si raggiunge con la tastiera e apre il suo popover, come i punti della matrice Valore × Costo.
 */
export function ValueByLever({ chart, hrefs, legend }: ValueByLeverProps) {
  const rows = chart.rows;
  const anyPending = rows.some((row) => row.pending.length > 0);
  return (
    <figure data-slot="value-by-lever" aria-labelledby="value-by-lever-title" className="min-w-0 space-y-3">
      <div className="space-y-0.5">
        <h3 id="value-by-lever-title" className="text-sm font-semibold">
          {LEVER_CHART_TEXT.title}
        </h3>
        <p className="text-xs text-muted-foreground">{LEVER_CHART_TEXT.intro}</p>
      </div>

      <ul data-slot="value-by-lever-bars" className="hidden space-y-1 md:block">
        {rows.map((row) => (
          <BarRow key={row.lever} row={row} max={chart.max} hrefs={hrefs} />
        ))}
      </ul>

      <ul data-slot="value-by-lever-list" className="space-y-3 md:hidden">
        {rows
          .filter((row) => row.segments.length || row.pending.length || row.qualitative.length)
          .map((row) => (
            <PhoneRow key={row.lever} row={row} hrefs={hrefs} />
          ))}
      </ul>

      {legend.length || anyPending ? (
        <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <GroupLegendItems entries={legend} square />
          {anyPending ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("h-2.5 w-4 rounded-[2px] border border-dashed", SLOT_BORDER[0], SLOT_FILL_SOFT[0])} />
              {LEVER_CHART_TEXT.pendingLegend}
            </span>
          ) : null}
        </figcaption>
      ) : null}
    </figure>
  );
}

function LeverName({ row, className }: { row: LeverRow; className?: string }) {
  const Icon = LEVER_META[row.lever].icon;
  return (
    <span className={cn("flex min-w-0 items-center gap-1.5", className)}>
      <Icon aria-hidden className="size-4 shrink-0 text-muted-foreground" />
      <span className="truncate">{row.label}</span>
    </span>
  );
}

function BarRow({ row, max, hrefs }: { row: LeverRow; max: number; hrefs: Readonly<Record<string, string>> }) {
  const width = (eur: number) => (max > 0 ? `max(6px, calc(${((eur / max) * 100).toFixed(3)}% - 2px))` : "6px");
  const empty = !row.segments.length && !row.pending.length;
  return (
    <li data-lever={row.lever} className="grid min-h-8 grid-cols-[10.5rem_minmax(0,1fr)_minmax(6.5rem,auto)] items-center gap-3 text-sm">
      <LeverName row={row} className={empty && !row.qualitative.length ? "text-muted-foreground" : undefined} />
      <div className="flex h-6 min-w-0 items-center gap-0.5">
        {row.segments.map((segment) => (
          <SegmentPopover
            key={`c-${segment.id}`}
            segment={segment}
            row={row}
            href={hrefs[segment.id] ?? "#"}
            trigger={
              <button
                type="button"
                aria-label={segmentLabel(segment, row, false)}
                data-segment={segment.id}
                className={cn(
                  "h-5 shrink-0 rounded-[3px] outline-none transition-[filter] hover:brightness-125 focus-visible:ring-3 focus-visible:ring-ring/50 aria-expanded:brightness-125",
                  SLOT_FILL[segment.slot],
                )}
                style={{ width: width(segment.eur) }}
              />
            }
          />
        ))}
        {row.pending.map((segment) => (
          <SegmentPopover
            key={`p-${segment.id}`}
            segment={segment}
            row={row}
            href={hrefs[segment.id] ?? "#"}
            trigger={
              <button
                type="button"
                aria-label={segmentLabel(segment, row, true)}
                data-segment={segment.id}
                data-pending="true"
                className={cn(
                  "h-5 shrink-0 rounded-[3px] border border-dashed outline-none hover:brightness-125 focus-visible:ring-3 focus-visible:ring-ring/50",
                  SLOT_BORDER[segment.slot],
                  SLOT_FILL_SOFT[segment.slot],
                )}
                style={{ width: width(segment.eur) }}
              />
            }
          />
        ))}
      </div>
      <span className="flex items-baseline justify-end gap-1.5 whitespace-nowrap">
        {row.total > 0 ? <span className="tabular-nums">{formatEuro(row.total)}</span> : !row.qualitative.length ? <span className="text-muted-foreground">—</span> : null}
        {row.qualitative.length ? <QualitativePopover row={row} hrefs={hrefs} /> : null}
      </span>
    </li>
  );
}

/** Un segmento con il suo popover: le voci di quel tipo dello use case e «Apri», che chiude il popover. */
function SegmentPopover({ segment, row, href, trigger }: { segment: LeverSegment; row: LeverRow; href: string; trigger: ReactElement }) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={trigger} />
      <PopoverContent align="start" className="w-72 max-w-[calc(100vw-2rem)] gap-2 p-3">
        <UseCaseLines segment={segment} row={row} />
        <Button variant="outline" size="sm" className="self-start" nativeButton={false} render={<Link href={href} scroll={false} onClick={() => setOpen(false)} />}>
          {LEVER_CHART_TEXT.open}
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function UseCaseLines({ segment, row }: { segment: LeverSegment; row: LeverRow }) {
  return (
    <div className="space-y-2" data-slot="lever-popover">
      <div>
        {segment.code ? <p className="font-mono text-xs text-muted-foreground">{segment.code}</p> : null}
        <p className="font-medium">{segment.title}</p>
        <LeverName row={row} className="pt-0.5 text-xs text-muted-foreground" />
        {segment.groupLabel ? <p className="pt-0.5 text-xs text-muted-foreground">{segment.groupLabel}</p> : null}
      </div>
      <ul className="space-y-1.5">
        {segment.components.map((line) => (
          <li key={line.key} className="text-sm">
            <p>{line.label}</p>
            <p className="text-xs text-muted-foreground">
              <span className="text-foreground tabular-nums">{line.amount}</span>
              {FIGURE_SEPARATOR}
              {line.confidence}
              {!line.counted && line.kind !== "qualitativo" ? `${FIGURE_SEPARATOR}${LEVER_CHART_TEXT.outOfTotal}` : ""}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** «(2 qualitativi)», le voci qualitative di questo tipo: apre i loro use case, ognuno con «Apri». */
function QualitativePopover({ row, hrefs }: { row: LeverRow; hrefs: Readonly<Record<string, string>> }) {
  const [open, setOpen] = useState(false);
  const text = qualitativeCountText(row.qualitativeCount);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <button
            type="button"
            data-qualitative={row.lever}
            className="rounded-sm text-xs text-muted-foreground underline decoration-dotted underline-offset-4 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        }
      >
        {text}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 max-w-[calc(100vw-2rem)] gap-3 p-3">
        {row.qualitative.map((segment) => (
          <div key={segment.id} className="space-y-1.5">
            <UseCaseLines segment={{ ...segment, components: segment.components.filter((line) => line.kind === "qualitativo") }} row={row} />
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href={hrefs[segment.id] ?? "#"} scroll={false} onClick={() => setOpen(false)} />}>
              {LEVER_CHART_TEXT.open}
            </Button>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** Al telefono: il tipo con il suo totale e, sotto, gli use case come link. */
function PhoneRow({ row, hrefs }: { row: LeverRow; hrefs: Readonly<Record<string, string>> }) {
  const link = (segment: LeverSegment, text: string, kind: string) => (
    <li key={`${kind}-${segment.id}`}>
      <Link href={hrefs[segment.id] ?? "#"} scroll={false} className="flex min-h-11 items-center gap-2 rounded-md px-1 text-sm outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50">
        <span
          aria-hidden
          className={cn(
            "size-2.5 shrink-0 rounded-[2px]",
            kind === "c" ? SLOT_FILL[segment.slot] : kind === "p" ? cn("border border-dashed", SLOT_BORDER[segment.slot]) : cn("border", SLOT_BORDER[segment.slot]),
          )}
        />
        {segment.code ? <span className="font-mono text-xs text-muted-foreground">{segment.code}</span> : null}
        <span className="min-w-0 flex-1 truncate">{segment.title}</span>
        <span className="text-xs whitespace-nowrap text-muted-foreground tabular-nums">{text}</span>
      </Link>
    </li>
  );
  return (
    <li data-lever={row.lever} className="space-y-1">
      <p className="flex items-baseline justify-between gap-3 text-sm font-medium">
        <LeverName row={row} />
        {row.total > 0 ? <span className="tabular-nums">{formatEuro(row.total)}</span> : null}
      </p>
      <ul>
        {row.segments.map((segment) => link(segment, formatEuro(segment.eur), "c"))}
        {row.pending.map((segment) => link(segment, `${LEVER_CHART_TEXT.pending} · ${LEVER_CHART_TEXT.upTo} ${formatEuro(segment.eur)}`, "p"))}
        {row.qualitative.map((segment) => link(segment, "qualitativo", "q"))}
      </ul>
    </li>
  );
}
