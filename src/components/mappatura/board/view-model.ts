/**
 * «Mappatura board»: quello che le viste della board calcolano e le operazioni che i loro controlli mandano
 * (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.2, §1.3, §4.3, P38, P52–P58, P65).
 *
 * Riquadri, conteggi e righe nascono dal modello di lettura (`board-model.ts`): una modifica li cambia tutti insieme.
 * Ogni controllo delle viste chiama una funzione di qui per sapere quale operazione mandare allo store (`dispatch`):
 * il valore che la persona ha visto (`prev`) e quello nuovo (`next`), mai una modifica che non cambia niente. Così le
 * regole stanno in un posto solo, e un test con Node le prova tutte senza un browser.
 *
 * Modulo puro.
 */
import {
  boardNumbers,
  locateStep,
  processLetter,
  shownUnitStatus,
  stepCode,
  stepFrictions,
  uncheckedNoteStatus,
  unitNumbers,
  type BoardNote,
  type BoardProcess,
  type BoardStep,
  type MappingBoard,
  type UnitBoardSummary,
} from "../../../lib/mappatura/board-model.ts";
import { cutLine, stepFieldValue, type StepField, type StepValue } from "../../../lib/mappatura/board-ops.ts";
import { BOARD_TEXT, counted, formatCount, formatHours } from "../../../lib/mappatura/text.ts";
import { BOARD_LANE, MAPPING_LIMITS, STREAMS, type Friction, type StepLane, type Stream, type UnitStatus } from "../../../lib/mappatura/vocab.ts";
import type { OpInput } from "../store/board-client.ts";
import { mapCountsLine, todayTileTexts, toClassifyText, toValidateText, unitStepsLine, type UnitWords, unitsTileTexts } from "./text.ts";

const L = MAPPING_LIMITS;

// ─── Che cosa si vede ────────────────────────────────────────────────

/** Si può modificare: chi guarda è un collaboratore, la 0039 c'è e nessun salvataggio è stato rifiutato (lo store spegne `can`). */
export const boardEditable = (board: Pick<MappingBoard, "can" | "store">): boolean => board.can.edit && board.store === "pronto";

/** La mappatura dell'unità è completa (`mapped`, o `validated` che dice la stessa cosa). */
export const unitComplete = (status: UnitStatus): boolean => status === "mapped" || status === "validated";

/** Un'unità senza processi: il blocco «Nessun passo, per ora» al posto di riquadri e mappa. */
export const boardEmpty = (board: Pick<MappingBoard, "processes">): boolean => board.processes.length === 0;

/** I punti di analisi si vedono quando ce n'è almeno uno, o quando la mappatura è completa (§1.3). */
export const analysisShown = (board: Pick<MappingBoard, "analysis" | "unit">): boolean => board.analysis.length > 0 || unitComplete(board.unit.status);

/** I quattro riquadri di «Processi di oggi», dagli stessi numeri della legenda e delle tabelle (P37, P38). */
export function todayTiles(board: MappingBoard): Array<{ value: string; label: string }> {
  return todayTileTexts(boardNumbers(board));
}

/** La riga dei conteggi sopra la mappa (P60). */
export function mapCounts(board: MappingBoard): string {
  const n = boardNumbers(board);
  return mapCountsLine(n.toValidate, n.confirmed, n.frictions);
}

/** «Evidenzia attriti» sfuma i passi che non hanno attriti (P61). */
export const stepDimmed = (step: Pick<BoardStep, "friction" | "notes">, dim: boolean): boolean => dim && stepFrictions(step) === 0;

/** Un processo che non ha più posto per un passo (40). */
export const processFull = (process: Pick<BoardProcess, "steps">): boolean => process.steps.length >= L.stepsPerProcess;

/** Una corsia di note che non ha più posto (30), o la board che non ha più posto per un punto di analisi (6). */
export const laneFull = (notes: readonly BoardNote[], lane: StepLane | typeof BOARD_LANE): boolean => notes.length >= (lane === BOARD_LANE ? L.analysisPoints : L.notesPerLane);

