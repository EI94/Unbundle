/**
 * Scheda di un dataset dal file (PIANO §6.5): lettura della tabella (CSV, TSV
 * o primo foglio XLSX non vuoto, con i lettori interni), righe, colonne e
 * tipo dedotto, qualità minima (percentuale di vuoti per colonna, colonne
 * vuote, fusi orari misti → avviso `dq.fusi_orari`), dati personali
 * dalle intestazioni e una proposta di mappatura delle colonne sui campi
 * collegati alla fonte (per nome).
 *
 * Nella scheda vanno solo nomi di colonna, tipi e conteggi: mai valori.
 *
 * Modulo puro.
 */
import { parseNumberIt } from "../answers/number-it.ts";
import { fail, ok, type Json, type Result } from "../types.ts";
import type { FilePersonalData } from "../vocab.ts";
import { parseDelimited } from "./csv.ts";
import { checkTables } from "./header-check.ts";
import { readOoxml } from "./ooxml.ts";
import { decodeTextFile, sniffFile, UC_UPLOAD_LIMITS } from "./sniff.ts";

export const TABULAR_KINDS = ["csv", "tsv", "xlsx"] as const;
export type TabularKind = (typeof TABULAR_KINDS)[number];

/** Tipi di file che diventano una scheda dataset. */
export const TABULAR_MIME_TYPES: readonly string[] = ["text/csv", "text/tab-separated-values", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"];

export interface TabularData {
  kind: TabularKind;
  sheet: string | null;
  rows: string[][];
  truncated: boolean;
}

export const PROFILE_MESSAGES = {
  non_tabellare: "Questo file non è una tabella: la scheda dataset si crea da un CSV o da un file Excel (.xlsx).",
  tabella_vuota: "Il file non contiene righe di dati.",
} as const;

function isBlankRow(row: readonly string[]): boolean {
  return !row.some((c) => typeof c === "string" && c.trim() !== "");
}

/** Legge la tabella di un file già controllato (stessi lettori della quarantena). */
export function readTabularFile(bytes: Uint8Array, fileName: string): Result<TabularData> {
  const sniffed = sniffFile(bytes, fileName, { maxBytes: UC_UPLOAD_LIMITS.clientBlobMaxBytes });
  if (!sniffed.ok) return sniffed;
  const { kind } = sniffed.value;
  if (kind === "csv" || kind === "tsv") {
    const parsed = parseDelimited(decodeTextFile(bytes, sniffed.value.text!), { kind });
    if (!parsed.ok) return parsed;
    return ok({ kind, sheet: null, rows: parsed.value.rows.filter((r) => !isBlankRow(r)), truncated: parsed.value.truncated });
  }
  if (kind === "xlsx") {
    const doc = readOoxml(bytes, "xlsx");
    if (!doc.ok) return doc;
    const table = doc.value.tables.find((t) => t.rows.some((r) => !isBlankRow(r)));
    if (!table) return fail("tabella_vuota", PROFILE_MESSAGES.tabella_vuota);
    return ok({ kind, sheet: table.name, rows: table.rows.filter((r) => !isBlankRow(r)), truncated: false });
  }
  return fail("non_tabellare", PROFILE_MESSAGES.non_tabellare);
}

export type ColumnType = "numero" | "data" | "data_ora" | "testo" | "vuota";

export interface ProfiledColumn {
  /** Intestazione (nome della colonna), troncata a 120 caratteri. */
  name: string;
  type: ColumnType;
  /** Percentuale di celle vuote, intera. */
  empty_pct: number;
}

export interface DatasetProfile {
  rowCount: number;
  columns: ProfiledColumn[];
  /** `uc_datasets.schema`. */
  schema: { columns: { name: string; type: ColumnType }[]; truncated: boolean };
  /** `uc_datasets.quality`: solo percentuali, nomi di colonna e codici. */
  quality: { vuoti_pct: Record<string, number>; colonne_vuote: string[]; fusi_orari_misti: boolean; avvisi: string[] };
  /** Colonne con intestazioni o valori personali (`uc_datasets.pii_columns`). */
  personalColumns: string[];
  personalData: FilePersonalData;
  /** Colonna → chiave del campo collegato (`uc_datasets.column_mapping`). */
  columnMapping: Record<string, string>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const IT_DATE = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}$/;
const ISO_DATETIME = /^\d{4}-\d{2}-\d{2}[T ]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?\s*(Z|[+-]\d{2}:?\d{2}|UTC)?$/i;
const IT_DATETIME = /^\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}[ T]\d{1,2}[:.]\d{2}([:.]\d{2})?$/;
const ZONED = /(Z|[+-]\d{2}:?\d{2}|UTC)$/i;

function cellType(value: string): Exclude<ColumnType, "vuota"> {
  const v = value.trim();
  if (ISO_DATETIME.test(v) || IT_DATETIME.test(v)) return "data_ora";
  if (ISO_DATE.test(v) || IT_DATE.test(v)) return "data";
  if (parseNumberIt(v).ok) return "numero";
  return "testo";
}

