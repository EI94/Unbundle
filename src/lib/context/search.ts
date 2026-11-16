/**
 * La ricerca per parole di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §4.4): dalla domanda di
 * una persona alla stringa per `to_tsquery('italian', …)`, la stessa forma di `buildTsQuery` di
 * src/lib/ai/rag/retriever.ts. Modulo puro.
 */

/** Quante parole della domanda entrano nella ricerca. */
export const SEARCH_WORDS_MAX = 15;
/** Una parola più corta non si cerca. */
export const SEARCH_WORD_MIN = 3;

/** Le parole della domanda che si cercano: solo lettere e cifre, almeno 3 caratteri, senza doppioni, al massimo 15. */
export function searchWords(question: string): string[] {
  const words = String(question ?? "")
    .normalize("NFC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word.length >= SEARCH_WORD_MIN);
  return [...new Set(words)].slice(0, SEARCH_WORDS_MAX);
}

/**
 * La stringa per `to_tsquery`: le parole unite con `|`, ognuna con il prefisso `:*`. Vuota se la domanda non ha parole
 * da cercare. Nessun segno della domanda arriva nella stringa: nessun operatore (`&`, `!`, `<->`, parentesi,
 * virgolette, due punti) può passare.
 */
export function contextTsQuery(question: string): string {
  return searchWords(question)
    .map((word) => `${word}:*`)
    .join(" | ");
}
