/**
 * «Mappatura board»: il modello di lettura e le sue derivazioni (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.2).
 *
 * `MappingBoard` è quello che il server manda al browser: l'unità, i processi in ordine con i loro passi in ordine, i
 * punti di analisi, gli use case collegati, che cosa può fare chi guarda. Un passo è un'attività (`activities.id`) con
 * quello che la board le aggiunge. Riquadri, legenda, tabelle e testo nascono da qui e da nessun'altra parte: una
 * modifica li cambia tutti insieme.
 *
 * Modulo puro: importa solo il vocabolario e le scritte. Lo usano il server, il browser e i test con Node.
 */
import { BOARD_TEXT, LANE_LABEL, STEP_STATUS_LABEL, formatHours, frequencyLabel, noteMark } from "./text.ts";
import { STEP_LANES, STREAMS, type Friction, type Lane, type NoteStatus, type Origin, type StepLane, type StepStatus, type Stream, type UnitStatus, type WorkType } from "./vocab.ts";

export interface BoardNote {
  id: string;
  lane: Lane;
  title: string | null;
  text: string;
  status: NoteStatus;
  origin: Origin;
}

export interface BoardStep {
  /** `activities.id`. */
  id: string;
  title: string;
  description: string | null;
  who: string[];
  tools: string[];
  input: string | null;
  output: string | null;
  decision: string | null;
  decisionLabel: string | null;
  exception: string | null;
  /** Il livello mostrato: quello salvato, oppure 2 se c'è un attrito scritto e nessun livello, altrimenti 0. */
  friction: Friction;
  /** Vero se il livello è stato scelto da una persona o dall'assistente (`mapping_steps.friction_level` non nullo). */
  frictionSet: boolean;
  frequency: string | null;
  hoursWeek: number | null;
  quality: string | null;
  workType: WorkType | null;
  status: StepStatus;
  origin: Origin;
  notes: Record<StepLane, BoardNote[]>;
  stream: Stream | null;
  proposedStream: Stream | null;
  confidence: number | null;
  reason: string | null;
  aiPotential: string | null;
  onetCode: string | null;
  onetTitle: string | null;
  /** Da 0 a 1. */
  aiExposure: number | null;
  /** I passi di questa unità da cui dipende, e quelli che lo aspettano. */
  dependsOn: string[];
  neededBy: string[];
  useCaseIds: string[];
}

export interface BoardProcess {
  id: string;
  name: string;
  owner: string | null;
  /** La somma dei voti di tutti. */
  votes: number;
  /** I voti di chi guarda. */
  myVotes: number;
  steps: BoardStep[];
}

export interface BoardUseCaseLink {
  id: string;
  code: string | null;
  title: string;
  href: string;
  stream: Stream | null;
}

export interface MappingBoard {
  unit: { id: string; name: string; description: string | null; teamSize: number | null; status: UnitStatus };
  revision: number;
  /** ISO; null: mai salvata («Pronto»). */
  savedAt: string | null;
  headline: string | null;
  /** In ordine; i passi in ordine. */
  processes: BoardProcess[];
  analysis: BoardNote[];
  /** Solo quelli che chi guarda può vedere. */
  useCases: BoardUseCaseLink[];
  can: { edit: boolean; setStream: boolean; complete: boolean };
  /** «mancante»: senza la 0039, sola lettura. */
  store: "pronto" | "mancante";
}

export interface UnitBoardSummary {
  id: string;
  name: string;
  description: string | null;
  teamSize: number | null;
  status: UnitStatus;
  processes: number;
  steps: number;
  hoursWeek: number;
  toValidate: number;
  unclassified: number;
  streams: Record<Stream, number>;
}

// ─── Mattoni ─────────────────────────────────────────────────────────

/** Le corsie di un passo, vuote. */
export function emptyNotes(): Record<StepLane, BoardNote[]> {
  return { attivita: [], attriti: [], dati: [], tempi: [], idee: [] };
}

