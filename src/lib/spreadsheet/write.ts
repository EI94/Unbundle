/**
 * L'unica porta dell'app verso SheetJS: scrive file .xlsx, non ne legge mai.
 *
 * `xlsx` 0.18.5 ha due vulnerabilità note nel parsing (prototype pollution e
 * ReDoS) e su npm non c'è una versione corretta. Qui non c'è nessuna funzione
 * che legga un foglio, e la regola `no-restricted-imports` di eslint.config.mjs
 * vieta `xlsx` e `xlsx-js-style` nel resto di src/ (i test li usano per
 * rileggere i file scritti). I file caricati dagli utenti si leggono con
 * `src/lib/uc/files/ooxml.ts`, senza SheetJS.
 *
 * Solo per il server, ma senza `import "server-only"`: i test unitari caricano
 * con Node i moduli che scrivono, e lì `server-only` non si risolve.
 */
import * as XLSX from "xlsx";
import XLSXStyle from "xlsx-js-style";

export type WorkBook = XLSX.WorkBook;
export type WorkSheet = XLSX.WorkSheet;

export function newWorkbook(): WorkBook {
  return XLSX.utils.book_new();
}

/**
 * Un foglio da oggetti, una riga per oggetto. `header` fissa le prime colonne e
 * il loro ordine; SheetJS vi aggiunge le chiavi che trova in più, quindi va
 * passata una copia.
 */
export function jsonToSheet(rows: object[], options?: { header: string[] }): WorkSheet {
  return XLSX.utils.json_to_sheet(rows, options);
}

/** Un foglio da righe di celle. */
export function aoaToSheet(rows: unknown[][]): WorkSheet {
  return XLSX.utils.aoa_to_sheet(rows);
}

/** L'intervallo come «A1:D20». */
export function encodeRange(range: XLSX.Range): string {
  return XLSX.utils.encode_range(range);
}

export function appendSheet(book: WorkBook, sheet: WorkSheet, name: string): void {
  XLSX.utils.book_append_sheet(book, sheet, name);
}

/**
 * Il file .xlsx. `compression` comprime le parti dello zip. Il Buffer di Node
 * sta su un `ArrayBuffer`, quindi va bene anche come corpo di una `Response`.
 */
export function writeXlsx(book: WorkBook, options: { compression?: boolean } = {}): Buffer<ArrayBuffer> {
  const opts: XLSX.WritingOptions = { bookType: "xlsx", type: "buffer" };
  if (options.compression) opts.compression = true;
  return XLSX.write(book, opts) as Buffer<ArrayBuffer>;
}

/** Una cella con lo stile di xlsx-js-style (`s`: font, fill, alignment, border). */
export type StyledCell = { v: string; s?: Record<string, unknown> };

export type StyledSheet = {
  name: string;
  rows: StyledCell[][];
  cols?: XLSX.ColInfo[];
  rowHeights?: XLSX.RowInfo[];
  merges?: XLSX.Range[];
};

/** Il file .xlsx con gli stili di cella, scritto da xlsx-js-style: un foglio per voce, in ordine. */
export function writeStyledXlsx(sheets: readonly StyledSheet[]): Buffer<ArrayBuffer> {
  const book = XLSXStyle.utils.book_new();
  for (const s of sheets) {
    const sheet = XLSXStyle.utils.aoa_to_sheet(s.rows);
    if (s.cols) sheet["!cols"] = s.cols;
    if (s.rowHeights) sheet["!rows"] = s.rowHeights;
    if (s.merges) sheet["!merges"] = s.merges;
    XLSXStyle.utils.book_append_sheet(book, sheet, s.name);
  }
  return XLSXStyle.write(book, { type: "buffer", bookType: "xlsx" }) as Buffer<ArrayBuffer>;
}
