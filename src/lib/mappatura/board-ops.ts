/**
 * «Mappatura board»: le operazioni (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.3).
 *
 * Una modifica alla board è una piccola operazione, non un file intero: mentre una persona scrive, l'assistente e i
 * colleghi salvano sulla stessa unità, e rifiutare tutta la board butterebbe via lavoro buono. Un'operazione che cambia
 * un campo porta il valore che la persona ha visto (`prev`) e quello nuovo (`next`): il server la applica solo se nel
 * frattempo nessuno ha cambiato quel campo (`board-sql.ts`, regola R3).
 *
 * Qui stanno:
 * - i tipi delle operazioni e lo schema zod che le controlla e le rifinisce (testi senza spazi ai bordi, limiti di
 *   `MAPPING_LIMITS`, liste senza doppioni): lo usano il server prima di ogni SQL e il browser prima di applicarle;
 * - `applyOps`, il riduttore che il browser usa per mostrare subito la modifica (e i test per dire che cosa deve
 *   uscire dal database);
 * - `coalesce`, che unisce le modifiche dello stesso campo prima di un salvataggio;
 * - `opsForNewStep` e `opsForStepPatch`, che traducono un passo raccolto dall'assistente o dai documenti nelle
 *   operazioni che lo scrivono: tagliano i testi troppo lunghi, non li rifiutano.
 *
 * Modulo puro: zod, il vocabolario e il modello. Nessun accesso al database.
 */
import { z } from "zod";
import { emptyNotes, shownFriction, shownUnitStatus, type BoardNote, type BoardProcess, type BoardStep, type MappingBoard } from "./board-model.ts";
import {
  ACTIVITY_COLUMNS,
  BOARD_LANE,
  LANES,
  MAPPING_LIMITS,
  NOTE_STATUSES,
  STEP_STATUSES,
  STREAMS,
  WORK_TYPES,
  isStepLane,
  type Friction,
  type Lane,
  type NoteStatus,
  type Origin,
  type StepLane,
  type StepStatus,
  type Stream,
  type WorkType,
} from "./vocab.ts";

// ─── Tipi ────────────────────────────────────────────────────────────

/** Chi scrive: una persona sulla board, l'assistente dalla chat, i passi confermati dai documenti. */
export type ActorKind = "persona" | "assistente" | "documenti";

type TextValue = string | null;

export type StepField =
  // colonne di activities
  | "title"
  | "description"
  | "tools"
  | "input"
  | "output"
  | "decision"
  | "frequency"
  | "hoursWeek"
  | "quality"
  | "workType"
  // colonne di mapping_steps
  | "who"
  | "decisionLabel"
  | "exception"
  | "friction"
  | "status";

export type StepValue = string | number | string[] | null;

export type BoardOp = { id: string } & (
  | { t: "process.add"; processId: string; name: string; beforeId?: string | null }
  | { t: "process.set"; processId: string; field: "name" | "owner"; prev: TextValue; next: TextValue }
  | { t: "process.move"; processId: string; beforeId: string | null }
  /** Solo senza passi. */
  | { t: "process.remove"; processId: string }
  /** I miei voti, valore assoluto 0–99. */
  | { t: "process.vote"; processId: string; mine: number }
  /** `afterId`: subito dopo quel passo (serve all'assistente, che conosce il passo di prima e non quello dopo). */
  | { t: "step.add"; stepId: string; processId: string; beforeId?: string | null; afterId?: string | null; title: string }
  | { t: "step.set"; stepId: string; field: StepField; prev: StepValue; next: StepValue }
  | { t: "step.move"; stepId: string; processId: string; beforeId: string | null }
  | { t: "step.remove"; stepId: string }
  /** Solo i revisori. */
  | { t: "step.stream"; stepId: string; prev: Stream | null; next: Stream | null }
  /** Solo i revisori. */
  | { t: "streams.reset" }
  | { t: "note.add"; noteId: string; stepId: string | null; lane: Lane; text: string; title?: TextValue; beforeId?: string | null }
  | { t: "note.set"; noteId: string; field: "text" | "title" | "status"; prev: TextValue; next: TextValue }
  | { t: "note.remove"; noteId: string }
  | { t: "board.set"; field: "headline"; prev: TextValue; next: TextValue }
);

export type BoardOpType = BoardOp["t"];

