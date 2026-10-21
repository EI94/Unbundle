import test from "node:test";
import assert from "node:assert/strict";
import { COST_BANDS, resolveCostBands } from "../../lib/use-cases/cost-bands.ts";
import { costColumns } from "../../lib/use-cases/inputs.ts";
import type { CostFigure } from "../../lib/use-cases/valuation.ts";
import {
  COST_FIELD_NAME,
  COST_INPUT_TEXT,
  bandOptions,
  chooseBand,
  clearCost,
  costFormValue,
  costInputValue,
  hasCostValue,
  initialCostInputState,
  parseEuroInput,
  readCostFormValue,
  setAmountText,
  switchToAmount,
  switchToBand,
  type CostInputState,
} from "./cost-input-state.ts";

// Campo «Costo di realizzazione»: docs/use-case/DESIGN.md §5.4 e §7.2 (D5, D15); PIANO-LAVORI H2d.

const ERROR = "Scrivi un importo in euro, senza decimali (es. 40000).";

const WORKSPACE_BANDS = resolveCostBands({
  costBands: {
    limits: [15_000, 40_000, 90_000, 200_000],
    labels: ["Piccolo", "Da 15.000 a 40.000 €", "Da 40.000 a 90.000 €", "Da 90.000 a 200.000 €", "Oltre 200.000 €"],
    topReferenceEur: 300_000,
  },
});

test("testi esatti del campo (§5.4)", () => {
  assert.deepEqual(COST_INPUT_TEXT, {
    label: "Costo di realizzazione (una tantum)",
    amountHelp: "Quanto costa costruirlo, una volta sola. Non contare i costi annui.",
    amountPlaceholder: "es. 40000",
    amountSuffix: "€",
    toBand: "Non sai l'importo? Scegli una fascia",
    bandHelp: "Scegli la fascia più vicina.",
    toAmount: "Ho un importo preciso",
    clear: "Togli il costo",
    amountError: ERROR,
  });
  assert.equal(COST_FIELD_NAME, "cost");
});

test("parseEuroInput: intero da 0 a 100.000.000, con i punti delle migliaia; errore di §5.4", () => {
  assert.deepEqual(parseEuroInput("40000"), { ok: true, value: 40_000 });
  assert.deepEqual(parseEuroInput("40.000"), { ok: true, value: 40_000 });
  assert.deepEqual(parseEuroInput(" 1.250.000 "), { ok: true, value: 1_250_000 });
  assert.deepEqual(parseEuroInput("0"), { ok: true, value: 0 });
  assert.deepEqual(parseEuroInput("100000000"), { ok: true, value: 100_000_000 });
  assert.deepEqual(parseEuroInput(""), { ok: true, value: null });
  assert.deepEqual(parseEuroInput("   "), { ok: true, value: null });
  for (const bad of ["40000,50", "40.5", "40,000", "-100", "+100", "1e5", "quarantamila", "40 000", "100000001", "40.00", "€ 40000"]) {
    assert.deepEqual(parseEuroInput(bad), { ok: false, message: ERROR }, bad);
  }
});

test("le 5 etichette vengono da `bands`: predefinite e del workspace", () => {
  assert.deepEqual(
    bandOptions().map((o) => `${o.symbol} ${o.label}`),
    ["€ Fino a 25.000 €", "€€ Da 25.000 a 65.000 €", "€€€ Da 65.000 a 130.000 €", "€€€€ Da 130.000 a 250.000 €", "€€€€€ 250.000 € e oltre"],
  );
  assert.deepEqual(bandOptions(COST_BANDS), bandOptions());
  assert.deepEqual(
    bandOptions(WORKSPACE_BANDS).map((o) => [o.value, o.symbol, o.label]),
    [
      ["1", "€", "Piccolo"],
      ["2", "€€", "Da 15.000 a 40.000 €"],
      ["3", "€€€", "Da 40.000 a 90.000 €"],
      ["4", "€€€€", "Da 90.000 a 200.000 €"],
      ["5", "€€€€€", "Oltre 200.000 €"],
    ],
  );
  assert.deepEqual(bandOptions([]), bandOptions(), "senza 5 fasce valgono le predefinite");
});

