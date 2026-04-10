import { eq, and } from "drizzle-orm";
import { db } from "..";
import {
  organizations,
  memberships,
  workspaces,
  invitations,
  type NewOrganization,
} from "../schema";
import { v4 as uuidv4 } from "uuid";

export async function createOrganization(
  data: NewOrganization,
  userId: string
) {
  const [org] = await db.insert(organizations).values(data).returning();
  await db.insert(memberships).values({
    userId,
    organizationId: org.id,
    role: "exec_sponsor",
  });
  return org;
}

export async function getOrganizationsByUser(userId: string) {
  return db
    .select({
      organization: organizations,
      membership: memberships,
    })
    .from(memberships)
    .innerJoin(organizations, eq(memberships.organizationId, organizations.id))
    .where(eq(memberships.userId, userId));
}

export async function getOrganizationBySlug(slug: string) {
  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.slug, slug))
    .limit(1);
  return org ?? null;
}

export async function getUserMembership(userId: string, orgId: string) {
  const [membership] = await db
    .select()
    .from(memberships)
    .where(
      and(eq(memberships.userId, userId), eq(memberships.organizationId, orgId))
    )
    .limit(1);
  return membership ?? null;
}

export async function getOrganizationMembers(orgId: string) {
  return db
    .select()
    .from(memberships)
    .where(eq(memberships.organizationId, orgId));
}

export async function createInvitation(
  orgId: string,
  email: string,
  role: "exec_sponsor" | "transformation_lead" | "function_lead" | "contributor" | "analyst"
) {
  const token = uuidv4();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  const [invitation] = await db
    .insert(invitations)
    .values({
      organizationId: orgId,
      email,
      role,
      token,
      expiresAt,
    })
    .returning();
  return invitation;
}

export async function getInvitationByToken(token: string) {
  const [invitation] = await db
    .select()
    .from(invitations)
    .where(eq(invitations.token, token))
    .limit(1);
  return invitation ?? null;
}
