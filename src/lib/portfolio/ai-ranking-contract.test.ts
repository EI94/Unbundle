import test from "node:test";
import assert from "node:assert/strict";
import {
  buildPortfolioScorePrompt,
  buildPortfolioScoreSchema,
  compactPortfolioScoreObject,
} from "./ai-ranking-contract.ts";
import type { UseCase } from "../db/schema.ts";
import type { ScoringModelConfig } from "../db/queries/scoring-model.ts";

const useCase = {
  id: "uc_1",
  title: "Automazione offerte enterprise",
  portfolioKind: "use_case_ai",
  description: "Il team prepara offerte manualmente con molti passaggi ripetitivi.",
  flowDescription: "Un agente raccoglie dati CRM, prepara la bozza e chiede approvazione.",
  humanInTheLoop: "Sales manager approva prima dell'invio.",
  guardrails: "Nessun invio automatico al cliente.",
  businessCase: "Riduzione tempi e aumento conversione.",
  dataRequirements: "CRM, listini, storico offerte.",
  timeline: "Q2",
  sustainabilityImpact: "Meno rilavorazioni e meno stress operativo.",
} as UseCase;

const config: ScoringModelConfig = {
  dimensions: {
    impact: [
      {
        id: "conversion",
        label: "Conversione",
        description: "1 = nessun impatto, 5 = crescita ricavi significativa.",
        weight: 2,
        direction: "higher_better",
      },
      {
        id: "quality",
        label: "Qualita output",
        description: "1 = invariata, 5 = non raggiungibile manualmente.",
        weight: 1,
        direction: "higher_better",
      },
    ],
    feasibility: [
      {
        id: "effort",
        label: "Effort",
        description: "1 = minimo, 5 = progetto molto complesso.",
        weight: 1,
        direction: "lower_better",
      },
    ],
    esg: [
      {
        id: "social",
        label: "Sociale",
        description: "1 = nullo, 5 = beneficio ampio per persone o clienti.",
        weight: 1,
        direction: "higher_better",
      },
    ],
  },
  overall: { impact: 0.55, feasibility: 0.3, esg: 0.15 },
  thresholds: { highImpact: 3.7, highFeasibility: 3.4, midImpact: 2.4 },
};

test("il prompt AI riflette KPI custom, pesi, direzione e rubriche salvate", () => {
  const prompt = buildPortfolioScorePrompt({
    workspaceName: "NATIVA",
    useCase,
    config,
    esgEnabled: true,
  });

  assert.match(prompt, /conversion \(Conversione\)/);
  assert.match(prompt, /Peso: 2/);
  assert.match(prompt, /Direzione: lower_better/);
  assert.match(prompt, /restituisci sempre null/);
  assert.match(prompt, /Non stimare impatto economico/);
  assert.match(prompt, /1 = minimo, 5 = progetto molto complesso/);
  assert.match(prompt, /KPI ESG/);
  const providerName = ["cl", "aude"].join("");
  assert.equal(prompt.toLowerCase().includes(providerName), false);
});

test("lo schema AI richiede i KPI dinamici ma accetta null per campi economici", () => {
  const schema = buildPortfolioScoreSchema(config, true);

  assert.equal(
    schema.safeParse({
      impact: { conversion: null, quality: 4 },
      feasibility: { effort: 2 },
      esg: { social: 4 },
      rationale:
        "Qualita e complessita sono valutabili; la conversione resta vuota senza dati economici verificabili.",
    }).success,
    true
  );

  assert.equal(
    schema.safeParse({
      impact: { conversion: 5 },
      feasibility: { effort: 2 },
      esg: { social: 4 },
      rationale:
        "Manca un KPI obbligatorio e quindi la risposta deve essere rifiutata.",
    }).success,
    false
  );
});

test("i null dell'AI non vengono salvati come score e restano compilabili dal reviewer", () => {
  assert.deepEqual(
    compactPortfolioScoreObject({
      impact: { conversion: null, quality: 4 },
      feasibility: { effort: 2 },
      esg: { social: undefined },
    }),
    {
      impact: { quality: 4 },
      feasibility: { effort: 2 },
      esg: {},
    }
  );
});

test("i KPI monetari restano manual-only anche se il modello restituisce un numero", () => {
  assert.deepEqual(
    compactPortfolioScoreObject(
      {
        impact: { conversion: 5, quality: 4 },
        feasibility: { effort: 2 },
        esg: { social: 3 },
      },
      config
    ),
    {
      impact: { quality: 4 },
      feasibility: { effort: 2 },
      esg: { social: 3 },
    }
  );
});

test("lo schema AI non accetta ESG quando ESG e disattivato", () => {
  const schema = buildPortfolioScoreSchema(config, false);
  const result = schema.safeParse({
    impact: { conversion: 4, quality: 3 },
    feasibility: { effort: 2 },
    rationale:
      "ESG e disattivato, quindi la risposta deve restare sui soli assi attivi.",
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.data, {
    impact: { conversion: 4, quality: 3 },
    feasibility: { effort: 2 },
    rationale:
      "ESG e disattivato, quindi la risposta deve restare sui soli assi attivi.",
  });
});
