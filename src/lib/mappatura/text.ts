/**
 * «Mappatura board»: le scritte della cornice, della pillola, dei toast e del vocabolario
 * (docs/mappatura/MAPPATURA-BOARD-PIANO.md §7.1, §7.6).
 *
 * Stile della casa: frasi semplici e corte, genere neutro, maiuscola solo all'inizio, «use case». Le maiuscole che si
 * vedono in etichette e sigle le mette il CSS. I componenti importano le scritte da qui e non ne scrivono: così un test
 * le legge tutte. Nessuna chiave interna arriva a schermo: ogni parola del vocabolario ha la sua scritta.
 *
 * Modulo puro: lo caricano il server (la riga della campanella, i nomi dati dal server), il browser e i test con Node.
 */
import type { Friction, Lane, NoteStatus, Origin, StepLane, StepStatus, Stream, UnitStatus, WorkType } from "./vocab.ts";

/** Le due schede della board: l'ancora nell'indirizzo (`#oggi`, `#classificazione`) e l'etichetta. */
export const BOARD_TABS = ["oggi", "classificazione"] as const;
export type BoardTab = (typeof BOARD_TABS)[number];

export const BOARD_TEXT = Object.freeze({
  brand: Object.freeze({
    company: "lateral space",
    times: "×",
    dot: "·",
    /** L'etichetta in mono, che è anche il link all'elenco delle unità. */
    area: "Activity mapping",
  }),
  /** Il titolo dell'elenco delle unità: «Activity *mapping*». */
  unitsTitle: Object.freeze({ plain: "Activity", accent: "mapping" }),
  /** La parola in corsivo nel titolo della board di un'unità: «{Nome dell'unità} *board*». */
  boardTitleAccent: "board",
  tabsLabel: "Sezioni della board",
  tabs: Object.freeze({ oggi: "Processi di oggi", classificazione: "Classificazione" } satisfies Record<BoardTab, string>),
  pill: Object.freeze({
    loading: "Caricamento",
    ready: "Pronto",
    dirty: "Modifiche da salvare",
    saving: "Salvataggio…",
    readonly: "Sola lettura",
    local: "Modifiche solo su questo dispositivo",
  }),
  buttons: Object.freeze({ saveNow: "Salva ora", close: "Chiudi", undo: "Annulla", details: "Dettagli", retry: "Riprova" }),
  toast: Object.freeze({
    readonly: "Questa vista è in sola lettura: le modifiche restano su questo dispositivo.",
    conflict: "Qualcun altro ha salvato: la board si aggiorna alla versione più recente.",
    failure: "Salvataggio non riuscito. Riprova con «Salva ora».",
    noteRemoved: "Nota eliminata.",
    stepRemoved: "Passo eliminato.",
    processRemoved: "Processo eliminato.",
    linked: "Questo passo è collegato a uno use case: non si elimina.",
    limitStepsInProcess: "Un processo tiene al massimo 40 passi.",
    limitStepsInBoard: "Una board tiene al massimo 200 passi.",
    limitProcesses: "Una board tiene al massimo 26 processi.",
    limitNotes: "Una corsia tiene al massimo 30 note.",
    limitAnalysis: "Una board tiene al massimo 6 punti di analisi.",
    copied: "Mappa copiata.",
    /** «Completa la mappatura» su un'unità senza passi: lo dicono il bottone e l'assistente. */
    noSteps: "Aggiungi almeno un passo prima di completare la mappatura.",
  }),
  /** Senza le tabelle della 0039: la board si legge e basta, per qualche minuto. */
  storeMissing: "La board è in sola lettura per qualche minuto: si sta aggiornando.",
  errorPage: Object.freeze({ title: "La board non si apre.", text: "Riprova tra poco.", retry: "Riprova" }),
  empty: "—",
  /** I nomi che dà il server. */
  defaultProcessName: "Processo principale",
  newProcessName: "Nuovo processo",
  /** Le etichette che servono anche fuori dal drawer (la mappa come testo). */
  fields: Object.freeze({
    who: "Chi",
    tools: "Strumenti",
    input: "Entra",
    output: "Esce",
    decision: "Decide una persona",
    exception: "Eccezioni",
    hoursWeek: "h a settimana",
  }),
  /** I segni della mappa come testo (P62). */
  marks: Object.freeze({ toValidate: "[da validare]", hypothesis: "[ipotesi]" }),
  /** La card di un passo. */
  card: Object.freeze({ who: "Chi:", toValidate: "da validare", decides: "Decide una persona" }),
  /**
   * I due controlli di una nota e la sua spunta. Tolta la spunta, una nota scritta sulla board torna «ipotesi», una
   * venuta dalla chat, dai documenti o da prima della board torna «da fonti» (P56): per lei «Togli la spunta».
   */
  note: Object.freeze({
    validate: "Segna come validata",
    unvalidate: "Segna come ipotesi",
    unvalidateSource: "Togli la spunta",
    validated: "validata",
    remove: "Elimina",
    removeLabel: "Elimina nota",
  }),
  /** I voti di un processo. */
  votes: Object.freeze({ less: "Togli un tuo voto", more: "Aggiungi un voto" }),
});

