import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  bandForAmount,
  bandForEffort,
  COST_BAND_LABEL_MAX,
  COST_BANDS,
  COST_BANDS_AMOUNT_ERROR,
  COST_BANDS_LABEL_ERROR,
  COST_BANDS_LIMITS_ERROR,
  COST_BANDS_MAX_EUR,
  COST_BANDS_SHAPE_ERROR,
  COST_BANDS_TOP_REFERENCE_ERROR,
  COST_SCALE_TOP_EUR,
  costBandInfo,
  costPosition,
  DEFAULT_COST_BANDS_CONFIG,
  defaultCostBandLabels,
  effortCostEur,
  isCostBand,
  resolveCostBands,
  validateCostBands,
  type CostBandInfo,
  type CostBandsConfig,
} from "./cost-bands.ts";
import { COST_AMOUNT_ERROR } from "./inputs.ts";
import type { ScoringModelRow } from "../db/queries/scoring-model.ts";

// Le 5 fasce, la posizione in matrice e le fasce del workspace: docs/use-case/DESIGN.md §7.2
// (D5, D15), §5.4 e §14.3. Fasce del workspace sintetiche.

const table = (bands: readonly CostBandInfo[]) => bands.map((b) => [b.band, b.symbol, b.label, b.fromEur, b.toEur, b.referenceEur]);

