/**
 * Conferme (PIANO §3.9): `conferma_regola`, `conferma_formula` e lo strato
 * `conferma_valore` sopra qualsiasi tipo, con l'impronta del testo o del valore
 * confermato (`uc_answers.text_hash`) e la guardia `valore_non_tipizzato`.
 *
 * - `conferma_regola` `{choice: confermo|correggo|non_vale|non_so, text?, exceptions?}`:
 *   «Correggo» richiede il testo; le eccezioni servono se `config.ask_exceptions`.
 * - `conferma_formula` `{choice: confermo|correggo, formula?}`.
 * - `conferma_valore` `{choice: confermo|correggo|non_so, value?}`: «Correggo»
 *   normalizza `value` con il tipo base, nella stessa unità. «Confermo» senza
 *   valore vale solo se il valore dichiarato è tipizzato (o il tipo base è
 *   testuale); altrimenti il referente reinserisce il valore nel formato giusto
 *   (`{choice: 'confermo', value}`), così nel catalogo non entrano numeri in prosa.
 *
 * `text_hash = sha256(NFC(spazi collassati(testo confermato)))`.
 *
 * Modulo puro.
 */
import type { Json } from "../types.ts";
import type { AnswerKind, ResponseType } from "../vocab.ts";
import { issue, type Issue } from "./issues.ts";
import { sha256Hex } from "./sha256.ts";
import { cleanText, collapseSpaces, foldKey, isPlainObject, nonEmptyString } from "./strings.ts";
import { outcome, type NormalizeContext, type Outcome, type ResponseConfig } from "./types.ts";

/**
 * Tipi per cui un valore senza `value_normalized` è comunque «tipizzato»
 * (guardia 10 del §3.3). Per tutti gli altri un valore in prosa non si valida.
 */
export const TEXTUAL_RESPONSE_TYPES = ["testo", "conferma_regola", "conferma_formula", "file", "tabella"] as const satisfies readonly ResponseType[];

export function isTextualType(type: ResponseType | null): boolean {
  return type !== null && (TEXTUAL_RESPONSE_TYPES as readonly string[]).includes(type);
}

/**
 * `AnswerMeta.typed`: vero se c'è `value_normalized` oppure il tipo è testuale.
 * Per `conferma_valore` si passa il tipo base.
 */
export function answerIsTyped(type: ResponseType | null, valueNormalized: Json | null | undefined): boolean {
  return isTextualType(type) || (valueNormalized !== null && valueNormalized !== undefined);
}

/** «Confermo» si può mostrare sul valore dichiarato? */
export function canConfirmDeclared(baseType: ResponseType | null, declared: { normalized: Json | null } | null | undefined): boolean {
  if (!declared) return false;
  return answerIsTyped(baseType, declared.normalized);
}

/** Impronta di un testo confermato. */
export function textHash(text: string): string {
  return sha256Hex(collapseSpaces(text));
}

/** JSON con le chiavi in ordine: la stessa struttura dà sempre la stessa stringa. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value ?? null);
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/** Impronta di un valore confermato: il testo se è un testo, altrimenti il JSON stabile. */
export function valueHash(value: Json | null): string {
  if (typeof value === "string") return textHash(value);
  if (isPlainObject(value) && typeof value.text === "string" && Object.keys(value).length === 1) return textHash(value.text);
  return sha256Hex(stableStringify(value));
}

export type RuleChoice = "confermo" | "correggo" | "non_vale" | "non_so";
const RULE_CHOICES: readonly RuleChoice[] = ["confermo", "correggo", "non_vale", "non_so"];

/** Legge la scelta da un codice o da un'etichetta («Non lo so» → `non_so`). */
export function readChoice<T extends string>(input: unknown, allowed: readonly T[]): T | null {
  if (typeof input !== "string") return null;
  const key = foldKey(input);
  const alias: Record<string, string> = { non_lo_so: "non_so", confermato: "confermo", corretto: "correggo", correzione: "correggo" };
  const k = alias[key] ?? key;
  return (allowed as readonly string[]).includes(k) ? (k as T) : null;
}

