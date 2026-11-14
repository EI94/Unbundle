// La sezione «Evals e banco di prova» resa in HTML (rilascio 8.2a, docs/rilascio-8/BANCO-DI-PROVA.md §4.2): lo stato
// vuoto con i due comandi, le ultime evals con l'andamento, il banco di un ruolo con grafico, tabella e
// raccomandazione, i modelli finti, il caso in costruzione, i ruoli ancora senza banco. Dati sintetici.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { analyzeBench, type BenchResult, type EvalOverview, type EvalRunView } from "../../lib/use-cases/factory/benchmark.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { EVAL_TEXT } from "./eval-format.ts";

let render: (overview: EvalOverview | null, extra?: { unavailable?: boolean; caseCode?: string }) => string;
before(async () => {
  await enableTsxImports();
  const { EvalSection } = await import("./eval-section.tsx");
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  render = (overview, extra = {}) => renderToStaticMarkup(react.createElement(EvalSection, { overview, caseCode: "TJ-0049", ...extra }));
});

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
  models: { lettura: HAIKU, scrittura: SONNET },
  fakeModels: false,
  inConstruction: false,
  casesTotal: 28,
  createdAt: "2026-11-14T10:00:00.000Z",
  results: [
    result(HAIKU, 0.9643, 0.42, {
      current: true,
      passed: 27,
      total: 28,
      groups: { regole: { passati: 9, totali: 9, soglia: 1, ok: true }, avversari: { passati: 5, totali: 6, soglia: 1, ok: false }, casi: { passati: 13, totali: 13, soglia: 0.9, ok: true } },
    }),
  ],
  ...over,
});

function benchOf(role: string, results: BenchResult[], over: Partial<EvalRunView> = {}): EvalOverview["benches"][number] {
  const view = run({ kind: "banco", role, results, ...over });
  return { role, run: view, analysis: analyzeBench(results, { role, fakeModels: view.fakeModels }) };
}

const LETTURA = [result(SONNET, 0.96, 1.8, { current: true, latencyP95Ms: 4100 }), result(HAIKU, 0.95, 0.12), result(OPUS, 0.97, 3.6), result("altro/modello", 0.8, null, { thresholdsMet: false, latencyP95Ms: null })];

const FULL: EvalOverview = {
  evals: {
    latest: run(),
    trend: [
      { at: "2026-11-10T10:00:00.000Z", quality: 0.931, thresholdsMet: true, fakeModels: false },
      { at: "2026-11-12T10:00:00.000Z", quality: 0.95, thresholdsMet: true, fakeModels: false },
      { at: "2026-11-14T10:00:00.000Z", quality: 0.9643, thresholdsMet: true, fakeModels: false },
    ],
  },
  benches: [benchOf("lettura", LETTURA)],
};

/** Il testo visibile, senza tag e con gli spazi normali. */
const textOf = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .split(String.fromCharCode(160))
    .join(" ")
    .replace(/\s+/g, " ");

const count = (html: string, pattern: RegExp) => html.match(new RegExp(pattern.source, "g"))?.length ?? 0;

test("senza misure: i due comandi e a cosa servono, con il codice del caso", () => {
  const html = render(null);
  const text = textOf(html);
  assert.match(html, /data-slot="eval-empty"/);
  assert.ok(text.includes(EVAL_TEXT.emptyIntro));
  assert.ok(text.includes(EVAL_TEXT.emptyEvals));
  assert.ok(text.includes(EVAL_TEXT.emptyBench));
  assert.ok(text.includes("npm run unbundle -- eval TJ-0049 --invia"));
  assert.ok(text.includes("npm run unbundle -- banco TJ-0049 --ruolo <ruolo> --invia"));
  assert.doesNotMatch(html, /role="status"/, "nessun avviso se la lettura è andata");
  assert.doesNotMatch(html, /<table/);
  // Anche una panoramica vuota è lo stato vuoto.
  assert.match(render({ evals: { latest: null, trend: [] }, benches: [] }), /data-slot="eval-empty"/);
  // Senza codice del caso, il segnaposto.
  assert.ok(textOf(render(null, { caseCode: "<ID>" })).includes("npm run unbundle -- eval <ID> --invia"));
});

