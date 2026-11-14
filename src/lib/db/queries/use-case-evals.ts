import "server-only";
/**
 * Il banco di prova e le evals di uno use case (rilascio 8.2a, docs/rilascio-8/BANCO-DI-PROVA.md §2–§4, drizzle/0036).
 *
 * - **Scrivere (`recordEvalRun`):** l'esecuzione e i suoi risultati in una transazione sola, con l'id riservato dalla
 *   CLI: una ripresa dopo un esito incerto ritrova quella scritta e risponde come la prima volta, senza avvisare di nuovo.
 *   - Il banco: la lettura di `analyzeBench`, la stessa regola della CLI. Se consiglia di cambiare modello, il team che
 *     costruisce lo sa (campanella ed e-mail, `banco_consiglio`, con il modello detto solo con il nome del catalogo),
 *     tranne chi lo ha lanciato. Mai con i modelli finti: la lettura dice «finti», mai «cambia». Un ruolo nuovo solo
 *     finché il caso ha meno di {@link BENCH_ROLES_MAX} ruoli con un banco.
 *   - Le evals: l'avviso di `evalsAlert` rispetto alle precedenti dello stesso ramo e dello stesso livello, con lo
 *     stesso tipo di modelli (veri con veri, finti con finti). Le esecuzioni di un caso si scrivono una alla volta (un
 *     lock per use case) e la scrittura delle evals controlla che le precedenti siano ancora quelle confrontate: se nel
 *     frattempo ne è arrivata un'altra, si rifà il confronto. Il team lo sa (`evals_in_calo`) solo per le evals di
 *     `main`, con i modelli veri, di un caso non in costruzione, che fanno lo stato del caso (le «veloce» solo finché non
 *     ce ne sono di complete); chi le manda vede l'avviso nella risposta, su ogni ramo e livello.
 *   - Una notifica al giorno per caso e per persona, campanella ed e-mail, come le altre del team (`notifyTask`).
 * - **Leggere (`loadEvalOverview`):** le evals che fanno lo stato del caso (`main` prima, poi i modelli veri, poi il
 *   livello completo, poi le più recenti) con l'andamento delle ultime 12 della stessa serie (ramo, modelli veri o
 *   finti, livello), dalla più vecchia; l'ultimo banco di ogni ruolo con la sua lettura.
 *   Null se la 0036 non c'è ancora. Le ultime evals sono l'ultimo punto dell'andamento, letti insieme: non possono
 *   dire due cose diverse.
 * - **La pagina «Agent Factory» (`loadEvalFacts`):** per i casi dati, in due letture sole: le evals che fanno lo stato
 *   del caso (lo stesso ordine) e la lettura dell'ultimo banco di ogni ruolo, con il segno del banco superato (dopo di
 *   lui le evals vere di `main` usano un altro modello per il ruolo, o il ruolo non c'è più: il consiglio non è più da
 *   fare).
 *
 * Mai chi lancia il banco o manda le evals, né nelle tabelle né nelle letture (art. 15.4): la persona serve solo a non
 * avvisare chi ha agito, dentro la stessa istruzione, e non si scrive.
 */
import { randomUUID } from "node:crypto";
import type { UcExecutor, UcRow } from "@/lib/db/uc-executor";
import type { FactoryTarget } from "@/lib/db/queries/use-case-factory";
import { EVALS_PROBE_SQL } from "@/lib/db/use-case-hub-evals-ddl";
import { BUILDER_ROLES, NOBODY, notifyTask } from "@/lib/db/queries/use-case-tasks-notices";
import { cast, jsonb, raw, ref, toStatement, ucSql, type SqlFragment, type UcStatement } from "@/lib/uc/sql/statement";
import { rowDate } from "@/lib/uc/sql/readiness";
import { fail, ok, type Result } from "@/lib/uc/types";
import {
  analyzeBench,
  benchSuperseded,
  catalogueModelName,
  EVALS_MAIN,
  evalsAlert,
  formatQuality,
  type BenchAnalysis,
  type BenchResult,
  type BenchVerdict,
  type EvalGroup,
  type EvalOverview,
  type EvalPoint,
  type EvalRunKind,
  type EvalRunView,
  type EvalsAlert,
} from "@/lib/use-cases/factory/benchmark";
import type { EvalRunInput } from "@/lib/use-cases/factory/benchmark-input";

