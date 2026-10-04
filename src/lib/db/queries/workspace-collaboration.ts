import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db } from "..";
import { ensureDbSchema } from "../ensure-schema";
import {
  memberships,
  organizations,
  users,
  workspaces,
  workspaceInvitations,
  workspaceMemberships,
} from "../schema";
import {
  createInviteToken,
  decideInviteAcceptance,
  hashInviteToken,
  normalizeInviteEmail,
  WORKSPACE_INVITE_EXPIRES_IN_DAYS,
  WORKSPACE_INVITE_MAX_USES,
  type InviteRejection,
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

/**
 * Ogni ruolo che una riga di membership puo' portare, `learner` incluso: chi
 * entra da un link di corso e' un membro del workspace e compare negli
 * elenchi, quindi va mostrato per quello che e'. Non e' l'insieme assegnabile
 * da un invito, che resta WORKSPACE_COLLABORATOR_ROLES: nessuna interfaccia
 * umana deve poter conferire `learner`, e nessun invito deve poterlo togliere.
 */
export type WorkspaceMemberRole = WorkspaceCollaboratorRole | "learner";


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
      email: normalizeInviteEmail(params.email),
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
  role: WorkspaceMemberRole;
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
  role: WorkspaceMemberRole;
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

export type WorkspaceInvitationListItem = {
  id: string;
  email: string | null;
  role: WorkspaceMemberRole;
  maxUses: number;
  usedCount: number;
  expiresAt: Date;
  revokedAt: Date | null;
  createdAt: Date;
  createdByName: string | null;
  acceptedByEmail: string | null;
  acceptedAt: Date | null;
};

/**
 * Inviti del workspace per la scheda Collaboratori: tutti quelli ancora
 * utilizzabili (senza limite, perché vanno sempre poterli vedere e revocare)
 * più lo storico recente, revocati compresi, con chi li ha creati e chi li ha
 * usati.
 */
export async function getWorkspaceInvitationsForWorkspace(workspaceId: string) {
  await ensureDbSchema();
  const { rows } = await db.execute(sql`
    -- Colonne timestamp senza fuso, salvate in UTC da Drizzle: si dichiara
    -- il fuso, altrimenti il driver le leggerebbe come ora locale del server.
    SELECT i.id, i.email, i.role, i.max_uses AS "maxUses", i.used_count AS "usedCount",
      i.expires_at AT TIME ZONE 'UTC' AS "expiresAt", i.revoked_at AT TIME ZONE 'UTC' AS "revokedAt",
      i.created_at AT TIME ZONE 'UTC' AS "createdAt", COALESCE(NULLIF(c.name, ''), c.email) AS "createdByName",
      a.email_snapshot AS "acceptedByEmail", a.accepted_at AT TIME ZONE 'UTC' AS "acceptedAt"
    FROM workspace_invitations i
    LEFT JOIN users c ON c.id = i.created_by_user_id
    LEFT JOIN LATERAL (
      SELECT x.email_snapshot, x.accepted_at FROM workspace_invitation_acceptances x
      WHERE x.invitation_id = i.id ORDER BY x.accepted_at DESC LIMIT 1
    ) a ON true
    WHERE i.workspace_id = ${workspaceId}::uuid
      AND (
        (i.revoked_at IS NULL AND i.expires_at > now() AND i.used_count < i.max_uses)
        OR i.id IN (
          SELECT h.id FROM workspace_invitations h WHERE h.workspace_id = ${workspaceId}::uuid
            AND NOT (h.revoked_at IS NULL AND h.expires_at > now() AND h.used_count < h.max_uses)
          ORDER BY h.created_at DESC LIMIT 50
        )
      )
    ORDER BY i.created_at DESC`);
  return (rows as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    email: (r.email as string | null) ?? null,
    role: r.role as WorkspaceMemberRole,
    maxUses: Number(r.maxUses),
    usedCount: Number(r.usedCount),
    expiresAt: new Date(r.expiresAt as string),
    revokedAt: r.revokedAt ? new Date(r.revokedAt as string) : null,
    createdAt: new Date(r.createdAt as string),
    createdByName: (r.createdByName as string | null) ?? null,
    acceptedByEmail: (r.acceptedByEmail as string | null) ?? null,
    acceptedAt: r.acceptedAt ? new Date(r.acceptedAt as string) : null,
  })) satisfies WorkspaceInvitationListItem[];
}

