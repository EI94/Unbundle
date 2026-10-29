/**
 * La testa della Panoramica (rilascio «Panoramica»): le fasi con i loro numeri, le cifre, la riga
 * «Su tutto il portafoglio» e «Prossimo passo». Qui solo numeri; i testi in `panoramica-top.tsx`.
 *
 * - **Fasi** (`overviewSteps`): «Da decidere» con il contatore del selettore (ai contributori senza),
 *   poi quanti use case approvati, in realizzazione e realizzati (anche «diffusa»). Ogni fase porta
 *   alla sua vista o alla sua sezione della Panoramica (`OVERVIEW_STEP_TARGET`).
 * - **Cifre** (`overviewFigures`): le cifre di prima, non conti nuovi. Valore e costo da
 *   `roadmapTotals`, gli use case di «Questo trimestre» quanti ne mostra la sua corsia (`buildLanes`,
 *   scaduti compresi), «fino a» la somma dei «fino a X €» delle card (`pendingValueTotal`).
 * - **Su tutto il portafoglio** (`portfolioLine`): le ore e il pareggio di `buildRoadmapValue`.
 * - **Prossimo passo** (`overviewNextStep`): regole fisse, nell'ordine. Prima i requisiti degli use
 *   case approvati per questo trimestre (da chiedere, da verificare o bloccati, ognuno una volta),
 *   poi le decisioni; altrimenti niente.
 *
 * Art. 15.4: conteggi di use case o di esigenze, mai di persone; nessun conto per «Chi» o per parte.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { buildLanes, PANORAMA_SECTION_ID } from "./lanes.ts";
import { needAskCountsOf, type NeedView } from "./needs.ts";
import { quarterOfDate } from "./quarter.ts";
import type { Phase, QuarterCode } from "./types.ts";
import { BREAKEVEN_NOW, type RoadmapValue } from "./value-charts.ts";
import type { MonthCode } from "./value-model.ts";
import {
  decideCount,
  pendingValueTotal,
  roadmapGroupKey,
  roadmapTotals,
  type AnyHubItem,
  type HubItem,
  type PendingValueTotal,
  type RoadmapTile,
} from "./views.ts";

// ─── Fasi ────────────────────────────────────────────────────────────

/** Le fasi della striscia, nell'ordine della pagina. */
export const OVERVIEW_STEP_KEYS = ["da_decidere", "approvati", "in_realizzazione", "realizzati"] as const;
export type OverviewStepKey = (typeof OVERVIEW_STEP_KEYS)[number];

/** Dove porta una fase della Panoramica: l'ancora della sua sezione. «Da decidere» apre la sua vista. */
export const OVERVIEW_STEP_TARGET: Readonly<Record<Exclude<OverviewStepKey, "da_decidere">, string>> = Object.freeze({
  approvati: PANORAMA_SECTION_ID.approvati,
  in_realizzazione: PANORAMA_SECTION_ID.inRealizzazione,
  realizzati: PANORAMA_SECTION_ID.realizzati,
});

export interface OverviewStep {
  key: OverviewStepKey;
  /** Quanti use case; null per «In valutazione» dei contributori, che non ha contatore. */
  count: number | null;
}

const STEP_PHASE: Readonly<Record<Exclude<OverviewStepKey, "da_decidere">, Phase>> = {
  approvati: "approvato",
  in_realizzazione: "in_realizzazione",
  realizzati: "realizzato",
};

/**
 * Le quattro fasi, dagli use case della pagina (già filtrati, come le corsie). «Da decidere» è il
 * numero del selettore (`decide`), ai contributori null; le altre contano la fase, «Realizzato» con
 * i due sotto-stati (realizzato e diffusa).
 */
export function overviewSteps(items: readonly AnyHubItem[], opts: { reviewer: boolean; decide: number }): OverviewStep[] {
  return OVERVIEW_STEP_KEYS.map((key) =>
    key === "da_decidere"
      ? { key, count: opts.reviewer ? opts.decide : null }
      : { key, count: items.filter((item) => item.phase === STEP_PHASE[key]).length },
  );
}

// ─── Cifre ───────────────────────────────────────────────────────────

