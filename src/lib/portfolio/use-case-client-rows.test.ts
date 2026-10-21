import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { getTableColumns } from "drizzle-orm";
import { useCases, type UseCase } from "../db/schema.ts";
import {
  GANTT_USE_CASE_KEYS,
  USE_CASE_API_EXCLUDED_KEYS,
  USE_CASE_API_KEYS,
  USE_CASE_LIFECYCLE_KEYS,
  USE_CASE_MATRIX_POINT_KEYS,
  toGanttUseCase,
  toGanttUseCases,
  toUseCaseApiRow,
  toUseCaseApiRows,
  toUseCaseLifecycleState,
  toUseCaseMatrixPoint,
  toUseCaseMatrixPoints,
  type GanttUseCase,
  type UseCaseApiRow,
  type UseCaseLifecycleState,
  type UseCaseMatrixPoint,
} from "./use-case-client-rows.ts";

// Synthetic proposer and reviewer data: none of it may leave the server through /use-cases,
// /plan, the use-case REST API or the status/quadrant actions.
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

/** Never in any projection, whoever is looking. */
const PLANTED = [
  PROPOSER_NAME,
  PROPOSER_EMAIL,
  INTAKE_EMAIL,
  SOURCE_CONVERSATION,
  PROMPT_SNIPPET,
  SUBMITTER_IDENTITY_ID,
  REVIEWER_USER_ID,
  "Giulia",
  "submitterEmail",
  "submittedBy",
  "sourceConversation",
  "promptSnippet",
  "hiddenFromSearch",
  "proposedBy",
  "reviewedBy",
  "intake",
];

/** A use_cases row with every column filled, proposer, reviewer and intake included. */
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
    customScores: { impact: { efficiency: 4.2 }, feasibility: { effort: 2 }, esg: { social: 3.5 } },
    overallEsgScore: 3.2,
    overallImpactScore: 3.9,
    overallFeasibilityScore: 3.4,
    overallScore: 3.65,
    sequenceOrder: 7,
    timeline: "Q1 2027",
    requirements: ["Accesso ERP"],
    dataDependencies: ["ordini"],
    relatedActivityIds: ["5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00bb"],
    code: "TJ-0042",
    intake: {
      contractVersion: 2,
      area: "amministrazione",
      tools: ["excel"],
      submitterEmail: INTAKE_EMAIL,
      submittedBy: { name: PROPOSER_NAME, email: PROPOSER_EMAIL },
      sourceConversation: SOURCE_CONVERSATION,
      promptSnippet: PROMPT_SNIPPET,
      hiddenFromSearch: true,
    },
    publicNote: PUBLIC_NOTE,
    statusChangedAt: new Date("2026-10-02T08:00:00.000Z"),
    submittedByUserId: SUBMITTER_IDENTITY_ID,
    createdAt: new Date("2026-10-01T08:00:00.000Z"),
    updatedAt: new Date("2026-10-03T09:30:00.000Z"),
    ...overrides,
  } as UseCase;
}

/** The serialized form the browser gets (RSC payload or JSON response). */
function assertNoPlanted(value: unknown, label: string) {
  const json = JSON.stringify(value);
  for (const planted of PLANTED) assert.equal(json.includes(planted), false, `${label} leaks ${planted}`);
}

const ALL_COLUMNS = Object.keys(getTableColumns(useCases)).sort();

test("the stuffed row fills every use_cases column", () => {
  assert.deepEqual(Object.keys(stuffedRow()).sort(), ALL_COLUMNS);
});

