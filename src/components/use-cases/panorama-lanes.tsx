import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { SegmentedNav, type SegmentedNavItem } from "@/components/dashboard/segmented-nav";
import { DossierCard, DossierReadOnlyNotice } from "@/components/uc/shell/case-card";
import type { DossierColumn } from "@/lib/db/queries/uc-nav";
import type { DossierCardView } from "@/lib/uc/views/realization";
import { agentLabel, NO_AGENT_PARAM, type AgentPalette } from "@/lib/use-cases/agents";
import type { CostBandInfo } from "@/lib/use-cases/cost-bands";
import { FIGURE_SEPARATOR } from "@/lib/use-cases/format";
import type { InfoProgressView } from "@/lib/use-cases/info-progress";
import {
  LANE_PREVIEW,
  PANORAMA_SECTION_ID,
  agentGroups,
  buildLanes,
  laneCountedText,
  laneMoreLabel,
  laneSummaryText,
  type Lane,
  type LaneEntry,
} from "@/lib/use-cases/lanes";
import { isContributorItem, type AnyHubItem, type HubItem } from "@/lib/use-cases/views";
import { AgentGrid } from "./agent-grid";
import { Disclosure } from "./disclosure";
import { EmptyState, HUB_TEXT, NoResults } from "./hub-header";
import { LaneCard } from "./lane-card";
import { panelHref, type HubQuery } from "./use-case-row";