test("la lettura non riuscita lo dice, sopra lo stato vuoto", () => {
  const html = render(null, { unavailable: true });
  assert.match(html, /role="status"/);
  assert.ok(textOf(html).includes(EVAL_TEXT.unavailable));
  assert.match(html, /data-slot="eval-empty"/);
  // Non si sa se ci sono misure: niente «ancora nessuna misura», ma i comandi sì.
  assert.ok(!textOf(html).includes(EVAL_TEXT.emptyIntro));
  assert.ok(textOf(html).includes(EVAL_TEXT.emptyIntroUnavailable));
  assert.ok(textOf(html).includes("npm run unbundle -- eval TJ-0049 --invia"));
});

test("le ultime evals: qualità, soglie, prove, data, ramo, livello, gruppi, modelli, andamento, comando", () => {
  const html = render(FULL);
  const text = textOf(html);
  assert.match(html, /data-slot="eval-latest"/);
  assert.ok(text.includes("96,4%"));
  assert.ok(text.includes("✓ soglie rispettate · 27 di 28 prove"));
  assert.ok(text.includes("96,4%, 27 di 28 prove, soglie rispettate."), "la frase per i lettori di schermo");
  assert.ok(text.includes("14/11/2026 · ramo main · livello pull request · commit a1b2c3d"));
  assert.ok(text.includes("regole 9 di 9 · avversari 5 di 6, sotto soglia · casi 13 di 13"));
  assert.ok(text.includes("Modelli: lettura · Claude Haiku 5.5, scrittura · Claude Sonnet 5.5"));
  assert.match(html, /data-slot="eval-trend"/);
  assert.ok(text.includes("Ultime 3: da 93,1% a 96,4%"));
  assert.ok(text.includes("Andamento delle ultime 3 evals sul ramo main, dalla più vecchia: 93,1%, 95%, 96,4%."));
  assert.ok(text.includes("Per rifarle: npm run unbundle -- eval TJ-0049 --invia"));
  assert.doesNotMatch(html, /data-slot="eval-alert"/, "niente avviso: sopra soglia e non in calo");
  assert.ok(!text.includes(EVAL_TEXT.fakeModels));
  assert.ok(!text.includes(EVAL_TEXT.inConstruction));
});

test("le evals in calo o sotto soglia hanno l'avviso; in costruzione la nota e nessun avviso di soglia", () => {
  const drop: EvalOverview = {
    evals: { latest: run({ results: [result(HAIKU, 0.9, 0.42, { current: true })] }), trend: [{ at: "2026-11-13T10:00:00.000Z", quality: 0.97, thresholdsMet: true, fakeModels: false }] },
    benches: [],
  };
  const dropHtml = render(drop);
  assert.match(dropHtml, /data-slot="eval-alert"/);
  assert.ok(textOf(dropHtml).includes("In calo: 7 punti sotto le evals precedenti."));
  const building: EvalOverview = { evals: { latest: run({ inConstruction: true, results: [result(HAIKU, 0.7, 0.42, { current: true, thresholdsMet: false })] }), trend: [] }, benches: [] };
  const buildingHtml = render(building);
  assert.ok(textOf(buildingHtml).includes(EVAL_TEXT.inConstruction));
  assert.ok(textOf(buildingHtml).includes("✗ sotto soglia"));
  assert.doesNotMatch(buildingHtml, /data-slot="eval-alert"/);
});

