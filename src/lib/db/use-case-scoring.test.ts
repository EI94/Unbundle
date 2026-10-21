import test from "node:test";
import assert from "node:assert/strict";
import {
  AI_RATIONALE_LABELS,
  DEFAULT_SCORING_MODEL_CONFIG,
  aiMayWriteSuggestion,
  aiScoresOf,
  deriveUseCasePortfolioMetrics,
  isCustomScoringModel,
  kpiScoresOf,
  mergeScoringConfig,
  normalizeKpiScoreForAggregation,
  normalizeScoringConfig,
  replaceAiRationale,
  rewriteAiRationale,
  splitAiRationale,
  type AiSuggestionKind,
  type ScoreSource,
  type ScoringModelConfig,
  type ScoringModelConfigPatch,
} from "./use-case-scoring.ts";
import { COST_BANDS, COST_BANDS_MAX_EUR, DEFAULT_COST_BANDS_CONFIG, resolveCostBands } from "../use-cases/cost-bands.ts";
import { aggregateScores, type KpiScoreMap } from "../use-cases/valuation.ts";

// Punteggio degli use case, v1 e v2 (docs/use-case/DESIGN.md §7.6; PIANO-LAVORI H3a).
// Modulo puro: niente database. Le prove d'integrazione (AI, salvataggio del modello,
// `use-case-admin scoring-v2`) stanno in src/lib/use-cases/scoring-v2.integration.test.ts.

const config: ScoringModelConfig = {
  dimensions: {
    impact: [
      { id: "efficiency", label: "Efficienza", weight: 3, direction: "higher_better" },
      { id: "profitability", label: "Profittabilita", weight: 1, direction: "higher_better" },
    ],
    feasibility: [
      { id: "effort", label: "Effort", weight: 1, direction: "lower_better" },
    ],
    esg: [
      { id: "environmental", label: "Ambientale", weight: 1, direction: "higher_better" },
      { id: "social", label: "Sociale", weight: 1, direction: "higher_better" },
    ],
  },
  overall: { impact: 0.5, feasibility: 0.3, esg: 0.2 },
  thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
};

/** Arrotondato a 3 decimali: `null` resta `null` («da stimare» in v2). */
const fixed3 = (value: number | null) => (value === null ? null : Number(value.toFixed(3)));

test("normalizza i KPI lower_better mantenendo la scala grezza per input e AI", () => {
  assert.equal(
    normalizeKpiScoreForAggregation(1, {
      id: "effort",
      label: "Effort",
      weight: 1,
      direction: "lower_better",
    }),
    5
  );
  assert.equal(
    normalizeKpiScoreForAggregation(5, {
      id: "effort",
      label: "Effort",
      weight: 1,
      direction: "lower_better",
    }),
    1
  );
});

test("applica i pesi KPI, poi rinormalizza i pesi globali quando ESG e disattivato", () => {
  const metrics = deriveUseCasePortfolioMetrics(
    {
      customScores: {
        impact: { efficiency: 5, profitability: 1 },
        feasibility: { effort: 1 },
        esg: { environmental: 5, social: 5 },
      },
    },
    {
      model: { impactFlagEnabled: false, config },
      esgEnabled: false,
    }
  );

  assert.equal(metrics.overallImpactScore, 4);
  assert.equal(metrics.overallFeasibilityScore, 5);
  assert.equal(metrics.overallEsgScore, null);
  assert.equal(fixed3(metrics.overallScore), 4.375);
  assert.equal(metrics.category, "quick_win");
});

test("non ricostruisce la profitability da colonne legacy quando manca il valore manuale", () => {
  const metrics = deriveUseCasePortfolioMetrics(
    {
      impactEconomic: 5,
      impactTime: 5,
      impactQuality: 5,
      customScores: {
        impact: { efficiency: 5 },
        feasibility: { effort: 1 },
      },
    },
    {
      model: { impactFlagEnabled: false, config },
      esgEnabled: false,
    }
  );

  assert.equal(metrics.overallImpactScore, 3.75);
  assert.equal(metrics.overallFeasibilityScore, 5);
});

test("usa la profitability solo quando il reviewer la compila manualmente", () => {
  const metrics = deriveUseCasePortfolioMetrics(
    {
      customScores: {
        impact: { efficiency: 5, profitability: 4 },
        feasibility: { effort: 1 },
      },
    },
    {
      model: { impactFlagEnabled: false, config },
      esgEnabled: false,
    }
  );

  assert.equal(metrics.overallImpactScore, 4.75);
  assert.equal(metrics.overallFeasibilityScore, 5);
});

test("include ESG nel ranking e usa le soglie custom per la categoria", () => {
  const metrics = deriveUseCasePortfolioMetrics(
    {
      customScores: {
        impact: { efficiency: 3, profitability: 3 },
        feasibility: { effort: 4 },
        esg: { environmental: 5, social: 3 },
      },
    },
    {
      model: {
        impactFlagEnabled: false,
        config: {
          ...config,
          thresholds: { highImpact: 4.5, highFeasibility: 4.5, midImpact: 3 },
        },
      },
      esgEnabled: true,
    }
  );

  assert.equal(metrics.overallImpactScore, 3);
  assert.equal(metrics.overallFeasibilityScore, 2);
  assert.equal(metrics.overallEsgScore, 4);
  assert.equal(fixed3(metrics.overallScore), 2.9);
  assert.equal(metrics.category, "capability_builder");
});

