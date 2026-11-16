import "server-only";

/**
 * «Mappatura board»: lettura e scrittura sul database (docs/mappatura/MAPPATURA-BOARD-PIANO.md §3.5, §4.3).
 *
 * - `readBoard`: la board di un'unità per chi guarda. Chiama il self-heal dello schema e l'adozione; senza la 0039
 *   legge le sole attività (store «mancante», sola lettura).
 * - `adoptUnit`: le attività nate prima della board (o scritte dal codice di prima) entrano nella board, senza toccare
 *   una colonna di `activities` e senza alzare la revisione. Idempotente; quando non c'è niente da adottare è una
 *   lettura sola.
 * - `saveBoardOps`: **l'unica strada per scrivere la board**: i salvataggi del browser, i tool dell'assistente, i passi
 *   confermati dai documenti. Una transazione (`executor.batch`), un'istruzione per operazione, poi la coda (R5).
 * - `resolveProcess`: il processo con quel nome, o uno nuovo; anche lui passa dalle stesse istruzioni.
 *
 * Ogni funzione prende l'esecutore SQL dei comandi uc (`src/lib/db/uc-executor.ts`): l'app passa quello condiviso, le
 * suite sul database il loro. Nei log solo id e codici, mai titoli o testi.
 */
import { createHash } from "node:crypto";
import type { UcExecutor, UcRow } from "@/lib/db/uc-executor";
import { logSafeError } from "@/lib/log/safe-error";
import { boardAbilities } from "./abilities";
import { adoptionOrder, type MappingBoard } from "./board-model";
import { REVIEWER_ONLY_OPS, oneLine, saveInputSchema, type BoardOp } from "./board-ops";
import { assembleActivitiesOnly, assembleBoard, date, isoDate, number, text } from "./board-rows";
import {
  activitiesOnlyReads,
  adoptionReads,
  adoptionWrites,
  boardReads,
  noteLanes,
  preflight,
  processNames,
  revisionRead,
  saveBatch,
  storeProbe,
  type BoardActor,
  type BoardScope,
  type OpOutcome,
  type ProjectedLane,
} from "./board-sql";
import { BOARD_TEXT } from "./text";
import { MAPPING_LIMITS } from "./vocab";

export type { ActorKind } from "./board-ops";
export type { BoardActor, BoardScope } from "./board-sql";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const validScope = (scope: BoardScope) => UUID.test(scope.workspaceId) && UUID.test(scope.departmentId);
const logContext = (scope: BoardScope) => ({ workspaceId: scope.workspaceId, departmentId: scope.departmentId });

