/**
 * Letture dell'area «Use case»: parametri, proiezioni per ruolo e le tre viste
 * (docs/use-case/DESIGN.md §4.2-4.7, §4.10, §6.9, §7.5, §9.3, §11; PIANO-LAVORI H2b).
 *
 * - **Parametri.** `parseHubParams` tiene solo i parametri dell'elenco di §4.2 e ignora
 *   tutti gli altri: nessun filtro per persona entra nemmeno scritto a mano nell'URL (§11).
 *   Ai contributori restano solo vista (tranne «Cosa serve»), ricerca e ricevute.
 * - **Proiezioni.** I revisori ricevono `HubItem` (lista) e `UseCaseDetail` (scheda), senza
 *   il proponente; i contributori `ContributorUseCase` di `permissions.ts`, e nient'altro.
 *   Di `intake` i revisori ricevono solo le chiavi di `REVIEWER_INTAKE_KEYS`: un elenco di
 *   ciò che si può dare, così una chiave nuova resta fuori finché qualcuno non la aggiunge
 *   qui. La REST di oggi risponde ai soli revisori con `toUseCaseApiRow`
 *   (`src/lib/portfolio/use-case-client-rows.ts`). Chi gestisce il workspace riceve in più la proiezione di
 *   `projectForManager` (`src/lib/db/queries/use-case-hub.ts`), l'unico posto che la nomina.
 * - **Viste.** «Panoramica» (qui i trimestri rispetto a oggi, le cifre e la matrice del menu «⋯»;
 *   le corsie stanno in `lanes.ts`, la testa in `panoramica.ts`; i vecchi «Priorità» e «Roadmap»
 *   dei link valgono la Panoramica), «Da decidere» (giorni di attesa, contatore senza «Serve
 *   info»), «Cosa serve» (requisiti e prossimi passi degli use case, solo revisori). Nessun
 *   ordinamento, raggruppamento o conteggio per persona (art. 15.4).
 * - **Costo.** Valore, costo, zone e costo basso passano da `valuation.ts` con il modello del
 *   workspace, quindi con le sue fasce (`resolveCostBands`, D15). Dove questo modulo scrive
 *   l'etichetta di una fascia riceve anche `bands` (predefinite `COST_BANDS`).
 * - **Benefici e costi.** Una scheda con `value_model` valido (`parseValueModel`) si conta con
 *   le ipotesi del workspace (`ctx.valueParams`, `modelEstimate`): il modello vale al posto dei
 *   KPI d'impatto e del costo scritto a mano. Solo i revisori lo ricevono (`HubItem.valueModel`);
 *   la proiezione dei contributori non lo nomina.
 * - **Giorni di attesa** (D8): dall'ultimo «Riapri» se c'è, altrimenti dall'arrivo
 *   (`coalesce(submitted_at, created_at)`); per «Da rivedere» dalla data di revisione. Mai
 *   dall'ultimo cambio di stato: cambia anche quando si salva una valutazione.
 *
 * Modulo puro: solo import relativi `.ts` (tipi di `schema.ts` compresi), nessun `server-only`.
 */
import type { UseCase } from "../db/schema.ts";
import type { CaseStatus } from "../uc/vocab.ts";
import { agentParamOf, parseAgentParam, type AgentParam } from "./agents.ts";
import { isAnswerPending } from "./answers.ts";
import { COST_BANDS, costBandInfo, costLowBandFrom, isCostBand, isCostLowBand, resolveCostBands, type CostBandInfo } from "./cost-bands.ts";
import { zoneText } from "./format.ts";
import {
  COST_SOURCE_LABEL,
  KIND_LABEL,
  NOT_ESTIMATED_LABEL,
  ORIGIN_LABEL,
  VALUE_MODEL_STATE_LABEL,
  VALUE_SOURCE_LABEL,
  VALUE_WORD_LABEL,
  ZONES,
  channelLabel,
  kindOf,
  type RiskChip,
  type Zone,
} from "./labels.ts";
import {
  abilitiesForUseCase,
  isHiddenFromSearch,
  projectForContributor,
  type ContributorUseCase,
  type ProposalOwner,
  type ProposalRow,
  type UseCaseViewer,
} from "./permissions.ts";
import { phaseOfUseCase, type PhaseInput } from "./phase.ts";
import { compareQuarters, isQuarterCode, nextQuarter, parseIsoDate, quarterLabel, quarterOfDate, romeToday, WHEN_LATER_LABEL } from "./quarter.ts";
import { ORIGINS, USE_CASE_SOURCES, type CostBand, type IsoDate, type Origin, type Phase, type PhaseTone, type QuarterCode, type SubState, type UseCaseKind } from "./types.ts";
import {
  costFigure,
  riskChips,
  valueFigure,
  zoneOf,
  type CostFigure,
  type KpiScoreMap,
  type LegacyScoreColumns,
  type ValuationModel,
  type ValueFigure,
} from "./valuation.ts";
import { modelEstimate } from "./value-calc.ts";
import { parseInfoParam, type InfoProgressState } from "./info-progress.ts";
import { DEFAULT_VALUE_PARAMS, LEVER_LABELS, parseValueModel, type MonthCode, type ValueModel, type ValueParams } from "./value-model.ts";

// ═══ Parametri della pagina (§4.2) ═══════════════════════════════════

/** Le viste, nell'ordine del selettore (rilascio «Panoramica»). */
export const HUB_VIEWS = ["panoramica", "da-decidere", "cosa-serve"] as const;
export type HubView = (typeof HUB_VIEWS)[number];

/**
 * I nomi delle viste di prima del rilascio «Panoramica», nei link che girano ancora: preferiti,
 * email già partite, campanella, riepilogo, dossier. Si leggono come la vista a destra, con ogni
 * altro parametro (`parseHubParams`); nessuno li scrive più, e non si tolgono.
 */
export const HUB_VIEW_ALIASES: Readonly<Record<string, HubView>> = Object.freeze({ priorita: "panoramica", roadmap: "panoramica" });

/** La vista di `vista`: una delle viste o un vecchio nome. Maiuscole, «toString» e «__proto__» non valgono. */
function viewOf(value: string | null): HubView | null {
  if (value === null) return null;
  return oneOf(HUB_VIEWS, value) ?? (Object.hasOwn(HUB_VIEW_ALIASES, value) ? HUB_VIEW_ALIASES[value] : null);
}

export const HUB_KIND_PARAMS = ["costruire", "diffondere"] as const;
export type HubKindParam = (typeof HUB_KIND_PARAMS)[number];

/**
 * Che cosa mostra la Panoramica: senza `mostra` le corsie per trimestre; `agenti` gli stessi use
 * case per agente; `matrice`, `benefici` e `curva` i grafici del menu «⋯», al posto delle corsie.
 * Solo revisori. `lista` dei vecchi link di «Priorità» non vale più: la Panoramica.
 */
export const HUB_SHOW_PARAMS = ["matrice", "benefici", "curva", "agenti"] as const;
export type HubShowParam = (typeof HUB_SHOW_PARAMS)[number];

/** I grafici del menu «⋯», aperti nella Panoramica al posto delle corsie. */
export const HUB_CHART_PARAMS = ["matrice", "benefici", "curva"] as const;
export type HubChartParam = (typeof HUB_CHART_PARAMS)[number];

/** `mostra` apre un grafico del menu «⋯»? */
export function isHubChart(value: string | null): value is HubChartParam {
  return oneOf(HUB_CHART_PARAMS, value) !== null;
}

/**
 * I valori di `stima`: «da stimare» e «fuori dalla matrice» (con «Benefici e costi», senza
 * beneficio contato o costo). Sui grafici `stima` non filtra: apre il suo elenco chiuso sotto la
 * matrice. Altrove resta un filtro nascosto, per i vecchi link di «Priorità».
 */