/** Le operazioni che solo un revisore può fare. */
export const REVIEWER_ONLY_OPS: readonly BoardOpType[] = ["step.stream", "streams.reset"];

// ─── Rifinitura dei testi ────────────────────────────────────────────

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Quanto può essere lungo un testo prima di essere rifinito, e un valore `prev` (che si confronta e basta). */
const RAW_MAX = 20_000;
const L = MAPPING_LIMITS;

/** Una riga: spazi e a capo diventano uno spazio, niente spazi ai bordi. */
export const oneLine = (text: string): string => text.replace(/\s+/g, " ").trim();
/** Un testo su più righe: a capo normali, niente spazi a fine riga né ai bordi, al più una riga vuota di seguito. */
export const prose = (text: string): string =>
  text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

/** Taglia a `max` caratteri senza lasciare uno spazio in fondo. */
const cut = (text: string, max: number): string => (text.length > max ? text.slice(0, max).trimEnd() : text);
/** Una riga rifinita e tagliata; null se resta vuota. */
export function cutLine(text: string | null | undefined, max: number): string | null {
  const out = typeof text === "string" ? cut(oneLine(text), max) : "";
  return out === "" ? null : out;
}
/** Un testo su più righe rifinito e tagliato; null se resta vuoto. */
export function cutProse(text: string | null | undefined, max: number): string | null {
  const out = typeof text === "string" ? cut(prose(text), max) : "";
  return out === "" ? null : out;
}
/** Una lista di righe rifinite: senza vuoti, senza doppioni (a meno di maiuscole), tagliata a `maxItems` voci di `maxLength`. */
export function cutList(items: readonly string[] | null | undefined, maxItems: number, maxLength: number): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    const text = cutLine(item, maxLength);
    if (!text) continue;
    const key = text.toLocaleLowerCase("it");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= maxItems) break;
  }
  return out;
}

// ─── Schema ──────────────────────────────────────────────────────────

const uuid = z
  .string()
  .regex(UUID)
  .transform((value) => value.toLowerCase());
const uuidOrNull = uuid.nullable();
const raw = z.string().max(RAW_MAX);

/** Una riga che non può restare vuota. */
const line = (max: number) => raw.transform(oneLine).pipe(z.string().min(1).max(max));
/** Una riga facoltativa: vuota diventa null. */
const lineOrNull = (max: number) =>
  raw
    .nullable()
    .transform((value) => (value === null ? null : oneLine(value) || null))
    .pipe(z.string().max(max).nullable());
/** Un testo su più righe che non può restare vuoto. */
const text = (max: number) => raw.transform(prose).pipe(z.string().min(1).max(max));
/** Un testo su più righe facoltativo: vuoto diventa null. */
const textOrNull = (max: number) =>
  raw
    .nullable()
    .transform((value) => (value === null ? null : prose(value) || null))
    .pipe(z.string().max(max).nullable());
/** Una lista di righe: rifinite, senza vuoti e senza doppioni; troppe voci o una voce troppo lunga si rifiutano. */
const list = (maxItems: number, maxLength: number) =>
  z
    .array(raw)
    .max(200)
    .transform((items) => cutList(items, Number.MAX_SAFE_INTEGER, RAW_MAX))
    .pipe(z.array(z.string().max(maxLength)).max(maxItems));

/** Quello che la persona ha visto: si confronta e basta, quindi basta che sia del tipo giusto. */
const prevText = raw.nullable();
const prevList = z.array(raw).max(200);
const prevNumber = z.number().min(-1e9).max(1e9).nullable();
const prevWord = z.string().max(60).nullable();

const friction = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const hours = z
  .number()
  .min(0)
  .max(L.hoursWeek)
  .transform((value) => Math.round(value * 100) / 100);

const opId = { id: uuid };

function stepSet<F extends StepField, P extends z.ZodType, N extends z.ZodType>(field: F, prev: P, next: N) {
  return z.strictObject({ ...opId, t: z.literal("step.set"), stepId: uuid, field: z.literal(field), prev, next });
}

