import { COURSE_DOOR_CHECK_SECONDS } from "../../../lib/public/course.ts";

/**
 * (Rilascio 10, ondata 4; revisione) Il ritmo con cui la pagina del corso, con l'ingresso chiuso, controlla da sola se la
 * lezione si è aperta (`./door-watch.tsx`). In Next 16 una rilettura della pagina (`router.refresh`) che non arriva al
 * server diventa una navigazione vera, e senza rete il browser mostra la sua pagina «offline»: per questo prima di
 * rileggere si controlla la rete, e dopo un controllo fallito si aspetta di più. Modulo puro: lo provano i test.
 *
 * - ogni 10 secondi, e appena la scheda torna in vista o la rete torna;
 * - senza rete (`navigator.onLine` falso) o con la scheda nascosta, niente controllo: si riprova al giro dopo;
 * - un controllo che non raggiunge il sito raddoppia l'attesa (20, 40, 80 secondi), fino a 2 minuti; il primo che lo
 *   raggiunge rilegge la pagina e torna a 10 secondi.
 */

/** L'attesa più lunga fra due controlli, dopo una serie di controlli falliti. */
export const DOOR_CHECK_MAX_SECONDS = 120;

/** Un file piccolo del sito, che basta chiedere per sapere se la rete arriva al sito. */
export const DOOR_CHECK_PROBE = "/favicon.ico";

/** L'attesa prima del prossimo controllo, in millisecondi: 10 s, poi il doppio a ogni fallimento, fino a 2 minuti. */
export function doorCheckDelayMs(failures: number, baseSeconds: number = COURSE_DOOR_CHECK_SECONDS): number {
  const steps = Math.max(0, Math.min(Math.floor(failures), 16));
  return Math.min(baseSeconds * 2 ** steps, DOOR_CHECK_MAX_SECONDS) * 1000;
}

/** Se controllare adesso: solo con la rete e con la scheda in vista. */
export function doorCheckRuns(i: { online: boolean; visible: boolean }): boolean {
  return i.online && i.visible;
}

/** Dopo un controllo: il sito risponde → rileggi la pagina e riparti da zero; non risponde → un fallimento in più. */
export function doorCheckAfter(failures: number, reachable: boolean): { failures: number; refresh: boolean } {
  return reachable ? { failures: 0, refresh: true } : { failures: failures + 1, refresh: false };
}