export const HUB_ESTIMATE_PARAMS = ["mancante", "fuori-matrice"] as const;
export type HubEstimateParam = (typeof HUB_ESTIMATE_PARAMS)[number];

/** `trimestre=piu-avanti`: gli approvati senza trimestre. */
export const LATER_QUARTER_PARAM = "piu-avanti";

/** Valori di `?joined=` (benvenuto dopo un invito, oggi `portfolio/page.tsx`). */
export const JOINED_VALUES = ["1", "upgraded", "already"] as const;
export type JoinedValue = (typeof JOINED_VALUES)[number];

/** Ricerca: da 2 a 100 caratteri, su titolo e codice (§4.2). */
export const SEARCH_MIN = 2;
export const SEARCH_MAX = 100;
const AREA_MAX = 80;
const LAB_MAX = 120;

/** I soli parametri della pagina, nell'ordine di §4.2. Ogni altro parametro si ignora. */
export const HUB_PARAM_KEYS = [
  "vista",
  "tipo",
  "mostra",
  "origine",
  "q",
  "canale",
  "area",
  "agente",
  "lab",
  "trimestre",
  "stima",
  "info",
  "apri",
  "nuovo",
  "thanks",
  "created",
  "joined",
] as const;
export type HubParamKey = (typeof HUB_PARAM_KEYS)[number];

export interface HubParams {
  /** null: la vista di partenza (`defaultHubView`). */
  vista: HubView | null;
  tipo: HubKindParam | null;
  mostra: HubShowParam | null;
  origine: Origin | null;
  q: string | null;
  /** Canale come valore di `use_cases.source` (§4.7). */
  canale: string | null;
  area: string | null;
  /** «Agente»: il prefisso del titolo («LIBRA», `agents.ts`) o «altri», mai una persona. */
  agente: AgentParam | null;
  lab: string | null;
  trimestre: QuarterCode | typeof LATER_QUARTER_PARAM | null;
  /** «mancante»: l'elenco «N da stimare» sotto la matrice; «fuori-matrice»: le schede con «Benefici e costi» senza un punto nella matrice. */
  stima: HubEstimateParam | null;
  /** «Raccolta informazioni» (`info-progress.ts`): solo per i revisori, come `stima`. */
  info: InfoProgressState | null;
  apri: string | null;
  /** Pannello rapido: solo Lateral Space (§5.1). */
  nuovo: boolean;
  thanks: boolean;
  created: string | null;
  joined: JoinedValue | null;
}

/** `searchParams` di una pagina Next, oppure `URLSearchParams`. */
export type RawHubParams = URLSearchParams | Readonly<Record<string, string | readonly string[] | undefined>>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readParam(raw: RawHubParams, key: HubParamKey): string | null {
  let value: unknown;
  if (raw instanceof URLSearchParams) value = raw.get(key);
  else if (Object.prototype.hasOwnProperty.call(raw, key)) value = raw[key];
  if (Array.isArray(value)) value = value[0];
  return typeof value === "string" ? value : null;
}

function oneOf<T extends string>(list: readonly T[], value: string | null): T | null {
  return value !== null && (list as readonly string[]).includes(value) ? (value as T) : null;
}

function boundedText(value: string | null, min: number, max: number): string | null {
  if (value === null) return null;
  const text = value.trim().replace(/\s+/g, " ");
  const length = [...text].length;
  return length >= min && length <= max ? text : null;
}

/**
 * I vecchi link di «Priorità» (`vista=priorita`): lì «Da costruire | Da diffondere» sceglieva la
 * lista, non filtrava. «Da diffondere» sono le best practice della Panoramica, senza grafico né «da
 * stimare»; «Da costruire» non filtra, e il vecchio chip «N da stimare» (`stima`) apre la matrice.
 */
function legacyPriority(p: Pick<HubParams, "tipo" | "mostra" | "stima">): Pick<HubParams, "tipo" | "mostra" | "stima"> {
  if (p.tipo === "diffondere") return { tipo: "diffondere", mostra: null, stima: null };
  return { tipo: null, mostra: isHubChart(p.mostra) ? p.mostra : p.stima ? "matrice" : null, stima: p.stima };
}

/**
 * I parametri della pagina, per chi guarda (§4.2, §4.7, §4.10, §11). Restano solo le chiavi
 * di `HUB_PARAM_KEYS`, con valori dell'elenco; ogni altro parametro (anche sul proponente) si
 * ignora. I vecchi nomi delle viste valgono la Panoramica (`HUB_VIEW_ALIASES`), quelli di
 * «Priorità» con `legacyPriority`. «Agente» è il prefisso del titolo (`parseAgentParam`), mai una
 * persona. Ai contributori restano la vista (non «Cosa serve»), la ricerca, `apri` e le ricevute,
 * senza «Agente»; il pannello rapido (`nuovo=1`) solo a chi lo apre (Lateral Space).
 */
export function parseHubParams(raw: RawHubParams, viewer: UseCaseViewer): HubParams {
  const abilities = abilitiesForUseCase(viewer);
  const filters = abilities.canUseAllFilters;
  const rawVista = readParam(raw, "vista");
  let vista = viewOf(rawVista);
  if (vista === "cosa-serve" && !abilities.canSeeNeeds) vista = null;
  const trimestreRaw = readParam(raw, "trimestre");
  const trimestre = trimestreRaw === LATER_QUARTER_PARAM ? LATER_QUARTER_PARAM : isQuarterCode(trimestreRaw) ? trimestreRaw : null;
  const apri = readParam(raw, "apri");
  const created = readParam(raw, "created");
  let tipo = filters ? oneOf(HUB_KIND_PARAMS, readParam(raw, "tipo")) : null;
  let mostra = filters ? oneOf(HUB_SHOW_PARAMS, readParam(raw, "mostra")) : null;
  let stima = filters ? oneOf(HUB_ESTIMATE_PARAMS, readParam(raw, "stima")) : null;
  if (rawVista === "priorita") ({ tipo, mostra, stima } = legacyPriority({ tipo, mostra, stima }));
  return {
    vista,
    tipo,
    mostra,
    origine: filters ? oneOf(ORIGINS, readParam(raw, "origine")) : null,
    q: boundedText(readParam(raw, "q"), SEARCH_MIN, SEARCH_MAX),
    canale: filters ? oneOf(USE_CASE_SOURCES, readParam(raw, "canale")) : null,
    area: filters ? boundedText(readParam(raw, "area"), 1, AREA_MAX) : null,
    agente: filters ? parseAgentParam(readParam(raw, "agente")) : null,
    lab: filters ? boundedText(readParam(raw, "lab"), 1, LAB_MAX) : null,
    trimestre: filters ? trimestre : null,
    stima,
    info: filters && abilities.canSeeNeeds ? parseInfoParam(readParam(raw, "info")) : null,
    apri: apri !== null && UUID.test(apri) ? apri.toLowerCase() : null,
    nuovo: abilities.newUseCase === "pannello_rapido" && readParam(raw, "nuovo") === "1",
    thanks: readParam(raw, "thanks") === "1",
    created: created !== null && UUID.test(created) ? created.toLowerCase() : null,
    joined: oneOf(JOINED_VALUES, readParam(raw, "joined")),
  };
}

/**
 * Ci sono filtri attivi («Togli i filtri», §4.7)? La vista, `apri` e le ricevute non sono
 * filtri. Sulle due matrici del menu «⋯» (solo «Da costruire») il tipo non vale: la pagina
 * passa `ignoreKind`, come ad `applyHubFilters`. Altrove il tipo è un filtro.
 */
export function hasActiveFilters(params: HubParams, opts: { ignoreKind?: boolean } = {}): boolean {
  return Boolean(
    (params.tipo && !opts.ignoreKind) ||
      params.origine ||
      params.q ||
      params.canale ||
      params.area ||
      params.agente ||
      params.lab ||
      params.trimestre ||
      params.stima ||
      params.info,
  );
}

