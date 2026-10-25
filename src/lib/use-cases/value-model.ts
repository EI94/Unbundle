/**
 * Modello dei benefici di uno use case (`use_cases.value_model`, drizzle/0022) e ipotesi di
 * calcolo del workspace (`workspace_scoring_models.config.valueParams`).
 *
 * - **Uno schema solo** (`valueModelSchema`), usato dalla pagina e dal MCP del team: 8 tipi
 *   di ritorno (le leve `LEVERS` dei dossier), da 1 a 6 voci a ore, in euro o qualitative,
 *   costi, facilità, gruppo, chi conferma e, facoltativo, il piano dei mesi. Oggetti stretti:
 *   una chiave fuori elenco, o un campo di un altro tipo di voce, è un errore.
 * - **`primary`** è il tipo di almeno una voce; le chiavi delle voci sono uniche.
 * - **Ipotesi del workspace** (`resolveValueParams`): ogni valore mancante o non valido vale
 *   il suo predefinito; `originMonth` mancante è il mese corrente a Roma. Le scritture (solo
 *   i manager, Impostazioni › Valutazione) passano da `valueParamsSchema`.
 * - Valore e costo si calcolano in lettura (`value-calc.ts`) e non si salvano.
 *
 * Modulo puro: import relativi `.ts` e `zod`; gira con `node --test`.
 */
import { z } from "zod";
import { LEVERS, type Lever } from "../uc/vocab.ts";
import { VALUE_EUR_YEAR_MAX } from "./amount-limits.ts";
import { romeToday } from "./quarter.ts";

// ─── Vocabolari ──────────────────────────────────────────────────────

export const VALUE_MODEL_VERSION = 1;
/** Da 1 a 6 voci per scheda. */
export const VALUE_COMPONENTS_MAX = 6;

/** Come si misura una voce: ore risparmiate, euro all'anno, oppure a parole. */
export const VALUE_COMPONENT_KINDS = ["ore", "euro", "qualitativo"] as const;
export type ValueComponentKind = (typeof VALUE_COMPONENT_KINDS)[number];

/** Quanto è solida una voce. `da_misurare` non entra nel beneficio (salvo `includeUnmeasured`). */
export const VALUE_CONFIDENCES = ["fonte", "ipotesi", "da_misurare", "misurato"] as const;
export type ValueConfidence = (typeof VALUE_CONFIDENCES)[number];

/** Le etichette degli 8 tipi di ritorno; le icone sono quelle di `LEVER_META`. */
export const LEVER_LABELS: Readonly<Record<Lever, string>> = Object.freeze({
  tempo: "Risparmio di tempo",
  output: "Più output",
  qualita: "Più qualità",
  nuove_capacita: "Nuove capacità",
  decisioni: "Decisioni migliori",
  costi: "Meno costi",
  ricavi: "Più ricavi",
  rischio: "Meno rischio",
});

export const VALUE_COMPONENT_KIND_LABELS: Readonly<Record<ValueComponentKind, string>> = Object.freeze({
  ore: "Ore",
  euro: "Euro",
  qualitativo: "Qualitativo",
});

export const VALUE_CONFIDENCE_LABELS: Readonly<Record<ValueConfidence, string>> = Object.freeze({
  fonte: "Da una fonte",
  ipotesi: "Ipotesi",
  da_misurare: "Da misurare",
  misurato: "Misurato",
});

/** Mese `AAAA-MM`. */
export type MonthCode = `${number}-${number}`;
export const MONTH_PATTERN = /^([0-9]{4})-(0[1-9]|1[0-2])$/;

export function isMonthCode(value: unknown): value is MonthCode {
  return typeof value === "string" && MONTH_PATTERN.test(value);
}

/** «Più avanti» nel piano: nessun trimestre. */
export const PLAN_LATER = "piu_avanti";

// ─── Limiti ──────────────────────────────────────────────────────────

export const VALUE_MODEL_LIMITS = Object.freeze({
  key: 40,
  label: 120,
  whyPrimary: 500,
  unit: 40,
  indicator: 200,
  basis: 500,
  notCounted: 1000,
  easeWhy: 500,
  runCostNote: 200,
  group: 60,
  ref: 60,
  confirmBy: 120,
  volumeYearMax: 100_000_000,
  minutesPerUnitMax: 100_000,
  devDaysMax: 10_000,
  internalHoursMax: 1_000_000,
  runCostEurYearMax: 100_000_000,
});

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export const VALUE_MODEL_ERRORS = Object.freeze({
  primaryNotInComponents: "Il ritorno principale deve essere il tipo di almeno una voce.",
  duplicateKey: "Due voci hanno la stessa chiave.",
  goLiveBeforeStart: "L'entrata in uso non può venire prima dell'avvio.",
});

