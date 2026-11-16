import test from "node:test";
import assert from "node:assert/strict";
import { closesOnEscape, inertOthers, tabbables, wrapFocus, type Focusable, type InertNode } from "./modal-panel.ts";

// Il pannello dell'assistente sopra la pagina, sotto i 1280 px (docs/mappatura/MAPPATURA-BOARD-PIANO.md §1.5; F2): un
// dialogo modale vero. Il resto della pagina e dell'app inerte (il velo no: lo chiude), il Tab che gira dentro il
// pannello, Escape che lo chiude dovunque sia il fuoco. Elementi finti.

/** Un albero finto: `name`, i figli, e chi è inerte. */
function node(name: string, children: InertNode[] = [], inert = false): InertNode & { name: string } {
  const element = { name, children, inert, parentElement: null as InertNode | null };
  for (const child of children) child.parentElement = element;
  return element;
}

test("sopra la pagina tutto il resto è inerte (barra laterale e barra in alto comprese), il velo no; chiuso, torna com'era", () => {
  const panel = node("pannello");
  const column = node("colonna della board", [], true);
  const board = node("board", [column, panel]);
  const scrim = node("velo");
  const toast = node("toast della pagina");
  const root = node("radice della board", [board, scrim, toast]);
  const sidebar = node("barra laterale");
  const topbar = node("barra in alto");
  const main = node("pagina", [topbar, root]);
  const already = node("un portale già inerte", [], true);
  const body = node("body", [sidebar, main, already]);
  const nameOf = (item: unknown) => (item as { name: string }).name;
  const restore = inertOthers(panel, body, (item) => nameOf(item) === "velo");
  const inert = (items: InertNode[]) => items.map((item) => [nameOf(item), item.inert]);
  assert.deepEqual(inert([column, scrim, toast, topbar, sidebar, already, panel, board, root, main]), [
    ["colonna della board", true],
    ["velo", false],
    ["toast della pagina", true],
    ["barra in alto", true],
    ["barra laterale", true],
    ["un portale già inerte", true],
    ["pannello", false],
    ["board", false],
    ["radice della board", false],
    ["pagina", false],
  ]);
  restore();
  // Torna attivo solo quello che il pannello ha reso inerte: la colonna (inerte per conto suo) e il portale restano.
  assert.deepEqual(inert([column, toast, topbar, sidebar, already]), [
    ["colonna della board", true],
    ["toast della pagina", false],
    ["barra in alto", false],
    ["barra laterale", false],
    ["un portale già inerte", true],
  ]);
});

test("il Tab gira dentro il pannello: la guardia in fondo porta al primo elemento, quella in cima all'ultimo; le guardie e i nascosti non contano", () => {
  const focused: string[] = [];
  const item = (name: string, visible = true, guard = false): Focusable & { name: string } => ({
    name,
    offsetParent: visible ? {} : null,
    hasAttribute: (attribute: string) => guard && attribute === "data-focus-guard",
    focus: () => void focused.push(name),
  });
  const items = [item("guardia in cima", true, true), item("Chiudi"), item("Carica documenti (nascosto)", false), item("campo"), item("Invia"), item("guardia in fondo", true, true)];
  const panel = { querySelectorAll: () => items };
  assert.deepEqual(tabbables(panel).map((entry) => (entry as unknown as { name: string }).name), ["Chiudi", "campo", "Invia"]);
  wrapFocus(panel, "end");
  wrapFocus(panel, "start");
  assert.deepEqual(focused, ["Chiudi", "Invia"]);
  // Un pannello senza niente da raggiungere: niente si rompe.
  wrapFocus({ querySelectorAll: () => [] }, "end");
});

test("Escape chiude il pannello dovunque sia il fuoco, tranne dentro un altro dialogo aperto sopra di lui", () => {
  const panelDialog = { name: "il pannello" };
  const drawer = { name: "un drawer del compagno" };
  const panel = { contains: (target: unknown) => target === panelDialog };
  const inside = { closest: () => panelDialog };
  const inDrawer = { closest: () => drawer };
  const onPage = { closest: () => null };
  assert.equal(closesOnEscape({ key: "Escape", defaultPrevented: false, target: inside }, panel), true);
  assert.equal(closesOnEscape({ key: "Escape", defaultPrevented: false, target: onPage }, panel), true, "il fuoco è finito sulla pagina");
  assert.equal(closesOnEscape({ key: "Escape", defaultPrevented: false, target: null }, panel), true);
  assert.equal(closesOnEscape({ key: "Escape", defaultPrevented: false, target: inDrawer }, panel), false, "il drawer chiude prima se stesso");
  assert.equal(closesOnEscape({ key: "Escape", defaultPrevented: true, target: inside }, panel), false, "un campo l'ha già usato");
  assert.equal(closesOnEscape({ key: "Enter", defaultPrevented: false, target: inside }, panel), false);
});
