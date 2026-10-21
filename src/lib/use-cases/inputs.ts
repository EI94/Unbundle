/**
 * Validazione dei campi dell'area «Use case» (docs/use-case/DESIGN.md §5.2, §5.4, §6.2, §6.4,
 * §9.1 passo 3). Lo usano il servizio per ogni canale e, per comporre i loro schemi, le
 * action e il MCP del team.
 *
 * - Testi: si tolgono gli spazi in testa e in coda; un testo vuoto vuol dire «nessun
 *   valore» (`null`), tranne il titolo, che non si svuota.
 * - Costo (D5): un importo in euro una tantum oppure una fascia, mai entrambi. L'importo è
 *   un intero da 0 a 100.000.000; si accettano i punti delle migliaia («40.000»).
 * - La Storia registra solo i nomi dei campi (`EventField`), mai i valori.
 *
 * Modulo puro: import relativi `.ts` e `zod`, nessun `@/`, nessun `server-only`.
 */
import { z } from "zod";
import { USE_CASE_CODE_PATTERN } from "../portfolio/use-case-code.ts";
import { isCostBand } from "./cost-bands.ts";
import type { EventField } from "./labels.ts";
import { KINDS, ORIGINS, type CostBand, type CostInput } from "./types.ts";
import type { Dimension } from "./valuation.ts";

// ─── Limiti (§5.2, §5.4, §6.2, §6.4, CHECK della 0019 e della 0020) ──

/** Lunghezza massima dei testi, in caratteri (§6.2; nota pubblica §6.4). */
export const TEXT_LIMITS = {
  title: 200,
  description: 4000,
  flowDescription: 4000,
  humanInTheLoop: 2000,
  guardrails: 2000,
  businessCase: 2000,
  dataRequirements: 2000,
  sustainabilityImpact: 2000,
  /** Testo libero, quando il workspace non ha l'elenco delle aree della guida del connettore. */
  area: 80,
  aiLab: 120,
  publicNote: 1000,
} as const;

/** Il titolo ha almeno 3 caratteri (pannello rapido §5.2, MCP del team §9.4). */
export const TITLE_MIN_LENGTH = 3;

/** Pannello rapido (§5.2): titolo 3-200, «Problema in una riga» 3-300, AI Lab fino a 120. */
export const QUICK_CREATE_LIMITS = {
  title: { min: 3, max: 200 },
  problem: { min: 3, max: 300 },
  aiLab: { max: 120 },
} as const;

/** `cost_eur_once`: intero da 0 a 100.000.000 (§5.4, CHECK della 0020). */
export const COST_EUR_ONCE_MAX = 100_000_000;
/** `value_eur_year`: intero da 0 a 1.000.000.000 (CHECK della 0020). */
export const VALUE_EUR_YEAR_MAX = 1_000_000_000;

/** Errore del campo costo, testo esatto di §5.4. */
export const COST_AMOUNT_ERROR = "Scrivi un importo in euro, senza decimali (es. 40000).";
export const VALUE_AMOUNT_ERROR = "Scrivi un valore in euro all'anno, senza decimali (es. 60000).";
export const COST_BOTH_ERROR = "Indica un importo oppure una fascia, non tutti e due.";
export const COST_BAND_ERROR = "Scegli una fascia da 1 a 5.";
export const KPI_SCORE_ERROR = "Il punteggio deve essere tra 1 e 5.";
export const KPI_UNKNOWN_ERROR = "Questo KPI non è nel modello del workspace.";
export const PUBLIC_NOTE_REQUIRED_ERROR = "Scrivi la nota pubblica.";
export const CODE_ERROR = "Scrivi un codice come XX-0012.";
export const UNKNOWN_FIELD_ERROR = "Campo non previsto.";
export const NO_CHANGES_ERROR = "Nessuna modifica da salvare.";

/** «1.000», «4.000»: le migliaia col punto, anche sotto 10.000 (it-IT da solo non le raggruppa). */
function groupThousands(n: number): string {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

export function tooLongMessage(max: number): string {
  return `Massimo ${groupThousands(max)} caratteri.`;
}

// ─── Importi in euro ─────────────────────────────────────────────────

const PLAIN_DIGITS = /^[0-9]+$/;
const THOUSANDS_DOTS = /^[0-9]{1,3}(\.[0-9]{3})+$/;

/**
 * Un importo in euro intero da 0 a `max`. Testo: cifre, con i punti delle migliaia
 * («40.000»), spazi in testa e in coda tolti; vuoto o `null` vuol dire nessun importo.
 * Niente decimali («40,5», «40.5»), segni, esponenti o testo.
 */
export function parseEuroAmount(raw: unknown, max: number): { ok: true; value: number | null } | { ok: false } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  let value: number;
  if (typeof raw === "number") {
    value = raw;
  } else if (typeof raw === "string") {
    const text = raw.trim();
    if (text === "") return { ok: true, value: null };
    if (!PLAIN_DIGITS.test(text) && !THOUSANDS_DOTS.test(text)) return { ok: false };
    value = Number(text.replaceAll(".", ""));
  } else {
    return { ok: false };
  }
  return Number.isSafeInteger(value) && value >= 0 && value <= max ? { ok: true, value } : { ok: false };
}

