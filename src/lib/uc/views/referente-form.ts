/**
 * Moduli della pagina del referente (`/r/[token]`, PIANO §5.4, §5.5, §3.9).
 *
 * Qui sta tutto quello che la pagina decide senza il server, così si prova con
 * `node --test` e gira uguale nel browser:
 *
 * - **Valore dell'input** per ogni tipo di risposta: la forma che l'input
 *   modifica (`emptyValue`, `valueFrom`) e quella che arriva al normalizzatore
 *   (`toRaw`). Bozze e invii mandano la stessa forma, così gli errori della
 *   bozza sono quelli dell'invio.
 * - **Modulo della voce** (`ReferentForm`): valore, nota, «È una stima», «Da
 *   dove viene», «Valido dal», «Ho risposto solo in parte», «Non lo so», «Non si
 *   applica», conferma o correzione del valore già noto, e l'**intento**
 *   (`intent`): cosa ha deciso il referente sulla domanda. L'intento si salva in
 *   bozza mentre avanza e parte con l'invio dell'argomento (DESIGN §4.2).
 * - **Riepilogo e invio a gruppi** (`answerSummary`, `batchEntry`,
 *   `chunkBatch`): le righe di «Controlla e invia» e i corpi di
 *   `POST …/answers`, al massimo 50 risposte per chiamata.
 * - **Corpi delle chiamate** `PUT …/draft` e `POST …/answer` (`draftBody`,
 *   `answerBody`) secondo gli schemi stretti delle API di WP7b, e il controllo
 *   prima dell'invio (`checkSubmit`) con la stessa normalizzazione e la stessa
 *   scansione del testo del server.
 * - **Salvataggio automatico**: chiavi e formato della copia sul dispositivo
 *   (mai per le voci personali), stati del salvataggio, attese tra i tentativi.
 * - **Testi** dell'intestazione: scadenza del link, numero di domande, tempo.
 *
 * Il server ricontrolla sempre tutto: qui si evita solo di mandare quello che
 * verrebbe rifiutato e si spiega perché, accanto al campo.
 *
 * Modulo puro, senza import dell'app.
 */
import { choiceOptions, isOtherOption } from "../answers/choice.ts";
import { confirmValueConfig, confirmationBase } from "../answers/confirm.ts";
import { CURRENCY_CODES, currencyFromToken, currencyFromUnit, perFromUnit, vatFromUnit } from "../answers/currency.ts";
import { itemTimeZone } from "../answers/datetime.ts";
import { intervalKindFromConfig } from "../answers/interval.ts";
import { issue, type Issue } from "../answers/issues.ts";
import { answerContext } from "../answers/normalize.ts";
import { parsePercentHint } from "../answers/percent.ts";
import { prepareAnswer, prepareUniversalAction, type PreparedAnswer } from "../answers/prepare.ts";
import { isPlainObject } from "../answers/strings.ts";
import { buildTable, pasteOptionsFromConfig, parsePastedTable, type PasteResult } from "../answers/table-paste.ts";
import type { IntervalKind, ResponseConfig } from "../answers/types.ts";
import { UNITS, lookupUnit, parseUnitHint, type UnitDef } from "../answers/units.ts";
import type { ApprovalView, ReferentAnswerKind, ReferentItemView } from "../public-view.ts";
import type { Json } from "../types.ts";
import { csvCell } from "../../learning/policy.ts";
import { findingMessage, hasHardBlock, scanPayload } from "../text/scan.ts";
import { formatCountIt } from "./format.ts";
import { SOURCE_BASIS, type ResponseType, type SourceBasis } from "../vocab.ts";

type Obj = Record<string, Json>;

function str(v: unknown): string {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v).replace(".", ",");
  return "";
}

function obj(v: unknown): Obj {
  return isPlainObject(v) ? (v as Obj) : {};
}

function filled(v: unknown): boolean {
  return typeof v === "string" ? v.trim() !== "" : v !== null && v !== undefined;
}

/** Copia senza le stringhe vuote: il normalizzatore legge «assente», non «vuoto». */
function compact(o: Obj): Obj {
  const out: Obj = {};
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === "string" && v.trim() === "") continue;
    if (v === null || v === undefined) continue;
    out[k] = typeof v === "string" ? v.trim() : v;
  }
  return out;
}

