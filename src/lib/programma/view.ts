/**
 * La pagina «Programma» (rilascio 7) a partire dai dati letti: un solo oggetto, già calcolato, che il
 * componente disegna e il PDF del SAL scrive. Qui niente database: `src/lib/db/queries/program.ts` legge e
 * chiama `buildProgramView`.
 *
 * Che cosa arriva al browser: numeri aggregati, codici e titoli degli use case (i revisori li vedono già),
 * conteggi di risposte sopra soglia. Mai una persona, mai la percentuale dello sviluppo di Lateral Space né
 * come si divide il canone, tranne a Lateral Space (`ls`). Mai parole come «quota» o «fee» (test).
 *
 * Modulo puro: import relativi `.ts`.
 */
import { shownPerYear } from "../use-cases/format.ts";
import { quarterOfDate } from "../use-cases/quarter.ts";
import { decideCount, roadmapGroupKey, type HubItem } from "../use-cases/views.ts";
import type { MonthCode, ValueParams } from "../use-cases/value-model.ts";
import type { GoalCheckinKind, ProgramFactSource } from "../db/use-case-hub-program-ddl.ts";
import {
  programCards,
  programCurve,
  supportOfMonth,
  supportPerYearByCard,
  type ProgramCard,
  type ProgramCosts,
  type ProgramCurve,
  type ProgramStage,
  type Scenario,
} from "./curve.ts";
import { agentsToReview, aiNativeIndex, levelDistribution, programInitiatives, programResults, PEOPLE_THRESHOLD, type AiNativeIndex, type IndexWeights, type LevelDistribution, type ProgramResults } from "./figures.ts";
import { WEEKLY_USE_KPI, kpiRows, kpiSnapshotValues, type KpiRow, type ProgramMetrics, type StoredKpi, type StoredKpiValue } from "./kpis.ts";

// ─── Ingresso ────────────────────────────────────────────────────────

export interface ProgramSettings {
  employees: number | null;
  employeesSource: ProgramFactSource | null;
  revenueEur: number | null;
  revenueSource: ProgramFactSource | null;
  costs: ProgramCosts;
  weights: Partial<IndexWeights> | null;
  asks: Array<{ id: string; text: string }>;
  lastSalOn: string | null;
  updatedAt: string | null;
}

export interface TrainingTotals {
  /** Persone distinte presenti ad almeno una sessione. */
  trained: number;
  /** Ore d'aula erogate. */
  hours: number;
  sessions: number;
  /** Esercitazioni completate (partecipazioni con tutte le esercitazioni). */
  exercises: number;
}

export interface ReadinessInput {
  /** La soglia del questionario. */
  threshold: number;
  /** Risposte inviate. */
  respondents: number;
  thresholdMet: boolean;
  /** Da 0 a 5. */
  overall: number | null;
  pillars: Record<string, number | null>;
  /** Il livello (0-5) di ogni risposta inviata: solo per la distribuzione. */
  levels: number[];
  areas: Array<{ unit: string; respondents: number; met: boolean; pillars: Record<string, number | null> }>;
}

export interface GoalInput {
  id: string;
  parentId: string | null;
  type: "goal" | "objective" | "key_result";
  title: string;
  direction: "increase" | "decrease" | "maintain" | null;
  targetValue: number | null;
  currentValue: number | null;
  kpiUnit: string | null;
  timeframe: string | null;
}

export interface CheckinInput {
  goalId: string;
  kind: GoalCheckinKind;
  value: number;
  recordedOn: string;
}

export interface SnapshotInput {
  kind: "mese" | "sal";
  period: string;
  metrics: Record<string, unknown>;
}

export interface ProgramInput {
  workspaceId: string;
  companyName: string;
  /** `AAAA-MM-GG` a Roma. */
  today: string;
  items: readonly HubItem[];
  params: ValueParams;
  settings: ProgramSettings;
  training: TrainingTotals | null;
  readiness: ReadinessInput | null;
  goals: readonly GoalInput[];
  checkins: readonly CheckinInput[];
  krLinks: ReadonlyArray<{ useCaseId: string; keyResultId: string }>;
  kpis: readonly StoredKpi[];
  kpiValues: readonly StoredKpiValue[];
  snapshots: readonly SnapshotInput[];
  viewer: { isLateralSpace: boolean; canEdit: boolean };
}

