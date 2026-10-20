/**
 * Utilità sui testi per la normalizzazione delle risposte. Modulo puro.
 */

/** Spazi «strani» che arrivano da Excel, Word e tastiere del telefono. */
const ODD_SPACES = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u3000]/g;
const ZERO_WIDTH = /[\u200b-\u200d\u2060\ufeff]/g;

/** NFC, spazi uniformi, niente caratteri a larghezza zero, trim. */
export function cleanText(text: string): string {
  return text.normalize("NFC").replace(ZERO_WIDTH, "").replace(ODD_SPACES, " ").trim();
}

/** Come `cleanText` e in più una sola spaziatura tra le parole (a capo compresi). */
export function collapseSpaces(text: string): string {
  return cleanText(text).replace(/\s+/g, " ");
}

/** Toglie gli accenti (à → a). */
export function deaccent(text: string): string {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").normalize("NFC");
}

/**
 * Chiave confrontabile: senza accenti, minuscola, ogni sequenza di caratteri
 * non alfanumerici diventa `_`, senza `_` ai bordi. «Città d'arrivo» → `citta_d_arrivo`.
 */
export function foldKey(text: string): string {
  return deaccent(cleanText(text))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/** Confronto «umano» di due etichette: senza accenti, maiuscole e punteggiatura. */
export function sameLabel(a: string, b: string): boolean {
  const fa = foldKey(a);
  return fa.length > 0 && fa === foldKey(b);
}

/** Oggetto semplice, come quelli di `JSON.parse` (niente array, date, mappe, classi). */
export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/** Stringa non vuota dopo la pulizia, altrimenti null. */
export function nonEmptyString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const cleaned = cleanText(value);
  return cleaned.length > 0 ? cleaned : null;
}

/** Lunghezza in byte UTF-8, senza Buffer (funziona anche nel browser). */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0;
    bytes += cp < 0x80 ? 1 : cp < 0x800 ? 2 : cp < 0x10000 ? 3 : 4;
  }
  return bytes;
}
