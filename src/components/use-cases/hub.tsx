import { SegmentedNav } from "@/components/dashboard/segmented-nav";
import { PageContainer } from "@/components/dashboard/page-container";
import type { Session } from "@/lib/auth";
import { getUseCaseDetail, listHubItems, viewerFromSession, type HubList } from "@/lib/db/queries/use-case-hub";
import { dossierColumnOf } from "@/lib/db/queries/use-case-dossiers";
import { listWorkspaceNeeds } from "@/lib/db/queries/use-case-needs";
import { listInfoProgress } from "@/lib/db/queries/use-case-info-progress";
import type { DossierColumn } from "@/lib/db/queries/uc-nav";
import { getPortfolioParticipation } from "@/lib/db/queries/portfolio-participation";
import type { Participation } from "@/lib/portfolio/participation";
import { ParticipationCard } from "@/components/portfolio/participation-card";
import { SubprocessorsLsNotice, subprocessorsPendingForLs } from "@/components/workspace/subprocessors-notice";
import { reviewTeamName } from "@/lib/review-team";
import { activityMappingPath, fullFormPath, type ActivityMappingState } from "@/lib/use-cases/create";
import { activityMappingReadiness, quickCreateOptions, type QuickCreateOptions } from "@/lib/use-cases/create-data";
import { toDuplicateCandidates } from "@/lib/use-cases/decision-ui";
import { agentFilterOptions, agentOfTitle } from "@/lib/use-cases/agents";
import { answersOf, type InfoAnswer } from "@/lib/use-cases/answers";
import { unofficialEstimateLines } from "@/lib/use-cases/estimates";
import { INFO_PROGRESS_PARAM, type InfoProgressState, type InfoProgressView } from "@/lib/use-cases/info-progress";
import { channelLabel } from "@/lib/use-cases/labels";
import { laneBarScale, PANORAMA_SECTION_ID } from "@/lib/use-cases/lanes";
import { buildNeedsBoard, panelNeeds, type NeedView } from "@/lib/use-cases/needs";
import { overviewFigures, overviewNextStep, overviewSteps, portfolioLine } from "@/lib/use-cases/panoramica";
import { abilitiesForUseCase, type UseCaseAbilities } from "@/lib/use-cases/permissions";
import { compareQuarters, quarterLabel, WHEN_LATER_LABEL } from "@/lib/use-cases/quarter";
import { USE_CASE_SOURCES } from "@/lib/use-cases/types";
import { buildRoadmapValue, groupPalette, hubCharts, roadmapPlan } from "@/lib/use-cases/value-charts";
import {
  LATER_QUARTER_PARAM,
  applyHubFilters,
  decideCount,
  defaultHubView,
  hasActiveFilters,
  isContributorItem,
  parseHubParams,
  shownChart,
  type AnyHubItem,
  type HubChartParam,
  type HubItem,
  type HubParams,
  type HubView,
  type RawHubParams,
} from "@/lib/use-cases/views";
import { USE_CASE_VALUATION_ANCHOR } from "@/lib/use-cases/settings";
import { roleLabel } from "@/lib/workspace-roles";
import type { WorkspaceAccess } from "@/lib/workspace-access";
import { CHART_TEXT, HubChartView } from "./chart-view";
import { DecideView } from "./decide-view";
import { FilterBar, type FilterOption } from "./filter-bar";
import { infoFilterOptions } from "./info-chip";
import { NeedsBoardView } from "./needs-board";
import { EmptyState, HUB_TEXT, HubHeader, HubNotice, receiptText } from "./hub-header";
import { HashFocusOnCommit, ListFocusTarget } from "./list-focus";
import { LANES_TEXT, PanoramaLanes, type LanesGrouping } from "./panorama-lanes";
import { PanoramicaTop } from "./panoramica-top";
import { QuickCreateSheet } from "./quick-create-sheet";
import { UseCasePanel, type UseCasePanelData } from "./use-case-panel";
import { hubHref, panelHref, withoutTransient, type HubQuery } from "./use-case-row";

