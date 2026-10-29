import { COST_BANDS, costLowLinePosition, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import { DEFAULT_THRESHOLDS, costLowBandOf, type ValuationModel } from "@/lib/use-cases/valuation";
import { buildBenefitBubbles, groupPalette, type GroupPalette } from "@/lib/use-cases/value-charts";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import type { ValueParams } from "@/lib/use-cases/value-model";
import { buildPriority, offMatrixLabel, roadmapGroupKey, type HubChartParam, type HubItem, type HubKindParam, type HubShowParam } from "@/lib/use-cases/views";
import { BenefitBubbleChart } from "./benefit-bubbles";
import { DiffuseList } from "./diffuse-list";
import { EmptyState, HUB_TEXT, NoResults } from "./hub-header";
import { BackToListLink, ListFocusTarget } from "./list-focus";
import { PriorityList } from "./priority-list";
import { hubHref, panelHref, withoutTransient, type HubQuery } from "./use-case-row";
import { ValueCostMatrix, type MatrixPoint } from "./value-cost-matrix";
import { ValueParamsSummary } from "./value-params-summary";

/** Testi della vista (docs/use-case/DESIGN.md §4.4, §14.3). */
export const PRIORITY_TEXT = Object.freeze({
  kindLabel: "Tipo",
  build: "Da costruire",
  diffuse: "Da diffondere",
  matrix: "Matrice Valore × Costo",
  benefits: "Matrice Facilità × Beneficio",
  emptyBuildTitle: "Nessuno use case da mettere in ordine",
  emptyBuildBody: "Valuta Valore e Costo in «Da decidere».",
  emptyDiffuse: "Nessuna best practice approvata.",
});

export interface PriorityViewProps {
  workspaceId: string;
  /** Gli use case dei revisori, già filtrati (il tipo qui non è un filtro). */
  items: readonly HubItem[];
  tipo: HubKindParam | null;
  /** null: la lista; «matrice» e «benefici»: un grafico del menu «⋯», con «‹ Torna alla Panoramica» sopra. */
  mostra: HubShowParam | null;
  model: ValuationModel;
  /** Le ipotesi di calcolo del workspace, per le bolle facilità × beneficio e il riquadro «Ipotesi di calcolo». */
  valueParams?: ValueParams | null;
  /** I colori dei gruppi, da tutte le schede del workspace (`groupPalette`). */
  palette?: GroupPalette | null;
  /** Il primo mese della curva segue il mese corrente: «Ipotesi di calcolo» lo dice. */
  followsCurrentMonth?: boolean;
  /** Impostazioni › Valutazione, solo per chi gestisce il workspace: il link in «Ipotesi di calcolo». */
  settingsHref?: string | null;
  bands?: readonly CostBandInfo[];
  today: string;
  canDecide: boolean;
  basePath: string;
  query: HubQuery;
  filtersActive: boolean;
  clearHref: string;
  /**
   * «Raccolta informazioni» per scheda (id in minuscolo), solo per i revisori: il chip corto nella
   * lista (SPEC §P2.10.5). null per chi non vede «Cosa serve».
   */
  info?: Readonly<Record<string, InfoProgressView>> | null;
}

/**
 * Sopra un grafico del menu «⋯»: «‹ Torna alla Panoramica», con gli stessi filtri, e il nome del
 * grafico. Tornando, il fuoco va al titolo della Panoramica (`ListFocusTarget`), non sul `<body>`.
 */
function ChartHeader({ title, backHref }: { title: string; backHref: string }) {
  return (
    <div data-slot="chart-header" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <BackToListLink href={backHref}>{HUB_TEXT.backToOverview}</BackToListLink>
      <h2 className="text-base font-semibold">{title}</h2>
    </div>
  );
}

/**
 * I grafici del menu «⋯», aperti nella Panoramica (`?vista=panoramica&mostra=matrice|benefici`;
 * docs/use-case/DESIGN.md §4.4; solo revisori), con «‹ Torna alla Panoramica» sopra e gli stessi
 * filtri. Da costruire: le fasi «Da valutare» (non le «Rimandate» in attesa) e «Approvato»; la
 * matrice Valore × Costo, oppure le bolle facilità × beneficio delle schede con «Benefici e
 * costi», con «Ipotesi di calcolo» sotto. La lista senza grafico e «Da diffondere» (le best
 * practice approvate, per ore stimate) restano qui, ma la pagina non le apre più: le sostituisce
 * la Panoramica. Valore, costo, zone e soglie sono quelli del modello e delle fasce del
 * workspace (D15, D18).
 */
export function PriorityView({
  workspaceId,
  items,
  tipo,
  mostra,
  model,
  valueParams = null,
  palette = null,
  followsCurrentMonth = false,
  settingsHref = null,
  bands = COST_BANDS,
  today,
  canDecide,
  basePath,
  query,
  filtersActive,
  clearHref,
  info = null,
}: PriorityViewProps) {
  const view = buildPriority(items, tipo);
  const base = withoutTransient(query);

  if (view.tipo === "diffondere") {
    return (
      <div data-slot="priority-view" className="space-y-4">
        {view.list.length === 0 ? (
          filtersActive ? (
            <NoResults clearHref={clearHref} />
          ) : (
            <EmptyState title={PRIORITY_TEXT.emptyDiffuse} />
          )
        ) : (
          <DiffuseList
            workspaceId={workspaceId}
            canDecide={canDecide}
            items={view.list.map((item) => ({
              id: item.id,
              code: item.code,
              title: item.title,
              origin: item.origin,
              area: item.area,
              claudeHoursPerYear: item.claudeHoursPerYear,
              version: item.version,
              href: panelHref(basePath, query, item.id),
            }))}
          />
        )}
      </div>
    );
  }

  // Un grafico del menu «⋯» al posto della lista: le bolle solo con le ipotesi di calcolo, altrimenti la matrice.
  const chart: HubChartParam | null = mostra === "benefici" && valueParams ? "benefici" : mostra === "matrice" || mostra === "benefici" ? "matrice" : null;
  // «‹ Torna alla Panoramica»: le corsie, con gli stessi filtri e senza «da stimare».
  const header = chart ? <ChartHeader title={chart === "benefici" ? PRIORITY_TEXT.benefits : PRIORITY_TEXT.matrix} backHref={hubHref(basePath, base, { mostra: null, stima: null })} /> : null;

  if (view.list.length === 0) {
    // Con un grafico aperto e nessuna scheda: «‹ Torna alla Panoramica» resta; «Togli i filtri» tiene il grafico.
    return (
      <div data-slot="priority-view" data-chart={chart ?? undefined} className="space-y-4">
        {header ?? <ListFocusTarget title={PRIORITY_TEXT.build} />}
        {filtersActive ? <NoResults clearHref={clearHref} /> : <EmptyState title={PRIORITY_TEXT.emptyBuildTitle} body={PRIORITY_TEXT.emptyBuildBody} />}
      </div>
    );
  }

  // Il chip «N da stimare» resta sul grafico.
  const toEstimateHref = hubHref(basePath, base, { stima: "mancante" });

  // Le bolle facilità × beneficio, con «Ipotesi di calcolo» sotto.
  if (chart === "benefici" && valueParams) {
    const colors = palette ?? groupPalette(view.list, valueParams);
    const bubbles = buildBenefitBubbles(view.list, valueParams, today, colors);
    const hrefs = Object.fromEntries(bubbles.bubbles.map((bubble) => [bubble.id, panelHref(basePath, query, bubble.id)]));
    return (
      <div data-slot="priority-view" data-chart="benefici" className="space-y-4">
        {header}
        <BenefitBubbleChart chart={bubbles} palette={colors} hrefs={hrefs} />
        <ValueParamsSummary params={valueParams} followsCurrentMonth={followsCurrentMonth} settingsHref={settingsHref} className="max-w-[720px]" />
      </div>
    );
  }

  // La matrice Valore × Costo.
  if (chart === "matrice") {
    const byId = new Map(view.list.map((item) => [item.id, item]));
    const points: MatrixPoint[] = view.points.flatMap((point) => {
      const item = byId.get(point.id);
      if (!item || !item.cost) return [];
      // Approvato con un trimestre passato: «Scaduto», come nella Roadmap.
      const expired = item.phase === "approvato" && roadmapGroupKey(item.targetQuarter, today) === "scaduti";
      return [{ ...point, value: item.value, cost: item.cost, expired, href: panelHref(basePath, query, point.id) }];
    });
    const offMatrix =
      view.offMatrix.count > 0
        ? { label: offMatrixLabel(view.offMatrix), count: view.offMatrix.count, href: hubHref(basePath, base, { stima: "fuori-matrice" }) }
        : null;
    const thresholds = model.thresholds ?? {};
    const highValue = typeof thresholds.highImpact === "number" ? thresholds.highImpact : DEFAULT_THRESHOLDS.highImpact;
    return (
      <div data-slot="priority-view" data-chart="matrice" className="space-y-4">
        {header}
        <ValueCostMatrix
          points={points}
          highValue={highValue}
          lowCostX={costLowLinePosition(costLowBandOf(model))}
          bands={bands}
          toEstimate={view.toEstimate}
          toEstimateHref={toEstimateHref}
          offMatrix={offMatrix}
        />
      </div>
    );
  }

  // La lista, a ogni larghezza; il suo titolo per i lettori di schermo prende il fuoco dopo «‹ Torna alla Panoramica».
  return (
    <div data-slot="priority-view" className="space-y-4">
      <ListFocusTarget title={PRIORITY_TEXT.build} />
      <PriorityList workspaceId={workspaceId} items={view.list} today={today} canDecide={canDecide} bands={bands} basePath={basePath} query={query} toEstimateHref={toEstimateHref} info={info} />
    </div>
  );
}
