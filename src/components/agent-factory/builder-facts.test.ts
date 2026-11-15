// (8.0c) La riga di «Chi costruisce» a 390 px: le parole vanno a capo intere; solo l'e-mail può spezzarsi dove serve.
import test, { before } from "node:test";
import assert from "node:assert/strict";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

let render: (email: string | null, facts: string[]) => string;

before(async () => {
  await enableTsxImports();
  const react = await import("react");
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { BuilderFacts } = await import("./builder-facts.tsx");
  render = (email, facts) => renderToStaticMarkup(react.createElement(BuilderFacts, { email, facts }));
});

/** Le classi dello `span` che contiene `text` (il più interno ancora aperto). */
function classesAround(html: string, text: string): string[] {
  const at = html.indexOf(text);
  assert.ok(at >= 0, text);
  const open: string[][] = [];
  for (const tag of html.slice(0, at).matchAll(/<(\/?)span(?: class="([^"]*)")?>/g)) {
    if (tag[1]) open.pop();
    else open.push(tag[2]?.split(" ") ?? []);
  }
  return open.at(-1) ?? [];
}

test("i fatti della riga vanno a capo per parole intere, mai a metà di «Sviluppatore»", () => {
  const html = render(null, ["esterno", "Sviluppatore", "tutti i casi", "CLI da collegare"]);
  assert.match(html, />esterno · Sviluppatore · tutti i casi · CLI da collegare</);
  const outer = classesAround(html, "esterno · Sviluppatore");
  assert.ok(outer.includes("break-words"), outer.join(" "));
  assert.ok(!html.includes("break-all"), "senza e-mail, niente break-all");
});

test("l'e-mail di Lateral Space, una parola lunga, va a capo dove serve; il resto per parole", () => {
  const email = "nome.cognome.molto.lungo@lateralspace.ai";
  const html = render(email, ["Sviluppatore", "tutti i casi", "CLI collegata"]);
  assert.deepEqual(classesAround(html, email), ["break-all"]);
  const outer = classesAround(html, " · Sviluppatore");
  assert.ok(outer.includes("break-words") && !outer.includes("break-all"), outer.join(" "));
  assert.match(html, /<span class="break-all">nome\.cognome\.molto\.lungo@lateralspace\.ai<\/span> · Sviluppatore · tutti i casi · CLI collegata/);
});
