import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { enableTsxImports } from "../../use-cases/detail/referent/tsx-test-loader.ts";
import { FIXTURE_IDS, fixtureBoard } from "../../../lib/mappatura/board-fixture.ts";
import { locateStep, type MappingBoard } from "../../../lib/mappatura/board-model.ts";
import { clickable, clickables, elements, ofType, press, recorder, textOf, type AnyElement } from "./test-support/elements.ts";

// Il drawer di un passo (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.3; P20, P21, P51–P58, P67, F6): ogni controllo
// manda l'operazione giusta; spostare a sinistra, a destra e in un altro processo; un passo nuovo nasce dal suo titolo,
// e senza titolo niente; il fuoco nel titolo di un passo nuovo; in sola lettura si legge e basta. I controlli si
// chiamano dall'albero degli elementi, senza browser.

await enableTsxImports();
const { Lane, StepDrawerBody, StepText, draftDrawerHead, drawerFocus, stepDrawerHead } = await import("./step-drawer.tsx");
const { DrawerStatic } = await import("../ui/drawer.tsx");
const { ChipInput, LevelButtons, NoteItem, NumberInput, TextInPlace } = await import("../ui/edit.tsx");
const { DraftText, LineInPlace } = await import("./in-place.tsx");

const I = FIXTURE_IDS;
const EXPAND = [Lane, StepText] as never[];

function body(board: MappingBoard, stepId: string, options: { editable?: boolean; addingLane?: "attivita" | "attriti" | "dati" | "tempi" | null } = {}) {
  const log = recorder();
  let seq = 0;
  const actions = {
    dispatch: log.record("dispatch"),
    openStep: log.record("openStep"),
    close: log.record("close"),
    notify: log.record("notify"),
    newId: () => `f0000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`,
    setAdding: log.record("setAdding"),
  };
  const place = locateStep(board, stepId)!;
  const tree = StepDrawerBody({ board, place, editable: options.editable ?? true, addingLane: options.addingLane ?? null, actions });
  return { tree, log, actions, place };
}
const h = <P extends object>(type: (props: P) => ReactNode, props: Omit<P, "children"> | null = null, ...children: ReactNode[]) =>
  createElement(type as unknown as FunctionComponent<Omit<P, "children">>, props, ...children);
const html = (node: ReactNode) => renderToStaticMarkup(h(DrawerStatic, { wide: true, context: "contesto", title: "titolo" }, node));

test("spostare: a sinistra, a destra, in un altro processo; i bottoni spenti dove il passo è già in fondo (P58, F6)", () => {
  const board = fixtureBoard();
  const { tree, log } = body(board, I.confronto);
  press(tree, "Sposta a sinistra");
  press(tree, "Sposta a destra");
  const moveTo = elements(tree).find((element) => element.type === "select" && element.props["aria-label"] === "Sposta in")!;
  // Il menu offre gli altri processi con posto, con la lettera; la prima voce è il suo nome.
  assert.deepEqual(ofType(moveTo, "option").map((option) => [option.props.value, textOf(option.props.children)]), [["", "Sposta in"], [I.processB, "B · Dall'ordine alla consegna"]]);
  (moveTo.props.onChange as (event: unknown) => void)({ target: { value: I.processB } });
  assert.deepEqual(log.named("dispatch"), [
    [{ t: "step.move", stepId: I.confronto, processId: I.processA, beforeId: I.richieste }],
    [{ t: "step.move", stepId: I.confronto, processId: I.processA, beforeId: I.ordine }],
    [{ t: "step.move", stepId: I.confronto, processId: I.processB, beforeId: null }],
  ]);
  // Il primo passo non va più a sinistra, l'ultimo non va più a destra.
  assert.equal(clickable(body(board, I.richieste).tree, "Sposta a sinistra").props.disabled, true);
  assert.equal(clickable(body(board, I.richieste).tree, "Sposta a destra").props.disabled, false);
  assert.equal(clickable(body(board, I.ordine).tree, "Sposta a destra").props.disabled, true);
});

