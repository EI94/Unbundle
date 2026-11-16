import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { focusBeforeRemoving, focusKeeper, neighbourIndex, type FocusNode } from "./focus.ts";

// (Mappatura board) Dove va il fuoco quando un controllo sparisce o si spegne sotto di lui (F1 del riferimento): mai
// sulla pagina. Un DOM finto, con quello che ui/focus.ts legge; e una prova sui sorgenti: nessun controllo della board
// si spegne (`disabled`) per uno stato che cambia mentre ha il fuoco.

/** Un elemento finto: tag, attributi `data-b`, ruolo, figli; `focus()` lo fa diventare l'elemento attivo. */
class Fake implements FocusNode {
  parentElement: Fake | null = null;
  children: Fake[] = [];
  readonly doc: { activeElement: unknown };
  readonly tag: string;
  readonly attrs: Record<string, string>;
  constructor(doc: { activeElement: unknown }, tag: string, attrs: Record<string, string> = {}, kids: Fake[] = []) {
    this.doc = doc;
    this.tag = tag;
    this.attrs = attrs;
    for (const kid of kids) {
      kid.parentElement = this;
      this.children.push(kid);
    }
  }
  get ownerDocument() {
    return this.doc;
  }
  get isConnected() {
    return true;
  }
  matches(selector: string): boolean {
    const data = /^\[data-b="([a-z-]+)"\]$/.exec(selector);
    if (data) return this.attrs["data-b"] === data[1];
    const role = /^\[role="([a-z]+)"\]$/.exec(selector);
    if (role) return this.attrs.role === role[1];
    return selector === this.tag;
  }
  closest(selector: string): Fake | null {
    if (this.matches(selector)) return this;
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }
  private all(): Fake[] {
    return this.children.flatMap((child) => [child, ...child.all()]);
  }
  querySelector(selector: string): Fake | null {
    const direct = /^:scope > (.+)$/.exec(selector);
    if (direct) return this.children.find((child) => child.matches(direct[1])) ?? null;
    return this.all().find((node) => node.matches(selector)) ?? null;
  }
  querySelectorAll(selector: string): Fake[] {
    return this.all().filter((node) => node.matches(selector));
  }
  focus(): void {
    this.doc.activeElement = this;
  }
}

/** Una lista di elementi `item` con due bottoni ciascuno (la spunta e la «×»), e il «+» in fondo, dentro un drawer. */
function list(item: string, count: number, add: "dentro" | "fuori" | "nessuno" = "dentro") {
  const doc = { activeElement: null as unknown };
  const items = Array.from({ length: count }, (_, index) => new Fake(doc, "div", { "data-b": item, id: String(index) }, [new Fake(doc, "button", { name: "spunta" }), new Fake(doc, "button", { name: "×" })]));
  const plus = new Fake(doc, "button", { "data-b": "add" });
  const container = new Fake(doc, "div", { "data-b": "lista" }, add === "dentro" ? [...items, plus] : items);
  const block = new Fake(doc, "div", { "data-b": "block" }, add === "fuori" ? [container, plus] : [container]);
  const dialog = new Fake(doc, "div", { role: "dialog" }, [block]);
  const remove = (index: number) => items[index].children[1];
  return { doc, items, plus, dialog, remove };
}

test("il vicino di un elemento tolto: quello dopo, o quello prima; nessuno se era solo", () => {
  assert.deepEqual([neighbourIndex(3, 0), neighbourIndex(3, 1), neighbourIndex(3, 2), neighbourIndex(1, 0)], [1, 2, 1, -1]);
});

