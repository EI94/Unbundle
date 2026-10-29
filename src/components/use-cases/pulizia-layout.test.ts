import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { VALUE_COST_NOT_ESTIMATED_LABEL } from "../../lib/use-cases/labels.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// Le correzioni visive del rilascio «Pulizia», nei componenti dell'area: le viste in due colonne al
// telefono, la riga senza Valore né Costo, il costo del modello che non si spezza dentro un importo,
// le etichette dei punti vicini nella matrice.
let nav: typeof import("../dashboard/segmented-nav.tsx");
let row: typeof import("./use-case-row.tsx");
let cost: typeof import("./cost-figure.tsx");
let matrix: typeof import("./value-cost-matrix.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  nav = await import("../dashboard/segmented-nav.tsx");
  row = await import("./use-case-row.tsx");
  cost = await import("./cost-figure.tsx");
  matrix = await import("./value-cost-matrix.tsx");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const textOf = (html: string) => html.replace(/<[^>]+>/g, "");
const VIEWS = [
  { key: "panoramica", label: "Panoramica", href: "/h?vista=panoramica" },
  { key: "da-decidere", label: "Da decidere", count: 3, href: "/h?vista=da-decidere" },
  { key: "cosa-serve", label: "Cosa serve", href: "/h?vista=cosa-serve" },
];

test("le tre viste: al telefono una griglia di due colonne, tutte in vista, l'ultima sulla riga intera; da sm la riga di sempre", () => {
  const html = renderToStaticMarkup(createElement(nav.SegmentedNav, { items: VIEWS, active: "panoramica", ariaLabel: "Viste", gridOnPhone: true }));
  const ul = /<ul[^>]*class="([^"]*)"/.exec(html)?.[1].split(" ") ?? [];
  for (const cls of ["grid", "w-full", "grid-cols-2", "sm:inline-flex", "sm:w-auto"]) assert.ok(ul.includes(cls), cls);
  assert.ok(!ul.includes("inline-flex"), "al telefono non è una riga che scorre");
  // «Panoramica | Da decidere 3» sopra, «Cosa serve» sotto: una dispari in fondo prende la riga intera.
  assert.equal((html.match(/<li class="min-w-0 sm:shrink-0 last:odd:col-span-2">/g) ?? []).length, 3);
  assert.equal((html.match(/justify-center sm:justify-start/g) ?? []).length, 3);
  // Senza la scelta (il dossier, gli altri usi) resta com'era.
  const plain = renderToStaticMarkup(createElement(nav.SegmentedNav, { items: VIEWS, active: "panoramica", ariaLabel: "Viste" }));
  assert.match(plain, /<ul class="max-w-full gap-1 overflow-x-auto rounded-2xl border bg-muted\/60 p-1 \[scrollbar-width:none\] inline-flex">/);
  assert.ok(!plain.includes("grid-cols-2") && !plain.includes("justify-center"));
  // La pagina «Use case» la chiede quando le viste sono più di due.
  const hub = readFileSync(new URL("./hub.tsx", import.meta.url), "utf8");
  assert.ok(hub.includes("<SegmentedNav ariaLabel={HUB_TEXT.viewsLabel} active={view} items={navItems} gridOnPhone={navItems.length > 2} />"));
});

test("una riga senza Valore né Costo dice che cosa è da stimare", () => {
  assert.equal(VALUE_COST_NOT_ESTIMATED_LABEL, "Valore e costo: da stimare");
  const html = renderToStaticMarkup(createElement(row.RowFigures, { item: { value: null, cost: null } }));
  assert.equal(textOf(html), "Valore e costo: da stimare");
  assert.match(html, /data-figure="stima" data-estimated="true"/);
});