const stepSetSchema = z.discriminatedUnion("field", [
  stepSet("title", prevText, line(L.title)),
  stepSet("description", prevText, textOrNull(L.description)),
  stepSet("tools", prevList, list(L.tools, L.toolItem)),
  stepSet("input", prevText, textOrNull(L.io)),
  stepSet("output", prevText, textOrNull(L.io)),
  stepSet("decision", prevText, textOrNull(L.decision)),
  stepSet("frequency", prevText, lineOrNull(ACTIVITY_COLUMNS.frequency)),
  stepSet("hoursWeek", prevNumber, hours.nullable()),
  stepSet("quality", prevText, lineOrNull(ACTIVITY_COLUMNS.quality)),
  stepSet("workType", prevWord, z.enum(WORK_TYPES).nullable()),
  stepSet("who", prevList, list(L.who, L.whoItem)),
  stepSet("decisionLabel", prevText, lineOrNull(L.decisionLabel)),
  stepSet("exception", prevText, textOrNull(L.exception)),
  stepSet("friction", friction.nullable(), friction.nullable()),
  stepSet("status", prevWord, z.enum(STEP_STATUSES)),
]);

const processSetSchema = z.discriminatedUnion("field", [
  z.strictObject({ ...opId, t: z.literal("process.set"), processId: uuid, field: z.literal("name"), prev: prevText, next: line(L.processName) }),
  z.strictObject({ ...opId, t: z.literal("process.set"), processId: uuid, field: z.literal("owner"), prev: prevText, next: lineOrNull(L.owner) }),
]);

const noteSetSchema = z.discriminatedUnion("field", [
  z.strictObject({ ...opId, t: z.literal("note.set"), noteId: uuid, field: z.literal("text"), prev: prevText, next: text(L.note) }),
  z.strictObject({ ...opId, t: z.literal("note.set"), noteId: uuid, field: z.literal("title"), prev: prevText, next: lineOrNull(L.noteTitle) }),
  z.strictObject({ ...opId, t: z.literal("note.set"), noteId: uuid, field: z.literal("status"), prev: prevWord, next: z.enum(NOTE_STATUSES) }),
]);

/** Una nota di un passo (corsia di un passo, senza titolo) o un punto di analisi della board (senza passo). */
const noteAddSchema = z
  .strictObject({
    ...opId,
    t: z.literal("note.add"),
    noteId: uuid,
    stepId: uuidOrNull,
    lane: z.enum(LANES),
    text: text(L.note),
    title: lineOrNull(L.noteTitle).optional(),
    beforeId: uuidOrNull.optional(),
  })
  .refine((op) => (op.lane === BOARD_LANE) === (op.stepId === null), { path: ["lane"], message: "corsia" })
  .refine((op) => op.lane === BOARD_LANE || op.title === undefined || op.title === null, { path: ["title"], message: "titolo" });

const boardOps = z.discriminatedUnion("t", [
  z.strictObject({ ...opId, t: z.literal("process.add"), processId: uuid, name: line(L.processName), beforeId: uuidOrNull.optional() }),
  processSetSchema,
  z.strictObject({ ...opId, t: z.literal("process.move"), processId: uuid, beforeId: uuidOrNull }),
  z.strictObject({ ...opId, t: z.literal("process.remove"), processId: uuid }),
  z.strictObject({ ...opId, t: z.literal("process.vote"), processId: uuid, mine: z.number().int().min(0).max(L.votes) }),
  z
    .strictObject({ ...opId, t: z.literal("step.add"), stepId: uuid, processId: uuid, beforeId: uuidOrNull.optional(), afterId: uuidOrNull.optional(), title: line(L.title) })
    .refine((op) => !(op.beforeId && op.afterId), { path: ["afterId"], message: "posto" }),
  stepSetSchema,
  z.strictObject({ ...opId, t: z.literal("step.move"), stepId: uuid, processId: uuid, beforeId: uuidOrNull }),
  z.strictObject({ ...opId, t: z.literal("step.remove"), stepId: uuid }),
  z.strictObject({ ...opId, t: z.literal("step.stream"), stepId: uuid, prev: z.enum(STREAMS).nullable(), next: z.enum(STREAMS).nullable() }),
  z.strictObject({ ...opId, t: z.literal("streams.reset") }),
  noteAddSchema,
  noteSetSchema,
  z.strictObject({ ...opId, t: z.literal("note.remove"), noteId: uuid }),
  z.strictObject({ ...opId, t: z.literal("board.set"), field: z.literal("headline"), prev: prevText, next: lineOrNull(L.headline) }),
]);

/** Un'operazione: UUID, testi rifiniti, limiti di MAPPING_LIMITS, liste senza doppioni. */
export const boardOpSchema: z.ZodType<BoardOp> = boardOps;

