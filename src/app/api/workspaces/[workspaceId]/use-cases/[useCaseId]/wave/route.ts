import { auth } from "@/lib/auth";
import { patchUseCaseWaveBodySchema } from "@/lib/api/use-case-status-wave-schema";
import { restResponse, restWriteContext, setLegacyCategory } from "@/lib/use-cases/service";
import { toUseCaseApiRow } from "@/lib/portfolio/use-case-client-rows";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/**
 * Deprecata (docs/use-case/DESIGN.md §9.3): imposta a mano il quadrante (`category`) senza
 * modificare i punteggi. La categoria non si mostra più; la rotta resta con la forma di oggi
 * finché non si toglie con la pulizia (fase 6). Passa dal servizio dell'area, canale `rest`,
 * con la riga di Storia. Un successivo `PATCH .../scores` ricalcola la categoria dai punteggi.
 *
 * Risposte: 200 `{ useCase }`; 400 corpo non valido; 401 senza sessione; 403 senza ruolo da
 * revisore; 404 workspace o use case non trovato; 409 modificato nel frattempo; 503 errore
 * temporaneo, riprovare.
 */
export async function PATCH(
  req: Request,
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

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Body JSON non valido" }, { status: 400 });
  }

  const parsed = patchUseCaseWaveBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await setLegacyCategory(
    restWriteContext(session.user, workspaceId, access.role),
    useCaseId,
    parsed.data.category
  );
  // Errori come li dà il servizio; la scheda passa dall'allowlist della REST.
  if (!result.ok) return restResponse(result);
  return Response.json({ useCase: toUseCaseApiRow(result.value) });
}
