/**
 * Tabelle incollate da Excel e tipo `tabella` (PIANO §3.9).
 *
 * `parsePastedTable(text, opts)` legge quello che arriva da «Copia» in Excel,
 * Numbers o Google Fogli:
 * 1. toglie il BOM e porta CRLF/CR a LF;
 * 2. riconosce il separatore: TAB prima di tutto; poi `;` o `,` solo se danno lo
 *    stesso numero di celle su tutte le righe (una virgola sempre tra due cifre è
 *    un decimale italiano, non un separatore); altrimenti una colonna sola;
 * 3. gestisce le celle tra virgolette di Excel, con TAB o a capo interni e `""`
 *    per le virgolette;
 * 4. elimina righe e colonne vuote in coda (e le righe vuote in mezzo, con un avviso);
 * 5. completa le righe corte con `''` e un avviso; una riga più lunga
 *    dell'intestazione è un errore;
 * 6. prima riga = intestazione, confrontata con `config.columns` (senza accenti,
 *    minuscolo, `_`); senza colonne nel template l'intestazione diventa la
 *    definizione delle colonne. Una prima riga fatta di numeri o date non è
 *    un'intestazione: le colonne diventano «Colonna 1», «Colonna 2»…
 *
 * Controlli: almeno una riga di dati; chiave senza doppioni (prima colonna o
 * `keyColumn`); ogni cella tipizzata col tipo della colonna (senza tipo si
 * deduce: numero, percentuale, valuta, data, ora, sì/no, altrimenti testo);
 * celle che iniziano con `= + - @` salvate come testo e segnalate (all'export
 * passano da `csvCell`); meno righe di `minRows` = risposta parziale.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import { parseYesNo } from "./choice.ts";
import { parseMoneyText } from "./currency.ts";
import { parseDateIt, parseTimeIt } from "./datetime.ts";
import { readDurationText } from "./duration.ts";
import { issue, type Issue } from "./issues.ts";
import { decimalPlaces, parseNumberIt, roundTo } from "./number-it.ts";
import { cleanText, foldKey, isPlainObject, utf8Length } from "./strings.ts";
import {
  TABLE_CELL_TYPES,
  outcome,
  type Outcome,
  type ResponseConfig,
  type TableCellType,
  type TableColumnConfig,
} from "./types.ts";
import { lookupUnit } from "./units.ts";

export const TABLE_LIMITS = { maxRows: 2000, maxCols: 50, maxBytes: 200_000, maxCellLength: 2000 } as const;

export type Separator = "\t" | ";" | ",";

export interface PasteOptions {
  /** Colonne attese dal template. Senza, le colonne vengono dall'intestazione. */
  columns?: readonly TableColumnConfig[];
  /** Colonna chiave (chiave o etichetta). Default: la prima. */
  keyColumn?: string;
  minRows?: number;
  maxRows?: number;
  maxCols?: number;
  maxBytes?: number;
}

export interface TableColumn {
  key: string;
  label: string;
  type: TableCellType;
}

/** Valore tipizzato di una cella. La percentuale è salvata come frazione (12,5% → 0.125). */
export type CellValue = string | number | boolean | { amount: number; currency: string } | null;

export interface ParsedTable {
  separator: Separator | null;
  headerDetected: boolean;
  columns: TableColumn[];
  /** Celle pulite, come scritte, senza intestazione. */
  rows: string[][];
  /** Una riga per riga di dati, con le chiavi delle colonne. Null se ci sono errori. */
  typedRows: Record<string, CellValue>[] | null;
  partial: boolean;
}

export interface PasteResult {
  /** Null quando il testo non si legge affatto (vuoto, troppo grande, solo intestazione). */
  table: ParsedTable | null;
  errors: Issue[];
  warnings: Issue[];
}

// ── 1-3. Lettura delle righe ─────────────────────────────────────────────

/** Toglie il BOM e porta gli a capo a LF. */
export function normalizeNewlines(text: string): string {
  return text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
}

