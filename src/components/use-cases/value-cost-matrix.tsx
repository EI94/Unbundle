import Link from "next/link";
import { shortRefOf } from "@/lib/use-cases/agents";
import { COST_BANDS, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import { costShortText, valueScreenText } from "@/lib/use-cases/format";
import { ORIGIN_LABEL, ZONE_HINT, ZONE_LABEL } from "@/lib/use-cases/labels";
import { groupLabelTexts, groupNearPoints, placeMatrixLabels, type MatrixLabelPlacement } from "@/lib/use-cases/matrix-labels";
import type { Origin } from "@/lib/use-cases/types";
import type { CostFigure as CostFigureData, ValueFigure as ValueFigureData } from "@/lib/use-cases/valuation";
import { EXPIRED_TAG, toEstimateLabel, type HubEstimateParam } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { CostFigure } from "./cost-figure";
import { Disclosure } from "./disclosure";
import { RevealOnMount } from "./list-focus";
import { NeedUseCaseLink } from "./need-use-cases";
import { ORIGIN_DOT_CLASS } from "./origin-chip";
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
  value: ValueFigureData;
  cost: CostFigureData;
  /** Apre il pannello laterale (`?apri=<id>`). */
  href: string;
}

/** Uno use case senza un punto nella matrice, in un elenco sotto di lei: «TJ-0012 · Titolo», che apre il pannello. */
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

const clamp = (pct: number) => Math.min(97, Math.max(3, pct));

/** Le etichette delle zone, grigie; vanno a capo dentro la loro zona. */
const ZONE_TEXT = "absolute text-xs leading-tight break-words text-muted-foreground";

/**
 * Punti che cadono nello stesso posto (stessa fascia, stesso Valore): si aprono a raggiera di
 * poco, così ognuno resta cliccabile. Punti quasi nello stesso posto restano dove sono (la
 * posizione è il loro costo), ma il primo porta l'etichetta con tutti i codici del gruppo
 * («TJ-0001, TJ-0004», `groupNearPoints`): senza, il secondo codice copriva il primo e uno use case
 * spariva dal grafico. Un titolo con l'agente dà il tag al posto del codice («LIBRA L1, TJ-0004»),
 * come le card della Panoramica (`shortRefOf`). Nessun ordine per persona: l'ordine è quello della lista.
 */
function spread(points: readonly MatrixPoint[]): Array<MatrixPoint & { left: number; top: number; labelText: string }> {
  const groups = new Map<string, number>();
  const seen = new Map<string, number>();
  for (const point of points) {
    const key = `${leftPct(point.x).toFixed(1)}|${topPct(point.y).toFixed(1)}`;
    groups.set(key, (groups.get(key) ?? 0) + 1);
  }
  const placed = points.map((point) => {
    const left = leftPct(point.x);
    const top = topPct(point.y);
    const key = `${left.toFixed(1)}|${top.toFixed(1)}`;
    const size = groups.get(key) ?? 1;
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    if (size === 1) return { ...point, left: clamp(left), top: clamp(top) };
    const angle = (2 * Math.PI * index) / size;
    const radius = 2.2;
    return { ...point, left: clamp(left + radius * Math.cos(angle)), top: clamp(top + radius * Math.sin(angle)) };
  });
  const texts = groupLabelTexts(
    placed.map((point) => shortRefOf(point)),
    groupNearPoints(placed),
  );
  return placed.map((point, index) => ({ ...point, labelText: texts[index] }));
}

/**
 * La matrice Valore × Costo di realizzazione del menu «⋯», sugli use case «Da costruire»
 * (docs/use-case/DESIGN.md §4.4, §7.2, §7.4; D5, D15). Valore da 1 a 5 in verticale; costo da €
 * a €€€€€ in orizzontale, sulla scala delle fasce del workspace (un importo cade dentro la sua
 * fascia, una fascia sola al centro). Due linee tratteggiate: «Valore alto» e «Costo basso», soglie del workspace.
 * Quattro zone in grigio: «Subito», «Da pianificare», «Se avanza tempo», «Non ora», ognuna dentro
 * la sua zona, di qua o di là della linea del costo basso (anche al telefono). Punti di
 * 10 px colorati per origine, pieni se approvati, vuoti se da decidere, con il bordo rosso se
 * scaduti; ogni punto ha accanto il suo codice, messo dove non copre gli altri
 * (`placeMatrixLabels`; dove coprirebbe qualcosa non c'è, come nelle bolle facilità × beneficio);
 * punti quasi nello stesso posto hanno un'etichetta sola con tutti i loro codici.
 * Al passaggio del mouse codice, titolo, Valore, Costo e fonte; al clic,
 * o al tocco, il pannello laterale (il punto e il codice sono lo stesso link, largo abbastanza
 * per un dito). Senza trascinamento. Sotto la legenda, gli use case senza Valore o Costo, e quelli
 * con «Benefici e costi» senza un punto, in due elenchi chiusi (`toEstimate`, `offMatrix`). Solo per i revisori.
 */
