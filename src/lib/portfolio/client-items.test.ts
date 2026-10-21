import test from "node:test";
import assert from "node:assert/strict";
import type { UseCase } from "../db/schema.ts";
import type { ScoringModelConfig } from "../db/queries/scoring-model.ts";
import { readUseCaseRawKpiScore } from "../db/use-case-scoring.ts";
import {
  PORTFOLIO_CLIENT_ITEM_KEYS,
  PORTFOLIO_REVIEWER_EXTRA_KEYS,
  isHiddenFromColleagues,
  isPlacedOnMatrix,
  isWavePlanCandidate,
  sanitizeCustomScores,
  toPortfolioClientItem,
  toPortfolioClientItems,
  toPortfolioReviewerItem,
  type PortfolioItem,
} from "./client-items.ts";

// Synthetic proposer data: none of it may reach the browser of the «Raccolta & ranking» page.
const PROPOSER_NAME = "Giulia Proponente Sintetica";
const PROPOSER_EMAIL = "giulia.proponente@cliente.test";
const INTAKE_EMAIL = "giulia.intake@cliente.test";
const SOURCE_CONVERSATION = "Chat riservata di Giulia sul magazzino";
const PROMPT_SNIPPET = "Prompt privato di Giulia: riassumi le fatture del fornitore";
const SUBMITTER_IDENTITY_ID = "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f0001";
const REVIEWER_USER_ID = "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f0002";
const WORKSPACE_ID = "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f0003";
const REVIEW_NOTES = "Nota interna di chi valuta: verificare i volumi prima della wave";
const PUBLIC_NOTE = "Nota pubblica sintetica per chi conosce il codice";
const CODE = "TJ-0042";

const IDENTITY_STRINGS = [
  PROPOSER_NAME,
  PROPOSER_EMAIL,
  INTAKE_EMAIL,
  SOURCE_CONVERSATION,
  PROMPT_SNIPPET,
  SUBMITTER_IDENTITY_ID,
  REVIEWER_USER_ID,
  WORKSPACE_ID,
  PUBLIC_NOTE,
  CODE,
  "Giulia",
];

/** Keys a client row must never carry, whoever is looking. */
const NEVER_KEYS = [
  "workspaceId",
  "proposedBy",
  "source",
  "submittedByUserId",
  "submittedAt",
  "reviewedBy",
  "reviewedAt",
  "intake",
  "code",
  "publicNote",
  "createdAt",
  "statusChangedAt",
  "status",
  "category",
  "impactFlag",
  "sequenceOrder",
  "timeline",
  "requirements",
  "dataDependencies",
  "relatedActivityIds",
];

const EXPECTED_CLIENT_KEYS = [
  "id",
  "title",
  "description",
  "businessCase",
  "flowDescription",
  "humanInTheLoop",
  "guardrails",
  "dataRequirements",
  "sustainabilityImpact",
  "portfolioKind",
  "portfolioReviewStatus",
  "overallImpactScore",
  "overallFeasibilityScore",
  "overallEsgScore",
  "overallScore",
  "impactEconomic",
  "impactTime",
  "impactQuality",
  "impactCoordination",
  "impactSocial",
  "feasibilityData",
  "feasibilityWorkflow",
  "feasibilityRisk",
  "feasibilityTech",
  "feasibilityTeam",
  "esgEnvironmental",
  "esgSocial",
  "esgGovernance",
  "customScores",
];

