import { UnitsView } from "@/components/mappatura/board/units-view";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { listUnitBoards } from "@/lib/mappatura/units";
import { getUnitTerm } from "@/lib/utils/unit-terminology";

/**
 * L'activity mapping, S1 · Le unità (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.2, §4.10): una riga per unità, con i
 * numeri della sua board, in una lettura sola. Chi segue solo un corso resta fuori (`requireWorkspacePage`).
 */
export default async function MappingPage({ params }: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await params;
  const { access } = await requireWorkspacePage(workspaceId);
  const executor = await getAppUcExecutor();
  const units = await listUnitBoards(executor, workspaceId);
  return <UnitsView workspaceId={workspaceId} workspaceName={access.workspace.name} unitTerm={getUnitTerm(access.workspace)} units={units} />;
}
