import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import { getUserMembership } from "@/lib/db/queries/organizations";

export async function userHasWorkspaceAccess(
  userId: string,
  workspaceId: string
): Promise<boolean> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return false;
  const membership = await getUserMembership(
    userId,
    workspace.organizationId
  );
  return !!membership;
}