/** A use_cases row with every column filled, proposer and intake included. */
function stuffedRow(overrides: Partial<UseCase> = {}): UseCase {
  return {
    id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00aa",
    workspaceId: WORKSPACE_ID,
    title: "Riconciliazione fatture fornitori",
    description: "Oggi si controllano a mano le fatture contro gli ordini.",
    businessCase: "Meno ore di controllo a fine mese.",
    portfolioKind: "use_case_ai",
    category: "quick_win",
    status: "proposed",
    source: "claude_connector",
    proposedBy: PROPOSER_NAME,
    impactFlag: true,
    portfolioReviewStatus: "scored",
    submittedAt: new Date("2026-10-01T08:00:00.000Z"),
    reviewedAt: new Date("2026-10-02T08:00:00.000Z"),
    reviewedBy: REVIEWER_USER_ID,
    reviewNotes: REVIEW_NOTES,
    flowDescription: "L'AI confronta fattura e ordine e segnala le differenze.",
    humanInTheLoop: "L'amministrazione approva ogni scostamento.",
    guardrails: "Nessun pagamento automatico.",
    dataRequirements: "Ordini e fatture degli ultimi 12 mesi.",
    sustainabilityImpact: "Meno carta stampata.",
    impactEconomic: 3,
    impactTime: 4,
    impactQuality: 3.5,
    impactCoordination: 2,
    impactSocial: 1,
    feasibilityData: 4,
    feasibilityWorkflow: 3,
    feasibilityRisk: 2,
    feasibilityTech: 4,
    feasibilityTeam: 3,
    esgEnvironmental: 2.5,
    esgSocial: 3,
    esgGovernance: 4,
    customScores: {
      impact: { efficiency: 4.2, profitability: 3 },
      feasibility: { effort: 2 },
      esg: { environmental: 3, social: 3.5 },
    },
    overallEsgScore: 3.2,
    overallImpactScore: 3.9,
    overallFeasibilityScore: 3.4,
    overallScore: 3.65,
    sequenceOrder: 7,
    timeline: "Q1 2027",
    requirements: ["Accesso ERP"],
    dataDependencies: ["ordini"],
    relatedActivityIds: ["5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00bb"],
    code: CODE,
    intake: {
      contractVersion: 2,
      area: "amministrazione",
      company: "alfa",
      tools: ["excel"],
      submitterEmail: INTAKE_EMAIL,
      submittedBy: { name: PROPOSER_NAME, email: PROPOSER_EMAIL },
      sourceConversation: SOURCE_CONVERSATION,
      promptSnippet: PROMPT_SNIPPET,
    },
    publicNote: PUBLIC_NOTE,
    statusChangedAt: new Date("2026-10-02T08:00:00.000Z"),
    submittedByUserId: SUBMITTER_IDENTITY_ID,
    createdAt: new Date("2026-10-01T08:00:00.000Z"),
    updatedAt: new Date("2026-10-03T09:30:00.000Z"),
    ...overrides,
  } as UseCase;
}

const config: ScoringModelConfig = {
  dimensions: {
    impact: [
      { id: "efficiency", label: "Efficienza", weight: 3, direction: "higher_better" },
      { id: "profitability", label: "Profittabilità", weight: 1, direction: "higher_better" },
    ],
    feasibility: [{ id: "effort", label: "Effort", weight: 1, direction: "lower_better" }],
    esg: [
      { id: "environmental", label: "Ambientale", weight: 1, direction: "higher_better" },
      { id: "social", label: "Sociale", weight: 1, direction: "higher_better" },
    ],
  },
  overall: { impact: 0.5, feasibility: 0.5, esg: 0.2 },
  thresholds: { highImpact: 3.5, highFeasibility: 3.5, midImpact: 2.5 },
} as ScoringModelConfig;

/** What the page hands to RankingMatrix and WavePlanner, serialized as the RSC payload would carry it. */
function pageProps(rows: UseCase[], canReview: boolean) {
  const items = toPortfolioClientItems(rows, { canReview });
  return JSON.stringify({
    matrix: { workspaceId: "ws", teamName: "AI Transformation", items, thresholds: config.thresholds, config, esgEnabled: true, canReview },
    waves: { workspaceId: "ws", items, config, esgEnabled: true },
  });
}

test("the client allowlist is exactly the fields the matrix and the wave planner read", () => {
  assert.deepEqual([...PORTFOLIO_CLIENT_ITEM_KEYS], EXPECTED_CLIENT_KEYS);
  assert.deepEqual([...PORTFOLIO_REVIEWER_EXTRA_KEYS], ["reviewNotes", "updatedAt"]);
  assert.deepEqual(Object.keys(toPortfolioClientItem(stuffedRow())).sort(), [...EXPECTED_CLIENT_KEYS].sort());
  assert.deepEqual(
    Object.keys(toPortfolioReviewerItem(stuffedRow())).sort(),
    [...EXPECTED_CLIENT_KEYS, "reviewNotes", "updatedAt"].sort()
  );
});

test("a non-reviewer gets no proposer identity, no intake and no review notes", () => {
  const [item] = toPortfolioClientItems([stuffedRow()], { canReview: false });
  for (const key of [...NEVER_KEYS, "reviewNotes", "updatedAt"]) {
    assert.equal(Object.hasOwn(item, key), false, `${key} must not be sent`);
  }
  const json = JSON.stringify(item);
  for (const value of [...IDENTITY_STRINGS, REVIEW_NOTES, "submitterEmail", "promptSnippet", "sourceConversation"]) {
    assert.equal(json.includes(value), false, `${value} leaked`);
  }
});

test("a reviewer gets the review notes and the row version, still without proposer identity", () => {
  const row = stuffedRow();
  const [item] = toPortfolioClientItems([row], { canReview: true });
  assert.equal(item.reviewNotes, REVIEW_NOTES);
  assert.ok(item.updatedAt instanceof Date);
  assert.equal(item.updatedAt.getTime(), row.updatedAt.getTime());
  for (const key of NEVER_KEYS) assert.equal(Object.hasOwn(item, key), false, `${key} must not be sent`);
  const json = JSON.stringify(item);
  for (const value of [...IDENTITY_STRINGS, "submitterEmail", "promptSnippet", "sourceConversation"]) {
    assert.equal(json.includes(value), false, `${value} leaked`);
  }
});

