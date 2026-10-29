import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import type { NeedUseCaseRef } from "../../lib/use-cases/needs.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// «Per 3 use case», «Serve anche ad altri 2 use case» (rilascio «Pulizia»): gli use case di
// un'esigenza dietro un `<details>` chiuso, con il titolo dell'esigenza per i lettori di schermo.
let needUseCases: typeof import("./need-use-cases.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  needUseCases = await import("./need-use-cases.tsx");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const REFS: NeedUseCaseRef[] = [
  { id: "aaaaaaaa-0000-4000-8000-000000000001", code: "XV-0001", title: "Smistamento" },
  { id: "bbbbbbbb-0000-4000-8000-000000000002", code: "XV-0002", title: "Fatture" },
  { id: "cccccccc-0000-4000-8000-000000000003", code: null, title: "Preventivi" },
];
const hrefOf = (id: string) => `/uc/${id}?capitolo=cosa-serve`;

const render = () =>
  renderToStaticMarkup(
    createElement(needUseCases.NeedUseCasesDisclosure, { summary: "Per 3 use case", context: "Accesso al gestionale", useCases: REFS, hrefOf }),
  );

test("«Per 3 use case»: un <details> chiuso, con il titolo dell'esigenza solo per i lettori di schermo", () => {
  const html = render();
  const opening = /<details[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(opening, /data-slot="need-use-cases"/);
  assert.doesNotMatch(opening.replace(/="[^"]*"/g, ""), /\sopen\b/, "chiuso di default: nessun attributo open");
  assert.match(opening, /open:basis-full/, "aperto prende tutta la riga");
  const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? "";
  assert.ok(summary.includes("Per 3 use case"));
  assert.ok(summary.includes('<span class="sr-only">: Accesso al gestionale</span>'));
});

test("«Per 3 use case»: un link per use case, «codice · titolo» o il titolo solo", () => {
  const html = render();
  const links = [...html.matchAll(/<a [^>]*data-need-use-case="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)];
  assert.equal(links.length, 3);
  const text = (inner: string) => inner.replace(/<[^>]+>/g, "");
  assert.deepEqual(
    links.map((link) => [link[1], text(link[2])]),
    [
      [REFS[0].id, "XV-0001 · Smistamento"],
      [REFS[1].id, "XV-0002 · Fatture"],
      [REFS[2].id, "Preventivi"],
    ],
  );
  for (const ref of REFS) assert.ok(html.includes(`href="${hrefOf(ref.id)}"`), ref.id);
  // Sottolineati sempre, come gli altri link dell'area: in una riga grigia il solo colore non basta.
  for (const link of links) {
    const classes = /class="([^"]*)"/.exec(link[0])?.[1].split(" ") ?? [];
    assert.ok(classes.includes("underline") && classes.includes("hover:decoration-2"), link[0]);
    assert.ok(!classes.includes("hover:underline"), link[0]);
    // La sottolineatura sta dentro la riga da 20 px: `line-clamp` (overflow nascosto) non la taglia.
    assert.ok(classes.includes("underline-offset-2") && !classes.includes("underline-offset-4"), link[0]);
    assert.match(link[2], /^<span class="line-clamp-2 leading-5 break-words">/, link[2]);
  }
  assert.ok(html.includes('title="XV-0001 · Smistamento"'));
  assert.ok(html.includes('title="Preventivi"'));
});

test("la freccia segue solo il suo <details>: chiusa anche dentro un «Già a posto» aperto", () => {
  const html = render();
  assert.ok(html.includes("[[open]&gt;summary&gt;&amp;]:rotate-90"), "la classe della freccia, com'è nel markup");
  assert.ok(!html.includes("group-open/"));
  const source = readFileSync(new URL("./disclosure.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("[[open]>summary>&]:rotate-90"));
  assert.ok(!source.includes("group/disclosure") && !source.includes("group-open/"));
});

test("le righe con un <details> dentro sono <div>, non <p>: dentro un <p> il parser spezzerebbe il DOM", () => {
  const meta = '<div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">';
  for (const file of ["./needs-board.tsx", "./detail/section-needs.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(source.includes(meta), file);
    assert.ok(!source.includes('<p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">'), file);
  }
});

test("i testi della vista «Cosa serve» passano la guardia delle parole", () => {
  // needs-board.tsx porta con sé la testata della pagina (e le sue azioni): qui se ne leggono i testi dal sorgente.
  const source = readFileSync(new URL("./needs-board.tsx", import.meta.url), "utf8");
  const block = /export const NEEDS_BOARD_TEXT = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(source)?.[1] ?? "";
  const texts = [...block.matchAll(/^\s+\w+: "([^"]*)",$/gm)].map((match) => match[1]);
  assert.ok(texts.includes("Requisiti") && texts.includes("Niente da chiedere con questi filtri."), block);
  assert.equal(texts.length, block.split("\n").filter((line) => line.trim()).length, "ogni voce è una stringa su una riga");
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
});
