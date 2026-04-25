export function canDeleteWorkspace(role: string | null | undefined) {
  return role === "exec_sponsor" || role === "transformation_lead";
}
