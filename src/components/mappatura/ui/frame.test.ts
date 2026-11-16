import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";

// La cornice della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.9; P1–P3, P6, P7, P70–P75, P85): la testata con il
// marchio e la pillola, il titolo con il corsivo, le schede con il numero d'ordine e le frecce, la testa della vista.
// Markup statico, come lo disegna il server.

await enableTsxImports();
const { Block, BoardBrand, BoardHeader, BoardMain, BoardTabs, BoardTitle, StatusPill, ViewHead, boardPanelId, boardTabId, tabAfterKey, tabOrdinal } = await import("./frame.tsx");

const html = (element: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(element);
/** `createElement` con i figli dopo le props: il tipo di React li vuole tra le props quando un componente li chiede. */
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
const TABS = [
  { id: "oggi", label: "Processi di oggi" },
  { id: "classificazione", label: "Classificazione" },
] as const;

test("la testata: il marchio con la pillola a destra, il titolo con il corsivo, le schede; nell'ordine del riferimento", () => {
  const out = html(
    h(BoardHeader, {
      brand: h(BoardBrand, { workspaceName: "Officina di prova", areaHref: "/dashboard/ws/mapping" }),
      title: h(BoardTitle, { plain: "Ufficio acquisti", accent: "board" }),
      aside: h(StatusPill, { state: "saved", savedAt: null }),
      tabs: createElement(BoardTabs, { label: "Sezioni della board", tabs: TABS, selected: "oggi", onSelect() {} }),
    }),
  );
  assert.match(out, /^<header class="b-top" data-b="header"><div class="b-wrap"><div class="b-shell"><div class="b-top-in">/);
  const at = (needle: string) => out.indexOf(needle);
  assert.ok(at('data-b="brand"') < at('class="b-spacer"') && at('class="b-spacer"') < at('class="b-top-aside"') && at('class="b-top-aside"') < at('data-b="pill"'));
  assert.ok(at('data-b="pill"') < at('<h1 class="b-title"') && at('<h1 class="b-title"') < at('role="tablist"'), "marchio e pillola, poi il titolo, poi le schede");
  assert.match(out, /<h1 class="b-title" style="margin-top:8px"><span data-b="title">Ufficio acquisti <i>board<\/i><\/span><\/h1>/);
  // Senza `aside` e senza schede (l'elenco delle unità): niente pillola, niente schede, e lo spazio della loro riga sotto
  // il titolo (b-notabs), così il serif non tocca la riga della testata.
  const bare = html(h(BoardHeader, { brand: "marchio", title: "titolo" }));
  assert.doesNotMatch(bare, /b-top-aside|tablist/);
  assert.match(bare, /^<header class="b-top b-notabs" data-b="header">/);
  const css = readFileSync(new URL("../board.css", import.meta.url), "utf8");
  assert.match(css, /@media \(min-width: 48rem\) \{\s*\[data-board-root\] \.b-top\.b-notabs \.b-title \{ padding-bottom: 12px; \}/);
});

test("il marchio: il segno, «lateral space», ×, il workspace, · e l'etichetta che porta all'elenco delle unità", () => {
  const out = html(h(BoardBrand, { workspaceName: "  Officina di prova ", areaHref: "/dashboard/ws/mapping" }));
  assert.match(out, /^<div class="b-brand" data-b="brand"><svg width="22" height="12" viewBox="0 0 24 12" aria-hidden="true" focusable="false">/);
  assert.match(out, /<b>lateral <span class="b-mute">space<\/span><\/b><span class="b-x" aria-hidden="true">×<\/span><span>Officina di prova<\/span><span class="b-x" aria-hidden="true">·<\/span><a href="\/dashboard\/ws\/mapping">Activity mapping<\/a>/);
  // Il nome del link è la sua etichetta (il titolo della pagina dove porta): nessuna aria-label che dica altro.
  assert.doesNotMatch(out, /aria-label/);
  // Senza nome del workspace (la cornice di caricamento) niente «×».
  const loading = html(h(BoardBrand, { workspaceName: "", areaHref: "/dashboard/ws/mapping" }));
  assert.doesNotMatch(loading, /×/);
  assert.match(loading, /·<\/span><a href/);
});

test("il titolo: la parte in corsivo dopo il resto, o prima", () => {
  assert.equal(html(h(BoardTitle, { plain: "Activity", accent: "mapping" })), '<span data-b="title">Activity <i>mapping</i></span>');
  assert.equal(html(h(BoardTitle, { plain: "per tutte", accent: "Due parole", accentFirst: true })), '<span data-b="title"><i>Due parole</i> per tutte</span>');
});

test("le schede: tablist con la sua etichetta, numero d'ordine su due cifre, aria-selected e aria-controls, nessun conteggio", () => {
  const out = html(createElement(BoardTabs, { label: "Sezioni della board", tabs: TABS, selected: "classificazione", onSelect() {} }));
  assert.match(out, /<div class="b-tabs" role="tablist" aria-label="Sezioni della board">/);
  const tabs = [...out.matchAll(/<button type="button" role="tab" id="([^"]+)" class="b-tab" data-tab="([^"]+)" aria-selected="(true|false)" aria-controls="([^"]+)" tabindex="(-?\d)">(.*?)<\/button>/g)];
  assert.equal(tabs.length, 2);
  assert.deepEqual(
    tabs.map(([, id, tab, selected, controls, index, inner]) => [id, tab, selected, controls, index, inner]),
    [
      [boardTabId("oggi"), "oggi", "false", boardPanelId("oggi"), "-1", '<span class="b-n" aria-hidden="true">01</span>Processi di oggi'],
      [boardTabId("classificazione"), "classificazione", "true", boardPanelId("classificazione"), "0", '<span class="b-n" aria-hidden="true">02</span>Classificazione'],
    ],
  );
  assert.deepEqual([boardTabId("oggi"), boardPanelId("oggi"), tabOrdinal(0), tabOrdinal(9)], ["b-tab-oggi", "b-panel-oggi", "01", "10"]);
  // Un id che sembra un colore esadecimale lo conterebbe il censimento dei colori: questi no.
  assert.doesNotMatch(`#${boardTabId("oggi")} #${boardPanelId("classificazione")}`, /#[0-9a-f]{3}\b|#[0-9a-f]{6}\b/i);
  // Sul telefono, a destra della riga: la pillola a punto e il bottone dell'assistente.
  assert.match(html(createElement(BoardTabs, { label: "Sezioni della board", tabs: [TABS[0]], selected: "oggi", onSelect() {}, aside: "accanto" })), /<div class="b-tabs-aside">accanto<\/div>/);
});

test("le frecce sulle schede: la vicina, con il giro in fondo; Home e End; gli altri tasti niente", () => {
  const ids = ["oggi", "classificazione"] as const;
  assert.equal(tabAfterKey(ids, "oggi", "ArrowRight"), "classificazione");
  assert.equal(tabAfterKey(ids, "classificazione", "ArrowRight"), "oggi", "giro in fondo");
  assert.equal(tabAfterKey(ids, "oggi", "ArrowLeft"), "classificazione", "giro all'inizio");
  assert.equal(tabAfterKey(["a", "b", "c"], "b", "Home"), "a");
  assert.equal(tabAfterKey(["a", "b", "c"], "a", "End"), "c");
  assert.equal(tabAfterKey(ids, "oggi", "Enter"), null);
  assert.equal(tabAfterKey(ids, "oggi", "ArrowDown"), null);
});

test("la pillola: la scritta di ogni stato, una regione viva educata, «Salva ora» solo con modifiche da salvare", () => {
  const savedAt = "2026-11-16T09:30:00.000Z"; // 10:30 a Roma
  const cases = [
    ["loading", null, "Caricamento"],
    ["saved", savedAt, "Salvato 16/11, 10:30"],
    ["saved", null, "Pronto"],
    ["dirty", savedAt, "Modifiche da salvare"],
    ["saving", savedAt, "Salvataggio…"],
    ["readonly", savedAt, "Sola lettura"],
    ["local", savedAt, "Modifiche solo su questo dispositivo"],
  ] as const;
  for (const [state, at, text] of cases) {
    const out = html(h(StatusPill, { state, savedAt: at, onSaveNow() {} }));
    // Con «Salva ora» la pillola prende il fuoco quando il bottone sparisce (tabindex -1: fuori dal giro del Tab).
    assert.ok(
      out.startsWith(`<span class="b-status" data-s="${state}" role="status" aria-live="polite" tabindex="-1" data-b="pill"><span class="b-dot" aria-hidden="true"></span><span>${text}</span></span>`),
      `${state}: ${out}`,
    );
    assert.equal(out.includes("Salva ora"), state === "dirty", `${state}: «Salva ora»`);
  }
  assert.match(html(h(StatusPill, { state: "dirty", savedAt: null, onSaveNow() {} })), /<button type="button" class="b-btn b-small" data-b="save-now">Salva ora<\/button>$/);
  assert.doesNotMatch(html(h(StatusPill, { state: "dirty", savedAt: null })), /Salva ora|tabindex/, "senza onSaveNow niente bottone, e la pillola non prende il fuoco");
  // «Salva ora» sparisce appena il salvataggio parte: prima il fuoco va alla pillola, se era sul bottone (F1).
  assert.match(readFileSync(new URL("./frame.tsx", import.meta.url), "utf8"), /if \(event\.currentTarget\.ownerDocument\.activeElement === event\.currentTarget\) pill\.current\?\.focus\(\{ preventScroll: true \}\);\s+p\.onSaveNow\?\.\(\);/);
  // Compatta (la riga delle schede sul telefono): solo il punto; la scritta resta per gli screen reader.
  const compact = html(h(StatusPill, { state: "dirty", savedAt: null, compact: true, onSaveNow() {} }));
  assert.equal(compact, '<span class="b-status b-compact" data-s="dirty" role="status" aria-live="polite" data-b="pill"><span class="b-dot" aria-hidden="true"></span><span class="b-sr">Modifiche da salvare</span></span>');
});

test("l'area della board, la testa della vista e i blocchi", () => {
  assert.equal(html(h(BoardMain, null, "vista")), '<div class="b-main" data-b="main"><div class="b-wrap"><div class="b-shell">vista</div></div></div>');
  const head = html(h(ViewHead, { eyebrow: "Processi di oggi", title: h(BoardTitle, { plain: "Come lavora oggi", accent: "l'ufficio" }), lede: "Una frase.", action: "azione" }));
  assert.equal(
    head,
    '<div class="b-head" data-b="view-head"><div><p class="b-eyebrow">Processi di oggi</p><h2 class="b-h"><span data-b="title">Come lavora oggi <i>l&#x27;ufficio</i></span></h2><p class="b-lede">Una frase.</p></div><div class="b-head-action">azione</div></div>',
  );
  assert.doesNotMatch(html(h(ViewHead, { eyebrow: "Classificazione", title: "Titolo" })), /b-lede|b-head-action/);
  assert.equal(html(h(Block, { title: "I processi, uno per uno", hint: "clicca un passo" }, "mappa")), '<div class="b-block" data-b="block"><h3 class="b-sh">I processi, uno per uno<small>clicca un passo</small></h3>mappa</div>');
  assert.equal(html(h(Block, null, "solo")), '<div class="b-block" data-b="block">solo</div>');
});
