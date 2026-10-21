import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
// use-case-scoring.ts ha solo import di tipi: sotto Node puro si carica, e il confronto v1 usa il codice di oggi.
import { deriveUseCasePortfolioMetrics } from "../db/use-case-scoring.ts";
import type { ScoringModelConfig } from "../db/queries/scoring-model.ts";
import {
  aggregateScores,
  annualValue,
  costFigure,
  costLowBandOf,
  DEFAULT_COST_KPI_ID,
  DEFAULT_THRESHOLDS,
  hasTeamValuation,
  isCostLow,
  readKpi,
  riskChips,
  scoringVersionOf,
  valueFigure,
  valueWord,
  zoneOf,
  type CostFigure,
  type LegacyScoreColumns,
  type ValuationModel,
} from "./valuation.ts";
import { COST_BANDS, DEFAULT_COST_BANDS_CONFIG, effortCostEur, resolveCostBands, type CostBandsConfig } from "./cost-bands.ts";

// Valore, costo, rischio, zone e aggregatore: docs/use-case/DESIGN.md §7.1-7.4 e §7.6.
// Modelli e punteggi sintetici.

// ─── Modelli d'esempio ───────────────────────────────────────────────

/** Come `DEFAULT_SCORING_MODEL_CONFIG` di scoring-model.ts (che sotto Node puro non si carica). */
const defaultModel: ScoringModelConfig = {
  dimensions: {
    impact: [
      { id: "efficiency", label: "Efficienza", weight: 1, direction: "higher_better" },
      { id: "profitability", label: "Profittabilità", weight: 1, direction: "higher_better" },
    ],
    feasibility: [{ id: "effort", label: "Sforzo", weight: 1, direction: "lower_better" }],
    esg: [
      { id: "environmental", label: "Ambientale", weight: 1, direction: "higher_better" },
      { id: "social", label: "Sociale", weight: 1, direction: "higher_better" },
    ],
  },
  overall: { impact: 0.5, feasibility: 0.3, esg: 0.2 },
  thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
};

/** I 13 sotto-criteri storici, con pesi diversi. */
const legacyModel: ScoringModelConfig = {
  dimensions: {
    impact: ["economic", "time", "quality", "coordination", "social"].map((id, i) => ({ id, label: id, weight: i + 1 })),
    feasibility: ["data", "workflow", "risk", "tech", "team"].map((id, i) => ({ id, label: id, weight: 5 - i })),
    esg: ["environmental", "social", "governance"].map((id) => ({ id, label: id, weight: 2 })),
  },
  overall: { impact: 2, feasibility: 1, esg: 1 },
  thresholds: { highImpact: 3, highFeasibility: 3, midImpact: 2 },
};

/** Un modello personalizzato, con un KPI del costo che non è «effort». */
const customModel: ScoringModelConfig & Pick<ValuationModel, "costKpiId"> = {
  dimensions: {
    impact: [
      { id: "fatturato", label: "Fatturato", weight: 2 },
      { id: "efficiency", label: "Efficienza", weight: 0.5 },
    ],
    feasibility: [
      { id: "complessita", label: "Complessità", weight: 3, direction: "lower_better" },
      { id: "tech", label: "Tecnologia", weight: 1 },
    ],
    esg: [],
  },
  overall: { impact: 1, feasibility: 0, esg: 0 },
  thresholds: { highImpact: 4, highFeasibility: 3, midImpact: 3 },
  costKpiId: "complessita",
};

/** Pesi complessivi a zero: oggi si ripiega su metà e metà. */
const zeroWeightsModel: ScoringModelConfig = { ...defaultModel, overall: { impact: 0, feasibility: 0, esg: 0 } };

const models: Array<[string, ScoringModelConfig]> = [
  ["predefinito", defaultModel],
  ["legacy", legacyModel],
  ["personalizzato", customModel],
  ["pesi a zero", zeroWeightsModel],
];

type Sample = LegacyScoreColumns & {
  customScores?: { impact?: Record<string, number>; feasibility?: Record<string, number>; esg?: Record<string, number> } | null;
};

const samples: Array<[string, Sample]> = [
  ["vuota", {}],
  ["solo KPI scritti in custom_scores", { customScores: { impact: { efficiency: 4 }, feasibility: { effort: 2 } } }],
  ["profittabilità a mano", { customScores: { impact: { efficiency: 4, profitability: 3 }, feasibility: { effort: 5 } } }],
  [
    "colonne legacy (Activity mapping)",
    {
      impactEconomic: 5,
      impactTime: 4,
      impactQuality: 3,
      impactCoordination: 2,
      impactSocial: 1,
      feasibilityData: 4,
      feasibilityWorkflow: 3,
      feasibilityRisk: 2,
      feasibilityTech: 2,
      feasibilityTeam: 5,
      esgEnvironmental: 3,
      esgSocial: 4,
      esgGovernance: 2,
    },
  ],
  ["legacy: efficienza da coordinamento e sociale", { impactCoordination: 3, impactSocial: 4, impactTime: 0 }],
  ["legacy: efficienza dal solo economico", { impactEconomic: 3, feasibilityTech: 1 }],
  ["valori fuori scala", { customScores: { impact: { efficiency: 0, profitability: 7 }, feasibility: { effort: -1 } } }],
  ["ESG a mano", { customScores: { esg: { environmental: 5, social: 2 } }, esgGovernance: 4 }],
  ["KPI personalizzati", { customScores: { impact: { fatturato: 3 }, feasibility: { complessita: 4, tech: 2 } } }],
  ["tutto insieme", { customScores: { impact: { efficiency: 2 } }, impactTime: 5, feasibilityData: 1, esgEnvironmental: 2 }],
];

// ─── Forma del modello ───────────────────────────────────────────────