/**
 * La pagina «Use case» con l'area accesa (docs/use-case/DESIGN.md §4; PIANO-LAVORI H4a): testata,
 * le tre viste «Panoramica» (in testa fasi, cifre e «Prossimo passo», poi le corsie), «Da decidere»
 * e «Cosa serve», i filtri, il pannello laterale (`?apri=`) e il pannello rapido di «Nuovo use
 * case» (`?nuovo=1`, solo Lateral Space).
 *
 * `loadUseCaseHub` legge tutto sul server, in una volta: la lista già proiettata per chi guarda
 * (`listHubItems`, una query; i contributori ricevono `ContributorUseCase` e nient'altro, D4 e
 * D13), il modello e le fasce del costo del workspace (D15), e solo se servono le voci del
 * pannello rapido, lo stato di Activity mapping e, per il pannello laterale di un revisore, i
 * dati raccolti dello use case aperto (la «Stima di Claude, non ufficiale», §7.5). `UseCaseHub`
 * poi compone la pagina senza altre letture. Nessun filtro, ordinamento o conteggio per persona
 * (art. 15.4): i parametri passano da `parseHubParams`, che scarta tutto quello che non è
 * nell'elenco di §4.2.
 */

export interface UseCaseHubInput {
  workspaceId: string;
  session: Session;
  access: WorkspaceAccess;
  searchParams: RawHubParams;
  now?: Date;
}

export interface UseCaseHubData {
  workspaceId: string;
  /** `/dashboard/<ws>/use-cases`. */
  basePath: string;
  abilities: UseCaseAbilities;
  params: HubParams;
  /** La vista a schermo: quella dell'indirizzo, altrimenti la vista di partenza per ruolo (§4.2). */
  view: HubView;
  list: HubList;
  /** Il nome del team che valuta, da solo (§14.2): ricevuta, «Rispondi» e pannello. */
  teamName: string;
  workspaceName: string;
  roleName: string;
  /** Le voci di «AI Lab» del pannello rapido, solo se è aperto. */
  quickCreate: QuickCreateOptions | null;
  /** Il menu «⋯» › «Proponi da Activity mapping» (solo revisori). */
  activityMapping: ActivityMappingState | null;
  /** Le righe delle «Stime non ufficiali» dello use case aperto (§7.5): solo revisori, vuoto senza dati. */
  panelEstimate: string[];
  /** Le risposte di chi ha proposto a «Serve info» dello use case aperto (D17): solo revisori. */
  panelAnswers: InfoAnswer[];
  /** Al contributore, la sua risposta a «Serve info» dello use case aperto, se è suo e non ancora deciso (D17). */
  panelOwnAnswer: InfoAnswer | null;
  /**
   * Le card dei dossier della colonna «In realizzazione» (H6a, `dossierColumnOf`): solo per un
   * revisore sulla Panoramica, senza grafico, con la parte del dossier che ha risposto; null altrimenti.
   */
  dossierColumn: DossierColumn | null;
  /**
   * «Cosa serve» (`listWorkspaceNeeds`): le esigenze non archiviate del workspace, solo per un
   * revisore nella vista «Cosa serve», con il pannello aperto e anche sulla Panoramica, per
   * «Prossimo passo» (sulle corsie senza filtri, non con un grafico); null altrimenti. Ai
   * contributori mai.
   */
  needs: NeedView[] | null;
  /**
   * «Partecipazione per area» (la scheda di «Raccolta & ranking», che con l'area accesa è la vista
   * «Da decidere»): solo etichette e numeri per area e società, mai chi propone (art. 15.4). Solo
   * sulla vista «Da decidere», per ogni ruolo come su /portfolio; null altrove o senza aree nella
   * guida del connettore.
   */
  participation: Participation | null;
  /**
   * «Raccolta informazioni» di ogni scheda con requisiti del cliente (chiave: id in minuscolo), solo
   * per i revisori che vedono «Cosa serve» (`listInfoProgress`); null ai contributori. Il chip nelle
   * righe e il filtro «Informazioni».
   */
  info: Record<string, InfoProgressView> | null;
  /**
   * L'avviso dei sub-responsabili non ancora autorizzati dal cliente: solo per Lateral Space,
   * sulla Panoramica, senza grafico (con l'area accesa `/casi-duso` porta qui), con la sezione
   * Casi d'uso accesa.
   */
  subprocessorsPending: boolean;
  /** Le voci dei grafici del menu «⋯» (`hubCharts`, su tutte le schede); [] ai contributori. */
  charts: HubChartParam[];
  /** Il grafico aperto nella Panoramica al posto delle corsie (`shownChart`); null senza. */
  chart: HubChartParam | null;
}