/** Dove andrebbe un passo nuovo in fondo a un processo: il nome del processo e il codice («A4»). Senza processo, il primo che nascerà. */
export function newStepPlace(board: Pick<MappingBoard, "processes">, processId: string | null): { processName: string; code: string } {
  const index = processId ? board.processes.findIndex((process) => process.id === processId) : -1;
  if (index === -1) return { processName: BOARD_TEXT.defaultProcessName, code: stepCode(board.processes.length, 0) };
  const process = board.processes[index];
  return { processName: process.name, code: stepCode(index, process.steps.length) };
}

/** I processi dove un passo si può spostare con «Sposta in»: gli altri, con posto. */
export function moveTargets(board: Pick<MappingBoard, "processes">, stepId: string): Array<{ id: string; letter: string; name: string }> {
  const place = locateStep(board, stepId);
  if (!place) return [];
  return board.processes.flatMap((process, index) => (process.id === place.process.id || processFull(process) ? [] : [{ id: process.id, letter: processLetter(index), name: process.name }]));
}

/** I codici dei passi di una board, per id: le tabelle e i collegamenti li nominano. */
export function stepCodes(board: Pick<MappingBoard, "processes">): Map<string, { code: string; title: string }> {
  const out = new Map<string, { code: string; title: string }>();
  board.processes.forEach((process, processIndex) => process.steps.forEach((step, stepIndex) => out.set(step.id, { code: stepCode(processIndex, stepIndex), title: step.title })));
  return out;
}

// ─── S1 · Le unità ───────────────────────────────────────────────────

export type UnitTone = "neutral" | "wait" | "ok";

/** Il chip dello stato: «Da iniziare» neutro, «In corso» in ambra, «Mappatura completa» verde. */
export const unitTone = (status: UnitStatus): UnitTone => (status === "not_started" ? "neutral" : status === "in_progress" ? "wait" : "ok");

export interface UnitRowModel {
  /** Lo stato mostrato: «In corso» da solo al primo passo (§0 punto 9). */
  status: UnitStatus;
  tone: UnitTone;
  steps: string;
  /** «2 da validare», «1 da classificare» (solo a mappatura completa): quello che resta da fare. */
  todo: string[];
  /** I tre stream con i loro passi, quando almeno un passo è classificato. */
  streams: Array<{ stream: Stream; count: number }> | null;
}

export function unitRow(unit: UnitBoardSummary): UnitRowModel {
  const status = shownUnitStatus(unit.status, unit.steps);
  const todo: string[] = [];
  if (unit.toValidate > 0) todo.push(toValidateText(unit.toValidate));
  if (unitComplete(status) && unit.unclassified > 0) todo.push(toClassifyText(unit.unclassified));
  const classified = STREAMS.some((stream) => unit.streams[stream] > 0);
  return {
    status,
    tone: unitTone(status),
    steps: unitStepsLine(unit.steps, unit.hoursWeek),
    todo,
    streams: classified ? STREAMS.map((stream) => ({ stream, count: unit.streams[stream] })) : null,
  };
}

/** I quattro riquadri dell'elenco delle unità, dagli stessi numeri delle righe. */
export function unitsTiles(units: readonly UnitBoardSummary[], words: UnitWords): Array<{ value: string; label: string }> {
  return unitsTileTexts(unitNumbers(units), words);
}

// ─── Le operazioni dei controlli ─────────────────────────────────────

/** Il valore di prima di un testo facoltativo: un campo vuoto è null, come lo legge il server (R3). */
const prevText = (base: string): string | null => (base.trim() === "" ? null : base);
const nextText = (text: string): string | null => (text.trim() === "" ? null : text);
const sameValue = (a: StepValue, b: StepValue) => (Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, index) => item === b[index]) : a === b);

export type StepTextField = "title" | "description" | "input" | "output" | "decision" | "decisionLabel" | "exception" | "quality";

/** Un testo di un passo lasciato dalla persona: `base` è quello che c'era quando è entrata nel campo. Il titolo non si svuota. */
export function stepTextOp(step: Pick<BoardStep, "id">, field: StepTextField, next: string, base: string): OpInput | null {
  const value = nextText(next);
  if (field === "title" && value === null) return null;
  const prev = prevText(base);
  if (prev === value) return null;
  return { t: "step.set", stepId: step.id, field, prev, next: value };
}