test("il modello del workspace di oggi è un ValuationModel, anche con le chiavi nuove di §7.6", () => {
  const asModel = (config: ScoringModelConfig): ValuationModel => config;
  const v2: ValuationModel = { ...asModel(defaultModel), scoringVersion: 2, costKpiId: "effort", thresholds: { ...defaultModel.thresholds, costLowBand: 2 } };
  assert.equal(scoringVersionOf(asModel(defaultModel)), 1, "senza scoringVersion vale 1");
  assert.equal(scoringVersionOf(v2), 2);
  assert.equal(scoringVersionOf({ ...v2, scoringVersion: 3 }), 1);
  assert.equal(scoringVersionOf(null), 1);
  assert.deepEqual(DEFAULT_THRESHOLDS, { highImpact: 3.5, midImpact: 2.5, highFeasibility: 3.5, costLowBand: 1, costLowMaxEur: 25_000 });
  assert.equal(DEFAULT_COST_KPI_ID, "effort");
});

// ─── Aggregatore v1 (§7.6: «v1: comportamento di oggi, identico») ────

test("v1: gli stessi numeri di deriveUseCasePortfolioMetrics, su ogni modello e ogni scheda d'esempio", () => {
  for (const [modelName, config] of models) {
    for (const esgEnabled of [false, true]) {
      for (const [sampleName, data] of samples) {
        const today = deriveUseCasePortfolioMetrics(data, { model: { impactFlagEnabled: false, config }, esgEnabled });
        const label = `${modelName} · ${sampleName} · ESG ${esgEnabled ? "sì" : "no"}`;
        assert.deepEqual(
          aggregateScores(data, config, { version: 1, esgEnabled }),
          {
            impact: today.overallImpactScore,
            feasibility: today.overallFeasibilityScore,
            esg: today.overallEsgScore,
            overall: today.overallScore,
          },
          label,
        );
        // Senza scoringVersion il modello è v1.
        assert.deepEqual(aggregateScores(data, config, { esgEnabled }), aggregateScores(data, config, { version: 1, esgEnabled }), label);
      }
    }
  }
});

test("v1: un KPI vuoto conta zero e resta nel denominatore (il difetto 1 di oggi)", () => {
  const scores = aggregateScores({ customScores: { impact: { efficiency: 4 } } }, defaultModel, { version: 1 });
  assert.equal(scores.impact, 2, "profittabilità vuota vale 0: (4 + 0) / 2");
  assert.equal(aggregateScores({}, defaultModel, { version: 1 }).impact, 0);
});

test("v1 ignora i punteggi dell'AI in ai_suggestion, come oggi", () => {
  const withAi = aggregateScores({ aiScores: { impact: { efficiency: 5, profitability: 5 } } }, defaultModel, { version: 1 });
  assert.deepEqual(withAi, aggregateScores({}, defaultModel, { version: 1 }));
});

// ─── Aggregatore v2 (§7.6, regole 1 e 2) ─────────────────────────────

const v2Model: ValuationModel = { ...defaultModel, scoringVersion: 2 };

test("v2: un KPI vuoto esce dal denominatore", () => {
  // Valutata solo dall'AI, senza profittabilità: oggi resta sotto 2,5, in v2 vale 4.
  const ai = aggregateScores({ aiScores: { impact: { efficiency: 4 } } }, v2Model);
  assert.equal(ai.impact, 4);
  assert.equal(aggregateScores({ customScores: { impact: { efficiency: 4 } } }, v2Model).impact, 4);
  assert.equal(aggregateScores({ customScores: { impact: { efficiency: 4, profitability: 2 } } }, v2Model).impact, 3);
  // Con i pesi: solo i KPI che hanno un valore.
  const weighted: ValuationModel = {
    ...v2Model,
    dimensions: { ...v2Model.dimensions, impact: [{ id: "a", weight: 3 }, { id: "b", weight: 1 }, { id: "c", weight: 10 }] },
  };
  assert.equal(aggregateScores({ customScores: { impact: { a: 5, b: 1 } } }, weighted).impact, (5 * 3 + 1 * 1) / 4);
});

test("v2: una dimensione senza valori è null («da stimare»), non 0", () => {
  const empty = aggregateScores({}, v2Model, { esgEnabled: true });
  assert.deepEqual(empty, { impact: null, feasibility: null, esg: null, overall: null });
  const onlyImpact = aggregateScores({ customScores: { impact: { efficiency: 4 } } }, v2Model, { esgEnabled: true });
  assert.equal(onlyImpact.feasibility, null);
  assert.equal(onlyImpact.esg, null);
  // Nel complessivo esce anche la dimensione vuota: resta l'impatto.
  assert.equal(onlyImpact.overall, 4);
  // Un valore 0 o «Nessun valore» (chiave assente o null) non è un valore.
  assert.equal(aggregateScores({ customScores: { impact: { efficiency: 0, profitability: null as unknown as number } } }, v2Model).impact, null);
});

test("v2: per ogni KPI vale persona, poi AI, poi colonne legacy", () => {
  const all = { customScores: { impact: { efficiency: 2 } }, aiScores: { impact: { efficiency: 5 } }, impactTime: 4, impactQuality: 4 };
  assert.deepEqual(readKpi(all, "impact", "efficiency"), { value: 2, from: "persona" });
  assert.deepEqual(readKpi({ ...all, customScores: null }, "impact", "efficiency"), { value: 5, from: "ai" });
  assert.deepEqual(readKpi({ ...all, customScores: null, aiScores: null }, "impact", "efficiency"), { value: 4, from: "legacy" });
  assert.equal(readKpi({}, "impact", "efficiency"), null);
  assert.equal(aggregateScores(all, v2Model).impact, 2);
  assert.equal(aggregateScores({ ...all, customScores: null }, v2Model).impact, 5);
  assert.equal(aggregateScores({ ...all, customScores: null, aiScores: null }, v2Model).impact, 4);
});

