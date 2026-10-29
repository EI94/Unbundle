import { COST_BANDS, costLowLinePosition, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import { DEFAULT_THRESHOLDS, costLowBandOf, type ValuationModel } from "@/lib/use-cases/valuation";
import { buildBenefitBubbles, buildRoadmapValue, groupPalette, roadmapPlan, type GroupPalette } from "@/lib/use-cases/value-charts";
import type { ValueParams } from "@/lib/use-cases/value-model";
import { buildPriority, offMatrixLabel, roadmapGroupKey, type HubChartParam, type HubEstimateParam, type HubItem } from "@/lib/use-cases/views";
import { BenefitBubbleChart } from "./benefit-bubbles";
import { EmptyState, NoResults } from "./hub-header";
import { BackToListLink } from "./list-focus";
import { RoadmapValueCharts } from "./roadmap-value";
import { hubHref, panelHref, withoutTransient, type HubQuery } from "./use-case-row";
import { ValueCostMatrix, type MatrixOffItem, type MatrixPoint } from "./value-cost-matrix";
import { ValueParamsSummary } from "./value-params-summary";

/** Testi dei grafici del menu «⋯» (rilascio «Panoramica»): le voci del menu e i titoli sopra i grafici. */
export const CHART_TEXT = Object.freeze({
  matrice: "Matrice Valore × Costo",
  benefici: "Matrice Facilità × Beneficio",
  curva: "Curva del valore",
  back: "Torna alla Panoramica",
  emptyMatrixTitle: "Nessuno use case da mettere in ordine",
  emptyMatrixBody: "Valuta Valore e Costo in «Da decidere».",
});

/**
 * Sopra un grafico del menu «⋯»: «‹ Torna alla Panoramica», con gli stessi filtri, e il nome del
 * grafico. Tornando, il fuoco va al titolo della Panoramica (`ListFocusTarget`), non sul `<body>`.
 */
export function ChartHeader({ title, backHref }: { title: string; backHref: string }) {
  return (
    <div data-slot="chart-header" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <BackToListLink href={backHref}>{CHART_TEXT.back}</BackToListLink>
      <h2 className="text-base font-semibold">{title}</h2>
    </div>
  );
}

export interface HubChartViewProps {
  /** Il grafico aperto (`shownChart`): mai `benefici` senza «Benefici e costi» nel workspace. */
  chart: HubChartParam;
  /** Gli use case dei revisori, già filtrati (sulle due matrici il tipo non è un filtro). */
  items: readonly HubItem[];
  /** Tutti gli use case dei revisori del workspace: i mesi della curva non si spostano con un filtro. */
  planItems: readonly HubItem[];
  model: ValuationModel;
  /** Le ipotesi di calcolo del workspace: bolle, curva e il riquadro «Ipotesi di calcolo». */
  valueParams?: ValueParams | null;
  /** I colori dei gruppi, da tutte le schede del workspace (`groupPalette`). */
  palette?: GroupPalette | null;
  /** Il primo mese della curva segue il mese corrente: «Ipotesi di calcolo» lo dice. */
  followsCurrentMonth?: boolean;
  /** Impostazioni › Valutazione, solo per chi gestisce il workspace: il link in «Ipotesi di calcolo». */
  settingsHref?: string | null;
  bands?: readonly CostBandInfo[];
  today: string;
  basePath: string;
  query: HubQuery;
  filtersActive: boolean;
  /** «Togli i filtri»: il grafico resta. */
  clearHref: string;
  /** `stima` dell'indirizzo: l'elenco sotto la matrice aperto quando la pagina si rende (un vecchio chip «N da stimare»). */
  open: HubEstimateParam | null;
}

/**
 * I grafici del menu «⋯», aperti nella Panoramica al posto delle corsie
 * (`?vista=panoramica&mostra=matrice|benefici|curva`; solo revisori), con «‹ Torna alla Panoramica»
 * sopra e gli stessi filtri:
 * - «Matrice Valore × Costo»: le fasi «Da valutare» (non le «Rimandate» in attesa) e «Approvato»
 *   degli use case «Da costruire»; sotto la legenda, chiusi, quelli «da stimare» e quelli con
 *   «Benefici e costi» senza un punto, che un link `stima` apre. Valore, costo, zone e soglie sono
 *   quelli del modello e delle fasce del workspace (D15, D18).
 * - «Matrice Facilità × Beneficio»: le bolle delle stesse schede con «Benefici e costi», con
 *   «Ipotesi di calcolo» sotto.
 * - «Curva del valore»: la J-curve e «Valore per tipo di ritorno» degli approvati e in realizzazione
 *   con «Benefici e costi», con «Ipotesi di calcolo» sotto; i mesi vengono da tutto il workspace.
 * Ogni use case apre il pannello laterale. Il titolo della Panoramica per i lettori di schermo
 * (`ListFocusTarget`) non sta qui: è delle corsie, dove «‹ Torna alla Panoramica» porta il fuoco.
 */
export function HubChartView({
  chart,
  items,
  planItems,
  model,
  valueParams = null,
  palette = null,
  followsCurrentMonth = false,
  settingsHref = null,
  bands = COST_BANDS,
  today,
  basePath,
  query,
  filtersActive,
  clearHref,
  open,
}: HubChartViewProps) {
  const base = withoutTransient(query);
  // Le bolle solo con le ipotesi di calcolo, altrimenti la matrice.
  const shown: HubChartParam = chart === "benefici" && !valueParams ? "matrice" : chart;
  // «‹ Torna alla Panoramica»: le corsie, con gli stessi filtri e senza «da stimare».
  const header = <ChartHeader title={CHART_TEXT[shown]} backHref={hubHref(basePath, base, { mostra: null, stima: null })} />;
  const hrefOf = (id: string) => panelHref(basePath, query, id);

  // «Curva del valore»: i conti delle schede filtrate, con i mesi di tutto il workspace.
  if (shown === "curva") {
    const value = valueParams ? buildRoadmapValue(items, valueParams, { plan: roadmapPlan(planItems, valueParams) }) : null;
    return (
      <div data-slot="hub-chart" data-chart="curva" className="space-y-4">
        {header}
        {value && valueParams ? (
          <RoadmapValueCharts
            value={value}
            items={items}
            params={valueParams}
            palette={palette ?? groupPalette(planItems, valueParams)}
            hrefs={Object.fromEntries(value.cards.map((card) => [card.id, hrefOf(card.id)]))}
            followsCurrentMonth={followsCurrentMonth}
            settingsHref={settingsHref}
          />
        ) : (
          // Il menu offre la curva solo con «Benefici e costi» nel workspace: qui c'è un filtro.
          <NoResults clearHref={clearHref} />
        )}
      </div>
    );
  }

  const view = buildPriority(items);

  if (view.list.length === 0) {
    // Nessuna scheda da mettere in ordine: «‹ Torna alla Panoramica» resta; «Togli i filtri» tiene il grafico.
    return (
      <div data-slot="hub-chart" data-chart={shown} className="space-y-4">
        {header}
        {filtersActive ? <NoResults clearHref={clearHref} /> : <EmptyState title={CHART_TEXT.emptyMatrixTitle} body={CHART_TEXT.emptyMatrixBody} />}
      </div>
    );
  }

  // Le bolle facilità × beneficio, con «Ipotesi di calcolo» sotto.
  if (shown === "benefici" && valueParams) {
    const colors = palette ?? groupPalette(view.list, valueParams);
    const bubbles = buildBenefitBubbles(view.list, valueParams, today, colors);
    const hrefs = Object.fromEntries(bubbles.bubbles.map((bubble) => [bubble.id, hrefOf(bubble.id)]));
    return (
      <div data-slot="hub-chart" data-chart="benefici" className="space-y-4">
        {header}
        <BenefitBubbleChart chart={bubbles} palette={colors} hrefs={hrefs} />
        <ValueParamsSummary params={valueParams} followsCurrentMonth={followsCurrentMonth} settingsHref={settingsHref} className="max-w-[720px]" />
      </div>
    );
  }

  // La matrice Valore × Costo.
  const byId = new Map(view.list.map((item) => [item.id, item]));
  const points: MatrixPoint[] = view.points.flatMap((point) => {
    const item = byId.get(point.id);
    if (!item || !item.cost) return [];
    // Approvato con un trimestre passato: «Scaduto», come nelle corsie.
    const expired = item.phase === "approvato" && roadmapGroupKey(item.targetQuarter, today) === "scaduti";
    return [{ ...point, value: item.value, cost: item.cost, expired, href: hrefOf(point.id) }];
  });
  const offItem = (item: HubItem): MatrixOffItem => ({ id: item.id, code: item.code, title: item.title, href: hrefOf(item.id) });
  const thresholds = model.thresholds ?? {};
  const highValue = typeof thresholds.highImpact === "number" ? thresholds.highImpact : DEFAULT_THRESHOLDS.highImpact;
  const off = view.offMatrix.items;
  return (
    <div data-slot="hub-chart" data-chart="matrice" className="space-y-4">
      {header}
      <ValueCostMatrix
        points={points}
        highValue={highValue}
        lowCostX={costLowLinePosition(costLowBandOf(model))}
        bands={bands}
        toEstimate={view.toEstimate.map(offItem)}
        offMatrix={off.length ? { label: offMatrixLabel({ count: off.length, withoutBenefit: view.offMatrix.withoutBenefit }), items: off.map(offItem) } : null}
        open={open}
      />
    </div>
  );
}
