import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// (Ondata 0, docs/ui-10/PROPOSTA-10.md §6.3 voce 0.15) AI Readiness: gli use case proposti, le persone invitate, gli
// insight e gli export non si tagliano più senza dirlo. Le prime righe restano in vista, le altre dietro «Mostra tutti
// (N)»: dal nono use case in poi si può ancora portarlo nel Portfolio. Il campo `riskLevel` è la priorità e si chiama
// così. Resa in HTML, senza database. Dati inventati.

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

test("the AI Readiness page folds its four lists instead of cutting them, and calls the priority «Priorità»", () => {
  const page = readFileSync(new URL("../../app/(dashboard)/dashboard/[workspaceId]/ai-readiness/page.tsx", import.meta.url), "utf8");
  for (const [items, visible] of [["insights", 8], ["respondents", 12], ["useCases", 8], ["exports", 8]] as const) {
    assert.ok(page.includes(`<ShowAll items={${items}} visible={${visible}}>`), items);
    assert.doesNotMatch(page, new RegExp(`${items}\\.slice\\(0, \\d+\\)\\.map`), `${items}: niente righe tagliate`);
  }
  assert.doesNotMatch(page, /rischio n\/d/);
  assert.ok(page.includes('{item.riskLevel ? `Priorità: ${item.riskLevel.toLowerCase()}` : "Priorità non indicata"}'));
});
