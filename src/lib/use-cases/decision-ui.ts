/**
 * Le decisioni a schermo (docs/use-case/DESIGN.md §3.6, §3.7, §4.8, §6.4, §6.5, §6.7, §14.3;
 * decisioni D3, D8; PIANO-LAVORI H3b).
 *
 * Quello che i pulsanti, i dialoghi e il capitolo «Decisione» mostrano, e quello che le
 * server action di `src/lib/actions/use-case-decisions.ts` accettano dalla pagina:
 * - **Pulsanti per fase** (§6.4, `decisionLayout`): un solo pulsante pieno, gli altri
 *   `outline`, il resto nel menu «⋯». Chi non decide non vede pulsanti: mai pulsanti spenti.
 * - **Testi e toast esatti** di §14.3 (`DECISION_LABEL`, `dialogText`, `decisionToast`).
 * - **«Rimanda»**: le date proposte, calcolate a Roma (`postponeOptions`); data obbligatoria
 *   e futura.
 * - **Nota pubblica**: obbligatoria per «Serve info» e «Non avviare», precompilata con quella
 *   salvata, al massimo 1.000 caratteri, con l'avviso fisso.
 * - **«Doppione di…»**: gli use case dello stesso workspace che hanno un codice, esclusa la
 *   scheda stessa (`duplicateCandidates`).
 * - **Ingresso delle action** (`parseDecisionInput`, `parseWhenChoice`): solo le forme che la
 *   pagina manda. Le regole (fase, dossier, chi) restano di `decisions.ts`, che il servizio
 *   applica a ogni canale.
 * - **Coda delle scritture** del browser (`createDecisionWriteQueue`): una dopo l'altra, ognuna
 *   con la versione lasciata da quella prima.
 *
 * Le date a schermo partono da `today` (`AAAA-MM-GG` a Roma) che la pagina legge sul server:
 * server e browser scrivono le stesse etichette, anche a cavallo di un trimestre.
 *
 * Modulo puro: solo import relativi `.ts` e `zod`, nessun `@/`, nessun `server-only`.
 */
import { z } from "zod";
import type { CaseStatus } from "../uc/vocab.ts";
import { DECISION_MESSAGES, DOSSIER_IN_USE_STATUSES } from "./decisions.ts";
import { formatDate, formatDayInYear, formatDayMonth } from "./format.ts";
import { TEXT_LIMITS, normalizeUseCaseCode, validatePublicNote } from "./inputs.ts";
import { ARCHIVE_REASON_LABEL, type CostSource, type ValueEurSource, type ValueSource } from "./labels.ts";
import { currentQuarter, nextQuarter, parseIsoDate, quarterStart, romeToday, whenChoiceLabel, whenChoiceToQuarter } from "./quarter.ts";
import {
  ARCHIVE_REASONS,
  WHEN_CHOICES,
  type ArchiveReason,
  type Decision,
  type IsoDate,
  type LifecycleStatus,
  type Phase,
  type ServiceError,
  type SubState,
  type UseCaseKind,
  type WhenChoice,
} from "./types.ts";
import { waitingDays, waitingLabel } from "./views.ts";

// ─── Lo use case come lo leggono i pulsanti ──────────────────────────

/**
 * Le parti di uno use case che servono alle decisioni. `HubItem` e `UseCaseDetail` di
 * `views.ts` (la proiezione dei revisori) le hanno tutte: le pagine li passano così come sono.
 */
export interface DecisionItem {
  id: string;
  code: string | null;
  title: string;
  phase: Phase;
  subState: SubState;
  /** La pillola dei revisori, es. «Chiuso · Doppione di XX-0007». */
  phaseLabel: string;
  kind: UseCaseKind;
  hiddenFromSearch: boolean;
  publicNote: string | null;
  /**
   * Una risposta a «Serve info» in attesa di decisione (D17, `HubItem.answered`): i dialoghi
   * propongono di aggiornare la nota pubblica, che è ancora la domanda.
   */
  answered?: boolean;
  targetQuarter: string | null;
  reviewBy: string | null;
  /** Da quando aspetta una risposta (D8, `waitingStart` di `views.ts`). */
  waitingSince: string;
  value: { source: ValueSource | null; perYear: { source: ValueEurSource } | null } | null;
  cost: { source: CostSource } | null;
  /** Dossier collegato; null senza dossier, con la sezione Casi d'uso spenta o se la lettura è fallita. */
  dossier: { status: CaseStatus } | null;
  /**
   * `use_cases.status`, quando la pagina lo passa: dice dove riporta «Riapri»
   * (`reopenDestination`). La proiezione dei revisori (`HubItem`) oggi non lo porta: senza,
   * «Riapri» si regola sul sotto-stato e non promette una fase che non conosce.
   */
  status?: LifecycleStatus | null;
  /** La `version` letta con la pagina: ogni scrittura la porta (§6.8). */
  version: number;
}

/**
 * Solo le parti di `DecisionItem`, senza il resto della scheda (testi, punteggi, note
 * interne): quello che il capitolo «Decisione», reso sul server, passa ai pezzi del browser.
 */
export function toDecisionItem(item: DecisionItem): DecisionItem {
  return {
    id: item.id,
    code: item.code,
    title: item.title,
    phase: item.phase,
    subState: item.subState,
    phaseLabel: item.phaseLabel,
    kind: item.kind,
    hiddenFromSearch: item.hiddenFromSearch,
    publicNote: item.publicNote,
    answered: item.answered === true,
    targetQuarter: item.targetQuarter,
    reviewBy: item.reviewBy,
    waitingSince: item.waitingSince,
    value: item.value ? { source: item.value.source, perYear: item.value.perYear ? { source: item.value.perYear.source } : null } : null,
    cost: item.cost ? { source: item.cost.source } : null,
    dossier: item.dossier ? { status: item.dossier.status } : null,
    status: item.status ?? null,
    version: item.version,
  };
}

