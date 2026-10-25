import test from "node:test";
import assert from "node:assert/strict";
import {
  componentResult,
  impactThresholds,
  jCurve,
  modelValue,
  monthAt,
  monthIndex,
  monthLabel,
  planMonths,
  quarterFirstMonth,
  quarterOfMonth,
  valueScore,
  valueTotals,
  type CurveCard,
  type PlanCard,
} from "./value-calc.ts";
import { DEFAULT_THRESHOLDS, type ValuationModel } from "./valuation.ts";
import { DEFAULT_VALUE_PARAMS, valueModelSchema, type ValueModel, type ValueParams } from "./value-model.ts";

// Golden test della spec (25/10/2026): ipotesi predefinite, originMonth 2026-11. Dati sintetici.

const PARAMS: ValueParams = { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" };
const VALUATION: ValuationModel = { dimensions: { impact: [{ id: "efficiency" }], feasibility: [{ id: "effort" }], esg: [] } };

const PLAN = { quarter: "2026-Q4", startMonth: "2026-11", goLiveMonth: "2027-01" } as const;

const FIX_A: ValueModel = valueModelSchema.parse({
  v: 1,
  primary: "tempo",
  components: [
    { key: "capacita", lever: "nuove_capacita", label: "Risposte anche fuori orario", kind: "qualitativo", confidence: "ipotesi" },
    { key: "tempo", lever: "tempo", label: "Smistamento delle richieste", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" },
    { key: "qualita", lever: "qualita", label: "Meno errori di smistamento", kind: "qualitativo", confidence: "da_misurare" },
  ],
  ease: 4,
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
  plan: PLAN,
});

const FIX_B: ValueModel = valueModelSchema.parse({
  v: 1,
  primary: "costi",
  components: [
    { key: "costi", lever: "costi", label: "Meno licenze", kind: "euro", eurYear: 535, confidence: "ipotesi" },
    { key: "tempo-1", lever: "tempo", label: "Controllo delle fatture", kind: "ore", volumeYear: 480, minutesPerUnit: 12, automatablePct: 65, confidence: "ipotesi" },
    { key: "tempo-2", lever: "tempo", label: "Solleciti ai fornitori", kind: "ore", volumeYear: 600, minutesPerUnit: 6, automatablePct: 80, confidence: "da_misurare" },
    { key: "rischio", lever: "rischio", label: "Meno pagamenti doppi", kind: "qualitativo", confidence: "da_misurare" },
  ],
  costs: { devDays: 2, internalHours: 8, runCostEurYear: 0 },
  plan: PLAN,
});

/** Uguali a due decimali: la differenza non supera mezzo centesimo. */
function near(actual: number, expected: number, label: string) {
  assert.ok(Math.abs(actual - expected) <= 0.005 + 1e-9, `${label}: ${actual} invece di ${expected}`);
}

function nearAll(actual: readonly number[], expected: readonly number[], label: string) {
  expected.forEach((value, i) => near(actual[i], value, `${label}[${i}]`));
}

function curveOf(model: ValueModel, params: ValueParams = PARAMS) {
  const totals = valueTotals(model, params);
  const [months] = planMonths([{ id: "a", stage: "approvato", targetQuarter: "2026-Q4", plan: model.plan }], params);
  const card: CurveCard = { start: months.start, goLive: months.goLive, benefit: totals.benefit, oneoff: totals.oneoff, run: totals.run };
  return { totals, months, curve: jCurve([card], params) };
}

test("FIX_A: ore, beneficio, avvio, ricorrenti e netto", () => {
  const t = valueTotals(FIX_A, PARAMS);
  near(t.hours, 115.5, "hours");
  near(t.benefit, 4042.5, "benefit");
  near(t.pendingEur, 0, "pendingEur");
  near(t.oneoff, 560, "oneoff");
  near(t.run, 600, "run");
  near(t.net, 3442.5, "net");
  assert.equal(t.qualitative, 2);
  assert.equal(t.byLever.tempo, t.benefit);
  assert.equal(t.qualitativeByLever.nuove_capacita, 1);
  assert.equal(t.qualitativeByLever.qualita, 1);
  for (const lever of ["output", "qualita", "nuove_capacita", "decisioni", "costi", "ricavi", "rischio"] as const) {
    assert.equal(t.byLever[lever], 0, lever);
  }
});

test("FIX_A: J-curve e pareggio al mese 6, «mag 27»", () => {
  const { months, curve } = curveOf(FIX_A);
  assert.deepEqual({ start: months.start, goLive: months.goLive, source: months.source }, { start: 0, goLive: 2, source: "piano" });
  assert.equal(curve.net.length, PARAMS.horizonMonths + 1);
  nearAll(curve.net, [0, -280, -560, -497.71, -323.13, -36.25, 250.62], "net");
  assert.equal(curve.breakeven, 6);
  assert.equal(curve.breakevenMonth, "2027-05");
  assert.equal(monthLabel(curve.breakevenMonth!), "mag 27");
  assert.equal(curve.months[0], "2026-11");
});

test("ore nell'ordine della spec: 115,5 h e 4.042,5 € esatti, non 115,4999…", () => {
  const ore = componentResult(FIX_A.components[1], PARAMS);
  assert.equal(ore.hours, 115.5);
  assert.equal(ore.eur, 4042.5);
});

test("pareggio con tolleranza: una curva che tocca lo zero pareggia in quel mese", () => {
  // Avvio 1.000 € su tre mesi, poi 333,33 € al mese: net[6] è 0 nel conto esatto, −1,1e-13 in virgola mobile.
  const exact = jCurve([{ start: 0, goLive: 3, benefit: 4000, oneoff: 1000, run: 0 }], { ...PARAMS, rampMonths: 1, horizonMonths: 24 });
  assert.ok(Math.abs(exact.net[6]) < 1e-9, `net[6] = ${exact.net[6]}`);
  assert.equal(exact.breakeven, 6);
  assert.equal(monthLabel(exact.breakevenMonth!), "mag 27");
  // Con 700 € la stessa forma dà già 6: le due curve dicono lo stesso mese.
  const other = jCurve([{ start: 0, goLive: 3, benefit: 2800, oneoff: 700, run: 0 }], { ...PARAMS, rampMonths: 1, horizonMonths: 24 });
  assert.equal(other.breakeven, 6);
});

test("FIX_B: ore, beneficio, da misurare, avvio e netto", () => {
  const t = valueTotals(FIX_B, PARAMS);
  near(t.hours, 62.4, "hours");
  near(t.benefit, 2719, "benefit");
  near(t.pendingEur, 1680, "pendingEur");
  near(t.oneoff, 280, "oneoff");
  near(t.run, 0, "run");
  near(t.net, 2719, "net");
  near(t.byLever.costi, 535, "byLever.costi");
  near(t.byLever.tempo, 2184, "byLever.tempo");
  near(t.pendingByLever.tempo, 1680, "pendingByLever.tempo");
  assert.equal(t.qualitative, 1);
  assert.equal(t.qualitativeByLever.rischio, 1);
});

test("FIX_B: J-curve e pareggio al mese 5, «apr 27»", () => {
  const { curve } = curveOf(FIX_B);
  nearAll(curve.net, [0, -140, -280, -204.47, -53.42, 173.17], "net");
  assert.equal(curve.breakeven, 5);
  assert.equal(monthLabel(curve.breakevenMonth!), "apr 27");
});

test("includeUnmeasured: le voci da misurare entrano nel beneficio e nelle ore", () => {
  const t = valueTotals(FIX_B, { ...PARAMS, includeUnmeasured: true });
  near(t.hours, 62.4 + 48, "hours");
  near(t.benefit, 2719 + 1680, "benefit");
  assert.equal(t.pendingEur, 0);
});

test("la riga calcolata di una voce: ore ed euro, contata o no", () => {
  const ore = componentResult(FIX_A.components[1], PARAMS);
  assert.deepEqual({ counted: ore.counted, kind: ore.kind }, { counted: true, kind: "ore" });
  near(ore.hours, 115.5, "hours");
  near(ore.eur, 4042.5, "eur");
  const pending = componentResult(FIX_B.components[2], PARAMS);
  assert.equal(pending.counted, false);
  near(pending.eur, 1680, "eur da misurare");
  assert.deepEqual(componentResult(FIX_A.components[0], PARAMS), { key: "capacita", lever: "nuove_capacita", kind: "qualitativo", counted: true, hours: 0, eur: 0 });
});

test("senza costi: avvio e ricorrenti a zero; il costo di una giornata entra nell'avvio", () => {
  const noCosts = valueTotals({ components: FIX_A.components }, PARAMS);
  assert.deepEqual([noCosts.oneoff, noCosts.run], [0, 0]);
  near(noCosts.net, 4042.5, "net");
  const withDay = valueTotals(FIX_A, { ...PARAMS, dayCostEur: 400 });
  near(withDay.oneoff, 4 * 400 + 16 * 35, "oneoff");
});

// ─── Punteggio ───────────────────────────────────────────────────────

test("punteggio: i quattro punti esatti, in mezzo lineare, fuori dai bordi 1 e 5", () => {
  const th = impactThresholds(VALUATION);
  assert.deepEqual(th, { midImpact: DEFAULT_THRESHOLDS.midImpact, highImpact: DEFAULT_THRESHOLDS.highImpact });
  assert.equal(valueScore(0, PARAMS, th), 1);
  assert.equal(valueScore(-10, PARAMS, th), 1);
  assert.equal(valueScore(15_000, PARAMS, th), 2.5);
  assert.equal(valueScore(50_000, PARAMS, th), 3.5);
  assert.equal(valueScore(100_000, PARAMS, th), 5);
  assert.equal(valueScore(1_000_000, PARAMS, th), 5);
  near(valueScore(7_500, PARAMS, th), 1.75, "metà del primo tratto");
  near(valueScore(32_500, PARAMS, th), 3, "metà del secondo tratto");
  near(valueScore(75_000, PARAMS, th), 4.25, "metà del terzo tratto");
  near(valueScore(4042.5, PARAMS, th), 1.40425, "FIX_A");
});

test("punteggio: con le soglie del workspace, «Medio» e «Alto» cominciano proprio da midValueEur e highValueEur", () => {
  const custom: ValuationModel = { ...VALUATION, thresholds: { midImpact: 2.2, highImpact: 4.1 } };
  const params = { ...PARAMS, midValueEur: 10_000, highValueEur: 40_000 };
  const word = (eur: number) => modelValue({ benefit: eur, pendingEur: 0 }, params, custom).word;
  assert.equal(word(9_999), "basso");
  assert.equal(word(10_000), "medio");
  assert.equal(word(39_999), "medio");
  assert.equal(word(40_000), "alto");
  assert.equal(valueScore(40_000, params, impactThresholds(custom)), 4.1);
});

test("Valore di una scheda con modello: contato, da misurare, qualitativo", () => {
  const a = modelValue(valueTotals(FIX_A, PARAMS), PARAMS, VALUATION);
  assert.equal(a.state, "contato");
  assert.equal(a.word, "basso");
  near(a.score!, 1.40425, "score");
  const onlyPending = valueModelSchema.parse({
    v: 1,
    primary: "tempo",
    components: [{ key: "t", lever: "tempo", label: "Da misurare", kind: "ore", volumeYear: 600, minutesPerUnit: 6, automatablePct: 80, confidence: "da_misurare" }],
  });
  const b = modelValue(valueTotals(onlyPending, PARAMS), PARAMS, VALUATION);
  assert.deepEqual({ state: b.state, score: b.score, word: b.word }, { state: "da_misurare", score: null, word: null });
  near(b.pendingEur, 1680, "fino a");
  const onlyWords = valueModelSchema.parse({ v: 1, primary: "rischio", components: [{ key: "r", lever: "rischio", label: "Meno rischio", kind: "qualitativo", confidence: "ipotesi" }] });
  assert.equal(modelValue(valueTotals(onlyWords, PARAMS), PARAMS, VALUATION).state, "qualitativo");
});

// ─── Mesi ────────────────────────────────────────────────────────────

test("mesi: indice, mese dopo e prima, etichetta italiana, trimestri", () => {
  assert.equal(monthIndex("2026-11", "2027-05"), 6);
  assert.equal(monthIndex("2026-11", "2026-09"), -2);
  assert.equal(monthAt("2026-11", 2), "2027-01");
  assert.equal(monthAt("2026-11", -11), "2025-12");
  assert.equal(monthAt("2026-11", 14), "2028-01");
  assert.deepEqual(
    ["2027-01", "2027-02", "2027-03", "2027-04", "2027-05", "2027-06", "2027-07", "2027-08", "2027-09", "2027-10", "2027-11", "2027-12"].map(monthLabel),
    ["gen 27", "feb 27", "mar 27", "apr 27", "mag 27", "giu 27", "lug 27", "ago 27", "set 27", "ott 27", "nov 27", "dic 27"],
  );
  assert.equal(monthLabel("2030-03"), "mar 30");
  assert.equal(quarterFirstMonth("2027-Q2"), "2027-04");
  assert.equal(quarterOfMonth("2026-11"), "2026-Q4");
  assert.equal(quarterOfMonth("2027-03"), "2027-Q1");
  assert.throws(() => monthIndex("2026-13", "2027-01"), RangeError);
});

// ─── Piano ───────────────────────────────────────────────────────────

test("piano: mesi del piano, trimestre approvato, origine, «Più avanti» dopo l'ultimo usato", () => {
  const cards: PlanCard[] = [
    { id: "piano", stage: "approvato", targetQuarter: "2027-Q2", plan: { quarter: "2027-Q2", startMonth: "2027-05", goLiveMonth: "2027-08" } },
    { id: "trimestre", stage: "approvato", targetQuarter: "2027-Q1" },
    { id: "realizzazione", stage: "in_realizzazione", targetQuarter: "2027-Q3" },
    { id: "iniziato", stage: "approvato", targetQuarter: "2026-Q4" },
    { id: "passato", stage: "approvato", targetQuarter: "2026-Q2" },
    { id: "dopo", stage: "approvato", targetQuarter: null },
  ];
  const months = planMonths(cards, PARAMS);
  const by = Object.fromEntries(months.map((m) => [m.id, [m.start, m.goLive, m.startMonth, m.goLiveMonth, m.source]]));
  assert.deepEqual(months.map((m) => m.id), cards.map((c) => c.id));
  assert.deepEqual(by.piano, [6, 9, "2027-05", "2027-08", "piano"]);
  assert.deepEqual(by.trimestre, [2, 4, "2027-01", "2027-03", "trimestre"]);
  assert.deepEqual(by.realizzazione, [0, 2, "2026-11", "2027-01", "origine"]);
  // Il trimestre è cominciato prima dell'origine, oppure è passato: si parte dall'origine.
  assert.deepEqual(by.iniziato, [0, 2, "2026-11", "2027-01", "origine"]);
  assert.deepEqual(by.passato, [0, 2, "2026-11", "2027-01", "origine"]);
  // L'ultimo trimestre usato è 2027-Q2 (avvio del piano a maggio): «Più avanti» parte a luglio.
  assert.deepEqual(by.dopo, [8, 10, "2027-07", "2027-09", "piu_avanti"]);
});

test("piano: «Più avanti» da solo parte nel trimestre dopo quello dell'origine; buildMonths 0", () => {
  const [alone] = planMonths([{ id: "x", stage: "approvato", targetQuarter: null }], PARAMS);
  assert.deepEqual([alone.start, alone.goLive, alone.startMonth], [2, 4, "2027-01"]);
  const [now] = planMonths([{ id: "y", stage: "approvato", targetQuarter: "2027-Q1" }], { ...PARAMS, buildMonths: 0 });
  assert.deepEqual([now.start, now.goLive], [2, 2]);
});

// ─── J-curve ─────────────────────────────────────────────────────────

test("J-curve: avvio ed entrata in uso nello stesso mese, tutto il costo in quel mese", () => {
  const curve = jCurve([{ start: 1, goLive: 1, benefit: 1200, oneoff: 300, run: 0 }], { ...PARAMS, rampMonths: 0, horizonMonths: 6 });
  // ramp = max(1, 0) = 1: dal mese di entrata in uso il beneficio è pieno (100 al mese).
  nearAll(curve.net, [0, 0, -200, -100, 0, 100, 200], "net");
  assert.equal(curve.breakeven, 4);
  assert.equal(curve.months.length, 7);
});

test("J-curve: più schede si sommano; senza schede nessun pareggio; mesi fuori orizzonte esclusi", () => {
  const empty = jCurve([], PARAMS);
  assert.equal(empty.breakeven, null);
  assert.equal(empty.breakevenMonth, null);
  assert.ok(empty.net.every((v) => v === 0));
  const a: CurveCard = { start: 0, goLive: 2, benefit: 4042.5, oneoff: 560, run: 600 };
  const b: CurveCard = { start: 0, goLive: 2, benefit: 2719, oneoff: 280, run: 0 };
  const both = jCurve([a, b], PARAMS);
  const sum = jCurve([a], PARAMS).net.map((v, i) => v + jCurve([b], PARAMS).net[i]);
  nearAll(both.net, sum, "somma");
  // Una scheda che entra in uso dopo l'orizzonte paga solo l'avvio dentro l'orizzonte.
  const late = jCurve([{ start: 22, goLive: 30, benefit: 120_000, oneoff: 800, run: 0 }], PARAMS);
  near(late.net[24], -200, "due mesi di avvio su otto");
  assert.equal(late.breakeven, null);
});
