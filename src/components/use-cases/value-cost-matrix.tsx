import type { CSSProperties } from "react";
import Link from "next/link";
import { shortRefOf, type AgentPalette } from "@/lib/use-cases/agents";
import { COST_BANDS, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import { costShortText, valueScreenText } from "@/lib/use-cases/format";
import { swarm } from "@/lib/use-cases/chart-layout";
import { ORIGIN_LABEL, ZONES, ZONE_HINT, ZONE_LABEL, type Zone } from "@/lib/use-cases/labels";
import { placeMatrixLabels, placeZoneLabels, zoneLabelRect, type MatrixLabelPlacement, type ZoneLabelInput, type ZoneLabelSpot } from "@/lib/use-cases/matrix-labels";
import type { Origin } from "@/lib/use-cases/types";
import type { CostFigure as CostFigureData, ValueFigure as ValueFigureData } from "@/lib/use-cases/valuation";
import { agentPointLegend, agentPointSlot, type GroupSlot } from "@/lib/use-cases/value-charts";
import { EXPIRED_TAG, toEstimateLabel, type HubEstimateParam } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { CHART_LABEL_CHAR_PX, ChartLabel, ChartListSection, ChartUseCaseLink } from "./chart-label";
import { CostFigure } from "./cost-figure";
import { Disclosure } from "./disclosure";
import { RevealOnMount } from "./list-focus";
import { NeedUseCaseLink } from "./need-use-cases";
import { ORIGIN_DOT_CLASS } from "./origin-chip";
import { GroupLegendItems, SLOT_BORDER, SLOT_FILL } from "./value-chart-colors";
import { ValueFigure } from "./value-figure";

/** Testi della matrice (docs/use-case/DESIGN.md §4.4, §14.3). */
export const MATRIX_TEXT = Object.freeze({
  label: "Matrice Valore × Costo di realizzazione",
  // Gli altri schermi scrivono il Valore in euro: qui l'asse dice che è il punteggio da 1 a 5.
  valueAxis: "Valore (punteggio 1–5)",
  costAxis: "Costo di realizzazione",
  approved: "approvato",
  toDecide: "da decidere",
  expired: "scaduto",
  allToEstimate: "Nessuno use case ha ancora Valore e Costo.",
});

export interface MatrixPoint {
  id: string;
  code: string | null;
  title: string;
  origin: Origin;
  /** Pieno se approvato, vuoto se da decidere. */
  approved: boolean;
  /** Approvato con un trimestre passato e non partito: bordo rosso, «Scaduto» come nelle corsie della Panoramica. */
  expired?: boolean;
  /** Posizione del costo, da 0,5 a 5,5 sulla scala delle fasce del workspace (`costPosition`). */
  x: number;
  /** Valore, da 1 a 5. */
  y: number;
  /** La zona (`zoneOf`): il gruppo dell'elenco sotto la matrice. Senza, quella dove cade il punto. */
  zone?: Zone | null;
  value: ValueFigureData;
  cost: CostFigureData;
  /** Apre il pannello laterale (`?apri=<id>`). */
  href: string;
}

/** Uno use case senza un punto nella matrice, in un elenco sotto di lei: «RD-0012 · Titolo», che apre il pannello. */
export interface MatrixOffItem {
  id: string;
  code: string | null;
  title: string;
  /** Il pannello laterale (`?apri=<id>`). */
  href: string;
}

export interface ValueCostMatrixProps {
  points: readonly MatrixPoint[];
  /** Soglia «Valore alto» del workspace (`thresholds.highImpact`, predefinita 3,5). */
  highValue: number;
  /** «Costo basso fino alla fascia N» del workspace (D18): il confine della fascia N, `costLowLinePosition(N)`. */
  lowCostX: number;
  /** Le 5 fasce del costo del workspace (D15): tacche e loro etichette. */
  bands?: readonly CostBandInfo[];
  /** Gli use case senza Valore o Costo: l'elenco chiuso «5 da stimare» sotto la matrice. */
  toEstimate: readonly MatrixOffItem[];
  /**
   * Le schede con «Benefici e costi» che non hanno un punto qui: l'elenco chiuso «2 senza beneficio
   * contato» (`offMatrixLabel`) sotto il primo. Senza, nessun elenco.
   */
  offMatrix?: { label: string; items: readonly MatrixOffItem[] } | null;
  /** L'elenco che l'indirizzo chiede (`stima`, un vecchio chip «N da stimare»), aperto quando la pagina si rende. */
  open?: HubEstimateParam | null;
  /**
   * I toni degli agenti del workspace (`workspaceAgentPalette`): con gli agenti nei titoli i punti
   * hanno il colore dell'agente, come i tag della Panoramica, e la legenda gli agenti; senza, l'origine.
   */
  agents?: AgentPalette | null;
}

/** Il dominio dei due assi: da 0,5 a 5,5, con le tacche a 1, 2, 3, 4, 5. */
const MIN = 0.5;
const SPAN = 5;

/** Percentuale orizzontale di una posizione del costo. */
function leftPct(x: number): number {
  return ((Math.min(5.5, Math.max(0.5, x)) - MIN) / SPAN) * 100;
}

/** Percentuale dall'alto di un Valore (alto in alto). */
function topPct(y: number): number {
  return ((MIN + SPAN - Math.min(5.5, Math.max(0.5, y))) / SPAN) * 100;
}

/** Le etichette delle zone, grigie; vanno a capo dentro la loro zona. */
const ZONE_TEXT = "absolute text-xs leading-tight break-words text-muted-foreground";

/**
 * Il riquadro della matrice, in pixel: 304 al telefono più stretto (360 px di finestra), 576 al più
 * largo (la figura è larga al massimo 600 px). Punti e posizioni delle etichette si calcolano lì.
 */
const MATRIX_BOX = Object.freeze({ minPx: 304, midPx: 440, maxPx: 576 });
/**
 * Le etichette che non stanno nel riquadro del telefono si scrivono da 440 px in su: la pagina larga
 * almeno 29rem (464 px, meno l'asse del Valore). Classi scritte per intero, così Tailwind le trova.
 */
const WIDE_LABEL_CLASS = "hidden @min-[29rem]/hub:block";
/** Il raggio del pallino, bordo compreso (10 px). */
const DOT_R = 5;
/** Di quanto un punto può salire o scendere per far posto agli altri, in punti di Valore. */
const VALUE_JITTER = 0.2;

/** Il lato della linea del costo basso e la metà del Valore di ogni zona. */
const ZONE_PLACE: Readonly<Record<Zone, Pick<ZoneLabelInput, "side" | "half">>> = {
  subito: { side: "low", half: "top" },
  da_pianificare: { side: "high", half: "top" },
  se_avanza_tempo: { side: "low", half: "bottom" },
  non_ora: { side: "high", half: "bottom" },
};
const ZONE_INPUTS: readonly ZoneLabelInput[] = ZONES.map((key) => ({ key, text: ZONE_LABEL[key], ...ZONE_PLACE[key] }));

type PlacedPoint = MatrixPoint & { left: number; top: number; zoneKey: Zone };

/**
 * Lo sciame dei punti (`swarm`, sul riquadro più piccolo): un punto resta nella sua fascia di costo
 * e alla sua altezza, e si sposta di lato quanto basta per non toccare gli altri; se la fascia è
 * piena a quell'altezza sale o scende di 0,2 punti di Valore al massimo, mai oltre la linea del
 * «Valore alto» né fuori da 1-5. Su Rondine quindici use case nella colonna «€» con Valore tra 1,6
 * e 2,1 erano un solo grumo di pallini; ora ognuno si vede e si clicca. Prima i punti più vicini al
 * bordo della loro metà (sotto la linea dal Valore più basso, sopra dal più alto), che hanno meno
 * spazio per spostarsi; a pari Valore l'ordine della lista. Nessun ordine per persona.
 */
function layoutPoints(points: readonly MatrixPoint[], highValue: number, lowCostX: number): PlacedPoint[] {
  const W = MATRIX_BOX.minPx;
  const px = (pct: number) => (pct / 100) * W;
  const highY = px(topPct(highValue));
  const isHigh = (point: MatrixPoint) => point.y >= highValue;
  const order = points.map((_, index) => index).sort((a, b) => {
    const pa = points[a];
    const pb = points[b];
    if (isHigh(pa) !== isHigh(pb)) return isHigh(pa) ? -1 : 1;
    return isHigh(pa) ? pb.y - pa.y : pa.y - pb.y;
  });
  const swarmed = swarm(
    order.map((index) => {
      const point = points[index];
      // La fascia del costo: da 0,5 a 1,5 la prima, e così via.
      const band = Math.min(5, Math.max(1, Math.ceil(point.x - 0.5)));
      return {
        x: px(leftPct(point.x)),
        y: px(topPct(point.y)),
        r: DOT_R,
        lo: px(leftPct(band - 0.5)) + DOT_R + 1,
        hi: px(leftPct(band + 0.5)) - DOT_R - 1,
        dy: VALUE_JITTER * (W / SPAN),
        yLo: isHigh(point) ? px(topPct(5)) : highY + DOT_R + 1,
        yHi: isHigh(point) ? highY - DOT_R - 1 : px(topPct(1)),
      };
    }),
    { gap: 1 },
  );
  const at = new Map(order.map((index, k) => [index, swarmed[k]]));
  return points.map((point, index) => {
    const low = point.x <= lowCostX;
    const zoneKey = point.zone ?? (isHigh(point) ? (low ? "subito" : "da_pianificare") : low ? "se_avanza_tempo" : "non_ora");
    const spot = at.get(index)!;
    return { ...point, left: (spot.x / W) * 100, top: (spot.y / W) * 100, zoneKey };
  });
}

/** La posizione del nome di una zona: nell'angolo esterno, o accanto alla linea del «Valore alto». */
function zoneStyle(zone: ZoneLabelInput, spot: ZoneLabelSpot, lowLeft: number, highTop: number): CSSProperties {
  // A sinistra della linea del costo basso, oppure a destra: l'etichetta non la passa.
  const horizontal = zone.side === "low" ? { maxWidth: `calc(${lowLeft}% - 0.75rem)` } : { left: `calc(${lowLeft}% + 0.5rem)` };
  if (zone.half === "top") return { ...horizontal, ...(spot === "outer" ? { top: "0.375rem" } : { bottom: `calc(${100 - highTop}% + 0.375rem)` }) };
  return { ...horizontal, ...(spot === "outer" ? { bottom: "0.375rem" } : { top: `calc(${highTop}% + 0.375rem)` }) };
}

/**
 * La matrice Valore × Costo di realizzazione del menu «⋯», sugli use case «Da costruire»
 * (docs/use-case/DESIGN.md §4.4, §7.2, §7.4; D5, D15). Valore da 1 a 5 in verticale; costo da €
 * a €€€€€ in orizzontale, sulla scala delle fasce del workspace (un importo cade dentro la sua
 * fascia, una fascia sola al centro). Due linee tratteggiate: «Valore alto» e «Costo basso», soglie del workspace.
 * Quattro zone in grigio: «Subito», «Da pianificare», «Se avanza tempo», «Non ora», ognuna dentro
 * la sua zona, di qua o di là della linea del costo basso (anche al telefono): nell'angolo esterno,
 * o accanto alla linea del «Valore alto» se l'angolo esterno è pieno di punti (`placeZoneLabels`).
 * Punti di 10 px colorati per origine (in un workspace con gli agenti nei titoli per agente, nel
 * tono del suo tag, grigi senza: `agentPointSlot`), pieni se approvati, vuoti se da decidere, con
 * il bordo rosso se scaduti. Punti nello stesso posto si aprono a sciame dentro la loro fascia
 * (`layoutPoints`), così nessuno copre un altro. Il tag o il codice sta accanto ai soli punti
 * isolati, dove è libero a ogni larghezza (`placeMatrixLabels`: non copre punti, nomi delle zone
 * né linee tratteggiate), con un alone del colore della pagina; i gruppi fitti si leggono
 * nell'elenco per zona sotto la legenda. Al passaggio del mouse codice, titolo, Valore, Costo e
 * fonte; al clic, o al tocco, il pannello laterale (il punto e il codice sono lo stesso link,
 * largo abbastanza per un dito). Senza trascinamento. Sotto la legenda gli use case per zona, poi
 * quelli senza Valore o Costo e quelli con «Benefici e costi» senza un punto, tutti in elenchi
 * chiusi (`toEstimate`, `offMatrix`). Solo per i revisori.
 */
export function ValueCostMatrix({ points, highValue, lowCostX, bands = COST_BANDS, toEstimate, offMatrix = null, open = null, agents = null }: ValueCostMatrixProps) {
  const placed = layoutPoints(points, highValue, lowCostX);
  // Per agente solo se i titoli del workspace li portano; altrimenti per origine, come sempre.
  const agentLegend = agentPointLegend(agents, points.map((point) => point.title));
  const anyExpired = points.some((point) => point.expired);
  const highTop = topPct(highValue);
  const lowLeft = leftPct(lowCostX);
  const geometry = { lowLeftPct: lowLeft, highTopPct: highTop };
  const widths = [MATRIX_BOX.minPx, MATRIX_BOX.midPx, MATRIX_BOX.maxPx];
  const spots = placeZoneLabels(
    ZONE_INPUTS,
    placed.map((point) => ({ left: point.left, top: point.top, radiusPx: DOT_R })),
    geometry,
    widths,
  );
  // Le etichette: dalla matrice più piccola (304 px, al telefono) alla più grande (576 px), oppure
  // solo da 440 px. Ogni punto è un ostacolo, e così i nomi delle zone e le due linee tratteggiate.
  const labels = placeMatrixLabels(
    placed.map((point) => ({ id: point.id, left: point.left, top: point.top, text: shortRefOf(point) ?? "" })),
    {
      boxPx: MATRIX_BOX.minPx,
      maxBoxPx: MATRIX_BOX.maxPx,
      wideFromPx: MATRIX_BOX.midPx,
      charPx: CHART_LABEL_CHAR_PX,
      dotPx: 2 * DOT_R,
      obstacles: (box) => [
        ...ZONE_INPUTS.map((zone) => zoneLabelRect(zone, spots[zone.key], geometry, box)),
        { x: 0, y: (highTop / 100) * box.h - 2, w: box.w, h: 4 },
        { x: (lowLeft / 100) * box.w - 2, y: 0, w: 4, h: box.h },
      ],
    },
  );
  const byZone = ZONES.map((zone) => ({ zone, points: placed.filter((point) => point.zoneKey === zone) })).filter((group) => group.points.length);
  return (
    <figure data-slot="value-cost-matrix" aria-label={MATRIX_TEXT.label} className="w-full max-w-[600px] space-y-3">
      {points.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{MATRIX_TEXT.allToEstimate}</p>
      ) : (
        <div className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-1">
          <div />
          <p className="pb-1 text-xs text-muted-foreground">{MATRIX_TEXT.valueAxis}</p>
          {/* Le tacche del Valore. */}
          <div className="relative" aria-hidden>
            {[1, 2, 3, 4, 5].map((tick) => (
              <span key={tick} className="absolute right-0 -translate-y-1/2 text-[11px] text-muted-foreground tabular-nums" style={{ top: `${topPct(tick)}%` }}>
                {tick}
              </span>
            ))}
          </div>
          <div className="relative aspect-square w-full">
            <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
              <rect x="0" y="0" width="100" height="100" className="fill-muted/30 stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              {[1.5, 2.5, 3.5, 4.5].map((edge) => (
                <line key={edge} x1={leftPct(edge)} x2={leftPct(edge)} y1="0" y2="100" className="stroke-border/60" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
              <line x1="0" x2="100" y1={highTop} y2={highTop} className="stroke-muted-foreground/70" strokeWidth="1.25" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
              <line x1={lowLeft} x2={lowLeft} y1="0" y2="100" className="stroke-muted-foreground/70" strokeWidth="1.25" strokeDasharray="5 4" vectorEffect="non-scaling-stroke" />
            </svg>
            {ZONE_INPUTS.map((zone) => (
              <span
                key={zone.key}
                aria-hidden
                data-slot="zone-label"
                data-zone={zone.key}
                data-spot={spots[zone.key]}
                className={cn(ZONE_TEXT, zone.side === "low" ? "left-2" : "right-2 text-right")}
                style={zoneStyle(zone, spots[zone.key], lowLeft, highTop)}
              >
                {zone.text}
              </span>
            ))}
            <ul className="absolute inset-0">
              {placed.map((point) => (
                <MatrixDot key={point.id} point={point} bands={bands} label={labels.get(point.id) ?? null} slot={agentPointSlot(agents, point.title)} />
              ))}
            </ul>
          </div>
          <div />
          {/* Asse del costo: le fasce del workspace, con la loro etichetta al passaggio del mouse. */}
          <div className="relative h-5">
            {bands.map((band) => (
              <span
                key={band.band}
                title={band.label}
                className="absolute top-1 -translate-x-1/2 text-[11px] whitespace-nowrap text-muted-foreground"
                style={{ left: `${leftPct(band.band)}%` }}
              >
                {band.symbol}
                <span className="sr-only"> {band.label}</span>
              </span>
            ))}
          </div>
          <div />
          <p className="pt-1 text-right text-xs text-muted-foreground">{MATRIX_TEXT.costAxis}</p>
        </div>
      )}
      <figcaption className="space-y-2">
        <p data-slot="matrix-legend" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {agentLegend.length ? (
            <GroupLegendItems entries={agentLegend} />
          ) : (
            (["adoption", "transformation"] as const).map((origin) => (
              <span key={origin} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn("size-2.5 rounded-full", ORIGIN_DOT_CLASS[origin])} />
                {ORIGIN_LABEL[origin].chip}
              </span>
            ))
          )}
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full border-2 border-muted-foreground bg-muted-foreground" />
            {MATRIX_TEXT.approved}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span aria-hidden className="size-2.5 rounded-full border-2 border-muted-foreground bg-background" />
            {MATRIX_TEXT.toDecide}
          </span>
          {anyExpired ? (
            <span className="inline-flex items-center gap-1.5">
              <span aria-hidden className="size-2.5 rounded-full border-2 border-muted-foreground bg-muted-foreground ring-2 ring-red-500" />
              {MATRIX_TEXT.expired}
            </span>
          ) : null}
        </p>
        {byZone.length || toEstimate.length || offMatrix ? (
          <div className="space-y-1">
            {/* I punti per zona: i gruppi fitti, che nel grafico non hanno etichetta, si leggono qui. */}
            {byZone.map(({ zone, points: inZone }) => (
              <ChartListSection key={zone} slot="matrix-zone" label={ZONE_LABEL[zone]} count={inZone.length}>
                {inZone.map((point) => (
                  <li key={point.id}>
                    <ChartUseCaseLink href={point.href} code={point.code} title={point.title} marker={<PointMark point={point} slot={agentPointSlot(agents, point.title)} />} />
                  </li>
                ))}
              </ChartListSection>
            ))}
            {toEstimate.length ? (
              <Disclosure slot="to-estimate" summary={toEstimateLabel(toEstimate.length)} defaultOpen={open === "mancante"}>
                <MatrixOffList items={toEstimate} />
                {/* Aperto da un vecchio link: l'elenco in vista, non sotto la piega. */}
                {open === "mancante" ? <RevealOnMount /> : null}
              </Disclosure>
            ) : null}
            {offMatrix ? (
              <Disclosure slot="off-matrix" summary={offMatrix.label} defaultOpen={open === "fuori-matrice"}>
                <MatrixOffList items={offMatrix.items} />
                {open === "fuori-matrice" ? <RevealOnMount /> : null}
              </Disclosure>
            ) : null}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">{ZONE_HINT}</p>
      </figcaption>
    </figure>
  );
}

/** Un elenco chiuso sotto la matrice: un link per use case, «RD-0012 · Titolo», che apre il pannello e resta nella pagina. */
function MatrixOffList({ items }: { items: readonly MatrixOffItem[] }) {
  return (
    <ul className="space-y-0.5">
      {items.map((item) => (
        <li key={item.id}>
          <NeedUseCaseLink useCase={item} href={item.href} scroll={false} />
        </li>
      ))}
    </ul>
  );
}

const RING_CLASS: Readonly<Record<Origin, string>> = {
  adoption: "border-teal-500",
  transformation: "border-indigo-500",
};

/** Il pallino di un punto: il colore dell'agente o dell'origine, pieno se approvato, il bordo rosso se scaduto. */
function PointMark({ point, slot, className }: { point: MatrixPoint; slot: GroupSlot | null; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "size-2.5 shrink-0 rounded-full border-2",
        slot === null ? RING_CLASS[point.origin] : SLOT_BORDER[slot],
        point.approved ? (slot === null ? ORIGIN_DOT_CLASS[point.origin] : SLOT_FILL[slot]) : "bg-background",
        point.expired && "ring-2 ring-red-500 ring-offset-1 ring-offset-background",
        className,
      )}
    />
  );
}

