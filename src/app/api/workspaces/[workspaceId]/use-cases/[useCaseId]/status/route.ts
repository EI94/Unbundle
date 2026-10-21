import { auth } from "@/lib/auth";
import { patchUseCaseStatusBodySchema } from "@/lib/api/use-case-status-wave-schema";
import { applyLegacyStatus, restResponse, restWriteContext } from "@/lib/use-cases/service";
import { toUseCaseApiRow } from "@/lib/portfolio/use-case-client-rows";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/**
 * Cambia lo stato di uno use case, con il corpo di oggi (`{ status }`), in tutti i
 * workspace. Passa dal servizio dell'area (docs/use-case/DESIGN.md §9.3), canale `rest`, con
 * la riga di Storia. I passaggi ammessi li decide la mappa di oggi (`use-case-lifecycle.ts`,
 * §3.7). Con l'area spenta cambia solo lo stato, come oggi; con l'area accesa `accepted` vale
 * «Approva · Più avanti», `rejected` «Non avviare» senza nota, e le regole di §3.7 valgono
 * come in pagina. Lo stesso stato di adesso non cambia niente.
 *
 * Risposte: 200 `{ useCase }`; 400 corpo non valido o passaggio non ammesso; 401 senza
 * sessione; 403 senza ruolo da revisore; 404 workspace o use case non trovato; 409
 * modificato nel frattempo; 503 stato del dossier non leggibile o errore temporaneo, riprovare.
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

  const parsed = patchUseCaseStatusBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await applyLegacyStatus(
    restWriteContext(session.user, workspaceId, access.role),
    useCaseId,
    parsed.data.status
  );
  // Errori come li dà il servizio; la scheda passa dall'allowlist della REST.
  if (!result.ok) return restResponse(result);
  return Response.json({ useCase: toUseCaseApiRow(result.value) });
}
