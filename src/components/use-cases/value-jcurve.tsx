import type { ReactNode } from "react";
import { shortRefOf } from "@/lib/use-cases/agents";
import { formatEuro } from "@/lib/use-cases/format";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { monthLabel } from "@/lib/use-cases/value-calc";
import { curveScale, type RoadmapValue } from "@/lib/use-cases/value-charts";
import { cn } from "@/lib/utils";
import { ChartListSection, ChartUseCaseLink } from "./chart-label";

/** Testi della J-curve di «Curva del valore» (menu «⋯»; spec di Pierpaolo, 25/10/2026). */
export const JCURVE_TEXT = Object.freeze({
  title: "Valore netto cumulato",
  goLive: "Entra in uso",
  goLiveLegend: "entrata in uso",
  breakeven: "Pareggio",
  low: "Punto più basso",
  month: "Mese",
  net: "Netto cumulato",
});

/** «Da nov 26, per 24 mesi: prima l'avvio, poi benefici e costi ricorrenti.» */
export function jCurveIntro(from: string, months: number): string {
  return `Da ${from}, per ${months} mesi: prima l'avvio, poi benefici e costi ricorrenti.`;
}

/** «Dopo 24 mesi». */
export function afterMonthsText(months: number): string {
  return months === 1 ? "Dopo 1 mese" : `Dopo ${months} mesi`;
}

export interface ValueJCurveProps {
  value: RoadmapValue;
  /** id → il pannello laterale: gli use case che entrano in uso, nell'elenco al telefono. */
  hrefs?: Readonly<Record<string, string>>;
}

/**
 * La J-curve di «Curva del valore» (menu «⋯»; spec di Pierpaolo, 25/10/2026): il valore netto cumulato delle schede
 * approvate e in realizzazione con «Benefici e costi», mese per mese dall'origine delle ipotesi
 * (`jCurve` di value-calc). Area e linea, la linea dello zero, linee tratteggiate ai mesi di
 * entrata in uso, il punto di pareggio con la sua etichetta e il valore a fine orizzonte. SVG
 * scritto a mano come la matrice Valore × Costo; al passaggio del mouse il mese con il netto e chi
 * entra in uso. In una pagina più stretta di 36rem (il telefono, il tablet accanto alla barra) le
 * tappe al posto del grafico: punto più basso, pareggio e valore a fine orizzonte, poi un mese di
 * entrata in uso per sezione chiusa («Entra in uso · gen 27 · 17 use case»), con gli use case su
 * due righe come nelle card. Per i lettori di schermo, da 36rem in su, la tabella mese per mese.
 */