test("v2: la mappa legacy di oggi, senza zeri finti", () => {
  // Profittabilità non ha colonne: in v1 vale 0, in v2 non c'è.
  assert.equal(readKpi({ impactEconomic: 5 }, "impact", "profitability"), null);
  // Efficienza: tempo e qualità, poi coordinamento e sociale, poi economico.
  assert.equal(readKpi({ impactTime: 4, impactQuality: 2, impactEconomic: 1 }, "impact", "efficiency")?.value, 3);
  assert.equal(readKpi({ impactCoordination: 3, impactSocial: 5 }, "impact", "efficiency")?.value, 4);
  assert.equal(readKpi({ impactEconomic: 2 }, "impact", "efficiency")?.value, 2);
  // Sforzo: 6 − media delle colonne di fattibilità.
  assert.equal(readKpi({ feasibilityData: 4, feasibilityWorkflow: 2 }, "feasibility", "effort")?.value, 3);
  // «social» legge la colonna della sua dimensione.
  assert.equal(readKpi({ esgSocial: 4, impactSocial: 2 }, "esg", "social")?.value, 4);
  assert.equal(readKpi({ esgSocial: 4, impactSocial: 2 }, "impact", "social")?.value, 2);
  // Colonne a zero o vuote non sono valori.
  assert.equal(readKpi({ impactTime: 0, impactQuality: null }, "impact", "time"), null);
});

test("v2: «lower_better» si inverte, i pesi delle dimensioni valgono solo dove c'è un valore", () => {
  const scores = aggregateScores({ customScores: { impact: { efficiency: 4 }, feasibility: { effort: 2 } } }, v2Model);
  assert.equal(scores.feasibility, 4, "sforzo 2 su 5 è una fattibilità di 4");
  assert.equal(scores.overall, (4 * 0.5 + 4 * 0.3) / 0.8);
  // ESG entra solo col flag del workspace.
  const esg = { customScores: { impact: { efficiency: 4 }, esg: { environmental: 2 } } };
  assert.equal(aggregateScores(esg, v2Model, { esgEnabled: false }).esg, null);
  assert.equal(aggregateScores(esg, v2Model, { esgEnabled: false }).overall, 4);
  assert.equal(aggregateScores(esg, v2Model, { esgEnabled: true }).esg, 2);
  assert.equal(aggregateScores(esg, v2Model, { esgEnabled: true }).overall, (4 * 0.5 + 2 * 0.2) / 0.7);
});

test("v2: con tutti i pesi complessivi a zero, impatto e fattibilità a metà come in v1 (ESG fuori)", () => {
  const data = { customScores: { impact: { efficiency: 4 }, feasibility: { effort: 2 } } };
  const v1 = aggregateScores(data, zeroWeightsModel, { version: 1 });
  const v2 = aggregateScores(data, zeroWeightsModel, { version: 2 });
  assert.deepEqual(v1, { impact: 2, feasibility: 4, esg: null, overall: 3 });
  assert.deepEqual(v2, { impact: 4, feasibility: 4, esg: null, overall: 4 });
  // Una dimensione senza valori esce anche dal ripiego.
  assert.equal(aggregateScores({ customScores: { impact: { efficiency: 3 } } }, zeroWeightsModel, { version: 2 }).overall, 3);
  assert.equal(aggregateScores({ customScores: { feasibility: { effort: 1 } } }, zeroWeightsModel, { version: 2 }).overall, 5);
  // ESG non pesa nel ripiego: con il solo ESG il complessivo resta «da stimare».
  const onlyEsg = aggregateScores({ customScores: { esg: { environmental: 5 } } }, zeroWeightsModel, { version: 2, esgEnabled: true });
  assert.deepEqual(onlyEsg, { impact: null, feasibility: null, esg: 5, overall: null });
  const withEsg = aggregateScores({ ...data, customScores: { ...data.customScores, esg: { environmental: 1 } } }, zeroWeightsModel, { version: 2, esgEnabled: true });
  assert.equal(withEsg.overall, 4);
  // Senza nessun valore resta null.
  assert.equal(aggregateScores({}, zeroWeightsModel, { version: 2, esgEnabled: true }).overall, null);
  // Un peso a zero solo per una dimensione non è il ripiego: conta l'altra.
  const onlyImpactWeight: ValuationModel = { ...zeroWeightsModel, overall: { impact: 1, feasibility: 0, esg: 0 } };
  assert.equal(aggregateScores(data, onlyImpactWeight, { version: 2 }).overall, 4);
  assert.equal(aggregateScores({ customScores: { feasibility: { effort: 1 } } }, onlyImpactWeight, { version: 2 }).overall, null, "conta solo l'impatto, che non c'è");
});

test("v2 si sceglie col modello (scoringVersion = 2) o esplicitamente", () => {
  const data = { aiScores: { impact: { efficiency: 4 } } };
  assert.equal(aggregateScores(data, v2Model).impact, 4);
  assert.equal(aggregateScores(data, defaultModel, { version: 2 }).impact, 4);
  assert.equal(aggregateScores(data, v2Model, { version: 1 }).impact, 0);
});

// ─── Valore (§7.1) ───────────────────────────────────────────────────

test("parola del Valore: Alto da 3,5, Medio da 2,5, Basso sotto; senza punteggio «da stimare»", () => {
  assert.equal(valueWord(5, defaultModel), "alto");
  assert.equal(valueWord(3.5, defaultModel), "alto");
  assert.equal(valueWord(3.49, defaultModel), "medio");
  assert.equal(valueWord(2.5, defaultModel), "medio");
  assert.equal(valueWord(2.49, defaultModel), "basso");
  assert.equal(valueWord(1, defaultModel), "basso");
  assert.equal(valueWord(null, defaultModel), null);
  assert.equal(valueWord(Number.NaN, defaultModel), null);
  // Le soglie sono del workspace.
  assert.equal(valueWord(3.8, customModel), "medio");
  assert.equal(valueWord(4, customModel), "alto");
  assert.equal(valueWord(2.9, customModel), "basso");
  // Senza soglie nel modello: i predefiniti.
  assert.equal(valueWord(3.5, { dimensions: defaultModel.dimensions }), "alto");
});

test("fonte del Valore «team»: almeno un KPI d'impatto inserito da una persona", () => {
  const value = valueFigure({ customScores: { impact: { efficiency: 4 } }, aiScores: { impact: { profitability: 2 } } }, v2Model);
  assert.deepEqual({ score: value.score, word: value.word, source: value.source }, { score: 3, word: "medio", source: "team" });
});

