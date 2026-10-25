/**
 * La logica dell'editor «Benefici e costi» della scheda (Dettaglio › Valutazione), fuori dal
 * componente perché la provi `node --test`.
 *
 * - **Bozza** (`ValueModelDraft`): il modello come lo scrive la persona, con i numeri come testo
 *   («6.600», «1,5»). `draftFromModel` la prepara dal modello salvato, `modelFromDraft` la
 *   riporta al modello, validato con lo schema unico (`valueModelSchema`), con errori in
 *   italiano per campo (`components.0.label`, `costs.devDays`, …): gli stessi percorsi che il
 *   servizio rimanda sotto `model.`.
 * - **Senza voci non c'è modello**: una bozza senza voci vale `null` (salvare toglie il modello).
 * - **Ritorno principale**: sempre il tipo di una voce; se quello scelto non c'è più, il primo.
 * - **Righe calcolate** (`componentLine`, `totalsLines`): «116 h · 4.043 €» per voce e i totali,
 *   con le ipotesi del workspace (`componentResult`, `valueTotals` di `value-calc.ts`). Una voce con
 *   un numero che manca o non si legge dà «—», non «0 h · 0 €».
 * - **Errori mentre si scrive** (`liveDraftErrors`): un numero scritto che non si legge, o una quota
 *   oltre 100, ha subito il suo messaggio; i campi vuoti aspettano «Salva».
 *
 * Modulo puro: solo import relativi `.ts`, nessun `@/`.
 */
import { LEVERS, type Lever } from "../../../lib/uc/vocab.ts";
import { FIGURE_SEPARATOR, formatEuro, formatInteger, oneoffRunText } from "../../../lib/use-cases/format.ts";
import { componentResult, quarterOfMonth, valueTotals } from "../../../lib/use-cases/value-calc.ts";
import {
  LEVER_LABELS,
  VALUE_COMPONENTS_MAX,
  VALUE_MODEL_ERRORS,
  VALUE_MODEL_VERSION,
  isMonthCode,
  valueModelSchema,
  type ValueComponent,
  type ValueComponentKind,
  type ValueConfidence,
  type ValueModel,
  type ValueParams,
} from "../../../lib/use-cases/value-model.ts";
import { parseDecimalText } from "../../../lib/use-cases/value-params-form.ts";

// ─── Testi ───────────────────────────────────────────────────────────

export const VALUE_MODEL_EDITOR_TEXT = Object.freeze({
  title: "Benefici e costi",
  intro: "Da qui partono Valore e costo: voci a ore, in euro o qualitative.",
  addComponent: "Aggiungi una voce",
  removeComponent: "Togli la voce",
  maxComponents: `Al massimo ${VALUE_COMPONENTS_MAX} voci.`,
  noComponents: "Senza voci i benefici non si salvano.",
  component: "Voce",
  lever: "Tipo di ritorno",
  label: "Che cosa",
  labelPlaceholder: "es. Smistamento delle richieste",
  kind: "Come si conta",
  confidence: "Quanto è sicura",
  volumeYear: "Volte all'anno",
  unit: "Che cosa si conta",
  unitPlaceholder: "es. richieste",
  minutesPerUnit: "Minuti per volta",
  automatablePct: "Quota risparmiata",
  eurYear: "Euro all'anno",
  indicator: "Come si misura dopo",
  basis: "Da dove viene la stima",
  primary: "Ritorno principale",
  whyPrimary: "Perché è il principale",
  costs: "Costi",
  devDays: "Giorni di sviluppo",
  internalHours: "Ore delle vostre persone",
  runCostEurYear: "Costi ricorrenti",
  runCostNote: "Di che cosa sono fatti",
  ease: "Facilità",
  easeNone: "Non indicata",
  easeWhy: "Perché questa facilità",
  group: "Gruppo",
  groupPlaceholder: "es. Amministrazione",
  confirmBy: "Chi conferma i numeri",
  advanced: "Avanzate",
  startMonth: "Mese di avvio",
  goLiveMonth: "Mese di entrata in uso",
  monthsHelp: "Vuoti: dal trimestre approvato.",
  notCounted: "Che cosa resta fuori dal conto",
  ref: "Riferimento",
  counted: "Contati",
  pending: "Da misurare, fuori dal totale",
  qualitative: "qualitativo",
  measureLater: "da misurare, fuori dal totale",
  perYear: "all'anno",
  hoursSuffix: "h",
  percentSuffix: "%",
  euroSuffix: "€",
  euroYearSuffix: "€/anno",
  daysSuffix: "giorni",
  hoursUnitSuffix: "ore",
  /** La riga calcolata quando un numero della voce manca o non si legge. */
  lineMissing: "—",
});

