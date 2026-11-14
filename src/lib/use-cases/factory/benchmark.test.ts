// Il banco di prova e le evals (rilascio 8.2a): il più bravo, il più economico, il più efficiente, la frontiera, la
// raccomandazione; l'avviso delle evals. Docs: docs/rilascio-8/BANCO-DI-PROVA.md §3.
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBench, evalsAlert, formatCost, formatQuality, modelLabel, type BenchResult } from "./benchmark.ts";

const r = (model: string, quality: number, cost: number | null, over: Partial<BenchResult> = {}): BenchResult => ({
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
const HAIKU = "anthropic/claude-haiku-5-5";
const SONNET = "anthropic/claude-sonnet-5-5";
const OPUS = "anthropic/claude-opus-5-5";

test("i nomi e i numeri come li legge una persona", () => {
  assert.equal(modelLabel(HAIKU), "Claude Haiku 5.5");
  assert.equal(modelLabel("openai/gpt-x"), "gpt-x");
  assert.equal(modelLabel("claude-opus-5-5"), "Claude Opus 5.5");
  assert.equal(formatQuality(0.9643), "96,4%");
  assert.match(formatCost(0.42), /^0,42\s?USD$/);
  assert.match(formatCost(0.0035), /^0,0035\s?USD$/);
});

test("il più bravo, il più economico, il più efficiente e la frontiera", () => {
  const a = analyzeBench([r(SONNET, 0.96, 1.8, { current: true }), r(HAIKU, 0.95, 0.12), r(OPUS, 0.97, 3.6)], { role: "lettura", fakeModels: false });
  assert.equal(a.best, OPUS);
  assert.equal(a.cheapest, HAIKU);
  assert.equal(a.efficient, HAIKU, "il più economico a non più di 2 punti dal più bravo");
  assert.deepEqual(a.frontier, [HAIKU, SONNET, OPUS]);
  assert.equal(a.verdict.kind, "cambia");
  assert.ok(a.verdict.kind === "cambia" && a.verdict.from === SONNET && a.verdict.model === HAIKU);
  assert.ok(a.verdict.kind === "cambia" && Math.abs((a.verdict.saving ?? 0) - (1 - 0.12 / 1.8)) < 1e-9);
  assert.match(a.verdict.text, /^Conviene Claude Haiku 5\.5 per «lettura»: 95%, 0,12\s?USD per 1\.000 esecuzioni, contro 96%, 1,80\s?USD per 1\.000 esecuzioni di Claude Sonnet 5\.5 \(-93,3% di costo\)\.$/);
});

test("resta: l'attuale è già il più efficiente, o il risparmio è sotto il 10%", () => {
  const same = analyzeBench([r(HAIKU, 0.95, 0.12, { current: true }), r(SONNET, 0.96, 1.8)], { role: "lettura", fakeModels: false });
  assert.equal(same.verdict.kind, "resta");
  assert.match(same.verdict.text, /^Resta Claude Haiku 5\.5 per «lettura»: è già il più conveniente/);
  const small = analyzeBench([r(SONNET, 0.96, 1.0, { current: true }), r(OPUS, 0.96, 0.95)], { role: "scrittura", fakeModels: false });
  assert.equal(small.verdict.kind, "resta", "5% in meno non basta");
  const worse = analyzeBench([r(SONNET, 0.96, 1.8, { current: true }), r(HAIKU, 0.9, 0.12)], { role: "lettura", fakeModels: false });
  assert.equal(worse.verdict.kind, "resta", "6 punti sotto non è alla pari");
  assert.equal(worse.efficient, SONNET);
});

test("l'attuale sotto soglia: conviene il più efficiente che le rispetta", () => {
  const a = analyzeBench([r(HAIKU, 0.8, 0.12, { current: true, thresholdsMet: false }), r(SONNET, 0.96, 1.8)], { role: "lettura", fakeModels: false });
  assert.ok(a.verdict.kind === "cambia" && a.verdict.model === SONNET && a.verdict.from === HAIKU);
  assert.match(a.verdict.text, /^Claude Haiku 5\.5 non rispetta le soglie per «lettura» \(80%\): conviene Claude Sonnet 5\.5/);
});

test("nessuno rispetta le soglie; costi non noti; modelli finti", () => {
  assert.equal(analyzeBench([r(HAIKU, 0.5, 0.1, { current: true, thresholdsMet: false })], { role: "lettura", fakeModels: false }).verdict.kind, "nessuno");
  const unknown = analyzeBench([r(HAIKU, 0.95, null, { current: true }), r("altro/modello", 0.97, null)], { role: "lettura", fakeModels: false });
  assert.ok(unknown.verdict.kind === "senza_costi" && unknown.verdict.model === "altro/modello");
  assert.equal(unknown.cheapest, null);
  const currentUnknown = analyzeBench([r(HAIKU, 0.95, null, { current: true }), r(SONNET, 0.96, 1.8)], { role: "lettura", fakeModels: false });
  assert.ok(currentUnknown.verdict.kind === "senza_costi" && currentUnknown.verdict.model === SONNET);
  assert.match(currentUnknown.verdict.text, /^Il costo di Claude Haiku 5\.5 non è noto/);
  const fake = analyzeBench([r(HAIKU, 1, 0, { current: true })], { role: "lettura", fakeModels: true });
  assert.equal(fake.verdict.kind, "finti");
  assert.deepEqual([fake.best, fake.cheapest, fake.efficient, fake.frontier], [null, null, null, []]);
});

test("l'avviso delle evals: sotto soglia (non in costruzione), o giù di 5 punti con gli stessi modelli e lo stesso ramo", () => {
  const p = (quality: number, over: Partial<{ thresholdsMet: boolean; fakeModels: boolean; inConstruction: boolean; branch: string | null }> = {}) => ({ quality, thresholdsMet: true, fakeModels: false, inConstruction: false, branch: "main", ...over });
  assert.deepEqual(evalsAlert(null, p(0.8, { thresholdsMet: false })), { kind: "sotto_soglia", drop: null });
  assert.equal(evalsAlert(null, p(0.8, { thresholdsMet: false, inConstruction: true })), null, "in costruzione non avvisa");
  assert.deepEqual(evalsAlert(p(0.97), p(0.91)), { kind: "in_calo", drop: 0.97 - 0.91 });
  assert.equal(evalsAlert(p(0.97), p(0.93)), null, "4 punti: niente");
  assert.equal(evalsAlert(p(0.97, { fakeModels: true }), p(0.9)), null, "finti con veri non si confrontano");
  assert.equal(evalsAlert(p(0.97, { branch: "tj-0049/t-3" }), p(0.9)), null, "rami diversi non si confrontano");
});
