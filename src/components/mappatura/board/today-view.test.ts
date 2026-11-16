import test from "node:test";
import assert from "node:assert/strict";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import type { MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { clickables, ofType, press, recorder, textOf } from "./test-support/elements.ts";

// La vista «Processi di oggi» (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3, §8.1; P7, P34, P35, P37, P38, P53–P62,
// F9): i riquadri prima della mappa; un'unità vuota con i suoi due bottoni, uno pieno; una board in sola lettura con i
// controlli spenti dal primo disegno; al più un bottone pieno nella vista; i controlli mandano le operazioni giuste.

await enableTsxImports();
const { AnalysisPoint, TodayContent, TodayView } = await import("./today-view.tsx");
const { BoardProvider } = await import("../store/use-board.tsx");
const { BoardButton, FilterChip } = await import("../ui/atoms.tsx");
const { DraftPoint, LineInPlace } = await import("./in-place.tsx");

const I = FIXTURE_IDS;
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
const completeButton = () => h(BoardButton, { variant: "primary" }, "Completa la mappatura");
/** La vista com'è al primo disegno, dentro la board del browser. */
const render = (board: MappingBoard, headAction: ReactNode = completeButton()) =>
  renderToStaticMarkup(h(BoardProvider, { workspaceId: I.workspace, departmentId: board.unit.id, userId: I.user, initial: board }, h(TodayView, { headAction, onStartAssistant() {} })));

function content(board: MappingBoard, extra: { dim?: boolean; addingPoint?: boolean } = {}) {
  const log = recorder();
  let seq = 0;
  const actions = {
    dispatch: log.record("dispatch"),
    notify: log.record("notify"),
    openStep: log.record("openStep"),
    addStep: log.record("addStep"),
    addProcess: log.record("addProcess"),
    startAssistant: log.record("startAssistant"),
    toggleDim: log.record("toggleDim"),
    copyMap: log.record("copyMap"),
    setAddingPoint: log.record("setAddingPoint"),
    newId: () => `f0000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
  };
  const tree = TodayContent({ board, dim: extra.dim ?? false, addingPoint: extra.addingPoint ?? false, focusProcessId: null, headAction: completeButton(), actions });
  return { tree, log };
}

test("dall'alto: la testa con il bottone della vista, i riquadri, i punti di analisi, chi fa cosa, la mappa (P37: i numeri prima)", () => {
  const html = render(fixtureBoard());
  const at = (needle: string) => {
    const index = html.indexOf(needle);
    assert.notEqual(index, -1, needle);
    return index;
  };
  assert.ok(at('data-b="view-head"') < at('data-b="kpis"'));
  assert.ok(at('data-b="kpis"') < at('data-b="points"'));
  assert.ok(at('data-b="points"') < at("Chi fa cosa e con quali strumenti"));
  assert.ok(at("Chi fa cosa e con quali strumenti") < at('data-b="legend"'));
  assert.ok(at('data-b="legend"') < at('data-b="map-tools"'));
  assert.ok(at('data-b="map-tools"') < at('data-b="map"'), "i riquadri prima della mappa");
  // La testa: l'occhiello, il titolo di sempre con il nome dell'unità in corsivo, la descrizione, a destra il bottone della vista.
  assert.match(html, /<p class="b-eyebrow">Processi di oggi<\/p><h2 class="b-h">Come lavora oggi <i>Ufficio acquisti<\/i><\/h2><p class="b-lede">Compra materiali e servizi per gli altri uffici\.<\/p><\/div><div class="b-head-action"><button type="button" class="b-btn b-primary" data-b="button" data-variant="primary">Completa la mappatura<\/button><\/div>/);
  const tiles = [...html.matchAll(/<div class="b-kv">([^<]*)<\/div><div class="b-kl">([^<]*)<\/div>/g)].map((match) => `${match[1]} ${match[2]}`);
  assert.deepEqual(tiles, ["6 passi in 2 processi", "28,5 h ore a settimana", "3 passi dove decide una persona", "2 passi da validare"]);
  // La legenda: i tre attriti, il rombo, «da validare»; la riga dei conteggi; i due strumenti della mappa.
  assert.match(html, /<i class="b-adot" data-tone="crit" aria-hidden="true" data-b="dot"><\/i>attrito forte<\/span>/);
  assert.match(html, /<i class="b-adot b-diamond" aria-hidden="true" data-b="dot"><\/i>decide una persona<\/span>/);
  assert.match(html, /<span class="b-legend-note">«da validare» = passo da confermare<\/span>/);
  assert.match(html, /<span class="b-counts">2 da validare · 4 confermati · 5 attriti<\/span>/);
  assert.match(html, /<button type="button" class="b-fchip" aria-pressed="false" data-b="filter-chip">Evidenzia attriti<\/button>/);
  assert.match(html, /<button type="button" class="b-btn b-ghost" data-b="button" data-variant="ghost">Copia la mappa come testo<\/button>/);
  assert.match(html, /<h3 class="b-sh">I processi, uno per uno<small>clicca un passo per aprire attività, persone, dati, attriti, tempi e volumi<\/small><\/h3>/);
  // Chi fa cosa: chiuso, con il conteggio nel suo sommario.
  assert.match(html, /<details class="b-sec" data-b="section"><summary>Chi fa cosa e con quali strumenti<small>4 ruoli · 6 strumenti<\/small><\/summary>/);
});

test("al più un bottone pieno nella vista: quello della testa; il drawer è una schermata sua", () => {
  const html = render(fixtureBoard());
  assert.equal((html.match(/data-variant="primary"/g) ?? []).length, 1);
  assert.equal((render(fixtureBoard({ classified: true })).match(/data-variant="primary"/g) ?? []).length, 1);
});

test("un'unità vuota: «Nessun passo, per ora» con «Inizia con l'assistente» pieno e «Aggiungi un passo»; niente riquadri e niente mappa", () => {
  const empty = fixtureBoard({ empty: true });
  const html = render(empty);
  assert.match(html, /<div class="b-empty" data-b="empty"><b>Nessun passo, per ora<\/b><p>Racconta il lavoro all&#x27;assistente, oppure aggiungi il primo passo\.<\/p><div class="b-empty-actions"><button type="button" class="b-btn b-primary" data-b="button" data-variant="primary">Inizia con l&#x27;assistente<\/button><button type="button" class="b-btn" data-b="button" data-variant="outline">Aggiungi un passo<\/button><\/div><\/div>/);
  assert.doesNotMatch(html, /data-b="kpis"|data-b="map"|b-head-action/, "il bottone della testa resta fuori: uno solo pieno");
  assert.equal((html.match(/data-variant="primary"/g) ?? []).length, 1);
  const { tree, log } = content(empty);
  press(tree, "Inizia con l'assistente");
  press(tree, "Aggiungi un passo");
  assert.deepEqual(log.calls, [["startAssistant"], ["addStep", null]]);
  // In sola lettura «Aggiungi un passo» è spento.
  assert.match(render(fixtureBoard({ empty: true, readOnly: true })), /<button disabled="" type="button" class="b-btn" data-b="button" data-variant="outline">Aggiungi un passo<\/button>/);
});

test("una board in sola lettura disegna i suoi controlli spenti, o non li disegna, dal primo disegno (F9)", () => {
  const html = render(fixtureBoard({ readOnly: true }));
  assert.doesNotMatch(html, /<textarea|<input|<select|\+ passo|\+ processo|\+ punto|b-grip|b-row-ctl|b-more-edit/);
  for (const button of html.match(/<button[^>]*aria-label="(Togli un tuo voto|Aggiungi un voto)"[^>]*>/g) ?? []) assert.match(button, /disabled=""/);
  // Senza le tabelle della 0039: lo dice una riga, e la board si legge e basta.
  const missing = render({ ...fixtureBoard(), store: "mancante" });
  assert.match(missing, /<p class="b-notice">La board è in sola lettura per qualche minuto: si sta aggiornando\.<\/p>/);
  assert.doesNotMatch(missing, /<textarea|\+ passo/);
});

test("i controlli della vista: la scoperta sul posto, «Evidenzia attriti», «Copia la mappa come testo», i passi delle tabelle", () => {
  const classified = fixtureBoard({ classified: true });
  const { tree, log } = content(classified);
  const [headline] = ofType(tree, LineInPlace);
  assert.equal(headline.props.value, "Un terzo del tempo va a rincorrere richieste incomplete e consegne in ritardo.");
  assert.equal(headline.props.placeholder, "La scoperta, in una frase.");
  (headline.props.onCommit as (next: string, base: string) => void)("", headline.props.value as string);
  const [dim] = ofType(tree, FilterChip);
  assert.equal(textOf(dim.props.children), "Evidenzia attriti");
  (dim.props.onToggle as () => void)();
  press(tree, "Copia la mappa come testo");
  // A2 è nelle righe di tutti i suoi ruoli e strumenti: ognuna lo apre.
  const refs = clickables(tree, "A2 · Confronto delle offerte");
  assert.equal(refs.length, 7);
  (refs[0].props.onClick as () => void)();
  assert.deepEqual(log.calls, [
    ["dispatch", { t: "board.set", field: "headline", prev: "Un terzo del tempo va a rincorrere richieste incomplete e consegne in ritardo.", next: null }],
    ["toggleDim"],
    ["copyMap"],
    ["openStep", I.confronto],
  ]);
  // «Evidenzia attriti» premuto.
  assert.equal(ofType(content(classified, { dim: true }).tree, FilterChip)[0].props.pressed, true);
  assert.equal(dim.props.pressed, false);
});

test("i punti di analisi: titolo, prima frase e «Dettagli»; si validano, si eliminano con «Annulla», se ne aggiunge uno che nasce con il testo (P35, P53–P57)", () => {
  const board = fixtureBoard();
  const html = render(board);
  // Due punti: uno validato (nessuna didascalia), uno dalla chat («da fonti · chat»).
  assert.equal((html.match(/data-b="point"/g) ?? []).length, 2);
  assert.match(html, /<div class="b-point" data-status="fonte" data-b="point">.*?<i class="b-point-cap">da fonti · chat<\/i>/);
  const { tree, log } = content(board);
  const [first, second] = ofType(tree, AnalysisPoint);
  const pointTree = AnalysisPoint(second.props as never);
  press(pointTree, "Segna come validata");
  press(pointTree, "Elimina nota");
  const [title] = ofType(AnalysisPoint(first.props as never), LineInPlace);
  (title.props.onCommit as (next: string, base: string) => void)("Solleciti", "Il tempo va nei solleciti");
  const secondId = board.analysis[1].id;
  assert.deepEqual(log.named("dispatch"), [
    [{ t: "note.set", noteId: secondId, field: "status", prev: "fonte", next: "validato" }],
    [{ t: "note.remove", noteId: secondId }, { undo: "Nota eliminata." }],
    [{ t: "note.set", noteId: board.analysis[0].id, field: "title", prev: "Il tempo va nei solleciti", next: "Solleciti" }],
  ]);
  // «+ punto» apre un punto nuovo, che nasce quando ha un testo.
  press(tree, "+ punto");
  assert.deepEqual(log.named("setAddingPoint"), [[true]]);
  const adding = content(board, { addingPoint: true });
  assert.deepEqual(clickables(adding.tree, "+ punto"), [], "mentre se ne scrive uno, il bottone non c'è");
  const [draft] = ofType(adding.tree, DraftPoint);
  (draft.props.onDone as (point: unknown) => void)(null);
  (draft.props.onDone as (point: unknown) => void)({ title: "", text: "Le offerte arrivano tardi." });
  assert.deepEqual(adding.log.calls, [
    ["setAddingPoint", false],
    ["setAddingPoint", false],
    ["dispatch", { t: "note.add", noteId: "f0000000-0000-4000-8000-000000000001", stepId: null, lane: "analisi", text: "Le offerte arrivano tardi.", title: null }],
  ]);
  // Senza punti e prima del completamento la sezione non c'è; dopo il completamento c'è, con «+ punto».
  assert.doesNotMatch(render({ ...board, analysis: [] }), /Punti di analisi/);
  assert.match(render({ ...fixtureBoard({ classified: true }), analysis: [] }), /<h3 class="b-sh">Punti di analisi<\/h3><div class="b-points" data-b="points"><\/div><button type="button" class="b-add b-add-point" data-b="add">\+ punto<\/button>/);
});

test("la mappa come testo senza appunti: il drawer stretto mette il fuoco nel testo appena aperto, che si sceglie da sé (P62)", async () => {
  const { CopyDrawer } = await import("./today-view.tsx");
  const { Drawer } = await import("../ui/drawer.tsx");
  const opened = CopyDrawer({ text: "A · Dall'ordine alla consegna", onClose() {} });
  assert.equal(opened.type, Drawer);
  assert.equal(opened.props.open, true);
  assert.equal(opened.props.wide, undefined, "la forma stretta");
  assert.equal(opened.props.initialFocus, "body", "il fuoco nel testo dal dialogo stesso, non da un timer dopo «Chiudi»");
  const area = opened.props.children as { type: string; props: Record<string, unknown> };
  assert.equal(area.type, "textarea");
  assert.equal(area.props.readOnly, true);
  let selected = 0;
  (area.props.onFocus as (event: unknown) => void)({ currentTarget: { select: () => (selected += 1) } });
  assert.equal(selected, 1, "preso il fuoco, il testo è scelto");
  assert.equal(CopyDrawer({ text: null, onClose() {} }).props.open, false);
});