/** Lo stesso id che PostgreSQL calcola con `md5(testo)::uuid`: dipende solo dal testo. */
export function md5Uuid(seed: string): string {
  const hex = createHash("md5").update(seed).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** L'id di «Processo principale» di un'unità (`defaultProcessIdSql`), e quello di un processo creato per nome. */
export const defaultProcessId = (departmentId: string) => md5Uuid(`${departmentId.toLowerCase()}:processo`);
const namedProcessId = (departmentId: string, key: string) => md5Uuid(`${departmentId.toLowerCase()}:processo:${key}`);
/** L'id della nota che l'adozione crea da `pain_points` o `data_required` (`adoptionWrites`). */
export const adoptedNoteId = (activityId: string, lane: ProjectedLane) => md5Uuid(`${activityId.toLowerCase()}:${lane}`);

/** Il self-heal dello schema: caricato qui, così chi importa questo modulo non apre il database dell'app per forza. */
async function ensureSchema(): Promise<void> {
  const { ensureDbSchema } = await import("@/lib/db/ensure-schema");
  await ensureDbSchema();
}

/** Vero con tutte le tabelle della 0039 (MAPPING_BOARD_PROBE_SQL). */
export async function mappingStoreReady(executor: UcExecutor): Promise<boolean> {
  try {
    const [rows] = await executor.batch([storeProbe()]);
    return rows[0]?.ready === true;
  } catch {
    return false;
  }
}

/** La 0039 c'è? L'unità è di quel workspace? Una lettura sola, che non tocca le tabelle nuove. */
async function unitState(executor: UcExecutor, scope: BoardScope): Promise<{ ready: boolean; found: boolean }> {
  const [probe, unit] = await executor.batch(preflight(scope));
  return { ready: probe[0]?.ready === true, found: unit.length > 0 };
}

const dependencyPairs = (rows: readonly UcRow[]) =>
  rows.map((row) => ({ sourceActivityId: text(row.source_activity_id) ?? "", targetActivityId: text(row.target_activity_id) ?? "" }));

/**
 * Le attività dell'unità senza riga del passo entrano nel primo processo, nell'ordine di `adoptionOrder`; i passi
 * rimasti senza processo ci tornano. Con le tabelle della 0039 presenti (chi chiama l'ha controllato).
 */
export async function adoptUnit(executor: UcExecutor, scope: BoardScope): Promise<{ adopted: number }> {
  if (!validScope(scope)) return { adopted: 0 };
  const [orphans, loose, dependencies] = await executor.batch(adoptionReads(scope));
  if (orphans.length === 0 && (number(loose[0]?.loose) ?? 0) === 0) return { adopted: 0 };
  const ordered = adoptionOrder(
    orphans.map((row) => ({ id: text(row.id) ?? "", createdAt: date(row.created_at) })),
    dependencyPairs(dependencies),
  );
  const results = await executor.batch(adoptionWrites(scope, ordered, BOARD_TEXT.defaultProcessName));
  return { adopted: results[results.length - 1]?.length ?? 0 };
}

async function loadBoard(executor: UcExecutor, scope: BoardScope, viewer: { userId: string; role: string }): Promise<MappingBoard | null> {
  const [unit, processes, steps, notes, dependencies] = await executor.batch(boardReads(scope, UUID.test(viewer.userId) ? viewer.userId : null));
  return assembleBoard({ unit: unit[0], processes, steps, notes, dependencies }, boardAbilities(viewer.role));
}

async function loadActivitiesOnly(executor: UcExecutor, scope: BoardScope): Promise<MappingBoard | null> {
  const [unit, activities, dependencies] = await executor.batch(activitiesOnlyReads(scope));
  const ordered = adoptionOrder(
    activities.map((row) => ({ id: text(row.id) ?? "", createdAt: date(row.created_at) })),
    dependencyPairs(dependencies),
  );
  return assembleActivitiesOnly({ unit: unit[0], activities, dependencies }, ordered, {
    processId: defaultProcessId(scope.departmentId),
    processName: BOARD_TEXT.defaultProcessName,
    noteId: adoptedNoteId,
  });
}

/** null se l'unità non è di quel workspace. Chiama ensureDbSchema() e adoptUnit(); senza la 0039 legge le sole attività (store «mancante»). */
export async function readBoard(executor: UcExecutor, scope: BoardScope, viewer: { userId: string; role: string }): Promise<MappingBoard | null> {
  if (!validScope(scope)) return null;
  await ensureSchema();
  const state = await unitState(executor, scope);
  if (!state.found) return null;
  if (!state.ready) return loadActivitiesOnly(executor, scope);
  await adoptUnit(executor, scope);
  return loadBoard(executor, scope, viewer);
}

/**
 * Come `readBoard`, per chi ha già una board e chiede se è cambiata (`GET …/board?since=`): se la revisione è quella e
 * l'adozione non ha portato passi nuovi, risponde `unchanged` senza rileggere tutto. (L'adozione non alza la
 * revisione: un passo scritto dal codice di prima si vede dal fatto che è stato adottato adesso.)
 */
export async function readBoardSince(
  executor: UcExecutor,
  scope: BoardScope,
  viewer: { userId: string; role: string },
  since: number | null,
): Promise<{ unchanged: true; revision: number } | { unchanged: false; board: MappingBoard } | null> {
  if (!validScope(scope)) return null;
  await ensureSchema();
  const state = await unitState(executor, scope);
  if (!state.found) return null;
  if (!state.ready) {
    const board = await loadActivitiesOnly(executor, scope);
    return board ? { unchanged: false, board } : null;
  }
  const { adopted } = await adoptUnit(executor, scope);
  if (since !== null && adopted === 0) {
    const [rows] = await executor.batch([revisionRead(scope)]);
    const revision = number(rows[0]?.revision) ?? 0;
    if (revision === since) return { unchanged: true, revision };
  }
  const board = await loadBoard(executor, scope, viewer);
  return board ? { unchanged: false, board } : null;
}

// ─── Scrivere ────────────────────────────────────────────────────────

export type Rejection = { id: string; reason: "conflict" | "gone" | "forbidden" | "limit" | "linked" };
export type SaveResult =
  | { ok: true; revision: number; savedAt: string; rejected: Rejection[]; board: MappingBoard }
  | { ok: false; code: "non_trovata" | "non_valida" | "troppe_modifiche" | "non_disponibile" };

const OUTCOMES: readonly OpOutcome[] = ["ok", "conflict", "gone", "limit", "linked"];

/**
 * In quali passi cambiano le note di «Attriti» e «Dati e documenti»: per una nota modificata o eliminata lo sa solo il
 * database (quelle aggiunte in questo salvataggio le legge `saveBatch` dalle operazioni).
 */
async function touchedLanes(executor: UcExecutor, scope: BoardScope, ops: readonly BoardOp[]): Promise<Record<ProjectedLane, string[]>> {
  const added = new Set(ops.filter((op) => op.t === "note.add").map((op) => op.noteId));
  const unknown = new Set<string>();
  const touched: Record<ProjectedLane, Set<string>> = { attriti: new Set(), dati: new Set() };
  for (const op of ops) {
    if (op.t === "note.remove" || (op.t === "note.set" && op.field === "text")) {
      if (!added.has(op.noteId)) unknown.add(op.noteId);
    }
  }
  if (unknown.size > 0) {
    const [rows] = await executor.batch([noteLanes(scope, [...unknown])]);
    for (const row of rows) {
      const stepId = text(row.activity_id);
      if (stepId && (row.lane === "attriti" || row.lane === "dati")) touched[row.lane].add(stepId);
    }
  }
  // Una nota aggiunta e poi modificata o tolta nello stesso salvataggio: il passo è quello della sua `note.add`.
  for (const op of ops) {
    if (op.t === "note.add" && op.stepId && (op.lane === "attriti" || op.lane === "dati")) touched[op.lane].add(op.stepId);
  }
  return { attriti: [...touched.attriti], dati: [...touched.dati] };
}

/** Due salvataggi insieme possono aspettarsi a vicenda: PostgreSQL ne ferma uno (40P01, 40001). */
const RETRYABLE = new Set(["40P01", "40001"]);

/** La transazione, e una seconda volta se PostgreSQL l'ha fermata per far passare un'altra: niente era stato scritto. */
async function batchOnceMore(executor: UcExecutor, statements: Parameters<UcExecutor["batch"]>[0]): Promise<UcRow[][]> {
  try {
    return await executor.batch(statements);
  } catch (error) {
    const code = (error as { code?: unknown } | null)?.code;
    if (typeof code !== "string" || !RETRYABLE.has(code)) throw error;
    return executor.batch(statements);
  }
}

/** Le operazioni in una transazione, con la coda. Chi chiama ha già controllato schema, unità e adozione. */
async function runOps(executor: UcExecutor, scope: BoardScope, actor: BoardActor, ops: readonly BoardOp[]): Promise<{ rejected: Rejection[]; revision: number; savedAt: string | null }> {
  const touched = await touchedLanes(executor, scope, ops);
  const batch = saveBatch(scope, actor, ops, touched);
  const results = await batchOnceMore(executor, batch.statements);
  const rejected: Rejection[] = [];
  ops.forEach((op, index) => {
    const outcome = results[batch.opAt[index]]?.[0]?.outcome;
    if (outcome === "ok") return;
    rejected.push({ id: op.id, reason: OUTCOMES.includes(outcome as OpOutcome) ? (outcome as Rejection["reason"]) : "gone" });
  });
  const tail = results[batch.revisionAt]?.[0];
  return { rejected, revision: number(tail?.revision) ?? 0, savedAt: isoDate(tail?.updated_at) };
}

/** L'unica strada per scrivere la board: salvataggi del browser, tool dell'assistente, passi dai documenti. */
export async function saveBoardOps(executor: UcExecutor, scope: BoardScope, actor: BoardActor, input: { baseRevision: number; ops: readonly BoardOp[] }): Promise<SaveResult> {
  if (Array.isArray(input?.ops) && input.ops.length > MAPPING_LIMITS.opsPerSave) return { ok: false, code: "troppe_modifiche" };
  const parsed = saveInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, code: "non_valida" };
  if (!validScope(scope)) return { ok: false, code: "non_trovata" };
  const { baseRevision, ops } = parsed.data;

  await ensureSchema();
  const state = await unitState(executor, scope);
  if (!state.found) return { ok: false, code: "non_trovata" };
  if (!state.ready) return { ok: false, code: "non_disponibile" };

  try {
    await adoptUnit(executor, scope);
    // Chi non può modificare non scrive niente; le operazioni dei soli revisori, fatte da altri, escono prima di ogni SQL.
    const abilities = boardAbilities(actor.role);
    const allowed = ops.filter((op) => abilities.edit && (abilities.setStream || !REVIEWER_ONLY_OPS.includes(op.t)));
    const forbidden: Rejection[] = ops.filter((op) => !allowed.includes(op)).map((op) => ({ id: op.id, reason: "forbidden" }));
    const viewer = { userId: actor.userId, role: actor.role };

    if (allowed.length === 0) {
      const board = await loadBoard(executor, scope, viewer);
      if (!board) return { ok: false, code: "non_trovata" };
      return { ok: true, revision: board.revision, savedAt: board.savedAt ?? new Date().toISOString(), rejected: forbidden, board };
    }

    const done = await runOps(executor, scope, actor, allowed);
    const board = await loadBoard(executor, scope, viewer);
    if (!board) return { ok: false, code: "non_trovata" };
    const rejected = [...forbidden, ...done.rejected];
    if (rejected.length > 0) {
      const reasons: Record<string, number> = {};
      for (const { reason } of rejected) reasons[reason] = (reasons[reason] ?? 0) + 1;
      console.info("[mappatura/board] operazioni_rifiutate", JSON.stringify({ ...logContext(scope), attore: actor.kind, baseRevision, revision: done.revision, ...reasons }));
    }
    return { ok: true, revision: done.revision, savedAt: done.savedAt ?? board.savedAt ?? new Date().toISOString(), rejected, board };
  } catch (error) {
    logSafeError("mappatura/board", "salvataggio_non_riuscito", error, { ...logContext(scope), attore: actor.kind });
    throw error;
  }
}