/** Le scelte di «Facilità», da 1 a 5. */
export const EASE_CHOICES: ReadonlyArray<{ value: string; label: string }> = Object.freeze([
  { value: "1", label: "1 · difficile" },
  { value: "2", label: "2" },
  { value: "3", label: "3" },
  { value: "4", label: "4" },
  { value: "5", label: "5 · facile" },
]);

export const VALUE_MODEL_DRAFT_ERRORS = Object.freeze({
  label: "Scrivi che cosa porta questa voce.",
  volumeYear: "Scrivi quante volte all'anno (es. 6.600).",
  minutesPerUnit: "Scrivi i minuti per volta (es. 1,5).",
  automatablePct: "Scrivi una quota da 0 a 100.",
  eurYear: "Scrivi gli euro all'anno (es. 12.000).",
  number: "Scrivi un numero (es. 4 o 1,5).",
  months: "Scegli tutti e due i mesi, oppure nessuno.",
  invalid: "Controlla questo valore.",
});

// ─── Bozza ───────────────────────────────────────────────────────────

export interface ComponentDraft {
  key: string;
  lever: Lever;
  label: string;
  kind: ValueComponentKind;
  volumeYear: string;
  unit: string;
  minutesPerUnit: string;
  automatablePct: string;
  eurYear: string;
  confidence: ValueConfidence;
  indicator: string;
  basis: string;
}

export interface ValueModelDraft {
  primary: Lever | null;
  whyPrimary: string;
  components: ComponentDraft[];
  notCounted: string;
  /** «» oppure «1»…«5». */
  ease: string;
  easeWhy: string;
  devDays: string;
  internalHours: string;
  runCostEurYear: string;
  runCostNote: string;
  group: string;
  ref: string;
  confirmBy: string;
  startMonth: string;
  goLiveMonth: string;
  /** Il trimestre del piano salvato: resta se i mesi non cambiano. */
  savedPlan: ValueModel["plan"] | null;
}

const numberText = (n: number | undefined): string => {
  if (typeof n !== "number" || !Number.isFinite(n)) return "";
  if (Number.isInteger(n)) return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return String(n).replace(".", ",");
};

/** La bozza di un modello salvato; senza modello, vuota. */
export function draftFromModel(model: ValueModel | null): ValueModelDraft {
  return {
    primary: model?.primary ?? null,
    whyPrimary: model?.whyPrimary ?? "",
    components: (model?.components ?? []).map(componentDraftOf),
    notCounted: model?.notCounted ?? "",
    ease: model?.ease ? String(model.ease) : "",
    easeWhy: model?.easeWhy ?? "",
    devDays: numberText(model?.costs?.devDays),
    internalHours: numberText(model?.costs?.internalHours),
    runCostEurYear: numberText(model?.costs?.runCostEurYear),
    runCostNote: model?.costs?.runCostNote ?? "",
    group: model?.group ?? "",
    ref: model?.ref ?? "",
    confirmBy: model?.confirmBy ?? "",
    startMonth: model?.plan?.startMonth ?? "",
    goLiveMonth: model?.plan?.goLiveMonth ?? "",
    savedPlan: model?.plan ?? null,
  };
}

function componentDraftOf(component: ValueComponent): ComponentDraft {
  return {
    key: component.key,
    lever: component.lever,
    label: component.label,
    kind: component.kind,
    volumeYear: component.kind === "ore" ? numberText(component.volumeYear) : "",
    unit: component.kind === "ore" ? (component.unit ?? "") : "",
    minutesPerUnit: component.kind === "ore" ? numberText(component.minutesPerUnit) : "",
    automatablePct: component.kind === "ore" ? numberText(component.automatablePct) : "",
    eurYear: component.kind === "euro" ? numberText(component.eurYear) : "",
    confidence: component.confidence,
    indicator: component.indicator ?? "",
    basis: component.basis ?? "",
  };
}

