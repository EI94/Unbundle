"use client";

/**
 * «Mappatura board»: il drawer di un passo, S2c (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3; P20, P21, P29–P33,
 * P51–P58, P67; BOARD-SPEC §2.2, §1.4.13).
 *
 * Lo stesso drawer largo del riferimento, nello stesso ordine: la riga del contesto («{processo} · A2»), il titolo,
 * «Chiudi»; poi la descrizione, i chip di ruoli e strumenti, le liste. Qui è anche dove il passo si modifica, e
 * aggiunge le cinque parti che la mappatura di Unbundle chiede e il passo del riferimento non ha (BOARD-SPEC §5.3):
 * - la descrizione; ruoli e strumenti con «+ ruolo», «+ strumento»; «Entra» ed «Esce»;
 * - quattro corsie di note in tante colonne quante ne stanno: «Attività», «Attriti» (con i quattro livelli), «Dati e
 *   documenti», «Tempi e volumi» (con frequenza e ore a settimana). Ogni nota si scrive sul posto, si valida, si
 *   elimina con «Annulla»; «+ nota» ne aggiunge una con il cursore dentro;
 * - «Decide una persona» (il nome della decisione, chi decide che cosa), «Eccezioni», «Collegamenti» (i passi da cui
 *   dipende e quelli che lo aspettano, che si aprono), «Altri dettagli» chiusi (tipo di lavoro, qualità percepita);
 * - in fondo: da dove viene il passo, «Conferma il passo» (l'unico bottone pieno del drawer: la sua strada avanti) o
 *   «Segna da validare», «Sposta a sinistra», «Sposta a destra», «Sposta in», «Elimina il passo».
 * Un passo nuovo («+ passo») apre il drawer con il cursore nel titolo: nasce quando il titolo c'è, e senza titolo non
 * nasce niente (P53, P55). In sola lettura il drawer si legge: un elenco vuoto è «—» (P21).
 *
 * `StepDrawerBody` non ha stato (lo provano i test con Node, chiamando i suoi controlli); `StepDrawer` lo monta nel
 * dialogo delle fondamenta.
 */
import type { JSX, ReactNode } from "react";
import { hasHumanDecision, locateStep, type BoardNote, type MappingBoard, type StepPlace } from "../../../lib/mappatura/board-model.ts";
import { BOARD_TEXT, FREQUENCY_LABEL, FRICTION_LABEL, LANE_LABEL, ORIGIN_LABEL, WORK_TYPE_LABEL, formatHours, frequencyLabel, workTypeLabel } from "../../../lib/mappatura/text.ts";
import { ACTIVITY_COLUMNS, FRICTIONS, MAPPING_LIMITS, WORK_TYPES, type StepLane } from "../../../lib/mappatura/vocab.ts";
import type { OpInput } from "../store/board-client.ts";
import { AddButton, BoardButton, Section } from "../ui/atoms.tsx";
import { Drawer, DrawerColumns, DrawerList, Human } from "../ui/drawer.tsx";
import { ChipInput, Field, LevelButtons, NoteItem, NumberInput, TextInPlace } from "../ui/edit.tsx";
import { DraftText, LineInPlace } from "./in-place.tsx";
import { VIEW_TEXT, addNoteLabel, drawerContext, frictionGroupLabel, noteLabel, processOptionText, stepRefText } from "./text.ts";
import { frictionOp, hoursOp, laneFull, moveTargets, newStepOps, newStepPlace, noteAddOp, noteTextOps, noteToggleOp, statusOp, stepCodes, stepMoveOp, stepTextOp, stepValueOp, type StepTextField } from "./view-model.ts";

const L = MAPPING_LIMITS;
const D = VIEW_TEXT.drawer;

/** Che cosa mostra il drawer: un passo della board, o un passo nuovo che nasce dal suo titolo. */
export type DrawerTarget = { kind: "step"; stepId: string; created?: boolean } | { kind: "draft"; processId: string | null };

