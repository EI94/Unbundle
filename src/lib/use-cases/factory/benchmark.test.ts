// Il banco di prova e le evals (rilascio 8.2a): il più bravo, il più economico, il più efficiente, la frontiera, la
// raccomandazione; l'avviso delle evals. Docs: docs/rilascio-8/BANCO-DI-PROVA.md §3. (Casi senza AI,
// docs/rilascio-8/CASI-SENZA-AI.md §3, §5) La regola del segno e il banco superato dalle evals senza AI di main.
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBench, benchSuperseded, evalRunWithoutAi, evalsAlert, formatCost, formatQuality, modelLabel, NO_AI_MODEL, type BenchResult } from "./benchmark.ts";

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

test("un modello più bravo e più caro nel banco non toglie il consiglio di risparmiare a parità di qualità", () => {
  // Il caso visto con la CLI vera: oggi Sonnet, Haiku con la stessa qualità costa il 93% in meno, Opus è più bravo e
  // costa il doppio. Il più efficiente (vicino al più bravo) è Opus, ma il confronto per cambiare è con oggi.
  const S = r(SONNET, 18 / 19, 1.8, { current: true });
  const H = r(HAIKU, 18 / 19, 0.12);
  const O = r(OPUS, 1, 3.6);
  const withOpus = analyzeBench([S, H, O], { role: "scrittura", fakeModels: false });
  assert.deepEqual([withOpus.best, withOpus.efficient, withOpus.cheapest], [OPUS, OPUS, HAIKU]);
  assert.ok(withOpus.verdict.kind === "cambia" && withOpus.verdict.model === HAIKU && withOpus.verdict.from === SONNET);
  assert.match(withOpus.verdict.text, /^Conviene Claude Haiku 5\.5 per «scrittura»: 94,7%, 0,12\s?USD per 1\.000 esecuzioni, contro 94,7%, 1,80\s?USD per 1\.000 esecuzioni di Claude Sonnet 5\.5 \(-93,3% di costo\)\.$/);
  // Lo stesso consiglio con o senza Opus nel banco.
  const without = analyzeBench([S, H], { role: "scrittura", fakeModels: false });
  assert.ok(without.verdict.kind === "cambia" && without.verdict.model === HAIKU);
  // Mai sotto la qualità di oggi oltre la tolleranza, anche se costa molto meno.
  const lower = analyzeBench([S, r(HAIKU, 17 / 19, 0.12), O], { role: "scrittura", fakeModels: false });
  assert.equal(lower.verdict.kind, "resta");
  assert.match(lower.verdict.text, /^Resta Claude Sonnet 5\.5 per «scrittura»: nessun altro modello costa almeno il 10% in meno con la stessa qualità, né è più bravo allo stesso costo \(94,7%, 1,80\s?USD per 1\.000 esecuzioni\)\.$/);
});

test("più bravo di oggi oltre la tolleranza e non costa di più: conviene, anche con un risparmio sotto il 10%", () => {
  const a = analyzeBench([r(SONNET, 0.9, 1.8, { current: true }), r(OPUS, 0.97, 1.7), r(HAIKU, 0.8, 0.12)], { role: "lettura", fakeModels: false });
  assert.ok(a.verdict.kind === "cambia" && a.verdict.model === OPUS && a.verdict.from === SONNET);
  assert.ok(a.verdict.kind === "cambia" && Math.abs((a.verdict.saving ?? 0) - (1 - 1.7 / 1.8)) < 1e-9);
  assert.match(a.verdict.text, /^Conviene Claude Opus 5\.5 per «lettura»: più bravo e non costa di più, 97%, 1,70\s?USD per 1\.000 esecuzioni contro 90%, 1,80\s?USD per 1\.000 esecuzioni di Claude Sonnet 5\.5\.$/);
  // Più bravo ma più caro: resta (pagare di più è una scelta del team, non un consiglio automatico).
  const pricier = analyzeBench([r(SONNET, 0.9, 1.8, { current: true }), r(OPUS, 0.97, 3.6)], { role: "lettura", fakeModels: false });
  assert.equal(pricier.verdict.kind, "resta");
  // Alla pari entro la tolleranza e allo stesso costo: niente da guadagnare, resta.
  const tie = analyzeBench([r(SONNET, 0.9, 1.8, { current: true }), r(OPUS, 0.91, 1.8)], { role: "lettura", fakeModels: false });
  assert.equal(tie.verdict.kind, "resta");
});

