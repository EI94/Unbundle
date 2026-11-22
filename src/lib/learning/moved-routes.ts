/**
 * (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §2.4 e §8.2) Gli indirizzi della Formazione che
 * cambiano casa: un redirect permanente (308) che porta con sé la query, verso un'ancora della pagina nuova. Ogni
 * indirizzo di prima apre ancora lo stesso contenuto. Modulo puro: lo usano le route e lo provano i test.
 *
 * - `…/learning/<corso>/progress` («Il mio risultato») → la pagina del corso, sulla piega «Tutte le prove» (`#prove`):
 *   gli esiti sono in «Esercizi», lo storico delle prove nella piega.
 */

/** L'ancora della piega «Tutte le prove» nella pagina del corso. */
export const ATTEMPTS_ANCHOR = "prove";

const PROGRESS = /^(\/dashboard\/[^/]+\/learning\/[^/]+)\/progress\/?$/;

/** L'indirizzo nuovo di «Il mio risultato», con la query di prima; null per un altro percorso. */
export function progressTarget(pathname: string, search: URLSearchParams | string = ""): string | null {
  const match = PROGRESS.exec(pathname);
  if (!match) return null;
  const query = new URLSearchParams(search).toString();
  return `${match[1]}${query ? `?${query}` : ""}#${ATTEMPTS_ANCHOR}`;
}
