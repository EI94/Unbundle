import { cache } from "react";
import { isCaseOnly, workspaceDoor } from "@/lib/auth/case-only";
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
  // (8.0d) «Solo questo use case» vive solo nel workspace: una riga dell'organizzazione con quel ruolo (che il codice non
  // scrive mai) non dà niente, né il perimetro né il resto. Decide la riga del workspace, se c'è.
  if (organizationMembership && !isCaseOnly(organizationMembership.role)) {
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
 *
 * (8.0d-1) Chiusa per default, aperta per elenco (`workspaceDoor`): passano solo
 * i cinque ruoli da collaboratore. «Solo questo use case» (`esterno_caso`) passa
 * solo dove la porta lo dichiara (`allowCaseOnly`, solo nei file di
 * `CASE_ONLY_SURFACES`), e lì serve poi il predicato per il caso. Chi segue un
 * corso e un ruolo che il codice non conosce non passano mai.
 */
export async function getCollaboratorAccess(
  userId: string,
  workspaceId: string,
  opts: { allowCaseOnly?: boolean } = {}
): Promise<WorkspaceAccess | null> {
  const access = await getWorkspaceAccessForUser(userId, workspaceId);
  return access && workspaceDoor(access.role, { allowCaseOnly: opts.allowCaseOnly === true }) === "aperta" ? access : null;
}
