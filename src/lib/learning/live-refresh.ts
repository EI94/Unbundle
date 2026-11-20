/**
 * (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9) Il ritmo con cui la pagina del corso, in
 * lezione, si rilegge da sola (`src/components/learning/live-refresh.tsx`), al posto del pulsante «Aggiorna»: gli
 * esercizi si aprono all'ora della scaletta, o quando chi tiene il corso li apre, e la card «Adesso» cambia da sola.
 *
 * In Next 16 una rilettura (`router.refresh`) che non arriva al server diventa una navigazione vera, e senza rete il
 * browser mostra la sua pagina «offline»: per questo, come la pagina del link del corso (`/c`, ondata 4), prima di
 * rileggere si controlla che la rete arrivi al sito, e dopo un controllo fallito si aspetta di più.
 *
 * - ogni 15 secondi, e appena la scheda torna in vista o torna la rete;
 * - senza rete, con la scheda nascosta o con un modulo che ha modifiche non salvate, niente: si riprova al giro dopo;
 * - un controllo che non raggiunge il sito raddoppia l'attesa (30, 60 secondi), fino a 2 minuti; il primo che lo
 *   raggiunge rilegge la pagina e torna a 15 secondi.
 *
 * Modulo puro: lo provano i test.
 */

/** In lezione la pagina si rilegge ogni 15 secondi. */
export const LIVE_REFRESH_SECONDS = 15;

/** L'attesa più lunga fra due controlli, dopo una serie di controlli falliti. */
export const LIVE_REFRESH_MAX_SECONDS = 120;

/** Un file piccolo del sito, che basta chiedere per sapere se la rete arriva al sito. */
export const LIVE_REFRESH_PROBE = "/favicon.ico";

/** L'attesa prima del prossimo controllo, in millisecondi: 15 s, poi il doppio a ogni fallimento, fino a 2 minuti. */
export function liveRefreshDelayMs(failures: number, baseSeconds: number = LIVE_REFRESH_SECONDS): number {
  const steps = Math.max(0, Math.min(Math.floor(Number.isFinite(failures) ? failures : 0), 16));
  return Math.min(baseSeconds * 2 ** steps, LIVE_REFRESH_MAX_SECONDS) * 1000;
}

/** Se controllare adesso: solo con la rete, con la scheda in vista e senza modifiche da perdere. */
export function liveRefreshRuns(i: { online: boolean; visible: boolean; editing: boolean }): boolean {
  return i.online && i.visible && !i.editing;
}

/** Dopo un controllo: il sito risponde → rileggi la pagina e riparti da zero; non risponde → un fallimento in più. */
export function liveRefreshAfter(failures: number, reachable: boolean): { failures: number; refresh: boolean } {
  return reachable ? { failures: 0, refresh: true } : { failures: failures + 1, refresh: false };
}