// ─── v1: gli stessi numeri di oggi (istantanea) ──────────────────────

const KPI = (id: string, weight: number, direction: "higher_better" | "lower_better" = "higher_better") => ({ id, label: id, weight, direction });

/** Modelli d'esempio dell'istantanea v1: predefinito, pesato, con gli id storici, pesi complessivi a zero. */
const SNAPSHOT_MODELS = {
  predefinito: {
    dimensions: {
      impact: [KPI("efficiency", 1), KPI("profitability", 1)],
      feasibility: [KPI("effort", 1, "lower_better")],
      esg: [KPI("environmental", 1), KPI("social", 1)],
    },
    overall: { impact: 0.5, feasibility: 0.3, esg: 0.2 },
    thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
  },
  pesato: {
    dimensions: {
      impact: [KPI("efficiency", 3), KPI("profitability", 1), KPI("adozione", 2)],
      feasibility: [KPI("effort", 2, "lower_better"), KPI("dati", 1)],
      esg: [KPI("environmental", 1), KPI("social", 3)],
    },
    overall: { impact: 2, feasibility: 1, esg: 1 },
    thresholds: { highImpact: 3, highFeasibility: 3, midImpact: 2 },
  },
  storico: {
    dimensions: {
      impact: [KPI("economic", 2), KPI("time", 1), KPI("quality", 1), KPI("social", 1)],
      feasibility: [KPI("data", 1), KPI("risk", 1), KPI("tech", 2)],
      esg: [KPI("environmental", 1), KPI("social", 1), KPI("governance", 1)],
    },
    overall: { impact: 0.6, feasibility: 0.4, esg: 0.25 },
    thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
  },
  pesiZero: {
    dimensions: {
      impact: [KPI("efficiency", 0), KPI("profitability", 1)],
      feasibility: [KPI("effort", 1, "lower_better")],
      esg: [],
    },
    overall: { impact: 0, feasibility: 0, esg: 0 },
    thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
  },
} as const;

/** Schede d'esempio: vuota, persone, parziale, colonne storiche, miste, fuori scala, solo AI. */
const SNAPSHOT_CARDS = {
  vuota: {},
  persone: {
    customScores: {
      impact: { efficiency: 4, profitability: 2, adozione: 5, economic: 3, time: 4, quality: 2, social: 3 },
      feasibility: { effort: 2, dati: 4, data: 3, risk: 2, tech: 5 },
      esg: { environmental: 3, social: 4, governance: 5 },
    },
  },
  parziale: { customScores: { impact: { efficiency: 5 } } },
  storiche: {
    impactEconomic: 5, impactTime: 4, impactQuality: 2, impactCoordination: 3, impactSocial: 1,
    feasibilityData: 3, feasibilityWorkflow: 4, feasibilityRisk: 2, feasibilityTech: 5, feasibilityTeam: 1,
    esgEnvironmental: 4, esgSocial: 2, esgGovernance: 3,
  },
  miste: {
    impactTime: 3, impactQuality: 5, feasibilityData: 2, feasibilityTech: 4, esgGovernance: 4,
    customScores: { impact: { profitability: 3, economic: 4 }, feasibility: { risk: 3 }, esg: { social: 5 } },
  },
  fuoriScala: {
    impactCoordination: 9, impactSocial: -2,
    customScores: { impact: { efficiency: 7, profitability: -1, adozione: 0 }, feasibility: { effort: 0, dati: 6 } },
  },
  soloAi: {
    aiSuggestion: { scores: { impact: { efficiency: 5, profitability: 4 }, feasibility: { effort: 1 }, esg: { environmental: 5 } } },
  },
} as const;

type SnapshotModel = keyof typeof SNAPSHOT_MODELS;
type SnapshotCard = keyof typeof SNAPSHOT_CARDS;
type SnapshotRow = [SnapshotModel, SnapshotCard, boolean, number | null, number | null, number | null, number | null, string];

/**
 * Istantanea di `deriveUseCasePortfolioMetrics` com'era prima di H3a (feat/use-case-hub,
 * a71e407), su ogni modello e ogni scheda d'esempio, con ESG spento e acceso: impatto,
 * fattibilità, ESG, complessivo, quadrante. In v1 i numeri devono restare questi, al bit.
 */