/**
 * Vista di partenza quando `vista` manca (§4.2): Lateral Space e revisori del cliente «Da
 * decidere» se c'è qualcosa da decidere, altrimenti la Panoramica; uno sponsor del cliente
 * (`exec_sponsor` che non è di Lateral Space) e i contributori la Panoramica. «Cosa serve» non
 * è mai la vista di partenza.
 */
export function defaultHubView(viewer: UseCaseViewer, decideCount: number): HubView {
  const abilities = abilitiesForUseCase(viewer);
  if (!abilities.isReviewer) return "panoramica";
  if (viewer.role === "exec_sponsor" && !abilities.isLateralSpace) return "panoramica";
  return decideCount > 0 ? "da-decidere" : "panoramica";
}

/**
 * Il grafico del menu «⋯» che la Panoramica apre al posto delle corsie. `matrice` sempre (senza
 * use case da mettere in ordine la pagina dice «Nessuno use case da mettere in ordine»);
 * `benefici` solo se il menu lo offre, altrimenti la matrice (un vecchio link senza «Benefici e
 * costi»); `curva` solo se il menu la offre, altrimenti le corsie. Senza grafico (o con `agenti`): null.
 */
export function shownChart(mostra: HubShowParam | null, charts: readonly HubChartParam[]): HubChartParam | null {
  if (mostra === "matrice") return "matrice";
  if (mostra === "benefici") return charts.includes("benefici") ? "benefici" : "matrice";
  if (mostra === "curva") return charts.includes("curva") ? "curva" : null;
  return null;
}

// ═══ Proiezione dei revisori (§4.6, §4.8, §6, §7) ════════════════════

/** Il riepilogo minimo del dossier («In realizzazione» della Panoramica; il ricco arriva in H6a). */
export interface HubDossier {
  caseId: string;
  code: string;
  status: CaseStatus;
  /** «0 di 245 indispensabili a posto», dalla cache `uc_cases.readiness`; null senza cache. */
  readiness: { required: number; ok: number } | null;
}

/** Lo use case come lo ricevono i revisori nella lista: niente proponente (§11). */
export interface HubItem {
  id: string;
  code: string | null;
  title: string;
  origin: Origin;
  kind: UseCaseKind;
  phase: Phase;
  subState: SubState;
  /** La pillola dei revisori, es. «Chiuso · Doppione di XX-0007». */
  phaseLabel: string;
  tone: PhaseTone;
  /** «T1 2027» o «Più avanti» in fase «Approvato»; altrimenti null. */
  quando: string | null;
  targetQuarter: QuarterCode | null;
  reviewBy: IsoDate | null;
  value: ValueFigure;
  /** null: «da stimare». Con le fasce del workspace (`bandLabel`). */
  cost: CostFigure | null;
  zone: Zone | null;
  /** «Benefici e costi» (`value_model`), se valido: solo per i revisori (grafici, editor, «Cosa serve»). */
  valueModel: ValueModel | null;
  risks: RiskChip[];
  /** Stima di Claude, non ufficiale (§7.5): ore all'anno, alle decine; null senza dati. */
  claudeHoursPerYear: number | null;
  /** `use_cases.source` (canale, §4.7). */
  source: string | null;
  area: string | null;
  aiLab: string | null;
  hiddenFromSearch: boolean;
  publicNote: string | null;
  /**
   * Chi ha proposto ha risposto a «Serve info» e nessuno ha ancora deciso (D17, `isAnswerPending`):
   * la riga dice «Risposta ricevuta» al posto di «Nuova» e i dialoghi delle decisioni propongono di
   * aggiornare la nota pubblica, che è ancora la domanda.
   */
  answered: boolean;
  /** Il problema per il pannello (due righe), al massimo `PROBLEM_PREVIEW_MAX` caratteri. */
  problemPreview: string | null;
  /** Giorno di arrivo a Roma: `coalesce(submitted_at, created_at)`. */
  arrivedOn: IsoDate;
  /** Da quando aspetta una risposta (D8): ultimo «Riapri», poi arrivo; «Da rivedere» dalla data di revisione. */
  waitingSince: IsoDate;
  /**
   * Il mese di «Realizzati»: ultimo passaggio a «Realizzato» nella Storia; per le schede
   * realizzate prima della Storia, l'ultimo cambio di stato. null fuori da «Realizzato».
   */
  realizedOn: IsoDate | null;
  dossier: HubDossier | null;
  version: number;
}

/** Le colonne della scheda che servono alla proiezione dei revisori: nessuna sul proponente. */
export type HubSourceRow = Pick<
  UseCase,
  | "id"
  | "code"
  | "title"
  | "description"
  | "origin"
  | "portfolioKind"
  | "status"
  | "portfolioReviewStatus"
  | "reviewedBy"
  | "publicNote"
  | "intake"
  | "reviewBy"
  | "targetQuarter"
  | "customScores"
  | "aiSuggestion"
  | "valueEurYear"
  | "costEurOnce"
  | "costBand"
  | "source"
  | "aiLab"
  | "submittedAt"
  | "createdAt"
  | "statusChangedAt"
  | "version"
  | keyof LegacyScoreColumns
> & {
  /** `value_model`: la lista lo legge solo per i revisori (assente o null: nessun modello). */
  valueModel?: unknown;
  /** Giorno (Roma) dell'ultimo «Riapri», letto dalla Storia nella stessa query. */
  reopenedOn?: string | null;
  /** Giorno (Roma) dell'ultimo passaggio a «Realizzato», letto dalla Storia. */
  realizedOn?: string | null;
};

/** Il modello e il giorno con cui si proietta una scheda. */
export interface HubContext {
  model: ValuationModel;
  esgEnabled: boolean;
  /** Oggi, `AAAA-MM-GG` a Roma. */
  today: string;
  /**
   * Le ipotesi di calcolo del workspace (`resolveValueParams`, `config.valueParams`). Assenti:
   * le predefinite, con il mese di oggi come origine (`hubValueParams`).
   */
  valueParams?: ValueParams;
}

/** Le ipotesi del contesto, oppure le predefinite con il mese di oggi come origine. */
export function hubValueParams(ctx: Pick<HubContext, "valueParams" | "today">): ValueParams {
  return ctx.valueParams ?? { ...DEFAULT_VALUE_PARAMS, originMonth: ctx.today.slice(0, 7) as MonthCode };
}

/** Il problema nel pannello: due righe bastano. */
export const PROBLEM_PREVIEW_MAX = 280;

/** Le colonne che la fase legge, dalla riga e dal dossier (§3.5). */
export function phaseInputOf(
  row: Pick<UseCase, "status" | "portfolioReviewStatus" | "reviewedBy" | "publicNote" | "intake" | "reviewBy" | "portfolioKind" | "targetQuarter">,
  dossier: Pick<HubDossier, "code" | "status"> | null,
  today: string,
): PhaseInput {
  const intake = row.intake ?? null;
  return {
    status: row.status,
    portfolioReviewStatus: row.portfolioReviewStatus,
    reviewedBy: row.reviewedBy,
    publicNote: row.publicNote,
    intake: intake as PhaseInput["intake"],
    reviewBy: row.reviewBy,
    linkedCaseCode: dossier?.code ?? null,
    portfolioKind: row.portfolioKind,
    targetQuarter: row.targetQuarter,
    dossierStatus: dossier?.status ?? null,
    duplicateOfCode: typeof intake?.duplicateOfCode === "string" ? intake.duplicateOfCode : null,
    today,
  };
}

/** La riga da cui nasce la proiezione del contributore: colonne della fase, id, titolo, codice, e `ProposalRow`. */
export type ContributorRow = Parameters<typeof phaseInputOf>[0] & ProposalRow & Pick<UseCase, "id" | "title" | "code">;

