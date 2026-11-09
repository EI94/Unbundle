import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ensureDbSchema } from "@/lib/db/ensure-schema";
import {
  programCaseCosts,
  programKpis,
  programKpiValues,
  programSettings,
  programSnapshots,
  strategicGoalCheckins,
  strategicGoals,
  useCaseKrLinks,
  useCases,
} from "@/lib/db/schema";
import { PROGRAM_LIMITS, PROGRAM_PROBE_SQL, type ProgramFactSource, type ProgramKpiDirection, type ProgramKpiKind } from "@/lib/db/use-case-hub-program-ddl";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { listHubItems, viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { getAiReadinessDashboard, getLatestAssessmentBundleByWorkspace, listResponsesByAssessment } from "@/lib/db/queries/ai-readiness";
import { getStrategicGoalsByWorkspace } from "@/lib/db/queries/workspaces";
import { getMaturityLevel } from "@/lib/ai-readiness/scoring";
import { logSafeError } from "@/lib/log/safe-error";
import { parseLsDomains } from "@/lib/uc/lateral-space";
import { cast, toStatement, ucSql } from "@/lib/uc/sql/statement";
import { lsReviewerRecipientsSql } from "@/lib/use-cases/case-alerts/sql";
import { abilitiesForUseCase, type UseCaseViewer } from "@/lib/use-cases/permissions";
import { romeToday } from "@/lib/use-cases/quarter";
import { hubWorkspacesAmong, isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import type { ServiceResult } from "@/lib/use-cases/types";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";
import type { Workspace } from "@/lib/db/schema";
import type { CaseDevCost, ProgramCosts } from "@/lib/programma/curve";
import type { IndexWeights } from "@/lib/programma/figures";
import { catalogKpi, isMetricKey, kpiKeyOf, parseFormula, type StoredKpi, type StoredKpiValue } from "@/lib/programma/kpis";
import type { LsCosts } from "@/lib/programma/inputs";
import { buildProgramView, snapshotMetrics, type ProgramInput, type ProgramSettings, type ProgramView, type ReadinessInput, type TrainingTotals } from "@/lib/programma/view";

/**
 * Rilascio 7 «Programma» sul database (drizzle/0029; docs/programma/RILASCIO-7-PROGETTO.md).
 *
 * - **Chi vede la pagina**: i revisori del workspace (decisione 4), solo con l'area «Use case» accesa.
 * - **Chi scrive**: dipendenti e ricavo, decisioni per la leadership, KPI, risultati chiave e «Chiudi il
 *   SAL» Lateral Space e chi gestisce il workspace (sponsor, responsabile della trasformazione); i costi di
 *   Lateral Space, lo sviluppo dei singoli use case e i pesi dell'indice solo Lateral Space. Il ruolo si
 *   rilegge a ogni scrittura.
 * - **Niente persone**: la formazione arriva come totali, l'AI Readiness come livelli aggregati sopra soglia.
 * - Art. 15.4: nessun ordinamento, conteggio o raggruppamento per persona.
 */

const LOG_SCOPE = "programma";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export const PROGRAM_ERRORS = Object.freeze({
  denied: "Non hai il permesso di cambiarlo.",
  invalid: "Controlla i campi evidenziati.",
  retry: "Non è stato salvato. Riprova tra poco.",
  notFound: "Non c'è più: aggiorna la pagina.",
  unavailable: "«Programma» non è ancora pronto su questo workspace.",
});

type Result<T> = ServiceResult<T>;
const denied = <T>(): Result<T> => ({ ok: false, error: "permesso_mancante", message: PROGRAM_ERRORS.denied });
const invalid = <T>(fieldErrors?: Record<string, string>): Result<T> => ({ ok: false, error: "dati_non_validi", message: PROGRAM_ERRORS.invalid, fieldErrors });
const retry = <T>(): Result<T> => ({ ok: false, error: "riprova", message: PROGRAM_ERRORS.retry });
const missing = <T>(): Result<T> => ({ ok: false, error: "non_trovato", message: PROGRAM_ERRORS.notFound });
const off = <T>(): Result<T> => ({ ok: false, error: "area_spenta", message: PROGRAM_ERRORS.unavailable });

// ─── La 0029 c'è ─────────────────────────────────────────────────────

let storeReady = false;

/** Vero se la 0029 è applicata (la stessa sonda di `ensureDbSchema`); una volta vero resta vero nel processo. */
export async function programStoreReady(): Promise<boolean> {
  if (storeReady) return true;
  try {
    await ensureDbSchema();
    const result = (await db.execute(sql`SELECT ${sql.raw(PROGRAM_PROBE_SQL)} AS ready`)) as unknown as { rows?: Array<{ ready?: unknown }> };
    storeReady = result.rows?.[0]?.ready === true;
  } catch (error) {
    logSafeError(LOG_SCOPE, "probe_failed", error);
    storeReady = false;
  }
  return storeReady;
}

// ─── Chi scrive ──────────────────────────────────────────────────────

/** Chi scrive, con il ruolo appena riletto. */
export interface ProgramActor {
  workspaceId: string;
  userId: string;
  role: string | null;
  isLateralSpace: boolean;
}

/** Programma: dipendenti e ricavo, decisioni, KPI, risultati chiave, SAL. */
export function canEditProgram(actor: Pick<ProgramActor, "role" | "isLateralSpace">): boolean {
  const abilities = abilitiesForUseCase({ userId: "", email: null, emailVerified: false, role: actor.role, isLateralSpace: actor.isLateralSpace });
  return abilities.isReviewer && (actor.isLateralSpace || canManageWorkspaceSettings(actor.role));
}

/** Solo Lateral Space: i suoi costi, lo sviluppo dei singoli use case, i pesi dell'indice. */
export function canEditLsCosts(actor: Pick<ProgramActor, "role" | "isLateralSpace">): boolean {
  const abilities = abilitiesForUseCase({ userId: "", email: null, emailVerified: false, role: actor.role, isLateralSpace: actor.isLateralSpace });
  return abilities.isReviewer && actor.isLateralSpace;
}

async function writable(actor: ProgramActor, rule: (a: ProgramActor) => boolean): Promise<Result<true>> {
  if (!isUuid(actor.workspaceId) || !isUuid(actor.userId)) return denied();
  if (!isUseCaseHubWorkspace(actor.workspaceId)) return off();
  if (!rule(actor)) return denied();
  if (!(await programStoreReady())) return off();
  return { ok: true, value: true };
}

// ─── Letture ─────────────────────────────────────────────────────────

const toNumber = (value: unknown): number | null => {
  if (value === null || value === undefined) return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
};

function weightsOf(value: unknown): Partial<IndexWeights> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const out: Partial<IndexWeights> = {};
  for (const key of ["persone", "use_case", "valore", "adozione"] as const) {
    const n = toNumber((value as Record<string, unknown>)[key]);
    if (n !== null) out[key] = n;
  }
  return out;
}

function asksOf(value: unknown): Array<{ id: string; text: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((a) =>
    a && typeof a === "object" && typeof (a as { id?: unknown }).id === "string" && typeof (a as { text?: unknown }).text === "string"
      ? [{ id: (a as { id: string }).id, text: (a as { text: string }).text }]
      : [],
  );
}

/** Le impostazioni del programma del workspace, con i costi di Lateral Space; vuote senza riga. */
export async function readProgramSettings(workspaceId: string): Promise<ProgramSettings> {
  const [[row], devRows] = await Promise.all([
    db.select().from(programSettings).where(eq(programSettings.workspaceId, workspaceId)).limit(1),
    db.select().from(programCaseCosts).where(eq(programCaseCosts.workspaceId, workspaceId)),
  ]);
  const caseDev = new Map<string, CaseDevCost>(devRows.map((r) => [r.useCaseId.toLowerCase(), { mode: r.mode, amountEur: toNumber(r.amountEur) }]));
  const costs: ProgramCosts = {
    supportMonthEur: toNumber(row?.supportMonthEur),
    supportFrom: (row?.supportFrom as ProgramCosts["supportFrom"]) ?? null,
    supportTo: (row?.supportTo as ProgramCosts["supportTo"]) ?? null,
    devPct: toNumber(row?.devPct),
    caseDev,
  };
  return {
    employees: row?.employees ?? null,
    employeesSource: row?.employeesSource ?? null,
    revenueEur: toNumber(row?.revenueEur),
    revenueSource: row?.revenueSource ?? null,
    costs,
    weights: weightsOf(row?.indexWeights),
    asks: asksOf(row?.leadershipAsks),
    lastSalOn: row?.lastSalOn ?? null,
    updatedAt: row?.updatedAt ? row.updatedAt.toISOString() : null,
  };
}

/** I totali della formazione del workspace, dal registro: mai una persona. null senza formazione. */
async function trainingTotals(workspace: Workspace, now: Date): Promise<TrainingTotals | null> {
  // La stessa regola di `learningEnabled()`; il registro si carica solo con la formazione accesa.
  if (process.env.LEARNING_ENABLED !== "true") return null;
  try {
    const { getTrainingRegister } = await import("@/lib/learning/register");
    const register = await getTrainingRegister({ programIds: null, workspace }, { now });
    if (!register.programs.length) return null;
    const t = register.totals;
    return { trained: t.peopleAttended, hours: t.hoursDelivered, sessions: t.sessionsHeld, exercises: t.allExercises };
  } catch (error) {
    logSafeError(LOG_SCOPE, "training_failed", error, { workspaceId: workspace.id });
    return null;
  }
}

/** L'AI Readiness più recente del workspace, aggregata; i livelli delle risposte solo per la distribuzione. */
async function readinessOf(workspaceId: string): Promise<ReadinessInput | null> {
  try {
    const bundle = await getLatestAssessmentBundleByWorkspace(workspaceId);
    if (!bundle) return null;
    const [dashboard, responses] = await Promise.all([getAiReadinessDashboard(bundle.assessment.id), listResponsesByAssessment(bundle.assessment.id)]);
    if (!dashboard) return null;
    const levels = responses
      .filter((r) => r.status === "submitted")
      .flatMap((r) => {
        const index = (r.derivedScores as { readinessIndex?: unknown } | null)?.readinessIndex;
        const level = getMaturityLevel(typeof index === "number" ? index : null);
        return level ? [level.level] : [];
      });
    return {
      threshold: bundle.assessment.aggregationThreshold,
      respondents: dashboard.responseCount,
      thresholdMet: dashboard.aggregationThresholdMet,
      overall: dashboard.overallScore,
      pillars: dashboard.pillarScores,
      levels,
      areas: dashboard.units
        .filter((u) => u.unit !== "Non specificata" && u.unit !== "Privacy deleted")
        .map((u) => ({ unit: u.unit, respondents: u.respondentCount, met: u.aggregationThresholdMet, pillars: u.pillarScores })),
    };
  } catch (error) {
    logSafeError(LOG_SCOPE, "readiness_failed", error, { workspaceId });
    return null;
  }
}

async function goalsOf(workspaceId: string) {
  const [goals, checkins, links] = await Promise.all([
    getStrategicGoalsByWorkspace(workspaceId),
    db.select().from(strategicGoalCheckins).where(eq(strategicGoalCheckins.workspaceId, workspaceId)),
    db
      .select({ useCaseId: useCaseKrLinks.useCaseId, keyResultId: useCaseKrLinks.keyResultId })
      .from(useCaseKrLinks)
      .innerJoin(strategicGoals, eq(strategicGoals.id, useCaseKrLinks.keyResultId))
      .where(eq(strategicGoals.workspaceId, workspaceId)),
  ]);
  return {
    goals: goals.map((g) => ({
      id: g.id,
      parentId: g.parentId,
      type: g.type,
      title: g.title,
      direction: g.direction,
      targetValue: g.targetValue,
      currentValue: g.currentValue,
      kpiUnit: g.kpiUnit,
      timeframe: g.timeframe,
    })),
    checkins: checkins.map((c) => ({ goalId: c.goalId, kind: c.kind, value: c.value, recordedOn: c.recordedOn })),
    krLinks: links,
  };
}

async function kpisOf(workspaceId: string): Promise<{ kpis: StoredKpi[]; values: StoredKpiValue[] }> {
  const [kpis, values] = await Promise.all([
    db.select().from(programKpis).where(eq(programKpis.workspaceId, workspaceId)),
    db.select().from(programKpiValues).where(eq(programKpiValues.workspaceId, workspaceId)),
  ]);
  return {
    kpis: kpis.map((k) => ({
      id: k.id,
      key: k.key,
      label: k.label,
      unit: k.unit,
      kind: k.kind,
      source: k.source,
      formula: k.formula,
      base: k.baseValue,
      target: k.targetValue,
      direction: k.direction,
      keyResultId: k.keyResultId,
      position: k.position,
    })),
    values: values.map((v) => ({ kpiId: v.kpiId, period: v.period, value: v.value, source: v.source })),
  };
}

async function snapshotsOf(workspaceId: string) {
  const rows = await db.select().from(programSnapshots).where(eq(programSnapshots.workspaceId, workspaceId));
  return rows.map((r) => ({ kind: r.kind, period: r.period, metrics: r.metrics }));
}

/** I dati che servono a `buildProgramView`, per chi guarda (`viewer`) o per il cron. */
async function programInput(workspace: Workspace, viewer: UseCaseViewer, opts: { now: Date; canEdit: boolean }): Promise<ProgramInput | null> {
  const list = await listHubItems(workspace.id, viewer, { now: opts.now });
  if (!list || list.projection === "contributore") return null;
  const [settings, training, readiness, goals, kpis, snapshots] = await Promise.all([
    readProgramSettings(workspace.id),
    trainingTotals(workspace, opts.now),
    readinessOf(workspace.id),
    goalsOf(workspace.id),
    kpisOf(workspace.id),
    snapshotsOf(workspace.id),
  ]);
  return {
    workspaceId: workspace.id,
    companyName: workspace.name,
    today: list.today,
    items: list.items,
    params: list.valueParams,
    settings,
    training,
    readiness,
    goals: goals.goals,
    checkins: goals.checkins,
    krLinks: goals.krLinks,
    kpis: kpis.kpis,
    kpiValues: kpis.values,
    snapshots,
    viewer: { isLateralSpace: viewer.isLateralSpace, canEdit: opts.canEdit },
  };
}

export type ProgramPageRead = { status: "ok"; view: ProgramView } | { status: "non_pronto" } | { status: "nessuno" };

/**
 * La pagina per chi guarda. «nessuno»: non è un revisore, il workspace non ha l'area accesa o non esiste
 * (la pagina risponde «non trovata»). «non_pronto»: manca la 0029.
 */
export async function loadProgramPage(i: { workspace: Workspace; user: { id: string; email: string; emailVerified: boolean }; role: string; now?: Date }): Promise<ProgramPageRead> {
  if (!isUseCaseHubWorkspace(i.workspace.id)) return { status: "nessuno" };
  const viewer = viewerFromSession(i.user, i.role);
  if (!abilitiesForUseCase(viewer).isReviewer) return { status: "nessuno" };
  if (!(await programStoreReady())) return { status: "non_pronto" };
  const input = await programInput(i.workspace, viewer, { now: i.now ?? new Date(), canEdit: canEditProgram({ role: i.role, isLateralSpace: viewer.isLateralSpace }) });
  if (!input) return { status: "nessuno" };
  return { status: "ok", view: buildProgramView(input) };
}

/** Chi guarda il cron e il SAL: un gestore senza nome, che non è Lateral Space (nessuna impostazione di Lateral Space nel calcolo). */
const SYSTEM_VIEWER: UseCaseViewer = { userId: "00000000-0000-0000-0000-000000000000", email: null, emailVerified: false, role: "transformation_lead", isLateralSpace: false };

// ─── Scritture ───────────────────────────────────────────────────────

async function upsertSettings(actor: ProgramActor, set: Partial<typeof programSettings.$inferInsert>): Promise<void> {
  const now = new Date();
  await db
    .insert(programSettings)
    .values({ workspaceId: actor.workspaceId, ...set, updatedAt: now, updatedByUserId: actor.userId })
    .onConflictDoUpdate({ target: programSettings.workspaceId, set: { ...set, updatedAt: now, updatedByUserId: actor.userId } });
}

/**
 * Dipendenti e, se dato, il ricavo (`revenueEur`: undefined lo lascia com'è, null lo toglie), scritti a
 * mano dalla pagina.
 */
export async function saveCompanyFacts(actor: ProgramActor, facts: { employees?: number | null; revenueEur?: number | null }): Promise<Result<true>> {
  const can = await writable(actor, canEditProgram);
  if (!can.ok) return can;
  const set: Partial<typeof programSettings.$inferInsert> = {};
  if (facts.employees !== undefined) {
    if (facts.employees !== null && !(Number.isInteger(facts.employees) && facts.employees >= 1 && facts.employees <= PROGRAM_LIMITS.employeesMax)) return invalid({ employees: "Numero non valido." });
    set.employees = facts.employees;
    set.employeesSource = facts.employees === null ? null : "manuale";
  }
  if (facts.revenueEur !== undefined) {
    if (facts.revenueEur !== null && !(Number.isInteger(facts.revenueEur) && facts.revenueEur >= 1 && facts.revenueEur <= PROGRAM_LIMITS.revenueEurMax)) return invalid({ revenue: "Numero non valido." });
    set.revenueEur = facts.revenueEur;
    set.revenueSource = facts.revenueEur === null ? null : "manuale";
  }
  if (!Object.keys(set).length) return { ok: true, value: true };
  try {
    await upsertSettings(actor, set);
    return { ok: true, value: true };
  } catch (error) {
    logSafeError(LOG_SCOPE, "facts_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/**
 * Dipendenti e ricavo dalla chat di Discovery (lo strumento `saveCompanyFacts` della chat): l'ultimo
 * scritto vale, e la pagina dice da dove viene. Senza la 0029 non scrive niente e lo dice.
 */
export async function saveCompanyFactsFromDiscovery(workspaceId: string, facts: { employees?: number | null; revenueEur?: number | null }): Promise<boolean> {
  if (!isUuid(workspaceId) || !(await programStoreReady())) return false;
  const set: Partial<typeof programSettings.$inferInsert> = {};
  const source: ProgramFactSource = "discovery";
  if (typeof facts.employees === "number" && Number.isInteger(facts.employees) && facts.employees >= 1 && facts.employees <= PROGRAM_LIMITS.employeesMax) {
    set.employees = facts.employees;
    set.employeesSource = source;
  }
  if (typeof facts.revenueEur === "number" && Number.isFinite(facts.revenueEur) && facts.revenueEur >= 1 && facts.revenueEur <= PROGRAM_LIMITS.revenueEurMax) {
    set.revenueEur = Math.round(facts.revenueEur);
    set.revenueSource = source;
  }
  if (!Object.keys(set).length) return false;
  try {
    const now = new Date();
    await db.insert(programSettings).values({ workspaceId, ...set, updatedAt: now }).onConflictDoUpdate({ target: programSettings.workspaceId, set: { ...set, updatedAt: now } });
    return true;
  } catch (error) {
    logSafeError(LOG_SCOPE, "discovery_facts_failed", error, { workspaceId });
    return false;
  }
}

/** I costi di Lateral Space: canone, periodo, percentuale dello sviluppo. Solo Lateral Space. */
export async function saveLsCosts(actor: ProgramActor, costs: LsCosts): Promise<Result<true>> {
  const can = await writable(actor, canEditLsCosts);
  if (!can.ok) return can;
  if (costs.supportFrom && costs.supportTo && costs.supportTo < costs.supportFrom) return invalid({ supportTo: "Il mese di fine viene prima di quello di inizio." });
  try {
    await upsertSettings(actor, {
      supportMonthEur: costs.supportMonthEur === null ? null : String(costs.supportMonthEur),
      supportFrom: costs.supportFrom,
      supportTo: costs.supportTo,
      devPct: costs.devPct === null ? null : String(costs.devPct),
    });
    return { ok: true, value: true };
  } catch (error) {
    logSafeError(LOG_SCOPE, "ls_costs_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/** Lo sviluppo di Lateral Space di uno use case del workspace: a percentuale, a importo, o niente (`mode` null). Solo Lateral Space. */
export async function saveCaseDev(actor: ProgramActor, useCaseId: string, dev: { mode: CaseDevCost["mode"] | null; amountEur: number | null }): Promise<Result<true>> {
  const can = await writable(actor, canEditLsCosts);
  if (!can.ok) return can;
  if (!isUuid(useCaseId)) return missing();
  if (dev.mode === "importo" && (dev.amountEur === null || dev.amountEur < 0 || dev.amountEur > PROGRAM_LIMITS.caseAmountEurMax)) return invalid({ amountEur: "Scrivi l'importo." });
  try {
    const [own] = await db.select({ id: useCases.id }).from(useCases).where(and(eq(useCases.id, useCaseId), eq(useCases.workspaceId, actor.workspaceId))).limit(1);
    if (!own) return missing();
    if (dev.mode === null) {
      await db.delete(programCaseCosts).where(and(eq(programCaseCosts.useCaseId, useCaseId), eq(programCaseCosts.workspaceId, actor.workspaceId)));
      return { ok: true, value: true };
    }
    const values = { mode: dev.mode, amountEur: dev.mode === "importo" ? String(dev.amountEur) : null, updatedAt: new Date(), updatedByUserId: actor.userId };
    await db
      .insert(programCaseCosts)
      .values({ useCaseId, workspaceId: actor.workspaceId, ...values })
      .onConflictDoUpdate({ target: programCaseCosts.useCaseId, set: values, setWhere: eq(programCaseCosts.workspaceId, actor.workspaceId) });
    return { ok: true, value: true };
  } catch (error) {
    logSafeError(LOG_SCOPE, "case_dev_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/** I pesi dell'indice AI-native. Solo Lateral Space. */
export async function saveIndexWeights(actor: ProgramActor, weights: IndexWeights): Promise<Result<true>> {
  const can = await writable(actor, canEditLsCosts);
  if (!can.ok) return can;
  const values = Object.values(weights);
  if (values.some((w) => !Number.isFinite(w) || w < 0 || w > 100) || values.every((w) => w === 0)) return invalid({ weights: "Pesi non validi." });
  try {
    await upsertSettings(actor, { indexWeights: { ...weights } });
    return { ok: true, value: true };
  } catch (error) {
    logSafeError(LOG_SCOPE, "weights_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/** Le decisioni per la leadership, tutte insieme. */
export async function saveLeadershipAsks(actor: ProgramActor, asks: Array<{ id: string; text: string }>): Promise<Result<true>> {
  const can = await writable(actor, canEditProgram);
  if (!can.ok) return can;
  if (asks.length > PROGRAM_LIMITS.asksMax || asks.some((a) => !a.text.trim() || a.text.length > PROGRAM_LIMITS.askText)) return invalid({ asks: "Decisioni non valide." });
  try {
    await upsertSettings(actor, { leadershipAsks: asks });
    return { ok: true, value: true };
  } catch (error) {
    logSafeError(LOG_SCOPE, "asks_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

async function workspaceRow(workspaceId: string): Promise<Workspace | null> {
  const { getWorkspaceById } = await import("@/lib/db/queries/workspaces");
  return (await getWorkspaceById(workspaceId)) ?? null;
}

async function upsertSnapshot(workspaceId: string, kind: "mese" | "sal", period: string, metrics: Record<string, unknown>): Promise<void> {
  const takenAt = new Date();
  await db
    .insert(programSnapshots)
    .values({ workspaceId, kind, period, metrics, takenAt })
    .onConflictDoUpdate({ target: [programSnapshots.workspaceId, programSnapshots.kind, programSnapshots.period], set: { metrics, takenAt } });
}

/** «Chiudi il SAL»: la fotografia di oggi come SAL, quella del mese, e il giorno dell'ultimo SAL. */
export async function closeSal(actor: ProgramActor, now: Date = new Date()): Promise<Result<{ on: string }>> {
  const can = await writable(actor, canEditProgram);
  if (!can.ok) return can;
  try {
    const workspace = await workspaceRow(actor.workspaceId);
    if (!workspace) return missing();
    const input = await programInput(workspace, SYSTEM_VIEWER, { now, canEdit: false });
    if (!input) return missing();
    const view = buildProgramView(input);
    const metrics = snapshotMetrics(view);
    const on = romeToday(now);
    await upsertSnapshot(actor.workspaceId, "sal", on, metrics);
    await upsertSnapshot(actor.workspaceId, "mese", on.slice(0, 7), metrics);
    await upsertSettings(actor, { lastSalOn: on });
    return { ok: true, value: { on } };
  } catch (error) {
    logSafeError(LOG_SCOPE, "sal_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

// ─── KPI ─────────────────────────────────────────────────────────────

async function nextPosition(workspaceId: string): Promise<number> {
  const [row] = await db.select({ max: sql<number | null>`max(${programKpis.position})` }).from(programKpis).where(eq(programKpis.workspaceId, workspaceId));
  return Math.min(32_000, (toNumber(row?.max) ?? -1) + 1);
}

/** Attiva un KPI del catalogo. Già attivo: niente da fare. */
export async function activateCatalogKpi(actor: ProgramActor, key: string): Promise<Result<{ id: string }>> {
  const can = await writable(actor, canEditProgram);
  if (!can.ok) return can;
  const entry = catalogKpi(key);
  if (!entry) return invalid({ key: "KPI sconosciuto." });
  try {
    const [found] = await db.select({ id: programKpis.id }).from(programKpis).where(and(eq(programKpis.workspaceId, actor.workspaceId), eq(programKpis.key, key))).limit(1);
    if (found) return { ok: true, value: { id: found.id } };
    const [row] = await db
      .insert(programKpis)
      .values({
        workspaceId: actor.workspaceId,
        key: entry.key,
        label: entry.label,
        unit: entry.unit,
        kind: entry.kind,
        source: entry.source,
        direction: entry.direction,
        position: await nextPosition(actor.workspaceId),
        updatedByUserId: actor.userId,
      })
      .onConflictDoNothing()
      .returning({ id: programKpis.id });
    if (row) return { ok: true, value: { id: row.id } };
    const [again] = await db.select({ id: programKpis.id }).from(programKpis).where(and(eq(programKpis.workspaceId, actor.workspaceId), eq(programKpis.key, key))).limit(1);
    return again ? { ok: true, value: { id: again.id } } : retry();
  } catch (error) {
    logSafeError(LOG_SCOPE, "kpi_activate_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/** Un KPI personalizzato con una formula, oppure a mano senza formula. */
export async function addCustomKpi(
  actor: ProgramActor,
  kpi: { label: string; unit: string; kind: ProgramKpiKind; direction: ProgramKpiDirection; formula: string | null },
): Promise<Result<{ id: string }>> {
  const can = await writable(actor, canEditProgram);
  if (!can.ok) return can;
  const label = kpi.label.replace(/\s+/g, " ").trim();
  const unit = kpi.unit.trim();
  if (!label || label.length > PROGRAM_LIMITS.kpiLabel) return invalid({ label: "Scrivi un nome (al massimo 120 caratteri)." });
  if (unit.length > PROGRAM_LIMITS.kpiUnit) return invalid({ unit: "Al massimo 16 caratteri." });
  try {
    const existing = await db.select({ key: programKpis.key }).from(programKpis).where(eq(programKpis.workspaceId, actor.workspaceId));
    const taken = new Set(existing.map((k) => k.key));
    const key = kpiKeyOf(label, taken);
    let formula: string | null = null;
    if (kpi.formula !== null && kpi.formula.trim()) {
      const parsed = parseFormula(kpi.formula, (k) => isMetricKey(k) || taken.has(k), key);
      if (!parsed.ok) return invalid({ formula: parsed.error });
      formula = kpi.formula.trim();
    }
    const [row] = await db
      .insert(programKpis)
      .values({
        workspaceId: actor.workspaceId,
        key,
        label,
        unit,
        kind: kpi.kind,
        source: formula ? "formula" : "manuale",
        formula,
        direction: kpi.direction,
        position: await nextPosition(actor.workspaceId),
        updatedByUserId: actor.userId,
      })
      .returning({ id: programKpis.id });
    return row ? { ok: true, value: { id: row.id } } : retry();
  } catch (error) {
    logSafeError(LOG_SCOPE, "kpi_custom_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/** Base, obiettivo e risultato chiave collegato di un KPI del workspace. */
export async function updateKpiTargets(actor: ProgramActor, kpiId: string, t: { base: number | null; target: number | null; keyResultId: string | null }): Promise<Result<true>> {
  const can = await writable(actor, canEditProgram);
  if (!can.ok) return can;
  if (!isUuid(kpiId) || (t.keyResultId !== null && !isUuid(t.keyResultId))) return missing();
  try {
    if (t.keyResultId) {
      const [kr] = await db
        .select({ id: strategicGoals.id })
        .from(strategicGoals)
        .where(and(eq(strategicGoals.id, t.keyResultId), eq(strategicGoals.workspaceId, actor.workspaceId), eq(strategicGoals.type, "key_result")))
        .limit(1);
      if (!kr) return missing();
    }
    const updated = await db
      .update(programKpis)
      .set({ baseValue: t.base, targetValue: t.target, keyResultId: t.keyResultId, updatedAt: new Date(), updatedByUserId: actor.userId })
      .where(and(eq(programKpis.id, kpiId), eq(programKpis.workspaceId, actor.workspaceId)))
      .returning({ id: programKpis.id });
    return updated.length ? { ok: true, value: true } : missing();
  } catch (error) {
    logSafeError(LOG_SCOPE, "kpi_targets_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/** Toglie un KPI del workspace (e i suoi valori). */
export async function removeKpi(actor: ProgramActor, kpiId: string): Promise<Result<true>> {
  const can = await writable(actor, canEditProgram);
  if (!can.ok) return can;
  if (!isUuid(kpiId)) return missing();
  try {
    const removed = await db.delete(programKpis).where(and(eq(programKpis.id, kpiId), eq(programKpis.workspaceId, actor.workspaceId))).returning({ id: programKpis.id });
    return removed.length ? { ok: true, value: true } : missing();
  } catch (error) {
    logSafeError(LOG_SCOPE, "kpi_remove_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/** Il valore di un KPI a mano per un mese (lo sostituisce se c'era). */
export async function recordKpiValue(actor: ProgramActor, kpiId: string, period: string, value: number, source: "manuale" | "brain" = "manuale"): Promise<Result<true>> {
  const can = await writable(actor, canEditProgram);
  if (!can.ok) return can;
  if (!isUuid(kpiId)) return missing();
  if (!/^[0-9]{4}-(0[1-9]|1[0-2])$/.test(period) || !Number.isFinite(value)) return invalid({ value: "Valore non valido." });
  try {
    const [kpi] = await db
      .select({ id: programKpis.id, source: programKpis.source })
      .from(programKpis)
      .where(and(eq(programKpis.id, kpiId), eq(programKpis.workspaceId, actor.workspaceId)))
      .limit(1);
    if (!kpi) return missing();
    if (kpi.source !== "manuale") return invalid({ value: "Questo KPI si calcola da solo." });
    const now = new Date();
    await db
      .insert(programKpiValues)
      .values({ kpiId, workspaceId: actor.workspaceId, period, value, source, recordedAt: now, recordedByUserId: actor.userId })
      .onConflictDoUpdate({ target: [programKpiValues.kpiId, programKpiValues.period], set: { value, source, recordedAt: now, recordedByUserId: actor.userId } });
    return { ok: true, value: true };
  } catch (error) {
    logSafeError(LOG_SCOPE, "kpi_value_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

// ─── Risultati chiave ────────────────────────────────────────────────

async function ownKeyResult(workspaceId: string, goalId: string): Promise<boolean> {
  if (!isUuid(goalId)) return false;
  const [kr] = await db
    .select({ id: strategicGoals.id })
    .from(strategicGoals)
    .where(and(eq(strategicGoals.id, goalId), eq(strategicGoals.workspaceId, workspaceId), eq(strategicGoals.type, "key_result")))
    .limit(1);
  return Boolean(kr);
}

/** La base di un risultato chiave (una sola: la sostituisce). */
export async function setKeyResultBase(actor: ProgramActor, goalId: string, value: number, on: string): Promise<Result<true>> {
  const can = await writable(actor, canEditProgram);
  if (!can.ok) return can;
  if (!Number.isFinite(value)) return invalid({ value: "Valore non valido." });
  try {
    if (!(await ownKeyResult(actor.workspaceId, goalId))) return missing();
    // Una base sola per risultato chiave: un'unica scrittura sull'indice parziale (due «Salva» insieme non litigano).
    await db
      .insert(strategicGoalCheckins)
      .values({ goalId, workspaceId: actor.workspaceId, kind: "base", value, recordedOn: on, recordedByUserId: actor.userId })
      .onConflictDoUpdate({
        target: strategicGoalCheckins.goalId,
        targetWhere: sql`kind = 'base'`,
        set: { value, recordedOn: on, recordedAt: new Date(), recordedByUserId: actor.userId },
      });
    return { ok: true, value: true };
  } catch (error) {
    logSafeError(LOG_SCOPE, "kr_base_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/** Un aggiornamento di un risultato chiave: entra nella storia e diventa il valore attuale della Strategia. */
export async function addKeyResultCheckin(actor: ProgramActor, goalId: string, value: number, on: string, note: string | null): Promise<Result<true>> {
  const can = await writable(actor, canEditProgram);
  if (!can.ok) return can;
  if (!Number.isFinite(value)) return invalid({ value: "Valore non valido." });
  if (note && note.length > PROGRAM_LIMITS.checkinNote) return invalid({ note: "Nota troppo lunga." });
  try {
    if (!(await ownKeyResult(actor.workspaceId, goalId))) return missing();
    await db.insert(strategicGoalCheckins).values({ goalId, workspaceId: actor.workspaceId, kind: "aggiornamento", value, recordedOn: on, note: note?.trim() || null, recordedByUserId: actor.userId });
    // Il valore della Strategia è l'aggiornamento più recente per giorno, come in «Programma» (un
    // aggiornamento con una data vecchia entra nella storia senza cambiare il valore di adesso).
    await db.execute(sql`UPDATE strategic_goals g SET current_value = latest.value
      FROM (SELECT value FROM strategic_goal_checkins WHERE goal_id = ${goalId}::uuid AND kind = 'aggiornamento' ORDER BY recorded_on DESC, recorded_at DESC LIMIT 1) latest
      WHERE g.id = ${goalId}::uuid AND g.workspace_id = ${actor.workspaceId}::uuid`);
    return { ok: true, value: true };
  } catch (error) {
    logSafeError(LOG_SCOPE, "kr_checkin_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

/** Collega (o scollega) uno use case del workspace a un risultato chiave: scrive `use_case_kr_links`. */
export async function linkUseCaseToKeyResult(actor: ProgramActor, goalId: string, useCaseId: string, linked: boolean): Promise<Result<true>> {
  const can = await writable(actor, canEditProgram);
  if (!can.ok) return can;
  if (!isUuid(useCaseId)) return missing();
  try {
    if (!(await ownKeyResult(actor.workspaceId, goalId))) return missing();
    const [own] = await db.select({ id: useCases.id }).from(useCases).where(and(eq(useCases.id, useCaseId), eq(useCases.workspaceId, actor.workspaceId))).limit(1);
    if (!own) return missing();
    if (linked) await db.insert(useCaseKrLinks).values({ useCaseId, keyResultId: goalId }).onConflictDoNothing();
    else await db.delete(useCaseKrLinks).where(and(eq(useCaseKrLinks.useCaseId, useCaseId), eq(useCaseKrLinks.keyResultId, goalId)));
    return { ok: true, value: true };
  } catch (error) {
    logSafeError(LOG_SCOPE, "kr_link_failed", error, { workspaceId: actor.workspaceId });
    return retry();
  }
}

// ─── Cron: fotografie del mese e «Da rivedere» ───────────────────────

/** Il tetto di tempo del passo «Programma» del cron (il cron ha 120 s; l'AI ne prende al massimo 90 dopo). */
export const PROGRAM_CRON_BUDGET_MS = 15_000;

export interface ProgramCronCounts {
  workspaces: number;
  snapshots: number;
  reviewNotices: number;
  errors: number;
}

/**
 * Il passo del cron di «Programma»: per ogni workspace con l'area accesa e almeno uno use case, la
 * fotografia del mese (sostituita ogni giorno, così resta quella di fine mese), e una riga «Da rivedere»
 * nella campanella dei revisori di Lateral Space per ogni use case in uso che rende poco (una volta sola
 * per persona e use case, mai più dopo). Si ferma prima di `budgetMs`.
 */
export async function runProgramCron(o: { env?: Readonly<Record<string, string | undefined>>; now?: Date; budgetMs?: number } = {}): Promise<ProgramCronCounts> {
  const env = o.env ?? process.env;
  const now = o.now ?? new Date();
  const started = Date.now();
  const budget = o.budgetMs ?? 30_000;
  const counts: ProgramCronCounts = { workspaces: 0, snapshots: 0, reviewNotices: 0, errors: 0 };
  if (!(await programStoreReady())) return counts;
  const rows = await db.selectDistinct({ workspaceId: useCases.workspaceId }).from(useCases);
  const ids = hubWorkspacesAmong(rows.map((r) => r.workspaceId), env);
  if (!ids.length) return counts;
  const lsDomains = parseLsDomains(env.UC_LS_EMAIL_DOMAINS);
  const { workspaces } = await import("@/lib/db/schema");
  const listed = await db.select().from(workspaces).where(inArray(workspaces.id, ids));
  // Prima i workspace senza fotografia del mese o con la più vecchia: se il tetto di tempo finisce, il giorno
  // dopo tocca agli altri.
  const taken = await db
    .select({ workspaceId: programSnapshots.workspaceId, takenAt: sql<string>`max(${programSnapshots.takenAt})` })
    .from(programSnapshots)
    .where(and(inArray(programSnapshots.workspaceId, ids), eq(programSnapshots.kind, "mese")))
    .groupBy(programSnapshots.workspaceId);
  const lastTaken = new Map(taken.map((t) => [t.workspaceId, Date.parse(String(t.takenAt))]));
  const list = [...listed].sort((a, b) => (lastTaken.get(a.id) ?? 0) - (lastTaken.get(b.id) ?? 0) || a.id.localeCompare(b.id));
  const today = romeToday(now);
  for (const workspace of list) {
    if (Date.now() - started > budget) break;
    counts.workspaces += 1;
    try {
      const input = await programInput(workspace, SYSTEM_VIEWER, { now, canEdit: false });
      if (!input) continue;
      const view = buildProgramView(input);
      await upsertSnapshot(workspace.id, "mese", today.slice(0, 7), snapshotMetrics(view));
      counts.snapshots += 1;
      if (view.review.length && lsDomains.length) counts.reviewNotices += await noticeReview(workspace.id, view.review.map((r) => r.id), lsDomains, today);
    } catch (error) {
      counts.errors += 1;
      logSafeError(LOG_SCOPE, "cron_workspace_failed", error, { workspaceId: workspace.id });
    }
  }
  return counts;
}

/** Le righe «Da rivedere» per i revisori di Lateral Space del workspace: una per persona e use case, mai due. */
async function noticeReview(workspaceId: string, useCaseIds: readonly string[], lsDomains: readonly string[], today: string): Promise<number> {
  const executor = await getAppUcExecutor();
  const [rows] = await executor.batch([
    toStatement(ucSql`INSERT INTO use_case_notifications (workspace_id, use_case_id, recipient_user_id, kind, rome_day)
SELECT ${cast(workspaceId, "uuid")}, u.id, r.user_id, 'da_rivedere', ${cast(today, "date")}
FROM use_cases u
CROSS JOIN LATERAL (${lsReviewerRecipientsSql(cast(workspaceId, "uuid"), null, lsDomains)}) r
WHERE u.workspace_id = ${cast(workspaceId, "uuid")} AND u.id = ANY(${cast([...useCaseIds], "uuid[]")})
  AND NOT EXISTS (SELECT 1 FROM use_case_notifications n WHERE n.recipient_user_id = r.user_id AND n.use_case_id = u.id AND n.kind = 'da_rivedere')
ON CONFLICT DO NOTHING
RETURNING id`),
  ]);
  return rows?.length ?? 0;
}