// ─── Uscita ──────────────────────────────────────────────────────────

/** Una scheda come la vede la pagina: niente modello, niente come è calcolato lo sviluppo. */
export interface ViewCard {
  id: string;
  code: string | null;
  title: string;
  stage: ProgramStage;
  value: number;
  oneoff: number;
  lsDev: number;
  run: number;
  /** La parte del canone di Lateral Space all'anno, al ritmo di oggi. */
  supportYear: number;
  goLiveMonth: MonthCode;
  quarter: string | null;
  /** Il link alla scheda nel pannello della pagina «Use case». */
  href: string;
}

export interface ViewCurve {
  months: MonthCode[];
  value: number[];
  cost: number[];
  today: number;
  breakeven: ProgramCurve["breakeven"];
  /** Il mese per mese, per la tabella del pannello. */
  monthly: ProgramCurve["monthly"];
}

export interface ViewKeyResult {
  id: string;
  title: string;
  unit: string;
  direction: GoalInput["direction"];
  base: number | null;
  now: number | null;
  target: number | null;
  progress: number | null;
  /** Gli aggiornamenti, dal più vecchio. */
  checkins: Array<{ on: string; value: number }>;
  useCases: Array<{ id: string; code: string | null; title: string }>;
  kpi: { id: string; label: string } | null;
}

export interface ViewObjective {
  id: string;
  title: string;
  timeframe: string | null;
  goal: string | null;
  keyResults: ViewKeyResult[];
}

export interface SalChange {
  key: "valore_stimato" | "valore_in_uso" | "indice_ai_native" | "use_case_in_uso" | "use_case_in_realizzazione" | "persone_formate" | "agenti_da_rivedere";
  from: number;
  to: number;
}

export type NextStep =
  | { kind: "dipendenti" }
  | { kind: "decisioni"; count: number }
  | { kind: "avviare"; count: number; quarter: string }
  | { kind: "rivedere"; title: string; id: string }
  | { kind: "primo_sal" };

export interface ProgramView {
  workspaceId: string;
  companyName: string;
  today: string;
  viewer: { isLateralSpace: boolean; canEdit: boolean };
  company: { employees: number | null; employeesSource: ProgramFactSource | null; revenueEur: number | null; revenueSource: ProgramFactSource | null };
  results: ProgramResults;
  index: AiNativeIndex;
  /** I quattro riquadri all'ultimo SAL (o null senza SAL), per il delta. */
  lastSal: { on: string; estimated: number | null; inUse: number | null; perEmployee: number | null; index: number | null } | null;
  /** Le fotografie mensili dei quattro risultati, per le linee piccole e il pannello. */
  trend: Array<{ period: string; estimated: number | null; inUse: number | null; perEmployee: number | null; index: number | null }>;
  curve: Record<Scenario, ViewCurve>;
  costs: {
    /** Costo cumulato fino all'inizio del mese di oggi. */
    toDate: number;
    valueToDate: number;
    /** Il mantenimento all'anno degli use case in uso. */
    runInUse: number;
    /** L'avvio degli use case non ancora in uso. */
    buildPlanned: number;
    /** Il canone di Lateral Space: al mese oggi, fino a oggi, all'anno al ritmo di oggi; null senza canone. */
    support: { monthNow: number; toDate: number; perYear: number; from: string | null; to: string | null } | null;
    /** Lo sviluppo di Lateral Space, sommato. */
    lsDev: number;
    /** Use case con un valore o un costo, su tutti gli approvati, in realizzazione e realizzati. */
    coverage: { counted: number; total: number };
  };
  initiatives: Array<{ stage: ProgramStage; count: number; value: number; oneoff: number; run: number; lsDev: number; cards: ViewCard[] }>;
  review: Array<{ id: string; code: string | null; title: string; value: number; run: number; ratio: number; href: string }>;
  people: {
    training: TrainingTotals | null;
    /** Persone formate sui dipendenti, da 0 a 100; null senza dipendenti o formazione. */
    trainedPct: number | null;
    weeklyUsePct: number | null;
    levels: LevelDistribution | null;
    readiness: { respondents: number; overall: number; pillars: Record<string, number | null> } | null;
    areas: Array<{ unit: string; respondents: number; pillars: Record<string, number | null> }>;
  };
  objectives: ViewObjective[];
  kpis: KpiRow[];
  sal: { lastOn: string | null; changes: SalChange[] };
  nextSteps: NextStep[];
  asks: Array<{ id: string; text: string }>;
  /** Le metriche di adesso: le scrive anche la fotografia del mese. */
  metrics: ProgramMetrics;
  /** Solo a Lateral Space: le impostazioni dei costi e dei pesi. */
  ls: {
    supportMonthEur: number | null;
    supportFrom: string | null;
    supportTo: string | null;
    devPct: number | null;
    weights: IndexWeights;
    caseDev: Array<{ id: string; code: string | null; title: string; stage: ProgramStage; value: number; mode: "percentuale" | "importo" | null; amountEur: number | null; lsDev: number; missingPct: boolean }>;
  } | null;
}