test("fonte del Valore «AI»: il punteggio viene solo da ai_suggestion o dalle colonne legacy", () => {
  assert.equal(valueFigure({ aiScores: { impact: { efficiency: 4 } } }, v2Model).source, "ai");
  assert.equal(valueFigure({ impactTime: 4, impactQuality: 4 }, v2Model).source, "ai", "Activity mapping");
  // Un KPI di persona fuori dal modello, o solo di fattibilità, non fa «team».
  assert.equal(valueFigure({ customScores: { impact: { altro: 5 } }, aiScores: { impact: { efficiency: 3 } } }, v2Model).source, "ai");
  assert.equal(valueFigure({ customScores: { feasibility: { effort: 2 } }, aiScores: { impact: { efficiency: 3 } } }, v2Model).source, "ai");
});

test("fonte del Valore «da stimare»: nessun KPI d'impatto ha un valore", () => {
  for (const model of [v2Model, defaultModel]) {
    const value = valueFigure({ customScores: { feasibility: { effort: 2 } } }, model);
    assert.deepEqual(value, { score: null, word: null, source: null, perYear: null }, `v${scoringVersionOf(model)}`);
  }
});

test("fonte del Valore in v1: i punteggi di ai_suggestion non contano, come nell'aggregatore v1", () => {
  // Una scheda v1 con i soli punteggi dell'AI (dopo `scoring-v2 --revert` o «Chiedi un nuovo
  // suggerimento»): «da stimare», non «Basso» da 0.
  const aiOnly = { aiScores: { impact: { efficiency: 4, profitability: 5 } } };
  assert.deepEqual(valueFigure(aiOnly, defaultModel), { score: null, word: null, source: null, perYear: null });
  assert.deepEqual(valueFigure(aiOnly, v2Model, { version: 1 }), { score: null, word: null, source: null, perYear: null });
  assert.equal(zoneOf(valueFigure(aiOnly, defaultModel), costFigure({ costEurOnce: 5_000 }, defaultModel), defaultModel), null);
  // In v2 gli stessi punteggi fanno il Valore, con fonte «AI».
  assert.deepEqual(
    { ...valueFigure(aiOnly, v2Model), perYear: undefined },
    { score: 4.5, word: "alto", source: "ai", perYear: undefined },
  );
  assert.equal(valueFigure(aiOnly, defaultModel, { version: 2 }).score, 4.5);
  // In v1 le colonne legacy e i KPI di persona contano ancora, con l'aggregatore v1.
  assert.deepEqual(
    { ...valueFigure({ ...aiOnly, impactTime: 4, impactQuality: 4 }, defaultModel), perYear: undefined },
    { score: 2, word: "basso", source: "ai", perYear: undefined },
  );
  assert.equal(valueFigure({ ...aiOnly, customScores: { impact: { efficiency: 4 } } }, defaultModel).source, "team");
});

test("Valore: il punteggio è quello del modello del workspace (D7), con l'aggregatore della sua versione", () => {
  const data = { customScores: { impact: { efficiency: 4 } } };
  assert.equal(valueFigure(data, v2Model).score, 4);
  assert.equal(valueFigure(data, defaultModel).score, 2, "in v1 la profittabilità vuota conta 0");
  assert.equal(valueFigure(data, defaultModel).word, "basso");
});

test("euro all'anno: prima il dossier («dal dossier»), poi il team", () => {
  assert.deepEqual(annualValue({ dossierAnnualBenefitEur: 60_000, valueEurYear: 40_000 }), { amount: 60_000, source: "dossier" });
  assert.deepEqual(annualValue({ dossierAnnualBenefitEur: null, valueEurYear: 40_000 }), { amount: 40_000, source: "team" });
  assert.deepEqual(annualValue({ dossierAnnualBenefitEur: 0 }), { amount: 0, source: "dossier" });
  assert.equal(annualValue({}), null);
  assert.deepEqual(valueFigure({ valueEurYear: 40_000 }, v2Model).perYear, { amount: 40_000, source: "team" });
});

// ─── Costo di realizzazione (§7.2) ───────────────────────────────────

const pick = (cost: CostFigure | null) =>
  cost && {
    source: cost.source,
    amount: cost.amount,
    band: cost.band,
    bandLabel: cost.bandLabel,
    fromBand: cost.fromBand,
    position: cost.position,
    referenceEur: cost.referenceEur,
  };

test("scala del costo: 1 dossier, 2 importo del team, 3 fascia del team, 4 sforzo, 5 nessuna", () => {
  const all = {
    dossierImplementationEur: 18_500,
    costEurOnce: 40_000,
    costBand: 4,
    customScores: { feasibility: { effort: 5 } },
  };
  assert.deepEqual(pick(costFigure(all, defaultModel)), {
    source: "dossier",
    amount: 18_500,
    band: 1,
    bandLabel: "Fino a 25.000 €",
    fromBand: false,
    position: 0.5 + 18_500 / 25_000,
    referenceEur: 18_500,
  });
  assert.deepEqual(pick(costFigure({ ...all, dossierImplementationEur: null }, defaultModel)), {
    source: "team_importo",
    amount: 40_000,
    band: 2,
    bandLabel: "Da 25.000 a 65.000 €",
    fromBand: false,
    position: 1.5 + (40_000 - 25_001) / (65_000 - 25_001),
    referenceEur: 40_000,
  });
  assert.deepEqual(pick(costFigure({ ...all, dossierImplementationEur: null, costEurOnce: null }, defaultModel)), {
    source: "team_fascia",
    amount: null,
    band: 4,
    bandLabel: "Da 130.000 a 250.000 €",
    fromBand: true,
    position: 4,
    referenceEur: 250_000,
  });
  // Sforzo 5: 250.000 € stimati, nella fascia €€€€ delle fasce predefinite; nei totali l'importo stimato.
  assert.deepEqual(pick(costFigure({ customScores: { feasibility: { effort: 5 } } }, defaultModel)), {
    source: "sforzo",
    amount: null,
    band: 4,
    bandLabel: "Da 130.000 a 250.000 €",
    fromBand: true,
    position: 4,
    referenceEur: 250_000,
  });
  assert.equal(costFigure({}, defaultModel), null);
});

