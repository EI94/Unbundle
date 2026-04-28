import { cache } from "react";
import { getUserMembership } from "@/lib/db/queries/organizations";
import { getWorkspaceMembershipByUser } from "@/lib/db/queries/workspace-collaboration";
import { getWorkspaceById } from "@/lib/db/queries/workspaces";
import type { Workspace } from "@/lib/db/schema";

export type WorkspaceAccess = {
  workspace: Workspace;
  role: string;
  source: "organization" | "workspace";
};

export const getWorkspaceAccessForUser = cache(async function getWorkspaceAccessForUser(
  userId: string,
  workspaceId: string
): Promise<WorkspaceAccess | null> {
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) return null;

  const organizationMembership = await getUserMembership(
    userId,
    workspace.organizationId
  );
  if (organizationMembership) {
    return {
      workspace,
      role: organizationMembership.role,
      source: "organization",
    };
  }

  const workspaceMembership = await getWorkspaceMembershipByUser(
    userId,
    workspaceId
  );
  if (workspaceMembership) {
    return {
      workspace,
      role: workspaceMembership.role,
      source: "workspace",
    };
  }

  return null;
});
