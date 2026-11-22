// (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5) La «Qualità» della Costruzione in una riga: qualità e soglie con il
// puntino e la parola; per chi costruisce la data, «dalla CI» (8.2b) e, per ruolo, la sola raccomandazione del banco;
// ai ruoli del cliente la sola riga, senza comandi, rami, commit o p95. Dati sintetici.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { analyzeBench, type BenchResult, type EvalOverview, type EvalRunView } from "../../lib/use-cases/factory/benchmark.ts";
import { findForbidden } from "../../lib/uc/views/copy-guard.ts";
import type { EvalRunOrigin } from "../../lib/db/queries/use-case-eval-origins.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { QUALITY_ANCHORS, QUALITY_TEXT, qualityLine, qualitySummary, type QualitySummary } from "./eval-format.ts";

let render: (summary: QualitySummary | null, extra?: { origins?: ReadonlyMap<string, EvalRunOrigin> | null; ciLinks?: boolean; unavailable?: boolean }) => string;
before(async () => {
  await enableTsxImports();
  const { EvalSummary } = await import("./eval-summary.tsx");
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  render = (summary, extra = {}) => renderToStaticMarkup(react.createElement(EvalSummary, { summary, ...extra })).replace(/&#x27;/g, "'");
});

const HAIKU = "anthropic/claude-haiku-5-5";
const SONNET = "anthropic/claude-sonnet-5-5";
const RUN_ID = "00000000-0000-4000-8000-000000000001";

const result = (model: string, quality: number, cost: number | null, over: Partial<BenchResult> = {}): BenchResult => ({
  model,
  current: false,
  quality,
  passed: Math.round(quality * 28),
  total: 28,
  thresholdsMet: true,
  groups: {},
  costPer1000Usd: cost,
  latencyP50Ms: 1000,
  latencyP95Ms: 2000,
  tokensInAvg: 1000,
  tokensOutAvg: 100,
  errors: 0,
  ...over,
});

const run = (over: Partial<EvalRunView> = {}): EvalRunView => ({
  id: RUN_ID,
  kind: "evals",
  role: null,
  level: "pull_request",
  branch: "main",
  commit: "a1b2c3d4e5f6",
  templateVersion: "1.6.0",
  models: { lettura: SONNET },
  fakeModels: false,
  inConstruction: false,
  casesTotal: 28,
  createdAt: "2026-11-14T10:00:00.000Z",
  results: [result(SONNET, 0.9643, 1.8, { current: true, passed: 27, total: 28 })],
  ...over,
});

const LETTURA = [result(SONNET, 0.96, 1.8, { current: true }), result(HAIKU, 0.95, 0.12)];
const bench = (role: string, results: BenchResult[], over: Partial<EvalRunView> = {}) => {
  const view = run({ id: "00000000-0000-4000-8000-000000000002", kind: "banco", role, results, createdAt: "2026-11-13T10:00:00.000Z", ...over });
  return { role, run: view, analysis: analyzeBench(results, { role, fakeModels: view.fakeModels }) };
};
const FULL: EvalOverview = { evals: { latest: run(), trend: [] }, benches: [bench("lettura", LETTURA)] };

const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

test("one row: quality and thresholds, as a dot and a word", () => {
  assert.equal(qualityLine(0.9643, true), "Qualità 96,4% · soglie rispettate");
  assert.equal(qualityLine(0.8, false), "Qualità 80% · sotto soglia");
  assert.deepEqual(QUALITY_ANCHORS, { section: "qualita", details: "banco" }, "`progetto#banco` keeps landing on the bench");
  assert.equal(qualitySummary(null, { builder: true }), null, "nothing measured: no row");
  assert.equal(qualitySummary({ evals: { latest: null, trend: [] }, benches: [] }, { builder: false }), null);
});

test("who builds: the date and «dalla CI» with the link, and for each role only the recommendation", () => {
  const s = qualitySummary(FULL, { builder: true })!;
  assert.equal(s.line, "Qualità 96,4% · soglie rispettate");
  assert.equal(s.meta, "14/11/2026", "main is not said; another branch is");
  assert.equal(qualitySummary({ ...FULL, evals: { latest: run({ branch: "tj-0049/t-3" }), trend: [] } }, { builder: true })!.meta, "14/11/2026 · ramo tj-0049/t-3");
  assert.equal(s.advice.length, 1);
  assert.equal(s.advice[0].role, "lettura");
  assert.equal(s.advice[0].text, FULL.benches[0].analysis.verdict.text);
  const html = render(s, { origins: new Map([[RUN_ID, { source: "ci", ciRunUrl: "https://github.com/acme/agente/actions/runs/42" }]]), ciLinks: true });
  const text = textOf(html);
  assert.ok(text.includes("Qualità 96,4% · soglie rispettate"));
  assert.match(html, /data-slot="eval-source" data-source="ci"/);
  assert.match(html, /href="https:\/\/github\.com\/acme\/agente\/actions\/runs\/42"/);
  assert.match(html, /data-slot="eval-advice"/);
  assert.equal([...html.matchAll(/<(a|button)\b/g)].length, 1, "one control at most: «dalla CI»");
  assert.doesNotMatch(text, /npm run|p95|commit|<table/i, "commands, tables and p95 stay in the details");
});

test("a bench superseded by main's evals does not advise any more: it stays in the details", () => {
  const newer = run({ models: { lettura: HAIKU }, results: [result(HAIKU, 0.95, 0.12, { current: true })] });
  const s = qualitySummary({ evals: { latest: newer, trend: [] }, benches: [bench("lettura", LETTURA)] }, { builder: true })!;
  assert.deepEqual(s.advice, []);
});

test("the client's roles: one sentence, no date, branch, source, model or command", () => {
  const s = qualitySummary(FULL, { builder: false })!;
  assert.deepEqual(s, { line: "Qualità 96,4% · soglie rispettate", tone: "verde", runId: null, meta: null, alert: null, advice: [] });
  const html = render(s, { origins: new Map([[RUN_ID, { source: "ci", ciRunUrl: "https://github.com/acme/agente/actions/runs/42" }]]) });
  assert.equal(textOf(html), "Qualità 96,4% · soglie rispettate");
  assert.deepEqual(findForbidden(textOf(html), "cliente"), []);
  assert.equal(qualitySummary({ evals: { latest: null, trend: [] }, benches: [bench("lettura", LETTURA)] }, { builder: false }), null, "only benches: nothing for the client");
});

test("below the thresholds the dot is red and the row says it; the read that failed says so to who builds", () => {
  const low = qualitySummary({ evals: { latest: run({ results: [result(SONNET, 0.8, 1.8, { current: true, thresholdsMet: false })] }), trend: [] }, benches: [] }, { builder: true })!;
  assert.equal(low.tone, "rosso");
  assert.ok(low.alert?.startsWith("Sotto soglia"));
  assert.match(render(low), /bg-uc-rosso/);
  assert.match(render(null, { unavailable: true }), /role="status"/);
  assert.equal(render(null), "");
  assert.equal(QUALITY_TEXT.details, "Dettagli per chi costruisce");
});

test("evals with the fake models: who builds reads «modelli finti» in the row, the client's roles get no row", () => {
  const fake: EvalOverview = { evals: { latest: run({ fakeModels: true }), trend: [] }, benches: [] };
  const s = qualitySummary(fake, { builder: true })!;
  assert.equal(s.line, "Qualità 96,4% · soglie rispettate · modelli finti");
  assert.equal(s.tone, "verde", "the thresholds still say how the code does");
  assert.ok(textOf(render(s)).includes("· modelli finti"));
  assert.equal(qualitySummary(fake, { builder: false }), null, "they measure the code, not the agent: nothing for the client");
  assert.equal(qualitySummary({ ...fake, benches: [bench("lettura", LETTURA)] }, { builder: false }), null);
  assert.equal(qualitySummary(FULL, { builder: true })!.line, "Qualità 96,4% · soglie rispettate", "real models: no mark");
});

test("in construction (version 0.x) the dot is neutral: below the thresholds is no alarm yet", () => {
  const below = (over: Partial<EvalRunView>) => ({ evals: { latest: run({ results: [result(SONNET, 0.8, 1.8, { current: true, thresholdsMet: false })], ...over }), trend: [] }, benches: [] });
  const building = qualitySummary(below({ inConstruction: true }), { builder: true })!;
  assert.equal(building.tone, "grigio");
  assert.equal(building.line, "Qualità 80% · sotto soglia");
  assert.equal(building.alert, null, "no «Sotto soglia» alert in construction (8.2a)");
  assert.match(render(building), /bg-uc-grigio/);
  assert.doesNotMatch(render(building), /bg-uc-rosso/);
  assert.equal(qualitySummary(below({ inConstruction: true }), { builder: false })!.tone, "grigio", "the client's row too");
  assert.equal(qualitySummary({ evals: { latest: run({ inConstruction: true }), trend: [] }, benches: [] }, { builder: true })!.tone, "grigio");
  assert.equal(qualitySummary(below({}), { builder: true })!.tone, "rosso", "out of construction it is red");
});