/** Un campo di un passo scelto con un controllo (ruoli, strumenti, frequenza, tipo di lavoro, ore): il `prev` è il valore a schermo. */
export function stepValueOp(step: BoardStep, field: Extract<StepField, "who" | "tools" | "frequency" | "workType" | "hoursWeek">, next: StepValue): OpInput | null {
  const prev = stepFieldValue(step, field);
  const value = typeof next === "string" && next.trim() === "" ? null : next;
  if (sameValue(prev, value)) return null;
  return { t: "step.set", stepId: step.id, field, prev, next: value };
}

/** Le ore a settimana lasciate in un campo numerico: `base` è il numero che c'era quando la persona ci è entrata. */
export function hoursOp(step: Pick<BoardStep, "id">, next: number | null, base: number | null): OpInput | null {
  if (next === base) return null;
  return { t: "step.set", stepId: step.id, field: "hoursWeek", prev: base, next };
}

/**
 * Il livello di attrito premuto (P67). Un livello mostrato ma non scelto (2 perché c'è un attrito scritto) si può
 * confermare con lo stesso bottone: diventa una scelta.
 */
export function frictionOp(step: Pick<BoardStep, "id" | "friction" | "frictionSet">, level: Friction): OpInput | null {
  if (step.frictionSet && step.friction === level) return null;
  return { t: "step.set", stepId: step.id, field: "friction", prev: step.frictionSet ? step.friction : null, next: level };
}

/** «Conferma il passo» e «Segna da validare». */
export function statusOp(step: Pick<BoardStep, "id" | "status">): OpInput {
  return { t: "step.set", stepId: step.id, field: "status", prev: step.status, next: step.status === "da_validare" ? "confermato" : "da_validare" };
}

/**
 * «Sposta a sinistra», «Sposta a destra» e «Sposta in» del drawer (P58, F6): null quando il passo è già in fondo da
 * quella parte, quando il processo scelto è il suo o non ha più posto.
 */
export function stepMoveOp(board: Pick<MappingBoard, "processes">, stepId: string, target: "left" | "right" | { processId: string }): OpInput | null {
  const place = locateStep(board, stepId);
  if (!place) return null;
  const steps = place.process.steps;
  const at = place.stepIndex;
  if (target === "left") return at > 0 ? { t: "step.move", stepId, processId: place.process.id, beforeId: steps[at - 1].id } : null;
  if (target === "right") return at < steps.length - 1 ? { t: "step.move", stepId, processId: place.process.id, beforeId: steps[at + 2]?.id ?? null } : null;
  const to = board.processes.find((process) => process.id === target.processId);
  if (!to || to.id === place.process.id || processFull(to)) return null;
  return { t: "step.move", stepId, processId: to.id, beforeId: null };
}

/** Dove cade un passo trascinato (P58): prima della prima card la cui metà sta a destra del puntatore, o in fondo. La card trascinata non conta. */
export function dropBeforeId(cards: ReadonlyArray<{ id: string; left: number; width: number }>, x: number, draggedId: string): string | null {
  for (const card of cards) {
    if (card.id === draggedId) continue;
    if (x < card.left + card.width / 2) return card.id;
  }
  return null;
}

/** Il passo lasciato in una riga: null se resta dov'era, o se la riga è un altro processo senza posto. */
export function dropMoveOp(board: Pick<MappingBoard, "processes">, stepId: string, processId: string, beforeId: string | null): OpInput | null {
  const place = locateStep(board, stepId);
  const to = board.processes.find((process) => process.id === processId);
  // «Prima di sé stesso» lascia tutto dov'è, come nel riduttore e sul server.
  if (!place || !to || beforeId === stepId) return null;
  if (to.id === place.process.id) {
    const rest = place.process.steps.filter((step) => step.id !== stepId).map((step) => step.id);
    const at = beforeId === null ? rest.length : rest.indexOf(beforeId);
    if (at === -1 || at === place.stepIndex) return null;
  } else if (processFull(to)) {
    return null;
  }
  return { t: "step.move", stepId, processId: to.id, beforeId };
}

/** «Sposta su» e «Sposta giù» di un processo. */
export function processMoveOp(board: Pick<MappingBoard, "processes">, processId: string, direction: "up" | "down"): OpInput | null {
  const at = board.processes.findIndex((process) => process.id === processId);
  if (at === -1) return null;
  if (direction === "up") return at > 0 ? { t: "process.move", processId, beforeId: board.processes[at - 1].id } : null;
  return at < board.processes.length - 1 ? { t: "process.move", processId, beforeId: board.processes[at + 2]?.id ?? null } : null;
}

