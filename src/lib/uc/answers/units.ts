/**
 * Unità di misura e tipo `numero` (PIANO §3.9).
 *
 * Conversioni verso l'unità base di ogni grandezza:
 * - lunghezza → m (m, km, ft, NM)
 * - massa → kg (kg, t, lb)
 * - tempo → min (s, min, h, giorni, settimane, mesi da 30 giorni)
 * - volume → l (l, USG, m³)
 * - velocità → km/h (kt, km/h)
 *
 * L'unità della voce arriva dal template come testo libero («metri», «NM
 * (miglia nautiche)», «passeggeri», «0-1»): `parseUnitHint` ne ricava l'unità
 * fisica, un'etichetta (conteggi come «passeggeri») o un intervallo ammesso.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import { issue, type Issue } from "./issues.ts";
import { extractNumbersIt, parseNumberIt, roundTo, formatNumberIt } from "./number-it.ts";
import { cleanText, deaccent, isPlainObject } from "./strings.ts";
import { outcome, type NormalizeContext, type Outcome, type ResponseConfig } from "./types.ts";

export type Dimension = "lunghezza" | "massa" | "tempo" | "volume" | "velocita";

export interface UnitDef {
  code: string;
  dimension: Dimension;
  /** Quante unità base vale 1 di questa unità. */
  factor: number;
  label: string;
  aliases: readonly string[];
}

export const BASE_UNITS: Readonly<Record<Dimension, string>> = {
  lunghezza: "m",
  massa: "kg",
  tempo: "min",
  volume: "l",
  velocita: "km/h",
};

export const UNITS: readonly UnitDef[] = [
  { code: "m", dimension: "lunghezza", factor: 1, label: "metri", aliases: ["m", "mt", "mtr", "metro", "metri"] },
  { code: "km", dimension: "lunghezza", factor: 1000, label: "chilometri", aliases: ["km", "chilometro", "chilometri", "kilometro", "kilometri"] },
  { code: "ft", dimension: "lunghezza", factor: 0.3048, label: "piedi", aliases: ["ft", "piede", "piedi", "feet", "foot"] },
  { code: "NM", dimension: "lunghezza", factor: 1852, label: "miglia nautiche", aliases: ["nm", "nmi", "miglio nautico", "miglia nautiche"] },
  { code: "kg", dimension: "massa", factor: 1, label: "kg", aliases: ["kg", "kgs", "chilo", "chili", "chilogrammo", "chilogrammi", "kilo", "kili"] },
  { code: "t", dimension: "massa", factor: 1000, label: "tonnellate", aliases: ["t", "ton", "tonnellata", "tonnellate"] },
  { code: "lb", dimension: "massa", factor: 0.45359237, label: "libbre", aliases: ["lb", "lbs", "libbra", "libbre"] },
  { code: "s", dimension: "tempo", factor: 1 / 60, label: "secondi", aliases: ["s", "sec", "secondo", "secondi"] },
  { code: "min", dimension: "tempo", factor: 1, label: "minuti", aliases: ["min", "mins", "minuto", "minuti", "m'", "'", "’"] },
  { code: "h", dimension: "tempo", factor: 60, label: "ore", aliases: ["h", "hr", "hrs", "ora", "ore"] },
  { code: "giorni", dimension: "tempo", factor: 1440, label: "giorni", aliases: ["gg", "giorno", "giorni", "day", "days"] },
  { code: "settimane", dimension: "tempo", factor: 10080, label: "settimane", aliases: ["sett", "settimana", "settimane"] },
  { code: "mesi", dimension: "tempo", factor: 43200, label: "mesi", aliases: ["mese", "mesi"] },
  { code: "l", dimension: "volume", factor: 1, label: "litri", aliases: ["l", "lt", "litro", "litri"] },
  { code: "USG", dimension: "volume", factor: 3.785411784, label: "galloni USA", aliases: ["usg", "gal", "gallone", "galloni", "us gal"] },
  { code: "m3", dimension: "volume", factor: 1000, label: "metri cubi", aliases: ["m3", "m³", "mc", "metro cubo", "metri cubi"] },
  { code: "kt", dimension: "velocita", factor: 1.852, label: "nodi", aliases: ["kt", "kts", "kn", "nodo", "nodi"] },
  { code: "km/h", dimension: "velocita", factor: 1, label: "km/h", aliases: ["km/h", "kmh", "km/ora", "chilometri orari"] },
];

