// La sezione «Evals e banco di prova» del progetto (rilascio 8.2a): testi, scale del grafico qualità contro costo,
// etichette che non si coprono, la lettura prudente della panoramica. Docs: docs/rilascio-8/BANCO-DI-PROVA.md §4.2.
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeBench, type BenchResult, type EvalOverview, type EvalRunView } from "../../lib/use-cases/factory/benchmark.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import {
  EVAL_TEXT,
  LABEL_FONT,
  QUALITY_MARGIN,
  benchCommand,
  benchHeading,
  benchLabels,
  benchMetaLine,
  benchMissingText,
  benchRows,
  benchSummary,
  changeHint,
  changeHintParts,
  costScale,
  dayText,
  evalSectionDescription,
  evalsAlertText,
  evalsCommand,
  evalsMetaLine,
  evalsStatusLine,
  formatLatency,
  formatPoints,
  groupsLine,
  hasMeasures,
  labelPriority,
  labelVariants,
  latestEvalsAlert,
  levelText,
  modelNames,
  modelsByRole,
  nearestPoint,
  normalizeEvalOverview,
  placePointLabels,
  segmentCrossesRect,
  pointDetails,
  pointLabel,
  qualityScale,
  rolesWithoutBench,
  rowSigns,
  sparkline,
  testsText,
  trendCaption,
  trendPoints,
  trendSentence,
  verdictTone,
  type LabelPoint,
  type PlacedLabel,
} from "./eval-format.ts";

const HAIKU = "anthropic/claude-haiku-5-5";
const SONNET = "anthropic/claude-sonnet-5-5";
const OPUS = "anthropic/claude-opus-5-5";

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
  id: "00000000-0000-4000-8000-000000000001",
  kind: "evals",
  role: null,
  level: "pull_request",
  branch: "main",
  commit: "a1b2c3d4e5f6",
  templateVersion: "1.4.0",
  models: { scrittura: SONNET, lettura: HAIKU },
  fakeModels: false,
  inConstruction: false,
  casesTotal: 28,
  createdAt: "2026-11-14T10:00:00.000Z",
  results: [result(HAIKU, 0.9643, 0.42, { current: true, passed: 27, total: 28 })],
  ...over,
});

const bench = (results: BenchResult[], over: Partial<EvalRunView> = {}) => run({ kind: "banco", role: "lettura", results, ...over });

/** Lo spazio che non va a capo di `Intl` («1,80 USD»): nei confronti diventa uno spazio normale. */
const plain = (text: string) => text.split(String.fromCharCode(160)).join(" ");

// ─── Testi ───────────────────────────────────────────────────────────

test("i comandi per rifare evals e banco, come li scrive la CLI del modello", () => {
  assert.equal(evalsCommand("TJ-0049"), "npm run unbundle -- eval TJ-0049 --invia");
  assert.equal(benchCommand("TJ-0049", "lettura"), "npm run unbundle -- banco TJ-0049 --ruolo lettura --invia");
  assert.equal(evalsCommand("TJ-0049", "pull_request"), "npm run unbundle -- eval TJ-0049 --invia", "il livello di default non si scrive");
  assert.equal(evalsCommand("TJ-0049", "veloce"), "npm run unbundle -- eval TJ-0049 --livello veloce --invia");
  assert.equal(benchCommand("TJ-0049", "lettura", "veloce"), "npm run unbundle -- banco TJ-0049 --ruolo lettura --livello veloce --invia");
  assert.equal(benchCommand("TJ-0049", null), "npm run unbundle -- banco TJ-0049 --ruolo <ruolo> --invia");
  // Un codice o un ruolo fuori regola non finisce in un comando da copiare.
  assert.equal(evalsCommand("TJ 0049; rm -rf /"), "npm run unbundle -- eval <ID> --invia");
  assert.equal(benchCommand("<ID>", "Lettura!"), "npm run unbundle -- banco <ID> --ruolo <ruolo> --invia");
  assert.equal(evalsCommand("TJ-0049", "VELOCE; x"), "npm run unbundle -- eval TJ-0049 --invia");
});

test("la riga di agent.yaml per cambiare modello, e le note fisse", () => {
  assert.equal(changeHint("lettura", HAIKU), "Per cambiarlo: in agent.yaml, modelli.lettura.modello: anthropic/claude-haiku-5-5, poi la pull request.");
  assert.deepEqual(changeHintParts("scrittura", SONNET), { file: "agent.yaml", line: "modelli.scrittura.modello: anthropic/claude-sonnet-5-5" });
  assert.equal(EVAL_TEXT.fakeModels, "modelli finti: misurano il codice, non i modelli");
  assert.equal(EVAL_TEXT.title, "Evals e banco di prova");
  assert.equal(benchHeading("lettura"), "Banco di prova · ruolo «lettura»");
  assert.equal(benchMissingText("scrittura"), "Ancora nessun banco per il ruolo «scrittura»:");
});

