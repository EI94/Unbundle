import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { SegmentedNav, type SegmentedNavItem } from "@/components/dashboard/segmented-nav";
import { DossierCard, DossierReadOnlyNotice } from "@/components/uc/shell/case-card";
import { Fold } from "@/components/ui-10/fold";
import type { DossierColumn } from "@/lib/db/queries/uc-nav";
import type { DossierCardView } from "@/lib/uc/views/realization";
import { agentLabel, NO_AGENT_PARAM, type AgentPalette } from "@/lib/use-cases/agents";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import { FIGURE_SEPARATOR, formatInteger } from "@/lib/use-cases/format";
import { keepTogether } from "@/lib/use-cases/line-breaks";
import type { ReferentStateKey } from "@/lib/use-cases/referent/use-case-state";
import {
  LANE_PREVIEW,
  PANORAMA_SECTION_ID,
  agentCardId,
  agentGroups,
  buildLanes,
  doneSummaryText,
  laneSeeAllLabel,
  laneSummaryText,
  type Lane,
  type LaneEntry,
} from "@/lib/use-cases/lanes";
import { isContributorItem, type AnyHubItem, type HubItem } from "@/lib/use-cases/views";
import { AgentGrid } from "./agent-grid";
import { Disclosure } from "./disclosure";
import { EmptyState, HUB_TEXT, NoResults } from "./hub-header";
import { LaneCard } from "./lane-card";
import { HashFocusLink, RevealOnLoad } from "./list-focus";
import { panelHref, type HubQuery } from "./use-case-row";

/** Testi delle corsie della Panoramica (rilascio «Panoramica»; rilascio 10, §3.4). */
export const LANES_TEXT = Object.freeze({
  inProgress: "In realizzazione",
  done: "In uso",
  showLess: "Mostra meno",
  emptyTitle: "Niente in programma, per ora",
  emptyBody: "Approva uno use case e scegli quando farlo.",
  /**
   * Ai contributori, che non approvano: che cosa trovano qui e dove sono le proposte. Solo quello
   * che vedono: gli approvati nascosti alla ricerca (AI Transformation) non li vedono, e il vuoto
   * non dice che nel workspace non ce ne sono.
   */
  emptyContributorBody: `Qui trovi gli use case approvati visibili a tutti. Le proposte sono in «${HUB_TEXT.contributorDecideView}».`,
  noneWithFilters: "Niente in programma con questi filtri.",
  groupingLabel: "Raggruppa",
  byQuarter: "Per trimestre",
  byAgent: "Per agente",
  sectionByQuarter: "Use case per trimestre",
  sectionByAgent: "Use case per agente",
  sectionOthers: "Altri use case per trimestre",
  allAgents: "Tutti gli agenti",
});

/** «Use case di LIBRA per trimestre»: le corsie di un solo agente, dopo un clic in «Per agente». */
export function agentSectionLabel(name: string): string {
  return `Use case di ${name} per trimestre`;
}

/** «Per trimestre | Per agente»: solo ai revisori, in un workspace con titoli con il prefisso dell'agente. */
export interface LanesGrouping {
  active: "trimestre" | "agente";
  items: SegmentedNavItem[];
  /**
   * Aperto dall'indirizzo, «Per agente» viene in vista e prende il fuoco al caricamento della pagina
   * (`RevealOnLoad`); false sotto un pannello aperto, il pannello rapido o un avviso in testa.
   */
  landOnLoad?: boolean;
}

export interface PanoramaLanesProps {
  /** Gli use case della pagina, già filtrati e proiettati per chi guarda. */
  items: readonly AnyHubItem[];
  today: string;
  /** I toni degli agenti del workspace (`workspaceAgentPalette`): né un filtro né il ruolo li cambiano. */
  agents: AgentPalette;
  /** La scala delle barre (`laneBarScale`, sugli approvati di tutto il workspace); 0 ai contributori. */
  barScale: number;
  bands?: readonly CostBandInfo[];
  /** La lettura del dossier è in errore (§4.9): «In realizzazione» mostra solo la fase. */
  dossierDown?: boolean;
  /**
   * Le card dei dossier di «In realizzazione» (`dossierColumnOf`, H6a): stato, «0 di 245
   * indispensabili a posto», «Tocca a te» o la prossima tappa. Solo revisori; null o non `pronta`:
   * le card dello use case.
   */
  dossierColumn?: DossierColumn | null;
  /** (Rilascio 5) Lo stato del referente per scheda (id in minuscolo), per tutti i ruoli: il chip delle card (D7: solo quando chiede un'azione). */
  referentStates?: Readonly<Record<string, ReferentStateKey>> | null;
  basePath: string;
  query: HubQuery;
  filtersActive: boolean;
  clearHref: string;
  /** «Per trimestre | Per agente»; null senza (contributori, workspace senza prefissi, grafici). */
  grouping: LanesGrouping | null;
  /** Le corsie di un agente da «Per agente» (`?agente=…#panoramica-approvati`). */
  agentHref: (param: string) => string;
  /** L'agente del filtro «Agente», per il nome della sezione; null senza. */
  agentFilter: string | null;
  /** Chi guarda è un contributore: il vuoto non gli chiede di approvare. */
  contributor?: boolean;
}

