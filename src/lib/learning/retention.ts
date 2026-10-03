/** Retention uses elapsed 24-hour days from the recorded closure instant. */
export function learningRetentionEligibility(input: { status: string; closedAt: Date | null; retentionDays: number }, now = new Date()) {
  if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 3650 || !Number.isFinite(now.getTime())) throw new Error("Invalid retention configuration");
  if (input.closedAt && !Number.isFinite(input.closedAt.getTime())) throw new Error("Invalid closure timestamp");
  const expiresAt = input.closedAt ? new Date(input.closedAt.getTime() + input.retentionDays * 86_400_000) : null;
  const eligible = ["closed", "archived"].includes(input.status) && expiresAt !== null && expiresAt.getTime() <= now.getTime();
  return { eligible, expiresAt };
}