const ALIAS_INDEX: ReadonlyMap<string, UnitDef> = new Map(
  UNITS.flatMap((u) => u.aliases.map((a) => [a, u] as const)),
);

function foldUnitToken(token: string): string {
  return deaccent(cleanText(token)).toLowerCase().replace(/\s+/g, " ").replace(/\.$/, "");
}

/** Unità da un token scritto («piedi», «NM», «km/h»), oppure null. */
export function lookupUnit(token: string): UnitDef | null {
  return ALIAS_INDEX.get(foldUnitToken(token)) ?? null;
}

export function unitByCode(code: string): UnitDef | null {
  return UNITS.find((u) => u.code === code) ?? null;
}

/** Converte un valore tra due unità della stessa grandezza. */
export function convert(value: number, from: UnitDef, to: UnitDef): number {
  if (from.dimension !== to.dimension) throw new Error("Unità di grandezze diverse");
  return (value * from.factor) / to.factor;
}

/** Valore nell'unità base della sua grandezza, arrotondato a 6 decimali. */
export function toBase(value: number, unit: UnitDef): { value: number; unit: string } {
  return { value: roundTo(value * unit.factor, 6), unit: BASE_UNITS[unit.dimension] };
}

/**
 * Prova a leggere un'unità all'inizio di un testo: restituisce l'unità e il
 * resto («ore per anno» → h, «per anno»). Prova da 3 parole a 1.
 */
export function leadingUnit(text: string): { unit: UnitDef; rest: string } | null {
  const cleaned = cleanText(text);
  const words = cleaned.split(/\s+/);
  for (let n = Math.min(3, words.length); n >= 1; n--) {
    const head = words.slice(0, n).join(" ").replace(/[,;:(]+$/, "");
    const unit = lookupUnit(head);
    if (unit) return { unit, rest: words.slice(n).join(" ").trim() };
  }
  return null;
}

export interface UnitHint {
  /** Testo originale del template. */
  raw: string | null;
  /** Unità fisica attesa. */
  unit: UnitDef | null;
  /** Unità alternative («ore o giorni»): una delle due va indicata. */
  alternatives: UnitDef[];
  /** Etichetta di un conteggio o di un'unità senza conversione («passeggeri»). */
  label: string | null;
  /** Intervallo ammesso scritto nell'unità («0-1», «punti 1-5»). */
  range: { min: number; max: number } | null;
}

/** Precisazione dopo l'unità: «per giorno», «al mese», «all'anno», «di preavviso». */
const QUALIFIER = /^(?:per|a|al|allo|alla|ai|agli|alle|all['’]|ogni|in|di|del|della|dal|dalla|da|su|sul|sulla)(?:\s|['’]|$)/i;

const RANGE_IN_UNIT = /(?:^|[\s(])(-?\d+(?:[.,]\d+)?)\s*(?:-|–|—|a)\s*(-?\d+(?:[.,]\d+)?)(?=\s|\)|%|$)/;

/** Legge l'unità in testo libero del template. */
export function parseUnitHint(rawUnit: string | null | undefined): UnitHint {
  const raw = typeof rawUnit === "string" && cleanText(rawUnit) !== "" ? cleanText(rawUnit) : null;
  const hint: UnitHint = { raw, unit: null, alternatives: [], label: null, range: null };
  if (raw === null) return hint;

  const rangeMatch = RANGE_IN_UNIT.exec(raw);
  if (rangeMatch) {
    const a = parseNumberIt(rangeMatch[1]);
    const b = parseNumberIt(rangeMatch[2]);
    if (a.ok && b.ok && a.value < b.value) hint.range = { min: a.value, max: b.value };
  }

  // Elenco di alternative: «ore o giorni», «t, passeggeri o km secondo fascia_tipo».
  // Le parti che iniziano con una preposizione sono solo precisazioni della
  // prima unità: «ore per turno o per giorno» → ore.
  const parts = cleanText(raw.replace(/\([^)]*\)/g, " "))
    .split(/\s*,\s*|\s+o\s+|\s+oppure\s+/)
    .filter(Boolean);
  if (parts.length > 1) {
    const units = parts.map((p) => leadingUnit(p)?.unit ?? null);
    if (units.every((u): u is UnitDef => u !== null)) {
      const unique = [...new Map(units.map((u) => [u.code, u])).values()];
      if (unique.length === 1) hint.unit = unique[0];
      else if (unique.every((u) => u.dimension === unique[0].dimension)) hint.alternatives = unique;
      else hint.label = raw;
      return hint;
    }
    const qualifiersOnly = units[0] !== null && parts.slice(1).every((p, i) => units[i + 1] === null && QUALIFIER.test(p));
    if (!qualifiersOnly) {
      hint.label = raw;
      return hint;
    }
  }

  const lead = leadingUnit(raw);
  if (lead) hint.unit = lead.unit;
  else if (!hint.range || !/^[\s\d.,()\-–—a%]+$/.test(raw)) hint.label = raw;
  return hint;
}

