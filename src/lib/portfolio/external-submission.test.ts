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
import { exampleSubmission } from "../connector/contract.fixtures.ts";
import { DEFAULT_REVIEW_TEAM_NAME } from "../review-team.ts";

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

test("requirements: senza nome del team la REST dà il nome predefinito, con la stessa chiave", () => {
  // DESIGN §14.2: la forma resta, cambia solo il valore per i workspace senza nome.
  for (const name of [null, undefined, "", "   "]) {
    const req = buildWorkspaceIntakeRequirements({ workspace: { ...workspace, aiTransformationTeamName: name } as Workspace, config });
    assert.equal(req.workspace.aiTransformationTeamName, DEFAULT_REVIEW_TEAM_NAME, JSON.stringify(name));
  }
  const named = buildWorkspaceIntakeRequirements({ workspace: { ...workspace, aiTransformationTeamName: "  CoE AI " } as Workspace, config });
  assert.equal(named.workspace.aiTransformationTeamName, "CoE AI");
  assert.deepEqual(Object.keys(named.workspace), ["id", "name", "esgEnabled", "aiTransformationTeamName"]);
});

// ─── Campi v2 del connettore (WP3): facoltativi ─────────────────────────────

test("un invio v1 resta identico: nessun campo aggiunto, hash stabile, intake vuoto", () => {
  const parsed = validateExternalContributionPayload(basePayload, { esgEnabled: false });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.deepEqual(parsed.data, basePayload);
  assert.equal(hashExternalContributionPayload(parsed.data), hashExternalContributionPayload(basePayload));
  const useCase = buildUseCaseDataFromExternalContribution({ payload: parsed.data, workspaceId: workspace.id, esgEnabled: false });
  assert.equal(useCase.intake, null);
  assert.equal(useCase.source, "claude_mcp");
  assert.equal(useCase.proposedBy, basePayload.submittedBy.email);
});

test("una segnalazione del contratto v2 passa anche lo schema condiviso", () => {
  const parsed = validateExternalContributionPayload(exampleSubmission(), { esgEnabled: false });
  assert.equal(parsed.ok, true, JSON.stringify(!parsed.ok && parsed.fieldErrors));
});

test("campi v2 controllati anche nello schema condiviso; campi sconosciuti sempre rifiutati", () => {
  const bad: Array<[string, Record<string, unknown>]> = [
    ["frequency", { frequency: "ogni_tanto" }],
    ["area", { area: "Area Con Spazi" }],
    ["tools", { tools: [] }],
    ["beneficiaries", { beneficiaries: 0 }],
    ["timeSavedMinutesPerRun", { timeSavedMinutesPerRun: -1 }],
    ["relatedCode", { relatedCode: "xx-1" }],
    ["relationType", { relationType: "uguale" }],
    ["flags.outsideFoundation", { flags: { personalData: false, safetyRelated: false } }],
    ["proponente", { proponente: "qualcuno" }],
  ];
  for (const [field, extra] of bad) {
    const parsed = validateExternalContributionPayload({ ...basePayload, ...extra }, { esgEnabled: false });
    assert.equal(parsed.ok, false, field);
    if (!parsed.ok) {
      assert.equal(parsed.code, "invalid_payload");
      assert.ok(Object.keys(parsed.fieldErrors).some((k) => k.startsWith(field) || k === "payload"), `${field}: ${JSON.stringify(parsed.fieldErrors)}`);
    }
  }
});

test("dal connettore: fonte claude_connector, nome in proposed_by, campi v2 in intake con contractVersion 2", () => {
  const payload = exampleSubmission({
    urgency: "quick_win",
    qualityGain: "sensibile",
    relatedAgent: "atlante",
    relatedCode: "XX-0007",
    relationType: "integra",
    promptSnippet: "Confronta le due tabelle e segnala le differenze.",
    sourceConversation: "Fatture di ottobre",
  });
  const parsed = validateExternalContributionPayload(payload, { esgEnabled: false });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const useCase = buildUseCaseDataFromExternalContribution({
    payload: parsed.data,
    workspaceId: workspace.id,
    esgEnabled: false,
    channel: "connector",
  });
  assert.equal(useCase.source, "claude_connector");
  assert.equal(useCase.proposedBy, "Persona di prova");
  assert.equal(useCase.status, "proposed");
  assert.equal(useCase.portfolioReviewStatus, "needs_inputs");
  assert.equal(useCase.timeline, "quick_win");
  assert.equal(useCase.description, payload.problem);
  assert.equal(useCase.businessCase, payload.expectedImpact);
  assert.deepEqual(useCase.intake, {
    contractVersion: 2,
    guideVersion: payload.guideVersion,
    area: payload.area,
    company: payload.company,
    tools: payload.tools,
    frequency: payload.frequency,
    beneficiaries: payload.beneficiaries,
    timeSavedMinutesPerRun: payload.timeSavedMinutesPerRun,
    qualityGain: "sensibile",
    developmentStatus: payload.developmentStatus,
    proposerEstimate: payload.proposerEstimate,
    flags: payload.flags,
    relatedAgent: "atlante",
    relatedCode: "XX-0007",
    relationType: "integra",
    promptSnippet: payload.promptSnippet,
    sourceConversation: "Fatture di ottobre",
    possibleDuplicateOf: "XX-0007",
    submitterEmail: "proponente@esempio.test",
  });
  for (const key of ["impactTime", "impactEconomic", "impactFlag", "customScores", "overallScore", "overallImpactScore"] as const) {
    assert.equal(useCase[key], undefined, key);
  }
});

test("intake: «simile_ma_diversa» non fa un possibile doppione; dalla REST niente contractVersion né email", () => {
  const payload = exampleSubmission({ relatedCode: "XX-0007", relationType: "simile_ma_diversa" });
  const parsed = validateExternalContributionPayload(payload, { esgEnabled: false });
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  const rest = buildUseCaseDataFromExternalContribution({ payload: parsed.data, workspaceId: workspace.id, esgEnabled: false });
  assert.equal(rest.source, "claude_mcp");
  assert.equal(rest.proposedBy, "proponente@esempio.test");
  const intake = rest.intake as Record<string, unknown>;
  assert.equal(intake.possibleDuplicateOf, undefined);
  assert.equal(intake.contractVersion, undefined);
  assert.equal(intake.submitterEmail, undefined);
  assert.equal(intake.relationType, "simile_ma_diversa");
});
