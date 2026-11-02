import test, { before } from "node:test";
import assert from "node:assert/strict";
import { enableTsxImports } from "./tsx-test-loader.ts";

// «Cosa chiedi» draws two NeedChecklist lists (the proposed questions and «Altre domande di questo use
// case») with the same `selected` and `onChange`: a tick in one list keeps the ticks of the other.
let fields: typeof import("./fields.tsx");

before(async () => {
  await enableTsxImports();
  fields = await import("./fields.tsx");
});

type El = { type: unknown; props: Record<string, unknown> & { children?: unknown } };
/** The checkboxes of a rendered NeedChecklist tree (the elements with `onCheckedChange`), in order. */
function boxesOf(node: unknown, out: El[] = []): El[] {
  if (Array.isArray(node)) {
    for (const n of node) boxesOf(n, out);
    return out;
  }
  if (node && typeof node === "object" && "props" in (node as object)) {
    const el = node as El;
    if (typeof el.props.onCheckedChange === "function") out.push(el);
    boxesOf(el.props.children, out);
  }
  return out;
}

const proposed = [{ id: "q-a", title: "Domanda A" }];
const others = [
  { id: "q-b", title: "Domanda B", meta: "Bruna · Cliente" },
  { id: "q-c", title: "Domanda C", meta: "Carlo · Cliente" },
];

/** Ticks (or unticks) the box at `index` of a list and returns what the list hands to `onChange`. */
function tick(items: ReadonlyArray<{ id: string; title: string; meta?: string }>, selected: string[], index: number, value: boolean): string[] {
  let next: string[] | null = null;
  const tree = fields.NeedChecklist({ labelledBy: "h", items, selected, onChange: (ids: string[]) => (next = ids) });
  const boxes = boxesOf(tree);
  assert.equal(boxes.length, items.length, "one box per question");
  (boxes[index].props.onCheckedChange as (v: boolean) => void)(value);
  assert.ok(next, "onChange called");
  return next;
}

test("a tick under «Altre domande» keeps the proposed ticks", () => {
  assert.deepEqual([...tick(others, ["q-a"], 0, true)].sort(), ["q-a", "q-b"]);
});

test("a tick among the proposed keeps the ticks under «Altre domande»", () => {
  assert.deepEqual([...tick(proposed, ["q-b", "q-c"], 0, true)].sort(), ["q-a", "q-b", "q-c"]);
});

test("unticking removes only that question, ticking twice adds it once", () => {
  assert.deepEqual(tick(others, ["q-a", "q-b", "q-c"], 1, false), ["q-a", "q-b"]);
  assert.deepEqual([...tick(others, ["q-a", "q-b"], 0, true)].sort(), ["q-a", "q-b"]);
});
