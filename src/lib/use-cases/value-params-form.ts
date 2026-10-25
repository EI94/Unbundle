/**
 * «Ipotesi di calcolo» di Impostazioni › Valutazione: le ipotesi del workspace con cui si contano
 * «Benefici e costi» (`workspace_scoring_models.config.valueParams`, `value-model.ts`).
 *
 * - **Testi** dei campi e del riquadro in sola lettura (`VALUE_PARAMS_TEXT`, `valueParamsLines`).
 * - **Campi** come testo (`ValueParamsTexts`): importi con i punti delle migliaia o la virgola
 *   dei decimali («1.500», «37,5»), mesi interi, il primo mese della curva `AAAA-MM` (vuoto: il
 *   mese corrente, che non si salva), e un sì/no per le voci da misurare.
 * - **Validazione** (`parseValueParamsTexts`): `valueParamsSchema`, con un errore in italiano
 *   per campo. La usano il modulo e il servizio (`saveValueParams` di `settings-data.ts`): le
 *   salvano solo i manager.
 *
 * Modulo puro: import relativi `.ts` e `zod` (attraverso `value-model.ts`).
 */
import {
  VALUE_PARAMS_ERRORS,
  VALUE_PARAMS_LIMITS,
  isMonthCode,
  valueParamsSchema,
  type StoredValueParams,
  type ValueParams,
} from "./value-model.ts";

// ─── Testi ───────────────────────────────────────────────────────────

/** Le chiavi numeriche e il mese, nell'ordine dei campi. */
export const VALUE_PARAMS_FIELDS = [
  "hourlyCostEur",
  "dayCostEur",
  "midValueEur",
  "highValueEur",
  "buildMonths",
  "rampMonths",
  "horizonMonths",
  "originMonth",
] as const;
export type ValueParamsField = (typeof VALUE_PARAMS_FIELDS)[number];

const groupThousands = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
const DECIMAL = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 2, useGrouping: false });

export const VALUE_PARAMS_TEXT = Object.freeze({
  title: "Ipotesi di calcolo",
  hint: "costo orario, soglie in euro, mesi",
  help: "Servono a contare «Benefici e costi»: ore in euro, avvio, Valore e curva del valore netto.",
  readOnly: "Le cambia chi gestisce il workspace, in Impostazioni › Valutazione.",
  editIn: "Puoi cambiarle in",
  settingsPlace: "Impostazioni › Valutazione",
  planRule:
    "Se uno use case non ha i suoi mesi, parte dal primo mese del trimestre approvato; dal primo mese della curva se è già in realizzazione o se il trimestre è già cominciato. Quelli «Più avanti» partono nel trimestre dopo l'ultimo usato.",
  save: "Salva le ipotesi",
  saved: "Ipotesi salvate.",
  originEmpty: "il mese corrente",
  yes: "sì",
  no: "no",
  fields: Object.freeze({
    hourlyCostEur: Object.freeze({ label: "Costo di un'ora di lavoro", suffix: "€" }),
    dayCostEur: Object.freeze({ label: "Costo di una giornata di sviluppo", suffix: "€" }),
    midValueEur: Object.freeze({ label: "Beneficio per «Medio», da", suffix: "€ all'anno" }),
    highValueEur: Object.freeze({ label: "Beneficio per «Alto», da", suffix: "€ all'anno" }),
    buildMonths: Object.freeze({ label: "Mesi dall'avvio all'entrata in uso", suffix: "mesi", help: "Quando lo use case non ha i suoi mesi." }),
    rampMonths: Object.freeze({ label: "Mesi per arrivare al beneficio pieno", suffix: "mesi" }),
    horizonMonths: Object.freeze({ label: "Mesi della curva del valore", suffix: "mesi" }),
    originMonth: Object.freeze({ label: "Primo mese della curva", help: "Vuoto: il mese corrente." }),
    includeUnmeasured: Object.freeze({ label: "Conta anche le voci da misurare", help: "Di solito no: restano fuori dal totale, tratteggiate." }),
  }),
});

