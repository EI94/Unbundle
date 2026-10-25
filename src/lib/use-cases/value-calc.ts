/**
 * Calcolo dei benefici di uno use case: voci, punteggio del valore, piano dei mesi e J-curve.
 *
 * - **Voci** (`valueTotals`): una voce conta se non è `da_misurare`, oppure se il workspace
 *   conta anche quelle (`includeUnmeasured`). Ore: `volumeYear × minutesPerUnit / 60 ×
 *   automatablePct / 100`, al costo orario del workspace. Euro: `eurYear`. Qualitativa: si
 *   conta e basta. Quello che non conta finisce in `pendingEur` («da misurare · fino a …»).
 *   Avvio `oneoff = devDays × dayCostEur + internalHours × hourlyCostEur`, ricorrenti
 *   `run = runCostEurYear`, netto `net = benefit − run`.
 * - **Punteggio del valore** (`valueScore`): interpolazione lineare tra `(0, 1)`,
 *   `(midValueEur, midImpact)`, `(highValueEur, highImpact)` e `(2 × highValueEur, 5)`.
 *   `midImpact` e `highImpact` sono le soglie del workspace della parola del Valore
 *   (`thresholds.midImpact` e `thresholds.highImpact`, predefinite 2,5 e 3,5 in
 *   `DEFAULT_THRESHOLDS`): così con `valueWord` un beneficio di `midValueEur` è esattamente
 *   «Medio» e uno di `highValueEur` è esattamente «Alto», anche quando il workspace ha
 *   cambiato le soglie. Oltre `2 × highValueEur` il punteggio resta 5.
 * - **Piano** (`planMonths`): per le schede approvate o in realizzazione, in mesi contati da
 *   `originMonth` (indice 0).
 * - **J-curve** (`jCurve`): il valore netto cumulato, mese per mese, e il pareggio.
 *
 * Nessun arrotondamento qui: si arrotonda solo quando si mostra.
 * Modulo puro: import relativi `.ts`.
 */
import { LEVERS, type Lever } from "../uc/vocab.ts";
import type { ValueWord } from "./labels.ts";
import { compareQuarters, nextQuarter, parseQuarter } from "./quarter.ts";
import type { QuarterCode } from "./types.ts";
import { DEFAULT_THRESHOLDS, valueWord, type ModelEstimate, type ValuationModel } from "./valuation.ts";
import { MONTH_PATTERN, type MonthCode, type ValueComponent, type ValueModel, type ValueParams } from "./value-model.ts";

// ─── Voci ────────────────────────────────────────────────────────────

/** Vero se la voce entra nel beneficio contato. */
export function countsComponent(component: Pick<ValueComponent, "confidence">, params: Pick<ValueParams, "includeUnmeasured">): boolean {
  return component.confidence !== "da_misurare" || params.includeUnmeasured;
}

export interface ComponentResult {
  key: string;
  lever: Lever;
  kind: ValueComponent["kind"];
  /** Entra nel beneficio contato. */
  counted: boolean;
  /** Ore all'anno (solo voci a ore). */
  hours: number;
  /** Euro all'anno: le ore al costo orario, oppure `eurYear`; 0 per le qualitative. */
  eur: number;
}

/** Ore ed euro di una voce, per la riga calcolata dell'editor («116 h · 4.043 €»). */
export function componentResult(component: ValueComponent, params: Pick<ValueParams, "hourlyCostEur" | "includeUnmeasured">): ComponentResult {
  const counted = countsComponent(component, params);
  const base = { key: component.key, lever: component.lever, kind: component.kind, counted };
  switch (component.kind) {
    case "ore": {
      // Nell'ordine della spec, da sinistra: 6.600 × 1,5 / 60 × 70 / 100 dà 115,5 esatto (con
      // `× (70 / 100)` la virgola mobile darebbe 115,4999…, letto 115 invece di 116).
      const hours = (((component.volumeYear * component.minutesPerUnit) / 60) * component.automatablePct) / 100;
      return { ...base, hours, eur: hours * params.hourlyCostEur };
    }
    case "euro":
      return { ...base, hours: 0, eur: component.eurYear };
    case "qualitativo":
      return { ...base, hours: 0, eur: 0 };
  }
}