/** Revoca gli inviti ancora validi creati da una persona: servono quando perde il diritto di invitare. */
export async function revokeInvitationsCreatedBy(params: { workspaceId: string; userId: string }) {
  await ensureDbSchema();
  const rows = await db
    .update(workspaceInvitations)
    .set({ revokedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(workspaceInvitations.workspaceId, params.workspaceId),
        eq(workspaceInvitations.createdByUserId, params.userId),
        isNull(workspaceInvitations.revokedAt),
        gt(workspaceInvitations.expiresAt, new Date()),
        // I link già usati restano nello storico come «usati»: c'è scritto chi è entrato.
        sql`${workspaceInvitations.usedCount} < ${workspaceInvitations.maxUses}`
      )
    )
    .returning({ id: workspaceInvitations.id });
  return rows.length;
}

/**
 * Chi è stato promosso da partecipante a collaboratore e viene rimosso
 * torna partecipante: perde il workspace ma non i corsi a cui è iscritto.
 * Restituisce true se è successo, false se la persona non ha corsi attivi.
 */
export async function demoteToLearnerIfEnrolled(params: { workspaceId: string; userId: string }) {
  await ensureDbSchema();
  // Negli ambienti senza modulo Formazione la tabella non esiste: nessun corso da conservare.
  const { rows: present } = await db.execute(sql`SELECT to_regclass('public.learning_enrollments') IS NOT NULL AS ok`);
  if (!(present[0] as { ok: boolean } | undefined)?.ok) return false;
  const { rows } = await db.execute(sql`
    UPDATE workspace_memberships SET role = 'learner', updated_at = now()
    WHERE workspace_id = ${params.workspaceId}::uuid AND user_id = ${params.userId}::uuid
      AND EXISTS (
        SELECT 1 FROM learning_enrollments e
        WHERE e.workspace_id = ${params.workspaceId}::uuid AND e.user_id = ${params.userId}::uuid AND e.status = 'active'
      )
    RETURNING id`);
  return rows.length > 0;
}

/**
 * Revoca i permessi sui corsi (gestire, rivedere, esportare) di chi perde
 * l'accesso da collaboratore: anche se resta partecipante, o rientra più
 * avanti da un link di corso, non torna formatore. Ogni revoca resta nel
 * registro degli eventi del corso.
 */
export async function revokeCourseGrants(params: { workspaceId: string; userId: string; actorId: string }) {
  await ensureDbSchema();
  const { rows: present } = await db.execute(sql`SELECT to_regclass('public.learning_grants') IS NOT NULL AS ok`);
  if (!(present[0] as { ok: boolean } | undefined)?.ok) return 0;
  const { rows } = await db.execute(sql`
    WITH revoked AS (
      UPDATE learning_grants SET revoked_at = now()
      WHERE workspace_id = ${params.workspaceId}::uuid AND user_id = ${params.userId}::uuid AND revoked_at IS NULL
      RETURNING id, program_id, capability, cohort_id
    ), audited AS (
      INSERT INTO learning_audit_events (workspace_id, program_id, actor_id, resource_id, event_type, metadata)
      SELECT ${params.workspaceId}::uuid, program_id, ${params.actorId}::uuid, id, 'grant_revoked',
        jsonb_build_object('reason', 'member_removed', 'capability', capability, 'cohortId', cohort_id)
      FROM revoked
      RETURNING id
    )
    SELECT count(*)::int AS n FROM audited`);
  return Number((rows[0] as { n: number } | undefined)?.n ?? 0);
}

/** Disattiva tutti i link pubblici al portfolio già condivisi (src/lib/portfolio/share-link.ts). */
export async function disablePortfolioShareLinks(workspaceId: string) {
  await ensureDbSchema();
  await db
    .update(workspaces)
    .set({ portfolioShareEpoch: sql`${workspaces.portfolioShareEpoch} + 1`, updatedAt: new Date() })
    .where(eq(workspaces.id, workspaceId));
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
      /** joined: nuovo accesso; upgraded: era partecipante a un corso; already_member: era già dentro, ruolo invariato. */
      outcome: "joined" | "upgraded" | "already_member";
      role: string;
    }
  | { ok: false; reason: "invalid" | InviteRejection };