export function ValueJCurve({ value, hrefs = {} }: ValueJCurveProps) {
  const { curve, goLives, low } = value;
  const horizon = curve.months.length - 1;
  const scale = curveScale(Math.min(...curve.net), Math.max(...curve.net));
  const span = scale.max - scale.min;
  const y = (net: number) => ((scale.max - net) / span) * 100;
  const x = (m: number) => (horizon > 0 ? (m / horizon) * 100 : 0);
  const zero = y(0);
  const points = curve.net.map((net, m) => `${x(m).toFixed(3)} ${y(net).toFixed(3)}`);
  const line = `M ${points.join(" L ")}`;
  const area = `M ${x(0)} ${zero} L ${points.join(" L ")} L ${x(horizon)} ${zero} Z`;
  const step = Math.max(1, Math.ceil(horizon / 4));
  const ticks = Array.from({ length: Math.floor(horizon / step) + 1 }, (_, i) => i * step);
  const breakeven = curve.breakeven;
  const end = curve.net[horizon];
  const showEnd = breakeven === null || x(breakeven) < 75;
  const goLiveAt = new Map(goLives.map((mark) => [mark.index, mark]));
  const from = monthLabel(curve.months[0]);
  return (
    <figure data-slot="value-jcurve" aria-labelledby="value-jcurve-title" className="min-w-0 space-y-3">
      <div className="space-y-0.5">
        <h3 id="value-jcurve-title" className="text-sm font-semibold">
          {JCURVE_TEXT.title}
        </h3>
        <p className="text-xs text-muted-foreground">{keepTogether(jCurveIntro(from, horizon))}</p>
      </div>

      <div data-slot="value-jcurve-chart" aria-hidden className="hidden grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 @xl/hub:grid">
        <div className="relative">
          {scale.ticks.map((tick) => (
            <span key={tick} className="absolute right-0 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums" style={{ top: `${y(tick)}%` }}>
              {formatEuro(tick)}
            </span>
          ))}
        </div>
        <div className="relative h-52">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
            {scale.ticks.map((tick) =>
              tick === 0 ? null : <line key={tick} x1="0" x2="100" y1={y(tick)} y2={y(tick)} className="stroke-border/60" strokeWidth="1" vectorEffect="non-scaling-stroke" />,
            )}
            {goLives.map((mark) => (
              <line
                key={mark.index}
                data-go-live={mark.month}
                x1={x(mark.index)}
                x2={x(mark.index)}
                y1="0"
                y2="100"
                className="stroke-muted-foreground/80"
                strokeWidth="1"
                strokeDasharray="4 4"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            <path d={area} className="fill-uc-serie-1/10" />
            <line x1="0" x2="100" y1={zero} y2={zero} className="stroke-muted-foreground" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            <path d={line} className="fill-none stroke-uc-serie-1" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
          </svg>

          {breakeven !== null ? (
            <span data-slot="jcurve-breakeven" className="absolute" style={{ left: `${x(breakeven)}%`, top: `${y(curve.net[breakeven])}%` }}>
              <span className="absolute size-2.5 -translate-1/2 rounded-full bg-uc-serie-1 ring-2 ring-background" />
              <span
                className={cn(
                  "absolute bottom-2 rounded-sm bg-background/80 px-1 text-xs font-medium whitespace-nowrap",
                  x(breakeven) > 75 ? "right-1" : "left-1",
                )}
              >
                {JCURVE_TEXT.breakeven} · {value.breakevenText}
              </span>
            </span>
          ) : null}
          {showEnd ? (
            <span className="absolute right-0 -translate-y-[130%] rounded-sm bg-background/80 px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums" style={{ top: `${y(end)}%` }}>
              {formatEuro(end)}
            </span>
          ) : null}

          {/* Il mese sotto il puntatore: linea sottile, punto e riquadro con il netto. */}
          <ul className="absolute inset-0">
            {curve.net.map((net, m) => {
              const mark = goLiveAt.get(m);
              const right = x(m) > 60;
              return (
                <li key={m} className="group absolute inset-y-0" style={{ left: `${x(m) - 50 / Math.max(1, horizon)}%`, width: `${100 / Math.max(1, horizon)}%` }}>
                  <span className="absolute inset-y-0 left-1/2 hidden w-px bg-muted-foreground/50 group-hover:block" />
                  <span className="absolute left-1/2 hidden size-2 -translate-1/2 rounded-full bg-uc-serie-1 ring-2 ring-background group-hover:block" style={{ top: `${y(net)}%` }} />
                  <span
                    className={cn(
                      "pointer-events-none absolute top-0 z-10 hidden w-max max-w-[14rem] space-y-0.5 rounded-lg border bg-popover px-3 py-2 text-xs text-popover-foreground shadow-md group-hover:block",
                      right ? "right-1/2 mr-2" : "left-1/2 ml-2",
                    )}
                  >
                    <span className="block font-semibold tabular-nums">{formatEuro(net)}</span>
                    <span className="block text-muted-foreground">{monthLabel(curve.months[m])}</span>
                    {mark ? (
                      <span className="block text-muted-foreground">
                        {JCURVE_TEXT.goLive}: {mark.names.join(", ")}
                      </span>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
        <div />
        <div className="relative h-5">
          {ticks.map((m, i) => (
            <span
              key={m}
              className={cn(
                "absolute top-1 text-[11px] whitespace-nowrap text-muted-foreground",
                i === 0 ? "" : m === horizon ? "-translate-x-full" : "-translate-x-1/2",
              )}
              style={{ left: `${x(m)}%` }}
            >
              {monthLabel(curve.months[m])}
            </span>
          ))}
        </div>
        <div />
        <p className="flex items-center gap-1.5 pt-1 text-xs text-muted-foreground">
          <svg viewBox="0 0 16 2" className="h-0.5 w-4" aria-hidden>
            <line x1="0" x2="16" y1="1" y2="1" className="stroke-muted-foreground" strokeWidth="2" strokeDasharray="3 3" />
          </svg>
          {JCURVE_TEXT.goLiveLegend}
        </p>
      </div>

      {/* Al telefono: le tappe della curva, senza grafico; i mesi di entrata in uso chiusi. */}
      <div data-slot="value-jcurve-list" className="space-y-3 text-sm @xl/hub:hidden">
        <dl className="space-y-2">
          {low ? <Fact label={JCURVE_TEXT.low} value={`${formatEuro(low.net)} · ${low.label}`} /> : null}
          {value.breakevenText ? <Fact label={JCURVE_TEXT.breakeven} value={value.breakevenText} /> : null}
          <Fact label={afterMonthsText(horizon)} value={formatEuro(end)} />
        </dl>
        {goLives.length ? (
          <div className="space-y-1">
            {goLives.map((mark) => {
              const cards = value.cards
                .filter((card) => card.goLive === mark.index)
                .sort((a, b) => (shortRefOf(a) ?? a.title).localeCompare(shortRefOf(b) ?? b.title, "it-IT"));
              return (
                <ChartListSection key={mark.index} slot="jcurve-go-live" label={`${JCURVE_TEXT.goLive} · ${mark.label}`} count={cards.length}>
                  {cards.map((card) => (
                    <li key={card.id}>
                      <ChartUseCaseLink href={hrefs[card.id] ?? "#"} code={card.code} title={card.title} />
                    </li>
                  ))}
                </ChartListSection>
              );
            })}
          </div>
        ) : null}
      </div>

      {/*
        Per i lettori di schermo, da una pagina di 36rem in su: la curva mese per mese. `sr-only` sta sul riquadro,
        non sulla tabella: con `display: table` la larghezza di 1 px non vale, e le righe lunghe di
        «Entrata in uso» allargavano la pagina.
      */}
      <div className="sr-only hidden @xl/hub:block">
        <table>
          <caption>{JCURVE_TEXT.title}</caption>
          <thead>
            <tr>
              <th scope="col">{JCURVE_TEXT.month}</th>
              <th scope="col">{JCURVE_TEXT.net}</th>
            </tr>
          </thead>
          <tbody>
            {curve.net.map((net, m) => {
              const mark = goLiveAt.get(m);
              return (
                <tr key={m}>
                  <th scope="row">{monthLabel(curve.months[m])}</th>
                  <td>
                    {formatEuro(net)}
                    {mark ? ` · ${JCURVE_TEXT.goLive}: ${mark.names.join(", ")}` : ""}
                    {m === breakeven ? ` · ${JCURVE_TEXT.breakeven}` : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

/** Una tappa al telefono: il nome sopra, il valore sotto, così un elenco lungo ha tutta la riga. */
function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="space-y-0.5">
      <dt className="text-muted-foreground">{keepTogether(label)}</dt>
      <dd className="tabular-nums">{typeof value === "string" ? keepTogether(value) : value}</dd>
    </div>
  );
}