test("date, tempi, punti e prove come li legge una persona", () => {
  assert.equal(dayText("2026-11-14T10:00:00.000Z"), "14/11/2026");
  assert.equal(dayText("2026-11-14T23:30:00Z"), "15/11/2026", "a Roma è già il giorno dopo");
  assert.equal(dayText("2026-11-14 10:00:00+00"), "14/11/2026", "la forma testuale di Postgres");
  assert.equal(dayText("non è una data"), null);
  assert.equal(dayText(""), null);
  assert.equal(dayText(null), null);
  assert.equal(formatLatency(850), "850 ms");
  assert.equal(formatLatency(4100), "4,1 s");
  assert.equal(formatLatency(12_400), "12 s");
  assert.equal(formatLatency(null), "—");
  assert.equal(formatLatency(-1), "—");
  assert.equal(formatLatency(Number.NaN), "—");
  assert.equal(formatPoints(0.06), "6 punti");
  assert.equal(formatPoints(0.055), "5,5 punti");
  assert.equal(formatPoints(0.01), "1 punto");
  assert.equal(testsText(27, 28), "27 di 28 prove");
  assert.equal(testsText(1, 1), "1 di 1 prova");
  assert.equal(testsText(1200, 1500), "1.200 di 1.500 prove");
  assert.equal(levelText("pull_request"), "pull request");
  assert.equal(levelText("veloce"), "veloce");
  assert.equal(levelText("notte_lunga"), "notte lunga");
});

test("la riga delle evals: qualità, prove, soglie; data, ramo, livello e commit", () => {
  assert.equal(evalsStatusLine(run()), "96,4% · 27 di 28 prove · soglie rispettate");
  assert.equal(evalsStatusLine(run(), ", "), "96,4%, 27 di 28 prove, soglie rispettate");
  assert.equal(evalsStatusLine(run({ results: [result(HAIKU, 0.8, null, { current: true, thresholdsMet: false, passed: 22, total: 28 })] })), "80% · 22 di 28 prove · sotto soglia");
  assert.equal(evalsStatusLine(run({ results: [] })), "Nessun risultato in queste evals.");
  assert.equal(evalsMetaLine(run()), "14/11/2026 · ramo main · livello pull request · commit a1b2c3d");
  assert.equal(evalsMetaLine(run({ branch: null, commit: null, level: "veloce" })), "14/11/2026 · livello veloce");
  assert.equal(benchMetaLine(bench([result(HAIKU, 0.95, 0.12), result(SONNET, 0.96, 1.8, { current: true })])), "14/11/2026 · livello pull request · 2 modelli · ramo main");
  assert.equal(benchMetaLine(bench([result(HAIKU, 0.95, 0.12, { current: true })], { branch: null })), "14/11/2026 · livello pull request · 1 modello");
});

test("i modelli per ruolo e i gruppi di prove, in un ordine fisso", () => {
  assert.deepEqual(
    modelsByRole({ scrittura: SONNET, lettura: HAIKU }).map((m) => `${m.role} · ${m.label}`),
    ["lettura · Claude Haiku 5.5", "scrittura · Claude Sonnet 5.5"],
  );
  const groups = {
    casi: { passati: 13, totali: 13, soglia: 0.9, ok: true },
    avversari: { passati: 5, totali: 6, soglia: 1, ok: false },
    regole: { passati: 9, totali: 9, soglia: 1, ok: true },
    extra: { passati: 1, totali: 2, soglia: 0.5, ok: true },
  };
  assert.equal(groupsLine(groups), "regole 9 di 9 · avversari 5 di 6, sotto soglia · casi 13 di 13 · extra 1 di 2");
  assert.equal(groupsLine({}), null);
});

test("la descrizione della sezione: cosa c'è, o come si comincia", () => {
  const empty: EvalOverview = { evals: { latest: null, trend: [] }, benches: [] };
  assert.equal(evalSectionDescription(null), EVAL_TEXT.descriptionEmpty);
  assert.equal(evalSectionDescription(empty), EVAL_TEXT.descriptionEmpty);
  assert.equal(hasMeasures(empty), false);
  const withEvals: EvalOverview = { evals: { latest: run(), trend: [] }, benches: [] };
  assert.equal(evalSectionDescription(withEvals), EVAL_TEXT.description);
  assert.equal(evalSectionDescription(null, true), EVAL_TEXT.description, "lettura non riuscita: non si dice «ancora nessuna misura»");
  assert.equal(hasMeasures(withEvals), true);
});

// ─── L'andamento e l'avviso ──────────────────────────────────────────

const point = (day: number, quality: number, over: Partial<{ thresholdsMet: boolean; fakeModels: boolean }> = {}) => ({
  at: `2026-11-${String(day).padStart(2, "0")}T10:00:00.000Z`,
  quality,
  thresholdsMet: true,
  fakeModels: false,
  ...over,
});

test("l'andamento: stesso tipo di modelli, dalla più vecchia, al massimo 12, l'ultima compresa", () => {
  const latest = run({ createdAt: "2026-11-14T10:00:00.000Z" });
  // L'ultima manca dall'elenco: si aggiunge. I finti non si mescolano ai veri; l'ordine si rimette.
  const trend = [point(12, 0.94), point(10, 0.93), point(11, 0.5, { fakeModels: true }), point(13, 0.95)];
  const points = trendPoints({ latest, trend });
  assert.deepEqual(
    points.map((p) => [p.at.slice(8, 10), p.quality]),
    [
      ["10", 0.93],
      ["12", 0.94],
      ["13", 0.95],
      ["14", 0.9643],
    ],
  );
  // L'ultima già nell'elenco non si ripete.
  assert.equal(trendPoints({ latest, trend: [point(13, 0.95), point(14, 0.9643)] }).length, 2);
  // Al massimo 12, le più recenti.
  const long = Array.from({ length: 20 }, (_, i) => point(i + 1, 0.9));
  const capped = trendPoints({ latest: run({ createdAt: "2026-11-20T10:00:00.000Z" }), trend: long });
  assert.equal(capped.length, 12);
  assert.equal(capped[0].at.slice(8, 10), "09");
  // Senza ultime evals niente andamento; con i modelli finti solo i finti.
  assert.deepEqual(trendPoints({ latest: null, trend: long }), []);
  const fake = trendPoints({ latest: run({ fakeModels: true }), trend: [point(11, 0.5, { fakeModels: true }), point(12, 0.94)] });
  assert.deepEqual(
    fake.map((p) => p.quality),
    [0.5, 0.9643],
  );
});

