import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import { allSteps, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { applyOps } from "../../../lib/mappatura/board-ops.ts";

// (Mappatura board) La scheda «Classificazione» (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.4, §7.3; P22–P28, P37,
// P42–P46): prima del completamento la testa e il blocco; dopo, i numeri prima, la riga da classificare, la legenda, i
// filtri, la stessa mappa colorata per stream, gli use case nati dalla mappatura (solo quelli che la pagina ha dato).
// «Usa gli stream proposti» solo per chi rivede, e solo se un passo è diverso dalla proposta. Un solo bottone pieno.

await enableTsxImports();
const { BoardProvider } = await import("../store/use-board.tsx");
const { ClassificationView, classificationKpis, matchesFilter, resetStreams } = await import("./classification-view.tsx");

const I = FIXTURE_IDS;
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
const decode = (text: string) => text.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
const view = (board: MappingBoard, useCaseHub = false) =>
  decode(renderToStaticMarkup(h(BoardProvider, { workspaceId: I.workspace, departmentId: I.unit, initial: board }, h(ClassificationView, { workspaceId: I.workspace, useCaseHub }))));
const primaries = (out: string) => out.match(/data-variant="primary"/g)?.length ?? 0;

test("prima del completamento: la testa della classificazione e il blocco; il bottone pieno è «Completa la mappatura»", () => {
  const out = view(fixtureBoard());
  assert.match(out, /^<div class="b-cls" data-b="classification"><div class="b-head" data-b="view-head"><div><p class="b-eyebrow">Classificazione<\/p><h2 class="b-h"><span data-b="title">Stessi processi, <i>tre stream<\/i><\/span><\/h2>/);
  assert.match(out, /<p class="b-lede">Ogni passo mostra lo stream in cui cade e il punto in cui decide una persona\.<\/p>/);
  assert.match(out, /<div class="b-empty" data-b="empty"><b>La classificazione arriva alla fine<\/b><p>Quando i processi sono a posto, completa la mappatura: ogni passo entra in uno dei tre stream\.<\/p><\/div>/);
  assert.match(out, /data-variant="primary">Completa la mappatura<\/button>/);
  assert.equal(primaries(out), 1);
  assert.doesNotMatch(out, /data-b="map"|data-b="kpis"|Usa gli stream proposti/);
});

test("dopo il completamento: i numeri prima di tutto, la riga da classificare con «Classifica 1 passo», la legenda e i filtri", () => {
  const board = fixtureBoard({ classified: true });
  const out = view(board);
  // I quattro riquadri: tre stream con passi e ore, poi l'esposizione media (34, 22, 40 → 32%).
  // Un colore per stream anche qui (P28): il punto dello stream davanti alla riga dei tre riquadri.
  assert.deepEqual(
    [...out.matchAll(/<div class="b-kpi"(?: data-stream="([a-z]+)")?><div class="b-kv">([^<]+)<\/div><div class="b-kl">(?:<i class="b-adot" data-tone="([a-z]+)"[^>]*><\/i>)?([^<]+)<\/div><\/div>/g)].map((match) => [match[1] ?? null, match[2], match[3] ?? null, match[4]]),
    [
      ["automate", "3", "automate", "Automate · 19,5 h a settimana"],
      ["differentiate", "1", "differentiate", "Differentiate · 3 h a settimana"],
      ["innovate", "1", "innovate", "Innovate · 4 h a settimana"],
      [null, "32%", null, "AI exposure media"],
    ],
  );
  assert.deepEqual(classificationKpis(board).map((item) => item.value), ["3", "1", "1", "32%"]);
  // Una sola fonte (P38): uno stream corretto cambia i riquadri.
  const corrected = applyOps(board, [{ id: "00000000-0000-4000-8000-000000000001", t: "step.stream", stepId: I.ordine, prev: null, next: "differentiate" }], { kind: "persona" });
  assert.deepEqual(classificationKpis(corrected).map((item) => [item.value, item.label]).slice(0, 2), [
    ["3", "Automate · 19,5 h a settimana"],
    ["2", "Differentiate · 5 h a settimana"],
  ]);
  assert.ok(out.indexOf('data-b="kpis"') < out.indexOf('data-b="map"'), "i numeri prima della mappa");
  assert.match(out, /<p class="b-cls-todo">1 passo da classificare\.<\/p>/);
  assert.match(out, /data-variant="primary">Classifica 1 passo<\/button>/);
  assert.deepEqual([...out.matchAll(/<span data-b="legend-item"><i class="b-adot( b-diamond)?"(?: data-tone="([a-z]+)")?[^>]*><\/i>([^<]+)<\/span>/g)].map((match) => [match[2] ?? "rombo", match[3]]), [
    ["automate", "Automate"],
    ["differentiate", "Differentiate"],
    ["innovate", "Innovate"],
    ["neutral", "da classificare"],
    ["rombo", "decide una persona"],
  ]);
  assert.match(out, /<div class="b-cls-filters" role="group" aria-label="Mostra i passi">/);
  assert.deepEqual([...out.matchAll(/<button type="button" class="b-fchip" aria-pressed="(true|false)" data-b="filter-chip">(?:<i[^>]*><\/i>)?([^<]+)<\/button>/g)].map((match) => [match[2], match[1]]), [
    ["Tutti", "true"],
    ["Automate", "false"],
    ["Differentiate", "false"],
    ["Innovate", "false"],
    ["Da classificare", "false"],
  ]);
});

test("la stessa mappa di «Processi di oggi», colorata per stream: badge, «AI x%», «da classificare», la pillola della decisione", () => {
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
  assert.match(out, /<span class="b-nt">Raccolta delle richieste<\/span><span class="b-ag"><span class="b-abadge b-small" data-stream="automate" data-b="stream-badge">Automate<\/span><span class="b-abadge b-auto b-small" data-b="exposure-badge">AI 34%<\/span><\/span>/);
  assert.match(out, /<span class="b-nt">Invio dell'ordine<\/span><span class="b-none">da classificare<\/span>/);
  assert.deepEqual([...out.matchAll(/<span class="b-gate" data-b="gate">([^<]+)<\/span>/g)].map((match) => match[1]), ["Richiesta completa", "Scelta del fornitore", "Decide una persona"]);
  // Niente chi e strumenti sulla mappa classificata: quelli sono di «Processi di oggi» e del drawer.
  assert.doesNotMatch(out, /class="b-who"|b-chip b-tool/);
});

test("«Usa gli stream proposti»: per chi rivede, solo se un passo è diverso dalla proposta; contornato accanto al bottone pieno", () => {
  const board = fixtureBoard({ classified: true });
  const out = view(board);
  assert.match(out, /<div class="b-cls-actions"><button data-action="reset-streams" type="button" class="b-btn" data-b="button" data-variant="outline">Usa gli stream proposti<\/button><button data-action="complete"/);
  assert.equal(primaries(out), 1, "un solo bottone pieno");
  assert.doesNotMatch(view({ ...board, can: { ...board.can, setStream: false } }), /Usa gli stream proposti/, "chi non rivede non lo vede");
  // Il clic: un'operazione dei revisori, e il toast (P46).
  const calls: unknown[] = [];
  resetStreams({ dispatch: (op) => void calls.push(op), notify: (text) => void calls.push(text) });
  assert.deepEqual(calls, [{ t: "streams.reset" }, "Stream riportati alla proposta."]);
  const asProposed = { ...board, processes: board.processes.map((process) => ({ ...process, steps: process.steps.map((step) => ({ ...step, proposedStream: step.stream })) })) };
  assert.doesNotMatch(view(asProposed), /Usa gli stream proposti/, "niente di diverso dalla proposta");
});

test("gli use case nati dalla mappatura: solo quelli dati dalla pagina, una riga ciascuno; nessuno, il link all'area; area spenta, niente", () => {
  const board = fixtureBoard({ classified: true });
  assert.doesNotMatch(view(board, false), /Use case nati da questa mappatura/);
  const none = view(board, true);
  assert.match(none, /<details class="b-sec" data-b="section"><summary>Use case nati da questa mappatura<small>0<\/small><\/summary>/);
  assert.match(none, new RegExp(`<p class="b-cls-none" data-b="cases-empty">Ancora nessuno\\. <a href="/dashboard/${I.workspace}/use-cases">Vai a Use case</a></p>`));
  const href = `/dashboard/${I.workspace}/use-cases/uc-1`;
  const linked: MappingBoard = { ...board, useCases: [{ id: "uc-1", code: "UC-0001", title: "Richieste in un modulo solo", href, stream: "automate" }] };
  const out = view(linked, true);
  assert.match(out, /<summary>Use case nati da questa mappatura<small>1<\/small><\/summary>/);
  assert.match(
    out,
    new RegExp(
      `<a class="b-crow" data-accent="automate" aria-label="Apri UC-0001 Richieste in un modulo solo" data-b="row" href="${href}"><span class="b-cid">UC-0001</span><span class="b-cn">Richieste in un modulo solo</span><span class="b-cls-stream"><i class="b-adot" data-tone="automate"[^>]*></i>Automate</span><span class="b-cls-open">Apri</span></a>`,
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
