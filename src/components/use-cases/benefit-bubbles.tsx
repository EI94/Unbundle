import Link from "next/link";
import { shortRefOf } from "@/lib/use-cases/agents";
import { packStrip, swarm } from "@/lib/use-cases/chart-layout";
import { FIGURE_SEPARATOR, formatEuro, oneoffRunParts, oneoffRunText, perYearShortText } from "@/lib/use-cases/format";
import { UP_TO_WORD, VALUE_MODEL_STATE_LABEL } from "@/lib/use-cases/labels";
import { SCREEN_SEPARATOR, joinPieces, keepTogether } from "@/lib/use-cases/line-breaks";
import { placeMatrixLabels, type MatrixLabelPlacement } from "@/lib/use-cases/matrix-labels";
import { BUBBLE_WHEN_LABEL, bubbleWhenText, markLegendGroups, type BenefitBubble, type BenefitBubbles, type BubbleWhen, type GroupPalette } from "@/lib/use-cases/value-charts";
import { cn } from "@/lib/utils";
import { CHART_LABEL_CHAR_PX, ChartLabel, ChartListSection, ChartUseCaseLink } from "./chart-label";
import { SLOT_BORDER, SLOT_FILL, SLOT_FILL_MID, SLOT_FILL_SOFT } from "./value-chart-colors";

/** Testi della «Matrice Facilità × Beneficio» (dal menu «⋯» della Panoramica; spec di Pierpaolo, 25/10/2026). */
export const BUBBLES_TEXT = Object.freeze({
  label: "Matrice Facilità × Beneficio",
  benefitAxis: "Beneficio contato all'anno",
  easeAxis: "Facilità",
  ease: "Facilità",
  hard: "difficile",
  easy: "facile",
  size: "Bolla più grande: costo di avvio più alto.",
  /** La striscia sotto lo zero: le bolle senza un beneficio contato (da misurare o qualitativo). */
  notCounted: "non contato",
  empty: "Nessuno use case della vista ha la facilità in «Benefici e costi».",
});

/** «1 use case senza facilità non è nel grafico.» */
export function withoutEaseText(count: number): string {
  return count === 1 ? "1 use case senza facilità non è nel grafico." : `${count} use case senza facilità non sono nel grafico.`;
}

/** «da misurare · fino a 1.680 €»: la parte che non conta, se c'è. */
function pendingText(bubble: Pick<BenefitBubble, "pendingEur">): string | null {
  return bubble.pendingEur > 0 ? `${VALUE_MODEL_STATE_LABEL.da_misurare}${FIGURE_SEPARATOR}${UP_TO_WORD} ${formatEuro(bubble.pendingEur)}` : null;
}

/** «4.043 €/anno»; senza beneficio contato «da misurare · fino a 5.000 €» oppure «qualitativo». */
function benefitText(bubble: Pick<BenefitBubble, "benefit" | "pendingEur">): string {
  if (bubble.benefit > 0) return perYearShortText(bubble.benefit);
  return pendingText(bubble) ?? VALUE_MODEL_STATE_LABEL.qualitativo;
}

/**
 * Le parti della riga sotto il titolo, nell'elenco sotto il grafico: ognuna va a capo intera, mai
 * «1.200» da una parte e «€/anno» dall'altra, e il «·» resta con la parte prima (`joinPieces`).
 * `withGroup: false` nell'elenco, dove il gruppo è il titolo della sezione.
 */
export function bubbleSummaryParts(bubble: BenefitBubble, { withGroup = true }: { withGroup?: boolean } = {}): string[] {
  const parts = [`${BUBBLES_TEXT.ease} ${bubble.ease}`, benefitText(bubble), ...oneoffRunParts(bubble.oneoff, bubble.run), bubbleWhenText(bubble)];
  if (withGroup && bubble.groupLabel) parts.push(bubble.groupLabel);
  return parts;
}

/**
 * «Facilità 4 · 4.043 €/anno · avvio 560 € · ricorrenti 600 €/anno · questo trimestre · Gruppo Vendite»
 * (con «· scaduto» se il trimestre è passato); con gli agenti nei titoli senza il gruppo: il colore
 * è dell'agente del titolo, e lo dice la legenda (`groupLabelOf`).
 */
export function bubbleSummary(bubble: BenefitBubble): string {
  return bubbleSummaryParts(bubble).join(FIGURE_SEPARATOR);
}