test("in fondo: da dove viene il passo, «Conferma il passo» pieno (la strada avanti del drawer) o «Segna da validare», «Elimina il passo»", () => {
  const board = fixtureBoard();
  const { tree, log } = body(board, I.confronto);
  const confirm = clickable(tree, "Conferma il passo");
  assert.equal(confirm.props.variant, "primary");
  assert.equal(clickables(tree, "").filter((element) => element.props.variant === "primary").length, 0);
  assert.equal(elements(tree).filter((element) => element.props.variant === "primary").length, 1, "un solo bottone pieno nel drawer");
  (confirm.props.onClick as () => void)();
  assert.deepEqual(log.named("dispatch"), [[{ t: "step.set", stepId: I.confronto, field: "status", prev: "da_validare", next: "confermato" }]]);
  assert.match(html(tree), /<span class="b-dr-origin">Dalla chat<\/span>/);
  // Un passo confermato si può rimettere da validare, con un bottone contornato.
  const confirmed = body(board, I.ordine);
  assert.equal(clickable(confirmed.tree, "Segna da validare").props.variant, "outline");
  // Eliminare: il passo sparisce, il toast offre «Annulla», il drawer si chiude.
  press(confirmed.tree, "Elimina il passo");
  assert.deepEqual(confirmed.log.calls, [
    ["dispatch", { t: "step.remove", stepId: I.ordine }, { undo: "Passo eliminato." }],
    ["close"],
  ]);
  // Un passo che uno use case elenca non si elimina: lo dice subito, e niente parte.
  const linkedBoard = { ...board, processes: board.processes.map((process) => ({ ...process, steps: process.steps.map((step) => (step.id === I.ordine ? { ...step, useCaseIds: ["uc-1"] } : step)) })) };
  const linked = body(linkedBoard, I.ordine);
  press(linked.tree, "Elimina il passo");
  assert.deepEqual(linked.log.calls, [["notify", "Questo passo è collegato a uno use case: non si elimina."]]);
});

test("le note di una corsia: si scrivono, si validano, si eliminano con «Annulla»; «+ nota» ne apre una nuova che nasce solo con un testo (P51–P57)", () => {
  const board = fixtureBoard();
  const { tree, log } = body(board, I.richieste);
  const notes = ofType(tree, NoteItem, EXPAND);
  assert.deepEqual(notes.map((note) => [(note.props.note as { text: string }).text, note.props.label]), [
    ["Si apre la casella condivisa", "Nota: Attività"],
    ["Si copia la richiesta nel foglio", "Nota: Attività"],
    ["Richieste incomplete", "Nota: Attriti"],
    ["Nessun modulo unico", "Nota: Attriti"],
    ["Elenco dei fornitori", "Nota: Dati e documenti"],
    ["Quaranta richieste a settimana", "Nota: Tempi e volumi"],
  ]);
  const [first, , , fromChat] = notes;
  const firstId = (first.props.note as { id: string }).id;
  const chatId = (fromChat.props.note as { id: string }).id;
  (first.props.onText as (next: string, base: string) => void)("Si apre la casella", "Si apre la casella condivisa");
  (first.props.onText as (next: string, base: string) => void)("", "Si apre la casella condivisa");
  (fromChat.props.onToggle as () => void)();
  (fromChat.props.onRemove as () => void)();
  assert.deepEqual(log.named("dispatch"), [
    [[{ t: "note.set", noteId: firstId, field: "text", prev: "Si apre la casella condivisa", next: "Si apre la casella" }]],
    [[{ t: "note.remove", noteId: firstId }]],
    [{ t: "note.set", noteId: chatId, field: "status", prev: "fonte", next: "validato" }],
    [{ t: "note.remove", noteId: chatId }, { undo: "Nota eliminata." }],
  ]);
  // «+ nota» in fondo a ogni corsia apre la nota nuova; nella corsia aperta c'è il campo, non il bottone.
  press(tree, "Aggiungi nota: Attriti", EXPAND);
  assert.deepEqual(log.named("setAdding"), [["attriti"]]);
  const adding = body(board, I.richieste, { addingLane: "attriti" });
  assert.deepEqual(clickables(adding.tree, "Aggiungi nota: Attriti", EXPAND), []);
  const [draft] = ofType(adding.tree, DraftText, EXPAND);
  assert.equal(draft.props.label, "Nota: Attriti");
  (draft.props.onDone as (text: string | null) => void)(null);
  (draft.props.onDone as (text: string | null) => void)("Moduli diversi per ufficio");
  assert.deepEqual(adding.log.calls, [
    ["setAdding", null],
    ["setAdding", null],
    ["dispatch", { t: "note.add", noteId: "f0000000-0000-4000-8000-000000000001", stepId: I.richieste, lane: "attriti", text: "Moduli diversi per ufficio" }],
  ]);
});

