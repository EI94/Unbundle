/**
 * La testa della Panoramica (rilascio «Panoramica») e il prossimo passo del workspace (rilascio 10,
 * decisione D3): le fasi con i loro numeri, le cifre, la riga «Su tutto il portafoglio» e la regola
 * unica del passo. Qui solo numeri; i testi in `panoramica-top.tsx` e, per il passo, in
 * `src/lib/home/text.ts`.
 *
 * - **Fasi** (`overviewSteps`): «Da decidere» con il contatore del selettore (ai contributori senza),
 *   poi quanti use case approvati, in realizzazione e realizzati (anche «diffusa»). Ogni fase porta
 *   alla sua vista o alla sua sezione della Panoramica (`OVERVIEW_STEP_TARGET`).
 * - **Cifre** (`overviewFigures`): le cifre di prima, non conti nuovi. Valore e costo da
 *   `roadmapTotals`, somme delle cifre delle card arrotondate una a una, gli use case di «Questo
 *   trimestre» quanti ne mostra la sua corsia (`buildLanes`, scaduti compresi), «fino a» la somma dei
 *   «fino a X €» delle card (`pendingValueTotal`).
 * - **Su tutto il portafoglio** (`portfolioLine`): le ore e il pareggio di `buildRoadmapValue`.
 * - **Prossimo passo del workspace** (`workspaceSteps`, D3): una regola sola per la Home e per la
 *   Panoramica, in quest'ordine: fornitori da autorizzare · use case da decidere · informazioni da
 *   chiedere per il trimestre · risposte da verificare · SAL dovuto. Prima ciò che blocca altre
 *   persone; niente: «Tutto in ordine».
 *
 * Art. 15.4: conteggi di use case o di esigenze, mai di persone; nessun conto per «Chi» o per parte.
 *
 * Modulo puro: solo import relativi `.ts`.
 */
