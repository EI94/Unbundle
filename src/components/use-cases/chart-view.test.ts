import test, { before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { agentPalette, agentToneOf } from "../../lib/use-cases/agents.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import type { ValuationModel } from "../../lib/use-cases/valuation.ts";
import { groupPalette } from "../../lib/use-cases/value-charts.ts";
import { DEFAULT_VALUE_PARAMS, valueModelSchema, type ValueParams } from "../../lib/use-cases/value-model.ts";
import { projectHubItem, type HubContext, type HubItem, type HubSourceRow } from "../../lib/use-cases/views.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// I grafici del menu «⋯» resi in HTML (rilascio «Panoramica»): «‹ Torna alla Panoramica» con il nome
// del grafico, la matrice con i due elenchi chiusi sotto («N da stimare», «N senza beneficio
// contato»), il vuoto e «Curva del valore». Dati sintetici.
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

test("matrice: sotto la legenda due elenchi chiusi; l'indirizzo apre il suo", () => {
  const one = { id: "11111111-0000-4000-8000-000000000001", code: "TJ-0003", title: "Bozza di registrazione", href: "/h?apri=11111111-0000-4000-8000-000000000001" };
  const off = { id: "22222222-0000-4000-8000-000000000002", code: null, title: "Meno errori nelle fatture", href: "/h?apri=22222222-0000-4000-8000-000000000002" };
  const html = renderToStaticMarkup(
    createElement(matrix.ValueCostMatrix, {
      points: [],
      highValue: 3.5,
      lowCostX: 2.5,
      toEstimate: [one],
      offMatrix: { label: "1 senza beneficio contato", items: [off] },
      open: "fuori-matrice",
    }),
  );
  const toEstimate = detailsTag(html, "to-estimate");
  assert.match(toEstimate, /^<details data-slot="to-estimate"/);
  assert.equal(isOpen(toEstimate), false, "chiuso: l'indirizzo chiede l'altro");
  const estimate = detailsOf(html, "to-estimate");
  assert.match(estimate, /<summary[^>]*>[\s\S]*1\u00a0da stimare<\/summary>/);
  const link = /<a [^>]*href="\/h\?apri=11111111-0000-4000-8000-000000000001"[^>]*>([\s\S]*?)<\/a>/.exec(estimate);
  assert.ok(link, "il link al pannello");
  assert.ok(link[1].includes("TJ-0003") && link[1].includes("Bozza di registrazione"), link[1]);
  assert.match(detailsTag(html, "off-matrix"), /^<details data-slot="off-matrix" open=""/);
  const offList = detailsOf(html, "off-matrix");
  assert.ok(offList.includes("1\u00a0senza beneficio contato") && offList.includes(">Meno errori nelle fatture<"), "senza codice, il titolo solo");
  // L'elenco che l'indirizzo apre viene in vista appena c'è (un vecchio link lo lasciava sotto la piega); l'altro no.
  assert.ok(offList.includes('<span hidden="" data-slot="reveal-on-mount"></span>'));
  assert.ok(!estimate.includes("reveal-on-mount"));
  // Gli elenchi stanno sotto la legenda, nella didascalia della matrice.
  assert.ok(html.indexOf('data-slot="matrix-legend"') < html.indexOf('data-slot="to-estimate"'));
  assert.ok(html.indexOf('data-slot="off-matrix"') < html.indexOf("</figcaption>"));

  // Senza «Benefici e costi» solo il primo; senza `open` chiuso.
  const only = renderToStaticMarkup(createElement(matrix.ValueCostMatrix, { points: [], highValue: 3.5, lowCostX: 2.5, toEstimate: [one] }));
  assert.equal(isOpen(detailsTag(only, "to-estimate")), false);
  assert.ok(!only.includes('data-slot="off-matrix"'));
  // Elenchi vuoti: niente.
  const none = renderToStaticMarkup(createElement(matrix.ValueCostMatrix, { points: [], highValue: 3.5, lowCostX: 2.5, toEstimate: [], offMatrix: null, open: "mancante" }));
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
  assert.match(estimate, /2\u00a0da stimare<\/summary>/);
  for (const card of [missingCost, missingValue]) {
    assert.ok(estimate.includes(`>${card.code}<`), card.code ?? "");
    assert.ok(estimate.includes(`href="${BASE}?vista=panoramica&amp;mostra=matrice&amp;origine=adoption&amp;stima=mancante&amp;apri=${card.id}"`), card.code ?? "");
  }
  assert.ok(!estimate.includes(`>${valued.code}<`) && !estimate.includes(`>${building.code}<`), "solo quelli senza un punto, mai chi è già partito");
  const off = detailsOf(html, "off-matrix");
  assert.equal(isOpen(detailsTag(html, "off-matrix")), false);
  assert.match(off, /1\u00a0senza beneficio contato<\/summary>/);
  assert.ok(off.includes(`>${qualitative.code}<`));
});

test("«Matrice Valore × Costo» con gli agenti nei titoli: i punti nel tono dell'agente, grigi senza, la legenda per agente", () => {
  const libra = item({ title: "LIBRA L1 · Lettura delle fatture estere", origin: "transformation", customScores: HIGH, costEurOnce: 18_000 });
  const deneb = item({ title: "DENEB D1 · Richieste di riposo e ferie", origin: "transformation", customScores: HIGH, costEurOnce: 4_000, ...TO_DECIDE });
  const plain = item({ title: "Strategia per volo", origin: "transformation", customScores: HIGH, costEurOnce: 40_000 });
  const proposal = item({ title: "IVA · Calcolo dell'imposta sui biglietti", customScores: HIGH, costEurOnce: 9_000, ...TO_DECIDE });
  const items = [libra, deneb, plain, proposal];
  // I toni del workspace: solo gli agenti della Panoramica (IVA ha solo una proposta).
  const agents = agentPalette([{ title: libra.title }, { title: "DENEB D2 · Turni" }, { title: "ORSA O1 · Voli" }]);
  const html = view({ items, agents });
  // Il pallino di un punto: il primo `<span>` dopo il suo link.
  const dotOf = (id: string) => {
    const start = html.indexOf(`data-point="${id}"`);
    return /<span aria-hidden="true" class="([^"]*)"/.exec(html.slice(start))?.[1] ?? "";
  };
  const tone = (agent: string) => agentToneOf(agents, agent);
  // Approvato: pieno nel tono del tag; da decidere: solo il bordo, nel tono; senza agente il grigio.
  assert.match(dotOf(libra.id), new RegExp(`\\bborder-uc-agente-${tone("LIBRA")}\\b.*\\bbg-uc-agente-${tone("LIBRA")}\\b`));
  assert.match(dotOf(deneb.id), new RegExp(`\\bborder-uc-agente-${tone("DENEB")}\\b.*\\bbg-background\\b`));
  assert.match(dotOf(plain.id), /\bborder-uc-serie-altro\b.*\bbg-uc-serie-altro\b/);
  assert.match(dotOf(proposal.id), /\bborder-uc-serie-altro\b.*\bbg-background\b/, "un agente senza tono: grigio");
  assert.ok(!/(?:bg|border)-(?:indigo|teal)-500/.test(html.slice(html.indexOf('data-slot="value-cost-matrix"'))), "nessun colore dell'origine");
  // La legenda: gli agenti dei punti, poi IVA, senza tono, in grigio con il suo nome, come nel filtro
  // «Agente», poi «Altri use case» (solo i titoli senza il prefisso); le fasi come prima, senza l'origine.
  const legendStart = html.indexOf(">", html.indexOf('data-slot="matrix-legend"')) + 1;
  const legend = html.slice(legendStart, html.indexOf("</p>", legendStart));
  const legendText = legend.replace(/<[^>]+>/g, "|").split("|").filter(Boolean);
  assert.deepEqual(legendText, ["DENEB", "LIBRA", "IVA", "Altri use case", "approvato", "da decidere"]);
  assert.ok(legend.includes(`bg-uc-agente-${tone("DENEB")}`) && legend.includes(`bg-uc-agente-${tone("LIBRA")}`) && legend.includes("bg-uc-serie-altro"));
  // Etichette, riquadri e nomi per i lettori di schermo restano quelli di prima.
  assert.ok(html.includes(`aria-label="${libra.code} ${libra.title}. Valore:`));
  assert.deepEqual([...html.matchAll(/data-slot="matrix-label"[^>]*>([^<]*)</g)].map((match) => match[1]).sort(), ["DENEB D1", "IVA", "LIBRA L1", plain.code].sort());
  // Senza agenti nei titoli: l'origine, come sempre.
  const byOrigin = view({ items, agents: agentPalette([{ title: "Strategia per volo" }]) });
  assert.ok(byOrigin.includes("bg-indigo-500") && byOrigin.includes("border-teal-500") && !byOrigin.includes("uc-agente"));
  assert.ok(byOrigin.includes(">AI Transformation<") && !byOrigin.includes("Altri use case"));
  assert.equal(view({ items }), byOrigin, "senza tavolozza come senza agenti");
});

