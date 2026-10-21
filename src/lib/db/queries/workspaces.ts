import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
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
import { logSafeError } from "@/lib/log/safe-error";
import { ensureDbSchema } from "../ensure-schema";
import { provisionUseCaseWorkspaceSafely } from "./use-case-provisioning";

/**
 * Crea il workspace e, subito dopo, i prerequisiti dell'area «Use case»
 * (`provisionUseCaseWorkspaceSafely`, docs/use-case/DESIGN.md §10.6, §12.1-12.2): la riga di
 * `workspace_connector_configs` (prefisso dal nome come `use-case-admin configs`, slug dal nome
 * più gli 8 caratteri dell'id, unico per costruzione: lo slug «pulito» resta all'operatore;
 * `enabled = false`, contatore a zero) e il modello di valutazione in v2, come lo crea
 * `scoring-v2 --apply` su un workspace senza proposte. Così ogni workspace nuovo è pronto per
 * l'area senza script dell'operatore.
 *
 * La creazione del workspace non fallisce mai per colpa dei prerequisiti:
 * - prima `ensureDbSchema()`, così le tabelle ci sono (un suo guasto si registra e basta);
 * - un guasto dei prerequisiti si registra (solo nome e codice dell'errore) e il workspace
 *   resta creato. Li recupera il layout del workspace alla prima visita con l'area accesa, e
 *   la riga anche la prima proposta (`assignUseCaseCode`); `use-case-admin doctor` dice cosa
 *   manca.
 */
export async function createWorkspace(data: NewWorkspace) {
  try {
    await ensureDbSchema();
  } catch (error) {
    logSafeError("workspaces", "ensure_schema_failed", error);
  }
  const id = data.id ?? randomUUID();
  const [workspace] = await db.insert(workspaces).values({ ...data, id }).returning();
  await provisionUseCaseWorkspaceSafely(workspace.id);
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

/** Oggetti dei casi d'uso da cancellare con il workspace, per archivio. */
export type UcWorkspaceBlobs = { standard: string[]; personale: string[] };

/**
 * File dei casi d'uso del workspace (PIANO §5.3, D43): percorsi definitivi
 * nell'archivio della loro zona e quarantene nell'archivio standard, raccolti
 * prima della cascata. Le tabelle uc possono non esistere (`to_regclass`); si
 * raccolgono anche con la sezione spenta, così nessun file sopravvive al
 * workspace. Un errore si registra e la cancellazione prosegue senza la parte uc.
 */
async function ucBlobPathsForWorkspace(id: string): Promise<UcWorkspaceBlobs> {
  const out: UcWorkspaceBlobs = { standard: [], personale: [] };
  try {
    const { rows: present } = await db.execute(sql`SELECT to_regclass('public.uc_files') IS NOT NULL AS ok`);
    if ((present[0] as { ok: boolean } | undefined)?.ok !== true) return out;
    const { rows } = await db.execute(sql`
      SELECT storage_zone, blob_path, quarantine_path FROM uc_files
      WHERE workspace_id = ${id}::uuid AND (blob_path IS NOT NULL OR quarantine_path IS NOT NULL)`);
    for (const row of rows as { storage_zone: string; blob_path: string | null; quarantine_path: string | null }[]) {
      if (row.blob_path) (row.storage_zone === "personale" ? out.personale : out.standard).push(row.blob_path);
      if (row.quarantine_path) out.standard.push(row.quarantine_path);
    }
  } catch (error) {
    console.error("[uc] file dei casi d'uso non raccolti", error instanceof Error ? error.name : "errore");
  }
  return out;
}

export async function deleteWorkspaceById(id: string) {
  await ensureDbSchema();

  const documents = await db
    .select({ blobUrl: uploadedDocuments.blobUrl })
    .from(uploadedDocuments)
    .where(eq(uploadedDocuments.workspaceId, id));
  const ucBlobs = await ucBlobPathsForWorkspace(id);

  const [workspace] = await db
    .delete(workspaces)
    .where(eq(workspaces.id, id))
    .returning();

  return {
    workspace: workspace ?? null,
    blobUrls: documents.map((doc) => doc.blobUrl).filter(Boolean),
    ucBlobs: workspace ? ucBlobs : { standard: [], personale: [] },
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
