import { auth } from "@/lib/auth";
import { patchUseCaseScoresBodySchema } from "@/lib/api/use-case-scores-schema";
import { restResponse, restWriteContext, saveLegacyScores } from "@/lib/use-cases/service";
import { toUseCaseApiRow } from "@/lib/portfolio/use-case-client-rows";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/**
 * Aggiorna i punteggi legacy (impatto / fattibilità / ESG, da 1 a 5) con il corpo di oggi,
 * in tutti i workspace. Passa da «Salva la valutazione» del servizio dell'area
 * (docs/use-case/DESIGN.md §9.3), canale `rest`: ricalcola category e punteggi complessivi,
 * segna lo use case come valutato e scrive la riga di Storia.
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

  const parsed = patchUseCaseScoresBodySchema.safeParse(body);
  if (!parsed.success) {
    const flat = parsed.error.flatten();
    const msg =
      flat.formErrors.join("; ") ||
      Object.values(flat.fieldErrors)
        .flat()
        .filter(Boolean)
        .join("; ") ||
      "Input non valido";
    return Response.json({ error: msg }, { status: 400 });
  }

  const result = await saveLegacyScores(
    restWriteContext(session.user, workspaceId, access.role),
    useCaseId,
    parsed.data
  );
  // Errori come li dà il servizio; la scheda passa dall'allowlist della REST.
  if (!result.ok) return restResponse(result);
  return Response.json({ useCase: toUseCaseApiRow(result.value) });
}