const PLAIN_NUMBER = /^\s*[-+]?(?:\d[\d.' ]*)?(?:,\d+)?\s*$/;

/** Eccezioni di una regola confermata con «È così» senza eccezioni scritte. */
export const NO_EXCEPTIONS = "nessuna segnalata";

// ── Unità degli input ─────────────────────────────────────────────────

export interface UnitChoice {
  /** `fissa`: un'unità fisica, convertibile con le altre della stessa grandezza; `scelta`: una tra le alternative del template; `etichetta`: un conteggio («passeggeri»); `nessuna`. */
  mode: "fissa" | "scelta" | "etichetta" | "nessuna";
  options: { code: string; label: string }[];
  defaultCode: string;
  label: string | null;
}

function unitOptions(dimensionOf: UnitDef, exclude: readonly string[] = []): { code: string; label: string }[] {
  return UNITS.filter((u) => u.dimension === dimensionOf.dimension && !exclude.includes(u.code)).map((u) => ({ code: u.code, label: u.label }));
}

/** Unità dell'input `numero` dall'unità in testo libero del template. */
export function numberUnitChoice(config: ResponseConfig): UnitChoice {
  const hint = parseUnitHint(typeof config.unit === "string" ? config.unit : null);
  if (hint.unit) return { mode: "fissa", options: unitOptions(hint.unit, ["s"]), defaultCode: hint.unit.code, label: hint.unit.label };
  if (hint.alternatives.length > 1) return { mode: "scelta", options: hint.alternatives.map((u) => ({ code: u.code, label: u.label })), defaultCode: "", label: null };
  if (hint.label) return { mode: "etichetta", options: [], defaultCode: "", label: hint.label };
  return { mode: "nessuna", options: [], defaultCode: "", label: hint.raw };
}

const TIME_UNITS = UNITS.filter((u) => u.dimension === "tempo" && u.code !== "s");

/** Unità dell'input `durata`: minuti, ore, giorni, settimane, mesi; proposta quella del template. */
export function durationUnitChoice(config: ResponseConfig): UnitChoice {
  const hint = parseUnitHint(typeof config.unit === "string" ? config.unit : null);
  const expected = hint.unit && hint.unit.dimension === "tempo" ? hint.unit : null;
  const alternatives = hint.alternatives.filter((u) => u.dimension === "tempo");
  const options = (alternatives.length > 1 ? alternatives : TIME_UNITS).map((u) => ({ code: u.code, label: u.label }));
  return { mode: alternatives.length > 1 ? "scelta" : "fissa", options, defaultCode: expected?.code ?? "", label: expected?.label ?? null };
}

/** Tipo degli estremi dell'intervallo (decide gli input: orari, date, numeri…). */
export function intervalKindOf(config: ResponseConfig): IntervalKind | null {
  return intervalKindFromConfig(config).kind;
}

/** Unità degli estremi di un intervallo di numeri o di durate; null per orari e date. */
export function intervalUnitChoice(config: ResponseConfig): UnitChoice | null {
  const kind = intervalKindOf(config);
  if (kind === "durata") return durationUnitChoice(config);
  if (kind === "numero") return numberUnitChoice(config);
  return null;
}

/** Valute proposte nell'elenco, con quella della voce per prima. */
export function currencyChoices(config: ResponseConfig): string[] {
  const first = defaultCurrency(config);
  const common = ["EUR", "CHF", "GBP", "USD"];
  return [...new Set([first, ...common, ...CURRENCY_CODES])];
}

function defaultCurrency(config: ResponseConfig): string {
  return currencyFromToken(typeof config.currency === "string" ? config.currency : "") ?? currencyFromUnit(typeof config.unit === "string" ? config.unit : null) ?? "EUR";
}

/** IVA fissata dalla voce (configurazione o unità del template), altrimenti null: la indica il referente. */
export function fixedVat(config: ResponseConfig): "inclusa" | "esclusa" | null {
  if (config.vat === "inclusa" || config.vat === "esclusa") return config.vat;
  return vatFromUnit(typeof config.unit === "string" ? config.unit : null);
}

// ── Valore dell'input per tipo ────────────────────────────────────────

export type TableGrid = {
  columns: { key: string; label: string }[];
  rows: string[][];
};

function configColumns(config: ResponseConfig): { key: string; label: string }[] {
  const cols = pasteOptionsFromConfig(config).columns ?? [];
  return cols.map((c) => ({ key: c.key, label: typeof c.label === "string" && c.label.trim() ? c.label : c.key }));
}

/** Valore vuoto dell'input del tipo, con le proposte del template (unità, valuta, base, fuso…). */
export function emptyValue(type: ResponseType | null, config: ResponseConfig): Json {
  switch (type ?? "testo") {
    case "numero":
      return { value: "", unit: numberUnitChoice(config).defaultCode };
    case "valuta":
      return {
        amount: "",
        currency: defaultCurrency(config),
        vat: fixedVat(config) ?? "",
        per: (typeof config.per === "string" ? config.per : null) ?? perFromUnit(typeof config.unit === "string" ? config.unit : null) ?? "",
        fx: { rate_to_eur: "", date: "", source: "" },
      };
    case "percentuale":
      return { value: "", base: (typeof config.base === "string" ? config.base : null) ?? parsePercentHint(typeof config.unit === "string" ? config.unit : null).base ?? "" };
    case "durata":
      return { amount: "", unit: durationUnitChoice(config).defaultCode };
    case "data":
      return "";
    case "data_ora":
      return { date: "", time: "", tz: itemTimeZone(config) };
    case "intervallo":
      return { from: "", to: "", unit: intervalUnitChoice(config)?.defaultCode ?? "" };
    case "si_no":
      return { value: null };
    case "scelta":
      return { option: "", other_text: "" };
    case "scelta_multipla":
      return { options: [], other_text: "" };
    case "codice":
      return { code: "" };
    case "tabella":
      return { columns: configColumns(config), rows: [] };
    case "file":
      return { file_ids: [] };
    case "dataset":
      return { file_id: "", dataset_id: "" };
    case "conferma_regola":
      return { choice: "", text: "", exceptions: "" };
    case "conferma_formula":
      return { choice: "", formula: "" };
    case "conferma_valore": {
      const base = confirmationBase(config);
      return { choice: "", value: emptyValue(base.type ?? "testo", base.config) };
    }
    case "collegamento_sistema":
      return { sistema: "", oggetto: "", campo: "", accesso: "", chi_ha_accesso: "", frequenza: "" };
    case "caso_prova":
      return { richiesta: "", atteso: "", regole: "", tipo: "sintetico" };
    case "testo":
    default:
      return { text: "" };
  }
}

function unitCode(token: unknown, fallback: string): string {
  if (typeof token !== "string" || token.trim() === "") return fallback;
  return lookupUnit(token)?.code ?? token;
}

/**
 * Valore dell'input da un valore qualsiasi: bozza salvata, risposta già data
 * (valore canonico), valore letto dal testo dichiarato in call. Quello che non
 * si riconosce resta vuoto.
 */
export function valueFrom(type: ResponseType | null, config: ResponseConfig, raw: Json | null | undefined): Json {
  const base = emptyValue(type, config);
  if (raw === null || raw === undefined) return base;
  const b = obj(base);
  const o = obj(raw);
  switch (type ?? "testo") {
    case "numero":
      if (typeof raw === "string" || typeof raw === "number") return { ...b, value: str(raw) };
      return { value: str(o.value), unit: unitCode(o.unit, str(b.unit)) };
    case "valuta": {
      if (typeof raw === "string" || typeof raw === "number") return { ...b, amount: str(raw) };
      const fx = obj(o.fx);
      return {
        amount: str(o.amount),
        currency: typeof o.currency === "string" && o.currency ? o.currency : str(b.currency),
        vat: o.vat === "inclusa" || o.vat === "esclusa" ? o.vat : str(b.vat),
        per: typeof o.per === "string" && o.per ? o.per : str(b.per),
        fx: { rate_to_eur: str(fx.rate_to_eur), date: str(fx.date), source: str(fx.source) },
      };
    }
    case "percentuale":
      if (typeof raw === "string" || typeof raw === "number") return { ...b, value: str(raw).replace(/\s*%\s*$/, "") };
      return { value: str(o.value).replace(/\s*%\s*$/, ""), base: typeof o.base === "string" && o.base ? o.base : str(b.base) };
    case "durata":
      if (typeof raw === "string" || typeof raw === "number") return { ...b, amount: str(raw) };
      return { amount: str(o.amount), unit: unitCode(o.unit, str(b.unit)) };
    case "data":
      return typeof raw === "string" ? raw : str(o.value ?? o.date);
    case "data_ora": {
      const tz = typeof o.tz === "string" && o.tz ? o.tz : str(b.tz);
      if (typeof o.local === "string") {
        const [date, time] = o.local.split("T");
        return { date: date ?? "", time: (time ?? "").slice(0, 5), tz };
      }
      if (typeof o.local_time === "string") return { date: "", time: o.local_time, tz };
      return { date: str(o.date), time: str(o.time), tz };
    }
    case "intervallo": {
      const end = (v: Json | undefined) => (isPlainObject(v) ? str((v as Obj).amount ?? (v as Obj).value) : str(v));
      return { from: end(o.from), to: end(o.to), unit: unitCode(o.unit, str(b.unit)) };
    }
    case "si_no": {
      const v = isPlainObject(raw) ? o.value : raw;
      return { value: typeof v === "boolean" ? v : null };
    }
    case "scelta":
      if (typeof raw === "string") return { option: raw, other_text: "" };
      return { option: str(o.option), other_text: str(o.other_text) };
    case "scelta_multipla": {
      const list = Array.isArray(raw) ? raw : Array.isArray(o.options) ? o.options : [];
      return { options: list.filter((x): x is string => typeof x === "string"), other_text: str(o.other_text) };
    }
    case "codice":
      return { code: typeof raw === "string" ? raw : str(o.code) };
    case "tabella":
      return gridFromValue(raw, config);
    case "file":
      return { file_ids: Array.isArray(o.file_ids) ? o.file_ids.filter((x): x is string => typeof x === "string") : [] };
    case "dataset":
      return { file_id: str(o.file_id), dataset_id: str(o.dataset_id) };
    case "conferma_regola":
      return { choice: str(o.choice), text: str(o.text), exceptions: str(o.exceptions) };
    case "conferma_formula":
      return { choice: str(o.choice), formula: str(o.formula) };
    case "conferma_valore": {
      const baseCfg = confirmationBase(config);
      return { choice: str(o.choice), value: valueFrom(baseCfg.type ?? "testo", baseCfg.config, (o.value ?? null) as Json | null) };
    }
    case "collegamento_sistema":
      return {
        sistema: str(o.sistema),
        oggetto: str(o.oggetto),
        campo: str(o.campo),
        accesso: str(o.accesso),
        chi_ha_accesso: str(o.chi_ha_accesso),
        frequenza: str(o.frequenza),
      };
    case "caso_prova":
      return {
        richiesta: str(o.richiesta),
        atteso: str(o.atteso),
        regole: Array.isArray(o.regole) ? o.regole.filter((x): x is string => typeof x === "string").join(", ") : str(o.regole),
        tipo: o.tipo === "pseudonimizzato" ? "pseudonimizzato" : "sintetico",
      };
    case "testo":
    default:
      return { text: typeof raw === "string" ? raw : str(o.text) };
  }
}

/** Griglia della tabella da un valore (griglia dell'input o valore canonico `{columns, rows}`). */
export function gridFromValue(raw: Json | null | undefined, config: ResponseConfig): TableGrid {
  const o = obj(raw);
  const fromConfig = configColumns(config);
  const columns = Array.isArray(o.columns) && o.columns.length > 0
    ? o.columns
        .map((c, i) => {
          if (isPlainObject(c)) {
            const label = str((c as Obj).label) || str((c as Obj).key);
            return { key: str((c as Obj).key) || `col_${i + 1}`, label: label || `Colonna ${i + 1}` };
          }
          return { key: `col_${i + 1}`, label: str(c) || `Colonna ${i + 1}` };
        })
        .slice(0, 50)
    : fromConfig;
  const width = Math.max(columns.length, 1);
  const rows = Array.isArray(o.rows)
    ? o.rows
        .filter((r): r is Json[] => Array.isArray(r))
        .slice(0, 2000)
        .map((r) => Array.from({ length: width }, (_, j) => str(r[j])))
    : [];
  return { columns, rows };
}

function gridFromTable(result: PasteResult): { grid: TableGrid | null; errors: Issue[]; warnings: Issue[] } {
  if (!result.table) return { grid: null, errors: result.errors, warnings: result.warnings };
  return {
    grid: { columns: result.table.columns.map((c) => ({ key: c.key, label: c.label })), rows: result.table.rows.map((r) => [...r]) },
    errors: result.errors,
    warnings: result.warnings,
  };
}

/** Tabella incollata da Excel → griglia, con gli errori e gli avvisi della lettura. */
export function gridFromPaste(text: string, config: ResponseConfig): { grid: TableGrid | null; errors: Issue[]; warnings: Issue[] } {
  return gridFromTable(parsePastedTable(text, pasteOptionsFromConfig(config)));
}

/**
 * Righe di un file Excel o CSV caricato («Carica un Excel», DESIGN §4.3 R2c)
 * → griglia, con le stesse regole della tabella incollata: intestazione
 * riconosciuta, colonne della voce, righe vuote saltate, limiti.
 */
export function gridFromRows(rows: readonly (readonly string[])[], config: ResponseConfig): { grid: TableGrid | null; errors: Issue[]; warnings: Issue[] } {
  return gridFromTable(buildTable(rows, pasteOptionsFromConfig(config)));
}

/**
 * Modello della tabella da scaricare (CSV con `;`, come lo apre Excel in
 * italiano): l'intestazione con le colonne della voce. Null se la voce non ha
 * colonne: in quel caso si incolla la propria tabella con l'intestazione.
 */
export function tableTemplateCsv(config: ResponseConfig): string | null {
  const cols = configColumns(config);
  if (cols.length === 0) return null;
  return `﻿${cols.map((c) => csvCell(c.label)).join(";")}\r\n`;
}

/**
 * Valore da mandare al normalizzatore (bozza e invio), oppure null se l'input è
 * vuoto. `fileIds` = allegati utilizzabili della voce (tipi `file` e `dataset`).
 */
export function toRaw(type: ResponseType | null, config: ResponseConfig, value: Json, fileIds: readonly string[] = []): Json | null {
  const o = obj(value);
  switch (type ?? "testo") {
    case "numero":
      if (!filled(o.value)) return null;
      return compact({ value: str(o.value), unit: str(o.unit) });
    case "valuta": {
      if (!filled(o.amount)) return null;
      const out = compact({ amount: str(o.amount), currency: str(o.currency), vat: str(o.vat), per: str(o.per) });
      const fx = compact(obj(o.fx));
      if (Object.keys(fx).length > 0 && out.currency !== "EUR") out.fx = fx;
      return out;
    }
    case "percentuale":
      if (!filled(o.value)) return null;
      return compact({ value: str(o.value), base: str(o.base) });
    case "durata": {
      const amount = str(o.amount).trim();
      if (!amount) return null;
      // «2:30», «1 ora e 30», «90 min»: il testo si legge così com'è; un numero solo va con l'unità scelta.
      if (!PLAIN_NUMBER.test(amount)) return amount;
      return compact({ amount, unit: str(o.unit) });
    }
    case "data":
      return typeof value === "string" && value.trim() ? value.trim() : null;
    case "data_ora":
      if (!filled(o.time) && !filled(o.date)) return null;
      return compact({ date: str(o.date), time: str(o.time), tz: str(o.tz) });
    case "intervallo": {
      if (!filled(o.from) && !filled(o.to)) return null;
      const kind = intervalKindOf(config);
      return compact({ from: str(o.from), to: str(o.to), unit: str(o.unit), ...(kind ? { kind } : {}) });
    }
    case "si_no":
      return typeof o.value === "boolean" ? { value: o.value } : null;
    case "scelta":
      if (!filled(o.option)) return null;
      return compact({ option: str(o.option), other_text: str(o.other_text) });
    case "scelta_multipla": {
      const options = Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === "string" && x.trim() !== "") : [];
      if (options.length === 0) return null;
      return compact({ options, other_text: str(o.other_text) });
    }
    case "codice":
      return filled(o.code) ? { code: str(o.code).trim() } : null;
    case "tabella": {
      const grid = gridFromValue(value, config);
      const rows = grid.rows.filter((r) => r.some((c) => c.trim() !== ""));
      if (rows.length === 0) return null;
      return { columns: grid.columns.map((c) => ({ key: c.key, label: c.label })), rows };
    }
    case "file":
      return fileIds.length > 0 ? { file_ids: [...fileIds] } : null;
    case "dataset":
      if (!filled(o.dataset_id) && fileIds.length === 0) return null;
      return compact({ file_id: str(o.file_id) || (fileIds[0] ?? ""), dataset_id: str(o.dataset_id) });
    case "conferma_regola": {
      if (!filled(o.choice)) return null;
      // «È così» senza eccezioni scritte: si registra «nessuna segnalata» (DESIGN §4.3 R2b, §9.1 punto 15).
      const exceptions = o.choice === "confermo" && !filled(o.exceptions) && config.ask_exceptions === true ? NO_EXCEPTIONS : str(o.exceptions);
      return compact({ choice: str(o.choice), text: o.choice === "correggo" ? str(o.text) : "", exceptions: o.choice === "non_vale" ? "" : exceptions });
    }
    case "conferma_formula":
      if (!filled(o.choice)) return null;
      return compact({ choice: str(o.choice), formula: o.choice === "correggo" ? str(o.formula) : "" });
    case "conferma_valore": {
      if (!filled(o.choice)) return null;
      const base = confirmationBase(config);
      const inner = o.choice === "correggo" || o.choice === "confermo" ? toRaw(base.type ?? "testo", base.config, (o.value ?? null) as Json, fileIds) : null;
      return inner === null ? { choice: str(o.choice) } : { choice: str(o.choice), value: inner };
    }
    case "collegamento_sistema": {
      const out = compact({
        sistema: str(o.sistema),
        oggetto: str(o.oggetto),
        campo: str(o.campo),
        accesso: str(o.accesso),
        chi_ha_accesso: str(o.chi_ha_accesso),
        frequenza: str(o.frequenza),
      });
      return Object.keys(out).length > 0 ? out : null;
    }
    case "caso_prova": {
      if (!filled(o.richiesta) && !filled(o.atteso) && !filled(o.regole)) return null;
      const regole = str(o.regole)
        .split(/[\s,;]+/)
        .map((r) => r.trim())
        .filter(Boolean);
      return { ...compact({ richiesta: str(o.richiesta), atteso: str(o.atteso), tipo: str(o.tipo) || "sintetico" }), regole };
    }
    case "testo":
    default: {
      const text = typeof value === "string" ? value : str(o.text);
      return text.trim() ? { text } : null;
    }
  }
}

// ── Modulo della voce ─────────────────────────────────────────────────

/**
 * Cosa ha deciso il referente su una domanda (DESIGN §4.2): la risposta scritta
 * (`risposta`, anche la correzione o la riscrittura del valore già noto),
 * «È così» con un tocco sul valore già noto (`conferma`), «Non lo so»,
 * «Da noi non si applica». Null: non ha ancora deciso.
 */
export type ReferentIntent = "risposta" | "conferma" | "non_so" | "non_si_applica";

export interface ReferentForm {
  /** Cosa ha deciso il referente; null finché non ha risposto. */
  intent: ReferentIntent | null;
  /** Valore nella forma dell'input del tipo (vedi `emptyValue`). */
  value: Json;
  note: string;
  /** «È una stima» → `confidence = stima`. */
  estimate: boolean;
  /** «Da dove viene». */
  sourceBasis: SourceBasis | null;
  /** «Valido dal», `YYYY-MM-DD` dall'input data, oppure vuoto. */
  validFrom: string;
  /** «Ho risposto solo in parte». */
  partial: boolean;
  /** «Non lo so»: chi potrebbe saperlo (facoltativo). */
  whoMightKnow: string;
  /** «Non si applica»: il motivo. */
  naReason: string;
  /**
   * Sul valore già noto («Ci avete già detto»): `correzione` dopo «Correggo»,
   * `conferma` quando il valore va riscritto nel formato richiesto («Controlla
   * e invia»). Null: risposta nuova.
   */
  confirmMode: "conferma" | "correzione" | null;
}

function baseForm(item: ReferentItemView): ReferentForm {
  return {
    intent: null,
    value: emptyValue(item.responseType, item.config),
    note: "",
    estimate: false,
    sourceBasis: null,
    validFrom: "",
    partial: false,
    whoMightKnow: "",
    naReason: "",
    confirmMode: null,
  };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function sourceBasisOf(v: unknown): SourceBasis | null {
  return typeof v === "string" && (SOURCE_BASIS as readonly string[]).includes(v) ? (v as SourceBasis) : null;
}

/** Modulo dalla bozza salvata sul server (`uc_request_items.draft`), oppure null se la bozza non si legge. */
export function formFromDraft(item: ReferentItemView, draft: Json | null | undefined): ReferentForm | null {
  if (!isPlainObject(draft) || (draft as Obj).v !== 1) return null;
  const d = draft as Obj;
  const form = baseForm(item);
  const kind = typeof d.kind === "string" ? d.kind : "valore";
  const hasPayload = d.payload !== undefined && d.payload !== null;
  if (hasPayload) form.value = valueFrom(item.responseType, item.config, d.payload as Json);
  form.confirmMode = kind === "correzione" ? "correzione" : kind === "conferma" && hasPayload ? "conferma" : null;
  // Un valore scritto e salvato da solo non è una decisione: lo è solo con `decided`
  // («Avanti», «È così», un tocco). «Non lo so» e «Non si applica» lo sono sempre.
  const decided = d.decided === true || (d.decided === undefined && (kind === "non_so" || kind === "proposta_na"));
  form.intent = !decided
    ? null
    : kind === "non_so"
      ? "non_so"
      : kind === "proposta_na"
        ? "non_si_applica"
        : kind === "conferma" && !hasPayload
          ? "conferma"
          : hasPayload
            ? "risposta"
            : null;
  form.note = str(d.note);
  form.estimate = d.estimate === true || d.confidence === "stima";
  form.sourceBasis = sourceBasisOf(d.source_basis);
  form.validFrom = typeof d.valid_from === "string" && ISO_DATE.test(d.valid_from) ? d.valid_from : "";
  form.partial = d.partial === true;
  form.whoMightKnow = str(d.who_might_know);
  form.naReason = str(d.reason);
  return form;
}

/**
 * Modulo di partenza della voce:
 * 1. la bozza salvata, se c'è;
 * 2. sul valore già noto non confermabile con un clic, l'input tipizzato
 *    precompilato dal testo («Controlla e invia», D45);
 * 3. su una voce validata o con un chiarimento, l'ultima risposta del referente;
 * 4. altrimenti vuoto.
 */
export function initialForm(item: ReferentItemView): ReferentForm {
  const fromDraft = item.draft ? formFromDraft(item, item.draft) : null;
  if (fromDraft) return fromDraft;
  const form = baseForm(item);
  if (item.toConfirm && !item.toConfirm.canConfirm) {
    form.confirmMode = "conferma";
    if (item.toConfirm.prefill !== null) form.value = valueFrom(item.responseType, item.config, item.toConfirm.prefill);
    return form;
  }
  if (item.ownAnswer?.value !== undefined && item.ownAnswer?.value !== null && (item.can.newVersionOnly || item.clarification !== null)) {
    form.value = valueFrom(item.responseType, item.config, item.ownAnswer.value);
    form.estimate = item.ownAnswer.estimate;
  }
  return form;
}

/** Il valore dell'input è vuoto (niente da salvare né da inviare). */
export function isBlankValue(item: Pick<ReferentItemView, "responseType" | "config">, value: Json, fileIds: readonly string[] = []): boolean {
  return toRaw(item.responseType, item.config, value, fileIds) === null;
}

/** Il modulo non contiene niente di scritto dal referente. */
export function isBlankForm(item: Pick<ReferentItemView, "responseType" | "config">, form: ReferentForm, fileIds: readonly string[] = []): boolean {
  return (
    form.intent === null &&
    isBlankValue(item, form.value, fileIds) &&
    form.note.trim() === "" &&
    !form.estimate &&
    form.sourceBasis === null &&
    form.validFrom === "" &&
    !form.partial &&
    form.whoMightKnow.trim() === "" &&
    form.naReason.trim() === ""
  );
}

/** Azione d'invio che corrisponde all'intento. */
export function intentAction(intent: ReferentIntent): SubmitAction {
  switch (intent) {
    case "risposta":
      return "invia";
    case "conferma":
      return "confermo";
    case "non_so":
      return "non_so";
    case "non_si_applica":
      return "non_si_applica";
  }
}

/** Tipo della risposta in bozza secondo l'intento (lo schema stretto dell'API lo accetta). */
export function draftKind(item: Pick<ReferentItemView, "clarification">, form: Pick<ReferentForm, "confirmMode" | "intent">): ReferentAnswerKind {
  switch (form.intent) {
    case "conferma":
      return "conferma";
    case "non_so":
      return "non_so";
    case "non_si_applica":
      return "proposta_na";
    default:
      return sendKind(item, form);
  }
}

/** Tipo della risposta per il pulsante «Invia» della voce. */
export function sendKind(item: Pick<ReferentItemView, "clarification">, form: Pick<ReferentForm, "confirmMode">): ReferentAnswerKind {
  if (form.confirmMode) return form.confirmMode;
  return item.clarification !== null ? "risposta_chiarimento" : "valore";
}

/** Cosa si invia: la risposta del modulo, «Confermo» sul valore già noto, «Non lo so», «Non si applica». */
export type SubmitAction = "invia" | "confermo" | "non_so" | "non_si_applica";

export function kindFor(item: Pick<ReferentItemView, "clarification">, form: Pick<ReferentForm, "confirmMode">, action: SubmitAction): ReferentAnswerKind {
  switch (action) {
    case "confermo":
      return "conferma";
    case "non_so":
      return "non_so";
    case "non_si_applica":
      return "proposta_na";
    case "invia":
      return sendKind(item, form);
  }
}

const DATA_KINDS: readonly ReferentAnswerKind[] = ["valore", "conferma", "correzione", "risposta_chiarimento"];

/** Corpo di `PUT …/items/[itemId]/draft`, secondo lo schema stretto dell'API. */
export function draftBody(item: ReferentItemView, form: ReferentForm, fileIds: readonly string[] = []): Obj {
  const body: Obj = { kind: draftKind(item, form) };
  // «È così» con un tocco non ha un valore da salvare: è la conferma del valore già noto.
  const raw = form.intent === "conferma" ? null : toRaw(item.responseType, item.config, form.value, fileIds);
  if (raw !== null) body.payload = raw;
  // La decisione si salva a parte: un valore scritto ma non ancora confermato con
  // «Avanti» resta in bozza senza contare come risposta pronta (DESIGN §4.2, R2).
  if (form.intent !== null) body.decided = true;
  const note = form.note.trim();
  if (note) body.note = note.slice(0, 2000);
  if (form.estimate) body.estimate = true;
  if (form.sourceBasis) body.source_basis = form.sourceBasis;
  if (ISO_DATE.test(form.validFrom)) body.valid_from = form.validFrom;
  if (form.partial) body.partial = true;
  const who = form.whoMightKnow.trim();
  if (who) body.who_might_know = who.slice(0, 300);
  const reason = form.naReason.trim();
  if (reason) body.reason = reason.slice(0, 2000);
  return body;
}

/**
 * Dati sanitari o preferenze discriminatorie nella bozza: non si salvano né sul
 * server né sul dispositivo (PIANO §3.10). Restituisce il problema da mostrare,
 * senza il testo, oppure null.
 */
export function draftHardBlock(item: Pick<ReferentItemView, "healthRuleQuestion" | "title">, body: Obj): Issue | null {
  const findings = scanPayload(body as Json, scanOptions(item));
  const hard = findings.blocking.find((f) => hasHardBlock([f]));
  if (hard) return issue(`testo_${hard.category}`, findingMessage(hard.category), hard.path.replace(/^payload\.?/, "") || undefined);
  if (findings.truncated) return issue("risposta_troppo_complessa", "La risposta è troppo lunga: allega un file.");
  return null;
}

/** Corpo di `POST …/items/[itemId]/answer`. */
export function answerBody(item: ReferentItemView, form: ReferentForm, action: SubmitAction, fileIds: readonly string[] = []): Obj {
  const kind = kindFor(item, form, action);
  const body: Obj = { kind };
  if (item.currentAnswerId) body.supersedes_answer_id = item.currentAnswerId;
  const note = item.personal ? "" : form.note.trim();
  if (note) body.note = note.slice(0, 2000);
  if (kind === "non_so") {
    const who = form.whoMightKnow.trim();
    if (who) body.who_might_know = who.slice(0, 300);
    return body;
  }
  if (kind === "proposta_na") {
    body.reason = form.naReason.trim().slice(0, 2000);
    return body;
  }
  if (action !== "confermo") {
    const raw = toRaw(item.responseType, item.config, form.value, fileIds);
    if (raw !== null) body.payload = raw;
  }
  if (form.estimate) body.estimate = true;
  if (form.sourceBasis) body.source_basis = form.sourceBasis;
  if (ISO_DATE.test(form.validFrom)) body.valid_from = form.validFrom;
  if (form.partial && item.can.partial && action === "invia" && (kind === "valore" || kind === "conferma" || kind === "correzione")) body.partial = true;
  if (fileIds.length > 0) body.file_ids = [...fileIds];
  return body;
}

export interface SubmitCheck {
  ok: boolean;
  errors: Issue[];
  warnings: Issue[];
}

function scanOptions(item: Pick<ReferentItemView, "healthRuleQuestion" | "title">) {
  return { context: "risposta" as const, healthRuleQuestion: item.healthRuleQuestion ? { questionText: item.title } : undefined };
}

function fromPrepared(p: PreparedAnswer): SubmitCheck {
  return p.ok ? { ok: true, errors: [], warnings: p.warnings } : { ok: false, errors: p.errors, warnings: p.warnings };
}

/**
 * Controllo prima dell'invio, con la normalizzazione stretta e la scansione
 * del testo del server (dati sanitari, preferenze discriminatorie, nomi,
 * contatti). Gli errori hanno il campo (`value`, `amount`, `valid_from`…) per
 * mostrarli accanto all'input.
 */
export function checkSubmit(item: ReferentItemView, form: ReferentForm, action: SubmitAction, fileIds: readonly string[], now: Date): SubmitCheck {
  const kind = kindFor(item, form, action);
  const scan = scanOptions(item);
  const note = item.personal ? "" : form.note.trim();
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  if (note.length > 2000) errors.push(issue("nota_troppo_lunga", "La nota può avere al massimo 2.000 caratteri.", "note"));

  if (kind === "non_so" || kind === "proposta_na") {
    const p = prepareUniversalAction({
      action: kind,
      raw: kind === "non_so" ? { who_might_know: form.whoMightKnow.trim() || undefined } : { reason: form.naReason },
      activeItemIds: [],
      scan,
    });
    const c = fromPrepared(p);
    errors.push(...c.errors.map((e) => ({ ...e, field: kind === "non_so" ? "who_might_know" : "reason" })));
    warnings.push(...c.warnings);
  } else if (action === "confermo") {
    if (!item.toConfirm?.canConfirm) errors.push(issue("valore_non_tipizzato", "Scrivi il valore nel formato richiesto e invia.", "value"));
  } else {
    const type = item.responseType ?? "testo";
    const raw = toRaw(type, item.config, form.value, fileIds);
    const confirm = kind === "conferma" || kind === "correzione";
    if (raw === null) {
      errors.push(issue("risposta_mancante", type === "file" ? "Allega almeno un file." : "Scrivi la risposta.", "value"));
    } else {
      const p = prepareAnswer({
        type: confirm ? "conferma_valore" : type,
        raw: confirm ? { choice: kind === "conferma" ? "confermo" : "correggo", value: raw } : raw,
        config: confirm ? confirmValueConfig(type, item.config) : item.config,
        ctx: answerContext(now, true, { usableFileIds: fileIds, proposedText: item.title }),
        extras: { note },
        scan,
      });
      const c = fromPrepared(p);
      errors.push(...c.errors.map((e) => (confirm && e.field?.startsWith("value.") ? { ...e, field: e.field.slice("value.".length) } : e)));
      warnings.push(...c.warnings);
      if (p.ok && item.requiresValidFrom && !ISO_DATE.test(form.validFrom) && !p.validFrom) {
        errors.push(issue("valido_dal_mancante", "Indica da quando vale questo valore.", "valid_from"));
      }
    }
    if (kind === "risposta_chiarimento" && note === "" && !item.personal) {
      errors.push(issue("chiarimento_mancante", "Scrivi nella nota la risposta alla domanda di Lateral Space.", "note"));
    }
  }
  if (action === "confermo" && item.requiresValidFrom && !ISO_DATE.test(form.validFrom)) {
    errors.push(issue("valido_dal_mancante", "Indica da quando vale questo valore.", "valid_from"));
  }
  if (DATA_KINDS.includes(kind) && form.partial && item.can.partial && note === "" && !item.personal) {
    warnings.push(issue("parziale_senza_nota", "Scrivi nella nota cosa manca: ci aiuta a chiedere il resto.", "note"));
  }
  return { ok: errors.length === 0, errors: dedupe(errors), warnings: dedupe(warnings) };
}

function dedupe(list: readonly Issue[]): Issue[] {
  const seen = new Set<string>();
  return list.filter((i) => {
    const k = `${i.code}|${i.field ?? ""}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/**
 * La domanda è pronta per l'invio dell'argomento: il referente ha deciso
 * (`intent`), la risposta passa i controlli del server, e non è una di quelle
 * che partono da sole (dati personali, chiarimenti: DESIGN §4.2).
 */
export function isReadyToSend(item: ReferentItemView, form: ReferentForm, fileIds: readonly string[], now: Date): boolean {
  if (form.intent === null || !item.can.answer || !sendsInBatch(item)) return false;
  if (form.intent === "conferma" && !item.toConfirm?.canConfirm) return false;
  if (form.intent === "non_so" && !item.can.notKnown) return false;
  if (form.intent === "non_si_applica" && !item.can.proposeNa) return false;
  if (form.intent === "risposta" && isBlankValue(item, form.value, fileIds)) return false;
  return checkSubmit(item, form, intentAction(form.intent), fileIds, now).ok;
}

/**
 * Le risposte che entrano in un invio a gruppi: mai i dati personali (partono
 * subito, cifrati), mai le risposte a un chiarimento e mai le nuove versioni di
 * una risposta già a posto (partono da sole, DESIGN §4.2).
 */
export function sendsInBatch(item: Pick<ReferentItemView, "personal" | "clarification" | "can">): boolean {
  return !item.personal && item.clarification === null && !item.can.newVersionOnly;
}

/** Una risposta di `POST …/answers`: il corpo di `POST …/answer` più l'id della domanda. */
export function batchEntry(item: ReferentItemView, form: ReferentForm, fileIds: readonly string[] = []): Obj {
  const action = form.intent ? intentAction(form.intent) : "invia";
  return { item_id: item.id, ...answerBody(item, form, action, fileIds) };
}

/** Limite prudente del corpo di un invio a gruppi, sotto i 2 MB del server. */
export const BATCH_MAX_BYTES = 1_800_000;

const UTF8 = new TextEncoder();

/**
 * Divide le risposte in invii da al massimo `max` risposte e `maxBytes` di
 * JSON (60 risposte → 50 + 10). Ogni invio conta una volta sola nel limite.
 * I byte sono quelli UTF-8 che il server conta, non i caratteri: accenti,
 * emoji e ideogrammi valgono 2-4 byte.
 */
export function chunkBatch<T>(entries: readonly T[], max = 50, maxBytes = BATCH_MAX_BYTES): T[][] {
  const out: T[][] = [];
  let current: T[] = [];
  let bytes = 20;
  for (const e of entries) {
    const size = UTF8.encode(JSON.stringify(e)).length + 1;
    if (current.length > 0 && (current.length >= max || bytes + size > maxBytes)) {
      out.push(current);
      current = [];
      bytes = 20;
    }
    current.push(e);
    bytes += size;
  }
  if (current.length > 0) out.push(current);
  return out;
}

// ── Riepilogo («Controlla e invia») ───────────────────────────────────

const DAY_IT = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

function dateText(iso: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) ? DAY_IT.format(new Date(`${iso}T12:00:00Z`)) : iso;
}

function short(text: string, max = 80): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function unitLabelOf(code: string, choice: UnitChoice): string {
  return choice.options.find((o) => o.code === code)?.label ?? (code || choice.label || "");
}

/** Il valore del modulo in poche parole, per il riepilogo; null se vuoto. */
export function valueSummary(type: ResponseType | null, config: ResponseConfig, value: Json, fileIds: readonly string[] = []): string | null {
  if (toRaw(type, config, value, fileIds) === null) return null;
  const o = obj(value);
  switch (type ?? "testo") {
    case "numero": {
      const unit = unitLabelOf(str(o.unit), numberUnitChoice(config));
      return `${str(o.value).trim()}${unit ? ` ${unit}` : ""}`;
    }
    case "valuta": {
      const per = str(o.per).trim();
      return `${str(o.amount).trim()} ${str(o.currency) || "EUR"}${per ? ` a ${per}` : ""}`;
    }
    case "percentuale": {
      const base = str(o.base).trim();
      return `${str(o.value).trim()}%${base ? ` ${base}` : ""}`;
    }
    case "durata": {
      const amount = str(o.amount).trim();
      if (!PLAIN_NUMBER.test(amount)) return amount;
      const unit = unitLabelOf(str(o.unit), durationUnitChoice(config));
      return `${amount}${unit ? ` ${unit}` : ""}`;
    }
    case "data":
      return dateText(typeof value === "string" ? value.trim() : "");
    case "data_ora":
      return [str(o.date) ? dateText(str(o.date)) : "", str(o.time)].filter(Boolean).join(", ");
    case "intervallo":
      return `${str(o.from).trim()} – ${str(o.to).trim()}`;
    case "si_no":
      return o.value === true ? "Sì" : "No";
    case "scelta": {
      const chosen = choiceList(config).find((x) => x.value === str(o.option));
      const other = str(o.other_text).trim();
      return chosen?.other && other ? `${chosen.label}: ${other}` : (chosen?.label ?? str(o.option));
    }
    case "scelta_multipla": {
      const options = choiceList(config);
      const chosen = Array.isArray(o.options) ? o.options.filter((x): x is string => typeof x === "string") : [];
      return chosen.map((c) => options.find((x) => x.value === c)?.label ?? c).join(", ");
    }
    case "codice":
      return str(o.code).trim();
    case "tabella": {
      const rows = gridFromValue(value, config).rows.filter((r) => r.some((c) => c.trim() !== "")).length;
      return rows === 1 ? "1 riga" : `${rows} righe`;
    }
    case "file":
    case "dataset":
      return fileIds.length === 1 ? "1 file" : `${fileIds.length} file`;
    case "conferma_regola":
      return o.choice === "confermo" ? "È così" : o.choice === "correggo" ? `Va corretta: ${short(str(o.text), 60)}` : "Non vale";
    case "conferma_formula":
      return o.choice === "confermo" ? "È così" : `Va corretta: ${short(str(o.formula), 60)}`;
    case "conferma_valore": {
      const base = confirmationBase(config);
      const inner = valueSummary(base.type ?? "testo", base.config, (o.value ?? null) as Json, fileIds);
      return o.choice === "confermo" ? `Confermato${inner ? `: ${inner}` : ""}` : (inner ?? "Da correggere");
    }
    case "collegamento_sistema":
      return [str(o.sistema), str(o.oggetto)]
        .map((x) => x.trim())
        .filter(Boolean)
        .join(" · ");
    case "caso_prova":
      return short(str(o.richiesta) || "Un caso d'esempio", 60);
    case "testo":
    default:
      return short(typeof value === "string" ? value : str(o.text));
  }
}

/**
 * La riga del riepilogo di una domanda pronta (DESIGN §4.3 R6): «Confermato:
 * {valore}», il valore corretto, «Non si applica: {motivo}», «{valore}
 * (stima)», «Non lo so · forse {chi}».
 */
export function answerSummary(item: ReferentItemView, form: ReferentForm, fileIds: readonly string[] = []): string {
  switch (form.intent) {
    case "conferma":
      return item.toConfirm?.display ? `Confermato: ${short(item.toConfirm.display)}` : "Confermato";
    case "non_so": {
      const who = form.whoMightKnow.trim();
      return who ? `Non lo so · forse ${short(who, 60)}` : "Non lo so";
    }
    case "non_si_applica":
      return `Non si applica: ${short(form.naReason, 70)}`;
    default: {
      const v = valueSummary(item.responseType, item.config, form.value, fileIds) ?? "";
      return form.estimate ? `${v} (stima)` : v;
    }
  }
}

// ── «Da dove viene?» ──────────────────────────────────────────────────

/** Tipi su cui si chiede «Da dove viene?» (DESIGN §4.3 R2b). */
export const SOURCE_CHIP_TYPES: readonly ResponseType[] = ["numero", "valuta", "percentuale", "durata", "data", "data_ora", "intervallo"];

export const SOURCE_CHIPS: readonly { basis: SourceBasis; label: string }[] = [
  { basis: "sistema", label: "Sistema" },
  { basis: "documento", label: "Documento" },
  { basis: "calcolo", label: "Calcolo" },
  { basis: "stima_a_memoria", label: "A memoria" },
];

/**
 * Tocco su una provenienza: si sceglie o si toglie. «A memoria» vale come
 * stima (DESIGN §9.1 punto 14).
 */
export function toggleSource(form: ReferentForm, basis: SourceBasis): ReferentForm {
  if (form.sourceBasis === basis) return { ...form, sourceBasis: null, estimate: basis === "stima_a_memoria" ? false : form.estimate };
  return { ...form, sourceBasis: basis, estimate: basis === "stima_a_memoria" ? true : form.estimate };
}

/** Problemi di un campo (anche annidati: `amount`, `fx.rate_to_eur`, `rows[2]…`). */
export function fieldIssues(issues: readonly Issue[], field: string): Issue[] {
  return issues.filter((i) => i.field === field || i.field?.startsWith(`${field}.`) || i.field?.startsWith(`${field}[`));
}

/** Problemi senza un campo noto tra quelli indicati: si mostrano sotto la voce. */
export function otherIssues(issues: readonly Issue[], known: readonly string[]): Issue[] {
  return issues.filter((i) => !i.field || !known.some((f) => i.field === f || i.field!.startsWith(`${f}.`) || i.field!.startsWith(`${f}[`)));
}

// ── Scelte ────────────────────────────────────────────────────────────

export interface ChoiceView {
  value: string;
  label: string;
  other: boolean;
}

/** Opzioni della scelta, con quelle «Altro» che chiedono il testo. Mai «Non lo so»: è l'azione universale. */
export function choiceList(config: ResponseConfig): ChoiceView[] {
  return choiceOptions(config).map((o) => ({ value: o.value, label: o.label ?? o.value, other: isOtherOption(o) || (config.allow_other === true && isOtherOption(o.value)) }));
}

// ── Delega ────────────────────────────────────────────────────────────

export interface DelegateForm {
  nome: string;
  email: string;
  messaggio: string;
  voci: string[];
}

export function delegateBody(f: DelegateForm): Obj {
  const body: Obj = { nome: f.nome.trim(), email: f.email.trim(), voci: [...f.voci] };
  const messaggio = f.messaggio.trim();
  if (messaggio) body.messaggio = messaggio;
  return body;
}

/**
 * La delega preparata come sul server (nome, email, messaggio, voci aperte),
 * ma senza passare gli id delle domande dalla scansione dei testi: un id è un
 * UUID, e con cento e più domande capita che uno somigli a un numero di
 * telefono e fermi la delega (DESIGN §7.1 P0-13). Gli id si sostituiscono con
 * segnaposto per la scansione e tornano quelli veri nel valore.
 */
export function prepareDelegation(raw: unknown, activeItemIds: readonly string[]): PreparedAnswer {
  const alias = new Map<string, string>();
  const back = new Map<string, string>();
  activeItemIds.forEach((id, i) => {
    alias.set(id.toLowerCase(), `voce${i + 1}`);
    back.set(`voce${i + 1}`, id);
  });
  const input = isPlainObject(raw) && Array.isArray(raw.voci) ? { ...raw, voci: raw.voci.map((v) => (typeof v === "string" ? (alias.get(v.toLowerCase()) ?? "sconosciuta") : v)) } : raw;
  const p = prepareUniversalAction({ action: "delega", raw: input, activeItemIds: [...back.keys()], scan: { context: "risposta" } });
  if (!p.ok || !isPlainObject(p.value) || !Array.isArray(p.value.voci)) return p;
  const value = { ...p.value, voci: p.value.voci.map((a) => (typeof a === "string" ? (back.get(a) ?? a) : a)) } as Obj;
  return { ...p, value, normalized: value };
}

/** Controllo della delega prima dell'invio: nome, email valida, voci aperte, scansione di nome e messaggio. */
export function checkDelegate(f: DelegateForm, activeItemIds: readonly string[]): SubmitCheck {
  return fromPrepared(prepareDelegation(delegateBody(f), activeItemIds));
}

// ── Firme (link di approvazione) ──────────────────────────────────────

export function approvalBody(a: Pick<ApprovalView, "kind" | "targetId" | "textHash">, decision: "approvo" | "non_approvo", reason: string): Obj {
  const body: Obj = { kind: a.kind, target_id: a.targetId, decision, read: true, text_hash: a.textHash };
  const r = reason.trim();
  if (decision === "non_approvo" && r) body.reason = r.slice(0, 2000);
  return body;
}

// ── Copia sul dispositivo ─────────────────────────────────────────────

export const DEVICE_DRAFT_VERSION = 1;
/** Una copia più vecchia del link (30 giorni) non serve più. */
export const DEVICE_DRAFT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/** Chiave `uc-draft:<prefisso del link>:<voce>` (il prefisso non basta a ricostruire il link). */
export function deviceDraftKey(token: string, itemId: string): string {
  return `uc-draft:${token.slice(0, 12)}:${itemId}`;
}

/**
 * Copia sul dispositivo di una bozza non ancora salvata sul server. Mai per le
 * voci personali: la pagina non la scrive e qui si rifiuta comunque.
 */
export function encodeDeviceDraft(item: Pick<ReferentItemView, "personal">, form: ReferentForm, now: Date): string | null {
  if (item.personal) return null;
  return JSON.stringify({ v: DEVICE_DRAFT_VERSION, savedAt: now.toISOString(), form });
}

/** Modulo dalla copia sul dispositivo, oppure null (versione diversa, troppo vecchia, illeggibile, voce personale). */
export function decodeDeviceDraft(item: ReferentItemView, text: string | null | undefined, now: Date): ReferentForm | null {
  if (item.personal || typeof text !== "string" || text === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(parsed) || parsed.v !== DEVICE_DRAFT_VERSION || typeof parsed.savedAt !== "string" || !isPlainObject(parsed.form)) return null;
  const savedAt = Date.parse(parsed.savedAt);
  if (!Number.isFinite(savedAt) || now.getTime() - savedAt > DEVICE_DRAFT_MAX_AGE_MS) return null;
  const f = parsed.form as Record<string, unknown>;
  const form = baseForm(item);
  form.value = valueFrom(item.responseType, item.config, (f.value ?? null) as Json);
  form.note = str(f.note);
  form.estimate = f.estimate === true;
  form.sourceBasis = sourceBasisOf(f.sourceBasis);
  form.validFrom = typeof f.validFrom === "string" && ISO_DATE.test(f.validFrom) ? f.validFrom : "";
  form.partial = f.partial === true;
  form.whoMightKnow = str(f.whoMightKnow);
  form.naReason = str(f.naReason);
  form.confirmMode = f.confirmMode === "conferma" || f.confirmMode === "correzione" ? f.confirmMode : null;
  form.intent = f.intent === "risposta" || f.intent === "conferma" || f.intent === "non_so" || f.intent === "non_si_applica" ? f.intent : null;
  return form;
}

// ── Stato del salvataggio automatico ──────────────────────────────────

/** Attesa prima del salvataggio automatico (come i questionari: 2 secondi). */
export const AUTOSAVE_DEBOUNCE_MS = 2000;

export type SaveState = "idle" | "pending" | "saving" | "saved" | "error" | "offline" | "blocked";

/** Attesa crescente tra i tentativi: 2, 4, 8, 16, 30 secondi. */
export function retryDelayMs(attempt: number): number {
  return Math.min(30_000, AUTOSAVE_DEBOUNCE_MS * 2 ** Math.max(0, attempt));
}

/** Si riprova da soli solo per rete assente, troppe richieste ed errori del server. */
export function isRetryableStatus(status: number): boolean {
  return status === 0 || status === 408 || status === 429 || (status >= 500 && status <= 599);
}

// ── Risposte delle API ────────────────────────────────────────────────

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; code: string; message: string; issues: Issue[] };

export const NETWORK_ERROR_MESSAGE = "Connessione assente: la risposta non è partita. Riprova quando sei online.";
const GENERIC_ERROR = "Qualcosa non ha funzionato. Riprova tra poco.";

/** Risposta uniforme delle API pubbliche (`{ok, data}` oppure `{ok:false, error, message, issues}`). */
export function parseApiResponse<T>(status: number, body: unknown): ApiResult<T> {
  if (status === 0) return { ok: false, status, code: "rete", message: NETWORK_ERROR_MESSAGE, issues: [] };
  const o = obj(body);
  if (status >= 200 && status < 300 && o.ok === true) return { ok: true, data: o.data as T };
  const issues = Array.isArray(o.issues)
    ? o.issues
        .filter((i): i is Obj => isPlainObject(i) && typeof (i as Obj).code === "string" && typeof (i as Obj).message === "string")
        .map((i) => (typeof i.field === "string" ? issue(String(i.code), String(i.message), i.field) : issue(String(i.code), String(i.message))))
    : [];
  return {
    ok: false,
    status,
    code: typeof o.error === "string" ? o.error : "errore",
    message: typeof o.message === "string" && o.message.trim() ? o.message : GENERIC_ERROR,
    issues,
  };
}

// ── Testi della pagina ────────────────────────────────────────────────

export function questionsText(n: number): string {
  return n === 1 ? "1 domanda" : `${formatCountIt(n)} domande`;
}

export function minutesText(n: number): string {
  if (n <= 0) return "";
  if (n < 60) return n === 1 ? "circa 1 minuto" : `circa ${n} minuti`;
  const h = Math.floor(n / 60);
  const m = n % 60;
  const hours = h === 1 ? "1 ora" : `${h} ore`;
  return m === 0 ? `circa ${hours}` : `circa ${hours} e ${m} minuti`;
}
