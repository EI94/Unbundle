"use client";

/**
 * «Mappatura board»: il drawer della classificazione, S2c sulla scheda «Classificazione» (docs/mappatura/MAPPATURA-BOARD-PIANO.md
 * §1.4; P27, P44, P25, P21).
 *
 * Il drawer largo che confronta, come quello del processo con gli agenti del riferimento: i badge del passo; «Oggi»
 * (la riga grigia, il passo com'è) accanto a «Classificazione» (la riga dell'accento, il motivo del classificatore);
 * per chi rivede il selettore dello stream `Automate | Differentiate | Innovate | —`, con il punto ambra sulla proposta
 * dell'assistente (per gli altri è spento); «Potenziale con l'AI»; «Decide una persona»; «AI exposure» con il match
 * O*NET; gli strumenti; gli attriti di oggi; le idee del team, che si scrivono qui («+ idea»); gli use case del passo.
 *
 * `ClassificationDetails` è il corpo, senza dialogo: lo usano il drawer e i test.
 */
import Link from "next/link";
import { useState, type JSX } from "react";
import { hasHumanDecision, locateStep, uncheckedNoteStatus, type BoardNote, type MappingBoard, type StepPlace } from "../../../lib/mappatura/board-model.ts";
import { BOARD_TEXT, STREAM_LABEL, formatCount } from "../../../lib/mappatura/text.ts";
import { STREAMS, type Stream } from "../../../lib/mappatura/vocab.ts";
import type { OpInput } from "../store/board-client.ts";
import { useBoard, useBoardClient } from "../store/use-board.tsx";
import { AddButton, Chip, ExposureBadge, StreamBadge } from "../ui/atoms.tsx";
import { Compare, Drawer, DrawerColumns, DrawerList, Human } from "../ui/drawer.tsx";
import { NoteItem, Segmented } from "../ui/edit.tsx";
import { CLASSIFICATION_TEXT, onetLine, reliabilityText } from "./text.ts";

type StreamChoice = Stream | "none";

/** Le voci del selettore: i tre stream e «—»; il punto ambra su quello proposto dall'assistente. */
export function streamOptions(proposed: Stream | null): Array<{ value: StreamChoice; label: string; recommended?: boolean; ariaLabel?: string }> {
  return [
    ...STREAMS.map((stream) => ({ value: stream, label: STREAM_LABEL[stream], ...(proposed === stream ? { recommended: true } : {}) })),
    // «—» è un segno: a chi usa uno screen reader l'opzione dice «Nessuno stream» (§7.3).
    { value: "none" as const, label: CLASSIFICATION_TEXT.drawer.none, ariaLabel: CLASSIFICATION_TEXT.drawer.noneLabel },
  ];
}

/** L'operazione di una scelta nel selettore: lo stream di adesso e quello nuovo; null se non cambia niente. */
export function streamChoiceOp(stepId: string, current: Stream | null, choice: StreamChoice): OpInput | null {
  const next = choice === "none" ? null : choice;
  return next === current ? null : { t: "step.stream", stepId, prev: current, next };
}

/** Il testo di una nota lasciato dalla persona: vuoto la toglie, con «Annulla» (P55, P57); altrimenti lo cambia (P52). */
export function noteTextChange(note: Pick<BoardNote, "id">, next: string, base: string): { op: OpInput; undo?: string } {
  return next === ""
    ? { op: { t: "note.remove", noteId: note.id }, undo: BOARD_TEXT.toast.noteRemoved }
    : { op: { t: "note.set", noteId: note.id, field: "text", prev: base, next } };
}

/** La spunta di una nota: validata, o di nuovo «ipotesi» o «da fonti» secondo da dove viene (P56). */
export function noteToggleOp(note: Pick<BoardNote, "id" | "status" | "origin">): OpInput {
  return { t: "note.set", noteId: note.id, field: "status", prev: note.status, next: note.status === "validato" ? uncheckedNoteStatus(note.origin) : "validato" };
}

/** Un'idea del team scritta qui: una nota della corsia «Idee del team» del passo; vuota non nasce. */
export function newIdeaOp(stepId: string, text: string, noteId: string): OpInput | null {
  return text.trim() ? { t: "note.add", noteId, stepId, lane: "idee", text } : null;
}

const EMPTY = <p className="b-muted">{BOARD_TEXT.empty}</p>;

/** Una nota scritta qui nasce validata (P54); vuota non si salva (P55). */
const DRAFT: BoardNote = { id: "nuova-idea", lane: "idee", title: null, text: "", status: "validato", origin: "board" };