test("con gli agenti nei titoli il grigio ha un nome solo: «Altri use case» nelle tre legende, nessun «Gruppo …» sui segni", () => {
  // TopJet con «TJ-0051» (29/10/2026): una copia senza il prefisso nel gruppo «Varie».
  const model = (group: string) => ({ ...COUNTED, group });
  const auto = item({ title: "AUTO X1 · Estratti conto in Echo", valueModel: model("Automazioni"), customScores: HIGH, costEurOnce: 4_000 });
  const libra = item({ title: "LIBRA L1 · Lettura delle fatture estere", valueModel: model("LIBRA"), customScores: HIGH, costEurOnce: 18_000 });
  const copy = item({ title: "Controllo dei preventivi dei fornitori di catering", valueModel: model("Varie"), customScores: HIGH, costEurOnce: 9_000 });
  const items = [auto, libra, copy];
  const agents = agentPalette([{ title: auto.title }, { title: libra.title }]);
  const palette = groupPalette(items, PARAMS, agents);
  const bubbles = view({ chart: "benefici", items, planItems: items, agents, palette, query: { vista: "panoramica", mostra: "benefici" } });
  const curve = view({ chart: "curva", items, planItems: items, agents, palette, query: { vista: "panoramica", mostra: "curva" } });
  const matrixHtml = view({ items, agents });
  /** Le voci di una legenda, dal suo attributo alla sua chiusura. */
  const legendOf = (html: string, at: string, end: string) => {
    const start = html.indexOf(">", html.indexOf(at)) + 1;
    return html.slice(start, html.indexOf(end, start));
  };
  const texts = (legend: string) => legend.replace(/<[^>]+>/g, "|").split("|").filter(Boolean);
  const legends = [
    legendOf(bubbles, 'data-slot="bubbles-legend"', "</p>"),
    legendOf(curve, "<figcaption", "</figcaption>"),
    legendOf(matrixHtml, 'data-slot="matrix-legend"', "</p>"),
  ];
  for (const legend of legends) {
    assert.ok(texts(legend).includes("Altri use case"), legend);
    assert.ok(legend.includes("bg-uc-serie-altro"), "il grigio");
  }
  assert.deepEqual(texts(legends[0]).slice(0, 3), ["AUTO", "LIBRA", "Altri use case"]);
  // La bolla e il segmento grigi non dicono il loro colore, come il punto della matrice: lo dice la legenda.
  assert.ok(bubbles.includes(`aria-label="${copy.code} ${copy.title}. Facilità 4 · 4.043 €/anno · avvio 560 € · ricorrenti 600 €/anno · questo trimestre"`), "bolla");
  assert.ok(curve.includes(`aria-label="${copy.code} ${copy.title}: 4.043 € all&#x27;anno · Risparmio di tempo"`), "segmento");
  assert.ok(bubbles.includes(`aria-label="${auto.code} ${auto.title}. Facilità 4 · 4.043 €/anno · avvio 560 € · ricorrenti 600 €/anno · questo trimestre"`), "nemmeno «· AUTO»");
  for (const html of [bubbles, curve]) {
    for (const text of ["Altri gruppi", "Gruppo ", "Senza gruppo"]) assert.ok(!html.includes(text), text);
  }
  // Senza agenti nei titoli: i nomi dei gruppi, come sempre.
  const plain = agentPalette([{ title: "Strategia per volo" }]);
  const byGroup = view({ chart: "benefici", items, planItems: items, agents: plain, query: { vista: "panoramica", mostra: "benefici" } });
  assert.ok(byGroup.includes("· Gruppo Varie") && !byGroup.includes("Altri use case"));
});