const V1_SNAPSHOT: readonly SnapshotRow[] = [
  ["predefinito","vuota",false,0,0,null,0,"not_yet"],
  ["predefinito","vuota",true,0,0,0,0,"not_yet"],
  ["predefinito","persone",false,3,4,null,3.375,"capability_builder"],
  ["predefinito","persone",true,3,4,3.5,3.4000000000000004,"capability_builder"],
  ["predefinito","parziale",false,2.5,0,null,1.5625,"capability_builder"],
  ["predefinito","parziale",true,2.5,0,0,1.25,"capability_builder"],
  ["predefinito","storiche",false,1.5,3.25,null,2.15625,"not_yet"],
  ["predefinito","storiche",true,1.5,3.25,3,2.325,"not_yet"],
  ["predefinito","miste",false,3.5,3,null,3.3125,"strategic_bet"],
  ["predefinito","miste",true,3.5,3,2.5,3.15,"strategic_bet"],
  ["predefinito","fuoriScala",false,2.5,0,null,1.5625,"capability_builder"],
  ["predefinito","fuoriScala",true,2.5,0,0,1.25,"capability_builder"],
  ["predefinito","soloAi",false,0,0,null,0,"not_yet"],
  ["predefinito","soloAi",true,0,0,0,0,"not_yet"],
  ["pesato","vuota",false,0,0,null,0,"not_yet"],
  ["pesato","vuota",true,0,0,0,0,"not_yet"],
  ["pesato","persone",false,4,4,null,4,"quick_win"],
  ["pesato","persone",true,4,4,3.75,3.9375,"quick_win"],
  ["pesato","parziale",false,2.5,0,null,1.6666666666666665,"capability_builder"],
  ["pesato","parziale",true,2.5,0,0,1.25,"capability_builder"],
  ["pesato","storiche",false,1.5,2.1666666666666665,null,1.722222222222222,"not_yet"],
  ["pesato","storiche",true,1.5,2.1666666666666665,2.5,1.9166666666666665,"not_yet"],
  ["pesato","miste",false,2.5,2,null,2.333333333333333,"capability_builder"],
  ["pesato","miste",true,2.5,2,3.75,2.6875,"capability_builder"],
  ["pesato","fuoriScala",false,2.5,1.6666666666666667,null,2.2222222222222223,"capability_builder"],
  ["pesato","fuoriScala",true,2.5,1.6666666666666667,0,1.6666666666666667,"capability_builder"],
  ["pesato","soloAi",false,0,0,null,0,"not_yet"],
  ["pesato","soloAi",true,0,0,0,0,"not_yet"],
  ["storico","vuota",false,0,0,null,0,"not_yet"],
  ["storico","vuota",true,0,0,0,0,"not_yet"],
  ["storico","persone",false,3,3.75,null,3.3,"capability_builder"],
  ["storico","persone",true,3,3.75,4,3.4399999999999995,"capability_builder"],
  ["storico","parziale",false,0,0,null,0,"not_yet"],
  ["storico","parziale",true,0,0,0,0,"not_yet"],
  ["storico","storiche",false,3.4,3.75,null,3.54,"capability_builder"],
  ["storico","storiche",true,3.4,3.75,3,3.432,"capability_builder"],
  ["storico","miste",false,3.2,3.25,null,3.2199999999999998,"capability_builder"],
  ["storico","miste",true,3.2,3.25,3,3.176,"capability_builder"],
  ["storico","fuoriScala",false,0,0,null,0,"not_yet"],
  ["storico","fuoriScala",true,0,0,0,0,"not_yet"],
  ["storico","soloAi",false,0,0,null,0,"not_yet"],
  ["storico","soloAi",true,0,0,0,0,"not_yet"],
  ["pesiZero","vuota",false,0,0,null,0,"not_yet"],
  ["pesiZero","vuota",true,0,0,0,0,"not_yet"],
  ["pesiZero","persone",false,2,4,null,3,"not_yet"],
  ["pesiZero","persone",true,2,4,0,3,"not_yet"],
  ["pesiZero","parziale",false,0,0,null,0,"not_yet"],
  ["pesiZero","parziale",true,0,0,0,0,"not_yet"],
  ["pesiZero","storiche",false,0,3.25,null,1.625,"not_yet"],
  ["pesiZero","storiche",true,0,3.25,0,1.625,"not_yet"],
  ["pesiZero","miste",false,3,3,null,3,"capability_builder"],
  ["pesiZero","miste",true,3,3,0,3,"capability_builder"],
  ["pesiZero","fuoriScala",false,0,0,null,0,"not_yet"],
  ["pesiZero","fuoriScala",true,0,0,0,0,"not_yet"],
  ["pesiZero","soloAi",false,0,0,null,0,"not_yet"],
  ["pesiZero","soloAi",true,0,0,0,0,"not_yet"],
];

const modelOf = (name: SnapshotModel): ScoringModelConfig => SNAPSHOT_MODELS[name] as unknown as ScoringModelConfig;
const cardOf = (name: SnapshotCard): ScoreSource => SNAPSHOT_CARDS[name] as unknown as ScoreSource;

