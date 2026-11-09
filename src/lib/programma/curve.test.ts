import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_VALUE_PARAMS, valueModelSchema, type ValueModel, type ValueParams } from "../use-cases/value-model.ts";
import type { HubItem } from "../use-cases/views.ts";
import {
  NO_PROGRAM_COSTS,
  breakevenOf,
  lsDevAmount,
  programCards,
  programCurve,
  supportOfMonth,
  supportPerYearByCard,
  supportSplit,
  type ProgramCosts,
} from "./curve.ts";

// La curva della pagina «Programma» (rilascio 7): valore e costo cumulati, i costi di Lateral Space
// (canone diviso tra i casi partiti, sviluppo al posto dei giorni di sviluppo). Dati sintetici.

const TODAY = "2026-11-09";
const PARAMS: ValueParams = { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11", dayCostEur: 500, hourlyCostEur: 40, horizonMonths: 12, buildMonths: 2, rampMonths: 1 };

function model(eurYear: number, costs = { devDays: 10, internalHours: 20, runCostEurYear: 1200 }, plan?: ValueModel["plan"]): ValueModel {
  return valueModelSchema.parse({
    v: 1,
    primary: "costi",
    components: [{ key: "costi", lever: "costi", label: "Meno licenze", kind: "euro", eurYear, confidence: "ipotesi" }],
    costs,
    ...(plan ? { plan } : {}),
  });
}

function item(over: Partial<HubItem> & Pick<HubItem, "id" | "phase">): HubItem {
  const valueModel = over.valueModel === undefined ? null : over.valueModel;
  const perYear = valueModel ? { amount: valueModel.components.reduce((s, c) => s + (c.kind === "euro" ? c.eurYear : 0), 0), source: "stima" } : null;
  return {
    code: over.id.toUpperCase(),
    title: `Use case ${over.id}`,
    kind: "da_costruire",
    targetQuarter: null,
    value: { score: null, word: null, source: null, perYear },
    cost: null,
    realizedOn: null,
    ...over,
    valueModel,
  } as unknown as HubItem;
}

const costs = (over: Partial<ProgramCosts> = {}): ProgramCosts => ({ ...NO_PROGRAM_COSTS, caseDev: new Map(), ...over });

test("le schede: solo approvati, in realizzazione e realizzati; avvio da giorni e ore, ricorrenti dal modello", () => {
  const items = [
    item({ id: "a", phase: "approvato", targetQuarter: "2027-Q1", valueModel: model(12_000) }),
    item({ id: "b", phase: "in_realizzazione", valueModel: model(24_000) }),
    item({ id: "c", phase: "da_valutare", valueModel: model(50_000) }),
    item({ id: "d", phase: "chiuso", valueModel: model(50_000) }),
  ];
  const { cards, origin, end } = programCards(items, PARAMS, costs(), TODAY);
  assert.deepEqual(cards.map((c) => [c.id, c.stage]), [["a", "da_avviare"], ["b", "in_realizzazione"]]);
  const a = cards[0];
  assert.equal(a.value, 12_000);
  assert.equal(a.oneoff, 10 * 500 + 20 * 40);
  assert.equal(a.run, 1200);
  assert.equal(a.startMonth, "2027-01");
  assert.equal(a.goLiveMonth, "2027-03");
  assert.equal(origin, "2026-11");
  assert.equal(end, "2027-11");
});

test("una best practice da diffondere non paga l'avvio, ma porta valore e ricorrenti", () => {
  const { cards } = programCards([item({ id: "a", phase: "approvato", kind: "da_diffondere", valueModel: model(6000) })], PARAMS, costs(), TODAY);
  assert.equal(cards[0].oneoff, 0);
  assert.equal(cards[0].run, 1200);
});

test("lo sviluppo di Lateral Space sostituisce i giorni di sviluppo, a percentuale o a importo", () => {
  const items = [
    item({ id: "a", phase: "approvato", targetQuarter: "2027-Q1", valueModel: model(20_000) }),
    item({ id: "b", phase: "approvato", targetQuarter: "2027-Q1", valueModel: model(20_000) }),
    item({ id: "c", phase: "approvato", targetQuarter: "2027-Q1", valueModel: model(20_000) }),
  ];
  const caseDev = new Map([
    ["a", { mode: "percentuale" as const, amountEur: null }],
    ["b", { mode: "importo" as const, amountEur: 4000 }],
  ]);
  const { cards } = programCards(items, PARAMS, costs({ devPct: 15, caseDev }), TODAY);
  const byId = Object.fromEntries(cards.map((c) => [c.id, c]));
  assert.equal(byId.a.lsDev, 3000);
  assert.equal(byId.a.oneoff, 3000 + 20 * 40, "le ore interne restano, i giorni di sviluppo no");
  assert.equal(byId.b.lsDev, 4000);
  assert.equal(byId.b.oneoff, 4000 + 800);
  assert.equal(byId.c.lsDev, 0);
  assert.equal(byId.c.oneoff, 5000 + 800);
});

test("a percentuale senza la percentuale del workspace lo sviluppo vale zero e lo dice", () => {
  assert.deepEqual(lsDevAmount({ mode: "percentuale", amountEur: null }, 10_000, null), { amount: 0, missingPct: true });
  assert.deepEqual(lsDevAmount({ mode: "percentuale", amountEur: null }, 10_000, 10), { amount: 1000, missingPct: false });
  assert.equal(lsDevAmount(undefined, 10_000, 10), null);
});

test("senza «Benefici e costi»: il valore della card e il costo della card", () => {
  const raw = item({ id: "a", phase: "approvato", targetQuarter: "2027-Q1" });
  (raw as { value: unknown }).value = { score: null, word: null, source: "team", perYear: { amount: 9600, source: "team" } };
  (raw as { cost: unknown }).cost = { source: "team", amount: 3000, referenceEur: 3000, fromBand: false, runEurYear: null, position: 2, band: 2 };
  const { cards } = programCards([raw], PARAMS, costs(), TODAY);
  assert.equal(cards[0].value, 9600);
  assert.equal(cards[0].oneoff, 3000);
  assert.equal(cards[0].hasModel, false);
});

test("un realizzato entra in uso nel mese di «Realizzato», dopo i mesi di avvio; la curva parte da lì", () => {
  const items = [item({ id: "r", phase: "realizzato", realizedOn: "2026-08-20" as HubItem["realizedOn"], valueModel: model(12_000) })];
  const result = programCards(items, PARAMS, costs(), TODAY);
  assert.equal(result.cards[0].goLiveMonth, "2026-08");
  assert.equal(result.cards[0].startMonth, "2026-06");
  assert.equal(result.origin, "2026-06");
  const curve = programCurve(result, PARAMS, costs(), TODAY);
  assert.equal(curve.months[curve.today], "2026-11");
  // Agosto, settembre e ottobre in uso, a regime subito (rampa 1): 3 mesi × 1.000 €.
  assert.equal(curve.value[curve.today], 3000);
  assert.equal(curve.cost[curve.today], 5800 + 3 * 100);
});

test("valore e costo cumulati, con il pareggio quando il valore raggiunge il costo", () => {
  const items = [item({ id: "b", phase: "in_realizzazione", valueModel: model(24_000, { devDays: 4, internalHours: 0, runCostEurYear: 0 }) })];
  const curve = programCurve(programCards(items, PARAMS, costs(), TODAY), PARAMS, costs(), TODAY);
  // Avvio 2.000 € in nov e dic, poi 2.000 € al mese da gennaio.
  assert.deepEqual(curve.cost.slice(0, 4), [0, 1000, 2000, 2000]);
  assert.deepEqual(curve.value.slice(0, 4), [0, 0, 0, 2000]);
  assert.deepEqual(curve.breakeven, { kind: "mese", index: 3, month: "2027-02" });
});

test("il canone: ogni mese tra inizio e fine, nel costo", () => {
  const c = costs({ supportMonthEur: 4000, supportFrom: "2026-10", supportTo: "2027-03" });
  assert.equal(supportOfMonth(c, "2026-09"), 0);
  assert.equal(supportOfMonth(c, "2026-10"), 4000);
  assert.equal(supportOfMonth(c, "2027-03"), 4000);
  assert.equal(supportOfMonth(c, "2027-04"), 0);
  const items = [item({ id: "b", phase: "in_realizzazione", valueModel: model(24_000, { devDays: 0, internalHours: 0, runCostEurYear: 0 }) })];
  const result = programCards(items, PARAMS, c, TODAY);
  assert.equal(result.origin, "2026-10", "la curva parte dall'inizio del canone");
  const curve = programCurve(result, PARAMS, c, TODAY);
  assert.equal(curve.monthly[0].support, 4000);
  assert.equal(curve.cost[curve.months.length - 1], 6 * 4000);
});

test("il canone si divide tra gli use case partiti, in proporzione al valore; senza nessuno resta del programma", () => {
  const cards = [
    { id: "a", start: 0, value: 30_000, stage: "in_uso" as const },
    { id: "b", start: 0, value: 10_000, stage: "in_realizzazione" as const },
    { id: "c", start: 5, value: 60_000, stage: "da_avviare" as const },
    { id: "d", start: 2, value: 20_000, stage: "da_avviare" as const },
  ];
  assert.deepEqual([...supportSplit(cards, 4000, 2, 2)], [["a", 3000], ["b", 1000]], "oggi: un approvato non ancora partito non ne porta");
  assert.equal(supportSplit(cards, 4000, 2, 2).get("c"), undefined, "non ancora partito: niente canone");
  assert.deepEqual([...supportSplit(cards, 6000, 3, 2)], [["a", 3000], ["b", 1000], ["d", 2000]], "dopo oggi conta l'avvio previsto");
  assert.equal(supportSplit([{ id: "z", start: 9, value: 1, stage: "da_avviare" }], 4000, 2, 2).size, 0);
  assert.equal(supportSplit(cards, 0, 2, 2).size, 0);
});

test("la parte del canone all'anno di ogni use case, al ritmo di oggi", () => {
  const c = costs({ supportMonthEur: 1000, supportFrom: "2026-11", supportTo: null });
  const items = [
    item({ id: "a", phase: "in_realizzazione", valueModel: model(30_000) }),
    item({ id: "b", phase: "in_realizzazione", valueModel: model(10_000) }),
    item({ id: "c", phase: "approvato", targetQuarter: "2027-Q2", valueModel: model(10_000) }),
  ];
  const share = supportPerYearByCard(programCards(items, PARAMS, c, TODAY), c, TODAY);
  assert.equal(share.get("a"), 9000);
  assert.equal(share.get("b"), 3000);
  assert.equal(share.get("c"), undefined);
});

test("gli scenari cambiano solo il valore di chi non è ancora in uso", () => {
  const items = [
    item({ id: "r", phase: "realizzato", realizedOn: "2026-09-01" as HubItem["realizedOn"], valueModel: model(12_000, { devDays: 0, internalHours: 0, runCostEurYear: 0 }) }),
    item({ id: "a", phase: "approvato", targetQuarter: "2027-Q1", valueModel: model(12_000, { devDays: 0, internalHours: 0, runCostEurYear: 0 }) }),
  ];
  const result = programCards(items, PARAMS, costs(), TODAY);
  const base = programCurve(result, PARAMS, costs(), TODAY, "base");
  const low = programCurve(result, PARAMS, costs(), TODAY, "prudente");
  assert.equal(low.value[low.today], base.value[base.today], "fino a oggi non cambia");
  const last = base.value.length - 1;
  const liveOnly = base.monthly.reduce((s, row, m) => s + (m >= result.cards[0].goLive ? 1000 : 0), 0);
  assert.ok(Math.abs(low.value[last] - (liveOnly + (base.value[last] - liveOnly) * 0.7)) < 1e-6);
  assert.deepEqual(low.cost, base.cost);
});

test("il pareggio: subito, oltre la fine, nessuno", () => {
  const months = ["2026-11", "2026-12", "2027-01"] as const;
  assert.deepEqual(breakevenOf([...months], [0, 10, 20], [0, 5, 10]), { kind: "subito" });
  assert.deepEqual(breakevenOf([...months], [0, 1, 2], [0, 5, 10]), { kind: "oltre", month: "2027-01" });
  assert.equal(breakevenOf([...months], [0, 0, 0], [0, 0, 0]), null);
  assert.deepEqual(breakevenOf([...months], [0, 1, 12], [0, 5, 10]), { kind: "mese", index: 2, month: "2027-01" });
});

test("la curva non parte più di 36 mesi prima di oggi", () => {
  const items = [item({ id: "r", phase: "realizzato", realizedOn: "2020-01-10" as HubItem["realizedOn"], valueModel: model(12_000) })];
  assert.equal(programCards(items, PARAMS, costs(), TODAY).origin, "2023-11");
});
