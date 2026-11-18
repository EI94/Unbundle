import type { ReactNode } from "react";
import { stepItem } from "@/components/home/step-icons";
import { NextStep } from "@/components/ui-10/next-step";
import type { StepView } from "@/lib/home/next-step";
import { formatEuro, formatInteger } from "@/lib/use-cases/format";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import { OVERVIEW_STEP_TARGET, type OverviewFigures, type OverviewStep, type PortfolioLine } from "@/lib/use-cases/panoramica";
import { quarterLabel } from "@/lib/use-cases/quarter";
import { monthLongLabel } from "@/lib/use-cases/value-calc";
import type { MonthCode } from "@/lib/use-cases/value-model";
import { cn } from "@/lib/utils";
import { HUB_TEXT } from "./hub-header";
import { ViewFocusLink } from "./list-focus";

/** Testi della testa della Panoramica (rilascio «Panoramica»). */
export const OVERVIEW_TEXT = Object.freeze({
  stepsLabel: "Fasi degli use case",
  steps: Object.freeze({ approvati: "Approvati", in_realizzazione: "In realizzazione", realizzati: "In uso" }),
  none: "nessuno",
  figuresLabel: "Cifre degli use case",
  value: "valore all'anno",
  cost: "costo di realizzazione",
  quarter: "use case in questo trimestre",
  pending: "valore da misurare all'anno",
  upTo: "fino a",
});

/**
 * (Rilascio 10, D3) I passi che cambiano vista dentro «Use case» («Decidi», «Chiedi», «Verifica»): il loro link porta
 * il fuoco al titolo della vista nuova (`ViewFocusLink`). Gli altri («Autorizza i fornitori», «Chiudi il SAL») escono
 * dalla pagina con un link normale.
 */
const IN_HUB_STEPS: ReadonlySet<string> = new Set(["decidere", "chiedere", "verificare"]);

/** «ad agosto 2027», «a ottobre 2027»: «ad» solo davanti ad aprile e agosto. */
function monthWithPreposition(month: MonthCode): string {
  const text = monthLongLabel(month);
  return `${/^a(prile|gosto) /.test(text) ? "ad" : "a"} ${text}`;
}

/**
 * «Su tutto il portafoglio: 1.404 ore liberate all'anno, pareggio previsto ad agosto 2027.», con
 * «1 ora liberata all'anno», «pareggio subito», «pareggio previsto oltre ottobre 2028», o una parte sola.
 */
export function portfolioLineText(line: PortfolioLine): string {
  const parts: string[] = [];
  if (line.hours !== null) {
    const hours = Math.round(line.hours);
    parts.push(`${formatInteger(hours)} ${hours === 1 ? "ora liberata" : "ore liberate"} all'anno`);
  }
  const breakeven = line.breakeven;
  if (breakeven?.kind === "mese") parts.push(`pareggio previsto ${monthWithPreposition(breakeven.month)}`);
  else if (breakeven?.kind === "subito") parts.push("pareggio subito");
  else if (breakeven?.kind === "oltre") parts.push(`pareggio previsto oltre ${monthLongLabel(breakeven.month)}`);
  return `Su tutto il portafoglio: ${parts.join(", ")}.`;
}

export interface PanoramicaTopProps {
  /** Le quattro fasi (`overviewSteps`). */
  steps: readonly OverviewStep[];
  reviewer: boolean;
  /** «Da decidere» (o «In valutazione») con i filtri di adesso. */
  decideHref: string;
  /** Le cifre (`overviewFigures`): solo revisori; null senza. */
  figures: OverviewFigures | null;
  /** «Su tutto il portafoglio» (`portfolioLine`): solo revisori, senza filtri; null senza. */
  line: PortfolioLine | null;
  /**
   * (Rilascio 10, D3) Il prossimo passo del workspace, lo stesso della Home (`workspaceSteps` e `workspaceStepView`):
   * solo revisori, senza filtri; `step` null è «Tutto in ordine». null: niente passo (un filtro, un contributore).
   */
  nextStep: { step: StepView | null } | null;
}

/** Il riquadro di una fase con un link: bordo dei campi (3:1), fuoco visibile, un bersaglio da dito al telefono. */
const STEP_LINK =
  "flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-9 @2xl/hub:flex-none @2xl/hub:justify-start";
/** Lo stesso riquadro senza link: nessuno use case, o niente da aprire. */
const STEP_INERT =
  "flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-lg border bg-card px-3 py-2 text-sm text-muted-foreground sm:min-h-9 @2xl/hub:flex-none @2xl/hub:justify-start";

function StepCell({ step, reviewer, decideHref }: { step: OverviewStep; reviewer: boolean; decideHref: string }) {
  const label = step.key === "da_decidere" ? (reviewer ? HUB_TEXT.decideView : HUB_TEXT.contributorDecideView) : OVERVIEW_TEXT.steps[step.key];
  const count = step.count;
  const content: ReactNode = (
    <>
      <span className="min-w-0">{label}</span>
      {count === null ? null : count > 0 ? (
        <span className="font-semibold tabular-nums">{formatInteger(count)}</span>
      ) : (
        <>
          <span aria-hidden>—</span>
          <span className="sr-only">{OVERVIEW_TEXT.none}</span>
        </>
      )}
    </>
  );
  if (step.key === "da_decidere") {
    // Ai contributori «In valutazione» si apre sempre: non ha contatore. La Panoramica sparisce con
    // il link: il fuoco va al titolo di «Da decidere» (`ViewFocusLink`).
    return !reviewer || (count ?? 0) > 0 ? (
      <ViewFocusLink href={decideHref} className={STEP_LINK}>
        {content}
      </ViewFocusLink>
    ) : (
      <span className={STEP_INERT}>{content}</span>
    );
  }
  // Le altre fasi portano alla loro sezione della Panoramica, che c'è solo con almeno uno use case.
  return (count ?? 0) > 0 ? (
    <a href={`#${OVERVIEW_STEP_TARGET[step.key]}`} className={STEP_LINK}>
      {content}
    </a>
  ) : (
    <span className={STEP_INERT}>{content}</span>
  );
}

