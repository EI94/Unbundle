import "server-only";

/**
 * «Mappatura board»: le unità di un workspace con i numeri della loro board, per l'elenco
 * (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.2, §4.6).
 *
 * Una lettura sola al posto di una per unità. Non adotta: conta con un LEFT JOIN, e un'attività non ancora sulla
 * board conta come passo «da validare». Senza la 0039 conta dalle sole attività.
 */
import type { UcExecutor } from "@/lib/db/uc-executor";
import type { UnitBoardSummary } from "./board-model";
import { text, unitSummaryFromRow } from "./board-rows";
import { unitAdd, unitAddLock, unitBoards, unitDocuments, unitNameRead, type BoardScope } from "./board-sql";
import { mappingStoreReady } from "./board-store";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function listUnitBoards(executor: UcExecutor, workspaceId: string): Promise<UnitBoardSummary[]> {
  if (!UUID.test(workspaceId)) return [];
  // Il self-heal dello schema parte da qui: la prima pagina della mappatura aperta dopo un deploy applica la 0039.
  const { ensureDbSchema } = await import("@/lib/db/ensure-schema");
  await ensureDbSchema();
  const ready = await mappingStoreReady(executor);
  const [rows] = await executor.batch([unitBoards(workspaceId, ready)]);
  return rows.map(unitSummaryFromRow);
}

/** L'unità ha almeno un documento caricato, in quel workspace? Per «Proponi passi dai documenti» (§1.5, §5.5). */
export async function unitHasDocuments(executor: UcExecutor, scope: BoardScope): Promise<boolean> {
  if (!UUID.test(scope.workspaceId) || !UUID.test(scope.departmentId)) return false;
  const [rows] = await executor.batch([unitDocuments(scope)]);
  return rows[0]?.has === true;
}

/**
 * Il nome di un'unità di quel workspace, letto come lo legge la board (`readBoard`); null se l'unità non è del workspace.
 * Per la cornice della board che si apre (`mapping/[deptId]/layout.tsx`): il titolo vero, che va a capo come quello
 * della board che arriva, così la pagina non salta (§1.6).
 */
export async function unitName(executor: UcExecutor, scope: BoardScope): Promise<string | null> {
  if (!UUID.test(scope.workspaceId) || !UUID.test(scope.departmentId)) return null;
  const [rows] = await executor.batch([unitNameRead(scope)]);
  return rows.length > 0 ? (text(rows[0].name) ?? "") : null;
}

export type AddUnitOutcome = { ok: true; departmentId: string } | { ok: false; reason: "duplicate" | "full" };

/**
 * (Rilascio 10, §3.7, F-160) Un'unità nuova del workspace, con il solo nome (già pulito e controllato da chi chiama, con
 * i permessi): una transazione con il lucchetto del workspace, il controllo del nome uguale e il tetto delle unità
 * (`unitAdd` in board-sql.ts). Nessun modello, nessuna e-mail.
 */
export async function addUnit(executor: UcExecutor, workspaceId: string, name: string): Promise<AddUnitOutcome> {
  if (!UUID.test(workspaceId)) throw new Error("workspace non valido");
  const [, rows] = await executor.batch([unitAddLock(workspaceId), unitAdd(workspaceId, name)]);
  const row = rows[0];
  const id = text(row?.id);
  if (id) return { ok: true, departmentId: id };
  return { ok: false, reason: row?.same === true ? "duplicate" : "full" };
}