/** Il nome di un processo lasciato dalla persona: non si svuota. */
export function processNameOp(process: Pick<BoardProcess, "id">, next: string, base: string): OpInput | null {
  if (next.trim() === "" || next === base) return null;
  return { t: "process.set", processId: process.id, field: "name", prev: base, next };
}

/** Chi segue un processo: vuoto lo toglie. */
export function processOwnerOp(process: Pick<BoardProcess, "id">, next: string, base: string): OpInput | null {
  const prev = prevText(base);
  const value = nextText(next);
  if (prev === value) return null;
  return { t: "process.set", processId: process.id, field: "owner", prev, next: value };
}

/** I miei voti su un processo (P65): un valore assoluto, mai sotto zero. */
export function voteOp(process: Pick<BoardProcess, "id" | "myVotes">, mine: number): OpInput | null {
  const value = Math.min(L.votes, Math.max(0, Math.floor(mine)));
  return value === process.myVotes ? null : { t: "process.vote", processId: process.id, mine: value };
}

/** «+ processo»: un processo nuovo in fondo, con il nome che dà il server ai processi nuovi. */
export function newProcessOp(processId: string): OpInput {
  return { t: "process.add", processId, name: BOARD_TEXT.newProcessName };
}

/**
 * Il titolo di un passo nuovo, scritto nel drawer (P53, P55): senza titolo non nasce niente. Senza processo (un'unità
 * vuota) nasce anche il primo processo, nello stesso salvataggio.
 */
export function newStepOps(processId: string | null, title: string, newId: () => string): { stepId: string; processId: string; ops: OpInput[] } | null {
  const clean = cutLine(title, L.title);
  if (!clean) return null;
  const ops: OpInput[] = [];
  const place = processId ?? newId();
  if (!processId) ops.push({ t: "process.add", processId: place, name: BOARD_TEXT.defaultProcessName });
  const stepId = newId();
  ops.push({ t: "step.add", stepId, processId: place, title: clean });
  return { stepId, processId: place, ops };
}

/** Una nota nuova in una corsia di un passo, scritta sulla board (nasce validata, P54). Vuota non nasce. */
export function noteAddOp(stepId: string, lane: StepLane, text: string, newId: () => string): OpInput | null {
  if (text.trim() === "") return null;
  return { t: "note.add", noteId: newId(), stepId, lane, text };
}

/** Un punto di analisi nuovo: senza testo non nasce. */
export function pointAddOp(title: string, text: string, newId: () => string): OpInput | null {
  if (text.trim() === "") return null;
  return { t: "note.add", noteId: newId(), stepId: null, lane: BOARD_LANE, text, title: nextText(title) };
}

/** Il testo di una nota lasciato dalla persona (P52): vuoto, la nota sparisce (P55). */
export function noteTextOps(note: Pick<BoardNote, "id">, next: string, base: string): OpInput[] {
  if (next.trim() === "") return [{ t: "note.remove", noteId: note.id }];
  if (next === base) return [];
  return [{ t: "note.set", noteId: note.id, field: "text", prev: base, next }];
}

/** Il titolo di un punto di analisi: vuoto lo toglie (il punto resta). */
export function noteTitleOp(note: Pick<BoardNote, "id">, next: string, base: string): OpInput | null {
  const prev = prevText(base);
  const value = nextText(next);
  return prev === value ? null : { t: "note.set", noteId: note.id, field: "title", prev, next: value };
}

/** La spunta di una nota (P56): validata, oppure di nuovo «ipotesi» o «da fonti» secondo da dove viene. */
export function noteToggleOp(note: Pick<BoardNote, "id" | "status" | "origin">): OpInput {
  return { t: "note.set", noteId: note.id, field: "status", prev: note.status, next: note.status === "validato" ? uncheckedNoteStatus(note.origin) : "validato" };
}

/** La scoperta in una frase (il titolo della vista): vuota torna il titolo di sempre. */
export function headlineOp(next: string, base: string): OpInput | null {
  const prev = prevText(base);
  const value = nextText(next);
  return prev === value ? null : { t: "board.set", field: "headline", prev, next: value };
}