/** Quello che il drawer chiede a chi lo monta. */
export interface StepActions {
  dispatch(ops: OpInput | OpInput[], options?: { undo?: string }): void;
  openStep(stepId: string): void;
  close(): void;
  /** «Elimina il passo»: lo toglie (con «Annulla»), chiude il drawer e porta il fuoco alla card vicina (`focusAfterRemoval`). */
  removeStep(stepId: string): void;
  notify(text: string): void;
  newId(): string;
  /** La corsia dove la persona sta scrivendo una nota nuova (null: nessuna). */
  setAdding(lane: StepLane | null): void;
}

/** «—»: un elenco o un campo vuoto, quando la board si legge e basta (P21). */
const none = <p className="b-dr-none">{BOARD_TEXT.empty}</p>;

export interface StepDrawerBodyProps {
  board: MappingBoard;
  place: StepPlace;
  editable: boolean;
  /** Il passo è appena nato dal suo titolo: il cursore va nella descrizione. */
  created?: boolean;
  addingLane: StepLane | null;
  actions: StepActions;
}

/** Una corsia di note (P51–P57): le note, la nota nuova con il cursore dentro, «+ nota». In sola lettura un elenco. */
export function Lane(p: StepDrawerBodyProps & { lane: StepLane; children?: ReactNode }): JSX.Element {
  const { place, lane, editable, actions } = p;
  const step = place.step;
  const notes: BoardNote[] = step.notes[lane];
  const label = LANE_LABEL[lane];
  const adding = p.addingLane === lane;
  return (
    <DrawerList label={label}>
      {p.children}
      {editable ? (
        <div className="b-cell" data-lane={lane}>
          {notes.map((note) => (
            <NoteItem
              key={note.id}
              note={note}
              label={noteLabel(label)}
              onText={(next, base) => actions.dispatch(noteTextOps(note, next, base))}
              onToggle={() => actions.dispatch(noteToggleOp(note))}
              onRemove={() => actions.dispatch({ t: "note.remove", noteId: note.id }, { undo: BOARD_TEXT.toast.noteRemoved })}
            />
          ))}
          {adding ? (
            <div className="b-note-w" data-status="validato" data-origin="board">
              <div className="b-note">
                <DraftText
                  label={noteLabel(label)}
                  maxLength={L.note}
                  onDone={(text) => {
                    actions.setAdding(null);
                    const op = text ? noteAddOp(step.id, lane, text, actions.newId) : null;
                    if (op) actions.dispatch(op);
                  }}
                />
              </div>
            </div>
          ) : laneFull(notes, lane) ? null : (
            <AddButton aria-label={addNoteLabel(label)} onClick={() => actions.setAdding(lane)}>
              {D.addNote}
            </AddButton>
          )}
        </div>
      ) : notes.length > 0 ? (
        <ul className="b-l">
          {notes.map((note) => (
            <li key={note.id}>{note.text}</li>
          ))}
        </ul>
      ) : (
        none
      )}
    </DrawerList>
  );
}

/** Un testo del passo: sul posto per chi modifica, letto (o «—») in sola lettura. */
export function StepText(p: StepDrawerBodyProps & { field: Exclude<StepTextField, "title" | "decisionLabel" | "quality">; label: string; placeholder: string; max: number; autoFocus?: boolean }): JSX.Element {
  const step = p.place.step;
  const value = step[p.field] ?? "";
  if (!p.editable) return value ? <p className="b-dr-text">{value}</p> : none;
  return (
    <TextInPlace
      value={value}
      multiline
      label={p.label}
      placeholder={p.placeholder}
      maxLength={p.max}
      autoFocus={p.autoFocus}
      onCommit={(next, base) => {
        const op = stepTextOp(step, p.field, next, base);
        if (op) p.actions.dispatch(op);
      }}
    />
  );
}

/** Le opzioni della frequenza: le quattro della chat, più il testo salvato quando non è una di loro. */
function frequencyOptions(stored: string | null): Array<{ value: string; label: string }> {
  const known = Object.entries(FREQUENCY_LABEL).map(([value, label]) => ({ value, label }));
  const key = stored?.trim().toLowerCase() ?? "";
  if (!stored || Object.hasOwn(FREQUENCY_LABEL, key)) return known;
  return [...known, { value: stored, label: stored }];
}
const frequencyValue = (stored: string | null) => {
  const key = stored?.trim().toLowerCase() ?? "";
  return stored ? (Object.hasOwn(FREQUENCY_LABEL, key) ? key : stored) : "";
};

