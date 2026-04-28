import { auth } from "@/lib/auth";
import {
  getDepartmentsByWorkspace,
  getStrategicGoalsByWorkspace,
} from "@/lib/db/queries/workspaces";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUnitTerm } from "@/lib/utils/unit-terminology";
import { getWorkspaceAccessForUser } from "@/lib/workspace-access";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceId } = await params;
  const access = await getWorkspaceAccessForUser(session.user.id, workspaceId);
  if (!access) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const { workspace } = access;

  const [org] = await db
    .select()
    .from(organizations)
    .where(eq(organizations.id, workspace.organizationId))
    .limit(1);

  const departments = await getDepartmentsByWorkspace(workspaceId);
  const goals = await getStrategicGoalsByWorkspace(workspaceId);
  const term = getUnitTerm(workspace);

  const thesis = (org?.companyValueThesis as {
    coreValueProposition?: string;
    strategicNodes?: string[];
  } | null) ?? null;

  return Response.json({
    thesis,
    departments: departments.map((d) => ({
      id: d.id,
      name: d.name,
      mappingStatus: d.mappingStatus,
      teamSize: d.teamSize,
    })),
    goals: goals.map((g) => ({
      id: g.id,
      title: g.title,
      type: g.type,
    })),
    term,
  });
}
