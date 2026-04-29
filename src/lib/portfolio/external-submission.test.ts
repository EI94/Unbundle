import test from "node:test";
import assert from "node:assert/strict";
import {
  buildUseCaseDataFromExternalContribution,
  buildWorkspaceIntakeRequirements,
  hashExternalContributionPayload,
  validateExternalContributionPayload,
  type ExternalContributionPayload,
} from "./external-submission.ts";
import type { Workspace } from "../db/schema.ts";
import type { ScoringModelConfig } from "../db/queries/scoring-model.ts";

const basePayload: ExternalContributionPayload = {
  idempotencyKey: "claude-test-001",
  confirmedByUser: true,
  contributionKind: "use_case_ai",
  submittedBy: { email: "gianlucag@nativalab.com", name: "Gianluca" },
  title: "Automated project tracking",
  problem: "Oggi il tracking dei progetti viene aggiornato manualmente dal team.",
  flowDescription:
    "Un agente legge gli aggiornamenti dai sistemi interni e prepara una vista sintetica per il project manager.",
  humanInTheLoop:
    "Il project manager verifica lo stato prima di condividere aggiornamenti con il cliente.",
  guardrails:
    "L'agente non può modificare scadenze o budget e deve segnalare dati mancanti.",
  expectedImpact:
    "Riduce tempo di coordinamento e aumenta qualità e tempestività degli aggiornamenti.",
  dataRequirements: "Accesso a project plan, task tracker e documenti di avanzamento.",
  urgency: "Quick win se i dati sono già accessibili.",
};

const workspace = {
  id: "54d65ec8-1969-4917-9260-7e58a7206585",
  name: "NATIVAI",
  esgEnabled: true,
  aiTransformationTeamName: "AI Builders",
} as Workspace;

const config: ScoringModelConfig = {
  dimensions: {
    impact: [
      { id: "efficiency", label: "Efficienza", weight: 1, direction: "higher_better" },
      { id: "profitability", label: "Profittabilita", weight: 1, direction: "higher_better" },
    ],
    feasibility: [
      { id: "effort", label: "Effort", weight: 1, direction: "lower_better" },
    ],
    esg: [
      { id: "environmental", label: "Ambientale", weight: 1, direction: "higher_better" },
    ],
  },
  overall: { impact: 0.5, feasibility: 0.3, esg: 0.2 },
  thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
};

test("valida use case AI con ESG e costruisce il payload use_cases corretto", () => {
  const payload = {
    ...basePayload,
    sustainabilityImpact:
      "Riduce rilavorazioni e stress operativo, con impatto sociale positivo sul team.",
  };
  const parsed = validateExternalContributionPayload(payload, { esgEnabled: true });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) throw new Error("payload rejected");

  const useCase = buildUseCaseDataFromExternalContribution({
    payload: parsed.data,
    workspaceId: workspace.id,
    esgEnabled: true,
  });

  assert.equal(useCase.workspaceId, workspace.id);
  assert.equal(useCase.portfolioKind, "use_case_ai");
  assert.equal(useCase.status, "proposed");
  assert.equal(useCase.source, "claude_mcp");
  assert.equal(useCase.proposedBy, "gianlucag@nativalab.com");
  assert.equal(useCase.sustainabilityImpact, payload.sustainabilityImpact);
});

test("richiede sostenibilita se ESG e attivo", () => {
  const parsed = validateExternalContributionPayload(basePayload, {
    esgEnabled: true,
  });
  assert.equal(parsed.ok, false);
  if (parsed.ok) throw new Error("payload accepted unexpectedly");
  assert.equal(parsed.code, "missing_esg");
  assert.match(parsed.fieldErrors.sustainabilityImpact, /ESG/);
});

test("richiede guardrail espliciti per uno use case AI", () => {
  const parsed = validateExternalContributionPayload(
    {
      ...basePayload,
      guardrails: undefined,
      sustainabilityImpact: "Impatto sociale da verificare.",
    },
    { esgEnabled: true }
  );
  assert.equal(parsed.ok, false);
  if (parsed.ok) throw new Error("payload accepted unexpectedly");
  assert.equal(parsed.code, "missing_guardrails");
});

test("accetta best practice senza guardrail e senza ESG quando disabilitato", () => {
  const parsed = validateExternalContributionPayload(
    {
      idempotencyKey: "best-practice-001",
      confirmedByUser: true,
      contributionKind: "best_practice",
      submittedBy: { name: "Luca Baldessarini" },
      title: "Sintesi meeting con AI",
      problem:
        "Prima le note dei meeting venivano scritte manualmente e spesso arrivavano tardi.",
      flowDescription:
        "Ora un assistente AI prepara una bozza di sintesi che il team rivede e condivide.",
      expectedImpact:
        "Il team risparmia tempo e riceve note piu complete e consistenti.",
      humanInTheLoop: "Tutta Nativa puo beneficiarne e i team owner la adottano.",
      dataRequirements: "Template note, trascrizioni meeting e owner del processo.",
    },
    { esgEnabled: false }
  );

  assert.equal(parsed.ok, true);
});

test("hash payload stabile anche con ordine chiavi diverso", () => {
  const a = hashExternalContributionPayload(basePayload);
  const b = hashExternalContributionPayload({
    ...basePayload,
    submittedBy: { name: "Gianluca", email: "gianlucag@nativalab.com" },
  });
  assert.equal(a, b);
});

test("requirements espongono ESG, KPI e policy anti stime monetarie", () => {
  const req = buildWorkspaceIntakeRequirements({ workspace, config });
  assert.equal(req.workspace.aiTransformationTeamName, "AI Builders");
  assert.equal(req.requiredFields.use_case_ai.some((f) => f.name === "sustainabilityImpact" && f.required), true);
  assert.equal(req.scoringModel.impact.length, 2);
  assert.match(req.scoringModel.note, /Non inventare EUR/);
  assert.match(req.confirmationPolicy, /conferma/);
});
