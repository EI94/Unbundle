import { auth } from "@/lib/auth";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const items = await getUseCasesByWorkspace(workspaceId);
  return Response.json({ useCases: items });
}
