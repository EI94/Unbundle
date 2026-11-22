"use client";

/**
 * «Mappatura board»: la vista «Oggi» (prima «Processi di oggi»), S2 (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3; P7,
 * P11–P21, P34, P35, P37, P38, P53–P62; BOARD-SPEC §2.2; rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7).
 *
 * Dall'alto: la testa (la scoperta in una frase, quando c'è; la descrizione dell'unità; a destra l'unico bottone pieno,
 * lo slot `headAction` del compagno); un riquadro solo con i numeri («25 passi», le ore e le decisioni di una persona);
 * i punti di analisi, ognuno una nota che si scrive sul posto («+ punto»); «Chi fa cosa e con quali strumenti», chiuso;
 * «I processi, uno per uno»: i chip che filtrano («7 attriti», «5 da validare», solo se non sono a zero), la legenda
 * dietro il «?», la mappa. Un clic su un passo apre il suo drawer, con il suo indirizzo (`?apri=<passo>`): «Indietro»
 * lo chiude e il passo ha un link. Un'unità senza processi mostra «Nessun passo, per ora» con «Inizia con
 * l'assistente» (pieno) e «Aggiungi un passo». Una board in sola lettura disegna i suoi controlli spenti, o non li
 * disegna, dal primo disegno (F9). «Copia la mappa come testo» sta nel «⋯» della testata.
 *
 * `TodayContent` non ha stato (lo provano i test con Node, chiamando i suoi controlli); `TodayView` tiene il drawer, il
 * chip acceso, la legenda, la nota o il punto che si sta scrivendo, e legge la board dallo store.
 */