export async function acceptWorkspaceInvitation(params: {
  token: string;
  userId: string;
  userEmail: string;
  emailVerified: boolean;
}): Promise<AcceptWorkspaceInvitationResult> {
  await ensureDbSchema();
  const found = await getWorkspaceInvitationByToken(params.token);
  if (!found) return { ok: false, reason: "invalid" };
  const { invitation } = found;

  const [orgMembership, workspaceMembership] = await Promise.all([
    hasOrganizationMembership(params.userId, invitation.organizationId),
    getWorkspaceMembershipByUser(params.userId, invitation.workspaceId),
  ]);
  const decision = decideInviteAcceptance({
    invitation,
    user: { email: params.userEmail, emailVerified: params.emailVerified },
    orgRole: orgMembership?.role ?? null,
    workspaceRole: workspaceMembership?.role ?? null,
  });
  if (decision.kind === "already_member") {
    return { ok: true, workspaceId: invitation.workspaceId, outcome: "already_member", role: decision.role };
  }
  if (decision.kind === "reject") return { ok: false, reason: decision.reason };

  // Accesso al workspace, consumo del link e registro dell'accettazione in
  // un'unica istruzione: o tutto o niente (il driver HTTP di Neon non ha
  // transazioni interattive). L'invito si blocca e si riverifica per primo:
  // due clic contemporanei sullo stesso link si mettono in fila e il secondo
  // trova il link già usato. L'accesso si scrive solo se la persona non è
  // nel frattempo diventata membro con un ruolo da collaboratore (la riga di
  // un partecipante a un corso si aggiorna), e il link si consuma solo se
  // l'accesso è stato davvero scritto.
  const { rows } = await db.execute(sql`
    WITH valid AS (
      SELECT i.id, i.workspace_id, i.role, i.created_by_user_id FROM workspace_invitations i
      WHERE i.id = ${invitation.id}::uuid AND i.revoked_at IS NULL AND i.expires_at > now() AND i.used_count < i.max_uses
        AND NOT EXISTS (SELECT 1 FROM memberships m WHERE m.organization_id = i.organization_id AND m.user_id = ${params.userId}::uuid)
        AND NOT EXISTS (SELECT 1 FROM workspace_memberships w WHERE w.workspace_id = i.workspace_id
          AND w.user_id = ${params.userId}::uuid AND w.role <> 'learner')
      FOR UPDATE
    ), member AS (
      INSERT INTO workspace_memberships (workspace_id, user_id, role, source, invited_by_user_id)
      SELECT workspace_id, ${params.userId}::uuid, role, 'invite_link', created_by_user_id FROM valid
      ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role, source = EXCLUDED.source,
        invited_by_user_id = EXCLUDED.invited_by_user_id, updated_at = now()
        WHERE workspace_memberships.role = 'learner'
      RETURNING role
    ), claimed AS (
      UPDATE workspace_invitations i SET used_count = i.used_count + 1, updated_at = now()
      FROM valid v WHERE i.id = v.id AND EXISTS (SELECT 1 FROM member)
      RETURNING i.id, i.workspace_id
    ), accepted AS (
      INSERT INTO workspace_invitation_acceptances (invitation_id, workspace_id, user_id, email_snapshot)
      SELECT id, workspace_id, ${params.userId}::uuid, ${normalizeInviteEmail(params.userEmail)} FROM claimed
      ON CONFLICT (invitation_id, user_id) DO NOTHING
      RETURNING id
    )
    SELECT (SELECT count(*) FROM claimed)::int AS claimed, (SELECT role FROM member LIMIT 1) AS role`);
  const row = rows[0] as { claimed: number; role: string | null } | undefined;
  if (row?.claimed && row.role) {
    return {
      ok: true,
      workspaceId: invitation.workspaceId,
      outcome: decision.upgradesLearner ? "upgraded" : "joined",
      role: row.role,
    };
  }

  // Corsa persa (doppio clic, un altro che usa il link un attimo prima, un
  // annullamento in corso): si rilegge lo stato e si rifà la stessa decisione,
  // così il messaggio dice il motivo vero.
  const [fresh, orgNow, memberNow] = await Promise.all([
    getWorkspaceInvitationByToken(params.token),
    hasOrganizationMembership(params.userId, invitation.organizationId),
    getWorkspaceMembershipByUser(params.userId, invitation.workspaceId),
  ]);
  const retry = fresh
    ? decideInviteAcceptance({
        invitation: fresh.invitation,
        user: { email: params.userEmail, emailVerified: params.emailVerified },
        orgRole: orgNow?.role ?? null,
        workspaceRole: memberNow?.role ?? null,
      })
    : null;
  if (retry?.kind === "already_member") {
    return { ok: true, workspaceId: invitation.workspaceId, outcome: "already_member", role: retry.role };
  }
  if (!fresh) return { ok: false, reason: "invalid" };
  return { ok: false, reason: retry?.kind === "reject" ? retry.reason : "used" };
}
