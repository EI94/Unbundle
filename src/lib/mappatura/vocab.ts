/**
 * «Mappatura board»: il vocabolario e i limiti (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.1).
 *
 * L'activity mapping di un'unità è una board: i processi di oggi come righe di passi. Qui stanno le parole che il
 * database, il server e il browser condividono, e i limiti di ogni campo. I CHECK della 0039
 * (`src/lib/db/mapping-board-ddl.ts`) nascono da qui: il database, lo schema zod e le schermate dicono la stessa cosa.
 *
 * Modulo puro: nessun import. Lo caricano anche i test con Node e gli script.
 */

export const STREAMS = ["automate", "differentiate", "innovate"] as const;
export type Stream = (typeof STREAMS)[number];

export const STEP_STATUSES = ["da_validare", "confermato"] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const NOTE_STATUSES = ["ipotesi", "validato", "fonte"] as const;
export type NoteStatus = (typeof NOTE_STATUSES)[number];

/** Le corsie di note di un passo, nell'ordine del drawer; «analisi» è della board (senza passo). */
export const STEP_LANES = ["attivita", "attriti", "dati", "tempi", "idee"] as const;
export type StepLane = (typeof STEP_LANES)[number];
export const BOARD_LANE = "analisi";
export type Lane = StepLane | typeof BOARD_LANE;
/** Tutte le corsie, nell'ordine del CHECK della 0039: quelle di un passo, poi quella della board. */
export const LANES = [...STEP_LANES, BOARD_LANE] as const satisfies readonly Lane[];

export const ORIGINS = ["chat", "documenti", "board", "prima"] as const;
export type Origin = (typeof ORIGINS)[number];

export type UnitStatus = "not_started" | "in_progress" | "mapped" | "validated";
export const UNIT_STATUSES = ["not_started", "in_progress", "mapped", "validated"] as const satisfies readonly UnitStatus[];

export type WorkType = "enrichment" | "detection" | "interpretation" | "delivery";
export const WORK_TYPES = ["enrichment", "detection", "interpretation", "delivery"] as const satisfies readonly WorkType[];

export type Friction = 0 | 1 | 2 | 3;
export const FRICTIONS = [0, 1, 2, 3] as const satisfies readonly Friction[];

/** I valori che la chat scrive oggi in `activities.frequency`; ogni altro testo si mostra com'è. */
export const FREQUENCIES = ["giornaliera", "settimanale", "mensile", "ad_hoc"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

export const MAPPING_LIMITS = Object.freeze({
  title: 120,
  description: 2000,
  who: 12,
  whoItem: 80,
  tools: 20,
  toolItem: 80,
  io: 1000,
  decision: 2000,
  decisionLabel: 60,
  exception: 2000,
  note: 2000,
  noteTitle: 120,
  notesPerLane: 30,
  analysisPoints: 6,
  processName: 120,
  owner: 200,
  headline: 300,
  processes: 26,
  stepsPerProcess: 40,
  stepsPerUnit: 200,
  hoursWeek: 168,
  votes: 99,
  opsPerSave: 200,
});

/**
 * Le larghezze delle colonne di `activities` (drizzle/0000) che la board scrive e che `MAPPING_LIMITS` non nomina:
 * frequenza e qualità percepita sono `varchar(100)`. Il titolo di un'attività nata prima della board può arrivare a
 * 500 caratteri: si legge com'è, e chi lo cambia lo porta entro `MAPPING_LIMITS.title`.
 */
export const ACTIVITY_COLUMNS = Object.freeze({ title: 500, frequency: 100, quality: 100 });

/** I tempi della board di riferimento (BOARD-SPEC §3.3, §1.4.15). */
export const AUTOSAVE = Object.freeze({ quietMs: 5_000, minGapMs: 15_000, undoMs: 6_000, toastMs: 4_200 });

const includes = <T extends string | number>(list: readonly T[], value: unknown): value is T => (list as readonly unknown[]).includes(value);

export const isStream = (value: unknown): value is Stream => includes(STREAMS, value);
export const isStepStatus = (value: unknown): value is StepStatus => includes(STEP_STATUSES, value);
export const isNoteStatus = (value: unknown): value is NoteStatus => includes(NOTE_STATUSES, value);
export const isStepLane = (value: unknown): value is StepLane => includes(STEP_LANES, value);
export const isLane = (value: unknown): value is Lane => includes(LANES, value);
export const isOrigin = (value: unknown): value is Origin => includes(ORIGINS, value);
export const isUnitStatus = (value: unknown): value is UnitStatus => includes(UNIT_STATUSES, value);
export const isWorkType = (value: unknown): value is WorkType => includes(WORK_TYPES, value);
export const isFriction = (value: unknown): value is Friction => includes(FRICTIONS, value);
