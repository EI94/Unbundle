import type { ReactNode } from "react";
import { DossierCard, DossierReadOnlyNotice } from "@/components/uc/shell/case-card";
import type { DossierColumn } from "@/lib/db/queries/uc-nav";
import type { DossierCardView } from "@/lib/uc/views/realization";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import { buildRoadmapValue, groupPalette, roadmapPlan, type GroupPalette } from "@/lib/use-cases/value-charts";
import type { ValueParams } from "@/lib/use-cases/value-model";
import { ROADMAP_DONE_PREVIEW, buildRoadmap, isContributorItem, roadmapTotals, type AnyHubItem, type HubItem } from "@/lib/use-cases/views";
import { EmptyState, NoResults } from "./hub-header";
import { RoadmapCard } from "./roadmap-card";
import { RoadmapTiles } from "./roadmap-tiles";
import { RoadmapValueCharts } from "./roadmap-value";
import { panelHref, type HubQuery } from "./use-case-row";

/** Testi della vista (docs/use-case/DESIGN.md §4.5, §14.3). */
export const ROADMAP_TEXT = Object.freeze({
  upcoming: "Prossimi",
  inProgress: "In realizzazione",
  done: "Fatti",
  showAll: "Mostra tutti",
  emptyTitle: "La roadmap è vuota",
  emptyBody: "Approva uno use case e scegli quando farlo.",
});

export interface RoadmapViewProps {
  /** Gli use case della pagina, già filtrati e proiettati per chi guarda. */
  items: readonly AnyHubItem[];
  today: string;
  /** Cifre in testa: solo i revisori (`canSeeFigures`). */
  showTiles: boolean;
  bands?: readonly CostBandInfo[];
  /** La lettura del dossier è in errore (§4.9): «In realizzazione» mostra solo fase e titolo. */
  dossierDown?: boolean;
  /**
   * Le card dei dossier della colonna «In realizzazione» (`dossierColumnOf`, H6a): stato,
   * «0 di 245 indispensabili a posto», «Tocca a te» o la prossima tappa. Solo revisori; null o
   * non `pronta`: la colonna mostra le card dello use case.
   */
  dossierColumn?: DossierColumn | null;
  /**
   * Le ipotesi di calcolo del workspace (solo revisori): con almeno una scheda della vista con
   * «Benefici e costi», «Ore liberate all'anno», «Pareggio», la J-curve e «Valore per tipo di
   * ritorno». Assenti: la Roadmap di oggi.
   */
  valueParams?: ValueParams | null;
  /** I colori dei gruppi, da tutte le schede del workspace (`groupPalette`): un filtro non li cambia. */
  palette?: GroupPalette | null;
  /**
   * Tutte le schede dei revisori del workspace, senza filtri: i mesi della curva (`roadmapPlan`)
   * si calcolano su queste, così un filtro non sposta «Più avanti» né il pareggio delle altre.
   */
  planItems?: readonly HubItem[] | null;
  /** Il primo mese della curva segue il mese corrente: «Ipotesi di calcolo» lo dice. */
  followsCurrentMonth?: boolean;
  /** Impostazioni › Valutazione, solo per chi gestisce il workspace: il link in «Ipotesi di calcolo». */
  settingsHref?: string | null;
  basePath: string;
  query: HubQuery;
  filtersActive: boolean;
  clearHref: string;
  /** «Raccolta informazioni» per scheda (id in minuscolo), solo per i revisori: il chip delle card. */
  info?: Readonly<Record<string, InfoProgressView>> | null;
}

/**
 * «Roadmap» (docs/use-case/DESIGN.md §4.5): in testa al massimo tre cifre con «su N use case»
 * (solo revisori), poi tre colonne in sola lettura. «Prossimi»: gli approvati per trimestre,
 * con «Scaduti» (trimestre passato senza avvio, tag rosso «Scaduto»), «Questo trimestre · T4
 * 2026», «Prossimo trimestre · T1 2027», i trimestri dopo, «Più avanti» (ai contributori «Scaduti»
 * in grigio e senza tag: nessun giudizio sul team). «In realizzazione»:
 * la card del dossier dei Casi d'uso (`DossierCard`: codice e titolo, `StatusDot` dello stato,
 * la mini barra «0 di 245 indispensabili a posto», «Tocca a te · <passo>» o «Prossima tappa ·
 * 15 nov»; prima quelle in cui tocca a chi guarda), oppure fase e «Senza dossier»; senza la
 * parte del dossier solo la fase (§4.9). «Fatti»:
 * i primi 10, poi «Mostra tutti». I contributori vedono titolo, fase e «Quando».
 * Con «Benefici e costi» (solo revisori, almeno una scheda approvata o in realizzazione con un
 * modello) le cifre in testa diventano quattro e sotto vengono la J-curve, «Valore per tipo di
 * ritorno» e «Ipotesi di calcolo», prima delle colonne.
 */
