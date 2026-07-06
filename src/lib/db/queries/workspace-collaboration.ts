import { and, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";
import {
  memberships,
  organizations,
  users,
  workspaces,
  workspaceInvitationAcceptances,
  workspaceInvitations,
  workspaceMemberships,
  type WorkspaceMembership,
} from "../schema";
import {
  createInviteToken,
  hashInviteToken,
  isInvitationActive,
  WORKSPACE_INVITE_EXPIRES_IN_DAYS,
  WORKSPACE_INVITE_MAX_USES,
} from "@/lib/workspace-invite-token";

export const WORKSPACE_COLLABORATOR_ROLES = [
  "transformation_lead",
  "function_lead",
  "contributor",
  "analyst",
] as const;

export type WorkspaceCollaboratorRole =
  | "exec_sponsor"
  | (typeof WORKSPACE_COLLABORATOR_ROLES)[number];

function normalizeEmail(email: string | null | undefined) {
  const trimmed = email?.trim().toLowerCase() ?? "";
  return trimmed.length > 0 ? trimmed : null;
}

export async function createWorkspaceInvitation(params: {
  workspaceId: string;
  organizationId: string;
  role: WorkspaceCollaboratorRole;
  email?: string | null;
  maxUses?: number;
  expiresInDays?: number;
  createdByUserId: string;
}) {
  await ensureDbSchema();
  const token = createInviteToken();
  const tokenHash = hashInviteToken(token);
  const maxUses = Math.max(
    1,
    Math.min(25, Math.trunc(params.maxUses ?? WORKSPACE_INVITE_MAX_USES))
  );
  const expiresInDays = Math.max(
    1,
    Math.min(30, Math.trunc(params.expiresInDays ?? WORKSPACE_INVITE_EXPIRES_IN_DAYS))
  );
  const expiresAt = new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000);

  const [invitation] = await db
    .insert(workspaceInvitations)
    .values({
      workspaceId: params.workspaceId,
      organizationId: params.organizationId,
      role: params.role,
      email: normalizeEmail(params.email),
      tokenHash,
      maxUses,
      expiresAt,
      createdByUserId: params.createdByUserId,
    })
    .returning();

  return { invitation, token };
}

export async function revokeWorkspaceInvitation(params: {
  invitationId: string;
  workspaceId: string;
}) {
  await ensureDbSchema();
  const [invitation] = await db
    .update(workspaceInvitations)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workspaceInvitations.id, params.invitationId),
        eq(workspaceInvitations.workspaceId, params.workspaceId)
      )
    )
    .returning();
  return invitation ?? null;
}

export async function getWorkspaceInvitationById(invitationId: string) {
  await ensureDbSchema();
  const [row] = await db
    .select()
    .from(workspaceInvitations)
    .where(eq(workspaceInvitations.id, invitationId))
    .limit(1);
  return row ?? null;
}

export async function getWorkspaceInvitationByToken(token: string) {
  await ensureDbSchema();
  const tokenHash = hashInviteToken(token);
  const [row] = await db
    .select({
      invitation: workspaceInvitations,
      workspace: workspaces,
      organization: organizations,
    })
    .from(workspaceInvitations)
    .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.workspaceId))
    .innerJoin(
      organizations,
      eq(organizations.id, workspaceInvitations.organizationId)
    )
    .where(eq(workspaceInvitations.tokenHash, tokenHash))
    .limit(1);
  return row ?? null;
}

export async function getWorkspaceMembershipByUser(
  userId: string,
  workspaceId: string
) {
  await ensureDbSchema();
  const [row] = await db
    .select()
    .from(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.userId, userId),
        eq(workspaceMemberships.workspaceId, workspaceId)
      )
    )
    .limit(1);
  return row ?? null;
}

export async function upsertWorkspaceMembership(params: {
  workspaceId: string;
  userId: string;
  role: WorkspaceCollaboratorRole;
  source: string;
  invitedByUserId?: string | null;
}) {
  await ensureDbSchema();
  const [row] = await db
    .insert(workspaceMemberships)
    .values({
      workspaceId: params.workspaceId,
      userId: params.userId,
      role: params.role,
      source: params.source,
      invitedByUserId: params.invitedByUserId ?? null,
    })
    .onConflictDoUpdate({
      target: [workspaceMemberships.workspaceId, workspaceMemberships.userId],
      set: {
        role: params.role,
        source: params.source,
        invitedByUserId: params.invitedByUserId ?? null,
        updatedAt: new Date(),
      },
    })
    .returning();
  return row;
}

export async function updateWorkspaceMembershipRole(params: {
  workspaceId: string;
  userId: string;
  role: WorkspaceCollaboratorRole;
}) {
  await ensureDbSchema();
  const [row] = await db
    .update(workspaceMemberships)
    .set({ role: params.role, updatedAt: new Date() })
    .where(
      and(
        eq(workspaceMemberships.workspaceId, params.workspaceId),
        eq(workspaceMemberships.userId, params.userId)
      )
    )
    .returning();
  return row ?? null;
}

export async function deleteWorkspaceMembership(params: {
  workspaceId: string;
  userId: string;
}) {
  await ensureDbSchema();
  const [row] = await db
    .delete(workspaceMemberships)
    .where(
      and(
        eq(workspaceMemberships.workspaceId, params.workspaceId),
        eq(workspaceMemberships.userId, params.userId)
      )
    )
    .returning();
  return row ?? null;
}