/**
 * Divide il testo in righe e celle. Con `quotes` le celle che iniziano con `"`
 * possono contenere separatori e a capo, e `""` vale `"`. `unterminated` dice che
 * una virgoletta non è stata chiusa.
 */
export function splitRecords(text: string, sep: Separator | null, quotes = true): { records: string[][]; unterminated: boolean } {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let atFieldStart = true;
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }
    if (c === '"' && quotes && atFieldStart) {
      inQuotes = true;
      atFieldStart = false;
    } else if (sep !== null && c === sep) {
      record.push(field);
      field = "";
      atFieldStart = true;
    } else if (c === "\n") {
      record.push(field);
      records.push(record);
      record = [];
      field = "";
      atFieldStart = true;
    } else {
      field += c;
      atFieldStart = false;
    }
  }
  if (field !== "" || record.length > 0 || inQuotes) {
    record.push(field);
    records.push(record);
  }
  return { records, unterminated: inQuotes };
}

function isBlankRecord(record: readonly string[]): boolean {
  return record.every((cell) => cleanText(cell) === "");
}

/** Vero se ogni virgola fuori dalle virgolette sta tra due cifre (decimali italiani). */
function commasAreDecimals(text: string): boolean {
  const unquoted = text.replace(/"(?:[^"]|"")*"/g, "");
  const all = (unquoted.match(/,/g) ?? []).length;
  const decimal = (unquoted.match(/\d,(?=\d)/g) ?? []).length;
  return all > 0 && all === decimal;
}

/** Separatore delle celle: TAB, poi `;` o `,` se coerenti su tutte le righe, altrimenti null. */
export function detectSeparator(text: string): Separator | null {
  const tab = splitRecords(text, "\t");
  if (tab.records.some((r) => r.length > 1)) return "\t";
  for (const sep of [";", ","] as const) {
    const records = splitRecords(text, sep).records.filter((r) => !isBlankRecord(r));
    if (records.length === 0) continue;
    const width = records[0].length;
    if (width > 1 && records.every((r) => r.length === width)) {
      if (sep === "," && commasAreDecimals(text)) continue;
      return sep;
    }
  }
  return null;
}

// ── Tipi delle celle ─────────────────────────────────────────────────────