/** I nomi uguali a meno di maiuscole e spazi sono lo stesso processo. */
const nameKey = (name: string) => oneLine(name).toLocaleLowerCase("it");

/**
 * Il processo con quel nome nell'unità (senza badare a maiuscole e spazi), o uno nuovo in fondo; senza nome, il primo,
 * o «Processo principale». null se l'unità non è di quel workspace, se la 0039 manca o se la board ha già il massimo
 * dei processi. L'id di un processo creato qui dipende dall'unità e dal nome: due richieste insieme ne creano uno.
 */
export async function resolveProcess(executor: UcExecutor, scope: BoardScope, name: string | null): Promise<string | null> {
  if (!validScope(scope)) return null;
  await ensureSchema();
  const state = await unitState(executor, scope);
  if (!state.found || !state.ready) return null;
  try {
    await adoptUnit(executor, scope);
    const [rows] = await executor.batch([processNames(scope)]);
    const wanted = name === null ? "" : oneLine(name).slice(0, MAPPING_LIMITS.processName).trimEnd();
    if (!wanted) {
      const first = text(rows[0]?.id);
      if (first) return first;
    } else {
      const same = rows.find((row) => nameKey(text(row.name) ?? "") === nameKey(wanted));
      if (same) return text(same.id);
    }
    const processId = wanted ? namedProcessId(scope.departmentId, nameKey(wanted)) : defaultProcessId(scope.departmentId);
    const op: BoardOp = { id: md5Uuid(`op:${processId}`), t: "process.add", processId, name: wanted || BOARD_TEXT.defaultProcessName };
    // Un processo non ha autore né stato: chi lo crea non conta.
    const done = await runOps(executor, scope, { kind: "assistente", userId: "", role: "" }, [op]);
    return done.rejected.length === 0 ? processId : null;
  } catch (error) {
    logSafeError("mappatura/board", "processo_non_risolto", error, logContext(scope));
    throw error;
  }
}