/** Il ramo delle evals che contano per il team: la pagina, l'andamento, gli avvisi, «Da fare per te». */
export const EVALS_MAIN_BRANCH = EVALS_MAIN;
/** Il livello completo delle evals, con tutte le prove: «veloce» ne fa solo un pezzo. */
export const EVALS_FULL_LEVEL = "pull_request";
/** Quante evals nell'andamento. */
export const EVALS_TREND_MAX = 12;
/**
 * Quanti ruoli, al massimo, con il loro banco in un caso: un ruolo nuovo oltre questi non si scrive, e le letture tengono
 * i più recenti. Un agente ha pochi ruoli (quelli di agent.yaml): il tetto ferma i ruoli inventati.
 */
export const BENCH_ROLES_MAX = 20;
/** La risposta a un banco di un ruolo nuovo quando il caso ha già il banco di {@link BENCH_ROLES_MAX} ruoli. */
export const BENCH_ROLES_FULL_MESSAGE = `Questo caso ha già il banco di ${BENCH_ROLES_MAX} ruoli, il massimo: si rifà il banco di un ruolo che c'è già, non di uno nuovo (i ruoli sono quelli di agent.yaml).`;
/**
 * Quante volte si rifà il confronto delle evals quando ne arrivano altre dello stesso caso insieme: ogni tentativo andato
 * a vuoto vuol dire che un'altra è stata scritta, quindi bastano tanti tentativi quante evals insieme.
 */
