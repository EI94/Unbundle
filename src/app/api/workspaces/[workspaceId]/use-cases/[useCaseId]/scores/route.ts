import { auth } from "@/lib/auth";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { updateUseCaseScores } from "@/lib/db/queries/use-cases";
import { patchUseCaseScoresBodySchema } from "@/lib/api/use-case-scores-schema";

/**
 * Aggiorna i punteggi (impatto / fattibilità / ESG) e ricalcola category + overall score.
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
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return Response.json({ error: "Not found" }, { status: 404 });
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

  const updated = await updateUseCaseScores(useCaseId, workspaceId, parsed.data);
  if (!updated) {
    return Response.json({ error: "Use case non trovato" }, { status: 404 });
  }

  return Response.json({ useCase: updated });
}