function euroSchema(max: number, message: string) {
  return z.unknown().transform((raw, ctx) => {
    const parsed = parseEuroAmount(raw, max);
    if (!parsed.ok) {
      ctx.addIssue({ code: "custom", message });
      return z.NEVER;
    }
    return parsed.value;
  });
}

// ─── Costo (§5.4) ────────────────────────────────────────────────────

/**
 * Il costo del team dal campo di §5.4 (o dal MCP del team): `{ eurOnce }` oppure `{ band }`,
 * mai entrambi; `null` toglie il costo. Un importo vuoto senza fascia è «nessun costo».
 * La fascia arriva anche come testo («3», dal `RadioGroup`).
 */
export function parseCostInput(raw: unknown): { ok: true; value: CostInput } | { ok: false; message: string } {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, message: COST_AMOUNT_ERROR };
  const data = raw as Record<string, unknown>;
  if (Object.keys(data).some((key) => key !== "eurOnce" && key !== "band")) return { ok: false, message: UNKNOWN_FIELD_ERROR };
  const hasAmount = data.eurOnce !== undefined && data.eurOnce !== null && data.eurOnce !== "";
  const hasBand = data.band !== undefined && data.band !== null && data.band !== "";
  if (hasAmount && hasBand) return { ok: false, message: COST_BOTH_ERROR };
  if (hasBand) {
    const band = typeof data.band === "string" && /^[1-5]$/.test(data.band.trim()) ? Number(data.band.trim()) : data.band;
    return isCostBand(band) ? { ok: true, value: { band } } : { ok: false, message: COST_BAND_ERROR };
  }
  const amount = parseEuroAmount(data.eurOnce, COST_EUR_ONCE_MAX);
  if (!amount.ok) return { ok: false, message: COST_AMOUNT_ERROR };
  return { ok: true, value: amount.value === null ? null : { eurOnce: amount.value } };
}

const costSchema = z.unknown().transform((raw, ctx) => {
  const parsed = parseCostInput(raw);
  if (!parsed.ok) {
    ctx.addIssue({ code: "custom", message: parsed.message });
    return z.NEVER;
  }
  return parsed.value;
});

/** Le colonne da scrivere: salvare un importo azzera `cost_band`, salvare una fascia azzera `cost_eur_once`. */
export function costColumns(cost: CostInput): { costEurOnce: number | null; costBand: CostBand | null } {
  if (cost === null) return { costEurOnce: null, costBand: null };
  if (cost.eurOnce !== undefined) return { costEurOnce: cost.eurOnce, costBand: null };
  return { costEurOnce: null, costBand: cost.band };
}

// ─── Testi (§6.2) ────────────────────────────────────────────────────

/** Testo facoltativo: spazi tolti, vuoto = `null`, al massimo `max` caratteri. */
export function optionalTextSchema(max: number) {
  return z
    .string({ message: "Scrivi un testo." })
    .trim()
    .max(max, { message: tooLongMessage(max) })
    .nullable()
    .transform((value) => (value ? value : null));
}

export const titleSchema = z
  .string({ message: "Scrivi il titolo." })
  .trim()
  .min(TITLE_MIN_LENGTH, { message: `Il titolo deve avere almeno ${TITLE_MIN_LENGTH} caratteri.` })
  .max(TEXT_LIMITS.title, { message: tooLongMessage(TEXT_LIMITS.title) });

/** Codice di un altro use case (es. «Possibile doppione di»): maiuscole, formato XX-0012. */
export function normalizeUseCaseCode(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const code = raw.trim().toUpperCase();
  return USE_CASE_CODE_PATTERN.test(code) ? code : null;
}

const codeSchema = z
  .string({ message: CODE_ERROR })
  .nullable()
  .transform((raw, ctx) => {
    if (raw === null || raw.trim() === "") return null;
    const code = normalizeUseCaseCode(raw);
    if (!code) {
      ctx.addIssue({ code: "custom", message: CODE_ERROR });
      return z.NEVER;
    }
    return code;
  });

