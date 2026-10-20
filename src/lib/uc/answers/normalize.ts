/**
 * Normalizzazione delle risposte per tipo (PIANO §3.9).
 *
 * `normalizeAnswer(type, raw, config, ctx)` legge quello che il referente (o
 * Lateral Space) ha scritto e restituisce il valore canonico e, dove ha senso,
 * il valore normalizzato (unità base, euro, minuti, UTC…).
 *
 * - `strict = true` (invio): ogni errore rifiuta la risposta (`ok: false`).
 * - `strict = false` (bozza): la risposta si salva comunque; gli errori tornano
 *   in `errors` (e il normalizzato resta null), così l'interfaccia li mostra
 *   prima dell'invio. Un testo libero si prova a leggere (precompilazione dei
 *   valori dichiarati in call).
 *
 * La scansione dei testi è a parte (`text/scan.ts`, e `prepare.ts` per farle
 * entrambe). Modulo puro: gira uguale sul server e nel browser.
 */
import type { Json } from "../types.ts";
import { RESPONSE_TYPES, isVocab, type ResponseType } from "../vocab.ts";
import { normalizeSceltaMultipla, normalizeScelta, normalizeSiNo } from "./choice.ts";
import { normalizeConfermaFormula, normalizeConfermaRegola, normalizeConfermaValore } from "./confirm.ts";
import { normalizeValuta } from "./currency.ts";
import { DEFAULT_TZ, normalizeData, normalizeDataOra, romeToday } from "./datetime.ts";
import { normalizeDurata } from "./duration.ts";
import { normalizeIntervallo } from "./interval.ts";
import { issue, type Issue } from "./issues.ts";
import { normalizePercentuale } from "./percent.ts";
import {
  normalizeCasoProva,
  normalizeCodice,
  normalizeCollegamentoSistema,
  normalizeDataset,
  normalizeFile,
  normalizeTesto,
} from "./simple.ts";
import { isPlainObject } from "./strings.ts";
import { normalizeTabella } from "./table-paste.ts";
import { type NormalizeContext, type Outcome, type ResponseConfig } from "./types.ts";
import { normalizeNumero } from "./units.ts";

export type { Issue } from "./issues.ts";
export type { NormalizeContext, ResponseConfig } from "./types.ts";

export type NormalizeResult =
  | {
      ok: true;
      value: Json;
      normalized: Json | null;
      warnings: Issue[];
      /** Solo in bozza: errori che bloccheranno l'invio. */
      errors: Issue[];
      /** Risposta parziale (tabella con meno righe del minimo). */
      partial?: boolean;
      /** `valid_from` letto dal payload, per la colonna della risposta. */
      validFrom?: string | null;
      /** Impronta del testo o del valore confermato. */
      textHash?: string | null;
    }
  | { ok: false; errors: Issue[]; warnings: Issue[] };

/** Contesto di normalizzazione per un istante: oggi a Roma, fuso Europe/Rome. */
export function answerContext(now: Date, strict: boolean, extra: Partial<Omit<NormalizeContext, "today" | "tz" | "strict">> = {}): NormalizeContext {
  return { ...extra, today: romeToday(now, DEFAULT_TZ), tz: DEFAULT_TZ, strict };
}

/** Limite al payload di una risposta (JSON), oltre alle soglie di ogni tipo. */
export const MAX_ANSWER_JSON_LENGTH = 400_000;

/** Normalizzatore di un tipo, senza la decisione strict/bozza. */
export function normalizeOutcome(type: ResponseType, raw: unknown, config: ResponseConfig, ctx: NormalizeContext): Outcome {
  switch (type) {
    case "numero":
      return normalizeNumero(raw, config, ctx);
    case "valuta":
      return normalizeValuta(raw, config, ctx);
    case "percentuale":
      return normalizePercentuale(raw, config, ctx);
    case "durata":
      return normalizeDurata(raw, config, ctx);
    case "data":
      return normalizeData(raw, config, ctx);
    case "data_ora":
      return normalizeDataOra(raw, config, ctx);
    case "intervallo":
      return normalizeIntervallo(raw, config, ctx);
    case "si_no":
      return normalizeSiNo(raw);
    case "scelta":
      return normalizeScelta(raw, config);
    case "scelta_multipla":
      return normalizeSceltaMultipla(raw, config);
    case "testo":
      return normalizeTesto(raw, config);
    case "codice":
      return normalizeCodice(raw, config);
    case "file":
      return normalizeFile(raw, config, ctx);
    case "dataset":
      return normalizeDataset(raw, ctx);
    case "conferma_regola":
      return normalizeConfermaRegola(raw, config, ctx);
    case "conferma_formula":
      return normalizeConfermaFormula(raw, config, ctx);
    case "conferma_valore":
      return normalizeConfermaValore(raw, config, ctx, normalizeOutcome);
    case "collegamento_sistema":
      return normalizeCollegamentoSistema(raw, config);
    case "caso_prova":
      return normalizeCasoProva(raw);
    case "tabella":
      return normalizeTabella(raw, config);
  }
}

