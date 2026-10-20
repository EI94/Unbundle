/**
 * Tipo `valuta` (PIANO §3.9): `{amount, currency, vat, per}` (+ `valid_from`)
 * → `{amount_eur}`.
 *
 * - Lettura di «€ 1.200,50», «1200 EUR», «CHF 300», «£ 50», «1.200 euro + IVA»,
 *   «2.000 € a volo IVA esclusa».
 * - Simboli: € → EUR, £ → GBP, $ → USD; codici ISO da un elenco chiuso (niente
 *   sigle di aeroporti scambiate per valute).
 * - `amount ≥ 0`; `vat ∈ {inclusa, esclusa}` obbligatoria; `per` obbligatorio,
 *   proposto dall'unità del template («€ per notte» → «notte», «€ all'anno» →
 *   «anno»). Fuori EUR serve `fx {rate_to_eur, date, source}`.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import { parseDateIt } from "./datetime.ts";
import { issue, type Issue } from "./issues.ts";
import { extractNumbersIt, parseNumberIt, roundTo } from "./number-it.ts";
import { cleanText, deaccent, isPlainObject, nonEmptyString } from "./strings.ts";
import { outcome, type NormalizeContext, type Outcome, type ResponseConfig } from "./types.ts";

export type Vat = "inclusa" | "esclusa";

/** Codici ISO 4217 ammessi. Un codice fuori elenco non è una valuta. */
export const CURRENCY_CODES = [
  "EUR", "USD", "GBP", "CHF", "SEK", "NOK", "DKK", "ISK", "PLN", "CZK", "HUF", "RON", "BGN", "RSD", "TRY",
  "AED", "SAR", "QAR", "KWD", "BHD", "OMR", "ILS", "EGP", "MAD", "TND", "ZAR", "RUB", "UAH",
  "JPY", "CNY", "HKD", "SGD", "INR", "THB", "KRW", "AUD", "NZD", "CAD", "MXN", "BRL", "ARS",
] as const;
export type CurrencyCode = (typeof CURRENCY_CODES)[number];

const SYMBOLS: Readonly<Record<string, CurrencyCode>> = { "€": "EUR", "£": "GBP", $: "USD", "us$": "USD" };
const WORDS: Readonly<Record<string, CurrencyCode>> = {
  euro: "EUR",
  eur: "EUR",
  dollaro: "USD",
  dollari: "USD",
  sterlina: "GBP",
  sterline: "GBP",
  franco: "CHF",
  franchi: "CHF",
  "franco svizzero": "CHF",
  "franchi svizzeri": "CHF",
  fr: "CHF",
};

/** Suggerimenti per «a cosa si riferisce l'importo». */
export const CURRENCY_PER_SUGGESTIONS = ["volo", "ora", "notte", "persona", "tratta", "giorno", "mese", "anno", "una tantum"] as const;

/** Valuta da un simbolo, un codice o una parola, altrimenti null. */
export function currencyFromToken(token: string): CurrencyCode | null {
  const t = deaccent(cleanText(token)).toLowerCase().replace(/\.$/, "");
  if (SYMBOLS[t]) return SYMBOLS[t];
  if (WORDS[t]) return WORDS[t];
  const upper = t.toUpperCase();
  return (CURRENCY_CODES as readonly string[]).includes(upper) ? (upper as CurrencyCode) : null;
}

