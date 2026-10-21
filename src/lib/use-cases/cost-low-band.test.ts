import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SCORING_MODEL_CONFIG, mergeScoringConfig, normalizeScoringConfig } from "../db/use-case-scoring.ts";
import { COST_BANDS, COST_BANDS_MAX_EUR, costLowBandFrom, costLowLinePosition, costPosition, isCostLowBand, resolveCostBands } from "./cost-bands.ts";
import { costLowBandOf, isCostLow, zoneOf } from "./valuation.ts";
import { workspaceValuationModel } from "./views.ts";

// «Costo basso fino alla fascia N» (D18, docs/use-case/DESIGN.md §1.1, §7.2, §7.4): la fascia
// del workspace al posto della soglia in euro, predefinita la 1; le config di prima con
// `costLowMaxEur` si leggono come la fascia che contiene l'importo. Fasce sintetiche.

const CUSTOM_BANDS = {
  limits: [15_000, 40_000, 100_000, 200_000],
  labels: ["Piccolo", "Medio", "Grande", "Molto grande", "Enorme"],
  topReferenceEur: 300_000,
};
const custom = resolveCostBands({ costBands: CUSTOM_BANDS });

test("costLowBandFrom: la fascia salvata, poi quella che contiene la soglia in euro di prima, poi la 1", () => {
  assert.equal(costLowBandFrom(null), 1);
  assert.equal(costLowBandFrom({}), 1);
  assert.equal(costLowBandFrom({ costLowBand: 3 }), 3);
  assert.equal(costLowBandFrom({ costLowBand: 2, costLowMaxEur: 200_000 }), 2, "la fascia vince");
  assert.equal(costLowBandFrom({ costLowMaxEur: 25_000 }), 1);
  assert.equal(costLowBandFrom({ costLowMaxEur: 25_001 }), 2);
  assert.equal(costLowBandFrom({ costLowMaxEur: 130_000 }), 3);
  assert.equal(costLowBandFrom({ costLowMaxEur: COST_BANDS_MAX_EUR }), 4, "oltre il quarto confine: la 4, la quinta è aperta");
  // Con le fasce del workspace: 25.000 € sta nella seconda (15.001-40.000).
  assert.equal(costLowBandFrom({ costLowMaxEur: 25_000 }, custom), 2);
  assert.equal(costLowBandFrom({ costLowMaxEur: 15_000 }, custom), 1);
  for (const value of [0, 5, 1.5, "2", null, true]) assert.equal(costLowBandFrom({ costLowBand: value }), 1, JSON.stringify(value));
  for (const value of [-1, "30000", Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(costLowBandFrom({ costLowMaxEur: value }), 1, String(value));
  assert.equal(costLowBandFrom("soglie"), 1);
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(isCostLowBand), [false, true, true, true, true, false]);
});

test("la linea della matrice sta sul confine della fascia N, con le fasce predefinite e con quelle del workspace", () => {
  for (const band of [1, 2, 3, 4] as const) {
    assert.equal(costLowLinePosition(band), band + 0.5);
    // Il confine «A» della fascia N cade sulla linea.
    assert.equal(costPosition({ amount: COST_BANDS[band - 1].toEur! }, COST_BANDS), costLowLinePosition(band));
    assert.equal(costPosition({ amount: custom[band - 1].toEur! }, custom), costLowLinePosition(band));
  }
});

test("normalizeScoringConfig: la soglia in euro resta com'era; la fascia se la config la salva o se l'euro direbbe un'altra fascia", () => {
  // Fasce predefinite, niente salvato: il 25.000 predefinito è già la fascia 1, nessuna chiave in più.
  assert.equal("costLowBand" in normalizeScoringConfig(null).thresholds, false);
  assert.equal(normalizeScoringConfig({ thresholds: { costLowBand: 3 } }).thresholds.costLowBand, 3);
  assert.equal("costLowBand" in normalizeScoringConfig({ thresholds: { costLowBand: 5 } }).thresholds, false);
  assert.equal(normalizeScoringConfig({ thresholds: { costLowMaxEur: 30_000 } }).thresholds.costLowMaxEur, 30_000);
  assert.equal("costLowBand" in DEFAULT_SCORING_MODEL_CONFIG.thresholds, false);
  // Fasce del workspace con il primo confine a 15.000 € e nessuna soglia salvata: D18 dice la
  // fascia 1; il 25.000 predefinito da solo starebbe nella 2, quindi la fascia si scrive.
  const unsaved = normalizeScoringConfig({ costBands: CUSTOM_BANDS });
  assert.equal(unsaved.thresholds.costLowMaxEur, 25_000);
  assert.equal(unsaved.thresholds.costLowBand, 1);
  // Una soglia in euro salvata di prima si legge con le fasce del workspace: 25.000 € nella 2.
  assert.equal(costLowBandFrom(normalizeScoringConfig({ costBands: CUSTOM_BANDS, thresholds: { costLowMaxEur: 25_000 } }).thresholds, custom), 2);
  // Una soglia in euro non valida vale come non salvata: la fascia 1.
  assert.equal(normalizeScoringConfig({ costBands: CUSTOM_BANDS, thresholds: { costLowMaxEur: -1 } }).thresholds.costLowBand, 1);
});

test("la config normalizzata dà a ogni lettore il costo basso di D18 (scoring-v2 come la pagina)", () => {
  // `use-case-admin scoring-v2` (modelOf) legge la config normalizzata; la pagina passa da
  // `workspaceValuationModel`. Con le fasce del workspace e nessuna soglia salvata: fascia 1 per entrambi.
  for (const raw of [{ costBands: CUSTOM_BANDS }, { costBands: CUSTOM_BANDS, thresholds: { highImpact: 4 } }, null, {}]) {
    const normalized = normalizeScoringConfig(raw);
    const page = workspaceValuationModel(normalized, raw);
    assert.equal(costLowBandOf(normalized), costLowBandOf(page), JSON.stringify(raw));
    assert.equal(costLowBandOf(normalized), 1, JSON.stringify(raw));
  }
  for (const [raw, band] of [
    [{ costBands: CUSTOM_BANDS, thresholds: { costLowMaxEur: 25_000 } }, 2],
    [{ costBands: CUSTOM_BANDS, thresholds: { costLowBand: 3, costLowMaxEur: 25_000 } }, 3],
    [{ thresholds: { costLowMaxEur: 130_000 } }, 3],
  ] as const) {
    const normalized = normalizeScoringConfig(raw);
    assert.equal(costLowBandOf(normalized), band, JSON.stringify(raw));
    assert.equal(costLowBandOf(workspaceValuationModel(normalized, raw)), band, JSON.stringify(raw));
  }
  // Una cifra €€ (fascia 2 del workspace) con Valore alto: «Da pianificare» per tutti, mai «Subito».
  const normalized = normalizeScoringConfig({ costBands: CUSTOM_BANDS });
  const cost = { band: 2, amount: 30_000, fromBand: false, source: "team_importo", position: 2, referenceEur: 30_000 } as const;
  assert.equal(isCostLow(cost, normalized), false);
  assert.equal(zoneOf({ word: "alto" }, cost, normalized), "da_pianificare");
  assert.equal(zoneOf({ word: "alto" }, cost, workspaceValuationModel(normalized, { costBands: CUSTOM_BANDS })), "da_pianificare");
});

test("mergeScoringConfig: la fascia del costo basso toglie la soglia in euro; un salvataggio senza la fascia la lascia", () => {
  const saved = { scoringVersion: 2, thresholds: { highImpact: 3.5, costLowMaxEur: 30_000 }, costBands: CUSTOM_BANDS };
  assert.deepEqual(mergeScoringConfig(saved, { thresholds: { costLowBand: 3 } }).thresholds, { highImpact: 3.5, costLowBand: 3 });
  assert.deepEqual(mergeScoringConfig(saved, { thresholds: { highImpact: 4 } }).thresholds, { highImpact: 4, costLowMaxEur: 30_000 });
  const merged = mergeScoringConfig(saved, { thresholds: { costLowBand: 2 } });
  assert.equal(merged.scoringVersion, 2, "scoringVersion resta");
  assert.deepEqual(merged.costBands, CUSTOM_BANDS);
  assert.equal(normalizeScoringConfig(merged).thresholds.costLowBand, 2);
});