export type WorkspaceMemberListItem = {
  userId: string;
  name: string | null;
  email: string;
  image: string | null;
  role: WorkspaceCollaboratorRole;
  source: "organization" | "workspace";
  createdAt: Date;
};

export async function getWorkspaceCollaborators(workspaceId: string) {
  await ensureDbSchema();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!workspace) return [];

  const [orgRows, workspaceRows] = await Promise.all([
    db
      .select({
        user: users,
        membership: memberships,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(eq(memberships.organizationId, workspace.organizationId)),
    db
      .select({
        user: users,
        membership: workspaceMemberships,
      })
      .from(workspaceMemberships)
      .innerJoin(users, eq(users.id, workspaceMemberships.userId))
      .where(eq(workspaceMemberships.workspaceId, workspaceId)),
  ]);

  const out = new Map<string, WorkspaceMemberListItem>();
  for (const row of orgRows) {
    out.set(row.user.id, {
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
      image: row.user.image,
      role: row.membership.role,
      source: "organization",
      createdAt: row.membership.createdAt,
    });
  }
  for (const row of workspaceRows) {
    if (out.has(row.user.id)) continue;
    out.set(row.user.id, {
      userId: row.user.id,
      name: row.user.name,
      email: row.user.email,
      image: row.user.image,
      role: row.membership.role,
      source: "workspace",
      createdAt: row.membership.createdAt,
    });
  }

  return [...out.values()].sort((a, b) =>
    a.email.localeCompare(b.email, "it", { sensitivity: "base" })
  );
}

export async function getActiveWorkspaceInvitations(workspaceId: string) {
  await ensureDbSchema();
  const now = new Date();
  return db
    .select()
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.revokedAt),
        gt(workspaceInvitations.expiresAt, now),
        sql`${workspaceInvitations.usedCount} < ${workspaceInvitations.maxUses}`
      )
    )
    .orderBy(desc(workspaceInvitations.createdAt));
}

export async function getWorkspaceInvitationsForWorkspace(workspaceId: string) {
  await ensureDbSchema();
  return db
    .select()
    .from(workspaceInvitations)
    .where(
      and(
        eq(workspaceInvitations.workspaceId, workspaceId),
        isNull(workspaceInvitations.revokedAt)
      )
    )
    .orderBy(desc(workspaceInvitations.createdAt))
    .limit(50);
}

async function hasOrganizationMembership(userId: string, organizationId: string) {
  const [row] = await db
    .select()
    .from(memberships)
    .where(
      and(
        eq(memberships.userId, userId),
        eq(memberships.organizationId, organizationId)
      )
    )
    .limit(1);
  return row ?? null;
}

export type AcceptWorkspaceInvitationResult =
  | {
      ok: true;
      workspaceId: string;
      alreadyMember: boolean;
      membership: WorkspaceMembership | null;
    }
  | { ok: false; reason: "invalid" | "expired" | "email_mismatch" | "full" };

export async function acceptWorkspaceInvitation(params: {
  token: string;
  userId: string;
  userEmail: string;
}): Promise<AcceptWorkspaceInvitationResult> {
  await ensureDbSchema();
  const found = await getWorkspaceInvitationByToken(params.token);
  if (!found) return { ok: false, reason: "invalid" };

  const { invitation } = found;
  if (!isInvitationActive(invitation)) return { ok: false, reason: "expired" };

  const allowedEmail = normalizeEmail(invitation.email);
  const userEmail = normalizeEmail(params.userEmail);
  if (allowedEmail && allowedEmail !== userEmail) {
    return { ok: false, reason: "email_mismatch" };
  }

  const [orgMembership, workspaceMembership] = await Promise.all([
    hasOrganizationMembership(params.userId, invitation.organizationId),
    getWorkspaceMembershipByUser(params.userId, invitation.workspaceId),
  ]);
  if (orgMembership || workspaceMembership) {
    return {
      ok: true,
      workspaceId: invitation.workspaceId,
      alreadyMember: true,
      membership: workspaceMembership,
    };
  }

  const [claimed] = await db
    .update(workspaceInvitations)
    .set({
      usedCount: sql`${workspaceInvitations.usedCount} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(workspaceInvitations.id, invitation.id),
        isNull(workspaceInvitations.revokedAt),
        gt(workspaceInvitations.expiresAt, new Date()),
        sql`${workspaceInvitations.usedCount} < ${workspaceInvitations.maxUses}`
      )
    )
    .returning();

  if (!claimed) return { ok: false, reason: "full" };

  const membership = await upsertWorkspaceMembership({
    workspaceId: invitation.workspaceId,
    userId: params.userId,
    role: invitation.role,
    source: "invite_link",
    invitedByUserId: invitation.createdByUserId,
  });

  await db
    .insert(workspaceInvitationAcceptances)
    .values({
      invitationId: invitation.id,
      workspaceId: invitation.workspaceId,
      userId: params.userId,
      emailSnapshot: userEmail,
    })
    .onConflictDoNothing({
      target: [
        workspaceInvitationAcceptances.invitationId,
        workspaceInvitationAcceptances.userId,
      ],
    });

  return {
    ok: true,
    workspaceId: invitation.workspaceId,
    alreadyMember: false,
    membership,
  };
}
