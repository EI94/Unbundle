import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import type { MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { clickables, elements, ofType, press, recorder, type AnyElement } from "./test-support/elements.ts";

// La mappa che si modifica (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3; P11–P19, P53, P57–P61, P65): il disegno del
// riferimento, i controlli di [v1] portati sulla mappa, e niente controlli in sola lettura. I controlli si chiamano
// dall'albero degli elementi; il disegno si legge dal markup statico.

await enableTsxImports();
const { MapRows, NO_DRAG } = await import("./process-map.tsx");
const { LineInPlace } = await import("./in-place.tsx");
const { Votes } = await import("../ui/edit.tsx");
const { StepCard } = await import("../ui/map.tsx");

const I = FIXTURE_IDS;

function rows(board: MappingBoard, options: { editable?: boolean; dim?: boolean; drag?: { dragging: string | null; over: { processId: string; beforeId: string | null } | null }; focusProcessId?: string | null } = {}) {
  const log = recorder();
  const tree = MapRows({
    board,
    editable: options.editable ?? true,
    dim: options.dim ?? false,
    drag: options.drag ?? NO_DRAG,
    focusProcessId: options.focusProcessId ?? null,
    actions: { dispatch: log.record("dispatch"), openStep: log.record("openStep"), addStep: log.record("addStep"), addProcess: log.record("addProcess"), notify: log.record("notify") },
    onGripDragStart: log.record("dragStart"),
    onGripDragEnd: log.record("dragEnd"),
  });
  return { tree, log, html: renderToStaticMarkup(tree) };
}

test("una riga per processo, i passi da sinistra a destra con una freccia tra due; card, bordo dell'attrito, «◆», «da validare» (P11–P17, P25)", () => {
  const { html } = rows(fixtureBoard());
  assert.equal((html.match(/data-b="process-row"/g) ?? []).length, 2);
  // Ogni riga è larga quanto la più lunga (A, quattro passi), con il posto di «+ passo»: l'etichetta di B resta ferma
  // a sinistra quando la mappa scorre fino in fondo (P13).
  assert.match(html, /^<div class="b-pm" style="--steps:4" data-adds="" data-b="map">/);
  // A: quattro passi, tre frecce; B: due passi, una freccia. Le lettere e i codici vengono dall'ordine.
  const [a, b] = html.split('data-b="process-row"').slice(1);
  assert.equal((a.match(/data-b="arrow"/g) ?? []).length, 3);
  assert.equal((b.match(/data-b="arrow"/g) ?? []).length, 1);
  assert.match(a, /<span class="b-lid">A<\/span>/);
  assert.deepEqual([...html.matchAll(/data-step="(\w+)"/g)].map((match) => match[1]), ["A1", "A2", "A3", "A4", "B1", "B2"]);
  // A1: attrito forte, la decisione con il suo nome; A2: da validare; A4: attrito lieve; B2: decide una persona senza nome.
  assert.match(a, /class="b-node" data-pain="3" data-step="A1"[^>]*>.*?<span class="b-gate" data-b="gate">Richiesta completa<\/span>/);
  assert.match(a, /data-pain="2" data-step="A2".*?<span class="b-tag b-line">da validare<\/span>/);
  assert.match(a, /data-pain="1" data-step="A4"/);
  assert.match(b, /data-step="B2"[^>]*>.*?<span class="b-gate" data-b="gate">Decide una persona<\/span>/);
  assert.doesNotMatch(html, /<div class="b-pm-row" style=/, "nessuna riga ha una larghezza sua");
  // In sola lettura niente «+ passo», e la riga non ne tiene il posto.
  assert.match(rows(fixtureBoard({ readOnly: true }), { editable: false }).html, /^<div class="b-pm" style="--steps:4" data-b="map">/);
});

test("l'etichetta della riga: nome e chi lo segue sul posto, gli attriti, i voti, su, giù; un processo vuoto si elimina con «Annulla»", () => {
  const board = fixtureBoard();
  const { tree, log, html } = rows(board);
  const fields = ofType(tree, LineInPlace);
  const [nameA, ownerA, nameB, ownerB] = fields;
  assert.deepEqual(fields.map((field) => [field.props.value, field.props.placeholder]), [
    ["Dalla richiesta all'ordine", "Nome del processo"],
    ["Responsabile acquisti", "Chi lo segue"],
    ["Dall'ordine alla consegna", "Nome del processo"],
    ["", "Chi lo segue"],
  ]);
  (nameA.props.onCommit as (next: string, base: string) => void)("Acquisti", "Dalla richiesta all'ordine");
  (ownerB.props.onCommit as (next: string, base: string) => void)("Magazzino", "");
  (nameB.props.onCommit as (next: string, base: string) => void)("", "Dall'ordine alla consegna");
  void ownerA;
  // Gli attriti della riga, in rosso: A ne ha quattro (due note di A1, A2, il livello di A4), B uno.
  assert.match(html, /<span class="b-pm-fr">4 attriti<\/span>/);
  assert.match(html, /<span class="b-pm-fr">1 attrito<\/span>/);
  // I voti: il totale e i miei; ognuno muove i suoi.
  const [votesA] = ofType(tree, Votes);
  assert.deepEqual([votesA.props.total, votesA.props.mine, votesA.props.disabled], [3, 1, false]);
  (votesA.props.onChange as (mine: number) => void)(2);
  // Su e giù: il primo non sale, l'ultimo non scende.
  const ups = clickables(tree, "Sposta su");
  const downs = clickables(tree, "Sposta giù");
  assert.deepEqual([ups[0].props.disabled, ups[1].props.disabled, downs[0].props.disabled, downs[1].props.disabled], [true, false, false, true]);
  (downs[0].props.onClick as () => void)();
  assert.deepEqual(log.named("dispatch"), [
    [{ t: "process.set", processId: I.processA, field: "name", prev: "Dalla richiesta all'ordine", next: "Acquisti" }],
    [{ t: "process.set", processId: I.processB, field: "owner", prev: null, next: "Magazzino" }],
    [{ t: "process.vote", processId: I.processA, mine: 2 }],
    [{ t: "process.move", processId: I.processA, beforeId: null }],
  ]);
  // «Elimina il processo» solo per un processo senza passi.
  assert.deepEqual(clickables(tree, "Elimina il processo"), []);
  const emptyRow = { ...board, processes: [...board.processes, { id: "a0000000-0000-4000-8000-000000000009", name: "Resi", owner: null, votes: 0, myVotes: 0, steps: [] }] };
  const withEmpty = rows(emptyRow);
  press(withEmpty.tree, "Elimina il processo");
  assert.deepEqual(withEmpty.log.named("dispatch"), [[{ t: "process.remove", processId: "a0000000-0000-4000-8000-000000000009" }, { undo: "Processo eliminato." }]]);
  // Una riga vuota mostra sempre il suo «+ passo».
  assert.match(withEmpty.html, /class="b-add b-add-step b-add-first" data-b="add">\+ passo<\/button>/);
});

test("«+ passo» in fondo a ogni riga, «+ processo» sotto l'ultima, un clic su un passo lo apre (P19, P53)", () => {
  const { tree, log, html } = rows(fixtureBoard());
  press(tree, "Aggiungi un passo a Dall'ordine alla consegna");
  press(tree, "+ processo");
  const cards = ofType(tree, StepCard);
  (cards[1].props.onOpen as () => void)();
  assert.deepEqual(log.calls, [["addStep", I.processB], ["addProcess"], ["openStep", I.confronto]]);
  assert.match(html, /<div class="b-pm-foot"><button type="button" class="b-add b-add-process" data-b="add">\+ processo<\/button><\/div>/);
  // Ogni card ha la sua maniglia, fuori dal bottone, con l'id del passo; trascinarla avvisa chi tiene la mappa.
  const grips = elements(tree).filter((element) => element.type === "span" && element.props.className === "b-grip");
  assert.equal(grips.length, 6);
  assert.deepEqual([grips[0].props.draggable, grips[0].props["aria-hidden"], grips[0].props.title, grips[0].props["data-step-id"]], [true, "true", "Trascina per spostare", I.richieste]);
  const event = { dataTransfer: {} };
  (grips[2].props.onDragStart as (event: unknown) => void)(event);
  (grips[2].props.onDragEnd as () => void)();
  assert.deepEqual(log.calls.slice(3), [["dragStart", I.scelta, event], ["dragEnd"]]);
  assert.match(html, /<div class="b-node-w"><span class="b-grip" draggable="true" title="Trascina per spostare" aria-hidden="true" data-step-id="[^"]+"><\/span><button type="button" class="b-node"/);
});

test("il trascinamento: la riga sotto il passo si colora, un segno dice dove cadrà, la card presa è più chiara (P58, P59)", () => {
  const before = rows(fixtureBoard(), { drag: { dragging: I.ordine, over: { processId: I.processB, beforeId: I.controllo } } }).html;
  const [a, b] = before.split('data-b="process-row"').slice(1);
  assert.match(b, /<span hidden="" data-process-id="[^"]+" data-drop-row=""><\/span>/);
  assert.doesNotMatch(a, /data-drop-row/);
  assert.match(b, /data-step-id="bbbbbbbb-0000-4000-8000-000000000006" data-drop-before=""/);
  assert.match(a, /data-step-id="bbbbbbbb-0000-4000-8000-000000000004" data-dragging=""/);
  // In fondo alla riga: il segno prima di «+ passo».
  const atEnd = rows(fixtureBoard(), { drag: { dragging: I.ordine, over: { processId: I.processB, beforeId: null } } }).html;
  assert.match(atEnd.split('data-b="process-row"')[2], /data-drop-row=""><\/span><span class="b-drop-mark" aria-hidden="true"><\/span><button/);
  // La zona della mappa ascolta il trascinamento e lascia il passo con l'operazione di `dropMoveOp`.
  const source = readFileSync(new URL("./process-map.tsx", import.meta.url), "utf8");
  assert.match(source, /<div className="b-mapzone" data-dragging=\{drag\.dragging \? "" : undefined\} onDragOver=\{over\} onDragLeave=\{leave\} onDrop=\{drop\}>/);
  assert.match(source, /const op = dropMoveOp\(p\.board, dragging, target\.processId, target\.beforeId\);\s+if \(op\) p\.actions\.dispatch\(op\);/);
  assert.match(source, /p\.actions\.notify\(BOARD_TEXT\.toast\.limitStepsInProcess\)/);
  assert.match(source, /event\.dataTransfer\.setDragImage\(card, 16, 16\)/, "si vede la card intera");
});

test("«Evidenzia attriti» sfuma i passi senza attrito; il processo appena aggiunto ha il cursore nel nome, scelto (P61)", () => {
  const { html } = rows(fixtureBoard(), { dim: true });
  assert.match(html, /^<div class="b-pm" style="--steps:4" data-dim="" data-adds="" data-b="map">/);
  assert.deepEqual([...html.matchAll(/data-step="(\w+)" data-dimmed=""/g)].map((match) => match[1]), ["A3", "B2"]);
  assert.doesNotMatch(rows(fixtureBoard()).html, /data-dimmed/);
  const focused = rows(fixtureBoard(), { focusProcessId: I.processB });
  const [nameA, , nameB] = ofType(focused.tree, LineInPlace);
  assert.deepEqual([nameA.props.autoFocus, nameB.props.autoFocus, nameB.props.selectOnFocus], [false, true, true]);
});

test("in sola lettura la mappa si legge: nessun campo, nessuna maniglia, nessun «+»; i voti solo se ce ne sono, spenti (F9)", () => {
  const { tree, html } = rows(fixtureBoard({ readOnly: true }), { editable: false });
  assert.doesNotMatch(html, /<textarea|b-grip|b-add|b-row-ctl|data-process-id/);
  assert.match(html, /<b>Dalla richiesta all&#x27;ordine<\/b><small>Responsabile acquisti<\/small>/);
  const votes = ofType(tree, Votes) as AnyElement[];
  assert.equal(votes.length, 1, "B non ha voti: niente controllo");
  assert.equal(votes[0].props.disabled, true);
  assert.match(html, /<button type="button" aria-label="Togli un tuo voto" disabled="">/);
  // I passi si aprono lo stesso.
  assert.equal(ofType(tree, StepCard).length, 6);
});
