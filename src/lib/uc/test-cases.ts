/**
 * Casi di prova importati da file (PIANO §3.11, `uc_test_cases`).
 *
 * Formati ammessi:
 * - JSON: un array di righe, oppure `{ schema: "unbundle.uc-test-cases/1", cases: [...] }`;
 * - CSV (separatore `,`, `;` o TAB, celle tra virgolette come Excel), con
 *   intestazione `key, kind, input, atteso, regole, covers, serve_per`.
 *
 * Ogni riga: `key` unica, `kind ∈ {sintetico, pseudonimizzato}` (pseudonimizzato
 * solo con il blocco `a8` sciolto), `input` (oggetto JSON o testo),
 * `expected {atteso, regole[]}`, `covers[]`, `serve_per[]`. Ogni testo passa
 * dalla scansione (`scanText(context: 'caso_prova')`, iniettata): un esito
 * bloccante ferma l'import. Gli errori riportano riga, campo e categoria, mai il
 * testo. Modulo puro.
 */
import type { Json } from "./types.ts";
import { PHASES, TEST_CASE_KINDS, isVocab, type Phase, type TestCaseKind } from "./vocab.ts";

export const TEST_CASES_SCHEMA = "unbundle.uc-test-cases/1" as const;

/** Stessa forma di `scanText` di `text/scan.ts` (PIANO §3.10). */
export type ScanCategory = "sanitario" | "discriminatorio" | "nome_persona" | "data_nascita" | "codice_fiscale" | "contatto";
export interface ScanFinding {
  category: ScanCategory | string;
  term: string;
}
export type TestCaseScanner = (text: string, opts: { context: "caso_prova" }) => { blocking: ScanFinding[]; warnings: ScanFinding[] };

export interface TestCaseRow {
  key: string;
  kind: TestCaseKind;
  input: Json;
  expected: { atteso: string; regole: string[] };
  covers: string[];
  serve_per: Phase[];
}

export interface TestCaseIssue {
  /** Riga del file (1 = prima riga di dati). */
  row?: number;
  field?: string;
  code: string;
  message: string;
  category?: string;
}

export type TestCaseParseResult =
  | { ok: true; value: TestCaseRow[]; warnings: TestCaseIssue[] }
  | { ok: false; code: "casi_prova_non_validi"; message: string; errors: TestCaseIssue[] };

export interface ParseTestCasesOptions {
  format?: "json" | "csv";
  /** Blocco `a8` sciolto: solo così si importano casi `pseudonimizzato`. */
  a8Resolved: boolean;
  scan: TestCaseScanner;
  /** Chiavi delle voci del caso: le regole citate devono esistere. */
  knownItemKeys?: ReadonlySet<string>;
  maxRows?: number;
  maxBytes?: number;
}

export const TEST_CASE_KEY = /^[a-z0-9][a-z0-9_.-]{0,59}$/;
const ITEM_KEY = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/;
const MAX_TEXT = 4000;

// ── CSV ───────────────────────────────────────────────────────────────

/** Legge un CSV con celle tra virgolette (a capo e `""` ammessi dentro). */
export function parseCsv(text: string): { rows: string[][]; separator: string } | { error: string } {
  const src = text.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  const firstLine = src.split("\n", 1)[0] ?? "";
  const candidates = ["\t", ";", ","];
  const separator = candidates.find((c) => firstLine.includes(c)) ?? ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"' && cell === "") quoted = true;
    else if (ch === separator) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (quoted) return { error: "Virgolette non chiuse nel file." };
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { rows: rows.filter((r) => r.some((c) => c.trim() !== "")), separator };
}

const HEADER_ALIASES: Readonly<Record<string, string>> = {
  key: "key",
  chiave: "key",
  id: "key",
  kind: "kind",
  tipo: "kind",
  input: "input",
  richiesta: "input",
  atteso: "atteso",
  esito_atteso: "atteso",
  expected: "atteso",
  regole: "regole",
  rules: "regole",
  covers: "covers",
  copre: "covers",
  eccezioni_coperte: "covers",
  serve_per: "serve_per",
  serves_for: "serve_per",
};

