import { auth } from "@/lib/auth";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { toUseCaseApiRows } from "@/lib/portfolio/use-case-client-rows";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/**
 * Elenco degli use case del workspace, solo per chi valuta (come i PATCH di stato, quadrante e
 * punteggi). Le righe escono dall'allowlist di `toUseCaseApiRow`: niente proponente, niente
 * `reviewedBy`, niente intake del connettore.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceId } = await params;
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  if (!canReviewWorkspacePortfolio(access.role)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const items = await getUseCasesByWorkspace(workspaceId);
  return Response.json({ useCases: toUseCaseApiRows(items) });
}
