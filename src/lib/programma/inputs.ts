/**
 * I campi della pagina «Programma» (rilascio 7): dipendenti, ricavo, canone, percentuale, importi, mesi,
 * pesi, decisioni per la leadership, valori dei KPI e dei risultati chiave. Gli stessi parser girano nel
 * browser prima di salvare e sul server prima di scrivere.
 *
 * I numeri si scrivono come si dicono: «1.250», «1250», «12,5», «12 mln», «12 milioni», «800k», «€ 4.000».
 * Modulo puro: import relativi `.ts`.
 */
import { PROGRAM_LIMITS } from "../db/use-case-hub-program-ddl.ts";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const INPUT_ERRORS = Object.freeze({
  number: "Scrivi un numero, per esempio 1.250.",
  integer: "Scrivi un numero intero.",
  positive: "Deve essere più di zero.",
  tooBig: "È troppo grande.",
  pct: "Scrivi una percentuale da 0 a 100.",
  month: "Scegli un mese.",
  range: "Il mese di fine viene prima di quello di inizio.",
  weights: "Almeno un peso deve essere più di zero.",
  askEmpty: "Scrivi la decisione.",
  askLong: `Al massimo ${PROGRAM_LIMITS.askText} caratteri.`,
  asksMany: `Al massimo ${PROGRAM_LIMITS.asksMax} decisioni.`,
  date: "Scegli un giorno.",
  note: `Al massimo ${PROGRAM_LIMITS.checkinNote} caratteri.`,
});

const MULTIPLIERS: ReadonlyArray<[RegExp, number]> = [
  [/\s*(mld|miliardi?)\.?$/i, 1e9],
  [/\s*(mln|milioni?|m)\.?$/i, 1e6],
  [/\s*(k|mila)\.?$/i, 1e3],
];

/**
 * Un numero all'italiana: il punto o lo spazio per le migliaia, la virgola per i decimali; anche
 * «12.5» con un solo punto e una o due cifre dopo vale dodici e mezzo. null se non si legge.
 */
export function parseItalianNumber(text: string): number | null {
  let s = text.trim().replace(/€|eur(o)?/gi, "").replace(/ /g, " ").trim();
  if (!s) return null;
  let factor = 1;
  for (const [re, f] of MULTIPLIERS) {
    if (re.test(s)) {
      s = s.replace(re, "").trim();
      factor = f;
      break;
    }
  }
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1).trim();
  if (!/^[0-9][0-9 .,]*$/.test(s)) return null;
  s = s.replace(/ /g, "");
  let normalized: string;
  if (s.includes(",")) {
    if ((s.match(/,/g) ?? []).length > 1) return null;
    normalized = s.replace(/\./g, "").replace(",", ".");
  } else if ((s.match(/\./g) ?? []).length === 1 && /\.\d{1,2}$/.test(s)) {
    normalized = s;
  } else {
    if (!/^\d{1,3}(\.\d{3})*$|^\d+$/.test(s)) return null;
    normalized = s.replace(/\./g, "");
  }
  const n = Number(normalized) * factor;
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

/** Dipendenti: un intero da 1 al massimo. */
export function parseEmployees(text: string): Parsed<number> {
  const n = parseItalianNumber(text);
  if (n === null) return { ok: false, error: INPUT_ERRORS.number };
  if (!Number.isInteger(n)) return { ok: false, error: INPUT_ERRORS.integer };
  if (n <= 0) return { ok: false, error: INPUT_ERRORS.positive };
  if (n > PROGRAM_LIMITS.employeesMax) return { ok: false, error: INPUT_ERRORS.tooBig };
  return { ok: true, value: n };
}

/** Ricavo all'anno in euro, intero; vuoto = nessun ricavo. */
export function parseRevenue(text: string): Parsed<number | null> {
  if (!text.trim()) return { ok: true, value: null };
  const n = parseItalianNumber(text);
  if (n === null) return { ok: false, error: INPUT_ERRORS.number };
  if (n <= 0) return { ok: false, error: INPUT_ERRORS.positive };
  if (n > PROGRAM_LIMITS.revenueEurMax) return { ok: false, error: INPUT_ERRORS.tooBig };
  return { ok: true, value: Math.round(n) };
}