/** Nota pubblica (§6.4): al massimo 1.000 caratteri; per «Serve info» e «Non avviare» obbligatoria. */
export function validatePublicNote(raw: unknown, opts: { required: boolean }): { ok: true; value: string | null } | { ok: false; message: string } {
  if (raw !== null && raw !== undefined && typeof raw !== "string") return { ok: false, message: PUBLIC_NOTE_REQUIRED_ERROR };
  const text = typeof raw === "string" ? raw.trim() : "";
  if (!text) return opts.required ? { ok: false, message: PUBLIC_NOTE_REQUIRED_ERROR } : { ok: true, value: null };
  if (text.length > TEXT_LIMITS.publicNote) return { ok: false, message: tooLongMessage(TEXT_LIMITS.publicNote) };
  return { ok: true, value: text };
}

// ─── Modifiche alla scheda (updateUseCase) ───────────────────────────

/** Ogni chiave facoltativa: assente = non cambia; `null` o vuoto = si svuota (tranne il titolo). */
export const useCaseChangesSchema = z
  .object({
    title: titleSchema.optional(),
    description: optionalTextSchema(TEXT_LIMITS.description).optional(),
    flowDescription: optionalTextSchema(TEXT_LIMITS.flowDescription).optional(),
    humanInTheLoop: optionalTextSchema(TEXT_LIMITS.humanInTheLoop).optional(),
    guardrails: optionalTextSchema(TEXT_LIMITS.guardrails).optional(),
    businessCase: optionalTextSchema(TEXT_LIMITS.businessCase).optional(),
    dataRequirements: optionalTextSchema(TEXT_LIMITS.dataRequirements).optional(),
    sustainabilityImpact: optionalTextSchema(TEXT_LIMITS.sustainabilityImpact).optional(),
    area: optionalTextSchema(TEXT_LIMITS.area).optional(),
    aiLab: optionalTextSchema(TEXT_LIMITS.aiLab).optional(),
    origin: z.enum(ORIGINS, { message: "Scegli AI Adoption o AI Transformation." }).optional(),
    kind: z.enum(KINDS, { message: "Scegli Da costruire o Da diffondere." }).optional(),
    publicNote: optionalTextSchema(TEXT_LIMITS.publicNote).optional(),
    possibleDuplicateOf: codeSchema.optional(),
  })
  .strict();

export type UseCaseChanges = z.output<typeof useCaseChangesSchema>;

/**
 * Il campo della Storia di ogni modifica. `sustainabilityImpact` («Impatto ambientale e
 * sociale», §6.2) non ha un nome nell'elenco chiuso del CHECK `use_case_events_fields_check`
 * (DESIGN §10.3): `null`, la riga non lo nomina. Una modifica del solo ESG dà quindi
 * `fields: []`, anche se `version` sale (il trigger della 0020 guarda `sustainability_impact`).
 * Punto aperto per §10.3 e la 0020 (H1a): un nome nell'elenco, poi qui e in `EVENT_FIELDS`.
 */
export const CHANGE_EVENT_FIELD: Readonly<Record<keyof UseCaseChanges, EventField | null>> = {
  title: "titolo",
  description: "problema",
  flowDescription: "come_funziona",
  humanInTheLoop: "chi_controlla",
  guardrails: "limiti",
  businessCase: "impatto_atteso",
  dataRequirements: "dati",
  sustainabilityImpact: null,
  area: "area",
  aiLab: "ai_lab",
  origin: "origine",
  kind: "tipo",
  publicNote: "nota_pubblica",
  possibleDuplicateOf: "possibile_doppione",
};

export type FieldErrors = Record<string, string>;

function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    if (issue.code === "unrecognized_keys") {
      for (const key of issue.keys) out[[...issue.path, key].join(".")] ??= UNKNOWN_FIELD_ERROR;
      continue;
    }
    out[issue.path.join(".") || "payload"] ??= issue.message;
  }
  return out;
}

/**
 * Le modifiche a «Cosa è», nota pubblica e «Possibile doppione di». Con `areaOptions`
 * (elenco della guida del connettore) l'area deve essere una di quelle.
 */
export function validateUseCaseChanges(
  input: unknown,
  opts: { areaOptions?: readonly string[] | null } = {},
): { ok: true; changes: UseCaseChanges; fields: EventField[] } | { ok: false; fieldErrors: FieldErrors } {
  const parsed = useCaseChangesSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const changes = parsed.data;
  const keys = (Object.keys(changes) as Array<keyof UseCaseChanges>).filter((key) => changes[key] !== undefined);
  if (keys.length === 0) return { ok: false, fieldErrors: { payload: NO_CHANGES_ERROR } };
  if (opts.areaOptions?.length && changes.area && !opts.areaOptions.includes(changes.area)) {
    return { ok: false, fieldErrors: { area: "Scegli un'area dell'elenco." } };
  }
  return { ok: true, changes, fields: uniqueFields(keys.map((key) => CHANGE_EVENT_FIELD[key])) };
}

