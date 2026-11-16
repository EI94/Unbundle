import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import { locateStep, type MappingBoard } from "../../../lib/mappatura/board-model.ts";

// (Mappatura board) Il drawer che confronta, sulla scheda «Classificazione» (docs/mappatura/MAPPATURA-BOARD-PIANO.md
// §1.4, §7.3; P27, P44, P25, P21): badge, «Oggi» accanto a «Classificazione», il selettore dello stream (spento per chi
// non rivede, il punto ambra sulla proposta), il potenziale, la decisione, l'esposizione con O*NET, gli strumenti, gli
// attriti, le idee del team, gli use case. Il corpo si rende dentro il drawer statico (il dialogo non si disegna sul
// server).

await enableTsxImports();
const { ClassificationDetails, newIdeaOp, noteTextChange, noteToggleOp, streamChoiceOp, streamOptions } = await import("./classification-drawer.tsx");
const { DrawerStatic } = await import("../ui/drawer.tsx");

const I = FIXTURE_IDS;
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
const decode = (text: string) => text.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&");
function drawer(board: MappingBoard, stepId: string) {
  const place = locateStep(board, stepId)!;
  return decode(
    renderToStaticMarkup(
      h(DrawerStatic, { wide: true, context: `${place.process.name} · ${place.code}`, title: place.step.title }, h(ClassificationDetails, { board, place, dispatch() {}, newId: () => "nuovo" })),
    ),
  );
}

