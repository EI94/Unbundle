import Link from "next/link";
import { FIGURE_SEPARATOR, formatEuro, oneoffRunText, perYearShortText } from "@/lib/use-cases/format";
import { UP_TO_WORD, VALUE_MODEL_STATE_LABEL } from "@/lib/use-cases/labels";
import { placeMatrixLabels, type MatrixLabelPlacement } from "@/lib/use-cases/matrix-labels";
import { BUBBLE_WHEN_LABEL, bubbleWhenText, groupLegend, type BenefitBubble, type BenefitBubbles, type BubbleWhen, type GroupPalette } from "@/lib/use-cases/value-charts";
import { cn } from "@/lib/utils";
import { GroupLegendItems, SLOT_BORDER, SLOT_FILL_MID, SLOT_FILL_SOFT } from "./value-chart-colors";

/** Testi della «Matrice Facilità × Beneficio» (dal menu «⋯» di «Priorità»; spec di Pierpaolo, 25/10/2026). */
export const BUBBLES_TEXT = Object.freeze({
  label: "Matrice Facilità × Beneficio",
  benefitAxis: "Beneficio contato all'anno",
  easeAxis: "Facilità",
  ease: "Facilità",
  hard: "difficile",
  easy: "facile",
  size: "Bolla più grande: costo di avvio più alto.",
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

/** «Facilità 4 · 4.043 €/anno · avvio 560 € · ricorrenti 600 €/anno · questo trimestre · Gruppo Vendite» (con «· scaduto» se il trimestre è passato). */
export function bubbleSummary(bubble: BenefitBubble): string {
  const parts = [`${BUBBLES_TEXT.ease} ${bubble.ease}`, benefitText(bubble), oneoffRunText(bubble.oneoff, bubble.run), bubbleWhenText(bubble)];
  if (bubble.groupLabel) parts.push(bubble.groupLabel);
  return parts.join(FIGURE_SEPARATOR);
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

/** Il beneficio dall'alto, con un margine perché le bolle a zero restino dentro. */
function topPct(benefit: number, max: number): number {
  const share = max > 0 ? Math.min(1, Math.max(0, benefit / max)) : 0;
  return 4 + (1 - share) * 92;
}

/** Bolle nello stesso punto (stessa facilità, beneficio quasi uguale): si aprono di poco a raggiera. */
function spread(bubbles: readonly BenefitBubble[], max: number): Array<BenefitBubble & { left: number; top: number }> {
  const keyOf = (bubble: BenefitBubble) => `${bubble.ease}|${Math.round(topPct(bubble.benefit, max) / 3)}`;
  const sizes = new Map<string, number>();
  for (const bubble of bubbles) sizes.set(keyOf(bubble), (sizes.get(keyOf(bubble)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return bubbles.map((bubble) => {
    const key = keyOf(bubble);
    const size = sizes.get(key) ?? 1;
    const index = seen.get(key) ?? 0;
    seen.set(key, index + 1);
    const left = leftPct(bubble.ease);
    const top = topPct(bubble.benefit, max);
    if (size === 1) return { ...bubble, left, top };
    const angle = (2 * Math.PI * index) / size;
    return { ...bubble, left: left + 3 * Math.cos(angle), top: top + 3 * Math.sin(angle) };
  });
}

const WHEN_ORDER: readonly BubbleWhen[] = ["questo_trimestre", "prossimo_trimestre", "piu_avanti", "da_decidere"];

/**
 * La misura del riquadro delle bolle, per mettere i codici (`placeMatrixLabels`): il grafico si
 * disegna da 768 px, largo 600-640 px circa, alto tre quarti.
 */
const LABEL_BOX = { boxPx: 600, maxBoxPx: 640, aspect: 0.75 } as const;

export interface BenefitBubblesProps {
  chart: BenefitBubbles;
  palette: GroupPalette;
  /** id → il pannello laterale (`?apri=<id>`). */
  hrefs: Readonly<Record<string, string>>;
}

/**
 * «Matrice Facilità × Beneficio» (dal menu «⋯» di «Priorità»; spec di Pierpaolo, 25/10/2026): la
 * matrice a bolle facilità × beneficio, scritta a mano come la matrice Valore × Costo. x la
 * facilità da 1 (difficile) a 5 (facile), y il beneficio contato all'anno; la bolla è grande quanto
 * il costo di avvio, colorata per gruppo. Il bordo dice quando: scuro questo trimestre, pieno il
 * prossimo, tratteggiato più avanti; il riempimento chiaro è «da decidere». Al passaggio del mouse,
 * o con la tastiera, codice, titolo e cifre; al clic il pannello laterale. Sotto i 768 px un elenco
 * al posto del grafico. Solo revisori.
 *
 * Il riquadro, la griglia e le tacche sono SVG scritto a mano (niente recharts né d3); le bolle sono
 * link HTML posati sopra, come i punti della matrice Valore × Costo, perché ognuna si raggiunge con
 * la tastiera, si tocca con un dito e apre il pannello. Ogni codice va dove non copre altre bolle né
 * altri codici (`placeMatrixLabels`); se non c'è posto, non si scrive (resta nel riquadro e
 * nell'etichetta per i lettori di schermo).
 */
export function BenefitBubbleChart({ chart, palette, hrefs }: BenefitBubblesProps) {
  const max = chart.scale.max;
  const placed = spread(chart.bubbles, max);
  const labels = placeMatrixLabels(
    placed.filter((bubble) => bubble.code).map((bubble) => ({ id: bubble.id, left: bubble.left, top: bubble.top, text: bubble.code!, radiusPx: bubble.r })),
    LABEL_BOX,
  );
  const legend = groupLegend(
    palette,
    chart.bubbles.map((bubble) => bubble.group),
  );
  const whens = WHEN_ORDER.filter((when) => chart.bubbles.some((bubble) => bubble.when === when));
  const list = [...chart.bubbles].sort((a, b) => b.ease - a.ease || b.benefit - a.benefit || (a.code ?? "").localeCompare(b.code ?? ""));
  return (
    <figure data-slot="benefit-bubbles" aria-label={BUBBLES_TEXT.label} className="w-full max-w-[720px] space-y-3">
      {chart.bubbles.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">{BUBBLES_TEXT.empty}</p>
      ) : (
        <>
          <div data-slot="benefit-bubbles-chart" className="hidden grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 md:grid">
            <div />
            <p className="pb-1 text-xs text-muted-foreground">{BUBBLES_TEXT.benefitAxis}</p>
            <div className="relative" aria-hidden>
              {chart.scale.ticks.map((tick) => (
                <span key={tick} className="absolute right-0 -translate-y-1/2 text-[11px] whitespace-nowrap text-muted-foreground tabular-nums" style={{ top: `${topPct(tick, max)}%` }}>
                  {formatEuro(tick)}
                </span>
              ))}
            </div>
            <div className="relative aspect-[4/3] w-full">
              <svg aria-hidden viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 size-full overflow-visible">
                <rect x="0" y="0" width="100" height="100" className="fill-muted/30 stroke-border" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                {chart.scale.ticks.map((tick) => (
                  <line key={tick} x1="0" x2="100" y1={topPct(tick, max)} y2={topPct(tick, max)} className="stroke-border/60" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                ))}
              </svg>
              <ul className="absolute inset-0">
                {placed.map((bubble) => (
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
          <ul data-slot="benefit-bubbles-list" className="space-y-2 md:hidden">
            {list.map((bubble) => (
              <li key={bubble.id}>
                <Link
                  href={hrefs[bubble.id] ?? "#"}
                  scroll={false}
                  className="flex min-h-11 flex-col gap-0.5 rounded-lg border px-3 py-2 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm">
                    <span aria-hidden className={cn("size-3 shrink-0 rounded-full", bubbleClass(bubble))} />
                    {bubble.code ? <span className="font-mono text-xs text-muted-foreground">{bubble.code}</span> : null}
                    <span className="truncate font-medium">{bubble.title}</span>
                  </span>
                  <span className="text-xs text-muted-foreground">{bubbleSummary(bubble)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <figcaption className="space-y-2">
        {chart.bubbles.length ? (
          <p data-slot="bubbles-legend" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <GroupLegendItems entries={legend} />
            {whens.map((when) => (
              <span key={when} className="inline-flex items-center gap-1.5">
                <span aria-hidden className={cn("size-3 shrink-0 rounded-full", bubbleClass({ slot: palette.single ? 1 : 0, when }))} />
                {BUBBLE_WHEN_LABEL[when]}
              </span>
            ))}
            {/* Al telefono l'elenco ha pallini tutti uguali: la misura non dice niente. */}
            <span className="hidden md:inline">{BUBBLES_TEXT.size}</span>
          </p>
        ) : null}
        {chart.withoutEase > 0 ? <p className="text-xs text-muted-foreground">{withoutEaseText(chart.withoutEase)}</p> : null}
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
        {bubble.code && placement && !placement.crowded ? (
          // Il codice accanto alla bolla, dove non copre altre bolle né altri codici.
          <span
            aria-hidden
            data-slot="bubble-label"
            className="pointer-events-none absolute rounded-sm bg-background/80 px-0.5 font-mono text-[10px] leading-[13px] whitespace-nowrap text-muted-foreground group-hover:text-foreground"
            style={{ left: `calc(50% + ${placement.dx}px)`, top: `calc(50% + ${placement.dy}px)` }}
          >
            {bubble.code}
          </span>
        ) : null}
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
            {FIGURE_SEPARATOR}
            {bubbleWhenText(bubble)}
          </span>
          {bubble.groupLabel ? <span className="block text-muted-foreground">{bubble.groupLabel}</span> : null}
        </span>
      </Link>
    </li>
  );
}