test("l'avviso delle evals: in calo di 5 punti, sotto soglia, mai in costruzione", () => {
  const drop = { latest: run({ results: [result(HAIKU, 0.9, 0.42, { current: true })] }), trend: [point(13, 0.97)] };
  const alert = latestEvalsAlert(drop);
  assert.equal(alert?.kind, "in_calo");
  assert.equal(evalsAlertText(alert), "In calo: 7 punti sotto le evals precedenti.");
  assert.equal(latestEvalsAlert({ latest: run({ results: [result(HAIKU, 0.93, 0.42, { current: true })] }), trend: [point(13, 0.97)] }), null, "4 punti: niente");
  const below = { latest: run({ results: [result(HAIKU, 0.8, 0.42, { current: true, thresholdsMet: false })] }), trend: [point(13, 0.97)] };
  assert.equal(evalsAlertText(latestEvalsAlert(below)), "Sotto soglia: le evals di oggi non rispettano le soglie. E sono 17 punti sotto le precedenti.");
  const belowFirst = { latest: run({ results: [result(HAIKU, 0.8, 0.42, { current: true, thresholdsMet: false })] }), trend: [] };
  assert.equal(evalsAlertText(latestEvalsAlert(belowFirst)), "Sotto soglia: le evals di oggi non rispettano le soglie.");
  const building = { latest: run({ inConstruction: true, results: [result(HAIKU, 0.8, 0.42, { current: true, thresholdsMet: false })] }), trend: [] };
  assert.equal(latestEvalsAlert(building), null, "in costruzione la soglia non avvisa");
  assert.equal(evalsAlertText(null), null);
  assert.equal(latestEvalsAlert({ latest: null, trend: [] }), null);
});

test("la piccola linea dell'andamento, con le parole per chi non la vede", () => {
  const points = [point(10, 0.931), point(11, 0.95), point(12, 0.9643)].map(({ at, quality, thresholdsMet }) => ({ at, quality, thresholdsMet }));
  assert.equal(trendCaption(points), "Ultime 3: da 93,1% a 96,4%");
  // Due estremi uguali non nascondono la salita e la discesa in mezzo.
  const upDown = [0.8947, 0.9474, 1, 0.8947].map((quality) => ({ at: points[0].at, quality, thresholdsMet: true }));
  assert.equal(trendCaption(upDown), "Ultime 4: da 89,5% a 89,5% · massimo 100%");
  const dip = [0.95, 0.8, 0.96].map((quality) => ({ at: points[0].at, quality, thresholdsMet: true }));
  assert.equal(trendCaption(dip), "Ultime 3: da 95% a 96% · minimo 80%");
  assert.equal(trendSentence(points, "main"), "Andamento delle ultime 3 evals sul ramo main, dalla più vecchia: 93,1%, 95%, 96,4%.");
  assert.equal(trendSentence(points, null), "Andamento delle ultime 3 evals, dalla più vecchia: 93,1%, 95%, 96,4%.");
  const line = sparkline(points);
  assert.ok(line);
  assert.match(line.path, /^M 0\.00 [\d.]+ L 50\.00 [\d.]+ L 100\.00 [\d.]+$/);
  assert.equal(line.last.x, 100);
  assert.ok(line.last.y >= 0 && line.last.y <= 100);
  // La più alta sta più in alto (y più piccola).
  const ys = line.path.split(/[ML]/).filter(Boolean).map((part) => Number(part.trim().split(" ")[1]));
  assert.ok(ys[0] > ys[1] && ys[1] > ys[2]);
  assert.equal(sparkline(points.slice(0, 1)), null);
  assert.equal(trendCaption(points.slice(0, 1)), null);
  assert.equal(trendSentence([], "main"), null);
});

// ─── Il banco ────────────────────────────────────────────────────────

test("i nomi dei modelli: corti senza la parola comune, l'id intero quando due si chiamerebbero uguali", () => {
  assert.deepEqual([...modelNames([HAIKU, SONNET, OPUS]).values()], [
    { label: "Claude Haiku 5.5", short: "Haiku 5.5" },
    { label: "Claude Sonnet 5.5", short: "Sonnet 5.5" },
    { label: "Claude Opus 5.5", short: "Opus 5.5" },
  ]);
  assert.deepEqual([...modelNames([HAIKU, "bedrock/claude-haiku-5-5"]).values()].map((n) => n.label), [HAIKU, "bedrock/claude-haiku-5-5"]);
  assert.deepEqual([...modelNames([HAIKU, "openai/gpt-x"]).values()], [
    { label: "Claude Haiku 5.5", short: "Claude Haiku 5.5" },
    { label: "gpt-x", short: "gpt-x" },
  ]);
  assert.deepEqual([...modelNames([HAIKU]).values()], [{ label: "Claude Haiku 5.5", short: "Claude Haiku 5.5" }], "un modello solo tiene il nome intero");
});

