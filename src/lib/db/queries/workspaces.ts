import { eq, and } from "drizzle-orm";
import { db } from "..";
import {
  workspaces,
  departments,
  strategicGoals,
  type NewWorkspace,
  type NewDepartment,
  type NewStrategicGoal,
} from "../schema";

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

export async function getWorkspaceById(id: string) {
  const [workspace] = await db
    .select()
    .from(workspaces)
    .where(eq(workspaces.id, id))
    .limit(1);
  return workspace ?? null;
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
