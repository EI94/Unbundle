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

/**
 * (8.0d-1) I cinque ruoli da collaboratore: i revisori e il Contributore. Sono gli unici che passano le porte del
 * workspace senza opzioni (`workspaceDoor`, src/lib/auth/case-only.ts): chi segue solo un corso (`learner`),
 * «Solo questo use case» (`esterno_caso`) e un ruolo che il codice non conosce restano fuori, finché una porta non li
 * dichiara. Anche le query che chiedono «è un collaboratore?» usano questo elenco, mai «non è `learner`».
 */
export const COLLABORATOR_ROLES = Object.freeze([...PORTFOLIO_REVIEWER_ROLES, "contributor"] as const);

export function isCollaboratorRole(role: string | null | undefined): boolean {
  return typeof role === "string" && (COLLABORATOR_ROLES as readonly string[]).includes(role);
}

/**
 * (8.0d-1) I cinque ruoli da collaboratore come elenco SQL (`role::text IN (…)`): nel SQL il ruolo si confronta come
 * testo, mai come `member_role` (un valore che l'enum non ha ancora è un errore, non un «no»).
 */
export const COLLABORATOR_ROLES_SQL = COLLABORATOR_ROLES.map((role) => `'${role}'`).join(", ");