test("le righe del banco: i segni dall'analisi, dal più bravo, un modello una volta sola", () => {
  const results = [result(SONNET, 0.96, 1.8, { current: true }), result(HAIKU, 0.95, 0.12), result(OPUS, 0.97, 3.6), result("altro/modello", 0.99, null), result(HAIKU, 0.1, 9)];
  const analysis = analyzeBench(results, { role: "lettura", fakeModels: false });
  const rows = benchRows(results, analysis);
  assert.deepEqual(
    rows.map((r) => [r.label, r.marks]),
    [
      // Il più bravo può non avere il costo: lo dice la tabella, il grafico lo elenca sotto.
      ["modello", ["più bravo"]],
      ["Claude Opus 5.5", []],
      ["Claude Sonnet 5.5", ["oggi"]],
      ["Claude Haiku 5.5", ["più efficiente", "più economico"]],
    ],
  );
  const haiku = rows.find((r) => r.model === HAIKU)!;
  assert.equal(haiku.quality, 0.95, "la prima riga di un modello ripetuto");
  assert.equal(haiku.frontier, true);
  assert.equal(rows.find((r) => r.model === "altro/modello")!.frontier, false, "senza costo non è sulla frontiera");
  assert.deepEqual(rowSigns(rows.find((r) => r.model === SONNET)!), []);
  assert.deepEqual(rowSigns(haiku), ["più efficiente", "più economico"]);
});

test("il riquadro e il nome accessibile di un punto, e la frase del grafico", () => {
  const results = [result(SONNET, 0.96, 1.8, { current: true, latencyP95Ms: 4100 }), result(HAIKU, 0.95, 0.12), result(OPUS, 0.8, 3.6, { thresholdsMet: false, latencyP95Ms: null })];
  const analysis = analyzeBench(results, { role: "lettura", fakeModels: false });
  const rows = benchRows(results, analysis);
  const sonnet = rows.find((r) => r.model === SONNET)!;
  assert.deepEqual(pointDetails(sonnet).map(plain), ["96% · 27 di 28 prove", "1,80 USD per 1.000 esecuzioni", "tempo p95 4,1 s"]);
  assert.equal(plain(pointLabel(sonnet)), "Claude Sonnet 5.5, oggi e più bravo: qualità 96%, 27 di 28 prove, 1,80 USD per 1.000 esecuzioni, tempo p95 4,1 s.");
  assert.equal(plain(pointLabel(rows.find((r) => r.model === OPUS)!)), "Claude Opus 5.5: qualità 80%, 22 di 28 prove, 3,60 USD per 1.000 esecuzioni, tempo p95 non misurato, sotto soglia.");
  const opus = rows.find((r) => r.model === OPUS)!;
  assert.deepEqual(pointDetails(opus).slice(2), ["tempo p95 non misurato", "sotto soglia"]);
  const summary = plain(benchSummary("lettura", rows));
  assert.equal(
    summary,
    "Qualità e costo per 1.000 esecuzioni di 3 modelli per il ruolo «lettura». Oggi e più bravo: Claude Sonnet 5.5 (96%, 1,80 USD). Più efficiente e più economico: Claude Haiku 5.5 (95%, 0,12 USD). Sotto soglia: Claude Opus 5.5.",
  );
  const unknown = benchRows([result(HAIKU, 0.95, null, { current: true })], analyzeBench([result(HAIKU, 0.95, null, { current: true })], { role: "lettura", fakeModels: false }));
  assert.match(benchSummary("lettura", unknown), /di un modello per il ruolo «lettura».*Costo non noto: Claude Haiku 5\.5\.$/);
});

test("il tono della raccomandazione e i ruoli ancora senza banco", () => {
  assert.equal(verdictTone({ kind: "cambia", model: HAIKU, from: SONNET, saving: 0.9, text: "x" }), "cambia");
  assert.equal(verdictTone({ kind: "nessuno", text: "x" }), "attenzione");
  assert.equal(verdictTone({ kind: "resta", model: HAIKU, text: "x" }), "neutro");
  assert.equal(verdictTone({ kind: "finti", text: "x" }), "neutro");
  assert.equal(verdictTone({ kind: "senza_costi", model: null, text: "x" }), "neutro");
  const results = [result(HAIKU, 0.95, 0.12, { current: true })];
  const overview: EvalOverview = {
    evals: { latest: run({ models: { lettura: HAIKU, scrittura: SONNET, "Ruolo Strano": OPUS } }), trend: [] },
    benches: [{ role: "lettura", run: bench(results), analysis: analyzeBench(results, { role: "lettura", fakeModels: false }) }],
  };
  assert.deepEqual(rolesWithoutBench(overview), ["scrittura"]);
});

// ─── Le scale ────────────────────────────────────────────────────────

const ticks = (s: { ticks: { label: string }[] }) => s.ticks.map((t) => t.label);

test("costo: logaritmico da 10 volte in su, con tacche 1-2-5 e il dominio arrotondato", () => {
  const log = costScale([0.12, 1.8, 3.6]);
  assert.equal(log.kind, "logaritmica");
  assert.deepEqual([log.min, log.max], [0.1, 5]);
  assert.deepEqual(ticks(log), ["0,1", "0,2", "0,5", "1", "2", "5"]);
  assert.equal(log.at(0.1), 0);
  assert.equal(log.at(5), 1);
  assert.ok(Math.abs(log.at(1) - Math.log10(10) / Math.log10(50)) < 1e-9);
  // Esattamente 10 volte: logaritmica. Appena sotto: lineare da zero.
  assert.equal(costScale([0.1, 1]).kind, "logaritmica");
  assert.equal(costScale([0.11, 1]).kind, "lineare");
  // Un costo zero non ha logaritmo: lineare, anche se il più caro costa tanto.
  assert.equal(costScale([0, 5]).kind, "lineare");
});

