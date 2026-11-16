"use client";

import { useParams } from "next/navigation";
import { BoardLoadingHeader, useBoardLoadingNames } from "@/components/mappatura/board/loading-header";

/**
 * La board che si apre (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.6): la testata della board con la pillola
 * «Caricamento», come sul riferimento, che non ha scheletri. È quella vera, con il nome del workspace e il titolo
 * dell'unità che il layout ha letto sul server (`BoardLoadingNames`): un nome lungo va a capo come nella board, e la
 * pagina non salta quando arriva.
 */
export default function UnitBoardLoading() {
  const { workspaceId, deptId } = useParams<{ workspaceId: string; deptId: string }>();
  const names = useBoardLoadingNames();
  return <BoardLoadingHeader workspaceId={workspaceId} departmentId={deptId.toLowerCase()} unitName={names?.unitName ?? null} workspaceName={names?.workspaceName ?? ""} />;
}