/** Il livello di attrito mostrato: quello salvato; senza, «medio» se un attrito è scritto, altrimenti nessuno (P16). */
export function shownFriction(saved: Friction | null, hasFrictionText: boolean): Friction {
  if (saved !== null) return saved;
  return hasFrictionText ? 2 : 0;
}

/** Lo stato a cui torna una nota quando si toglie la spunta: «da fonti» se viene da fuori della board, «ipotesi» altrimenti (P56). */
export function uncheckedNoteStatus(origin: Origin): NoteStatus {
  return origin === "board" ? "ipotesi" : "fonte";
}

/** Vero se nel passo decide una persona: c'è il testo della decisione, o il suo nome. */
export function hasHumanDecision(step: Pick<BoardStep, "decision" | "decisionLabel">): boolean {
  return Boolean(step.decision?.trim() || step.decisionLabel?.trim());
}

/** Quanti attriti ha un passo: le note della corsia; un livello scelto senza note conta per uno. */
export function stepFrictions(step: Pick<BoardStep, "friction" | "notes">): number {
  return Math.max(step.notes.attriti.length, step.friction > 0 ? 1 : 0);
}

/** Quanti attriti tiene una riga della mappa (P60). */
export function processFrictions(process: Pick<BoardProcess, "steps">): number {
  return process.steps.reduce((sum, step) => sum + stepFrictions(step), 0);
}

/** Tutti i passi della board, nell'ordine della mappa. */
export function allSteps(board: Pick<MappingBoard, "processes">): BoardStep[] {
  return board.processes.flatMap((process) => process.steps);
}

export interface StepPlace {
  step: BoardStep;
  process: BoardProcess;
  processIndex: number;
  stepIndex: number;
  /** «A2». */
  code: string;
}

/** Dove sta un passo: il suo processo, la posizione e il codice. Null se non c'è. */
export function locateStep(board: Pick<MappingBoard, "processes">, stepId: string): StepPlace | null {
  for (let processIndex = 0; processIndex < board.processes.length; processIndex++) {
    const process = board.processes[processIndex];
    const stepIndex = process.steps.findIndex((step) => step.id === stepId);
    if (stepIndex !== -1) return { step: process.steps[stepIndex], process, processIndex, stepIndex, code: stepCode(processIndex, stepIndex) };
  }
  return null;
}

// ─── Derivazioni: una sola fonte per riquadri, legenda, tabelle e testo ─

/** La lettera di un processo dal suo posto: 0 → «A», 25 → «Z», 26 → «AA». Mai salvata. */
export function processLetter(index: number): string {
  let n = Math.max(0, Math.floor(index));
  let out = "";
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return out;
}

/** Il codice di un passo dal suo posto: (0, 1) → «A2». Mai salvato. */
export function stepCode(processIndex: number, stepIndex: number): string {
  return `${processLetter(processIndex)}${Math.max(0, Math.floor(stepIndex)) + 1}`;
}

const round1 = (value: number) => Math.round(value * 10) / 10;

export function boardNumbers(board: MappingBoard): { steps: number; processes: number; hoursWeek: number; decisions: number; toValidate: number; confirmed: number; frictions: number } {
  const steps = allSteps(board);
  return {
    steps: steps.length,
    processes: board.processes.length,
    hoursWeek: round1(steps.reduce((sum, step) => sum + (step.hoursWeek ?? 0), 0)),
    decisions: steps.filter(hasHumanDecision).length,
    toValidate: steps.filter((step) => step.status === "da_validare").length,
    confirmed: steps.filter((step) => step.status === "confermato").length,
    frictions: steps.reduce((sum, step) => sum + stepFrictions(step), 0),
  };
}

