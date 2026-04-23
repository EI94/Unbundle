/** Quadranti matrice impatto / fattibilità (wave planning). */
export const USE_CASE_CATEGORIES = [
  "quick_win",
  "strategic_bet",
  "capability_builder",
  "not_yet",
] as const;

export type UseCaseCategoryValue = (typeof USE_CASE_CATEGORIES)[number];

export const USE_CASE_STATUSES = [
  "draft",
  "proposed",
  "accepted",
  "in_progress",
  "implemented",
  "rejected",
] as const;

export type UseCaseStatusValue = (typeof USE_CASE_STATUSES)[number];

const transitions: Record<string, readonly UseCaseStatusValue[]> = {
  draft: ["accepted", "rejected"],
  proposed: ["accepted", "rejected"],
  accepted: ["in_progress", "implemented", "rejected"],
  in_progress: ["implemented", "rejected"],
  implemented: [],
  rejected: [],
};

export function isAllowedStatusTransition(
  from: string,
  to: string
): boolean {
  const allowed = transitions[from] ?? [];
  return (allowed as readonly string[]).includes(to);
}

export function allowedNextStatuses(from: string): readonly UseCaseStatusValue[] {
  return transitions[from] ?? [];
}

export function isValidCategory(c: string): c is UseCaseCategoryValue {
  return (USE_CASE_CATEGORIES as readonly string[]).includes(c);
}