test("stato di partenza: dall'importo salvato, dalla fascia salvata, oppure vuoto", () => {
  assert.deepEqual(initialCostInputState(), { mode: "importo", amountText: "", band: null });
  assert.deepEqual(initialCostInputState(null), { mode: "importo", amountText: "", band: null });
  assert.deepEqual(initialCostInputState({ costEurOnce: 40_000, costBand: null }), { mode: "importo", amountText: "40000", band: null });
  assert.deepEqual(initialCostInputState({ costEurOnce: null, costBand: 3 }), { mode: "fascia", amountText: "", band: 3 });
  assert.deepEqual(initialCostInputState({ eurOnce: 18_500 }), { mode: "importo", amountText: "18500", band: null });
  assert.deepEqual(initialCostInputState({ band: 2 }), { mode: "fascia", amountText: "", band: 2 });
  assert.deepEqual(initialCostInputState({ costEurOnce: 40_000, costBand: 3 }), { mode: "importo", amountText: "40000", band: null }, "vince l'importo");
  assert.deepEqual(initialCostInputState({ costBand: 7 }), { mode: "importo", amountText: "", band: null }, "una fascia fuori da 1-5 non vale");
  assert.deepEqual(initialCostInputState({ costEurOnce: -5 }), { mode: "importo", amountText: "", band: null });
});

test("la cifra a schermo (CostFigure) non è il costo del team: rifiutata dal tipo e ignorata", () => {
  // Importo del team di 40.000 €: la cifra ha anche la fascia derivata (2).
  const teamAmount: CostFigure = { source: "team_importo", amount: 40_000, band: 2, bandLabel: "Da 25.000 a 65.000 €", fromBand: false, position: 2.4, referenceEur: 40_000 };
  // Costo dallo sforzo, senza costo del team: la cifra ha una fascia, il team no.
  const effort: CostFigure = { source: "sforzo", amount: null, band: 3, fromBand: true, position: 3, referenceEur: 90_000 };
  // @ts-expect-error una CostFigure non è un SavedCost
  initialCostInputState(teamAmount);
  // @ts-expect-error nemmeno quella dello sforzo
  initialCostInputState(effort);
  const empty = { mode: "importo", amountText: "", band: null };
  for (const figure of [teamAmount, effort]) {
    const state = initialCostInputState(figure as never);
    assert.deepEqual(state, empty, figure.source);
    assert.equal(costFormValue(state), "", `${figure.source}: salvare senza toccare il campo non scrive cost_band`);
  }
  // Una riga della scheda, con le sue altre colonne (anche `source`), resta un punto di partenza valido.
  const row = { id: "uc-1", source: "web_proposed", title: "Sintetico", costEurOnce: null, costBand: 4 };
  assert.deepEqual(initialCostInputState(row), { mode: "fascia", amountText: "", band: 4 });
});

test("da importo a fascia e ritorno: la fascia dell'importo è già scelta, il testo resta", () => {
  let state = setAmountText(initialCostInputState(), "40.000");
  assert.deepEqual(costInputValue(state), { ok: true, value: { eurOnce: 40_000 } });
  state = switchToBand(state);
  assert.equal(state.mode, "fascia");
  assert.equal(state.band, 2, "40.000 € è €€ con le fasce predefinite");
  assert.deepEqual(costInputValue(state), { ok: true, value: { band: 2 } }, "in modo fascia conta solo la fascia");
  state = switchToAmount(state);
  assert.equal(state.amountText, "40.000");
  assert.deepEqual(costInputValue(state), { ok: true, value: { eurOnce: 40_000 } }, "tornando all'importo conta solo l'importo");
  // Con le fasce del workspace lo stesso importo cade in un'altra fascia.
  assert.equal(switchToBand(setAmountText(initialCostInputState(), "40000"), WORKSPACE_BANDS).band, 2);
  assert.equal(switchToBand(setAmountText(initialCostInputState(), "50000"), WORKSPACE_BANDS).band, 3);
  assert.equal(switchToBand(setAmountText(initialCostInputState(), "50000")).band, 2);
  assert.equal(switchToBand(setAmountText(initialCostInputState(), "1.000.000")).band, 5);
  // Senza un importo valido resta la fascia scelta prima.
  const chosen = chooseBand(initialCostInputState(), "4");
  assert.equal(switchToBand(switchToAmount(chosen)).band, 4);
  assert.equal(switchToBand(setAmountText(chosen, "40,5")).band, 4);
  assert.equal(switchToBand(initialCostInputState()).band, null);
});

