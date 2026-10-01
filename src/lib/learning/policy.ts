/** Pure privacy/output helpers; never infer learning grants from portfolio roles. */
export type LearningCapability = "manage" | "review" | "aggregate" | "export";
export function grantCoversCohort(grants: { capability: string; cohortId: string | null }[], capability: LearningCapability, cohortId: string): boolean {
  return grants.some(g => g.capability === capability && (g.cohortId === null || g.cohortId === cohortId));
}
export function csvCell(value: unknown): string {
  const raw = String(value ?? "");
  // Spreadsheet programs can ignore leading whitespace/control characters.
  const escaped = /^[\s\u0000-\u0020\u007f-\u009f]*[=+@-]/u.test(raw) ? `'${raw}` : raw;
  return `"${escaped.replaceAll('"', '""')}"`;
}
export function suppressSmallSplit(total: number, count: number, minimum = 5): number | null {
  if (total < minimum || (count > 0 && count < minimum) || (total - count > 0 && total - count < minimum)) return null;
  return count;
}

export function m1ReleaseMinutes(activity: {module_id:string;type:string;purpose:string}): number | null {
  if(activity.module_id!=="m1")return null;
  if(activity.type==="case_review")return 78;
  if(activity.type==="knowledge_check" && activity.purpose==="formative")return 30;
  if(activity.type==="knowledge_check" && ["post_module","retake"].includes(activity.purpose))return 105;
  return null;
}
