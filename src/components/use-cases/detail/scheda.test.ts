import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { enableTsxImports } from "./referent/tsx-test-loader.ts";
import { COST_BANDS } from "../../../lib/use-cases/cost-bands.ts";
import { GUIDED_TEXT, compactPathOf, impactView, pathOfUseCase, type GuidedItem, type RealizationAccount } from "../../../lib/use-cases/guided.ts";
import type { CostFigure, ValueFigure } from "../../../lib/use-cases/valuation.ts";

// (Rilascio 10, §3.4) La scheda dello use case in una colonna, resa in HTML senza database: «Valore» con una cifra sola
// (la stima del team, o il conto della realizzazione, D10), il percorso compatto, la testata con un solo «⋯», la riga
// «Cosa serve · N» e l'ordine della pagina. Dati inventati (codici XX-00NN).

let impactBlock: typeof import("./impact-block.tsx");
let pathDisclosure: typeof import("./path-disclosure.tsx");
let useCasePath: typeof import("./use-case-path.tsx");
let detailHeader: typeof import("./detail-header.tsx");
let sectionNeeds: typeof import("./section-needs.tsx");
let render: (element: unknown) => string;
let h: (type: unknown, props: unknown, ...children: unknown[]) => unknown;

/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: object, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

before(async () => {
  await enableTsxImports();
  // I pezzi della scheda importano le server action, che leggono la sessione e il database: qui al loro posto funzioni
  // con gli stessi nomi, che non si chiamano; nessuna sessione, nessun Firebase, nessun database.
  const stub = (source: string) => `data:text/javascript,${encodeURIComponent(source)}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "@/lib/auth") return { url: stub("export async function auth() { return null; }"), shortCircuit: true };
      const action = /^@\/lib\/actions\/([\w-]+)$/.exec(specifier);
      if (!action) return nextResolve(specifier, context);
      const source = readFileSync(new URL(`../../../lib/actions/${action[1]}.ts`, import.meta.url), "utf8");
      const names = [...source.matchAll(/^export (?:async )?function (\w+)/gm)].map((match) => match[1]);
      return { url: stub(names.map((name) => `export async function ${name}() { throw new Error("non in questa prova"); }`).join("\n")), shortCircuit: true };
    },
  });
  impactBlock = await import("./impact-block.tsx");
  pathDisclosure = await import("./path-disclosure.tsx");
  useCasePath = await import("./use-case-path.tsx");
  detailHeader = await import("./detail-header.tsx");
  sectionNeeds = await import("./section-needs.tsx");
  const react = await import("react");
  h = (type, props, ...children) => react.createElement(type as never, props as never, ...(children as never[]));
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: import("react").Context<object | null> };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  render = (element) => renderToStaticMarkup(h(AppRouterContext.Provider, { value: router }, element));
});

const WS = "6f1c2b3a-0000-4000-8000-0000000000aa";
const UC = "6f1c2b3a-0000-4000-8000-0000000000b1";
const PARAMS = { hourlyCostEur: 35, dayCostEur: 0, includeUnmeasured: false };
/** Il testo che si legge: senza tag, con gli spazi che non vanno a capo come spazi. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/ /g, " ").replace(/\s+/g, " ").trim();

const teamValue: ValueFigure = { score: 4, word: "alto", source: "team", perYear: { amount: 46_000, source: "team" }, benefits: { state: "contato", benefitEur: 46_000, pendingEur: 0, hours: 0 } };
const estimateCost: CostFigure = { source: "stima", amount: 30_000, band: 2, bandLabel: "da 25.000 a 65.000 €", fromBand: false, runEurYear: 0, position: 2, referenceEur: 30_000 };
const teamCost: CostFigure = { source: "team_importo", amount: 30_000, band: 2, bandLabel: "da 25.000 a 65.000 €", fromBand: false, position: 2, referenceEur: 30_000 };

function valore(value: ValueFigure | null, cost: CostFigure | null, over: { account?: RealizationAccount | null; canEdit?: boolean } = {}) {
  const view = impactView({ value, cost, valueModel: null, params: PARAMS, unofficial: false });
  return render(h(impactBlock.ImpactBlock, { view, value, cost, costBands: COST_BANDS, risks: [], canEdit: true, ...over }));
}

test("«Valore»: il numero grande, una riga con il costo, la sua fonte e il pareggio, una piega sola; «Modifica» apre la valutazione", () => {
  const html = valore(teamValue, estimateCost);
  assert.match(html, /^<section id="valore" aria-labelledby="valore-titolo" data-slot="valore" data-variant="B"/);
  assert.match(html, /data-slot="big-number-value"[^>]*>46\.000 €<\/p>/);
  assert.match(html, /data-slot="big-number-label"[^>]*>Valore all&#x27;anno<\/p>/);
  // La riga del prototipo: «Costo di realizzazione 30.000 € · stima del team · pareggio in 8 mesi».
  const line = text(/<p data-slot="valore-riga"[\s\S]*?<\/p>/.exec(html)?.[0] ?? "");
  assert.equal(line, "Costo 30.000 € · stima del team · pareggio in circa 8 mesi a regime");
  assert.match(html, /data-figure="costo" data-cost-source="stima"/);
  assert.equal(html.split("<details").length - 1, 0, "senza voci di «Benefici e costi» niente «Come si calcola»");
  // «Modifica» è un link della pagina alla piega «Valutazione del team», bordato di niente: mai pieno.
  const edit = /<a\b[^>]*data-action="valore-modifica"[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(edit, /href="#valutazione"/);
  assert.match(edit, /aria-label="Modifica la valutazione del team"/);
  assert.doesNotMatch(edit, /\bbg-primary\b/);
  // L'importo del team: «Costo di realizzazione», senza il simbolo della fascia.
  const team = text(/<p data-slot="valore-riga"[\s\S]*?<\/p>/.exec(valore({ ...teamValue, benefits: null }, teamCost))?.[0] ?? "");
  assert.equal(team, "Costo di realizzazione 30.000 € · importo del team");
  // Chi non modifica la valutazione non ha «Modifica».
  assert.doesNotMatch(valore(teamValue, estimateCost, { canEdit: false }), /valore-modifica/);
});

test("«Valore» (D10): con la realizzazione avviata la cifra, il costo e il pareggio sono il suo conto, senza «Modifica»", () => {
  const account: RealizationAccount = { benefit: "52.000 €", cost: "34.000 €", breakEven: "9 mesi", href: `/dashboard/${WS}/casi-duso/caso-1/valore` };
  const html = valore(teamValue, estimateCost, { account });
  assert.match(html, /data-variant="conto"/);
  assert.match(html, /data-figure="valore" data-source="dossier"/);
  assert.match(html, /data-slot="big-number-value"[^>]*>52\.000 €<\/p>/);
  assert.ok(!html.includes("46.000"), "lo stesso use case non ha due valori");
  assert.equal(text(/<p data-slot="valore-riga"[\s\S]*?<\/p>/.exec(html)?.[0] ?? ""), "Costo di realizzazione 34.000 € · dalla realizzazione · pareggio in 9 mesi");
  assert.doesNotMatch(html, /valore-modifica/, "la stima del team non cambia il conto");
  const how = /<details data-slot="impatto-come"[\s\S]*?<\/details>/.exec(html)?.[0] ?? "";
  assert.ok(text(how).includes(GUIDED_TEXT.impact.realizationAccount));
  assert.match(how, new RegExp(`href="/dashboard/${WS}/casi-duso/caso-1/valore"`), "la scheda «Valore» della realizzazione, per chi la apre");
  // Il conto ancora senza costo: «da calcolare»; chi non apre la realizzazione non ha il link.
  const partial = valore(teamValue, estimateCost, { account: { benefit: "52.000 €", cost: null, breakEven: null, href: null } });
  assert.equal(text(/<p data-slot="valore-riga"[\s\S]*?<\/p>/.exec(partial)?.[0] ?? ""), "Costo di realizzazione da calcolare · dalla realizzazione");
  assert.doesNotMatch(partial, /casi-duso/);
});

test("«Valore» da stimare: niente riga del costo da stimare né «Modifica»; c'è il link alla valutazione", () => {
  const html = valore(null, null);
  assert.match(html, /data-variant="G"/);
  assert.doesNotMatch(html, /data-slot="valore-riga"/);
  assert.doesNotMatch(html, /valore-modifica/);
  assert.match(html, /href="#valutazione"/);
});

const approved: GuidedItem = {
  id: UC,
  phase: "approvato",
  subState: "trimestre",
  kind: "da_costruire",
  phaseLabel: "Approvato · T4 2026",
  targetQuarter: "2026-Q4",
  reviewBy: null,
  waitingSince: "2026-10-26",
  realizedOn: null,
  value: { source: "team" },
  dossier: null,
};

test("il percorso compatto: una riga chiusa che si apre sui sei passi; l'ancora di «Quando» sta dentro", () => {
  const info = { state: "in_attesa" as const, received: 2, total: 5 };
  const path = pathOfUseCase({ item: approved, today: "2026-11-01", info, dossierRead: "ok" })!;
  const html = render(
    h(pathDisclosure.PathDisclosure, { compact: compactPathOf(path, info) }, h(useCasePath.UseCasePath, { path }), h("div", { id: "quando" }, "Quando")),
  );
  assert.match(html, /^<div id="percorso" data-slot="path-disclosure" data-arrival-host=""/);
  assert.match(html, /<button type="button" data-arrival-toggle="" aria-expanded="false" aria-controls="percorso-passi"/);
  assert.equal(text(html.slice(0, html.indexOf("</button>"))), "Passo 4 di 6 · Informazioni: 2 di 5 arrivate");
  assert.match(html, /<div id="percorso-passi" data-slot="path-steps" hidden=""/, "chiuso: i passi nell'HTML, nascosti");
  assert.equal((html.match(/aria-current="step"/g) ?? []).length, 1);
  assert.ok(html.indexOf('id="quando"') > html.indexOf('id="percorso-passi"'), "«Quando» dentro il percorso aperto");
});

test("la testata dei revisori: il tag, il codice, il titolo, un solo «⋯» e la pillola della fase; il contributore la sua", () => {
  const reviewer = render(
    h(detailHeader.DetailHeader, {
      workspaceId: WS,
      card: { id: UC, title: "Preventivi ai clienti", code: "XX-0024", phase: "approvato", subState: "trimestre", phaseLabel: "Approvato · T4 2026" },
      reviewer: { item: { id: UC, code: "XX-0024", version: 3, hiddenFromSearch: false }, canSetHidden: true, canRedact: true, redactOptions: [{ field: "titolo", label: "Titolo" }], decisions: null },
    }),
  );
  assert.equal(reviewer.split('aria-label="Altre azioni"').length - 1, 1, "un solo «⋯»");
  assert.ok(!reviewer.includes("Altre decisioni"));
  assert.match(reviewer, /data-slot="phase-pill"[^>]*>[\s\S]*?Approvato · T4 2026/);
  assert.ok(reviewer.indexOf("XX-0024") < reviewer.indexOf("<h1"), "codice sopra il titolo");
  assert.ok(reviewer.indexOf("<h1") < reviewer.indexOf('aria-label="Altre azioni"') && reviewer.indexOf('aria-label="Altre azioni"') < reviewer.indexOf('data-slot="phase-pill"'), "il «⋯» accanto al titolo, poi la pillola");
  const contributor = render(
    h(detailHeader.DetailHeader, { workspaceId: WS, card: { id: UC, title: "Preventivi ai clienti", code: null, phase: "approvato", subState: null, phaseLabel: "Approvato · T4 2026" } }),
  );
  assert.ok(contributor.includes('aria-label="Altre azioni"') && !contributor.includes("XX-0024"));
});

test("il «⋯» della testata: «Decisione» con le decisioni che non sono il passo, «Scheda» con «Visibile in azienda»", () => {
  const source = readFileSync(new URL("./detail-header.tsx", import.meta.url), "utf8");
  assert.match(source, /\{ label: t\.decisionGroup, items: decisions\.keys\.map\(\(key\) => \(\{ kind: "azione", label: DECISION_LABEL\[key\], onSelect: \(\) => openDialog\(key\) \}\)\) \}/);
  assert.match(source, /\{ label: t\.cardGroup, items: card \}/);
  // I permessi di oggi: «Visibile in azienda» a chi la cambia, «Oscura testo» a Lateral Space e a chi gestisce.
  assert.match(source, /canSet: reviewer\?\.canSetHidden === true/);
  assert.match(source, /if \(reviewer\.canRedact && reviewer\.redactOptions\.length\) cardItems\.push\(/);
  const visibility = readFileSync(new URL("./hide-from-search-item.tsx", import.meta.url), "utf8");
  assert.match(visibility, /kind: "interruttore",\n\s+label: GUIDED_TEXT\.scheda\.visible,\n\s+checked: visible,/);
  assert.match(visibility, /if \(!canSet\) return null;/);
  // Il riquadro del passo nella scheda non ha più il suo «⋯»: le decisioni stanno nella testata.
  const detail = readFileSync(new URL("./detail.tsx", import.meta.url), "utf8");
  assert.match(detail, /decisionsMenu=\{false\}/);
  assert.match(detail, /const menuKeys = menuDecisions\(decisionItem, \{ canDecide: abilities\.canDecide, primaryInStep: step\.action\.type === "decisione" && step\.decisions !== "none" \}\);/);
});

test("«Cosa serve · N»: una riga chiusa con le aperte, i gruppi prima quello che chiede di agire, e «Aggiungi ▾»", () => {
  const need = (id: string, title: string, status: string) => ({
    id,
    type: "requisito",
    kind: "dato",
    title,
    detail: null,
    ownerLabel: null,
    ownerSide: "cliente",
    status,
    availability: null,
    dueOn: null,
    dueLabel: null,
    dueIsProposal: false,
    forLabel: null,
    sortOrder: 1,
    version: 1,
    importKey: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    doneAt: null,
    archivedAt: null,
    archiveReason: null,
    useCaseIds: [UC],
  });
  const requirements = [
    need("7f000000-0000-4000-8000-000000000001", "Preventivi al mese", "in_verifica"),
    need("7f000000-0000-4000-8000-000000000002", "Chi controlla prima dell'invio", "in_verifica"),
    need("7f000000-0000-4000-8000-000000000003", "Come si preparano oggi", "chiesta"),
    need("7f000000-0000-4000-8000-000000000004", "Sconto massimo senza approvazione", "chiesta"),
    need("7f000000-0000-4000-8000-000000000005", "Un preventivo di esempio", "chiesta"),
  ];
  const linkable = [need("7f000000-0000-4000-8000-000000000009", "Listino dei prezzi", "da_chiedere")];
  const html = render(h(sectionNeeds.SectionNeeds, { workspaceId: WS, useCaseId: UC, requirements, steps: [], linkable: linkable.map((n) => ({ ...n, useCaseIds: [] })), refs: {}, today: "2026-11-01", canEdit: true }));
  assert.match(html, /^<section id="cosa-serve" data-slot="section-needs" data-arrival-host="" class="scroll-mt-20 rounded-xl border bg-card">/);
  assert.equal(text(html.slice(0, html.indexOf("</button>"))), "Cosa serve · 5 2 da verificare · 3 in attesa", "come nel prototipo");
  assert.match(html, /data-slot="needs-bar"/);
  assert.match(html, /<div id="cosa-serve-contenuto" data-slot="fold-content" hidden=""/, "chiusa");
  assert.equal((html.match(/data-need="/g) ?? []).length, 5, "le cinque in vista, una volta aperta");
  assert.match(html, /aria-haspopup="menu"[^>]*>Aggiungi<svg/, "«Aggiungi ▾»: aggiungere o collegare");
  assert.ok(!html.includes("informazioni ricevute"), "il conteggio delle arrivate sta nel percorso");
});

test("l'ordine della scheda: passo, percorso, nota quando serve, Valore, Come cambia il lavoro, Cosa serve, poi le pieghe", () => {
  const detail = readFileSync(new URL("./detail.tsx", import.meta.url), "utf8");
  const body = detail.slice(detail.indexOf("export function UseCaseDetailView("));
  const at = (needle: string) => {
    const index = body.indexOf(needle);
    assert.ok(index > 0, needle);
    return index;
  };
  const order = [
    "<DetailHeader",
    "<NextStepBox",
    "<PathDisclosure",
    "{noteInView ? publicNote : null}",
    "<ImpactBlock",
    "<WorkFlow",
    "<SectionNeeds",
    '<Fold id="valutazione"',
    '<Fold id="dettagli"',
    '<Fold id="contesto"',
    '<Fold id="realizzazione"',
    '<Fold id="storia"',
  ].map(at);
  assert.deepEqual([...order].sort((a, b) => a - b), order, "l'ordine di §3.4");
  // «Nota pubblica» fuori vista sta in «Dettagli»; «Quando» nel percorso; nessuna colonna di destra.
  assert.ok(at("{noteInView ? null : publicNote}") > at('<Fold id="dettagli"') && at("{noteInView ? null : publicNote}") < at('<Fold id="contesto"'));
  assert.ok(at('<div id="quando"') > at("<PathDisclosure") && at('<div id="quando"') < at("</PathDisclosure>"));
  assert.ok(!detail.includes("scheda-aside") && !detail.includes("scheda-grid"));
  // La scheda del contributore: la riga corta sugli use case di altri.
  assert.match(detail, /\{useCase\.own \? null : <p className="text-sm text-muted-foreground">\{othersDetailsNote\(teamName\)\}<\/p>\}/);
});