export function RoadmapView({
  items,
  today,
  showTiles,
  bands,
  dossierDown = false,
  dossierColumn = null,
  valueParams = null,
  palette = null,
  planItems = null,
  followsCurrentMonth = false,
  settingsHref = null,
  basePath,
  query,
  filtersActive,
  clearHref,
  info = null,
}: RoadmapViewProps) {
  const infoOf = (id: string) => info?.[id.toLowerCase()] ?? null;
  const roadmap = buildRoadmap(items, today);
  const empty = !roadmap.upcoming.length && !roadmap.inProgress.length && !roadmap.done.length;
  if (empty) {
    return filtersActive ? <NoResults clearHref={clearHref} /> : <EmptyState title={ROADMAP_TEXT.emptyTitle} body={ROADMAP_TEXT.emptyBody} />;
  }
  const reviewerItems = items.filter((item): item is HubItem => !isContributorItem(item));
  const forReviewers = reviewerItems.length === items.length;
  const href = (id: string) => panelHref(basePath, query, id);
  const column = forReviewers && dossierColumn?.state === "pronta" ? dossierColumn : null;
  const inProgress = inProgressOrder(roadmap.inProgress, column?.cards ?? []);
  const cardOf = (id: string): DossierCardView | undefined => column?.byUseCase.get(id.toLowerCase());
  const doneFirst = roadmap.done.slice(0, ROADMAP_DONE_PREVIEW);
  const doneRest = roadmap.done.slice(ROADMAP_DONE_PREVIEW);
  const figures = showTiles && forReviewers;
  const value = figures && valueParams ? buildRoadmapValue(reviewerItems, valueParams, { plan: roadmapPlan(planItems ?? reviewerItems, valueParams) }) : null;
  const hrefs = value ? Object.fromEntries(value.cards.map((card) => [card.id, href(card.id)])) : {};
  return (
    <div data-slot="roadmap-view" className="space-y-6">
      {figures ? <RoadmapTiles totals={roadmapTotals(reviewerItems)} value={value} /> : null}
      {value && valueParams ? (
        <RoadmapValueCharts
          value={value}
          items={reviewerItems}
          params={valueParams}
          palette={palette ?? groupPalette(reviewerItems, valueParams)}
          hrefs={hrefs}
          followsCurrentMonth={followsCurrentMonth}
          settingsHref={settingsHref}
        />
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Column id="roadmap-prossimi" title={ROADMAP_TEXT.upcoming} count={roadmap.upcoming.reduce((sum, group) => sum + group.items.length, 0)}>
          {roadmap.upcoming.map((group) => (
            <section key={group.key} aria-labelledby={`roadmap-gruppo-${group.key}`} className="space-y-2">
              <h3
                id={`roadmap-gruppo-${group.key}`}
                className={group.expired && forReviewers ? "text-xs font-medium text-red-300" : "text-xs font-medium text-muted-foreground"}
              >
                {group.label}
              </h3>
              <ul className="space-y-2">
                {group.items.map((item) => (
                  <RoadmapCard key={item.id} item={item} column="prossimi" expired={group.expired} href={href(item.id)} info={infoOf(item.id)} bands={bands} />
                ))}
              </ul>
            </section>
          ))}
        </Column>
        <Column id="roadmap-in-realizzazione" title={ROADMAP_TEXT.inProgress} count={roadmap.inProgress.length}>
          {column?.readOnlyNotice && inProgress.length ? <DossierReadOnlyNotice /> : null}
          <ul className="space-y-2">
            {inProgress.map((item) => {
              const card = cardOf(item.id);
              return card ? (
                <li key={item.id} data-slot="roadmap-card" data-id={item.id} className="min-w-0">
                  <DossierCard card={card} className="gap-2 px-3 py-2.5" />
                </li>
              ) : (
                <RoadmapCard key={item.id} item={item} column="in_realizzazione" dossierDown={dossierDown} href={href(item.id)} info={infoOf(item.id)} bands={bands} />
              );
            })}
          </ul>
        </Column>
        <Column id="roadmap-fatti" title={ROADMAP_TEXT.done} count={roadmap.done.length}>
          <ul className="space-y-2">
            {doneFirst.map((item) => (
              <RoadmapCard key={item.id} item={item} column="fatti" href={href(item.id)} info={infoOf(item.id)} bands={bands} />
            ))}
          </ul>
          {doneRest.length ? (
            <details className="group space-y-2">
              <summary className="inline-flex min-h-11 cursor-pointer items-center rounded-md px-1 text-sm font-medium text-primary underline underline-offset-4 outline-none select-none group-open:hidden hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8">
                {ROADMAP_TEXT.showAll}
              </summary>
              <ul className="space-y-2">
                {doneRest.map((item) => (
                  <RoadmapCard key={item.id} item={item} column="fatti" href={href(item.id)} info={infoOf(item.id)} bands={bands} />
                ))}
              </ul>
            </details>
          ) : null}
        </Column>
      </div>
    </div>
  );
}

/**
 * L'ordine della colonna «In realizzazione»: prima gli use case con la card del dossier,
 * nell'ordine delle card (prima quelli in cui tocca a chi guarda, poi per ultima modifica),
 * poi gli altri nell'ordine di prima.
 */
function inProgressOrder<T extends { id: string }>(items: readonly T[], cards: readonly DossierCardView[]): T[] {
  const rank = new Map<string, number>();
  cards.forEach((card, index) => {
    if (card.useCaseId) rank.set(card.useCaseId.toLowerCase(), index);
  });
  const at = (item: T) => rank.get(item.id.toLowerCase()) ?? Number.MAX_SAFE_INTEGER;
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => at(a.item) - at(b.item) || a.index - b.index)
    .map(({ item }) => item);
}

function Column({ id, title, count, children }: { id: string; title: string; count: number; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="min-w-0 space-y-3">
      <h2 id={id} className="flex items-baseline gap-2 text-sm font-semibold">
        {title}
        {count > 0 ? <span className="text-xs font-normal text-muted-foreground tabular-nums">{count}</span> : null}
      </h2>
      {children}
    </section>
  );
}
