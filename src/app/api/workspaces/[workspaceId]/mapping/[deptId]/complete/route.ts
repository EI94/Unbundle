import { chatDeadline } from "@/lib/ai/models";
import { logSafeError } from "@/lib/log/safe-error";
import { boardJson, boardRequest } from "@/lib/mappatura/board-access";
import { readBoard } from "@/lib/mappatura/board-store";
import { appCompleteDeps, completeUnitMapping } from "@/lib/mappatura/complete";

/**
 * «Completa la mappatura» e «Classifica N passi» (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.4, §4.5).
 *
 * `POST {}`: segna l'unità completa (una volta sola), classifica i passi senza stream e cerca il codice O*NET di quelli
 * senza codice, fino alla scadenza; risponde con l'esito e con la board. Chiamata di nuovo, continua con quello che
 * resta. La classificazione chiama il modello per ogni passo: per questo la rotta ha il suo `maxDuration`, e le
 * chiamate si fermano 25 secondi prima (`chatDeadline`: 95 secondi di 120), così la risposta parte in tempo.
 */
export const maxDuration = 120;

export async function POST(_request: Request, { params }: { params: Promise<{ workspaceId: string; deptId: string }> }): Promise<Response> {
  const startedAt = Date.now();
  const entry = await boardRequest(params);
  if (entry instanceof Response) return entry;
  try {
    const outcome = await completeUnitMapping(appCompleteDeps(entry.executor), { scope: entry.scope, deadline: chatDeadline(startedAt, maxDuration) });
    // L'unità c'è (`boardRequest`): senza esito manca la 0039, e la mappatura per ora si legge soltanto.
    if (!outcome) return boardJson({ code: "non_disponibile" }, 503);
    const board = await readBoard(entry.executor, entry.scope, { userId: entry.actor.userId, role: entry.actor.role });
    if (!board) return boardJson({ code: "non_trovata" }, 404);
    return boardJson({ outcome, board });
  } catch (error) {
    logSafeError("mappatura/complete", "completamento_non_riuscito", error, { workspaceId: entry.scope.workspaceId, departmentId: entry.scope.departmentId });
    return boardJson({ code: "errore" }, 500);
  }
}