test("il costo del modello: mai spezzato dentro un importo; nel pannello una parte per riga", () => {
  const model = { source: "stima", amount: 22_200, band: 1, fromBand: false, runEurYear: 6_000 } as const;
  const inline = renderToStaticMarkup(createElement(cost.CostFigure, { cost: model, withLabel: true }));
  assert.equal(textOf(inline), "Costo: avvio 22.200 €\u00a0· ricorrenti 6.000 €/anno");
  for (const part of ["avvio 22.200 €", "ricorrenti 6.000 €/anno"]) assert.ok(inline.includes(`<span class="whitespace-nowrap">${part}</span>`), part);
  assert.ok(!inline.includes("data-cost-parts"), "in riga le due parti con « · »");
  // Nel pannello sempre una sotto l'altra.
  const panel = renderToStaticMarkup(createElement(cost.CostFigure, { cost: model, withLabel: true, stack: true }));
  assert.equal(textOf(panel), "Costo: avvio 22.200 €ricorrenti 6.000 €/anno");
  assert.ok(!panel.includes(" · "));
  // Una cifra di una parte sola non cambia.
  const single = renderToStaticMarkup(createElement(cost.CostFigure, { cost: { source: "team_importo", amount: 40_000, band: 2, fromBand: false }, stack: true }));
  assert.equal(textOf(single), "€€ · 40.000 €\u00a0· team");
  assert.ok(!single.includes("data-cost-parts"));
  assert.match(readFileSync(new URL("./use-case-panel.tsx", import.meta.url), "utf8"), /<CostFigure cost=\{item\.cost\} bands=\{bands\} withLabel stack \/>/);
});

test("matrice: due punti quasi nello stesso posto restano al loro costo e hanno un'etichetta sola con i due codici", () => {
  const value = { word: "basso", score: 2.5, source: "team", perYear: { amount: 12_250, source: "team" }, benefits: null } as const;
  const costOf = (amount: number) => ({ source: "team_importo", amount, band: 1, fromBand: false }) as const;
  const point = (id: string, code: string, x: number) => ({ id, code, title: code, origin: "transformation", approved: true, x, y: 2.5, value, cost: costOf(1000), href: `/h?apri=${id}` }) as const;
  // 1,1 e 1,17 sulla scala del costo: 12 % e 13,4 %, 1,4 punti percentuali (4 px su 320).
  const points = [point("aaaaaaaa-0000-4000-8000-000000000001", "TJ-0001", 1.1), point("aaaaaaaa-0000-4000-8000-000000000004", "TJ-0004", 1.17), point("aaaaaaaa-0000-4000-8000-000000000007", "TJ-0007", 3)];
  const html = renderToStaticMarkup(createElement(matrix.ValueCostMatrix, { points, highValue: 3.5, lowCostX: 1.5, toEstimate: [] }));
  const labels = [...html.matchAll(/data-slot="matrix-label"[^>]*>([^<]*)</g)].map((match) => match[1]);
  assert.deepEqual(labels, ["TJ-0001, TJ-0004", "TJ-0007"], "nessun codice sparisce");
  const left = (id: string) => Number(new RegExp(`left:([\\d.]+)%;top:[\\d.]+%"[^>]*><a[^>]*data-point="${id}"`).exec(html)?.[1]);
  assert.ok(Math.abs(left(points[0].id) - 12) < 0.01 && Math.abs(left(points[1].id) - 13.4) < 0.01, "le posizioni restano quelle del costo");
  // L'asse del Valore dice che è un punteggio: gli altri schermi scrivono gli euro.
  assert.ok(html.includes(">Valore (punteggio 1–5)<"));
  // Un titolo con l'agente: accanto al punto il tag delle card della Panoramica, non il codice.
  const tagged = [{ ...points[0], title: "LIBRA L1 · Lettura delle fatture estere" }, points[1], points[2]];
  const withAgent = renderToStaticMarkup(createElement(matrix.ValueCostMatrix, { points: tagged, highValue: 3.5, lowCostX: 1.5, toEstimate: [] }));
  assert.deepEqual([...withAgent.matchAll(/data-slot="matrix-label"[^>]*>([^<]*)</g)].map((match) => match[1]), ["LIBRA L1, TJ-0004", "TJ-0007"]);
});
