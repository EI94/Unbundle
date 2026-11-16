import "server-only";

/**
 * «Mappatura board»: chi entra nelle rotte della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.4, §6).
 *
 * Le rotte sono raggiungibili direttamente: ognuna controlla da sé la sessione, che chi chiama sia un collaboratore di
 * quel workspace (chi segue solo un corso no) e che l'unità sia di quel workspace. Nessun id arrivato dal browser vale
 * prima di questi tre controlli. Chi non è un collaboratore e chi chiede un'unità di un altro workspace ricevono la
 * stessa risposta: 404.
 */
import { auth } from "@/lib/auth";
import { getAppUcExecutor, type UcExecutor } from "@/lib/db/uc-executor";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { preflight, type BoardActor, type BoardScope } from "./board-sql";

export { boardAbilities } from "./abilities";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Una risposta JSON delle rotte della board: mai in cache. */
export function boardJson(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

const notFound = () => boardJson({ code: "non_trovata" }, 404);

/** Sessione, getCollaboratorAccess, unità del workspace: lo scope, l'attore e chi guarda, oppure la risposta 401/404. */
export async function boardRequest(
  params: Promise<{ workspaceId: string; deptId: string }>,
): Promise<{ scope: BoardScope; actor: BoardActor; workspaceName: string; executor: UcExecutor } | Response> {
  const session = await auth();
  if (!session?.user?.id) return boardJson({ code: "non_autenticato" }, 401);
  const { workspaceId, deptId } = await params;
  if (!UUID.test(workspaceId) || !UUID.test(deptId)) return notFound();
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) return notFound();
  const scope: BoardScope = { workspaceId: workspaceId.toLowerCase(), departmentId: deptId.toLowerCase() };
  const executor = await getAppUcExecutor();
  const [unit] = await executor.batch([preflight(scope)[1]]);
  if (unit.length === 0) return notFound();
  return { scope, actor: { kind: "persona", userId: session.user.id, role: access.role }, workspaceName: access.workspace.name, executor };
}
