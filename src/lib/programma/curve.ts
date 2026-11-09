/**
 * La curva della pagina «Programma» (rilascio 7, docs/programma/RILASCIO-7-PROGETTO.md §2-§3):
 * valore e costo cumulati, due linee, mai un netto (principio del titolare, 04/11/2026).
 *
 * - **Le schede** (`programCards`): tutti gli use case approvati («da avviare»), in realizzazione e
 *   realizzati («in uso»), anche senza cifre (contano come nella Panoramica). Il valore all'anno è la cifra della card
 *   (`shownPerYearEur`), la stessa dei riquadri; il costo di avvio è quello della card (`referenceEur`:
 *   il dossier, la stima di «Benefici e costi», l'importo o la fascia del team), come la Panoramica; i
 *   ricorrenti vengono da «Benefici e costi», altrimenti dalla card.
 *   L'avvio conta come in `isCommittedCost` della Panoramica (in realizzazione, oppure approvato «Da
 *   costruire»), più i realizzati «Da costruire», che l'avvio l'hanno pagato.
 * - **Lo sviluppo di Lateral Space** (titolare, 09/11/2026: «a volte un costo di sviluppo e
 *   implementazione del caso d'uso, di solito una percentuale rispetto al valore prospettico»): acceso
 *   caso per caso (`ProgramCosts.caseDev`), vale la percentuale del workspace sul valore all'anno
 *   della card, oppure un importo fisso. Prende il posto del costo di avvio della card tranne le ore
 *   interne della stima di «Benefici e costi» (cioè dei suoi «giorni di sviluppo»): lo stesso lavoro non si
 *   conta due volte. I ricorrenti restano.
 * - **I mesi**: approvati e in realizzazione con `planMonths` (le ipotesi del workspace, come la
 *   «Curva del valore»); i realizzati dal loro piano, altrimenti entrati in uso nel mese di
 *   «Realizzato» (`realizedOn`) dopo `buildMonths` mesi di avvio. La curva parte dal mese più vecchio
 *   tra l'origine delle ipotesi, l'inizio del canone e l'avvio dei realizzati (mai più di
 *   `MAX_PAST_MONTHS` mesi prima di oggi) e finisce dove finisce la «Curva del valore».
 * - **Il canone di supporto** (titolare, 09/11/2026: «una fee fissa di supporto … splittata in modo
 *   intelligente tra tutti i casi d'uso»): ogni mese fra il suo inizio e la sua fine entra nel costo.
 *   Si divide tra gli use case partiti quel mese (in avvio o in uso; fino a oggi solo quelli davvero in
 *   realizzazione o in uso), in proporzione al valore all'anno; un mese senza use case partiti, o con
 *   valore zero, resta «del programma».
 * - **Il pareggio**: il primo mese in cui il valore cumulato raggiunge il costo cumulato dopo
 *   esserne stato sotto. Con la tolleranza `CURVE_EPSILON` della J-curve.
 * - **Gli scenari** (7c): il valore degli use case non ancora in uso per 0,7 (prudente), 1 (base) o
 *   1,3 (ambizioso). I costi non cambiano.
 *
 * Nessun arrotondamento qui: si arrotonda solo quando si mostra. Nessun conto per persona.
 * Modulo puro: import relativi `.ts`.
 */
import { shownPerYearEur } from "../use-cases/format.ts";
import { CURVE_EPSILON, monthAt, monthIndex, planMonths, valueTotals } from "../use-cases/value-calc.ts";
import type { MonthCode, ValueModel, ValueParams } from "../use-cases/value-model.ts";
import type { HubItem } from "../use-cases/views.ts";

// ─── Tipi ────────────────────────────────────────────────────────────

/** Dove sta uno use case nel programma: le tre righe delle iniziative. */
export type ProgramStage = "da_avviare" | "in_realizzazione" | "in_uso";

/** Lo sviluppo di Lateral Space di uno use case: la percentuale del workspace, oppure un importo fisso. */
export interface CaseDevCost {
  mode: "percentuale" | "importo";
  /** Solo con `importo`: euro, una volta. */
  amountEur: number | null;
}

/** I costi di Lateral Space del workspace (`program_settings`, `program_case_costs`). */
export interface ProgramCosts {
  /** Canone di supporto, euro al mese; null senza canone. */
  supportMonthEur: number | null;
  /** Primo mese del canone; null: dall'inizio della curva. */
  supportFrom: MonthCode | null;
  /** Ultimo mese del canone (compreso); null: fino in fondo. */
  supportTo: MonthCode | null;
  /** Percentuale dello sviluppo sul valore all'anno, da 0 a 100; null senza. */
  devPct: number | null;
  /** id dello use case (minuscolo) → sviluppo di Lateral Space; uno use case che non c'è non ne ha. */
  caseDev: ReadonlyMap<string, CaseDevCost>;
}