function proposed(ctx: Pick<NormalizeContext, "proposedText">, config: ResponseConfig): string | null {
  return nonEmptyString(ctx.proposedText ?? null) ?? nonEmptyString(config.proposed_text);
}

const MISSING_PROPOSED = "Manca il testo da confermare: segnalalo a Lateral Space.";

/** Tipo `conferma_regola`. */
export function normalizeConfermaRegola(raw: unknown, config: ResponseConfig, ctx: Pick<NormalizeContext, "proposedText">): Outcome {
  const choice = readChoice(isPlainObject(raw) ? raw.choice : raw, RULE_CHOICES);
  if (choice === null) {
    return outcome({ value: null, errors: [issue("scelta_mancante", "Scegli Confermo, Correggo, Non vale o Non lo so.", "choice")] });
  }
  const text = isPlainObject(raw) ? nonEmptyString(raw.text) : null;
  const exceptions = isPlainObject(raw) ? nonEmptyString(raw.exceptions) : null;
  const errors: Issue[] = [];
  const value: Record<string, Json> = { choice };
  let hash: string | null = null;
  if (choice === "correggo") {
    if (text === null) errors.push(issue("correzione_mancante", "Scrivi come va corretta la regola.", "text"));
    else {
      value.text = text;
      hash = textHash(text);
    }
  } else if (choice === "confermo") {
    const p = proposed(ctx, config);
    if (p === null) errors.push(issue("testo_proposto_mancante", MISSING_PROPOSED, "choice"));
    else hash = textHash(p);
  }
  if (choice === "confermo" || choice === "correggo") {
    if (exceptions !== null) value.exceptions = exceptions;
    else if (config.ask_exceptions === true) {
      errors.push(issue("eccezioni_mancanti", "Indica le eccezioni alla regola, oppure scrivi «nessuna».", "exceptions"));
    }
  }
  return outcome({ value, normalized: errors.length === 0 ? { ...value } : null, errors, textHash: hash });
}

export type FormulaChoice = "confermo" | "correggo";
const FORMULA_CHOICES: readonly FormulaChoice[] = ["confermo", "correggo"];

/** Tipo `conferma_formula`. Il ricalcolo dell'esempio richiede `config.variables` (assente nel template del primo caso). */
export function normalizeConfermaFormula(raw: unknown, config: ResponseConfig, ctx: Pick<NormalizeContext, "proposedText">): Outcome {
  const choice = readChoice(isPlainObject(raw) ? raw.choice : raw, FORMULA_CHOICES);
  if (choice === null) return outcome({ value: null, errors: [issue("scelta_mancante", "Scegli Confermo o Correggo.", "choice")] });
  const formula = isPlainObject(raw) ? nonEmptyString(raw.formula) : null;
  const value: Record<string, Json> = { choice };
  const errors: Issue[] = [];
  let hash: string | null = null;
  if (choice === "correggo") {
    if (formula === null) errors.push(issue("correzione_mancante", "Scrivi la formula corretta.", "formula"));
    else {
      value.formula = formula;
      hash = textHash(formula);
    }
  } else {
    const p = proposed(ctx, config);
    if (p === null) errors.push(issue("testo_proposto_mancante", MISSING_PROPOSED, "choice"));
    else hash = textHash(p);
  }
  return outcome({ value, normalized: errors.length === 0 ? { ...value } : null, errors, textHash: hash });
}

export type ValueChoice = "confermo" | "correggo" | "non_so";
const VALUE_CHOICES: readonly ValueChoice[] = ["confermo", "correggo", "non_so"];

export type NormalizeBase = (type: ResponseType, raw: unknown, config: ResponseConfig, ctx: NormalizeContext) => Outcome;

/**
 * Configurazione dello strato `conferma_valore` sopra il tipo della voce: si
 * normalizza con `normalizeAnswer("conferma_valore", raw, confirmValueConfig(tipo, config), ctx)`
 * e `ctx.declared` = il valore dichiarato.
 */