test("costo: con molte decadi meno tacche, sempre allineate al bordo sinistro", () => {
  const wide = costScale([0.001, 1000]);
  assert.equal(wide.kind, "logaritmica");
  assert.deepEqual(ticks(wide), ["0,001", "0,1", "10", "1.000"]);
  const mid = costScale([0.0035, 0.42]);
  assert.deepEqual([mid.min, mid.max], [0.002, 0.5]);
  assert.deepEqual(ticks(mid), ["0,003", "0,01", "0,03", "0,1", "0,3"]);
  for (const s of [wide, mid, costScale([0.0007, 0.9]), costScale([2, 25_000])]) {
    assert.ok(s.ticks.length >= 2 && s.ticks.length <= 6, `${s.ticks.length} tacche`);
    for (const t of s.ticks) assert.ok(t.value >= s.min - 1e-12 && t.value <= s.max + 1e-12 && t.at >= 0 && t.at <= 1);
  }
});

test("costo: lineare da zero con tacche tonde all'italiana", () => {
  const lin = costScale([1, 1.8]);
  assert.equal(lin.kind, "lineare");
  assert.deepEqual([lin.min, lin.max], [0, 2]);
  assert.deepEqual(ticks(lin), ["0", "0,5", "1", "1,5", "2"]);
  assert.equal(lin.at(1), 0.5);
  assert.deepEqual(ticks(costScale([0.18])), ["0", "0,05", "0,1", "0,15", "0,2"], "niente 0,15000000000000002");
  assert.deepEqual(ticks(costScale([0.6, 2.4])), ["0", "0,5", "1", "1,5", "2", "2,5"]);
  assert.deepEqual(ticks(costScale([1200, 4000])), ["0", "1.000", "2.000", "3.000", "4.000"]);
  // Senza costi (o tutti zero): da 0 a 1, senza dividere per zero.
  for (const s of [costScale([]), costScale([0, 0]), costScale([Number.NaN, -1])]) {
    assert.deepEqual([s.kind, s.min, s.max], ["lineare", 0, 1]);
    assert.equal(s.at(0), 0);
  }
  // Fuori dal dominio resta sul bordo.
  assert.equal(lin.at(-5), 0);
  assert.equal(lin.at(50), 1);
});

test("qualità: da 5 punti sotto il peggiore, mai sotto zero, arrotondata alla tacca, fino al 100%", () => {
  const q = qualityScale([0.9643, 0.95, 0.97]);
  assert.deepEqual([q.min, q.max], [0.9, 1]);
  assert.deepEqual(ticks(q), ["90%", "95%", "100%"]);
  assert.ok(q.min <= 0.95 - QUALITY_MARGIN + 1e-9, "almeno 5 punti sotto il peggiore");
  assert.equal(q.at(1), 1);
  assert.ok(Math.abs(q.at(0.95) - 0.5) < 1e-9);
  const perfect = qualityScale([1]);
  assert.deepEqual(ticks(perfect), ["94%", "96%", "98%", "100%"]);
  assert.ok(perfect.min <= 0.95);
  const zero = qualityScale([0, 0.6]);
  assert.deepEqual([zero.min, ...ticks(zero)], [0, "0%", "25%", "50%", "75%", "100%"]);
  assert.deepEqual(ticks(qualityScale([0.5])), ["40%", "60%", "80%", "100%"]);
  assert.deepEqual(ticks(qualityScale([0.8, 0.96])), ["70%", "80%", "90%", "100%"]);
  for (const s of [q, perfect, zero, qualityScale([0.31]), qualityScale([0.87]), qualityScale([])]) {
    assert.ok(s.ticks.length >= 2 && s.ticks.length <= 5);
    assert.equal(s.ticks[s.ticks.length - 1].value, 1);
    assert.ok(s.min >= 0);
  }
  // Valori fuori da 0..1 non escono dall'asse.
  assert.equal(q.at(1.5), 1);
  assert.equal(q.at(-1), 0);
});

// ─── Le etichette ────────────────────────────────────────────────────

const BOX = { w: 244, h: 224 };

function assertNoCollisions(points: readonly LabelPoint[], placed: Map<string, PlacedLabel>, box: { w: number; h: number }) {
  const labels = [...placed.entries()];
  const distance = (p: LabelPoint, l: PlacedLabel) => Math.hypot(Math.max(l.x - p.x, 0, p.x - (l.x + l.w)), Math.max(l.y - p.y, 0, p.y - (l.y + l.h)));
  for (const [id, l] of labels) {
    assert.ok(l.x >= 0 && l.y >= 0 && l.x + l.w <= box.w + 1e-9 && l.y + l.h <= box.h + 1e-9, `${id} esce dal riquadro`);
    const own = points.find((p) => p.id === id)!;
    for (const p of points) {
      assert.ok(distance(p, l) >= p.r, `l'etichetta di ${id} copre il punto ${p.id}`);
      if (p !== own) assert.ok(distance(p, l) > distance(own, l), `l'etichetta di ${id} è più vicina al punto ${p.id} che al suo`);
    }
    for (const [other, o] of labels) {
      if (other === id) continue;
      const apart = l.x + l.w <= o.x || o.x + o.w <= l.x || l.y + l.h <= o.y || o.y + o.h <= l.y;
      assert.ok(apart, `le etichette di ${id} e ${other} si coprono`);
    }
  }
}

