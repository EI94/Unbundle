/**
 * Tipo `intervallo` (PIANO §3.9): `{from, to, kind, unit?, crosses_midnight?}`.
 *
 * Accetta «10-20», «10–20 kg», «da 10 a 20», «22:00-06:00», «dalle 22 alle 6»,
 * «01/05–30/09», «dal 1/10/2025 al 30/9/2026». Stesso tipo e stessa unità ai due
 * estremi (un'unità scritta una volta sola vale per entrambi). `from ≤ to`, salvo:
 * - `kind = 'ora'` con `to < from`: a cavallo della mezzanotte (`crosses_midnight`, avviso);
 * - `kind = 'giorno_mese'` con `to < from`: a cavallo dell'anno (`crosses_year`, avviso),
 *   per le stagioni come «01/11–31/03».
 * Ogni estremo si normalizza secondo il suo tipo.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import { parseDateIt, parseDayMonth, parseTimeIt } from "./datetime.ts";
import { readDurationText } from "./duration.ts";
import { issue, type Issue } from "./issues.ts";
import { parseNumberIt, roundTo } from "./number-it.ts";
import { cleanText, isPlainObject, nonEmptyString } from "./strings.ts";
import { outcome, type IntervalKind, type NormalizeContext, type Outcome, type ResponseConfig } from "./types.ts";
import { lookupUnit, normalizeNumero, parseUnitHint, splitNumberAndUnit, type UnitDef } from "./units.ts";

export const INTERVAL_KINDS: readonly IntervalKind[] = ["numero", "durata", "ora", "data", "giorno_mese"];

const INTERVAL_MESSAGE = "Scrivi l'intervallo come «da – a», per esempio 10–20, 22:00–06:00 o 01/05–30/09.";

const WORDS_PATTERN =
  /^(da|dal|dallo|dalla|dall['’]\s*|dalle|tra|fra)\s+(.+?)\s+(?:a|al|allo|alla|all['’]\s*|alle|e|fino\s+a|fino\s+al|fino\s+alle)\s+(.+)$/i;

export interface IntervalSplit {
  left: string;
  right: string;
  /** «dalle 22 alle 6»: le parole dicono che sono orari. */
  hint: IntervalKind | null;
}

/** Possibili divisioni del testo in due estremi, dalla più probabile. */
export function candidateSplits(text: string): IntervalSplit[] {
  const t = cleanText(text);
  const out: IntervalSplit[] = [];
  const words = WORDS_PATTERN.exec(t);
  if (words) out.push({ left: words[2].trim(), right: words[3].trim(), hint: /^dalle$/i.test(words[1]) ? "ora" : null });
  // Trattino lungo prima, poi trattino con spazi, poi qualsiasi trattino.
  for (const sep of [/\s*[–—]\s*/g, /\s+-\s+/g, /-/g]) {
    for (const m of t.matchAll(sep)) {
      const i = m.index ?? 0;
      const left = t.slice(0, i).trim();
      const right = t.slice(i + m[0].length).trim();
      if (left && right) out.push({ left, right, hint: null });
    }
  }
  return out;
}

interface Endpoint {
  value: Json;
  normalized: Json;
  sortKey: number | string;
}

interface EndpointPair {
  kind: IntervalKind;
  from: Endpoint;
  to: Endpoint;
  unit: string | null;
  unitSi: string | null;
  warnings: Issue[];
}

type PairResult = EndpointPair | Issue[] | null;

const same = (v: string): Endpoint => ({ value: v, normalized: v, sortKey: v });

function hasClock(text: string): boolean {
  return /^\s*(?:ore\s+|h\s+)?\d{1,2}[:.h]\d{2}\s*$/i.test(text);
}

function readTimePair(left: string, right: string, explicit: boolean): PairResult {
  if (!explicit && !(hasClock(left) || hasClock(right))) return null;
  const dotted = /^\d{1,2}\.\d{2}$/;
  if (!explicit && dotted.test(left) && dotted.test(right)) {
    // «10.50-20.75» sono numeri; «22.00-06.30» orari: decidono i minuti sotto 60.
    if (Number(left.split(".")[1]) > 59 || Number(right.split(".")[1]) > 59) return null;
  }
  const a = parseTimeIt(left, "from");
  const b = parseTimeIt(right, "to");
  if (!a.ok || !b.ok) return explicit ? [...(a.ok ? [] : a.errors), ...(b.ok ? [] : b.errors)] : null;
  return { kind: "ora", from: same(a.value), to: same(b.value), unit: null, unitSi: null, warnings: [] };
}