/** Tutto quello che serve alla pagina, per chi guarda. null per chi non entra nell'area. */
export async function loadUseCaseHub({ workspaceId, session, access, searchParams, now }: UseCaseHubInput): Promise<UseCaseHubData | null> {
  const viewer = viewerFromSession(session.user, access.role);
  const abilities = abilitiesForUseCase(viewer);
  if (!abilities.canOpenArea) return null;
  const params = parseHubParams(searchParams, viewer);
  const reviewer = abilities.projection === "revisore" || abilities.projection === "gestore";
  const [list, quickCreate, activityMapping, opened] = await Promise.all([
    listHubItems(workspaceId, viewer, { createdId: params.thanks ? params.created : null, now }),
    params.nuovo ? quickCreateOptions(workspaceId) : null,
    abilities.canProposeFromActivityMapping ? activityMappingReadiness(workspaceId) : null,
    // Solo lo use case aperto: per un revisore i dati raccolti, per un contributore la sua risposta.
    params.apri ? getUseCaseDetail(workspaceId, params.apri, viewer, { now }) : null,
  ]);
  if (!list) return null;
  const items: readonly AnyHubItem[] = list.items;
  const view = params.vista ?? defaultHubView(viewer, decideCount(items));
  // I grafici del menu «⋯» dei revisori, su tutte le schede: un filtro non toglie una voce.
  const charts = reviewer && abilities.canSeePriority ? hubCharts(list.items as HubItem[]) : [];
  const chart = view === "panoramica" && reviewer ? shownChart(params.mostra, charts) : null;
  // La Panoramica con le sue corsie, senza un grafico del menu «⋯».
  const lanes = view === "panoramica" && chart === null;
  // La colonna «In realizzazione» con le card dei dossier (§4.5): un giro in più, solo sulle corsie.
  const inProgress =
    reviewer && lanes && list.dossierRead === "ok"
      ? (items as readonly HubItem[]).filter((item) => item.phase === "in_realizzazione" && item.dossier).map((item) => item.id)
      : [];
  // «Cosa serve»: le esigenze del workspace per la sua vista, per il pannello e per «Prossimo passo»
  // della Panoramica, solo ai revisori. «Prossimo passo» c'è solo sulle corsie senza filtri: con un
  // filtro le corsie non le leggono.
  const readsNeeds = reviewer && abilities.canSeeNeeds && (view === "cosa-serve" || (lanes && !hasActiveFilters(params)) || Boolean(params.apri));
  const [dossierColumn, participation, subprocessorsPending, needs, info] = await Promise.all([
    inProgress.length ? dossierColumnOf(workspaceId, { userId: session.user.id, role: access.role }, inProgress) : null,
    view === "da-decidere" ? getPortfolioParticipation(workspaceId) : null,
    // Solo a Lateral Space (la stessa regola di `getUcUserContext`): ai revisori del cliente nessuna lettura.
    reviewer && abilities.isLateralSpace && lanes ? subprocessorsPendingForLs(workspaceId, session.user.id) : false,
    readsNeeds ? listWorkspaceNeeds(workspaceId, viewer) : null,
    // «Raccolta informazioni»: solo a chi vede «Cosa serve»; la lettura stessa risponde null agli altri.
    abilities.canSeeNeeds ? listInfoProgress(workspaceId, viewer, { now }) : null,
  ]);
  return {
    workspaceId,
    basePath: `/dashboard/${workspaceId}/use-cases`,
    abilities,
    params,
    view,
    list,
    teamName: reviewTeamName(access.workspace),
    workspaceName: access.workspace.name,
    roleName: roleLabel(access.role),
    quickCreate,
    activityMapping,
    panelEstimate: opened && opened.projection !== "contributore" ? unofficialEstimateLines(opened.useCase.intake) : [],
    panelAnswers: opened && opened.projection !== "contributore" ? answersOf(opened.useCase.intake) : [],
    panelOwnAnswer: opened && opened.projection === "contributore" ? opened.answer : null,
    dossierColumn,
    needs,
    participation,
    info,
    subprocessorsPending,
    charts,
    chart,
  };
}

