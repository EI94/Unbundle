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
      { workspaceId: I.workspace, departmentId: board.unit.id, userId: I.user, initial: board },
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
  assert.match(html, /<span class="b-status" data-s="saved" role="status" aria-live="polite" tabindex="-1" data-b="pill"><span class="b-dot" aria-hidden="true"><\/span><span>Salvato 16\/11, 10:30<\/span><\/span>/);
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
  // Il pannello prende il fuoco senza entrare nel giro del Tab: è dove va chi lascia un campo con Escape.
  assert.match(html, /<section class="b-view b-on" role="tabpanel" id="b-panel-oggi" aria-labelledby="b-tab-oggi" tabindex="-1" data-b="view-oggi">.*?data-b="kpis"/);
  assert.match(html, /<section class="b-view" role="tabpanel" id="b-panel-classificazione" aria-labelledby="b-tab-classificazione" hidden="" tabindex="-1" data-b="view-classificazione"><\/section>/);
  assert.doesNotMatch(html, /slot-classificazione/);
  const classified = render(fixtureBoard({ classified: true }), { initialTab: "classificazione" });
  assert.match(classified, /<section class="b-view" role="tabpanel" id="b-panel-oggi" aria-labelledby="b-tab-oggi" hidden="" tabindex="-1" data-b="view-oggi"><\/section>/);
  assert.match(classified, /<section class="b-view b-on" role="tabpanel" id="b-panel-classificazione" aria-labelledby="b-tab-classificazione" tabindex="-1" data-b="view-classificazione"><p class="slot-classificazione">classificazione<\/p><\/section>/);
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
  assert.match(source, /<div className=\{cx\("b-scrim", "b-assist-scrim", overlay && "b-on"\)\} aria-hidden="true" onClick=\{close\}/);
  // Sopra la pagina è un dialogo modale (F2): il resto (app compresa) inerte tranne il velo, Escape sul documento, le due
  // guardie del Tab, il toast dentro il pannello (modal-panel.test.ts prova le funzioni).
  assert.match(source, /const restore = inertOthers\(element as unknown as InertNode, document\.body as unknown as InertNode, keep\);/);
  assert.match(source, /classList\?\.contains\("b-assist-scrim"\)/);
  assert.match(source, /document\.addEventListener\("keydown", onKeyDown\);/);
  assert.match(source, /if \(!closesOnEscape\(event, element\)\) return;/);
  assert.match(source, /useClaimToastHost\(panelToastHost, overlay\);/);
  assert.match(source, /\{overlay \? <BoardToastView host=\{panelToastHost\} \/> : null\}/);
  assert.equal(source.match(/data-focus-guard=""/g)?.length, 2);
  assert.match(source, /onFocus=\{\(\) => panel\.current && wrapFocus\(panel\.current, "start"\)\}/);
  assert.match(source, /onFocus=\{\(\) => panel\.current && wrapFocus\(panel\.current, "end"\)\}/);
  // «Inizia con l'assistente» apre il pannello con il cursore nel suo campo; chiuso, il fuoco torna al bottone.
  assert.match(source, /onStartAssistant=\{\(\) => setOpen\(true, "field"\)\}/);
  // Già aperto (un'unità vuota apre il pannello da sé): «Inizia con l'assistente» porta il cursore nel campo subito.
  assert.match(source, /if \(next === open\) \{\s+if \(focus === "field"\) focusTarget\(panel\.current\)\?\.focus\(\);\s+return;\s+\}/);
  assert.match(source, /if \(want === "field" && open\) focusTarget\(panel\.current\)\?\.focus\(\);/);
  assert.match(source, /if \(want === "toggle" && !open\) visibleOf\(headToggle\.current, tabToggle\.current\)\?\.focus\(\);/);
});

/**
 * Un pannello finto con gli elementi del compagno nell'ordine del documento, e `querySelector` come il browser: il primo
 * elemento che risponde a una delle parti del selettore. Basta per i selettori di `focusTarget`: un antenato di classe,
 * un tag, attributi con o senza valore, `:not(…)`.
 */