/** Un salvataggio: la revisione da cui parte chi salva (per i log) e al più `opsPerSave` operazioni. */
export const saveInputSchema: z.ZodType<{ baseRevision: number; ops: BoardOp[] }> = z.strictObject({
  baseRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  ops: z.array(boardOps).max(L.opsPerSave),
});

// ─── Il riduttore ────────────────────────────────────────────────────

/** Come nasce quello che scrive ognuno (§4.3 «Defaults by actor»). */
export const ACTOR_DEFAULTS: Readonly<Record<ActorKind, { stepStatus: StepStatus; noteStatus: NoteStatus; origin: Origin }>> = Object.freeze({
  persona: { stepStatus: "confermato", noteStatus: "validato", origin: "board" },
  assistente: { stepStatus: "da_validare", noteStatus: "fonte", origin: "chat" },
  documenti: { stepStatus: "da_validare", noteStatus: "fonte", origin: "documenti" },
});

/** Un passo appena nato, com'è nel database dopo `step.add`: solo il titolo. */
export function newStep(id: string, title: string, actor: { kind: ActorKind }): BoardStep {
  const defaults = ACTOR_DEFAULTS[actor.kind];
  return {
    id,
    title,
    description: null,
    who: [],
    tools: [],
    input: null,
    output: null,
    decision: null,
    decisionLabel: null,
    exception: null,
    friction: 0,
    frictionSet: false,
    frequency: null,
    hoursWeek: null,
    quality: null,
    workType: null,
    status: defaults.stepStatus,
    origin: defaults.origin,
    notes: emptyNotes(),
    stream: null,
    proposedStream: null,
    confidence: null,
    reason: null,
    aiPotential: null,
    onetCode: null,
    onetTitle: null,
    aiExposure: null,
    dependsOn: [],
    neededBy: [],
    useCaseIds: [],
  };
}

/** Il valore di un campo di un passo come lo vede `step.set`: per l'attrito, null finché nessuno l'ha scelto. */
export function stepFieldValue(step: BoardStep, field: StepField): StepValue {
  switch (field) {
    case "friction":
      return step.frictionSet ? step.friction : null;
    case "tools":
      return step.tools;
    case "who":
      return step.who;
    default:
      return step[field];
  }
}

const countSteps = (board: MappingBoard) => board.processes.reduce((sum, process) => sum + process.steps.length, 0);

function insertBefore<T extends { id: string }>(items: readonly T[], item: T, beforeId: string | null | undefined): T[] {
  const at = beforeId ? items.findIndex((other) => other.id === beforeId) : -1;
  return at === -1 ? [...items, item] : [...items.slice(0, at), item, ...items.slice(at)];
}

function mapStep(board: MappingBoard, stepId: string, change: (step: BoardStep) => BoardStep): MappingBoard {
  let found = false;
  const processes = board.processes.map((process) => {
    const index = process.steps.findIndex((step) => step.id === stepId);
    if (index === -1) return process;
    found = true;
    const steps = [...process.steps];
    steps[index] = change(steps[index]);
    return { ...process, steps };
  });
  return found ? { ...board, processes } : board;
}

function mapProcess(board: MappingBoard, processId: string, change: (process: BoardProcess) => BoardProcess): MappingBoard {
  const index = board.processes.findIndex((process) => process.id === processId);
  if (index === -1) return board;
  const processes = [...board.processes];
  processes[index] = change(processes[index]);
  return { ...board, processes };
}

/** Dopo un cambio nelle note di «Attriti»: senza un livello scelto, quello mostrato segue le note. */
const withFriction = (step: BoardStep): BoardStep => (step.frictionSet ? step : { ...step, friction: shownFriction(null, step.notes.attriti.length > 0) });

function setStepField(step: BoardStep, field: StepField, next: StepValue): BoardStep {
  switch (field) {
    case "title":
      return typeof next === "string" && next ? { ...step, title: next } : step;
    case "description":
    case "input":
    case "output":
    case "decision":
    case "frequency":
    case "quality":
    case "decisionLabel":
    case "exception":
      return next === null || typeof next === "string" ? { ...step, [field]: next || null } : step;
    case "tools":
    case "who":
      return Array.isArray(next) ? { ...step, [field]: [...next] } : step;
    case "hoursWeek":
      return next === null || typeof next === "number" ? { ...step, hoursWeek: next } : step;
    case "workType":
      return next === null || (WORK_TYPES as readonly unknown[]).includes(next) ? { ...step, workType: next as WorkType | null } : step;
    case "friction":
      if (next === null) return withFriction({ ...step, frictionSet: false });
      return next === 0 || next === 1 || next === 2 || next === 3 ? { ...step, friction: next as Friction, frictionSet: true } : step;
    case "status":
      return (STEP_STATUSES as readonly unknown[]).includes(next) ? { ...step, status: next as StepStatus } : step;
  }
}