test("il banco di un ruolo: grafico con i punti, la frontiera, la legenda e i modelli senza costo", () => {
  const html = render(FULL);
  const text = textOf(html);
  assert.match(html, /data-slot="bench-card" data-role="lettura"/);
  assert.ok(text.includes("Banco di prova · ruolo «lettura»"));
  assert.ok(text.includes("14/11/2026 · livello pull request · 4 modelli · ramo main"));
  // Un pulsante per ogni modello con il costo, con tutto nel nome; nessuno per chi non ha il costo.
  assert.equal(count(html, /data-point="/), 3);
  assert.equal(count(html, /<button[^>]*aria-label="[^"]+"/), 3);
  assert.match(html, /aria-label="Claude Sonnet 5\.5, oggi, sulla frontiera: qualità 96%, 27 di 28 prove, 1,80.USD per 1\.000 esecuzioni \(stimato\), tempo p95 4,1 s\."/);
  // La frontiera, che il grafico disegna, è anche nelle parole: nel nome dei punti e nella frase.
  assert.equal(count(html, /, sulla frontiera: /), 3);
  assert.ok(text.includes("Frontiera: Claude Haiku 5.5, Claude Sonnet 5.5, Claude Opus 5.5."));
  assert.match(html, /data-slot="bench-current"/, "il modello di oggi ha il cerchio");
  assert.match(html, /data-slot="bench-frontier"/);
  assert.ok(count(html, /data-slot="bench-label"/) >= 1, "le etichette accanto ai punti");
  // Il costo è una stima: lo dice l'asse (e la tabella, sotto).
  assert.ok(text.includes("Costo stimato per 1.000 esecuzioni (USD) · scala logaritmica"));
  for (const legend of [EVAL_TEXT.legendPassing, EVAL_TEXT.legendCurrent, EVAL_TEXT.legendFrontier]) assert.ok(text.includes(legend), legend);
  assert.ok(text.includes("Costo non noto: modello (80%, sotto soglia)."));
  assert.ok(text.includes("Qualità e costo stimato per 1.000 esecuzioni di 4 modelli per il ruolo «lettura»."), "la frase per i lettori di schermo");
});

test("la tabella del banco: dal più bravo, «oggi», soglie, costo, tempo p95 e segni", () => {
  const html = render(FULL);
  assert.match(html, /<table data-slot="bench-table"/);
  assert.equal(count(html, /<tr data-model="/), 4);
  const order = [...html.matchAll(/<tr data-model="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(order, [OPUS, SONNET, HAIKU, "altro/modello"]);
  const text = textOf(html);
  for (const header of [EVAL_TEXT.columnModel, EVAL_TEXT.columnQuality, EVAL_TEXT.columnThresholds, EVAL_TEXT.columnCost, EVAL_TEXT.columnP95, EVAL_TEXT.columnMarks]) assert.ok(text.includes(header), header);
  assert.ok(text.includes("Costo stimato per 1.000"), "il costo è una stima");
  assert.match(text, /Claude Sonnet 5\.5 oggi/);
  // Nella scheda stretta i segni sotto il nome, uno per riga; in quella larga nella loro colonna.
  assert.match(text, /Claude Haiku 5\.5 più efficiente più economico 95%/);
  assert.match(text, /0,12 USD 2 s più efficiente · più economico/);
  assert.match(text, /Claude Opus 5\.5 più bravo/);
  assert.ok(text.includes("0,12 USD"));
  assert.ok(text.includes("4,1 s"));
  assert.ok(text.includes("costo non noto"));
  assert.ok(text.includes("— non misurato"));
  assert.ok(text.includes("✗ sotto soglia"));
});

test("«cambia»: la raccomandazione in evidenza con la riga di agent.yaml, e il comando per rifare il banco", () => {
  const html = render(FULL);
  assert.match(html, /data-slot="bench-verdict" data-verdict="cambia" class="[^"]*border-uc-blu/);
  const text = textOf(html);
  assert.match(text, /Conviene Claude Haiku 5\.5 per «lettura»/);
  assert.ok(text.includes("Per cambiarlo: in agent.yaml , modelli.lettura.modello: anthropic/claude-haiku-5-5 , poi la pull request."));
  assert.ok(text.includes("Per rifarlo: npm run unbundle -- banco TJ-0049 --ruolo lettura --invia"));
  // «resta»: testo semplice, senza la riga da cambiare.
  const stay = render({ ...FULL, benches: [benchOf("lettura", [result(HAIKU, 0.95, 0.12, { current: true }), result(SONNET, 0.96, 1.8)])] });
  assert.match(stay, /data-verdict="resta" class="flex items-start gap-2 text-sm"/);
  assert.doesNotMatch(stay, /data-slot="bench-change-hint"/);
  // «nessuno»: attenzione.
  const none = render({ ...FULL, benches: [benchOf("lettura", [result(HAIKU, 0.5, 0.12, { current: true, thresholdsMet: false })])] });
  assert.match(none, /data-verdict="nessuno" class="[^"]*border-uc-giallo/);
});

test("modelli finti: il segno, nessuna raccomandazione di modello, nessuna riga da cambiare", () => {
  const fake = benchOf("lettura", [result(HAIKU, 1, 0.12, { current: true }), result(SONNET, 1, 1.8)], { fakeModels: true });
  const html = render({ evals: { latest: run({ fakeModels: true }), trend: [] }, benches: [fake] });
  const text = textOf(html);
  assert.equal(count(html, new RegExp(EVAL_TEXT.fakeModels)), 2, "nelle evals e nel banco");
  assert.match(html, /data-verdict="finti"/);
  assert.doesNotMatch(html, /data-slot="bench-change-hint"/);
  assert.ok(!text.includes("più bravo") && !text.includes("più efficiente") && !text.includes("più economico"), "nessun segno con i modelli finti");
});

test("tutti i costi non noti: niente grafico, la tabella e la raccomandazione senza costi", () => {
  const html = render({ ...FULL, benches: [benchOf("lettura", [result(HAIKU, 0.95, null, { current: true }), result(SONNET, 0.97, null)])] });
  assert.ok(textOf(html).includes(EVAL_TEXT.noPrices));
  assert.doesNotMatch(html, /data-slot="bench-plot"/);
  assert.equal(count(html, /<tr data-model="/), 2);
  assert.match(html, /data-verdict="senza_costi"/);
});

test("i ruoli senza banco hanno il loro comando, con o senza altri banchi", () => {
  const noBench = render({ ...FULL, benches: [] });
  const text = textOf(noBench);
  assert.ok(text.includes(EVAL_TEXT.benchNone));
  assert.ok(text.includes("Per il ruolo «lettura»: npm run unbundle -- banco TJ-0049 --ruolo lettura --invia"));
  assert.ok(text.includes("Per il ruolo «scrittura»: npm run unbundle -- banco TJ-0049 --ruolo scrittura --invia"));
  const partly = textOf(render(FULL));
  assert.ok(partly.includes("Ancora nessun banco per il ruolo «scrittura»: npm run unbundle -- banco TJ-0049 --ruolo scrittura --invia"));
  assert.ok(!partly.includes("Ancora nessun banco per il ruolo «lettura»"));
  // Banchi senza evals: le evals dicono come lanciarle.
  const benchOnly = textOf(render({ evals: { latest: null, trend: [] }, benches: FULL.benches }));
  assert.ok(benchOnly.includes(EVAL_TEXT.evalsNone));
  assert.ok(benchOnly.includes("Per lanciarle: npm run unbundle -- eval TJ-0049 --invia"));
});

test("i testi resi: «use case» nella dashboard, nessuna parola vietata, nessun nome di persona", () => {
  for (const html of [render(null, { unavailable: true }), render(FULL), render({ ...FULL, benches: [] })]) {
    const text = textOf(html);
    assert.deepEqual(findHubForbiddenIn([text], "area"), []);
    assert.doesNotMatch(text, /@|lanciato da|eseguito da|autore/i);
  }
});