const PERCENT_CELL = /^([-+−]?[\d.,'’ ]*\d)\s*%$/;

function parsePercentCell(text: string): number | null {
  const m = PERCENT_CELL.exec(text);
  if (!m) return null;
  const p = parseNumberIt(m[1]);
  return p.ok ? p.value : null;
}

function parseMoneyCell(text: string): { amount: number; currency: string } | null {
  if (!/[€£$]|\b[A-Za-z]{3}\b/.test(text)) return null;
  const p = parseMoneyText(text, true);
  if (Array.isArray(p) || p.money.currency === null) return null;
  return { amount: p.money.amount, currency: p.money.currency };
}

/** Il testo è un valore (numero, percentuale, importo, data, ora) e non un titolo? */
export function looksLikeValue(text: string): boolean {
  return (
    parseNumberIt(text).ok ||
    parsePercentCell(text) !== null ||
    parseMoneyCell(text) !== null ||
    parseDateIt(text).ok ||
    (/[:.h]/.test(text) && parseTimeIt(text).ok)
  );
}

/** Una cella da titolo: un testo, oppure un anno («2024») come nelle colonne per anno. */
function looksLikeTitle(text: string): boolean {
  return !looksLikeValue(text) || /^(?:19|20)\d{2}$/.test(text);
}

/** Tipo dedotto da una colonna senza tipo nel template. */
export function inferColumnType(cells: readonly string[]): TableCellType {
  const values = cells.filter((c) => c !== "");
  if (values.length === 0 || values.some((c) => /^[=@]/.test(c))) return "testo";
  const all = (test: (c: string) => boolean) => values.every(test);
  if (all((c) => parsePercentCell(c) !== null)) return "percentuale";
  if (all((c) => parseNumberIt(c).ok)) return "numero";
  if (all((c) => parseMoneyCell(c) !== null)) return "valuta";
  if (all((c) => parseDateIt(c).ok)) return "data";
  if (all((c) => /^\d{1,2}[:.]\d{2}$/.test(c) && parseTimeIt(c).ok)) return "ora";
  if (all((c) => parseYesNo(c) !== null && !/^\d$/.test(c))) return "si_no";
  return "testo";
}

/**
 * Cella che un foglio di calcolo leggerebbe come formula. Un numero con il segno
 * («-5», «+3,5») in una colonna numerica non lo è: si salva come numero.
 */
export function isFormulaLike(cell: string, numericColumn: boolean): boolean {
  if (!/^[=+\-@−]/.test(cell)) return false;
  if (/^[=@]/.test(cell)) return true;
  return !(numericColumn && parseNumberIt(cell).ok);
}

type CellParse = { ok: true; value: CellValue; warnings: Issue[] } | { ok: false; error: Issue };

/** Tipizza una cella secondo il tipo della colonna. `field` è `rows[i][j]`. */
export function parseCell(type: TableCellType, text: string, field: string, unit?: string): CellParse {
  if (text === "") return { ok: true, value: null, warnings: [] };
  switch (type) {
    case "testo":
      return { ok: true, value: text, warnings: [] };
    case "codice":
      return { ok: true, value: text.replace(/\s+/g, " ").toUpperCase(), warnings: [] };
    case "numero": {
      const p = parseNumberIt(text, field);
      return p.ok ? { ok: true, value: p.value, warnings: p.warnings } : { ok: false, error: { ...p.errors[0], field } };
    }
    case "percentuale": {
      const plain = parseNumberIt(text);
      const v = parsePercentCell(text) ?? (plain.ok ? plain.value : null);
      if (v === null) return { ok: false, error: issue("percentuale_non_valida", "Scrivi una percentuale, per esempio 12,5%.", field) };
      if (v < 0 || v > 100) return { ok: false, error: issue("percentuale_fuori_intervallo", "La percentuale va da 0 a 100.", field) };
      if (decimalPlaces(v) > 2) return { ok: false, error: issue("troppi_decimali", "Usa al massimo 2 decimali.", field) };
      return { ok: true, value: roundTo(v / 100, 8), warnings: [] };
    }
    case "valuta": {
      const money = parseMoneyCell(text);
      if (money) return { ok: true, value: money, warnings: [] };
      const p = parseNumberIt(text, field);
      if (!p.ok) return { ok: false, error: issue("importo_non_valido", "Scrivi un importo, per esempio € 1.200,50.", field) };
      return { ok: true, value: { amount: p.value, currency: "EUR" }, warnings: p.warnings };
    }
    case "data": {
      const p = parseDateIt(text, field);
      return p.ok ? { ok: true, value: p.value, warnings: p.warnings } : { ok: false, error: { ...p.errors[0], field } };
    }
    case "ora": {
      const p = parseTimeIt(text, field);
      return p.ok ? { ok: true, value: p.value, warnings: [] } : { ok: false, error: { ...p.errors[0], field } };
    }
    case "durata": {
      const d = readDurationText(text, true);
      if (Array.isArray(d)) return { ok: false, error: { ...d[0], field } };
      const u = d.unit ?? (unit ? lookupUnit(unit) : null);
      if (u === null || u.dimension !== "tempo") {
        return { ok: false, error: issue("unita_mancante", "Indica l'unità: minuti, ore o giorni.", field) };
      }
      if (d.amount < 0) return { ok: false, error: issue("durata_negativa", "La durata non può essere negativa.", field) };
      const dotted = d.dotAsHoursMinutes
        ? [issue("letto_come_ore_minuti", "Ho letto il punto come ore e minuti (2.30 = 2 ore e 30 minuti): controlla che sia giusto.", field)]
        : [];
      return { ok: true, value: roundTo(d.amount * u.factor, 4), warnings: dotted };
    }
    case "si_no": {
      const v = parseYesNo(text);
      return v === null ? { ok: false, error: issue("scelta_mancante", "Scrivi sì o no.", field) } : { ok: true, value: v, warnings: [] };
    }
  }
}

// ── 4-6. Costruzione della tabella ───────────────────────────────────────

function uniqueKey(base: string, used: Set<string>): string {
  let key = base;
  for (let n = 2; used.has(key); n++) key = `${base}_${n}`;
  used.add(key);
  return key;
}

function columnLabel(index: number): string {
  return `Colonna ${index + 1}`;
}

function matchColumn(cell: string, columns: readonly TableColumnConfig[]): number {
  const key = foldKey(cell);
  if (key === "") return -1;
  return columns.findIndex((c) => foldKey(c.key) === key || (c.label !== undefined && foldKey(c.label) === key));
}

function configType(column: TableColumnConfig): TableCellType | null {
  return column.type && (TABLE_CELL_TYPES as readonly string[]).includes(column.type) ? column.type : null;
}

interface HeaderPlan {
  /** Per ogni colonna del testo: indice nella definizione finale, oppure -1 (ignorata). */
  sourceToColumn: number[];
  columns: { key: string; label: string; type: TableCellType | null; unit?: string }[];
  headerDetected: boolean;
}

/**
 * Legge l'intestazione. Con colonne nel template: la prima riga è
 * l'intestazione se nomina almeno metà delle sue celle piene; senza
 * intestazione si accettano le righe solo se hanno esattamente le colonne del
 * template, nell'ordine.
 */
function planHeader(
  first: readonly string[],
  width: number,
  config: readonly TableColumnConfig[] | null,
  forceHeader: boolean,
  errors: Issue[],
  warnings: Issue[],
): HeaderPlan | null {
  if (config && config.length > 0) {
    const defs = config.map((c) => ({ key: c.key, label: c.label ?? c.key, type: configType(c), unit: c.unit }));
    const matches = first.map((cell) => matchColumn(cell, config));
    const filled = first.filter((c) => c !== "").length;
    const matched = matches.filter((m) => m >= 0).length;
    if (forceHeader || (matched > 0 && matched * 2 >= filled)) {
      const seen = new Set<number>();
      const sourceToColumn = matches.map((m, j) => {
        if (m < 0) {
          if (first[j] !== "") {
            // The pasted header is user text: the message names the position, never the text.
            warnings.push(issue("colonna_ignorata", `La colonna ${j + 1} non è tra quelle richieste: non la salviamo.`, `columns[${j}]`));
          }
          return -1;
        }
        if (seen.has(m)) {
          errors.push(issue("colonna_doppia", `La colonna «${defs[m].label}» compare due volte.`, `columns[${j}]`));
          return -1;
        }
        seen.add(m);
        return m;
      });
      defs.forEach((d, m) => {
        if (!seen.has(m)) errors.push(issue("colonna_mancante", `Manca la colonna «${d.label}».`, "columns"));
      });
      return { sourceToColumn, columns: defs, headerDetected: true };
    }
    if (width === defs.length) {
      warnings.push(issue("intestazione_assente", "Non ho trovato l'intestazione: ho letto le colonne nell'ordine richiesto.", "columns"));
      return { sourceToColumn: defs.map((_, j) => j), columns: defs, headerDetected: false };
    }
    errors.push(
      issue(
        "intestazione_non_riconosciuta",
        `Copia anche la riga dei titoli. Servono le colonne: ${defs.map((d) => d.label).join(", ")}.`,
        "columns",
      ),
    );
    return null;
  }

  const filled = first.filter((c) => c !== "");
  const isHeader = forceHeader || (filled.length > 0 && filled.every(looksLikeTitle));
  const used = new Set<string>();
  const columns: HeaderPlan["columns"] = [];
  let duplicates = false;
  for (let j = 0; j < width; j++) {
    const label = isHeader && first[j] ? first[j].replace(/\s+/g, " ").slice(0, 120) : columnLabel(j);
    const base = foldKey(label).slice(0, 60) || `colonna_${j + 1}`;
    if (used.has(base)) duplicates = true;
    columns.push({ key: uniqueKey(base, used), label, type: null });
  }
  if (duplicates) warnings.push(issue("intestazione_doppia", "Due colonne hanno lo stesso titolo: le ho numerate.", "columns"));
  if (!isHeader) {
    warnings.push(issue("intestazione_assente", "La prima riga sembra già un dato: ho chiamato le colonne «Colonna 1», «Colonna 2»…", "columns"));
  }
  return { sourceToColumn: columns.map((_, j) => j), columns, headerDetected: isHeader };
}

/**
 * Costruisce la tabella da righe già divise (dal testo incollato o dalla
 * griglia dell'interfaccia, con `forceHeader`).
 */
export function buildTable(
  rawRecords: readonly (readonly string[])[],
  opts: PasteOptions & { separator?: Separator | null; forceHeader?: boolean } = {},
): PasteResult {
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const maxRows = opts.maxRows ?? TABLE_LIMITS.maxRows;
  const maxCols = opts.maxCols ?? TABLE_LIMITS.maxCols;

  // 4. Pulizia delle celle, righe vuote, colonne vuote in coda.
  let records = rawRecords.map((r) => r.map((cell) => cleanText(String(cell ?? ""))));
  while (records.length > 0 && isBlankRecord(records[records.length - 1])) records.pop();
  while (records.length > 0 && isBlankRecord(records[0])) records.shift();
  const blanksInside = records.slice(1).filter(isBlankRecord).length;
  records = records.filter((r, i) => i === 0 || !isBlankRecord(r));
  if (records.length === 0) {
    return { table: null, errors: [issue("tabella_vuota", "Incolla la tabella: copia le celle da Excel e incollale qui.")], warnings };
  }
  if (blanksInside > 0) warnings.push(issue("righe_vuote_saltate", "Ho saltato le righe vuote.", "rows"));

  const lastFilled = (r: readonly string[]) => {
    for (let j = r.length - 1; j >= 0; j--) if (r[j] !== "") return j;
    return -1;
  };
  const width = Math.max(...records.map((r) => lastFilled(r) + 1));
  if (width > maxCols) {
    return { table: null, errors: [issue("troppe_colonne", `La tabella può avere al massimo ${maxCols} colonne.`, "columns")], warnings };
  }
  if (records.length - 1 > maxRows) {
    return { table: null, errors: [issue("troppe_righe", `La tabella può avere al massimo ${maxRows} righe: allega un file.`, "rows")], warnings };
  }

  // 6. Intestazione.
  const first = Array.from({ length: width }, (_, j) => records[0][j] ?? "");
  const plan = planHeader(first, width, opts.columns ?? null, opts.forceHeader === true, errors, warnings);
  if (plan === null) return { table: null, errors, warnings };
  const dataRecords = plan.headerDetected ? records.slice(1) : records;
  if (dataRecords.length === 0) {
    errors.push(issue("nessuna_riga", "Manca almeno una riga di dati sotto i titoli.", "rows"));
    return { table: null, errors, warnings };
  }

  // 5. Righe corte e lunghe.
  const headerWidth = plan.headerDetected ? lastFilled(first) + 1 : width;
  let padded = false;
  const rows: string[][] = dataRecords.map((r, i) => {
    const filledTo = lastFilled(r) + 1;
    if (filledTo > headerWidth) {
      errors.push(issue("riga_troppo_lunga", `La riga ${i + 1} ha più celle dei titoli.`, `rows[${i}]`));
    }
    if (filledTo < headerWidth && r.length < headerWidth) padded = true;
    return Array.from({ length: width }, (_, j) => r[j] ?? "");
  });
  if (padded) warnings.push(issue("righe_completate", "Alcune righe erano più corte: ho lasciato vuote le celle mancanti.", "rows"));

  // Righe nell'ordine delle colonne finali.
  const columnCount = plan.columns.length;
  const cells: string[][] = rows.map((r) => {
    const out = Array.from({ length: columnCount }, () => "");
    r.forEach((cell, j) => {
      const target = plan.sourceToColumn[j] ?? -1;
      if (target >= 0) out[target] = cell;
    });
    return out;
  });
  cells.forEach((r, i) =>
    r.forEach((cell, j) => {
      if (cell.length > TABLE_LIMITS.maxCellLength) {
        errors.push(issue("cella_troppo_lunga", `Una cella può avere al massimo ${TABLE_LIMITS.maxCellLength} caratteri.`, `rows[${i}][${j}]`));
      }
    }),
  );

  // Tipi.
  const columns: TableColumn[] = plan.columns.map((c, j) => ({
    key: c.key,
    label: c.label,
    type: c.type ?? inferColumnType(cells.map((r) => r[j])),
  }));

  // Celle che un foglio di calcolo leggerebbe come formula.
  let formulas = 0;
  cells.forEach((r, i) =>
    r.forEach((cell, j) => {
      const numeric = columns[j].type === "numero" || columns[j].type === "percentuale" || columns[j].type === "valuta";
      if (isFormulaLike(cell, numeric)) {
        formulas++;
        if (formulas <= 20) {
          warnings.push(issue("formula_in_cella", "La cella inizia con = + - o @: la salviamo come testo.", `rows[${i}][${j}]`));
        }
      }
    }),
  );

  // Chiave senza doppioni.
  let keyIndex = 0;
  if (opts.keyColumn) {
    const k = foldKey(opts.keyColumn);
    keyIndex = columns.findIndex((c) => foldKey(c.key) === k || foldKey(c.label) === k);
    if (keyIndex < 0) {
      errors.push(issue("colonna_chiave_mancante", `Manca la colonna «${opts.keyColumn}».`, "columns"));
      keyIndex = 0;
    }
  }
  const seenKeys = new Map<string, number>();
  cells.forEach((r, i) => {
    const key = r[keyIndex].replace(/\s+/g, " ").toLowerCase();
    if (key === "") {
      // Without template columns the label is the pasted header (user text): use the position.
      errors.push(issue("chiave_mancante", `Nella riga ${i + 1} manca il valore della colonna ${keyIndex + 1}.`, `rows[${i}][${keyIndex}]`));
      return;
    }
    const previous = seenKeys.get(key);
    if (previous !== undefined) {
      errors.push(issue("chiave_doppia", `Le righe ${previous + 1} e ${i + 1} hanno lo stesso valore nella colonna ${keyIndex + 1}.`, `rows[${i}][${keyIndex}]`));
    } else {
      seenKeys.set(key, i);
    }
  });

  // Tipizzazione delle celle.
  const typedRows: Record<string, CellValue>[] = [];
  let cellErrors = 0;
  cells.forEach((r, i) => {
    const typed: Record<string, CellValue> = {};
    r.forEach((cell, j) => {
      const column = columns[j];
      const field = `rows[${i}][${j}]`;
      const unit = plan.columns[j].unit;
      const p = parseCell(column.type, cell, field, unit);
      if (p.ok) {
        typed[column.key] = p.value;
        warnings.push(...p.warnings);
      } else {
        cellErrors++;
        if (cellErrors <= 50) errors.push(p.error);
      }
    });
    typedRows.push(typed);
  });
  if (cellErrors > 50) {
    errors.push(issue("troppi_errori", `Ci sono altre ${cellErrors - 50} celle da correggere.`, "rows"));
  }

  const minRows = typeof opts.minRows === "number" ? opts.minRows : 0;
  const partial = cells.length < minRows;
  if (partial) {
    warnings.push(issue("righe_insufficienti", `Servono almeno ${minRows} righe: la risposta resta parziale.`, "rows"));
  }
  return {
    table: {
      separator: opts.separator ?? null,
      headerDetected: plan.headerDetected,
      columns,
      rows: cells,
      typedRows: errors.length === 0 ? typedRows : null,
      partial,
    },
    errors,
    warnings,
  };
}

/** Legge una tabella incollata (vedi l'intestazione del modulo). */
export function parsePastedTable(text: string, opts: PasteOptions = {}): PasteResult {
  const maxBytes = opts.maxBytes ?? TABLE_LIMITS.maxBytes;
  if (typeof text !== "string" || text.trim() === "") {
    return { table: null, errors: [issue("tabella_vuota", "Incolla la tabella: copia le celle da Excel e incollale qui.")], warnings: [] };
  }
  if (utf8Length(text) > maxBytes) {
    return {
      table: null,
      errors: [issue("tabella_troppo_grande", "La tabella è troppo grande per incollarla: allega il file Excel.")],
      warnings: [],
    };
  }
  const normalized = normalizeNewlines(text);
  const separator = detectSeparator(normalized);
  const warnings: Issue[] = [];
  let split = splitRecords(normalized, separator, true);
  if (split.unterminated) {
    warnings.push(issue("virgolette_aperte", "Una virgoletta non è chiusa: l'ho letta come testo.", "rows"));
    split = splitRecords(normalized, separator, false);
  }
  const result = buildTable(split.records, { ...opts, separator });
  return { ...result, warnings: [...warnings, ...result.warnings] };
}

/** Opzioni della lettura dalla `response.config` della voce. */
export function pasteOptionsFromConfig(config: ResponseConfig): PasteOptions {
  return {
    columns: Array.isArray(config.columns)
      ? config.columns.filter((c): c is TableColumnConfig => isPlainObject(c) && typeof c.key === "string" && c.key !== "")
      : undefined,
    keyColumn: typeof config.key_column === "string" && config.key_column !== "" ? config.key_column : undefined,
    minRows: typeof config.min_rows === "number" ? config.min_rows : undefined,
    maxRows: typeof config.max_rows === "number" ? Math.min(config.max_rows, TABLE_LIMITS.maxRows) : undefined,
  };
}

function readGrid(raw: Record<string, unknown>): string[][] | null {
  if (!Array.isArray(raw.rows) || !raw.rows.every((r) => Array.isArray(r))) return null;
  const cell = (v: unknown) => (typeof v === "string" ? v : typeof v === "number" && Number.isFinite(v) ? String(v) : "");
  const rows = (raw.rows as unknown[][]).map((r) => r.map(cell));
  const labels = Array.isArray(raw.columns)
    ? raw.columns.map((c) => (isPlainObject(c) ? cell(c.label ?? c.key) : cell(c)))
    : null;
  return labels ? [labels, ...rows] : rows;
}

/**
 * Tipo `tabella`. Accetta il testo incollato (stringa o `{text}`) oppure la
 * griglia dell'interfaccia `{columns:[{key,label}], rows:string[][]}`.
 * Valore `{columns, rows}`; normalizzato `{rows:[{chiave: valore tipizzato}]}`.
 */
export function normalizeTabella(raw: unknown, config: ResponseConfig): Outcome {
  const opts = pasteOptionsFromConfig(config);
  let result: PasteResult;
  if (typeof raw === "string") {
    result = parsePastedTable(raw, opts);
  } else if (isPlainObject(raw) && typeof raw.text === "string") {
    result = parsePastedTable(raw.text, opts);
  } else if (isPlainObject(raw)) {
    const grid = readGrid(raw);
    if (grid === null) {
      return outcome({ value: null, errors: [issue("tabella_vuota", "Incolla la tabella: copia le celle da Excel e incollale qui.")] });
    }
    result = buildTable(grid, { ...opts, forceHeader: Array.isArray(raw.columns) });
  } else {
    return outcome({ value: null, errors: [issue("tabella_vuota", "Incolla la tabella: copia le celle da Excel e incollale qui.")] });
  }
  const table = result.table;
  if (table === null) return outcome({ value: null, errors: result.errors, warnings: result.warnings });
  const value: Json = {
    columns: table.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })),
    rows: table.rows,
  };
  return outcome({
    value,
    normalized: result.errors.length === 0 && table.typedRows ? { rows: table.typedRows } : null,
    errors: result.errors,
    warnings: result.warnings,
    partial: table.partial,
  });
}