function findNote(board: MappingBoard, noteId: string): { stepId: string | null; lane: Lane } | null {
  if (board.analysis.some((note) => note.id === noteId)) return { stepId: null, lane: BOARD_LANE };
  for (const process of board.processes) {
    for (const step of process.steps) {
      for (const lane of Object.keys(step.notes) as StepLane[]) {
        if (step.notes[lane].some((note) => note.id === noteId)) return { stepId: step.id, lane };
      }
    }
  }
  return null;
}

function mapNotes(board: MappingBoard, place: { stepId: string | null; lane: Lane }, change: (notes: BoardNote[]) => BoardNote[]): MappingBoard {
  if (place.stepId === null) return { ...board, analysis: change(board.analysis) };
  const lane = place.lane;
  if (!isStepLane(lane)) return board;
  return mapStep(board, place.stepId, (step) => withFriction({ ...step, notes: { ...step.notes, [lane]: change(step.notes[lane]) } }));
}

function applyOp(board: MappingBoard, op: BoardOp, actor: { kind: ActorKind }): MappingBoard {
  switch (op.t) {
    case "process.add": {
      if (board.processes.length >= L.processes || board.processes.some((process) => process.id === op.processId)) return board;
      const process: BoardProcess = { id: op.processId, name: op.name, owner: null, votes: 0, myVotes: 0, steps: [] };
      return { ...board, processes: insertBefore(board.processes, process, op.beforeId) };
    }
    case "process.set":
      return mapProcess(board, op.processId, (process) => (op.field === "name" ? (op.next ? { ...process, name: op.next } : process) : { ...process, owner: op.next || null }));
    case "process.move": {
      const process = board.processes.find((item) => item.id === op.processId);
      // «Prima di sé stesso» lascia tutto dov'è, come sul server.
      if (!process || op.beforeId === op.processId) return board;
      return { ...board, processes: insertBefore(board.processes.filter((item) => item.id !== op.processId), process, op.beforeId) };
    }
    case "process.remove": {
      const process = board.processes.find((item) => item.id === op.processId);
      if (!process || process.steps.length > 0) return board;
      return { ...board, processes: board.processes.filter((item) => item.id !== op.processId) };
    }
    case "process.vote":
      return mapProcess(board, op.processId, (process) => ({ ...process, myVotes: op.mine, votes: Math.max(0, process.votes - process.myVotes + op.mine) }));
    case "step.add": {
      const target = board.processes.find((process) => process.id === op.processId);
      if (!target || target.steps.length >= L.stepsPerProcess || countSteps(board) >= L.stepsPerUnit) return board;
      if (board.processes.some((process) => process.steps.some((step) => step.id === op.stepId))) return board;
      const step = newStep(op.stepId, op.title, actor);
      return mapProcess(board, op.processId, (process) => {
        const after = op.afterId ? process.steps.findIndex((item) => item.id === op.afterId) : -1;
        const beforeId = after === -1 ? op.beforeId : (process.steps[after + 1]?.id ?? null);
        return { ...process, steps: insertBefore(process.steps, step, beforeId) };
      });
    }
    case "step.set":
      return mapStep(board, op.stepId, (step) => setStepField(step, op.field, op.next));
    case "step.move": {
      const from = board.processes.find((process) => process.steps.some((step) => step.id === op.stepId));
      const to = board.processes.find((process) => process.id === op.processId);
      if (!from || !to) return board;
      if (from.id !== to.id && to.steps.length >= L.stepsPerProcess) return board;
      const step = from.steps.find((item) => item.id === op.stepId)!;
      const beforeId = op.beforeId === op.stepId ? (from.id === to.id ? (from.steps[from.steps.indexOf(step) + 1]?.id ?? null) : null) : op.beforeId;
      return {
        ...board,
        processes: board.processes.map((process) => {
          const steps = process.steps.filter((item) => item.id !== op.stepId);
          if (process.id === to.id) return { ...process, steps: insertBefore(steps, step, beforeId) };
          return process.id === from.id ? { ...process, steps } : process;
        }),
      };
    }
    case "step.remove": {
      const from = board.processes.find((process) => process.steps.some((step) => step.id === op.stepId));
      // Un passo che uno use case elenca non si elimina: il server risponde «linked», qui resta dov'è.
      if (!from || from.steps.find((step) => step.id === op.stepId)!.useCaseIds.length > 0) return board;
      const without = (ids: string[]) => (ids.includes(op.stepId) ? ids.filter((id) => id !== op.stepId) : ids);
      return {
        ...board,
        processes: board.processes.map((process) => ({
          ...process,
          steps: process.steps
            .filter((step) => step.id !== op.stepId)
            .map((step) => (step.dependsOn.includes(op.stepId) || step.neededBy.includes(op.stepId) ? { ...step, dependsOn: without(step.dependsOn), neededBy: without(step.neededBy) } : step)),
        })),
      };
    }
    case "step.stream":
      return mapStep(board, op.stepId, (step) => ({ ...step, stream: op.next }));
    case "streams.reset": {
      const differs = (step: BoardStep) => step.proposedStream !== null && step.stream !== step.proposedStream;
      if (!board.processes.some((process) => process.steps.some(differs))) return board;
      return {
        ...board,
        processes: board.processes.map((process) => ({ ...process, steps: process.steps.map((step) => (differs(step) ? { ...step, stream: step.proposedStream } : step)) })),
      };
    }
    case "note.add": {
      if (findNote(board, op.noteId)) return board;
      const defaults = ACTOR_DEFAULTS[actor.kind];
      const note: BoardNote = { id: op.noteId, lane: op.lane, title: op.lane === BOARD_LANE ? (op.title ?? null) : null, text: op.text, status: defaults.noteStatus, origin: defaults.origin };
      if (op.stepId === null) {
        if (op.lane !== BOARD_LANE || board.analysis.length >= L.analysisPoints) return board;
        return { ...board, analysis: insertBefore(board.analysis, note, op.beforeId) };
      }
      const lane = op.lane;
      if (!isStepLane(lane)) return board;
      return mapNotes(board, { stepId: op.stepId, lane }, (notes) => (notes.length >= L.notesPerLane ? notes : insertBefore(notes, note, op.beforeId)));
    }
    case "note.set": {
      const place = findNote(board, op.noteId);
      if (!place) return board;
      return mapNotes(board, place, (notes) =>
        notes.map((note) => {
          if (note.id !== op.noteId) return note;
          if (op.field === "text") return op.next ? { ...note, text: op.next } : note;
          if (op.field === "title") return place.lane === BOARD_LANE ? { ...note, title: op.next || null } : note;
          return (NOTE_STATUSES as readonly unknown[]).includes(op.next) ? { ...note, status: op.next as NoteStatus } : note;
        }),
      );
    }
    case "note.remove": {
      const place = findNote(board, op.noteId);
      return place ? mapNotes(board, place, (notes) => notes.filter((note) => note.id !== op.noteId)) : board;
    }
    case "board.set":
      return { ...board, headline: op.next || null };
  }
}