test("costo «da sforzo»: KPI del costo da persona o AI, con la tabella di estimateImplementationCost", () => {
  // Con le fasce predefinite: sforzo 1 e 2 in €, 3 in €€, 4 in €€€, 5 in €€€€ (§7.2).
  assert.equal(costFigure({ customScores: { feasibility: { effort: 1 } } }, defaultModel)?.band, 1);
  assert.equal(costFigure({ customScores: { feasibility: { effort: 2 } } }, defaultModel)?.band, 1);
  assert.equal(costFigure({ aiScores: { feasibility: { effort: 3 } } }, defaultModel)?.band, 2);
  assert.equal(costFigure({ aiScores: { feasibility: { effort: 4 } } }, defaultModel)?.band, 3);
  assert.equal(costFigure({ aiScores: { feasibility: { effort: 5 } } }, defaultModel)?.band, 4);
  // La persona vince sull'AI.
  assert.equal(costFigure({ customScores: { feasibility: { effort: 2 } }, aiScores: { feasibility: { effort: 5 } } }, defaultModel)?.referenceEur, 25_000);
  // Mai «6 − fattibilità» e nessuna stima dalle colonne legacy: senza valori il costo è da stimare.
  assert.equal(costFigure({ feasibilityData: 1, feasibilityTech: 1 } as never, defaultModel), null);
  assert.equal(costFigure({ customScores: { feasibility: { effort: 0 } } }, defaultModel), null);
});

test("costo «da sforzo»: il KPI è config.costKpiId; se il modello non lo ha, la fonte 4 non esiste", () => {
  assert.equal(costFigure({ customScores: { feasibility: { complessita: 4 } } }, customModel)?.source, "sforzo");
  assert.equal(costFigure({ customScores: { feasibility: { complessita: 4 } } }, customModel)?.band, 3, "130.000 € stimati");
  // Il modello personalizzato non ha «effort»: lo sforzo scritto lì non conta.
  assert.equal(costFigure({ customScores: { feasibility: { effort: 4 } } }, customModel), null);
  const noEffort: ValuationModel = { ...defaultModel, dimensions: { ...defaultModel.dimensions, feasibility: [{ id: "tech" }] } };
  assert.equal(costFigure({ customScores: { feasibility: { effort: 4 } } }, noEffort), null);
});

test("una fascia fuori da 1-5 non è una fascia", () => {
  for (const costBand of [0, 6, 2.5, null]) assert.equal(costFigure({ costBand }, defaultModel), null, String(costBand));
});

test("costo basso per importo (D18): la fascia dell'importo fino alla fascia N, predefinita la 1 (25.000 €)", () => {
  const amount = (costEurOnce: number) => costFigure({ costEurOnce }, defaultModel)!;
  assert.equal(costLowBandOf(defaultModel), 1);
  assert.equal(isCostLow(amount(0), defaultModel), true);
  assert.equal(isCostLow(amount(25_000), defaultModel), true);
  assert.equal(isCostLow(amount(25_001), defaultModel), false);
  const dossier = costFigure({ dossierImplementationEur: 24_000 }, defaultModel)!;
  assert.equal(isCostLow(dossier, defaultModel), true);
  // La fascia è del workspace: fino alla 2 vuol dire fino a 65.000 €.
  const higher: ValuationModel = { ...defaultModel, thresholds: { ...defaultModel.thresholds, costLowBand: 2 } };
  assert.equal(isCostLow(amount(65_000), higher), true);
  assert.equal(isCostLow(amount(65_001), higher), false);
  // Una config di prima con un importo vale la fascia che lo contiene: 30.000 € è la 2.
  const legacy: ValuationModel = { ...defaultModel, thresholds: { ...defaultModel.thresholds, costLowMaxEur: 30_000 } };
  assert.equal(costLowBandOf(legacy), 2);
  assert.equal(isCostLow(amount(65_000), legacy), true, "tutta la fascia 2, non più solo fino a 30.000 €");
  assert.equal(isCostLow(amount(65_001), legacy), false);
  // Con entrambe vince la fascia.
  assert.equal(costLowBandOf({ ...defaultModel, thresholds: { ...defaultModel.thresholds, costLowBand: 1, costLowMaxEur: 200_000 } }), 1);
});

test("costo basso per fascia: fascia ≤ N (D18)", () => {
  const band = (costBand: number) => costFigure({ costBand }, defaultModel)!;
  // Con le fasce predefinite «Subito» vuol dire fascia 1: la prima finisce a 25.000 €.
  assert.equal(isCostLow(band(1), defaultModel), true, "25.000 € è nella fascia 1");
  assert.equal(isCostLow(band(2), defaultModel), false);
  assert.equal(isCostLow(band(3), defaultModel), false);
  const effort = (score: number) => costFigure({ customScores: { feasibility: { effort: score } } }, defaultModel)!;
  assert.equal(isCostLow(effort(2), defaultModel), true, "25.000 € stimati, fascia 1");
  assert.equal(isCostLow(effort(3), defaultModel), false);
  // Fino alla fascia 2.
  const higher: ValuationModel = { ...defaultModel, thresholds: { ...defaultModel.thresholds, costLowBand: 2 } };
  assert.equal(isCostLow(band(2), higher), true);
  assert.equal(isCostLow(band(3), higher), false);
  // Fino alla fascia 4: la quinta resta alta.
  const top: ValuationModel = { ...defaultModel, thresholds: { ...defaultModel.thresholds, costLowBand: 4 } };
  assert.deepEqual([1, 2, 3, 4, 5].map((b) => isCostLow(band(b), top)), [true, true, true, true, false]);
});

// ─── Zone (§7.4) ─────────────────────────────────────────────────────

test("zone: Subito, Da pianificare, Se avanza tempo, Non ora", () => {
  const low = costFigure({ costEurOnce: 20_000 }, v2Model);
  const high = costFigure({ costEurOnce: 40_000 }, v2Model);
  assert.equal(zoneOf({ word: "alto" }, low, v2Model), "subito");
  assert.equal(zoneOf({ word: "alto" }, high, v2Model), "da_pianificare");
  assert.equal(zoneOf({ word: "medio" }, low, v2Model), "se_avanza_tempo");
  assert.equal(zoneOf({ word: "basso" }, low, v2Model), "se_avanza_tempo");
  assert.equal(zoneOf({ word: "medio" }, high, v2Model), "non_ora");
  assert.equal(zoneOf({ word: "basso" }, high, v2Model), "non_ora");
});