function uniqueFields(fields: Array<EventField | null>): EventField[] {
  return [...new Set(fields.filter((f): f is EventField => f !== null))];
}

// ─── Valutazione (saveValuation, §6.3) ───────────────────────────────

const kpiScoreSchema = z.unknown().transform((raw, ctx) => {
  // «Nessun valore»: il KPI resta vuoto, che non vuol dire zero (§7.6).
  if (raw === null || raw === "") return null;
  const value = typeof raw === "string" && raw.trim() !== "" ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 1 || value > 5) {
    ctx.addIssue({ code: "custom", message: KPI_SCORE_ERROR });
    return z.NEVER;
  }
  return value;
});

const kpiMapSchema = z.record(z.string(), kpiScoreSchema);

export const valuationSchema = z
  .object({
    kpis: z
      .object({ impact: kpiMapSchema.optional(), feasibility: kpiMapSchema.optional(), esg: kpiMapSchema.optional() })
      .strict()
      .optional(),
    valueEurYear: euroSchema(VALUE_EUR_YEAR_MAX, VALUE_AMOUNT_ERROR).optional(),
    cost: costSchema.optional(),
  })
  .strict();

export type ValuationInput = z.output<typeof valuationSchema>;

/**
 * «Salva la valutazione» (e `update_use_case` del MCP del team): KPI da 1 a 5 o vuoti, valore
 * all'anno, costo. Con `kpiIds` ogni KPI deve stare nel modello del workspace, nella sua
 * dimensione (con ESG spento: `esg: []`).
 */
export function validateValuation(
  input: unknown,
  opts: { kpiIds?: Partial<Record<Dimension, readonly string[]>> } = {},
): { ok: true; valuation: ValuationInput; fields: EventField[] } | { ok: false; fieldErrors: FieldErrors } {
  const parsed = valuationSchema.safeParse(input);
  if (!parsed.success) return { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
  const valuation = parsed.data;
  const fieldErrors: FieldErrors = {};
  if (valuation.kpis && opts.kpiIds) {
    for (const [dimension, scores] of Object.entries(valuation.kpis) as Array<[Dimension, Record<string, number | null> | undefined]>) {
      const allowed = opts.kpiIds[dimension];
      if (!scores || !allowed) continue;
      for (const kpiId of Object.keys(scores)) {
        if (!allowed.includes(kpiId)) fieldErrors[`kpis.${dimension}.${kpiId}`] = KPI_UNKNOWN_ERROR;
      }
    }
  }
  if (Object.keys(fieldErrors).length) return { ok: false, fieldErrors };
  const fields: Array<EventField | null> = [
    valuation.kpis !== undefined ? "kpi" : null,
    valuation.valueEurYear !== undefined ? "valore" : null,
    valuation.cost !== undefined ? "costo" : null,
  ];
  if (!fields.some(Boolean)) return { ok: false, fieldErrors: { payload: NO_CHANGES_ERROR } };
  return { ok: true, valuation, fields: uniqueFields(fields) };
}

// ─── Pannello rapido (§5.2) ──────────────────────────────────────────

export const quickCreateSchema = z
  .object({
    title: titleSchema,
    problem: z
      .string({ message: "Scrivi il problema in una riga." })
      .trim()
      .min(QUICK_CREATE_LIMITS.problem.min, { message: `Scrivi almeno ${QUICK_CREATE_LIMITS.problem.min} caratteri.` })
      .max(QUICK_CREATE_LIMITS.problem.max, { message: tooLongMessage(QUICK_CREATE_LIMITS.problem.max) }),
    aiLab: optionalTextSchema(QUICK_CREATE_LIMITS.aiLab.max).optional(),
    /** Predefinita «AI Transformation» (§5.2). */
    origin: z.enum(ORIGINS, { message: "Scegli AI Adoption o AI Transformation." }).default("transformation"),
    /** Predefinito «Da costruire». */
    kind: z.enum(KINDS, { message: "Scegli Da costruire o Da diffondere." }).default("da_costruire"),
  })
  .strict();

export type QuickCreateInput = z.output<typeof quickCreateSchema>;

export function validateQuickCreate(input: unknown): { ok: true; value: QuickCreateInput } | { ok: false; fieldErrors: FieldErrors } {
  const parsed = quickCreateSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, fieldErrors: fieldErrorsOf(parsed.error) };
}