export const NO_PROGRAM_COSTS: ProgramCosts = Object.freeze({
  supportMonthEur: null,
  supportFrom: null,
  supportTo: null,
  devPct: null,
  caseDev: new Map<string, CaseDevCost>(),
});

/** Uno use case nei conti del programma. */
export interface ProgramCard {
  id: string;
  code: string | null;
  title: string;
  stage: ProgramStage;
  kind: HubItem["kind"];
  targetQuarter: HubItem["targetQuarter"];
  /** Valore all'anno, la cifra della card; 0 senza. */
  value: number;
  /** Costo di avvio che entra nella curva, sviluppo di Lateral Space compreso. */
  oneoff: number;
  /** La parte di `oneoff` che è sviluppo di Lateral Space; 0 senza. */
  lsDev: number;
  /** Sviluppo di Lateral Space acceso a percentuale, ma il workspace non ha la percentuale: vale 0. */
  lsDevMissingPct: boolean;
  /** Mantenimento, euro all'anno. */
  run: number;
  /** Ha «Benefici e costi». */
  hasModel: boolean;
  /** Indici dei mesi da `ProgramCurve.months[0]`. */
  start: number;
  goLive: number;
  startMonth: MonthCode;
  goLiveMonth: MonthCode;
}

/** I tre scenari del pannello della curva. */
export const SCENARIOS = Object.freeze({ prudente: 0.7, base: 1, ambizioso: 1.3 });
export type Scenario = keyof typeof SCENARIOS;

/** Al massimo quanti mesi prima di oggi parte la curva. */
export const MAX_PAST_MONTHS = 36;

export interface ProgramMonth {
  month: MonthCode;
  /** Valore del mese. */
  value: number;
  /** Avvio del mese (sviluppo di Lateral Space compreso). */
  build: number;
  /** Mantenimento del mese. */
  run: number;
  /** Canone di supporto del mese. */
  support: number;
}

export interface ProgramCurve {
  /** `months.length = monthly.length + 1`: `value[0] = cost[0] = 0`, `value[m + 1]` comprende il mese `m`. */
  months: MonthCode[];
  value: number[];
  cost: number[];
  monthly: ProgramMonth[];
  /** L'indice di `months` del mese di oggi (inizio del mese): a sinistra il già successo, a destra la previsione. */
  today: number;
  /** Il pareggio: un mese, «subito» (il valore non è mai sotto il costo e sale), oltre l'ultimo mese; null senza né valore né costo. */
  breakeven: { kind: "mese"; index: number; month: MonthCode } | { kind: "subito" } | { kind: "oltre"; month: MonthCode } | null;
  scenario: Scenario;
}

// ─── Le schede ───────────────────────────────────────────────────────

const STAGE_OF: Partial<Record<HubItem["phase"], ProgramStage>> = {
  approvato: "da_avviare",
  in_realizzazione: "in_realizzazione",
  realizzato: "in_uso",
};

/** La fase di uno use case nel programma; null fuori (da valutare, chiuso). */
export function programStageOf(item: Pick<HubItem, "phase">): ProgramStage | null {
  return STAGE_OF[item.phase] ?? null;
}

/** Il mese di una data `AAAA-MM-GG`. */
function monthOf(date: string): MonthCode {
  return date.slice(0, 7) as MonthCode;
}

function laterMonth(a: MonthCode, b: MonthCode): MonthCode {
  return a >= b ? a : b;
}

function earlierMonth(a: MonthCode, b: MonthCode): MonthCode {
  return a <= b ? a : b;
}

/** Lo sviluppo di Lateral Space di una scheda: importo, oppure percentuale × valore all'anno. */
export function lsDevAmount(dev: CaseDevCost | undefined, value: number, devPct: number | null): { amount: number; missingPct: boolean } | null {
  if (!dev) return null;
  if (dev.mode === "importo") return { amount: Math.max(0, dev.amountEur ?? 0), missingPct: false };
  if (devPct === null) return { amount: 0, missingPct: true };
  return { amount: (Math.max(0, value) * devPct) / 100, missingPct: false };
}

interface CardDraft extends Omit<ProgramCard, "start" | "goLive" | "startMonth" | "goLiveMonth"> {
  plan: NonNullable<ValueModel["plan"]> | null;
  realizedOn: string | null;
}

