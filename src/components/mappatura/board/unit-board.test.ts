import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import type { MappingBoard } from "../../../lib/mappatura/board-model.ts";

// La board di un'unità (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3–§1.5; P1–P7, P70–P71, P79, P85): la testata con
// il marchio, la pillola, «Assistente», il titolo e le schede; una vista per volta, legata alla sua scheda; il pannello
// dell'assistente con lo slot del compagno, aperto o chiuso; sul telefono la riga delle schede con la pillola a punto e
// il bottone dell'assistente. Markup statico, com'è al primo disegno; il comportamento nel browser si legge dal sorgente.

await enableTsxImports();
const { UnitBoard } = await import("./unit-board.tsx");
const { BoardProvider } = await import("../store/use-board.tsx");
const { BoardButton } = await import("../ui/atoms.tsx");

const I = FIXTURE_IDS;
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);

function render(board: MappingBoard, extra: { assistantDefaultOpen?: boolean; initialTab?: "oggi" | "classificazione" } = {}) {
  return renderToStaticMarkup(
    h(
      BoardProvider,
      { workspaceId: I.workspace, departmentId: board.unit.id, initial: board },
      h(UnitBoard, {
        workspaceId: I.workspace,
        workspaceName: "Officina di prova",
        unitTerm: { singular: "reparto", plural: "reparti" },
        assistantDefaultOpen: extra.assistantDefaultOpen ?? false,
        assistant: createElement("p", { className: "slot-assistente" }, "conversazione"),
        classification: createElement("p", { className: "slot-classificazione" }, "classificazione"),
        headAction: h(BoardButton, { variant: "primary" }, "Completa la mappatura"),
        initialTab: extra.initialTab,
      }),
    ),
  );
}

test("la testata: il marchio con il link all'elenco, la pillola, «Assistente», il titolo «{unità} board», le schede (P1–P3, P70)", () => {
  const html = render(fixtureBoard());
  assert.match(html, /<header class="b-top" data-b="header">/);
  assert.match(html, /<div class="b-brand" data-b="brand">.*?lateral <span class="b-mute">space<\/span><\/b><span class="b-x" aria-hidden="true">×<\/span><span>Officina di prova<\/span><span class="b-x" aria-hidden="true">·<\/span><a href="\/dashboard\/[^/]+\/mapping">Activity mapping<\/a><\/div>/);
  assert.match(html, /<span class="b-status" data-s="saved" role="status" aria-live="polite" data-b="pill"><span class="b-dot" aria-hidden="true"><\/span><span>Salvato 16\/11, 10:30<\/span><\/span>/);
  assert.doesNotMatch(html, /data-b="save-now"/, "«Salva ora» solo con modifiche da salvare");
  const toggle = html.match(/<button type="button" class="b-btn b-hide-phone b-assist-toggle" aria-expanded="false" aria-controls="([^"]+)" data-b="assistant-toggle">Assistente<\/button>/);
  assert.ok(toggle, "il bottone dell'assistente, contornato");
  assert.match(html, new RegExp(`<aside id="${toggle![1].replace(/[^\w-]/g, "\\$&")}" class="b-assist" hidden=""`), "il bottone controlla il pannello");
  assert.match(html, /<h1 class="b-title" style="margin-top:8px"><span data-b="title">Ufficio acquisti <i>board<\/i><\/span><\/h1>/);
  // Le schede: il numero d'ordine, nessun conteggio; la scelta ha aria-selected e il suo pannello.
  assert.match(html, /<div class="b-tabs" role="tablist" aria-label="Sezioni della board">/);
  const tabs = [...html.matchAll(/<button type="button" role="tab" id="([^"]+)" class="b-tab" data-tab="(\w+)" aria-selected="(\w+)" aria-controls="([^"]+)" tabindex="(-?\d)"><span class="b-n" aria-hidden="true">(\d\d)<\/span>([^<]+)<\/button>/g)].map((match) => match.slice(1));
  assert.deepEqual(tabs, [
    ["b-tab-oggi", "oggi", "true", "b-panel-oggi", "0", "01", "Processi di oggi"],
    ["b-tab-classificazione", "classificazione", "false", "b-panel-classificazione", "-1", "02", "Classificazione"],
  ]);
});

test("una vista per volta, legata alla sua scheda: «Processi di oggi» per default, «Classificazione» con lo slot del compagno (P4, P6)", () => {
  const html = render(fixtureBoard());
  assert.match(html, /<section class="b-view b-on" role="tabpanel" id="b-panel-oggi" aria-labelledby="b-tab-oggi" data-b="view-oggi">.*?data-b="kpis"/);
  assert.match(html, /<section class="b-view" role="tabpanel" id="b-panel-classificazione" aria-labelledby="b-tab-classificazione" hidden="" data-b="view-classificazione"><\/section>/);
  assert.doesNotMatch(html, /slot-classificazione/);
  const classified = render(fixtureBoard({ classified: true }), { initialTab: "classificazione" });
  assert.match(classified, /<section class="b-view" role="tabpanel" id="b-panel-oggi" aria-labelledby="b-tab-oggi" hidden="" data-b="view-oggi"><\/section>/);
  assert.match(classified, /<section class="b-view b-on" role="tabpanel" id="b-panel-classificazione" aria-labelledby="b-tab-classificazione" data-b="view-classificazione"><p class="slot-classificazione">classificazione<\/p><\/section>/);
  assert.match(classified, /data-tab="classificazione" aria-selected="true"/);
});