test("un'etichetta sta a destra del suo punto, a sinistra vicino al bordo destro", () => {
  const one = placePointLabels([{ id: "a", x: 60, y: 100, r: 7, variants: [["Claude Haiku 5.5"]] }], BOX);
  const a = one.get("a")!;
  assert.equal(a.align, "start");
  assert.ok(a.x > 60 && Math.abs(a.y + a.h / 2 - 100) < 1);
  assert.equal(a.w, 16 * LABEL_FONT.charPx + 4);
  assert.equal(a.h, LABEL_FONT.linePx + 1);
  const edge = placePointLabels([{ id: "b", x: 230, y: 100, r: 7, variants: [["Claude Haiku 5.5"]] }], BOX).get("b")!;
  assert.equal(edge.align, "end");
  assert.ok(edge.x + edge.w < 230);
  // In alto a destra, senza posto a destra né sopra: a sinistra o sotto.
  const corner = placePointLabels([{ id: "c", x: 236, y: 6, r: 7, variants: [["Claude Haiku 5.5", "oggi"]] }], BOX).get("c")!;
  assert.ok(corner.x + corner.w <= BOX.w && corner.y >= 0);
});

test("due punti vicini: la seconda etichetta cerca un altro posto, la forma corta se serve", () => {
  // A 18 px l'uno dall'altro: la prima a sinistra (a destra c'è l'altro punto), la seconda a destra, corta.
  const points: LabelPoint[] = [
    { id: "a", x: 120, y: 100, r: 7, variants: [["Claude Sonnet 5.5", "oggi"]] },
    { id: "b", x: 138, y: 100, r: 7, variants: [["Claude Haiku 5.5"], ["Haiku 5.5"]] },
  ];
  const placed = placePointLabels(points, BOX);
  assert.equal(placed.size, 2);
  assert.equal(placed.get("a")!.align, "end");
  assert.deepEqual(placed.get("b")!.lines, ["Haiku 5.5"]);
  assertNoCollisions(points, placed, BOX);
  // Uno sopra l'altro sarebbe a metà strada tra i due: non si sa di chi è, e l'etichetta non c'è.
  const ambiguous = placePointLabels(
    [
      { id: "c", x: 100, y: 100, r: 7, variants: [["Claude Sonnet 5.5"]] },
      { id: "d", x: 118, y: 100, r: 7, variants: [] },
    ],
    { w: 210, h: 224 },
  );
  assert.equal(ambiguous.has("c"), false);
  // Un riquadro troppo stretto per il nome intero: la forma corta.
  const narrow = { w: 90, h: 60 };
  const short = placePointLabels([{ id: "x", x: 10, y: 30, r: 7, variants: [["Claude Sonnet 5.5"], ["Sonnet 5.5"]] }], narrow).get("x")!;
  assert.deepEqual(short.lines, ["Sonnet 5.5"]);
  // Nessuna forma sta: niente etichetta, il punto resta.
  assert.equal(placePointLabels([{ id: "y", x: 10, y: 30, r: 7, variants: [["Un nome lunghissimo che non sta"]] }], narrow).size, 0);
  // Senza forme: nessuna etichetta, ma il punto resta un ostacolo per gli altri.
  const blocked = placePointLabels(
    [
      { id: "z", x: 120, y: 100, r: 7, variants: [] },
      { id: "w", x: 100, y: 100, r: 7, variants: [["abcdef"]] },
    ],
    BOX,
  );
  assert.equal(blocked.has("z"), false);
  assertNoCollisions([{ id: "z", x: 120, y: 100, r: 7, variants: [] }, { id: "w", x: 100, y: 100, r: 7, variants: [] }], blocked, BOX);
});

