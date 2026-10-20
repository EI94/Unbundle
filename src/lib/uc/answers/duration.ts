/**
 * Tipo `durata` (PIANO §3.9): `{amount, unit}` → `{minutes}`.
 *
 * Accetta «90 min», «90'», «1,5 h», «2:30» e «2.30» (ore e minuti, come
 * nell'ora del giorno; il punto dà un avviso), «02:30:00» (copiato da Excel),
 * «2 ore e 30»,
 * «1h30», «2 ore e mezza», «mezz'ora», «3 giorni» (1 giorno = 1.440 minuti) e
 * le unità alternative della voce («ore o giorni»: un numero senza unità va
 * precisato). Un numero senza unità vale nell'unità della voce.
 * `min`/`max` sono nell'unità della voce, oppure in minuti se la voce ne ha più
 * d'una o nessuna.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import { issue, type Issue } from "./issues.ts";
import { extractNumbersIt, formatNumberIt, parseNumberIt, roundTo } from "./number-it.ts";
import { cleanText, deaccent, isPlainObject } from "./strings.ts";
import { outcome, type NormalizeContext, type Outcome, type ResponseConfig } from "./types.ts";
import { leadingUnit, lookupUnit, parseUnitHint, type UnitDef, type UnitHint } from "./units.ts";

export interface DurationValue {
  amount: number;
  unit: string;
}

const DURATION_MESSAGE = "Scrivi la durata, per esempio 90 min, 1,5 ore, 2:30 o 3 giorni.";

function timeUnit(token: string): UnitDef | null {
  const u = lookupUnit(token) ?? leadingUnit(token)?.unit ?? null;
  return u && u.dimension === "tempo" ? u : null;
}

export type DurationRead = {
  amount: number;
  unit: UnitDef | null;
  compound: boolean;
  fromProse: boolean;
  /** «2.30» letto come ore e minuti: si avvisa, perché il punto può essere un decimale. */
  dotAsHoursMinutes?: boolean;
};

/**
 * Legge una durata da un testo. `unit = null` se il testo è un numero senza
 * unità (decide la voce).
 */
