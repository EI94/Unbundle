"use client";

/**
 * «Mappatura board»: la board di un'unità, S2 (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3, §4.10).
 *
 * Nasce con le fondamenta come stub, con le props del contratto (`UnitBoardProps`): tiene viva la pagina con la mappa
 * in sola lettura, fatta dai pezzi di `ui/`, e mette al loro posto i tre slot del compagno. Da qui il file è del
 * pacchetto delle viste della board (§9.2): testata con schede e pillola, «Processi di oggi» con il drawer del passo,
 * il pannello dell'assistente, il telefono.
 */
import { Fragment, type JSX } from "react";
import { hasHumanDecision, processLetter, stepCode } from "../../../lib/mappatura/board-model.ts";
import { BOARD_TEXT } from "../../../lib/mappatura/text.ts";
import type { UnitBoardProps } from "../contracts.ts";
import { useBoard, useBoardClient } from "../store/use-board.tsx";
import { BoardToastView } from "../ui/edit.tsx";
import { BoardBrand, BoardHeader, BoardMain, BoardTitle, StatusPill, ViewHead } from "../ui/frame.tsx";
import { ProcessMap, ProcessRow, StepArrow, StepCard } from "../ui/map.tsx";

export function UnitBoard(p: UnitBoardProps): JSX.Element {
  const board = useBoard((state) => state.board);
  const pill = useBoard((state) => state.pill);
  const savedAt = useBoard((state) => state.savedAt);
  const client = useBoardClient();
  return (
    <>
      <BoardHeader
        brand={<BoardBrand workspaceName={p.workspaceName} areaHref={`/dashboard/${p.workspaceId}/mapping`} />}
        title={<BoardTitle plain={board.unit.name} accent={BOARD_TEXT.boardTitleAccent} />}
        aside={<StatusPill state={pill} savedAt={savedAt} onSaveNow={() => void client.saveNow()} />}
      />
      <BoardMain>
        <ViewHead eyebrow={BOARD_TEXT.tabs.oggi} title={board.headline ?? board.unit.name} lede={board.unit.description} action={p.headAction} />
        {board.processes.length > 0 ? (
          <ProcessMap>
            {board.processes.map((process, processIndex) => (
              <ProcessRow key={process.id} letter={processLetter(processIndex)} name={process.name} owner={process.owner} steps={process.steps.length}>
                {process.steps.map((step, stepIndex) => (
                  <Fragment key={step.id}>
                    {stepIndex > 0 ? <StepArrow /> : null}
                    <StepCard
                      code={stepCode(processIndex, stepIndex)}
                      title={step.title}
                      description={step.description}
                      who={step.who}
                      tools={step.tools}
                      accent={{ kind: "friction", level: step.friction }}
                      gate={hasHumanDecision(step) ? step.decisionLabel : false}
                      toValidate={step.status === "da_validare"}
                      onOpen={() => {}}
                    />
                  </Fragment>
                ))}
              </ProcessRow>
            ))}
          </ProcessMap>
        ) : null}
        {p.classification}
      </BoardMain>
      {p.assistant}
      <BoardToastView />
    </>
  );
}
