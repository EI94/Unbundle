import type { ReactNode } from "react";
import { formatEuro } from "@/lib/use-cases/format";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { monthLabel } from "@/lib/use-cases/value-calc";
import { curveScale, type RoadmapValue } from "@/lib/use-cases/value-charts";
import { cn } from "@/lib/utils";

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
}

/**
 * La J-curve di «Curva del valore» (menu «⋯»; spec di Pierpaolo, 25/10/2026): il valore netto cumulato delle schede
 * approvate e in realizzazione con «Benefici e costi», mese per mese dall'origine delle ipotesi
 * (`jCurve` di value-calc). Area e linea, la linea dello zero, linee tratteggiate ai mesi di
 * entrata in uso, il punto di pareggio con la sua etichetta e il valore a fine orizzonte. SVG
 * scritto a mano come la matrice Valore × Costo; al passaggio del mouse il mese con il netto e chi
 * entra in uso. Sotto i 768 px, e per i lettori di schermo, le stesse cifre come elenco e tabella.
 */
export function ValueJCurve({ value }: ValueJCurveProps) {
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

      <div data-slot="value-jcurve-chart" aria-hidden className="hidden grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 md:grid">
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

      {/* Al telefono: le tappe della curva, senza grafico. */}
      <dl data-slot="value-jcurve-list" className="space-y-2 text-sm md:hidden">
        {low ? <Fact label={JCURVE_TEXT.low} value={`${formatEuro(low.net)} · ${low.label}`} /> : null}
        {goLives.map((mark) => (
          <Fact key={mark.index} label={`${JCURVE_TEXT.goLive} · ${mark.label}`} value={<Names names={mark.names} />} />
        ))}
        {value.breakevenText ? <Fact label={JCURVE_TEXT.breakeven} value={value.breakevenText} /> : null}
        <Fact label={afterMonthsText(horizon)} value={formatEuro(end)} />
      </dl>

      {/*
        Per i lettori di schermo, da tablet in su: la curva mese per mese. `sr-only` sta sul riquadro,
        non sulla tabella: con `display: table` la larghezza di 1 px non vale, e le righe lunghe di
        «Entrata in uso» allargavano la pagina.
      */}
      <div className="sr-only hidden md:block">
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

/** «LIBRA L1, TJ-0006»: ogni nome intero su una riga, mai «TJ-» da una parte e «0006» dall'altra. */
function Names({ names }: { names: readonly string[] }) {
  return (
    <>
      {names.map((name, index) => (
        <span key={`${index}-${name}`}>
          {index ? " " : null}
          <span className="whitespace-nowrap">{index < names.length - 1 ? `${name},` : name}</span>
        </span>
      ))}
    </>
  );
}
