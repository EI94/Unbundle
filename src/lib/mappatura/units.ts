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
import { unitSummaryFromRow } from "./board-rows";
import { unitBoards } from "./board-sql";
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