function MatrixDot({
  point,
  bands,
  label,
  slot,
}: {
  point: PlacedPoint;
  bands: readonly CostBandInfo[];
  /** Dove sta il tag accanto al punto; null: il punto non è isolato, o il tag non sta libero. */
  label: MatrixLabelPlacement | null;
  /** Il tono dell'agente del punto (`agentPointSlot`, 0 il grigio); null: il colore dell'origine. */
  slot: GroupSlot | null;
}) {
  const text = `${point.code ? `${point.code} ` : ""}${point.title}. Valore: ${valueScreenText(point.value)}. Costo: ${costShortText(point.cost, bands)}`;
  const short = shortRefOf(point);
  // Il riquadro si apre verso il centro, così non esce dalla matrice.
  const toLeft = point.left > 50;
  const above = point.top > 35;
  return (
    // Il punto sotto il puntatore, o con il fuoco, sale sopra gli altri: il suo riquadro resta leggibile.
    <li className="absolute -translate-x-1/2 -translate-y-1/2 focus-within:z-20 hover:z-20" style={{ left: `${point.left}%`, top: `${point.top}%` }}>
      <Link
        href={point.href}
        scroll={false}
        aria-label={point.expired ? `${text}. ${EXPIRED_TAG}` : text}
        data-point={point.id}
        data-expired={point.expired ? "true" : undefined}
        className="group relative flex size-8 touch-manipulation items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50 pointer-coarse:size-11"
      >
        <PointMark point={point} slot={slot} className="transition-transform group-hover:scale-125" />
        {short && label ? <ChartLabel slot="matrix-label" text={short} dx={label.dx} dy={label.dy} className={label.wide ? WIDE_LABEL_CLASS : undefined} /> : null}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-10 hidden w-max max-w-[min(15rem,60vw)] space-y-1 rounded-lg border bg-popover px-3 py-2 text-left text-xs text-popover-foreground shadow-md group-hover:block group-focus-visible:block",
            toLeft ? "right-1/2" : "left-1/2",
            above ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {point.code ? <span className="block font-mono text-muted-foreground">{point.code}</span> : null}
          <span className="block font-medium whitespace-normal">{point.title}</span>
          <ValueFigure value={point.value} withLabel withSource className="block text-xs" />
          <CostFigure cost={point.cost} bands={bands} withLabel className="block text-xs" />
          {point.expired ? <span className="block font-medium text-red-300">{EXPIRED_TAG}</span> : null}
        </span>
      </Link>
    </li>
  );
}
