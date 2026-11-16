/**
 * «Mappatura board»: l'elenco delle unità, S1 (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.2, §4.10).
 *
 * Nasce con le fondamenta come stub, con le props del contratto (`UnitsViewProps`): la testata e una riga per unità che
 * porta alla sua board, fatte dai pezzi di `ui/`. Da qui il file è del pacchetto delle viste della board (§9.2): i
 * riquadri dei numeri, le righe con stato, stream e conteggi, il telefono, «Prima la Discovery».
 */
import type { JSX } from "react";
import { BOARD_TEXT, unitStatusLabel } from "../../../lib/mappatura/text.ts";
import type { UnitsViewProps } from "../contracts.ts";
import { RowLink, StatusChip } from "../ui/atoms.tsx";
import { BoardBrand, BoardHeader, BoardMain, BoardTitle } from "../ui/frame.tsx";

export function UnitsView(p: UnitsViewProps): JSX.Element {
  return (
    <>
      <BoardHeader
        brand={<BoardBrand workspaceName={p.workspaceName} areaHref={`/dashboard/${p.workspaceId}/mapping`} />}
        title={<BoardTitle plain={BOARD_TEXT.unitsTitle.plain} accent={BOARD_TEXT.unitsTitle.accent} />}
      />
      <BoardMain>
        {p.units.map((unit) => (
          <RowLink key={unit.id} href={`/dashboard/${p.workspaceId}/mapping/${unit.id}`} label={unit.name}>
            <StatusChip tone={unit.status === "not_started" ? "neutral" : unit.status === "in_progress" ? "wait" : "ok"}>{unitStatusLabel(unit.status)}</StatusChip>
            <span className="b-cn">
              {unit.name}
              {unit.description ? <small>{unit.description}</small> : null}
            </span>
          </RowLink>
        ))}
      </BoardMain>
    </>
  );
}
