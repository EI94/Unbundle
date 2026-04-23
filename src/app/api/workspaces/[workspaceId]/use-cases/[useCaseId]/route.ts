import { auth } from "@/lib/auth";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getUseCaseById } from "@/lib/db/queries/use-cases";

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
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const useCase = await getUseCaseById(useCaseId);
  if (!useCase || useCase.workspaceId !== workspaceId) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json({ useCase });
}