type FakeElement = { name: string; tag: string; inBody: boolean; attrs: Record<string, string> };
function fakePanel(elements: FakeElement[]) {
  const simple = (element: FakeElement, part: string): boolean => {
    const not = [...part.matchAll(/:not\(([^)]*)\)/g)].map((match) => match[1]);
    const rest = part.replace(/:not\([^)]*\)/g, "");
    const tag = /^[a-z]+/.exec(rest)?.[0];
    if (tag && element.tag !== tag) return false;
    for (const [, name, , value] of rest.matchAll(/\[([\w-]+)(=(["']?)([^"'\]]*)\3)?\]/g).map((m) => [m[0], m[1], m[2], m[4]] as const)) {
      if (!(name in element.attrs) || (value !== undefined && element.attrs[name] !== value)) return false;
    }
    return not.every((inner) => !simple(element, inner));
  };
  const matches = (element: FakeElement, selector: string) =>
    selector.split(/\s*,\s*/).some((part) => {
      const [ancestor, own] = part.includes(" ") ? [part.slice(0, part.lastIndexOf(" ")), part.slice(part.lastIndexOf(" ") + 1)] : [null, part];
      return (ancestor === null || (ancestor === ".b-assist-body" && element.inBody)) && simple(element, own);
    });
  return { querySelector: (selector: string) => elements.find((element) => matches(element, selector)) ?? null };
}

test("«Inizia con l'assistente» mette il cursore nel campo del compagno, non nella scelta dei file nascosta che sta prima", async () => {
  const { focusTarget } = await import("./unit-board.tsx");
  const close: FakeElement = { name: "chiudi", tag: "button", inBody: false, attrs: { type: "button" } };
  const files: FakeElement = { name: "file", tag: "input", inBody: true, attrs: { type: "file", hidden: "", "data-b": "companion-files" } };
  const upload: FakeElement = { name: "carica", tag: "button", inBody: true, attrs: { type: "button" } };
  const field: FakeElement = { name: "campo", tag: "textarea", inBody: true, attrs: { "data-b": "companion-input" } };
  const pick = (elements: FakeElement[]) => (focusTarget(fakePanel(elements) as never) as unknown as FakeElement | null)?.name ?? null;
  assert.equal(pick([close, files, upload, field]), "campo");
  // Mentre l'assistente risponde il campo è spento: il primo bottone del corpo, mai la scelta dei file.
  assert.equal(pick([close, files, upload, { ...field, attrs: { ...field.attrs, disabled: "" } }]), "carica");
  // Senza compagno, il primo campo visibile del corpo; senza niente, il primo bottone del pannello.
  assert.equal(pick([close, files, { name: "altro", tag: "input", inBody: true, attrs: { type: "text" } }]), "altro");
  assert.equal(pick([close]), "chiudi");
  assert.equal(focusTarget(null), null);
});

test("la vista che cambia mentre il fuoco non è da nessuna parte (il toast «Apri») prende il fuoco; non alla prima apertura", async () => {
  const { focusIsLost } = await import("./unit-board.tsx");
  const body = { closest: () => null };
  assert.equal(focusIsLost({ activeElement: null, body } as unknown as Document), true);
  assert.equal(focusIsLost({ activeElement: body, body } as unknown as Document), true);
  assert.equal(focusIsLost({ activeElement: { closest: (selector: string) => (selector === "[hidden]" ? {} : null) }, body } as unknown as Document), true, "nella vista appena nascosta");
  assert.equal(focusIsLost({ activeElement: { closest: () => null }, body } as unknown as Document), false);
  const source = readFileSync(new URL("./unit-board.tsx", import.meta.url), "utf8");
  assert.match(source, /if \(shownTab\.current === tab\) return;\s+shownTab\.current = tab;\s+if \(focusIsLost\(document\)\) document\.getElementById\(boardPanelId\(tab\)\)\?\.focus\(\{ preventScroll: true \}\);/);
});