test("i campi del passo: attrito a quattro livelli, frequenza, ore, ruoli e strumenti, testi; il valore di prima viaggia con quello nuovo", () => {
  const board = fixtureBoard();
  const { tree, log } = body(board, I.confronto);
  const [level] = ofType(tree, LevelButtons, EXPAND);
  // Il livello mostrato è «Medio» (c'è un attrito scritto e nessun livello scelto): si legge nel nome del gruppo.
  assert.equal(level.props.label, "Attrito: Medio");
  assert.deepEqual((level.props.options as Array<{ label: string }>).map((option) => option.label), ["Nessuno", "Lieve", "Medio", "Forte"]);
  (level.props.onChange as (value: number) => void)(3);
  const frequency = elements(tree, EXPAND).find((element) => element.type === "select" && element.props.value === "settimanale")!;
  (frequency.props.onChange as (event: unknown) => void)({ target: { value: "mensile" } });
  const [hours] = ofType(tree, NumberInput, EXPAND);
  (hours.props.onCommit as (next: number | null, base: number | null) => void)(9.5, 8);
  const [who, tools] = ofType(tree, ChipInput, EXPAND);
  assert.equal(tools.props.tool, true);
  (who.props.onChange as (next: string[]) => void)(["Buyer", "Ufficio tecnico", "Segreteria"]);
  const description = ofType(tree, TextInPlace, EXPAND).find((element) => element.props.label === "Descrizione del passo")!;
  (description.props.onCommit as (next: string, base: string) => void)("Tre offerte, confrontate a mano.", "Per ogni richiesta si chiedono tre offerte e si confrontano.");
  assert.deepEqual(log.named("dispatch"), [
    [{ t: "step.set", stepId: I.confronto, field: "friction", prev: null, next: 3 }],
    [{ t: "step.set", stepId: I.confronto, field: "frequency", prev: "settimanale", next: "mensile" }],
    [{ t: "step.set", stepId: I.confronto, field: "hoursWeek", prev: 8, next: 9.5 }],
    [{ t: "step.set", stepId: I.confronto, field: "who", prev: ["Buyer", "Ufficio tecnico"], next: ["Buyer", "Ufficio tecnico", "Segreteria"] }],
    [{ t: "step.set", stepId: I.confronto, field: "description", prev: "Per ogni richiesta si chiedono tre offerte e si confrontano.", next: "Tre offerte, confrontate a mano." }],
  ]);
  // «Decide una persona»: il nome della decisione e chi decide che cosa; un campo vuoto parte da null.
  const decisionLabel = ofType(tree, LineInPlace, EXPAND).find((element) => element.props.placeholder === "Nome della decisione")!;
  (decisionLabel.props.onCommit as (next: string, base: string) => void)("Offerta scelta", "");
  assert.deepEqual(log.named("dispatch").at(-1), [{ t: "step.set", stepId: I.confronto, field: "decisionLabel", prev: null, next: "Offerta scelta" }]);
});

test("i collegamenti aprono gli altri passi; senza collegamenti la sezione non c'è", () => {
  const board = fixtureBoard();
  const { tree, log } = body(board, I.confronto);
  press(tree, "A1 · Raccolta delle richieste");
  press(tree, "A3 · Scelta del fornitore");
  assert.deepEqual(log.named("openStep"), [[I.richieste], [I.scelta]]);
  const out = html(tree);
  assert.match(out, /<span class="b-links-k">Dipende da<\/span>/);
  assert.match(out, /<span class="b-links-k">Serve a<\/span>/);
  assert.doesNotMatch(html(body(board, I.ordine).tree), /Collegamenti/);
});

test("l'ordine del drawer: descrizione, chip, «Entra» ed «Esce», le quattro corsie, «Decide una persona», «Eccezioni», «Collegamenti», «Altri dettagli», il fondo (P20)", () => {
  const out = html(body(fixtureBoard(), I.richieste).tree);
  const labels = [...out.matchAll(/<p class="b-k">([^<]+)<\/p>|<div class="b-human" data-b="human"><b>([^<]+)<\/b>|<summary>([^<]+)<small>|<summary>([^<]+)<\/summary>/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4]);
  assert.deepEqual(labels, ["Entra", "Esce", "Attività", "Attriti", "Dati e documenti", "Tempi e volumi", "Decide una persona", "Eccezioni", "Collegamenti", "Altri dettagli"]);
  assert.ok(out.indexOf('data-b="step-description"') < out.indexOf('data-b="step-chips"'));
  assert.ok(out.indexOf('data-b="step-chips"') < out.indexOf(">Entra<"));
  assert.ok(out.indexOf("Altri dettagli") < out.indexOf('data-b="step-foot"'));
  // Ruoli e strumenti come chip, con «+ ruolo» e «+ strumento»; le note con la loro didascalia.
  assert.match(out, /<span class="b-chip" data-b="chip">Buyer<button type="button" aria-label="Togli Buyer"/);
  assert.match(out, /<span class="b-chip b-tool" data-b="chip">E-mail<button/);
  assert.match(out, />\+ ruolo<\/button>/);
  assert.match(out, />\+ strumento<\/button>/);
  assert.match(out, /<span class="b-note-cap">da fonti · chat<\/span>/);
  assert.match(out, /<span class="b-note-cap">ipotesi<\/span>/);
});

