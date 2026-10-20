/**
 * Voci citate nei testi (PIANO §4.2, mappa): le chiavi risolvibili che
 * compaiono in descrizione, ingressi e uscite di un nodo diventano le voci del
 * nodo. `hc.*`, `sc.*` (e in generale `<prefisso>.*`) si espandono in tutte le
 * voci con quel prefisso, nell'ordine del template.
 *
 * Serve al normalizzatore (mappa `soluzione`) e al seed (processi e mappe
 * aggiuntive). Modulo puro.
 */
import { looksLikeItemKey } from "./ids.ts";

/** Una chiave nel testo: segmenti minuscoli separati da punti, l'ultimo può essere `*`. */
const KEY_MENTION = /(?<![A-Za-z0-9_.])([a-z][a-z0-9_]*(?:\.[a-z0-9_]+)*\.(?:[a-z0-9_]+|\*))(?![A-Za-z0-9_])/g;

export interface DerivedKeys {
  /** Chiavi esistenti, nell'ordine della prima citazione (le espansioni nell'ordine del template). */
  keys: string[];
  /** Espansioni usate, es. `hc.*`. */
  wildcards: string[];
  /** Citazioni con la forma di una chiave che nel template non esiste. */
  unresolved: string[];
}

/** Tutte le citazioni con la forma di una chiave, così come compaiono. */
export function keyMentions(text: string): string[] {
  return [...text.matchAll(KEY_MENTION)].map((m) => m[1]);
}

/**
 * Chiavi citate nei testi. `itemKeys` è l'elenco ordinato delle chiavi del
 * template: decide cosa è risolvibile e l'ordine delle espansioni.
 */
export function deriveItemKeys(texts: readonly (string | null | undefined)[], itemKeys: readonly string[]): DerivedKeys {
  const known = new Set(itemKeys);
  const keys: string[] = [];
  const seen = new Set<string>();
  const wildcards: string[] = [];
  const unresolved: string[] = [];
  const add = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  };
  for (const text of texts) {
    if (!text) continue;
    for (const mention of keyMentions(text)) {
      if (mention.endsWith(".*")) {
        const prefix = mention.slice(0, -1);
        const matches = itemKeys.filter((k) => k.startsWith(prefix));
        if (matches.length === 0) {
          if (!unresolved.includes(mention)) unresolved.push(mention);
          continue;
        }
        if (!wildcards.includes(mention)) wildcards.push(mention);
        matches.forEach(add);
      } else if (known.has(mention)) {
        add(mention);
      } else if (looksLikeItemKey(mention) && !unresolved.includes(mention)) {
        unresolved.push(mention);
      }
    }
  }
  return { keys, wildcards, unresolved };
}
