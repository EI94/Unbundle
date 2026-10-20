/**
 * Tipi `si_no`, `scelta` e `scelta_multipla` (PIANO §3.9).
 *
 * - `si_no` `{value, note?}`: sì, si, no, vero, falso (anche booleani).
 * - `scelta` `{option, other_text?}`: l'opzione è nella lista della voce
 *   (confronto senza accenti né maiuscole sull'etichetta o sul valore).
 *   «Non lo so» non è un'opzione: è l'azione universale. «Altro» richiede il testo.
 * - `scelta_multipla` `{options[]}`: senza doppioni, rispetta minimo e massimo.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import { issue, type Issue } from "./issues.ts";
import { cleanText, deaccent, foldKey, isPlainObject, nonEmptyString } from "./strings.ts";
import { outcome, type ChoiceOption, type Outcome, type ResponseConfig } from "./types.ts";

const YES = new Set(["si", "s", "yes", "y", "vero", "true", "1", "certo", "esatto"]);
const NO = new Set(["no", "n", "falso", "false", "0"]);

/** Legge sì/no da un testo o da un booleano. */
export function parseYesNo(input: unknown): boolean | null {
  if (typeof input === "boolean") return input;
  if (typeof input === "number") return input === 1 ? true : input === 0 ? false : null;
  if (typeof input !== "string") return null;
  const t = deaccent(cleanText(input)).toLowerCase().replace(/[.!]+$/, "");
  if (YES.has(t)) return true;
  if (NO.has(t)) return false;
  return null;
}

/** Tipo `si_no`. */
export function normalizeSiNo(raw: unknown): Outcome {
  const input = isPlainObject(raw) ? raw.value : raw;
  const value = parseYesNo(input);
  const note = isPlainObject(raw) ? nonEmptyString(raw.note) : null;
  if (value === null) return outcome({ value: null, errors: [issue("scelta_mancante", "Scegli sì o no.", "value")] });
  const out: Record<string, Json> = { value };
  if (note) out.note = note;
  return outcome({ value: out, normalized: { value } });
}

/** Opzioni della voce come `{value, label}`. */
export function choiceOptions(config: ResponseConfig): ChoiceOption[] {
  const raw = Array.isArray(config.options) ? config.options : [];
  const out: ChoiceOption[] = [];
  for (const o of raw) {
    if (typeof o === "string" && cleanText(o) !== "") out.push({ value: cleanText(o), label: cleanText(o) });
    else if (isPlainObject(o) && typeof o.value === "string" && cleanText(o.value) !== "") {
      out.push({ value: cleanText(o.value), label: typeof o.label === "string" ? cleanText(o.label) : cleanText(o.value) });
    }
  }
  return out;
}

const DONT_KNOW_KEYS = ["non_lo_so", "non_so", "non_saprei", "boh", "non_lo_sappiamo", "nessuna_idea"] as const;

/**
 * «Non lo so», «Non lo sappiamo», «non so», «boh», e «Non lo so» con un seguito
 * («Non lo so ancora»): l'azione universale, mai un'opzione. Unico controllo
 * per il normalizzatore del template, il suo validatore e le risposte (PIANO
 * §3.9): un'opzione che il template conserva si può sempre scegliere.
 */
export function isDontKnowText(text: string): boolean {
  if (typeof text !== "string") return false;
  const key = foldKey(text);
  return (DONT_KNOW_KEYS as readonly string[]).includes(key) || key.startsWith("non_lo_so_");
}

const OTHER_KEY = /^altr[oaie](?:_(?:da_)?(?:specific|indic|scriv|precis|descriv|qual)[a-z]*(?:_[a-z]+)*)?$/;

/**
 * «Altro», «Altri», «Altro (specificare)», «Altro: quale?»: chiede il testo.
 * «Altre compagnie» invece è un'opzione come le altre.
 */
export function isOtherOption(option: ChoiceOption | string): boolean {
  const texts = typeof option === "string" ? [option] : [option.value, option.label ?? ""];
  return texts.some((t) => OTHER_KEY.test(foldKey(t)));
}


function findOption(options: ChoiceOption[], input: string): ChoiceOption | null {
  const exact = options.find((o) => o.value === input);
  if (exact) return exact;
  const key = foldKey(input);
  if (key === "") return null;
  return options.find((o) => foldKey(o.value) === key || foldKey(o.label ?? "") === key) ?? null;
}

const OTHER: ChoiceOption = { value: "altro", label: "Altro" };

