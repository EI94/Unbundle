/**
 * «Mappatura board»: dalle righe del database al modello di lettura (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.2).
 *
 * `board-sql.ts` scrive le letture, qui si montano: i processi in ordine con i loro passi, le note per corsia, le
 * dipendenze tra passi dell'unità. Ogni valore passa da un lettore che non si fida del tipo che arriva (il driver può
 * dare un numero come testo, un jsonb già letto o no).
 *
 * Modulo puro: lo usano `board-store.ts` e i test con Node.
 */
import { emptyNotes, shownFriction, shownUnitStatus, type BoardNote, type BoardProcess, type BoardStep, type MappingBoard, type UnitBoardSummary } from "./board-model.ts";
import { streamOf } from "./streams.ts";
import { isFriction, isLane, isNoteStatus, isOrigin, isStepLane, isStepStatus, isStream, isUnitStatus, isWorkType, type Friction, type UnitStatus } from "./vocab.ts";

export type Row = Record<string, unknown>;

export function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const out = typeof value === "string" ? value : String(value);
  return out === "" ? null : out;
}

export function number(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

export function strings(value: unknown): string[] {
  let list: unknown = value;
  if (typeof value === "string") {
    try {
      list = JSON.parse(value);
    } catch {
      return [];
    }
  }
  return Array.isArray(list) ? list.filter((item): item is string => typeof item === "string") : [];
}

export function isoDate(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === "string" && value.trim() ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
}

export function date(value: unknown): Date {
  const iso = isoDate(value);
  return iso ? new Date(iso) : new Date(0);
}

const unitStatus = (value: unknown): UnitStatus => (isUnitStatus(value) ? value : "not_started");
const friction = (value: unknown): Friction | null => {
  const level = number(value);
  return isFriction(level) ? level : null;
};
const fraction = (value: unknown): number | null => {
  const n = number(value);
  return n === null ? null : Math.min(1, Math.max(0, n));
};

function noteFromRow(row: Row): BoardNote | null {
  const id = text(row.id);
  const body = text(row.body);
  if (!id || !body || !isLane(row.lane)) return null;
  return { id, lane: row.lane, title: text(row.title), text: body, status: isNoteStatus(row.status) ? row.status : "ipotesi", origin: isOrigin(row.origin) ? row.origin : "prima" };
}

/** Le colonne di `activities` di un passo (`STEP_READ_COLUMNS`): comuni alla board e alla lettura senza la 0039. */
function activityPart(row: Row): Pick<BoardStep, "id" | "title" | "description" | "tools" | "input" | "output" | "decision" | "frequency" | "hoursWeek" | "quality" | "workType" | "stream" | "confidence" | "onetCode" | "aiExposure"> {
  return {
    id: text(row.id) ?? "",
    title: text(row.title) ?? "",
    description: text(row.description),
    tools: strings(row.tools),
    input: text(row.input),
    output: text(row.output),
    decision: text(row.decision),
    frequency: text(row.frequency),
    hoursWeek: number(row.hours_week),
    quality: text(row.quality),
    workType: isWorkType(row.work_type) ? row.work_type : null,
    stream: streamOf(text(row.classification)),
    confidence: fraction(row.confidence_score),
    onetCode: text(row.onet_task_id),
    aiExposure: fraction(row.ai_exposure_score),
  };
}

export interface BoardRows {
  unit: Row | undefined;
  processes: readonly Row[];
  steps: readonly Row[];
  notes: readonly Row[];
  dependencies: readonly Row[];
}

/** La board dalle cinque letture di `boardReads`. Null se l'unità non c'è (non è di quel workspace). */
export function assembleBoard(rows: BoardRows, can: MappingBoard["can"]): MappingBoard | null {
  const unitId = text(rows.unit?.id);
  if (!rows.unit || !unitId) return null;

  const analysis: BoardNote[] = [];
  const notesByStep = new Map<string, BoardNote[]>();
  for (const row of rows.notes) {
    const note = noteFromRow(row);
    if (!note) continue;
    const stepId = text(row.activity_id);
    if (stepId === null) {
      if (note.lane === "analisi") analysis.push(note);
    } else if (isStepLane(note.lane)) {
      notesByStep.set(stepId, [...(notesByStep.get(stepId) ?? []), note]);
    }
  }

  const stepIds = new Set(rows.steps.map((row) => text(row.id)).filter((id): id is string => id !== null));
  const dependsOn = new Map<string, string[]>();
  const neededBy = new Map<string, string[]>();
  for (const row of rows.dependencies) {
    const source = text(row.source_activity_id);
    const target = text(row.target_activity_id);
    if (!source || !target || source === target || !stepIds.has(source) || !stepIds.has(target)) continue;
    dependsOn.set(source, [...(dependsOn.get(source) ?? []), target]);
    neededBy.set(target, [...(neededBy.get(target) ?? []), source]);
  }

  const processes: BoardProcess[] = rows.processes
    .map((row) => ({ id: text(row.id) ?? "", name: text(row.name) ?? "", owner: text(row.owner), votes: Math.max(0, number(row.votes) ?? 0), myVotes: Math.max(0, number(row.my_votes) ?? 0), steps: [] as BoardStep[] }))
    .filter((process) => process.id !== "");
  const byId = new Map(processes.map((process) => [process.id, process]));

  for (const row of rows.steps) {
    const part = activityPart(row);
    if (!part.id) continue;
    const notes = emptyNotes();
    for (const note of notesByStep.get(part.id) ?? []) if (isStepLane(note.lane)) notes[note.lane].push(note);
    const saved = friction(row.friction_level);
    const step: BoardStep = {
      ...part,
      who: strings(row.who),
      decisionLabel: text(row.decision_label),
      exception: text(row.exception_text),
      friction: shownFriction(saved, notes.attriti.length > 0),
      frictionSet: saved !== null,
      status: isStepStatus(row.status) ? row.status : "da_validare",
      origin: isOrigin(row.origin) ? row.origin : "prima",
      notes,
      proposedStream: isStream(row.proposed_stream) ? row.proposed_stream : null,
      reason: text(row.classification_reason),
      aiPotential: text(row.ai_potential),
      onetTitle: text(row.onet_title),
      dependsOn: dependsOn.get(part.id) ?? [],
      neededBy: neededBy.get(part.id) ?? [],
      useCaseIds: [],
    };
    // Un passo rimasto senza processo (il suo è sparito) torna nel primo alla prossima adozione: fino ad allora si legge lì.
    const home = byId.get(text(row.process_id) ?? "") ?? processes[0];
    if (home) home.steps.push(step);
  }

  const revision = Math.max(0, number(rows.unit.revision) ?? 0);
  const steps = processes.reduce((sum, process) => sum + process.steps.length, 0);
  return {
    unit: { id: unitId, name: text(rows.unit.name) ?? "", description: text(rows.unit.description), teamSize: number(rows.unit.team_size), status: shownUnitStatus(unitStatus(rows.unit.mapping_status), steps) },
    revision,
    savedAt: revision > 0 ? isoDate(rows.unit.saved_at) : null,
    headline: text(rows.unit.headline),
    processes,
    analysis,
    useCases: [],
    can,
    store: "pronto",
  };
}

/**
 * La board senza la 0039: le attività in una riga sola, nell'ordine dato (`orderedIds`, da `adoptionOrder`); le note
 * di «Attriti» e «Dati e documenti» dalle colonne di sempre, con gli id che avranno dopo l'adozione (`noteId`). Niente
 * si può modificare.
 */
export function assembleActivitiesOnly(
  rows: { unit: Row | undefined; activities: readonly Row[]; dependencies: readonly Row[] },
  orderedIds: readonly string[],
  names: { processId: string; processName: string; noteId(activityId: string, lane: "attriti" | "dati"): string },
): MappingBoard | null {
  const unitId = text(rows.unit?.id);
  if (!rows.unit || !unitId) return null;
  const byId = new Map(rows.activities.map((row) => [text(row.id) ?? "", row]));
  const steps: BoardStep[] = [];
  for (const id of orderedIds) {
    const row = byId.get(id);
    if (!row) continue;
    const part = activityPart(row);
    const notes = emptyNotes();
    for (const [lane, column] of [["attriti", "pain_points"], ["dati", "data_required"]] as const) {
      const body = text(row[column]);
      if (body) notes[lane].push({ id: names.noteId(part.id, lane), lane, title: null, text: body, status: "fonte", origin: "prima" });
    }
    steps.push({
      ...part,
      who: [],
      decisionLabel: null,
      exception: null,
      friction: shownFriction(null, notes.attriti.length > 0),
      frictionSet: false,
      status: "da_validare",
      origin: "prima",
      notes,
      proposedStream: null,
      reason: null,
      aiPotential: null,
      onetTitle: null,
      dependsOn: [],
      neededBy: [],
      useCaseIds: [],
    });
  }
  const known = new Set(steps.map((step) => step.id));
  for (const row of rows.dependencies) {
    const source = text(row.source_activity_id);
    const target = text(row.target_activity_id);
    if (!source || !target || source === target || !known.has(source) || !known.has(target)) continue;
    steps.find((step) => step.id === source)!.dependsOn.push(target);
    steps.find((step) => step.id === target)!.neededBy.push(source);
  }
  return {
    unit: { id: unitId, name: text(rows.unit.name) ?? "", description: text(rows.unit.description), teamSize: number(rows.unit.team_size), status: shownUnitStatus(unitStatus(rows.unit.mapping_status), steps.length) },
    revision: 0,
    savedAt: null,
    headline: null,
    processes: steps.length ? [{ id: names.processId, name: names.processName, owner: null, votes: 0, myVotes: 0, steps }] : [],
    analysis: [],
    useCases: [],
    can: { edit: false, setStream: false, complete: false },
    store: "mancante",
  };
}

/** Una riga di `unitBoards`. */
export function unitSummaryFromRow(row: Row): UnitBoardSummary {
  const steps = Math.max(0, number(row.steps) ?? 0);
  return {
    id: text(row.id) ?? "",
    name: text(row.name) ?? "",
    description: text(row.description),
    teamSize: number(row.team_size),
    status: shownUnitStatus(unitStatus(row.mapping_status), steps),
    // Un'unità con delle attività e ancora senza processi ne avrà uno alla prima apertura della board.
    processes: Math.max(number(row.processes) ?? 0, steps > 0 ? 1 : 0),
    steps,
    hoursWeek: Math.round((number(row.hours_week) ?? 0) * 10) / 10,
    toValidate: Math.max(0, number(row.to_validate) ?? 0),
    unclassified: Math.max(0, number(row.unclassified) ?? 0),
    streams: { automate: number(row.automate) ?? 0, differentiate: number(row.differentiate) ?? 0, innovate: number(row.innovate) ?? 0 },
  };
}