export const EVALS_WRITE_ATTEMPTS = 5;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vero se la 0036 è applicata (la stessa sonda di `ensureDbSchema`). */
export async function evalsStoreReady(executor: UcExecutor): Promise<boolean> {
  try {
    const [rows] = await executor.batch([toStatement(ucSql`SELECT ${raw(EVALS_PROBE_SQL)} AS ready`)]);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

// ─── Righe ───────────────────────────────────────────────────────────

/** Le colonne di un'esecuzione (`r`) e di un suo risultato (`x`): nessuna sulla persona. */
const RUN_COLUMNS = raw(
  "r.id, r.kind, r.role, r.level, r.branch, r.commit_sha, r.template_version, r.models, r.fake_models, r.in_construction, r.cases_total, r.created_at",
);
const RESULT_COLUMNS = raw(
  "x.model, x.current, x.passed, x.total, x.thresholds_met, x.groups, x.cost_per_1000_usd, x.latency_p50_ms, x.latency_p95_ms, x.tokens_in_avg, x.tokens_out_avg, x.errors",
);
/** Le colonne di un risultato che servono alla lettura del banco (`analyzeBench`): niente gruppi, tempi né token. */
const VERDICT_RESULT_COLUMNS = raw("x.model, x.current, x.passed, x.total, x.thresholds_met, x.cost_per_1000_usd");

const numberOrNull = (v: unknown): number | null => {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const count = (v: unknown) => Math.max(0, Math.trunc(numberOrNull(v) ?? 0));
const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
/** Un istante del database in ISO, con i millesimi: il driver dà un `Date` (mai passare dal testo, che li perde). */
function isoOf(v: unknown): string {
  const d = rowDate(v);
  if (!d) throw new Error("use-case-evals: istante non valido");
  return d.toISOString();
}
const objectOf = (v: unknown): Record<string, unknown> => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {});

function modelsOf(v: unknown): Record<string, string> {
  return Object.fromEntries(Object.entries(objectOf(v)).filter((e): e is [string, string] => typeof e[1] === "string"));
}

function groupsOf(v: unknown): Record<string, EvalGroup> {
  const out: Record<string, EvalGroup> = {};
  for (const [name, raw] of Object.entries(objectOf(v))) {
    const g = objectOf(raw);
    const soglia = numberOrNull(g.soglia);
    if (soglia === null || typeof g.ok !== "boolean") continue;
    out[name] = { passati: count(g.passati), totali: count(g.totali), soglia, ok: g.ok };
  }
  return out;
}

/** Un risultato: la qualità si rilegge come superate / totali, lo stesso numero che il controllo ha calcolato. */
function resultOf(r: UcRow): BenchResult {
  const passed = count(r.passed);
  const total = Math.max(1, count(r.total));
  return {
    model: String(r.model),
    current: r.current === true,
    quality: passed / total,
    passed,
    total,
    thresholdsMet: r.thresholds_met === true,
    groups: groupsOf(r.groups),
    costPer1000Usd: numberOrNull(r.cost_per_1000_usd),
    latencyP50Ms: numberOrNull(r.latency_p50_ms),
    latencyP95Ms: numberOrNull(r.latency_p95_ms),
    tokensInAvg: numberOrNull(r.tokens_in_avg),
    tokensOutAvg: numberOrNull(r.tokens_out_avg),
    errors: count(r.errors),
  };
}

function runViewOf(r: UcRow, results: BenchResult[]): EvalRunView {
  return {
    id: String(r.id),
    kind: String(r.kind) as EvalRunKind,
    role: text(r.role),
    level: String(r.level),
    branch: text(r.branch),
    commit: text(r.commit_sha),
    templateVersion: text(r.template_version),
    models: modelsOf(r.models),
    fakeModels: r.fake_models === true,
    inConstruction: r.in_construction === true,
    casesTotal: count(r.cases_total),
    createdAt: isoOf(r.created_at),
    results,
  };
}

/** Le righe esecuzione × risultato, raggruppate per esecuzione, nell'ordine in cui arrivano. */
function runsOf(rows: readonly UcRow[]): EvalRunView[] {
  const byRun = new Map<string, { run: UcRow; results: BenchResult[] }>();
  for (const row of rows) {
    const id = String(row.id);
    const entry = byRun.get(id) ?? { run: row, results: [] };
    entry.results.push(resultOf(row));
    byRun.set(id, entry);
  }
  return [...byRun.values()].map((e) => runViewOf(e.run, e.results));
}

const benchAnalysis = (run: EvalRunView): BenchAnalysis => analyzeBench(run.results, { role: run.role ?? "", fakeModels: run.fakeModels });

/** Il punto delle evals di un'esecuzione, dal suo risultato «attuale», con il livello: si confronta solo con lo stesso. */
function pointOf(run: { fakeModels: boolean; inConstruction: boolean; branch: string | null; level: string }, result: Pick<BenchResult, "quality" | "thresholdsMet">): EvalPoint {
  return { quality: result.quality, thresholdsMet: result.thresholdsMet, fakeModels: run.fakeModels, inConstruction: run.inConstruction, branch: run.branch, level: run.level };
}

// ─── Scrivere ────────────────────────────────────────────────────────

export interface EvalRunRecorded {
  id: string;
  /** La lettura del banco; null per le evals. */
  analysis: BenchAnalysis | null;
  /** L'avviso delle evals; null per il banco, o se le evals vanno bene. */
  alert: EvalsAlert;
  /**
   * Se questa scrittura ha mandato le istruzioni dell'avviso al team: la route poi fa partire il giro delle e-mail.
   * Le righe possono non nascere (una al giorno, nessuno a cui dirlo, evals che non fanno lo stato del caso): il giro
   * allora non trova niente da mandare.
   */
  notified: boolean;
}

/** Il nome del catalogo del modello consigliato, per l'e-mail; niente per un modello fuori dal catalogo. */
function catalogueLabel(model: string): { label?: string } {
  const name = catalogueModelName(model);
  return name ? { label: name } : {};
}

/** Vero se l'esecuzione con questo id è nata in questa transazione (la sua `created_at` è il `now()` della transazione). */
const insertedNow = (id: string) => ucSql`EXISTS (SELECT 1 FROM use_case_eval_runs n WHERE n.id = ${cast(id, "uuid")} AND n.created_at = now())`;

/**
 * Tra quelle di cui il team è avvisato, vero se le evals che si scrivono fanno lo stato del caso ({@link statusOrderSql}):
 * le complete sempre, le «veloce» solo finché il caso non ha evals complete di `main` con i modelli veri. Così l'avviso
 * dice lo stesso numero della pagina, e una volta che le complete ci sono una «veloce» non prende il posto del giorno
 * al loro avviso (prima, quando è lei a fare lo stato, avvisa: una e-mail al giorno per caso, come sempre).
 */
function makesStatusSql(target: FactoryTarget, id: string, input: Pick<EvalRunInput, "level">): SqlFragment {
  if (input.level === EVALS_FULL_LEVEL) return insertedNow(id);
  return ucSql`${insertedNow(id)} AND NOT EXISTS (SELECT 1 FROM use_case_eval_runs s
  WHERE s.workspace_id = ${cast(target.workspaceId, "uuid")} AND s.use_case_id = ${cast(target.useCaseId, "uuid")} AND s.kind = 'evals'
    AND s.branch = ${cast(EVALS_MAIN_BRANCH, "text")} AND NOT s.fake_models AND s.level = ${cast(EVALS_FULL_LEVEL, "text")})`;
}

/** Il team lo sa solo per le evals di `main`, con i modelli veri, di un caso non in costruzione. */
export function evalsNoticeApplies(input: Pick<EvalRunInput, "fakeModels" | "inConstruction" | "branch">): boolean {
  return !input.fakeModels && !input.inConstruction && input.branch === EVALS_MAIN_BRANCH;
}

function insertRunSql(target: FactoryTarget, id: string, input: EvalRunInput, guard: SqlFragment): UcStatement {
  return toStatement(ucSql`INSERT INTO use_case_eval_runs (id, use_case_id, workspace_id, kind, role, level, branch, commit_sha, template_version, models, fake_models, in_construction, cases_total)
SELECT ${cast(id, "uuid")}, u.id, u.workspace_id, ${cast(input.kind, "text")}, ${cast(input.role, "text")}, ${cast(input.level, "text")}, ${cast(input.branch, "text")},
  ${cast(input.commit, "text")}, ${cast(input.templateVersion, "text")}, ${jsonb(input.models)}, ${cast(input.fakeModels, "boolean")}, ${cast(input.inConstruction, "boolean")},
  ${cast(input.casesTotal, "int")}
FROM use_cases u WHERE u.id = ${cast(target.useCaseId, "uuid")} AND u.workspace_id = ${cast(target.workspaceId, "uuid")} AND ${guard}
ON CONFLICT (id) DO NOTHING
RETURNING id`);
}

/** I risultati, solo se l'esecuzione è nata in questa transazione: nel suo caso e nel suo workspace. */
function insertResultsSql(id: string, results: readonly BenchResult[]): UcStatement {
  const rows = results.map((r) => ({
    model: r.model,
    current: r.current,
    quality: r.quality,
    passed: r.passed,
    total: r.total,
    thresholds_met: r.thresholdsMet,
    groups: r.groups,
    cost: r.costPer1000Usd,
    p50: r.latencyP50Ms,
    p95: r.latencyP95Ms,
    tokens_in: r.tokensInAvg,
    tokens_out: r.tokensOutAvg,
    errors: r.errors,
  }));
  return toStatement(ucSql`INSERT INTO use_case_eval_results (run_id, use_case_id, workspace_id, model, current, quality, passed, total, thresholds_met, groups,
  cost_per_1000_usd, latency_p50_ms, latency_p95_ms, tokens_in_avg, tokens_out_avg, errors)
SELECT r.id, r.use_case_id, r.workspace_id, x.model, x.current, x.quality, x.passed, x.total, x.thresholds_met, x.groups,
  x.cost, x.p50, x.p95, x.tokens_in, x.tokens_out, x.errors
FROM use_case_eval_runs r
CROSS JOIN jsonb_to_recordset(${jsonb(rows)}) AS x(model text, current boolean, quality double precision, passed integer, total integer, thresholds_met boolean,
  groups jsonb, cost numeric, p50 integer, p95 integer, tokens_in integer, tokens_out integer, errors integer)
WHERE r.id = ${cast(id, "uuid")} AND r.created_at = now()`);
}

/** In fila per use case: le esecuzioni di un caso si scrivono una alla volta (il confronto delle evals, i ruoli del banco). */
function caseWriteLockSql(target: FactoryTarget): UcStatement {
  return toStatement(ucSql`SELECT pg_advisory_xact_lock(hashtext('unbundle:evals:' || ${cast(target.useCaseId, "text")}))`);
}

/** I banchi del caso: quanti ruoli diversi, e se `role` è già tra questi. */
function benchRolesSql(target: FactoryTarget, role: string): UcStatement {
  return toStatement(ucSql`SELECT count(DISTINCT b.role)::int AS roles, coalesce(bool_or(b.role = ${cast(role, "text")}), false) AS known
FROM use_case_eval_runs b WHERE b.workspace_id = ${cast(target.workspaceId, "uuid")} AND b.use_case_id = ${cast(target.useCaseId, "uuid")} AND b.kind = 'banco'`);
}

/** Vero se nel caso c'è posto per il banco di `role`: il ruolo ha già un banco, o i ruoli sono meno di {@link BENCH_ROLES_MAX}. */
function benchRoomSql(target: FactoryTarget, role: string): SqlFragment {
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  return ucSql`(EXISTS (SELECT 1 FROM use_case_eval_runs b WHERE b.workspace_id = ${ws} AND b.use_case_id = ${uc} AND b.kind = 'banco' AND b.role = ${cast(role, "text")})
  OR (SELECT count(DISTINCT b.role) FROM use_case_eval_runs b WHERE b.workspace_id = ${ws} AND b.use_case_id = ${uc} AND b.kind = 'banco') < ${cast(BENCH_ROLES_MAX, "int")})`;
}

/** L'esecuzione con l'id (di qualunque caso: un id riservato è unico) e se lo use case c'è nel workspace. */
function precheckSql(target: FactoryTarget, id: string): UcStatement[] {
  return [
    toStatement(ucSql`SELECT r.use_case_id, r.workspace_id FROM use_case_eval_runs r WHERE r.id = ${cast(id, "uuid")}`),
    toStatement(ucSql`SELECT 1 AS ok FROM use_cases u WHERE u.id = ${cast(target.useCaseId, "uuid")} AND u.workspace_id = ${cast(target.workspaceId, "uuid")}`),
  ];
}

/**
 * Le ultime evals prima di quelle che si scrivono: stesso caso, stesso ramo, stesso livello, stesso tipo di modelli. Le
 * evals «veloce» fanno un pezzo delle prove (le regole, gli avversari, i primi 20 casi d'oro): con quelle complete non
 * si confrontano mai. `before`: l'id di un'esecuzione già scritta (si guarda prima di lei); senza, l'ultima che c'è,
 * tranne `exclude`.
 */
function previousEvalsSql(target: FactoryTarget, run: { branch: string | null; fakeModels: boolean; level: string }, o: { before?: string; exclude?: string }): SqlFragment {
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const order = o.before ? ucSql` AND (p.created_at, p.id) < (SELECT me.created_at, me.id FROM use_case_eval_runs me WHERE me.id = ${cast(o.before, "uuid")})` : raw("");
  const exclude = o.exclude ? ucSql` AND p.id <> ${cast(o.exclude, "uuid")}` : raw("");
  return ucSql`(SELECT p.id FROM use_case_eval_runs p
  WHERE p.workspace_id = ${ws} AND p.use_case_id = ${uc} AND p.kind = 'evals' AND p.branch IS NOT DISTINCT FROM ${cast(run.branch, "text")}
    AND p.fake_models = ${cast(run.fakeModels, "boolean")} AND p.level = ${cast(run.level, "text")}${order}${exclude}
  ORDER BY p.created_at DESC, p.id DESC LIMIT 1)`;
}

function readPreviousSql(previous: SqlFragment): UcStatement {
  return toStatement(ucSql`SELECT r.id, r.branch, r.level, r.fake_models, r.in_construction, x.passed, x.total, x.thresholds_met
FROM use_case_eval_runs r JOIN use_case_eval_results x ON x.run_id = r.id AND x.current
WHERE r.id = ${previous}`);
}

const previousPoint = (row: UcRow | undefined): { id: string; point: EvalPoint } | null => {
  if (!row) return null;
  const result = resultOf(row);
  const run = { fakeModels: row.fake_models === true, inConstruction: row.in_construction === true, branch: text(row.branch), level: String(row.level) };
  return { id: String(row.id), point: pointOf(run, result) };
};

/** Le evals scritte da una ripresa: la stessa risposta della prima volta, letta dal database. */
async function replayRun(executor: UcExecutor, target: FactoryTarget, id: string): Promise<Result<EvalRunRecorded>> {
  const [rows] = await executor.batch([
    toStatement(ucSql`SELECT r.use_case_id, r.workspace_id, ${RUN_COLUMNS}, ${RESULT_COLUMNS} FROM use_case_eval_runs r JOIN use_case_eval_results x ON x.run_id = r.id
WHERE r.id = ${cast(id, "uuid")}
ORDER BY x.current DESC, x.model`),
  ]);
  const run = runsOf(rows)[0];
  // Non c'è: lo use case non c'è più (la scrittura non è avvenuta). C'è, di un altro caso: un id riservato non torna mai.
  if (!run) return fail("non_trovato", "Use case non trovato.");
  const same = (a: unknown, b: string) => String(a).toLowerCase() === b.toLowerCase();
  if (!same(rows[0].use_case_id, target.useCaseId) || !same(rows[0].workspace_id, target.workspaceId)) {
    return fail("conflitto", "Questa esecuzione appartiene a un altro caso: rimandala con una chiave nuova.");
  }
  if (run.kind === "banco") return ok({ id: run.id, analysis: benchAnalysis(run), alert: null, notified: false });
  const current = run.results.find((r) => r.current) ?? run.results[0];
  const [previous] = await executor.batch([readPreviousSql(previousEvalsSql(target, run, { before: run.id }))]);
  return ok({ id: run.id, analysis: null, alert: evalsAlert(previousPoint(previous[0])?.point ?? null, pointOf(run, current)), notified: false });
}

/**
 * Scrive un banco o delle evals dello use case, già controllati (`parseEvalRun`). I permessi li controlla chi chiama.
 * `id`: quello riservato dal registro dell'idempotenza (una ripresa lo ritrova); `actorUserId`: chi ha mandato, per non
 * avvisarlo (mai scritto).
 */
export async function recordEvalRun(
  executor: UcExecutor,
  target: FactoryTarget,
  input: EvalRunInput,
  o: { id?: string | null; actorUserId: string | null; now?: Date },
): Promise<Result<EvalRunRecorded>> {
  const id = o.id ?? randomUUID();
  if (!UUID_RE.test(id)) return fail("dati_non_validi", "Id non valido.");
  if (input.kind === "banco" ? input.role === null : input.role !== null) return fail("dati_non_validi", "Il ruolo c'è solo per il banco.");
  const current = input.results.filter((r) => r.current);
  if (current.length !== 1 || (input.kind === "evals" && input.results.length !== 1)) return fail("dati_non_validi", "Serve un solo risultato «attuale».");
  if (!(await evalsStoreReady(executor))) return fail("non_disponibile", "Il banco e le evals non sono ancora disponibili: riprova tra qualche minuto.");
  const actor = o.actorUserId ?? NOBODY;
  const now = o.now ?? new Date();

  if (input.kind === "banco") {
    const role = input.role as string;
    const analysis = analyzeBench(input.results, { role, fakeModels: input.fakeModels });
    const verdict = analysis.verdict;
    const [existing, useCase, roles] = await executor.batch([...precheckSql(target, id), benchRolesSql(target, role)]);
    if (existing[0]) return replayRun(executor, target, id);
    if (!useCase[0]) return fail("non_trovato", "Use case non trovato.");
    // Un ruolo nuovo solo finché il caso ha meno di BENCH_ROLES_MAX ruoli con un banco; uno che c'è già si rifà sempre.
    if (roles[0]?.known !== true && count(roles[0]?.roles) >= BENCH_ROLES_MAX) return fail("conflitto", BENCH_ROLES_FULL_MESSAGE);
    // Il consiglio arriva solo con «cambia», che con i modelli finti non c'è mai. L'e-mail dice il modello solo con il
    // nome del catalogo: un id fuori dal catalogo l'ha scelto chi manda, e non va mai in un'e-mail.
    const notices =
      verdict.kind === "cambia" && !input.fakeModels
        ? notifyTask(target, "banco_consiglio", { roles: BUILDER_ROLES }, actor, now, null, insertedNow(id), { role, model: verdict.model, ...catalogueLabel(verdict.model) })
        : [];
    // In fila per caso, e il posto per il ruolo si conta dentro la scrittura: due banchi di ruoli nuovi insieme non
    // superano il tetto.
    const written = await executor.batch([caseWriteLockSql(target), insertRunSql(target, id, input, benchRoomSql(target, role)), insertResultsSql(id, input.results), ...notices]);
    if (written[1][0]) return ok({ id, analysis, alert: null, notified: notices.length > 0 });
    // Non scritto: la stessa esecuzione arrivata insieme (si risponde come lei), lo use case che non c'è più, o i ruoli
    // del caso riempiti nel frattempo.
    const [again, still] = await executor.batch(precheckSql(target, id));
    if (again[0]) return replayRun(executor, target, id);
    if (!still[0]) return fail("non_trovato", "Use case non trovato.");
    return fail("conflitto", BENCH_ROLES_FULL_MESSAGE);
  }

  const point = pointOf(input, current[0]);
  for (let attempt = 0; attempt < EVALS_WRITE_ATTEMPTS; attempt++) {
    const [existing, useCase, previousRows] = await executor.batch([...precheckSql(target, id), readPreviousSql(previousEvalsSql(target, input, { exclude: id }))]);
    if (existing[0]) return replayRun(executor, target, id);
    if (!useCase[0]) return fail("non_trovato", "Use case non trovato.");
    const previous = previousPoint(previousRows[0]);
    const alert = evalsAlert(previous?.point ?? null, point);
    const notices =
      alert !== null && evalsNoticeApplies(input)
        ? notifyTask(target, "evals_in_calo", { roles: BUILDER_ROLES }, actor, now, null, makesStatusSql(target, id, input), {
            alert: alert.kind,
            qualityText: formatQuality(point.quality),
            ...(alert.kind === "in_calo" ? { drop: alert.drop } : {}),
          })
        : [];
    // In fila per use case; si scrive solo se le ultime evals confrontate sono ancora le ultime.
    const still = ucSql`${previousEvalsSql(target, input, { exclude: id })} IS NOT DISTINCT FROM ${cast(previous?.id ?? null, "uuid")}`;
    const results = await executor.batch([
      caseWriteLockSql(target),
      insertRunSql(target, id, input, still),
      insertResultsSql(id, input.results),
      ...notices,
    ]);
    if (results[1][0]) return ok({ id, analysis: null, alert, notified: notices.length > 0 });
  }
  return fail("conflitto", "Altre evals dello stesso caso sono arrivate insieme: riprova tra poco.");
}

// ─── Leggere ─────────────────────────────────────────────────────────

/**
 * L'ordine delle evals che fanno lo stato del caso (la pagina, la CLI, l'Agent Factory, «Da fare per te»): quelle di
 * `main` prima, poi quelle con i modelli veri, poi quelle del livello completo, poi le più recenti. Così né le evals con
 * i modelli finti né quelle «veloce» prendono il posto delle evals vere e complete di `main`.
 */
function statusOrderSql(alias: "l" | "r"): SqlFragment {
  const a = ref(alias);
  return ucSql`(${a}.branch IS NOT DISTINCT FROM ${cast(EVALS_MAIN_BRANCH, "text")}) DESC, ${a}.fake_models ASC, (${a}.level = ${cast(EVALS_FULL_LEVEL, "text")}) DESC, ${a}.created_at DESC, ${a}.id DESC`;
}

/**
 * Quello che la sezione «Evals e banco di prova» mostra di un caso: le evals che fanno lo stato del caso
 * ({@link statusOrderSql}) con l'andamento delle ultime {@link EVALS_TREND_MAX} della stessa serie (stesso ramo, stessi
 * modelli veri o finti, stesso livello), dalla più vecchia (l'ultima compresa); l'ultimo banco di ogni ruolo, in ordine
 * di ruolo, con la sua lettura. Null se la 0036 non c'è.
 */
export async function loadEvalOverview(executor: UcExecutor, target: FactoryTarget): Promise<EvalOverview | null> {
  if (!(await evalsStoreReady(executor))) return null;
  const ws = cast(target.workspaceId, "uuid");
  const uc = cast(target.useCaseId, "uuid");
  const latest = ucSql`(SELECT l.id FROM use_case_eval_runs l WHERE l.workspace_id = ${ws} AND l.use_case_id = ${uc} AND l.kind = 'evals'
  ORDER BY ${statusOrderSql("l")} LIMIT 1)`;
  // Le evals hanno un solo risultato, quello «attuale»: l'andamento porta tutta l'esecuzione, e l'ultima è la sua fine.
  // L'andamento è quello delle evals che fanno lo stato: lo stesso ramo, gli stessi modelli (veri o finti), lo stesso
  // livello. Sono le più recenti di quella serie, quindi l'ultimo punto.
  const [trendRows, benchRows] = await executor.batch([
    toStatement(ucSql`SELECT ${RUN_COLUMNS}, ${RESULT_COLUMNS} FROM (
  SELECT q.id FROM use_case_eval_runs q JOIN use_case_eval_runs me ON me.id = ${latest}
  WHERE q.workspace_id = ${ws} AND q.use_case_id = ${uc} AND q.kind = 'evals' AND q.branch IS NOT DISTINCT FROM me.branch
    AND q.fake_models = me.fake_models AND q.level = me.level
  ORDER BY q.created_at DESC, q.id DESC
  LIMIT ${cast(EVALS_TREND_MAX, "int")}) t
JOIN use_case_eval_runs r ON r.id = t.id
JOIN LATERAL (SELECT * FROM use_case_eval_results c WHERE c.run_id = r.id AND c.current ORDER BY c.model LIMIT 1) x ON true
ORDER BY r.created_at, r.id`),
    toStatement(ucSql`WITH latest AS (
  SELECT b.id, b.created_at FROM (
    SELECT DISTINCT ON (q.role) q.id, q.created_at FROM use_case_eval_runs q
    WHERE q.workspace_id = ${ws} AND q.use_case_id = ${uc} AND q.kind = 'banco'
    ORDER BY q.role, q.created_at DESC, q.id DESC) b
  ORDER BY b.created_at DESC, b.id DESC
  LIMIT ${cast(BENCH_ROLES_MAX, "int")})
SELECT ${RUN_COLUMNS}, ${RESULT_COLUMNS} FROM latest l JOIN use_case_eval_runs r ON r.id = l.id JOIN use_case_eval_results x ON x.run_id = r.id
ORDER BY r.role, x.current DESC, x.model`),
  ]);
  const runs = trendRows.map((row) => runViewOf(row, [resultOf(row)]));
  const trend = runs.map((run) => ({ at: run.createdAt, quality: run.results[0].quality, thresholdsMet: run.results[0].thresholdsMet, fakeModels: run.fakeModels }));
  const benches = runsOf(benchRows).map((run) => ({ role: run.role ?? "", run, analysis: benchAnalysis(run) }));
  return { evals: { latest: runs.at(-1) ?? null, trend }, benches };
}

/** Le evals e il banco di un caso, come li dice la pagina «Agent Factory». */
export interface CaseEvalFacts {
  /**
   * Le evals che fanno lo stato del caso: `main` prima, poi i modelli veri, poi il livello completo, poi le più recenti.
   * Con il livello e i modelli di oggi per ruolo (dicono se un banco è superato).
   */
  evals: {
    quality: number;
    thresholdsMet: boolean;
    fakeModels: boolean;
    inConstruction: boolean;
    branch: string | null;
    level: string;
    models: Record<string, string>;
    at: string;
  } | null;
  /**
   * La lettura dell'ultimo banco di ogni ruolo (al massimo {@link BENCH_ROLES_MAX}, i più recenti), in ordine di ruolo:
   * quando è nato, il suo modello «attuale» e se è superato (`benchSuperseded`: dopo di lui le evals vere di `main`
   * usano un altro modello per il ruolo, o il ruolo non c'è più). Il consiglio di un banco superato non è più da fare.
   */
  benches: { role: string; verdict: BenchVerdict; at: string; currentModel: string | null; superseded: boolean }[];
}

/**
 * Le evals e il banco dei casi dati (gli use case di un workspace), in due letture sole, per la pagina «Agent Factory».
 * Una mappa vuota se la 0036 non c'è.
 */
export async function loadEvalFacts(executor: UcExecutor, workspaceId: string, useCaseIds: readonly string[]): Promise<Map<string, CaseEvalFacts>> {
  const out = new Map<string, CaseEvalFacts>();
  if (useCaseIds.length === 0 || !(await evalsStoreReady(executor))) return out;
  const ws = cast(workspaceId, "uuid");
  const ids = cast([...new Set(useCaseIds)], "uuid[]");
  const [evalsRows, benchRows] = await executor.batch([
    toStatement(ucSql`SELECT DISTINCT ON (r.use_case_id) r.use_case_id, r.branch, r.level, r.models, r.fake_models, r.in_construction, r.created_at,
  x.passed, x.total, x.thresholds_met
FROM use_case_eval_runs r JOIN use_case_eval_results x ON x.run_id = r.id AND x.current
WHERE r.workspace_id = ${ws} AND r.use_case_id = ANY (${ids}) AND r.kind = 'evals'
ORDER BY r.use_case_id, ${statusOrderSql("r")}`),
    // L'ultimo banco di ogni ruolo, al massimo BENCH_ROLES_MAX ruoli per caso (i più recenti, come la pagina), con le
    // sole colonne della lettura.
    toStatement(ucSql`WITH latest AS (
  SELECT DISTINCT ON (q.use_case_id, q.role) q.id, q.use_case_id, q.created_at FROM use_case_eval_runs q
  WHERE q.workspace_id = ${ws} AND q.use_case_id = ANY (${ids}) AND q.kind = 'banco'
  ORDER BY q.use_case_id, q.role, q.created_at DESC, q.id DESC),
ranked AS (
  SELECT l.id, row_number() OVER (PARTITION BY l.use_case_id ORDER BY l.created_at DESC, l.id DESC) AS n FROM latest l)
SELECT r.use_case_id, ${RUN_COLUMNS}, ${VERDICT_RESULT_COLUMNS} FROM ranked k JOIN use_case_eval_runs r ON r.id = k.id JOIN use_case_eval_results x ON x.run_id = r.id
WHERE k.n <= ${cast(BENCH_ROLES_MAX, "int")}
ORDER BY r.use_case_id, r.role, x.current DESC, x.model`),
  ]);
  const entry = (useCaseId: string) => {
    const found = out.get(useCaseId) ?? { evals: null, benches: [] };
    out.set(useCaseId, found);
    return found;
  };
  for (const row of evalsRows) {
    const result = resultOf(row);
    entry(String(row.use_case_id)).evals = {
      quality: result.quality,
      thresholdsMet: result.thresholdsMet,
      fakeModels: row.fake_models === true,
      inConstruction: row.in_construction === true,
      branch: text(row.branch),
      level: String(row.level),
      models: modelsOf(row.models),
      at: isoOf(row.created_at),
    };
  }
  const caseOfRun = new Map(benchRows.map((row) => [String(row.id), String(row.use_case_id)]));
  for (const run of runsOf(benchRows)) {
    const useCaseId = caseOfRun.get(run.id);
    if (!useCaseId || !run.role) continue;
    const currentModel = run.results.find((r) => r.current)?.model ?? null;
    entry(useCaseId).benches.push({ role: run.role, verdict: benchAnalysis(run).verdict, at: run.createdAt, currentModel, superseded: false });
  }
  // Un banco superato: le evals che fanno lo stato del caso sono arrivate dopo, vere, di main, con un altro modello per il
  // ruolo (o senza il ruolo).
  for (const facts of out.values()) {
    for (const bench of facts.benches) bench.superseded = benchSuperseded(bench, facts.evals);
  }
  return out;
}
