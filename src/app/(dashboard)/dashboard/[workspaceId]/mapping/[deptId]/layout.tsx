import { BoardLoadingNames } from "@/components/mappatura/board/loading-header";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { logSafeError } from "@/lib/log/safe-error";
import { unitName } from "@/lib/mappatura/units";

/**
 * La board di un'unità, prima della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.6): il nome dell'unità e quello
 * del workspace, letti sul server con lo stesso controllo della pagina (`requireWorkspacePage`, che la pagina rifà: le
 * due letture della richiesta sono le stesse, in cache), vanno alla testata che carica (`loading.tsx`). Così il titolo
 * che carica è quello vero e va a capo come andrà nella board: la pagina non salta quando arriva. Un'unità di un altro
 * workspace non ha nome (la pagina risponde 404); una lettura non riuscita lascia la testata senza nome, e la pagina
 * decide (la sua `error.tsx` non copre questo layout).
 */
export default async function UnitBoardLayout({ children, params }: { children: React.ReactNode; params: Promise<{ workspaceId: string; deptId: string }> }) {
  const { workspaceId, deptId } = await params;
  const { access } = await requireWorkspacePage(workspaceId);
  let name: string | null = null;
  try {
    name = await unitName(await getAppUcExecutor(), { workspaceId, departmentId: deptId });
  } catch (error) {
    logSafeError("mappatura/board", "nome_unita_non_letto", error, { workspaceId, departmentId: deptId });
  }
  return (
    <BoardLoadingNames unitName={name} workspaceName={access.workspace.name}>
      {children}
    </BoardLoadingNames>
  );
}