export function streamNumbers(board: MappingBoard): {
  byStream: Record<Stream, { steps: number; hoursWeek: number }>;
  unclassified: number;
  avgExposurePct: number | null;
  differsFromProposal: number;
} {
  const byStream = { automate: { steps: 0, hoursWeek: 0 }, differentiate: { steps: 0, hoursWeek: 0 }, innovate: { steps: 0, hoursWeek: 0 } };
  let unclassified = 0;
  let differsFromProposal = 0;
  const exposures: number[] = [];
  for (const step of allSteps(board)) {
    if (step.stream) {
      byStream[step.stream].steps += 1;
      byStream[step.stream].hoursWeek += step.hoursWeek ?? 0;
    } else {
      unclassified += 1;
    }
    if (step.proposedStream && step.stream !== step.proposedStream) differsFromProposal += 1;
    if (typeof step.aiExposure === "number" && Number.isFinite(step.aiExposure)) exposures.push(step.aiExposure);
  }
  for (const stream of STREAMS) byStream[stream].hoursWeek = round1(byStream[stream].hoursWeek);
  const avgExposurePct = exposures.length ? Math.round((exposures.reduce((sum, value) => sum + value, 0) / exposures.length) * 100) : null;
  return { byStream, unclassified, avgExposurePct, differsFromProposal };
}

type StepRef = { code: string; title: string };

/** Una tabella «nome → passi»: i nomi uguali a meno di maiuscole e spazi sono lo stesso nome; in ordine alfabetico. */
function namesTable(board: MappingBoard, pick: (step: BoardStep) => readonly string[]): Array<{ name: string; steps: StepRef[] }> {
  const rows = new Map<string, { name: string; steps: StepRef[] }>();
  board.processes.forEach((process, processIndex) => {
    process.steps.forEach((step, stepIndex) => {
      const seen = new Set<string>();
      for (const raw of pick(step)) {
        const name = raw.trim().replace(/\s+/g, " ");
        const key = name.toLocaleLowerCase("it");
        if (!name || seen.has(key)) continue;
        seen.add(key);
        const row = rows.get(key) ?? { name, steps: [] };
        row.steps.push({ code: stepCode(processIndex, stepIndex), title: step.title });
        rows.set(key, row);
      }
    });
  });
  return [...rows.values()].sort((a, b) => a.name.localeCompare(b.name, "it", { sensitivity: "base" }));
}

export function rolesTable(board: MappingBoard): Array<{ role: string; steps: StepRef[] }> {
  return namesTable(board, (step) => step.who).map(({ name, steps }) => ({ role: name, steps }));
}

export function toolsTable(board: MappingBoard): Array<{ tool: string; steps: StepRef[] }> {
  return namesTable(board, (step) => step.tools).map(({ name, steps }) => ({ tool: name, steps }));
}

export function unitNumbers(units: readonly UnitBoardSummary[]): { complete: number; total: number; steps: number; hoursWeek: number; toValidate: number } {
  return {
    complete: units.filter((unit) => unit.status === "mapped" || unit.status === "validated").length,
    total: units.length,
    steps: units.reduce((sum, unit) => sum + unit.steps, 0),
    hoursWeek: round1(units.reduce((sum, unit) => sum + unit.hoursWeek, 0)),
    toValidate: units.reduce((sum, unit) => sum + unit.toValidate, 0),
  };
}

/**
 * La prima frase di un testo e il resto (P35): la prima frase finisce a un punto, un punto di domanda, un esclamativo o
 * tre puntini seguiti da uno spazio e da una maiuscola, una cifra o una virgoletta, oppure a un a capo.
 */