// ─── Schema di `value_model` ─────────────────────────────────────────

const text = (max: number) => z.string().trim().min(1).max(max);
const amount = (max: number) => z.number().min(0).max(max);

const componentBase = {
  key: text(VALUE_MODEL_LIMITS.key).regex(KEY_PATTERN).describe("Chiave della voce, unica nella scheda (es. tempo-1)."),
  lever: z.enum(LEVERS).describe("Tipo di ritorno: tempo, output, qualita, nuove_capacita, decisioni, costi, ricavi, rischio."),
  label: text(VALUE_MODEL_LIMITS.label).describe("Etichetta della voce, in parole semplici."),
  confidence: z
    .enum(VALUE_CONFIDENCES)
    .describe("fonte, ipotesi, da_misurare (non entra nel beneficio contato) o misurato."),
  indicator: text(VALUE_MODEL_LIMITS.indicator).optional().describe("Come si misura dopo l'avvio."),
  basis: text(VALUE_MODEL_LIMITS.basis).optional().describe("Da dove viene la stima."),
};

const hoursComponentSchema = z
  .object({
    ...componentBase,
    kind: z.literal("ore"),
    volumeYear: amount(VALUE_MODEL_LIMITS.volumeYearMax).describe("Quante volte all'anno."),
    unit: text(VALUE_MODEL_LIMITS.unit).optional().describe("Che cosa si conta (es. fatture)."),
    minutesPerUnit: amount(VALUE_MODEL_LIMITS.minutesPerUnitMax).describe("Minuti per ogni volta."),
    automatablePct: z.number().min(0).max(100).describe("Quota che si risparmia, da 0 a 100."),
  })
  .strict();

const euroComponentSchema = z
  .object({
    ...componentBase,
    kind: z.literal("euro"),
    eurYear: amount(VALUE_EUR_YEAR_MAX).describe("Euro all'anno."),
  })
  .strict();

const qualitativeComponentSchema = z.object({ ...componentBase, kind: z.literal("qualitativo") }).strict();

export const valueComponentSchema = z.discriminatedUnion("kind", [hoursComponentSchema, euroComponentSchema, qualitativeComponentSchema]);

export const valueCostsSchema = z
  .object({
    devDays: amount(VALUE_MODEL_LIMITS.devDaysMax).describe("Giorni di sviluppo."),
    internalHours: amount(VALUE_MODEL_LIMITS.internalHoursMax).describe("Ore delle persone del cliente."),
    runCostEurYear: amount(VALUE_MODEL_LIMITS.runCostEurYearMax).describe("Costi ricorrenti, euro all'anno."),
    runCostNote: text(VALUE_MODEL_LIMITS.runCostNote).optional().describe("Di che cosa sono fatti i costi ricorrenti."),
  })
  .strict();

const monthSchema = z.string().regex(MONTH_PATTERN);
/** Trimestre `AAAA-Qn`, come `target_quarter` (CHECK della 0020). */
const QUARTER_PATTERN = /^[0-9]{4}-Q[1-4]$/;

export const valuePlanSchema = z
  .object({
    quarter: z
      .union([z.string().regex(QUARTER_PATTERN), z.literal(PLAN_LATER)])
      .describe("Trimestre come 2027-Q1, oppure piu_avanti."),
    startMonth: monthSchema.describe("Mese di avvio, AAAA-MM."),
    goLiveMonth: monthSchema.describe("Mese di entrata in uso, AAAA-MM."),
  })
  .strict()
  .superRefine((plan, ctx) => {
    if (plan.goLiveMonth < plan.startMonth) {
      ctx.addIssue({ code: "custom", path: ["goLiveMonth"], message: VALUE_MODEL_ERRORS.goLiveBeforeStart });
    }
  });