const zeroByLever = (): Record<Lever, number> => Object.fromEntries(LEVERS.map((lever) => [lever, 0])) as Record<Lever, number>;

export interface ValueTotals {
  /** Ore all'anno contate. */
  hours: number;
  /** Beneficio contato, euro all'anno. */
  benefit: number;
  /** Euro all'anno delle voci che non contano (da misurare). */
  pendingEur: number;
  /** Quante voci qualitative. */
  qualitative: number;
  /** Beneficio contato per tipo di ritorno. */
  byLever: Record<Lever, number>;
  /** Euro da misurare per tipo di ritorno (la parte tratteggiata, fuori dal totale). */
  pendingByLever: Record<Lever, number>;
  /** Voci qualitative per tipo di ritorno. */
  qualitativeByLever: Record<Lever, number>;
  /** Costo di avvio, euro. */
  oneoff: number;
  /** Costi ricorrenti, euro all'anno. */
  run: number;
  /** `benefit − run`, euro all'anno. */
  net: number;
  components: ComponentResult[];
}

/** I conti di un modello con le ipotesi del workspace. */
export function valueTotals(model: Pick<ValueModel, "components" | "costs">, params: ValueParams): ValueTotals {
  const totals: ValueTotals = {
    hours: 0,
    benefit: 0,
    pendingEur: 0,
    qualitative: 0,
    byLever: zeroByLever(),
    pendingByLever: zeroByLever(),
    qualitativeByLever: zeroByLever(),
    oneoff: 0,
    run: 0,
    net: 0,
    components: [],
  };
  for (const component of model.components) {
    const result = componentResult(component, params);
    totals.components.push(result);
    if (component.kind === "qualitativo") {
      totals.qualitative += 1;
      totals.qualitativeByLever[component.lever] += 1;
      continue;
    }
    if (result.counted) {
      totals.hours += result.hours;
      totals.benefit += result.eur;
      totals.byLever[component.lever] += result.eur;
    } else {
      totals.pendingEur += result.eur;
      totals.pendingByLever[component.lever] += result.eur;
    }
  }
  const costs = model.costs;
  totals.oneoff = costs ? costs.devDays * params.dayCostEur + costs.internalHours * params.hourlyCostEur : 0;
  totals.run = costs ? costs.runCostEurYear : 0;
  totals.net = totals.benefit - totals.run;
  return totals;
}

// ─── Punteggio del valore ────────────────────────────────────────────

/** Le soglie della parola del Valore del workspace (`valueWord`), con i predefiniti. */
export function impactThresholds(model: Pick<ValuationModel, "thresholds"> | null | undefined): { midImpact: number; highImpact: number } {
  const read = (value: unknown, fallback: number) => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
  return {
    midImpact: read(model?.thresholds?.midImpact, DEFAULT_THRESHOLDS.midImpact),
    highImpact: read(model?.thresholds?.highImpact, DEFAULT_THRESHOLDS.highImpact),
  };
}

const clamp15 = (value: number) => Math.max(1, Math.min(5, value));

/**
 * Punteggio da 1 a 5 di un beneficio all'anno: interpolazione lineare tra `(0, 1)`,
 * `(midValueEur, midImpact)`, `(highValueEur, highImpact)` e `(2 × highValueEur, 5)`; sotto
 * zero 1, oltre l'ultimo punto 5. Nei punti il valore è esatto (nessun errore di virgola).
 */