/** Copia JSON sicura di un input qualsiasi (bozze illeggibili), senza funzioni né cicli. */
export function toJsonValue(input: unknown, depth = 0): Json {
  if (input === null || input === undefined) return null;
  if (typeof input === "string" || typeof input === "boolean") return input;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (depth > 8) return null;
  if (Array.isArray(input)) return input.slice(0, 5000).map((v) => toJsonValue(v, depth + 1));
  if (isPlainObject(input)) {
    const out: Record<string, Json> = {};
    for (const [k, v] of Object.entries(input).slice(0, 200)) {
      if (v !== undefined && typeof v !== "function") out[k] = toJsonValue(v, depth + 1);
    }
    return out;
  }
  return null;
}

function jsonLength(input: unknown): number {
  try {
    return JSON.stringify(input ?? null)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Normalizza una risposta del tipo indicato (vedi l'intestazione del modulo). */
export function normalizeAnswer(type: ResponseType, raw: unknown, config: ResponseConfig | null | undefined, ctx: NormalizeContext): NormalizeResult {
  if (!isVocab(RESPONSE_TYPES, type)) {
    return { ok: false, errors: [issue("tipo_non_supportato", "Tipo di risposta sconosciuto.")], warnings: [] };
  }
  if (jsonLength(raw) > MAX_ANSWER_JSON_LENGTH) {
    return { ok: false, errors: [issue("risposta_troppo_lunga", "La risposta è troppo lunga. Allega un file.")], warnings: [] };
  }
  const o = normalizeOutcome(type, raw, isPlainObject(config) ? config : {}, ctx);
  const extra = {
    ...(o.partial !== undefined ? { partial: o.partial } : {}),
    ...(o.validFrom !== undefined ? { validFrom: o.validFrom } : {}),
    ...(o.textHash !== undefined ? { textHash: o.textHash } : {}),
  };
  if (ctx.strict) {
    if (o.errors.length > 0 || o.value === null) {
      return { ok: false, errors: o.errors.length > 0 ? o.errors : [issue("risposta_mancante", "Scrivi la risposta.")], warnings: o.warnings };
    }
    return { ok: true, value: o.value, normalized: o.normalized, warnings: o.warnings, errors: [], ...extra };
  }
  const value = o.value ?? toJsonValue(raw);
  return {
    ok: true,
    value,
    normalized: o.errors.length > 0 ? null : o.normalized,
    warnings: o.warnings,
    errors: o.errors,
    ...extra,
  };
}

/**
 * Precompila l'input tipizzato da un valore dichiarato in prosa (§3.9,
 * `conferma_valore`, «Controlla e invia»): lettura non stretta. Restituisce il
 * valore letto e quello che manca ancora (per esempio l'IVA), oppure null se nel
 * testo non c'è niente di leggibile. Il referente controlla e invia.
 */
export function prefillFromDeclared(
  baseType: ResponseType,
  declaredText: string,
  config: ResponseConfig | null | undefined,
  ctx: Omit<NormalizeContext, "strict">,
): { value: Json; missing: Issue[]; warnings: Issue[] } | null {
  if (!isVocab(RESPONSE_TYPES, baseType) || typeof declaredText !== "string" || declaredText.trim() === "") return null;
  const o = normalizeOutcome(baseType, declaredText, isPlainObject(config) ? config : {}, { ...ctx, strict: false });
  if (o.value === null) return null;
  return { value: o.value, missing: o.errors, warnings: o.warnings };
}