test("zone: senza Valore o senza Costo nessuna zona («da stimare»)", () => {
  const cost = costFigure({ costBand: 1 }, v2Model);
  assert.equal(zoneOf({ word: null }, cost, v2Model), null);
  assert.equal(zoneOf(null, cost, v2Model), null);
  assert.equal(zoneOf({ word: "alto" }, null, v2Model), null);
});

test("zone dalla scheda intera, con le soglie del workspace", () => {
  const card = { customScores: { impact: { fatturato: 4, efficiency: 4 } }, costBand: 1 };
  const value = valueFigure(card, customModel);
  assert.equal(value.word, "alto");
  assert.equal(zoneOf(value, costFigure(card, customModel), customModel), "subito");
  assert.equal(zoneOf(value, costFigure({ ...card, costBand: 2 }, customModel), customModel), "da_pianificare");
  // Lo stesso Valore con il modello predefinito (soglia 3,5) è comunque alto; il costo da fascia 3 è alto.
  assert.equal(zoneOf(valueFigure({ aiScores: { impact: { efficiency: 4 } } }, v2Model), costFigure({ costBand: 3 }, v2Model), v2Model), "da_pianificare");
});

// ─── Fasce del costo del workspace (§7.2, D15) ───────────────────────

/** Fasce di un workspace inventato, diverse dalle predefinite. */
const WORKSPACE_BANDS: CostBandsConfig = {
  limits: [15_000, 40_000, 100_000, 200_000],
  labels: ["Fino a 15.000 €", "Da 15.000 a 40.000 €", "Da 40.000 a 100.000 €", "Da 100.000 a 200.000 €", "200.000 € e oltre"],
  topReferenceEur: 300_000,
};
/** Le fasce di partenza di H1b come fasce di un workspace: quelle «di prima» di un cambio. */
const H1B_BANDS: CostBandsConfig = {
  limits: [10_000, 25_000, 65_000, 130_000],
  labels: ["Fino a 10.000 €", "Da 10.000 a 25.000 €", "Da 25.000 a 65.000 €", "Da 65.000 a 130.000 €", "Oltre 130.000 €"],
  topReferenceEur: 250_000,
};
const bandsModel: ValuationModel = { ...v2Model, costBands: WORKSPACE_BANDS };
const h1bBandsModel: ValuationModel = { ...v2Model, costBands: H1B_BANDS };

test("il modello porta le fasce del workspace (config.costBands), anche come jsonb non tipato", () => {
  const fromJsonb: ValuationModel = { ...defaultModel, costBands: JSON.parse(JSON.stringify(WORKSPACE_BANDS)) as unknown };
  assert.equal(resolveCostBands(fromJsonb)[1].label, "Da 15.000 a 40.000 €");
  assert.equal(resolveCostBands(defaultModel), COST_BANDS, "senza costBands: le predefinite");
  assert.deepEqual(resolveCostBands({ ...defaultModel, costBands: DEFAULT_COST_BANDS_CONFIG }), COST_BANDS);
});

test("fasce del workspace: la fascia di un importo ai confini, con la sua etichetta", () => {
  const cases: Array<[number, number, string]> = [
    [0, 1, "Fino a 15.000 €"],
    [15_000, 1, "Fino a 15.000 €"],
    [15_001, 2, "Da 15.000 a 40.000 €"],
    [40_000, 2, "Da 15.000 a 40.000 €"],
    [40_001, 3, "Da 40.000 a 100.000 €"],
    [200_000, 4, "Da 100.000 a 200.000 €"],
    [200_001, 5, "200.000 € e oltre"],
    [5_000_000, 5, "200.000 € e oltre"],
  ];
  for (const [amount, band, bandLabel] of cases) {
    for (const input of [{ costEurOnce: amount }, { dossierImplementationEur: amount }]) {
      const cost = costFigure(input, bandsModel)!;
      assert.deepEqual([cost.band, cost.bandLabel, cost.amount, cost.fromBand], [band, bandLabel, amount, false], JSON.stringify(input));
    }
  }
});

test("fasce del workspace: posizione da 0,5 a 5,5 con A5 = valore della quinta nei totali", () => {
  const position = (costEurOnce: number) => costFigure({ costEurOnce }, bandsModel)!.position;
  assert.equal(position(0), 0.5);
  assert.equal(position(15_000), 1.5);
  assert.equal(position(15_001), 1.5);
  assert.equal(position(250_000), 4.5 + (250_000 - 200_001) / (300_000 - 200_001));
  assert.equal(position(300_000), 5.5);
  assert.equal(position(1_000_000), 5.5);
  // Lo stesso importo con le fasce predefinite (A5 = 400.000 €) sta altrove.
  assert.equal(costFigure({ costEurOnce: 300_000 }, v2Model)!.position, 4.5 + (300_000 - 250_001) / (400_000 - 250_001));
  for (const costBand of [1, 2, 3, 4, 5]) assert.equal(costFigure({ costBand }, bandsModel)!.position, costBand);
});

test("fasce del workspace: nei totali l'importo, o il valore di riferimento della fascia del team", () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((costBand) => costFigure({ costBand }, bandsModel)!.referenceEur),
    [15_000, 40_000, 100_000, 200_000, 300_000],
  );
  assert.equal(costFigure({ costEurOnce: 33_333 }, bandsModel)!.referenceEur, 33_333);
  assert.equal(costFigure({ dossierImplementationEur: 777_000 }, bandsModel)!.referenceEur, 777_000);
});

