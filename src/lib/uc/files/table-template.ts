/**
 * Modello Excel da scaricare per le risposte di tipo `tabella` (PIANO §5.9,
 * `GET /api/r/[token]/items/[itemId]/template.xlsx`): l'intestazione dalle
 * colonne del template (`config.columns`), altrimenti una riga con il titolo
 * della domanda e la griglia vuota. Il referente lo compila, poi copia e
 * incolla le celle nella pagina.
 *
 * Ogni testo passa da `sheetText` (niente formule). Nessun dato del caso oltre
 * al titolo della domanda e alle etichette delle colonne. Modulo puro (solo
 * `xlsx` per scrivere il file).
 */
import * as XLSX from "xlsx";
import { pasteOptionsFromConfig } from "../answers/table-paste.ts";
import { sheetText } from "../export/sheets.ts";
import type { Json } from "../types.ts";

/** Righe vuote della griglia quando il template non dà le colonne. */
export const EMPTY_GRID_ROWS = 20;
/** Colonne vuote della griglia quando il template non dà le colonne. */
export const EMPTY_GRID_COLUMNS = 4;

export interface TableTemplate {
  /** Righe del foglio (prima riga = intestazione o titolo). */
  rows: string[][];
  /** Il template ha le colonne: la prima riga è l'intestazione da incollare. */
  hasColumns: boolean;
}

/** Contenuto del foglio, senza scriverlo. */
export function tableTemplateRows(i: { title: string; config: Record<string, Json> }): TableTemplate {
  const columns = (pasteOptionsFromConfig(i.config).columns ?? []).map((c) => (typeof c.label === "string" && c.label.trim() ? c.label : c.key));
  if (columns.length > 0) return { rows: [columns.map(sheetText)], hasColumns: true };
  const title = sheetText(i.title.replace(/\s+/g, " ").trim().slice(0, 500) || "Tabella");
  const empty = Array.from({ length: EMPTY_GRID_COLUMNS }, () => "");
  return { rows: [[title], ...Array.from({ length: EMPTY_GRID_ROWS }, () => [...empty])], hasColumns: false };
}

/** File `.xlsx` del modello, come buffer. */
export function tableTemplateWorkbook(i: { title: string; config: Record<string, Json> }): Buffer {
  const { rows } = tableTemplateRows(i);
  const sheet = XLSX.utils.aoa_to_sheet(rows);
  sheet["!cols"] = (rows[0] ?? []).map((c) => ({ wch: Math.min(Math.max(String(c).length + 2, 14), 60) }));
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Modello");
  return XLSX.write(book, { bookType: "xlsx", type: "buffer" }) as Buffer;
}

/** Nome del file scaricato: `modello-<chiave della voce>.xlsx`, solo caratteri sicuri. */
export function tableTemplateFileName(itemKey: string): string {
  const safe = itemKey.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 80) || "tabella";
  return `modello-${safe}.xlsx`;
}