import { useEffect, useRef, useState, type JSX, type ReactNode } from "react";
import { locateStep, rolesTable, toolsTable, type BoardNote, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { BOARD_TEXT, noteCaption } from "../../../lib/mappatura/text.ts";
import { MAPPING_LIMITS, type StepLane } from "../../../lib/mappatura/vocab.ts";
import type { OpInput } from "../store/board-client.ts";
import { useBoard, useBoardClient } from "../store/use-board.tsx";
import { useSheetParam } from "../../ui-10/side-sheet.tsx";
import { sheetIdParam } from "../../context/view-model.ts";
import { AddButton, BoardButton, Dot, FilterChip, Kpis, Legend, LegendItem, RemoveIcon, Section, StackTable, Tag } from "../ui/atoms.tsx";
import { Drawer } from "../ui/drawer.tsx";
import { EmptyBlock, noteToggleLabel } from "../ui/edit.tsx";
import { focusBeforeRemoving, type FocusNode } from "../ui/focus.ts";
import { Block, ViewHead } from "../ui/frame.tsx";
import { DraftPoint, LineInPlace, TextWithMore } from "./in-place.tsx";
import { ProcessMapEditor, type MapActions } from "./process-map.tsx";
import { StepDrawer, type DrawerTarget, type StepActions } from "./step-drawer.tsx";
import { VIEW_TEXT, rolesToolsHint, stepRefText } from "./text.ts";
import { useArrivalStep } from "./arrival.tsx";
import {
  analysisShown,
  boardEditable,
  boardEmpty,
  drawerReturnFocus,
  focusAfterRemoval,
  headlineOp,
  laneFull,
  mapFilterChips,
  newProcessOp,
  noteTextOps,
  noteTitleOp,
  noteToggleOp,
  pointAddOp,
  stepCodes,
  todaySummary,
  type MapFilter,
  type MapFocus,
} from "./view-model.ts";

/** Il passo aperto (`?apri=<passo>`): un id che sembra un uuid. Una funzione del modulo. */
const acceptStep = (raw: string | null) => sheetIdParam(raw);
/** Che cosa mostra il drawer, in una parola: per tenere l'ultimo mentre si chiude. */
const targetKey = (target: DrawerTarget | null): string => (!target ? "" : target.kind === "step" ? `passo:${target.stepId}:${target.created === true}` : `nuovo:${target.processId ?? ""}`);

const L = MAPPING_LIMITS;

/** Quello che la vista chiede a chi la monta. */
export interface TodayActions extends MapActions {
  addStep(processId: string | null): void;
  startAssistant(): void;
  /** Accende un chip della mappa (null: nessuno). */
  setFilter(filter: MapFilter | null): void;
  /** Apre e chiude la legenda dietro il «?». */
  toggleLegend(): void;
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
  /** Il chip acceso: «N attriti» o «N da validare». */
  filter: MapFilter | null;
  /** La legenda dietro il «?» è aperta. */
  legend: boolean;
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
  // (Rilascio 10, §3.7) Niente occhiello né «Come lavora oggi {unità}»: la scheda e il titolo della board lo dicono già.
  // Resta la scoperta in una frase, quando c'è.
  const title = board.headline ? (
    editable ? (
      <LineInPlace value={board.headline} label={VIEW_TEXT.today.headlineLabel} placeholder={VIEW_TEXT.today.headlinePlaceholder} maxLength={L.headline} onCommit={(next, base) => run(headlineOp(next, base))} />
    ) : (
      board.headline
    )
  ) : null;
  const head = <ViewHead title={title} lede={board.unit.description} action={empty ? undefined : p.headAction} />;
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
  const chips = mapFilterChips(board);
  const legendId = "b-legenda-oggi";

  return (
    <>
      {head}
      {notice}
      <Kpis items={[todaySummary(board)]} single />

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

      <Block title={VIEW_TEXT.map.title}>
        {/* Il toast non copre mai gli strumenti della mappa (i chip): ci sale sopra (data-toast-avoid). */}
        <div className="b-ctrl b-map-tools" data-b="map-tools" data-toast-avoid="">
          {chips.length > 0 ? (
            <span className="b-map-chips" role="group" aria-label={VIEW_TEXT.map.chipsLabel}>
              {chips.map((chip) => (
                <FilterChip key={chip.filter} pressed={p.filter === chip.filter} onToggle={() => actions.setFilter(p.filter === chip.filter ? null : chip.filter)} dot={chip.filter === "attriti" ? <Dot tone="crit" /> : undefined}>
                  {chip.label}
                </FilterChip>
              ))}
            </span>
          ) : null}
          <span className="b-spacer" />
          <button type="button" className="b-iconbtn b-legend-btn" aria-label={VIEW_TEXT.map.legendButton} title={VIEW_TEXT.map.legendButton} aria-expanded={p.legend} aria-controls={legendId} onClick={() => actions.toggleLegend()} data-b="legend-toggle">
            ?
          </button>
        </div>
        <div id={legendId} hidden={!p.legend}>
          <Legend>
            <LegendItem dot={<Dot tone="crit" />}>{VIEW_TEXT.legend.strong}</LegendItem>
            <LegendItem dot={<Dot tone="amber" />}>{VIEW_TEXT.legend.medium}</LegendItem>
            <LegendItem dot={<Dot tone="neutral" />}>{VIEW_TEXT.legend.light}</LegendItem>
            <LegendItem dot={<Dot tone="amber" diamond />}>{VIEW_TEXT.legend.decides}</LegendItem>
            <span className="b-legend-note">
              <Tag tone="line">{BOARD_TEXT.card.toValidate}</Tag>
            </span>
          </Legend>
        </div>
        <ProcessMapEditor board={board} editable={editable} filter={p.filter} focusProcessId={p.focusProcessId} actions={actions} />
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

/**
 * La vista con il suo stato. `onStartAssistant`: «Inizia con l'assistente» apre il pannello, con il cursore nel suo campo.
 * (Rilascio 10, §8.2) Il drawer di un passo ha un indirizzo, `?apri=<passo>` (`useSheetParam`): aprirlo aggiunge un passo
 * alla cronologia, «Indietro» lo chiude, il link lo riapre. Un passo nuovo nasce in un drawer senza indirizzo; appena ha
 * il titolo, il drawer prende quello del passo.
 */
export function TodayView(p: { headAction: ReactNode; onStartAssistant(): void }): JSX.Element {
  const board = useBoard((state) => state.board);
  const client = useBoardClient();
  const editable = boardEditable(board);
  const [filter, setFilter] = useState<MapFilter | null>(null);
  const [legend, setLegend] = useState(false);
  const [openStep, showStep] = useSheetParam({ initial: useArrivalStep(), accept: acceptStep });
  const [draft, setDraft] = useState<{ processId: string | null } | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [addingLane, setAddingLane] = useState<StepLane | null>(null);
  const [addingPoint, setAddingPoint] = useState(false);
  const [focusProcessId, setFocusProcessId] = useState<string | null>(null);
  // Chi ha aperto il drawer (la card, «+ passo», «Aggiungi un passo») e il posto deciso dopo «Elimina il passo»: alla
  // chiusura il fuoco non cade sulla pagina se chi l'ha aperto non c'è più (F1).
  const opener = useRef<Element | null>(null);
  const afterRemoval = useRef<MapFocus | null>(null);

  const target: DrawerTarget | null = draft ? { kind: "draft", processId: draft.processId } : openStep ? { kind: "step", stepId: openStep, created: created === openStep } : null;
  // Mentre il drawer si chiude (0,26 s) resta l'ultimo passo, come il riferimento.
  const [last, setLast] = useState<DrawerTarget | null>(target);
  if (target && targetKey(target) !== targetKey(last)) setLast(target);

  // Un indirizzo con un passo che non c'è (eliminato, o di un'altra unità): il drawer resta chiuso e l'indirizzo torna pulito.
  const missing = openStep !== null && locateStep(board, openStep) === null;
  useEffect(() => {
    if (missing) showStep(null);
  }, [missing, showStep]);

  const remember = () => {
    opener.current = typeof document === "undefined" ? null : document.activeElement;
    afterRemoval.current = null;
    setAddingLane(null);
  };
  const close = () => {
    setAddingLane(null);
    setCreated(null);
    if (draft) setDraft(null);
    else showStep(null);
  };
  const actions: TodayActions & StepActions = {
    dispatch: (ops, options) => client.dispatch(ops, options),
    notify: (text) => client.notify(text),
    newId: () => client.newId(),
    openStep: (stepId) => {
      if (!draft && !openStep) remember();
      setDraft(null);
      showStep(stepId);
    },
    addStep: (processId) => {
      remember();
      setDraft({ processId });
    },
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
    setFilter,
    toggleLegend: () => setLegend((current) => !current),
  };

  return (
    <>
      <TodayContent board={board} filter={filter} legend={legend} addingPoint={addingPoint} focusProcessId={focusProcessId} headAction={p.headAction} actions={actions} />
      <StepDrawer
        board={board}
        open={target !== null && !missing}
        target={target ?? last}
        editable={editable}
        addingLane={addingLane}
        actions={actions}
        onCreated={(stepId) => {
          setCreated(stepId);
          setDraft(null);
          showStep(stepId);
        }}
        finalFocus={() => {
          const planned = afterRemoval.current;
          afterRemoval.current = null;
          const view = document.querySelector<HTMLElement>('[data-b="view-oggi"]');
          const shown = last;
          return drawerReturnFocus({ view, planned, opener: opener.current, stepId: shown?.kind === "step" ? shown.stepId : null });
        }}
      />
    </>
  );
}