// ─── Dove va il fuoco quando un controllo sparisce (F1) ──────────────

/** Un posto della mappa che prende il fuoco: la card di un passo, o «+ passo» in fondo a una riga. */
export type MapFocus = { kind: "step"; stepId: string } | { kind: "add"; processId: string };

/**
 * Dopo «Elimina il passo» il drawer si chiude, e la card che l'aveva aperto non c'è più: il fuoco va alla card prima
 * nella riga, o a quella dopo, o a «+ passo» della riga rimasta vuota. null se il passo non c'è.
 */
export function focusAfterRemoval(board: Pick<MappingBoard, "processes">, stepId: string): MapFocus | null {
  const place = locateStep(board, stepId);
  if (!place) return null;
  const near = place.process.steps[place.stepIndex - 1] ?? place.process.steps[place.stepIndex + 1];
  return near ? { kind: "step", stepId: near.id } : { kind: "add", processId: place.process.id };
}

/** Il selettore del posto, nella vista: la card porta `data-step-id`, «+ passo» `data-add-step`. */
export const mapFocusSelector = (target: MapFocus): string =>
  target.kind === "step" ? `[data-b="step"][data-step-id="${target.stepId}"]` : `[data-add-step="${target.processId}"]`;

/**
 * Dove va il fuoco quando il drawer di un passo si chiude: il posto deciso prima (`planned`, dopo «Elimina il passo»);
 * altrimenti chi l'ha aperto, se c'è ancora (null: il dialogo lo rimette lui); se non c'è più (il blocco dell'unità vuota
 * con «Aggiungi un passo», sparito quando il primo passo è nato) la card del passo del drawer, o la vista. Mai la pagina.
 */
export function drawerReturnFocus<E>(p: {
  view: (E & { querySelector(selector: string): unknown }) | null;
  planned: MapFocus | null;
  opener: { isConnected: boolean } | null;
  stepId: string | null;
}): E | null {
  const find = (target: MapFocus) => (p.view?.querySelector(mapFocusSelector(target)) as E | null | undefined) ?? null;
  if (p.planned) return find(p.planned) ?? p.view;
  if (p.opener?.isConnected) return null;
  return (p.stepId ? find({ kind: "step", stepId: p.stepId }) : null) ?? p.view;
}

// ─── (Rilascio 10, §3.7) La vista «Processi» di «Contesto» ───────────

/** Il prossimo passo della vista: l'unità in corso, poi la prima da iniziare; tutte complete (o nessuna): un'unità nuova. */
export type ProcessesStep = { kind: "continue" | "start"; unit: UnitBoardSummary } | { kind: "add" };

export function processesStep(units: readonly UnitBoardSummary[]): ProcessesStep {
  const shown = units.map((unit) => ({ unit, status: shownUnitStatus(unit.status, unit.steps) }));
  const going = shown.find((item) => item.status === "in_progress");
  if (going) return { kind: "continue", unit: going.unit };
  const fresh = shown.find((item) => item.status === "not_started");
  if (fresh) return { kind: "start", unit: fresh.unit };
  return { kind: "add" };
}

/** Il numero grande: «2 di 6» unità mappate; null senza unità (lo zero non si mostra). */
export function processesNumber(units: readonly UnitBoardSummary[]): string | null {
  if (units.length === 0) return null;
  const n = unitNumbers(units);
  return `${formatCount(n.complete)} di ${formatCount(n.total)}`;
}

/** Il tono del puntino dello stato di un'unità, nel semaforo dell'app: da iniziare grigio, in corso blu, completa verde. */
export const unitDotTone = (status: UnitStatus): "grigio" | "blu" | "verde" => (status === "not_started" ? "grigio" : status === "in_progress" ? "blu" : "verde");

/** Il fatto grigio della riga di un'unità: «25 passi · 40 h a settimana · 5 da validare»; niente a zero. */
export function unitFactLine(unit: UnitBoardSummary): string | null {
  const row = unitRow(unit);
  const parts = [unit.steps > 0 ? counted(unit.steps, "passo", "passi") : null, unit.hoursWeek > 0 ? `${formatHours(unit.hoursWeek)} h a settimana` : null, ...row.todo].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(" · ") : null;
}
