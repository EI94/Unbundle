import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import { allSteps, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { applyOps } from "../../../lib/mappatura/board-ops.ts";

// (Mappatura board) La scheda «Con l'AI» (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.4, §7.3; P22–P28, P37, P42–P46;
// rilascio 10, §3.7: niente doppioni): prima del completamento la testa e il blocco; dopo, i tre riquadri delle categorie,
// i chip che filtrano e fanno da legenda, il «?», la stessa mappa colorata per categoria, gli use case nati dalla
// mappatura (solo quelli che la pagina ha dato, solo se ce ne sono). «Usa le categorie proposte» sta nel «⋯» della
// testata della board. Un solo bottone pieno.

await enableTsxImports();
const { BoardProvider } = await import("../store/use-board.tsx");
const { ClassificationView, classificationKpis, matchesFilter, resetStreams } = await import("./classification-view.tsx");

const I = FIXTURE_IDS;
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
const decode = (text: string) => text.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const view = (board: MappingBoard, useCaseHub = false) =>
  decode(renderToStaticMarkup(h(BoardProvider, { workspaceId: I.workspace, departmentId: I.unit, userId: I.user, initial: board }, h(ClassificationView, { workspaceId: I.workspace, useCaseHub }))));
const primaries = (out: string) => out.match(/data-variant="primary"/g)?.length ?? 0;

test("prima del completamento: la testa della classificazione e il blocco; il bottone pieno è «Completa la mappatura»", () => {
  const out = view(fixtureBoard());
  // (Rilascio 10, §3.7) Niente occhiello (è la scheda) e niente frase che ripete i chip.
  assert.match(out, /^<div class="b-cls" data-b="classification"><div class="b-head" data-b="view-head"><div><h2 class="b-h"><span data-b="title">Stessi processi, <i>tre categorie<\/i><\/span><\/h2><\/div>/);
  assert.doesNotMatch(out, /b-eyebrow|b-lede/);
  assert.match(out, /<div class="b-empty" data-b="empty"><b>La classificazione arriva alla fine<\/b><p>Quando i processi sono a posto, completa la mappatura: ogni passo entra in una delle tre categorie\.<\/p><\/div>/);
  assert.match(out, /data-variant="primary">Completa la mappatura<\/button>/);
  assert.equal(primaries(out), 1);
  assert.doesNotMatch(out, /data-b="map"|data-b="kpis"|Usa le categorie proposte/);
});

test("dopo il completamento: i tre riquadri delle categorie, il bottone «Classifica 1 passo», i chip che fanno da legenda, il «?»", () => {
  const board = fixtureBoard({ classified: true });
  const out = view(board);
  // Tre riquadri, uno per categoria, con passi e ore; un colore per categoria (P28). L'esposizione media all'AI non c'è più:
  // è un dettaglio tecnico, nel drawer.
  assert.deepEqual(
    [...out.matchAll(/<div class="b-kpi"(?: data-stream="([a-z]+)")?><div class="b-kv">([^<]+)<\/div><div class="b-kl">(?:<i class="b-adot" data-tone="([a-z]+)"[^>]*><\/i>)?([^<]+)<\/div><\/div>/g)].map((match) => [match[1] ?? null, match[2], match[3] ?? null, match[4]]),
    [
      ["automate", "3", "automate", "Automatizzare · 19,5 h a settimana"],
      ["differentiate", "1", "differentiate", "Differenziare · 3 h a settimana"],
      ["innovate", "1", "innovate", "Innovare · 4 h a settimana"],
    ],
  );
  assert.deepEqual(classificationKpis(board).map((item) => item.value), ["3", "1", "1"]);
  assert.doesNotMatch(out, /Esposizione all'AI|b-cls-todo|da classificare\.<\/p>/);
  // Una sola fonte (P38): una categoria corretta cambia i riquadri.
  const corrected = applyOps(board, [{ id: "00000000-0000-4000-8000-000000000001", t: "step.stream", stepId: I.ordine, prev: null, next: "differentiate" }], { kind: "persona" });
  assert.deepEqual(classificationKpis(corrected).map((item) => [item.value, item.label]).slice(0, 2), [
    ["3", "Automatizzare · 19,5 h a settimana"],
    ["2", "Differenziare · 5 h a settimana"],
  ]);
  assert.ok(out.indexOf('data-b="kpis"') < out.indexOf('data-b="map"'), "i numeri prima della mappa");
  assert.match(out, /data-variant="primary">Classifica 1 passo<\/button>/);
  // I chip filtrano e fanno da legenda; il «?» apre il rombo di «decide una persona».
  assert.match(out, /<div class="b-cls-filters" role="group" aria-label="Mostra i passi">/);
  assert.deepEqual([...out.matchAll(/<button type="button" class="b-fchip" aria-pressed="(true|false)" data-b="filter-chip">(?:<i class="b-adot" data-tone="([a-z]+)"[^>]*><\/i>)?([^<]+)<\/button>/g)].map((match) => [match[3], match[1], match[2] ?? null]), [
    ["Tutti", "true", null],
    ["Automatizzare", "false", "automate"],
    ["Differenziare", "false", "differentiate"],
    ["Innovare", "false", "innovate"],
    ["Da classificare", "false", "neutral"],
  ]);
  assert.match(out, /<button type="button" class="b-iconbtn b-legend-btn" aria-label="Che cosa vuol dire" title="Che cosa vuol dire" aria-expanded="false" aria-controls="b-legenda-con-ai" data-b="legend-toggle">\?<\/button>/);
  assert.deepEqual([...out.matchAll(/<span data-b="legend-item"><i class="b-adot( b-diamond)?"(?: data-tone="([a-z]+)")?[^>]*><\/i>([^<]+)<\/span>/g)].map((match) => [match[2] ?? "rombo", match[3]]), [["rombo", "decide una persona"]]);
});

test("la stessa mappa di «Oggi», colorata per categoria: il badge, «da classificare», la pillola della decisione; niente «AI x%»", () => {
  const board = fixtureBoard({ classified: true });
  const out = view(board);
  const cards = [...out.matchAll(/<button type="button" class="b-node b-tb"( data-stream="([a-z]+)")? data-step="([A-Z]\d+)"/g)].map((match) => [match[3], match[2] ?? null]);
  assert.deepEqual(cards, [
    ["A1", "automate"],
    ["A2", "automate"],
    ["A3", "differentiate"],
    ["A4", null],
    ["B1", "automate"],
    ["B2", "innovate"],
  ], "stesse righe, stessi passi, stesso ordine (P22); il bordo dello stream, o quello neutro");
  assert.equal(cards.length, allSteps(board).length);
  assert.match(out, /<span class="b-nt">Raccolta delle richieste<\/span><span class="b-ag"><span class="b-abadge b-small" data-stream="automate" data-b="stream-badge" title="Automate">Automatizzare<\/span><\/span>/);
  assert.doesNotMatch(out, /exposure-badge|AI 34%/, "l'esposizione all'AI sta nei dettagli tecnici del drawer");
  assert.match(out, /<span class="b-nt">Invio dell'ordine<\/span><span class="b-none">da classificare<\/span>/);
  assert.deepEqual([...out.matchAll(/<span class="b-gate" data-b="gate">([^<]+)<\/span>/g)].map((match) => match[1]), ["Richiesta completa", "Scelta del fornitore", "Decide una persona"]);
  // Niente chi e strumenti sulla mappa classificata: quelli sono di «Processi di oggi» e del drawer. (Rilascio 10, §3.7)
  // Nemmeno la descrizione: come su «Oggi», sta nel drawer.
  assert.doesNotMatch(out, /class="b-who"|b-chip b-tool|class="b-ns2"/);
  assert.ok(allSteps(board).some((step) => step.description), "la prova ha passi con la descrizione");
  // Ogni riga è larga quanto la più lunga (quattro passi), senza il posto di «+ passo»: le etichette restano ferme (P13).
  assert.match(out, /<div class="b-pm" style="--steps:4" data-dim="" data-b="map">|<div class="b-pm" style="--steps:4" data-b="map">/);
  assert.doesNotMatch(out, /<div class="b-pm-row" style=|data-adds/);
});

test("«Usa le categorie proposte»: nel «⋯» della testata della board, per chi rivede e solo se un passo è diverso dalla proposta", () => {
  const board = fixtureBoard({ classified: true });
  const out = view(board);
  assert.doesNotMatch(out, /Usa le categorie proposte|b-cls-actions/, "non sta più nella testa della vista");
  assert.equal(primaries(out), 1, "un solo bottone pieno");
  // Il clic: un'operazione dei revisori, e il toast (P46).
  const calls: unknown[] = [];
  resetStreams({ dispatch: (op) => void calls.push(op), notify: (text) => void calls.push(text) });
  assert.deepEqual(calls, [{ t: "streams.reset" }, "Categorie riportate alla proposta."]);
  // Con il bottone che l'ha chiesto, il fuoco va prima nella vista (F1).
  const view_ = { focus: (options?: { preventScroll?: boolean }) => void calls.push(`vista.focus ${options?.preventScroll === true}`) };
  const button = { closest: (selector: string) => (selector === '[role="tabpanel"]' ? view_ : null) as Element | null };
  calls.length = 0;
  resetStreams({ dispatch: (op) => void calls.push(op), notify: (text) => void calls.push(text) }, button);
  assert.deepEqual(calls, ["vista.focus true", { t: "streams.reset" }, "Categorie riportate alla proposta."]);
  // La voce del «⋯»: solo con un passo diverso dalla proposta e per chi può correggere le categorie.
  const source = readFileSync(new URL("../board/unit-board.tsx", import.meta.url), "utf8");
  assert.match(source, /const canReset = complete && board\.can\.setStream && streamNumbers\(board\)\.differsFromProposal > 0;/);
  assert.match(source, /\.\.\.\(canReset\s*\?\s*\[\s*\{\s*key: "categorie",\s*label: CLASSIFICATION_TEXT\.reset,\s*onSelect: \(\) => resetStreams\(client\),/);
});

test("gli use case nati dalla mappatura: solo quelli dati dalla pagina, una riga ciascuno; nessuno, niente (lo zero non si vede); area spenta, niente", () => {
  const board = fixtureBoard({ classified: true });
  assert.doesNotMatch(view(board, false), /Use case nati da questa mappatura/);
  const none = view(board, true);
  assert.doesNotMatch(none, /Use case nati da questa mappatura|cases-empty/);
  const href = `/dashboard/${I.workspace}/use-cases/uc-1`;
  const linked: MappingBoard = { ...board, useCases: [{ id: "uc-1", code: "UC-0001", title: "Richieste in un modulo solo", href, stream: "automate" }] };
  const out = view(linked, true);
  assert.match(out, /<summary>Use case nati da questa mappatura<small>1<\/small><\/summary>/);
  assert.match(
    out,
    new RegExp(
      `<a class="b-crow" data-accent="automate" aria-label="Apri UC-0001 Richieste in un modulo solo" data-b="row" href="${href}"><span class="b-cid">UC-0001</span><span class="b-cn">Richieste in un modulo solo</span><span class="b-cls-stream"><i class="b-adot" data-tone="automate"[^>]*></i>Automatizzare</span><span class="b-cls-open">Apri</span></a>`,
    ),
  );
});

test("i filtri: un passo resta acceso con il suo stream, con «Tutti», o senza stream con «Da classificare»", () => {
  assert.equal(matchesFilter({ stream: "automate" }, "all"), true);
  assert.equal(matchesFilter({ stream: "automate" }, "automate"), true);
  assert.equal(matchesFilter({ stream: "automate" }, "innovate"), false);
  assert.equal(matchesFilter({ stream: null }, "none"), true);
  assert.equal(matchesFilter({ stream: "differentiate" }, "none"), false);
});

test("«da classificare» nella legenda e nei filtri è un anello: il punto pieno neutro quasi sparisce sul fondo scuro", () => {
  const css = readFileSync(new URL("../board-companion.css", import.meta.url), "utf8");
  assert.match(css, /\[data-board-root\] \.b-cls \.b-adot\[data-tone="neutral"\] \{ background: transparent; box-shadow: inset 0 0 0 1\.5px var\(--board-graphite-2\); \}/);
});