/** Un importo in euro (al centesimo) da 0 a `max`; vuoto = null. */
export function parseAmount(text: string, max: number): Parsed<number | null> {
  if (!text.trim()) return { ok: true, value: null };
  const n = parseItalianNumber(text);
  if (n === null) return { ok: false, error: INPUT_ERRORS.number };
  if (n < 0) return { ok: false, error: INPUT_ERRORS.positive };
  if (n > max) return { ok: false, error: INPUT_ERRORS.tooBig };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

/** Una percentuale da 0 a 100 (due decimali); vuoto = null. */
export function parsePct(text: string): Parsed<number | null> {
  if (!text.trim()) return { ok: true, value: null };
  const n = parseItalianNumber(text.replace("%", ""));
  if (n === null || n < 0 || n > 100) return { ok: false, error: INPUT_ERRORS.pct };
  return { ok: true, value: Math.round(n * 100) / 100 };
}

const MONTH = /^([0-9]{4})-(0[1-9]|1[0-2])$/;

/** Un mese `AAAA-MM`; vuoto = null. */
export function parseMonth(text: string): Parsed<string | null> {
  const s = text.trim();
  if (!s) return { ok: true, value: null };
  return MONTH.test(s) ? { ok: true, value: s } : { ok: false, error: INPUT_ERRORS.month };
}

/** Un giorno `AAAA-MM-GG` che esiste. */
export function parseDay(text: string): Parsed<string> {
  const s = text.trim();
  const m = /^([0-9]{4})-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.exec(s);
  if (!m) return { ok: false, error: INPUT_ERRORS.date };
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCDate() === Number(m[3]) ? { ok: true, value: s } : { ok: false, error: INPUT_ERRORS.date };
}

export interface LsCostsInput {
  supportMonthEur: string;
  supportFrom: string;
  supportTo: string;
  devPct: string;
}

export interface LsCosts {
  supportMonthEur: number | null;
  supportFrom: string | null;
  supportTo: string | null;
  devPct: number | null;
}

/** I costi di Lateral Space: canone, periodo, percentuale. Errori per campo. */
export function parseLsCosts(input: LsCostsInput): { ok: true; value: LsCosts } | { ok: false; fieldErrors: Partial<Record<keyof LsCostsInput, string>> } {
  const fieldErrors: Partial<Record<keyof LsCostsInput, string>> = {};
  const canone = parseAmount(input.supportMonthEur, PROGRAM_LIMITS.supportMonthEurMax);
  const from = parseMonth(input.supportFrom);
  const to = parseMonth(input.supportTo);
  const pct = parsePct(input.devPct);
  if (!canone.ok) fieldErrors.supportMonthEur = canone.error;
  if (!from.ok) fieldErrors.supportFrom = from.error;
  if (!to.ok) fieldErrors.supportTo = to.error;
  if (!pct.ok) fieldErrors.devPct = pct.error;
  if (from.ok && to.ok && from.value && to.value && to.value < from.value) fieldErrors.supportTo = INPUT_ERRORS.range;
  if (Object.keys(fieldErrors).length || !canone.ok || !from.ok || !to.ok || !pct.ok) return { ok: false, fieldErrors };
  return { ok: true, value: { supportMonthEur: canone.value, supportFrom: from.value, supportTo: to.value, devPct: pct.value } };
}

/** I pesi dell'indice: quattro numeri da 0 a 100, almeno uno più di zero. */
export function parseWeights(input: Record<"persone" | "use_case" | "valore" | "adozione", string>): Parsed<Record<"persone" | "use_case" | "valore" | "adozione", number>> {
  const out = { persone: 0, use_case: 0, valore: 0, adozione: 0 };
  for (const key of Object.keys(out) as Array<keyof typeof out>) {
    const n = parseItalianNumber(input[key] ?? "");
    if (n === null || n < 0 || n > 100) return { ok: false, error: INPUT_ERRORS.pct };
    out[key] = Math.round(n);
  }
  if (Object.values(out).every((w) => w === 0)) return { ok: false, error: INPUT_ERRORS.weights };
  return { ok: true, value: out };
}

/** Le decisioni per la leadership: righe non vuote, al massimo `asksMax`, ognuna al massimo `askText` caratteri. */
export function parseAsks(asks: ReadonlyArray<{ id: string; text: string }>): Parsed<Array<{ id: string; text: string }>> {
  const clean = asks.map((a) => ({ id: a.id, text: a.text.replace(/\s+/g, " ").trim() })).filter((a) => a.text.length > 0);
  if (clean.length > PROGRAM_LIMITS.asksMax) return { ok: false, error: INPUT_ERRORS.asksMany };
  if (clean.some((a) => a.text.length > PROGRAM_LIMITS.askText)) return { ok: false, error: INPUT_ERRORS.askLong };
  if (clean.some((a) => !/^[a-z0-9-]{1,40}$/i.test(a.id))) return { ok: false, error: INPUT_ERRORS.askEmpty };
  return { ok: true, value: clean };
}

/** Un valore (di un KPI o di un risultato chiave): un numero qualsiasi, anche negativo. */
export function parseValue(text: string): Parsed<number> {
  const n = parseItalianNumber(text.replace("%", ""));
  return n === null ? { ok: false, error: INPUT_ERRORS.number } : { ok: true, value: n };
}

/** Un valore facoltativo: vuoto = null. */
export function parseOptionalValue(text: string): Parsed<number | null> {
  return text.trim() ? parseValue(text) : { ok: true, value: null };
}