/** Una chiave nuova, unica nella bozza: `voce-1`, `voce-2`, … */
export function newComponentKey(components: readonly Pick<ComponentDraft, "key">[]): string {
  const used = new Set(components.map((c) => c.key));
  for (let n = 1; ; n++) if (!used.has(`voce-${n}`)) return `voce-${n}`;
}

/** Una voce nuova: il primo tipo non ancora usato, a ore, ipotesi. */
export function newComponentDraft(components: readonly ComponentDraft[]): ComponentDraft {
  const used = new Set(components.map((c) => c.lever));
  const lever = LEVERS.find((l) => !used.has(l)) ?? LEVERS[0];
  return {
    key: newComponentKey(components),
    lever,
    label: "",
    kind: "ore",
    volumeYear: "",
    unit: "",
    minutesPerUnit: "",
    automatablePct: "",
    eurYear: "",
    confidence: "ipotesi",
    indicator: "",
    basis: "",
  };
}

/** I tipi delle voci, nell'ordine delle 8 leve, senza doppioni: le scelte del ritorno principale. */
export function draftLevers(draft: Pick<ValueModelDraft, "components">): Lever[] {
  const used = new Set(draft.components.map((c) => c.lever));
  return LEVERS.filter((lever) => used.has(lever));
}

/** Il ritorno principale della bozza: quello scelto se è il tipo di una voce, altrimenti il primo tipo delle voci. */
export function draftPrimary(draft: Pick<ValueModelDraft, "primary" | "components">): Lever | null {
  const levers = draftLevers(draft);
  if (draft.primary && levers.includes(draft.primary)) return draft.primary;
  return draft.components[0]?.lever ?? null;
}

// ─── Dalla bozza al modello ──────────────────────────────────────────

export type DraftResult = { ok: true; model: ValueModel | null } | { ok: false; errors: Record<string, string> };

const optionalText = (text: string): string | undefined => (text.trim() ? text.trim() : undefined);

/** Un numero della bozza: vuoto è `empty`, illeggibile è null. */
function readNumber(text: string, empty: number | undefined): number | undefined | null {
  if (!text.trim()) return empty;
  const value = parseDecimalText(text);
  return value === null ? null : value;
}

/**
 * Il modello della bozza, validato con `valueModelSchema`. Senza voci: `null`. Errori per campo,
 * in italiano, con i percorsi del modello (`components.0.volumeYear`, `costs.devDays`, `plan`).
 */