test("UseCaseMatrix gets exactly id, title, quadrant and the two axes", () => {
  assert.deepEqual([...USE_CASE_MATRIX_POINT_KEYS], ["id", "title", "category", "overallImpactScore", "overallFeasibilityScore"]);
  const row = stuffedRow();
  const point = toUseCaseMatrixPoint(row);
  assert.deepEqual(Object.keys(point).sort(), [...USE_CASE_MATRIX_POINT_KEYS].sort());
  assert.deepEqual(point, {
    id: row.id,
    title: row.title,
    category: "quick_win",
    overallImpactScore: 3.9,
    overallFeasibilityScore: 3.4,
  });
  assertNoPlanted(toUseCaseMatrixPoints([row, stuffedRow({ source: "web_proposed", proposedBy: PROPOSER_EMAIL })]), "matrix");
  // Missing or non-finite scores become null, which the matrix draws at 0 as before.
  const blank = toUseCaseMatrixPoint(stuffedRow({ category: null, overallImpactScore: null, overallFeasibilityScore: Number.NaN }));
  assert.equal(blank.category, null);
  assert.equal(blank.overallImpactScore, null);
  assert.equal(blank.overallFeasibilityScore, null);
});

test("GanttChart gets exactly id, title, quadrant, overall score and order", () => {
  assert.deepEqual([...GANTT_USE_CASE_KEYS], ["id", "title", "category", "overallScore", "sequenceOrder"]);
  const row = stuffedRow();
  const item = toGanttUseCase(row);
  assert.deepEqual(Object.keys(item).sort(), [...GANTT_USE_CASE_KEYS].sort());
  assert.deepEqual(item, { id: row.id, title: row.title, category: "quick_win", overallScore: 3.65, sequenceOrder: 7 });
  assertNoPlanted(toGanttUseCases([row, stuffedRow({ source: "learning", proposedBy: SUBMITTER_IDENTITY_ID })]), "gantt");
});

test("the status and quadrant actions answer with id, status and quadrant only", () => {
  assert.deepEqual([...USE_CASE_LIFECYCLE_KEYS], ["id", "status", "category"]);
  const state = toUseCaseLifecycleState(stuffedRow({ status: "accepted", category: "strategic_bet" }));
  assert.deepEqual(state, { id: "5b0c2a52-6a7e-4a43-9a51-0d1d6a1f00aa", status: "accepted", category: "strategic_bet" });
  assertNoPlanted({ useCase: state }, "action response");
  assert.equal(JSON.stringify(state).includes(REVIEW_NOTES), false);
});

test("the REST row is every column but proposer, reviewer and intake", () => {
  assert.deepEqual([...USE_CASE_API_EXCLUDED_KEYS], ["proposedBy", "submittedByUserId", "reviewedBy", "intake"]);
  // Every column is classified: either sent or excluded, never both.
  assert.deepEqual([...USE_CASE_API_KEYS, ...USE_CASE_API_EXCLUDED_KEYS].sort(), ALL_COLUMNS);
  assert.equal(new Set(USE_CASE_API_KEYS).size, USE_CASE_API_KEYS.length);
  const row = stuffedRow();
  const api = toUseCaseApiRow(row);
  assert.deepEqual(Object.keys(api).sort(), [...USE_CASE_API_KEYS].sort());
  for (const key of USE_CASE_API_EXCLUDED_KEYS) assert.equal(Object.hasOwn(api, key), false, `${key} must not be sent`);
  // What the caller had before, minus the excluded columns, survives a JSON round trip unchanged.
  const before = JSON.parse(JSON.stringify(row)) as Record<string, unknown>;
  for (const key of USE_CASE_API_EXCLUDED_KEYS) delete before[key];
  assert.deepEqual(JSON.parse(JSON.stringify(api)), before);
  assertNoPlanted({ useCases: toUseCaseApiRows([row]) }, "GET list");
  assertNoPlanted({ useCase: api }, "GET detail / PATCH");
  // Reviewer-only content of the row stays (the routes answer only to reviewers).
  const json = JSON.stringify(api);
  assert.ok(json.includes(REVIEW_NOTES) && json.includes(PUBLIC_NOTE) && json.includes("TJ-0042"));
});

