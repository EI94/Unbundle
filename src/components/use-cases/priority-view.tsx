import Link from "next/link";
import { Button } from "@/components/ui/button";
import { COST_BANDS, costLowLinePosition, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import { DEFAULT_THRESHOLDS, costLowBandOf, type ValuationModel } from "@/lib/use-cases/valuation";
import { buildBenefitBubbles, groupPalette, type GroupPalette } from "@/lib/use-cases/value-charts";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import type { ValueParams } from "@/lib/use-cases/value-model";
import { buildPriority, offMatrixLabel, roadmapGroupKey, type HubChartParam, type HubItem, type HubKindParam, type HubShowParam } from "@/lib/use-cases/views";
import { BenefitBubbleChart } from "./benefit-bubbles";
import { DiffuseList } from "./diffuse-list";
import { EmptyState, NoResults } from "./hub-header";
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
  backToList: "Torna alla lista",
  emptyBuildTitle: "Nessuno use case da mettere in ordine",
  emptyBuildBody: "Valuta Valore e Costo in «Da decidere».",
  emptyDiffuse: "Nessuna best practice approvata.",
  goToRoadmap: "Vai alla Roadmap",
});

/** «1 use case è già in realizzazione» · «3 use case sono già in realizzazione»: li mostra la Roadmap, non «Priorità». */
export function inRealizationText(count: number): string {
  return count === 1 ? "1 use case è già in realizzazione." : `${count} use case sono già in realizzazione.`;
}

export interface PriorityViewProps {
  workspaceId: string;
  /** Gli use case dei revisori, già filtrati (il tipo qui non è un filtro). */
  items: readonly HubItem[];
  tipo: HubKindParam | null;
  /** null o «lista»: la lista; «matrice» e «benefici»: un grafico del menu «⋯» al posto della lista, con «‹ Torna alla lista» sopra. */
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
  /** Dove sta la Roadmap: nel vuoto di «Da costruire» rimanda agli use case già in realizzazione. */
  roadmapHref?: string | null;
  /**
   * «Raccolta informazioni» per scheda (id in minuscolo), solo per i revisori: il chip corto nella
   * lista (SPEC §P2.10.5). null per chi non vede «Cosa serve».
   */
  info?: Readonly<Record<string, InfoProgressView>> | null;
}

/**
 * Sopra un grafico del menu «⋯»: «‹ Torna alla lista», con gli stessi filtri, e il nome del grafico.
 * Tornando, il fuoco va al titolo della lista (`ListFocusTarget`), non sul `<body>`.
 */
function ChartHeader({ title, listHref }: { title: string; listHref: string }) {
  return (
    <div data-slot="chart-header" className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <BackToListLink href={listHref}>{PRIORITY_TEXT.backToList}</BackToListLink>
      <h2 className="text-base font-semibold">{title}</h2>
    </div>
  );
}

/**
 * «Priorità» (docs/use-case/DESIGN.md §4.4; solo revisori). «Da costruire | Da diffondere» sta
 * nel menu «Tipo» della riga dei filtri: qui solo il contenuto. Da costruire: le fasi «Da
 * valutare» (non le «Rimandate» in attesa) e «Approvato», come lista. Dal menu «⋯»
 * (`?mostra=matrice|benefici`) un grafico prende il posto della lista, mai i due insieme: la
 * matrice Valore × Costo, oppure le bolle facilità × beneficio delle schede con «Benefici e
 * costi», con «Ipotesi di calcolo» sotto. Sopra il grafico «‹ Torna alla lista», con gli stessi
 * filtri. `?mostra=lista` dei vecchi link è la lista. Da diffondere: le best practice approvate,
 * per ore stimate. Valore, costo, zone e soglie sono quelli del modello e delle fasce del
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
  roadmapHref = null,
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
  const header = chart ? <ChartHeader title={chart === "benefici" ? PRIORITY_TEXT.benefits : PRIORITY_TEXT.matrix} listHref={hubHref(basePath, base, { mostra: null })} /> : null;

  if (view.list.length === 0) {
    const inRealization = items.filter((item) => item.phase === "in_realizzazione").length;
    // Con un grafico aperto e nessuna scheda: «‹ Torna alla lista» resta; «Togli i filtri» tiene il grafico.
    return (
      <div data-slot="priority-view" data-chart={chart ?? undefined} className="space-y-4">
        {header ?? <ListFocusTarget title={PRIORITY_TEXT.build} />}
        {filtersActive ? (
          <NoResults clearHref={clearHref} />
        ) : inRealization > 0 && roadmapHref ? (
          <EmptyState title={PRIORITY_TEXT.emptyBuildTitle} body={inRealizationText(inRealization)}>
            <Button variant="outline" className="min-h-11 sm:min-h-8" render={<Link href={roadmapHref} scroll={false} />} nativeButton={false}>
              {PRIORITY_TEXT.goToRoadmap}
            </Button>
          </EmptyState>
        ) : (
          <EmptyState title={PRIORITY_TEXT.emptyBuildTitle} body={PRIORITY_TEXT.emptyBuildBody} />
        )}
      </div>
    );
  }

  const toEstimateHref = hubHref(basePath, base, { tipo: "costruire", mostra: null, stima: "mancante" });

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
        ? { label: offMatrixLabel(view.offMatrix), count: view.offMatrix.count, href: hubHref(basePath, base, { tipo: "costruire", mostra: null, stima: "fuori-matrice" }) }
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

  // La lista, a ogni larghezza; il suo titolo per i lettori di schermo prende il fuoco dopo «‹ Torna alla lista».
  return (
    <div data-slot="priority-view" className="space-y-4">
      <ListFocusTarget title={PRIORITY_TEXT.build} />
      <PriorityList workspaceId={workspaceId} items={view.list} today={today} canDecide={canDecide} bands={bands} basePath={basePath} query={query} toEstimateHref={toEstimateHref} info={info} />
    </div>
  );
}