test("fasce del workspace: costo basso per importo e per fascia (D18)", () => {
  // Fino alla fascia N delle fasce del workspace: con la 2, fino a 40.000 €.
  const upTo2: ValuationModel = { ...bandsModel, thresholds: { ...bandsModel.thresholds, costLowBand: 2 } };
  assert.equal(isCostLow(costFigure({ costEurOnce: 40_000 }, upTo2)!, upTo2), true);
  assert.equal(isCostLow(costFigure({ costEurOnce: 40_001 }, upTo2)!, upTo2), false);
  // Predefinita la fascia 1, anche con le fasce del workspace: fino a 15.000 €.
  assert.equal(isCostLow(costFigure({ costEurOnce: 15_000 }, bandsModel)!, bandsModel), true);
  assert.equal(isCostLow(costFigure({ costEurOnce: 15_001 }, bandsModel)!, bandsModel), false);
  const band = (costBand: number, model: ValuationModel) => isCostLow(costFigure({ costBand }, model)!, model);
  assert.deepEqual([1, 2, 3, 4, 5].map((b) => band(b, upTo2)), [true, true, false, false, false]);
  assert.deepEqual([1, 2, 3, 4, 5].map((b) => band(b, v2Model)), [true, false, false, false, false], "predefinite: solo €");
  // Una config di prima: 25.000 € sta nella seconda fascia del workspace.
  const legacy: ValuationModel = { ...bandsModel, thresholds: { ...bandsModel.thresholds, costLowMaxEur: 25_000 } };
  assert.deepEqual([1, 2, 3, 4, 5].map((b) => band(b, legacy)), [true, true, false, false, false]);
  const lower: ValuationModel = { ...bandsModel, thresholds: { ...bandsModel.thresholds, costLowMaxEur: 15_000 } };
  assert.deepEqual([1, 2, 3, 4, 5].map((b) => band(b, lower)), [true, false, false, false, false]);
  // «Da sforzo» è una fascia: 25.000 € stimati cadono nella seconda, 65.000 € nella terza.
  const effort = (score: number) => costFigure({ customScores: { feasibility: { effort: score } } }, upTo2)!;
  assert.equal(isCostLow(effort(2), upTo2), true);
  assert.equal(isCostLow(effort(3), upTo2), false);
  // E la zona segue: Valore alto con la fascia 2 è «Subito» qui, «Da pianificare» con le predefinite.
  const value = valueFigure({ customScores: { impact: { efficiency: 4 } } }, v2Model);
  assert.equal(zoneOf(value, costFigure({ costBand: 2 }, upTo2), upTo2), "subito");
  assert.equal(zoneOf(value, costFigure({ costBand: 2 }, v2Model), v2Model), "da_pianificare");
});

test("fasce del workspace: «da sforzo» con l'indice giusto, l'etichetta del workspace e l'importo stimato nei totali", () => {
  const figures = [1, 2, 3, 4, 5].map((score) => costFigure({ aiScores: { feasibility: { effort: score } } }, bandsModel)!);
  assert.deepEqual(
    figures.map((c) => [c.source, c.band, c.bandLabel, c.amount, c.fromBand, c.position, c.referenceEur]),
    [
      ["sforzo", 1, "Fino a 15.000 €", null, true, 1, 10_000],
      ["sforzo", 2, "Da 15.000 a 40.000 €", null, true, 2, 25_000],
      ["sforzo", 3, "Da 40.000 a 100.000 €", null, true, 3, 65_000],
      ["sforzo", 4, "Da 100.000 a 200.000 €", null, true, 4, 130_000],
      ["sforzo", 5, "200.000 € e oltre", null, true, 5, 250_000],
    ],
  );
});

test("i totali «da sforzo» restano quelli di oggi, con qualunque fascia", () => {
  // Gli importi di H1b (valore di riferimento della fascia di allora) = la tabella di estimateImplementationCost.
  const today = [10_000, 25_000, 65_000, 130_000, 250_000];
  for (const model of [defaultModel, v2Model, bandsModel, h1bBandsModel]) {
    const totals = [1, 2, 3, 4, 5].map((score) => costFigure({ customScores: { feasibility: { effort: score } } }, model)!.referenceEur);
    assert.deepEqual(totals, today);
  }
  assert.deepEqual([1, 2, 3, 4, 5].map(effortCostEur), today);
});

test("config assente o non valida: le fasce predefinite", () => {
  const invalid: unknown[] = [
    { ...WORKSPACE_BANDS, limits: [15_000, 40_000, 100_000, 200_000, 250_000] },
    { ...WORKSPACE_BANDS, limits: [15_000, 15_000, 100_000, 200_000] },
    { ...WORKSPACE_BANDS, topReferenceEur: 200_000 },
    { ...WORKSPACE_BANDS, labels: ["x".repeat(41), ...WORKSPACE_BANDS.labels.slice(1)] },
    "fasce",
    null,
  ];
  const inputs = [{ costEurOnce: 30_000 }, { costBand: 2 }, { costBand: 5 }, { customScores: { feasibility: { effort: 3 } } }];
  for (const costBands of invalid) {
    const model: ValuationModel = { ...v2Model, costBands };
    for (const input of inputs) {
      assert.deepEqual(costFigure(input, model), costFigure(input, v2Model), JSON.stringify([costBands, input]));
      const cost = costFigure(input, model)!;
      assert.equal(isCostLow(cost, model), isCostLow(cost, v2Model));
    }
  }
  assert.equal(costFigure({ costBand: 2 }, { ...v2Model, costBands: "fasce" })!.bandLabel, "Da 25.000 a 65.000 €");
});

test("un cambio di fasce non riscrive i dati: stesso cost_band con l'etichetta nuova, stesso importo nella fascia nuova", () => {
  const band2 = Object.freeze({ costBand: 2 });
  const read = (model: ValuationModel) => {
    const cost = costFigure(band2, model)!;
    return [cost.band, cost.bandLabel, cost.referenceEur];
  };
  assert.deepEqual(read(h1bBandsModel), [2, "Da 10.000 a 25.000 €", 25_000]);
  assert.deepEqual(read(v2Model), [2, "Da 25.000 a 65.000 €", 65_000]);
  assert.deepEqual(read(bandsModel), [2, "Da 15.000 a 40.000 €", 40_000]);
  // «Un importo di 30.000 € può passare da €€€ a €€»; l'importo resta quello.
  const amount = Object.freeze({ costEurOnce: 30_000 });
  assert.deepEqual([costFigure(amount, h1bBandsModel)!.band, costFigure(amount, v2Model)!.band], [3, 2]);
  assert.deepEqual([costFigure(amount, h1bBandsModel)!.referenceEur, costFigure(amount, v2Model)!.referenceEur], [30_000, 30_000]);
  assert.deepEqual(band2, { costBand: 2 });
});

