import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";

// La board che si apre (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.6): la testata ha la forma di quella vera (la riga
// del marchio con la pillola e il bottone dell'assistente, il titolo, la riga delle schede), così la pagina non salta
// quando arriva la board. Schede e bottoni ci sono ma non si usano ancora. Markup statico, come lo disegna il server.

await enableTsxImports();
const { BoardLoadingHeader } = await import("./loading-header.tsx");
const { BoardProvider } = await import("../store/use-board.tsx");
const { UnitBoard } = await import("./unit-board.tsx");

const I = FIXTURE_IDS;
/** `createElement` con i figli dopo le props: il tipo di React li vuole tra le props quando un componente li chiede. */
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
const html = renderToStaticMarkup(createElement(BoardLoadingHeader, { workspaceId: I.workspace, departmentId: I.unit }));
/** La testata vera della board, per un'unità con quel nome, in un workspace con quel nome. */
function loadedHeader(unitName: string, workspaceName = "Officina di prova"): string {
  const board = fixtureBoard();
  const real = renderToStaticMarkup(
    h(
      BoardProvider,
      { workspaceId: I.workspace, departmentId: I.unit, userId: I.user, initial: { ...board, unit: { ...board.unit, name: unitName } } },
      h(UnitBoard, { workspaceId: I.workspace, workspaceName, unitTerm: { singular: "reparto", plural: "reparti" }, assistantDefaultOpen: false, assistant: null, classification: null, headAction: null }),
    ),
  );
  return real.slice(real.indexOf("<header"), real.indexOf("</header>") + "</header>".length);
}

test("la testata che carica: la pillola «Caricamento», il titolo che tiene la sua riga, le due schede e il bottone dell'assistente, fermi", () => {
  assert.match(html, /^<header class="b-top" data-b="header">/, "con le schede: niente spazio in più sotto il titolo");
  assert.match(html, /<span class="b-status" data-s="loading" role="status" aria-live="polite" data-b="pill"><span class="b-dot" aria-hidden="true"><\/span><span>Caricamento<\/span><\/span>/);
  assert.match(html, /<h1 class="b-title" style="margin-top:8px"> <\/h1>/, "uno spazio che non si comprime: la riga del titolo resta alta 28 px");
  assert.match(html, /<button type="button" class="b-btn b-hide-phone b-assist-toggle" inert="" data-b="assistant-toggle">Assistente<\/button>/);
  assert.match(html, /<div class="b-tabbar" inert="" data-b="tabs"><div class="b-tabs" role="tablist"/);
  assert.deepEqual([...html.matchAll(/<button type="button" role="tab"[^>]*data-tab="([a-z]+)" aria-selected="(true|false)"/g)].map((match) => [match[1], match[2]]), [
    ["oggi", "true"],
    ["classificazione", "false"],
  ]);
  // Il link all'elenco delle unità resta: si può tornare indietro mentre la board arriva.
  assert.match(html, /<a href="\/dashboard\/[^"]+\/mapping">Activity mapping<\/a>/);
  assert.doesNotMatch(html, /×/, "il nome del workspace non si sa ancora");
});

test("la testata che carica ha gli stessi pezzi di quella della board, nello stesso ordine", () => {
  const board = fixtureBoard();
  const real = renderToStaticMarkup(
    h(
      BoardProvider,
      { workspaceId: I.workspace, departmentId: I.unit, userId: I.user, initial: board },
      h(UnitBoard, { workspaceId: I.workspace, workspaceName: "Officina di prova", unitTerm: { singular: "reparto", plural: "reparti" }, assistantDefaultOpen: false, assistant: null, classification: null, headAction: null }),
    ),
  );
  const header = real.slice(real.indexOf("<header"), real.indexOf("</header>") + "</header>".length);
  // Gli elementi con le loro classi e i loro ruoli, nell'ordine, senza i testi e senza il titolo (che qui è uno spazio):
  // la stessa struttura, quindi la stessa altezza.
  const shape = (markup: string) =>
    [...markup.replace(/(<h1[^>]*>)[\s\S]*?(<\/h1>)/, "$1$2").matchAll(/<([a-z0-9]+)([^>]*)>/g)].map((match) => {
      const attrs = match[2];
      return [match[1], /class="([^"]+)"/.exec(attrs)?.[1] ?? "", /role="([^"]+)"/.exec(attrs)?.[1] ?? ""].join(".");
    });
  // La riga del marchio non ha il nome del workspace (non si sa ancora): una riga sola lo stesso. Dal resto in poi, uguali.
  const after = (parts: string[]) => parts.slice(parts.indexOf("div.b-spacer."));
  assert.deepEqual(after(shape(html)), after(shape(header)));
  assert.ok(shape(html).includes("div.b-tabbar."), "la riga delle schede c'è");
});

test("con i nomi letti sul server: il marchio con il workspace e il titolo vero, gli stessi della board che arriva; un nome lungo va a capo uguale", () => {
  const long = "Amministrazione, finanza, controllo di gestione e rapporti con le banche";
  const loading = renderToStaticMarkup(createElement(BoardLoadingHeader, { workspaceId: I.workspace, departmentId: I.unit, unitName: long, workspaceName: "Officina di prova" }));
  const loaded = loadedHeader(long);
  // Il marchio e il titolo sono gli stessi, carattere per carattere: vanno a capo nello stesso punto, a ogni larghezza.
  const brand = (markup: string) => /<div class="b-brand" data-b="brand">[\s\S]*?<\/div>/.exec(markup)?.[0];
  const title = (markup: string) => /<h1 class="b-title"[^>]*>[\s\S]*?<\/h1>/.exec(markup)?.[0];
  assert.equal(title(loading), `<h1 class="b-title" style="margin-top:8px"><span data-b="title">${long} <i>board</i></span></h1>`);
  assert.equal(title(loading), title(loaded));
  assert.equal(brand(loading), brand(loaded));
  assert.match(loading, /<span class="b-x" aria-hidden="true">×<\/span><span>Officina di prova<\/span>/);
  // Tutta la testata: la stessa struttura, elemento per elemento; cambiano solo la pillola e i bottoni che non si usano ancora.
  const shape = (markup: string) => [...markup.matchAll(/<([a-z0-9]+)([^>]*)>/g)].map((match) => [match[1], /class="([^"]+)"/.exec(match[2])?.[1] ?? ""].join("."));
  assert.deepEqual(shape(loading), shape(loaded));
});