// ─── Calcolo ─────────────────────────────────────────────────────────

const caseHref = (workspaceId: string, id: string) => `/dashboard/${workspaceId}/use-cases?apri=${encodeURIComponent(id)}`;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function viewCurve(curve: ProgramCurve): ViewCurve {
  return { months: curve.months, value: curve.value, cost: curve.cost, today: curve.today, breakeven: curve.breakeven, monthly: curve.monthly };
}

/** Il valore misurato: le card con il valore all'anno dal dossier del caso. */
function measuredValue(items: readonly HubItem[], cards: readonly ProgramCard[]): number {
  const ids = new Set(cards.map((c) => c.id));
  return items.filter((item) => ids.has(item.id) && shownPerYear(item.value)?.source === "dossier").reduce((sum, item) => sum + (shownPerYear(item.value)?.amount ?? 0), 0);
}

function keyResultsOf(input: ProgramInput, kpis: readonly KpiRow[]): ViewObjective[] {
  const byId = new Map(input.goals.map((g) => [g.id, g]));
  const children = (id: string) => input.goals.filter((g) => g.parentId === id);
  const itemById = new Map(input.items.map((item) => [item.id.toLowerCase(), item]));
  const kr = (g: GoalInput): ViewKeyResult => {
    const own = input.checkins.filter((c) => c.goalId === g.id).sort((a, b) => a.recordedOn.localeCompare(b.recordedOn));
    const base = own.find((c) => c.kind === "base")?.value ?? null;
    const updates = own.filter((c) => c.kind === "aggiornamento");
    const now = updates.at(-1)?.value ?? g.currentValue;
    const target = g.targetValue;
    let progress: number | null = null;
    if (base !== null && now !== null && target !== null && base !== target) {
      const raw = g.direction === "decrease" ? (base - now) / (base - target) : (now - base) / (target - base);
      progress = Number.isFinite(raw) ? Math.max(0, Math.min(100, raw * 100)) : null;
    }
    const kpi = kpis.find((k) => k.keyResultId === g.id) ?? null;
    return {
      id: g.id,
      title: g.title,
      unit: g.kpiUnit ?? "",
      direction: g.direction,
      base,
      now,
      target,
      progress,
      checkins: updates.map((c) => ({ on: c.recordedOn, value: c.value })),
      useCases: input.krLinks
        .filter((l) => l.keyResultId === g.id)
        .flatMap((l) => {
          const item = itemById.get(l.useCaseId.toLowerCase());
          return item ? [{ id: item.id, code: item.code, title: item.title }] : [];
        }),
      kpi: kpi ? { id: kpi.id, label: kpi.label } : null,
    };
  };
  const objectives: ViewObjective[] = [];
  for (const g of input.goals) {
    if (g.type !== "objective") continue;
    const parent = g.parentId ? byId.get(g.parentId) : null;
    objectives.push({ id: g.id, title: g.title, timeframe: g.timeframe, goal: parent?.type === "goal" ? parent.title : null, keyResults: children(g.id).filter((c) => c.type === "key_result").map(kr) });
  }
  // Risultati chiave appesi direttamente a un goal, o senza genitore: un obiettivo con il titolo del goal.
  const orphans = input.goals.filter((g) => g.type === "key_result" && !(g.parentId && byId.get(g.parentId)?.type === "objective"));
  const byParent = new Map<string, GoalInput[]>();
  for (const g of orphans) byParent.set(g.parentId ?? "", [...(byParent.get(g.parentId ?? "") ?? []), g]);
  for (const [parentId, list] of byParent) {
    const parent = parentId ? byId.get(parentId) : null;
    objectives.push({ id: parentId || "senza-obiettivo", title: parent?.title ?? "Altri risultati chiave", timeframe: parent?.timeframe ?? null, goal: null, keyResults: list.map(kr) });
  }
  return objectives.filter((o) => o.keyResults.length > 0);
}