// ─── Date (fuso Europe/Rome) ─────────────────────────────────────────

/**
 * L'istante con cui si calcolano trimestri e date di un giorno `AAAA-MM-GG` di Roma:
 * mezzogiorno UTC, che a Roma è sempre lo stesso giorno. Un giorno illeggibile dà adesso.
 */
export function instantOfDay(day: string | null | undefined): Date {
  const parsed = parseIsoDate(day);
  return parsed ? new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day, 12)) : new Date();
}

function formatDay(year: number, month: number, day: number): IsoDate {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` as IsoDate;
}

/** Lo stesso giorno tra `months` mesi; se quel mese è più corto, il suo ultimo giorno (31 gen + 1 → 28 feb). */
export function addMonths(day: string, months: number): IsoDate {
  const parsed = parseIsoDate(day);
  if (!parsed) throw new RangeError(`Data non valida: ${day}`);
  const index = parsed.year * 12 + (parsed.month - 1) + months;
  const year = Math.floor(index / 12);
  const month = (index % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return formatDay(year, month, Math.min(parsed.day, last));
}

/** Il giorno dopo. */
export function addDays(day: string, days: number): IsoDate {
  const parsed = parseIsoDate(day);
  if (!parsed) throw new RangeError(`Data non valida: ${day}`);
  const next = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
  return formatDay(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());
}

/**
 * Una data futura come la scrivono le decisioni: «14 gen» entro un anno da oggi (le date di
 * «Rimanda» del dialogo, §14.3), «14 gen 2028» più in là.
 */
export function futureDayLabel(day: string, today: string): string {
  const short = day < addMonths(today, 12);
  return (short ? formatDayMonth(day) : formatDate(day)) ?? day;
}

// ─── «Rimanda» (§6.4, §14.3) ─────────────────────────────────────────

export const POSTPONE_KEYS = ["un_mese", "tre_mesi", "prossimo_trimestre", "data"] as const;
export type PostponeKey = (typeof POSTPONE_KEYS)[number];

export interface PostponeOption {
  key: PostponeKey;
  label: string;
  /** La data che si salva in `review_by`; null per «Scegli una data». */
  date: IsoDate | null;
}

/**
 * Le scelte del dialogo «Rimanda», da oggi a Roma: «Tra un mese (14 nov)», «Tra tre mesi (14
 * gen)», «All'inizio del prossimo trimestre (1 gen)», «Scegli una data». Tutte nel futuro.
 */
export function postponeOptions(now: Date = new Date()): PostponeOption[] {
  const today = romeToday(now);
  const inOneMonth = addMonths(today, 1);
  const inThreeMonths = addMonths(today, 3);
  const nextQuarterStart = quarterStart(nextQuarter(currentQuarter(now)));
  return [
    { key: "un_mese", label: `Tra un mese (${futureDayLabel(inOneMonth, today)})`, date: inOneMonth },
    { key: "tre_mesi", label: `Tra tre mesi (${futureDayLabel(inThreeMonths, today)})`, date: inThreeMonths },
    { key: "prossimo_trimestre", label: `All'inizio del prossimo trimestre (${futureDayLabel(nextQuarterStart, today)})`, date: nextQuarterStart },
    { key: "data", label: "Scegli una data", date: null },
  ];
}

/** Il primo giorno che «Scegli una data» accetta: domani, a Roma (`min` del campo data). */
export function minPostponeDate(now: Date = new Date()): IsoDate {
  return addDays(romeToday(now), 1);
}

/** La data di «Rimanda»: obbligatoria e futura (a Roma). Lo stesso controllo lo rifà `decisions.ts`. */
export function checkPostponeDate(raw: unknown, now: Date = new Date()): { ok: true; date: IsoDate } | { ok: false; message: string } {
  if (typeof raw !== "string" || !parseIsoDate(raw)) return { ok: false, message: DECISION_MESSAGES.reviewByInvalid };
  if (raw <= romeToday(now)) return { ok: false, message: DECISION_MESSAGES.reviewByNotFuture };
  return { ok: true, date: raw as IsoDate };
}

// ─── «Quando» (§3.6, §6.4) ───────────────────────────────────────────

export interface WhenOption {
  choice: WhenChoice;
  /** «Questo trimestre (T4 2026)», «Prossimo trimestre (T1 2027)», «Più avanti». */
  label: string;
}

export function whenOptions(now: Date = new Date()): WhenOption[] {
  return WHEN_CHOICES.map((choice) => ({ choice, label: whenChoiceLabel(choice, now) }));
}

/**
 * La scelta che corrisponde al trimestre salvato: «Più avanti» senza trimestre; null per un
 * trimestre che non è né questo né il prossimo (passato, o scelto via MCP del team).
 */
export function currentWhenChoice(targetQuarter: string | null | undefined, now: Date = new Date()): WhenChoice | null {
  if (!targetQuarter) return "piu_avanti";
  for (const choice of WHEN_CHOICES) if (whenChoiceToQuarter(choice, now) === targetQuarter) return choice;
  return null;
}