/** Bordo e riempimento: scuro questo trimestre, pieno il prossimo, tratteggiato più avanti, chiaro da decidere. */
export function bubbleClass(bubble: Pick<BenefitBubble, "slot" | "when">): string {
  const fill = bubble.when === "da_decidere" ? SLOT_FILL_SOFT[bubble.slot] : SLOT_FILL_MID[bubble.slot];
  switch (bubble.when) {
    case "questo_trimestre":
      return cn(fill, "border-2 border-foreground");
    case "prossimo_trimestre":
      return cn(fill, "border-2", SLOT_BORDER[bubble.slot]);
    case "piu_avanti":
      return cn(fill, "border-2 border-dashed", SLOT_BORDER[bubble.slot]);
    case "da_decidere":
      return cn(fill, "border", SLOT_BORDER[bubble.slot]);
  }
}

/** La facilità da 0,5 a 5,5, con le tacche da 1 a 5. */
function leftPct(ease: number): number {
  return ((Math.min(5.5, Math.max(0.5, ease)) - 0.5) / 5) * 100;
}

const WHEN_ORDER: readonly BubbleWhen[] = ["questo_trimestre", "prossimo_trimestre", "piu_avanti", "da_decidere"];

/**
 * Il riquadro delle bolle, in pixel: il grafico si disegna da una pagina larga 36rem (576 px), dove
 * è largo 496 px, fino a 640 px (la figura è larga al massimo 720 px). Bolle ed etichette si
 * calcolano su 480 px; la parte del beneficio contato è alta tre quarti della larghezza.
 */
const PLOT = Object.freeze({ minPx: 480, maxPx: 640, aspect: 0.75 });
/** Tra la linea dello zero e la prima bolla della striscia «non contato», in pixel. */
const STRIP_GAP = 10;

interface BubbleLayout {
  /** Le misure del riquadro su cui si calcola, in pixel: la parte del beneficio più la striscia. */
  width: number;
  height: number;
  /** Il beneficio (da 0 al massimo della scala) in percentuale dall'alto. */
  topOf: (benefit: number) => number;
  /** La striscia delle bolle senza beneficio contato, in percentuale dall'alto; null se non ce ne sono. */
  strip: { top: number; middle: number } | null;
  /** Le bolle nell'ordine ricevuto (dalla più grande: le piccole restano sopra), con la loro posizione in percentuale. */
  bubbles: Array<BenefitBubble & { left: number; top: number }>;
}

/**
 * Dove sta ogni bolla. Con un beneficio contato: alla sua altezza, e di lato nella colonna della
 * sua facilità quanto basta per non toccare le altre (`swarm`). Senza: nella striscia «non
 * contato» sotto lo zero, ognuna nella colonna della sua facilità, il più in alto possibile
 * (`packStrip`). Su TopJet 28 bolle su 46 erano una sopra l'altra sullo zero, a facilità 2, 3 e 4.
 */
function layoutBubbles(bubbles: readonly BenefitBubble[], max: number): BubbleLayout {
  const W = PLOT.minPx;
  const countedHeight = W * PLOT.aspect;
  const yOf = (benefit: number) => {
    const share = max > 0 ? Math.min(1, Math.max(0, benefit / max)) : 0;
    return (0.04 + (1 - share) * 0.92) * countedHeight;
  };
  const column = (bubble: BenefitBubble) => {
    const x = (leftPct(bubble.ease) / 100) * W;
    const half = W / 10;
    return { x, lo: x - half + bubble.r + 2, hi: x + half - bubble.r - 2 };
  };
  const counted = bubbles.filter((bubble) => bubble.benefit > 0);
  const swarmed = swarm(
    counted.map((bubble) => ({ ...column(bubble), y: yOf(bubble.benefit), r: bubble.r })),
    { gap: 2 },
  );
  const zeroY = yOf(0);
  const rest = bubbles.filter((bubble) => !(bubble.benefit > 0));
  const strip = rest.length
    ? packStrip(
        rest.map((bubble) => ({ ...column(bubble), r: bubble.r })),
        { top: zeroY + STRIP_GAP, gap: 2, placed: swarmed.map((spot, index) => ({ x: spot.x, y: spot.y, r: counted[index].r })) },
      )
    : null;
  const H = Math.max(countedHeight, strip ? strip.bottom + 6 : 0);
  const at = new Map<string, { x: number; y: number }>();
  counted.forEach((bubble, index) => at.set(bubble.id, swarmed[index]));
  rest.forEach((bubble, index) => at.set(bubble.id, strip!.placements[index]));
  return {
    width: W,
    height: H,
    topOf: (benefit) => (yOf(benefit) / H) * 100,
    strip: strip ? { top: (zeroY / H) * 100, middle: ((zeroY + STRIP_GAP + H) / 2 / H) * 100 } : null,
    bubbles: bubbles.map((bubble) => {
      const spot = at.get(bubble.id)!;
      return { ...bubble, left: (spot.x / W) * 100, top: (spot.y / H) * 100 };
    }),
  };
}