export function valueScore(
  benefitEur: number,
  params: Pick<ValueParams, "midValueEur" | "highValueEur">,
  thresholds: { midImpact: number; highImpact: number },
): number {
  const midImpact = clamp15(thresholds.midImpact);
  const highImpact = clamp15(Math.max(thresholds.highImpact, midImpact));
  const points: Array<[number, number]> = [
    [0, 1],
    [params.midValueEur, midImpact],
    [params.highValueEur, highImpact],
    [2 * params.highValueEur, 5],
  ];
  if (!Number.isFinite(benefitEur) || benefitEur <= 0) return 1;
  for (let i = 1; i < points.length; i++) {
    const [x1, y1] = points[i];
    if (benefitEur === x1) return y1;
    if (benefitEur < x1) {
      const [x0, y0] = points[i - 1];
      return y0 + ((benefitEur - x0) * (y1 - y0)) / (x1 - x0);
    }
  }
  return 5;
}

/**
 * Il Valore di una scheda con un modello (calcolato in lettura, mai salvato):
 * - `contato`: c'è un beneficio contato maggiore di zero, con punteggio e parola;
 * - `da_misurare`: nessun beneficio contato, ma voci da misurare («da misurare · fino a X €»);
 * - `qualitativo`: nessun importo.
 */
export interface ModelValue {
  state: "contato" | "da_misurare" | "qualitativo";
  benefit: number;
  pendingEur: number;
  score: number | null;
  word: ValueWord | null;
}

export function modelValue(totals: Pick<ValueTotals, "benefit" | "pendingEur">, params: ValueParams, valuation: ValuationModel): ModelValue {
  if (totals.benefit > 0) {
    const score = valueScore(totals.benefit, params, impactThresholds(valuation));
    return { state: "contato", benefit: totals.benefit, pendingEur: totals.pendingEur, score, word: valueWord(score, valuation) };
  }
  return {
    state: totals.pendingEur > 0 ? "da_misurare" : "qualitativo",
    benefit: totals.benefit,
    pendingEur: totals.pendingEur,
    score: null,
    word: null,
  };
}

/**
 * I conti di una scheda con un modello, nella forma che leggono `valueFigure` e `costFigure`
 * (`ModelEstimate`): stato, beneficio contato, da misurare, ore, punteggio e, se il modello ha i
 * costi, avvio e ricorrenti.
 */
export function modelEstimate(model: Pick<ValueModel, "components" | "costs">, params: ValueParams, valuation: ValuationModel): ModelEstimate {
  const totals = valueTotals(model, params);
  const value = modelValue(totals, params, valuation);
  return {
    state: value.state,
    benefitEur: totals.benefit,
    pendingEur: totals.pendingEur,
    hours: totals.hours,
    score: value.score,
    costs: model.costs ? { oneoffEur: totals.oneoff, runEurYear: totals.run } : null,
  };
}

// ─── Mesi ────────────────────────────────────────────────────────────

const MONTH_SHORT_IT = ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"] as const;

function monthParts(month: string): { year: number; month: number } {
  const match = MONTH_PATTERN.exec(month);
  if (!match) throw new RangeError(`Mese non valido: ${month}`);
  return { year: Number(match[1]), month: Number(match[2]) };
}

/** Quanti mesi da `origin` a `month` (negativo se viene prima). */
export function monthIndex(origin: string, month: string): number {
  const a = monthParts(origin);
  const b = monthParts(month);
  return (b.year - a.year) * 12 + (b.month - a.month);
}