test("si salva sempre l'indice della fascia, mai l'etichetta né i confini", () => {
  const state = chooseBand(initialCostInputState(), "2");
  for (const bands of [COST_BANDS, WORKSPACE_BANDS]) {
    // Le fasce cambiano solo le etichette: il valore è lo stesso indice.
    assert.deepEqual(costInputValue(switchToBand(state, bands)), { ok: true, value: { band: 2 } });
  }
  assert.equal(costFormValue(state), '{"band":2}');
  assert.deepEqual(costColumns({ band: 2 }), { costEurOnce: null, costBand: 2 });
  assert.equal(chooseBand(initialCostInputState(), 3).band, 3);
  assert.equal(chooseBand(initialCostInputState(), "Da 25.000 a 65.000 €").band, null, "un'etichetta non è una scelta");
  assert.equal(chooseBand(initialCostInputState(), 6).band, null);
  assert.equal(chooseBand(initialCostInputState(), "0").band, null);
});

test("il campo non manda mai importo e fascia insieme", () => {
  const states: CostInputState[] = [
    { mode: "importo", amountText: "40000", band: 3 },
    { mode: "fascia", amountText: "40000", band: 3 },
    { mode: "importo", amountText: "", band: 3 },
    { mode: "fascia", amountText: "40000", band: null },
    { mode: "importo", amountText: "40,5", band: 2 },
  ];
  for (const state of states) {
    const result = costInputValue(state);
    if (result.ok && result.value !== null) assert.ok(!("eurOnce" in result.value && "band" in result.value), JSON.stringify(state));
    const form = costFormValue(state);
    if (form) {
      const data = JSON.parse(form) as Record<string, unknown>;
      assert.equal(Object.keys(data).length, 1, form);
    }
  }
  assert.deepEqual(costInputValue(states[0]), { ok: true, value: { eurOnce: 40_000 } }, "un importo scritto sostituisce la fascia");
  assert.deepEqual(costInputValue(states[1]), { ok: true, value: { band: 3 } });
  assert.deepEqual(costInputValue(states[2]), { ok: true, value: { band: 3 } }, "importo vuoto: resta la fascia scelta prima, non c'è nessun costo solo senza fascia");
  assert.deepEqual(costInputValue(states[3]), { ok: true, value: null }, "nessuna fascia: nessun costo, anche con un importo scritto prima");
  assert.deepEqual(costInputValue(states[4]), { ok: false, message: ERROR });
});

test("fascia salvata, poi «Ho un importo preciso» senza scrivere: la fascia resta finché non si scrive un importo", () => {
  const saved = initialCostInputState({ costEurOnce: null, costBand: 3 });
  const toAmount = switchToAmount(saved);
  assert.deepEqual(toAmount, { mode: "importo", amountText: "", band: 3 });
  assert.deepEqual(costInputValue(toAmount), { ok: true, value: { band: 3 } });
  assert.equal(costFormValue(toAmount), '{"band":3}');
  assert.deepEqual(readCostFormValue(costFormValue(toAmount)), { ok: true, value: { band: 3 } });
  assert.deepEqual(costColumns({ band: 3 }), { costEurOnce: null, costBand: 3 }, "salvando, cost_band resta 3");
  assert.equal(hasCostValue(toAmount), true, "«Togli il costo» si vede: c'è la fascia da togliere");
  // Scrivere un importo la sostituisce; svuotare di nuovo il campo la riporta.
  const typed = setAmountText(toAmount, "18.500");
  assert.deepEqual(costInputValue(typed), { ok: true, value: { eurOnce: 18_500 } });
  assert.deepEqual(costInputValue(setAmountText(typed, "")), { ok: true, value: { band: 3 } });
  // Solo «Togli il costo» toglie il costo.
  const cleared = clearCost(toAmount);
  assert.deepEqual(costInputValue(cleared), { ok: true, value: null });
  assert.equal(costFormValue(cleared), "");
  assert.equal(hasCostValue(cleared), false);
});