function draftOf(item: HubItem, stage: ProgramStage, params: ValueParams, costs: ProgramCosts): CardDraft {
  const value = Math.max(0, shownPerYearEur(item.value) ?? 0);
  const model = item.valueModel;
  // Il costo di avvio della card (`item.cost`: il dossier, poi la stima di «Benefici e costi», poi l'importo
  // o la fascia del team), come la Panoramica; i ricorrenti dal modello, o dalla card.
  const cardOneoff = item.cost ? Math.max(0, item.cost.referenceEur) : null;
  const totals = model ? valueTotals(model, params) : null;
  const run = totals ? totals.run : Math.max(0, item.cost?.runEurYear ?? 0);
  // Le ore interne si sanno solo dalla stima del modello: restano anche con lo sviluppo di Lateral Space.
  const internal = model?.costs && (item.cost === null || item.cost.source === "stima") ? model.costs.internalHours * params.hourlyCostEur : 0;
  // Come `isCommittedCost` della Panoramica (in realizzazione, oppure approvato «Da costruire»), più i
  // realizzati «Da costruire», che l'avvio l'hanno pagato.
  const committed = item.phase === "in_realizzazione" || item.kind === "da_costruire";
  const ls = lsDevAmount(costs.caseDev.get(item.id.toLowerCase()), value, costs.devPct);
  const lsDev = ls?.amount ?? 0;
  const base = cardOneoff ?? (totals ? totals.oneoff : 0);
  const oneoff = ls ? lsDev + (committed ? internal : 0) : committed ? base : 0;
  return {
    id: item.id,
    code: item.code,
    title: item.title,
    stage,
    kind: item.kind,
    targetQuarter: item.targetQuarter,
    value,
    oneoff,
    lsDev,
    lsDevMissingPct: ls?.missingPct ?? false,
    run,
    hasModel: model !== null,
    plan: model?.plan ?? null,
    realizedOn: item.realizedOn,
  };
}

export interface ProgramCardsResult {
  cards: ProgramCard[];
  /** Il mese 0 della curva. */
  origin: MonthCode;
  /** L'ultimo mese della curva (`months[months.length - 1]`). */
  end: MonthCode;
}

/**
 * Le schede del programma con i loro mesi, da tutte le schede dei revisori del workspace (non
 * filtrate). `today` è `AAAA-MM-GG` a Roma.
 */
export function programCards(items: readonly HubItem[], params: ValueParams, costs: ProgramCosts, today: string): ProgramCardsResult {
  const todayMonth = monthOf(today);
  const drafts: CardDraft[] = [];
  for (const item of items) {
    const stage = programStageOf(item);
    if (!stage) continue;
    drafts.push(draftOf(item, stage, params, costs));
  }
  const planned = planMonths(
    drafts
      .filter((draft) => draft.stage !== "in_uso")
      .map((draft) => ({
        id: draft.id,
        stage: draft.stage === "in_realizzazione" ? ("in_realizzazione" as const) : ("approvato" as const),
        targetQuarter: draft.targetQuarter,
        plan: draft.plan,
      })),
    params,
  );
  const months = new Map<string, { startMonth: MonthCode; goLiveMonth: MonthCode }>(planned.map((p) => [p.id, { startMonth: p.startMonth, goLiveMonth: p.goLiveMonth }]));
  for (const draft of drafts) {
    if (draft.stage !== "in_uso") continue;
    if (draft.plan) {
      months.set(draft.id, { startMonth: draft.plan.startMonth as MonthCode, goLiveMonth: draft.plan.goLiveMonth as MonthCode });
      continue;
    }
    const goLiveMonth = draft.realizedOn ? monthOf(draft.realizedOn) : todayMonth;
    months.set(draft.id, { startMonth: monthAt(goLiveMonth, -params.buildMonths), goLiveMonth });
  }
  let origin = params.originMonth;
  if (costs.supportMonthEur && costs.supportFrom) origin = earlierMonth(origin, costs.supportFrom);
  for (const draft of drafts) if (draft.stage === "in_uso") origin = earlierMonth(origin, months.get(draft.id)!.startMonth);
  origin = laterMonth(origin, monthAt(todayMonth, -MAX_PAST_MONTHS));
  origin = earlierMonth(origin, todayMonth);
  const end = laterMonth(monthAt(params.originMonth, params.horizonMonths), todayMonth);
  const cards = drafts.map((draft): ProgramCard => {
    const m = months.get(draft.id)!;
    return {
      id: draft.id,
      code: draft.code,
      title: draft.title,
      stage: draft.stage,
      kind: draft.kind,
      targetQuarter: draft.targetQuarter,
      value: draft.value,
      oneoff: draft.oneoff,
      lsDev: draft.lsDev,
      lsDevMissingPct: draft.lsDevMissingPct,
      run: draft.run,
      hasModel: draft.hasModel,
      startMonth: m.startMonth,
      goLiveMonth: m.goLiveMonth,
      start: monthIndex(origin, m.startMonth),
      goLive: monthIndex(origin, m.goLiveMonth),
    };
  });
  return { cards, origin, end };
}

// ─── La curva ────────────────────────────────────────────────────────

