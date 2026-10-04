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

/**
 * Minuti dall'inizio del turno in cui un'attività si apre.
 * Un corso può dichiararli (opens_after_minutes); altrimenti valgono i tempi del
 * primo modulo da due ore per cui il modulo è nato. Solo M1: le iscrizioni sono
 * per M1, e un'attività di un altro modulo verrebbe aperta sul turno sbagliato.
 */
export function m1ReleaseMinutes(activity: {module_id:string;type:string;purpose:string;opens_after_minutes?:number}): number | null {
  if(activity.module_id!=="m1")return null;
  if(typeof activity.opens_after_minutes==="number")return activity.opens_after_minutes;
  if(activity.type==="case_review")return 78;
  if(activity.type==="knowledge_check" && activity.purpose==="formative")return 30;
  if(activity.type==="knowledge_check" && ["post_module","retake"].includes(activity.purpose))return 105;
  return null;
}

/** Formative completion is a submission outcome, never a competence/consolidation count. */
export function summarizeActivityOutcomes(enrolled: number, statuses: Array<string | null>, formative: boolean, minimum = 5) {
  const submitted = suppressSmallSplit(enrolled, statuses.length, minimum);
  const successful = statuses.filter(status => status === (formative ? "formative_completed" : "consolidated")).length;
  const value = submitted === null ? null : suppressSmallSplit(statuses.length, successful, minimum);
  return { submitted, consolidated: formative ? null : value, completed: formative ? value : null, suppressed: submitted === null || statuses.length < minimum };
}