/**
 * La proiezione del contributore di una riga del database (D4, D13, §11), con la fase
 * calcolata col suo dossier: `projectForContributor` decide cosa è proprio e cosa è
 * nascosto. null se il contributore non la vede (nascosta alla ricerca e non sua).
 */
export function projectContributorRow(
  viewer: ProposalOwner,
  row: ContributorRow,
  dossier: Pick<HubDossier, "code" | "status"> | null,
  today: string,
): ContributorUseCase | null {
  return projectForContributor(viewer, { ...row, ...phaseInputOf(row, dossier, today) });
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** Il giorno a Roma di un istante; `AAAA-MM-GG` già pronto passa com'è. */
export function romeDay(value: Date | string | null | undefined): IsoDate | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    const day = value.trim().slice(0, 10);
    if (value.trim().length === 10) return parseIsoDate(day) ? (day as IsoDate) : null;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : romeToday(parsed);
  }
  return Number.isNaN(value.getTime()) ? null : romeToday(value);
}

function dateOnly(value: string | null | undefined): IsoDate | null {
  if (typeof value !== "string") return null;
  const day = value.trim().slice(0, 10);
  return parseIsoDate(day) ? (day as IsoDate) : null;
}

/**
 * Da quando uno use case aspetta una risposta (D8, §4.3): per «Da rivedere» dalla data di
 * revisione; altrimenti dall'ultimo «Riapri», se c'è, o dall'arrivo. Non guarda mai l'ultimo
 * cambio di stato.
 */
export function waitingStart(i: {
  subState: SubState | null;
  reviewBy: string | null | undefined;
  reopenedOn: string | null | undefined;
  arrivedOn: string;
}): IsoDate {
  const review = dateOnly(i.reviewBy);
  if (i.subState === "da_rivedere" && review) return review;
  return dateOnly(i.reopenedOn) ?? (dateOnly(i.arrivedOn) as IsoDate);
}

function dayNumber(day: string): number {
  const parsed = parseIsoDate(day);
  if (!parsed) throw new RangeError(`Data non valida: ${day}`);
  return Date.UTC(parsed.year, parsed.month - 1, parsed.day) / 86_400_000;
}

/** Giorni di attesa fino a oggi (mai negativi). */
export function waitingDays(since: string, today: string): number {
  return Math.max(0, Math.round(dayNumber(today) - dayNumber(since)));
}

/** «oggi», «da 1 giorno», «da 6 giorni» (§4.3, §14.3). Nessuna soglia, nessun allarme. */
export function waitingLabel(days: number): string {
  if (days <= 0) return "oggi";
  return days === 1 ? "da 1 giorno" : `da ${days} giorni`;
}

/** Le volte all'anno di ogni frequenza del connettore, per la stima di Claude (§7.5). */
export const RUNS_PER_YEAR: Readonly<Record<string, number>> = Object.freeze({
  giornaliera: 240,
  settimanale: 48,
  mensile: 12,
  trimestrale: 4,
  una_tantum: 1,
});

/**
 * Stima di Claude, non ufficiale (§7.5): minuti × volte all'anno × persone / 60, arrotondata
 * alle decine. null se manca un dato o se le ore sono zero (lo zero non si mostra); una stima
 * piccola ma vera non scende sotto 10, così non diventa mai «circa 0 ore all'anno». Non entra
 * in nessun totale né nella matrice: in una corsia della Panoramica decide solo tra due best
 * practice a pari Valore (`lanes.ts`); la mostrano il pannello laterale e il MCP del team.
 */
export function claudeHoursPerYear(intake: unknown): number | null {
  const data = record(intake);
  if (!data) return null;
  const minutes = data.timeSavedMinutesPerRun;
  const people = data.beneficiaries;
  const runs = typeof data.frequency === "string" && Object.prototype.hasOwnProperty.call(RUNS_PER_YEAR, data.frequency) ? RUNS_PER_YEAR[data.frequency] : null;
  if (typeof minutes !== "number" || !Number.isFinite(minutes) || minutes < 0) return null;
  if (typeof people !== "number" || !Number.isFinite(people) || people < 0) return null;
  if (runs === null) return null;
  const hours = (minutes * runs * people) / 60;
  if (!Number.isFinite(hours) || hours <= 0) return null;
  return Math.max(10, Math.round(hours / 10) * 10);
}

function aiScoresOf(aiSuggestion: unknown): KpiScoreMap | null {
  const scores = record(record(aiSuggestion)?.scores);
  return scores ? (scores as KpiScoreMap) : null;
}