/** Il mese `index` mesi dopo `origin` (prima, se negativo). */
export function monthAt(origin: string, index: number): MonthCode {
  const { year, month } = monthParts(origin);
  const total = year * 12 + (month - 1) + index;
  const y = Math.floor(total / 12);
  const m = total - y * 12 + 1;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}` as MonthCode;
}

/** «mag 27». */
export function monthLabel(month: string): string {
  const { year, month: m } = monthParts(month);
  return `${MONTH_SHORT_IT[m - 1]} ${String(year % 100).padStart(2, "0")}`;
}

/** Primo mese di un trimestre: `2027-Q2` → `2027-04`. */
export function quarterFirstMonth(quarter: string): MonthCode {
  const parsed = parseQuarter(quarter);
  if (!parsed) throw new RangeError(`Trimestre non valido: ${quarter}`);
  return `${String(parsed.year).padStart(4, "0")}-${String((parsed.quarter - 1) * 3 + 1).padStart(2, "0")}` as MonthCode;
}

/** Il trimestre di un mese: `2026-11` → `2026-Q4`. */
export function quarterOfMonth(month: string): QuarterCode {
  const { year, month: m } = monthParts(month);
  return `${String(year).padStart(4, "0")}-Q${Math.floor((m - 1) / 3) + 1}` as QuarterCode;
}

// ─── Piano dei mesi ──────────────────────────────────────────────────

/** Le schede che entrano nel piano: approvate oppure in realizzazione. */
export type PlanStage = "approvato" | "in_realizzazione";

export interface PlanCard {
  id: string;
  stage: PlanStage;
  /** «Quando» della scheda approvata; `null` = «Più avanti». */
  targetQuarter: string | null;
  /** `value_model.plan`, se c'è. */
  plan?: ValueModel["plan"] | null;
}

/**
 * Da dove vengono i mesi: il piano della scheda; il primo mese del trimestre approvato;
 * l'origine (scheda in realizzazione, oppure trimestre già iniziato o passato); il
 * trimestre dopo l'ultimo usato («Più avanti»).
 */
export type PlanSource = "piano" | "trimestre" | "origine" | "piu_avanti";

export interface PlannedMonths {
  id: string;
  /** Indice del mese di avvio, da `originMonth`. */
  start: number;
  /** Indice del mese di entrata in uso. */
  goLive: number;
  startMonth: MonthCode;
  goLiveMonth: MonthCode;
  source: PlanSource;
}

/**
 * Mesi di avvio e di entrata in uso di ogni scheda, nell'ordine ricevuto:
 * - con `plan`, i suoi mesi;
 * - in realizzazione, l'origine;
 * - approvata con un trimestre, il suo primo mese; l'origine se quel mese viene prima. «Il
 *   trimestre è passato» della spec si legge «è già cominciato»: una scheda del trimestre in corso
 *   con l'origine al secondo o terzo mese parte dall'origine, così il suo avvio resta tutto dentro
 *   la curva (con il primo mese del trimestre, indice negativo, una parte dell'avvio cadrebbe prima
 *   dell'orizzonte). Lo dice anche il riquadro «Ipotesi di calcolo» (`VALUE_PARAMS_TEXT.planRule`).
 * - approvata «Più avanti», il primo mese del trimestre dopo l'ultimo usato dalle altre
 *   schede (mai prima di quello dopo il trimestre dell'origine). Tutte le «Più avanti» partono
 *   in quel trimestre: «l'ultimo usato» sono le schede con un trimestre o un piano, non le altre
 *   «Più avanti» (una lettura della spec da confermare con Pierpaolo: in sequenza, un trimestre
 *   dopo l'altro, la curva cambierebbe).
 * Senza piano, l'entrata in uso è `buildMonths` mesi dopo l'avvio.
 */
export function planMonths(cards: readonly PlanCard[], params: Pick<ValueParams, "originMonth" | "buildMonths">): PlannedMonths[] {
  const origin = params.originMonth;
  const placed = new Map<string, PlannedMonths>();
  const fromStart = (id: string, start: number, source: PlanSource): PlannedMonths => {
    const goLive = start + params.buildMonths;
    return { id, start, goLive, startMonth: monthAt(origin, start), goLiveMonth: monthAt(origin, goLive), source };
  };
  let lastUsed: string = quarterOfMonth(origin);
  const later: PlanCard[] = [];
  for (const card of cards) {
    let months: PlannedMonths;
    if (card.plan) {
      const start = monthIndex(origin, card.plan.startMonth);
      const goLive = monthIndex(origin, card.plan.goLiveMonth);
      months = { id: card.id, start, goLive, startMonth: card.plan.startMonth as MonthCode, goLiveMonth: card.plan.goLiveMonth as MonthCode, source: "piano" };
    } else if (card.stage === "in_realizzazione") {
      months = fromStart(card.id, 0, "origine");
    } else if (card.targetQuarter && parseQuarter(card.targetQuarter)) {
      const first = monthIndex(origin, quarterFirstMonth(card.targetQuarter));
      months = first >= 0 ? fromStart(card.id, first, "trimestre") : fromStart(card.id, 0, "origine");
    } else {
      later.push(card);
      continue;
    }
    placed.set(card.id, months);
    const used = quarterOfMonth(months.startMonth);
    if (compareQuarters(used, lastUsed) > 0) lastUsed = used;
  }
  if (later.length) {
    const start = Math.max(0, monthIndex(origin, quarterFirstMonth(nextQuarter(lastUsed))));
    for (const card of later) placed.set(card.id, fromStart(card.id, start, "piu_avanti"));
  }
  return cards.map((card) => placed.get(card.id)!);
}

// ─── J-curve ─────────────────────────────────────────────────────────

/**
 * Sotto questa soglia (in euro) un valore della curva vale zero: la virgola mobile lascia code come
 * −1,1e-13 dove il conto esatto dà 0. Nessun arrotondamento: si confronta solo con tolleranza.
 */
export const CURVE_EPSILON = 1e-6;

export interface CurveCard {
  /** Indice del mese di avvio. */
  start: number;
  /** Indice del mese di entrata in uso. */
  goLive: number;
  /** Beneficio contato, euro all'anno. */
  benefit: number;
  /** Costo di avvio, euro. */
  oneoff: number;
  /** Costi ricorrenti, euro all'anno. */
  run: number;
}

export interface JCurve {
  /** `horizonMonths + 1` mesi, da `originMonth`. */
  months: MonthCode[];
  /** Valore netto cumulato: `net[0] = 0`, `net[m + 1]` comprende il mese `m`. */
  net: number[];
  /**
   * Primo indice `m` con `net[m] ≥ 0` e `net[m − 1] < 0`, con la tolleranza `CURVE_EPSILON`: una
   * curva che tocca lo zero (−1e-13 per la virgola mobile) pareggia in quel mese. `null` se non c'è.
   */
  breakeven: number | null;
  breakevenMonth: MonthCode | null;
}

/**
 * Il valore netto cumulato delle schede, mese per mese. Per ogni scheda e ogni mese `m` da 0
 * a `H − 1`: il costo di avvio si divide sui mesi da `start` a `goLive − 1` (tutto nel mese
 * `start` se coincidono); dall'entrata in uso il beneficio cresce in `rampMonths` mesi fino
 * a `benefit / 12` al mese, e si pagano i ricorrenti (`run / 12`). Mesi fuori dall'orizzonte
 * non entrano.
 */
export function jCurve(cards: readonly CurveCard[], params: Pick<ValueParams, "originMonth" | "horizonMonths" | "rampMonths">): JCurve {
  const horizon = params.horizonMonths;
  const ramp = Math.max(1, params.rampMonths);
  const net = new Array<number>(horizon + 1).fill(0);
  for (const card of cards) {
    const { start: s, goLive: g } = card;
    for (let m = 0; m < horizon; m++) {
      let cost = 0;
      let flow = 0;
      if (s === g && m === s) cost += card.oneoff;
      if (s <= m && m < g) cost += card.oneoff / (g - s);
      if (m >= g) {
        flow += (card.benefit / 12) * Math.min(1, (m - g + 1) / ramp);
        cost += card.run / 12;
      }
      net[m + 1] += flow - cost;
    }
  }
  for (let m = 1; m <= horizon; m++) net[m] += net[m - 1];
  let breakeven: number | null = null;
  for (let m = 1; m <= horizon; m++) {
    if (net[m] >= -CURVE_EPSILON && net[m - 1] < -CURVE_EPSILON) {
      breakeven = m;
      break;
    }
  }
  const months = Array.from({ length: horizon + 1 }, (_, m) => monthAt(params.originMonth, m));
  return { months, net, breakeven, breakevenMonth: breakeven === null ? null : months[breakeven] };
}
