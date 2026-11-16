"use client";

/**
 * «Mappatura board»: la vista «Processi di oggi», S2 (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3; P7, P11–P21,
 * P34, P35, P37, P38, P53–P62; BOARD-SPEC §2.2).
 *
 * Dall'alto: la testa (occhiello, la scoperta in una frase o «Come lavora oggi *{unità}*», la descrizione dell'unità,
 * a destra l'unico bottone pieno: lo slot `headAction` del compagno); i quattro riquadri dei numeri; i punti di
 * analisi, ognuno una nota che si scrive sul posto («+ punto»); «Chi fa cosa e con quali strumenti», chiuso; «I
 * processi, uno per uno»: la legenda, la riga dei conteggi, «Evidenzia attriti», «Copia la mappa come testo», la
 * mappa. Un clic su un passo apre il suo drawer. Un'unità senza processi mostra «Nessun passo, per ora» con «Inizia
 * con l'assistente» (pieno) e «Aggiungi un passo». Una board in sola lettura disegna i suoi controlli spenti, o non li
 * disegna, dal primo disegno (F9).
 *
 * `TodayContent` non ha stato (lo provano i test con Node, chiamando i suoi controlli); `TodayView` tiene il drawer,
 * «Evidenzia attriti», la nota o il punto che si sta scrivendo, e legge la board dallo store.
 */