test("prima di togliere un chip, una nota, un punto: il fuoco va alla «×» del vicino, poi al «+», poi al drawer", () => {
  // Nel mezzo e in testa: la «×» di quello dopo; in fondo: quella di quello prima.
  for (const [at, expected] of [[1, "2"], [0, "1"], [2, "1"]] as const) {
    const { doc, items, remove } = list("note", 3);
    remove(at).focus();
    focusBeforeRemoving(remove(at), '[data-b="note"]');
    assert.equal(doc.activeElement, items[Number(expected)].children[1], `dalla ${at}`);
  }
  // L'ultimo della lista: il «+» della lista (dentro, come «+ nota» e «+ ruolo»; o subito fuori, come «+ punto»).
  const alone = list("chip", 1);
  alone.remove(0).focus();
  focusBeforeRemoving(alone.remove(0), '[data-b="chip"]');
  assert.equal(alone.doc.activeElement, alone.plus);
  const point = list("point", 1, "fuori");
  point.remove(0).focus();
  focusBeforeRemoving(point.remove(0), '[data-b="point"]');
  assert.equal(point.doc.activeElement, point.plus);
  // Senza «+» (la corsia piena): il drawer.
  const full = list("note", 1, "nessuno");
  full.remove(0).focus();
  focusBeforeRemoving(full.remove(0), '[data-b="note"]');
  assert.equal(full.doc.activeElement, full.dialog);
  // Il fuoco non era sul controllo (un clic che non lo dà, o era altrove): niente si muove.
  const elsewhere = list("note", 2);
  elsewhere.items[1].children[0].focus();
  focusBeforeRemoving(elsewhere.remove(0), '[data-b="note"]');
  assert.equal(elsewhere.doc.activeElement, elsewhere.items[1].children[0]);
});

test("un lavoro che dura: alla fine il fuoco torna alla vista se è andato perso, altrimenti resta dov'è", () => {
  const body = { name: "pagina" };
  const doc = { activeElement: null as unknown, body };
  const view = new Fake(doc, "section", { role: "tabpanel" });
  const button = new Fake(doc, "button");
  button.parentElement = view;
  const keep = focusKeeper(button as unknown as Element, doc as unknown as Document);
  doc.activeElement = body;
  keep();
  assert.equal(doc.activeElement, view, "il bottone è sparito: la vista");
  const other = new Fake(doc, "button");
  doc.activeElement = other;
  focusKeeper(button as unknown as Element, doc as unknown as Document)();
  assert.equal(doc.activeElement, other, "chi ha preso il fuoco lo tiene");
});

const ROOT = fileURLToPath(new URL("..", import.meta.url));
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".tsx") ? [path] : [];
  });
}

test("nessun controllo della board si spegne per uno stato che cambia mentre ha il fuoco: aria-disabled e il clic che non parte", () => {
  const busy = /\b(busy|working|uploading|adding|phase|saving|pending)\b/;
  const offenders = sources(ROOT).flatMap((path) =>
    [...readFileSync(path, "utf8").matchAll(/(?<![-\w])disabled=\{([^}]*)\}/g)].filter((match) => busy.test(match[1])).map((match) => `${relative(ROOT, path)}: disabled={${match[1]}}`),
  );
  assert.deepEqual(offenders, []);
  // I controlli che lavorano a lungo restano raggiungibili.
  const read = (path: string) => readFileSync(join(ROOT, path), "utf8");
  assert.match(read("companion/companion.tsx"), /readOnly=\{busy\}\s+aria-disabled=\{busy \|\| undefined\}/);
  assert.match(read("companion/companion.tsx"), /aria-disabled=\{busy \|\| undefined\} data-action="send"/);
  assert.match(read("companion/companion.tsx"), /field\.current\?\.focus\(\);\s+send\(suggestion\);/, "il suggerimento sparisce: il cursore va nel campo");
  assert.match(read("companion/complete-button.tsx"), /aria-disabled=\{working \|\| undefined\}[\s\S]*if \(working\) return;\s+const keep = focusKeeper\(event\.currentTarget\);[\s\S]*\.then\(keep\);/);
  assert.match(read("companion/documents.tsx"), /aria-disabled=\{uploading \|\| undefined\}[\s\S]*if \(!uploading\) input\.current\?\.click\(\);/);
  assert.match(read("companion/proposals.tsx"), /aria-disabled=\{phase !== "idle" \|\| undefined\}[\s\S]*if \(phase === "idle"\) void propose\(\);/);
  assert.match(read("companion/proposals.tsx"), /aria-disabled=\{adding \|\| undefined\}[\s\S]*if \(!adding\) void add\(\);/);
  // Le «×» che tolgono un elemento portano prima il fuoco al vicino.
  assert.match(read("ui/edit.tsx"), /focusBeforeRemoving\(event\.currentTarget as unknown as FocusNode, '\[data-b="note"\]'\);\s+p\.onRemove\(\);/);
  assert.match(read("board/today-view.tsx"), /focusBeforeRemoving\(event\.currentTarget as unknown as FocusNode, '\[data-b="point"\]'\);\s+actions\.dispatch\(\{ t: "note\.remove"/);
});