function normHeader(h: string): string {
  return h
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

function splitList(cell: string, separators: RegExp): string[] {
  return cell
    .split(separators)
    .map((s) => s.trim())
    .filter(Boolean);
}

function csvToRaw(text: string): { rows: Record<string, unknown>[] } | { error: string } {
  const parsed = parseCsv(text);
  if ("error" in parsed) return parsed;
  const [header, ...data] = parsed.rows;
  if (!header) return { error: "Il file è vuoto." };
  const columns = header.map((h) => HEADER_ALIASES[normHeader(h)] ?? null);
  if (!columns.includes("key")) return { error: "Manca la colonna «key»." };
  const rows = data.map((cells) => {
    const out: Record<string, unknown> = {};
    columns.forEach((c, i) => {
      if (!c) return;
      const cell = (cells[i] ?? "").trim();
      if (c === "regole" || c === "serve_per") out[c] = splitList(cell, /[|,\s]+/);
      else if (c === "covers") out[c] = splitList(cell, /[|\n]+/);
      else if (c === "input") {
        if (/^[[{]/.test(cell)) {
          try {
            out[c] = JSON.parse(cell);
            return;
          } catch {
            // resta testo
          }
        }
        out[c] = cell === "" ? null : { testo: cell };
      } else out[c] = cell;
    });
    return out;
  });
  return { rows };
}

// ── Validazione ───────────────────────────────────────────────────────

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function toJson(v: unknown, depth = 0): Json | undefined {
  if (depth > 8) return undefined;
  if (v === null || typeof v === "boolean" || typeof v === "string") return v;
  if (typeof v === "number") return Number.isFinite(v) ? v : undefined;
  if (Array.isArray(v)) {
    const out: Json[] = [];
    for (const x of v) {
      const j = toJson(x, depth + 1);
      if (j === undefined) return undefined;
      out.push(j);
    }
    return out;
  }
  if (isPlainObject(v)) {
    const out: { [key: string]: Json } = {};
    for (const [k, x] of Object.entries(v)) {
      const j = toJson(x, depth + 1);
      if (j === undefined) return undefined;
      out[k] = j;
    }
    return out;
  }
  return undefined;
}

function strings(v: unknown): string[] | null {
  if (v === undefined || v === null || v === "") return [];
  if (typeof v === "string") return [v];
  if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v.map((x) => x.trim()).filter(Boolean);
  return null;
}

const SAFE_SEGMENT = /^[A-Za-z0-9_]{1,40}$/;

/**
 * Ogni testo da scansionare: le foglie stringa e anche i nomi dei campi degli
 * oggetti (un campo «visita medica» è un testo come gli altri). Nel percorso un
 * nome di campo compare solo se è un identificativo semplice, altrimenti come
 * `#n`: gli errori non ripetono il testo.
 */
function leaves(value: Json, path: string, out: { path: string; text: string }[]): void {
  if (typeof value === "string") {
    if (value.trim()) out.push({ path, text: value });
  } else if (Array.isArray(value)) value.forEach((v, i) => leaves(v, `${path}[${i}]`, out));
  else if (value && typeof value === "object") {
    Object.entries(value).forEach(([k, v], i) => {
      const segment = SAFE_SEGMENT.test(k) ? k : `#${i + 1}`;
      const child = path ? `${path}.${segment}` : segment;
      if (k.trim()) out.push({ path: `${child} (nome del campo)`, text: k });
      leaves(v, child, out);
    });
  }
}

function rawRows(text: string, format: "json" | "csv"): { rows: unknown[] } | { error: string } {
  if (format === "csv") return csvToRaw(text);
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ""));
  } catch {
    return { error: "Il file non è un JSON valido." };
  }
  if (Array.isArray(parsed)) return { rows: parsed };
  if (isPlainObject(parsed) && Array.isArray(parsed.cases)) {
    if (parsed.schema !== undefined && parsed.schema !== TEST_CASES_SCHEMA) return { error: `Schema non riconosciuto: serve «${TEST_CASES_SCHEMA}».` };
    return { rows: parsed.cases };
  }
  return { error: "Il JSON deve essere un elenco di casi di prova o un oggetto con «cases»." };
}

