/**
 * Parole di un testo per la scansione (PIANO §3.10).
 *
 * Il testo si porta in NFC; poi se ne fa una copia «piegata» (minuscolo, senza
 * accenti) **della stessa lunghezza**, così le posizioni valgono per entrambe:
 * le parole si cercano sulla copia piegata e la maiuscola iniziale (per i nomi)
 * si legge sul testo originale. Le posizioni dei risultati sono quindi riferite a
 * `text.normalize("NFC")`.
 *
 * Le parole sono sequenze di lettere e cifre; apostrofi, trattini e punti
 * separano («dell'aereo» → «dell», «aereo»). Strutture parallele (`starts`,
 * `ends`, `norms`) per reggere anche testi di qualche megabyte (file estratti).
 *
 * Modulo puro.
 */

/** Segnaposto per i segni diacritici staccati: resta dentro la parola ma non conta. */
const FILLER = "\u0001";
const WORD = /[\p{L}\p{N}\u0001]+/gu;

function foldRun(run: string): string {
  let out = "";
  for (const ch of run) {
    let f = ch.normalize("NFD").replace(/\p{M}+/gu, "").toLowerCase();
    if (f.length !== ch.length) f = f.length > ch.length ? f.slice(0, ch.length) : f.padEnd(ch.length, FILLER);
    out += f;
  }
  return out;
}

/** Minuscolo e senza accenti, con la stessa lunghezza (in unità UTF-16) dell'ingresso. */
export function foldSameLength(text: string): string {
  return text.replace(/[A-Z]+|[^\x00-\x7f]+/g, (run) => (/^[A-Z]+$/.test(run) ? run.toLowerCase() : foldRun(run)));
}

export interface PreparedText {
  /** Testo in NFC: le posizioni dei risultati valgono qui. */
  text: string;
  /** Stessa lunghezza di `text`, minuscolo e senza accenti. */
  folded: string;
  starts: number[];
  ends: number[];
  /** Parola piegata (minuscolo, senza accenti). */
  norms: string[];
}

export function prepareText(input: string): PreparedText {
  const text = input.normalize("NFC");
  const folded = foldSameLength(text);
  const starts: number[] = [];
  const ends: number[] = [];
  const norms: string[] = [];
  for (const m of folded.matchAll(WORD)) {
    const start = m.index ?? 0;
    starts.push(start);
    ends.push(start + m[0].length);
    norms.push(m[0].includes(FILLER) ? m[0].split(FILLER).join("") : m[0]);
  }
  return { text, folded, starts, ends, norms };
}

/** Parola com'è scritta nel testo originale. */
export function rawWord(t: PreparedText, i: number): string {
  return t.text.slice(t.starts[i], t.ends[i]);
}

/** Indice della prima parola che finisce dopo `offset` (ricerca binaria). */
export function wordIndexAt(t: PreparedText, offset: number): number {
  let lo = 0;
  let hi = t.ends.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t.ends[mid] <= offset) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** «Mario», «D'Annunzio» (solo la prima parte), «Dell»: maiuscola e poi minuscole. */
export function isTitleCase(raw: string): boolean {
  return /^\p{Lu}[\p{Ll}\p{M}]+$/u.test(raw);
}

/** «ROSSI»: almeno due lettere, tutte maiuscole. */
export function isAllCaps(raw: string): boolean {
  return /^\p{Lu}[\p{Lu}\p{M}]+$/u.test(raw);
}

/** Tra le parole `i` e `j` (i < j) ci sono solo spazi (nessun a capo né punteggiatura). */
export function onlySpacesBetween(t: PreparedText, i: number, j: number): boolean {
  return /^[ \t]+$/.test(t.text.slice(t.ends[i], t.starts[j]));
}

/** Indici delle parole entro `distance` parole da `i` (escluso `i`). */
export function* around(t: PreparedText, i: number, distance: number): Generator<number> {
  const from = Math.max(0, i - distance);
  const to = Math.min(t.norms.length - 1, i + distance);
  for (let j = from; j <= to; j++) if (j !== i) yield j;
}

/** Vero se una parola entro `distance` da `i` soddisfa il test. */
export function anyAround(t: PreparedText, i: number, distance: number, test: (j: number) => boolean): boolean {
  for (const j of around(t, i, distance)) if (test(j)) return true;
  return false;
}
