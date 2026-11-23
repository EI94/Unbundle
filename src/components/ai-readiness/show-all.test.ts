import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// (Ondata 0, docs/ui-10/PROPOSTA-10.md §6.3 voce 0.15) AI Readiness: gli use case proposti, le persone invitate, gli
// insight e gli export non si tagliano più senza dirlo. Le prime righe restano in vista, le altre dietro «Mostra tutti
// (N)»: dal nono use case in poi si può ancora aggiungerlo agli use case. Il campo `riskLevel` è la priorità e si chiama
// così. (Ondata 7b) Tre righe in vista. Resa in HTML, senza database. Dati inventati.

let showAll: typeof import("./show-all.tsx");
let render: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;

before(async () => {
  await enableTsxImports();
  showAll = await import("./show-all.tsx");
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup: render } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const rows = (n: number) => Array.from({ length: n }, (_, i) => `XX-00${String(i + 1).padStart(2, "0")}`);
const list = (items: string[], visible: number) =>
  render(h(showAll.ShowAll, { items, visible, children: (code: string) => h("p", { key: code, "data-row": code, children: code }) }));

test("every row is there: the first ones in view, the others behind «Mostra tutti (N)»", () => {
  const html = list(rows(10), 8);
  assert.equal(html.match(/data-row=/g)?.length, 10, "nessuna riga tagliata");
  const details = html.indexOf("<details");
  assert.ok(details > html.indexOf('data-row="XX-0008"'), "le prime 8 fuori dalla piega");
  assert.ok(html.indexOf('data-row="XX-0009"') > details && html.indexOf('data-row="XX-0010"') > details, "la nona e la decima dentro");
  assert.match(html, /Mostra tutti \(10\)/);
});

test("a short list has no fold", () => {
  for (const n of [0, 1, 8]) {
    const html = list(rows(n), 8);
    assert.equal(html.match(/data-row=/g)?.length ?? 0, n);
    assert.doesNotMatch(html, /<details|Mostra tutti/, String(n));
  }
});

test("(ondata 7b) the four AI Readiness lists fold behind «Mostra tutti (N)» after three rows instead of cutting them", () => {
  const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
  const collection = read("./collection-tab.tsx");
  assert.ok(collection.includes("<ShowAll items={m.people} visible={3} inList>"), "persone");
  assert.ok(collection.includes("<ShowAll items={p.proposals} visible={3} inList>"), "use case proposti");
  assert.ok(read("./insights-tab.tsx").includes("<ShowAll items={p.insights} visible={3}>"), "insight");
  assert.ok(read("./settings-tab.tsx").includes("<ShowAll items={p.exports} visible={3}>"), "file scaricati");
  // La pagina passa le liste intere: nessuna riga tagliata.
  const page = read("../../app/(dashboard)/dashboard/[workspaceId]/ai-readiness/page.tsx");
  for (const list of ["people: respondents.map(", "proposals={useCases.map(", "insights={ordered.map(", "exports={exports.map("]) assert.ok(page.includes(list), list);
  assert.doesNotMatch(page, /(?:respondents|useCases|insights|exports)\.slice\(0, \d+\)/, "niente righe tagliate");
  // Il campo `riskLevel` è la priorità, e si chiama così.
  assert.doesNotMatch(read("../../lib/ai-readiness/dashboard-view.ts"), /rischio n\/d/);
  assert.match(read("../../lib/ai-readiness/dashboard-text.ts"), /priority: \(value: string\) => `priorità \$\{value\.toLowerCase\(\)\}`/);
});

test("in a list with divided rows the fold divides its rows too, and «Mostra tutti» lines up", () => {
  const html = render(h(showAll.ShowAll, { items: rows(5), visible: 3, inList: true, children: (code: string) => h("p", { key: code, children: code }) }));
  assert.match(html, /<details class="group divide-y">/);
  assert.match(html, /<summary class="[^"]*px-4[^"]*">/);
});
