import { auth } from "@/lib/auth";
import { updateUseCaseWaveCategory } from "@/lib/db/queries/use-cases";
import { patchUseCaseWaveBodySchema } from "@/lib/api/use-case-status-wave-schema";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";
import { canReviewWorkspacePortfolio } from "@/lib/workspace-permissions";

/**
 * Imposta manualmente il quadrante (categoria wave) senza modificare i punteggi.
 * Nota: un successivo `PATCH .../scores` ricalcola la categoria dagli score.
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
  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
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

  const result = await updateUseCaseWaveCategory(
    useCaseId,
    workspaceId,
    parsed.data.category
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ useCase: result.useCase });
}