function nextStepsOf(input: ProgramInput, cards: readonly ProgramCard[], review: ReturnType<typeof agentsToReview>, settings: ProgramSettings): NextStep[] {
  const steps: NextStep[] = [];
  if (!settings.employees) steps.push({ kind: "dipendenti" });
  if (review.length) steps.push({ kind: "rivedere", title: review[0].card.title, id: review[0].card.id });
  const decide = decideCount(input.items);
  if (decide > 0) steps.push({ kind: "decisioni", count: decide });
  // Gli approvati del trimestre di oggi (e scaduti) da avviare; altrimenti quelli del prossimo.
  const now = input.items.filter((item) => item.phase === "approvato" && ["questo_trimestre", "scaduti"].includes(roadmapGroupKey(item.targetQuarter, input.today)));
  const next = input.items.filter((item) => item.phase === "approvato" && roadmapGroupKey(item.targetQuarter, input.today) === "prossimo_trimestre");
  if (now.length) steps.push({ kind: "avviare", count: now.length, quarter: quarterOfDate(input.today) });
  else if (next.length) steps.push({ kind: "avviare", count: next.length, quarter: next[0].targetQuarter ?? quarterOfDate(input.today) });
  if (!settings.lastSalOn && cards.length) steps.push({ kind: "primo_sal" });
  return steps.slice(0, 4);
}

const SAL_KEYS: readonly SalChange["key"][] = ["valore_stimato", "valore_in_uso", "indice_ai_native", "use_case_in_uso", "use_case_in_realizzazione", "persone_formate", "agenti_da_rivedere"];

