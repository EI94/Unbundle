import test from "node:test";
import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureUnits } from "../../../lib/mappatura/board-fixture.ts";

// L'elenco delle unità, S1 (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.2; P37, P42, P43, P47): la testata senza schede
// né pillola, i numeri prima delle righe, una riga per unità che porta alla sua board, nessun bottone pieno, e senza
// unità «Prima la Discovery». Markup statico, come lo disegna il server.

await enableTsxImports();
const { UnitsView } = await import("./units-view.tsx");

const WS = FIXTURE_IDS.workspace;
const words = { singular: "reparto", plural: "reparti" };
const render = (units = fixtureUnits()) => renderToStaticMarkup(createElement(UnitsView, { workspaceId: WS, workspaceName: "Officina di prova", unitTerm: words, units }));

test("la testata della board senza schede né pillola, la testa della vista con la parola dell'unità", () => {
  const html = render();
  assert.match(html, /^<header class="b-top" data-b="header">/);
  assert.match(html, /<h1 class="b-title" style="margin-top:8px"><span data-b="title">Activity <i>mapping<\/i><\/span><\/h1>/);
  assert.doesNotMatch(html, /role="tablist"|data-b="pill"|data-b="save-now"/, "qui non si modifica niente");
  assert.match(html, /<p class="b-eyebrow">Activity mapping<\/p><h2 class="b-h">Il lavoro di oggi, <i>reparto per reparto<\/i><\/h2><p class="b-lede">Ogni reparto ha la sua board: i processi, i passi, chi li fa e dove decide una persona\.<\/p>/);
  assert.doesNotMatch(html, /data-variant="primary"|b-primary/, "nessun bottone pieno");
});

test("i numeri prima delle righe: quattro riquadri, poi la sezione con il conteggio e una riga per unità (P37, P42)", () => {
  const html = render();
  const tiles = [...html.matchAll(/<div class="b-kv">([^<]*)<\/div><div class="b-kl">([^<]*)<\/div>/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(tiles, [
    ["1 di 3", "reparti con la mappatura completa"],
    ["10", "passi mappati"],
    ["59,5 h", "ore a settimana"],
    ["6", "passi da validare"],
  ]);
  assert.ok(html.indexOf('data-b="kpis"') < html.indexOf('data-b="units"'), "i riquadri prima delle righe");
  assert.match(html, /<h3 class="b-sh">Reparti<small>3<\/small><\/h3>/);
  const rows = [...html.matchAll(/<a class="b-crow" aria-label="([^"]+)" data-b="row" href="([^"]+)">/g)].map((match) => [match[1], match[2]]);
  assert.deepEqual(rows, [
    ["Apri la board di Ufficio acquisti", `/dashboard/${WS}/mapping/${FIXTURE_IDS.unit}`],
    ["Apri la board di Magazzino", `/dashboard/${WS}/mapping/dddddddd-0000-4000-8000-000000000002`],
    ["Apri la board di Amministrazione", `/dashboard/${WS}/mapping/dddddddd-0000-4000-8000-000000000003`],
  ]);
});

test("una riga: lo stato, il nome con la descrizione, i punti degli stream dopo la classificazione, i conteggi (P43)", () => {
  const html = render();
  const [acquisti, magazzino, amministrazione] = html.split('data-b="row"').slice(1);
  assert.match(acquisti, /<span class="b-st-chip b-ok" data-tone="ok" data-b="status-chip">Mappatura completa<\/span>/);
  assert.match(acquisti, /<span class="b-cn">Ufficio acquisti<small>6 persone · Compra materiali e servizi per gli altri uffici\.<\/small><\/span>/);
  // I tre stream, ognuno con il suo punto e i suoi passi; il nome dello stream nel title.
  const dots = [...acquisti.matchAll(/<span class="b-sdot" title="([^"]+)" data-stream="(\w+)"><i class="b-adot" data-tone="(\w+)"/g)].map((match) => [match[1], match[2], match[3]]);
  assert.deepEqual(dots, [
    ["Automate: 3", "automate", "automate"],
    ["Differentiate: 1", "differentiate", "differentiate"],
    ["Innovate: 1", "innovate", "innovate"],
  ]);
  assert.match(acquisti, /<span class="b-num2">6 passi · 28,5 h a settimana<small>2 da validare · 1 da classificare<\/small><\/span>/);
  // In corso: nessun punto (niente è classificato), solo quello che resta da validare.
  assert.match(magazzino, /data-tone="wait" data-b="status-chip">In corso<\/span>/);
  assert.match(magazzino, /<span class="b-crow-streams"><\/span><span class="b-num2">4 passi · 31 h a settimana<small>4 da validare<\/small><\/span>/);
  // Da iniziare, senza descrizione e senza persone: niente riga sotto il nome, niente da fare.
  assert.match(amministrazione, /data-tone="neutral" data-b="status-chip">Da iniziare<\/span><\/span><span class="b-cn">Amministrazione<\/span>/);
  assert.match(amministrazione, /<span class="b-num2">0 passi · 0 h a settimana<\/span>/);
  // Nessuna chiave interna a schermo.
  assert.doesNotMatch(html, />[^<]*(not_started|in_progress|mapped|da_validare)[^<]*</);
});

test("un'unità con passi è «In corso» da sola, anche prima che qualcuno la segni", () => {
  const [, , amministrazione] = fixtureUnits();
  const html = render([{ ...amministrazione, steps: 2, hoursWeek: 3, toValidate: 2, unclassified: 2 }]);
  assert.match(html, /data-tone="wait" data-b="status-chip">In corso<\/span>/);
  assert.match(html, /2 passi · 3 h a settimana<small>2 da validare<\/small>/);
});

test("senza unità: «Prima la Discovery», con un link solo e nessun bottone pieno", () => {
  const html = render([]);
  assert.match(html, /<div class="b-empty" data-b="empty"><b>Prima la Discovery<\/b><p>La mappatura comincia dalla Discovery\. Completa quella fase per aprire le board\.<\/p><div class="b-empty-actions"><a class="b-btn" data-b="discovery" href="\/dashboard\/[^"]+\/setup\/leadership">Vai alla Discovery<\/a><\/div><\/div>/);
  assert.doesNotMatch(html, /data-b="kpis"|data-b="units"|b-primary/);
});
