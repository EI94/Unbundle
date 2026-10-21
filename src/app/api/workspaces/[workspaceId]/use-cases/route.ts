import { auth } from "@/lib/auth";
import { listUseCasesForRest, viewerFromSession } from "@/lib/db/queries/use-case-hub";
import { toUseCaseApiRows } from "@/lib/portfolio/use-case-client-rows";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/**
 * Elenco degli use case del workspace, solo per chi valuta (come i PATCH di stato, quadrante e
 * punteggi), in tutti i workspace, area accesa o no. Le righe escono dall'allowlist di
 * `toUseCaseApiRow`: niente proponente, niente `reviewedBy`, niente intake del connettore,
 * nemmeno per chi gestisce il workspace. I contributori vedono gli use case nella pagina, con
 * la loro proiezione (D4 e D13).
 *
 * Risposte: 200 `{ useCases }`; 401 senza sessione; 403 senza ruolo da revisore; 404
 * workspace non trovato o senza accesso.
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

  const items = await listUseCasesForRest(workspaceId, viewerFromSession(session.user, access.role));
  if (!items) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ useCases: toUseCaseApiRows(items) });
}