/** Un generatore pseudo-casuale con il seme, per prove ripetibili. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test("con tanti punti a caso, nessuna etichetta esce, copre un punto o un'altra etichetta", () => {
  const random = mulberry32(8_2);
  const names = ["Claude Haiku 5.5", "Claude Sonnet 5.5", "Claude Opus 5.5", "Claude Fable 5.2", "gpt-x", "Claude Opus 4.8"];
  for (let round = 0; round < 200; round++) {
    const box = random() < 0.5 ? BOX : { w: 640, h: 288 };
    const n = 1 + Math.floor(random() * 12);
    const points: LabelPoint[] = Array.from({ length: n }, (_, i) => ({
      id: `p${i}`,
      x: 16 + random() * (box.w - 32),
      y: 16 + random() * (box.h - 32),
      r: random() < 0.2 ? 11 : 7,
      variants: [[names[i % names.length], "oggi · più bravo"], [names[i % names.length]], [names[i % names.length].replace("Claude ", "")]],
    }));
    assertNoCollisions(points, placePointLabels(points, box), box);
  }
});

test("la frontiera: un'etichetta non la attraversa se c'è un altro posto, altrimenti sì", () => {
  assert.equal(segmentCrossesRect({ x1: 0, y1: 0, x2: 100, y2: 100 }, { x: 40, y: 40, w: 10, h: 10 }), true);
  assert.equal(segmentCrossesRect({ x1: 0, y1: 0, x2: 100, y2: 0 }, { x: 40, y: 10, w: 10, h: 10 }), false);
  assert.equal(segmentCrossesRect({ x1: 0, y1: 50, x2: 30, y2: 50 }, { x: 40, y: 40, w: 10, h: 20 }), false, "si ferma prima");
  assert.equal(segmentCrossesRect({ x1: 45, y1: 0, x2: 45, y2: 100 }, { x: 40, y: 40, w: 10, h: 10 }), true, "verticale");
  assert.equal(segmentCrossesRect({ x1: 60, y1: 0, x2: 60, y2: 100 }, { x: 40, y: 40, w: 10, h: 10 }), false);
  // A destra del punto passa la frontiera: l'etichetta va dove non la tocca.
  const right = { x1: 100, y1: 100, x2: 240, y2: 100 };
  const avoided = placePointLabels([{ id: "a", x: 100, y: 100, r: 7, variants: [["Claude Haiku 5.5"]] }], BOX, { segments: [right] }).get("a")!;
  assert.equal(segmentCrossesRect(right, avoided), false);
  // In un riquadro basso c'è solo il posto sulla linea: l'etichetta c'è lo stesso.
  const flat = { x1: 0, y1: 13, x2: 130, y2: 13 };
  const only = placePointLabels([{ id: "b", x: 10, y: 13, r: 7, variants: [["abcdef"]] }], { w: 130, h: 26 }, { segments: [flat] }).get("b");
  assert.ok(only);
  assert.equal(segmentCrossesRect(flat, only), true);
});

test("le forme di un'etichetta e chi sceglie prima", () => {
  assert.deepEqual(labelVariants({ label: "Claude Haiku 5.5", short: "Haiku 5.5", marks: ["oggi", "più efficiente"] }), [
    ["Claude Haiku 5.5", "oggi · più efficiente"],
    ["Claude Haiku 5.5", "oggi", "più efficiente"],
    ["Claude Haiku 5.5", "oggi"],
    ["Claude Haiku 5.5"],
  ]);
  assert.deepEqual(labelVariants({ label: "Claude Haiku 5.5", short: "Haiku 5.5", marks: ["più bravo"] }, "short"), [["Haiku 5.5", "più bravo"], ["Haiku 5.5"]]);
  assert.deepEqual(labelVariants({ label: "gpt-x", short: "gpt-x", marks: [] }), [["gpt-x"]]);
  const results = [result(SONNET, 0.96, 1.8, { current: true }), result(HAIKU, 0.95, 0.12), result(OPUS, 0.97, 3.6), result("altro/a", 0.99, 2, { thresholdsMet: false }), result("altro/b", 0.9, 2.5)];
  const rows = benchRows(results, analyzeBench(results, { role: "lettura", fakeModels: false }));
  assert.deepEqual(
    [...rows].sort(labelPriority).map((r) => r.label),
    ["Claude Sonnet 5.5", "Claude Haiku 5.5", "Claude Opus 5.5", "b", "a"],
    "oggi, poi chi ha più segni, poi chi rispetta le soglie",
  );
});

test("le etichette del banco non mescolano nomi interi e corti", () => {
  const row = (label: string, short: string) => ({ label, short, marks: [] as never[] });
  const points = [
    { id: "a", x: 40, y: 40, r: 7, row: row("Claude Haiku 5.5", "Haiku 5.5") },
    { id: "b", x: 40, y: 64, r: 7, row: row("Claude Sonnet 5.5", "Sonnet 5.5") },
    { id: "c", x: 40, y: 88, r: 7, row: row("Claude Opus 5.5", "Opus 5.5") },
  ];
  const wide = benchLabels(points, { w: 640, h: 288 });
  assert.deepEqual([...wide.values()].map((l) => l.lines[0]), ["Claude Haiku 5.5", "Claude Sonnet 5.5", "Claude Opus 5.5"]);
  const narrow = benchLabels(points, { w: 120, h: 120 });
  assert.equal(narrow.size, 3);
  assert.deepEqual([...narrow.values()].map((l) => l.lines[0]), ["Haiku 5.5", "Sonnet 5.5", "Opus 5.5"]);
});

test("il puntatore prende il punto più vicino, entro la distanza", () => {
  const pts = [
    { id: "a", x: 10, y: 10 },
    { id: "b", x: 50, y: 10 },
  ];
  assert.equal(nearestPoint(pts, 12, 12, 28), "a");
  assert.equal(nearestPoint(pts, 45, 20, 28), "b");
  assert.equal(nearestPoint(pts, 30, 10, 28), "a", "a pari distanza vince il primo");
  assert.equal(nearestPoint(pts, 200, 200, 28), null);
  assert.equal(nearestPoint([], 0, 0, 28), null);
});

// ─── La lettura prudente ─────────────────────────────────────────────

test("la panoramica si controlla: righe illeggibili via e contate, l'analisi che manca si rifà", () => {
  assert.equal(normalizeEvalOverview(null), null);
  assert.equal(normalizeEvalOverview("x"), null);
  assert.equal(normalizeEvalOverview({ benches: [] }), null);
  const good = [result(SONNET, 0.96, 1.8, { current: true }), result(HAIKU, 0.95, 0.12)];
  const raw = {
    evals: {
      latest: run(),
      trend: [point(12, 0.94), { at: "x" }, point(13, Number.NaN)],
    },
    benches: [
      { role: "scrittura", run: bench(good, { role: "scrittura" }), analysis: analyzeBench(good, { role: "scrittura", fakeModels: false }) },
      // L'analisi manca: si rifà con la regola comune.
      { role: "lettura", run: bench(good), analysis: undefined },
      // Un ruolo ripetuto, un ruolo fuori regola, un banco senza risultati: via.
      { role: "lettura", run: bench(good), analysis: null },
      { role: "Lettura!", run: bench(good) },
      { role: "ragionamento", run: bench([]) },
      // Una riga illeggibile (qualità che non è un numero e senza prove): via, e l'analisi si rifà.
      { role: "giudice", run: bench([...good, { ...result(OPUS, 0.97, 3.6), quality: "alta", total: 0 } as unknown as BenchResult]), analysis: analyzeBench(good, { role: "giudice", fakeModels: false }) },
    ],
  };
  const read = normalizeEvalOverview(raw);
  assert.ok(read);
  assert.deepEqual(
    read.overview.benches.map((b) => b.role),
    ["giudice", "lettura", "scrittura"],
  );
  assert.equal(read.overview.evals.trend.length, 1);
  // 2 punti dell'andamento, 3 banchi, 1 riga.
  assert.equal(read.dropped, 6);
  const lettura = read.overview.benches.find((b) => b.role === "lettura")!;
  assert.equal(lettura.analysis.verdict.kind, "cambia");
  assert.equal(lettura.analysis.efficient, HAIKU);
  const giudice = read.overview.benches.find((b) => b.role === "giudice")!;
  assert.equal(giudice.run.results.length, 2);
  assert.match(giudice.analysis.verdict.text, /«giudice»/, "rifatta sulle righe rimaste");
});

test("i numeri strani si leggono senza rompere la pagina", () => {
  const odd = {
    model: HAIKU,
    current: true,
    quality: 1.4,
    passed: 30,
    total: 28,
    thresholdsMet: true,
    groups: { regole: { passati: 9, totali: 9, soglia: 1, ok: true }, rotto: { passati: 3, totali: 2, ok: true }, strano: "x" },
    costPer1000Usd: -2,
    latencyP50Ms: Number.POSITIVE_INFINITY,
    latencyP95Ms: "4,1 s",
    tokensInAvg: null,
    tokensOutAvg: 12.5,
    errors: -1,
  };
  const read = normalizeEvalOverview({ evals: { latest: { ...run(), results: [odd] }, trend: null }, benches: null });
  assert.ok(read);
  const r = read.overview.evals.latest!.results[0];
  assert.equal(r.quality, 1, "qualità tra 0 e 1");
  assert.deepEqual([r.passed, r.total], [0, 0], "superate più delle totali: non si dicono");
  assert.equal(r.costPer1000Usd, null, "un costo negativo non è un costo");
  assert.equal(r.latencyP50Ms, null);
  assert.equal(r.latencyP95Ms, null);
  assert.equal(r.tokensOutAvg, 12.5);
  assert.equal(r.errors, 0);
  assert.deepEqual(Object.keys(r.groups), ["regole"]);
  assert.deepEqual(read.overview.evals.trend, []);
  assert.deepEqual(read.overview.benches, []);
  // Le ultime evals di un altro tipo non sono le ultime evals.
  const wrongKind = normalizeEvalOverview({ evals: { latest: { ...run(), kind: "banco" }, trend: [] }, benches: [] });
  assert.equal(wrongKind?.overview.evals.latest, null);
  assert.equal(wrongKind?.dropped, 1);
});

test("dal database: i numeric come testo e le date come Date si leggono, nessun altro testo", () => {
  const raw = {
    evals: {
      latest: {
        ...run(),
        createdAt: new Date("2026-11-14T10:00:00Z"),
        results: [{ ...result(HAIKU, 0.9643, 0.42, { current: true }), quality: "0.9643", costPer1000Usd: "0.42", passed: "27", total: "28", latencyP95Ms: "4100" }],
      },
      trend: [
        { at: new Date("2026-11-13T10:00:00Z"), quality: "0.95", thresholdsMet: true, fakeModels: false },
        { at: "ieri", quality: 0.9, thresholdsMet: true, fakeModels: false },
      ],
    },
    benches: [],
  };
  const read = normalizeEvalOverview(raw);
  assert.ok(read);
  const latest = read.overview.evals.latest!;
  assert.deepEqual([latest.results[0].quality, latest.results[0].costPer1000Usd, latest.results[0].passed, latest.results[0].total, latest.results[0].latencyP95Ms], [0.9643, 0.42, 27, 28, 4100]);
  assert.equal(latest.createdAt, "2026-11-14T10:00:00.000Z");
  assert.deepEqual(
    read.overview.evals.trend.map((p) => [p.at, p.quality]),
    [["2026-11-13T10:00:00.000Z", 0.95]],
  );
  assert.equal(read.dropped, 1, "«ieri» non è una data");
  const text = normalizeEvalOverview({ evals: { latest: { ...run(), results: [{ ...result(HAIKU, 0.9, null, { current: true }), costPer1000Usd: "0,42 USD", total: "28 prove" }] }, trend: [] }, benches: [] });
  assert.equal(text?.overview.evals.latest?.results[0].costPer1000Usd, null, "«0,42 USD» non è un numero");
  assert.equal(text?.overview.evals.latest?.results[0].total, 0);
});

// ─── I testi della dashboard ─────────────────────────────────────────

test("nella dashboard «use case», mai «caso d'uso», e nessuna parola vietata dell'area", () => {
  const results = [result(SONNET, 0.96, 1.8, { current: true }), result(HAIKU, 0.95, 0.12)];
  const rows = benchRows(results, analyzeBench(results, { role: "lettura", fakeModels: false }));
  const texts = [
    ...Object.values(EVAL_TEXT),
    evalsStatusLine(run()),
    evalsMetaLine(run()),
    benchSummary("lettura", rows),
    ...rows.map(pointLabel),
    changeHint("lettura", HAIKU),
    evalsAlertText({ kind: "in_calo", drop: 0.06 }) ?? "",
    evalsAlertText({ kind: "sotto_soglia", drop: 0.06 }) ?? "",
  ];
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
  // E nessun riferimento a chi ha lanciato il banco (art. 15.4).
  for (const text of texts) assert.doesNotMatch(text, /lanciato da|autore|eseguito da/i);
});