/**
 * Le etichette di «Quando» che la pagina ha mostrato, calcolate da `pageToday` (il giorno a
 * Roma con cui la pagina è stata letta), dicono ancora il trimestre che si salva adesso? A
 * cavallo di un trimestre, con la pagina letta prima, no: «Prossimo trimestre (T1 2027)»
 * salverebbe 2027-Q2. Senza `pageToday` (una chiamata che non ha mostrato etichette) non c'è
 * niente da controllare; un giorno illeggibile è un ingresso che la pagina non manda.
 */
export function checkWhenLabels(choice: WhenChoice, pageToday: unknown, now: Date = new Date()): "ok" | "non_valido" | "superate" {
  if (pageToday === undefined) return "ok";
  if (typeof pageToday !== "string" || !parseIsoDate(pageToday)) return "non_valido";
  return whenChoiceToQuarter(choice, instantOfDay(pageToday)) === whenChoiceToQuarter(choice, now) ? "ok" : "superate";
}

// ─── Pulsanti per fase (§6.4) ────────────────────────────────────────

/** Le decisioni che hanno un pulsante nel capitolo «Decisione». */
export const DECISION_KEYS = [
  "approva",
  "rimanda",
  "serve_info",
  "non_avviare",
  "doppione",
  "archivia",
  "riapri",
  "segna_diffusa",
  "segna_realizzato",
] as const;
export type DecisionKey = (typeof DECISION_KEYS)[number];

/** Le etichette dei pulsanti (§6.4, §14.3). «Segna come in realizzazione» sta in «Realizzazione». */
export const DECISION_LABEL: Readonly<Record<DecisionKey | "segna_in_realizzazione", string>> = Object.freeze({
  approva: "Approva",
  rimanda: "Rimanda",
  serve_info: "Serve info",
  non_avviare: "Non avviare",
  doppione: "Doppione di…",
  archivia: "Archivia",
  riapri: "Riapri",
  segna_diffusa: "Segna come diffusa",
  segna_realizzato: "Segna come realizzato",
  segna_in_realizzazione: "Segna come in realizzazione",
});

export interface DecisionLayout {
  /** Il solo pulsante pieno, se c'è. */
  primary: DecisionKey | null;
  /** Pulsanti `outline`, nell'ordine. */
  outline: DecisionKey[];
  /** Voci del menu «⋯»; vuoto: il menu non c'è. */
  menu: DecisionKey[];
}

const NO_BUTTONS: DecisionLayout = Object.freeze({ primary: null, outline: [], menu: [] }) as DecisionLayout;

/** Il dossier collegato: nessuno, attivo, attivo e «In uso» o «Misura del valore», chiuso. */
export type DossierSituation = "nessuno" | "attivo" | "in_uso" | "chiuso";

export function dossierSituation(dossier: { status: CaseStatus } | null | undefined): DossierSituation {
  if (!dossier) return "nessuno";
  if (dossier.status === "chiuso") return "chiuso";
  return DOSSIER_IN_USE_STATUSES.includes(dossier.status) ? "in_uso" : "attivo";
}

function layout(primary: DecisionKey | null, outline: DecisionKey[], menu: DecisionKey[]): DecisionLayout {
  return { primary, outline, menu };
}

/** Dove riporta «Riapri»: «Da decidere», oppure la fase in cui la scheda era prima di archiviarla. */
export type ReopenDestination = "da_decidere" | "fase_di_prima";

/**
 * Dove riporta «Riapri» una scheda chiusa, con la regola di `riapri` di decisions.ts: da
 * `rejected` torna `proposed`; da archiviata `status` resta com'era (non esiste «Approvato → Da
 * decidere», §15 punto 10). Quindi `da_decidere` se lo `status` dopo è `draft` o `proposed`,
 * altrimenti `fase_di_prima` (Approvato, In realizzazione, Realizzato).
 * Senza `status` (la proiezione dei revisori non lo porta) lo si sa solo per un «Non avviato»:
 * ARCHIVIATA e DOPPIONE vengono prima di NON_AVVIATA (§3.5), quindi è `rejected` e non
 * archiviata. Per un'archiviata senza `status`: null, non si sa.
 */
export function reopenDestination(item: Pick<DecisionItem, "subState" | "status">): ReopenDestination | null {
  if (item.status) {
    const after = item.status === "rejected" ? "proposed" : item.status;
    return after === "draft" || after === "proposed" ? "da_decidere" : "fase_di_prima";
  }
  return item.subState === "non_avviato" ? "da_decidere" : null;
}

/**
 * I pulsanti del capitolo «Decisione» e del pannello laterale, tabella di §6.4. Chi non decide
 * (`canDecide` falso: contributori) non ne ha nessuno. Le regole restano nel servizio: qui c'è
 * solo quello che si mostra.
 */
export function decisionLayout(
  item: Pick<DecisionItem, "phase" | "subState" | "kind" | "dossier" | "status">,
  opts: { canDecide: boolean },
): DecisionLayout {
  if (!opts.canDecide) return NO_BUTTONS;
  switch (item.phase) {
    case "da_valutare":
      return layout("approva", ["rimanda", "serve_info", "non_avviare"], ["doppione", "archivia"]);
    case "approvato":
      // «Da costruire»: il passo dopo è in «Realizzazione» (Avvia, o Segna come in realizzazione).
      return item.kind === "da_diffondere"
        ? layout("segna_diffusa", ["non_avviare"], ["archivia"])
        : layout(null, ["non_avviare"], ["doppione", "archivia"]);
    case "in_realizzazione": {
      const dossier = dossierSituation(item.dossier);
      if (dossier === "nessuno") return layout("segna_realizzato", ["non_avviare"], ["archivia"]);
      if (dossier === "chiuso") return layout(null, ["non_avviare"], ["archivia"]);
      // Dossier attivo: «Archivia» e «Non avviare» solo a dossier chiuso.
      return dossier === "in_uso" ? layout("segna_realizzato", [], []) : NO_BUTTONS;
    }
    case "realizzato":
      return layout(null, [], ["archivia"]);
    case "chiuso":
      // Con un dossier collegato il servizio non riporta una scheda in «Da decidere» (`riapri`
      // di decisions.ts): un «Non avviato» dopo la chiusura del dossier (§6.5), o un'archiviata
      // ancora `draft`, `proposed` o `rejected` (righe di prima dell'area), resta chiusa. Nessun
      // pulsante, mai uno che fallisce sempre. Un'archiviata con il dossier di cui non si sa lo
      // `status` è, con le decisioni dell'area, una che torna in «In realizzazione» o
      // «Realizzato»: il pulsante c'è.
      return item.dossier && reopenDestination(item) === "da_decidere" ? NO_BUTTONS : layout("riapri", [], []);
  }
}

