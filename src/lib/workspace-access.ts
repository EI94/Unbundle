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

/**
 * Accesso per tutto ciò che non è la Formazione. Un partecipante a un corso
 * è membro del workspace (ruolo `learner`) ma vede solo i suoi corsi: le
 * azioni del server e le route sono raggiungibili direttamente, quindi
 * ognuna deve escluderlo da sé, non solo la barra laterale.
 */
export async function getCollaboratorAccess(
  userId: string,
  workspaceId: string
): Promise<WorkspaceAccess | null> {
  const access = await getWorkspaceAccessForUser(userId, workspaceId);
  return access && access.role !== "learner" ? access : null;
}