function readDatePair(left: string, right: string, explicit: boolean): PairResult {
  const a = parseDateIt(left, "from");
  const b = parseDateIt(right, "to");
  if (!a.ok || !b.ok) return explicit ? [...(a.ok ? [] : a.errors), ...(b.ok ? [] : b.errors)] : null;
  return { kind: "data", from: same(a.value), to: same(b.value), unit: null, unitSi: null, warnings: [...a.warnings, ...b.warnings] };
}

function readDayMonthPair(left: string, right: string, explicit: boolean): PairResult {
  const a = parseDayMonth(left, "from");
  const b = parseDayMonth(right, "to");
  if (!a.ok || !b.ok) return explicit ? [...(a.ok ? [] : a.errors), ...(b.ok ? [] : b.errors)] : null;
  return { kind: "giorno_mese", from: same(a.value), to: same(b.value), unit: null, unitSi: null, warnings: [] };
}

function readDurationPair(left: string, right: string, expected: UnitDef | null, explicit: boolean): PairResult {
  const a = readDurationText(left, true);
  const b = readDurationText(right, true);
  if (Array.isArray(a) || Array.isArray(b)) return explicit ? [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])] : null;
  if (!explicit && a.unit === null && b.unit === null && expected === null) return null;
  // «10.50-20.75» without a duration item: the dot is a decimal (or a time of day, read before).
  if (!explicit && (a.dotAsHoursMinutes || b.dotAsHoursMinutes)) return null;
  const ua = a.unit ?? b.unit ?? expected;
  const ub = b.unit ?? a.unit ?? expected;
  if (ua === null || ub === null) return [issue("unita_mancante", "Indica l'unità: minuti, ore o giorni.", "unit")];
  if (ua.code !== ub.code) return [issue("unita_diverse", "Usa la stessa unità per i due estremi.", "unit")];
  const end = (amount: number): Endpoint => {
    const minutes = roundTo(amount * ua.factor, 4);
    return { value: amount, normalized: minutes, sortKey: minutes };
  };
  const warnings =
    a.dotAsHoursMinutes || b.dotAsHoursMinutes
      ? [issue("letto_come_ore_minuti", "Ho letto il punto come ore e minuti (2.30 = 2 ore e 30 minuti): controlla che sia giusto.")]
      : [];
  return { kind: "durata", from: end(a.amount), to: end(b.amount), unit: ua.code, unitSi: "min", warnings };
}

function readNumberPair(left: string, right: string, config: ResponseConfig, explicit: boolean): PairResult {
  const sa = splitNumberAndUnit(left);
  const sb = splitNumberAndUnit(right);
  if (!sa || !sb || !parseNumberIt(sa.number).ok || !parseNumberIt(sb.number).ok) {
    return explicit ? [issue("intervallo_non_valido", INTERVAL_MESSAGE)] : null;
  }
  const unitA = sa.rest || sb.rest;
  const unitB = sb.rest || sa.rest;
  const ca = unitA ? (lookupUnit(unitA)?.code ?? unitA) : null;
  const cb = unitB ? (lookupUnit(unitB)?.code ?? unitB) : null;
  if (ca !== cb) return [issue("unita_diverse", "Usa la stessa unità per i due estremi.", "unit")];
  const strict = { strict: true };
  const a = normalizeNumero(unitA ? `${sa.number} ${unitA}` : sa.number, config, strict);
  const b = normalizeNumero(unitB ? `${sb.number} ${unitB}` : sb.number, config, strict);
  const errors = [
    ...a.errors.map((e) => ({ ...e, field: `from.${e.field ?? "value"}` })),
    ...b.errors.map((e) => ({ ...e, field: `to.${e.field ?? "value"}` })),
  ];
  if (errors.length > 0) return errors;
  const va = a.value as { value: number; unit: string | null };
  const vb = b.value as { value: number; unit: string | null };
  const na = a.normalized as { value_si: number; unit_si: string | null };
  const nb = b.normalized as { value_si: number; unit_si: string | null };
  return {
    kind: "numero",
    from: { value: va.value, normalized: na.value_si, sortKey: na.value_si },
    to: { value: vb.value, normalized: nb.value_si, sortKey: nb.value_si },
    unit: va.unit,
    unitSi: na.unit_si,
    warnings: [...a.warnings, ...b.warnings],
  };
}

/** Tipo degli estremi deciso dalla voce: `config.kind`, oppure dall'unità del template. */
export function intervalKindFromConfig(config: ResponseConfig): { kind: IntervalKind | null; timeUnit: UnitDef | null } {
  if (config.kind && INTERVAL_KINDS.includes(config.kind)) return { kind: config.kind, timeUnit: null };
  const hint = parseUnitHint(config.unit ?? null);
  const units = hint.unit ? [hint.unit] : hint.alternatives;
  if (units.length > 0 && units.every((u) => u.dimension === "tempo")) {
    return { kind: "durata", timeUnit: units.length === 1 ? units[0] : null };
  }
  if (units.length > 0 || hint.label !== null) return { kind: "numero", timeUnit: null };
  return { kind: null, timeUnit: null };
}