test("v1: gli stessi numeri di oggi sui modelli d'esempio (istantanea), con la versione del modello o esplicita", () => {
  assert.equal(V1_SNAPSHOT.length, Object.keys(SNAPSHOT_MODELS).length * Object.keys(SNAPSHOT_CARDS).length * 2);
  for (const [m, c, esgEnabled, impact, feasibility, esg, overall, category] of V1_SNAPSHOT) {
    const expected = { overallImpactScore: impact, overallFeasibilityScore: feasibility, overallEsgScore: esg, overallScore: overall, category };
    const label = `${m} · ${c} · ESG ${esgEnabled ? "acceso" : "spento"}`;
    // Senza `scoringVersion` (i modelli di oggi), con `scoringVersion: 1` e con `version: 1`.
    assert.deepEqual(deriveUseCasePortfolioMetrics(cardOf(c), { model: { impactFlagEnabled: false, config: modelOf(m) }, esgEnabled }), expected, label);
    assert.deepEqual(
      deriveUseCasePortfolioMetrics(cardOf(c), { model: { impactFlagEnabled: false, config: { ...modelOf(m), scoringVersion: 1 } }, esgEnabled }),
      expected,
      `${label} · scoringVersion 1`,
    );
    assert.deepEqual(
      deriveUseCasePortfolioMetrics(cardOf(c), { model: { impactFlagEnabled: false, config: { ...modelOf(m), scoringVersion: 2 } }, esgEnabled, version: 1 }),
      expected,
      `${label} · version 1 esplicita`,
    );
  }
});

test("v1: senza modello i numeri di oggi; i KPI dell'AI di ai_suggestion non contano", () => {
  assert.deepEqual(deriveUseCasePortfolioMetrics({ customScores: { impact: { efficiency: 5 } } }), {
    overallImpactScore: 0,
    overallFeasibilityScore: 0,
    overallEsgScore: null,
    overallScore: 0,
    category: "not_yet",
  });
  const withAi = deriveUseCasePortfolioMetrics(
    { customScores: { impact: { efficiency: 4 } }, aiSuggestion: { scores: { impact: { efficiency: 1, profitability: 5 } } } },
    { model: { impactFlagEnabled: false, config } },
  );
  const withoutAi = deriveUseCasePortfolioMetrics({ customScores: { impact: { efficiency: 4 } } }, { model: { impactFlagEnabled: false, config } });
  assert.deepEqual(withAi, withoutAi);
});

// ─── Un solo aggregatore: valuation.ts e gli overall_* salvati ───────

test("valuation.ts e deriveUseCasePortfolioMetrics danno gli stessi numeri sugli stessi modelli, in v1 e in v2", () => {
  for (const m of Object.keys(SNAPSHOT_MODELS) as SnapshotModel[]) {
    for (const c of Object.keys(SNAPSHOT_CARDS) as SnapshotCard[]) {
      for (const esgEnabled of [false, true]) {
        for (const version of [1, 2] as const) {
          const card = cardOf(c);
          const derived = deriveUseCasePortfolioMetrics(card, { model: { impactFlagEnabled: false, config: modelOf(m) }, esgEnabled, version });
          const aggregated = aggregateScores(
            {
              ...card,
              customScores: (card.customScores ?? null) as KpiScoreMap | null,
              aiScores: aiScoresOf(card.aiSuggestion),
            },
            modelOf(m),
            { version, esgEnabled },
          );
          const label = `${m} · ${c} · ESG ${esgEnabled} · v${version}`;
          assert.deepEqual(
            [derived.overallImpactScore, derived.overallFeasibilityScore, derived.overallEsgScore, derived.overallScore],
            [aggregated.impact, aggregated.feasibility, aggregated.esg, aggregated.overall],
            label,
          );
        }
      }
    }
  }
});

test("v2 si sceglie con scoringVersion = 2 del modello; version la sostituisce", () => {
  const card: ScoreSource = { aiSuggestion: { scores: { impact: { efficiency: 5 }, feasibility: { effort: 1 } } } };
  const v2Config = { ...config, scoringVersion: 2 as const };
  const v2 = deriveUseCasePortfolioMetrics(card, { model: { impactFlagEnabled: false, config: v2Config } });
  assert.equal(v2.overallImpactScore, 5);
  assert.equal(v2.overallFeasibilityScore, 5);
  assert.deepEqual(deriveUseCasePortfolioMetrics(card, { model: { impactFlagEnabled: false, config }, version: 2 }), v2);
  const v1 = deriveUseCasePortfolioMetrics(card, { model: { impactFlagEnabled: false, config: v2Config }, version: 1 });
  assert.equal(v1.overallImpactScore, 0, "in v1 i KPI dell'AI non contano");
});

// ─── v2: le regole di §7.6 ───────────────────────────────────────────

const v2 = (card: ScoreSource, esgEnabled = false, model: ScoringModelConfig = config) =>
  deriveUseCasePortfolioMetrics(card, { model: { impactFlagEnabled: false, config: { ...model, scoringVersion: 2 } }, esgEnabled });