export function modelFromDraft(draft: ValueModelDraft): DraftResult {
  if (draft.components.length === 0) return { ok: true, model: null };
  const errors: Record<string, string> = {};
  const components = draft.components.map((c, index) => {
    const path = `components.${index}`;
    if (!c.label.trim()) errors[`${path}.label`] = VALUE_MODEL_DRAFT_ERRORS.label;
    const base = {
      key: c.key,
      lever: c.lever,
      label: c.label.trim(),
      confidence: c.confidence,
      indicator: optionalText(c.indicator),
      basis: optionalText(c.basis),
    };
    if (c.kind === "ore") {
      const volumeYear = readNumber(c.volumeYear, undefined);
      const minutesPerUnit = readNumber(c.minutesPerUnit, undefined);
      const automatablePct = readNumber(c.automatablePct, undefined);
      if (volumeYear === null || volumeYear === undefined) errors[`${path}.volumeYear`] = VALUE_MODEL_DRAFT_ERRORS.volumeYear;
      if (minutesPerUnit === null || minutesPerUnit === undefined) errors[`${path}.minutesPerUnit`] = VALUE_MODEL_DRAFT_ERRORS.minutesPerUnit;
      if (automatablePct === null || automatablePct === undefined || automatablePct > 100) errors[`${path}.automatablePct`] = VALUE_MODEL_DRAFT_ERRORS.automatablePct;
      return { ...base, kind: "ore" as const, volumeYear, unit: optionalText(c.unit), minutesPerUnit, automatablePct };
    }
    if (c.kind === "euro") {
      const eurYear = readNumber(c.eurYear, undefined);
      if (eurYear === null || eurYear === undefined) errors[`${path}.eurYear`] = VALUE_MODEL_DRAFT_ERRORS.eurYear;
      return { ...base, kind: "euro" as const, eurYear };
    }
    return { ...base, kind: "qualitativo" as const };
  });

  const anyCost = [draft.devDays, draft.internalHours, draft.runCostEurYear].some((text) => text.trim());
  let costs: Record<string, unknown> | undefined;
  if (anyCost) {
    costs = { runCostNote: optionalText(draft.runCostNote) };
    for (const key of ["devDays", "internalHours", "runCostEurYear"] as const) {
      const value = readNumber(draft[key], 0);
      if (value === null) errors[`costs.${key}`] = VALUE_MODEL_DRAFT_ERRORS.number;
      else costs[key] = value;
    }
  }

  let plan: ValueModel["plan"] | undefined;
  const start = draft.startMonth.trim();
  const goLive = draft.goLiveMonth.trim();
  if (start || goLive) {
    if (!isMonthCode(start) || !isMonthCode(goLive)) errors.plan = VALUE_MODEL_DRAFT_ERRORS.months;
    else if (goLive < start) errors["plan.goLiveMonth"] = VALUE_MODEL_ERRORS.goLiveBeforeStart;
    else {
      const saved = draft.savedPlan;
      const quarter = saved && saved.startMonth === start ? saved.quarter : quarterOfMonth(start);
      plan = { quarter, startMonth: start, goLiveMonth: goLive };
    }
  }
  if (Object.keys(errors).length) return { ok: false, errors };

  const candidate = {
    v: VALUE_MODEL_VERSION,
    primary: draftPrimary(draft),
    whyPrimary: optionalText(draft.whyPrimary),
    components,
    notCounted: optionalText(draft.notCounted),
    ease: draft.ease ? Number(draft.ease) : undefined,
    easeWhy: optionalText(draft.easeWhy),
    costs,
    group: optionalText(draft.group),
    ref: optionalText(draft.ref),
    confirmBy: optionalText(draft.confirmBy),
    plan,
  };
  const parsed = valueModelSchema.safeParse(withoutUndefined(candidate));
  if (parsed.success) return { ok: true, model: parsed.data };
  const own = new Set<string>(Object.values(VALUE_MODEL_ERRORS));
  for (const issue of parsed.error.issues) {
    const key = issue.path.join(".") || "model";
    errors[key] ??= own.has(issue.message) ? issue.message : VALUE_MODEL_DRAFT_ERRORS.invalid;
  }
  return { ok: false, errors };
}

/** Senza le chiavi `undefined`: lo schema è stretto e una chiave c'è o non c'è. */
function withoutUndefined<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutUndefined) as T;
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, withoutUndefined(v)]),
  ) as T;
}

/** Gli errori del servizio (`model.components.0.label`) sui campi della bozza (`components.0.label`). */
export function draftErrorsFromService(fieldErrors: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(fieldErrors)) {
    if (key === "model") out.model = message;
    else if (key.startsWith("model.")) out[key.slice("model.".length)] = message;
  }
  return out;
}

/** Due modelli dicono la stessa cosa? (`null` è nessun modello.) */
export function sameValueModel(a: ValueModel | null, b: ValueModel | null): boolean {
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== "object") return value ?? null;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => [k, stable(v)]),
  );
}

// ─── Righe calcolate ─────────────────────────────────────────────────

/** Una voce della bozza come voce del modello, con 0 dove un numero manca o non vale: per i totali. */
function lenientComponent(c: ComponentDraft): ValueComponent {
  const n = (text: string) => parseDecimalText(text) ?? 0;
  const base = { key: c.key, lever: c.lever, label: c.label || c.key, confidence: c.confidence };
  const pct = n(c.automatablePct);
  if (c.kind === "ore") return { ...base, kind: "ore", volumeYear: n(c.volumeYear), minutesPerUnit: n(c.minutesPerUnit), automatablePct: pct > 100 ? 0 : pct };
  if (c.kind === "euro") return { ...base, kind: "euro", eurYear: n(c.eurYear) };
  return { ...base, kind: "qualitativo" };
}

/** I numeri che servono alla voce ci sono tutti e si leggono (la quota da 0 a 100). */
function componentNumbersReady(c: ComponentDraft): boolean {
  if (c.kind === "euro") return parseDecimalText(c.eurYear) !== null;
  if (c.kind !== "ore") return true;
  const pct = parseDecimalText(c.automatablePct);
  return parseDecimalText(c.volumeYear) !== null && parseDecimalText(c.minutesPerUnit) !== null && pct !== null && pct <= 100;
}

/**
 * Gli errori che si vedono mentre si scrive, con i percorsi del modello: un numero scritto che non
 * si legge («abc», «1,2,3») o una quota oltre 100. I campi vuoti non sono errori finché non si salva.
 */
