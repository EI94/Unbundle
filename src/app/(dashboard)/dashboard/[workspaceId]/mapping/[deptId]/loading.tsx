"use client";

import { useParams } from "next/navigation";
import { BoardLoadingHeader } from "@/components/mappatura/board/loading-header";

/**
 * La board che si apre (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.6): la testata della board con la pillola
 * «Caricamento», come sul riferimento, che non ha scheletri. Ha la forma di quella vera (titolo e schede compresi),
 * così la pagina non salta quando arriva.
 */
export default function UnitBoardLoading() {
  const { workspaceId, deptId } = useParams<{ workspaceId: string; deptId: string }>();
  return <BoardLoadingHeader workspaceId={workspaceId} departmentId={deptId.toLowerCase()} />;
}