test("un modello di oggi che non costa niente: nessun risparmio possibile, mai una divisione per zero", () => {
  const free = analyzeBench([r("locale/modello", 0.95, 0, { current: true }), r(HAIKU, 0.95, 0.12)], { role: "lettura", fakeModels: false });
  assert.equal(free.verdict.kind, "resta");
  assert.ok(!/NaN|Infinity/.test(free.verdict.text));
  const freeBetter = analyzeBench([r("locale/modello", 0.9, 0, { current: true }), r("locale/altro", 0.97, 0)], { role: "lettura", fakeModels: false });
  assert.ok(freeBetter.verdict.kind === "cambia" && freeBetter.verdict.model === "locale/altro" && freeBetter.verdict.saving === 0);
});

test("un id che coincide con un nome di Object.prototype resta un id", () => {
  assert.equal(modelLabel("x/constructor"), "constructor");
  assert.equal(modelLabel("toString"), "toString");
});

test("tra quelli buoni come oggi e più economici almeno del 10%: il più efficiente se lo è, poi il più economico", () => {
  // Il più efficiente (vicino al più bravo) è anche più bravo di oggi e costa il 44% in meno: è lui il consiglio, non il
  // più economico (che resta alla qualità di oggi). Senza di lui, il più economico.
  const B = r("anthropic/claude-fable-5-2", 1, 5);
  const E = r(OPUS, 0.985, 1.0);
  const C = r(HAIKU, 0.94, 0.3);
  const today = r(SONNET, 0.95, 1.8, { current: true });
  const a = analyzeBench([today, B, E, C], { role: "lettura", fakeModels: false });
  assert.deepEqual([a.best, a.efficient, a.cheapest], ["anthropic/claude-fable-5-2", OPUS, HAIKU]);
  assert.ok(a.verdict.kind === "cambia" && a.verdict.model === OPUS, JSON.stringify(a.verdict));
  const b = analyzeBench([today, B, C], { role: "lettura", fakeModels: false });
  assert.ok(b.verdict.kind === "cambia" && b.verdict.model === HAIKU, JSON.stringify(b.verdict));
});

test("il più bravo si sceglie tra i modelli con il costo noto, come gli altri segni", () => {
  const a = analyzeBench([r("x/a", 0.9, 1.0, { current: true }), r("x/b", 0.99, null), r("x/c", 0.89, 0.5)], { role: "lettura", fakeModels: false });
  assert.deepEqual([a.best, a.efficient, a.cheapest], ["x/a", "x/c", "x/c"]);
  assert.ok(a.verdict.kind === "cambia" && a.verdict.model === "x/c");
  // Nessun costo noto: il più bravo per sola qualità, e il consiglio senza costi.
  const u = analyzeBench([r("x/a", 0.9, null, { current: true }), r("x/b", 0.99, null)], { role: "lettura", fakeModels: false });
  assert.equal(u.best, "x/b");
  assert.equal(u.verdict.kind, "senza_costi");
});

test("le evals si confrontano solo con quelle dello stesso livello", () => {
  const p = (quality: number, level: string | null | undefined) => ({ quality, thresholdsMet: true, fakeModels: false, inConstruction: false, branch: "main", level });
  assert.equal(evalsAlert(p(1, "veloce"), p(0.9, "pull_request")), null, "veloce → pull_request: non è un calo");
  assert.deepEqual(evalsAlert(p(1, "pull_request"), p(0.9, "pull_request")), { kind: "in_calo", drop: 1 - 0.9 });
  assert.deepEqual(evalsAlert(p(1, undefined), p(0.9, undefined)), { kind: "in_calo", drop: 1 - 0.9 }, "senza livello da tutte e due le parti: come prima");
});