/** «Questo trimestre». */
function sentenceCase(text: string): string {
  return text.charAt(0).toLocaleUpperCase("it-IT") + text.slice(1);
}

interface BubbleSection {
  key: string;
  label: string;
  /** Il segno del gruppo: il colore, oppure il bordo del «quando» con un colore solo. */
  marker: string;
  bubbles: BenefitBubble[];
}

/**
 * Le sezioni dell'elenco sotto il grafico, che sono anche la legenda dei colori (`markLegendGroups`):
 * con gli agenti nei titoli una per agente del titolo, quelli con un tono in ordine alfabetico, poi in
 * grigio quelli con sole proposte, poi il grigio «Altri use case»; senza agenti una per colore del
 * gruppo, il grigio in fondo; con un colore solo una per «quando». Dentro, dalla più facile, poi dal
 * beneficio più alto.
 */
function bubbleSections(bubbles: readonly BenefitBubble[], palette: GroupPalette): BubbleSection[] {
  const sorted = [...bubbles].sort((a, b) => b.ease - a.ease || b.benefit - a.benefit || (a.code ?? "").localeCompare(b.code ?? ""));
  if (palette.single) {
    return WHEN_ORDER.map((when) => ({
      key: when,
      label: sentenceCase(BUBBLE_WHEN_LABEL[when]),
      marker: bubbleClass({ slot: 1, when }),
      bubbles: sorted.filter((bubble) => bubble.when === when),
    })).filter((section) => section.bubbles.length);
  }
  return markLegendGroups(palette, sorted)
    .map(({ entry, marks }) => ({ key: `${entry.slot}-${entry.label}`, label: entry.label, marker: SLOT_FILL[entry.slot], bubbles: marks }))
    .filter((section) => section.bubbles.length);
}

export interface BenefitBubblesProps {
  chart: BenefitBubbles;
  palette: GroupPalette;
  /** id → il pannello laterale (`?apri=<id>`). */
  hrefs: Readonly<Record<string, string>>;
}

/**
 * «Matrice Facilità × Beneficio» (dal menu «⋯» della Panoramica; spec di Pierpaolo, 25/10/2026): la
 * matrice a bolle facilità × beneficio, scritta a mano come la matrice Valore × Costo. x la
 * facilità da 1 (difficile) a 5 (facile), y il beneficio contato all'anno; la bolla è grande quanto
 * il costo di avvio, colorata per gruppo (con gli agenti nei titoli per l'agente del titolo, come la
 * matrice). Il bordo dice quando: scuro questo trimestre, pieno il prossimo, tratteggiato più avanti;
 * il riempimento chiaro è «da decidere». Le bolle senza un
 * beneficio contato (da misurare o qualitative) stanno nella striscia «non contato» sotto lo zero;
 * nessuna bolla ne copre un'altra (`layoutBubbles`). Al passaggio del mouse, o con la tastiera,
 * codice, titolo e cifre; al clic il pannello laterale. Sotto il grafico l'elenco per gruppo (o per
 * agente), in sezioni chiuse: è anche la legenda dei colori. In una pagina più stretta di 36rem
 * (il telefono, il tablet accanto alla barra) solo l'elenco. Solo revisori.
 *
 * Il riquadro, la griglia e le tacche sono SVG scritto a mano (niente recharts né d3); le bolle sono
 * link HTML posati sopra, come i punti della matrice Valore × Costo, perché ognuna si raggiunge con
 * la tastiera, si tocca con un dito e apre il pannello. Il tag o il codice sta accanto alle sole
 * bolle isolate con un beneficio contato, dove non copre altre bolle, altri codici né la striscia
 * (`placeMatrixLabels`), con un alone del colore della pagina; le altre si leggono nell'elenco, nel
 * riquadro e nell'etichetta per i lettori di schermo.
 */