/**
 * La board con le operazioni applicate: quello che il browser mostra subito. Un'operazione il cui bersaglio non c'è più
 * non fa niente; i limiti sono quelli del server, così non si vede quello che il server rifiuterebbe. `prev` non si
 * guarda: decide il server, campo per campo.
 */
export function applyOps(board: MappingBoard, ops: readonly BoardOp[], actor: { kind: ActorKind }): MappingBoard {
  let next = board;
  for (const op of ops) next = applyOp(next, op, actor);
  if (next === board) return board;
  const status = shownUnitStatus(next.unit.status, countSteps(next));
  return status === next.unit.status ? next : { ...next, unit: { ...next.unit, status } };
}

// ─── Unire le modifiche dello stesso campo ───────────────────────────

const sameValue = (a: unknown, b: unknown): boolean =>
  Array.isArray(a) && Array.isArray(b) ? a.length === b.length && a.every((item, index) => item === b[index]) : a === b;

/** La chiave del campo che un'operazione cambia; null per le operazioni che non si uniscono. */
function fieldKey(op: BoardOp): string | null {
  switch (op.t) {
    case "process.set":
      return `process:${op.processId}:${op.field}`;
    case "step.set":
      return `step:${op.stepId}:${op.field}`;
    case "step.stream":
      return `stream:${op.stepId}`;
    case "note.set":
      return `note:${op.noteId}:${op.field}`;
    case "board.set":
      return `board:${op.field}`;
    case "process.vote":
      return `vote:${op.processId}`;
    default:
      return null;
  }
}