function readPair(split: IntervalSplit, config: ResponseConfig): PairResult {
  const fromConfig = intervalKindFromConfig(config);
  const kind = fromConfig.kind ?? split.hint;
  const order: IntervalKind[] = kind ? [kind] : ["data", "giorno_mese", "ora", "durata", "numero"];
  const explicit = kind !== null;
  let firstErrors: Issue[] | null = null;
  for (const k of order) {
    const { left, right } = split;
    const r =
      k === "data"
        ? readDatePair(left, right, explicit)
        : k === "giorno_mese"
          ? readDayMonthPair(left, right, explicit)
          : k === "ora"
            ? readTimePair(left, right, explicit)
            : k === "durata"
              ? readDurationPair(left, right, fromConfig.timeUnit, explicit)
              : readNumberPair(left, right, config, explicit);
    if (r === null) continue;
    if (Array.isArray(r)) {
      firstErrors ??= r;
      continue;
    }
    return r;
  }
  return firstErrors;
}

function stringEnd(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return nonEmptyString(value);
}

/** Tipo `intervallo`. */
export function normalizeIntervallo(raw: unknown, config: ResponseConfig, ctx: Pick<NormalizeContext, "strict">): Outcome {
  void ctx;
  let splits: IntervalSplit[];
  if (isPlainObject(raw)) {
    const from = stringEnd(raw.from);
    const to = stringEnd(raw.to);
    if (from === null || to === null) {
      return outcome({
        value: null,
        errors: [issue("estremi_mancanti", "Indica inizio e fine dell'intervallo.", from === null ? "from" : "to")],
      });
    }
    const unit = nonEmptyString(raw.unit);
    const withUnit = (s: string) => (unit && /^[-+\u2212]?[\d.,'’ ]+$/.test(s) ? `${s} ${unit}` : s);
    const kind = typeof raw.kind === "string" && INTERVAL_KINDS.includes(raw.kind as IntervalKind) ? (raw.kind as IntervalKind) : null;
    splits = [{ left: withUnit(from), right: withUnit(to), hint: kind }];
  } else if (typeof raw === "string" && cleanText(raw) !== "") {
    splits = candidateSplits(raw);
  } else {
    return outcome({ value: null, errors: [issue("intervallo_mancante", INTERVAL_MESSAGE)] });
  }

  let pair: EndpointPair | null = null;
  let errors: Issue[] | null = null;
  for (const split of splits) {
    const r = readPair(split, config);
    if (r === null) continue;
    if (Array.isArray(r)) {
      errors ??= r;
      continue;
    }
    pair = r;
    break;
  }
  if (!pair) return outcome({ value: null, errors: errors ?? [issue("intervallo_non_valido", INTERVAL_MESSAGE)] });

  const warnings = [...pair.warnings];
  const value: Record<string, Json> = { from: pair.from.value, to: pair.to.value, kind: pair.kind };
  if (pair.unit !== null) value.unit = pair.unit;
  const reversed = pair.to.sortKey < pair.from.sortKey;
  const outErrors: Issue[] = [];
  let normalized: Record<string, Json>;

  if (pair.kind === "ora") {
    value.crosses_midnight = reversed;
    if (reversed) warnings.push(issue("a_cavallo_mezzanotte", "L'intervallo passa la mezzanotte: la fine è il giorno dopo.", "to"));
    normalized = { from: pair.from.normalized, to: pair.to.normalized, crosses_midnight: reversed };
  } else if (pair.kind === "giorno_mese") {
    value.crosses_year = reversed;
    if (reversed) warnings.push(issue("a_cavallo_anno", "Il periodo passa il 31 dicembre: la fine è l'anno dopo.", "to"));
    normalized = { from: pair.from.normalized, to: pair.to.normalized, crosses_year: reversed };
  } else {
    if (reversed) outErrors.push(issue("inizio_dopo_fine", "L'inizio deve venire prima della fine.", "to"));
    normalized =
      pair.kind === "durata"
        ? { from_minutes: pair.from.normalized, to_minutes: pair.to.normalized }
        : pair.kind === "numero"
          ? { from_si: pair.from.normalized, to_si: pair.to.normalized, unit_si: pair.unitSi }
          : { from: pair.from.normalized, to: pair.to.normalized };
  }
  return outcome({ value, normalized: outErrors.length === 0 ? normalized : null, errors: outErrors, warnings });
}
