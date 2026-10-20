/**
 * Tipo `percentuale` (PIANO §3.9): `{value, base}` → `{fraction}`.
 *
 * Accetta «12,5%», «12,5 %», «12,5 per cento», «12,5% del venduto». Da 0 a 100,
 * massimo 2 decimali. La base è obbligatoria: arriva dalla risposta, da
 * `config.base` o dall'unità del template («% dei preventivi» → «dei
 * preventivi»). Un'unità «da 0 a 1» accetta anche la frazione (0,35 → 35%).
 *
 * Modulo puro.
 */
import { issue, type Issue } from "./issues.ts";
import { decimalPlaces, extractNumbersIt, parseNumberIt, roundTo } from "./number-it.ts";
import { cleanText, isPlainObject, nonEmptyString } from "./strings.ts";
import { outcome, type NormalizeContext, type Outcome, type ResponseConfig } from "./types.ts";

export interface PercentHint {
  base: string | null;
  fractionScale: boolean;
}

/** Base e scala dall'unità in testo libero del template. */
export function parsePercentHint(unit: string | null | undefined): PercentHint {
  const text = typeof unit === "string" ? cleanText(unit) : "";
  const fractionScale = /^(?:da\s+)?0\s*(?:-|–|a)\s*1$/i.test(text);
  if (fractionScale || text === "") return { base: null, fractionScale };
  const m = /%\s*(.*)$/.exec(text);
  if (!m) return { base: null, fractionScale: false };
  const base = m[1].replace(/^\(|\)$/g, "").trim();
  if (base === "" || /^[\d\s\-–a%]*$/.test(base)) return { base: null, fractionScale: false };
  return { base, fractionScale: false };
}

// Numero, segno di percentuale facoltativo, base facoltativa.
const PERCENT_TEXT = /^([-+\u2212]?[\d.,'’ ]*\d)\s*(%|per\s*cento|percento)?\s*([\s\S]*)$/i;

interface ReadPercent {
  value: number;
  hasSign: boolean;
  base: string | null;
}

function read(raw: unknown, strict: boolean, warnings: Issue[]): ReadPercent | Issue[] {
  if (typeof raw === "number") {
    const p = parseNumberIt(raw, "value");
    return p.ok ? { value: p.value, hasSign: false, base: null } : p.errors;
  }
  if (isPlainObject(raw)) {
    const p = parseNumberIt(typeof raw.value === "string" ? raw.value.replace(/%\s*$/, "") : raw.value, "value");
    if (!p.ok) return p.errors;
    warnings.push(...p.warnings);
    return { value: p.value, hasSign: typeof raw.value === "string" && raw.value.includes("%"), base: nonEmptyString(raw.base) };
  }
  if (typeof raw !== "string" || cleanText(raw) === "") {
    return [issue("numero_mancante", "Scrivi la percentuale, per esempio 12,5%.", "value")];
  }
  const m = PERCENT_TEXT.exec(cleanText(raw));
  if (m) {
    const p = parseNumberIt(m[1], "value");
    const rest = (m[3] ?? "").trim();
    if (p.ok && (rest === "" || m[2])) {
      warnings.push(...p.warnings);
      return { value: p.value, hasSign: Boolean(m[2]), base: rest === "" ? null : rest };
    }
  }
  if (!strict) {
    const numbers = extractNumbersIt(raw);
    if (numbers.length === 1) {
      warnings.push(issue("letto_da_testo", "Ho letto la percentuale dal testo: controlla che sia giusta.", "value"));
      const after = raw.slice(numbers[0].end);
      return { value: numbers[0].value, hasSign: /^\s*%/.test(after), base: null };
    }
  }
  return [issue("percentuale_non_valida", "Scrivi solo la percentuale, per esempio 12,5%, e la base.", "value")];
}

export function normalizePercentuale(raw: unknown, config: ResponseConfig, ctx: Pick<NormalizeContext, "strict">): Outcome {
  const warnings: Issue[] = [];
  const r = read(raw, ctx.strict, warnings);
  if (Array.isArray(r)) return outcome({ value: null, errors: r, warnings });

  const hint = parsePercentHint(config.unit ?? null);
  let percent = r.value;
  if (hint.fractionScale && !r.hasSign && Math.abs(r.value) <= 1) percent = roundTo(r.value * 100, 10);

  const base = r.base ?? nonEmptyString(config.base) ?? hint.base;
  const errors: Issue[] = [];
  if (percent < 0 || percent > 100) {
    errors.push(issue("percentuale_fuori_intervallo", "La percentuale va da 0 a 100.", "value"));
  }
  if (decimalPlaces(percent) > 2) {
    errors.push(issue("troppi_decimali", "Usa al massimo 2 decimali.", "value"));
  }
  if (typeof config.min === "number" && percent < config.min) {
    errors.push(issue("sotto_minimo", `Il valore minimo è ${config.min}%.`, "value"));
  }
  if (typeof config.max === "number" && percent > config.max) {
    errors.push(issue("sopra_massimo", `Il valore massimo è ${config.max}%.`, "value"));
  }
  if (base === null) {
    errors.push(issue("base_mancante", "Indica su cosa si calcola, per esempio «del venduto».", "base"));
  }
  return outcome({
    value: { value: percent, base },
    normalized: errors.length === 0 ? { fraction: roundTo(percent / 100, 8) } : null,
    errors,
    warnings,
  });
}