export function BenefitBubbleChart({ chart, palette, hrefs }: BenefitBubblesProps) {
  const layout = layoutBubbles(chart.bubbles, chart.scale.max);
  const strip = layout.strip;
  const labels = placeMatrixLabels(
    layout.bubbles.map((bubble) => ({ id: bubble.id, left: bubble.left, top: bubble.top, text: bubble.benefit > 0 ? (shortRefOf(bubble) ?? "") : "", radiusPx: bubble.r })),
    {
      boxPx: PLOT.minPx,
      maxBoxPx: PLOT.maxPx,
      aspect: layout.height / layout.width,
      charPx: CHART_LABEL_CHAR_PX,
      // Nessun codice nella striscia: lì le bolle sono fitte, e un codice sembrerebbe di un'altra.
      obstacles: strip ? (box) => [{ x: 0, y: (strip.top / 100) * box.h - 1, w: box.w, h: box.h }] : undefined,
    },
  );
  const sections = bubbleSections(chart.bubbles, palette);
  // Con un colore solo le sezioni sono per «quando»: la legenda del bordo sarebbe un doppione.
  const whens = palette.single ? [] : WHEN_ORDER.filter((when) => chart.bubbles.some((bubble) => bubble.when === when));
  return (
    <figure data-slot="benefit-bubbles" aria-label={BUBBLES_TEXT.label} className="w-full max-w-[720px] space-y-3">
      {chart.bubbles.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{keepTogether(BUBBLES_TEXT.empty)}</p>
      ) : (
        <div data-slot="benefit-bubbles-chart" className="hidden grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 @xl/hub:grid">
          <div />
          <p className="pb-1 text-xs text-muted-foreground">{BUBBLES_TEXT.benefitAxis}</p>
          <div className="relative" aria-hidden>
            {chart.scale.ticks.map((tick) => (
              <span key={tick} className="absolute right-0 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums" style={{ top: `${layout.topOf(tick)}%` }}>
                {formatEuro(tick)}
              </span>
            ))}
            {strip ? (
              <span data-slot="bubbles-strip-label" className="absolute right-0 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground" style={{ top: `${strip.middle}%` }}>
                {BUBBLES_TEXT.notCounted}
              </span>
            ) : null}
          </div>
          <div className="relative w-full" style={{ aspectRatio: `${layout.width} / ${Math.round(layout.height)}` }}>
            <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
              <rect x="0" y="0" width="100" height="100" className="fill-muted/30 stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              {chart.scale.ticks.map((tick) => (
                <line key={tick} x1="0" x2="100" y1={layout.topOf(tick)} y2={layout.topOf(tick)} className="stroke-border/60" strokeWidth="1" vectorEffect="non-scaling-stroke" />
              ))}
            </svg>
            <ul className="absolute inset-0">
              {layout.bubbles.map((bubble) => (
                <BubbleDot key={bubble.id} bubble={bubble} href={hrefs[bubble.id] ?? "#"} label={labels.get(bubble.id) ?? null} />
              ))}
            </ul>
          </div>
          <div />
          <div className="relative h-5" aria-hidden>
            {[1, 2, 3, 4, 5].map((tick) => (
              <span key={tick} className="absolute top-1 -translate-x-1/2 text-[11px] text-muted-foreground tabular-nums" style={{ left: `${leftPct(tick)}%` }}>
                {tick}
              </span>
            ))}
          </div>
          <div />
          <p className="flex justify-between pt-1 text-xs text-muted-foreground">
            <span>{BUBBLES_TEXT.hard}</span>
            <span>{BUBBLES_TEXT.easeAxis}</span>
            <span>{BUBBLES_TEXT.easy}</span>
          </p>
        </div>
      )}
      <figcaption className="space-y-2">
        {chart.bubbles.length ? (
          <p data-slot="bubbles-legend" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            {whens.map((when) => (
              <span key={when} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn("size-3 shrink-0 rounded-full", bubbleClass({ slot: 0, when }))} />
                {BUBBLE_WHEN_LABEL[when]}
              </span>
            ))}
            {/* Nell'elenco i pallini sono tutti uguali: la misura la dice solo il grafico. */}
            <span className="hidden @xl/hub:inline">{BUBBLES_TEXT.size}</span>
          </p>
        ) : null}
        {sections.length ? (
          // Su una pagina larga 42rem due colonne: undici agenti in sei righe sotto il grafico.
          <div data-slot="benefit-bubbles-list" className="grid content-start gap-x-6 gap-y-1 @2xl/hub:grid-cols-2">
            {sections.map((section) => (
              <ChartListSection
                key={section.key}
                slot="bubbles-section"
                marker={<span aria-hidden className={cn("size-2.5 shrink-0 rounded-full", section.marker)} />}
                label={section.label}
                count={section.bubbles.length}
              >
                {section.bubbles.map((bubble) => (
                  <li key={bubble.id}>
                    <ChartUseCaseLink
                      href={hrefs[bubble.id] ?? "#"}
                      code={bubble.code}
                      title={bubble.title}
                      marker={<span aria-hidden className={cn("size-3 shrink-0 rounded-full", bubbleClass(bubble))} />}
                      detail={<span data-slot="bubble-summary">{joinPieces(bubbleSummaryParts(bubble, { withGroup: false }))}</span>}
                    />
                  </li>
                ))}
              </ChartListSection>
            ))}
          </div>
        ) : null}
        {chart.withoutEase > 0 ? <p className="text-xs text-muted-foreground">{keepTogether(withoutEaseText(chart.withoutEase))}</p> : null}
      </figcaption>
    </figure>
  );
}