/** Il titolo di un elenco della Panoramica, con il suo conteggio accanto: «T4 2026 5», «In realizzazione 3». */
function ListTitle({ id, title, count, anchor = false }: { id: string; title: string; count: number; anchor?: boolean }) {
  return (
    <h2
      id={id}
      tabIndex={anchor ? -1 : undefined}
      className={anchor ? "flex scroll-mt-24 items-baseline gap-2 text-base font-semibold outline-none" : "flex items-baseline gap-2 text-base font-semibold"}
    >
      {`${keepTogether(title)} `}
      <span className="text-sm font-normal text-muted-foreground tabular-nums">{formatInteger(count)}</span>
    </h2>
  );
}

/**
 * Un elenco di card (rilascio 10, §1 regola 4): le prime `LANE_PREVIEW` a vista, poi «Vedi tutti (N)», che apre le
 * altre sul posto; aperto dice «Mostra meno», e il fuoco resta sul riassunto.
 */
function CardList({ cards, total, className }: { cards: readonly ReactNode[]; total: number; className: string }) {
  const first = cards.slice(0, LANE_PREVIEW);
  const rest = cards.slice(LANE_PREVIEW);
  return (
    <>
      <ul className={className}>{first}</ul>
      {rest.length ? (
        <Disclosure
          slot="lane-more"
          summary={
            <>
              <span className="[[open]>summary>&]:hidden">{laneSeeAllLabel(total)}</span>
              <span className="hidden [[open]>summary>&]:inline">{LANES_TEXT.showLess}</span>
            </>
          }
        >
          <ul className={className}>{rest}</ul>
        </Disclosure>
      ) : null}
    </>
  );
}

/** Le card di una corsia (una colonna da 58rem del riquadro, prima due da 36rem). */
const LANE_GRID = "grid gap-2 @xl/hub:grid-cols-2 @min-[58rem]/hub:grid-cols-1";
/** Le card di «In realizzazione» e «In uso»: fino a tre colonne. */
const ROW_GRID = "grid gap-2 @xl/hub:grid-cols-2 @min-[58rem]/hub:grid-cols-3";

/**
 * Le corsie della Panoramica (rilascio «Panoramica»; rilascio 10, §3.4 e prototipo S2). In una sezione con l'ancora
 * `#panoramica-approvati` (prende il fuoco dopo un clic in «Per agente») gli approvati per trimestre: «T4 2026» e
 * «T1 2027» con il loro conteggio, e «Più avanti» in una piega chiusa con il riepilogo «4 use case»; a schermo solo
 * quelle con almeno uno use case. Ogni elenco mostra tre card, poi «Vedi tutti (N)». Le corsie stanno affiancate da
 * 58rem del riquadro (`@container/hub`), prima una sotto l'altra. Ai revisori di un workspace con gli agenti nel
 * titolo, sopra, «Per trimestre | Per agente»: per agente una card per agente al posto delle corsie (`AgentGrid`).
 * Aperta dall'indirizzo, «Per agente» viene in vista e prende il fuoco (`RevealOnLoad`); dopo un clic su «Per agente»
 * la pagina resta dov'è. Sotto «In realizzazione», aperta, con le card dei dossier, e «In uso», chiusa, con il
 * riepilogo «1 use case · 38.000 € all'anno». I contributori vedono le stesse corsie, con card con tag, titolo e
 * fase, senza cifre. Con il filtro «Agente» (anche dopo un clic in «Per agente») sopra le corsie una riga dice di chi
 * sono, «LIBRA · 7 use case», con «‹ Tutti gli agenti» quando c'è «Per agente», che torna alla card dell'agente e le
 * dà il fuoco (`HashFocusLink`). I grafici stanno nel «⋯» della testata.
 * Senza niente in programma il vuoto chiede ai revisori di approvare uno use case, e dice ai
 * contributori che cosa trovano qui e dove sono le proposte.
 */