function preview(text: string | null): string | null {
  if (text === null) return null;
  const flat = text.trim().replace(/\s+/g, " ");
  const chars = [...flat];
  if (chars.length <= PROBLEM_PREVIEW_MAX) return flat;
  const cut = chars.slice(0, PROBLEM_PREVIEW_MAX - 1).join("");
  const space = cut.lastIndexOf(" ");
  return `${(space > PROBLEM_PREVIEW_MAX / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/**
 * Lo use case come lo vedono i revisori nella lista (§4.6, §4.8): fase, Valore, Costo con
 * la fonte, zona, rischio, stima di Claude, giorni di attesa e riepilogo del dossier. Il
 * proponente non c'è: la riga in ingresso non lo porta (`HubSourceRow`).
 */
export function projectHubItem(row: HubSourceRow, ctx: HubContext, dossier: HubDossier | null): HubItem {
  const phase = phaseOfUseCase(phaseInputOf(row, dossier, ctx.today));
  const customScores = (row.customScores ?? null) as KpiScoreMap | null;
  const aiScores = aiScoresOf(row.aiSuggestion);
  const legacy: LegacyScoreColumns = {
    impactEconomic: row.impactEconomic,
    impactTime: row.impactTime,
    impactQuality: row.impactQuality,
    impactCoordination: row.impactCoordination,
    impactSocial: row.impactSocial,
    feasibilityData: row.feasibilityData,
    feasibilityWorkflow: row.feasibilityWorkflow,
    feasibilityRisk: row.feasibilityRisk,
    feasibilityTech: row.feasibilityTech,
    feasibilityTeam: row.feasibilityTeam,
    esgEnvironmental: row.esgEnvironmental,
    esgSocial: row.esgSocial,
    esgGovernance: row.esgGovernance,
  };
  // Il dossier come fonte di Valore e Costo (ROI) lo legge H6a: qui non c'è ancora.
  const valueModel = parseValueModel(row.valueModel);
  const estimate = valueModel ? modelEstimate(valueModel, hubValueParams(ctx), ctx.model) : null;
  const value = valueFigure({ ...legacy, customScores, aiScores, valueEurYear: row.valueEurYear, estimate }, ctx.model, { esgEnabled: ctx.esgEnabled });
  const cost = costFigure({ customScores, aiScores, costEurOnce: row.costEurOnce, costBand: row.costBand, estimate }, ctx.model);
  const intake = record(row.intake);
  const arrivedOn = romeDay(row.submittedAt ?? row.createdAt) ?? (ctx.today as IsoDate);
  const reviewBy = dateOnly(row.reviewBy);
  return {
    id: row.id,
    code: row.code ?? null,
    title: row.title,
    origin: row.origin === "transformation" ? "transformation" : "adoption",
    kind: kindOf(row.portfolioKind),
    phase: phase.phase,
    subState: phase.subState,
    phaseLabel: phase.label,
    tone: phase.tone,
    quando: phase.phase === "approvato" ? phase.subStateLabel : null,
    targetQuarter: isQuarterCode(row.targetQuarter) ? row.targetQuarter : null,
    reviewBy,
    value,
    cost,
    zone: zoneOf(value, cost, ctx.model),
    valueModel,
    risks: riskChips(intake),
    claudeHoursPerYear: claudeHoursPerYear(intake),
    source: row.source ?? null,
    area: textOrNull(intake?.area),
    aiLab: textOrNull(row.aiLab),
    hiddenFromSearch: isHiddenFromSearch(intake),
    publicNote: textOrNull(row.publicNote),
    answered: isAnswerPending({ intake, phase: phase.phase, subState: phase.subState }),
    problemPreview: preview(textOrNull(row.description)),
    arrivedOn,
    waitingSince: waitingStart({ subState: phase.subState, reviewBy, reopenedOn: row.reopenedOn, arrivedOn }),
    // Solo per il mese di «Realizzati»: i giorni di attesa non guardano mai l'ultimo cambio di stato.
    realizedOn: phase.phase === "realizzato" ? (dateOnly(row.realizedOn) ?? romeDay(row.statusChangedAt)) : null,
    dossier,
    version: row.version,
  };
}

// ─── Scheda dei revisori (§6) ────────────────────────────────────────

/**
 * Le chiavi di `intake` che i revisori ricevono: i dati raccolti dal connettore e i campi
 * tecnici dell'area. Ogni altra chiave, anche futura, resta fuori: così non arriva mai un
 * recapito di chi ha proposto (è nella proiezione di chi gestisce il workspace).
 */
export const REVIEWER_INTAKE_KEYS = [
  "contractVersion",
  "guideVersion",
  "area",
  "company",
  "tools",
  "toolsOther",
  "frequency",
  "beneficiaries",
  "timeSavedMinutesPerRun",
  "valuePerRunEur",
  "qualityGain",
  "developmentStatus",
  "proposerEstimate",
  "flags",
  "relatedAgent",
  "relatedCode",
  "relationType",
  "promptSnippet",
  "sourceConversation",
  "possibleDuplicateOf",
  "hiddenFromSearch",
  "archiveReason",
  "duplicateOfCode",
  // Le risposte di chi ha proposto a «Serve info» (D17): data e testo, mai chi le ha scritte.
  "risposte",
] as const;

/** `intake` con le sole chiavi di `REVIEWER_INTAKE_KEYS`; null se non ce n'è nessuna. */
export function reviewerIntake(intake: unknown): Record<string, unknown> | null {
  const data = record(intake);
  if (!data) return null;
  const out: Record<string, unknown> = {};
  for (const key of REVIEWER_INTAKE_KEYS) if (Object.prototype.hasOwnProperty.call(data, key)) out[key] = data[key];
  return Object.keys(out).length ? out : null;
}

/** Il suggerimento dell'AI come lo legge la scheda: punteggi e motivazione, senza la copia della v1. */
export interface HubAiSuggestion {
  scores: KpiScoreMap | null;
  rationale: string | null;
  model: string | null;
  at: string | null;
  kind: string | null;
}

/** La scheda per i revisori (§6.2-6.5): la riga della lista, i testi e la valutazione. */
export interface UseCaseDetail extends HubItem {
  description: string | null;
  flowDescription: string | null;
  humanInTheLoop: string | null;
  guardrails: string | null;
  businessCase: string | null;
  dataRequirements: string | null;
  sustainabilityImpact: string | null;
  /** Dati raccolti da Claude e campi tecnici (`REVIEWER_INTAKE_KEYS`). */
  intake: Record<string, unknown> | null;
  /** «Possibile doppione di» (`intake.possibleDuplicateOf`). */
  possibleDuplicateOf: string | null;
  customScores: KpiScoreMap | null;
  aiSuggestion: HubAiSuggestion | null;
  valueEurYear: number | null;
  costEurOnce: number | null;
  costBand: CostBand | null;
  /** Note del revisore (note interne). */
  reviewNotes: string | null;
  /** «Urgenza». */
  timeline: string | null;
  requirements: string[] | null;
  dataDependencies: string[] | null;
}

export type DetailSourceRow = HubSourceRow &
  Pick<
    UseCase,
    | "flowDescription"
    | "humanInTheLoop"
    | "guardrails"
    | "businessCase"
    | "dataRequirements"
    | "sustainabilityImpact"
    | "reviewNotes"
    | "timeline"
    | "requirements"
    | "dataDependencies"
  >;

function stringList(value: unknown): string[] | null {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : null;
}

/** La scheda dei revisori. Come la lista, senza il proponente. */
export function projectUseCaseDetail(row: DetailSourceRow, ctx: HubContext, dossier: HubDossier | null): UseCaseDetail {
  const ai = record(row.aiSuggestion);
  return {
    ...projectHubItem(row, ctx, dossier),
    description: row.description ?? null,
    flowDescription: row.flowDescription ?? null,
    humanInTheLoop: row.humanInTheLoop ?? null,
    guardrails: row.guardrails ?? null,
    businessCase: row.businessCase ?? null,
    dataRequirements: row.dataRequirements ?? null,
    sustainabilityImpact: row.sustainabilityImpact ?? null,
    intake: reviewerIntake(row.intake),
    possibleDuplicateOf: textOrNull(record(row.intake)?.possibleDuplicateOf),
    customScores: (row.customScores ?? null) as KpiScoreMap | null,
    aiSuggestion: ai
      ? {
          scores: aiScoresOf(ai),
          rationale: textOrNull(ai.rationale),
          model: textOrNull(ai.model),
          at: textOrNull(ai.at),
          kind: textOrNull(ai.kind),
        }
      : null,
    valueEurYear: row.valueEurYear ?? null,
    costEurOnce: row.costEurOnce ?? null,
    costBand: isCostBand(row.costBand) ? row.costBand : null,
    reviewNotes: row.reviewNotes ?? null,
    timeline: textOrNull(row.timeline),
    requirements: stringList(row.requirements),
    dataDependencies: stringList(row.dataDependencies),
  };
}

// ═══ Ricerca e filtri (§4.7) ═════════════════════════════════════════

/** Una riga che la pagina mostra: revisori o contributori. */
export type AnyHubItem = HubItem | ContributorUseCase;

/** È la proiezione di un contributore? Solo lei ha `own`. */
export function isContributorItem(item: AnyHubItem): item is ContributorUseCase {
  return Object.prototype.hasOwnProperty.call(item, "own");
}

function fold(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("it-IT");
}

/**
 * La ricerca (§4.7): i revisori su titolo e codice; i contributori sul titolo e, solo per
 * le proprie proposte, sul codice. Il codice di una proposta altrui non trova nulla.
 */
export function matchesSearch(item: AnyHubItem, q: string | null): boolean {
  if (q === null) return true;
  const needle = fold(q.trim());
  if (!needle) return true;
  if (fold(item.title).includes(needle)) return true;
  const code = isContributorItem(item) ? (item.own ? item.code : null) : item.code;
  return typeof code === "string" && fold(code).includes(needle);
}

/**
 * Senza Valore o senza Costo: «da stimare» (`stima=mancante`, l'elenco «N da stimare» sotto la matrice). Una scheda
 * con «Benefici e costi» non è mai da stimare, anche senza beneficio contato o senza costi.
 */
export function isToEstimate(item: Pick<HubItem, "value" | "cost">): boolean {
  if (item.value.benefits) return false;
  return item.value.score === null || item.cost === null;
}

/**
 * Una scheda con «Benefici e costi» che non ha un punto nella matrice Valore × Costo: senza
 * beneficio contato (Valore «qualitativo» o «da misurare») o senza costo. Non è «da stimare»
 * (`isToEstimate`), ma la matrice la mette a parte (l'elenco «N senza beneficio contato»), così non
 * sparisce; altrove `stima=fuori-matrice` la filtra.
 */
export function isOffMatrix(item: Pick<HubItem, "value" | "cost">): boolean {
  return Boolean(item.value.benefits) && (item.value.score === null || item.cost === null);
}

/**
 * I filtri della pagina. I contributori hanno solo la ricerca; i revisori anche origine,
 * tipo (non sulle due matrici del menu «⋯», che sono solo «Da costruire»: lì la pagina passa
 * `ignoreKind`), canale, area, agente (il prefisso del titolo, o «altri» senza: `agentParamOf`),
 * AI Lab, trimestre e «da stimare». Nessun filtro per persona.
 */
export function applyHubFilters<T extends AnyHubItem>(
  items: readonly T[],
  params: HubParams,
  opts: { ignoreKind?: boolean; infoOf?: (id: string) => InfoProgressState | null } = {},
): T[] {
  return items.filter((item) => {
    if (!matchesSearch(item, params.q)) return false;
    if (isContributorItem(item)) return true;
    if (params.origine && item.origin !== params.origine) return false;
    if (params.tipo && !opts.ignoreKind && item.kind !== (params.tipo === "diffondere" ? "da_diffondere" : "da_costruire")) return false;
    if (params.canale && (item.source ?? "activity_mapping") !== params.canale) return false;
    if (params.area && (item.area === null || fold(item.area) !== fold(params.area))) return false;
    if (params.agente && agentParamOf(item.title) !== params.agente) return false;
    if (params.lab && (item.aiLab === null || fold(item.aiLab) !== fold(params.lab))) return false;
    if (params.trimestre) {
      if (item.phase !== "approvato") return false;
      if (params.trimestre === LATER_QUARTER_PARAM ? item.targetQuarter !== null : item.targetQuarter !== params.trimestre) return false;
    }
    if (params.stima === "mancante" && !isToEstimate(item)) return false;
    if (params.stima === "fuori-matrice" && !isOffMatrix(item)) return false;
    if (params.info && (opts.infoOf?.(item.id) ?? null) !== params.info) return false;
    return true;
  });
}

// ═══ «Da decidere» (§4.3) ════════════════════════════════════════════

/** I sotto-stati di «Da decidere»: le «Rimandate» solo quando la data è arrivata («Da rivedere»). */
export const DECIDE_SUB_STATES: readonly SubState[] = Object.freeze(["nuova", "possibile_doppione", "valutata", "da_rivedere", "serve_info"]);

/**
 * In «Da decidere»: per i revisori i sotto-stati di `DECIDE_SUB_STATES`; per i contributori
 * («In valutazione») tutta la fase «Da valutare», perché delle proposte altrui non ricevono il
 * sotto-stato.
 */
export function isToDecide(item: Pick<AnyHubItem, "phase" | "subState"> | AnyHubItem): boolean {
  if (item.phase !== "da_valutare") return false;
  if ("own" in item) return true;
  return item.subState !== null && DECIDE_SUB_STATES.includes(item.subState);
}

export interface DecideList<T> {
  /** Prima chi aspetta da più giorni. */
  waiting: T[];
  /** Sotto il divisore «In attesa di risposta»: aspettano chi ha proposto, non il team. */
  needInfo: T[];
  /** «Da decidere 8»: tutto tranne «Serve info» (§1.2 punto 2). */
  count: number;
}

/** L'ordine del server e di «Da decidere»: chi aspetta da più giorni prima. */
export function compareWaiting(a: HubItem, b: HubItem): number {
  return a.waitingSince.localeCompare(b.waitingSince) || a.arrivedOn.localeCompare(b.arrivedOn) || (a.code ?? "").localeCompare(b.code ?? "") || a.id.localeCompare(b.id);
}

/**
 * La vista «Da decidere». Per i revisori l'ordine è dai giorni di attesa, dal più alto, con le
 * «Serve info» sotto il divisore. I contributori («In valutazione») non hanno date né divisore:
 * tutta la fase «Da valutare», nell'ordine in cui il server la manda (lo stesso). Nessun ordine
 * per proponente, nemmeno «le proprie prima» (§4.7, §11; art. 15.4): le proprie in «Serve info»
 * le porta avanti l'avviso sopra la lista.
 */
export function buildDecideList<T extends AnyHubItem>(items: readonly T[]): DecideList<T> {
  const sorted = items.filter(isToDecide);
  if (sorted.some(isContributorItem)) return { waiting: sorted, needInfo: [], count: 0 };
  (sorted as unknown as HubItem[]).sort(compareWaiting);
  const waiting = sorted.filter((item) => item.subState !== "serve_info");
  const needInfo = sorted.filter((item) => item.subState === "serve_info");
  return { waiting, needInfo, count: waiting.length };
}

/** Il numero di «Da decidere N» (senza «Serve info»). I contributori non hanno contatore: zero. */
export function decideCount(items: readonly AnyHubItem[]): number {
  return items.filter((item) => !isContributorItem(item) && isToDecide(item) && item.subState !== "serve_info").length;
}

// ═══ La matrice Valore × Costo (menu «⋯») ════════════════════════════

/** Un punto della matrice Valore × Costo di realizzazione. */
export interface PriorityPoint {
  id: string;
  code: string | null;
  title: string;
  origin: Origin;
  /** Pieno se approvato, vuoto se da decidere. */
  approved: boolean;
  /** Posizione del costo, da 0,5 a 5,5 sulla scala delle fasce del workspace. */
  x: number;
  /** Valore, da 1 a 5. */
  y: number;
  zone: Zone | null;
}

/** «Matrice Valore × Costo» del menu «⋯» (§4.4): i punti e, sotto, i due elenchi chiusi. */
export interface PriorityMatrix {
  /** Gli use case con un punteggio del Valore e un Costo. */
  points: PriorityPoint[];
  /** Zona, poi Valore decrescente, poi Costo crescente; «da stimare» in fondo. */
  list: HubItem[];
  /** Gli use case «da stimare» (`isToEstimate`), nell'ordine di `list`: l'elenco «N da stimare». */
  toEstimate: HubItem[];
  /**
   * Le schede con «Benefici e costi» che non hanno un punto (`isOffMatrix`), nell'ordine di `list`:
   * l'elenco «N senza beneficio contato»; `withoutBenefit` quante perché manca il beneficio contato
   * (le altre: il costo).
   */
  offMatrix: { items: HubItem[]; withoutBenefit: number };
}

/** Chi entra nella matrice Valore × Costo: «Da costruire» in «Da valutare» (non le «Rimandate» in attesa) o «Approvato». */
export function isPriorityCandidate(item: Pick<HubItem, "kind" | "phase" | "subState">): boolean {
  if (item.kind !== "da_costruire") return false;
  if (item.phase === "approvato") return true;
  return item.phase === "da_valutare" && item.subState !== "rimandata";
}

function zoneRank(zone: Zone | null): number {
  return zone === null ? ZONES.length : ZONES.indexOf(zone);
}

function byTitle(a: { title: string; id: string }, b: { title: string; id: string }): number {
  return a.title.localeCompare(b.title, "it-IT") || a.id.localeCompare(b.id);
}

function byPriority(a: HubItem, b: HubItem): number {
  const estimate = Number(isToEstimate(a)) - Number(isToEstimate(b));
  if (estimate) return estimate;
  return (
    zoneRank(a.zone) - zoneRank(b.zone) ||
    (b.value.score ?? -Infinity) - (a.value.score ?? -Infinity) ||
    (a.cost?.position ?? Infinity) - (b.cost?.position ?? Infinity) ||
    (a.cost?.referenceEur ?? Infinity) - (b.cost?.referenceEur ?? Infinity) ||
    byTitle(a, b)
  );
}

/** La matrice Valore × Costo del menu «⋯», sugli use case «Da costruire» (`isPriorityCandidate`). Solo revisori. */
export function buildPriority(items: readonly HubItem[]): PriorityMatrix {
  const list = items.filter(isPriorityCandidate).sort(byPriority);
  const points: PriorityPoint[] = [];
  for (const item of list) {
    // Un modello senza beneficio contato (o senza costo) non è da stimare e non ha un punto qui:
    // sta nell'elenco «N senza beneficio contato» (`isOffMatrix`).
    if (item.value.score === null || item.cost === null) continue;
    points.push({
      id: item.id,
      code: item.code,
      title: item.title,
      origin: item.origin,
      approved: item.phase === "approvato",
      x: item.cost.position,
      y: Math.min(5, Math.max(1, item.value.score)),
      zone: item.zone,
    });
  }
  const off = list.filter(isOffMatrix);
  return {
    points,
    list,
    toEstimate: list.filter(isToEstimate),
    offMatrix: { items: off, withoutBenefit: off.filter((item) => item.value.score === null).length },
  };
}

/** «5 da stimare». */
export function toEstimateLabel(count: number): string {
  return `${count} da stimare`;
}

/** «2 senza beneficio contato», oppure «3 senza beneficio contato o costo» se a qualcuna manca il costo. */
export function offMatrixLabel(offMatrix: { count: number; withoutBenefit: number }): string {
  return offMatrix.withoutBenefit === offMatrix.count ? `${offMatrix.count} senza beneficio contato` : `${offMatrix.count} senza beneficio contato o costo`;
}

// ═══ Trimestri (§4.5) ════════════════════════════════════════════════

/**
 * Il posto del trimestre di uno use case approvato rispetto a oggi: lo leggono le corsie e la testa
 * della Panoramica (`lanes.ts`, `panoramica.ts`), «Scaduto» e il «quando» delle bolle nelle due
 * matrici del menu «⋯», il riepilogo in campanella.
 */
export type RoadmapGroupKey = "scaduti" | "questo_trimestre" | "prossimo_trimestre" | QuarterCode | "piu_avanti";

export const EXPIRED_TAG = "Scaduto";

const QUARTER_LABEL = /^T([1-4]) ([0-9]{4})$/;

/**
 * Il trimestre di uno use case approvato: dal dato per i revisori, dall'etichetta «T1 2027» per i
 * contributori. Lo usano anche le corsie della Panoramica (`lanes.ts`).
 */
export function quarterOfItem(item: AnyHubItem): QuarterCode | null {
  if (!isContributorItem(item)) return item.targetQuarter;
  const match = item.quando ? QUARTER_LABEL.exec(item.quando) : null;
  return match ? (`${match[2]}-Q${match[1]}` as QuarterCode) : null;
}

/** La chiave del gruppo di un trimestre rispetto a oggi. */
export function roadmapGroupKey(quarter: QuarterCode | null, today: string): RoadmapGroupKey {
  if (quarter === null) return "piu_avanti";
  const current = quarterOfDate(today);
  const diff = compareQuarters(quarter, current);
  if (diff < 0) return "scaduti";
  if (diff === 0) return "questo_trimestre";
  if (compareQuarters(quarter, nextQuarter(current)) === 0) return "prossimo_trimestre";
  return quarter;
}

/** L'etichetta di un gruppo («Questo trimestre · T4 2026»). */
export function roadmapGroupLabel(key: RoadmapGroupKey, today: string): string {
  const current = quarterOfDate(today);
  switch (key) {
    case "scaduti":
      return "Scaduti";
    case "questo_trimestre":
      return `Questo trimestre · ${quarterLabel(current)}`;
    case "prossimo_trimestre":
      return `Prossimo trimestre · ${quarterLabel(nextQuarter(current))}`;
    case "piu_avanti":
      return WHEN_LATER_LABEL;
    default:
      return quarterLabel(key);
  }
}

/** «Realizzati» della Panoramica (`lanes.ts`): dal più recente; i contributori per titolo. */
export function byRealizedDesc<T extends AnyHubItem>(a: T, b: T): number {
  if (!isContributorItem(a) && !isContributorItem(b)) {
    const ra = a.realizedOn ?? "";
    const rb = b.realizedOn ?? "";
    if (ra !== rb) return rb.localeCompare(ra);
  }
  return byTitle(a, b);
}

/** Una cifra in testa alla Panoramica (solo revisori, `overviewFigures` di `panoramica.ts`). */
export interface RoadmapTile {
  amountEur: number;
  /** Su quanti use case è calcolata (solo quelli con una cifra). */
  count: number;
  /** Quanti valgono come fascia (costo da fascia del team o da sforzo). */
  fromBand: number;
  /** Quota delle due origini sull'importo, in percentuale intera (somma 100). */
  share: Record<Origin, number>;
  /** «su 9 use case», «su 7 use case · 2 da fascia». */
  note: string;
}

export interface RoadmapTotals {
  /** «valore contato all'anno»: approvati e in realizzazione. null senza use case con una cifra. */
  expectedValue: RoadmapTile | null;
  /** «costo di avvio»: approvati «Da costruire» e in realizzazione. null senza use case con un costo. */
  committedCost: RoadmapTile | null;
}

/** «su 9 use case», «su 7 use case · 2 da fascia». Lo zero «da fascia» non si scrive. */
export function totalsNote(count: number, fromBand = 0): string {
  return fromBand > 0 ? `su ${count} use case · ${fromBand} da fascia` : `su ${count} use case`;
}

function shareOf(parts: Array<{ origin: Origin; amount: number }>): Record<Origin, number> {
  const total = parts.reduce((sum, part) => sum + part.amount, 0);
  const adoptionAmount = parts.filter((part) => part.origin === "adoption").reduce((sum, part) => sum + part.amount, 0);
  if (total > 0) {
    const adoption = Math.round((adoptionAmount / total) * 100);
    return { adoption, transformation: 100 - adoption };
  }
  const adoption = Math.round((parts.filter((part) => part.origin === "adoption").length / parts.length) * 100);
  return { adoption, transformation: 100 - adoption };
}

/**
 * Le cifre in testa alla Panoramica (§4.5; `overviewFigures` di `panoramica.ts`). «valore contato
 * all'anno»: somma sugli approvati e in realizzazione del miglior valore annuo (dossier, poi team).
 * «costo di avvio»: somma sugli approvati «Da costruire» e in realizzazione del costo di §7.2; una
 * fascia vale il suo riferimento nelle fasce del workspace, lo sforzo l'importo stimato. Una cifra
 * senza use case non si mostra. «Valore misurato» arriva con il ROI del dossier (H6a).
 */
export function roadmapTotals(items: readonly HubItem[]): RoadmapTotals {
  const value: Array<{ origin: Origin; amount: number }> = [];
  const cost: Array<{ origin: Origin; amount: number; fromBand: boolean }> = [];
  for (const item of items) {
    const upcoming = item.phase === "approvato";
    const inProgress = item.phase === "in_realizzazione";
    if (!upcoming && !inProgress) continue;
    if (item.value.perYear) value.push({ origin: item.origin, amount: item.value.perYear.amount });
    if (item.cost && (inProgress || item.kind === "da_costruire")) {
      cost.push({ origin: item.origin, amount: item.cost.referenceEur, fromBand: item.cost.fromBand });
    }
  }
  const expectedValue: RoadmapTile | null = value.length
    ? {
        amountEur: value.reduce((sum, part) => sum + part.amount, 0),
        count: value.length,
        fromBand: 0,
        share: shareOf(value),
        note: totalsNote(value.length),
      }
    : null;
  const fromBand = cost.filter((part) => part.fromBand).length;
  const committedCost: RoadmapTile | null = cost.length
    ? {
        amountEur: cost.reduce((sum, part) => sum + part.amount, 0),
        count: cost.length,
        fromBand,
        share: shareOf(cost),
        note: totalsNote(cost.length, fromBand),
      }
    : null;
  return { expectedValue, committedCost };
}

/** «fino a 23.400 €» in testa alla Panoramica (solo revisori). */
export interface PendingValueTotal {
  amountEur: number;
  /** Su quanti use case è calcolata (solo quelli con una parte da misurare). */
  count: number;
  /** «su 9 use case». */
  note: string;
}

/**
 * «valore da misurare all'anno» in testa alla Panoramica. Non è un conto nuovo: somma, sugli stessi
 * use case di «valore contato all'anno» (approvati e in realizzazione), i «fino a X €» delle card, cioè
 * gli euro delle voci da misurare di «Benefici e costi» (`value.benefits.pendingEur`), gli stessi
 * delle parti tratteggiate di «Valore per tipo di ritorno». null senza use case con una parte da
 * misurare, anche quando il workspace conta le voci da misurare (`includeUnmeasured`: lo zero).
 */
export function pendingValueTotal(items: readonly HubItem[]): PendingValueTotal | null {
  let amountEur = 0;
  let count = 0;
  for (const item of items) {
    if (item.phase !== "approvato" && item.phase !== "in_realizzazione") continue;
    const pending = item.value.benefits?.pendingEur ?? 0;
    if (!Number.isFinite(pending) || pending <= 0) continue;
    amountEur += pending;
    count += 1;
  }
  return count ? { amountEur, count, note: totalsNote(count) } : null;
}

// ═══ Export «Use case» (§4.1) ════════════════════════════════════════

export const EXPORT_SHEET_NAME = "Use case";

/**
 * Le colonne del foglio «Use case», nell'ordine di §4.1, con le cifre di «Benefici e costi»
 * accanto a Valore e costo (vuote senza modello). Nessuna sul proponente. Il foglio è solo dei
 * revisori: il modello e le sue cifre non arrivano a nessun altro.
 */
export const EXPORT_COLUMNS = [
  "Codice",
  "Titolo",
  "Origine",
  "Tipo",
  "Fase",
  "Quando",
  "Valore",
  "Punteggio",
  "Fonte del valore",
  "Valore all'anno",
  "Ritorno principale",
  "Ore all'anno",
  "Da misurare all'anno",
  "Costo",
  "Fascia",
  "Fonte del costo",
  "Ricorrenti all'anno",
  "Facilità",
  "Zona",
  "AI Lab",
  "Canale",
  "Area",
  "Mese di arrivo",
  "Nota pubblica",
  "Problema",
  "Come funziona",
  "Chi controlla",
  "Limiti",
  "Dati",
] as const;
export type ExportColumn = (typeof EXPORT_COLUMNS)[number];
export type ExportRow = Record<ExportColumn, string | number | null>;

/** I testi lunghi della scheda che il foglio riporta per intero. */
export type ExportTexts = Pick<UseCaseDetail, "description" | "flowDescription" | "humanInTheLoop" | "guardrails" | "dataRequirements">;

const MONTH_YEAR = new Intl.DateTimeFormat("it-IT", { timeZone: "UTC", month: "short", year: "numeric" });

/** «ott 2026». */
export function monthLabel(day: string): string {
  const parsed = parseIsoDate(day);
  return parsed ? MONTH_YEAR.format(new Date(Date.UTC(parsed.year, parsed.month - 1, 1))) : "";
}

/** «€€ · Da 25.000 a 65.000 €»: simbolo ed etichetta della fascia nelle fasce del workspace. */
export function bandText(cost: CostFigure, bands: readonly CostBandInfo[] = COST_BANDS): string {
  const info = costBandInfo(cost.band, bands);
  return `${info.symbol} · ${cost.bandLabel ?? info.label}`;
}

/** Un importo del foglio al centesimo: i conti di «Benefici e costi» non portano code di virgola mobile. */
function cents(amount: number | null | undefined): number | null {
  return typeof amount === "number" && Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
}

/**
 * Una riga del foglio «Use case» (§4.1). Le etichette delle fasce sono quelle del workspace:
 * le porta `cost.bandLabel` (da `costFigure` con il modello del workspace) e, in sua
 * assenza, `bands`.
 */
export function exportRow(item: HubItem, texts: ExportTexts, bands: readonly CostBandInfo[] = COST_BANDS): ExportRow {
  const value = item.value;
  const cost = item.cost;
  const model = item.valueModel;
  return {
    Codice: item.code ?? "",
    Titolo: item.title,
    Origine: ORIGIN_LABEL[item.origin].chip,
    Tipo: KIND_LABEL[item.kind].label,
    Fase: item.phaseLabel,
    Quando: item.quando ?? "",
    Valore: value.word ? VALUE_WORD_LABEL[value.word] : value.benefits && value.benefits.state !== "contato" ? VALUE_MODEL_STATE_LABEL[value.benefits.state] : NOT_ESTIMATED_LABEL,
    Punteggio: value.score === null ? null : Math.round(value.score * 10) / 10,
    "Fonte del valore": value.source ? VALUE_SOURCE_LABEL[value.source] : NOT_ESTIMATED_LABEL,
    "Valore all'anno": cents(value.perYear?.amount),
    "Ritorno principale": model ? LEVER_LABELS[model.primary] : "",
    "Ore all'anno": value.benefits ? cents(value.benefits.hours) : null,
    "Da misurare all'anno": value.benefits ? cents(value.benefits.pendingEur) : null,
    Costo: cents(cost?.amount),
    Fascia: cost ? bandText(cost, bands) : "",
    "Fonte del costo": cost ? COST_SOURCE_LABEL[cost.source].long : NOT_ESTIMATED_LABEL,
    "Ricorrenti all'anno": model?.costs ? cents(model.costs.runCostEurYear) : null,
    Facilità: model?.ease ?? null,
    Zona: zoneText(item.zone, item.value),
    "AI Lab": item.aiLab ?? "",
    Canale: channelLabel(item.source),
    Area: item.area ?? "",
    "Mese di arrivo": monthLabel(item.arrivedOn),
    "Nota pubblica": item.publicNote ?? "",
    Problema: texts.description ?? "",
    "Come funziona": texts.flowDescription ?? "",
    "Chi controlla": texts.humanInTheLoop ?? "",
    Limiti: texts.guardrails ?? "",
    Dati: texts.dataRequirements ?? "",
  };
}

// ═══ Modello del workspace ═══════════════════════════════════════════

/**
 * Il modello di valutazione del workspace per le letture: la config normalizzata
 * (`resolvedConfig`) più le chiavi nuove del `jsonb` che la normalizzazione non conosce
 * (`scoringVersion`, `costKpiId`, `costBands`, §7.2, §7.6). Se la config normalizzata le porta
 * già, valgono le sue. Le fasce le valida poi `resolveCostBands`. Il costo basso è sempre una
 * fascia (`thresholds.costLowBand`, D18): quella della config normalizzata, altrimenti quella
 * del `jsonb` grezzo (`costLowBandFrom`: la fascia salvata, o quella che contiene una soglia in
 * euro salvata, o la 1). Mai la `costLowMaxEur` della config normalizzata, che ha un predefinito
 * (25.000 €) anche quando il workspace non ha salvato niente.
 */
export function workspaceValuationModel(resolved: ValuationModel, raw: unknown): ValuationModel {
  const extra = record(raw) ?? {};
  const costBands = resolved.costBands ?? extra.costBands;
  const thresholds: NonNullable<ValuationModel["thresholds"]> = { ...resolved.thresholds };
  delete thresholds.costLowMaxEur;
  const costLowBand = isCostLowBand(thresholds.costLowBand) ? thresholds.costLowBand : costLowBandFrom(extra.thresholds, resolveCostBands({ costBands }));
  return {
    dimensions: resolved.dimensions,
    overall: resolved.overall,
    thresholds: { ...thresholds, costLowBand },
    scoringVersion: resolved.scoringVersion ?? (extra.scoringVersion === 2 ? 2 : undefined),
    costKpiId: resolved.costKpiId ?? (typeof extra.costKpiId === "string" ? extra.costKpiId : undefined),
    costBands,
  };
}