/** I parametri letti, di nuovo come testo, con la vista a schermo. */
function queryOf(params: HubParams, view: HubView): HubQuery {
  const query: HubQuery = { vista: view };
  if (params.tipo) query.tipo = params.tipo;
  if (params.mostra) query.mostra = params.mostra;
  if (params.origine) query.origine = params.origine;
  if (params.q) query.q = params.q;
  if (params.canale) query.canale = params.canale;
  if (params.area) query.area = params.area;
  if (params.agente) query.agente = params.agente;
  if (params.lab) query.lab = params.lab;
  if (params.trimestre) query.trimestre = params.trimestre;
  if (params.stima) query.stima = params.stima;
  if (params.info) query.info = INFO_PROGRESS_PARAM[params.info];
  if (params.apri) query.apri = params.apri;
  if (params.nuovo) query.nuovo = "1";
  if (params.thanks) query.thanks = "1";
  if (params.created) query.created = params.created;
  if (params.joined) query.joined = params.joined;
  return query;
}

const byLabel = (a: FilterOption, b: FilterOption) => a.label.localeCompare(b.label, "it-IT");

/** Le voci dei grafici nel menu «⋯» e i titoli sopra di loro. */
const CHART_LABEL: Record<HubChartParam, string> = { matrice: CHART_TEXT.matrice, benefici: CHART_TEXT.benefici, curva: CHART_TEXT.curva };

/**
 * Le voci di «Altri filtri» dagli use case del workspace: canali, aree, agenti (il prefisso del
 * titolo), AI Lab e trimestri che ci sono. Un valore dell'indirizzo che nessuno use case ha più (un
 * link condiviso, l'ultimo use case di quel trimestre spostato) resta scelto, con il suo testo:
 * «T1 2027», «MCP del team».
 */
function moreFilterOptions(
  items: readonly HubItem[],
  params: HubParams,
  info: UseCaseHubData["info"],
): { channels: FilterOption[]; areas: FilterOption[]; agents: FilterOption[]; labs: FilterOption[]; quarters: FilterOption[]; infos: FilterOption[] } {
  const channels = new Map<string, string>();
  const areas = new Map<string, string>();
  const labs = new Map<string, string>();
  const quarters = new Set<string>();
  let later = false;
  for (const item of items) {
    const source = item.source ?? "activity_mapping";
    if ((USE_CASE_SOURCES as readonly string[]).includes(source)) channels.set(source, channelLabel(source));
    if (item.area) areas.set(item.area, item.area);
    if (item.aiLab) labs.set(item.aiLab, item.aiLab);
    if (item.phase === "approvato") {
      if (item.targetQuarter) quarters.add(item.targetQuarter);
      else later = true;
    }
  }
  if (params.canale && !channels.has(params.canale)) channels.set(params.canale, channelLabel(params.canale));
  if (params.area && !areas.has(params.area)) areas.set(params.area, params.area);
  if (params.lab && !labs.has(params.lab)) labs.set(params.lab, params.lab);
  if (params.trimestre === LATER_QUARTER_PARAM) later = true;
  else if (params.trimestre) quarters.add(params.trimestre);
  const asOptions = (map: Map<string, string>) => [...map].map(([value, label]) => ({ value, label })).sort(byLabel);
  return {
    channels: asOptions(channels),
    areas: asOptions(areas),
    // «Agente»: dai titoli, «Altri use case» in fondo; senza prefissi il campo non c'è.
    agents: agentFilterOptions(items, params.agente),
    labs: asOptions(labs),
    quarters: [
      ...[...quarters].sort(compareQuarters).map((value) => ({ value, label: quarterLabel(value) })),
      ...(later ? [{ value: LATER_QUARTER_PARAM, label: WHEN_LATER_LABEL }] : []),
    ],
    // «Informazioni»: gli stati delle schede che ci sono, nell'ordine fisso; mai per persona.
    infos: infoFilterOptions(info, params.info),
  };
}

