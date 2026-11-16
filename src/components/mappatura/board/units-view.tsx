/**
 * «Mappatura board»: l'elenco delle unità, S1 (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.2, §4.10; P37, P42, P43, P47).
 *
 * In alto la testata della board (il marchio, il titolo in serif, niente schede e niente pillola: qui non si modifica
 * niente), poi la testa della vista, i numeri prima di tutto (quattro riquadri) e una riga per unità: lo stato, il nome
 * con la descrizione, dopo la classificazione i tre punti degli stream con i loro passi, i passi e le ore, quello che
 * resta da validare o da classificare, la freccia. Tutta la riga porta alla board dell'unità. Nessun bottone pieno.
 * Senza unità: «Prima la Discovery», con un link solo. Sul telefono i riquadri vanno due per riga e i conteggi di una
 * riga scendono sotto il nome (board-views.css).
 *
 * Senza stato e senza hook: la disegna anche il server.
 */
import Link from "next/link";
import type { JSX } from "react";
import type { UnitBoardSummary } from "../../../lib/mappatura/board-model.ts";
import { BOARD_TEXT, STREAM_LABEL, formatCount, unitStatusLabel } from "../../../lib/mappatura/text.ts";
import type { UnitsViewProps } from "../contracts.ts";
import { Dot, Kpis, RowLink, StatusChip } from "../ui/atoms.tsx";
import { EmptyBlock } from "../ui/edit.tsx";
import { Block, BoardBrand, BoardHeader, BoardMain, BoardTitle, ViewHead } from "../ui/frame.tsx";
import { VIEW_TEXT, discoveryText, openBoardLabel, peopleText, unitsLede, unitsSectionTitle, unitsTitle } from "./text.ts";
import { unitRow, unitsTiles } from "./view-model.ts";

/** La freccia in fondo a una riga: un segno, non un testo. */
function RowArrow(): JSX.Element {
  return (
    <span className="b-crow-go" aria-hidden="true">
      <svg viewBox="0 0 16 10" width="16" height="10" focusable="false">
        <path d="M0 5h13M10 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    </span>
  );
}

/** Una riga per unità (P42, P43): tutta la riga è il link alla sua board. */
export function UnitRow(p: { workspaceId: string; unit: UnitBoardSummary }): JSX.Element {
  const { unit } = p;
  const row = unitRow(unit);
  const subtitle = [unit.teamSize ? peopleText(unit.teamSize) : null, unit.description?.trim() || null].filter(Boolean).join(" · ");
  return (
    <RowLink href={`/dashboard/${p.workspaceId}/mapping/${unit.id}`} label={openBoardLabel(unit.name)}>
      <span className="b-crow-st">
        <StatusChip tone={row.tone}>{unitStatusLabel(row.status)}</StatusChip>
      </span>
      <span className="b-cn">
        {unit.name}
        {subtitle ? <small>{subtitle}</small> : null}
      </span>
      <span className="b-crow-meta">
        <span className="b-crow-streams">
          {row.streams?.map(({ stream, count }) => (
            <span className="b-sdot" key={stream} title={`${STREAM_LABEL[stream]}: ${formatCount(count)}`} data-stream={stream}>
              <Dot tone={stream} />
              {formatCount(count)}
            </span>
          ))}
        </span>
        <span className="b-num2">
          {row.steps}
          {row.todo.length > 0 ? <small>{row.todo.join(" · ")}</small> : null}
        </span>
      </span>
      <RowArrow />
    </RowLink>
  );
}

export function UnitsView(p: UnitsViewProps): JSX.Element {
  const title = unitsTitle(p.unitTerm);
  return (
    <>
      <BoardHeader
        brand={<BoardBrand workspaceName={p.workspaceName} areaHref={`/dashboard/${p.workspaceId}/mapping`} />}
        title={<BoardTitle plain={BOARD_TEXT.unitsTitle.plain} accent={BOARD_TEXT.unitsTitle.accent} />}
      />
      <BoardMain>
        <ViewHead
          eyebrow={VIEW_TEXT.units.eyebrow}
          title={
            <>
              {title.plain} <i>{title.accent}</i>
            </>
          }
          lede={unitsLede(p.unitTerm)}
        />
        {p.units.length === 0 ? (
          <EmptyBlock title={VIEW_TEXT.units.discovery.title} text={discoveryText()}>
            <Link className="b-btn" href={`/dashboard/${p.workspaceId}/setup/leadership`} data-b="discovery">
              {VIEW_TEXT.units.discovery.link}
            </Link>
          </EmptyBlock>
        ) : (
          <>
            <Kpis items={unitsTiles(p.units, p.unitTerm)} />
            <Block title={unitsSectionTitle(p.unitTerm)} hint={formatCount(p.units.length)}>
              <div className="b-units" data-b="units">
                {p.units.map((unit) => (
                  <UnitRow key={unit.id} workspaceId={p.workspaceId} unit={unit} />
                ))}
              </div>
            </Block>
          </>
        )}
      </BoardMain>
    </>
  );
}
