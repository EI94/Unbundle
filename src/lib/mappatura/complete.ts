import "server-only";

/**
 * «Mappatura board»: completare la mappatura di un'unità (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.5).
 *
 * Una funzione sola per il bottone «Completa la mappatura» (e «Classifica N passi») e per il tool della chat: quello
 * che `markDepartmentMapped` fa oggi, con i controlli che gli mancano. Nessuna chiamata nuova al modello: usa
 * `classifyActivitiesBatch` e `matchActivitiesToOnet` così come sono.
 *
 * L'ordine: l'unità con le sue attività (adottate, lette con il workspace) → «Mappatura completa», una volta sola, con
 * la riga della campanella → la sintesi, se chi chiama la porta → la classificazione dei passi senza stream, fino alla
 * scadenza → lo stream, la confidenza e, sulla riga del passo, la proposta, il motivo e il potenziale → il match O*NET
 * dei passi senza codice → codice, esposizione e titolo **solo per gli id che sono passi di questa unità**. Chiamarla
 * di nuovo continua con quello che resta.
 *
 * Nei log solo id, codici e numeri: mai un titolo.
 */
import { randomUUID } from "node:crypto";
import { classifyActivitiesBatch, type ClassificationResult } from "@/lib/ai/classify";
import { ClaudeRefusalError, logClaudeTimeout, stoppedByDeadline, timeUntil } from "@/lib/ai/models";
import { matchActivitiesToOnet } from "@/lib/ai/onet-matching";
import { ONET_TITLE_MAX } from "@/lib/db/mapping-board-ddl";
import type { Activity, StrategicGoal } from "@/lib/db/schema";
import type { UcExecutor, UcRow } from "@/lib/db/uc-executor";
import { logSafeError } from "@/lib/log/safe-error";
import { cutLine, cutProse } from "./board-ops";
import { date, number, strings, text } from "./board-rows";
import { completionReads, markMapped, preflight, saveClassifications, saveOnetMatches, saveSummary, unitsToAdopt, type BoardScope, type ClassificationRow } from "./board-sql";
import { adoptUnit, mappingStoreReady } from "./board-store";
import { MAPPING_COMPLETED_SIGNAL, mappingCompletedSignal } from "./text";
import { MAPPING_LIMITS, STREAMS, isStream, type Stream } from "./vocab";

export type CompletionOutcome = {
  /** L'unità è passata ora a «mapped». */
  firstCompletion: boolean;
  /** I passi dell'unità. */
  total: number;
  /** Classificati in questo giro; ancora senza stream. */
  classified: number;
  remaining: number;
  /** Di questo giro. */
  counts: Record<Stream, number>;
  classification: "fatta" | "parziale" | "non_riuscita" | "niente_da_fare";
  matched: number;
  avgExposurePct: number | null;
  onet: "fatto" | "non_riuscito" | "niente_da_fare";
};

/**
 * Una mappatura senza passi non si completa: né dal bottone, né da una richiesta diretta, né dalla chat. Niente
 * «Mappatura completa», niente riga in campanella, nessuna chiamata al modello.
 */
export type CompletionRefusal = { refused: "senza_passi" };

/** L'esito è un rifiuto (`CompletionRefusal`)? */
export function isCompletionRefusal(value: CompletionOutcome | CompletionRefusal | null | undefined): value is CompletionRefusal {
  return Boolean(value && "refused" in value);
}

