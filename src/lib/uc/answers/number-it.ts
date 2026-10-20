/**
 * Lettura dei numeri scritti all'italiana (PIANO §3.9).
 *
 * - Con la virgola: la virgola è il decimale e il punto separa le migliaia
 *   («1.200,50» → 1200.5).
 * - Con soli punti: `^[1-9]\d{0,2}(\.\d{3})+$` sono migliaia («1.200» → 1200,
 *   «12.500.000» → 12500000); altrimenti il punto è il decimale («1.5», «12.75»,
 *   «0.500» → 0,5: uno zero iniziale non apre mai un gruppo di migliaia).
 * - Spazi e apostrofi valgono come separatori delle migliaia solo a gruppi di 3
 *   («1 200», «1'200»).
 * - Rifiutati: «1.2.3», «1,200.50», testo, notazione scientifica, NaN, Infinity.
 *
 * Modulo puro.
 */
import { failed, issue, parsed, type Issue, type Parsed } from "./issues.ts";
import { cleanText } from "./strings.ts";

const INT = /^\d+$/;
const DOT_THOUSANDS = /^[1-9]\d{0,2}(?:\.\d{3})+$/;
const DOT_DECIMAL = /^\d*\.\d+$/;
const COMMA_DECIMAL = /^(?:[1-9]\d{0,2}(?:\.\d{3})+|\d*),\d+$/;
const SPACE_THOUSANDS = /^[1-9]\d{0,2}(?:[ '’]\d{3})+(?:,\d+)?$/;

/** Messaggio unico per un numero illeggibile. */
export const NUMBER_FORMAT_MESSAGE = "Scrivi un numero, per esempio 1.200 oppure 1.200,50.";

function toNumber(intPart: string, decPart: string | null, negative: boolean): number {
  const n = Number(decPart === null ? intPart || "0" : `${intPart || "0"}.${decPart}`);
  return negative ? -n : n;
}

/**
 * Legge un numero da solo (senza unità). Accetta anche un `number` già pronto.
 * L'avviso `virgola_ambigua` segnala «1,200» letto come 1,2.
 */
export function parseNumberIt(input: unknown, field?: string): Parsed<number> {
  if (typeof input === "number") {
    return Number.isFinite(input) ? parsed(input) : failed(issue("numero_non_valido", NUMBER_FORMAT_MESSAGE, field));
  }
  if (typeof input !== "string") return failed(issue("numero_non_valido", NUMBER_FORMAT_MESSAGE, field));
  let text = cleanText(input).replace(/\u2212/g, "-");
  if (text === "") return failed(issue("numero_mancante", "Scrivi un numero.", field));
  let negative = false;
  if (text.startsWith("-") || text.startsWith("+")) {
    negative = text.startsWith("-");
    text = text.slice(1).trim();
  }
  const warnings: Issue[] = [];
  let value: number;
  if (INT.test(text)) {
    value = toNumber(text, null, negative);
  } else if (DOT_THOUSANDS.test(text)) {
    value = toNumber(text.replace(/\./g, ""), null, negative);
  } else if (DOT_DECIMAL.test(text)) {
    const [i, d] = text.split(".");
    value = toNumber(i, d, negative);
  } else if (COMMA_DECIMAL.test(text)) {
    const [i, d] = text.split(",");
    value = toNumber(i.replace(/\./g, ""), d, negative);
    if (!i.includes(".") && d.length === 3 && i.length > 0 && i !== "0") {
      warnings.push(
        issue(
          "virgola_ambigua",
          "Ho letto la virgola come decimale (1,200 vale 1,2). Se intendevi le migliaia, usa il punto (1.200).",
          field,
        ),
      );
    }
  } else if (SPACE_THOUSANDS.test(text)) {
    const [i, d] = text.split(",");
    value = toNumber(i.replace(/[ '’]/g, ""), d ?? null, negative);
  } else {
    return failed(issue("numero_non_valido", NUMBER_FORMAT_MESSAGE, field));
  }
  if (!Number.isFinite(value)) return failed(issue("numero_non_valido", NUMBER_FORMAT_MESSAGE, field));
  return parsed(value === 0 ? 0 : value, warnings);
}

/** Numero di cifre decimali significative (per «massimo 2 decimali»). */
export function decimalPlaces(value: number): number {
  if (!Number.isFinite(value) || Number.isInteger(value)) return 0;
  const text = String(Math.abs(value));
  if (text.includes("e-")) {
    const [mantissa, exp] = text.split("e-");
    return (mantissa.split(".")[1]?.length ?? 0) + Number(exp);
  }
  return text.split(".")[1]?.length ?? 0;
}

/** Arrotonda senza gli artefatti dei float (0.1 + 0.2). */
export function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON * Math.sign(value)) * factor) / factor;
}

export interface NumberToken {
  value: number;
  start: number;
  end: number;
}

// Numero dentro un testo: niente segno se subito prima c'è una cifra («10-20»);
// niente numeri preceduti da una lettera, come i riferimenti «F123», «E2», «A.8»
// o i modelli «A320» (un'unità dopo il numero va bene: «1,5h»).
const NUMBER_IN_TEXT = /(?<![\p{L}\d.,'’])(?:(?<!\d\s*)[-\u2212])?\d+(?:[.,'’]\d+)*(?!\d)/gu;

/**
 * Tutti i numeri leggibili in un testo libero, nell'ordine. I gruppi illeggibili
 * («1.2.3») si saltano. Serve alla lettura «non stretta» dei valori dichiarati.
 */
export function extractNumbersIt(text: string): NumberToken[] {
  const out: NumberToken[] = [];
  const cleaned = text.normalize("NFC");
  for (const m of cleaned.matchAll(NUMBER_IN_TEXT)) {
    const start = m.index ?? 0;
    const p = parseNumberIt(m[0]);
    if (p.ok) out.push({ value: p.value, start, end: start + m[0].length });
  }
  return out;
}

/** Numero all'italiana per i messaggi e i campi precompilati: 1200.5 → «1.200,5». */
export function formatNumberIt(value: number, maxDecimals = 6): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = roundTo(value, maxDecimals);
  const negative = rounded < 0;
  const [intPart, decPart] = Math.abs(rounded).toFixed(maxDecimals).split(".");
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const decimals = (decPart ?? "").replace(/0+$/, "");
  return `${negative ? "-" : ""}${grouped}${decimals ? `,${decimals}` : ""}`;
}