/** Il benvenuto dopo un invito (`?joined=`, i testi di oggi con «Nuovo use case», §5.5). */
function Welcome({ joined, workspaceName, roleName }: { joined: HubParams["joined"]; workspaceName: string; roleName: string }) {
  if (joined === "1" || joined === "upgraded") {
    return (
      <HubNotice tone="verde" title={`Benvenuto in ${workspaceName}!`} testId="workspace-welcome">
        Ora collabori come {roleName}
        {joined === "upgraded" ? " e continui a seguire i tuoi corsi" : ""}. Per iniziare, proponi un use case con «Nuovo use case».
      </HubNotice>
    );
  }
  if (joined === "already") {
    return (
      <HubNotice tone="blu" testId="workspace-already-member">
        Eri già in {workspaceName} come {roleName}: l&apos;invito non ha cambiato il tuo ruolo.
      </HubNotice>
    );
  }
  return null;
}

/** La pagina «Use case» con l'area accesa, dai dati di `loadUseCaseHub`. */
export function UseCaseHub({ data }: { data: UseCaseHubData }) {
  const { workspaceId, basePath, abilities, params, view, list } = data;
  const reviewer = list.projection !== "contributore";
  // Parte dossier non disponibile (§4.9): «In realizzazione» senza «Senza dossier», che non sarebbe vero.
  const dossierDown = list.dossierRead === "errore";
  const items: readonly AnyHubItem[] = list.items;
  const reviewerItems = reviewer ? (list.items as HubItem[]) : [];
  const bands = list.projection !== "contributore" ? list.costBands : undefined;
  // I colori degli agenti, dagli use case della Panoramica di tutto il workspace (`listHubItems`):
  // gli stessi per ogni ruolo, e né un filtro né una proposta li cambiano.
  const agents = list.agents;
  // «Benefici e costi» (solo revisori): ipotesi del workspace e colori dei gruppi, da tutte le schede;
  // con gli agenti nei titoli il colore dei grafici dice l'agente, come nelle card.
  const valueParams = list.projection !== "contributore" ? list.valueParams : null;
  const palette = reviewer ? groupPalette(reviewerItems, valueParams, agents) : null;
  const followsCurrentMonth = list.projection !== "contributore" ? list.followsCurrentMonth : false;
  // La scala delle barre, sugli approvati di tutto il workspace.
  const barScale = reviewer ? laneBarScale(reviewerItems) : 0;
  // «Ipotesi di calcolo» porta a Impostazioni › Valutazione solo chi le può cambiare.
  const valueSettingsHref = abilities.canEditSettings ? `/dashboard/${workspaceId}/settings#${USE_CASE_VALUATION_ANCHOR}` : null;
  const query = queryOf(params, view);
  const navQuery = withoutTransient(query);
  const chart = data.chart;
  // Le due matrici sono solo «Da costruire»: lì il tipo non filtra e «Tipo» non c'è; resta nell'indirizzo per il ritorno.
  const ignoreKind = chart === "matrice" || chart === "benefici";
  // Sui grafici «da stimare» (`stima`) non filtra: apre il suo elenco sotto la matrice, e i link non lo portano.
  const shown: HubParams = chart ? { ...params, stima: null } : params;
  // «Raccolta informazioni» della scheda, per il filtro e i chip: solo per i revisori.
  const infoOf = (id: string): InfoProgressState | null => data.info?.[id.toLowerCase()]?.state ?? null;
  const filtered = applyHubFilters(items, shown, { ignoreKind, infoOf });
  const filtersActive = hasActiveFilters(shown, { ignoreKind });
  const clearHref = hubHref(basePath, { vista: view, ...(view === "panoramica" && params.mostra ? { mostra: params.mostra } : {}) });
  const newHref = abilities.newUseCase === "pannello_rapido" ? hubHref(basePath, navQuery, { nuovo: "1" }) : fullFormPath(workspaceId);
  // «mostra» e «da stimare» non passano alle altre viste; il tipo sì, come l'origine.
  const viewHref = (key: HubView) => hubHref(basePath, navQuery, { vista: key, mostra: null, stima: null });
  // Il contatore di «Da decidere» conta come la sua vista: con il tipo, senza «da stimare».
  const decideItems = applyHubFilters(items, { ...params, stima: null }, { infoOf });
  // I grafici del menu «⋯» si aprono nella Panoramica con i filtri di adesso, senza «da stimare»
  // (`stima`): i suoi use case non hanno un punto.
  const chartLinks = data.charts.map((key) => ({
    label: CHART_LABEL[key],
    href: hubHref(basePath, navQuery, { vista: "panoramica", mostra: key, stima: null }),
  }));

  // «Per trimestre | Per agente»: ai revisori, solo se un approvato ha l'agente nel titolo (un vecchio
  // `?mostra=agenti` senza prefissi mostra le corsie). «Per trimestre» tiene ogni filtro; «Per agente»
  // toglie solo l'agente, e torna all'elenco degli agenti.
  const agentsInWorkspace = reviewer && reviewerItems.some((item) => item.phase === "approvato" && agentOfTitle(item.title) !== null);
  const grouping: LanesGrouping | null =
    view === "panoramica" && !chart && agentsInWorkspace
      ? {
          active: params.mostra === "agenti" ? "agente" : "trimestre",
          items: [
            { key: "trimestre", label: LANES_TEXT.byQuarter, href: hubHref(basePath, navQuery, { mostra: null }) },
            { key: "agente", label: LANES_TEXT.byAgent, href: hubHref(basePath, navQuery, { mostra: "agenti", agente: null }) },
          ],
        }
      : null;
  // Una card di «Per agente»: le corsie del solo agente, con l'ancora che le porta in vista e prende il fuoco (`HashFocusLink`).
  const agentHref = (param: string) => `${hubHref(basePath, navQuery, { mostra: null, agente: param })}#${PANORAMA_SECTION_ID.approvati}`;
  // La testa della Panoramica (solo con le corsie): fasi e cifre seguono i filtri, come le corsie;
  // «Su tutto il portafoglio» e «Prossimo passo» dicono tutto il workspace e con un filtro non ci sono.
  const overview =
    view === "panoramica" && !chart && filtered.length > 0
      ? {
          steps: overviewSteps(filtered, { reviewer, decide: decideCount(decideItems) }),
          figures: reviewer && abilities.canSeeFigures ? overviewFigures(filtered as HubItem[], list.today) : null,
          line:
            reviewer && abilities.canSeeFigures && !filtersActive && valueParams
              ? portfolioLine(buildRoadmapValue(reviewerItems, valueParams, { plan: roadmapPlan(reviewerItems, valueParams) }))
              : null,
          nextStep: reviewer && !filtersActive ? overviewNextStep({ items: reviewerItems, needs: data.needs, today: list.today }) : null,
        }
      : null;
  // Dove porta «Prossimo passo», senza i filtri di adesso: la vista mostra proprio quello che si è contato.
  const nextStep = overview?.nextStep ?? null;
  const nextStepHref = nextStep
    ? nextStep.kind === "decisioni"
      ? hubHref(basePath, {}, { vista: "da-decidere" })
      : hubHref(basePath, {}, { vista: "cosa-serve", trimestre: nextStep.quarter })
    : null;

  // «Cosa serve»: tutte le esigenze del workspace; con un filtro quelle degli use case che lo
  // passano (e quelle con la ricerca nel titolo). I codici in «Per» restano quelli di tutte le schede.
  const needsBoard =
    view === "cosa-serve" && reviewer && data.needs && valueParams
      ? buildNeedsBoard(data.needs, reviewerItems, {
          today: list.today,
          params: valueParams,
          only: filtersActive ? { useCaseIds: new Set((filtered as HubItem[]).map((item) => item.id.toLowerCase())), q: params.q } : null,
        })
      : null;

  const panelItem = params.apri ? items.find((item) => item.id.toLowerCase() === params.apri) : undefined;
  const panelData: UseCasePanelData | null = panelItem
    ? isContributorItem(panelItem)
      ? { projection: "contributore", item: panelItem, answer: data.panelOwnAnswer }
      : {
          projection: "revisore",
          item: panelItem,
          candidates: toDuplicateCandidates(reviewerItems) ?? [],
          estimate: data.panelEstimate,
          answers: data.panelAnswers,
          needs: data.needs ? panelNeeds(data.needs, panelItem, list.today) : null,
        }
    : null;

  // La Panoramica prima, per tutti. I contributori non decidono: per loro la vista è «In
  // valutazione», senza contatore (H4p).
  const navItems = [
    { key: "panoramica", label: HUB_TEXT.overviewView, href: viewHref("panoramica") },
    reviewer
      ? { key: "da-decidere", label: HUB_TEXT.decideView, count: decideCount(decideItems), href: viewHref("da-decidere") }
      : { key: "da-decidere", label: HUB_TEXT.contributorDecideView, href: viewHref("da-decidere") },
    ...(abilities.canSeeNeeds ? [{ key: "cosa-serve", label: "Cosa serve", href: viewHref("cosa-serve") }] : []),
  ];

  const receipt = params.thanks ? list.receipt : null;

  return (
    <PageContainer size="default">
      {/*
        `@container/hub`: le righe e le tabelle di «Cosa serve» cambiano forma sulla larghezza di
        questo riquadro, non della finestra. Da 768 px la barra laterale ne prende 256: a 1024 px
        restano circa 700 px, e le colonne pensate per la finestra intera non ci stanno.
      */}
      <div data-slot="use-case-hub" data-view={view} className="@container/hub space-y-6">
        {/* Dopo un link con un'ancora (`HashFocusLink`: «Per agente», «‹ Tutti gli agenti», «Vai alla Panoramica») l'ancora prende il fuoco. */}
        <HashFocusOnCommit />
        <HubHeader
          workspaceId={workspaceId}
          newHref={newHref}
          newUseCaseVariant={nextStep ? "outline" : "default"}
          menu={
            abilities.canExport && data.activityMapping
              ? {
                  exportHref: `/dashboard/${workspaceId}/portfolio/export`,
                  activityMapping: data.activityMapping,
                  mappingHref: activityMappingPath(workspaceId),
                  charts: chartLinks,
                }
              : null
          }
        >
          {items.length > 0 ? (
            <div className="space-y-3">
              <SegmentedNav ariaLabel={HUB_TEXT.viewsLabel} active={view} items={navItems} gridOnPhone={navItems.length > 2} />
              <FilterBar
                basePath={basePath}
                query={query}
                mode={reviewer ? "revisore" : "contributore"}
                kind={ignoreKind ? "nessuno" : "filtro"}
                more={reviewer ? moreFilterOptions(reviewerItems, params, data.info) : undefined}
                active={filtersActive}
                clearHref={clearHref}
              />
            </div>
          ) : null}
        </HubHeader>

        {receipt ? (
          <HubNotice tone="verde" title={HUB_TEXT.receiptTitle} testId="use-case-receipt">
            {receiptText(receipt.code, data.teamName)}
          </HubNotice>
        ) : null}
        <Welcome joined={params.joined} workspaceName={data.workspaceName} roleName={data.roleName} />
        {data.subprocessorsPending && view === "panoramica" && !chart ? <SubprocessorsLsNotice workspaceId={workspaceId} workspaceName={data.workspaceName} /> : null}

        {items.length === 0 ? (
          // «Nuovo use case» c'è già nella testata: il vuoto non ne aggiunge un secondo.
          <EmptyState title={HUB_TEXT.emptyTitle} body={reviewer ? HUB_TEXT.emptyReviewer : HUB_TEXT.emptyContributor} />
        ) : view === "panoramica" ? (
          chart && list.projection !== "contributore" ? (
            // Un grafico del menu «⋯» al posto delle corsie, con «‹ Torna alla Panoramica» sopra.
            <HubChartView
              chart={chart}
              items={filtered as HubItem[]}
              planItems={reviewerItems}
              model={list.model}
              valueParams={valueParams}
              palette={palette ?? groupPalette(reviewerItems, valueParams, agents)}
              agents={agents}
              followsCurrentMonth={followsCurrentMonth}
              settingsHref={valueSettingsHref}
              bands={list.costBands}
              today={list.today}
              basePath={basePath}
              query={query}
              filtersActive={filtersActive}
              clearHref={clearHref}
              open={params.stima}
            />
          ) : (
            // Il titolo per i lettori di schermo prende il fuoco dopo «‹ Torna alla Panoramica».
            <div data-slot="panoramica" className="space-y-6">
              <ListFocusTarget title={HUB_TEXT.overviewView} />
              {overview ? (
                <PanoramicaTop
                  steps={overview.steps}
                  reviewer={reviewer}
                  decideHref={viewHref("da-decidere")}
                  figures={overview.figures}
                  line={overview.line}
                  nextStep={nextStep && nextStepHref ? { step: nextStep, href: nextStepHref } : null}
                />
              ) : null}
              <PanoramaLanes
                items={filtered}
                today={list.today}
                agents={agents}
                barScale={barScale}
                bands={bands}
                dossierDown={dossierDown}
                dossierColumn={data.dossierColumn}
                info={data.info}
                basePath={basePath}
                query={query}
                filtersActive={filtersActive}
                clearHref={clearHref}
                grouping={grouping}
                agentHref={agentHref}
                agentFilter={params.agente}
                contributor={!reviewer}
              />
            </div>
          )
        ) : view === "cosa-serve" && list.projection !== "contributore" ? (
          needsBoard ? (
            // Il titolo per i lettori di schermo prende il fuoco dopo «Vedi cosa serve» della Panoramica.
            <>
              <ListFocusTarget key="cosa-serve" title="Cosa serve" />
              <NeedsBoardView
                board={needsBoard}
                today={list.today}
                agents={agents}
                hrefOf={(id) => panelHref(basePath, query, id)}
                inRealization={(filtered as HubItem[]).filter((item) => item.phase === "in_realizzazione").length}
                realizationHref={`${viewHref("panoramica")}#${PANORAMA_SECTION_ID.inRealizzazione}`}
                filtersActive={filtersActive}
                clearHref={clearHref}
                searched={Boolean(params.q)}
                quarter={params.trimestre ? (params.trimestre === LATER_QUARTER_PARAM ? WHEN_LATER_LABEL : quarterLabel(params.trimestre)) : null}
              />
            </>
          ) : null
        ) : (
          // Il titolo per i lettori di schermo prende il fuoco dopo «Vedi le proposte» e «Da decidere» delle fasi.
          <>
            <ListFocusTarget key="da-decidere" title={reviewer ? HUB_TEXT.decideView : HUB_TEXT.contributorDecideView} />
            <DecideView
              items={filtered}
              teamName={data.teamName}
              today={list.today}
              basePath={basePath}
              query={query}
              bands={bands}
              overviewHref={abilities.canSeePriority ? viewHref("panoramica") : null}
              info={data.info}
              filtersActive={filtersActive}
              clearHref={clearHref}
            />
          </>
        )}

        {view === "da-decidere" && data.participation ? <ParticipationCard participation={data.participation} /> : null}
      </div>

      {panelData ? (
        <UseCasePanel
          key={panelData.item.id}
          workspaceId={workspaceId}
          data={panelData}
          closeHref={hubHref(basePath, navQuery)}
          detailHref={`${basePath}/${panelData.item.id}`}
          today={list.today}
          canDecide={abilities.canDecide}
          bands={bands}
          dossierDown={dossierDown}
          teamName={data.teamName}
        />
      ) : null}
      {data.quickCreate ? <QuickCreateSheet workspaceId={workspaceId} aiLabs={data.quickCreate.aiLabs} lastAiLab={data.quickCreate.lastAiLab} /> : null}
    </PageContainer>
  );
}
