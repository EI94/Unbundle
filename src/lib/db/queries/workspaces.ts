import { eq } from "drizzle-orm";
import { cache } from "react";
import { db } from "..";
import {
  workspaces,
  organizations,
  workspaceMemberships,
  departments,
  strategicGoals,
  uploadedDocuments,
  type NewWorkspace,
  type NewDepartment,
  type NewStrategicGoal,
  type Workspace,
  type Organization,
} from "../schema";
import { getOrganizationsByUser } from "@/lib/db/queries/organizations";
import { ensureDbSchema } from "../ensure-schema";

export async function createWorkspace(data: NewWorkspace) {
  const [workspace] = await db.insert(workspaces).values(data).returning();
  return workspace;
}

export async function getWorkspacesByOrganization(orgId: string) {
  return db
    .select()
    .from(workspaces)
    .where(eq(workspaces.organizationId, orgId))
    .orderBy(workspaces.createdAt);
}

export const getWorkspaceById = cache(async function getWorkspaceById(id: string) {
  await ensureDbSchema();
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return workspace ?? null;
});

export async function deleteWorkspaceById(id: string) {
  await ensureDbSchema();

  const documents = await db
    .select({ blobUrl: uploadedDocuments.blobUrl })
    .from(uploadedDocuments)
    .where(eq(uploadedDocuments.workspaceId, id));

  const [workspace] = await db
    .delete(workspaces)
    .where(eq(workspaces.id, id))
    .returning();

  return {
    workspace: workspace ?? null,
    blobUrls: documents.map((doc) => doc.blobUrl).filter(Boolean),
  };
}

/** Tutti i workspace Unbundle a cui l’utente ha accesso (via organizzazione). */
export async function getWorkspacesForUser(userId: string) {
  const groups = await getWorkspaceGroupsForUser(userId);
  return groups.flatMap((group) =>
    group.workspaces.map(({ workspace }) => ({
      id: workspace.id,
      name: workspace.name,
      organizationName: group.organization.name,
    }))
  );
}

export type WorkspaceListItem = {
  workspace: Workspace;
  accessRole: string;
  accessSource: "organization" | "workspace";
};

export type WorkspaceGroup = {
  organization: Organization;
  workspaces: WorkspaceListItem[];
};

/** Workspace visibili in dashboard: membership org + membership workspace-specifica. */
export async function getWorkspaceGroupsForUser(
  userId: string
): Promise<WorkspaceGroup[]> {
  await ensureDbSchema();
  const orgRows = await getOrganizationsByUser(userId);
  const groups = new Map<string, WorkspaceGroup>();
  const seenWorkspaceIds = new Set<string>();

  for (const { organization, membership } of orgRows) {
    const wsList = await getWorkspacesByOrganization(organization.id);
    groups.set(organization.id, {
      organization,
      workspaces: wsList.map((workspace) => {
        seenWorkspaceIds.add(workspace.id);
        return {
          workspace,
          accessRole: membership.role,
          accessSource: "organization" as const,
        };
      }),
    });
  }

  const sharedRows = await db
    .select({
      workspace: workspaces,
      organization: organizations,
      membership: workspaceMemberships,
    })
    .from(workspaceMemberships)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMemberships.workspaceId))
    .innerJoin(organizations, eq(organizations.id, workspaces.organizationId))
    .where(eq(workspaceMemberships.userId, userId));

  for (const row of sharedRows) {
    if (seenWorkspaceIds.has(row.workspace.id)) continue;
    const existing = groups.get(row.organization.id);
    const item = {
      workspace: row.workspace,
      accessRole: row.membership.role,
      accessSource: "workspace" as const,
    };
    if (existing) {
      existing.workspaces.push(item);
    } else {
      groups.set(row.organization.id, {
        organization: row.organization,
        workspaces: [item],
      });
    }
    seenWorkspaceIds.add(row.workspace.id);
  }

  return [...groups.values()].map((group) => ({
    ...group,
    workspaces: group.workspaces.sort(
      (a, b) => a.workspace.createdAt.getTime() - b.workspace.createdAt.getTime()
    ),
  }));
}

export async function updateWorkspaceStatus(
  id: string,
  status: "setup" | "mapping" | "analysis" | "complete"
) {
  const [workspace] = await db
    .update(workspaces)
    .set({ status, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();
  return workspace;
}

export async function updateWorkspaceSystemBoundary(
  id: string,
  systemBoundary: unknown
) {
  const [workspace] = await db
    .update(workspaces)
    .set({ systemBoundary, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();
  return workspace;
}

export async function updateWorkspaceAiTransformationTeamName(
  id: string,
  aiTransformationTeamName: string | null
) {
  await ensureDbSchema();
  const [workspace] = await db
    .update(workspaces)
    .set({ aiTransformationTeamName, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();
  return workspace;
}

export async function updateWorkspaceWhatsappWebhook(
  id: string,
  whatsappWebhookUrl: string | null
) {
  await ensureDbSchema();
  const [workspace] = await db
    .update(workspaces)
    .set({ whatsappWebhookUrl, updatedAt: new Date() })
    .where(eq(workspaces.id, id))
    .returning();
  return workspace;
}

// ─── Departments ────────────────────────────────────────────────────

export async function createDepartment(data: NewDepartment) {
  const [dept] = await db.insert(departments).values(data).returning();
  return dept;
}

export async function getDepartmentsByWorkspace(workspaceId: string) {
  return db
    .select()
    .from(departments)
    .where(eq(departments.workspaceId, workspaceId))
    .orderBy(departments.name);
}

export async function getDepartmentById(id: string) {
  const [dept] = await db
    .select()
    .from(departments)
    .where(eq(departments.id, id))
    .limit(1);
  return dept ?? null;
}

export async function updateDepartmentStatus(
  id: string,
  status: "not_started" | "in_progress" | "mapped" | "validated"
) {
  const [dept] = await db
    .update(departments)
    .set({ mappingStatus: status })
    .where(eq(departments.id, id))
    .returning();
  return dept;
}

// ─── Strategic Goals ────────────────────────────────────────────────

export async function createStrategicGoal(data: NewStrategicGoal) {
  const [goal] = await db.insert(strategicGoals).values(data).returning();
  return goal;
}

export async function getStrategicGoalsByWorkspace(workspaceId: string) {
  return db
    .select()
    .from(strategicGoals)
    .where(eq(strategicGoals.workspaceId, workspaceId))
    .orderBy(strategicGoals.createdAt);
}

export async function updateStrategicGoal(
  id: string,
  data: Partial<NewStrategicGoal>
) {
  const [goal] = await db
    .update(strategicGoals)
    .set(data)
    .where(eq(strategicGoals.id, id))
    .returning();
  return goal;
}
