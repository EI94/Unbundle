import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// «‹ Torna alla lista» (rilascio «Pulizia», menu «⋯» di «Priorità»): il pulsante sparisce con il
// grafico; il fuoco va al titolo della lista, non sul <body>, e solo dopo quel clic.
let focus: typeof import("./list-focus.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown, ...children: unknown[]) => unknown;
before(async () => {
  await enableTsxImports();
  focus = await import("./list-focus.tsx");
  const react = await import("react");
  createElement = (type, props, ...children) => react.createElement(type as never, props as never, ...(children as never[]));
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const CLICK = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

test("il segno di «‹ Torna alla lista» vale una volta, e solo per il clic che resta nella pagina", () => {
  assert.equal(focus.takeListFocus(), false, "senza clic il fuoco resta dov'è");
  focus.markListFocus();
  assert.equal(focus.takeListFocus(), true);
  assert.equal(focus.takeListFocus(), false, "una volta sola");
  assert.equal(focus.staysInPage(CLICK), true);
  for (const key of ["metaKey", "ctrlKey", "shiftKey", "altKey"] as const) assert.equal(focus.staysInPage({ ...CLICK, [key]: true }), false, key);
  assert.equal(focus.staysInPage({ ...CLICK, button: 1 }), false, "clic centrale: nuova scheda");
});

test("il titolo della lista: solo per i lettori di schermo, raggiungibile dal codice e non dal Tab", () => {
  const html = renderToStaticMarkup(createElement(focus.ListFocusTarget, { title: "Da costruire" }));
  assert.equal(html, '<h2 tabindex="-1" data-slot="list-focus" class="sr-only">Da costruire</h2>');
  const link = renderToStaticMarkup(createElement(focus.BackToListLink, { href: "/dashboard/x/use-cases?vista=priorita" }, "Torna alla lista"));
  assert.match(link, /^<a [^>]*href="\/dashboard\/x\/use-cases\?vista=priorita"/);
  assert.ok(link.includes("Torna alla lista"));
});

test("«Priorità» mette il titolo nella lista e nel vuoto della lista, e «‹ Torna alla lista» sopra i grafici", () => {
  const source = readFileSync(new URL("./priority-view.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("<BackToListLink href={listHref}>{PRIORITY_TEXT.backToList}</BackToListLink>"));
  assert.ok(source.includes("{header ?? <ListFocusTarget title={PRIORITY_TEXT.build} />}"), "nel vuoto, senza grafico");
  assert.match(source, /<ListFocusTarget title=\{PRIORITY_TEXT\.build\} \/>\s*<PriorityList\b/, "prima della lista");
  const own = readFileSync(new URL("./list-focus.tsx", import.meta.url), "utf8");
  assert.match(own, /useEffect\(\(\) => \{\s*if \(takeListFocus\(\)\) ref\.current\?\.focus\(\);\s*\}, \[\]\);/);
});
