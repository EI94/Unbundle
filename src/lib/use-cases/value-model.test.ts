import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { LEVERS } from "../uc/vocab.ts";
import { findHubForbidden } from "./copy-guard.ts";
import {
  DEFAULT_VALUE_PARAMS,
  LEVER_LABELS,
  VALUE_COMPONENT_KIND_LABELS,
  VALUE_CONFIDENCE_LABELS,
  VALUE_MODEL_ERRORS,
  VALUE_PARAMS_ERRORS,
  currentMonth,
  isMonthCode,
  parseValueModel,
  resolveValueParams,
  valueModelSchema,
  valueParamsSchema,
} from "./value-model.ts";

// Schema di use_cases.value_model e ipotesi del workspace (spec del 25/10/2026). Dati sintetici.

const HOURS = { key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" };
const EURO = { key: "costi", lever: "costi", label: "Meno licenze", kind: "euro", eurYear: 535, confidence: "fonte" };
const WORDS = { key: "rischio", lever: "rischio", label: "Meno pagamenti doppi", kind: "qualitativo", confidence: "da_misurare" };
const MODEL = {
  v: 1,
  primary: "tempo",
  whyPrimary: "Le ore sono la parte più grande.",
  components: [HOURS, EURO, WORDS],
  notCounted: "Il tempo dei fornitori.",
  ease: 4,
  easeWhy: "I dati ci sono già.",
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600, runCostNote: "Licenza del modello" },
  group: "Amministrazione",
  ref: "A.3",
  confirmBy: "Responsabile amministrazione",
  plan: { quarter: "2026-Q4", startMonth: "2026-11", goLiveMonth: "2027-01" },
};

const issuesOf = (value: unknown) => {
  const parsed = valueModelSchema.safeParse(value);
  assert.equal(parsed.success, false, "doveva essere rifiutato");
  return parsed.error!.issues;
};

test("un modello completo passa, e il minimo pure (v, primary, una voce)", () => {
  assert.deepEqual(valueModelSchema.parse(MODEL), MODEL);
  const minimal = { v: 1, primary: "rischio", components: [WORDS] };
  assert.deepEqual(valueModelSchema.parse(minimal), minimal);
});

test("primary deve essere il tipo di almeno una voce", () => {
  const issues = issuesOf({ ...MODEL, primary: "ricavi" });
  assert.ok(issues.some((i) => i.path.join(".") === "primary" && i.message === VALUE_MODEL_ERRORS.primaryNotInComponents));
  assert.equal(issuesOf({ ...MODEL, primary: "inventato" }).length > 0, true);
});

test("da 1 a 6 voci, chiavi uniche", () => {
  issuesOf({ ...MODEL, components: [] });
  const six = Array.from({ length: 6 }, (_, i) => ({ ...WORDS, key: `r${i}` }));
  assert.ok(valueModelSchema.safeParse({ ...MODEL, primary: "rischio", components: six }).success);
  issuesOf({ ...MODEL, primary: "rischio", components: [...six, { ...WORDS, key: "r6" }] });
  const dup = issuesOf({ ...MODEL, components: [HOURS, { ...EURO, key: "tempo" }] });
  assert.ok(dup.some((i) => i.path.join(".") === "components.1.key" && i.message === VALUE_MODEL_ERRORS.duplicateKey));
});