/** L'etichetta del gruppo dei voti: il totale e quelli di chi guarda. */
export const votesLabel = (total: number, mine: number): string => `Voti: ${formatCount(total)}. Tuoi: ${formatCount(mine)}.`;
/** L'etichetta della × di un ruolo o di uno strumento. */
export const removeChipLabel = (name: string): string => `Togli ${name}`;
/** Il badge grigio dell'esposizione all'AI di un passo. */
export const exposureBadgeLabel = (pct: number): string => `AI ${formatCount(Math.round(pct))}%`;

// ─── Il vocabolario, in parole ───────────────────────────────────────

/** Gli stream sono nomi di prodotto: non si traducono. */
export const STREAM_LABEL: Readonly<Record<Stream, string>> = Object.freeze({ automate: "Automate", differentiate: "Differentiate", innovate: "Innovate" });
export const STREAM_LINE: Readonly<Record<Stream, string>> = Object.freeze({
  automate: "Non dovrebbe esistere così",
  differentiate: "Concentrare l'energia umana",
  innovate: "Valore che prima non esisteva",
});

/** `mapped` e `validated` dicono la stessa cosa: un nome, così niente deve concordare con la parola dell'unità. */
export const UNIT_STATUS_LABEL: Readonly<Record<UnitStatus, string>> = Object.freeze({
  not_started: "Da iniziare",
  in_progress: "In corso",
  mapped: "Mappatura completa",
  validated: "Mappatura completa",
});

export const WORK_TYPE_LABEL: Readonly<Record<WorkType, string>> = Object.freeze({
  enrichment: "Raccolta dati",
  detection: "Confronto",
  interpretation: "Interpretazione",
  delivery: "Consegna",
});

/** I quattro valori che la chat scrive in `activities.frequency`; ogni altro testo si mostra com'è. */
export const FREQUENCY_LABEL: Readonly<Record<string, string>> = Object.freeze({
  giornaliera: "Ogni giorno",
  settimanale: "Ogni settimana",
  mensile: "Ogni mese",
  ad_hoc: "Quando serve",
});

export const FRICTION_LABEL: Readonly<Record<Friction, string>> = Object.freeze({ 0: "Nessuno", 1: "Lieve", 2: "Medio", 3: "Forte" });

export const STEP_STATUS_LABEL: Readonly<Record<StepStatus, string>> = Object.freeze({ da_validare: "da validare", confermato: "confermato" });

export const ORIGIN_LABEL: Readonly<Record<Origin, string>> = Object.freeze({
  chat: "Dalla chat",
  documenti: "Dai documenti",
  board: "Aggiunto sulla board",
  prima: "Da prima della board",
});

/** Da dove viene una nota «da fonti», in una parola o due (la didascalia e il segno nella mappa come testo). */
export const ORIGIN_SOURCE: Readonly<Record<Origin, string>> = Object.freeze({
  chat: "chat",
  documenti: "documenti",
  board: "board",
  prima: "prima della board",
});

