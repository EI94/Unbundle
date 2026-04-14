import { auth } from "@/lib/auth";
import {
  getWorkspaceById,
  getDepartmentsByWorkspace,
  getStrategicGoalsByWorkspace,
} from "@/lib/db/queries/workspaces";
import { db } from "@/lib/db";
import { organizations } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getUnitTerm } from "@/lib/utils/unit-terminology";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceId } = await params;
  const workspace = await getWorkspaceById(workspaceId);
  if (!workspace) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

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
