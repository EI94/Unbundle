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
    /**
     * L'etichetta in mono, che è anche il link all'elenco delle unità. (Rilascio 10, §4) A schermo la mappatura si
     * chiama «Processi»: la grafica della board resta (scelta del titolare del 15/11), cambiano le parole.
     */
    area: "Processi",
  }),
  /** Il titolo dell'elenco delle unità: «*Processi*». */
  unitsTitle: Object.freeze({ plain: "", accent: "Processi" }),
  /** (Rilascio 10, §3.7) Il titolo della board di un'unità è il nome dell'unità: niente parola in corsivo («board»). */
  boardTitleAccent: "",
  tabsLabel: "Sezioni dell'unità",
  // (Rilascio 10, §3.7) Le schede «Oggi» e «Con l'AI», senza numeri.
  tabs: Object.freeze({ oggi: "Oggi", classificazione: "Con l'AI" } satisfies Record<BoardTab, string>),
  // (Rilascio 10, §3.7) La prima riga della testata: il percorso «Contesto › Processi › {Unità}».
  path: Object.freeze({ label: "Percorso", context: "Contesto", processes: "Processi", separator: "›" }),
  /** Il «⋯» della testata della board. */
  menu: "Altre azioni",
  /** (Rilascio 10, §3.7) La pillola dice la sua parola anche al telefono: la forma corta. */
  pillShort: Object.freeze({ loading: "Caricamento", ready: "Pronto", saved: "Salvato", dirty: "Da salvare", saving: "Salvo…", readonly: "Sola lettura", local: "Solo qui" }),
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
    conflict: "Qualcun altro ha salvato: la mappa si aggiorna alla versione più recente.",
    failure: "Salvataggio non riuscito. Riprova con «Salva ora».",
    noteRemoved: "Nota eliminata.",
    stepRemoved: "Passo eliminato.",
    processRemoved: "Processo eliminato.",
    linked: "Questo passo è collegato a uno use case: non si elimina.",
    limitStepsInProcess: "Un processo tiene al massimo 40 passi.",
    limitStepsInBoard: "Una mappa tiene al massimo 200 passi.",
    limitProcesses: "Una mappa tiene al massimo 26 processi.",
    limitNotes: "Una corsia tiene al massimo 30 note.",
    limitAnalysis: "Una mappa tiene al massimo 6 punti di analisi.",
    copied: "Mappa copiata.",
    /** «Completa la mappatura» su un'unità senza passi: lo dicono il bottone e l'assistente. */
    noSteps: "Aggiungi almeno un passo prima di completare la mappatura.",
  }),
  /** Senza le tabelle della 0039: la board si legge e basta, per qualche minuto. */
  storeMissing: "La mappa è in sola lettura per qualche minuto: si sta aggiornando.",
  // (Rilascio 10, §4) Le parole di ogni pagina che non si carica.
  errorPage: Object.freeze({ title: "Questa pagina non si è caricata.", text: "Quello che hai già salvato resta salvato.", retry: "Riprova" }),
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
  card: Object.freeze({
    who: "Chi:",
    toValidate: "da validare",
    decides: "Decide una persona",
    /** (Rilascio 10, §3.7) L'attrito sulla card non è solo il colore del bordo: la parola per i lettori di schermo. */
    friction: (level: string) => `Attrito: ${level.toLowerCase()}`,
  }),
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

/**
 * (Rilascio 10, §3.7) «Aggiungi un'unità», che prima mancava (le unità nascevano solo dall'Intervista iniziale): la
 * finestra e l'azione del server. La parola è sempre «unità», che non chiede accordi (vale per ogni workspace).
 */
export const UNIT_TEXT = Object.freeze({
  add: "Aggiungi un'unità",
  title: "Aggiungi un'unità",
  nameLabel: "Nome dell'unità",
  namePlaceholder: "Per esempio: Acquisti",
  submit: "Aggiungi",
  cancel: "Annulla",
  saving: "Aggiungo…",
  added: "Unità aggiunta: l'assistente aiuta a mappare il lavoro.",
  nameMissing: "Scrivi il nome.",
  nameTooLong: (max: number) => `Al massimo ${max} caratteri.`,
  duplicate: "C'è già un'unità con questo nome.",
  full: (max: number) => `Ci sono già ${max} unità: è il massimo.`,
  denied: "Non hai i permessi per farlo.",
  failed: "Non è riuscito. Riprova tra poco.",
});
/** Quanto può essere lungo il nome di un'unità (lo stesso limite del nome di un processo). */
export const UNIT_NAME_MAX = 120;

/** L'etichetta del gruppo dei voti: il totale e quelli di chi guarda. */
export const votesLabel = (total: number, mine: number): string => `Voti: ${formatCount(total)}. Tuoi: ${formatCount(mine)}.`;
/** L'etichetta della × di un ruolo o di uno strumento. */
export const removeChipLabel = (name: string): string => `Togli ${name}`;

// ─── Il vocabolario, in parole ───────────────────────────────────────

/**
 * (Rilascio 10, §4, D4) Gli stream in italiano: «Automatizzare · Differenziare · Innovare». Il nome inglese del
 * metodo resta nel suggerimento (`STREAM_ENGLISH`, l'attributo `title`).
 */
export const STREAM_LABEL: Readonly<Record<Stream, string>> = Object.freeze({ automate: "Automatizzare", differentiate: "Differenziare", innovate: "Innovare" });
export const STREAM_ENGLISH: Readonly<Record<Stream, string>> = Object.freeze({ automate: "Automate", differentiate: "Differentiate", innovate: "Innovate" });
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
  board: "Aggiunto sulla mappa",
  prima: "Da prima della mappa",
});

/** Da dove viene una nota «da fonti», in una parola o due (la didascalia e il segno nella mappa come testo). */
export const ORIGIN_SOURCE: Readonly<Record<Origin, string>> = Object.freeze({
  chat: "chat",
  documenti: "documenti",
  board: "mappa",
  prima: "prima della mappa",
});

export const LANE_LABEL: Readonly<Record<Lane, string>> = Object.freeze({
  // (Rilascio 10, §4) La corsia dei passi si chiama «Cosa si fa».
  attivita: "Cosa si fa",
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

/** (Rilascio 10, §3.7) La parola della pillola sulla riga delle schede del telefono: «Salvato», «Da salvare», «Salvo…». */
export function pillShortText(state: PillTextState, savedAt: string | null): string {
  if (state === "saved") return savedAtLabel(savedAt) ? BOARD_TEXT.pillShort.saved : BOARD_TEXT.pillShort.ready;
  return BOARD_TEXT.pillShort[state];
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

/**
 * (Rilascio 10, §4) Il codice di un passo («A2») nella riga del contesto del drawer, dopo il nome del processo: solo per
 * lo screen reader (niente codici a schermo), che così distingue due passi con lo stesso titolo.
 */
export const drawerCodeText = (code: string): string => ` · ${code}`;
