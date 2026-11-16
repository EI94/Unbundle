"use client";

import { useParams } from "next/navigation";
import { BoardBrand, BoardHeader, StatusPill } from "@/components/mappatura/ui/frame";

/**
 * La board che si apre (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.6): la cornice con la pillola «Caricamento», come
 * sul riferimento, che non ha scheletri. Il titolo tiene la sua altezza, così la pagina non salta quando arriva.
 */
export default function UnitBoardLoading() {
  const { workspaceId } = useParams<{ workspaceId: string }>();
  return (
    <BoardHeader
      brand={<BoardBrand workspaceName="" areaHref={`/dashboard/${workspaceId}/mapping`} />}
      title={" "}
      aside={<StatusPill state="loading" savedAt={null} />}
    />
  );
}