// ─── Nomi (D16) ──────────────────────────────────────────────────────

test("D16: nessun nome «use» più una maiuscola nelle regole pure di H1b, nemmeno nei commenti", () => {
  // I 6 moduli puri di H1b e i loro test.
  const modules = ["quarter", "cost-bands", "valuation", "decisions", "labels", "inputs"];
  const files = modules.flatMap((name) => [`${name}.ts`, `${name}.test.ts`]);
  // D16 vale per le funzioni (DESIGN §3.5). Uno schema zod di inputs.ts (`export const …Schema = z`)
  // è una costante, come un id: lo esenta anche permissions.test.ts. Solo quei nomi, solo lì.
  const inputs = readFileSync(new URL("./inputs.ts", import.meta.url), "utf8");
  const zodSchemas = new Set([...inputs.matchAll(/export const (\w+Schema) = z\b/g)].map((m) => m[1]));
  const offenders = files.flatMap((file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), "utf8");
    return [...source.matchAll(/\buse[A-Z]\w*/g)]
      .filter((m) => !(file === "inputs.ts" && zodSchemas.has(m[0])))
      .map((m) => `${file}: ${m[0]}`);
  });
  assert.deepEqual(offenders, []);
  // I nomi giusti ci sono, nei commenti di decisions.ts.
  const decisions = readFileSync(new URL("./decisions.ts", import.meta.url), "utf8");
  assert.ok(decisions.includes("`phaseOfUseCase`") && decisions.includes("`abilitiesForUseCase`"));
});

// ─── Rischio (§7.3) ──────────────────────────────────────────────────

test("rischio: «Serve decisione AI Board» con semaforo rosso o segnalazione fuori perimetro", () => {
  assert.deepEqual(riskChips({ proposerEstimate: { impactFlag: { value: "rosso", reasoning: "testo" } } }), ["ai_board"]);
  assert.deepEqual(riskChips({ flags: { outsideFoundation: true } }), ["ai_board"]);
  assert.deepEqual(riskChips({ proposerEstimate: { impactFlag: { value: "rosso" } }, flags: { outsideFoundation: true } }), ["ai_board"]);
  assert.deepEqual(riskChips({ proposerEstimate: { impactFlag: { value: "verde" } } }), []);
  assert.deepEqual(riskChips({ proposerEstimate: { impactFlag: { value: "giallo" } }, flags: { outsideFoundation: false } }), []);
});

test("rischio: «Dati personali» e «Sicurezza» dalle segnalazioni", () => {
  assert.deepEqual(riskChips({ flags: { personalData: true } }), ["dati_personali"]);
  assert.deepEqual(riskChips({ flags: { safetyRelated: true } }), ["sicurezza"]);
  assert.deepEqual(
    riskChips({ proposerEstimate: { impactFlag: { value: "rosso" } }, flags: { personalData: true, safetyRelated: true } }),
    ["ai_board", "dati_personali", "sicurezza"],
  );
  assert.deepEqual(riskChips({ flags: { personalData: "true", safetyRelated: 1 } }), [], "solo true conta");
});

test("rischio: senza dati del connettore nessun chip, e non cambia Valore, Costo o zona", () => {
  for (const intake of [null, undefined, {}, [], "testo", { flags: null }, { proposerEstimate: "rosso" }]) {
    assert.deepEqual(riskChips(intake), [], JSON.stringify(intake));
  }
  const card = { customScores: { impact: { efficiency: 4 } }, costEurOnce: 20_000 };
  const risky = { ...card, intake: { flags: { personalData: true, outsideFoundation: true } } };
  assert.deepEqual(valueFigure(risky, v2Model), valueFigure(card, v2Model));
  assert.deepEqual(costFigure(risky, v2Model), costFigure(card, v2Model));
});

test("la stima di chi propone (dati del connettore) non entra mai nel Valore né nel costo (§7.1, §7.5)", () => {
  const intake = {
    timeSavedMinutesPerRun: 15,
    frequency: "giornaliera",
    beneficiaries: 3,
    valuePerRunEur: 20,
    proposerEstimate: { efficiency: { score: 5 }, effort: { score: 1 }, impactFlag: { value: "verde" } },
  };
  // Senza valori del team o dell'AI resta tutto «da stimare».
  assert.deepEqual(valueFigure({ intake } as never, v2Model), { score: null, word: null, source: null, perYear: null });
  assert.equal(costFigure({ intake } as never, v2Model), null);
  // Con i valori del team, la stima non li cambia.
  const card = { aiScores: { impact: { efficiency: 2 }, feasibility: { effort: 4 } } };
  assert.deepEqual(valueFigure({ ...card, intake } as never, v2Model), valueFigure(card, v2Model));
  assert.deepEqual(costFigure({ ...card, intake } as never, v2Model), costFigure(card, v2Model));
});

// ─── Valutazione del team (Riapri, §3.7) ─────────────────────────────

test("valori del team: un KPI di una persona, il valore all'anno o il costo", () => {
  assert.equal(hasTeamValuation({}), false);
  assert.equal(hasTeamValuation({ customScores: { impact: {} } }), false);
  assert.equal(hasTeamValuation({ customScores: { impact: { efficiency: 0 } } }), false);
  assert.equal(hasTeamValuation({ customScores: { feasibility: { effort: 3 } } }), true);
  assert.equal(hasTeamValuation({ valueEurYear: 0 }), true);
  assert.equal(hasTeamValuation({ costEurOnce: 40_000 }), true);
  assert.equal(hasTeamValuation({ costBand: 2 }), true);
  assert.equal(hasTeamValuation({ costBand: 9 }), false);
});