export function PanoramaLanes({
  items,
  today,
  agents,
  barScale,
  bands,
  dossierDown = false,
  dossierColumn = null,
  referentStates = null,
  basePath,
  query,
  filtersActive,
  clearHref,
  grouping,
  agentHref,
  agentFilter,
  contributor = false,
}: PanoramaLanesProps) {
  const lanes = buildLanes(items, today);
  const planned = lanes.lanes.some((lane) => lane.entries.length > 0);
  if (!planned && !lanes.inProgress.length && !lanes.done.length) {
    return filtersActive ? (
      <NoResults clearHref={clearHref} title={items.length ? LANES_TEXT.noneWithFilters : undefined} />
    ) : (
      <EmptyState title={LANES_TEXT.emptyTitle} body={contributor ? LANES_TEXT.emptyContributorBody : LANES_TEXT.emptyBody} />
    );
  }
  const reviewers = items.every((item) => !isContributorItem(item));
  const byAgent = reviewers && grouping?.active === "agente";
  const href = (id: string) => panelHref(basePath, query, id);
  const stateOf = (id: string) => referentStates?.[id.toLowerCase()] ?? null;
  const column = reviewers && dossierColumn?.state === "pronta" ? dossierColumn : null;
  const inProgress = inProgressOrder(lanes.inProgress, column?.cards ?? []);
  const cardOf = (id: string): DossierCardView | undefined => column?.byUseCase.get(id.toLowerCase());
  const planLabel = byAgent
    ? LANES_TEXT.sectionByAgent
    : agentFilter === NO_AGENT_PARAM
      ? LANES_TEXT.sectionOthers
      : agentFilter
        ? agentSectionLabel(agentLabel(agentFilter))
        : LANES_TEXT.sectionByQuarter;
  // Le corsie di un solo agente: il suo nome a schermo, non solo per i lettori di schermo.
  // «‹ Tutti gli agenti» sparisce con il clic: con l'ancora della card dell'agente Next scorre lì e
  // `HashFocusLink` le dà il fuoco, che altrimenti cadrebbe sul <body>, in cima alla pagina.
  const agentsHref = grouping?.items.find((item) => item.key === "agente")?.href ?? null;
  const agentLine =
    reviewers && agentFilter && !byAgent
      ? {
          name: agentLabel(agentFilter),
          count: lanes.lanes.reduce((sum, lane) => sum + lane.entries.length, 0),
          backHref: agentsHref ? `${agentsHref}#${agentCardId(agentFilter)}` : null,
        }
      : null;
  const card = (entry: LaneEntry<AnyHubItem>, place: Lane<AnyHubItem>["key"]) => (
    <LaneCard
      key={entry.item.id}
      item={entry.item}
      place={place}
      href={href(entry.item.id)}
      agents={agents}
      expired={entry.expired}
      barScale={barScale}
      dossierDown={dossierDown}
      bands={bands}
      referentState={stateOf(entry.item.id)}
    />
  );
  // A schermo solo le corsie con almeno uno use case (lo zero non si vede); «Più avanti» in una piega chiusa.
  const shownLanes = lanes.lanes.filter((lane) => lane.entries.length > 0);
  return (
    <div data-slot="panorama-lanes" className="space-y-6">
      {planned ? (
        // L'ancora delle corsie: «Per agente» ci porta con `?agente=…#panoramica-approvati`, Next ci scorre e `HashFocusLink` le dà il fuoco.
        <section id={PANORAMA_SECTION_ID.approvati} tabIndex={-1} aria-label={planLabel} data-slot="panorama-plan" className="scroll-mt-24 space-y-4 outline-none">
          {grouping ? (
            <div data-slot="plan-grouping" className="flex flex-wrap items-center justify-between gap-2">
              <SegmentedNav size="sm" ariaLabel={LANES_TEXT.groupingLabel} active={grouping.active} items={grouping.items} />
              {/* Qui e non in fondo alla sezione: con `space-y-4` un ultimo figlio in più darebbe un margine sotto le card. */}
              {byAgent && grouping.landOnLoad ? <RevealOnLoad /> : null}
            </div>
          ) : null}
          {agentLine ? (
            <p data-slot="agent-filter-line" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>
                <span className="font-semibold">{agentLine.name}</span>
                <span className="text-muted-foreground tabular-nums">{keepTogether(`${FIGURE_SEPARATOR}${laneSummaryText(agentLine.count, null)}`)}</span>
              </span>
              {agentLine.backHref ? (
                <HashFocusLink
                  href={agentLine.backHref}
                  className="inline-flex min-h-11 items-center gap-0.5 rounded-sm font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
                >
                  <ChevronLeft aria-hidden className="size-4" />
                  {LANES_TEXT.allAgents}
                </HashFocusLink>
              ) : null}
            </p>
          ) : null}
          {byAgent ? (
            <AgentGrid groups={agentGroups(lanes.lanes as Lane<HubItem>[], lanes.inProgress as HubItem[])} hrefOf={agentHref} agents={agents} />
          ) : (
            <div data-slot="lanes" className="grid gap-6 @min-[58rem]/hub:grid-cols-3 @min-[58rem]/hub:gap-4">
              {shownLanes.map((lane) => {
                const cards = lane.entries.map((entry) => card(entry, lane.key));
                if (lane.key === "piu_avanti") {
                  // «Più avanti»: una piega chiusa con il riepilogo; un link a `#panoramica-piu-avanti` la apre.
                  return (
                    <div key={lane.key} data-slot="lane" data-lane={lane.key} className="min-w-0">
                      <Fold id={PANORAMA_SECTION_ID.piuAvanti} title={lane.title} summary={keepTogether(laneSummaryText(lane.entries.length, null))}>
                        <CardList cards={cards} total={lane.entries.length} className={LANE_GRID} />
                      </Fold>
                    </div>
                  );
                }
                return (
                  <section key={lane.key} data-slot="lane" data-lane={lane.key} aria-labelledby={`lane-${lane.key}`} className="min-w-0 space-y-3">
                    <ListTitle id={`lane-${lane.key}`} title={lane.title} count={lane.entries.length} />
                    <CardList cards={cards} total={lane.entries.length} className={LANE_GRID} />
                  </section>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {inProgress.length ? (
        <section aria-labelledby={PANORAMA_SECTION_ID.inRealizzazione} data-slot="panoramica-in-realizzazione" className="space-y-3">
          {/* L'ancora di «In realizzazione»: con `tabIndex` prende il fuoco, da `HashFocusLink` per «Vai alla Panoramica» di «Cosa serve». */}
          <ListTitle id={PANORAMA_SECTION_ID.inRealizzazione} title={LANES_TEXT.inProgress} count={inProgress.length} anchor />
          {column?.readOnlyNotice ? <DossierReadOnlyNotice /> : null}
          <CardList
            total={inProgress.length}
            className={ROW_GRID}
            cards={inProgress.map((item) => {
              const dossier = cardOf(item.id);
              return dossier ? (
                <li key={item.id} data-slot="lane-card" data-id={item.id} data-lane="in_realizzazione" className="min-w-0">
                  <DossierCard card={dossier} className="h-full gap-2 px-3 py-2.5 ring-input" />
                </li>
              ) : (
                <LaneCard
                  key={item.id}
                  item={item}
                  place="in_realizzazione"
                  href={href(item.id)}
                  agents={agents}
                  dossierDown={dossierDown}
                  bands={bands}
                  referentState={stateOf(item.id)}
                />
              );
            })}
          />
        </section>
      ) : null}

      {lanes.done.length ? (
        // «In uso», chiusa (§3.4): il riepilogo con gli euro contati ai revisori; `#panoramica-realizzati`, l'ancora di prima, la apre.
        <div data-slot="panoramica-realizzati">
          <Fold id={PANORAMA_SECTION_ID.realizzati} title={LANES_TEXT.done} summary={keepTogether(doneSummaryText(lanes.done.length, lanes.doneCountedEurYear))}>
            <CardList
              total={lanes.done.length}
              className={ROW_GRID}
              cards={lanes.done.map((item) => (
                <LaneCard key={item.id} item={item} place="realizzati" href={href(item.id)} agents={agents} bands={bands} referentState={stateOf(item.id)} />
              ))}
            />
          </Fold>
        </div>
      ) : null}
    </div>
  );
}

/**
 * L'ordine di «In realizzazione»: prima gli use case con la card del dossier, nell'ordine delle card
 * (prima quelli in cui tocca a chi guarda, poi per ultima modifica), poi gli altri nell'ordine di prima.
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