export interface CompleteDeps {
  /** (Rilascio 9b) `contesto`: il blocco «Contesto» per il classificatore ("" o assente: il prompt di prima). */
  loadUnit(scope: BoardScope): Promise<{ unitName: string; activities: Activity[]; companyValueThesis: unknown; goals: StrategicGoal[]; contesto?: string } | null>;
  markMapped(scope: BoardScope, signal: { title: string; description: string }): Promise<{ first: boolean }>;
  saveSummary(scope: BoardScope, summary: { headline?: string | null; analysis?: ReadonlyArray<{ title: string; text: string }> }): Promise<void>;
  /**
   * Scrive le classificazioni e dice quante ne ha scritte, per stream: solo i passi ancora senza stream (uno che
   * qualcuno ha classificato nel frattempo, una persona o un altro giro, resta com'è e non conta).
   */
  saveClassifications(scope: BoardScope, results: ReadonlyMap<string, ClassificationResult>): Promise<Record<Stream, number>>;
  saveOnetMatches(scope: BoardScope, matches: ReadonlyArray<{ activityId: string; suggestedOnetCode: string; occupationTitle: string; aiExposureEstimate: number }>): Promise<number>;
  classify: typeof classifyActivitiesBatch;
  matchOnet: typeof matchActivitiesToOnet;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const logContext = (scope: BoardScope) => ({ workspaceId: scope.workspaceId, departmentId: scope.departmentId });

async function ensureSchema(): Promise<void> {
  const { ensureDbSchema } = await import("@/lib/db/ensure-schema");
  await ensureDbSchema();
}

/**
 * La tesi del valore che il classificatore riceve: quella del workspace (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §10.1),
 * mai quella dell'organizzazione, che può essere di un altro workspace. Si carica quando serve, come lo schema.
 */
async function workspaceValueThesis(workspaceId: string): Promise<unknown> {
  const { getWorkspaceValueThesis } = await import("@/lib/db/queries/value-thesis");
  return getWorkspaceValueThesis(workspaceId);
}

/**
 * (Rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.12) Il blocco «Contesto» che il classificatore riceve: solo
 * «In breve», «Per tutti», con l'ok della richiesta; "" senza. Chi chiama ha già controllato la sessione (la rotta con
 * `boardRequest`, il tool della chat dopo i controlli della rotta). Si carica quando serve, come la tesi.
 */
async function classifyContext(workspaceId: string): Promise<string> {
  const { loadPromptContext } = await import("@/lib/db/queries/context-work");
  return loadPromptContext(workspaceId, { profile: "classify", consent: "request" });
}

/** Una riga di `activities` come la dà Drizzle: è il tipo che il classificatore e il match O*NET prendono. */
function activityFromRow(row: UcRow): Activity {
  return {
    id: text(row.id) ?? "",
    departmentId: text(row.department_id) ?? "",
    workspaceId: text(row.workspace_id) ?? "",
    title: text(row.title) ?? "",
    description: text(row.description),
    workType: text(row.work_type) as Activity["workType"],
    classification: text(row.classification) as Activity["classification"],
    confidenceScore: number(row.confidence_score),
    frequency: text(row.frequency),
    timeSpentHoursWeek: number(row.time_spent_hours_week),
    toolsUsed: row.tools_used === null || row.tools_used === undefined ? null : strings(row.tools_used),
    inputDescription: text(row.input_description),
    outputDescription: text(row.output_description),
    decisionPoints: text(row.decision_points),
    dependencies: row.dependencies === null || row.dependencies === undefined ? null : strings(row.dependencies),
    painPoints: text(row.pain_points),
    dataRequired: text(row.data_required),
    qualityPerceived: text(row.quality_perceived),
    onetTaskId: text(row.onet_task_id),
    onetMatchScore: number(row.onet_match_score),
    aiExposureScore: number(row.ai_exposure_score),
    createdAt: date(row.created_at),
    updatedAt: date(row.updated_at),
  };
}

function goalFromRow(row: UcRow): StrategicGoal {
  return {
    id: text(row.id) ?? "",
    workspaceId: text(row.workspace_id) ?? "",
    parentId: text(row.parent_id),
    type: text(row.type) as StrategicGoal["type"],
    title: text(row.title) ?? "",
    description: text(row.description),
    direction: text(row.direction) as StrategicGoal["direction"],
    targetValue: number(row.target_value),
    currentValue: number(row.current_value),
    owner: text(row.owner),
    timeframe: text(row.timeframe),
    kpiName: text(row.kpi_name),
    kpiUnit: text(row.kpi_unit),
    createdAt: date(row.created_at),
  };
}

const noStreams = (): Record<Stream, number> => ({ automate: 0, differentiate: 0, innovate: 0 });

const classificationRows = (results: ReadonlyMap<string, ClassificationResult>): ClassificationRow[] =>
  [...results]
    .filter(([id, result]) => UUID.test(id) && isStream(result.classification))
    .map(([id, result]) => ({ id, stream: result.classification, confidence: Math.min(1, Math.max(0, Number(result.confidenceScore) || 0)), reason: String(result.reasoning ?? ""), potential: String(result.aiPotential ?? "") }));

/** Le dipendenze vere: il database dell'app (o quello della suite), il classificatore e il match O*NET di sempre. */
export function appCompleteDeps(executor: UcExecutor): CompleteDeps {
  return {
    async loadUnit(scope) {
      if (!UUID.test(scope.workspaceId) || !UUID.test(scope.departmentId)) return null;
      await ensureSchema();
      const [probe, unit] = await executor.batch(preflight(scope));
      if (unit.length === 0 || probe[0]?.ready !== true) return null;
      await adoptUnit(executor, scope);
      const [units, goals, activities] = await executor.batch(completionReads(scope));
      if (units.length === 0) return null;
      const companyValueThesis = await workspaceValueThesis(scope.workspaceId);
      const contesto = await classifyContext(scope.workspaceId);
      return { unitName: text(units[0].name) ?? "", activities: activities.map(activityFromRow), companyValueThesis, goals: goals.map(goalFromRow), contesto };
    },
    async markMapped(scope, signal) {
      const [rows] = await executor.batch([markMapped(scope, { type: MAPPING_COMPLETED_SIGNAL, ...signal })]);
      return { first: rows[0]?.first === true };
    },
    async saveSummary(scope, summary) {
      const points = summary.analysis
        ? summary.analysis
            .flatMap((point) => {
              const body = cutProse(point.text, MAPPING_LIMITS.note);
              return body === null ? [] : [{ id: randomUUID() as string, title: cutLine(point.title, MAPPING_LIMITS.noteTitle), text: body }];
            })
            .slice(0, MAPPING_LIMITS.analysisPoints)
        : null;
      await executor.batch(saveSummary(scope, { headline: cutLine(summary.headline, MAPPING_LIMITS.headline), points }));
    },
    async saveClassifications(scope, results) {
      const rows = classificationRows(results);
      if (rows.length === 0) return noStreams();
      const [written] = await executor.batch([saveClassifications(scope, rows, true)]);
      return { automate: number(written[0]?.automate) ?? 0, differentiate: number(written[0]?.differentiate) ?? 0, innovate: number(written[0]?.innovate) ?? 0 };
    },
    async saveOnetMatches(scope, matches) {
      const rows = matches.filter((match) => UUID.test(match.activityId)).map((match) => ({ id: match.activityId, code: match.suggestedOnetCode, title: match.occupationTitle, exposure: match.aiExposureEstimate }));
      if (rows.length === 0) return 0;
      const [written] = await executor.batch([saveOnetMatches(scope, rows, ONET_TITLE_MAX)]);
      return number(written[0]?.n) ?? 0;
    },
    classify: classifyActivitiesBatch,
    matchOnet: matchActivitiesToOnet,
  };
}

/**
 * Completa la mappatura di un'unità, o continua con quello che resta. null se l'unità non è di quel workspace o se la
 * 0039 manca; un rifiuto se l'unità non ha passi. `deadline`: l'istante oltre il quale le chiamate al modello si
 * interrompono (quello che è riuscito resta).
 */
export async function completeUnitMapping(
  deps: CompleteDeps,
  input: { scope: BoardScope; deadline: number; headline?: string | null; analysis?: ReadonlyArray<{ title: string; text: string }> },
): Promise<CompletionOutcome | CompletionRefusal | null> {
  const { scope, deadline } = input;
  const unit = await deps.loadUnit(scope);
  if (!unit) return null;
  // Senza passi non si completa niente (anche `markMapped` lo controlla, nella stessa istruzione che segna l'unità).
  if (unit.activities.length === 0) return { refused: "senza_passi" };

  const hours = unit.activities.reduce((sum, activity) => sum + (activity.timeSpentHoursWeek ?? 0), 0);
  const { first } = await deps.markMapped(scope, mappingCompletedSignal(unit.unitName, unit.activities.length, hours));
  if (input.headline || input.analysis) await deps.saveSummary(scope, { headline: input.headline, analysis: input.analysis });

  const outcome: CompletionOutcome = {
    firstCompletion: first,
    total: unit.activities.length,
    classified: 0,
    remaining: 0,
    counts: noStreams(),
    classification: "niente_da_fare",
    matched: 0,
    avgExposurePct: null,
    onet: "niente_da_fare",
  };

  const unclassified = unit.activities.filter((activity) => !activity.classification);
  outcome.remaining = unclassified.length;
  if (unclassified.length > 0) {
    try {
      // Le classificazioni riuscite si scrivono; quelle rifiutate, fallite o fermate dalla scadenza restano da fare.
      const results = await deps.classify(unclassified, { companyValueThesis: unit.companyValueThesis, goals: unit.goals, contesto: unit.contesto ?? "" }, { abortSignal: AbortSignal.timeout(timeUntil(deadline)) });
      const own = new Map([...results].filter(([id]) => unclassified.some((activity) => activity.id === id)));
      // Si conta quello che questo giro ha scritto: un passo che un altro giro (o una persona) ha classificato nel
      // frattempo non è suo. Se gli altri hanno fatto tutto, a questo giro non resta niente da fare.
      outcome.counts = await deps.saveClassifications(scope, own);
      outcome.classified = STREAMS.reduce((sum, stream) => sum + outcome.counts[stream], 0);
      outcome.remaining = unclassified.length - own.size;
      outcome.classification = own.size === 0 ? "non_riuscita" : own.size < unclassified.length ? "parziale" : outcome.classified === 0 ? "niente_da_fare" : "fatta";
    } catch (error) {
      logSafeError("mappatura/complete", "classificazione_non_riuscita", error, logContext(scope));
      outcome.classification = "non_riuscita";
    }
  }

  const unmatched = unit.activities.filter((activity) => !activity.onetTaskId);
  if (unmatched.length > 0) {
    const timeoutMs = timeUntil(deadline);
    const abortSignal = AbortSignal.timeout(timeoutMs);
    try {
      const matches = await deps.matchOnet(unmatched, { abortSignal });
      // Il modello restituisce gli id: valgono solo quelli dei passi che gli sono stati mandati, uno per passo.
      const sent = new Set(unmatched.map((activity) => activity.id));
      const kept = matches.filter((match) => sent.delete(match.activityId));
      outcome.matched = await deps.saveOnetMatches(scope, kept);
      // La stima va da 0 a 1 (onet-matching.ts): qui in percentuale, come nella scheda «Classificazione».
      outcome.avgExposurePct = kept.length > 0 ? Math.round((kept.reduce((sum, match) => sum + match.aiExposureEstimate, 0) / kept.length) * 100) : null;
      outcome.onet = "fatto";
    } catch (error) {
      // Un rifiuto è già nel log (throwIfRefused); la scadenza e gli altri errori senza testi.
      if (stoppedByDeadline(error, abortSignal)) logClaudeTimeout("ai/onet-matching", { timeoutMs });
      else if (!(error instanceof ClaudeRefusalError)) logSafeError("ai/onet-matching", "match_non_riuscito", error, logContext(scope));
      outcome.onet = "non_riuscito";
    }
  }
  return outcome;
}

/**
 * Per «Classifica attività» del workspace: le colonne di sempre più proposta, motivo e potenziale. Solo attività di
 * quel workspace. Le attività non ancora sulla board ci entrano prima (adozione), così la proposta ha dove stare.
 * Senza la 0039 scrive le sole colonne di sempre. Restituisce quante attività ha scritto.
 */
export async function recordClassifications(executor: UcExecutor, workspaceId: string, results: ReadonlyMap<string, ClassificationResult>): Promise<number> {
  const rows = classificationRows(results);
  if (!UUID.test(workspaceId) || rows.length === 0) return 0;
  await ensureSchema();
  const ready = await mappingStoreReady(executor);
  if (ready) {
    const [units] = await executor.batch([unitsToAdopt(workspaceId, rows.map((row) => row.id))]);
    for (const unit of units) {
      const departmentId = text(unit.department_id);
      if (departmentId) await adoptUnit(executor, { workspaceId, departmentId });
    }
  }
  const [written] = await executor.batch([saveClassifications({ workspaceId }, rows, ready)]);
  return number(written[0]?.n) ?? 0;
}