/** La pagina «Programma» dai dati letti. */
export function buildProgramView(input: ProgramInput): ProgramView {
  const { settings, params, today } = input;
  const cardsResult = programCards(input.items, params, settings.costs, today);
  const { cards } = cardsResult;
  const curves = {
    prudente: programCurve(cardsResult, params, settings.costs, today, "prudente"),
    base: programCurve(cardsResult, params, settings.costs, today, "base"),
    ambizioso: programCurve(cardsResult, params, settings.costs, today, "ambizioso"),
  };
  const base = curves.base;
  const results = programResults(cards, { employees: settings.employees, revenueEur: settings.revenueEur });
  const review = agentsToReview(cards);
  const supportYear = supportPerYearByCard(cardsResult, settings.costs, today);

  // KPI: prima le metriche senza indice (l'indice usa l'uso settimanale scritto a mano).
  const trained = input.training?.trained ?? null;
  const readinessMet = input.readiness && input.readiness.thresholdMet && input.readiness.respondents >= PEOPLE_THRESHOLD ? input.readiness : null;
  const baseMetrics = (index: number | null): ProgramMetrics => ({
    valore_stimato: results.estimated,
    valore_in_uso: results.inUse,
    valore_per_dipendente: results.perEmployee,
    valore_misurato_pct: results.estimated > 0 ? (measuredValue(input.items, cards) / results.estimated) * 100 : null,
    indice_ai_native: index,
    dipendenti: settings.employees,
    persone_formate: trained,
    persone_formate_pct: trained !== null && settings.employees ? Math.min(100, (trained / settings.employees) * 100) : null,
    ore_formazione: input.training?.hours ?? null,
    use_case_in_uso: cards.filter((c) => c.stage === "in_uso").length,
    use_case_in_realizzazione: cards.filter((c) => c.stage === "in_realizzazione").length,
    use_case_da_avviare: cards.filter((c) => c.stage === "da_avviare").length,
    agenti_da_rivedere: review.length,
    costo_cumulato: base.cost[base.today],
    valore_cumulato: base.value[base.today],
  });
  const monthly = input.snapshots.filter((s) => s.kind === "mese").sort((a, b) => a.period.localeCompare(b.period));
  const history = monthly.map((s) => ({ period: s.period, metrics: s.metrics as Record<string, number | null>, kpis: (s.metrics.kpis ?? {}) as Record<string, number | null> }));
  const preKpis = kpiRows(input.kpis, input.kpiValues, baseMetrics(null), history);
  const weeklyUsePct = preKpis.find((k) => k.key === WEEKLY_USE_KPI)?.now ?? null;
  const index = aiNativeIndex({
    cards,
    results,
    trained,
    employees: settings.employees,
    weeklyUsePct,
    readinessAdoption: readinessMet ? num(readinessMet.pillars.adoption) : null,
    weights: settings.weights,
  });
  const metrics = baseMetrics(index.value);
  const kpis = kpiRows(input.kpis, input.kpiValues, metrics, history);

  // SAL: l'ultimo SAL chiuso e cosa è cambiato da allora.
  const sals = input.snapshots.filter((s) => s.kind === "sal").sort((a, b) => a.period.localeCompare(b.period));
  // Il giorno di un SAL appena chiuso il confronto è con il SAL prima (il PDF esportato dopo «Chiudi il SAL»
  // dice cosa è cambiato da allora); senza un SAL prima, con quello di oggi.
  const lastSalSnap = (sals.at(-1)?.period === today && sals.length > 1 ? sals.at(-2) : sals.at(-1)) ?? null;
  const lastSal = lastSalSnap
    ? {
        on: lastSalSnap.period,
        estimated: num(lastSalSnap.metrics.valore_stimato),
        inUse: num(lastSalSnap.metrics.valore_in_uso),
        perEmployee: num(lastSalSnap.metrics.valore_per_dipendente),
        index: num(lastSalSnap.metrics.indice_ai_native),
      }
    : null;
  const changes: SalChange[] = lastSalSnap
    ? SAL_KEYS.flatMap((key) => {
        const from = num(lastSalSnap.metrics[key]);
        const to = metrics[key];
        return from !== null && to !== null && Math.round(from) !== Math.round(to) ? [{ key, from, to }] : [];
      })
    : [];

  const viewCard = (c: ProgramCard): ViewCard => ({
    id: c.id,
    code: c.code,
    title: c.title,
    stage: c.stage,
    value: c.value,
    oneoff: c.oneoff,
    lsDev: c.lsDev,
    run: c.run,
    // Come si divide il canone lo vede solo Lateral Space (§2): agli altri zero, che la pagina non mostra.
    supportYear: input.viewer.isLateralSpace ? (supportYear.get(c.id) ?? 0) : 0,
    goLiveMonth: c.goLiveMonth,
    quarter: c.targetQuarter,
    href: caseHref(input.workspaceId, c.id),
  });

  const support = settings.costs.supportMonthEur
    ? {
        monthNow: supportOfMonth(settings.costs, today.slice(0, 7) as MonthCode),
        toDate: base.monthly.slice(0, base.today).reduce((s, m) => s + m.support, 0),
        perYear: supportOfMonth(settings.costs, today.slice(0, 7) as MonthCode) * 12,
        from: settings.costs.supportFrom,
        to: settings.costs.supportTo,
      }
    : null;
  const programItems = input.items.filter((item) => ["approvato", "in_realizzazione", "realizzato"].includes(item.phase));

  const readinessShown = readinessMet && readinessMet.overall !== null ? { respondents: readinessMet.respondents, overall: readinessMet.overall, pillars: readinessMet.pillars } : null;

  return {
    workspaceId: input.workspaceId,
    companyName: input.companyName,
    today,
    viewer: input.viewer,
    company: { employees: settings.employees, employeesSource: settings.employeesSource, revenueEur: settings.revenueEur, revenueSource: settings.revenueSource },
    results,
    index,
    lastSal,
    trend: monthly.map((s) => ({
      period: s.period,
      estimated: num(s.metrics.valore_stimato),
      inUse: num(s.metrics.valore_in_uso),
      perEmployee: num(s.metrics.valore_per_dipendente),
      index: num(s.metrics.indice_ai_native),
    })),
    curve: { prudente: viewCurve(curves.prudente), base: viewCurve(base), ambizioso: viewCurve(curves.ambizioso) },
    costs: {
      toDate: base.cost[base.today],
      valueToDate: base.value[base.today],
      runInUse: cards.filter((c) => c.stage === "in_uso").reduce((s, c) => s + c.run, 0),
      buildPlanned: cards.filter((c) => c.stage !== "in_uso").reduce((s, c) => s + c.oneoff, 0),
      support,
      lsDev: cards.reduce((s, c) => s + c.lsDev, 0),
      coverage: { counted: cards.filter((c) => c.value > 0 || c.oneoff > 0 || c.run > 0).length, total: programItems.length },
    },
    initiatives: programInitiatives(cards).map((row) => ({ ...row, cards: row.cards.map(viewCard) })),
    review: review.map((r) => ({ id: r.card.id, code: r.card.code, title: r.card.title, value: r.card.value, run: r.card.run, ratio: r.ratio, href: caseHref(input.workspaceId, r.card.id) })),
    people: {
      training: input.training,
      trainedPct: metrics.persone_formate_pct,
      weeklyUsePct,
      levels: input.readiness ? levelDistribution(input.readiness.levels, input.readiness.threshold) : null,
      readiness: readinessShown,
      areas: (input.readiness?.areas ?? []).filter((a) => a.met && a.respondents >= PEOPLE_THRESHOLD).map((a) => ({ unit: a.unit, respondents: a.respondents, pillars: a.pillars })),
    },
    objectives: keyResultsOf(input, kpis),
    kpis,
    sal: { lastOn: settings.lastSalOn, changes },
    nextSteps: nextStepsOf(input, cards, review, settings),
    asks: settings.asks,
    metrics: { ...metrics },
    ls: input.viewer.isLateralSpace
      ? {
          supportMonthEur: settings.costs.supportMonthEur,
          supportFrom: settings.costs.supportFrom,
          supportTo: settings.costs.supportTo,
          devPct: settings.costs.devPct,
          weights: { ...{ persone: 25, use_case: 25, valore: 25, adozione: 25 }, ...index.pillars.reduce((w, p) => ({ ...w, [p.pillar]: p.weight }), {}) } as IndexWeights,
          caseDev: cards.map((c) => {
            const dev = settings.costs.caseDev.get(c.id.toLowerCase()) ?? null;
            return { id: c.id, code: c.code, title: c.title, stage: c.stage, value: c.value, mode: dev?.mode ?? null, amountEur: dev?.amountEur ?? null, lsDev: c.lsDev, missingPct: c.lsDevMissingPct };
          }),
        }
      : null,
  };
}

/** La fotografia del mese: le metriche e i valori dei KPI di adesso. */
export function snapshotMetrics(view: Pick<ProgramView, "metrics" | "kpis" | "curve">): Record<string, unknown> {
  const b = view.curve.base.breakeven;
  return { ...view.metrics, kpis: kpiSnapshotValues(view.kpis), pareggio: b?.kind === "mese" ? b.month : (b?.kind ?? null) };
}