/**
 * Più modifiche dello stesso campo prima di un salvataggio diventano una: il `prev` della prima, il `next` dell'ultima,
 * al posto dell'ultima. Dei voti resta l'ultimo valore. Una modifica che torna al valore di partenza sparisce.
 * «Usa gli stream proposti» in mezzo separa: lo stream scelto prima e quello scelto dopo restano due operazioni.
 */
export function coalesce(ops: readonly BoardOp[]): BoardOp[] {
  const out: Array<BoardOp | null> = [];
  const open = new Map<string, number>();
  for (const op of ops) {
    if (op.t === "streams.reset") {
      for (const key of [...open.keys()]) if (key.startsWith("stream:")) open.delete(key);
      out.push(op);
      continue;
    }
    const key = fieldKey(op);
    if (key === null) {
      out.push(op);
      continue;
    }
    const earlier = open.get(key);
    const first = earlier === undefined ? null : out[earlier];
    if (first && op.t !== "process.vote" && "prev" in first && "prev" in op) {
      out[earlier!] = null;
      const merged = { ...op, prev: first.prev } as BoardOp;
      if ("next" in merged && sameValue(merged.prev, merged.next)) {
        open.delete(key);
        continue;
      }
      open.set(key, out.push(merged) - 1);
      continue;
    }
    if (first && op.t === "process.vote") out[earlier!] = null;
    open.set(key, out.push(op) - 1);
  }
  return out.filter((op): op is BoardOp => op !== null);
}

// ─── Dal modulo di un passo alle operazioni ──────────────────────────

/** Il modulo di un passo raccolto dall'assistente o dai documenti (§5.1): i testi arrivano come li scrive il modello. */
export interface StepDraft {
  title: string;
  description?: string;
  who?: string[];
  tools?: string[];
  input?: string;
  output?: string;
  decision?: string;
  decisionLabel?: string;
  exception?: string;
  friction?: Friction;
  frequency?: string;
  hoursWeek?: number;
  quality?: string;
  workType?: WorkType;
  /** I passaggi operativi: note della corsia «Attività». */
  steps?: string[];
  /** Note della corsia «Attriti». */
  frictions?: string[];
  /** Note della corsia «Dati e documenti». */
  data?: string[];
  /** Note della corsia «Tempi e volumi». */
  times?: string[];
}

const DRAFT_LANES: ReadonlyArray<[keyof Pick<StepDraft, "steps" | "frictions" | "data" | "times">, StepLane]> = [
  ["steps", "attivita"],
  ["frictions", "attriti"],
  ["data", "dati"],
  ["times", "tempi"],
];

/** I campi di un modulo, rifiniti e tagliati entro i limiti: quello che `step.set` accetta. Solo i campi presenti. */
function draftFields(draft: Partial<StepDraft>): Partial<Record<StepField, StepValue>> {
  const out: Partial<Record<StepField, StepValue>> = {};
  if (draft.title !== undefined) out.title = cutLine(draft.title, L.title);
  if (draft.description !== undefined) out.description = cutProse(draft.description, L.description);
  if (draft.who !== undefined) out.who = cutList(draft.who, L.who, L.whoItem);
  if (draft.tools !== undefined) out.tools = cutList(draft.tools, L.tools, L.toolItem);
  if (draft.input !== undefined) out.input = cutProse(draft.input, L.io);
  if (draft.output !== undefined) out.output = cutProse(draft.output, L.io);
  if (draft.decision !== undefined) out.decision = cutProse(draft.decision, L.decision);
  if (draft.decisionLabel !== undefined) out.decisionLabel = cutLine(draft.decisionLabel, L.decisionLabel);
  if (draft.exception !== undefined) out.exception = cutProse(draft.exception, L.exception);
  if (draft.friction !== undefined) out.friction = draft.friction === 0 || draft.friction === 1 || draft.friction === 2 || draft.friction === 3 ? draft.friction : null;
  if (draft.frequency !== undefined) out.frequency = cutLine(draft.frequency, ACTIVITY_COLUMNS.frequency);
  if (draft.hoursWeek !== undefined) out.hoursWeek = Number.isFinite(draft.hoursWeek) ? Math.round(Math.min(L.hoursWeek, Math.max(0, draft.hoursWeek)) * 100) / 100 : null;
  if (draft.quality !== undefined) out.quality = cutLine(draft.quality, ACTIVITY_COLUMNS.quality);
  if (draft.workType !== undefined) out.workType = (WORK_TYPES as readonly unknown[]).includes(draft.workType) ? draft.workType : null;
  return out;
}