export const valueModelSchema = z
  .object({
    v: z.literal(VALUE_MODEL_VERSION),
    primary: z.enum(LEVERS).describe("Ritorno principale: il tipo di almeno una voce."),
    whyPrimary: text(VALUE_MODEL_LIMITS.whyPrimary).optional().describe("Perché è il ritorno principale."),
    components: z.array(valueComponentSchema).min(1).max(VALUE_COMPONENTS_MAX).describe("Da 1 a 6 voci."),
    notCounted: text(VALUE_MODEL_LIMITS.notCounted).optional().describe("Che cosa resta fuori dal conto."),
    ease: z.number().int().min(1).max(5).optional().describe("Facilità da 1 (difficile) a 5 (facile)."),
    easeWhy: text(VALUE_MODEL_LIMITS.easeWhy).optional(),
    costs: valueCostsSchema.optional(),
    group: text(VALUE_MODEL_LIMITS.group).optional().describe("Gruppo, per il colore nella matrice."),
    ref: text(VALUE_MODEL_LIMITS.ref).optional().describe("Riferimento esterno."),
    confirmBy: text(VALUE_MODEL_LIMITS.confirmBy).optional().describe("Chi conferma i numeri."),
    plan: valuePlanSchema.optional(),
  })
  .strict()
  .superRefine((model, ctx) => {
    if (!model.components.some((component) => component.lever === model.primary)) {
      ctx.addIssue({ code: "custom", path: ["primary"], message: VALUE_MODEL_ERRORS.primaryNotInComponents });
    }
    const seen = new Set<string>();
    model.components.forEach((component, index) => {
      if (seen.has(component.key)) {
        ctx.addIssue({ code: "custom", path: ["components", index, "key"], message: VALUE_MODEL_ERRORS.duplicateKey });
      }
      seen.add(component.key);
    });
  });

export type ValueModel = z.output<typeof valueModelSchema>;
export type ValueComponent = z.output<typeof valueComponentSchema>;
export type ValueCosts = z.output<typeof valueCostsSchema>;
export type ValuePlan = z.output<typeof valuePlanSchema>;

/**
 * Il modello salvato, se è valido; altrimenti `null` (la scheda si legge come senza modello).
 * Per le letture del `jsonb`: le scritture passano da `valueModelSchema` e dai suoi errori.
 */