const VAT_INCLUDED = /(?:\biva\s+(?:inclusa|compresa|incl\.?)|\b(?:inclusa|compresa|incluso|compreso)\s+(?:l['’]\s*)?iva|\bivat[oa]\b)/i;
const VAT_EXCLUDED = /(?:\+\s*iva\b|\biva\s+(?:esclusa|escl\.?|a\s+parte)|\b(?:esclusa|escluso|oltre|piu|più|senza)\s+(?:l['’]\s*)?iva\b|\bal\s+netto\s+(?:di\s+|dell['’]\s*)?iva\b|\bnetto\s+iva\b|\bnon\s+ivat[oa]\b)/i;

/** IVA da un testo («IVA inclusa», «+ IVA», «al netto di IVA»), altrimenti null. */
export function vatFromText(text: string): Vat | null {
  if (VAT_EXCLUDED.test(text)) return "esclusa";
  if (VAT_INCLUDED.test(text)) return "inclusa";
  return null;
}

function vatFromValue(value: unknown): Vat | null {
  if (value === "inclusa" || value === true) return "inclusa";
  if (value === "esclusa" || value === false) return "esclusa";
  return typeof value === "string" ? vatFromText(/iva/i.test(value) ? value : `iva ${value}`) : null;
}

// «a volo», «per notte», «/ora», «all'anno», «al mese», «ogni tratta»: in fondo al testo.
const PER_SUFFIX = /(?:\s*\/\s*|\s+(?:per|a|ad|ogni)\s+|\s+(?:al|allo|alla)\s+|\s+all['’]\s*)([a-zà-ù][a-zà-ù' ]*?)\s*$/i;

/**
 * Unità di riferimento proposta dall'unità del template: «€ per notte» →
 * «notte», «€/ora» → «ora», «€ all'anno per cliente» → «anno per cliente».
 * Le parti tra parentesi si ignorano.
 */
export function perFromUnit(unit: string | null | undefined): string | null {
  if (typeof unit !== "string") return null;
  // Parentesi e precisazioni dopo la virgola non fanno parte dell'unità: «€/anno, IVA esclusa» → «anno».
  const text = cleanText(unit.replace(/\([^)]*\)/g, " ").split(/[,;]/)[0] ?? "");
  const m = /^(?:€|eur|euro)\s*(?:\/\s*|per\s+|a\s+|al\s+|alla\s+|all['’]\s*)(.+)$/i.exec(text);
  return m ? cleanText(m[1]) || null : null;
}

/** IVA indicata dall'unità del template («€/anno, IVA esclusa»), fuori dalle parentesi. */
export function vatFromUnit(unit: string | null | undefined): Vat | null {
  if (typeof unit !== "string") return null;
  return vatFromText(unit.replace(/\([^)]*\)/g, " "));
}

/** Valuta proposta dall'unità del template («EUR», «€ per notte»); null se libera. */
export function currencyFromUnit(unit: string | null | undefined): CurrencyCode | null {
  if (typeof unit !== "string") return null;
  const first = cleanText(unit).split(/[\s/]+/)[0] ?? "";
  return currencyFromToken(first);
}

export interface ParsedMoney {
  amount: number;
  currency: CurrencyCode | null;
  vat: Vat | null;
  per: string | null;
}

const CURRENCY_TOKEN = "(€|£|\\$|us\\$|[a-z]{3}|euro|dollar[oi]|sterlin[ae]|franc(?:o|hi)(?:\\s+svizzer[oi])?|fr\\.?)";
const MONEY = new RegExp(`^(?:${CURRENCY_TOKEN}\\s*)?([-+\\u2212]?(?:\\d[\\d.,'’ ]*\\d|\\d))\\s*(?:${CURRENCY_TOKEN})?$`, "i");

/**
 * Legge un importo scritto in un testo. In modo stretto il testo deve essere
 * solo importo, valuta, IVA e unità di riferimento; altrimenti si cerca un solo
 * numero nel testo.
 */
export function parseMoneyText(text: string, strict: boolean): { money: ParsedMoney; fromProse: boolean } | Issue[] {
  let rest = cleanText(text);
  if (rest === "") return [issue("importo_mancante", "Scrivi l'importo.", "amount")];
  const vat = vatFromText(rest);
  rest = rest.replace(VAT_EXCLUDED, " ").replace(VAT_INCLUDED, " ").replace(/\s+/g, " ").trim();
  let per: string | null = null;
  const perMatch = PER_SUFFIX.exec(rest);
  if (perMatch && /\d/.test(rest.slice(0, perMatch.index))) {
    per = cleanText(perMatch[1]);
    rest = rest.slice(0, perMatch.index).trim();
  }
  const m = MONEY.exec(rest);
  if (m) {
    const before = m[1] ? currencyFromToken(m[1]) : null;
    const after = m[3] ? currencyFromToken(m[3]) : null;
    const amount = parseNumberIt(m[2], "amount");
    const tokensOk = (m[1] === undefined || before !== null) && (m[3] === undefined || after !== null);
    if (amount.ok && tokensOk && !(before && after && before !== after)) {
      return { money: { amount: amount.value, currency: before ?? after, vat, per }, fromProse: false };
    }
  }
  if (!strict) {
    const numbers = extractNumbersIt(text);
    if (numbers.length === 1) {
      const symbol = /€|£|\$|\b(?:eur|euro|chf|usd|gbp)\b/i.exec(text);
      return {
        money: { amount: numbers[0].value, currency: symbol ? currencyFromToken(symbol[0]) : null, vat, per: null },
        fromProse: true,
      };
    }
  }
  return [issue("importo_non_valido", "Scrivi l'importo, per esempio € 1.200,50. Per una stima usa «È una stima».", "amount")];
}

export interface FxInfo {
  rate_to_eur: number;
  date: string;
  source: string;
}

function readFx(raw: unknown, today: string, errors: Issue[]): FxInfo | null {
  if (raw === undefined || raw === null) return null;
  if (!isPlainObject(raw)) {
    errors.push(issue("cambio_non_valido", "Indica cambio verso l'euro, data e fonte.", "fx"));
    return null;
  }
  const rate = parseNumberIt(raw.rate_to_eur, "fx.rate_to_eur");
  const date = parseDateIt(raw.date, "fx.date");
  const source = nonEmptyString(raw.source);
  if (!rate.ok) errors.push(...rate.errors);
  else if (rate.value <= 0) errors.push(issue("cambio_non_valido", "Il cambio deve essere maggiore di zero.", "fx.rate_to_eur"));
  if (!date.ok) errors.push(...date.errors);
  else if (date.value > today) errors.push(issue("data_futura", "La data del cambio non può essere nel futuro.", "fx.date"));
  if (source === null) errors.push(issue("fonte_cambio_mancante", "Indica la fonte del cambio (per esempio BCE).", "fx.source"));
  if (!rate.ok || !date.ok || source === null || rate.value <= 0) return null;
  return { rate_to_eur: rate.value, date: date.value, source };
}

/** Tipo `valuta`. */
export function normalizeValuta(raw: unknown, config: ResponseConfig, ctx: Pick<NormalizeContext, "strict" | "today">): Outcome {
  const warnings: Issue[] = [];
  const errors: Issue[] = [];
  let money: ParsedMoney;
  let fxRaw: unknown = undefined;
  let validFromRaw: unknown = undefined;

  if (isPlainObject(raw)) {
    const amountText = typeof raw.amount === "string" ? raw.amount : null;
    let parsedText: ParsedMoney | null = null;
    if (amountText !== null) {
      const p = parseMoneyText(amountText, ctx.strict);
      if (Array.isArray(p)) return outcome({ value: null, errors: p });
      parsedText = p.money;
      if (p.fromProse) warnings.push(issue("letto_da_testo", "Ho letto l'importo dal testo: controlla che sia giusto.", "amount"));
    } else {
      const p = parseNumberIt(raw.amount, "amount");
      if (!p.ok) return outcome({ value: null, errors: p.errors });
      warnings.push(...p.warnings);
      parsedText = { amount: p.value, currency: null, vat: null, per: null };
    }
    const currencyRaw = nonEmptyString(raw.currency);
    const currency = currencyRaw === null ? null : currencyFromToken(currencyRaw);
    if (currencyRaw !== null && currency === null) {
      errors.push(issue("valuta_non_valida", "Valuta non riconosciuta: usa il codice di tre lettere (EUR, CHF, GBP, USD…).", "currency"));
    }
    money = {
      amount: parsedText.amount,
      currency: currency ?? parsedText.currency,
      vat: vatFromValue(raw.vat) ?? parsedText.vat,
      per: nonEmptyString(raw.per) ?? parsedText.per,
    };
    fxRaw = raw.fx;
    validFromRaw = raw.valid_from;
  } else if (typeof raw === "string") {
    const p = parseMoneyText(raw, ctx.strict);
    if (Array.isArray(p)) return outcome({ value: null, errors: p });
    money = p.money;
    if (p.fromProse) warnings.push(issue("letto_da_testo", "Ho letto l'importo dal testo: controlla che sia giusto.", "amount"));
  } else if (typeof raw === "number") {
    const p = parseNumberIt(raw, "amount");
    if (!p.ok) return outcome({ value: null, errors: p.errors });
    money = { amount: p.value, currency: null, vat: null, per: null };
  } else {
    return outcome({ value: null, errors: [issue("importo_mancante", "Scrivi l'importo.", "amount")] });
  }

  const currency: CurrencyCode =
    money.currency ?? currencyFromToken(typeof config.currency === "string" ? config.currency : "") ?? currencyFromUnit(config.unit) ?? "EUR";
  const per = money.per ?? nonEmptyString(config.per) ?? perFromUnit(config.unit);
  const vat = money.vat ?? vatFromValue(config.vat) ?? vatFromUnit(config.unit);

  if (money.amount < 0) errors.push(issue("importo_negativo", "L'importo non può essere negativo.", "amount"));
  if (vat === null) errors.push(issue("iva_mancante", "Indica se l'IVA è inclusa o esclusa.", "vat"));
  if (per === null) {
    errors.push(issue("per_mancante", "Indica a cosa si riferisce l'importo: a volo, a ora, a notte, a persona…", "per"));
  }
  const fx = readFx(fxRaw, ctx.today, errors);
  if (currency !== "EUR" && fx === null && !errors.some((e) => e.field?.startsWith("fx"))) {
    errors.push(issue("cambio_mancante", "L'importo non è in euro: indica il cambio verso l'euro, la data e la fonte.", "fx"));
  }

  let validFrom: string | null = null;
  if (validFromRaw !== undefined && validFromRaw !== null && validFromRaw !== "") {
    const p = parseDateIt(validFromRaw, "valid_from");
    if (p.ok) validFrom = p.value;
    else errors.push(...p.errors);
  }

  const value: Record<string, Json> = { amount: money.amount, currency, vat, per };
  if (fx) value.fx = { ...fx };
  if (validFrom) value.valid_from = validFrom;
  let normalized: Json | null = null;
  if (errors.length === 0) {
    const eur = currency === "EUR" ? money.amount : fx ? money.amount * fx.rate_to_eur : null;
    normalized = eur === null ? null : { amount_eur: roundTo(eur, 4) };
  }
  return outcome({ value, normalized, errors, warnings, validFrom });
}
