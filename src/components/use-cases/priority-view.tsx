import Link from "next/link";
import { ChartScatter, List } from "lucide-react";
import { COST_BANDS, costLowLinePosition, type CostBandInfo } from "@/lib/use-cases/cost-bands";
import { DEFAULT_THRESHOLDS, costLowBandOf, type ValuationModel } from "@/lib/use-cases/valuation";
import { buildPriority, roadmapGroupKey, type HubItem, type HubKindParam, type HubShowParam } from "@/lib/use-cases/views";
import { cn } from "@/lib/utils";
import { DiffuseList } from "./diffuse-list";
import { EmptyState, NoResults } from "./hub-header";
import { PriorityList } from "./priority-list";
import { hubHref, panelHref, withoutTransient, type HubQuery } from "./use-case-row";
import { ValueCostMatrix, type MatrixPoint } from "./value-cost-matrix";

/** Testi della vista (docs/use-case/DESIGN.md §4.4, §14.3). */
export const PRIORITY_TEXT = Object.freeze({
  kindLabel: "Tipo",
  build: "Da costruire",
  diffuse: "Da diffondere",
  showLabel: "Mostra",
  matrix: "Matrice",
  list: "Lista",
  emptyBuildTitle: "Nessuno use case da mettere in ordine",
  emptyBuildBody: "Valuta Valore e Costo in «Da decidere».",
  emptyDiffuse: "Nessuna best practice approvata.",
});

export interface PriorityViewProps {
  workspaceId: string;
  /** Gli use case dei revisori, già filtrati (il tipo qui non è un filtro). */
  items: readonly HubItem[];
  tipo: HubKindParam | null;
  /** null: matrice da 768 px in su, lista sotto (§4.2). */
  mostra: HubShowParam | null;
  model: ValuationModel;
  bands?: readonly CostBandInfo[];
  today: string;
  canDecide: boolean;
  basePath: string;
  query: HubQuery;
  filtersActive: boolean;
  clearHref: string;
}

/**
 * L'interruttore «Matrice | Lista» di «Priorità › Da costruire» (§4.4), piccolo, in fondo alla
 * riga dei filtri: al telefono le icone, dal tablet anche le parole. Senza `?mostra=` vale la
 * matrice da 768 px in su e la lista sotto, come la vista.
 */
export function ShowToggle({ basePath, query, mostra }: { basePath: string; query: HubQuery; mostra: HubShowParam | null }) {
  const base = withoutTransient(query);
  const toggle = (active: HubShowParam) => (
    <nav aria-label={PRIORITY_TEXT.showLabel} data-slot="show-toggle">
      <ul className="inline-flex gap-0.5 rounded-lg border bg-muted/60 p-0.5">
        {(
          [
            { key: "matrice", label: PRIORITY_TEXT.matrix, Icon: ChartScatter },
            { key: "lista", label: PRIORITY_TEXT.list, Icon: List },
          ] as const
        ).map(({ key, label, Icon }) => {
          const current = key === active;
          return (
            <li key={key}>
              <Link
                href={hubHref(basePath, base, { tipo: "costruire", mostra: key })}
                scroll={false}
                aria-current={current ? "page" : undefined}
                aria-label={label}
                title={label}
                className={cn(
                  "flex min-h-11 min-w-11 items-center justify-center gap-1 rounded-md px-2 text-xs font-medium whitespace-nowrap outline-none transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-7 sm:min-w-0",
                  current ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon aria-hidden className="size-4" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
  if (mostra) return toggle(mostra);
  return (
    <>
      <div className="hidden md:block">{toggle("matrice")}</div>
      <div className="md:hidden">{toggle("lista")}</div>
    </>
  );
}

/**
 * «Priorità» (docs/use-case/DESIGN.md §4.4; solo revisori). «Da costruire | Da diffondere» sta
 * nel menu «Tipo» della riga dei filtri e «Matrice | Lista» in fondo alla stessa riga
 * (`ShowToggle`): qui solo il contenuto. Da costruire: le fasi «Da valutare» (non le
 * «Rimandate» in attesa) e «Approvato», come matrice Valore × Costo o come lista, mai insieme;
 * senza `?mostra=` la matrice da 768 px in su e la lista sotto. Da diffondere: le best practice
 * approvate, per ore stimate. Valore, costo, zone e soglie sono quelli del modello e delle
 * fasce del workspace (D15, D18).
 */
export function PriorityView({ workspaceId, items, tipo, mostra, model, bands = COST_BANDS, today, canDecide, basePath, query, filtersActive, clearHref }: PriorityViewProps) {
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

  if (view.list.length === 0) {
    return (
      <div data-slot="priority-view" className="space-y-4">
        {filtersActive ? <NoResults clearHref={clearHref} /> : <EmptyState title={PRIORITY_TEXT.emptyBuildTitle} body={PRIORITY_TEXT.emptyBuildBody} />}
      </div>
    );
  }

  const byId = new Map(view.list.map((item) => [item.id, item]));
  const points: MatrixPoint[] = view.points.flatMap((point) => {
    const item = byId.get(point.id);
    if (!item || !item.cost) return [];
    // Approvato con un trimestre passato: «Scaduto», come nella Roadmap.
    const expired = item.phase === "approvato" && roadmapGroupKey(item.targetQuarter, today) === "scaduti";
    return [{ ...point, value: item.value, cost: item.cost, expired, href: panelHref(basePath, query, point.id) }];
  });
  const toEstimateHref = hubHref(basePath, base, { tipo: "costruire", mostra: "lista", stima: "mancante" });
  const thresholds = model.thresholds ?? {};
  const highValue = typeof thresholds.highImpact === "number" ? thresholds.highImpact : DEFAULT_THRESHOLDS.highImpact;
  const matrix = (
    <ValueCostMatrix
      points={points}
      highValue={highValue}
      lowCostX={costLowLinePosition(costLowBandOf(model))}
      bands={bands}
      toEstimate={view.toEstimate}
      toEstimateHref={toEstimateHref}
    />
  );
  const list = (
    <PriorityList workspaceId={workspaceId} items={view.list} today={today} canDecide={canDecide} bands={bands} basePath={basePath} query={query} toEstimateHref={toEstimateHref} />
  );

  return (
    <div data-slot="priority-view" className="space-y-4">
      {mostra === "matrice" ? matrix : null}
      {mostra === "lista" ? list : null}
      {/* Senza scelta: la matrice da 768 px in su, la lista sotto; mai le due insieme a schermo. */}
      {mostra === null ? (
        <>
          <div data-default-show="matrice" className="hidden md:block">
            {matrix}
          </div>
          <div data-default-show="lista" className="md:hidden">
            {list}
          </div>
        </>
      ) : null}
    </div>
  );
}