test("campo nascosto del modulo: costFormValue e readCostFormValue si capiscono", () => {
  const cases: Array<[CostInputState, string, unknown]> = [
    [{ mode: "importo", amountText: "40.000", band: null }, '{"eurOnce":40000}', { eurOnce: 40_000 }],
    [{ mode: "fascia", amountText: "", band: 5 }, '{"band":5}', { band: 5 }],
    [{ mode: "importo", amountText: "", band: null }, "", null],
    [{ mode: "fascia", amountText: "", band: null }, "", null],
  ];
  for (const [state, form, value] of cases) {
    assert.equal(costFormValue(state), form);
    assert.deepEqual(readCostFormValue(form), { ok: true, value });
  }
  // Un importo non valido arriva com'è scritto e l'action risponde con lo stesso errore.
  const invalid = costFormValue({ mode: "importo", amountText: " 40,5 ", band: null });
  assert.equal(invalid, '{"eurOnce":"40,5"}');
  assert.deepEqual(readCostFormValue(invalid), { ok: false, message: ERROR });
  // Campo assente, non JSON, importo e fascia insieme: rifiutati o «nessun costo».
  assert.deepEqual(readCostFormValue(null), { ok: true, value: null });
  assert.deepEqual(readCostFormValue(undefined), { ok: true, value: null });
  assert.deepEqual(readCostFormValue("   "), { ok: true, value: null });
  assert.deepEqual(readCostFormValue("40000"), { ok: false, message: ERROR }, "un numero da solo non è la forma del campo");
  assert.deepEqual(readCostFormValue('{"importo":40000}'), { ok: false, message: "Campo non previsto." });
  assert.deepEqual(readCostFormValue("{"), { ok: false, message: ERROR });
  assert.deepEqual(readCostFormValue('{"eurOnce":40000,"band":2}'), { ok: false, message: "Indica un importo oppure una fascia, non tutti e due." });
  assert.deepEqual(readCostFormValue('{"band":9}'), { ok: false, message: "Scegli una fascia da 1 a 5." });
  assert.deepEqual(readCostFormValue({ band: 2 }), { ok: false, message: ERROR }, "solo testo, come da un modulo");
});

test("«Togli il costo»: compare solo con un valore e svuota il modo in cui si è", () => {
  const amount = setAmountText(initialCostInputState(), "40000");
  assert.equal(hasCostValue(amount), true);
  assert.deepEqual(clearCost(amount), { mode: "importo", amountText: "", band: null });
  assert.equal(hasCostValue(clearCost(amount)), false);
  const band = chooseBand(initialCostInputState(), 2);
  assert.equal(hasCostValue(band), true);
  assert.deepEqual(clearCost(band), { mode: "fascia", amountText: "", band: null });
  assert.equal(costFormValue(clearCost(band)), "");
  assert.equal(hasCostValue(initialCostInputState()), false);
  assert.equal(hasCostValue(setAmountText(initialCostInputState(), "  ")), false);
  assert.equal(hasCostValue({ mode: "fascia", amountText: "40000", band: null }), false, "in modo fascia conta solo la fascia");
  assert.equal(hasCostValue({ mode: "importo", amountText: "", band: 2 }), true, "in modo importo conta anche la fascia che resta");
  assert.equal(hasCostValue({ mode: "importo", amountText: " ", band: null }), false);
});