export const VALUE_PARAMS_FIELD_ERRORS: Readonly<Record<ValueParamsField, string>> = Object.freeze({
  hourlyCostEur: `Scrivi un importo da 0 a ${groupThousands(VALUE_PARAMS_LIMITS.hourlyCostEurMax)} €.`,
  dayCostEur: `Scrivi un importo da 0 a ${groupThousands(VALUE_PARAMS_LIMITS.dayCostEurMax)} €.`,
  midValueEur: "Scrivi un importo all'anno maggiore di zero.",
  highValueEur: "Scrivi un importo all'anno maggiore di zero.",
  buildMonths: `Scrivi un numero intero di mesi da 0 a ${VALUE_PARAMS_LIMITS.buildMonthsMax}.`,
  rampMonths: `Scrivi un numero intero di mesi da 0 a ${VALUE_PARAMS_LIMITS.rampMonthsMax}.`,
  horizonMonths: `Scrivi un numero intero di mesi da ${VALUE_PARAMS_LIMITS.horizonMonthsMin} a ${VALUE_PARAMS_LIMITS.horizonMonthsMax}.`,
  originMonth: "Scegli un mese, oppure lascia vuoto.",
});

const INCLUDE_UNMEASURED_ERROR = "Scegli sì o no.";

// ─── Campi come testo ────────────────────────────────────────────────

/** I campi come si scrivono. `originMonth` vuoto: il mese corrente (non si salva). */
export interface ValueParamsTexts {
  hourlyCostEur: string;
  dayCostEur: string;
  midValueEur: string;
  highValueEur: string;
  buildMonths: string;
  rampMonths: string;
  horizonMonths: string;
  originMonth: string;
  includeUnmeasured: boolean;
}

/** «37,5», «15.000»: un numero come si scrive nel campo. */
export function numberInputText(n: number): string {
  if (!Number.isFinite(n)) return "";
  return Number.isInteger(n) ? groupThousands(n) : DECIMAL.format(n);
}

/**
 * Le ipotesi come si scrivono nei campi. Il primo mese della curva è quello salvato
 * (`storedOriginMonth`), vuoto se il workspace segue il mese corrente.
 */
export function valueParamsTexts(params: ValueParams, storedOriginMonth: string | null): ValueParamsTexts {
  return {
    hourlyCostEur: numberInputText(params.hourlyCostEur),
    dayCostEur: numberInputText(params.dayCostEur),
    midValueEur: numberInputText(params.midValueEur),
    highValueEur: numberInputText(params.highValueEur),
    buildMonths: String(params.buildMonths),
    rampMonths: String(params.rampMonths),
    horizonMonths: String(params.horizonMonths),
    originMonth: isMonthCode(storedOriginMonth) ? storedOriginMonth : "",
    includeUnmeasured: params.includeUnmeasured,
  };
}

/**
 * Un numero scritto all'italiana: «1.500» (punti delle migliaia), «37,5» (virgola dei
 * decimali), «1.500,5». Senza segno. null se non si legge.
 */
export function parseDecimalText(raw: unknown): number | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const text = raw.trim().replace(/\s+/g, "");
  if (!text) return null;
  let normalized = text;
  if (text.includes(",")) {
    if (!/^\d{1,3}(?:\.\d{3})*,\d+$|^\d+,\d+$/.test(text)) return null;
    normalized = text.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(text)) {
    normalized = text.replace(/\./g, "");
  }
  if (!/^\d+(?:\.\d+)?$/.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isFinite(value) ? value : null;
}

export type ValueParamsResult = { ok: true; value: StoredValueParams } | { ok: false; fieldErrors: Record<string, string> };

/**
 * Le ipotesi da salvare, dai testi dei campi: ogni numero deve leggersi, i limiti sono quelli di
 * `valueParamsSchema` e «Medio» resta sotto «Alto». Il mese vuoto non si salva (vale il mese
 * corrente). Errori per campo, in italiano.
 */