test("the serialized page props carry none of the seeded proposer strings, for either role", () => {
  const rows = [
    stuffedRow(),
    stuffedRow({ id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00ab", source: "web_proposed", proposedBy: PROPOSER_EMAIL, intake: null }),
    stuffedRow({ id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00ac", source: "learning", proposedBy: SUBMITTER_IDENTITY_ID, portfolioKind: "best_practice" }),
  ];
  const contributor = pageProps(rows, false);
  const reviewer = pageProps(rows, true);
  for (const value of IDENTITY_STRINGS) {
    assert.equal(contributor.includes(value), false, `contributor props leak ${value}`);
    assert.equal(reviewer.includes(value), false, `reviewer props leak ${value}`);
  }
  assert.equal(contributor.includes(REVIEW_NOTES), false);
  assert.equal(reviewer.includes(REVIEW_NOTES), true);
  // The contribution itself is still there.
  assert.ok(contributor.includes("Riconciliazione fatture fornitori"));
  assert.ok(contributor.includes("Nessun pagamento automatico."));
});

test("customScores is rebuilt: three dimensions, finite numbers only", () => {
  const dirty = {
    impact: { efficiency: 4, note: PROPOSER_NAME, nan: Number.NaN },
    feasibility: { effort: 2, who: { email: PROPOSER_EMAIL } },
    esg: [3],
    submittedBy: { name: PROPOSER_NAME },
  };
  assert.deepEqual(sanitizeCustomScores(dirty), { impact: { efficiency: 4 }, feasibility: { effort: 2 } });
  assert.equal(sanitizeCustomScores(null), null);
  assert.equal(sanitizeCustomScores("x"), null);
  const item = toPortfolioClientItem(stuffedRow({ customScores: dirty as unknown as UseCase["customScores"] }));
  assert.equal(JSON.stringify(item).includes("Giulia"), false);
  // A fresh object: the row's jsonb never rides along by reference.
  const row = stuffedRow();
  assert.notEqual(toPortfolioClientItem(row).customScores, row.customScores);
});

test("every KPI score the matrix and the waves compute reads the same from the reduced row", () => {
  const rows = [
    stuffedRow(),
    stuffedRow({ customScores: null }),
    stuffedRow({ customScores: { impact: { custom_a1: 2.5 } }, impactTime: null, feasibilityData: null }),
  ];
  const kpis = {
    impact: ["efficiency", "profitability", "economic", "time", "quality", "coordination", "social", "custom_a1"],
    feasibility: ["effort", "data", "workflow", "risk", "tech", "team"],
    esg: ["environmental", "social", "governance"],
  } as const;
  for (const row of rows) {
    for (const item of [toPortfolioClientItem(row), toPortfolioReviewerItem(row)]) {
      for (const [dimension, ids] of Object.entries(kpis) as [keyof typeof kpis, readonly string[]][]) {
        for (const id of ids) {
          assert.equal(readUseCaseRawKpiScore(item, dimension, id), readUseCaseRawKpiScore(row, dimension, id), `${dimension}.${id}`);
        }
      }
      for (const key of ["overallImpactScore", "overallFeasibilityScore", "overallEsgScore", "overallScore", "portfolioKind", "portfolioReviewStatus"] as const) {
        assert.equal(item[key], row[key], key);
      }
    }
  }
});

test("a whole use_cases row does not type-check as a client item", () => {
  const row = stuffedRow();
  // @ts-expect-error only toPortfolioClientItems builds a PortfolioItem: a raw row would leak the proposer
  const leaked: PortfolioItem[] = [row];
  const safe: PortfolioItem[] = toPortfolioClientItems([row], { canReview: false });
  assert.equal(leaked.length, safe.length);
});

test("rows that neither the matrix nor the wave planner shows are not sent", () => {
  const unscored = stuffedRow({
    id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00c1",
    title: "Proposta senza punteggi",
    portfolioReviewStatus: "needs_inputs",
    overallImpactScore: null,
    overallFeasibilityScore: null,
    overallEsgScore: null,
    overallScore: null,
  });
  const zero = stuffedRow({
    id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00c2",
    title: "Proposta a zero",
    overallImpactScore: 0,
    overallFeasibilityScore: 0,
    overallScore: 0,
  });
  const nonFinite = stuffedRow({
    id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00c3",
    title: "Proposta con punteggi non finiti",
    overallImpactScore: Number.NaN,
    overallFeasibilityScore: Number.POSITIVE_INFINITY,
    overallScore: Number.NaN,
  });
  // Placed on the matrix although archived (the matrix keeps archived points; the waves skip them).
  const archivedPlaced = stuffedRow({ id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00c4", portfolioReviewStatus: "archived" });
  // Only the wave planner takes it: overall score without the two axes.
  const waveOnly = stuffedRow({
    id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00c5",
    overallImpactScore: null,
    overallFeasibilityScore: null,
    overallScore: 2.4,
  });
  const placed = stuffedRow({ id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00c6" });
  const rows = [unscored, zero, nonFinite, archivedPlaced, waveOnly, placed];
  for (const canReview of [false, true]) {
    const items = toPortfolioClientItems(rows, { canReview });
    assert.deepEqual(items.map((item) => item.id), [archivedPlaced.id, waveOnly.id, placed.id], `canReview=${canReview}`);
    const json = JSON.stringify(items);
    for (const title of ["Proposta senza punteggi", "Proposta a zero", "Proposta con punteggi non finiti"]) {
      assert.equal(json.includes(title), false, `${title} sent with canReview=${canReview}`);
    }
  }
  assert.equal(isPlacedOnMatrix({ overallImpactScore: 0, overallFeasibilityScore: 1.2 }), true);
  assert.equal(isPlacedOnMatrix({ overallImpactScore: 3, overallFeasibilityScore: null }), false);
  assert.equal(isWavePlanCandidate({ portfolioKind: null, portfolioReviewStatus: "scored", overallScore: 3 }), false);
  assert.equal(isWavePlanCandidate({ portfolioKind: "best_practice", portfolioReviewStatus: "in_review", overallScore: 0.1 }), true);
});

test("proposals hidden from colleagues reach only the reviewers", () => {
  const hiddenIntake = (flag: unknown) => ({ ...(stuffedRow().intake ?? {}), hiddenFromSearch: flag });
  const hiddenBool = stuffedRow({ id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00d1", title: "Nascosta booleana", intake: hiddenIntake(true) });
  const hiddenText = stuffedRow({ id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00d2", title: "Nascosta testo", intake: hiddenIntake("true") });
  // Like `coalesce(intake ->> 'hiddenFromSearch', '') <> 'true'`: anything but the text 'true' stays visible.
  const notHidden = [false, "false", "TRUE", 1, null].map((flag, i) =>
    stuffedRow({ id: `5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00e${i}`, intake: hiddenIntake(flag) })
  );
  const noIntake = stuffedRow({ id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00f1", intake: null });
  const rows = [hiddenBool, hiddenText, ...notHidden, noIntake];

  const contributor = toPortfolioClientItems(rows, { canReview: false });
  assert.deepEqual(contributor.map((item) => item.id), [...notHidden, noIntake].map((row) => row.id));
  const contributorJson = JSON.stringify(contributor);
  assert.equal(contributorJson.includes("Nascosta booleana"), false);
  assert.equal(contributorJson.includes("Nascosta testo"), false);

  const reviewer = toPortfolioClientItems(rows, { canReview: true });
  assert.deepEqual(reviewer.map((item) => item.id), rows.map((row) => row.id));
  // The flag decides on the server: it never rides along, nor does the rest of the intake.
  for (const json of [contributorJson, JSON.stringify(reviewer)]) {
    for (const value of ["hiddenFromSearch", "submitterEmail", INTAKE_EMAIL, PROMPT_SNIPPET]) {
      assert.equal(json.includes(value), false, `${value} leaked`);
    }
  }
  assert.equal(isHiddenFromColleagues({ intake: { hiddenFromSearch: true } }), true);
  assert.equal(isHiddenFromColleagues({ intake: null }), false);
});

test("an invalid updatedAt becomes null instead of an Invalid Date", () => {
  const valid = toPortfolioReviewerItem(stuffedRow());
  assert.ok(valid.updatedAt instanceof Date);
  assert.equal(valid.updatedAt.toISOString(), "2026-10-03T09:30:00.000Z");
  const fromText = toPortfolioReviewerItem(stuffedRow({ updatedAt: "2026-10-03T09:30:00.000Z" as unknown as Date }));
  assert.equal(fromText.updatedAt?.toISOString(), "2026-10-03T09:30:00.000Z");
  // The browser would get null anyway (an Invalid Date's toJSON is null): the type now says so.
  for (const bad of [undefined, null, "non è una data", Number.NaN, new Date(Number.NaN)]) {
    const item = toPortfolioReviewerItem(stuffedRow({ updatedAt: bad as unknown as Date }));
    assert.equal(item.updatedAt, null, String(bad));
  }
});