export const LANE_LABEL: Readonly<Record<Lane, string>> = Object.freeze({
  attivita: "Attività",
  attriti: "Attriti",
  dati: "Dati e documenti",
  tempi: "Tempi e volumi",
  idee: "Idee del team",
  analisi: "Punti di analisi",
});

export const streamLabel = (stream: Stream): string => STREAM_LABEL[stream];
export const unitStatusLabel = (status: UnitStatus): string => UNIT_STATUS_LABEL[status];
export const workTypeLabel = (workType: WorkType): string => WORK_TYPE_LABEL[workType];
export const frictionLabel = (friction: Friction): string => FRICTION_LABEL[friction];
export const originLabel = (origin: Origin): string => ORIGIN_LABEL[origin];
export const laneLabel = (lane: Lane | StepLane): string => LANE_LABEL[lane];

/** La frequenza in parole: uno dei quattro valori della chat, oppure il testo com'è. */
export function frequencyLabel(frequency: string): string {
  const key = frequency.trim().toLowerCase();
  return Object.hasOwn(FREQUENCY_LABEL, key) ? FREQUENCY_LABEL[key] : frequency.trim();
}

/** La didascalia di una nota non validata: «ipotesi», «da fonti · chat»… Una nota validata ha la spunta, non una scritta. */
export function noteCaption(status: NoteStatus, origin: Origin): string | null {
  if (status === "validato") return null;
  if (status === "ipotesi") return "ipotesi";
  return origin === "board" ? "da fonti" : `da fonti · ${ORIGIN_SOURCE[origin]}`;
}

/** Il segno dopo una nota nella mappa come testo: «[ipotesi]», «[fonte: chat]»; niente per una nota validata. */
export function noteMark(status: NoteStatus, origin: Origin): string | null {
  if (status === "validato") return null;
  if (status === "ipotesi") return BOARD_TEXT.marks.hypothesis;
  return `[fonte: ${ORIGIN_SOURCE[origin]}]`;
}

// ─── Numeri, date, plurali ───────────────────────────────────────────

/** «1 passo», «3 passi»: il numero con la sua parola. */
export function counted(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}

/** Un numero intero come si scrive in Italia: il punto delle migliaia da cinque cifre (1250, 12.500). */
export function formatCount(n: number): string {
  return new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0 }).format(Number.isFinite(n) ? n : 0);
}

/** Le ore a settimana: intere quando lo sono, altrimenti con un decimale e la virgola (12,5). */
export function formatHours(hours: number): string {
  const value = Number.isFinite(hours) ? Math.round(hours * 10) / 10 : 0;
  return new Intl.NumberFormat("it-IT", { minimumFractionDigits: 0, maximumFractionDigits: 1 }).format(value);
}

const SAVED_AT = new Intl.DateTimeFormat("it-IT", { timeZone: "Europe/Rome", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });

/** «gg/mm, hh:mm» a Roma: la stessa scritta sul server e nel browser. Null se la data non si legge. */
export function savedAtLabel(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const parts = Object.fromEntries(SAVED_AT.formatToParts(date).map((part) => [part.type, part.value]));
  return `${parts.day}/${parts.month}, ${parts.hour}:${parts.minute}`;
}

export type PillTextState = "loading" | "saved" | "dirty" | "saving" | "readonly" | "local";

/** La scritta della pillola, stato per stato (BOARD-SPEC §3.4): «Salvato gg/mm, hh:mm», «Pronto» se mai salvata. */
export function pillText(state: PillTextState, savedAt: string | null): string {
  if (state === "saved") {
    const when = savedAtLabel(savedAt);
    return when ? `Salvato ${when}` : BOARD_TEXT.pill.ready;
  }
  return BOARD_TEXT.pill[state];
}

// ─── La riga della campanella (la scrive il server, §7.6) ────────────

export const MAPPING_COMPLETED_SIGNAL = "mapping_completed";

export function mappingCompletedSignal(unitName: string, steps: number, hoursWeek: number): { title: string; description: string } {
  const hours = formatHours(hoursWeek);
  return {
    title: `Mappatura completata: ${unitName}`,
    description: `${counted(steps, "passo", "passi")}, ${hours} ${hours === "1" ? "ora" : "ore"} a settimana.`,
  };
}
