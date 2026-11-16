/**
 * Appunti lunghi (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §4.2): la lettura va per parti, una chiamata
 * al modello per parte. Un appunto arriva al massimo a 300.000 caratteri (limite al salvataggio): tre parti lo coprono
 * sempre. Niente si taglia in silenzio: le parti, unite, ridanno il testo. Modulo puro.
 */
import { CONTEXT_LIMITS } from "../vocab.ts";

/** Quante parti servono per un testo di questa lunghezza (almeno una, al massimo 3). */
export function partsFor(length: number): number {
  return Math.max(1, Math.min(CONTEXT_LIMITS.partsMax, Math.ceil(length / CONTEXT_LIMITS.partChars)));
}

/** Fino a 100.000 caratteri: una parte. Oltre: parti da al massimo 100.000, tagliate a un a capo (o a un punto), al massimo 3. */
export function splitForReading(text: string): string[] {
  const size = CONTEXT_LIMITS.partChars;
  const parts = partsFor(text.length);
  if (parts === 1) return [text];
  const out: string[] = [];
  let start = 0;
  for (let k = 1; k < parts; k++) {
    // Il taglio sta dove quello che resta entra ancora nelle parti che restano, e questa parte non supera il limite.
    const earliest = Math.max(start + 1, text.length - (parts - k) * size);
    const latest = Math.min(start + size, text.length - 1);
    const cutAt = breakPoint(text, earliest, latest);
    out.push(text.slice(start, cutAt));
    start = cutAt;
  }
  out.push(text.slice(start));
  return out;
}

/** Dove tagliare tra `earliest` e `latest` (compresi): dopo l'ultimo a capo, altrimenti dopo l'ultimo punto, altrimenti a `latest`. */
function breakPoint(text: string, earliest: number, latest: number): number {
  if (earliest >= latest) return latest;
  const newline = text.lastIndexOf("\n", latest - 1);
  if (newline >= earliest - 1 && newline >= 0) return newline + 1;
  const period = text.lastIndexOf(". ", latest - 2);
  if (period >= earliest - 2 && period >= 0) return period + 2;
  // Mai a metà di una coppia surrogata.
  const code = text.charCodeAt(latest - 1);
  return code >= 0xd800 && code <= 0xdbff && latest - 1 >= earliest ? latest - 1 : latest;
}
