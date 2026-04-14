import { eq, and } from "drizzle-orm";
import { db } from "..";
import {
  slackInstallations,
  slackUseCaseDrafts,
  type NewSlackInstallation,
  type NewSlackUseCaseDraft,
} from "../schema";

export async function upsertSlackInstallation(data: NewSlackInstallation) {
  const [row] = await db
    .insert(slackInstallations)
    .values(data)
    .onConflictDoUpdate({
      target: slackInstallations.slackTeamId,
      set: {
        botToken: data.botToken,
        slackTeamName: data.slackTeamName,
        installedBy: data.installedBy,
      },
    })
    .returning();
  return row;
}

export async function getSlackInstallationByTeamId(slackTeamId: string) {
  const [row] = await db
    .select()
    .from(slackInstallations)
    .where(eq(slackInstallations.slackTeamId, slackTeamId))
    .limit(1);
  return row ?? null;
}

export async function getSlackInstallationByWorkspace(workspaceId: string) {
  const [row] = await db
    .select()
    .from(slackInstallations)
    .where(eq(slackInstallations.workspaceId, workspaceId))
    .limit(1);
  return row ?? null;
}

export async function updateSlackNotifyChannel(
  installationId: string,
  channelId: string
) {
  await db
    .update(slackInstallations)
    .set({ notifyChannelId: channelId })
    .where(eq(slackInstallations.id, installationId));
}

export async function getOrCreateDraft(
  workspaceId: string,
  slackUserId: string,
  slackTeamId: string,
  slackThreadTs?: string
) {
  const existing = await db
    .select()
    .from(slackUseCaseDrafts)
    .where(
      and(
        eq(slackUseCaseDrafts.workspaceId, workspaceId),
        eq(slackUseCaseDrafts.slackUserId, slackUserId),
        eq(slackUseCaseDrafts.status, "drafting")
      )
    )
    .limit(1);

  if (existing.length > 0) return existing[0];

  const [row] = await db
    .insert(slackUseCaseDrafts)
    .values({
      workspaceId,
      slackUserId,
      slackTeamId,
      slackThreadTs: slackThreadTs ?? null,
      status: "drafting",
    })
    .returning();
  return row;
}

export async function updateDraft(
  draftId: string,
  data: Partial<NewSlackUseCaseDraft>
) {
  const [row] = await db
    .update(slackUseCaseDrafts)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(slackUseCaseDrafts.id, draftId))
    .returning();
  return row;
}

export async function markDraftSubmitted(draftId: string) {
  const [row] = await db
    .update(slackUseCaseDrafts)
    .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(slackUseCaseDrafts.id, draftId))
    .returning();
  return row;
}

export async function getDraftById(draftId: string) {
  const [row] = await db
    .select()
    .from(slackUseCaseDrafts)
    .where(eq(slackUseCaseDrafts.id, draftId))
    .limit(1);
  return row ?? null;
}