test("jsonb columns of the REST row are rebuilt, not passed by reference", () => {
  const dirty = stuffedRow({
    customScores: { impact: { efficiency: 4, who: PROPOSER_NAME }, submittedBy: { name: PROPOSER_NAME } } as unknown as UseCase["customScores"],
    requirements: ["Accesso ERP", { email: PROPOSER_EMAIL }] as unknown as string[],
    dataDependencies: "ordini" as unknown as string[],
  });
  const api = toUseCaseApiRow(dirty);
  assert.deepEqual(api.customScores, { impact: { efficiency: 4 } });
  assert.deepEqual(api.requirements, ["Accesso ERP"]);
  assert.equal(api.dataDependencies, null);
  assertNoPlanted(api, "dirty jsonb");
  const row = stuffedRow();
  assert.notEqual(toUseCaseApiRow(row).requirements, row.requirements);
  assert.notEqual(toUseCaseApiRow(row).customScores, row.customScores);
});

test("a whole use_cases row does not type-check as any projection", () => {
  const row = stuffedRow();
  // @ts-expect-error UseCaseMatrix takes toUseCaseMatrixPoints: a raw row would send the proposer
  const matrix: UseCaseMatrixPoint[] = [row];
  // @ts-expect-error GanttChart takes toGanttUseCases
  const gantt: GanttUseCase[] = [row];
  // @ts-expect-error the actions answer with toUseCaseLifecycleState
  const state: UseCaseLifecycleState = row;
  // @ts-expect-error the REST routes answer with toUseCaseApiRow
  const api: UseCaseApiRow = row;
  assert.ok(matrix && gantt && state && api);
});

const source = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
/** Source without whitespace and trailing commas, so a reformat does not change what the checks below read. */
const compact = (path: string) => source(path).replace(/\s+/g, "").replace(/,(?=[)}\]])/g, "");
const API = "src/app/api/workspaces/[workspaceId]/use-cases";
const DASHBOARD = "src/app/(dashboard)/dashboard/[workspaceId]";

test("the REST routes answer with the projection and the GETs only to reviewers", () => {
  for (const file of [`${API}/route.ts`, `${API}/[useCaseId]/route.ts`]) {
    assert.match(compact(file), /if\(!canReviewWorkspacePortfolio\(access\.role\)\)\{?returnResponse\.json\(\{error:["']Forbidden["']\},\{status:403\}\)/, file);
  }
  assert.match(compact(`${API}/route.ts`), /Response\.json\(\{useCases:toUseCaseApiRows\(items\)\}\)/);
  for (const file of [`${API}/route.ts`, `${API}/[useCaseId]/route.ts`, `${API}/[useCaseId]/status/route.ts`, `${API}/[useCaseId]/scores/route.ts`, `${API}/[useCaseId]/wave/route.ts`]) {
    const text = compact(file);
    // `{ useCase }` or `{ useCases }` as a shorthand would send the variable as it is.
    assert.doesNotMatch(text, /Response\.json\(\{useCases?[,}]/, file);
    if (file === `${API}/route.ts`) continue;
    const answers = [...text.matchAll(/Response\.json\(\{useCase:([^}]*)\}/g)].map((m) => m[1]);
    assert.ok(answers.length > 0 && answers.every((a) => a.startsWith("toUseCaseApiRow(")), `${file}: ${answers.join(" | ")}`);
  }
});

test("the pages and the actions hand the client components the projections only", () => {
  assert.match(compact(`${DASHBOARD}/use-cases/page.tsx`), /<UseCaseMatrixuseCases=\{toUseCaseMatrixPoints\(useCases\)\}\/>/);
  assert.match(compact(`${DASHBOARD}/plan/page.tsx`), /<GanttChartuseCases=\{toGanttUseCases\(useCases\)\}\/>/);
  const actions = compact("src/lib/actions/use-cases.ts");
  assert.equal([...actions.matchAll(/return\{useCase:toUseCaseLifecycleState\(result\.useCase\)\}/g)].length, 2);
  assert.doesNotMatch(actions, /return\{useCase:result\.useCase\}/);
});

test("the use case detail page shows the status and quadrant actions to reviewers only", () => {
  // The actions refuse every other role; a contributor no longer sees buttons that would fail.
  const page = compact(`${DASHBOARD}/use-cases/[useCaseId]/page.tsx`);
  assert.equal([...page.matchAll(/<UseCasePortfolioActions/g)].length, 1);
  assert.match(page, /\{canReviewWorkspacePortfolio\(access\.role\)&&\(?<UseCasePortfolioActions/);
});
