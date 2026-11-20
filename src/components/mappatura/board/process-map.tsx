"use client";

/**
 * «Mappatura board»: la mappa dei processi che si modifica (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3; P11–P19,
 * P53, P57–P61, P65, BOARD-SPEC §1.4.6, §1.4.7; rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7).
 *
 * Il disegno è quello del riferimento [v2], fatto con i pezzi delle fondamenta (`ui/map.tsx`): una riga per processo,
 * i passi come card con una freccia tra due, il bordo dell'attrito (con la parola per i lettori di schermo), «◆ decide
 * una persona», «da validare». (Rilascio 10) La card dice solo il titolo, «Chi», ◆ e «da validare»: descrizione e
 * strumenti stanno nel drawer. Le modifiche:
 * - l'etichetta della riga: il nome si scrive sul posto; chi lo segue si legge; gli attriti della riga in rosso; i
 *   voti solo se ce ne sono; un «⋯» per processo apre chi lo segue (da scrivere), «Sposta su», «Sposta giù», «Elimina
 *   il processo» (per uno vuoto, con «Annulla») e i voti `−` n `+`;
 * - «+ passo» in fondo a ogni riga, sempre in vista (apre il drawer di un passo nuovo), «+ processo» sotto l'ultima;
 * - la maniglia a sinistra di ogni card trascina il passo nella sua riga o in un'altra (P58): la riga sotto il passo
 *   si colora (P59) e un segno dice dove cadrà. Senza mouse e sul telefono lo fanno i bottoni «Sposta…» del drawer.
 * In sola lettura nessun controllo: si legge la mappa e si aprono i passi.
 *
 * `MapRows` non ha stato (la provano i test con Node, chiamando i suoi controlli); `ProcessMapEditor` tiene il
 * trascinamento e il «⋯» aperto.
 */
import { Fragment, useState, type DragEvent, type JSX } from "react";
import { hasHumanDecision, locateStep, processFrictions, processLetter, stepCode, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { BOARD_TEXT, formatCount, frictionLabel, votesLabel } from "../../../lib/mappatura/text.ts";
import { MAPPING_LIMITS } from "../../../lib/mappatura/vocab.ts";
import type { OpInput } from "../store/board-client.ts";
import { AddButton, RemoveIcon } from "../ui/atoms.tsx";
import { Votes, fieldHolder } from "../ui/edit.tsx";
import { ProcessMap, ProcessRow, StepArrow, StepCard, widestRow } from "../ui/map.tsx";
import { LineInPlace } from "./in-place.tsx";
import { VIEW_TEXT, addStepLabel, rowFrictionsText } from "./text.ts";
import { dropBeforeId, dropMoveOp, processFull, processMoveOp, processNameOp, processOwnerOp, stepDimmed, voteOp, type MapFilter } from "./view-model.ts";

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

function MoreIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
      <circle cx="3.5" cy="8" r="1.3" fill="currentColor" />
      <circle cx="8" cy="8" r="1.3" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.3" fill="currentColor" />
    </svg>
  );
}

