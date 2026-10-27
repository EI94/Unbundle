/**
 * Il salvataggio automatico di una risposta della pagina `/rispondi/<token>` (SPEC §4.4 punto 4):
 * un riduttore puro, così i tempi e gli stati si provano senza browser.
 *
 * - Ogni modifica (testo o «Non lo so») aspetta 1,5 secondi dall'ultimo tasto; uscire dal campo
 *   salva subito. Si salva solo se il valore è diverso dall'ultimo salvato.
 * - Una chiamata alla volta: una modifica arrivata durante il salvataggio riparte quando finisce.
 * - Esiti: «Salvato», «Salvataggio…», «Non salvato: riprova» (rete o server; si riprova alla
 *   prossima modifica o uscendo dal campo). Un blocco del testo (nomi, email, telefoni, dati
 *   sanitari) non salva niente e si mostra come errore del campo; gli avvisi stanno sotto il campo.
 *
 * Modulo puro: niente React, niente rete.
 */

export const AUTOSAVE_DELAY_MS = 1500;

export interface DraftValue {
  text: string;
  dontKnow: boolean;
}

/** Un problema del testo, come lo restituisce il server (`Issue`). */
export interface DraftIssue {
  code: string;
  message: string;
  field?: string;
}

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error" | "blocked";

export interface AutosaveState {
  /** Quello che c'è adesso nel campo. */
  value: DraftValue;
  /** L'ultimo valore che il server ha salvato. */
  saved: DraftValue;
  /** Il valore della chiamata in corso, oppure null. */
  inFlight: DraftValue | null;
  status: AutosaveStatus;
  /** Quando parte il salvataggio (millisecondi), oppure null. */
  dueAt: number | null;
  /** Il blocco del testo: nessun salvataggio finché non cambia il testo. */
  fieldError: DraftIssue[];
  /** Avvisi dell'ultimo salvataggio riuscito. */
  warnings: DraftIssue[];
  savedAt: string | null;
  /** Almeno un salvataggio riuscito in questa visita: da qui «Salvato». */
  savedThisVisit: boolean;
}

export type AutosaveEvent =
  | { type: "edit"; value: DraftValue; now: number }
  | { type: "blur"; now: number }
  | { type: "start"; value: DraftValue }
  | { type: "success"; value: DraftValue; savedAt: string; warnings: readonly DraftIssue[] }
  | { type: "blocked"; value: DraftValue; issues: readonly DraftIssue[] }
  | { type: "failure"; value: DraftValue };

/** Lo stesso valore, per il server: testo senza spazi ai bordi; con «Non lo so» il testo non conta. */
export function sameDraft(a: DraftValue, b: DraftValue): boolean {
  if (a.dontKnow !== b.dontKnow) return false;
  return a.dontKnow || a.text.trim() === b.text.trim();
}

export function initialAutosave(value: DraftValue, savedAt: string | null = null): AutosaveState {
  // «Salvato» compare solo dopo la prima modifica di questa visita.
  return { value, saved: value, inFlight: null, status: "idle", dueAt: null, fieldError: [], warnings: [], savedAt, savedThisVisit: false };
}

export function autosaveReducer(state: AutosaveState, event: AutosaveEvent): AutosaveState {
  switch (event.type) {
    case "edit": {
      const changed = !sameDraft(event.value, state.value);
      const value = event.value;
      if (sameDraft(value, state.saved) && !state.inFlight) {
        // Tornato al valore salvato: niente da salvare.
        return { ...state, value, status: state.savedThisVisit ? "saved" : "idle", dueAt: null, fieldError: changed ? [] : state.fieldError };
      }
      return { ...state, value, status: "pending", dueAt: event.now + AUTOSAVE_DELAY_MS, fieldError: changed ? [] : state.fieldError };
    }
    case "blur": {
      if (state.status === "blocked" || sameDraft(state.value, state.saved) || state.inFlight) return state;
      return { ...state, status: "pending", dueAt: event.now };
    }
    case "start":
      return { ...state, inFlight: event.value, status: "saving", dueAt: null };
    case "success": {
      const again = !sameDraft(state.value, event.value);
      return {
        ...state,
        saved: event.value,
        inFlight: null,
        savedAt: event.savedAt,
        savedThisVisit: true,
        warnings: [...event.warnings],
        fieldError: [],
        status: again ? "pending" : "saved",
        dueAt: again ? (state.dueAt ?? 0) : null,
      };
    }
    case "blocked": {
      const again = !sameDraft(state.value, event.value);
      return { ...state, inFlight: null, fieldError: again ? [] : [...event.issues], warnings: [], status: again ? "pending" : "blocked", dueAt: again ? (state.dueAt ?? 0) : null };
    }
    case "failure": {
      const again = !sameDraft(state.value, event.value);
      return { ...state, inFlight: null, status: again ? "pending" : "error", dueAt: again ? (state.dueAt ?? 0) : null };
    }
  }
}

/** Il valore da salvare adesso, oppure null (si aspetta, è già salvato, c'è già una chiamata o un blocco). */
export function dueDraft(state: AutosaveState, now: number): DraftValue | null {
  if (state.inFlight || state.status !== "pending" || state.dueAt === null || state.dueAt > now) return null;
  return sameDraft(state.value, state.saved) ? null : state.value;
}

/** Quanto aspettare prima di controllare di nuovo (millisecondi), oppure null. */
export function waitFor(state: AutosaveState, now: number): number | null {
  if (state.inFlight || state.status !== "pending" || state.dueAt === null) return null;
  return Math.max(0, state.dueAt - now);
}

/** C'è qualcosa da salvare prima dell'invio (una modifica in attesa o non riuscita). */
export function needsFlush(state: AutosaveState): boolean {
  if (state.inFlight) return true;
  if (state.status === "blocked") return false;
  return !sameDraft(state.value, state.saved);
}

/** Il testo dello stato sotto il campo, oppure null. */
export function autosaveLabelKey(state: AutosaveState): "saved" | "saving" | "error" | null {
  if (state.status === "saving") return "saving";
  if (state.status === "error") return "error";
  if (state.status === "saved") return "saved";
  return null;
}
