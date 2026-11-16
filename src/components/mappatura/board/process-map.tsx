"use client";

/**
 * «Mappatura board»: la mappa dei processi che si modifica (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3; P11–P19,
 * P53, P57–P61, P65; BOARD-SPEC §1.4.6, §1.4.7).
 *
 * Il disegno è quello del riferimento [v2], fatto con i pezzi delle fondamenta (`ui/map.tsx`): una riga per processo,
 * i passi come card con una freccia tra due, il bordo dell'attrito, «◆ decide una persona», «da validare». Le modifiche
 * sono quelle di [v1], portate sulla mappa:
 * - l'etichetta della riga: il nome e chi lo segue si scrivono sul posto; gli attriti della riga in rosso; i voti
 *   `−` n `+`; «Sposta su», «Sposta giù» e, per un processo vuoto, «Elimina il processo» (con «Annulla»);
 * - «+ passo» in fondo a ogni riga (apre il drawer di un passo nuovo), «+ processo» sotto l'ultima;
 * - la maniglia a sinistra di ogni card trascina il passo nella sua riga o in un'altra (P58): la riga sotto il passo
 *   si colora (P59) e un segno dice dove cadrà. Senza mouse e sul telefono lo fanno i bottoni «Sposta…» del drawer.
 * In sola lettura nessun controllo: si legge la mappa e si aprono i passi.
 *
 * `MapRows` non ha stato (la provano i test con Node, chiamando i suoi controlli); `ProcessMapEditor` tiene il
 * trascinamento.
 */
import { Fragment, useState, type DragEvent, type JSX } from "react";
import { hasHumanDecision, locateStep, processFrictions, processLetter, stepCode, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { BOARD_TEXT } from "../../../lib/mappatura/text.ts";
import { MAPPING_LIMITS } from "../../../lib/mappatura/vocab.ts";
import type { OpInput } from "../store/board-client.ts";
import { AddButton, RemoveIcon } from "../ui/atoms.tsx";
import { Votes } from "../ui/edit.tsx";
import { ProcessMap, ProcessRow, StepArrow, StepCard } from "../ui/map.tsx";
import { LineInPlace } from "./in-place.tsx";
import { VIEW_TEXT, addStepLabel, rowFrictionsText } from "./text.ts";
import { dropBeforeId, dropMoveOp, processFull, processMoveOp, processNameOp, processOwnerOp, stepDimmed, voteOp } from "./view-model.ts";

const L = MAPPING_LIMITS;

/** Quello che la mappa chiede a chi la monta: mandare operazioni, aprire un passo, aggiungerne uno, dare un avviso. */
export interface MapActions {
  dispatch(ops: OpInput | OpInput[], options?: { undo?: string }): void;
  openStep(stepId: string): void;
  addStep(processId: string): void;
  addProcess(): void;
  notify(text: string): void;
}

/** Il passo trascinato e dove cadrebbe. */
export interface DragState {
  dragging: string | null;
  over: { processId: string; beforeId: string | null } | null;
}

export const NO_DRAG: DragState = Object.freeze({ dragging: null, over: null });

function ArrowIcon(p: { up: boolean }): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
      <path d={p.up ? "M6 10V2M2.5 5.5 6 2l3.5 3.5" : "M6 2v8M2.5 6.5 6 10l3.5-3.5"} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export interface MapRowsProps {
  board: MappingBoard;
  editable: boolean;
  /** «Evidenzia attriti» è acceso (P61). */
  dim: boolean;
  drag: DragState;
  /** Il processo appena aggiunto: il cursore va nel suo nome, scelto, così si scrive sopra «Nuovo processo». */
  focusProcessId: string | null;
  actions: MapActions;
  onGripDragStart(stepId: string, event: DragEvent<HTMLSpanElement>): void;
  onGripDragEnd(): void;
}

/** Le righe della mappa, senza stato. */
export function MapRows(p: MapRowsProps): JSX.Element {
  const { board, editable, drag, actions } = p;
  const run = (op: OpInput | null) => {
    if (op) actions.dispatch(op);
  };
  return (
    <ProcessMap dim={p.dim}>
      {board.processes.map((process, processIndex) => {
        const frictions = processFrictions(process);
        const focus = p.focusProcessId === process.id;
        const over = drag.over?.processId === process.id ? drag.over : null;
        const name = editable ? (
          <LineInPlace
            value={process.name}
            label={VIEW_TEXT.row.namePlaceholder}
            placeholder={VIEW_TEXT.row.namePlaceholder}
            maxLength={L.processName}
            autoFocus={focus}
            selectOnFocus={focus}
            onCommit={(next, base) => run(processNameOp(process, next, base))}
          />
        ) : (
          process.name
        );
        const owner = editable ? (
          <LineInPlace value={process.owner ?? ""} label={VIEW_TEXT.row.ownerPlaceholder} placeholder={VIEW_TEXT.row.ownerPlaceholder} maxLength={L.owner} onCommit={(next, base) => run(processOwnerOp(process, next, base))} />
        ) : (
          process.owner
        );
        const extra = (
          <>
            {frictions > 0 ? <span className="b-pm-fr">{rowFrictionsText(frictions)}</span> : null}
            {editable || process.votes > 0 ? <Votes total={process.votes} mine={process.myVotes} disabled={!editable} onChange={(mine) => run(voteOp(process, mine))} /> : null}
            {editable ? (
              <span className="b-row-ctl" data-b="row-controls">
                <button type="button" aria-label={VIEW_TEXT.row.up} title={VIEW_TEXT.row.up} disabled={processIndex === 0} onClick={() => run(processMoveOp(board, process.id, "up"))}>
                  <ArrowIcon up />
                </button>
                <button type="button" aria-label={VIEW_TEXT.row.down} title={VIEW_TEXT.row.down} disabled={processIndex === board.processes.length - 1} onClick={() => run(processMoveOp(board, process.id, "down"))}>
                  <ArrowIcon up={false} />
                </button>
                {process.steps.length === 0 ? (
                  <button
                    type="button"
                    aria-label={VIEW_TEXT.row.remove}
                    title={VIEW_TEXT.row.remove}
                    onClick={() => actions.dispatch({ t: "process.remove", processId: process.id }, { undo: BOARD_TEXT.toast.processRemoved })}
                  >
                    <RemoveIcon />
                  </button>
                ) : null}
              </span>
            ) : null}
          </>
        );
        const after = editable ? (
          <>
            <span hidden data-process-id={process.id} data-drop-row={over ? "" : undefined} />
            {over && over.beforeId === null ? <span className="b-drop-mark" aria-hidden="true" /> : null}
            {processFull(process) ? null : (
              <AddButton className={process.steps.length === 0 ? "b-add-step b-add-first" : "b-add-step"} aria-label={addStepLabel(process.name)} onClick={() => actions.addStep(process.id)}>
                {VIEW_TEXT.add.step}
              </AddButton>
            )}
          </>
        ) : undefined;
        return (
          <ProcessRow key={process.id} letter={processLetter(processIndex)} name={name} owner={owner} extra={extra} steps={process.steps.length} after={after}>
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
                  dimmed={stepDimmed(step, p.dim)}
                  grip={
                    editable ? (
                      <span
                        className="b-grip"
                        draggable
                        title={VIEW_TEXT.card.grip}
                        aria-hidden="true"
                        data-step-id={step.id}
                        data-dragging={drag.dragging === step.id ? "" : undefined}
                        data-drop-before={over?.beforeId === step.id ? "" : undefined}
                        onDragStart={(event) => p.onGripDragStart(step.id, event)}
                        onDragEnd={() => p.onGripDragEnd()}
                      />
                    ) : undefined
                  }
                  onOpen={() => actions.openStep(step.id)}
                />
              </Fragment>
            ))}
          </ProcessRow>
        );
      })}
      {editable && board.processes.length < L.processes ? (
        <div className="b-pm-foot">
          <AddButton className="b-add-process" onClick={() => actions.addProcess()}>
            {VIEW_TEXT.add.process}
          </AddButton>
        </div>
      ) : null}
    </ProcessMap>
  );
}

