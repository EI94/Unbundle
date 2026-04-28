import { auth } from "@/lib/auth";
import { getUseCasesByWorkspace } from "@/lib/db/queries/use-cases";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceId } = await params;
  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  const items = await getUseCasesByWorkspace(workspaceId);
  return Response.json({ useCases: items });
}