test("campi per tipo di voce: le ore vogliono volume, minuti e quota; l'euro vuole eurYear; niente campi degli altri tipi", () => {
  const without = (value: Record<string, unknown>, field: string) => Object.fromEntries(Object.entries(value).filter(([key]) => key !== field));
  for (const field of ["volumeYear", "minutesPerUnit", "automatablePct"]) {
    issuesOf({ ...MODEL, components: [without(HOURS, field), EURO] });
  }
  issuesOf({ ...MODEL, components: [HOURS, without(EURO, "eurYear")] });
  issuesOf({ ...MODEL, components: [{ ...HOURS, eurYear: 100 }] });
  issuesOf({ ...MODEL, components: [HOURS, { ...EURO, minutesPerUnit: 3 }] });
  issuesOf({ ...MODEL, components: [HOURS, { ...WORDS, eurYear: 10 }] });
  issuesOf({ ...MODEL, components: [{ ...HOURS, kind: "giorni" }] });
  // Limiti dei numeri.
  issuesOf({ ...MODEL, components: [{ ...HOURS, automatablePct: 101 }] });
  issuesOf({ ...MODEL, components: [{ ...HOURS, volumeYear: -1 }] });
  issuesOf({ ...MODEL, components: [HOURS, { ...EURO, eurYear: -5 }] });
  issuesOf({ ...MODEL, components: [HOURS, { ...EURO, eurYear: Number.POSITIVE_INFINITY }] });
  issuesOf({ ...MODEL, components: [{ ...HOURS, confidence: "certo" }] });
});

test("chiavi fuori elenco, versione, facilità, costi e testi", () => {
  issuesOf({ ...MODEL, extra: true });
  issuesOf({ ...MODEL, v: 2 });
  issuesOf({ ...MODEL, ease: 0 });
  issuesOf({ ...MODEL, ease: 6 });
  issuesOf({ ...MODEL, ease: 3.5 });
  issuesOf({ ...MODEL, costs: { devDays: 4, internalHours: 16 } });
  issuesOf({ ...MODEL, costs: { ...MODEL.costs, other: 1 } });
  issuesOf({ ...MODEL, group: "" });
  issuesOf({ ...MODEL, components: [{ ...HOURS, label: "x".repeat(121) }] });
  issuesOf({ ...MODEL, components: [{ ...HOURS, key: "con spazio" }] });
  // I testi si salvano senza spazi ai bordi.
  assert.equal(valueModelSchema.parse({ ...MODEL, group: "  Finanza  " }).group, "Finanza");
});

test("piano: trimestre o più avanti, mesi AAAA-MM, entrata in uso non prima dell'avvio", () => {
  assert.ok(valueModelSchema.safeParse({ ...MODEL, plan: { quarter: "piu_avanti", startMonth: "2027-07", goLiveMonth: "2027-07" } }).success);
  issuesOf({ ...MODEL, plan: { ...MODEL.plan, quarter: "2026-Q5" } });
  issuesOf({ ...MODEL, plan: { ...MODEL.plan, quarter: "T4 2026" } });
  issuesOf({ ...MODEL, plan: { ...MODEL.plan, startMonth: "2026-13" } });
  issuesOf({ ...MODEL, plan: { ...MODEL.plan, startMonth: "2026-1" } });
  issuesOf({ ...MODEL, plan: { quarter: "2026-Q4", startMonth: "2026-11" } });
  const before = issuesOf({ ...MODEL, plan: { ...MODEL.plan, goLiveMonth: "2026-10" } });
  assert.ok(before.some((i) => i.path.join(".") === "plan.goLiveMonth" && i.message === VALUE_MODEL_ERRORS.goLiveBeforeStart));
});

test("parseValueModel: il jsonb salvato valido torna com'è; rovinato o assente è null", () => {
  assert.deepEqual(parseValueModel(MODEL), MODEL);
  assert.equal(parseValueModel(null), null);
  assert.equal(parseValueModel(undefined), null);
  assert.equal(parseValueModel({ v: 1 }), null);
  assert.equal(parseValueModel("testo"), null);
});

test("lo schema diventa JSON Schema per il MCP (lato ingresso), con i vocabolari", () => {
  const json = JSON.stringify(z.toJSONSchema(valueModelSchema, { io: "input", unrepresentable: "any" }));
  for (const word of [...LEVERS, "ore", "euro", "qualitativo", "da_misurare", "piu_avanti"]) assert.ok(json.includes(`"${word}"`), word);
});