test("il pannello dell'assistente: lo slot del compagno sotto «Assistente» e «Chiudi»; chiuso resta montato; aperto da solo quando la pagina lo chiede", () => {
  const closed = render(fixtureBoard());
  assert.match(closed, /<aside id="[^"]+" class="b-assist" hidden="" role="complementary" aria-labelledby="([^"]+)" data-b="assistant"><div class="b-assist-head"><h2 class="b-assist-t" id="\1">Assistente<\/h2><button type="button" class="b-btn b-x" data-b="assistant-close">Chiudi<\/button><\/div><div class="b-assist-body"><p class="slot-assistente">conversazione<\/p><\/div><\/aside>/);
  assert.match(closed, /data-b="board" data-assistant="closed"|class="b-board" data-assistant="closed"/);
  const open = render(fixtureBoard({ empty: true }), { assistantDefaultOpen: true });
  assert.match(open, /<aside id="[^"]+" class="b-assist" role="complementary"/);
  assert.doesNotMatch(open, /class="b-assist" hidden=""/);
  assert.match(open, /aria-expanded="true"/);
  assert.match(open, /<div class="b-board" data-assistant="open" data-b="board">/);
  // Il velo dell'assistente c'è, spento: si accende solo sopra la pagina, sotto i 1280 px.
  assert.match(open, /<div class="b-scrim b-assist-scrim" aria-hidden="true" data-b="assistant-scrim"><\/div>/);
  // Il toast della board in fondo alla pagina.
  assert.match(open, /<div class="b-toast" role="status" aria-live="polite" data-b="toast"><\/div>$/);
});

test("sul telefono: la riga delle schede con la pillola a punto (per gli occhi) e il bottone dell'assistente (P79)", () => {
  const html = render(fixtureBoard());
  assert.match(
    html,
    /<div class="b-tabs-aside"><span class="b-tabs-pill" aria-hidden="true"><span class="b-status b-compact" data-s="saved" role="status" aria-live="polite" data-b="pill"><span class="b-dot" aria-hidden="true"><\/span><span class="b-sr">Salvato 16\/11, 10:30<\/span><\/span><\/span><button type="button" class="b-iconbtn" aria-label="Assistente" title="Assistente" aria-expanded="false" aria-controls="[^"]+">/,
  );
});

test("nel browser: la scheda scelta porta in cima e si ricorda; il pannello sopra la pagina la rende inerte e si chiude con Escape e il velo", () => {
  const source = readFileSync(new URL("./unit-board.tsx", import.meta.url), "utf8");
  // La scheda viene dalle preferenze (l'ancora, poi quella ricordata) e sceglierla la ricorda e porta in cima.
  assert.match(source, /useSyncExternalStore\(prefs\.subscribe, \(\) => prefs\.tab\(departmentId, fallbackTab\), \(\) => fallbackTab\)/);
  assert.match(source, /prefs\.selectTab\(departmentId, next\);\s+window\.scrollTo\(\{ top: 0 \}\);/);
  assert.match(source, /window\.addEventListener\("hashchange", top\)/);
  // Il pannello: la scelta della visita, il default della pagina, la preferenza del dispositivo; sopra la pagina sotto i 1280 px.
  assert.match(source, /const open = choice \?\? \(p\.assistantDefaultOpen \|\| remembered === true\);/);
  assert.match(source, /const overlay = open && !wide;/);
  assert.match(source, /<div className="b-board-col" inert=\{overlay \|\| undefined\}>/);
  assert.match(source, /if \(event\.key === "Escape" && overlay && !event\.defaultPrevented\)/);
  assert.match(source, /<div className=\{cx\("b-scrim", "b-assist-scrim", overlay && "b-on"\)\} aria-hidden="true" onClick=\{close\}/);
  // «Inizia con l'assistente» apre il pannello con il cursore nel suo campo; chiuso, il fuoco torna al bottone.
  assert.match(source, /onStartAssistant=\{\(\) => setOpen\(true, "field"\)\}/);
  assert.match(source, /if \(want === "field" && open\) focusTarget\(panel\.current\)\?\.focus\(\);/);
  assert.match(source, /if \(want === "toggle" && !open\) visibleOf\(headToggle\.current, tabToggle\.current\)\?\.focus\(\);/);
});