export function parseValueParamsTexts(input: unknown): ValueParamsResult {
  const data = input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
  const fieldErrors: Record<string, string> = {};
  const candidate: Record<string, unknown> = {};
  for (const key of VALUE_PARAMS_FIELDS) {
    if (key === "originMonth") {
      const month = typeof data.originMonth === "string" ? data.originMonth.trim() : "";
      if (month) candidate.originMonth = month;
      continue;
    }
    const value = parseDecimalText(data[key]);
    if (value === null) fieldErrors[key] = VALUE_PARAMS_FIELD_ERRORS[key];
    else candidate[key] = value;
  }
  if (typeof data.includeUnmeasured !== "boolean") fieldErrors.includeUnmeasured = INCLUDE_UNMEASURED_ERROR;
  else candidate.includeUnmeasured = data.includeUnmeasured;
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  const parsed = valueParamsSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, value: parsed.data };
  for (const issue of parsed.error.issues) {
    const key = String(issue.path[0] ?? "");
    if (fieldErrors[key]) continue;
    fieldErrors[key] =
      issue.message === VALUE_PARAMS_ERRORS.midNotBelowHigh
        ? issue.message
        : (VALUE_PARAMS_FIELD_ERRORS as Record<string, string>)[key] ?? VALUE_PARAMS_FIELD_ERRORS.originMonth;
  }
  // Con «Alto» sbagliato, il confronto con «Medio» non dice niente di più.
  if (fieldErrors.highValueEur && fieldErrors.midValueEur === VALUE_PARAMS_ERRORS.midNotBelowHigh) delete fieldErrors.midValueEur;
  return { ok: false, fieldErrors };
}

/** Vero se i campi dicono ipotesi diverse da `saved` (i numeri si confrontano letti, non come testo). */
export function valueParamsTextsChanged(texts: ValueParamsTexts, saved: ValueParamsTexts): boolean {
  if (texts.includeUnmeasured !== saved.includeUnmeasured) return true;
  for (const key of VALUE_PARAMS_FIELDS) {
    const a = texts[key].trim();
    const b = saved[key].trim();
    if (key === "originMonth") {
      if (a !== b) return true;
      continue;
    }
    const va = parseDecimalText(a);
    const vb = parseDecimalText(b);
    if (va === null || vb === null ? a !== b : va !== vb) return true;
  }
  return false;
}

// ─── Riquadro in sola lettura ────────────────────────────────────────

/** «mag 2027»: un mese `AAAA-MM` nel riquadro. */
function monthText(month: string): string {
  const [year, m] = month.split("-").map(Number);
  const name = new Intl.DateTimeFormat("it-IT", { month: "short", timeZone: "UTC" }).format(new Date(Date.UTC(year, m - 1, 1)));
  return `${name} ${year}`;
}

/**
 * Le righe del riquadro «Ipotesi di calcolo» (sola lettura, sotto i grafici): etichetta e valore,
 * nell'ordine dei campi. `followsCurrentMonth`: il workspace non ha salvato il primo mese.
 */
export function valueParamsLines(params: ValueParams, opts: { followsCurrentMonth?: boolean } = {}): Array<{ key: string; label: string; value: string }> {
  const f = VALUE_PARAMS_TEXT.fields;
  const euro = (n: number) => `${numberInputText(n)} €`;
  const months = (n: number) => (n === 1 ? "1 mese" : `${n} mesi`);
  const origin = opts.followsCurrentMonth ? `${VALUE_PARAMS_TEXT.originEmpty} (${monthText(params.originMonth)})` : monthText(params.originMonth);
  return [
    { key: "hourlyCostEur", label: f.hourlyCostEur.label, value: euro(params.hourlyCostEur) },
    { key: "dayCostEur", label: f.dayCostEur.label, value: euro(params.dayCostEur) },
    { key: "midValueEur", label: f.midValueEur.label, value: `${euro(params.midValueEur)} all'anno` },
    { key: "highValueEur", label: f.highValueEur.label, value: `${euro(params.highValueEur)} all'anno` },
    { key: "buildMonths", label: f.buildMonths.label, value: months(params.buildMonths) },
    { key: "rampMonths", label: f.rampMonths.label, value: months(params.rampMonths) },
    { key: "horizonMonths", label: f.horizonMonths.label, value: months(params.horizonMonths) },
    { key: "originMonth", label: f.originMonth.label, value: origin },
    { key: "includeUnmeasured", label: f.includeUnmeasured.label, value: params.includeUnmeasured ? VALUE_PARAMS_TEXT.yes : VALUE_PARAMS_TEXT.no },
  ];
}
