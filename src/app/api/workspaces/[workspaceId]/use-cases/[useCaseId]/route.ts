import { auth } from "@/lib/auth";
import { getUseCaseForRest, viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { toUseCaseApiRow } from "@/lib/portfolio/use-case-client-rows";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/**
 * Dettaglio di uno use case, solo per chi valuta, con l'allowlist di `toUseCaseApiRow`, in
 * tutti i workspace.
 *
 * Risposte: 200 `{ useCase }`; 401 senza sessione; 403 senza ruolo da revisore; 404
 * workspace o use case non trovato.
 */
export async function GET(
  _req: Request,
  {
    params,
  }: { params: Promise<{ workspaceId: string; useCaseId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceId, useCaseId } = await params;
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!canReviewWorkspacePortfolio(access.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const useCase = await getUseCaseForRest(workspaceId, useCaseId, viewerFromSession(session.user, access.role));
  if (!useCase) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ useCase: toUseCaseApiRow(useCase) });
}