/** Due etichette indicano la stessa cosa? («passeggero» ~ «passeggeri»). */
export function labelsMatch(a: string, b: string): boolean {
  const fa = foldUnitToken(a);
  const fb = foldUnitToken(b);
  if (fa === fb) return true;
  const stem = (s: string) => s.split(" ")[0].replace(/[aeiou]$/, "");
  return stem(fa).length >= 3 && stem(fa) === stem(fb);
}

// Numero all'inizio, poi l'eventuale unità («1.200 m», «-3,5 kg», «1 200 ft»).
const NUMBER_THEN_REST = /^([-+\u2212]?(?:\d[\d.,'’ ]*\d|\d)|[-+\u2212]?,\d+)\s*([\s\S]*)$/;

/** Separa numero e testo che segue. Null se il testo non inizia con un numero. */
export function splitNumberAndUnit(text: string): { number: string; rest: string } | null {
  const m = NUMBER_THEN_REST.exec(cleanText(text));
  if (!m) return null;
  return { number: m[1].trim(), rest: (m[2] ?? "").trim() };
}

export interface NumeroValue {
  value: number;
  unit: string | null;
}

type NumberInput = { value: number; unitToken: string | null; fromProse: boolean };

function readNumberInput(raw: unknown, strict: boolean, warnings: Issue[]): NumberInput | Issue[] {
  if (typeof raw === "number") {
    const p = parseNumberIt(raw, "value");
    return p.ok ? { value: p.value, unitToken: null, fromProse: false } : p.errors;
  }
  if (isPlainObject(raw)) {
    const unit = typeof raw.unit === "string" && cleanText(raw.unit) !== "" ? cleanText(raw.unit) : null;
    const p = parseNumberIt(raw.value, "value");
    if (!p.ok) return p.errors;
    warnings.push(...p.warnings);
    return { value: p.value, unitToken: unit, fromProse: false };
  }
  if (typeof raw !== "string") return [issue("numero_non_valido", "Scrivi un numero.", "value")];
  const split = splitNumberAndUnit(raw);
  if (split) {
    const p = parseNumberIt(split.number, "value");
    if (p.ok) {
      warnings.push(...p.warnings);
      return { value: p.value, unitToken: split.rest === "" ? null : split.rest, fromProse: false };
    }
  }
  if (cleanText(raw) === "") return [issue("numero_mancante", "Scrivi un numero.", "value")];
  if (!strict) {
    // Lettura da un testo libero (bozze, valori dichiarati in call): solo se c'è un numero solo.
    const numbers = extractNumbersIt(raw);
    if (numbers.length === 1) {
      const after = raw.slice(numbers[0].end).trim();
      const lead = after ? leadingUnit(after) : null;
      warnings.push(issue("letto_da_testo", "Ho letto il numero dal testo: controlla che sia giusto.", "value"));
      return { value: numbers[0].value, unitToken: lead ? lead.unit.code : null, fromProse: true };
    }
  }
  return [issue("numero_non_valido", "Scrivi solo il numero e, se serve, l'unità. Per una stima usa «È una stima».", "value")];
}

function rangeIssues(value: number, config: ResponseConfig, hint: UnitHint, unitLabel: string | null): Issue[] {
  const out: Issue[] = [];
  const min = typeof config.min === "number" ? config.min : hint.range?.min;
  const max = typeof config.max === "number" ? config.max : hint.range?.max;
  const suffix = unitLabel ? ` ${unitLabel}` : "";
  if (config.integer === true && !Number.isInteger(value)) {
    out.push(issue("intero_richiesto", "Qui serve un numero intero.", "value"));
  }
  if (min !== undefined && value < min) {
    out.push(issue("sotto_minimo", `Il valore minimo è ${formatNumberIt(min)}${suffix}.`, "value"));
  }
  if (max !== undefined && value > max) {
    out.push(issue("sopra_massimo", `Il valore massimo è ${formatNumberIt(max)}${suffix}.`, "value"));
  }
  return out;
}

function extraText(strict: boolean, errors: Issue[], warnings: Issue[]): void {
  const message = "Dopo il numero scrivi solo l'unità. Per una stima usa «È una stima»; il resto va nella nota.";
  (strict ? errors : warnings).push(issue("testo_in_piu", message, "value"));
}

/**
 * Tipo `numero`. Valore `{value, unit}` come scritto dal referente; normalizzato
 * `{value_si, unit_si}` nell'unità base (conteggi ed etichette: stesso valore,
 * `unit_si` = etichetta). Unità sconosciuta su una voce con unità fisica:
 * normalizzato null con avviso (errore all'invio).
 */
export function normalizeNumero(raw: unknown, config: ResponseConfig, ctx: Pick<NormalizeContext, "strict">): Outcome {
  const warnings: Issue[] = [];
  const read = readNumberInput(raw, ctx.strict, warnings);
  if (Array.isArray(read)) return outcome({ value: null, errors: read, warnings });

  const hint = parseUnitHint(config.unit ?? null);
  const expected = hint.unit;
  const errors: Issue[] = [];
  let given: UnitDef | null = null;
  let givenLabel: string | null = null;
  if (read.unitToken !== null) {
    const exact = lookupUnit(read.unitToken);
    const lead = exact ? null : leadingUnit(read.unitToken);
    if (exact) given = exact;
    else if (lead) {
      given = lead.unit;
      extraText(ctx.strict, errors, warnings);
    } else if (/\d/.test(read.unitToken) || read.unitToken.split(/\s+/).length > 3) {
      extraText(ctx.strict, errors, warnings);
    } else {
      givenLabel = read.unitToken;
    }
  }

  const value: NumeroValue = { value: read.value, unit: null };
  let normalized: Json | null = null;
  // Valore espresso nell'unità della voce, per minimo e massimo.
  let valueInExpected = read.value;

  if (expected || hint.alternatives.length > 0) {
    const allowed = expected ? [expected] : hint.alternatives;
    const unit = given ?? (givenLabel === null && expected ? expected : null);
    if (unit === null) {
      if (givenLabel !== null) {
        errors.push(
          issue("unita_sconosciuta", `Unità non riconosciuta. Usa ${allowed.map((u) => u.label).join(" o ")}.`, "unit"),
        );
      } else {
        errors.push(issue("unita_mancante", `Indica l'unità: ${allowed.map((u) => u.label).join(" o ")}.`, "unit"));
      }
    } else if (unit.dimension !== allowed[0].dimension) {
      errors.push(
        issue("unita_incompatibile", `Qui serve una misura in ${allowed.map((u) => u.label).join(" o ")}.`, "unit"),
      );
    } else {
      value.unit = unit.code;
      const base = toBase(read.value, unit);
      normalized = { value_si: base.value, unit_si: base.unit };
      valueInExpected = expected ? convert(read.value, unit, expected) : read.value;
    }
  } else if (hint.label !== null) {
    value.unit = hint.label;
    if (given) {
      errors.push(issue("unita_incompatibile", `Qui serve un numero di ${hint.label}, senza altre unità.`, "unit"));
    } else {
      if (givenLabel !== null && !labelsMatch(givenLabel, hint.label)) {
        warnings.push(issue("unita_ignorata", `Ho letto il numero come ${hint.label}.`, "unit"));
      }
      normalized = { value_si: read.value, unit_si: hint.label };
    }
  } else if (given) {
    value.unit = given.code;
    const base = toBase(read.value, given);
    normalized = { value_si: base.value, unit_si: base.unit };
  } else {
    value.unit = givenLabel;
    normalized = { value_si: read.value, unit_si: givenLabel };
  }

  errors.push(...rangeIssues(valueInExpected, config, hint, expected?.label ?? hint.label));
  if (errors.length > 0) normalized = null;
  return outcome({ value: value as unknown as Json, normalized, errors, warnings });
}
