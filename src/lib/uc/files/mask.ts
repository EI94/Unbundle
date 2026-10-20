/**
 * Anteprima tabellare mascherata (PIANO §6.4; spec «anteprima delle prime
 * righe con le colonne personali mascherate»).
 *
 * - Prime 20 righe di dati di un CSV, di un TSV o del primo foglio XLSX, dopo
 *   l'intestazione (la prima riga non vuota).
 * - Colonne con un'intestazione personale, sanitaria, particolare o vietata
 *   (stesse regole di `header-check.ts`) → `•••` in ogni cella.
 * - Celle che somigliano a email, telefono, codice fiscale o IBAN → `•••`,
 *   in qualunque colonna (anche nell'intestazione).
 * - Celle lunghe tagliate a 120 caratteri, al più 50 colonne.
 *
 * Il risultato va in `uc_files.preview` già mascherato. Per la zona personale
 * non si crea anteprima: solo i metadati (lo decide il chiamante).
 *
 * Modulo puro.
 */
import { personalValueKind, sensitiveColumns } from "./header-check.ts";

export const PREVIEW_SCHEMA = "unbundle.uc-preview/1";
export const MASK = "•••";
export const PREVIEW_LIMITS = Object.freeze({ rows: 20, columns: 50, cellChars: 120 });

export interface MaskedPreview {
  schema: typeof PREVIEW_SCHEMA;
  /** Nome del foglio (XLSX), altrimenti null. */
  sheet: string | null;
  /** Intestazioni mostrate (al più 50). */
  columns: string[];
  /** Prime righe di dati, mascherate. */
  rows: string[][];
  /** Righe di dati nella tabella (senza l'intestazione). */
  total_rows: number;
  /** Colonne nella tabella. */
  total_columns: number;
  /** Colonne mascherate per intestazione (indici 0-based tra quelle mostrate). */
  masked_columns: number[];
  /** Celle mascherate per il valore. */
  masked_cells: number;
  /** Vero se righe o colonne non sono tutte nell'anteprima, o se la lettura era già troncata. */
  truncated: boolean;
}

export interface PreviewSource {
  name?: string | null;
  rows: readonly (readonly string[])[];
  /** La lettura del file si è fermata a un limite. */
  truncated?: boolean;
}

export interface PreviewOptions {
  /** `spec.forbidden_columns` della voce e modelli del template: colonne mascherate anche loro. */
  forbiddenColumns?: readonly string[] | null;
  maxRows?: number;
  maxColumns?: number;
}

function clip(value: string, max: number): string {
  const chars = Array.from(value);
  return chars.length <= max ? value : `${chars.slice(0, max - 1).join("")}…`;
}

function isEmptyRow(row: readonly string[]): boolean {
  return !row.some((cell) => typeof cell === "string" && cell.trim() !== "");
}

/** Anteprima mascherata di una tabella. */
export function maskedPreview(source: PreviewSource, options: PreviewOptions = {}): MaskedPreview {
  const maxRows = options.maxRows ?? PREVIEW_LIMITS.rows;
  const maxColumns = options.maxColumns ?? PREVIEW_LIMITS.columns;
  const rows = source.rows.filter((row) => !isEmptyRow(row));
  const header = rows[0] ?? [];
  const data = rows.slice(1);
  const totalColumns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const shownColumns = Math.min(totalColumns, maxColumns);
  const sensitive = sensitiveColumns(header.slice(0, shownColumns), options.forbiddenColumns);
  let maskedCells = 0;

  const cell = (value: string | undefined, column: number, isHeader: boolean): string => {
    const text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
    if (!text) return "";
    if (!isHeader && sensitive.has(column)) return MASK;
    if (personalValueKind(text)) {
      maskedCells++;
      return MASK;
    }
    return clip(text, PREVIEW_LIMITS.cellChars);
  };

  const columns = Array.from({ length: shownColumns }, (_, c) => cell(header[c], c, true));
  const shownRows = data.slice(0, maxRows).map((row) => Array.from({ length: shownColumns }, (_, c) => cell(row[c], c, false)));
  return {
    schema: PREVIEW_SCHEMA,
    sheet: source.name ?? null,
    columns,
    rows: shownRows,
    total_rows: data.length,
    total_columns: totalColumns,
    masked_columns: [...sensitive].sort((a, b) => a - b),
    masked_cells: maskedCells,
    truncated: Boolean(source.truncated) || data.length > maxRows || totalColumns > shownColumns,
  };
}