export interface MapRowsProps {
  board: MappingBoard;
  editable: boolean;
  /** (Rilascio 10, §3.7) Il chip acceso: «N attriti» (prima «Evidenzia attriti», P61) o «N da validare». */
  filter: MapFilter | null;
  /** Il processo con il «⋯» aperto (sposta, elimina, voti); null: nessuno. */
  menu: string | null;
  onMenu(processId: string | null): void;
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
    <ProcessMap dim={p.filter !== null} steps={widestRow(board.processes)} adds={editable}>
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
        // (Rilascio 10, §3.7) Chi segue il processo si legge sulla riga; si scrive nel «⋯» del processo, con gli altri
        // controlli della riga (sulla riga resta un campo solo, il nome).
        const owner = process.owner?.trim() ? process.owner : null;
        const menuOpen = p.menu === process.id;
        const controlsId = `b-row-ctl-${process.id}`;
        const extra = (
          <>
            {frictions > 0 ? <span className="b-pm-fr">{rowFrictionsText(frictions)}</span> : null}
            {/* I voti sulla riga solo se ci sono; si danno dal «⋯» (rilascio 10, §3.7). */}
            {process.votes > 0 && !menuOpen ? (
              <span className="b-votes" data-b="votes-count">
                <span className="b-vb" aria-hidden="true">
                  {formatCount(process.votes)}
                </span>
                <span className="b-sr">{votesLabel(process.votes, process.myVotes)}</span>
              </span>
            ) : null}
            {editable ? (
              <>
                <button
                  type="button"
                  className="b-row-more"
                  aria-label={VIEW_TEXT.row.menu(process.name)}
                  title={VIEW_TEXT.row.menu(process.name)}
                  aria-expanded={menuOpen}
                  aria-controls={controlsId}
                  onClick={() => p.onMenu(menuOpen ? null : process.id)}
                  data-b="row-menu"
                >
                  <MoreIcon />
                </button>
                <span className="b-row-ctl" id={controlsId} hidden={!menuOpen} data-b="row-controls">
                  <span className="b-row-owner">
                    <LineInPlace value={process.owner ?? ""} label={VIEW_TEXT.row.ownerPlaceholder} placeholder={VIEW_TEXT.row.ownerPlaceholder} maxLength={L.owner} onCommit={(next, base) => run(processOwnerOp(process, next, base))} />
                  </span>
                  {/* In cima e in fondo il bottone resta raggiungibile (aria-disabled, come i voti): il fuoco non si perde (F1). */}
                  <button
                    type="button"
                    aria-label={VIEW_TEXT.row.up}
                    title={VIEW_TEXT.row.up}
                    aria-disabled={processIndex === 0 || undefined}
                    onClick={() => {
                      if (processIndex > 0) run(processMoveOp(board, process.id, "up"));
                    }}
                  >
                    <ArrowIcon up />
                  </button>
                  <button
                    type="button"
                    aria-label={VIEW_TEXT.row.down}
                    title={VIEW_TEXT.row.down}
                    aria-disabled={processIndex === board.processes.length - 1 || undefined}
                    onClick={() => {
                      if (processIndex < board.processes.length - 1) run(processMoveOp(board, process.id, "down"));
                    }}
                  >
                    <ArrowIcon up={false} />
                  </button>
                  {process.steps.length === 0 ? (
                    <button
                      type="button"
                      aria-label={VIEW_TEXT.row.remove}
                      title={VIEW_TEXT.row.remove}
                      onClick={(event) => {
                        // La riga se ne va con il bottone: il fuoco resta nella vista, non sulla pagina (F1).
                        fieldHolder(event.currentTarget)?.focus({ preventScroll: true });
                        p.onMenu(null);
                        actions.dispatch({ t: "process.remove", processId: process.id }, { undo: BOARD_TEXT.toast.processRemoved });
                      }}
                    >
                      <RemoveIcon />
                    </button>
                  ) : null}
                  <Votes total={process.votes} mine={process.myVotes} onChange={(mine) => run(voteOp(process, mine))} />
                </span>
              </>
            ) : null}
          </>
        );
        const after = editable ? (
          <>
            <span hidden data-process-id={process.id} data-drop-row={over ? "" : undefined} />
            {over && over.beforeId === null ? <span className="b-drop-mark" aria-hidden="true" /> : null}
            {processFull(process) ? null : (
              <AddButton className="b-add-step" aria-label={addStepLabel(process.name)} data-add-step={process.id} onClick={() => actions.addStep(process.id)}>
                {VIEW_TEXT.add.step}
              </AddButton>
            )}
          </>
        ) : undefined;
        return (
          <ProcessRow key={process.id} letter={processLetter(processIndex)} name={name} owner={owner} extra={extra} after={after}>
            {process.steps.map((step, stepIndex) => (
              <Fragment key={step.id}>
                {stepIndex > 0 ? <StepArrow /> : null}
                <StepCard
                  code={stepCode(processIndex, stepIndex)}
                  stepId={step.id}
                  title={step.title}
                  who={step.who}
                  accent={{ kind: "friction", level: step.friction }}
                  frictionText={step.friction > 0 ? BOARD_TEXT.card.friction(frictionLabel(step.friction)) : null}
                  gate={hasHumanDecision(step) ? step.decisionLabel : false}
                  toValidate={step.status === "da_validare"}
                  dimmed={stepDimmed(step, p.filter)}
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
export function ProcessMapEditor(p: { board: MappingBoard; editable: boolean; filter: MapFilter | null; focusProcessId: string | null; actions: MapActions }): JSX.Element {
  const [drag, setDrag] = useState<DragState>(NO_DRAG);
  const [menu, setMenu] = useState<string | null>(null);
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
      <MapRows board={p.board} editable={p.editable} filter={p.filter} menu={menu} onMenu={setMenu} drag={drag} focusProcessId={p.focusProcessId} actions={p.actions} onGripDragStart={start} onGripDragEnd={end} />
    </div>
  );
}