test("regola 1: per ogni KPI persona, poi AI, poi colonne legacy", () => {
  const equal = { ...config, dimensions: { ...config.dimensions, impact: config.dimensions.impact.map((k) => ({ ...k, weight: 1 })) } };
  // efficiency dalla persona (2), profitability dall'AI (4): l'efficiency dell'AI (5) e le colonne legacy non contano.
  const both = v2(
    {
      impactTime: 3,
      impactQuality: 3,
      customScores: { impact: { efficiency: 2 } },
      aiSuggestion: { scores: { impact: { efficiency: 5, profitability: 4 } } },
    },
    false,
    equal,
  );
  assert.equal(both.overallImpactScore, 3);
  // Senza persona e senza AI per efficiency: le colonne legacy di oggi ((4 + 2) / 2).
  const legacy = v2({ impactTime: 4, impactQuality: 2, aiSuggestion: { scores: { impact: { profitability: 5 } } } }, false, equal);
  assert.equal(legacy.overallImpactScore, 4);
  // Lo sforzo (lower_better) della persona vince su quello dell'AI e si inverte: 2 → 4.
  const effort = v2({ customScores: { feasibility: { effort: 2 } }, aiSuggestion: { scores: { feasibility: { effort: 5 } } } });
  assert.equal(effort.overallFeasibilityScore, 4);
  // Un valore vuoto o zero della persona non copre quello dell'AI.
  const empty = v2({ customScores: { impact: { efficiency: 0 } }, aiSuggestion: { scores: { impact: { efficiency: 4 } } } });
  assert.equal(empty.overallImpactScore, 4);
});

test("regola 2: un KPI vuoto esce dal denominatore; una dimensione senza valori è null («da stimare»)", () => {
  // Valutata solo dall'AI, senza profittabilità: 5 di impatto, non 3,75 come in v1.
  const aiOnly = v2({ aiSuggestion: { scores: { impact: { efficiency: 5 }, feasibility: { effort: 1 } } } });
  assert.equal(aiOnly.overallImpactScore, 5);
  assert.equal(aiOnly.overallFeasibilityScore, 5);
  assert.equal(aiOnly.overallScore, 5);
  assert.equal(aiOnly.category, "quick_win");
  const v1 = deriveUseCasePortfolioMetrics(
    { customScores: { impact: { efficiency: 5 }, feasibility: { effort: 1 } } },
    { model: { impactFlagEnabled: false, config } },
  );
  assert.equal(v1.overallImpactScore, 3.75, "in v1 la profittabilità vuota vale 0 e resta nel denominatore");

  // Solo impatto: fattibilità null, il complessivo è l'impatto (la dimensione vuota esce anche lì).
  const impactOnly = v2({ customScores: { impact: { efficiency: 4, profitability: 2 } } });
  assert.equal(impactOnly.overallImpactScore, 3.5);
  assert.equal(impactOnly.overallFeasibilityScore, null);
  assert.equal(impactOnly.overallScore, 3.5);
  assert.equal(impactOnly.category, "strategic_bet", "fattibilità da stimare: sotto ogni soglia");

  // Niente valori: tutto null, quadrante «not_yet» (category resta calcolata, non si mostra).
  assert.deepEqual(v2({}, true), {
    overallImpactScore: null,
    overallFeasibilityScore: null,
    overallEsgScore: null,
    overallScore: null,
    category: "not_yet",
  });
  // ESG spento: null anche con valori; acceso: conta solo con valori.
  const esg = { customScores: { impact: { efficiency: 4 }, esg: { environmental: 2 } } };
  assert.equal(v2(esg, false).overallEsgScore, null);
  assert.equal(v2(esg, true).overallEsgScore, 2);
  assert.equal(fixed3(v2(esg, true).overallScore), fixed3((4 * 0.5 + 2 * 0.2) / 0.7));
});

const AI_KINDS: readonly AiSuggestionKind[] = ["auto", "suggerimento", "ricalibrazione"];

test("regole 3 e 4: quali schede scrive l'AI in v2 (mai le valutate o le archiviate fuori da «Chiedi un suggerimento»)", () => {
  const at = new Date("2026-10-01T10:00:00Z");
  const cases: Array<[string, Date | null, Record<AiSuggestionKind, boolean>]> = [
    ["needs_inputs", null, { auto: true, suggerimento: true, ricalibrazione: true }],
    ["needs_inputs", at, { auto: false, suggerimento: true, ricalibrazione: true }],
    ["in_review", null, { auto: false, suggerimento: true, ricalibrazione: true }],
    ["in_review", at, { auto: false, suggerimento: true, ricalibrazione: true }],
    ["scored", at, { auto: false, suggerimento: true, ricalibrazione: false }],
    ["archived", at, { auto: false, suggerimento: true, ricalibrazione: false }],
    ["archived", null, { auto: false, suggerimento: true, ricalibrazione: false }],
  ];
  for (const [status, reviewedAt, expected] of cases) {
    for (const kind of AI_KINDS) {
      const card = { portfolioReviewStatus: status, reviewedAt } as Parameters<typeof aiMayWriteSuggestion>[0];
      assert.equal(aiMayWriteSuggestion(card, kind), expected[kind], `${status} · ${reviewedAt ? "valutata" : "mai"} · ${kind}`);
    }
  }
});

