import test from "node:test";
import assert from "node:assert/strict";
import type { ProgramCard } from "./curve.ts";
import { DEFAULT_INDEX_WEIGHTS, aiNativeIndex, agentsToReview, indexWeightsOf, levelDistribution, programInitiatives, programResults } from "./figures.ts";

// I numeri della prima vista di «Programma» (rilascio 7). Dati sintetici.

function card(over: Partial<ProgramCard> & Pick<ProgramCard, "id" | "stage">): ProgramCard {
  return {
    code: over.id.toUpperCase(),
    title: `Use case ${over.id}`,
    kind: "da_costruire",
    targetQuarter: null,
    value: 0,
    oneoff: 0,
    lsDev: 0,
    lsDevMissingPct: false,
    run: 0,
    hasModel: true,
    start: 0,
    goLive: 2,
    startMonth: "2026-11",
    goLiveMonth: "2027-01",
    ...over,
  };
}

const CARDS = [
  card({ id: "u1", stage: "in_uso", value: 30_000.4, oneoff: 5000, run: 2000 }),
  card({ id: "u2", stage: "in_uso", value: 3000, oneoff: 1000, run: 2000 }),
  card({ id: "r1", stage: "in_realizzazione", value: 20_000, oneoff: 4000, run: 600, goLiveMonth: "2027-01" }),
  card({ id: "a1", stage: "da_avviare", value: 47_000, oneoff: 9000, run: 1200, lsDev: 7050, goLiveMonth: "2027-04" }),
  card({ id: "a2", stage: "da_avviare", value: 0, oneoff: 2000, run: 0, goLiveMonth: "2027-06" }),
];

test("i risultati: stimato su tutto, in uso sui realizzati, per dipendente e sul ricavo", () => {
  const r = programResults(CARDS, { employees: 100, revenueEur: 10_000_000 });
  assert.equal(r.estimated, 30_000 + 3000 + 20_000 + 47_000);
  assert.equal(r.estimatedCount, 4);
  assert.equal(r.inUse, 33_000);
  assert.equal(r.inUseCount, 2);
  assert.equal(r.firstGoLive, null);
  assert.equal(r.perEmployee, 330);
  assert.ok(Math.abs((r.perEmployeeOfRevenuePct ?? 0) - 0.33) < 1e-9);
});

test("senza nessuno in uso: il primo mese previsto; senza dipendenti niente per dipendente", () => {
  const r = programResults(CARDS.filter((c) => c.stage !== "in_uso"), { employees: null, revenueEur: 5_000_000 });
  assert.equal(r.inUse, 0);
  assert.equal(r.firstGoLive, "2027-01");
  assert.equal(r.perEmployee, null);
  assert.equal(r.perEmployeeOfRevenuePct, null);
});

test("le iniziative: tre righe nell'ordine, somme delle cifre arrotondate, mai un netto", () => {
  const rows = programInitiatives(CARDS);
  assert.deepEqual(rows.map((r) => [r.stage, r.count, r.value, r.oneoff, r.run, r.lsDev]), [
    ["in_uso", 2, 33_000, 6000, 4000, 0],
    ["in_realizzazione", 1, 20_000, 4000, 600, 0],
    ["da_avviare", 2, 47_000, 11_000, 1200, 7050],
  ]);
  assert.deepEqual(rows[0].cards.map((c) => c.id), ["u1", "u2"]);
  assert.deepEqual(programInitiatives([]), []);
});

test("da rivedere: in uso, con mantenimento, sotto 2 € di valore per euro", () => {
  const review = agentsToReview(CARDS);
  assert.deepEqual(review.map((r) => [r.card.id, r.ratio]), [["u2", 1.5]]);
  assert.deepEqual(agentsToReview([card({ id: "x", stage: "in_uso", value: 100, run: 0 })]), []);
});