/** Dove cadrebbe il passo trascinato sopra un punto della mappa: la riga sotto il puntatore e la card prima della quale cade. */
function dropTarget(target: EventTarget | null, x: number, draggedId: string): DragState["over"] {
  const row = target instanceof Element ? target.closest(".b-pm-row") : null;
  const processId = row?.querySelector<HTMLElement>("[data-process-id]")?.dataset.processId;
  if (!row || !processId) return null;
  const cards = [...row.querySelectorAll<HTMLElement>(".b-node-w")].flatMap((wrap) => {
    const id = wrap.querySelector<HTMLElement>(".b-grip")?.dataset.stepId;
    if (!id) return [];
    const rect = wrap.getBoundingClientRect();
    return [{ id, left: rect.left, width: rect.width }];
  });
  return { processId, beforeId: dropBeforeId(cards, x, draggedId) };
}

/** La mappa con il trascinamento: un passo preso per la maniglia cade in una riga, prima di una card o in fondo (P58, P59). */
export function ProcessMapEditor(p: { board: MappingBoard; editable: boolean; dim: boolean; focusProcessId: string | null; actions: MapActions }): JSX.Element {
  const [drag, setDrag] = useState<DragState>(NO_DRAG);
  const start = (stepId: string, event: DragEvent<HTMLSpanElement>) => {
    event.dataTransfer.setData("text/plain", stepId);
    event.dataTransfer.effectAllowed = "move";
    // Si vede la card intera, non la sola maniglia.
    const card = event.currentTarget.parentElement;
    if (card) event.dataTransfer.setDragImage(card, 16, 16);
    setDrag({ dragging: stepId, over: null });
  };
  const end = () => setDrag(NO_DRAG);
  const over = (event: DragEvent<HTMLDivElement>) => {
    const dragging = drag.dragging;
    if (!dragging) return;
    const place = dropTarget(event.target, event.clientX, dragging);
    if (!place) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDrag((current) => (current.over?.processId === place.processId && current.over.beforeId === place.beforeId ? current : { ...current, over: place }));
  };
  const leave = (event: DragEvent<HTMLDivElement>) => {
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    setDrag((current) => (current.over ? { ...current, over: null } : current));
  };
  const drop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    const { dragging, over: target } = drag;
    setDrag(NO_DRAG);
    if (!dragging || !target) return;
    const from = locateStep(p.board, dragging)?.process;
    const to = p.board.processes.find((process) => process.id === target.processId);
    if (from && to && from.id !== to.id && processFull(to)) {
      p.actions.notify(BOARD_TEXT.toast.limitStepsInProcess);
      return;
    }
    const op = dropMoveOp(p.board, dragging, target.processId, target.beforeId);
    if (op) p.actions.dispatch(op);
  };
  return (
    <div className="b-mapzone" data-dragging={drag.dragging ? "" : undefined} onDragOver={over} onDragLeave={leave} onDrop={drop}>
      <MapRows board={p.board} editable={p.editable} dim={p.dim} drag={drag} focusProcessId={p.focusProcessId} actions={p.actions} onGripDragStart={start} onGripDragEnd={end} />
    </div>
  );
}
