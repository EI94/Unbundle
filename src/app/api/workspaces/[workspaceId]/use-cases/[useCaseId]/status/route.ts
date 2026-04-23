import { auth } from "@/lib/auth";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { updateUseCaseStatus } from "@/lib/db/queries/use-cases";
import { patchUseCaseStatusBodySchema } from "@/lib/api/use-case-status-wave-schema";

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

  const parsed = patchUseCaseStatusBodySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const result = await updateUseCaseStatus(
    useCaseId,
    workspaceId,
    parsed.data.status
  );
  if (!result.ok) {
    return Response.json({ error: result.error }, { status: 400 });
  }

  return Response.json({ useCase: result.useCase });
}