import { useRef, useState, type JSX, type ReactNode } from "react";
import { boardAsText, rolesTable, toolsTable, type BoardNote, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { BOARD_TEXT, noteCaption } from "../../../lib/mappatura/text.ts";
import { MAPPING_LIMITS, type StepLane } from "../../../lib/mappatura/vocab.ts";
import type { OpInput } from "../store/board-client.ts";
import { useBoard, useBoardClient } from "../store/use-board.tsx";
import { AddButton, BoardButton, Dot, FilterChip, Kpis, Legend, LegendItem, RemoveIcon, Section, StackTable } from "../ui/atoms.tsx";
import { Drawer } from "../ui/drawer.tsx";
import { EmptyBlock, noteToggleLabel } from "../ui/edit.tsx";
import { focusBeforeRemoving, type FocusNode } from "../ui/focus.ts";
import { Block, ViewHead } from "../ui/frame.tsx";
import { DraftPoint, LineInPlace, TextWithMore } from "./in-place.tsx";
import { ProcessMapEditor, type MapActions } from "./process-map.tsx";
import { StepDrawer, type DrawerTarget, type StepActions } from "./step-drawer.tsx";
import { VIEW_TEXT, rolesToolsHint, stepRefText } from "./text.ts";
import {
  analysisShown,
  boardEditable,
  boardEmpty,
  drawerReturnFocus,
  focusAfterRemoval,
  headlineOp,
  laneFull,
  mapCounts,
  newProcessOp,
  noteTextOps,
  noteTitleOp,
  noteToggleOp,
  pointAddOp,
  stepCodes,
  todayTiles,
  type MapFocus,
} from "./view-model.ts";

const L = MAPPING_LIMITS;

/** Quello che la vista chiede a chi la monta. */
export interface TodayActions extends MapActions {
  addStep(processId: string | null): void;
  startAssistant(): void;
  toggleDim(): void;
  copyMap(): void;
  newId(): string;
  setAddingPoint(adding: boolean): void;
}

function CheckIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2 6.3l2.5 2.4L10 3.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Un punto di analisi (P35): il titolo, la prima frase con il resto sotto «Dettagli»; una nota che si valida e si elimina. */
export function AnalysisPoint(p: { note: BoardNote; editable: boolean; actions: TodayActions }): JSX.Element {
  const { note, editable, actions } = p;
  const caption = noteCaption(note.status, note.origin);
  const run = (op: OpInput | null) => {
    if (op) actions.dispatch(op);
  };
  const toggle = noteToggleLabel(note);
  return (
    <div className="b-point" data-status={note.status} data-b="point">
      {editable ? (
        <b>
          <LineInPlace value={note.title ?? ""} label={VIEW_TEXT.points.titleLabel} placeholder={VIEW_TEXT.points.titlePlaceholder} maxLength={L.noteTitle} onCommit={(next, base) => run(noteTitleOp(note, next, base))} />
        </b>
      ) : note.title ? (
        <b>{note.title}</b>
      ) : null}
      <TextWithMore
        text={note.text}
        label={VIEW_TEXT.points.textLabel}
        editLabel={VIEW_TEXT.points.edit}
        placeholder={VIEW_TEXT.points.textPlaceholder}
        maxLength={L.note}
        disabled={!editable}
        onCommit={(next, base) => actions.dispatch(noteTextOps(note, next, base))}
      />
      {caption ? <i className="b-point-cap">{caption}</i> : null}
      {editable ? (
        <div className="b-note-ctl b-point-ctl">
          <button type="button" aria-label={toggle} title={toggle} onClick={() => actions.dispatch(noteToggleOp(note))}>
            <CheckIcon />
          </button>
          <button
            type="button"
            aria-label={BOARD_TEXT.note.removeLabel}
            title={BOARD_TEXT.note.remove}
            onClick={(event) => {
              // Il punto se ne va con la sua «×»: il fuoco va alla «×» del punto vicino, o a «+ punto» (F1).
              focusBeforeRemoving(event.currentTarget as unknown as FocusNode, '[data-b="point"]');
              actions.dispatch({ t: "note.remove", noteId: note.id }, { undo: BOARD_TEXT.toast.noteRemoved });
            }}
          >
            <RemoveIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
}

export interface TodayContentProps {
  board: MappingBoard;
  dim: boolean;
  addingPoint: boolean;
  focusProcessId: string | null;
  /** Lo slot del compagno: «Completa la mappatura» o «Classifica {n} passi», l'unico bottone pieno della vista. */
  headAction: ReactNode;
  actions: TodayActions;
}

/** La vista, senza stato. */
export function TodayContent(p: TodayContentProps): JSX.Element {
  const { board, actions } = p;
  const editable = boardEditable(board);
  const empty = boardEmpty(board);
  const run = (op: OpInput | null) => {
    if (op) actions.dispatch(op);
  };
  const title = board.headline ? (
    editable ? (
      <LineInPlace value={board.headline} label={VIEW_TEXT.today.headlineLabel} placeholder={VIEW_TEXT.today.headlinePlaceholder} maxLength={L.headline} onCommit={(next, base) => run(headlineOp(next, base))} />
    ) : (
      board.headline
    )
  ) : (
    <>
      {VIEW_TEXT.today.titlePlain} <i>{board.unit.name}</i>
    </>
  );
  const head = <ViewHead eyebrow={BOARD_TEXT.tabs.oggi} title={title} lede={board.unit.description} action={empty ? undefined : p.headAction} />;
  const notice = board.store === "mancante" ? <p className="b-notice">{BOARD_TEXT.storeMissing}</p> : null;

  if (empty) {
    return (
      <>
        {head}
        {notice}
        <EmptyBlock title={VIEW_TEXT.empty.title} text={VIEW_TEXT.empty.text}>
          <BoardButton variant="primary" onClick={() => actions.startAssistant()}>
            {VIEW_TEXT.empty.assistant}
          </BoardButton>
          <BoardButton disabled={!editable} onClick={() => actions.addStep(null)}>
            {VIEW_TEXT.empty.addStep}
          </BoardButton>
        </EmptyBlock>
      </>
    );
  }

  const codes = stepCodes(board);
  const idOfCode = new Map([...codes].map(([id, ref]) => [ref.code, id]));
  const refs = (steps: ReadonlyArray<{ code: string; title: string }>) => (
    <span className="b-steprefs">
      {steps.map((ref) => {
        const id = idOfCode.get(ref.code);
        return (
          <button key={ref.code} type="button" className="b-stepref" onClick={() => (id ? actions.openStep(id) : undefined)}>
            {stepRefText(ref.code, ref.title)}
          </button>
        );
      })}
    </span>
  );
  const roles = rolesTable(board);
  const tools = toolsTable(board);
  const R = VIEW_TEXT.roles;

  return (
    <>
      {head}
      {notice}
      <Kpis items={todayTiles(board)} />

      {analysisShown(board) && (board.analysis.length > 0 || editable) ? (
        <Block title={VIEW_TEXT.points.title}>
          <div className="b-points" data-b="points">
            {board.analysis.map((note) => (
              <AnalysisPoint key={note.id} note={note} editable={editable} actions={actions} />
            ))}
            {p.addingPoint ? (
              <DraftPoint
                titleLabel={VIEW_TEXT.points.titleLabel}
                titlePlaceholder={VIEW_TEXT.points.titlePlaceholder}
                textLabel={VIEW_TEXT.points.textLabel}
                textPlaceholder={VIEW_TEXT.points.textPlaceholder}
                titleMax={L.noteTitle}
                textMax={L.note}
                onDone={(point) => {
                  actions.setAddingPoint(false);
                  if (point) run(pointAddOp(point.title, point.text, actions.newId));
                }}
              />
            ) : null}
          </div>
          {editable && !p.addingPoint && !laneFull(board.analysis, "analisi") ? (
            <AddButton className="b-add-point" onClick={() => actions.setAddingPoint(true)}>
              {VIEW_TEXT.points.add}
            </AddButton>
          ) : null}
        </Block>
      ) : null}

      {roles.length > 0 || tools.length > 0 ? (
        <div className="b-block b-roles">
          <Section title={R.title} hint={rolesToolsHint(roles.length, tools.length)}>
            <div className="b-grid2">
              {roles.length > 0 ? <StackTable columns={[R.role, R.steps]} rows={roles.map((row) => [<b key="n">{row.role}</b>, refs(row.steps)])} /> : null}
              {tools.length > 0 ? <StackTable columns={[R.tool, R.steps]} rows={tools.map((row) => [<b key="n">{row.tool}</b>, refs(row.steps)])} /> : null}
            </div>
          </Section>
        </div>
      ) : null}

      <Block title={VIEW_TEXT.map.title} hint={VIEW_TEXT.map.hint}>
        <Legend>
          <LegendItem dot={<Dot tone="crit" />}>{VIEW_TEXT.legend.strong}</LegendItem>
          <LegendItem dot={<Dot tone="amber" />}>{VIEW_TEXT.legend.medium}</LegendItem>
          <LegendItem dot={<Dot tone="neutral" />}>{VIEW_TEXT.legend.light}</LegendItem>
          <LegendItem dot={<Dot tone="amber" diamond />}>{VIEW_TEXT.legend.decides}</LegendItem>
          <span className="b-legend-note">{VIEW_TEXT.legend.toValidate}</span>
        </Legend>
        {/* Il toast non copre mai gli strumenti della mappa («Evidenzia attriti»): ci sale sopra (data-toast-avoid). */}
        <div className="b-ctrl b-map-tools" data-b="map-tools" data-toast-avoid="">
          <span className="b-counts">{mapCounts(board)}</span>
          <span className="b-spacer" />
          <FilterChip pressed={p.dim} onToggle={() => actions.toggleDim()}>
            {VIEW_TEXT.map.dim}
          </FilterChip>
          <BoardButton variant="ghost" onClick={() => actions.copyMap()}>
            {VIEW_TEXT.map.copy}
          </BoardButton>
        </div>
        <ProcessMapEditor board={board} editable={editable} dim={p.dim} focusProcessId={p.focusProcessId} actions={actions} />
      </Block>
    </>
  );
}

/**
 * La mappa come testo, quando gli appunti non ci sono (P62): il drawer stretto con il testo scelto, da copiare a mano.
 * Il dialogo mette il fuoco nel testo appena aperto (`initialFocus="body"`), e il testo preso dal fuoco è scelto.
 */
export function CopyDrawer(p: { text: string | null; onClose(): void }): JSX.Element {
  return (
    <Drawer open={p.text !== null} onClose={p.onClose} context={VIEW_TEXT.copy.context} title={VIEW_TEXT.copy.title} initialFocus="body">
      <textarea className="b-input b-copy" readOnly value={p.text ?? ""} aria-label={VIEW_TEXT.copy.title} onFocus={(event) => event.currentTarget.select()} />
    </Drawer>
  );
}

/** La vista con il suo stato. `onStartAssistant`: «Inizia con l'assistente» apre il pannello, con il cursore nel suo campo. */
export function TodayView(p: { headAction: ReactNode; onStartAssistant(): void }): JSX.Element {
  const board = useBoard((state) => state.board);
  const client = useBoardClient();
  const editable = boardEditable(board);
  const [dim, setDim] = useState(false);
  const [drawer, setDrawer] = useState<{ open: boolean; target: DrawerTarget | null }>({ open: false, target: null });
  const [addingLane, setAddingLane] = useState<StepLane | null>(null);
  const [addingPoint, setAddingPoint] = useState(false);
  const [focusProcessId, setFocusProcessId] = useState<string | null>(null);
  const [copyText, setCopyText] = useState<string | null>(null);
  // Chi ha aperto il drawer (la card, «+ passo», «Aggiungi un passo») e il posto deciso dopo «Elimina il passo»: alla
  // chiusura il fuoco non cade sulla pagina se chi l'ha aperto non c'è più (F1).
  const opener = useRef<Element | null>(null);
  const afterRemoval = useRef<MapFocus | null>(null);

  const open = (target: DrawerTarget) => {
    opener.current = typeof document === "undefined" ? null : document.activeElement;
    afterRemoval.current = null;
    setAddingLane(null);
    setDrawer({ open: true, target });
  };
  const close = () => {
    setAddingLane(null);
    setDrawer((current) => ({ ...current, open: false }));
  };
  const actions: TodayActions & StepActions = {
    dispatch: (ops, options) => client.dispatch(ops, options),
    notify: (text) => client.notify(text),
    newId: () => client.newId(),
    openStep: (stepId) => open({ kind: "step", stepId }),
    addStep: (processId) => open({ kind: "draft", processId }),
    addProcess: () => {
      const processId = client.newId();
      client.dispatch(newProcessOp(processId));
      setFocusProcessId(processId);
    },
    close,
    removeStep: (stepId) => {
      afterRemoval.current = focusAfterRemoval(board, stepId);
      client.dispatch({ t: "step.remove", stepId }, { undo: BOARD_TEXT.toast.stepRemoved });
      close();
    },
    setAdding: setAddingLane,
    setAddingPoint,
    startAssistant: () => p.onStartAssistant(),
    toggleDim: () => setDim((current) => !current),
    copyMap: () => {
      const text = boardAsText(board);
      const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
      if (!clipboard?.writeText) {
        setCopyText(text);
        return;
      }
      clipboard.writeText(text).then(
        () => client.notify(BOARD_TEXT.toast.copied),
        () => setCopyText(text),
      );
    },
  };

  return (
    <>
      <TodayContent board={board} dim={dim} addingPoint={addingPoint} focusProcessId={focusProcessId} headAction={p.headAction} actions={actions} />
      <StepDrawer
        board={board}
        open={drawer.open}
        target={drawer.target}
        editable={editable}
        addingLane={addingLane}
        actions={actions}
        onCreated={(stepId) => setDrawer({ open: true, target: { kind: "step", stepId, created: true } })}
        finalFocus={() => {
          const planned = afterRemoval.current;
          afterRemoval.current = null;
          const view = document.querySelector<HTMLElement>('[data-b="view-oggi"]');
          return drawerReturnFocus({ view, planned, opener: opener.current, stepId: drawer.target?.kind === "step" ? drawer.target.stepId : null });
        }}
      />
      <CopyDrawer text={copyText} onClose={() => setCopyText(null)} />
    </>
  );
}