test("il confronto: badge, «Oggi» (la riga grigia) accanto a «Classificazione» (il motivo e l'affidabilità)", () => {
  const out = drawer(fixtureBoard({ classified: true }), I.confronto);
  assert.match(out, /<div class="b-dr-sub">Dalla richiesta all'ordine · A2<\/div><h2 class="b-dr-t"[^>]*>Confronto delle offerte<\/h2>/);
  assert.match(out, /<div class="b-ag" data-b="badges"><span class="b-abadge" data-stream="automate" data-b="stream-badge">Automate<\/span><span class="b-abadge b-auto" data-b="exposure-badge">AI 22%<\/span><\/div>/);
  assert.match(
    out,
    /<div class="b-compare" data-b="compare"><div class="b-was"><p class="b-k">Oggi<\/p><p>Per ogni richiesta si chiedono tre offerte e si confrontano\.<\/p><\/div><div class="b-now"><p class="b-k">Classificazione<\/p><p>Il confronto è meccanico, ma la scelta dei criteri no\.<\/p><p class="b-muted">Affidabilità 61%<\/p><\/div><\/div>/,
  );
  // Un passo senza stream: resta da classificare.
  assert.match(drawer(fixtureBoard({ classified: true }), I.ordine), /<div class="b-now"><p class="b-k">Classificazione<\/p><p>Resta da classificare\.<\/p><\/div>/);
});

test("il selettore dello stream: uno premuto, il punto ambra sulla proposta dell'assistente; spento per chi non rivede", () => {
  const board = fixtureBoard({ classified: true });
  const out = drawer(board, I.confronto);
  assert.match(
    out,
    /<p class="b-k">Stream<\/p><div class="b-wsel" role="group" aria-label="Stream del passo" data-b="segmented"><button type="button" aria-pressed="true">Automate<\/button><button type="button" class="b-rec" aria-pressed="false" title="Proposto dall'assistente">Differentiate<span class="b-sr"> Proposto dall'assistente<\/span><\/button><button type="button" aria-pressed="false">Innovate<\/button><button type="button" aria-label="Nessuno stream" aria-pressed="false">—<\/button><\/div>/,
  );
  const contributor = drawer({ ...board, can: { ...board.can, setStream: false } }, I.confronto);
  assert.equal(contributor.match(/<button type="button"(?: class="b-rec")?(?: aria-label="Nessuno stream")? aria-pressed="(?:true|false)" disabled=""/g)?.length, 4, "spento dal primo disegno");
  // «—» premuto per un passo senza stream.
  // Il segno «—» ha un nome per chi usa uno screen reader: «Nessuno stream» (§7.3).
  assert.match(drawer(board, I.ordine), /<button type="button" aria-label="Nessuno stream" aria-pressed="true">—<\/button>/);
});

test("la scelta nel selettore: un'operazione dei revisori con lo stream di adesso; la stessa scelta, niente", () => {
  assert.deepEqual(streamChoiceOp(I.confronto, "automate", "differentiate"), { t: "step.stream", stepId: I.confronto, prev: "automate", next: "differentiate" });
  assert.deepEqual(streamChoiceOp(I.confronto, "automate", "none"), { t: "step.stream", stepId: I.confronto, prev: "automate", next: null });
  assert.equal(streamChoiceOp(I.confronto, "automate", "automate"), null);
  assert.equal(streamChoiceOp(I.ordine, null, "none"), null);
  assert.deepEqual(streamOptions(null).map((option) => [option.value, option.label, option.recommended === true, option.ariaLabel ?? null]), [
    ["automate", "Automate", false, null],
    ["differentiate", "Differentiate", false, null],
    ["innovate", "Innovate", false, null],
    ["none", "—", false, "Nessuno stream"],
  ]);
});

test("il resto del passo: potenziale, la decisione con il suo nome, l'esposizione con O*NET, strumenti, attriti, idee, use case", () => {
  const board = fixtureBoard({ classified: true });
  const href = `/dashboard/${I.workspace}/use-cases/uc-1`;
  const linked: MappingBoard = {
    ...board,
    useCases: [{ id: "uc-1", code: "UC-0001", title: "Richieste in un modulo solo", href, stream: "automate" }],
    processes: board.processes.map((process) => ({ ...process, steps: process.steps.map((step) => (step.id === I.richieste ? { ...step, useCaseIds: ["uc-1"] } : step)) })),
  };
  const out = drawer(linked, I.richieste);
  assert.match(out, /<p class="b-k">Potenziale con l'AI<\/p><p>La richiesta si può leggere e completare da sola\.<\/p>/);
  assert.match(out, /<p class="b-k">Decide una persona<\/p><div class="b-human" data-b="human"><b>Richiesta completa<\/b>Chi compra decide se la richiesta è completa\.<\/div>/);
  assert.match(out, /<p class="b-k">AI exposure<\/p><p class="b-cls-big">34%<\/p><p class="b-muted">O\*NET 13-1023\.00 · Purchasing agents<\/p>/);
  assert.match(out, /<p class="b-k">Strumenti<\/p><div class="b-chips"><span class="b-chip b-tool" data-b="chip">E-mail<\/span><span class="b-chip b-tool" data-b="chip">Foglio di calcolo<\/span><\/div>/);
  assert.match(out, /<p class="b-k">Attriti di oggi<\/p><ul class="b-l"><li>Richieste incomplete<\/li><li>Nessun modulo unico<\/li><\/ul>/);
  assert.match(out, /<p class="b-k">Idee del team<\/p><div class="b-cell" data-lane="idee"><div class="b-note-w" data-status="validato" data-origin="board" data-b="note">/);
  assert.match(out, /<button aria-label="Aggiungi un'idea del team" type="button" class="b-add" data-b="add">\+ idea<\/button>/);
  assert.match(out, new RegExp(`<p class="b-k">Use case</p><ul class="b-l"><li><a href="${href}">UC-0001 · Richieste in un modulo solo</a></li></ul>`));
  // Senza nulla da dire, «—»; un passo senza decisione non ha il blocco.
  const plain = drawer(board, I.ordine);
  assert.match(plain, /<p class="b-k">Potenziale con l'AI<\/p><p class="b-muted">—<\/p>/);
  assert.match(plain, /<p class="b-k">AI exposure<\/p><p class="b-muted">—<\/p>/);
  assert.match(plain, /<p class="b-k">Use case<\/p><p class="b-muted">—<\/p>/);
  assert.doesNotMatch(plain, /Decide una persona/);
});

test("in sola lettura le idee non si scrivono: niente «+ idea», le note spente, «—» se non ce ne sono", () => {
  const board = fixtureBoard({ classified: true, readOnly: true });
  const withIdea = drawer(board, I.richieste);
  assert.doesNotMatch(withIdea, /\+ idea|b-note-ctl/);
  assert.match(withIdea, /<textarea class="b-textin"[^>]*disabled=""/);
  assert.match(drawer(board, I.confronto), /<div class="b-cell" data-lane="idee"><p class="b-muted">—<\/p><\/div>/);
});

test("le idee del team: una nota della corsia del passo; il testo cambia con il valore visto, vuoto la toglie con «Annulla»; la spunta", () => {
  assert.deepEqual(newIdeaOp(I.richieste, "Un modulo unico", "n-1"), { t: "note.add", noteId: "n-1", stepId: I.richieste, lane: "idee", text: "Un modulo unico" });
  assert.equal(newIdeaOp(I.richieste, "   ", "n-1"), null, "vuota non nasce");
  assert.deepEqual(noteTextChange({ id: "n-1" }, "Un modulo per tutti", "Un modulo unico"), { op: { t: "note.set", noteId: "n-1", field: "text", prev: "Un modulo unico", next: "Un modulo per tutti" } });
  assert.deepEqual(noteTextChange({ id: "n-1" }, "", "Un modulo unico"), { op: { t: "note.remove", noteId: "n-1" }, undo: "Nota eliminata." });
  assert.deepEqual(noteToggleOp({ id: "n-1", status: "validato", origin: "board" }), { t: "note.set", noteId: "n-1", field: "status", prev: "validato", next: "ipotesi" });
  assert.deepEqual(noteToggleOp({ id: "n-1", status: "validato", origin: "chat" }), { t: "note.set", noteId: "n-1", field: "status", prev: "validato", next: "fonte" });
  assert.deepEqual(noteToggleOp({ id: "n-1", status: "fonte", origin: "chat" }), { t: "note.set", noteId: "n-1", field: "status", prev: "fonte", next: "validato" });
});