export function ValueCostMatrix({ points, highValue, lowCostX, bands = COST_BANDS, toEstimate, offMatrix = null, open = null }: ValueCostMatrixProps) {
  const placed = spread(points);
  // Le etichette si mettono per la matrice più piccola (320 px, al telefono) e per la più grande (600 px).
  // Ogni punto è un ostacolo; ha un'etichetta solo chi porta i codici del suo gruppo.
  const labels = placeMatrixLabels(
    placed.map((point) => ({ id: point.id, left: point.left, top: point.top, text: point.labelText })),
    { boxPx: 320, maxBoxPx: 600 },
  );
  const anyExpired = points.some((point) => point.expired);
  const highTop = topPct(highValue);
  const lowLeft = leftPct(lowCostX);
  // A sinistra della linea del costo basso, oppure a destra: l'etichetta non la passa.
  const lowSide = { maxWidth: `calc(${lowLeft}% - 0.75rem)` };
  const highSide = { left: `calc(${lowLeft}% + 0.5rem)` };
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
            <span aria-hidden className={cn(ZONE_TEXT, "top-1.5 left-2")} style={lowSide}>
              {ZONE_LABEL.subito}
            </span>
            <span aria-hidden className={cn(ZONE_TEXT, "top-1.5 right-2 text-right")} style={highSide}>
              {ZONE_LABEL.da_pianificare}
            </span>
            <span aria-hidden className={cn(ZONE_TEXT, "bottom-1.5 left-2")} style={lowSide}>
              {ZONE_LABEL.se_avanza_tempo}
            </span>
            <span aria-hidden className={cn(ZONE_TEXT, "right-2 bottom-1.5 text-right")} style={highSide}>
              {ZONE_LABEL.non_ora}
            </span>
            <ul className="absolute inset-0">
              {placed.map((point) => (
                <MatrixDot key={point.id} point={point} bands={bands} label={labels.get(point.id) ?? null} />
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
          {(["adoption", "transformation"] as const).map((origin) => (
            <span key={origin} className="inline-flex items-center gap-1.5">
              <span aria-hidden className={cn("size-2.5 rounded-full", ORIGIN_DOT_CLASS[origin])} />
              {ORIGIN_LABEL[origin].chip}
            </span>
          ))}
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
        {toEstimate.length || offMatrix ? (
          <div className="space-y-1">
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

/** Un elenco chiuso sotto la matrice: un link per use case, «TJ-0012 · Titolo», che apre il pannello e resta nella pagina. */
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

function MatrixDot({
  point,
  bands,
  label,
}: {
  point: MatrixPoint & { left: number; top: number; labelText: string };
  bands: readonly CostBandInfo[];
  label: MatrixLabelPlacement | null;
}) {
  const text = `${point.code ? `${point.code} ` : ""}${point.title}. Valore: ${valueScreenText(point.value)}. Costo: ${costShortText(point.cost, bands)}`;
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
        <span
          aria-hidden
          className={cn(
            "size-2.5 rounded-full border-2 transition-transform group-hover:scale-125",
            RING_CLASS[point.origin],
            point.approved ? ORIGIN_DOT_CLASS[point.origin] : "bg-background",
            point.expired && "ring-2 ring-red-500 ring-offset-1 ring-offset-background",
          )}
        />
        {point.labelText && label && !label.crowded ? (
          <span
            aria-hidden
            data-slot="matrix-label"
            className={cn(
              "pointer-events-none absolute rounded-sm bg-background/80 px-0.5 font-mono text-[10px] leading-[13px] whitespace-nowrap text-muted-foreground group-hover:text-foreground",
              // Sotto i 768 px, dove coprirebbe un altro punto, il codice non c'è (più tenue era 2,2:1 sul fondo).
              label.crowdedSmall && "max-md:hidden",
            )}
            style={{ left: `calc(50% + ${label.dx}px)`, top: `calc(50% + ${label.dy}px)` }}
          >
            {point.labelText}
          </span>
        ) : null}
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