interface FigureTile {
  key: "valore" | "costo" | "trimestre" | "da-misurare";
  figure: string;
  label: string;
  note: string;
  /** «fino a» prima della cifra. */
  upTo?: boolean;
}

function figureTiles(figures: OverviewFigures): FigureTile[] {
  const tiles: FigureTile[] = [];
  if (figures.value) tiles.push({ key: "valore", figure: formatEuro(figures.value.amountEur), label: OVERVIEW_TEXT.value, note: figures.value.note });
  if (figures.cost) tiles.push({ key: "costo", figure: formatEuro(figures.cost.amountEur), label: OVERVIEW_TEXT.cost, note: figures.cost.note });
  if (figures.quarter) {
    tiles.push({ key: "trimestre", figure: formatInteger(figures.quarter.count), label: OVERVIEW_TEXT.quarter, note: quarterLabel(figures.quarter.quarter) });
  }
  if (figures.pending) {
    tiles.push({ key: "da-misurare", figure: formatEuro(figures.pending.amountEur), label: OVERVIEW_TEXT.pending, note: figures.pending.note, upTo: true });
  }
  return tiles;
}

/**
 * La testa della Panoramica (rilascio «Panoramica»), sopra le corsie:
 * 1. le fasi, «Da decidere 4 → Approvati 45 → In realizzazione 1 → Realizzati —»: «Da decidere» apre
 *    la sua vista, le altre la loro sezione; lo zero è un trattino («nessuno» per i lettori di
 *    schermo) e non porta da nessuna parte. Ai contributori «In valutazione», senza numero;
 * 2. per i revisori le cifre, la cifra prima delle parole («50.367 €», «valore all'anno», «su
 *    17 use case»), e sotto «Su tutto il portafoglio: …»;
 * 3. per i revisori il prossimo passo del workspace (D3, `NextStep`): il pulsante pieno con l'icona e il verbo,
 *    il «?» con il perché; «Tocca a …» quando non tocca a chi guarda, «Tutto in ordine» quando non c'è niente
 *    (con il pulsante pieno, la testata rende «Nuovo use case» bordato).
 * «Da decidere» e il pulsante cambiano vista: il fuoco va al titolo della vista nuova (`ViewFocusLink`).
 * Conteggi di use case e di esigenze, mai di persone (art. 15.4).
 */
export function PanoramicaTop({ steps, reviewer, decideHref, figures, line, nextStep }: PanoramicaTopProps) {
  const tiles = figures ? figureTiles(figures) : [];
  return (
    <div data-slot="panoramica-top" className="space-y-4">
      <section aria-label={OVERVIEW_TEXT.stepsLabel} data-slot="phase-strip">
        <ol className="grid grid-cols-2 gap-2 @2xl/hub:flex @2xl/hub:flex-wrap @2xl/hub:items-center">
          {steps.map((step, index) => (
            <li key={step.key} data-step={step.key} className="flex min-w-0 items-center gap-2">
              {index > 0 ? (
                <span aria-hidden className="hidden text-muted-foreground @2xl/hub:inline">
                  →
                </span>
              ) : null}
              <StepCell step={step} reviewer={reviewer} decideHref={decideHref} />
            </li>
          ))}
        </ol>
      </section>

      {tiles.length || line ? (
        <section aria-label={OVERVIEW_TEXT.figuresLabel} data-slot="overview-figures" className="space-y-2">
          {tiles.length ? (
            <div className={cn("grid grid-cols-2 gap-2 @3xl/hub:gap-3", tiles.length >= 4 ? "@3xl/hub:grid-cols-4" : tiles.length === 3 ? "@3xl/hub:grid-cols-3" : null)}>
              {tiles.map((tile) => (
                <div key={tile.key} data-figure={`totale-${tile.key}`} className="min-w-0 space-y-1 rounded-xl border bg-card p-3 @3xl/hub:p-4">
                  <p className="text-2xl font-semibold tracking-tight tabular-nums">
                    {tile.upTo ? (
                      <>
                        <span className="text-sm font-normal text-muted-foreground">{OVERVIEW_TEXT.upTo}</span>{" "}
                      </>
                    ) : null}
                    <span className="whitespace-nowrap">{tile.figure}</span>
                  </p>
                  <p className="text-sm">{tile.label}</p>
                  <p className="text-xs text-muted-foreground">{keepTogether(tile.note)}</p>
                </div>
              ))}
            </div>
          ) : null}
          {line ? (
            <p data-slot="portfolio-line" className="text-sm text-muted-foreground">
              {keepTogether(portfolioLineText(line))}
            </p>
          ) : null}
        </section>
      ) : null}

      {nextStep ? <PanoramicaNextStep step={nextStep.step} /> : null}
    </div>
  );
}

/** Il passo del workspace sulla Panoramica: dentro «Use case» il link porta il fuoco al titolo della vista che apre. */
function PanoramicaNextStep({ step }: { step: StepView | null }) {
  const item = stepItem(step);
  const href = step?.href ?? null;
  const link = step && href && IN_HUB_STEPS.has(step.key) ? <ViewFocusLink href={href} /> : null;
  return <NextStep id="panoramica-prossimo-passo" step={item ? { ...item, link } : null} />;
}