test("in sola lettura il drawer si legge: «—» per un elenco o un campo vuoto, nessun controllo (P21, F9)", () => {
  const board = fixtureBoard({ readOnly: true });
  const { tree } = body(board, I.ordine, { editable: false });
  const out = html(tree);
  assert.doesNotMatch(out, /<textarea|<input|<select|\+ nota|\+ ruolo|Conferma il passo|Elimina il passo|Sposta/);
  // Le corsie vuote e i campi vuoti dicono «—»; le liste piene sono elenchi.
  assert.ok((out.match(/<p class="b-dr-none">—<\/p>/g) ?? []).length >= 6);
  assert.match(out, /<span class="b-chip" data-b="chip">Buyer<\/span>/, "i chip senza la «×»");
  assert.match(out, /<span class="b-dr-value">Ogni settimana<\/span>/);
  assert.match(out, /<span class="b-dr-value">Consegna<\/span>/);
  const richieste = html(body(board, I.richieste, { editable: false }).tree);
  assert.match(richieste, /<ul class="b-l"><li>Richieste incomplete<\/li><li>Nessun modulo unico<\/li><\/ul>/);
  assert.match(richieste, /<span class="b-dec-label">Richiesta completa<\/span><p class="b-dr-text">Chi compra decide se la richiesta è completa\.<\/p>/);
  // I livelli dell'attrito si vedono, spenti.
  assert.match(richieste, /<button type="button" aria-pressed="true" disabled="">Forte<\/button>/);
});

test("un passo nuovo nasce dal suo titolo, con il cursore dentro; senza titolo non nasce niente (P30, P53, P55)", () => {
  const board = fixtureBoard();
  const log = recorder();
  let seq = 0;
  const newId = () => `f0000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const head = draftDrawerHead({ board, processId: I.processB, actions: { dispatch: log.record("dispatch"), newId }, onCreated: log.record("created") });
  assert.equal(head.context, "Dall'ordine alla consegna · B3");
  const title = head.title as AnyElement;
  assert.equal(title.type, LineInPlace);
  assert.equal(title.props.autoFocus, true);
  assert.equal(title.props.value, "");
  assert.equal(title.props.placeholder, "Titolo del passo");
  (title.props.onCommit as (next: string) => void)("");
  (title.props.onCommit as (next: string) => void)("   ");
  assert.deepEqual(log.calls, [], "senza titolo niente");
  (title.props.onCommit as (next: string) => void)("Archivio delle bolle");
  assert.deepEqual(log.calls, [
    ["dispatch", [{ t: "step.add", stepId: "f0000000-0000-4000-8000-000000000001", processId: I.processB, title: "Archivio delle bolle" }]],
    ["created", "f0000000-0000-4000-8000-000000000001"],
  ]);
  // Il dialogo mette il fuoco nel titolo di un passo nuovo, su «Chiudi» per un passo che c'è già.
  assert.equal(drawerFocus({ kind: "draft", processId: null }), "title");
  assert.equal(drawerFocus({ kind: "step", stepId: I.ordine }), "close");
  const source = readFileSync(new URL("./step-drawer.tsx", import.meta.url), "utf8");
  assert.match(source, /<Drawer open=\{open\} onClose=\{p\.actions\.close\} wide context=\{head\.context\} title=\{head\.title\} initialFocus=\{drawerFocus\(target\)\}>/);
  // Il passo appena nato porta il cursore nella descrizione.
  const created = StepDrawerBody({ board, place: locateStep(board, I.ordine)!, editable: true, created: true, addingLane: null, actions: { dispatch() {}, openStep() {}, close() {}, notify() {}, newId, setAdding() {} } });
  const description = elements(created, EXPAND).find((element) => element.props.label === "Descrizione del passo")!;
  assert.equal(description.props.autoFocus, true);
});

test("la testa di un passo: la riga del contesto e il titolo sul posto, che non si svuota", () => {
  const board = fixtureBoard();
  const log = recorder();
  const head = stepDrawerHead({ place: locateStep(board, I.scelta)!, editable: true, actions: { dispatch: log.record("dispatch") } });
  assert.equal(head.context, "Dalla richiesta all'ordine · A3");
  const title = head.title as AnyElement;
  (title.props.onCommit as (next: string, base: string) => void)("", "Scelta del fornitore");
  (title.props.onCommit as (next: string, base: string) => void)("Scelta dell'offerta", "Scelta del fornitore");
  assert.deepEqual(log.calls, [["dispatch", { t: "step.set", stepId: I.scelta, field: "title", prev: "Scelta del fornitore", next: "Scelta dell'offerta" }]]);
  assert.equal(stepDrawerHead({ place: locateStep(board, I.scelta)!, editable: false, actions: { dispatch() {} } }).title, "Scelta del fornitore");
});
