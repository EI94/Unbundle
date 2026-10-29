import test, { before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import type { ValuationModel } from "../../lib/use-cases/valuation.ts";
import { DEFAULT_VALUE_PARAMS, valueModelSchema, type ValueParams } from "../../lib/use-cases/value-model.ts";
import { projectHubItem, type HubContext, type HubItem, type HubSourceRow } from "../../lib/use-cases/views.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// I grafici del menu «⋯» resi in HTML (rilascio «Panoramica»): «‹ Torna alla Panoramica» con il nome
// del grafico, la matrice con i due elenchi chiusi sotto («N da stimare», «N senza beneficio
// contato») al posto dei chip, il vuoto e «Curva del valore». Dati sintetici.
//
// I vuoti vengono da hub-header.tsx, che porta con sé il menu «⋯» con le sue azioni del server (e il
// database): qui il menu è un componente vuoto, il resto è quello vero.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};
let charts: typeof import("./chart-view.tsx");
let matrix: typeof import("./value-cost-matrix.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  const menu = `data:text/javascript,${encodeURIComponent("export function HubMenu() { return null; }")}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "./hub-menu" && context.parentURL?.endsWith("/hub-header.tsx")) return { url: menu, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  charts = await import("./chart-view.tsx");
  matrix = await import("./value-cost-matrix.tsx");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const TODAY = "2026-10-29"; // T4 2026
const BASE = "/dashboard/ws/use-cases";
const PARAMS: ValueParams = { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" };
const MODEL: ValuationModel = {
  dimensions: { impact: [{ id: "efficiency" }], feasibility: [{ id: "effort", direction: "lower_better" }], esg: [] },
  thresholds: { highImpact: 3.5, midImpact: 2.5 },
};
const CTX: HubContext = { model: MODEL, esgEnabled: false, today: TODAY, valueParams: PARAMS };
const HIGH = { impact: { efficiency: 4 } };
const TO_DECIDE = { status: "proposed", portfolioReviewStatus: "in_review", targetQuarter: null } as const;
/** Un modello senza beneficio contato: nessun punto, «senza beneficio contato». */
const QUALITATIVE = valueModelSchema.parse({
  v: 1,
  primary: "qualita",
  components: [{ key: "qualita", lever: "qualita", label: "Meno errori", kind: "qualitativo", confidence: "ipotesi" }],
  costs: { devDays: 1, internalHours: 4, runCostEurYear: 0 },
});
/** 6.600 richieste × 1,5 min × 70% ≈ 115,5 h all'anno, avvio 4 giorni. */
const COUNTED = valueModelSchema.parse({
  v: 1,
  primary: "tempo",
  components: [{ key: "tempo", lever: "tempo", label: "Smistamento", kind: "ore", volumeYear: 6600, minutesPerUnit: 1.5, automatablePct: 70, confidence: "ipotesi" }],
  ease: 4,
  costs: { devDays: 4, internalHours: 16, runCostEurYear: 600 },
  plan: { quarter: "2026-Q4", startMonth: "2026-11", goLiveMonth: "2027-01" },
});

let seq = 0;
function row(o: Partial<HubSourceRow> = {}): HubSourceRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    code: `TJ-${String(seq).padStart(4, "0")}`,
    title: `Use case di prova ${seq}`,
    description: "Problema di prova.",
    origin: "adoption",
    portfolioKind: "use_case_ai",
    status: "accepted",
    portfolioReviewStatus: "scored",
    reviewedBy: null,
    publicNote: null,
    intake: null,
    reviewBy: null,
    targetQuarter: "2026-Q4",
    customScores: null,
    aiSuggestion: null,
    valueEurYear: null,
    costEurOnce: null,
    costBand: null,
    source: "web_proposed",
    aiLab: null,
    submittedAt: new Date("2026-10-01T10:00:00Z"),
    createdAt: new Date("2026-10-01T10:00:00Z"),
    statusChangedAt: new Date("2026-10-13T10:00:00Z"),
    version: 1,
    impactEconomic: null,
    impactTime: null,
    impactQuality: null,
    impactCoordination: null,
    impactSocial: null,
    feasibilityData: null,
    feasibilityWorkflow: null,
    feasibilityRisk: null,
    feasibilityTech: null,
    feasibilityTeam: null,
    esgEnvironmental: null,
    esgSocial: null,
    esgGovernance: null,
    reopenedOn: null,
    realizedOn: null,
    ...o,
  };
}
const item = (o: Partial<HubSourceRow> = {}): HubItem => projectHubItem(row(o), CTX, null);

function view(props: Record<string, unknown>): string {
  return renderToStaticMarkup(
    createElement(charts.HubChartView, {
      chart: "matrice",
      items: [],
      planItems: [],
      model: MODEL,
      valueParams: PARAMS,
      today: TODAY,
      basePath: BASE,
      query: { vista: "panoramica", mostra: "matrice" },
      filtersActive: false,
      clearHref: `${BASE}?vista=panoramica&mostra=matrice`,
      open: null,
      ...props,
    }),
  );
}

/** L'apertura del `<details>` con quel `data-slot`. */
function detailsTag(html: string, slot: string): string {
  return /<details[^>]*>/.exec(html.slice(html.lastIndexOf("<details", html.indexOf(`data-slot="${slot}"`))))?.[0] ?? "";
}

/** Il `<details>` con quel `data-slot`, dalla sua apertura alla chiusura. */
function detailsOf(html: string, slot: string): string {
  const start = html.lastIndexOf("<details", html.indexOf(`data-slot="${slot}"`));
  return html.slice(start, html.indexOf("</details>", start));
}

const isOpen = (tag: string) => /\sopen\b/.test(tag.replace(/="[^"]*"/g, ""));

test("matrice: sotto la legenda due elenchi chiusi al posto dei chip; l'indirizzo apre il suo", () => {
  const one = { id: "11111111-0000-4000-8000-000000000001", code: "TJ-0003", title: "Bozza di registrazione", href: "/h?apri=11111111-0000-4000-8000-000000000001" };
  const off = { id: "22222222-0000-4000-8000-000000000002", code: null, title: "Meno errori nelle fatture", href: "/h?apri=22222222-0000-4000-8000-000000000002" };
  const html = renderToStaticMarkup(
    createElement(matrix.ValueCostMatrix, {
      points: [],
      highValue: 3.5,
      lowCostX: 2.5,
      toEstimate: 1,
      toEstimateHref: "/h",
      lists: { toEstimate: [one], offMatrix: { label: "1 senza beneficio contato", items: [off] }, open: "fuori-matrice" },
    }),
  );
  const toEstimate = detailsTag(html, "to-estimate");
  assert.match(toEstimate, /^<details data-slot="to-estimate"/);
  assert.equal(isOpen(toEstimate), false, "chiuso: l'indirizzo chiede l'altro");
  const estimate = detailsOf(html, "to-estimate");
  assert.match(estimate, /<summary[^>]*>[\s\S]*1 da stimare<\/summary>/);
  const link = /<a [^>]*href="\/h\?apri=11111111-0000-4000-8000-000000000001"[^>]*>([\s\S]*?)<\/a>/.exec(estimate);
  assert.ok(link, "il link al pannello");
  assert.ok(link[1].includes("TJ-0003") && link[1].includes("Bozza di registrazione"), link[1]);
  assert.match(detailsTag(html, "off-matrix"), /^<details data-slot="off-matrix" open=""/);
  const offList = detailsOf(html, "off-matrix");
  assert.ok(offList.includes("1 senza beneficio contato") && offList.includes(">Meno errori nelle fatture<"), "senza codice, il titolo solo");
  assert.ok(!html.includes("to-estimate-chip") && !html.includes("off-matrix-chip"), "niente chip");
  // Gli elenchi stanno sotto la legenda, nella didascalia della matrice.
  assert.ok(html.indexOf('data-slot="matrix-legend"') < html.indexOf('data-slot="to-estimate"'));
  assert.ok(html.indexOf('data-slot="off-matrix"') < html.indexOf("</figcaption>"));

  // Senza elenchi, i chip di prima (fino a quando escono dalla matrice).
  const chips = renderToStaticMarkup(createElement(matrix.ValueCostMatrix, { points: [], highValue: 3.5, lowCostX: 2.5, toEstimate: 2, toEstimateHref: "/h?stima=mancante" }));
  assert.ok(chips.includes('data-slot="to-estimate-chip"') && !chips.includes("<details"));
  // Elenchi vuoti: niente.
  const none = renderToStaticMarkup(
    createElement(matrix.ValueCostMatrix, { points: [], highValue: 3.5, lowCostX: 2.5, toEstimate: 0, toEstimateHref: "/h", lists: { toEstimate: [], offMatrix: null, open: "mancante" } }),
  );
  assert.ok(!none.includes("<details") && !none.includes("da stimare"));
});

test("«Matrice Valore × Costo» dal menu «⋯»: «‹ Torna alla Panoramica», i punti, gli elenchi con i link al pannello", () => {
  const valued = item({ customScores: HIGH, costEurOnce: 18_000 });
  const missingCost = item({ customScores: HIGH, ...TO_DECIDE });
  const missingValue = item({ costEurOnce: 20_000 });
  const qualitative = item({ valueModel: QUALITATIVE });
  const building = item({ customScores: HIGH, status: "in_progress" });
  const query = { vista: "panoramica", mostra: "matrice", origine: "adoption", stima: "mancante", apri: valued.id };
  const html = view({ items: [valued, missingCost, missingValue, qualitative, building], query, open: "mancante" });
  assert.match(html, /^<div data-slot="hub-chart" data-chart="matrice" class="space-y-4">/);
  // «‹ Torna alla Panoramica»: le corsie, con gli stessi filtri, senza grafico, «da stimare» né pannello.
  const header = html.slice(html.indexOf('data-slot="chart-header"'), html.indexOf("</h2>"));
  assert.match(header, new RegExp(`<a [^>]*href="${BASE}\\?vista=panoramica&amp;origine=adoption"`));
  assert.ok(header.includes(">Torna alla Panoramica<") && header.endsWith(">Matrice Valore × Costo"), header);
  assert.ok(!html.includes('data-slot="list-focus"'), "il titolo per i lettori di schermo è della Panoramica");
  assert.ok(html.includes(`data-point="${valued.id}"`), "il punto");
  // «da stimare»: aperto, perché l'indirizzo lo chiede; i link aprono il pannello e restano nel grafico.
  assert.equal(isOpen(detailsTag(html, "to-estimate")), true);
  const estimate = detailsOf(html, "to-estimate");
  assert.match(estimate, /2 da stimare<\/summary>/);
  for (const card of [missingCost, missingValue]) {
    assert.ok(estimate.includes(`>${card.code}<`), card.code ?? "");
    assert.ok(estimate.includes(`href="${BASE}?vista=panoramica&amp;mostra=matrice&amp;origine=adoption&amp;stima=mancante&amp;apri=${card.id}"`), card.code ?? "");
  }
  assert.ok(!estimate.includes(`>${valued.code}<`) && !estimate.includes(`>${building.code}<`), "solo quelli senza un punto, mai chi è già partito");
  const off = detailsOf(html, "off-matrix");
  assert.equal(isOpen(detailsTag(html, "off-matrix")), false);
  assert.match(off, /1 senza beneficio contato<\/summary>/);
  assert.ok(off.includes(`>${qualitative.code}<`));
  assert.ok(!html.includes("to-estimate-chip"));
});

test("i vuoti dei grafici: «Nessuno use case da mettere in ordine», o «Togli i filtri» che tiene il grafico", () => {
  const empty = view({ items: [item({ customScores: HIGH, status: "in_progress" })] });
  assert.ok(empty.includes('data-slot="chart-header"') && empty.includes("Nessuno use case da mettere in ordine") && empty.includes("Valuta Valore e Costo in «Da decidere»."));
  assert.ok(!empty.includes('data-slot="value-cost-matrix"'));
  const filtered = view({ items: [], filtersActive: true });
  assert.ok(filtered.includes("Nessuno use case con questi filtri."));
  assert.match(filtered, new RegExp(`href="${BASE}\\?vista=panoramica&amp;mostra=matrice"[^>]*>Togli i filtri<`));
  // Le bolle senza le ipotesi di calcolo: la matrice, con il suo nome.
  const bubbles = view({ chart: "benefici", valueParams: null, items: [item({ customScores: HIGH, costEurOnce: 18_000 })] });
  assert.match(bubbles, /data-chart="matrice"/);
  assert.ok(bubbles.includes(">Matrice Valore × Costo</h2>") && !bubbles.includes("Facilità"));
});

test("«Curva del valore»: J-curve, «Valore per tipo di ritorno» e «Ipotesi di calcolo»; senza schede con un modello il vuoto dei filtri", () => {
  const approved = item({ valueModel: COUNTED });
  const plain = item({ customScores: HIGH, costEurOnce: 18_000 });
  const query = { vista: "panoramica", mostra: "curva" };
  const html = view({ chart: "curva", items: [approved, plain], planItems: [approved, plain], query, clearHref: `${BASE}?vista=panoramica&mostra=curva` });
  assert.match(html, /^<div data-slot="hub-chart" data-chart="curva"/);
  assert.ok(html.includes(">Curva del valore</h2>"));
  assert.ok(html.includes('aria-label="Curva del valore" data-slot="roadmap-value"'), "la sezione dei grafici");
  for (const slot of ["value-jcurve", "value-by-lever", "value-params-summary"]) assert.ok(html.includes(`data-slot="${slot}"`), slot);
  assert.ok(html.includes(`apri=${approved.id}`), "i segmenti aprono il pannello");
  assert.ok(!html.includes('data-slot="list-focus"'));
  const none = view({ chart: "curva", items: [plain], planItems: [approved, plain], query, filtersActive: true, clearHref: `${BASE}?vista=panoramica&mostra=curva` });
  assert.ok(none.includes('data-slot="chart-header"') && none.includes("Nessuno use case con questi filtri."));
  assert.match(none, new RegExp(`href="${BASE}\\?vista=panoramica&amp;mostra=curva"[^>]*>Togli i filtri<`));
  assert.ok(!none.includes('data-slot="roadmap-value"'));
});

test("i testi dei grafici passano la guardia delle parole", () => {
  assert.deepEqual(Object.keys(charts.CHART_TEXT), ["matrice", "benefici", "curva", "back", "emptyMatrixTitle", "emptyMatrixBody"]);
  assert.deepEqual(findHubForbiddenIn(Object.values(charts.CHART_TEXT), "area"), []);
  const header = renderToStaticMarkup(createElement(charts.ChartHeader, { title: charts.CHART_TEXT.curva, backHref: `${BASE}?vista=panoramica` }));
  assert.match(header, /^<div data-slot="chart-header" class="flex flex-wrap items-center gap-x-3 gap-y-2">/);
  assert.match(header, new RegExp(`<a [^>]*href="${BASE}\\?vista=panoramica"`));
  assert.ok(header.endsWith("<h2 class=\"text-base font-semibold\">Curva del valore</h2></div>"));
});