/**
 * «Segna come in realizzazione» nel capitolo «Realizzazione» (§6.5, §3.7): solo Lateral Space
 * con ruolo da revisore, use case approvato «Da costruire» senza dossier, sezione Casi d'uso
 * spenta per il workspace. Con i dossier accesi c'è «Avvia la realizzazione».
 */
export function showMarkInProgress(
  item: Pick<DecisionItem, "phase" | "kind" | "dossier">,
  opts: { canMarkInProgress: boolean; dossiersEnabled: boolean },
): boolean {
  return opts.canMarkInProgress && !opts.dossiersEnabled && item.phase === "approvato" && item.kind === "da_costruire" && !item.dossier;
}

// ─── Decisione attuale (§6.4) ────────────────────────────────────────

/** Il titolo del capitolo «Decisione» (§6.4). La fase sta una volta sola, nella pillola della testata. */
export const DECISION_SECTION_TITLE = "Decisione";

/** «in attesa da oggi», «in attesa da 1 giorno», «in attesa da 6 giorni» (D8: nessuna soglia). */
export function waitingText(since: string, today: string): string {
  const days = parseIsoDate(since) && parseIsoDate(today) ? waitingDays(since, today) : 0;
  return days <= 0 ? "in attesa da oggi" : `in attesa ${waitingLabel(days)}`;
}

function capitalized(text: string): string {
  return text.charAt(0).toLocaleUpperCase("it-IT") + text.slice(1);
}

/**
 * Sotto il titolo «Decisione» (§6.4), solo quello che la pillola della testata non dice già
 * (H4p: la fase si mostra una volta sola): «In attesa da 6 giorni» per una scheda da decidere,
 * «In attesa di risposta da chi ha proposto» in «Serve info», «Deciso il 3 ott» per una non
 * avviata, se la pagina conosce il giorno (`closedOn`). null altrimenti: «Rimandata al 14 gen»,
 * «Approvato · T1 2027», «Doppione di XX-0007» e il resto li dice già la pillola.
 */
export function decisionNote(
  item: Pick<DecisionItem, "phase" | "subState" | "waitingSince">,
  today: string,
  opts: { closedOn?: string | null } = {},
): string | null {
  switch (item.phase) {
    case "da_valutare":
      if (item.subState === "serve_info") return "In attesa di risposta da chi ha proposto";
      if (item.subState === "rimandata") return null;
      return capitalized(waitingText(item.waitingSince, today));
    case "chiuso": {
      if (item.subState !== "non_avviato" || !opts.closedOn) return null;
      const day = formatDayInYear(opts.closedOn, instantOfDay(today));
      return day ? `Deciso il ${day}` : null;
    }
    default:
      return null;
  }
}

// ─── Nota pubblica (§6.4, §6.8) ──────────────────────────────────────

export const PUBLIC_NOTE_MAX = TEXT_LIMITS.publicNote;

/** Il segnaposto di «Oscura testo» (§1.2 punto 10, `REDACTED_TEXT` del servizio). */
export const REDACTED_PLACEHOLDER = "[testo rimosso]";

export const PUBLIC_NOTE_TEXT = Object.freeze({
  label: "Nota pubblica",
  /** Il campo del capitolo «Decisione»: facoltativo, non serve per «Approva» (§6.4). */
  optionalLabel: "Nota pubblica (facoltativa)",
  /** Nei dialoghi dopo una risposta a «Serve info» (D17): la nota è ancora la domanda. */
  answeredHint: "È ancora la domanda fatta a chi ha proposto: aggiornala o svuotala.",
  /** Avviso fisso sotto il campo (§6.4, §14.3). */
  warning: "Chi conosce il codice la legge tramite Claude. Non scrivere dati personali.",
  /** Seconda riga, solo per una scheda nascosta alla ricerca. */
  hiddenWarning: "Questa scheda è nascosta alla ricerca: tramite Claude chi conosce il codice vede solo la fase.",
  saved: "Salvata.",
});

/** Le righe sotto la nota pubblica: l'avviso, e per una scheda nascosta la seconda riga. */
export function publicNoteHints(hiddenFromSearch: boolean): string[] {
  return hiddenFromSearch ? [PUBLIC_NOTE_TEXT.warning, PUBLIC_NOTE_TEXT.hiddenWarning] : [PUBLIC_NOTE_TEXT.warning];
}

/**
 * Il testo con cui si apre la nota di «Serve info» e «Non avviare»: quella salvata. Una nota
 * oscurata non si ripropone: il segnaposto non è una nota.
 */