test("regola 5: i blocchi della motivazione dell'AI escono dalle note, con la stessa espressione di replaceAiRationale", () => {
  assert.deepEqual([...AI_RATIONALE_LABELS], ["Auto-ranking AI", "Suggerimento AI", "Ricalibrazione AI"]);
  // replaceAiRationale (v1): come oggi, toglie i blocchi dell'AI e mette il nuovo in fondo.
  assert.equal(replaceAiRationale(null, " Motivo uno ", "Auto-ranking AI"), "Auto-ranking AI:\nMotivo uno");
  assert.equal(
    replaceAiRationale("Nota del team.\n\nAuto-ranking AI:\nVecchio motivo", "Nuovo motivo", "Ricalibrazione AI"),
    "Nota del team.\n\nRicalibrazione AI:\nNuovo motivo",
  );
  assert.equal(replaceAiRationale("Suggerimento AI:\nVecchio", "Nuovo", "Suggerimento AI"), "Suggerimento AI:\nNuovo");

  assert.deepEqual(splitAiRationale("Nota del team.\n\nAuto-ranking AI:\nMotivo dell'AI\nsu due righe"), {
    notes: "Nota del team.",
    blocks: [{ label: "Auto-ranking AI", text: "Motivo dell'AI\nsu due righe" }],
  });
  assert.deepEqual(splitAiRationale("Suggerimento AI:\nUno\n\nRicalibrazione AI:\nDue"), {
    notes: null,
    blocks: [
      { label: "Suggerimento AI", text: "Uno" },
      { label: "Ricalibrazione AI", text: "Due" },
    ],
  });
  // Senza blocchi le note tornano come sono; un'etichetta a metà riga non è un blocco.
  assert.deepEqual(splitAiRationale("Nota con Auto-ranking AI: citato"), { notes: "Nota con Auto-ranking AI: citato", blocks: [] });
  assert.deepEqual(splitAiRationale(null), { notes: null, blocks: [] });
  assert.deepEqual(splitAiRationale(""), { notes: "", blocks: [] });
  // Le note di replaceAiRationale si dividono di nuovo nelle stesse parti.
  const stamped = replaceAiRationale("Prima nota.\n\nSeconda nota.", "Motivo", "Auto-ranking AI");
  assert.deepEqual(splitAiRationale(stamped), { notes: "Prima nota.\n\nSeconda nota.", blocks: [{ label: "Auto-ranking AI", text: "Motivo" }] });
});

test("rewriteAiRationale: ogni blocco dell'AI lascia nelle note, al suo posto, solo quel che `keep` restituisce", () => {
  // Un blocco arriva fino alla fine: comprende la riga scritta sotto da una persona.
  const notes = "Nota.\n\nAuto-ranking AI:\nMotivo dell'AI.\n\nRiga del revisore.";
  const seen: Array<{ label: string; text: string }> = [];
  const kept = rewriteAiRationale(notes, (block) => {
    seen.push(block);
    return block.text.slice("Motivo dell'AI.".length);
  });
  assert.deepEqual(seen, [{ label: "Auto-ranking AI", text: "Motivo dell'AI.\n\nRiga del revisore." }]);
  assert.equal(kept, "Nota.\n\nRiga del revisore.");
  // Con `keep` vuoto è splitAiRationale(...).notes.
  for (const value of [notes, "Suggerimento AI:\nUno\n\nRicalibrazione AI:\nDue", "Auto-ranking AI:\nSolo AI", "Nota con Auto-ranking AI: citato"]) {
    assert.equal(rewriteAiRationale(value, () => ""), splitAiRationale(value).notes, value);
  }
  // Un blocco in testa con testo tenuto, poi un altro blocco tolto.
  assert.equal(rewriteAiRationale("Suggerimento AI:\nUno\n\nRicalibrazione AI:\nDue", (b) => (b.text === "Uno" ? "Tenuto" : "")), "Tenuto");
});

// ─── Modello: chiavi di §7.2 e §7.6, predefiniti, merge dei salvataggi ─

const CUSTOM_BANDS = {
  limits: [15_000, 40_000, 100_000, 200_000],
  labels: ["Piccolo", "Medio", "Grande", "Molto grande", "Enorme"],
  topReferenceEur: 300_000,
};