test("un banco superato: evals vere di main più nuove, con un altro modello per il ruolo (o senza il ruolo)", () => {
  const bench = { role: "lettura", at: "2026-11-14T10:00:00.000Z", currentModel: SONNET };
  const evals = (over: Record<string, unknown> = {}) => ({ at: "2026-11-14T11:00:00.000Z", branch: "main", fakeModels: false, models: { lettura: HAIKU } as Record<string, string>, ...over });
  assert.equal(benchSuperseded(bench, evals()), true, "il consiglio è stato seguito");
  assert.equal(benchSuperseded(bench, evals({ models: { scrittura: HAIKU } })), true, "il ruolo non c'è più");
  assert.equal(benchSuperseded(bench, evals({ models: { lettura: SONNET.toUpperCase() } })), false, "stesso modello: il consiglio vale ancora");
  assert.equal(benchSuperseded(bench, evals({ at: "2026-11-14T09:00:00.000Z" })), false, "evals più vecchie del banco");
  assert.equal(benchSuperseded(bench, evals({ at: bench.at })), false, "nello stesso istante: non dopo");
  assert.equal(benchSuperseded(bench, evals({ fakeModels: true })), false, "le evals finte non dicono il modello vero");
  assert.equal(benchSuperseded(bench, evals({ branch: "tj-0049/t-3" })), false, "solo main");
  assert.equal(benchSuperseded(bench, evals({ models: {} })), false, "evals senza i modelli: non dicono che il ruolo non c'è più");
  assert.equal(benchSuperseded(bench, null), false);
  assert.equal(benchSuperseded({ ...bench, role: null }, evals()), false);
  assert.equal(benchSuperseded(bench, evals({ models: Object.assign(Object.create(null), { constructor: HAIKU }) })), true, "un ruolo «constructor» non viene dal prototipo");
});

test("(casi senza AI) la regola: le evals con il risultato «attuale» senza-ai; mai un banco, mai i modelli vuoti senza il segno", () => {
  assert.equal(NO_AI_MODEL, "senza-ai");
  assert.equal(evalRunWithoutAi("evals", [r(NO_AI_MODEL, 1, null, { current: true })]), true);
  assert.equal(evalRunWithoutAi("banco", [r(NO_AI_MODEL, 1, null, { current: true })]), false, "mai un banco");
  assert.equal(evalRunWithoutAi("evals", [r(HAIKU, 1, null, { current: true })]), false, "un modello vero, anche con i modelli vuoti");
  assert.equal(evalRunWithoutAi("evals", [r(HAIKU, 1, null, { current: true }), r(NO_AI_MODEL, 1, null)]), false, "conta solo il risultato «attuale»");
  assert.equal(evalRunWithoutAi("evals", [r("Senza-AI", 1, null, { current: true })]), false, "l'id riservato com'è scritto nel database");
  assert.equal(evalRunWithoutAi("evals", []), false);
});

test("(casi senza AI) un banco superato: evals senza AI di main più recenti; i modelli vuoti senza il segno restano come oggi", () => {
  const bench = { role: "lettura", at: "2026-11-14T10:00:00.000Z", currentModel: SONNET };
  const noAi = (over: Record<string, unknown> = {}) => ({ at: "2026-11-14T11:00:00.000Z", branch: "main", fakeModels: false, models: {} as Record<string, string>, withoutAi: true, ...over });
  assert.equal(benchSuperseded(bench, noAi()), true, "il ruolo non c'è più: il caso è senza AI");
  assert.equal(benchSuperseded({ role: "scrittura", at: bench.at, currentModel: HAIKU }, noAi()), true, "ogni banco del caso");
  assert.equal(benchSuperseded(bench, noAi({ withoutAi: false })), false, "models vuoti senza il segno: le evals mandate a mano prima del 14/11");
  assert.equal(benchSuperseded(bench, noAi({ withoutAi: undefined })), false, "il caso di oggi");
  assert.equal(benchSuperseded(bench, noAi({ at: "2026-11-14T09:00:00.000Z" })), false, "evals più vecchie del banco");
  assert.equal(benchSuperseded(bench, noAi({ at: bench.at })), false, "nello stesso istante: non dopo");
  assert.equal(benchSuperseded(bench, noAi({ branch: "xx-0007/prova" })), false, "solo main");
  assert.equal(benchSuperseded(bench, noAi({ fakeModels: true })), false);
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
