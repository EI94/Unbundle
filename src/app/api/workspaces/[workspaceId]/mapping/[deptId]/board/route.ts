import { logSafeError } from "@/lib/log/safe-error";
import { boardJson, boardRequest } from "@/lib/mappatura/board-access";
import { readBoardSince, saveBoardOps } from "@/lib/mappatura/board-store";

/**
 * La board di un'unità (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.4).
 *
 * `GET ?since=<revisione>`: la board per chi guarda, oppure `{ unchanged: true }` se è ancora quella.
 * `PUT { baseRevision, ops }`: salva le operazioni; quelle rifiutate tornano una per una, le altre sono salvate.
 * Route handler e non server action: il browser manda le ultime modifiche mentre la pagina si chiude
 * (`fetch(…, { keepalive: true })`). Sessione, collaboratore del workspace, unità del workspace: `boardRequest`.
 */
type Context = { params: Promise<{ workspaceId: string; deptId: string }> };

export async function GET(request: Request, { params }: Context): Promise<Response> {
  const entry = await boardRequest(params);
  if (entry instanceof Response) return entry;
  const raw = new URL(request.url).searchParams.get("since");
  const since = raw !== null && /^\d{1,15}$/.test(raw) ? Number(raw) : null;
  try {
    const result = await readBoardSince(entry.executor, entry.scope, { userId: entry.actor.userId, role: entry.actor.role }, since);
    if (!result) return boardJson({ code: "non_trovata" }, 404);
    return result.unchanged ? boardJson({ unchanged: true, revision: result.revision }) : boardJson({ board: result.board });
  } catch (error) {
    logSafeError("mappatura/board", "lettura_non_riuscita", error, { workspaceId: entry.scope.workspaceId, departmentId: entry.scope.departmentId });
    return boardJson({ code: "errore" }, 500);
  }
}

export async function PUT(request: Request, { params }: Context): Promise<Response> {
  const entry = await boardRequest(params);
  if (entry instanceof Response) return entry;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return boardJson({ code: "non_valida" }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return boardJson({ code: "non_valida" }, 400);
  try {
    const result = await saveBoardOps(entry.executor, entry.scope, entry.actor, body as { baseRevision: number; ops: [] });
    if (result.ok) return boardJson({ revision: result.revision, savedAt: result.savedAt, rejected: result.rejected, board: result.board });
    const status = { non_valida: 400, troppe_modifiche: 413, non_disponibile: 503, non_trovata: 404 }[result.code];
    return boardJson({ code: result.code }, status);
  } catch {
    // L'errore è già nel log (saveBoardOps), senza testi.
    return boardJson({ code: "errore" }, 500);
  }
}