test("normalizeScoringConfig: scoringVersion, costKpiId, costLowMaxEur e costBands con i predefiniti", () => {
  const empty = normalizeScoringConfig(null);
  assert.equal(empty.scoringVersion, 1);
  assert.equal(empty.costKpiId, "effort");
  assert.equal(empty.thresholds.costLowMaxEur, 25_000);
  assert.deepEqual(empty.costBands, COST_BANDS);
  assert.deepEqual(empty.dimensions, DEFAULT_SCORING_MODEL_CONFIG.dimensions);
  assert.deepEqual(empty.overall, DEFAULT_SCORING_MODEL_CONFIG.overall);

  assert.equal(normalizeScoringConfig({ scoringVersion: 2 }).scoringVersion, 2);
  for (const value of [1, "2", 3, null, true, { v: 2 }]) {
    assert.equal(normalizeScoringConfig({ scoringVersion: value }).scoringVersion, 1, JSON.stringify(value));
  }
  assert.equal(normalizeScoringConfig({ costKpiId: "sforzo" }).costKpiId, "sforzo");
  assert.equal(normalizeScoringConfig({ costKpiId: "  " }).costKpiId, "effort");
  assert.equal(normalizeScoringConfig({ thresholds: { costLowMaxEur: 30_000 } }).thresholds.costLowMaxEur, 30_000);
  assert.equal(normalizeScoringConfig({ thresholds: { costLowMaxEur: -1 } }).thresholds.costLowMaxEur, 25_000);
  assert.equal(normalizeScoringConfig({ thresholds: { costLowMaxEur: "30000" } }).thresholds.costLowMaxEur, 25_000);
  assert.equal(normalizeScoringConfig({ thresholds: { costLowMaxEur: 5e9 } }).thresholds.costLowMaxEur, COST_BANDS_MAX_EUR);
  // Le soglie di oggi restano, con la soglia del costo accanto.
  assert.deepEqual(normalizeScoringConfig({ thresholds: { highImpact: 4, midImpact: 2 } }).thresholds, {
    highImpact: 4,
    highFeasibility: 3.5,
    midImpact: 2,
    costLowMaxEur: 25_000,
  });
});

test("normalizeScoringConfig passa le fasce valide (resolveCostBands) e scarta quelle non valide", () => {
  const valid = normalizeScoringConfig({ costBands: CUSTOM_BANDS });
  assert.deepEqual(valid.costBands, resolveCostBands({ costBands: CUSTOM_BANDS }));
  assert.deepEqual(valid.costBands.map((b) => b.label), CUSTOM_BANDS.labels);
  assert.equal(valid.costBands[4].referenceEur, 300_000);
  // Già risolte, si rileggono uguali.
  assert.deepEqual(resolveCostBands(valid), valid.costBands);
  for (const invalid of [
    { ...CUSTOM_BANDS, limits: [40_000, 15_000, 100_000, 200_000] },
    { ...CUSTOM_BANDS, limits: [15_000, 40_000, 100_000] },
    { ...CUSTOM_BANDS, topReferenceEur: 150_000 },
    { ...CUSTOM_BANDS, labels: ["", "Medio", "Grande", "Molto grande", "Enorme"] },
    { ...CUSTOM_BANDS, labels: ["x".repeat(41), "Medio", "Grande", "Molto grande", "Enorme"] },
    "fasce",
    [1, 2, 3],
  ]) {
    assert.deepEqual(normalizeScoringConfig({ costBands: invalid }).costBands, COST_BANDS, JSON.stringify(invalid));
  }
});

test("normalizeScoringConfig: i modelli storici si leggono come oggi", () => {
  const legacy = normalizeScoringConfig({ weights: { impact: { efficiency: 2 }, overall: { impact: 0.6, feasibility: 0.4, esgWhenEnabled: 0.1 } } });
  assert.equal(legacy.dimensions.impact[0].weight, 2);
  assert.deepEqual(legacy.overall, { impact: 0.6, feasibility: 0.4, esg: 0.1 });
  const oldIds = normalizeScoringConfig({
    dimensions: {
      impact: [{ id: "time", label: "Tempo", weight: 2 }, { id: "quality", label: "Qualità", weight: 4 }, { id: "economic", label: "Economico", weight: 3 }],
      feasibility: [{ id: "data", label: "Dati", weight: 1 }],
      esg: [{ id: "environmental", label: "Ambiente", weight: 1 }, { id: "governance", label: "Governance", weight: 1 }],
    },
  });
  assert.deepEqual(oldIds.dimensions.impact.map((k) => [k.id, k.weight]), [["efficiency", 3], ["profitability", 3]]);
  assert.deepEqual(oldIds.dimensions.feasibility.map((k) => k.id), ["effort"]);
  assert.equal(oldIds.scoringVersion, 1);
});

test("DEFAULT_SCORING_MODEL_CONFIG non scrive le chiavi nuove: valgono i predefiniti", () => {
  for (const key of ["scoringVersion", "costKpiId", "costBands"]) assert.equal(key in DEFAULT_SCORING_MODEL_CONFIG, false, key);
  assert.equal("costLowMaxEur" in DEFAULT_SCORING_MODEL_CONFIG.thresholds, false);
});