test("etichette: gli 8 tipi di ritorno della spec, nell'ordine delle leve, senza parole vietate", () => {
  assert.deepEqual(Object.keys(LEVER_LABELS), [...LEVERS]);
  assert.deepEqual(Object.values(LEVER_LABELS), [
    "Risparmio di tempo",
    "Più output",
    "Più qualità",
    "Nuove capacità",
    "Decisioni migliori",
    "Meno costi",
    "Più ricavi",
    "Meno rischio",
  ]);
  assert.deepEqual(Object.values(VALUE_COMPONENT_KIND_LABELS), ["Ore", "Euro", "Qualitativo"]);
  const texts = [
    ...Object.values(LEVER_LABELS),
    ...Object.values(VALUE_COMPONENT_KIND_LABELS),
    ...Object.values(VALUE_CONFIDENCE_LABELS),
    ...Object.values(VALUE_MODEL_ERRORS),
    ...Object.values(VALUE_PARAMS_ERRORS),
  ];
  for (const text of texts) assert.deepEqual(findHubForbidden(text, "area"), [], text);
});

// ─── Ipotesi del workspace ───────────────────────────────────────────

const NOW = new Date("2026-10-31T23:30:00Z"); // a Roma è già il 1° novembre

test("ipotesi: senza valueParams valgono i predefiniti e il mese corrente a Roma", () => {
  const expected = { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" };
  assert.equal(currentMonth(NOW), "2026-11");
  assert.deepEqual(resolveValueParams(null, NOW), expected);
  assert.deepEqual(resolveValueParams({}, NOW), expected);
  assert.deepEqual(resolveValueParams({ valueParams: "rotto" }, NOW), expected);
  assert.deepEqual(DEFAULT_VALUE_PARAMS, {
    hourlyCostEur: 35,
    dayCostEur: 0,
    rampMonths: 3,
    horizonMonths: 24,
    buildMonths: 2,
    includeUnmeasured: false,
    highValueEur: 50_000,
    midValueEur: 15_000,
  });
});

test("ipotesi: i valori salvati vincono; uno non valido vale il suo predefinito; «Medio» non sotto «Alto» rimette le soglie", () => {
  const saved = {
    dimensions: {},
    valueParams: { hourlyCostEur: 42, dayCostEur: 400, rampMonths: 0, horizonMonths: 36, buildMonths: 3, originMonth: "2027-01", includeUnmeasured: true, highValueEur: 80_000, midValueEur: 20_000 },
  };
  assert.deepEqual(resolveValueParams(saved, NOW), saved.valueParams);
  const broken = resolveValueParams({ valueParams: { hourlyCostEur: -1, rampMonths: 1.5, horizonMonths: 0, originMonth: "2027-13", includeUnmeasured: "sì", other: 1 } }, NOW);
  assert.deepEqual(broken, { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" });
  const swapped = resolveValueParams({ valueParams: { highValueEur: 10_000, midValueEur: 20_000 } }, NOW);
  assert.deepEqual([swapped.midValueEur, swapped.highValueEur], [15_000, 50_000]);
});

test("ipotesi da salvare: chiavi facoltative e strette, «Medio» sotto «Alto»", () => {
  assert.ok(valueParamsSchema.safeParse({}).success);
  assert.ok(valueParamsSchema.safeParse({ hourlyCostEur: 40, originMonth: "2026-11" }).success);
  assert.equal(valueParamsSchema.safeParse({ hourlyCost: 40 }).success, false);
  assert.equal(valueParamsSchema.safeParse({ originMonth: "nov 26" }).success, false);
  assert.equal(valueParamsSchema.safeParse({ rampMonths: 2.5 }).success, false);
  const order = valueParamsSchema.safeParse({ midValueEur: 60_000 });
  assert.equal(order.success, false);
  assert.ok(order.error!.issues.some((i) => i.path.join(".") === "midValueEur" && i.message === VALUE_PARAMS_ERRORS.midNotBelowHigh));
  assert.ok(isMonthCode("2026-11"));
  assert.equal(isMonthCode("2026-00"), false);
});
