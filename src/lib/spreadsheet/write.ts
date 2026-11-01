/**
 * Una delle due porte dell'app verso SheetJS: scrive file .xlsx, non ne legge
 * mai. L'altra è `write-styled.ts`, il file con gli stili di cella scritto da
 * xlsx-js-style, che usa solo l'export delle domande dell'assessment.
 *
 * `xlsx` 0.18.5 ha due vulnerabilità note nel parsing (prototype pollution e
 * ReDoS) e su npm non c'è una versione corretta. Qui non c'è nessuna funzione
 * che legga un foglio, e la regola `no-restricted-imports` di eslint.config.mjs
 * vieta `xlsx` e `xlsx-js-style` nel resto di src/ tranne `write-styled.ts` (i
 * test li usano per rileggere i file scritti). I file caricati dagli utenti si
 * leggono con `src/lib/uc/files/ooxml.ts`, senza SheetJS.
 *
 * Questo modulo non importa xlsx-js-style: è una libreria CommonJS con effetti
 * collaterali che il bundler non elimina, e da qui finirebbe in ogni pagina e
 * route che scrive un foglio (lo controlla `write.test.ts`).
 *
 * Solo per il server, ma senza `import "server-only"`: i test unitari caricano
 * con Node i moduli che scrivono, e lì `server-only` non si risolve.
 */
import * as XLSX from "xlsx";

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
