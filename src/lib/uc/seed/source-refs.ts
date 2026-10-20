/**
 * Riferimenti estratti dai testi del seed (PIANO §8.1).
 *
 * - Fonti dei valori dichiarati: id dei fatti `F001`…, `F014a`, `F-M3`, `F-T12`,
 *   e delle email `E1`/`E2` (`/\b(F\d{3}[a-z]?|F-[MT]\d{1,2}|E[12])\b/g`).
 * - Riferimenti di contratto (`contract_refs`): «art. 5.1», «Artt. 3 e 4», «All. B.3»,
 *   normalizzati in «art. N» e «All. X».
 *
 * Modulo puro.
 */

export const SOURCE_REF_PATTERN = /\b(F\d{3}[a-z]?|F-[MT]\d{1,2}|E[12])\b/g;

/** Testo di `source_ref` quando il valore non cita una fonte. */
export const SOURCE_REF_UNKNOWN = "dichiarato in call (fonte non indicata)";

/** Id delle fonti citate, senza doppioni, nell'ordine in cui compaiono. */
export function extractSourceRefs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(SOURCE_REF_PATTERN)) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

/** `source_ref` della risposta v1 (≤ 500 caratteri, come la colonna). */
export function sourceRefLabel(ids: readonly string[]): string {
  if (ids.length === 0) return SOURCE_REF_UNKNOWN;
  let out = "";
  for (const id of ids) {
    const next = out ? `${out}, ${id}` : id;
    if (next.length > 500) break;
    out = next;
  }
  return out;
}

const ARTICLE = /\b([Aa]rtt?\.|[Aa]ll\.)\s*([0-9A-Z][0-9A-Za-z]*(?:\.[0-9A-Za-z]+)*)(?:\s*(?:,|e)\s*([0-9]+(?:\.[0-9]+)*))*/g;
const NUMBER_LIST = /(?:,|\be)\s*([0-9]+(?:\.[0-9]+)*)/g;

/**
 * Riferimenti a articoli e allegati del contratto, normalizzati («art. 5.1»,
 * «All. B»), senza doppioni e nell'ordine in cui compaiono. «artt. 3 e 4»
 * diventa «art. 3», «art. 4».
 */
export function extractContractRefs(texts: readonly string[]): string[] {
  const out: string[] = [];
  const add = (ref: string) => {
    if (!out.includes(ref)) out.push(ref);
  };
  for (const text of texts) {
    for (const m of text.matchAll(ARTICLE)) {
      const isAnnex = /^all\.$/i.test(m[1]);
      const prefix = isAnnex ? "All." : "art.";
      if (!isAnnex && !/^[0-9]/.test(m[2])) continue;
      add(`${prefix} ${m[2]}`);
      if (!isAnnex) {
        const tail = m[0].slice(m[0].indexOf(m[2]) + m[2].length);
        for (const n of tail.matchAll(NUMBER_LIST)) add(`art. ${n[1]}`);
      }
    }
  }
  return out;
}