test("«Matrice Facilità × Beneficio» e «Curva del valore» con gli agenti nei titoli: ogni segno nel tono dell'agente del suo titolo, come la matrice", () => {
  // TopJet (29/10/2026): una copia approvata di un ORSA senza il prefisso, nel gruppo «ORSA».
  const model = (group?: string) => ({ ...COUNTED, group });
  const orsa = item({ title: "ORSA O1 · Voli pieni, vuoti ed empty leg", valueModel: model("ORSA"), customScores: HIGH, costEurOnce: 18_000 });
  const copy = item({ title: "Controllo dei preventivi dei fornitori di catering", valueModel: model("ORSA"), customScores: HIGH, costEurOnce: 18_000 });
  const libra = item({ title: "LIBRA L1 · Lettura delle fatture estere", valueModel: model("Operazioni"), customScores: HIGH, costEurOnce: 4_000 });
  const proposal = item({ title: "IVA · Calcolo dell'imposta sui biglietti", valueModel: model(), customScores: HIGH, costEurOnce: 9_000, ...TO_DECIDE });
  const items = [orsa, copy, libra, proposal];
  const agents = agentPalette([{ title: orsa.title }, { title: libra.title }, { title: "SIRIO S1 · Cassa" }]);
  const tone = (agent: string) => agentToneOf(agents, agent);
  // Senza `palette`: anche le bolle e la curva leggono gli agenti, come la matrice.
  const bubbles = view({ chart: "benefici", items, planItems: items, agents, query: { vista: "panoramica", mostra: "benefici" } });
  const curve = view({ chart: "curva", items, planItems: items, agents, query: { vista: "panoramica", mostra: "curva" } });
  const matrixHtml = view({ items, agents });
  /** Le classi del segno: il `<span>` colorato dopo il link della bolla o del punto, il `<button>` del segmento. */
  const classesAfter = (html: string, marker: string) => {
    const from = marker.startsWith("data-segment") ? html.lastIndexOf("<button", html.indexOf(marker)) : html.indexOf(marker);
    return /<(?:span|button) [^>]*class="([^"]*(?:uc-agente|uc-serie)[^"]*)"/.exec(html.slice(from))?.[1] ?? "";
  };
  const toneIn = (classes: string) => /uc-agente-(\d+)/.exec(classes)?.[1] ?? (/uc-serie-altro/.test(classes) ? "grigio" : "?");
  const expected = { [orsa.id]: String(tone("ORSA")), [copy.id]: "grigio", [libra.id]: String(tone("LIBRA")), [proposal.id]: "grigio" };
  for (const it of items) {
    assert.equal(toneIn(classesAfter(bubbles, `data-bubble="${it.id}"`)), expected[it.id], `bolla ${it.title}`);
    assert.equal(toneIn(classesAfter(matrixHtml, `data-point="${it.id}"`)), expected[it.id], `punto ${it.title}`);
    if (it !== proposal) assert.equal(toneIn(classesAfter(curve, `data-segment="${it.id}"`)), expected[it.id], `segmento ${it.title}`);
  }
  // Nessun «Gruppo …» né il nome dell'agente in coda: l'agente è nel titolo.
  assert.ok(bubbles.includes(`aria-label="${orsa.code} ${orsa.title}. Facilità 4 · 4.043 €/anno · avvio 560 € · ricorrenti 600 €/anno · questo trimestre"`), "bolla");
  assert.ok(bubbles.includes(`aria-label="${copy.code} ${copy.title}. Facilità 4 · 4.043 €/anno · avvio 560 € · ricorrenti 600 €/anno · questo trimestre"`), "la copia senza prefisso");
  assert.ok(curve.includes(`aria-label="${copy.code} ${copy.title}: 4.043 € all&#x27;anno · Risparmio di tempo"`), "segmento");
  assert.ok(!/Gruppo (?:ORSA|Operazioni)|· ORSA"/.test(bubbles + curve));
  // Le legende: gli agenti dei segni, IVA (senza tono) con il suo nome, poi «Altri use case», come la matrice.
  const legendOf = (html: string, at: string) => {
    const start = html.indexOf(">", html.indexOf(at)) + 1;
    return html.slice(start, html.indexOf(/^<figcaption/.test(at) ? "</figcaption>" : "</p>", start)).replace(/<[^>]+>/g, "|").split("|").filter(Boolean);
  };
  assert.deepEqual(legendOf(bubbles, 'data-slot="bubbles-legend"').slice(0, 4), ["LIBRA", "ORSA", "IVA", "Altri use case"]);
  assert.deepEqual(legendOf(curve, "<figcaption").slice(0, 3), ["LIBRA", "ORSA", "Altri use case"]);
  // Senza agenti nei titoli: i colori e i nomi dei gruppi, come sempre.
  const plain = agentPalette([{ title: "Strategia per volo" }]);
  const byGroup = view({ chart: "benefici", items, planItems: items, agents: plain, query: { vista: "panoramica", mostra: "benefici" } });
  assert.ok(byGroup.includes("Gruppo ORSA") && byGroup.includes("bg-uc-serie-1") && !byGroup.includes("uc-agente"));
  assert.equal(view({ chart: "benefici", items, planItems: items, query: { vista: "panoramica", mostra: "benefici" } }), byGroup, "senza tavolozza come senza agenti");
});

test("i vuoti dei grafici: «Nessuno use case da mettere in ordine», o «Togli i filtri» che tiene il grafico", () => {
  const empty = view({ items: [item({ customScores: HIGH, status: "in_progress" })] });
  assert.ok(empty.includes('data-slot="chart-header"') && empty.includes("Nessuno use case da mettere in ordine") && empty.includes("Valuta Valore e Costo in «Da\u00a0decidere»."));
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