test("mergeScoringConfig: un salvataggio del modulo non cancella scoringVersion, costKpiId, costLowMaxEur, costBands né chiavi sconosciute", () => {
  const saved = {
    ...DEFAULT_SCORING_MODEL_CONFIG,
    thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5, costLowMaxEur: 30_000 },
    scoringVersion: 2,
    costKpiId: "effort",
    costBands: CUSTOM_BANDS,
    futura: { qualcosa: true },
  };
  const form: ScoringModelConfigPatch = {
    dimensions: { ...DEFAULT_SCORING_MODEL_CONFIG.dimensions, impact: [{ id: "efficiency", label: "Efficienza", weight: 2, direction: "higher_better" }] },
    overall: { impact: 0.6, feasibility: 0.4, esg: 0 },
    thresholds: { highImpact: 4, highFeasibility: 3, midImpact: 2 },
  };
  const merged = mergeScoringConfig(saved, form);
  assert.equal(merged.scoringVersion, 2);
  assert.equal(merged.costKpiId, "effort");
  assert.deepEqual(merged.costBands, CUSTOM_BANDS);
  assert.deepEqual(merged.futura, { qualcosa: true });
  assert.deepEqual(merged.thresholds, { highImpact: 4, highFeasibility: 3, midImpact: 2, costLowMaxEur: 30_000 });
  assert.deepEqual(merged.dimensions, form.dimensions);
  assert.deepEqual(merged.overall, form.overall);
  assert.equal(saved.thresholds.highImpact, 3.5, "il config salvato non cambia");
  const resolved = normalizeScoringConfig(merged);
  assert.equal(resolved.scoringVersion, 2);
  assert.equal(resolved.thresholds.costLowMaxEur, 30_000);
  assert.deepEqual(resolved.costBands.map((b) => b.label), CUSTOM_BANDS.labels);
});

test("mergeScoringConfig: soglie una per una, fasce validate o tolte, mai scoringVersion", () => {
  const saved = { scoringVersion: 2, thresholds: { highImpact: 3.5, costLowMaxEur: 30_000 }, costBands: CUSTOM_BANDS };
  assert.deepEqual(mergeScoringConfig(saved, { thresholds: { costLowMaxEur: 40_000, midImpact: undefined } }).thresholds, {
    highImpact: 3.5,
    costLowMaxEur: 40_000,
  });
  assert.equal("costBands" in mergeScoringConfig(saved, { costBands: null }), false, "null toglie le fasce del workspace");
  assert.deepEqual(mergeScoringConfig(saved, { costBands: DEFAULT_COST_BANDS_CONFIG }).costBands, {
    limits: [...DEFAULT_COST_BANDS_CONFIG.limits],
    labels: [...DEFAULT_COST_BANDS_CONFIG.labels],
    topReferenceEur: DEFAULT_COST_BANDS_CONFIG.topReferenceEur,
  });
  assert.deepEqual(mergeScoringConfig(saved, { costBands: { ...CUSTOM_BANDS, labels: ["  Piccolo  ", "Medio", "Grande", "Molto grande", "Enorme"] } }).costBands, CUSTOM_BANDS);
  assert.throws(() => mergeScoringConfig(saved, { costBands: { ...CUSTOM_BANDS, topReferenceEur: 1 } }), /Fasce del costo non valide/);
  assert.equal(mergeScoringConfig(saved, { costKpiId: "sforzo" }).costKpiId, "sforzo");
  // Nemmeno passata di nascosto: il merge non copia scoringVersion.
  const smuggled = { scoringVersion: 1, thresholds: { highImpact: 4 } } as unknown as ScoringModelConfigPatch;
  assert.equal(mergeScoringConfig(saved, smuggled).scoringVersion, 2);
  assert.equal("scoringVersion" in mergeScoringConfig(null, smuggled), false);
  assert.deepEqual(mergeScoringConfig("non un oggetto", { overall: { impact: 1, feasibility: 1, esg: 0 } }), { overall: { impact: 1, feasibility: 1, esg: 0 } });
});

test("isCustomScoringModel, kpiScoresOf e aiScoresOf", () => {
  assert.equal(isCustomScoringModel(DEFAULT_SCORING_MODEL_CONFIG), false);
  assert.equal(isCustomScoringModel(normalizeScoringConfig({ ...DEFAULT_SCORING_MODEL_CONFIG, overall: { impact: 1, feasibility: 1, esg: 1 } })), false, "i pesi non lo rendono personalizzato");
  assert.equal(isCustomScoringModel(config), false);
  assert.equal(isCustomScoringModel({ dimensions: { ...config.dimensions, feasibility: [...config.dimensions.feasibility, { id: "dati", label: "Dati", weight: 1 }] } }), true);
  assert.equal(isCustomScoringModel(SNAPSHOT_MODELS.storico as unknown as ScoringModelConfig), true);

  assert.deepEqual(kpiScoresOf({ impact: { efficiency: 4, x: "3", y: null, z: Number.NaN }, feasibility: [], esg: { social: 2 }, altro: { a: 1 } }), {
    impact: { efficiency: 4 },
    esg: { social: 2 },
  });
  assert.deepEqual(kpiScoresOf({ impact: {} }), {});
  assert.equal(kpiScoresOf(null), null);
  assert.equal(kpiScoresOf([1]), null);

  assert.deepEqual(aiScoresOf({ scores: { impact: { efficiency: 5 } }, rationale: "r" }), { impact: { efficiency: 5 } });
  assert.equal(aiScoresOf({ rationale: "r" }), null);
  assert.equal(aiScoresOf(null), null);
  assert.equal(aiScoresOf({ scores: [1] }), null);
});