export function confirmValueConfig(baseType: ResponseType, baseConfig: ResponseConfig | null | undefined): ResponseConfig {
  return { base_type: baseType, base_config: isPlainObject(baseConfig) ? (baseConfig as ResponseConfig) : {} };
}

/** Tipo base e configurazione di uno strato `conferma_valore`. */
export function confirmationBase(config: ResponseConfig): { type: ResponseType | null; config: ResponseConfig } {
  const type = typeof config.base_type === "string" && config.base_type !== "conferma_valore" ? config.base_type : null;
  return { type, config: isPlainObject(config.base_config) ? (config.base_config as ResponseConfig) : config };
}

/**
 * Tipo `conferma_valore`. `normalizeBase` è il normalizzatore generale (passato
 * da `normalize.ts` per evitare un import circolare).
 */
export function normalizeConfermaValore(raw: unknown, config: ResponseConfig, ctx: NormalizeContext, normalizeBase: NormalizeBase): Outcome {
  const choice = readChoice(isPlainObject(raw) ? raw.choice : raw, VALUE_CHOICES);
  if (choice === null) return outcome({ value: null, errors: [issue("scelta_mancante", "Scegli Confermo, Correggo o Non lo so.", "choice")] });
  if (choice === "non_so") return outcome({ value: { choice }, normalized: null });

  const base = confirmationBase(config);
  if (base.type === null) {
    return outcome({ value: null, errors: [issue("tipo_base_mancante", "Manca il tipo del valore da confermare: segnalalo a Lateral Space.", "choice")] });
  }
  const hasValue = isPlainObject(raw) && raw.value !== undefined && raw.value !== null && !(typeof raw.value === "string" && cleanText(raw.value) === "");

  if (choice === "confermo" && !hasValue) {
    const declared = ctx.declared ?? null;
    if (!declared || declared.value === null) {
      return outcome({ value: null, errors: [issue("valore_dichiarato_mancante", "Non c'è un valore da confermare: scrivi la risposta.", "value")] });
    }
    if (!canConfirmDeclared(base.type, declared)) {
      return outcome({
        value: { choice },
        errors: [issue("valore_non_tipizzato", "Il valore che ci avete detto è scritto a parole: inseriscilo nel formato richiesto e invia.", "value")],
      });
    }
    // Valore tipizzato (o tipo testuale): si conferma così com'è.
    return outcome({
      value: { choice, value: declared.value },
      normalized: declared.normalized,
      textHash: valueHash(declared.normalized ?? declared.value),
    });
  }

  if (!hasValue) {
    return outcome({ value: { choice }, errors: [issue("correzione_mancante", "Scrivi il valore corretto.", "value")] });
  }
  const inner = normalizeBase(base.type, (raw as Record<string, unknown>).value, base.config, ctx);
  const errors = inner.errors.map((e) => ({ ...e, field: e.field ? `value.${e.field}` : "value" }));
  const warnings = inner.warnings.map((e) => ({ ...e, field: e.field ? `value.${e.field}` : "value" }));
  const confirmed = inner.normalized ?? inner.value;
  return outcome({
    value: { choice, value: inner.value },
    normalized: errors.length === 0 ? inner.normalized : null,
    errors,
    warnings,
    partial: inner.partial,
    validFrom: inner.validFrom ?? null,
    textHash: errors.length === 0 && confirmed !== null ? (inner.textHash ?? valueHash(confirmed)) : null,
  });
}

/**
 * Tipo di risposta (`uc_answers.kind`) suggerito dalla scelta. «Non vale» su una
 * regola è una correzione (la regola proposta non è giusta).
 */
export function answerKindForChoice(type: ResponseType | null, value: Json | null): AnswerKind {
  if ((type === "conferma_regola" || type === "conferma_formula" || type === "conferma_valore") && isPlainObject(value)) {
    switch (value.choice) {
      case "confermo":
        return "conferma";
      case "correggo":
      case "non_vale":
        return "correzione";
      case "non_so":
        return "non_so";
    }
  }
  return "valore";
}