export function parseValueModel(raw: unknown): ValueModel | null {
  if (raw === null || raw === undefined) return null;
  const parsed = valueModelSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ─── Ipotesi di calcolo del workspace ────────────────────────────────

export interface ValueParams {
  /** Costo di un'ora di lavoro, in euro. */
  hourlyCostEur: number;
  /** Costo di una giornata di sviluppo, in euro. */
  dayCostEur: number;
  /** Mesi per arrivare al beneficio pieno dopo l'entrata in uso. */
  rampMonths: number;
  /** Mesi della J-curve. */
  horizonMonths: number;
  /** Mesi tra avvio ed entrata in uso, quando la scheda non ha un piano. */
  buildMonths: number;
  /** Mese 0 della J-curve. */
  originMonth: MonthCode;
  /** Vero: anche le voci da misurare entrano nel beneficio. */
  includeUnmeasured: boolean;
  /** Beneficio all'anno che vale «Alto». */
  highValueEur: number;
  /** Beneficio all'anno che vale «Medio». */
  midValueEur: number;
}

/** Le ipotesi predefinite, tranne `originMonth` (il mese corrente). */
export const DEFAULT_VALUE_PARAMS: Readonly<Omit<ValueParams, "originMonth">> = Object.freeze({
  hourlyCostEur: 35,
  dayCostEur: 0,
  rampMonths: 3,
  horizonMonths: 24,
  buildMonths: 2,
  includeUnmeasured: false,
  highValueEur: 50_000,
  midValueEur: 15_000,
});

export const VALUE_PARAMS_LIMITS = Object.freeze({
  hourlyCostEurMax: 10_000,
  dayCostEurMax: 100_000,
  rampMonthsMax: 36,
  horizonMonthsMin: 1,
  horizonMonthsMax: 120,
  buildMonthsMax: 36,
  valueEurMax: VALUE_EUR_YEAR_MAX,
});

export const VALUE_PARAMS_ERRORS = Object.freeze({
  midNotBelowHigh: "La soglia «Medio» deve essere più bassa della soglia «Alto».",
});

const paramFields = {
  hourlyCostEur: amount(VALUE_PARAMS_LIMITS.hourlyCostEurMax),
  dayCostEur: amount(VALUE_PARAMS_LIMITS.dayCostEurMax),
  rampMonths: z.number().int().min(0).max(VALUE_PARAMS_LIMITS.rampMonthsMax),
  horizonMonths: z.number().int().min(VALUE_PARAMS_LIMITS.horizonMonthsMin).max(VALUE_PARAMS_LIMITS.horizonMonthsMax),
  buildMonths: z.number().int().min(0).max(VALUE_PARAMS_LIMITS.buildMonthsMax),
  originMonth: monthSchema,
  includeUnmeasured: z.boolean(),
  highValueEur: z.number().gt(0).max(VALUE_PARAMS_LIMITS.valueEurMax),
  midValueEur: z.number().gt(0).max(VALUE_PARAMS_LIMITS.valueEurMax),
} as const;

/**
 * Le ipotesi da salvare in `config.valueParams`: ogni chiave è facoltativa (manca = vale il
 * predefinito), nessuna chiave fuori elenco, «Medio» sotto «Alto» quando ci sono tutte e due.
 */
export const valueParamsSchema = z
  .object({
    hourlyCostEur: paramFields.hourlyCostEur.optional(),
    dayCostEur: paramFields.dayCostEur.optional(),
    rampMonths: paramFields.rampMonths.optional(),
    horizonMonths: paramFields.horizonMonths.optional(),
    buildMonths: paramFields.buildMonths.optional(),
    originMonth: paramFields.originMonth.optional(),
    includeUnmeasured: paramFields.includeUnmeasured.optional(),
    highValueEur: paramFields.highValueEur.optional(),
    midValueEur: paramFields.midValueEur.optional(),
  })
  .strict()
  .superRefine((params, ctx) => {
    const high = params.highValueEur ?? DEFAULT_VALUE_PARAMS.highValueEur;
    const mid = params.midValueEur ?? DEFAULT_VALUE_PARAMS.midValueEur;
    if (mid >= high) ctx.addIssue({ code: "custom", path: ["midValueEur"], message: VALUE_PARAMS_ERRORS.midNotBelowHigh });
  });

export type StoredValueParams = z.output<typeof valueParamsSchema>;

/** Il mese corrente a Roma, `AAAA-MM`. */
export function currentMonth(now: Date = new Date()): MonthCode {
  return romeToday(now).slice(0, 7) as MonthCode;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Il workspace non ha salvato un primo mese della curva valido (`config.valueParams.originMonth`):
 * `resolveValueParams` usa il mese corrente, che cambia ogni mese. Il riquadro «Ipotesi di
 * calcolo» lo dice («il mese corrente (nov 2026)»).
 */
export function originFollowsCurrentMonth(config: unknown): boolean {
  const raw = isRecord(config) && isRecord(config.valueParams) ? config.valueParams : {};
  return !paramFields.originMonth.safeParse(raw.originMonth).success;
}

/**
 * Le ipotesi del workspace, dalla `config` di `workspace_scoring_models` (la riga intera:
 * si legge `config.valueParams`). Ogni chiave mancante o non valida vale il predefinito;
 * `originMonth` mancante è il mese corrente a Roma; con «Medio» non sotto «Alto» valgono
 * le due soglie predefinite.
 */
export function resolveValueParams(config: unknown, now: Date = new Date()): ValueParams {
  const raw = isRecord(config) && isRecord(config.valueParams) ? config.valueParams : {};
  const pick = <K extends keyof typeof paramFields>(key: K, fallback: ValueParams[K]): ValueParams[K] => {
    const parsed = paramFields[key].safeParse(raw[key]);
    return parsed.success ? (parsed.data as ValueParams[K]) : fallback;
  };
  const params: ValueParams = {
    hourlyCostEur: pick("hourlyCostEur", DEFAULT_VALUE_PARAMS.hourlyCostEur),
    dayCostEur: pick("dayCostEur", DEFAULT_VALUE_PARAMS.dayCostEur),
    rampMonths: pick("rampMonths", DEFAULT_VALUE_PARAMS.rampMonths),
    horizonMonths: pick("horizonMonths", DEFAULT_VALUE_PARAMS.horizonMonths),
    buildMonths: pick("buildMonths", DEFAULT_VALUE_PARAMS.buildMonths),
    originMonth: pick("originMonth", currentMonth(now)),
    includeUnmeasured: pick("includeUnmeasured", DEFAULT_VALUE_PARAMS.includeUnmeasured),
    highValueEur: pick("highValueEur", DEFAULT_VALUE_PARAMS.highValueEur),
    midValueEur: pick("midValueEur", DEFAULT_VALUE_PARAMS.midValueEur),
  };
  if (params.midValueEur >= params.highValueEur) {
    params.midValueEur = DEFAULT_VALUE_PARAMS.midValueEur;
    params.highValueEur = DEFAULT_VALUE_PARAMS.highValueEur;
  }
  return params;
}