/** Nome di colonna confrontabile: minuscolo, senza accenti, `_` tra le parole. */
export function normalizeColumnName(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function clip(text: string, max = 120): string {
  const chars = Array.from(text.replace(/\s+/g, " ").trim());
  return chars.length <= max ? chars.join("") : chars.slice(0, max).join("");
}

export interface MappingField {
  /** Chiave della voce `campo` (es. `richiesta.canale`). */
  key: string;
  title?: string | null;
}

/** Proposta per nome: la colonna coincide con la parte finale della chiave del campo o con il suo titolo. */
export function proposeColumnMapping(columns: readonly string[], fields: readonly MappingField[]): Record<string, string> {
  const byName = new Map<string, string>();
  for (const f of fields) {
    const tail = normalizeColumnName(f.key.split(".").pop() ?? "");
    if (tail && !byName.has(tail)) byName.set(tail, f.key);
    const full = normalizeColumnName(f.key);
    if (full && !byName.has(full)) byName.set(full, f.key);
    const title = f.title ? normalizeColumnName(f.title) : "";
    if (title && !byName.has(title)) byName.set(title, f.key);
  }
  const out: Record<string, string> = {};
  const used = new Set<string>();
  for (const c of columns) {
    const key = byName.get(normalizeColumnName(c));
    if (key && !used.has(key) && !(c in out)) {
      out[c] = key;
      used.add(key);
    }
  }
  return out;
}

/**
 * Profilo della tabella: la prima riga è l'intestazione. Nessun valore esce
 * di qui, solo nomi di colonna, tipi, conteggi e percentuali.
 */
export function profileDataset(
  data: Pick<TabularData, "rows" | "truncated">,
  opts: { forbiddenColumns?: readonly string[] | null; fields?: readonly MappingField[]; pseudonymized?: boolean } = {},
): Result<DatasetProfile> {
  const rows = data.rows.filter((r) => !isBlankRow(r));
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  if (body.length === 0) return fail("tabella_vuota", PROFILE_MESSAGES.tabella_vuota);
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const names: string[] = [];
  const seen = new Map<string, number>();
  for (let c = 0; c < width; c++) {
    let name = clip(typeof header[c] === "string" && header[c].trim() ? header[c] : `Colonna ${c + 1}`);
    const n = seen.get(name) ?? 0;
    seen.set(name, n + 1);
    if (n > 0) name = `${name} (${n + 1})`;
    names.push(name);
  }

  const columns: ProfiledColumn[] = [];
  let zoned = 0;
  let unzoned = 0;
  for (let c = 0; c < width; c++) {
    let empty = 0;
    const types = new Map<Exclude<ColumnType, "vuota">, number>();
    for (const row of body) {
      const cell = typeof row[c] === "string" ? row[c].trim() : "";
      if (!cell) {
        empty++;
        continue;
      }
      const t = cellType(cell);
      types.set(t, (types.get(t) ?? 0) + 1);
      if (t === "data_ora") {
        if (ZONED.test(cell)) zoned++;
        else unzoned++;
      }
    }
    const filled = body.length - empty;
    let type: ColumnType = "vuota";
    if (filled > 0) {
      const [top] = [...types.entries()].sort((a, b) => b[1] - a[1]);
      type = top && top[1] === filled ? top[0] : "testo";
    }
    columns.push({ name: names[c], type, empty_pct: Math.round((100 * empty) / body.length) });
  }

  const avvisi: string[] = [];
  const mixedZones = zoned > 0 && unzoned > 0;
  if (mixedZones) avvisi.push("dq.fusi_orari");
  const emptyColumns = columns.filter((c) => c.type === "vuota").map((c) => c.name);
  if (emptyColumns.length > 0) avvisi.push("dq.colonne_vuote");
  if (data.truncated) avvisi.push("tabella_troncata");

  const check = checkTables([{ rows }], { personalAllowed: true, forbiddenColumns: opts.forbiddenColumns });
  const personalIdx = [...new Set(check.findings.filter((f) => f.category === "personale").map((f) => f.column))].sort((a, b) => a - b);
  const personalColumns = personalIdx.map((i) => names[i] ?? `Colonna ${i + 1}`);
  const personalData: FilePersonalData = personalColumns.length === 0 ? "no" : opts.pseudonymized ? "pseudonimizzati" : "identificativi";

  return ok({
    rowCount: body.length,
    columns,
    schema: { columns: columns.map((c) => ({ name: c.name, type: c.type })), truncated: data.truncated },
    quality: {
      vuoti_pct: Object.fromEntries(columns.map((c) => [c.name, c.empty_pct])),
      colonne_vuote: emptyColumns,
      fusi_orari_misti: mixedZones,
      avvisi,
    },
    personalColumns,
    personalData,
    columnMapping: proposeColumnMapping(names, opts.fields ?? []),
  });
}

/** Il profilo come JSON per le colonne `jsonb` (nessun valore, solo struttura). */
export function profileJson(p: DatasetProfile): { schema: Json; quality: Json; column_mapping: Json; pii_columns: Json } {
  return {
    schema: p.schema as unknown as Json,
    quality: p.quality as unknown as Json,
    column_mapping: p.columnMapping,
    pii_columns: p.personalColumns,
  };
}