export function liveDraftErrors(draft: Pick<ValueModelDraft, "components" | "devDays" | "internalHours" | "runCostEurYear">): Record<string, string> {
  const errors: Record<string, string> = {};
  const unreadable = (text: string) => text.trim() !== "" && parseDecimalText(text) === null;
  draft.components.forEach((c, index) => {
    const path = `components.${index}`;
    if (c.kind === "ore") {
      if (unreadable(c.volumeYear)) errors[`${path}.volumeYear`] = VALUE_MODEL_DRAFT_ERRORS.volumeYear;
      if (unreadable(c.minutesPerUnit)) errors[`${path}.minutesPerUnit`] = VALUE_MODEL_DRAFT_ERRORS.minutesPerUnit;
      const pct = parseDecimalText(c.automatablePct);
      if (unreadable(c.automatablePct) || (pct !== null && pct > 100)) errors[`${path}.automatablePct`] = VALUE_MODEL_DRAFT_ERRORS.automatablePct;
    } else if (c.kind === "euro" && unreadable(c.eurYear)) {
      errors[`${path}.eurYear`] = VALUE_MODEL_DRAFT_ERRORS.eurYear;
    }
  });
  for (const key of ["devDays", "internalHours", "runCostEurYear"] as const) {
    if (unreadable(draft[key])) errors[`costs.${key}`] = VALUE_MODEL_DRAFT_ERRORS.number;
  }
  return errors;
}

/** «116 h»: le ore all'anno, intere. */
function hoursText(hours: number): string {
  return `${formatInteger(hours)} ${VALUE_MODEL_EDITOR_TEXT.hoursSuffix}`;
}

/**
 * La riga calcolata di una voce: «116 h · 4.043 €» (ore), «535 €» (euro), «qualitativo»
 * (qualitativa); con «da misurare» in più «da misurare, fuori dal totale» (salvo che il
 * workspace conti anche quelle).
 */
export function componentLine(component: ComponentDraft, params: Pick<ValueParams, "hourlyCostEur" | "includeUnmeasured">): string {
  if (component.kind === "qualitativo") return VALUE_MODEL_EDITOR_TEXT.qualitative;
  if (!componentNumbersReady(component)) return VALUE_MODEL_EDITOR_TEXT.lineMissing;
  const result = componentResult(lenientComponent(component), params);
  const amount = component.kind === "ore" ? `${hoursText(result.hours)}${FIGURE_SEPARATOR}${formatEuro(result.eur)}` : formatEuro(result.eur);
  return result.counted ? amount : `${amount}${FIGURE_SEPARATOR}${VALUE_MODEL_EDITOR_TEXT.measureLater}`;
}

/**
 * I totali della bozza, sotto le voci: «Contati: 116 h · 4.043 € all'anno», «Da misurare, fuori
 * dal totale: fino a 1.680 €» (solo se c'è) e, con i costi, «avvio 560 € · ricorrenti 600 €/anno».
 */
export function totalsLines(
  draft: ValueModelDraft,
  params: ValueParams,
): { counted: string; pending: string | null; costs: string | null } {
  const anyCost = [draft.devDays, draft.internalHours, draft.runCostEurYear].some((text) => text.trim());
  const n = (text: string) => parseDecimalText(text) ?? 0;
  const totals = valueTotals(
    {
      components: draft.components.map(lenientComponent),
      costs: anyCost ? { devDays: n(draft.devDays), internalHours: n(draft.internalHours), runCostEurYear: n(draft.runCostEurYear) } : undefined,
    },
    params,
  );
  const hours = totals.hours > 0 ? `${hoursText(totals.hours)}${FIGURE_SEPARATOR}` : "";
  return {
    counted: `${VALUE_MODEL_EDITOR_TEXT.counted}: ${hours}${formatEuro(totals.benefit)} ${VALUE_MODEL_EDITOR_TEXT.perYear}`,
    pending: totals.pendingEur > 0 ? `${VALUE_MODEL_EDITOR_TEXT.pending}: fino a ${formatEuro(totals.pendingEur)}` : null,
    costs: anyCost ? oneoffRunText(totals.oneoff, totals.run) : null,
  };
}

/** L'etichetta di un tipo di ritorno («Risparmio di tempo»). */
export function leverLabel(lever: Lever): string {
  return LEVER_LABELS[lever];
}
