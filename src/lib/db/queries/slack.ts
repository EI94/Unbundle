import { eq, and, lt, gte, desc, isNull } from "drizzle-orm";
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
  channelId: string | null
) {
  await db
    .update(slackInstallations)
    .set({ notifyChannelId: channelId?.trim() || null })
    .where(eq(slackInstallations.id, installationId));
}

export async function getOrCreateDraft(
  workspaceId: string,
  slackUserId: string,
  slackTeamId: string,
  slackThreadTs: string | undefined,
  contributionKind: "best_practice" | "use_case_ai" | null
) {
  const query = db
    .select()
    .from(slackUseCaseDrafts)
    .where(
      and(
        eq(slackUseCaseDrafts.workspaceId, workspaceId),
        eq(slackUseCaseDrafts.slackUserId, slackUserId),
        eq(slackUseCaseDrafts.status, "drafting"),
        ...(contributionKind
          ? [eq(slackUseCaseDrafts.contributionKind, contributionKind)]
          : [])
      )
    )
    .orderBy(desc(slackUseCaseDrafts.updatedAt))
    .limit(1);

  const existing = await query;

  if (existing.length > 0) return existing[0];

  const [row] = await db
    .insert(slackUseCaseDrafts)
    .values({
      workspaceId,
      slackUserId,
      slackTeamId,
      slackThreadTs: slackThreadTs ?? null,
      contributionKind: contributionKind ?? null,
      status: "drafting",
    })
    .returning();
  return row;
}

export async function updateDraft(
  draftId: string,
  data: Partial<NewSlackUseCaseDraft>,
  opts?: { touchUpdatedAt?: boolean }
) {
  const touch = opts?.touchUpdatedAt !== false;
  const [row] = await db
    .update(slackUseCaseDrafts)
    .set(touch ? { ...data, updatedAt: new Date() } : { ...data })
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

/** Evita doppio submit e race: aggiorna solo se lo stato è ancora `drafting`. */
export async function markDraftSubmittedIfDrafting(draftId: string) {
  const [row] = await db
    .update(slackUseCaseDrafts)
    .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(slackUseCaseDrafts.id, draftId),
        eq(slackUseCaseDrafts.status, "drafting")
      )
    )
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

/** Draft inattivi da ≥48h: passa a `abandoned` (non aggiorna `updated_at`). */
export async function abandonSlackDraftsInactiveSince(cutoff: Date) {
  return db
    .update(slackUseCaseDrafts)
    .set({
      status: "abandoned",
      abandonedAt: new Date(),
    })
    .where(
      and(
        eq(slackUseCaseDrafts.status, "drafting"),
        lt(slackUseCaseDrafts.updatedAt, cutoff)
      )
    )
    .returning();
}

/**
 * Draft tra 24h e 48h senza aggiornamenti, reminder non ancora inviato.
 */
export async function listSlackDraftsFor24hReminder(
  olderThan: Date,
  notOlderThan: Date
) {
  return db
    .select()
    .from(slackUseCaseDrafts)
    .where(
      and(
        eq(slackUseCaseDrafts.status, "drafting"),
        isNull(slackUseCaseDrafts.reminder24hSentAt),
        lt(slackUseCaseDrafts.updatedAt, olderThan),
        gte(slackUseCaseDrafts.updatedAt, notOlderThan)
      )
    );
}

export async function markSlackDraftReminderSent(draftId: string) {
  const [row] = await db
    .update(slackUseCaseDrafts)
    .set({ reminder24hSentAt: new Date() })
    .where(eq(slackUseCaseDrafts.id, draftId))
    .returning();
  return row;
}
