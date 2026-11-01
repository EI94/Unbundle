/**
 * Il file .xlsx con gli stili di cella, scritto da xlsx-js-style: una delle due
 * porte dell'app verso SheetJS, con `write.ts`. Scrive soltanto, come l'altra.
 *
 * Sta in un modulo a sé perché xlsx-js-style è una libreria CommonJS con effetti
 * collaterali all'import (carica e registra le tabelle di codepage di
 * `cpexcel.js`: con SheetJS fa un chunk del server di circa 1,1 MB e oltre 10 MB
 * di heap a ogni caricamento) che il bundler non può eliminare: chi importa
 * questo file la carica e la esegue. Lo usa solo
 * l'export delle domande dell'assessment (`ai-readiness/question-doc.ts`, per la
 * route `questions-export`), come su main prima di `write.ts`; le pagine e le
 * altre route scrivono con `write.ts`, che non la importa. Da `xlsx` qui entrano
 * solo tipi.
 *
 * La regola `no-restricted-imports` di eslint.config.mjs ammette xlsx-js-style
 * solo qui e in `write.ts` (e nei test). Senza `import "server-only"`, come
 * `write.ts`: i test unitari caricano con Node i moduli che scrivono.
 */
import XLSXStyle from "xlsx-js-style";
import type { ColInfo, Range, RowInfo } from "xlsx";

/** Una cella con lo stile di xlsx-js-style (`s`: font, fill, alignment, border). */
export type StyledCell = { v: string; s?: Record<string, unknown> };

export type StyledSheet = {
  name: string;
  rows: StyledCell[][];
  cols?: ColInfo[];
  rowHeights?: RowInfo[];
  merges?: Range[];
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