function detectFormat(text: string): "json" | "csv" {
  return /^﻿?\s*[[{]/.test(text) ? "json" : "csv";
}

/** Legge e valida i casi di prova. Restituisce tutte le righe valide oppure tutti gli errori. */
export function parseTestCases(text: string, opts: ParseTestCasesOptions): TestCaseParseResult {
  const errors: TestCaseIssue[] = [];
  const warnings: TestCaseIssue[] = [];
  const failWith = (list: TestCaseIssue[]): TestCaseParseResult => ({
    ok: false,
    code: "casi_prova_non_validi",
    message: list.length === 1 ? list[0].message : `Il file ha ${list.length} problemi: correggili e caricalo di nuovo.`,
    errors: list,
  });

  const maxBytes = opts.maxBytes ?? 2_000_000;
  if (new TextEncoder().encode(text).length > maxBytes) return failWith([{ code: "file_troppo_grande", message: "Il file è troppo grande." }]);
  const raw = rawRows(text, opts.format ?? detectFormat(text));
  if ("error" in raw) return failWith([{ code: "formato_non_valido", message: raw.error }]);
  const maxRows = opts.maxRows ?? 500;
  if (raw.rows.length === 0) return failWith([{ code: "nessun_caso", message: "Il file non contiene casi di prova." }]);
  if (raw.rows.length > maxRows) return failWith([{ code: "troppi_casi", message: `Al massimo ${maxRows} casi di prova per file.` }]);

  const seen = new Set<string>();
  const rows: TestCaseRow[] = [];
  raw.rows.forEach((r, index) => {
    const rowNo = index + 1;
    const err = (field: string, code: string, message: string, category?: string) => errors.push({ row: rowNo, field, code, message, category });
    if (!isPlainObject(r)) {
      err("", "riga_non_valida", `Riga ${rowNo}: non è un caso di prova.`);
      return;
    }
    const key = typeof r.key === "string" ? r.key.trim().toLowerCase() : "";
    if (!TEST_CASE_KEY.test(key)) err("key", "chiave_non_valida", `Riga ${rowNo}: la chiave deve avere lettere minuscole, cifre, «.», «_» o «-» (al massimo 60).`);
    else if (seen.has(key)) err("key", "chiave_doppia", `Riga ${rowNo}: la chiave ${key} compare due volte.`);
    seen.add(key);

    const kindRaw = typeof r.kind === "string" && r.kind.trim() ? r.kind.trim().toLowerCase() : "sintetico";
    if (!isVocab(TEST_CASE_KINDS, kindRaw)) err("kind", "tipo_non_valido", `Riga ${rowNo}: il tipo è «sintetico» o «pseudonimizzato».`);
    else if (kindRaw === "pseudonimizzato" && !opts.a8Resolved) {
      err("kind", "a8_non_sciolto", `Riga ${rowNo}: i casi pseudonimizzati si caricano solo dopo l'approvazione della scheda A.8.`);
    }

    const input = toJson(r.input);
    if (input === undefined || input === null || (typeof input === "string" && !input.trim())) {
      err("input", "input_mancante", `Riga ${rowNo}: manca la richiesta d'esempio («input»).`);
    }

    const expectedObj = isPlainObject(r.expected) ? r.expected : null;
    const attesoRaw = expectedObj ? (expectedObj.atteso ?? expectedObj.esito) : (r.atteso ?? (typeof r.expected === "string" ? r.expected : undefined));
    const atteso = typeof attesoRaw === "string" ? attesoRaw.trim() : "";
    if (!atteso) err("atteso", "atteso_mancante", `Riga ${rowNo}: manca l'esito atteso.`);
    else if (atteso.length > MAX_TEXT) err("atteso", "testo_troppo_lungo", `Riga ${rowNo}: l'esito atteso è troppo lungo.`);

    const regole = strings(expectedObj ? expectedObj.regole : r.regole);
    if (regole === null) err("regole", "regole_non_valide", `Riga ${rowNo}: «regole» è un elenco di ID di voci.`);
    else {
      for (const id of regole) {
        if (!ITEM_KEY.test(id)) err("regole", "regola_non_valida", `Riga ${rowNo}: in «regole» c'è un valore che non è un ID di voce.`);
        else if (opts.knownItemKeys && !opts.knownItemKeys.has(id)) err("regole", "regola_assente", `Riga ${rowNo}: la voce ${id} non esiste nel caso.`);
      }
    }

    const covers = strings(r.covers);
    if (covers === null) err("covers", "covers_non_valido", `Riga ${rowNo}: «covers» è un elenco di testi.`);
    const servePer = strings(r.serve_per ?? r.serves_for);
    const phases: Phase[] = [];
    if (servePer === null) err("serve_per", "serve_per_non_valido", `Riga ${rowNo}: «serve_per» è un elenco di usi.`);
    else {
      for (const p of servePer) {
        const v = p.toLowerCase();
        if (isVocab(PHASES, v)) {
          if (!phases.includes(v)) phases.push(v);
        } else err("serve_per", "uso_non_valido", `Riga ${rowNo}: in «serve_per» ci sono solo questi usi: ${PHASES.join(", ")}.`);
      }
    }

    if (input === undefined || input === null || !atteso || regole === null || covers === null) return;
    // Scansione di ogni testo: input, esito atteso, eccezioni coperte.
    const texts: { path: string; text: string }[] = [];
    leaves(input, "input", texts);
    texts.push({ path: "atteso", text: atteso });
    covers.forEach((c, i) => texts.push({ path: `covers[${i}]`, text: c }));
    let blocked = false;
    for (const t of texts) {
      if (t.text.length > MAX_TEXT) {
        err(t.path, "testo_troppo_lungo", `Riga ${rowNo}: il testo in ${t.path} è troppo lungo.`);
        blocked = true;
        continue;
      }
      const result = opts.scan(t.text, { context: "caso_prova" });
      for (const f of result.blocking) {
        blocked = true;
        err(t.path, "testo_non_ammesso", `Riga ${rowNo}: il testo in ${t.path} contiene dati da togliere (${f.category}).`, String(f.category));
      }
      for (const f of result.warnings) {
        warnings.push({ row: rowNo, field: t.path, code: "testo_da_controllare", message: `Riga ${rowNo}: controlla il testo in ${t.path} (${f.category}).`, category: String(f.category) });
      }
    }
    if (blocked || !isVocab(TEST_CASE_KINDS, kindRaw) || !TEST_CASE_KEY.test(key)) return;
    rows.push({ key, kind: kindRaw, input, expected: { atteso, regole }, covers, serve_per: phases });
  });

  if (errors.length > 0) return failWith(errors);
  return { ok: true, value: rows, warnings };
}
