import { auth } from "@/lib/auth";
import {
  getDepartmentsByWorkspace,
  getStrategicGoalsByWorkspace,
} from "@/lib/db/queries/workspaces";
import { getWorkspaceValueThesis } from "@/lib/db/queries/value-thesis";
import { getUnitTerm } from "@/lib/utils/unit-terminology";
import { getCollaboratorAccess } from "@/lib/workspace-access";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { workspaceId } = await params;
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  const { workspace } = access;

  // La tesi del valore del workspace (rilascio 9a, RILASCIO-9a-COSTRUZIONE.md §10.1): con più workspace nella stessa
  // organizzazione, ognuno la sua.
  const [valueThesis, departments, goals] = await Promise.all([
    getWorkspaceValueThesis(workspaceId),
    getDepartmentsByWorkspace(workspaceId),
    getStrategicGoalsByWorkspace(workspaceId),
  ]);
  const term = getUnitTerm(workspace);

  const thesis = valueThesis ?? null;

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