const close = (actual: number, expected: number, label: string) =>
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: ${actual} invece di ${expected}`);

/** Fasce di un workspace inventato: confini e riferimento diversi dai predefiniti. */
const WORKSPACE: CostBandsConfig = {
  limits: [15_000, 40_000, 100_000, 200_000],
  labels: ["Piccolo", "Da 15.000 a 40.000 €", "Medio", "Grande", "Molto grande"],
  topReferenceEur: 300_000,
};
const workspaceBands = resolveCostBands({ costBands: WORKSPACE });

/** Le fasce di partenza di H1b, come fasce di un workspace: «Un importo di 30.000 € può passare da €€€ a €€». */
const H1B_BANDS: CostBandsConfig = {
  limits: [10_000, 25_000, 65_000, 130_000],
  labels: ["Fino a 10.000 €", "Da 10.000 a 25.000 €", "Da 25.000 a 65.000 €", "Da 65.000 a 130.000 €", "Oltre 130.000 €"],
  topReferenceEur: 250_000,
};

// ─── Fasce predefinite (decise il 14/10/2026) ────────────────────────

test("5 fasce predefinite: simbolo, etichetta, da, a e valore di riferimento (tabella di §7.2)", () => {
  assert.deepEqual(table(COST_BANDS), [
    [1, "€", "Fino a 25.000 €", 0, 25_000, 25_000],
    [2, "€€", "Da 25.000 a 65.000 €", 25_001, 65_000, 65_000],
    [3, "€€€", "Da 65.000 a 130.000 €", 65_001, 130_000, 130_000],
    [4, "€€€€", "Da 130.000 a 250.000 €", 130_001, 250_000, 250_000],
    [5, "€€€€€", "250.000 € e oltre", 250_001, null, 400_000],
  ]);
  assert.equal(COST_SCALE_TOP_EUR, 400_000, "A5 = riferimento della quinta");
  assert.equal(COST_BANDS[4].referenceEur, COST_SCALE_TOP_EUR);
  for (const band of [1, 2, 3, 4, 5] as const) assert.equal(costBandInfo(band).band, band);
  // La prima fascia coincide con la soglia del costo basso (25.000 €, D15).
  assert.equal(COST_BANDS[0].toEur, 25_000);
});

test("le fasce predefinite come config: 4 confini, 5 etichette, 400.000 € nei totali della quinta", () => {
  assert.deepEqual(DEFAULT_COST_BANDS_CONFIG, {
    limits: [25_000, 65_000, 130_000, 250_000],
    labels: ["Fino a 25.000 €", "Da 25.000 a 65.000 €", "Da 65.000 a 130.000 €", "Da 130.000 a 250.000 €", "250.000 € e oltre"],
    topReferenceEur: 400_000,
  });
  // La config predefinita dà esattamente COST_BANDS, ed è valida.
  assert.deepEqual(resolveCostBands({ costBands: DEFAULT_COST_BANDS_CONFIG }), COST_BANDS);
  assert.deepEqual(validateCostBands(DEFAULT_COST_BANDS_CONFIG), { ok: true, value: DEFAULT_COST_BANDS_CONFIG });
  // Le etichette predefinite sono quelle che l'editor propone per i confini predefiniti.
  assert.deepEqual(defaultCostBandLabels(DEFAULT_COST_BANDS_CONFIG.limits), DEFAULT_COST_BANDS_CONFIG.labels);
});

test("le fasce predefinite non si modificano per sbaglio", () => {
  assert.ok(Object.isFrozen(COST_BANDS));
  assert.ok(COST_BANDS.every((info) => Object.isFrozen(info)));
  assert.ok(Object.isFrozen(DEFAULT_COST_BANDS_CONFIG) && Object.isFrozen(DEFAULT_COST_BANDS_CONFIG.limits) && Object.isFrozen(DEFAULT_COST_BANDS_CONFIG.labels));
});

test("solo le fasce da 1 a 5", () => {
  for (const ok of [1, 2, 3, 4, 5]) assert.equal(isCostBand(ok), true);
  for (const bad of [0, 6, 2.5, "3", null, undefined, -1]) assert.equal(isCostBand(bad), false, String(bad));
});

test("confini: la fascia è la prima con importo ≤ A; sopra 250.000 € è la 5", () => {
  const cases: Array<[number, number]> = [
    [0, 1],
    [1, 1],
    [10_000, 1],
    [25_000, 1],
    [25_001, 2],
    [40_000, 2],
    [65_000, 2],
    [65_001, 3],
    [130_000, 3],
    [130_001, 4],
    [250_000, 4],
    [250_001, 5],
    [400_000, 5],
    [400_001, 5],
    [1_000_000, 5],
    [100_000_000, 5],
  ];
  for (const [amount, band] of cases) assert.equal(bandForAmount(amount), band, String(amount));
  // Importi con decimali (ROI del dossier): «≤ A» vale anche qui.
  assert.equal(bandForAmount(25_000.5), 2);
});

test("costPosition di un importo: da 0,5 a 5,5 con la formula di §7.2", () => {
  close(costPosition({ amount: 0 }), 0.5, "0 €");
  close(costPosition({ amount: 12_500 }), 1, "metà della prima fascia");
  close(costPosition({ amount: 25_000 }), 1.5, "25.000 €");
  close(costPosition({ amount: 25_001 }), 1.5, "25.001 €");
  close(costPosition({ amount: 40_000 }), 1.5 + (40_000 - 25_001) / (65_000 - 25_001), "40.000 €");
  close(costPosition({ amount: 65_000 }), 2.5, "65.000 €");
  close(costPosition({ amount: 130_000 }), 3.5, "130.000 €");
  close(costPosition({ amount: 250_000 }), 4.5, "250.000 €");
  close(costPosition({ amount: 250_001 }), 4.5, "250.001 €");
  close(costPosition({ amount: 325_000 }), 4.5 + (325_000 - 250_001) / (400_000 - 250_001), "325.000 €");
  close(costPosition({ amount: 400_000 }), 5.5, "400.000 € (A5)");
});

test("costPosition: importi oltre 400.000 € restano a 5,5", () => {
  for (const amount of [400_001, 500_000, 1_000_000, 100_000_000]) close(costPosition({ amount }), 5.5, String(amount));
});

test("costPosition cresce con l'importo e resta tra 0,5 e 5,5, anche coi decimali tra due fasce", () => {
  let previous = -Infinity;
  for (let amount = 0; amount <= 500_000; amount += 250) {
    const position = costPosition({ amount });
    assert.ok(position >= 0.5 && position <= 5.5, `${amount}: ${position}`);
    assert.ok(position >= previous, `${amount}: ${position} < ${previous}`);
    previous = position;
  }
  close(costPosition({ amount: 25_000.5 }), 1.5, "25.000,50 €");
});

test("costPosition di una fascia sola (team o sforzo): al centro della fascia", () => {
  for (const band of [1, 2, 3, 4, 5] as const) assert.equal(costPosition({ band }), band);
  // Il centro di una fascia sta tra le posizioni dei suoi due confini.
  for (const info of COST_BANDS) {
    const low = costPosition({ amount: info.fromEur });
    const high = costPosition({ amount: info.toEur ?? COST_SCALE_TOP_EUR });
    assert.ok(low <= info.band && info.band <= high, `fascia ${info.band}`);
  }
});

test("importi non validi: errore, mai una posizione inventata", () => {
  assert.throws(() => bandForAmount(Number.NaN), RangeError);
  assert.throws(() => costPosition({ amount: Number.POSITIVE_INFINITY }), RangeError);
  assert.throws(() => costPosition({ band: 6 as never }), RangeError);
  assert.throws(() => bandForAmount(Number.NaN, resolveCostBands({ costBands: WORKSPACE })), RangeError);
});

test("costo «da sforzo»: lo sforzo dà l'importo di oggi, l'importo dà la fascia (§7.2)", () => {
  // Con le fasce predefinite: sforzo 1 e 2 cadono in €, 3 in €€, 4 in €€€, 5 in €€€€.
  assert.deepEqual(
    [1, 1.49, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((score) => [score, effortCostEur(score), bandForEffort(score)]),
    [
      [1, 10_000, 1],
      [1.49, 10_000, 1],
      [1.5, 25_000, 1],
      [2, 25_000, 1],
      [2.5, 65_000, 2],
      [3, 65_000, 2],
      [3.5, 130_000, 3],
      [4, 130_000, 3],
      [4.5, 250_000, 4],
      [5, 250_000, 4],
    ],
  );
  for (const score of [1, 2, 3, 4, 5]) assert.equal(bandForEffort(score), bandForAmount(effortCostEur(score)), String(score));
});

test("la tabella dello sforzo è la stessa di estimateImplementationCost (planning.ts)", () => {
  // planning.ts importa moduli dell'app (`@/…`) e sotto Node puro non si carica: si
  // confrontano le soglie scritte nel sorgente. Se cambiano là, questo test lo dice.
  const source = readFileSync(new URL("../portfolio/planning.ts", import.meta.url), "utf8");
  const body = /export function estimateImplementationCost\(effortScore: number\) \{([\s\S]*?)\n\}/.exec(source)?.[1];
  assert.ok(body, "estimateImplementationCost non trovata in planning.ts");
  const thresholds = [...body.matchAll(/if \(effortScore >= ([0-9.]+)\) return ([0-9_]+);/g)].map((m) => [
    Number(m[1]),
    Number(m[2].replaceAll("_", "")),
  ]);
  const fallback = Number(/\n\s*return ([0-9_]+);\s*$/.exec(body)?.[1].replaceAll("_", ""));
  assert.deepEqual(thresholds, [
    [4.5, 250_000],
    [3.5, 130_000],
    [2.5, 65_000],
    [1.5, 25_000],
  ]);
  assert.equal(fallback, 10_000);
  for (const [threshold, eur] of thresholds) {
    assert.equal(effortCostEur(threshold), eur);
    assert.equal(effortCostEur(threshold - 0.01), thresholds.find(([t]) => t < threshold)?.[1] ?? fallback);
  }
});

// ─── Fasce del workspace (D15) ───────────────────────────────────────

test("fasce del workspace: «Da» è il confine prima più 1 euro, la quinta è aperta, simboli fissi", () => {
  assert.deepEqual(table(workspaceBands), [
    [1, "€", "Piccolo", 0, 15_000, 15_000],
    [2, "€€", "Da 15.000 a 40.000 €", 15_001, 40_000, 40_000],
    [3, "€€€", "Medio", 40_001, 100_000, 100_000],
    [4, "€€€€", "Grande", 100_001, 200_000, 200_000],
    [5, "€€€€€", "Molto grande", 200_001, null, 300_000],
  ]);
  assert.equal(costBandInfo(2, workspaceBands).label, "Da 15.000 a 40.000 €");
  assert.equal(costBandInfo(5, workspaceBands).referenceEur, 300_000, "valore nei totali della quinta");
  assert.ok(Object.isFrozen(workspaceBands));
});

test("fasce del workspace: la fascia di un importo ai confini", () => {
  const cases: Array<[number, number]> = [
    [0, 1],
    [15_000, 1],
    [15_001, 2],
    [40_000, 2],
    [40_001, 3],
    [100_000, 3],
    [100_001, 4],
    [200_000, 4],
    [200_001, 5],
    [300_001, 5],
    [100_000_000, 5],
  ];
  for (const [amount, band] of cases) assert.equal(bandForAmount(amount, workspaceBands), band, String(amount));
});

test("fasce del workspace: posizione da 0,5 a 5,5 con A5 = valore della quinta nei totali", () => {
  close(costPosition({ amount: 0 }, workspaceBands), 0.5, "0 €");
  close(costPosition({ amount: 7_500 }, workspaceBands), 1, "metà della prima fascia");
  close(costPosition({ amount: 15_000 }, workspaceBands), 1.5, "15.000 €");
  close(costPosition({ amount: 15_001 }, workspaceBands), 1.5, "15.001 €");
  close(costPosition({ amount: 200_000 }, workspaceBands), 4.5, "200.000 €");
  close(costPosition({ amount: 250_000 }, workspaceBands), 4.5 + (250_000 - 200_001) / (300_000 - 200_001), "250.000 €");
  close(costPosition({ amount: 300_000 }, workspaceBands), 5.5, "300.000 € (A5)");
  for (const amount of [300_001, 400_000, 100_000_000]) close(costPosition({ amount }, workspaceBands), 5.5, String(amount));
  for (const band of [1, 2, 3, 4, 5] as const) assert.equal(costPosition({ band }, workspaceBands), band);
  let previous = -Infinity;
  for (let amount = 0; amount <= 400_000; amount += 250) {
    const position = costPosition({ amount }, workspaceBands);
    assert.ok(position >= 0.5 && position <= 5.5 && position >= previous, `${amount}: ${position}`);
    previous = position;
  }
});

test("fasce del workspace larghe un euro: la posizione resta un numero tra 0,5 e 5,5", () => {
  const narrow = resolveCostBands({ costBands: { limits: [1, 2, 3, 4], labels: ["a", "b", "c", "d", "e"], topReferenceEur: 5 } });
  assert.notEqual(narrow, COST_BANDS);
  let previous = -Infinity;
  for (let amount = 0; amount <= 6; amount += 0.25) {
    const position = costPosition({ amount }, narrow);
    assert.ok(Number.isFinite(position) && position >= 0.5 && position <= 5.5 && position >= previous, `${amount}: ${position}`);
    previous = position;
  }
  close(costPosition({ amount: 2 }, narrow), 2.5, "fine della seconda fascia");
  close(costPosition({ amount: 1.5 }, narrow), 1.5, "tra 1 e 2 €, prima dell'inizio della seconda");
});

test("fasce del workspace: «da sforzo» con l'importo di oggi e l'indice delle fasce del workspace", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((score) => bandForEffort(score, workspaceBands)),
    [1, 2, 3, 4, 5],
    "10.000, 25.000, 65.000, 130.000 e 250.000 € nelle fasce del workspace",
  );
  // Con le fasce di partenza di H1b come fasce del workspace, lo sforzo cade dov'era: 1-5.
  assert.deepEqual([1, 2, 3, 4, 5].map((score) => bandForEffort(score, resolveCostBands({ costBands: H1B_BANDS }))), [1, 2, 3, 4, 5]);
});

test("un cambio di fasce: lo stesso cost_band si legge con l'etichetta nuova, lo stesso importo trova la fascia nuova", () => {
  const before = resolveCostBands({ costBands: H1B_BANDS });
  // cost_band = 2 resta la seconda fascia, con l'etichetta e il valore di quella del workspace.
  assert.equal(costBandInfo(2, before).label, "Da 10.000 a 25.000 €");
  assert.equal(costBandInfo(2, COST_BANDS).label, "Da 25.000 a 65.000 €");
  assert.equal(costBandInfo(2, workspaceBands).label, "Da 15.000 a 40.000 €");
  assert.deepEqual([before, COST_BANDS, workspaceBands].map((bands) => costBandInfo(2, bands).referenceEur), [25_000, 65_000, 40_000]);
  // 30.000 € passa da €€€ a €€.
  assert.equal(bandForAmount(30_000, before), 3);
  assert.equal(bandForAmount(30_000, COST_BANDS), 2);
  assert.equal(bandForAmount(30_000), 2);
});

test("config assente o non valida: le fasce predefinite, sempre COST_BANDS", () => {
  for (const model of [null, undefined, {}, { costBands: undefined }, { costBands: null }, { dimensions: {}, thresholds: {} }]) {
    assert.equal(resolveCostBands(model), COST_BANDS, JSON.stringify(model));
  }
  const invalid: unknown[] = [
    "fasce",
    42,
    [],
    {},
    { ...WORKSPACE, limits: [15_000, 15_000, 100_000, 200_000] },
    { ...WORKSPACE, limits: [...WORKSPACE.limits, 250_000] },
    { ...WORKSPACE, topReferenceEur: 200_000 },
    { ...WORKSPACE, labels: ["", ...WORKSPACE.labels.slice(1)] },
    { ...WORKSPACE, labels: WORKSPACE.labels.slice(0, 4) },
    { ...WORKSPACE, limits: [15_000.5, 40_000, 100_000, 200_000] },
    { limits: WORKSPACE.limits, labels: WORKSPACE.labels },
  ];
  for (const costBands of invalid) assert.equal(resolveCostBands({ costBands }), COST_BANDS, JSON.stringify(costBands));
});

test("resolveCostBands legge la config del modello, mai la riga del database", () => {
  // La riga di workspace_scoring_models come la restituisce getWorkspaceScoringModel: le
  // fasce stanno nel jsonb `config` (e, da H3a, in `resolvedConfig`), mai in cima alla riga.
  const rowConfig = {
    dimensions: { impact: [], feasibility: [], esg: [] },
    thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
    costBands: JSON.parse(JSON.stringify(WORKSPACE)) as unknown,
  };
  const row: ScoringModelRow = {
    id: "00000000-0000-4000-8000-000000000001",
    workspaceId: "00000000-0000-4000-8000-000000000002",
    impactFlagEnabled: false,
    config: rowConfig,
    updatedByUserId: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    resolvedConfig: {
      dimensions: { impact: [], feasibility: [], esg: [] },
      overall: { impact: 0.5, feasibility: 0.5, esg: 0.2 },
      thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
    },
  };
  // `npm run typecheck` controlla che la riga intera non compili: non ha nessuna chiave del modello.
  // @ts-expect-error la riga non è la config del modello
  assert.equal(resolveCostBands(row), COST_BANDS, "a runtime la riga non ha costBands: le predefinite");
  assert.deepEqual(resolveCostBands(row.config), workspaceBands);
  assert.deepEqual(resolveCostBands({ ...row.resolvedConfig, costBands: rowConfig.costBands }), workspaceBands);
});

test("le fasce risolte, rimesse in costBands, danno le stesse fasce, anche dopo il jsonb", () => {
  for (const bands of [COST_BANDS, workspaceBands, resolveCostBands({ costBands: H1B_BANDS })]) {
    assert.deepEqual(resolveCostBands({ costBands: bands }), bands);
    assert.deepEqual(resolveCostBands({ costBands: JSON.parse(JSON.stringify(bands)) }), bands);
  }
  // Si rileggono con la stessa validazione: fasce risolte sbagliate danno le predefinite.
  const broken: unknown[] = [
    workspaceBands.slice(0, 4),
    [workspaceBands[1], workspaceBands[0], ...workspaceBands.slice(2)],
    [null, ...workspaceBands.slice(1)],
    [...workspaceBands.slice(0, 4), { ...workspaceBands[4], toEur: 400_000 }],
    [...workspaceBands.slice(0, 4), { ...workspaceBands[4], referenceEur: 150_000 }],
    workspaceBands.map((info) => (info.band === 3 ? { ...info, toEur: 10_000 } : info)),
    workspaceBands.map((info) => (info.band === 1 ? { ...info, label: "" } : info)),
  ];
  for (const costBands of broken) assert.equal(resolveCostBands({ costBands }), COST_BANDS, JSON.stringify(costBands));
});

// ─── Validazione (§7.2, testi di §14.3) ──────────────────────────────

const fieldErrorsOf = (input: unknown) => {
  const result = validateCostBands(input);
  assert.equal(result.ok, false, JSON.stringify(input));
  return result.ok ? {} : result.fieldErrors;
};

test("validazione: testi esatti di §14.3, e l'importo con il testo del campo costo (§5.4)", () => {
  assert.equal(COST_BANDS_LIMITS_ERROR, "I confini devono crescere da una fascia all'altra.");
  assert.equal(COST_BANDS_TOP_REFERENCE_ERROR, "Il valore nei totali della quinta fascia deve superare il quarto confine.");
  assert.equal(COST_BANDS_LABEL_ERROR, "Scrivi un'etichetta di massimo 40 caratteri.");
  assert.equal(COST_BANDS_AMOUNT_ERROR, COST_AMOUNT_ERROR);
  assert.equal(COST_BANDS_MAX_EUR, 100_000_000);
  assert.equal(COST_BAND_LABEL_MAX, 40);
});

test("validazione: fasce valide, anche con i numeri scritti nel campo («25.000») e gli spazi", () => {
  assert.deepEqual(validateCostBands(WORKSPACE), { ok: true, value: WORKSPACE });
  assert.deepEqual(
    validateCostBands({
      limits: ["15.000", "40000", 100_000, " 200.000 "],
      labels: ["  Piccolo ", "Da 15.000 a 40.000 €", "Medio", "Grande", "Molto grande"],
      topReferenceEur: "300.000",
      altro: "si ignora",
    }),
    { ok: true, value: WORKSPACE },
  );
  // Ai limiti: confine 1, valore della quinta 100.000.000, etichetta di 40 caratteri.
  const edge = { limits: [1, 2, 3, 99_999_999], labels: ["a", "b", "c", "d", "x".repeat(40)], topReferenceEur: 100_000_000 };
  assert.deepEqual(validateCostBands(edge), { ok: true, value: edge });
  // 40 caratteri con l'euro: contano i caratteri, non i byte.
  assert.equal(validateCostBands({ ...WORKSPACE, labels: ["€".repeat(40), ...WORKSPACE.labels.slice(1)] }).ok, true);
});

test("validazione: confini non crescenti", () => {
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, limits: [15_000, 15_000, 100_000, 200_000] }), { "limits.1": COST_BANDS_LIMITS_ERROR });
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, limits: [40_000, 15_000, 100_000, 200_000] }), { "limits.1": COST_BANDS_LIMITS_ERROR });
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, limits: [15_000, 40_000, 300_000, 200_000], topReferenceEur: 400_000 }), {
    "limits.3": COST_BANDS_LIMITS_ERROR,
  });
  // La prima fascia parte da 0: il primo confine è almeno 1 euro.
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, limits: [0, 40_000, 100_000, 200_000] }), { "limits.0": COST_BANDS_LIMITS_ERROR });
  // Un confine sbagliato non trascina gli altri: si confronta con l'ultimo valido.
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, limits: [15_000, "tanti", 100_000, 200_000] }), { "limits.1": COST_BANDS_AMOUNT_ERROR });
});

test("validazione: la quinta fascia non ha un tetto", () => {
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, limits: [15_000, 40_000, 100_000, 200_000, 300_000] }), { limits: COST_BANDS_SHAPE_ERROR });
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, limits: [15_000, 40_000, 100_000] }), { limits: COST_BANDS_SHAPE_ERROR });
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, limits: "15000" }), { limits: COST_BANDS_SHAPE_ERROR });
});

test("validazione: il valore della quinta nei totali supera il quarto confine e non va oltre 100.000.000", () => {
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, topReferenceEur: 200_000 }), { topReferenceEur: COST_BANDS_TOP_REFERENCE_ERROR });
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, topReferenceEur: 150_000 }), { topReferenceEur: COST_BANDS_TOP_REFERENCE_ERROR });
  assert.equal(validateCostBands({ ...WORKSPACE, topReferenceEur: 200_001 }).ok, true);
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, topReferenceEur: 100_000_001 }), { topReferenceEur: COST_BANDS_AMOUNT_ERROR });
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, topReferenceEur: undefined }), { topReferenceEur: COST_BANDS_AMOUNT_ERROR });
});

test("validazione: confini e valore della quinta sono importi interi in euro", () => {
  for (const bad of [25_000.5, -1, Number.NaN, Number.POSITIVE_INFINITY, "25,000", "25000,00", "2.5", "€ 25000", "", null, true, 100_000_001]) {
    assert.deepEqual(
      fieldErrorsOf({ ...WORKSPACE, limits: [bad, 40_000, 100_000, 200_000] }),
      { "limits.0": COST_BANDS_AMOUNT_ERROR },
      String(bad),
    );
  }
});

test("validazione: etichetta vuota o oltre 40 caratteri", () => {
  const labels = (index: number, label: unknown) => WORKSPACE.labels.map((l, i) => (i === index ? label : l));
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, labels: labels(0, "") }), { "labels.0": COST_BANDS_LABEL_ERROR });
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, labels: labels(2, "   ") }), { "labels.2": COST_BANDS_LABEL_ERROR });
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, labels: labels(4, "x".repeat(41)) }), { "labels.4": COST_BANDS_LABEL_ERROR });
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, labels: labels(3, 3) }), { "labels.3": COST_BANDS_LABEL_ERROR });
  assert.deepEqual(fieldErrorsOf({ ...WORKSPACE, labels: [...WORKSPACE.labels, "sesta"] }), { labels: COST_BANDS_SHAPE_ERROR });
});

test("validazione: tutti gli errori per campo insieme; forma sbagliata", () => {
  assert.deepEqual(
    fieldErrorsOf({ limits: [15_000, 10_000, 100_000, 200_000], labels: ["", "b", "c", "d", "e"], topReferenceEur: 100 }),
    { "limits.1": COST_BANDS_LIMITS_ERROR, "labels.0": COST_BANDS_LABEL_ERROR, topReferenceEur: COST_BANDS_TOP_REFERENCE_ERROR },
  );
  for (const input of [null, undefined, "fasce", 3, [], [WORKSPACE]]) {
    assert.deepEqual(fieldErrorsOf(input), { payload: COST_BANDS_SHAPE_ERROR }, JSON.stringify(input));
  }
  assert.deepEqual(fieldErrorsOf({}), { limits: COST_BANDS_SHAPE_ERROR, labels: COST_BANDS_SHAPE_ERROR, topReferenceEur: COST_BANDS_AMOUNT_ERROR });
});

test("validazione: un array sparso (con i buchi) non è mai valido, il buco è il campo che manca", () => {
  // Un'action che costruisce gli array per indice può lasciare un buco: lunghezza giusta, valore assente.
  const limits = new Array<number>(4);
  limits[0] = 10_000;
  limits[2] = 30_000;
  limits[3] = 40_000;
  const labels = new Array<string>(5);
  for (const i of [0, 1, 2, 4]) labels[i] = ["a", "b", "c", "d", "e"][i];
  assert.deepEqual(fieldErrorsOf({ limits, labels, topReferenceEur: 50_000 }), {
    "limits.1": COST_BANDS_AMOUNT_ERROR,
    "labels.3": COST_BANDS_LABEL_ERROR,
  });
  assert.deepEqual(fieldErrorsOf({ limits, labels: WORKSPACE.labels, topReferenceEur: 50_000 }), { "limits.1": COST_BANDS_AMOUNT_ERROR });
  assert.deepEqual(fieldErrorsOf({ limits: WORKSPACE.limits, labels, topReferenceEur: WORKSPACE.topReferenceEur }), { "labels.3": COST_BANDS_LABEL_ERROR });
  // Le fasce restano le predefinite: mai una fascia con «A» assente o «Da» NaN.
  assert.equal(resolveCostBands({ costBands: { limits, labels, topReferenceEur: 50_000 } }), COST_BANDS);
});

test("etichette proposte dall'editor quando cambia un confine: la forma predefinita", () => {
  assert.deepEqual(defaultCostBandLabels([15_000, 40_000, 100_000, 200_000]), [
    "Fino a 15.000 €",
    "Da 15.000 a 40.000 €",
    "Da 40.000 a 100.000 €",
    "Da 100.000 a 200.000 €",
    "200.000 € e oltre",
  ]);
  // Le migliaia col punto anche sotto 10.000; nessun decimale.
  assert.deepEqual(defaultCostBandLabels([5_000, 9_999, 10_000, 1_250_000]), [
    "Fino a 5.000 €",
    "Da 5.000 a 9.999 €",
    "Da 9.999 a 10.000 €",
    "Da 10.000 a 1.250.000 €",
    "1.250.000 € e oltre",
  ]);
  // Le etichette proposte passano la validazione con i confini di oggi e con quelli del workspace.
  for (const limits of [DEFAULT_COST_BANDS_CONFIG.limits, WORKSPACE.limits, [1, 2, 3, 99_999_999]]) {
    assert.equal(validateCostBands({ limits, labels: defaultCostBandLabels(limits), topReferenceEur: 100_000_000 }).ok, true, String(limits));
  }
});
