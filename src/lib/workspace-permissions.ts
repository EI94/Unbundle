export function canDeleteWorkspace(role: string | null | undefined) {
  return role === "exec_sponsor" || role === "transformation_lead";
}

export function canManageWorkspaceCollaborators(
  role: string | null | undefined
) {
  return role === "exec_sponsor" || role === "transformation_lead";
}

export function canManageWorkspaceSettings(role: string | null | undefined) {
  return role === "exec_sponsor" || role === "transformation_lead";
}

export function canReviewWorkspacePortfolio(role: string | null | undefined) {
  return (
    role === "exec_sponsor" ||
    role === "transformation_lead" ||
    role === "function_lead" ||
    role === "analyst"
  );
}