export function ClassificationDetails(p: { board: MappingBoard; place: StepPlace; dispatch(ops: OpInput | OpInput[], options?: { undo?: string }): void; newId(): string }): JSX.Element {
  const { board, place, dispatch } = p;
  const { step } = place;
  const T = CLASSIFICATION_TEXT.drawer;
  const [drafting, setDrafting] = useState(false);
  const edit = board.can.edit;
  const exposure = typeof step.aiExposure === "number" ? Math.round(step.aiExposure * 100) : null;
  const cases = step.useCaseIds.flatMap((id) => board.useCases.filter((item) => item.id === id));

  const setText = (note: BoardNote) => (next: string, base: string) => {
    const change = noteTextChange(note, next, base);
    dispatch(change.op, change.undo ? { undo: change.undo } : undefined);
  };
  const toggle = (note: BoardNote) => () => dispatch(noteToggleOp(note));

  return (
    <>
      {step.stream || exposure !== null ? (
        <div className="b-ag" data-b="badges">
          {step.stream ? <StreamBadge stream={step.stream} /> : null}
          {exposure !== null ? <ExposureBadge pct={exposure} /> : null}
        </div>
      ) : null}
      <Compare
        wasLabel={T.today}
        was={<p>{step.description?.trim() || BOARD_TEXT.empty}</p>}
        nowLabel={T.classification}
        now={
          step.stream ? (
            <>
              <p>{step.reason?.trim() || BOARD_TEXT.empty}</p>
              {typeof step.confidence === "number" ? <p className="b-muted">{reliabilityText(step.confidence)}</p> : null}
            </>
          ) : (
            <p>{T.unclassified}</p>
          )
        }
      />
      <DrawerList label={T.stream}>
        <Segmented
          label={T.selector}
          options={streamOptions(step.proposedStream)}
          value={step.stream ?? "none"}
          disabled={!board.can.setStream}
          recommendedLabel={T.proposed}
          onChange={(choice) => {
            const op = streamChoiceOp(step.id, step.stream, choice);
            if (op) dispatch(op);
          }}
        />
      </DrawerList>
      <DrawerColumns>
        <DrawerList label={T.potential}>{step.aiPotential?.trim() ? <p>{step.aiPotential}</p> : EMPTY}</DrawerList>
        {hasHumanDecision(step) ? (
          <DrawerList label={T.decides}>
            <Human label={step.decisionLabel}>{step.decision?.trim() || null}</Human>
          </DrawerList>
        ) : null}
        <DrawerList label={T.exposure}>
          {exposure !== null || step.onetCode ? (
            <>
              {exposure !== null ? <p className="b-cls-big">{`${formatCount(exposure)}%`}</p> : null}
              {step.onetCode ? <p className="b-muted">{onetLine(step.onetCode, step.onetTitle)}</p> : null}
            </>
          ) : (
            EMPTY
          )}
        </DrawerList>
        <DrawerList label={T.tools}>
          {step.tools.length > 0 ? (
            <div className="b-chips">
              {step.tools.map((tool, index) => (
                <Chip key={`${index}:${tool}`} tool>
                  {tool}
                </Chip>
              ))}
            </div>
          ) : (
            EMPTY
          )}
        </DrawerList>
        <DrawerList label={T.frictions}>
          {step.notes.attriti.length > 0 ? (
            <ul className="b-l">
              {step.notes.attriti.map((note) => (
                <li key={note.id}>{note.text}</li>
              ))}
            </ul>
          ) : (
            EMPTY
          )}
        </DrawerList>
        <DrawerList label={T.ideas}>
          <div className="b-cell" data-lane="idee">
            {step.notes.idee.map((note) => (
              <NoteItem
                key={note.id}
                note={note}
                label={T.ideaLabel}
                disabled={!edit}
                onText={setText(note)}
                onToggle={toggle(note)}
                onRemove={() => dispatch({ t: "note.remove", noteId: note.id }, { undo: BOARD_TEXT.toast.noteRemoved })}
              />
            ))}
            {edit && drafting ? (
              <div
                onBlur={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDrafting(false);
                }}
              >
                <NoteItem
                  note={DRAFT}
                  label={T.ideaLabel}
                  autoFocus
                  onText={(next) => {
                    const op = newIdeaOp(step.id, next, p.newId());
                    if (op) dispatch(op);
                    setDrafting(false);
                  }}
                  onToggle={() => {}}
                  onRemove={() => setDrafting(false)}
                />
              </div>
            ) : null}
            {edit && !drafting ? (
              <AddButton aria-label={T.addIdeaLabel} onClick={() => setDrafting(true)}>
                {T.addIdea}
              </AddButton>
            ) : null}
            {!edit && step.notes.idee.length === 0 ? EMPTY : null}
          </div>
        </DrawerList>
        <DrawerList label={T.useCases}>
          {cases.length > 0 ? (
            <ul className="b-l">
              {cases.map((item) => (
                <li key={item.id}>
                  <Link href={item.href}>{[item.code, item.title].filter(Boolean).join(" · ")}</Link>
                </li>
              ))}
            </ul>
          ) : (
            EMPTY
          )}
        </DrawerList>
      </DrawerColumns>
    </>
  );
}

/**
 * Il drawer di un passo della classificazione: si apre con l'id del passo, si chiude se il passo non c'è più. Mentre si
 * chiude (0,26 s) mostra ancora l'ultimo passo, come il riferimento.
 */
export function ClassificationDrawer(p: { stepId: string | null; onClose(): void }): JSX.Element {
  const board = useBoard((state) => state.board);
  const client = useBoardClient();
  const place = p.stepId ? locateStep(board, p.stepId) : null;
  // L'ultimo passo aperto, per id: mentre il drawer si chiude resta quello.
  const [lastId, setLastId] = useState(p.stepId);
  if (p.stepId && p.stepId !== lastId) setLastId(p.stepId);
  const shown = place ?? (lastId ? locateStep(board, lastId) : null);
  return (
    <Drawer open={place !== null} onClose={p.onClose} wide context={shown ? `${shown.process.name} · ${shown.code}` : ""} title={shown?.step.title ?? ""}>
      {shown ? <ClassificationDetails key={shown.step.id} board={board} place={shown} dispatch={(ops, options) => client.dispatch(ops, options)} newId={() => client.newId()} /> : null}
    </Drawer>
  );
}