export function firstSentence(text: string): { first: string; rest: string } {
  const clean = text.trim();
  const end = /[.!?…]+(?=\s+[\p{Lu}\p{N}«"“(])|\n/u.exec(clean);
  if (!end) return { first: clean, rest: "" };
  const cut = end[0] === "\n" ? end.index : end.index + end[0].length;
  return { first: clean.slice(0, cut).trim(), rest: clean.slice(cut).trim() };
}

function notesLine(notes: readonly BoardNote[], lead: readonly string[] = []): string {
  const parts = [...lead.filter(Boolean), ...notes.map((note) => [note.text.replace(/\s*\n\s*/g, " "), noteMark(note.status, note.origin)].filter(Boolean).join(" "))];
  return parts.join(" · ");
}

/**
 * La mappa come testo semplice (P62): per processo e per passo, una riga per corsia, le note unite da « · »,
 * «[da validare]» dopo un passo, «[ipotesi]» o «[fonte: chat]» dopo una nota. Le righe vuote non si scrivono.
 */
export function boardAsText(board: MappingBoard): string {
  const out: string[] = [];
  if (board.headline) out.push(board.headline, "");
  board.processes.forEach((process, processIndex) => {
    out.push([`${processLetter(processIndex)} · ${process.name}`, process.owner].filter(Boolean).join(" · "));
    process.steps.forEach((step, stepIndex) => {
      const lines: Array<[string, string]> = [
        [LANE_LABEL.attivita, notesLine(step.notes.attivita, [step.description?.replace(/\s*\n\s*/g, " ") ?? ""])],
        [BOARD_TEXT.fields.who, step.who.join(", ")],
        [BOARD_TEXT.fields.tools, step.tools.join(", ")],
        [BOARD_TEXT.fields.input, step.input ?? ""],
        [BOARD_TEXT.fields.output, step.output ?? ""],
        [LANE_LABEL.dati, notesLine(step.notes.dati)],
        [LANE_LABEL.attriti, notesLine(step.notes.attriti)],
        [
          LANE_LABEL.tempi,
          notesLine(step.notes.tempi, [step.frequency ? frequencyLabel(step.frequency) : "", step.hoursWeek !== null ? `${formatHours(step.hoursWeek)} ${BOARD_TEXT.fields.hoursWeek}` : ""]),
        ],
        [BOARD_TEXT.fields.decision, [step.decisionLabel, step.decision].filter(Boolean).join(": ")],
        [BOARD_TEXT.fields.exception, step.exception ?? ""],
      ];
      out.push(`  ${[stepCode(processIndex, stepIndex), step.title].join(" · ")}${step.status === "da_validare" ? ` ${BOARD_TEXT.marks.toValidate}` : ""}`);
      for (const [label, value] of lines) if (value.trim()) out.push(`    ${label}: ${value.replace(/\s*\n\s*/g, " ").trim()}`);
    });
    out.push("");
  });
  if (board.analysis.length) {
    out.push(LANE_LABEL.analisi);
    for (const point of board.analysis) out.push(`  ${[point.title, notesLine([point])].filter(Boolean).join(": ")}`);
    out.push("");
  }
  return out.join("\n").trimEnd();
}

/**
 * L'ordine in cui le attività di prima entrano nella board (§3.5): l'ordine di creazione, spostato solo quanto serve
 * perché un'attività venga dopo quelle da cui dipende (`source` dipende da `target`). Un ciclo tiene l'ordine di
 * creazione. Le dipendenze verso attività che non sono nell'elenco non contano.
 */
export function adoptionOrder(
  activities: ReadonlyArray<{ id: string; createdAt: Date }>,
  dependencies: ReadonlyArray<{ sourceActivityId: string; targetActivityId: string }>,
): string[] {
  const time = (date: Date) => (Number.isNaN(date.getTime()) ? 0 : date.getTime());
  const byCreation = activities
    .map((activity, index) => ({ id: activity.id, time: time(activity.createdAt), index }))
    .sort((a, b) => a.time - b.time || a.index - b.index)
    .map((entry) => entry.id);
  const known = new Set(byCreation);
  const waitsFor = new Map<string, Set<string>>(byCreation.map((id) => [id, new Set<string>()]));
  for (const { sourceActivityId, targetActivityId } of dependencies) {
    if (sourceActivityId !== targetActivityId && known.has(sourceActivityId) && known.has(targetActivityId)) waitsFor.get(sourceActivityId)!.add(targetActivityId);
  }
  // Un ciclo tiene l'ordine di creazione: le dipendenze che chiudono un giro non contano.
  const reaches = (from: string, to: string): boolean => {
    const seen = new Set<string>();
    const stack = [from];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (id === to) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      stack.push(...waitsFor.get(id)!);
    }
    return false;
  };
  const inCycle: Array<[string, string]> = [];
  for (const [source, targets] of waitsFor) for (const target of targets) if (reaches(target, source)) inCycle.push([source, target]);
  for (const [source, target] of inCycle) waitsFor.get(source)!.delete(target);

  const placed = new Set<string>();
  const out: string[] = [];
  while (out.length < byCreation.length) {
    // La prima per creazione che non aspetta più nessuno (senza cicli ce n'è sempre una).
    const remaining = byCreation.filter((id) => !placed.has(id));
    const next = remaining.find((id) => [...waitsFor.get(id)!].every((target) => placed.has(target))) ?? remaining[0];
    placed.add(next);
    out.push(next);
  }
  return out;
}

/**
 * La board con gli use case collegati (§4.6): `readBoard` non li legge, li mette la pagina una volta. `byStep` va dal
 * passo agli use case che lo elencano; si tengono solo i passi di questa board.
 */
export function withUseCaseLinks(board: MappingBoard, links: { links: readonly BoardUseCaseLink[]; byStep: ReadonlyMap<string, readonly string[]> }): MappingBoard {
  const linked: MappingBoard = {
    ...board,
    processes: board.processes.map((process) => ({
      ...process,
      steps: process.steps.map((step) => ({ ...step, useCaseIds: [...(links.byStep.get(step.id) ?? [])] })),
    })),
  };
  return { ...linked, useCases: links.links.map((link) => ({ ...link, stream: linkedCaseStream(linked, link.id) })) };
}

/**
 * Lo stream di uno use case collegato: quello che ha la maggior parte dei suoi passi su questa board (a parità, il
 * primo nell'ordine Automate, Differentiate, Innovate). null se nessuno dei suoi passi è classificato.
 */
export function linkedCaseStream(board: Pick<MappingBoard, "processes">, useCaseId: string): Stream | null {
  const counts: Record<Stream, number> = { automate: 0, differentiate: 0, innovate: 0 };
  for (const step of allSteps(board)) if (step.stream && step.useCaseIds.includes(useCaseId)) counts[step.stream] += 1;
  const best = STREAMS.reduce((winner, stream) => (counts[stream] > counts[winner] ? stream : winner), STREAMS[0]);
  return counts[best] > 0 ? best : null;
}

/** Gli use case collegati di una board già letta, da tenere quando ne arriva una più nuova dal server. */
export function caseLinksOf(board: MappingBoard): { links: BoardUseCaseLink[]; byStep: Map<string, string[]> } {
  const byStep = new Map<string, string[]>();
  for (const step of allSteps(board)) if (step.useCaseIds.length) byStep.set(step.id, [...step.useCaseIds]);
  return { links: [...board.useCases], byStep };
}

/** Lo stato mostrato di un'unità: «In corso» da sola al primo passo, anche prima del primo salvataggio (§0 punto 9). */
export function shownUnitStatus(stored: UnitStatus, steps: number): UnitStatus {
  return stored === "not_started" && steps > 0 ? "in_progress" : stored;
}

/** Le corsie di un passo che hanno note, nell'ordine del drawer. */
export function filledLanes(step: Pick<BoardStep, "notes">): StepLane[] {
  return STEP_LANES.filter((lane) => step.notes[lane].length > 0);
}

/** La scritta dello stato di un passo, com'è sulla card («da validare»). */
export const stepStatusLabel = (status: StepStatus): string => STEP_STATUS_LABEL[status];