const FIELD_ORDER: readonly StepField[] = ["description", "who", "tools", "input", "output", "decision", "decisionLabel", "exception", "friction", "frequency", "hoursWeek", "quality", "workType"];

/**
 * Le operazioni che scrivono un passo nuovo: `step.add`, poi un `step.set` per ogni campo riempito, poi una nota per
 * ogni voce delle liste. I testi troppo lunghi si tagliano, mai si rifiutano. Con un titolo vuoto non scrive niente
 * (`ops` vuoto). `afterStepId`: subito dopo quel passo; senza, in fondo al processo.
 */
export function opsForNewStep(draft: StepDraft, place: { processId: string; afterStepId?: string | null }, newId: () => string): { stepId: string; ops: BoardOp[] } {
  const stepId = newId();
  const title = cutLine(draft.title, L.title);
  if (!title) return { stepId, ops: [] };
  const ops: BoardOp[] = [{ id: newId(), t: "step.add", stepId, processId: place.processId, ...(place.afterStepId ? { afterId: place.afterStepId } : {}), title }];
  const blank = newStep(stepId, title, { kind: "assistente" });
  const fields = draftFields(draft);
  for (const field of FIELD_ORDER) {
    if (!(field in fields)) continue;
    const prev = stepFieldValue(blank, field);
    const next = fields[field] as StepValue;
    if (!sameValue(prev, next)) ops.push({ id: newId(), t: "step.set", stepId, field, prev, next });
  }
  for (const [key, lane] of DRAFT_LANES) {
    for (const text of cutNotes(draft[key])) ops.push({ id: newId(), t: "note.add", noteId: newId(), stepId, lane, text });
  }
  return { stepId, ops };
}

/** Le voci di una lista come note: rifinite, tagliate, senza doppioni, al più quante ne tiene una corsia. */
function cutNotes(items: readonly string[] | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of items ?? []) {
    const text = cutProse(item, L.note);
    if (!text) continue;
    const key = text.toLocaleLowerCase("it");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length >= L.notesPerLane) break;
  }
  return out;
}

/**
 * Le operazioni che correggono o completano un passo già sulla board: un `step.set` per ogni campo che cambia (con il
 * valore di adesso come `prev`), una nota per ogni voce delle liste che la corsia non ha già. Le liste aggiungono
 * note, non ne tolgono mai: quello lo fanno le persone sulla board. Un campo che resterebbe vuoto non si tocca.
 */
export function opsForStepPatch(current: BoardStep, patch: Partial<StepDraft>, newId: () => string): BoardOp[] {
  const ops: BoardOp[] = [];
  const fields = draftFields(patch);
  for (const field of ["title", ...FIELD_ORDER] as StepField[]) {
    if (!(field in fields)) continue;
    const next = fields[field] as StepValue;
    // L'assistente completa e corregge: non svuota un campo (per quello c'è la board).
    if (next === null || (Array.isArray(next) && next.length === 0)) continue;
    const prev = stepFieldValue(current, field);
    if (!sameValue(prev, next)) ops.push({ id: newId(), t: "step.set", stepId: current.id, field, prev, next });
  }
  for (const [key, lane] of DRAFT_LANES) {
    const existing = new Set(current.notes[lane].map((note) => note.text.toLocaleLowerCase("it")));
    let room = L.notesPerLane - current.notes[lane].length;
    for (const text of cutNotes(patch[key])) {
      if (room <= 0) break;
      if (existing.has(text.toLocaleLowerCase("it"))) continue;
      ops.push({ id: newId(), t: "note.add", noteId: newId(), stepId: current.id, lane, text });
      room -= 1;
    }
  }
  return ops;
}