export function readDurationText(text: string, strict: boolean): DurationRead | Issue[] {
  const t = deaccent(cleanText(text)).toLowerCase().replace(/\s+/g, " ");
  if (t === "") return [issue("durata_mancante", "Scrivi la durata.", "amount")];
  const min = lookupUnit("min") as UnitDef;
  const hours = lookupUnit("h") as UnitDef;

  // «mezz'ora», «un'ora», «un giorno»
  if (/^mezz['’ ]?ora$/.test(t)) return { amount: 30, unit: min, compound: true, fromProse: false };
  const one = /^(?:un['’]\s*|una\s+|uno\s+|un\s+)([a-z]+)$/.exec(t);
  if (one && timeUnit(one[1])) return { amount: 1, unit: timeUnit(one[1]), compound: false, fromProse: false };

  // «2:30», «2.30 h», «2.30 ore» = ore e minuti; «02:30:00» = ore, minuti e secondi (Excel)
  let m = /^(\d{1,3})([:.])(\d{2})(?::(\d{2}))?(?:\s*(?:h|ore))?$/.exec(t);
  if (m && Number(m[3]) < 60 && (m[4] === undefined || (m[2] === ":" && Number(m[4]) < 60))) {
    const minutes = Number(m[1]) * 60 + Number(m[3]) + (m[4] === undefined ? 0 : Number(m[4]) / 60);
    return { amount: roundTo(minutes, 4), unit: min, compound: true, fromProse: false, dotAsHoursMinutes: m[2] === "." };
  }

  // «1h30», «1 h 30 min», «2 ore e 30», «2 ore e 30 minuti», «2 ore e mezza», «1 giorno e 4 ore»
  m = /^(\d+(?:[.,]\d+)?)\s*([a-z']+)\s*(?:e\s+)?(?:(\d+(?:[.,]\d+)?)\s*([a-z']+)?|(mezza|mezzo))$/.exec(t);
  if (m) {
    const first = timeUnit(m[2]);
    const a = parseNumberIt(m[1]);
    if (first && a.ok) {
      if (m[5]) return { amount: (a.value + 0.5) * first.factor, unit: min, compound: true, fromProse: false };
      const b = parseNumberIt(m[3]);
      const smaller = m[4] ? timeUnit(m[4]) : first.code === "h" ? min : first.code === "giorni" ? hours : null;
      if (b.ok && smaller && smaller.factor < first.factor) {
        return { amount: a.value * first.factor + b.value * smaller.factor, unit: min, compound: true, fromProse: false };
      }
    }
  }

  // «90 min», «1,5 h», «3 giorni», «90'», oppure solo «90»
  m = /^([-+]?\d[\d.,]*)\s*(.*)$/.exec(t);
  if (m) {
    const a = parseNumberIt(m[1]);
    const rest = m[2].trim();
    if (a.ok && rest === "") return { amount: a.value, unit: null, compound: false, fromProse: false };
    const unit = a.ok ? lookupUnit(rest) : null;
    if (a.ok && unit && unit.dimension === "tempo") return { amount: a.value, unit, compound: false, fromProse: false };
    if (a.ok && unit) return [issue("unita_incompatibile", "Qui serve una durata in minuti, ore o giorni.", "unit")];
  }

  if (!strict) {
    const numbers = extractNumbersIt(text);
    if (numbers.length === 1) {
      const after = deaccent(text.slice(numbers[0].end)).toLowerCase().trim();
      const unit = after ? timeUnit(after.split(/\s+/)[0]) : null;
      return { amount: numbers[0].value, unit, compound: false, fromProse: true };
    }
  }
  return [issue("durata_non_valida", DURATION_MESSAGE, "amount")];
}

function boundsIssues(minutes: number, config: ResponseConfig, hint: UnitHint): Issue[] {
  const out: Issue[] = [];
  const unit = hint.unit && hint.unit.dimension === "tempo" ? hint.unit : null;
  const factor = unit ? unit.factor : 1;
  const label = unit ? unit.label : "minuti";
  const value = minutes / factor;
  if (typeof config.min === "number" && value < config.min) {
    out.push(issue("sotto_minimo", `La durata minima è ${formatNumberIt(config.min)} ${label}.`, "amount"));
  }
  if (typeof config.max === "number" && value > config.max) {
    out.push(issue("sopra_massimo", `La durata massima è ${formatNumberIt(config.max)} ${label}.`, "amount"));
  }
  return out;
}

/** Tipo `durata`. */
export function normalizeDurata(raw: unknown, config: ResponseConfig, ctx: Pick<NormalizeContext, "strict">): Outcome {
  const warnings: Issue[] = [];
  let read: DurationRead | Issue[];
  if (isPlainObject(raw)) {
    const a = parseNumberIt(raw.amount, "amount");
    const unitText = typeof raw.unit === "string" ? raw.unit : "";
    const unit = unitText ? timeUnit(unitText) : null;
    if (!a.ok) read = a.errors;
    else if (unitText && !unit) read = [issue("unita_sconosciuta", "Usa minuti, ore o giorni.", "unit")];
    else {
      warnings.push(...a.warnings);
      read = { amount: a.value, unit, compound: false, fromProse: false };
    }
  } else if (typeof raw === "number") {
    read = { amount: raw, unit: null, compound: false, fromProse: false };
  } else if (typeof raw === "string") {
    read = readDurationText(raw, ctx.strict);
  } else {
    read = [issue("durata_mancante", "Scrivi la durata.", "amount")];
  }
  if (Array.isArray(read)) return outcome({ value: null, errors: read, warnings });
  if (read.fromProse) warnings.push(issue("letto_da_testo", "Ho letto la durata dal testo: controlla che sia giusta.", "amount"));
  if (read.dotAsHoursMinutes) {
    warnings.push(issue("letto_come_ore_minuti", "Ho letto il punto come ore e minuti (2.30 = 2 ore e 30 minuti): controlla che sia giusto.", "amount"));
  }

  const hint = parseUnitHint(config.unit ?? null);
  const expected = hint.unit && hint.unit.dimension === "tempo" ? hint.unit : null;
  const errors: Issue[] = [];
  let unit = read.unit;
  if (unit === null) {
    if (expected) unit = expected;
    else {
      const options = hint.alternatives.filter((u) => u.dimension === "tempo");
      errors.push(
        issue(
          "unita_mancante",
          options.length > 1 ? `Indica se sono ${options.map((u) => u.label).join(" o ")}.` : "Indica l'unità: minuti, ore o giorni.",
          "unit",
        ),
      );
      return outcome({ value: { amount: read.amount, unit: null }, errors, warnings });
    }
  }
  if (!Number.isFinite(read.amount) || read.amount < 0) {
    errors.push(issue("durata_negativa", "La durata non può essere negativa.", "amount"));
  }
  if (unit.code === "mesi") warnings.push(issue("mese_30_giorni", "Un mese vale 30 giorni nel calcolo in minuti.", "unit"));
  const minutes = roundTo(read.amount * unit.factor, 4);
  errors.push(...boundsIssues(minutes, config, hint));
  const value: DurationValue = { amount: read.amount, unit: unit.code };
  return outcome({
    value: value as unknown as Json,
    normalized: errors.length === 0 ? { minutes } : null,
    errors,
    warnings,
  });
}