import { buildLanes, PANORAMA_SECTION_ID } from "./lanes.ts";
import { askGroupOf, needAskCountsOf, type NeedView } from "./needs.ts";
import { quarterOfDate } from "./quarter.ts";
import type { Phase, QuarterCode } from "./types.ts";
import { BREAKEVEN_NOW, type RoadmapValue } from "./value-charts.ts";
import type { MonthCode } from "./value-model.ts";
import {
  isToDecide,
  pendingValueTotal,
  roadmapGroupKey,
  roadmapTotals,
  waitingDays,
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

// ─── Prossimo passo del workspace (D3) ───────────────────────────────

/** Il SAL è dovuto ogni 28 giorni dall'ultimo: «prossimo dal …» della Home. */
export const SAL_EVERY_DAYS = 28;

/** Le cinque regole del passo, nell'ordine di D3. */
export const WORKSPACE_STEP_KEYS = ["fornitori", "decidere", "chiedere", "verificare", "sal"] as const;
export type WorkspaceStepKey = (typeof WORKSPACE_STEP_KEYS)[number];

/**
 * Un passo del workspace. `mine`: tocca a chi guarda (pulsante pieno); altrimenti la riga «Tocca a …»
 * senza pulsante. Decidere, chiedere e verificare li fa ogni revisore (permissions.ts, D3 del 13/10).
 */
export type WorkspaceStep =
  | { key: "fornitori"; mine: boolean; /** Le informazioni da chiedere che l'ok tiene ferme. */ waiting: number }
  | { key: "decidere"; mine: true; count: number; /** I giorni d'attesa del più vecchio. */ oldestDays: number }
  | { key: "chiedere"; mine: true; count: number; quarter: QuarterCode }
  | { key: "verificare"; mine: true; count: number }
  | { key: "sal"; mine: boolean; /** Nessun SAL chiuso ancora. */ first: boolean; lastOn: string | null; /** Giorni dall'ultimo; null al primo. */ days: number | null };

export interface WorkspaceStepInput {
  /** Le schede dei revisori, senza filtri (`listHubItems`). */
  items: readonly HubItem[];
  /** Le esigenze del workspace (`listWorkspaceNeeds`); null: non lette, niente regole 1, 3 e 4. */
  needs: readonly Pick<NeedView, "id" | "type" | "status" | "archivedAt" | "useCaseIds">[] | null;
  /** `AAAA-MM-GG` a Roma. */
  today: string;
  /**
   * L'ok sui fornitori (sub-responsabili), solo dove «Chiedi al referente» è acceso: senza, le domande al
   * referente non partono. `canAuthorize`: chi guarda lo può dare. null: la funzione è spenta o la lettura
   * non è riuscita, e la regola 1 non vale.
   */
  suppliers: { authorized: boolean; canAuthorize: boolean } | null;
  /** Il SAL del Programma: l'ultimo chiuso e se chi guarda lo può chiudere. null senza Programma. */
  sal: { lastOn: string | null; canClose: boolean } | null;
}

/** Giorni da `a` a `b` (`AAAA-MM-GG`), mai negativi. */
function daysFrom(a: string, b: string): number {
  return waitingDays(a, b);
}

/** Il giorno `AAAA-MM-GG` `n` giorni dopo `iso`. */
export function addDays(iso: string, n: number): string {
  const at = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  at.setUTCDate(at.getUTCDate() + n);
  return at.toISOString().slice(0, 10);
}

/** Da quando il prossimo SAL è dovuto: l'ultimo più `SAL_EVERY_DAYS`. null senza un SAL chiuso. */
export function nextSalFrom(lastOn: string | null): string | null {
  return lastOn ? addDays(lastOn, SAL_EVERY_DAYS) : null;
}

/** Le fasi del Programma: approvato, in realizzazione, realizzato (`programStageOf`). */
const PROGRAM_PHASES: readonly Phase[] = ["approvato", "in_realizzazione", "realizzato"];

/**
 * Il SAL è dovuto: il primo appena il Programma ha uno use case (approvato, in realizzazione o realizzato),
 * poi dopo `SAL_EVERY_DAYS` giorni dall'ultimo.
 */
export function salDue(lastOn: string | null, today: string, items: readonly Pick<HubItem, "phase">[]): boolean {
  if (lastOn === null) return items.some((item) => PROGRAM_PHASES.includes(item.phase));
  return daysFrom(lastOn, today) >= SAL_EVERY_DAYS;
}

/** I requisiti non archiviati del workspace per gruppo: gli stessi conteggi di «Cosa serve» senza filtri. */
function requirementCounts(needs: NonNullable<WorkspaceStepInput["needs"]>): { toAsk: number; toVerify: number } {
  let toAsk = 0;
  let toVerify = 0;
  const seen = new Set<string>();
  for (const need of needs) {
    if (need.type !== "requisito" || need.archivedAt) continue;
    const id = need.id.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    const group = askGroupOf(need.status);
    if (group === "toAsk") toAsk += 1;
    else if (group === "toVerify") toVerify += 1;
  }
  return { toAsk, toVerify };
}

/**
 * I passi del workspace che valgono adesso, nell'ordine di D3 (il primo è il pulsante della Home e della
 * Panoramica, il secondo il «Poi: …» del suo «?»):
 * 1. **fornitori**: manca l'ok e tiene ferme le domande al referente, cioè c'è almeno un'informazione da
 *    chiedere nel workspace;
 * 2. **decidere**: gli use case che aspettano una decisione (`decideCount`: «Serve info» aspetta chi ha
 *    proposto), con i giorni del più vecchio;
 * 3. **chiedere**: le informazioni da chiedere degli use case approvati per questo trimestre (non quelli già
 *    partiti, scaduti o di altri trimestri: gli stessi del filtro `trimestre` di «Cosa serve»), ognuna una volta;
 * 4. **verificare**: le risposte da verificare, in tutto il workspace (la riga dei conteggi di «Cosa serve»);
 * 5. **sal**: il SAL dovuto (`salDue`).
 * Nessun passo: «Tutto in ordine».
 */
export function workspaceSteps(i: WorkspaceStepInput): WorkspaceStep[] {
  const steps: WorkspaceStep[] = [];
  const open = i.needs ? requirementCounts(i.needs) : null;
  if (i.suppliers && !i.suppliers.authorized && open && open.toAsk > 0) {
    steps.push({ key: "fornitori", mine: i.suppliers.canAuthorize, waiting: open.toAsk });
  }
  const deciding = i.items.filter((item) => isToDecide(item) && item.subState !== "serve_info");
  if (deciding.length > 0) {
    const oldestDays = Math.max(...deciding.map((item) => waitingDays(item.waitingSince, i.today)));
    steps.push({ key: "decidere", mine: true, count: deciding.length, oldestDays });
  }
  if (i.needs) {
    const starting = new Set(
      i.items.filter((item) => item.phase === "approvato" && roadmapGroupKey(item.targetQuarter, i.today) === "questo_trimestre").map((item) => item.id.toLowerCase()),
    );
    const toAsk = starting.size > 0 ? needAskCountsOf(i.needs, starting).toAsk : 0;
    if (toAsk > 0) steps.push({ key: "chiedere", mine: true, count: toAsk, quarter: quarterOfDate(i.today) });
  }
  if (open && open.toVerify > 0) steps.push({ key: "verificare", mine: true, count: open.toVerify });
  if (i.sal && salDue(i.sal.lastOn, i.today, i.items)) {
    steps.push({ key: "sal", mine: i.sal.canClose, first: i.sal.lastOn === null, lastOn: i.sal.lastOn, days: i.sal.lastOn === null ? null : daysFrom(i.sal.lastOn, i.today) });
  }
  return steps;
}

/** Il prossimo passo del workspace (D3): il primo di `workspaceSteps`; null: «Tutto in ordine». */
export function workspaceNextStep(i: WorkspaceStepInput): WorkspaceStep | null {
  return workspaceSteps(i)[0] ?? null;
}