/** Testi delle corsie della Panoramica (rilascio «Panoramica»). */
export const LANES_TEXT = Object.freeze({
  inProgress: "In realizzazione",
  done: "Realizzati",
  emptyLane: "Nessuno use case.",
  showLess: "Mostra meno",
  emptyTitle: "Niente in programma, per ora",
  emptyBody: "Approva uno use case e scegli quando farlo.",
  /** Ai contributori, che non approvano: dove trovano le proposte. */
  emptyContributorBody: `Nessuno use case è ancora approvato. Le proposte sono in «${HUB_TEXT.contributorDecideView}».`,
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
  /** «Raccolta informazioni» per scheda (id in minuscolo), solo per i revisori: il chip delle card. */
  info?: Readonly<Record<string, InfoProgressView>> | null;
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

/**
 * Le corsie della Panoramica (rilascio «Panoramica»). In una sezione con l'ancora
 * `#panoramica-approvati` (prende il fuoco dopo un clic in «Per agente») gli approvati in tre corsie,
 * «Questo trimestre · T4 2026», «Prossimo trimestre · T1 2027» e «Più avanti», sempre tutte e tre:
 * ognuna con «3 use case · 24.500 € contati all'anno», le prime 5 card e le altre dietro «Mostra gli
 * altri N». Le corsie stanno affiancate da 58rem del riquadro (`@container/hub`), prima una sotto
 * l'altra. Ai revisori di un workspace con gli agenti nel titolo, sopra, «Per trimestre | Per agente»:
 * per agente una card per agente al posto delle corsie (`AgentGrid`). Sotto «In realizzazione», aperta,
 * con le card dei dossier, e «Realizzati», chiusa, con il conto. I contributori vedono le stesse corsie
 * con «N use case» e card con tag, titolo e fase, senza cifre. Con il filtro «Agente» (anche dopo un
 * clic in «Per agente») sopra le corsie una riga dice di chi sono, «LIBRA · 7 use case», con
 * «‹ Tutti gli agenti» quando c'è «Per agente». Senza niente in programma il vuoto chiede ai
 * revisori di approvare uno use case, e dice ai contributori dove sono le proposte.
 */
export function PanoramaLanes({
  items,
  today,
  agents,
  barScale,
  bands,
  dossierDown = false,
  dossierColumn = null,
  info = null,
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
  const infoOf = (id: string) => info?.[id.toLowerCase()] ?? null;
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
  const agentLine =
    reviewers && agentFilter && !byAgent
      ? {
          name: agentLabel(agentFilter),
          count: lanes.lanes.reduce((sum, lane) => sum + lane.entries.length, 0),
          backHref: grouping?.items.find((item) => item.key === "agente")?.href ?? null,
        }
      : null;
  const card = (entry: LaneEntry<AnyHubItem>, place: Lane<AnyHubItem>["key"]) => (
    <LaneCard
      key={entry.item.id}
      item={entry.item}
      place={place}
      href={href(entry.item.id)}
      agents={agents}
      quarterNote={entry.quarterNote}
      expired={entry.expired}
      barScale={barScale}
      dossierDown={dossierDown}
      bands={bands}
      info={infoOf(entry.item.id)}
    />
  );
  return (
    <div data-slot="panorama-lanes" className="space-y-6">
      {planned ? (
        // L'ancora delle corsie: «Per agente» ci porta con `?agente=…#panoramica-approvati` e Next le dà il fuoco.
        <section id={PANORAMA_SECTION_ID.approvati} tabIndex={-1} aria-label={planLabel} data-slot="panorama-plan" className="scroll-mt-24 space-y-3 outline-none">
          {grouping ? (
            <div data-slot="plan-grouping">
              <SegmentedNav size="sm" ariaLabel={LANES_TEXT.groupingLabel} active={grouping.active} items={grouping.items} />
            </div>
          ) : null}
          {agentLine ? (
            <p data-slot="agent-filter-line" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>
                <span className="font-semibold">{agentLine.name}</span>
                <span className="text-muted-foreground tabular-nums">{`${FIGURE_SEPARATOR}${laneSummaryText(agentLine.count, null)}`}</span>
              </span>
              {agentLine.backHref ? (
                <Link
                  href={agentLine.backHref}
                  className="inline-flex min-h-11 items-center gap-0.5 rounded-sm font-medium text-primary underline underline-offset-4 outline-none hover:decoration-2 focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
                >
                  <ChevronLeft aria-hidden className="size-4" />
                  {LANES_TEXT.allAgents}
                </Link>
              ) : null}
            </p>
          ) : null}
          {byAgent ? (
            <AgentGrid groups={agentGroups(lanes.lanes as Lane<HubItem>[])} hrefOf={agentHref} agents={agents} />
          ) : (
            <div data-slot="lanes" className="grid gap-6 @min-[58rem]/hub:grid-cols-3 @min-[58rem]/hub:gap-4">
              {lanes.lanes.map((lane) => {
                const first = lane.entries.slice(0, LANE_PREVIEW);
                const rest = lane.entries.slice(LANE_PREVIEW);
                return (
                  <section key={lane.key} data-slot="lane" data-lane={lane.key} aria-labelledby={`lane-${lane.key}`} className="min-w-0 space-y-2">
                    <h2 id={`lane-${lane.key}`} className="text-sm font-semibold">
                      {lane.label}
                    </h2>
                    {lane.entries.length ? (
                      <>
                        <p className="text-xs text-muted-foreground tabular-nums">
                          {laneSummaryText(lane.entries.length, null)}
                          {lane.countedEurYear ? (
                            <>
                              {FIGURE_SEPARATOR}
                              <span data-figure="corsia">{laneCountedText(lane.countedEurYear)}</span>
                            </>
                          ) : null}
                        </p>
                        <ul className="grid gap-2 @xl/hub:grid-cols-2 @min-[58rem]/hub:grid-cols-1">{first.map((entry) => card(entry, lane.key))}</ul>
                        {rest.length ? (
                          // Il riassunto resta a schermo anche aperto («Mostra meno»): il fuoco non si perde.
                          <Disclosure
                            slot="lane-more"
                            summary={
                              <>
                                <span className="[[open]>summary>&]:hidden">{laneMoreLabel(rest.length)}</span>
                                <span className="hidden [[open]>summary>&]:inline">{LANES_TEXT.showLess}</span>
                              </>
                            }
                          >
                            <ul className="grid gap-2 @xl/hub:grid-cols-2 @min-[58rem]/hub:grid-cols-1">{rest.map((entry) => card(entry, lane.key))}</ul>
                          </Disclosure>
                        ) : null}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground">{LANES_TEXT.emptyLane}</p>
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </section>
      ) : null}

      {inProgress.length ? (
        <section aria-labelledby={PANORAMA_SECTION_ID.inRealizzazione} className="space-y-3">
          {/* L'ancora di «In realizzazione» (le fasi, «Vai alla Panoramica» da «Cosa serve»): con `tabIndex` Next le dà il fuoco. */}
          <h2 id={PANORAMA_SECTION_ID.inRealizzazione} tabIndex={-1} className="flex scroll-mt-24 items-baseline gap-2 text-sm font-semibold outline-none">
            {`${LANES_TEXT.inProgress} `}
            <span className="text-xs font-normal text-muted-foreground tabular-nums">{inProgress.length}</span>
          </h2>
          {column?.readOnlyNotice ? <DossierReadOnlyNotice /> : null}
          <ul className="grid gap-2 @xl/hub:grid-cols-2 @min-[58rem]/hub:grid-cols-3">
            {inProgress.map((item) => {
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
                  info={infoOf(item.id)}
                />
              );
            })}
          </ul>
        </section>
      ) : null}

      {lanes.done.length ? (
        <Disclosure
          id={PANORAMA_SECTION_ID.realizzati}
          slot="panoramica-realizzati"
          className="scroll-mt-24"
          summaryClassName="text-sm font-semibold text-foreground"
          summary={
            <>
              {`${LANES_TEXT.done} `}
              <span className="text-xs font-normal text-muted-foreground tabular-nums">{lanes.done.length}</span>
            </>
          }
        >
          <ul className="grid gap-2 @xl/hub:grid-cols-2 @min-[58rem]/hub:grid-cols-3">
            {lanes.done.map((item) => (
              <LaneCard key={item.id} item={item} place="realizzati" href={href(item.id)} agents={agents} bands={bands} info={infoOf(item.id)} />
            ))}
          </ul>
        </Disclosure>
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