export interface OverviewFigures {
  /** «valore contato all'anno»: `roadmapTotals().expectedValue`. */
  value: RoadmapTile | null;
  /** «costo di avvio»: `roadmapTotals().committedCost`. */
  cost: RoadmapTile | null;
  /** «use case in questo trimestre»: quanti nella corsia, scaduti compresi; null senza. */
  quarter: { count: number; quarter: QuarterCode } | null;
  /** «fino a … valore da misurare all'anno». */
  pending: PendingValueTotal | null;
}

/** Le cifre in testa, solo per i revisori, dagli use case della pagina. null senza nessuna cifra. */
export function overviewFigures(items: readonly HubItem[], today: string): OverviewFigures | null {
  const totals = roadmapTotals(items);
  const lane = buildLanes(items, today).lanes.find((entry) => entry.key === "questo_trimestre");
  const count = lane?.entries.length ?? 0;
  const figures: OverviewFigures = {
    value: totals.expectedValue,
    cost: totals.committedCost,
    quarter: count > 0 ? { count, quarter: quarterOfDate(today) } : null,
    pending: pendingValueTotal(items),
  };
  return figures.value || figures.cost || figures.quarter || figures.pending ? figures : null;
}

// ─── Su tutto il portafoglio ─────────────────────────────────────────

export interface PortfolioLine {
  /** Le ore contate all'anno; null se nessuna scheda ne libera. */
  hours: number | null;
  /** Il mese del pareggio, «subito», oltre l'ultimo mese della curva; null se la curva resta a zero. */
  breakeven: { kind: "mese" | "oltre"; month: MonthCode } | { kind: "subito" } | null;
}

/** Le ore e il pareggio di `buildRoadmapValue` su tutto il workspace. null senza né l'una né l'altro. */
export function portfolioLine(value: RoadmapValue | null): PortfolioLine | null {
  if (!value) return null;
  const hours = value.cards.some((card) => card.hours > 0) ? value.hours : null;
  let breakeven: PortfolioLine["breakeven"] = null;
  if (value.curve.breakevenMonth) breakeven = { kind: "mese", month: value.curve.breakevenMonth };
  else if (value.breakevenText === BREAKEVEN_NOW) breakeven = { kind: "subito" };
  else if (value.breakevenText !== null) breakeven = { kind: "oltre", month: value.curve.months[value.curve.months.length - 1] };
  return hours === null && breakeven === null ? null : { hours, breakeven };
}

// ─── Prossimo passo ──────────────────────────────────────────────────

export type OverviewNextStep =
  | { kind: "requisiti"; quarter: QuarterCode; toAsk: number; toVerify: number; blocked: number }
  | { kind: "decisioni"; count: number };

/**
 * Il prossimo passo di tutto il workspace (`items`: le schede dei revisori, senza filtri), con
 * regole fisse:
 * 1. i requisiti degli use case approvati per questo trimestre (non quelli già partiti, scaduti o di
 *    altri trimestri: gli stessi che prende il filtro `trimestre` di «Cosa serve») da chiedere, da
 *    verificare o bloccati, con i tre conteggi: sono quelli della riga sotto «Requisiti» di «Cosa
 *    serve» del trimestre, dove porta il pulsante («T4 2026 · 67 aperti · 40 da chiedere · 17 in
 *    attesa · 2 da verificare · 8 bloccati · 1 a posto»), e la frase li nomina tutti;
 * 2. altrimenti gli use case che aspettano una decisione (`decideCount`);
 * 3. altrimenti null: niente riquadro.
 * Ogni requisito conta una volta, anche se serve a più use case (`needAskCountsOf`). `needs` null
 * (chi non le legge): solo la regola 2.
 */
export function overviewNextStep(i: { items: readonly HubItem[]; needs: readonly NeedView[] | null; today: string }): OverviewNextStep | null {
  const starting = new Set(
    i.items.filter((item) => item.phase === "approvato" && roadmapGroupKey(item.targetQuarter, i.today) === "questo_trimestre").map((item) => item.id.toLowerCase()),
  );
  if (i.needs && starting.size > 0) {
    const counts = needAskCountsOf(i.needs, starting);
    if (counts.toAsk + counts.toVerify + counts.blocked > 0) {
      return { kind: "requisiti", quarter: quarterOfDate(i.today), toAsk: counts.toAsk, toVerify: counts.toVerify, blocked: counts.blocked };
    }
  }
  const count = decideCount(i.items);
  return count > 0 ? { kind: "decisioni", count } : null;
}
