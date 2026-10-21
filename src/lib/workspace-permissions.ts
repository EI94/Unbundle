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

/** I ruoli che valutano gli use case: anche le query che filtrano per ruolo usano questo elenco. */
export const PORTFOLIO_REVIEWER_ROLES = Object.freeze(["exec_sponsor", "transformation_lead", "function_lead", "analyst"] as const);

export function canReviewWorkspacePortfolio(role: string | null | undefined) {
  return typeof role === "string" && (PORTFOLIO_REVIEWER_ROLES as readonly string[]).includes(role);
}
