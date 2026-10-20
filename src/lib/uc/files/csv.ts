/**
 * Lettura di file CSV e TSV caricati (PIANO §6.3, §6.4).
 *
 * - Separatore: quello dichiarato da Excel (`sep=;` sulla prima riga), il TAB
 *   per i `.tsv`, altrimenti il più regolare tra `;` `,` TAB e `|` nelle prime
 *   righe (a parità vince `;`, quello di Excel in italiano).
 * - Virgolette alla RFC 4180: `""` dentro un campo, a capo dentro le
 *   virgolette, CRLF e CR; un BOM iniziale si toglie.
 * - Limiti: righe e celle massime; oltre si smette di leggere e
 *   `truncated = true`. Le righe vuote si saltano.
 *
 * Nessuna valutazione di formule: le celle restano testo. Modulo puro.
 */
import { fail, ok, type Result } from "../types.ts";

export const CSV_DELIMITERS = [";", ",", "\t", "|"] as const;
export type CsvDelimiter = (typeof CSV_DELIMITERS)[number];

export const CSV_LIMITS = Object.freeze({
  /** Celle lette in tutto. */
  maxCells: 2_000_000,
  /** Righe lette. */
  maxRows: 1_000_000,
  /** Caratteri di un campo (il limite di una cella di Excel). */
  maxFieldChars: 32_767,
  /** Colonne per riga (XFD = 16.384). */
  maxColumns: 16_384,
});

export interface CsvOptions {
  /** Separatore imposto; altrimenti si riconosce. */
  delimiter?: CsvDelimiter;
  /** Tipo dal file: `tsv` impone il TAB. */
  kind?: "csv" | "tsv";
  maxCells?: number;
  maxRows?: number;
}

export interface CsvTable {
  delimiter: CsvDelimiter;
  /** Righe non vuote, celle come testo. */
  rows: string[][];
  /** Vero se i limiti hanno fermato la lettura. */
  truncated: boolean;
  /** Avvisi non bloccanti (es. virgolette non chiuse alla fine del file). */
  warnings: ("virgolette_non_chiuse" | "campo_troppo_lungo")[];
}

export const CSV_MESSAGES = {
  csv_troppe_colonne: "Il file ha troppe colonne per essere controllato.",
} as const;

const SAMPLE_LINES = 30;

/** Conta i separatori fuori dalle virgolette, riga per riga, nelle prime righe. */
function delimiterCounts(text: string, delimiter: string): number[] {
  const counts: number[] = [];
  let inQuotes = false;
  let current = 0;
  for (let i = 0; i < text.length && counts.length < SAMPLE_LINES; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes && (ch === "\n" || ch === "\r")) {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      counts.push(current);
      current = 0;
    } else if (!inQuotes && ch === delimiter) {
      current++;
    }
  }
  if (counts.length < SAMPLE_LINES && current > 0) counts.push(current);
  return counts;
}

/**
 * Riconosce il separatore: vince quello presente nel maggior numero di righe
 * con lo stesso conteggio (la «forma» della tabella), a parità l'ordine di
 * `CSV_DELIMITERS`.
 */
export function detectDelimiter(text: string): CsvDelimiter {
  const hint = /^sep=(.)\r?\n/i.exec(text);
  if (hint && (CSV_DELIMITERS as readonly string[]).includes(hint[1])) return hint[1] as CsvDelimiter;
  let best: CsvDelimiter = ";";
  let bestScore = 0;
  for (const delimiter of CSV_DELIMITERS) {
    const counts = delimiterCounts(text, delimiter).filter((n) => n > 0);
    if (counts.length === 0) continue;
    const frequency = new Map<number, number>();
    for (const n of counts) frequency.set(n, (frequency.get(n) ?? 0) + 1);
    const score = Math.max(...frequency.values());
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

/** Legge un CSV o TSV già decodificato in testo. */
export function parseDelimited(input: string, options: CsvOptions = {}): Result<CsvTable> {
  let text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const hinted = /^sep=(.)\r?\n/i.exec(text);
  const delimiter: CsvDelimiter = options.delimiter ?? (options.kind === "tsv" ? "\t" : detectDelimiter(text));
  if (hinted && (CSV_DELIMITERS as readonly string[]).includes(hinted[1])) text = text.slice(hinted[0].length);
  const maxCells = options.maxCells ?? CSV_LIMITS.maxCells;
  const maxRows = options.maxRows ?? CSV_LIMITS.maxRows;

  const rows: string[][] = [];
  const warnings = new Set<CsvTable["warnings"][number]>();
  let row: string[] = [];
  let field: string[] = [];
  let fieldLength = 0;
  let cells = 0;
  let truncated = false;
  let inQuotes = false;
  let quotedField = false;

  const pushField = () => {
    row.push(field.join(""));
    field = [];
    fieldLength = 0;
    quotedField = false;
  };
  const pushRow = (): boolean => {
    pushField();
    const empty = row.length === 1 && row[0] === "";
    if (!empty) {
      if (row.length > CSV_LIMITS.maxColumns) return false;
      if (rows.length >= maxRows || cells + row.length > maxCells) {
        truncated = true;
        return false;
      }
      cells += row.length;
      rows.push(row);
    }
    row = [];
    return true;
  };
  const append = (chunk: string) => {
    if (fieldLength + chunk.length > CSV_LIMITS.maxFieldChars) {
      warnings.add("campo_troppo_lungo");
      const room = CSV_LIMITS.maxFieldChars - fieldLength;
      if (room > 0) field.push(chunk.slice(0, room));
      fieldLength = CSV_LIMITS.maxFieldChars;
      return;
    }
    field.push(chunk);
    fieldLength += chunk.length;
  };

  let i = 0;
  const length = text.length;
  while (i < length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          append('"');
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      // Copy a run of ordinary characters at once.
      let j = i;
      while (j < length && text[j] !== '"') j++;
      append(text.slice(i, j).replace(/\r\n?/g, "\n"));
      i = j;
      continue;
    }
    if (ch === '"' && fieldLength === 0 && !quotedField) {
      inQuotes = true;
      quotedField = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      if (row.length > CSV_LIMITS.maxColumns) return fail("csv_troppe_colonne", CSV_MESSAGES.csv_troppe_colonne);
      i++;
      continue;
    }
    if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      i++;
      if (!pushRow()) {
        if (truncated) break;
        return fail("csv_troppe_colonne", CSV_MESSAGES.csv_troppe_colonne);
      }
      continue;
    }
    // An unquoted run up to the next delimiter or line break; a quote in the middle is text.
    let j = i + 1;
    while (j < length) {
      const c = text[j];
      if (c === delimiter || c === "\n" || c === "\r") break;
      j++;
    }
    append(text.slice(i, j));
    i = j;
  }
  if (!truncated) {
    if (inQuotes) warnings.add("virgolette_non_chiuse");
    if (field.length > 0 || row.length > 0 || quotedField) {
      if (!pushRow() && !truncated) return fail("csv_troppe_colonne", CSV_MESSAGES.csv_troppe_colonne);
    }
  }
  return ok({ delimiter, rows, truncated, warnings: [...warnings] });
}