test("l'indice: media pesata dei pilastri con dati; chi manca non conta e dice perché", () => {
  const results = programResults(CARDS, { employees: 200, revenueEur: null });
  const index = aiNativeIndex({ cards: CARDS, results, trained: 50, employees: 200, weeklyUsePct: null, readinessAdoption: 2.5 });
  const by = Object.fromEntries(index.pillars.map((p) => [p.pillar, p]));
  assert.equal(by.persone.score, 25);
  assert.ok(Math.abs((by.use_case.score ?? 0) - ((1 + 1 + 2 / 3 + 1 / 3 + 1 / 3) / 5) * 100) < 1e-9);
  assert.ok(Math.abs((by.valore.score ?? 0) - (33_000 / 100_000) * 100) < 1e-9);
  assert.equal(by.adozione.score, 50);
  assert.equal(by.adozione.source, "ai_readiness");
  const expected = Math.round((25 + by.use_case.score! + by.valore.score! + 50) / 4);
  assert.equal(index.value, expected);

  const missing = aiNativeIndex({ cards: CARDS, results, trained: 50, employees: null, weeklyUsePct: 40, readinessAdoption: 2.5 });
  const m = Object.fromEntries(missing.pillars.map((p) => [p.pillar, p]));
  assert.equal(m.persone.score, null);
  assert.equal(m.persone.gap, "dipendenti");
  assert.equal(m.adozione.score, 40, "il KPI scritto a mano prima dell'AI Readiness");
  assert.equal(m.adozione.source, "kpi");
  assert.equal(missing.value, Math.round((m.use_case.score! + m.valore.score! + 40) / 3));

  const none = aiNativeIndex({ cards: [], results: { estimated: 0, inUse: 0 }, trained: null, employees: null, weeklyUsePct: null, readinessAdoption: null });
  assert.equal(none.value, null);
  assert.deepEqual(none.pillars.map((p) => p.gap), ["dipendenti", "use_case", "valore", "adozione"]);
});

test("i pesi: numeri da 0 a 100, il resto predefinito; un peso zero toglie il pilastro", () => {
  assert.deepEqual(indexWeightsOf(null), DEFAULT_INDEX_WEIGHTS);
  assert.deepEqual(indexWeightsOf({ persone: 40, valore: -1, adozione: 500 }), { persone: 40, use_case: 25, valore: 25, adozione: 25 });
  const index = aiNativeIndex({ cards: CARDS, results: { estimated: 100, inUse: 100 }, trained: 0, employees: 10, weeklyUsePct: null, readinessAdoption: null, weights: { persone: 0, use_case: 0 } });
  assert.equal(index.value, 100, "conta solo il valore");
});

test("i livelli: mai un gruppo sotto 5, nemmeno per sottrazione", () => {
  assert.equal(levelDistribution([1, 2, 2, 3], 3), null, "mai sotto 5, anche se la soglia è più bassa");
  assert.equal(levelDistribution(Array(8).fill(2), 10), null);
  const six = levelDistribution([...Array(6).fill(2), ...Array(5).fill(3)], 5)!;
  assert.equal(six.grouped, false);
  assert.deepEqual(six.bars.map((b) => [b.label, b.count]), [["Livello 0", 0], ["Livello 1", 0], ["Livello 2", 6], ["Livello 3", 5], ["Livello 4", 0], ["Livello 5", 0]]);
  // Cinque al livello 2 e uno al livello 4: per livello si ricaverebbe la persona; a coppie 2–3 ha 5, 4–5 ha 1: niente.
  assert.equal(levelDistribution([...Array(5).fill(2), 4], 5), null);
  const pairs = levelDistribution([...Array(4).fill(2), ...Array(2).fill(3), ...Array(5).fill(5)], 5)!;
  assert.equal(pairs.grouped, true);
  assert.deepEqual(pairs.bars.map((b) => [b.label, b.count]), [["Livelli 0–1", 0], ["Livelli 2–3", 6], ["Livelli 4–5", 5]]);
  assert.equal(pairs.total, 11);
  for (const bar of [...six.bars, ...pairs.bars]) assert.ok(bar.count === 0 || bar.count >= 5);
});