function resolveChoice(
  input: string,
  options: ChoiceOption[],
  config: ResponseConfig,
  field: string,
): { option: ChoiceOption | null; errors: Issue[] } {
  if (isDontKnowText(input)) {
    return {
      option: null,
      errors: [issue("non_so_non_e_opzione", "«Non lo so» non è una delle opzioni: usa il pulsante «Non lo so».", field)],
    };
  }
  const found = findOption(options, input);
  if (found) return { option: found, errors: [] };
  if (config.allow_other === true && isOtherOption(input)) return { option: OTHER, errors: [] };
  return { option: null, errors: [issue("opzione_non_valida", "Scegli una delle opzioni proposte.", field)] };
}

/** Tipo `scelta`. */
export function normalizeScelta(raw: unknown, config: ResponseConfig): Outcome {
  const input = isPlainObject(raw) ? raw.option : raw;
  const otherText = isPlainObject(raw) ? nonEmptyString(raw.other_text) : null;
  if (typeof input !== "string" || cleanText(input) === "") {
    return outcome({ value: null, errors: [issue("scelta_mancante", "Scegli una delle opzioni.", "option")] });
  }
  const options = choiceOptions(config);
  if (options.length === 0) {
    // Voce senza elenco (il template canonico lo vieta): si salva il testo con un avviso.
    const text = cleanText(input);
    return outcome({
      value: { option: text },
      normalized: { option: text },
      warnings: [issue("opzioni_assenti", "Questa domanda non ha un elenco di opzioni: la risposta resta come testo.", "option")],
    });
  }
  const { option, errors } = resolveChoice(cleanText(input), options, config, "option");
  if (!option) return outcome({ value: { option: cleanText(input) }, errors });
  const value: Record<string, Json> = { option: option.value };
  if (isOtherOption(option)) {
    if (otherText === null) {
      return outcome({ value, errors: [issue("altro_senza_testo", "Hai scelto «Altro»: scrivi quale.", "other_text")] });
    }
    value.other_text = otherText;
  }
  return outcome({ value, normalized: { ...value } });
}

/** Tipo `scelta_multipla`. */
export function normalizeSceltaMultipla(raw: unknown, config: ResponseConfig): Outcome {
  const list = isPlainObject(raw) ? raw.options : raw;
  const otherText = isPlainObject(raw) ? nonEmptyString(raw.other_text) : null;
  const items = Array.isArray(list) ? list : typeof list === "string" ? list.split(/\s*[;\n]\s*/) : null;
  if (items === null) return outcome({ value: null, errors: [issue("scelta_mancante", "Scegli almeno un'opzione.", "options")] });
  const options = choiceOptions(config);
  const chosen: string[] = [];
  const errors: Issue[] = [];
  let hasOther = false;
  items.forEach((item, index) => {
    if (typeof item !== "string" || cleanText(item) === "") return;
    const field = `options[${index}]`;
    if (options.length === 0) {
      chosen.push(cleanText(item));
      return;
    }
    const r = resolveChoice(cleanText(item), options, config, field);
    if (!r.option) {
      errors.push(...r.errors);
      return;
    }
    if (chosen.includes(r.option.value)) {
      errors.push(issue("opzione_doppia", "Hai scelto due volte la stessa opzione.", field));
      return;
    }
    if (isOtherOption(r.option)) hasOther = true;
    chosen.push(r.option.value);
  });
  const min = typeof config.min_choices === "number" ? config.min_choices : typeof config.min === "number" ? config.min : 1;
  const max = typeof config.max_choices === "number" ? config.max_choices : typeof config.max === "number" ? config.max : null;
  if (chosen.length < min) {
    errors.push(issue("troppo_poche_scelte", min <= 1 ? "Scegli almeno un'opzione." : `Scegli almeno ${min} opzioni.`, "options"));
  }
  if (max !== null && chosen.length > max) {
    errors.push(issue("troppe_scelte", max === 1 ? "Puoi scegliere una sola opzione." : `Puoi scegliere al massimo ${max} opzioni.`, "options"));
  }
  if (hasOther && otherText === null) errors.push(issue("altro_senza_testo", "Hai scelto «Altro»: scrivi quale.", "other_text"));
  const value: Record<string, Json> = { options: chosen };
  if (hasOther && otherText !== null) value.other_text = otherText;
  const warnings =
    options.length === 0 ? [issue("opzioni_assenti", "Questa domanda non ha un elenco di opzioni: le risposte restano come testo.", "options")] : [];
  return outcome({ value, normalized: errors.length === 0 ? { ...value } : null, errors, warnings });
}