/** Il corpo del drawer di un passo, senza stato. */
export function StepDrawerBody(p: StepDrawerBodyProps): JSX.Element {
  const { board, place, editable, actions } = p;
  const step = place.step;
  const run = (op: OpInput | null) => {
    if (op) actions.dispatch(op);
  };
  const codes = stepCodes(board);
  const links = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const ref = codes.get(id);
      return ref
        ? [
            <button key={id} type="button" className="b-chip b-chip-link" onClick={() => actions.openStep(id)}>
              {stepRefText(ref.code, ref.title)}
            </button>,
          ]
        : [];
    });
  const dependsOn = links(step.dependsOn);
  const neededBy = links(step.neededBy);
  const targets = moveTargets(board, step.id);
  const atStart = place.stepIndex === 0;
  const atEnd = place.stepIndex === place.process.steps.length - 1;

  return (
    <>
      <div className="b-dr-lede" data-b="step-description">
        <StepText {...p} field="description" label={D.descriptionLabel} placeholder={D.descriptionPlaceholder} max={L.description} autoFocus={p.created} />
      </div>

      {editable || step.who.length > 0 || step.tools.length > 0 ? (
        <div className="b-dr-chips" data-b="step-chips">
          <ChipInput values={step.who} addLabel={D.addRole} placeholder={D.rolePlaceholder} max={L.who} maxLength={L.whoItem} disabled={!editable} onChange={(next) => run(stepValueOp(step, "who", next))} />
          <ChipInput values={step.tools} tool addLabel={D.addTool} placeholder={D.toolPlaceholder} max={L.tools} maxLength={L.toolItem} disabled={!editable} onChange={(next) => run(stepValueOp(step, "tools", next))} />
        </div>
      ) : null}

      <DrawerColumns>
        <DrawerList label={D.input}>
          <StepText {...p} field="input" label={D.input} placeholder={D.inputPlaceholder} max={L.io} />
        </DrawerList>
        <DrawerList label={D.output}>
          <StepText {...p} field="output" label={D.output} placeholder={D.outputPlaceholder} max={L.io} />
        </DrawerList>
      </DrawerColumns>

      <DrawerColumns>
        <Lane {...p} lane="attivita" />
        <Lane {...p} lane="attriti">
          <LevelButtons
            label={frictionGroupLabel(FRICTION_LABEL[step.friction])}
            options={FRICTIONS.map((level) => ({ value: level, label: FRICTION_LABEL[level] }))}
            value={step.friction}
            disabled={!editable}
            onChange={(level) => run(frictionOp(step, level))}
          />
        </Lane>
        <Lane {...p} lane="dati" />
        <Lane {...p} lane="tempi">
          <div className="b-dr-fields">
            <Field label={D.frequency}>
              {editable ? (
                <select className="b-input b-select" value={frequencyValue(step.frequency)} onChange={(event) => run(stepValueOp(step, "frequency", event.target.value))}>
                  <option value="">{BOARD_TEXT.empty}</option>
                  {frequencyOptions(step.frequency).map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="b-dr-value">{step.frequency ? frequencyLabel(step.frequency) : BOARD_TEXT.empty}</span>
              )}
            </Field>
            <Field label={D.hoursWeek}>
              {editable ? (
                <NumberInput value={step.hoursWeek} min={0} max={L.hoursWeek} step={0.5} onCommit={(next, base) => run(hoursOp(step, next, base))} />
              ) : (
                <span className="b-dr-value">{step.hoursWeek === null ? BOARD_TEXT.empty : formatHours(step.hoursWeek)}</span>
              )}
            </Field>
          </div>
        </Lane>
      </DrawerColumns>

      <Human label={D.decides}>
        {editable ? (
          <>
            <LineInPlace
              className="b-dec-label"
              value={step.decisionLabel ?? ""}
              label={D.decisionLabelPlaceholder}
              placeholder={D.decisionLabelPlaceholder}
              maxLength={L.decisionLabel}
              onCommit={(next, base) => run(stepTextOp(step, "decisionLabel", next, base))}
            />
            <StepText {...p} field="decision" label={D.decides} placeholder={D.decisionPlaceholder} max={L.decision} />
          </>
        ) : hasHumanDecision(step) ? (
          <>
            {step.decisionLabel ? <span className="b-dec-label">{step.decisionLabel}</span> : null}
            {step.decision ? <p className="b-dr-text">{step.decision}</p> : null}
          </>
        ) : (
          none
        )}
      </Human>

      <DrawerList label={D.exception}>
        <StepText {...p} field="exception" label={D.exception} placeholder={D.exceptionPlaceholder} max={L.exception} />
      </DrawerList>

      {dependsOn.length > 0 || neededBy.length > 0 ? (
        <DrawerList label={D.links}>
          {dependsOn.length > 0 ? (
            <div className="b-links">
              <span className="b-links-k">{D.dependsOn}</span>
              {dependsOn}
            </div>
          ) : null}
          {neededBy.length > 0 ? (
            <div className="b-links">
              <span className="b-links-k">{D.neededBy}</span>
              {neededBy}
            </div>
          ) : null}
        </DrawerList>
      ) : null}

      <Section title={D.more}>
        <div className="b-dr-fields">
          <Field label={D.workType}>
            {editable ? (
              <select className="b-input b-select" value={step.workType ?? ""} onChange={(event) => run(stepValueOp(step, "workType", event.target.value))}>
                <option value="">{BOARD_TEXT.empty}</option>
                {WORK_TYPES.map((workType) => (
                  <option key={workType} value={workType}>
                    {WORK_TYPE_LABEL[workType]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="b-dr-value">{step.workType ? workTypeLabel(step.workType) : BOARD_TEXT.empty}</span>
            )}
          </Field>
          <Field label={D.quality}>
            {editable ? (
              <TextInPlace value={step.quality ?? ""} label={D.quality} maxLength={ACTIVITY_COLUMNS.quality} onCommit={(next, base) => run(stepTextOp(step, "quality", next, base))} />
            ) : (
              <span className="b-dr-value">{step.quality ?? BOARD_TEXT.empty}</span>
            )}
          </Field>
        </div>
      </Section>

      <div className="b-dr-foot" data-b="step-foot">
        <span className="b-dr-origin">{ORIGIN_LABEL[step.origin]}</span>
        {editable ? (
          <div className="b-dr-actions">
            <BoardButton variant={step.status === "da_validare" ? "primary" : "outline"} onClick={() => actions.dispatch(statusOp(step))}>
              {step.status === "da_validare" ? D.confirm : D.unconfirm}
            </BoardButton>
            {/* In fondo alla riga il bottone resta raggiungibile (aria-disabled, come i voti): il fuoco non si perde (F1). */}
            <BoardButton
              aria-disabled={atStart || undefined}
              onClick={() => {
                if (!atStart) run(stepMoveOp(board, step.id, "left"));
              }}
            >
              {D.left}
            </BoardButton>
            <BoardButton
              aria-disabled={atEnd || undefined}
              onClick={() => {
                if (!atEnd) run(stepMoveOp(board, step.id, "right"));
              }}
            >
              {D.right}
            </BoardButton>
            {targets.length > 0 ? (
              <select
                className="b-input b-select b-move-to"
                aria-label={D.moveTo}
                value=""
                onChange={(event) => {
                  const processId = event.target.value;
                  if (processId) run(stepMoveOp(board, step.id, { processId }));
                }}
              >
                <option value="" disabled>
                  {D.moveTo}
                </option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {processOptionText(target.letter, target.name)}
                  </option>
                ))}
              </select>
            ) : null}
            <BoardButton
              className="b-danger"
              onClick={() => {
                // Un passo che uno use case elenca non si elimina: lo dice subito, senza aspettare il server.
                if (step.useCaseIds.length > 0) {
                  actions.notify(BOARD_TEXT.toast.linked);
                  return;
                }
                // La card che ha aperto il drawer se ne va con il passo: il fuoco va alla card vicina (F1).
                actions.removeStep(step.id);
              }}
            >
              {D.remove}
            </BoardButton>
          </div>
        ) : null}
      </div>
    </>
  );
}

/** La testa del drawer di un passo: la riga del contesto e il titolo (sul posto per chi modifica). */
export function stepDrawerHead(p: { place: StepPlace; editable: boolean; actions: Pick<StepActions, "dispatch"> }): { context: string; title: ReactNode } {
  const { place } = p;
  const context = drawerContext(place.process.name, place.code);
  if (!p.editable) return { context, title: place.step.title };
  return {
    context,
    title: (
      <LineInPlace
        value={place.step.title}
        label={D.titlePlaceholder}
        placeholder={D.titlePlaceholder}
        maxLength={L.title}
        onCommit={(next, base) => {
          const op = stepTextOp(place.step, "title", next, base);
          if (op) p.actions.dispatch(op);
        }}
      />
    ),
  };
}

/**
 * La testa del drawer di un passo nuovo: il cursore nel titolo; nasce quando il titolo c'è (P53, P55). Il cursore ce lo
 * mette il dialogo (`drawerFocus`, «title»), non `autoFocus`: il dialogo ricorda chi l'ha aperto («+ passo») prima di
 * spostare il fuoco, e alla chiusura glielo rende; un `autoFocus` sposterebbe il fuoco prima, e il fuoco tornerebbe a
 * chi aveva aperto il drawer di prima.
 */
export function draftDrawerHead(p: { board: MappingBoard; processId: string | null; actions: Pick<StepActions, "dispatch" | "newId">; onCreated(stepId: string): void }): { context: string; title: ReactNode } {
  const place = newStepPlace(p.board, p.processId);
  return {
    context: drawerContext(place.processName, place.code),
    title: (
      <LineInPlace
        value=""
        label={D.titlePlaceholder}
        placeholder={D.titlePlaceholder}
        maxLength={L.title}
        onCommit={(next) => {
          const made = newStepOps(p.processId, next, p.actions.newId);
          if (!made) return;
          p.actions.dispatch(made.ops);
          p.onCreated(made.stepId);
        }}
      />
    ),
  };
}

/** Il fuoco all'apertura (P30): «Chiudi», o il titolo di un passo nuovo. */
export const drawerFocus = (target: DrawerTarget | null): "close" | "title" => (target?.kind === "draft" ? "title" : "close");

/**
 * Il drawer di un passo, nel dialogo delle fondamenta: largo, modale, il fuoco a «Chiudi» o nel titolo di un passo
 * nuovo. Un passo che non c'è più (eliminato, o da un altro) chiude il drawer.
 */
export function StepDrawer(p: {
  board: MappingBoard;
  open: boolean;
  target: DrawerTarget | null;
  editable: boolean;
  addingLane: StepLane | null;
  actions: StepActions;
  onCreated(stepId: string): void;
  /** Dove va il fuoco alla chiusura (`drawerReturnFocus`); null lascia fare al dialogo. */
  finalFocus?: () => HTMLElement | null;
}): JSX.Element {
  const target = p.target;
  const place = target?.kind === "step" ? locateStep(p.board, target.stepId) : null;
  const draft = target?.kind === "draft" && p.editable ? target : null;
  const open = p.open && (place !== null || draft !== null);
  const head = place
    ? stepDrawerHead({ place, editable: p.editable, actions: p.actions })
    : draft
      ? draftDrawerHead({ board: p.board, processId: draft.processId, actions: p.actions, onCreated: p.onCreated })
      : { context: "", title: "" };
  return (
    <Drawer open={open} onClose={p.actions.close} wide context={head.context} title={head.title} initialFocus={drawerFocus(target)} finalFocus={p.finalFocus}>
      {place ? <StepDrawerBody board={p.board} place={place} editable={p.editable} created={target?.kind === "step" && target.created === true} addingLane={p.addingLane} actions={p.actions} /> : null}
    </Drawer>
  );
}