/** Il canone del mese `month`: tra inizio e fine (compresi), altrimenti 0. */
export function supportOfMonth(costs: Pick<ProgramCosts, "supportMonthEur" | "supportFrom" | "supportTo">, month: MonthCode): number {
  const canone = costs.supportMonthEur ?? 0;
  if (!(canone > 0)) return 0;
  if (costs.supportFrom && month < costs.supportFrom) return 0;
  if (costs.supportTo && month > costs.supportTo) return 0;
  return canone;
}

/**
 * Come si divide il canone del mese `m` (indice da `months[0]`) tra le schede partite quel mese, in
 * proporzione al valore all'anno: id → euro. Vuota se il mese non ha canone, nessuna scheda è partita
 * o il loro valore è zero (il canone resta del programma).
 */
export function supportSplit(cards: readonly Pick<ProgramCard, "id" | "start" | "value" | "stage">[], canone: number, m: number, today: number): Map<string, number> {
  const split = new Map<string, number>();
  if (!(canone > 0)) return split;
  // Fino a oggi conta chi è davvero partito (in realizzazione o in uso); un approvato «da avviare» il cui
  // avvio previsto cade nel mese di oggi non porta canone finché non parte. Dopo oggi, l'avvio previsto.
  const started = (card: Pick<ProgramCard, "start" | "stage">) => card.start <= m && (m > today || card.stage !== "da_avviare");
  const active = cards.filter((card) => started(card) && card.value > 0);
  const total = active.reduce((sum, card) => sum + card.value, 0);
  if (!(total > 0)) return split;
  for (const card of active) split.set(card.id, (canone * card.value) / total);
  return split;
}

/** Valore e costo cumulati dal mese 0 della curva, mese per mese, con il pareggio. */
export function programCurve(result: ProgramCardsResult, params: Pick<ValueParams, "rampMonths">, costs: ProgramCosts, today: string, scenario: Scenario = "base"): ProgramCurve {
  const { cards, origin, end } = result;
  const n = Math.max(0, monthIndex(origin, end));
  const ramp = Math.max(1, params.rampMonths);
  const todayIndex = Math.min(n, Math.max(0, monthIndex(origin, monthOf(today))));
  const factor = SCENARIOS[scenario];
  const months = Array.from({ length: n + 1 }, (_, m) => monthAt(origin, m));
  const monthly: ProgramMonth[] = [];
  for (let m = 0; m < n; m++) {
    const row: ProgramMonth = { month: months[m], value: 0, build: 0, run: 0, support: supportOfMonth(costs, months[m]) };
    for (const card of cards) {
      const { start: s, goLive: g } = card;
      if (s === g && m === s) row.build += card.oneoff;
      if (s <= m && m < g) row.build += card.oneoff / (g - s);
      if (m >= g) {
        // Gli scenari cambiano il valore di chi non è ancora in uso; quello degli use case in uso resta.
        const k = card.stage === "in_uso" ? 1 : factor;
        row.value += ((card.value * k) / 12) * Math.min(1, (m - g + 1) / ramp);
        row.run += card.run / 12;
      }
    }
    monthly.push(row);
  }
  const value = [0];
  const cost = [0];
  for (const row of monthly) {
    value.push(value[value.length - 1] + row.value);
    cost.push(cost[cost.length - 1] + row.build + row.run + row.support);
  }
  return { months, value, cost, monthly, today: todayIndex, breakeven: breakevenOf(months, value, cost), scenario };
}

/** Il pareggio di due curve cumulate (`programCurve`). */
export function breakevenOf(months: readonly MonthCode[], value: readonly number[], cost: readonly number[]): ProgramCurve["breakeven"] {
  const below = (m: number) => value[m] < cost[m] - CURVE_EPSILON;
  for (let m = 1; m < months.length; m++) {
    if (!below(m) && below(m - 1)) return { kind: "mese", index: m, month: months[m] };
  }
  const last = months.length - 1;
  if (last < 0) return null;
  const everBelow = value.some((_, m) => below(m));
  if (everBelow) return below(last) ? { kind: "oltre", month: months[last] } : null;
  return value[last] > CURVE_EPSILON ? { kind: "subito" } : null;
}

/**
 * La parte del canone di ogni scheda in un anno, al ritmo del mese di oggi (il canone di oggi
 * diviso come `supportSplit`, per 12): id → euro all'anno. Vuota se oggi non c'è canone.
 */
export function supportPerYearByCard(result: ProgramCardsResult, costs: ProgramCosts, today: string): Map<string, number> {
  const m = monthIndex(result.origin, monthOf(today));
  const split = supportSplit(result.cards, supportOfMonth(costs, monthOf(today)), m, m);
  return new Map([...split].map(([id, eur]) => [id, eur * 12]));
}