export function publicNotePrefill(note: string | null | undefined): string {
  if (typeof note !== "string") return "";
  return note.trim() === REDACTED_PLACEHOLDER ? "" : note;
}

/** Le decisioni che, dopo una risposta a «Serve info», propongono di aggiornare la nota pubblica (D17). */
export const NOTE_AFTER_ANSWER_DECISIONS: readonly DecisionKey[] = Object.freeze(["approva", "rimanda", "doppione", "archivia"]);

/**
 * Il dialogo propone la nota pubblica da aggiornare? Solo dopo una risposta a «Serve info» non
 * ancora decisa, con una nota salvata (la domanda), e solo per le decisioni che non hanno già il
 * loro campo della nota («Serve info» e «Non avviare» lo hanno).
 */
export function proposesNoteUpdate(item: Pick<DecisionItem, "answered" | "publicNote">, key: DecisionKey): boolean {
  return item.answered === true && typeof item.publicNote === "string" && item.publicNote.trim() !== "" && NOTE_AFTER_ANSWER_DECISIONS.includes(key);
}

/** «37 / 1.000»: il contatore della nota. */
export function publicNoteCounter(text: string): string {
  const max = String(PUBLIC_NOTE_MAX).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${text.length} / ${max}`;
}

/** La nota di «Serve info» e «Non avviare»: obbligatoria, al massimo 1.000 caratteri. */
export function checkDecisionNote(text: string): { ok: true; value: string } | { ok: false; message: string } {
  const checked = validatePublicNote(text, { required: true });
  if (!checked.ok) return checked;
  return { ok: true, value: checked.value ?? "" };
}

/**
 * Il campo «Nota pubblica» all'uscita: cosa salvare, oppure niente se non è cambiato (spazi
 * in testa e in coda non contano; vuoto vuol dire nessuna nota).
 */
export function publicNoteChange(
  saved: string | null | undefined,
  draft: string,
): { change: false } | { change: true; value: string | null } | { change: false; error: string } {
  const checked = validatePublicNote(draft, { required: false });
  if (!checked.ok) return { change: false, error: checked.message };
  const before = typeof saved === "string" && saved.trim() ? saved.trim() : null;
  return checked.value === before ? { change: false } : { change: true, value: checked.value };
}

/**
 * Il testo del campo è quello di una nota salvata: spazi in testa e in coda non contano, il
 * servizio salva la nota senza.
 */
export function draftFollowsSavedNote(draft: string, saved: string | null | undefined): boolean {
  return draft.trim() === (typeof saved === "string" ? saved.trim() : "");
}

/** Lo stato del campo «Nota pubblica» del capitolo. */
export interface PublicNoteFieldState {
  /** Il testo nel campo. */
  draft: string;
  /** La nota della pagina con cui il campo si è allineato l'ultima volta. */
  synced: string | null;
  /**
   * La nota che il campo ha appena salvato, finché la pagina non porta una nota nuova;
   * undefined: nessuna. La pagina può arrivare già con la decisione dopo (le scritture della
   * coda), senza mai mostrare questa.
   */
  ownSave?: string | null;
}

export function publicNoteFieldState(pageNote: string | null): PublicNoteFieldState {
  return { draft: pageNote ?? "", synced: pageNote };
}

/**
 * Il campo quando la pagina porta un'altra nota (un dialogo, un'altra persona, la propria
 * scrittura riletta): la prende solo se il testo del campo è quello salvato prima (dalla
 * pagina o dal campo stesso), cioè se non lo si sta scrivendo. Il testo scritto resta (§6.8).
 * Stessa nota: lo stesso oggetto.
 */
export function followPageNote(state: PublicNoteFieldState, pageNote: string | null): PublicNoteFieldState {
  if (state.synced === pageNote) return state;
  const untouched =
    draftFollowsSavedNote(state.draft, state.synced) || (state.ownSave !== undefined && draftFollowsSavedNote(state.draft, state.ownSave));
  return { draft: untouched ? (pageNote ?? "") : state.draft, synced: pageNote };
}

/** La nota con cui si confronta il campo all'uscita: quella appena salvata dal campo, o quella della pagina. */
export function lastSavedNote(state: PublicNoteFieldState): string | null {
  return state.ownSave !== undefined ? state.ownSave : state.synced;
}

// ─── «Approva» (§6.4, §1.2 punto 4) ──────────────────────────────────

/** Le fonti del costo che sono una valutazione del team (o il dossier, che viene dopo); «stima» è «Benefici e costi». */
const TEAM_COST_SOURCES: readonly CostSource[] = ["stima", "team_importo", "team_fascia", "dossier"];

/**
 * Vero quando né Valore né Costo vengono dal team: il dialogo «Approva» mostra l'avviso non
 * bloccante «Valore e Costo non sono ancora valutati dal team.» (D8: nessuna regola che blocca).
 */
export function teamValuationMissing(item: Pick<DecisionItem, "value" | "cost">): boolean {
  const valueFromTeam = item.value?.source === "team" || item.value?.perYear?.source === "team";
  const costFromTeam = item.cost !== null && TEAM_COST_SOURCES.includes(item.cost.source);
  return !valueFromTeam && !costFromTeam;
}

// ─── «Doppione di…» (§6.4) ───────────────────────────────────────────

export interface DuplicateCandidate {
  id: string;
  code: string | null;
  title: string;
}

export const DUPLICATE_CANDIDATES_MAX = 20;

/**
 * Solo id, codice e titolo degli use case di «Doppione di…»: quello che il capitolo, reso sul
 * server, passa al browser. Un `HubItem` intero (note, valori, costi, dossier) non ci arriva.
 */
export function toDuplicateCandidates(items: readonly DuplicateCandidate[] | null | undefined): DuplicateCandidate[] | undefined {
  return items?.map(({ id, code, title }) => ({ id, code, title }));
}

/** Minuscole e senza accenti, per cercare «perche» e trovare «Perché». */
function folded(text: string): string {
  return text.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

/**
 * Gli use case che possono essere l'originale: dello stesso workspace (li passa la pagina),
 * con un codice, **esclusa la scheda stessa** (per id e per codice). Con una ricerca, quelli
 * che la contengono nel titolo o nel codice, senza distinguere maiuscole e accenti.
 */
export function duplicateCandidates(
  items: readonly DuplicateCandidate[],
  self: Pick<DuplicateCandidate, "id" | "code">,
  query = "",
  limit = DUPLICATE_CANDIDATES_MAX,
): Array<DuplicateCandidate & { code: string }> {
  const selfId = self.id.toLowerCase();
  const selfCode = normalizeUseCaseCode(self.code);
  const needle = folded(query.trim());
  const out: Array<DuplicateCandidate & { code: string }> = [];
  for (const item of items) {
    const code = normalizeUseCaseCode(item.code);
    if (!code || item.id.toLowerCase() === selfId || code === selfCode) continue;
    if (needle && !folded(item.title).includes(needle) && !folded(code).includes(needle)) continue;
    out.push({ ...item, code });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Un codice scritto per intero nella ricerca («xx-0007»), da usare anche se non è
 * nell'elenco; null se non è un codice o se è quello della scheda stessa.
 */
export function typedDuplicateCode(query: string, self: Pick<DuplicateCandidate, "code">): string | null {
  const code = normalizeUseCaseCode(query);
  return code && code !== normalizeUseCaseCode(self.code) ? code : null;
}

// ─── «Archivia» (§14.3) ──────────────────────────────────────────────

export const ARCHIVE_OPTIONS: ReadonlyArray<{ reason: ArchiveReason; label: string }> = ARCHIVE_REASONS.map((reason) => ({
  reason,
  label: ARCHIVE_REASON_LABEL[reason],
}));

// ─── Testi dei dialoghi e toast (§14.3) ──────────────────────────────

export const DIALOG_COMMON_TEXT = Object.freeze({
  cancel: "Annulla",
  /**
   * Il nome del menu «⋯» delle decisioni. «Altre azioni» è del menu della testata (§4.1,
   * §6.1), che sulla scheda sta sulla stessa pagina e ha anche lui «Archivia».
   */
  moreDecisions: "Altre decisioni",
  when: "Quando",
});

export interface DialogText {
  title: string;
  /** Testo sotto il titolo; null se il dialogo non ne ha. */
  description: string | null;
  confirm: string;
}

/** «Approva XX-0012»; senza codice, il solo verbo. */
function withCode(text: string, code: string | null | undefined, suffix = ""): string {
  return code ? `${text} ${code}${suffix}` : `${text}${suffix}`;
}

/**
 * Titolo, testo e pulsante di ogni dialogo, come in §14.3. «Riapri» dice «Torna in «Da
 * decidere».» solo quando la scheda ci torna davvero (`reopensTo`, da `reopenDestination`):
 * un'archiviata da Approvato, In realizzazione o Realizzato torna lì, e §14.3 non ha un testo
 * per quel caso, quindi il dialogo non ne ha nessuno (lo stesso se non si sa).
 */
export function dialogText(
  key: DecisionKey | "segna_in_realizzazione",
  code: string | null | undefined,
  opts: { reopensTo?: ReopenDestination | null } = {},
): DialogText {
  switch (key) {
    case "approva":
      return { title: withCode("Approva", code), description: "Quando lo facciamo?", confirm: "Approva" };
    case "rimanda":
      return { title: withCode("Rimanda", code), description: "Quando lo riguardiamo?", confirm: "Rimanda" };
    case "serve_info":
      return { title: "Cosa serve sapere?", description: null, confirm: "Chiedi informazioni" };
    case "non_avviare":
      return { title: "Perché non lo avviamo?", description: null, confirm: "Non avviare" };
    case "doppione":
      return { title: "Di quale use case è un doppione?", description: "Si chiude e chi lo segue vede il codice dell'altro.", confirm: "Segna come doppione" };
    case "archivia":
      return { title: "Perché lo archivi?", description: "Non si cancella niente: si può riaprire.", confirm: "Archivia" };
    case "riapri":
      return {
        title: code ? `Riaprire ${code}?` : "Riaprire?",
        description: opts.reopensTo === "da_decidere" ? "Torna in «Da decidere»." : null,
        confirm: "Riapri",
      };
    case "segna_diffusa":
      return { title: "Segnare come diffusa?", description: "La best practice risulta realizzata.", confirm: "Segna come diffusa" };
    case "segna_realizzato":
      return { title: "Segnare come realizzato?", description: "Lo use case risulta realizzato. Il dossier resta com'è.", confirm: "Segna come realizzato" };
    case "segna_in_realizzazione":
      return {
        title: "Segnare come in realizzazione?",
        description: "Senza dossier: la sezione Casi d'uso è spenta per questo workspace.",
        confirm: "Segna come in realizzazione",
      };
  }
}

/** I testi in più dei dialoghi (§14.3). */
export const DIALOG_EXTRA_TEXT = Object.freeze({
  approveNoValuation: "Valore e Costo non sono ancora valutati dal team.",
  approveShowToColleagues: "Mostralo ai colleghi (ricerca di Claude e lista)",
  postponeNote: "Fino ad allora resta fuori da «Da decidere». Chi l'ha proposto vede «Valutata, da decidere».",
  postponeDateLabel: "Data",
  duplicateSearch: "Cerca per titolo o codice",
  duplicateEmpty: "Nessuno use case con questa ricerca.",
  duplicateUseTyped: "Usa il codice",
  duplicateMissing: "Scegli lo use case originale.",
  archiveMissing: DECISION_MESSAGES.reasonInvalid,
});

/** Il toast dopo una decisione riuscita, testi esatti di §14.3. */
export function decisionToast(decision: Decision, today: string): string {
  switch (decision.type) {
    case "approva":
      return "Approvato. Lo trovi nella Roadmap.";
    case "rimanda":
      return `Rimandato al ${futureDayLabel(decision.reviewBy, today)}.`;
    case "serve_info":
      return "Richiesta salvata. La nota è visibile a chi conosce il codice.";
    case "non_avviare":
      return "Segnato come non avviato.";
    case "doppione":
      return `Segnato come doppione di ${normalizeUseCaseCode(decision.ofCode) ?? decision.ofCode.trim()}.`;
    case "archivia":
      return "Archiviato.";
    case "riapri":
      return "Riaperto.";
    case "segna_diffusa":
      return "Segnata come diffusa.";
    case "segna_realizzato":
      return "Segnato come realizzato.";
    case "segna_in_realizzazione":
      return "Segnato come in realizzazione.";
  }
}

/** Il toast di «Nascondi dalla ricerca» e «Mostra ai colleghi» (§8.6). */
export function visibilityToast(hidden: boolean): string {
  return hidden ? "Nascosta alla ricerca." : "Visibile ai colleghi.";
}

// ─── Ingresso e risposta delle server action ─────────────────────────

/** Una decisione che la pagina manda a `decideUseCaseAction` («Segna come in realizzazione» ha la sua action). */
export type PageDecision = Exclude<Decision, { type: "segna_in_realizzazione" }>;

/** La nota pubblica facoltativa di «Approva», «Rimanda», «Doppione di…» e «Archivia» dopo una risposta (D17). */
const optionalNote = z.string().max(PUBLIC_NOTE_MAX * 2).optional();

/**
 * Le forme che la pagina manda: «Quando» solo con le tre scelte (il trimestre esplicito è del
 * MCP del team), la nota di «Non avviare» sempre (il modo `legacy` è solo della PATCH REST), la
 * nota facoltativa delle altre decisioni solo se cambia (D17), nessun campo in più. Le regole
 * (fase, data futura, nota obbligatoria, doppione) le applica `decisions.ts` nel servizio.
 */
const pageDecisionSchema = z.discriminatedUnion("type", [
  z
    .object({ type: z.literal("approva"), quando: z.enum(WHEN_CHOICES), showToColleagues: z.boolean().optional(), publicNote: optionalNote })
    .strict(),
  z.object({ type: z.literal("rimanda"), reviewBy: z.string().max(10), publicNote: optionalNote }).strict(),
  z.object({ type: z.literal("serve_info"), publicNote: z.string().max(PUBLIC_NOTE_MAX * 2) }).strict(),
  z.object({ type: z.literal("non_avviare"), publicNote: z.string().max(PUBLIC_NOTE_MAX * 2) }).strict(),
  z.object({ type: z.literal("doppione"), ofCode: z.string().max(40), publicNote: optionalNote }).strict(),
  z.object({ type: z.literal("archivia"), reason: z.enum(ARCHIVE_REASONS), publicNote: optionalNote }).strict(),
  z.object({ type: z.literal("riapri") }).strict(),
  z.object({ type: z.literal("segna_diffusa") }).strict(),
  z.object({ type: z.literal("segna_realizzato") }).strict(),
]);

/** Il messaggio di un ingresso che la pagina non manderebbe mai. */
export const INVALID_DECISION_INPUT = "Decisione non valida.";

/** Una action che non risponde (rete, server): lo stesso testo di `riprova` del servizio. */
export const ACTION_FAILED_MESSAGE = "Non riusciamo a salvare. Riprova.";

export function parseDecisionInput(raw: unknown): { ok: true; decision: PageDecision } | { ok: false; message: string } {
  const parsed = pageDecisionSchema.safeParse(raw);
  return parsed.success ? { ok: true, decision: parsed.data as PageDecision } : { ok: false, message: INVALID_DECISION_INPUT };
}

/** «Quando» dalla pagina: una delle tre scelte. */
export function parseWhenChoice(raw: unknown): WhenChoice | null {
  return typeof raw === "string" && (WHEN_CHOICES as readonly string[]).includes(raw) ? (raw as WhenChoice) : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Workspace, use case e versione di una action: due UUID e un intero. */
export function isActionTarget(workspaceId: unknown, useCaseId: unknown, expectedVersion: unknown): boolean {
  return (
    typeof workspaceId === "string" &&
    UUID.test(workspaceId) &&
    typeof useCaseId === "string" &&
    UUID.test(useCaseId) &&
    typeof expectedVersion === "number" &&
    Number.isSafeInteger(expectedVersion) &&
    expectedVersion >= 0
  );
}

/**
 * La risposta di una action della pagina: la nuova `version` e il toast, oppure l'errore del
 * servizio con il suo messaggio (per `versione_superata` il testo esatto di §6.8).
 */
export type DecisionActionResult =
  | { ok: true; version: number; message: string | null }
  | { ok: false; error: ServiceError; message: string; fieldErrors?: Record<string, string> };

/**
 * Gli errori che vogliono dire «la pagina è vecchia», anche con la `version` giusta: lo stato
 * del dossier sta in `uc_cases`, il ruolo e l'accesso nel workspace, l'area nella
 * configurazione, la fase dipende anche dal giorno; niente di questo alza `use_cases.version`.
 * Senza rileggerla la pagina mostrerebbe un pulsante che il servizio rifiuta a ogni clic.
 * Fuori: `dati_non_validi` (l'ingresso; il dialogo mostra l'errore e tiene il testo) e
 * `riprova` (un guasto passeggero: la pagina resta com'è per riprovare, e rileggerla con il
 * database che non risponde la sostituirebbe con la pagina d'errore).
 */
export const STALE_PAGE_ERRORS: readonly ServiceError[] = Object.freeze([
  "versione_superata",
  "transizione_non_ammessa",
  "permesso_mancante",
  "non_trovato",
  "area_spenta",
]) as readonly ServiceError[];

/**
 * Dopo questa risposta la pagina si rilegge (§9.1, §6.8): dopo una scrittura riuscita e dopo
 * un errore di `STALE_PAGE_ERRORS`. Lo usano le action (`revalidatePath`) e il browser
 * (`router.refresh()` di `useDecisionRunner`).
 */
export function rereadsPage(result: DecisionActionResult): boolean {
  return result.ok || STALE_PAGE_ERRORS.includes(result.error);
}

/**
 * La risposta quando le etichette di «Quando» della pagina sono di un trimestre ormai passato
 * (`checkWhenLabels`): niente si salva, la pagina si rilegge con le etichette nuove e si
 * sceglie di nuovo. Nel dialogo «Approva» il messaggio sta sotto le scelte (`field`); dal
 * controllo «Quando» arriva come toast.
 */
export function staleWhenLabelsResult(opts: { field: boolean }): DecisionActionResult {
  const message = DECISION_MESSAGES.whenInvalid;
  return opts.field
    ? { ok: false, error: "dati_non_validi", message, fieldErrors: { quando: message } }
    : { ok: false, error: "dati_non_validi", message };
}

/** Dal risultato del servizio alla risposta della action: nessun dato della scheda oltre alla versione. */
export function toActionResult(
  result: { ok: true; value: { version: number } } | { ok: false; error: ServiceError; message: string; fieldErrors?: Record<string, string> },
  message: string | null,
): DecisionActionResult {
  if (result.ok) return { ok: true, version: result.value.version, message };
  return result.fieldErrors && Object.keys(result.fieldErrors).length
    ? { ok: false, error: result.error, message: result.message, fieldErrors: result.fieldErrors }
    : { ok: false, error: result.error, message: result.message };
}

// ─── La coda delle scritture nel browser (§6.4, §6.8) ────────────────

/*
 * Ogni scrittura porta la `version` letta con la pagina (§6.8). Nel capitolo «Decisione» le
 * scritture arrivano una dopo l'altra: la nota pubblica si salva all'uscita dal campo, e
 * l'uscita è il clic sul controllo successivo («Quando», «Serve info»…). Senza la coda le due
 * scritture partirebbero con la stessa versione, e la seconda riceverebbe sempre
 * `versione_superata` anche se nessun altro ha toccato lo use case. Quindi:
 * - una scrittura parte solo quando quella prima è finita;
 * - parte con la versione più recente che si conosce: quella della pagina, o quella lasciata
 *   dall'ultima scrittura riuscita **dalla stessa coda** sullo stesso use case. Una modifica
 *   di un'altra persona resta una versione superata, anche quando arriva mentre il servizio
 *   rilegge la scheda dopo la propria scrittura.
 *
 * Senza React: la usa `useDecisionRunner` di `decision-buttons.tsx`.
 */

/** Quello che una scrittura restituisce: la nuova `version` quando riesce. */
export type VersionedResult = { ok: true; version: number } | { ok: false };

export interface DecisionWriteQueue {
  /**
   * Manda `write` dopo le scritture già in coda, con la versione da portare. `pageVersion` è
   * quella letta con la pagina; un errore di `write` passa a chi chiama e la coda va avanti.
   */
  send<T extends VersionedResult>(useCaseId: string, pageVersion: number, write: (version: number) => Promise<T>): Promise<T>;
  /** La versione con cui partirebbe adesso una scrittura su quello use case. */
  versionFor(useCaseId: string, pageVersion: number): number;
}

export function createDecisionWriteQueue(): DecisionWriteQueue {
  let tail: Promise<unknown> = Promise.resolve();
  /** L'ultima versione restituita da una scrittura riuscita, per use case. */
  const written = new Map<string, number>();

  const versionFor = (useCaseId: string, pageVersion: number) => Math.max(pageVersion, written.get(useCaseId.toLowerCase()) ?? pageVersion);

  return {
    versionFor,
    send(useCaseId, pageVersion, write) {
      const key = useCaseId.toLowerCase();
      const run = tail.then(async () => {
        const sent = versionFor(key, pageVersion);
        const result = await write(sent);
        if (result.ok && Number.isSafeInteger(result.version)) {
          // Una scrittura alza `version` al massimo di uno (il trigger della 0020), ma il
          // servizio restituisce la versione della scheda riletta dopo: una versione più alta
          // viene da un'altra persona, arrivata tra la scrittura e la rilettura. Si tiene solo
          // quella della propria scrittura, così la scrittura dopo resta una versione superata.
          const own = Math.min(result.version, sent + 1);
          written.set(key, Math.max(own, written.get(key) ?? own));
        }
        return result;
      });
      tail = run.catch(() => undefined);
      return run;
    },
  };
}
