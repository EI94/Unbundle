import { eq, and, lt, gte, desc, isNull, or } from "drizzle-orm";
import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";
import {
  slackInstallations,
  slackUseCaseDrafts,
  type NewSlackInstallation,
  type NewSlackUseCaseDraft,
} from "../schema";

export async function upsertSlackInstallation(data: NewSlackInstallation) {
  await ensureDbSchema();
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
  await ensureDbSchema();
  const [row] = await db
    .select()
    .from(slackInstallations)
    .where(eq(slackInstallations.slackTeamId, slackTeamId))
    .limit(1);
  return row ?? null;
}

export async function getSlackInstallationByWorkspace(workspaceId: string) {
  await ensureDbSchema();
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
  await ensureDbSchema();
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
  await ensureDbSchema();
  const filters = [
    eq(slackUseCaseDrafts.workspaceId, workspaceId),
    eq(slackUseCaseDrafts.slackUserId, slackUserId),
    eq(slackUseCaseDrafts.slackTeamId, slackTeamId),
    eq(slackUseCaseDrafts.status, "drafting"),
    ...(contributionKind
      ? [eq(slackUseCaseDrafts.contributionKind, contributionKind)]
      : []),
  ];

  if (slackThreadTs) {
    filters.push(
      or(
        eq(slackUseCaseDrafts.slackThreadTs, slackThreadTs),
        isNull(slackUseCaseDrafts.slackThreadTs)
      )!
    );
  } else {
    filters.push(isNull(slackUseCaseDrafts.slackThreadTs));
  }

  const query = db
    .select()
    .from(slackUseCaseDrafts)
    .where(and(...filters))
    .orderBy(desc(slackUseCaseDrafts.updatedAt))
    .limit(1);

  const existing = await query;

  if (existing.length > 0) {
    const draft = existing[0];
    if (slackThreadTs && !draft.slackThreadTs) {
      await updateDraft(draft.id, { slackThreadTs }, { touchUpdatedAt: false });
      return { ...draft, slackThreadTs };
    }
    return draft;
  }

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

export async function getLatestOpenDraftForSlackConversation(params: {
  workspaceId: string;
  slackUserId: string;
  slackTeamId: string;
  slackChannelId: string;
  updatedAfter: Date;
}) {
  await ensureDbSchema();
  const rows = await db
    .select()
    .from(slackUseCaseDrafts)
    .where(
      and(
        eq(slackUseCaseDrafts.workspaceId, params.workspaceId),
        eq(slackUseCaseDrafts.slackUserId, params.slackUserId),
        eq(slackUseCaseDrafts.slackTeamId, params.slackTeamId),
        eq(slackUseCaseDrafts.slackChannelId, params.slackChannelId),
        eq(slackUseCaseDrafts.status, "drafting"),
        gte(slackUseCaseDrafts.updatedAt, params.updatedAfter)
      )
    )
    .orderBy(desc(slackUseCaseDrafts.updatedAt))
    .limit(10);

  return (
    rows.find(
      (row) =>
        row.contributionKind ||
        row.title ||
        row.problem ||
        row.flowDescription ||
        row.expectedImpact ||
        row.humanInTheLoop ||
        row.dataRequirements
    ) ??
    rows[0] ??
    null
  );
}

export async function updateDraft(
  draftId: string,
  data: Partial<NewSlackUseCaseDraft>,
  opts?: { touchUpdatedAt?: boolean }
) {
  await ensureDbSchema();
  const touch = opts?.touchUpdatedAt !== false;
  const [row] = await db
    .update(slackUseCaseDrafts)
    .set(touch ? { ...data, updatedAt: new Date() } : { ...data })
    .where(eq(slackUseCaseDrafts.id, draftId))
    .returning();
  return row;
}

export async function markDraftSubmitted(draftId: string) {
  await ensureDbSchema();
  const [row] = await db
    .update(slackUseCaseDrafts)
    .set({ status: "submitted", submittedAt: new Date(), updatedAt: new Date() })
    .where(eq(slackUseCaseDrafts.id, draftId))
    .returning();
  return row;
}

/** Evita doppio submit e race: aggiorna solo se lo stato è ancora `drafting`. */
export async function markDraftSubmittedIfDrafting(draftId: string) {
  await ensureDbSchema();
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
  await ensureDbSchema();
  const [row] = await db
    .select()
    .from(slackUseCaseDrafts)
    .where(eq(slackUseCaseDrafts.id, draftId))
    .limit(1);
  return row ?? null;
}

/** Draft inattivi da ≥48h: passa a `abandoned` (non aggiorna `updated_at`). */
export async function abandonSlackDraftsInactiveSince(cutoff: Date) {
  await ensureDbSchema();
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
  await ensureDbSchema();
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
  await ensureDbSchema();
  const [row] = await db
    .update(slackUseCaseDrafts)
    .set({ reminder24hSentAt: new Date() })
    .where(eq(slackUseCaseDrafts.id, draftId))
    .returning();
  return row;
}