function BubbleDot({ bubble, href, label: placement }: { bubble: BenefitBubble & { left: number; top: number }; href: string; label: MatrixLabelPlacement | null }) {
  const size = Math.round(bubble.r * 2);
  const hit = Math.max(32, size);
  // Il «da misurare» in coda solo accanto a un beneficio contato: senza, è già la cifra.
  const pending = bubble.benefit > 0 ? pendingText(bubble) : null;
  const label = `${bubble.code ? `${bubble.code} ` : ""}${bubble.title}. ${bubbleSummary(bubble)}${pending ? `${FIGURE_SEPARATOR}${pending}` : ""}`;
  const short = shortRefOf(bubble);
  // Il riquadro si apre verso il centro, così non esce dal grafico.
  const toLeft = bubble.left > 50;
  const above = bubble.top > 35;
  return (
    // Ogni <li> spostato è un contesto di sovrapposizione: quello sotto il puntatore, o con il fuoco,
    // sale sopra gli altri, così il suo riquadro non finisce sotto le bolle che vengono dopo.
    <li className="absolute -translate-x-1/2 -translate-y-1/2 focus-within:z-20 hover:z-20" style={{ left: `${bubble.left}%`, top: `${bubble.top}%` }}>
      <Link
        href={href}
        scroll={false}
        aria-label={label}
        data-bubble={bubble.id}
        data-when={bubble.when}
        className="group relative flex touch-manipulation items-center justify-center rounded-full outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{ width: hit, height: hit }}
      >
        <span
          aria-hidden
          className={cn("rounded-full ring-2 ring-background transition-transform group-hover:scale-110", bubbleClass(bubble))}
          style={{ width: size, height: size }}
        />
        {/* Il tag dell'agente o il codice accanto alla bolla isolata, dove non copre altre bolle né altri codici. */}
        {short && placement ? <ChartLabel slot="bubble-label" text={short} dx={placement.dx} dy={placement.dy} /> : null}
        <span
          aria-hidden
          className={cn(
            "pointer-events-none absolute z-10 hidden w-max max-w-[min(16rem,60vw)] space-y-1 rounded-lg border bg-popover px-3 py-2 text-left text-xs text-popover-foreground shadow-md group-hover:block group-focus-visible:block",
            toLeft ? "right-1/2" : "left-1/2",
            above ? "bottom-full mb-1" : "top-full mt-1",
          )}
        >
          {bubble.code ? <span className="block font-mono text-muted-foreground">{bubble.code}</span> : null}
          <span className="block font-medium whitespace-normal">{bubble.title}</span>
          <span className="block tabular-nums">{benefitText(bubble)}</span>
          {pending ? <span className="block text-muted-foreground">{pending}</span> : null}
          <span className="block text-muted-foreground">{oneoffRunText(bubble.oneoff, bubble.run)}</span>
          <span className="block text-muted-foreground">
            {BUBBLES_TEXT.ease} {bubble.ease}
            {SCREEN_SEPARATOR}
            {bubbleWhenText(bubble)}
          </span>
          {bubble.groupLabel ? <span className="block text-muted-foreground">{bubble.groupLabel}</span> : null}
        </span>
      </Link>
    </li>
  );
}
