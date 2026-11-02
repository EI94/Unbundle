import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import type { NeedUseCaseRef } from "../../lib/use-cases/needs.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// «Per 3 use case», «Serve anche ad altri 2 use case» (rilascio «Pulizia»): gli use case di
// un'esigenza dietro un `<details>` chiuso, con il titolo dell'esigenza per i lettori di schermo.
let needUseCases: typeof import("./need-use-cases.tsx");
let disclosure: typeof import("./disclosure.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  needUseCases = await import("./need-use-cases.tsx");
  disclosure = await import("./disclosure.tsx");
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
  assert.ok(summary.includes("Per 3\u00a0use\u00a0case"), summary);
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
      [REFS[0].id, "XV-0001\u00a0· Smistamento"],
      [REFS[1].id, "XV-0002\u00a0· Fatture"],
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
  // Il «·» resta con il codice: «XV-0001 ·» / «Smistamento», mai il «·» in testa alla riga. Il `title` resta com'è.
  assert.ok(html.includes('<span class="font-mono">XV-0001</span>\u00a0· Smistamento'));
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

test("`defaultOpen`: aperto quando la pagina si rende; senza, chiuso come prima", () => {
  const opening = (props: Record<string, unknown>) =>
    /<details[^>]*>/.exec(renderToStaticMarkup(createElement(disclosure.Disclosure, { summary: "Accessi", slot: "needs-area", children: "x", ...props })))?.[0] ?? "";
  assert.equal(opening({ defaultOpen: true }), '<details data-slot="needs-area" open="">');
  assert.equal(opening({}), '<details data-slot="needs-area">', "nessun attributo open");
  assert.equal(opening({ defaultOpen: false }), '<details data-slot="needs-area">');
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
  // Rilascio «Panoramica»: niente parole della vecchia Roadmap.
  assert.ok(!source.includes("Roadmap"));
  const block = /export const NEEDS_BOARD_TEXT = Object\.freeze\(\{([\s\S]*?)\n\}\);/.exec(source)?.[1] ?? "";
  const texts = [...block.matchAll(/^\s+\w+: "([^"]*)",$/gm)].map((match) => match[1]);
  // Rilascio 4: la lista sola non ha più «Requisiti» né le schede del trimestre.
  assert.ok(texts.includes("Prossimi passi") && texts.includes("Niente da chiedere con questi filtri."), block);
  for (const gone of ["Requisiti", "Cosa vi chiediamo", "Il ritorno da confermare", "Dopo la scheda A.8", "Chi conferma i numeri"]) assert.ok(!texts.some((text) => text.includes(gone)), gone);
  assert.equal(texts.length, block.split("\n").filter((line) => line.trim()).length, "ogni voce è una stringa su una riga");
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
});

test("needs-board.tsx si rende sul server: dai moduli «use client» importa solo componenti; need-draft.ts non ha la direttiva", () => {
  const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");
  const board = read("./needs-board.tsx");
  assert.ok(!/^\s*["']use client["']/.test(board), "needs-board.tsx è un componente del server");
  const imports = [...board.matchAll(/import\s+(type\s+)?\{([^}]*)\}\s+from\s+"([^"]+)"/g)].map(([, type, names, from]) => ({ type: Boolean(type), names: names.split(",").map((name) => name.trim()).filter(Boolean), from }));
  const fileOf = (from: string) =>
    from.startsWith("@/") ? new URL(`../../${from.slice(2)}`, import.meta.url) : new URL(from, new URL("./needs-board.tsx", import.meta.url));
  let clientModules = 0;
  for (const entry of imports) {
    if (entry.type) continue;
    const base = fileOf(entry.from);
    const source = [".tsx", ".ts", "/index.tsx", "/index.ts"].map((ext) => {
      try {
        return readFileSync(new URL(`${base.href}${ext}`), "utf8");
      } catch {
        return null;
      }
    }).find((text) => text !== null);
    if (source === undefined || source === null) continue;
    if (!/^\s*["']use client["']/.test(source)) continue;
    clientModules += 1;
    for (const name of entry.names) assert.match(name.replace(/^type\s+/, ""), /^[A-Z]/, `${entry.from}: «${name}» da un modulo client non è un componente`);
  }
  assert.ok(clientModules >= 1, "almeno list-focus.tsx (HashFocusLink)");
  // moreRowsText e NEED_ROWS_SHOWN arrivano da moduli senza direttiva: si possono chiamare sul server.
  assert.match(board, /import \{ moreRowsText \} from "\.\/detail\/need-draft";/);
  assert.ok(!/^\s*["']use client["']/.test(read("./detail/need-draft.ts")), "need-draft.ts senza direttiva");
  assert.ok(!/^\s*["']use client["']/.test(readFileSync(new URL("../../lib/use-cases/needs.ts", import.meta.url), "utf8")), "needs.ts senza direttiva");
});
