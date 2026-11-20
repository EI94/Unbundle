import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import { PUBLIC_TEXT, brandLine, fillPublic } from "../../lib/public/text.ts";
import { PUBLIC_FIELD, PUBLIC_LINK, PUBLIC_PRIMARY, PUBLIC_SECONDARY } from "./classes.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11) Il guscio unico delle pagine fuori dalla dashboard:
// il marchio in alto non cliccabile, con «{Cliente} · con Lateral Space»; il piè di pagina che dà la pagina; una scheda
// sola per il link che non vale e una per l'errore, con il solo «Riprova». Reso in HTML, senza browser. Dati inventati.

let shell: typeof import("./public-shell.tsx");
let card: typeof import("./state-card.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let h: (type: unknown, props: unknown, ...children: unknown[]) => unknown;

before(async () => {
  await enableTsxImports();
  shell = await import("./public-shell.tsx");
  card = await import("./state-card.tsx");
  const react = await import("react");
  h = (type, props, ...children) => react.createElement(type as never, props as never, ...(children as never[]));
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const textOf = (html: string) => readable(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const render = (element: unknown) => readable(renderToStaticMarkup(element));
const count = (html: string, pattern: RegExp) => (html.match(pattern) ?? []).length;
const DIR = new URL("./", import.meta.url);

test("the brand: small, at the top, never a link; «{Cliente} · con Lateral Space» when the client is known", () => {
  const plain = render(h(shell.PublicShell, {}, h("p", {}, "Contenuto")));
  assert.match(plain, /^<main data-slot="public-shell" class="mx-auto w-full max-w-\[40rem\] min-w-0 px-4 /, "una colonna, 16 px di margine al telefono");
  const brand = /<p data-slot="public-brand"[^>]*>[\s\S]*?<\/p>/.exec(plain)?.[0] ?? "";
  assert.ok(brand, plain);
  assert.equal(textOf(brand), "U Unbundle");
  assert.match(brand, /<span aria-hidden="true"[^>]*>U<\/span>/, "la «U» è solo grafica");
  assert.ok(!/<a\b/.test(brand), "il marchio non porta fuori");
  assert.ok(plain.indexOf("public-brand") < plain.indexOf("Contenuto"), "in alto");
  assert.ok(!plain.includes("<footer"), "niente piè di pagina se la pagina non ne dà uno");

  const client = render(h(shell.PublicShell, { client: "  Cliente   Demo " }, null));
  assert.equal(textOf(/<p data-slot="public-brand"[^>]*>[\s\S]*?<\/p>/.exec(client)?.[0] ?? ""), "U Cliente Demo · con Lateral Space");
  assert.equal(brandLine(""), "Unbundle");
  assert.equal(brandLine(null), "Unbundle");
  assert.equal(brandLine("Cliente Demo"), "Cliente Demo · con Lateral Space");
});

test("the footer: what the page gives, «Come usiamo le tue risposte» and the contact, every link 44 px", () => {
  const html = render(
    h(
      shell.PublicShell,
      {
        footer: h(
          "div",
          {},
          h(shell.PublicNoticeLink, { href: "/privacy/ai-readiness/tok" }),
          h(shell.PublicContact, { label: "aiuto@cliente-demo.test", href: "mailto:aiuto@cliente-demo.test" }),
        ),
      },
      h("p", {}, "Contenuto"),
    ),
  );
  const footer = /<footer data-slot="public-footer"[^>]*>[\s\S]*<\/footer>/.exec(html)?.[0] ?? "";
  assert.ok(footer, html);
  assert.equal(textOf(footer), "Come usiamo le tue risposte Serve aiuto? Scrivi a aiuto@cliente-demo.test");
  assert.ok(html.indexOf("Contenuto") < html.indexOf("<footer"), "in fondo");
  const links = [...footer.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(links.length, 2);
  assert.ok(links[0].includes('href="/privacy/ai-readiness/tok"'));
  assert.ok(links[1].includes('href="mailto:aiuto@cliente-demo.test"'));
  for (const link of links) assert.match(link, /\bmin-h-11\b/, link);
  assert.ok(!html.includes("Lateral Space via Unbundle"), "il marchio una volta sola, in alto");
});

test("one card for a link that no longer works: «Questo link non vale più.», the e-mail sentence unless the page says otherwise", () => {
  const html = render(h(card.PublicStateCard, { kind: "link" }));
  assert.equal(count(html, /<h1\b/g), 1);
  assert.equal(textOf(html), "Questo link non vale più. Rispondi all'email che hai ricevuto: arriva a chi ti ha scritto.");
  assert.ok(!/<button\b/.test(html), "nessun pulsante");

  const own = render(h(card.PublicStateCard, { kind: "link", body: "Chiedi al formatore il link nuovo." }, h("a", { href: "/login" }, "Accedi")));
  assert.equal(textOf(own), "Questo link non vale più. Chiedi al formatore il link nuovo. Accedi");

  const screen = render(h(card.PublicInvalidScreen, { client: "Cliente Demo" }));
  assert.equal(textOf(screen), "U Cliente Demo · con Lateral Space Questo link non vale più. Rispondi all'email che hai ricevuto: arriva a chi ti ha scritto.");
});

test("one card for errors, with only «Riprova», full width and 48 px: no second button", () => {
  let retried = 0;
  const html = render(h(card.PublicStateCard, { kind: "error", retry: () => (retried += 1) }));
  assert.equal(textOf(html), "Questa pagina non si è caricata. Riprova");
  assert.equal(count(html, /<button\b/g), 1);
  const button = /<button\b[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(button, /\bmin-h-12\b/);
  assert.match(button, /\bw-full\b/);
  assert.doesNotMatch(button, /\bwhitespace-nowrap\b|\bh-\(--btn-h\)/, "un testo lungo va a capo, il pulsante cresce");
  assert.match(button, /type="button"/);
  assert.ok(!/Ricarica/.test(html));
  assert.equal(retried, 0, "rendering does not retry");

  // Il testo sotto il titolo è della pagina: quello delle risposte già inviate vale solo dove ce ne sono (/r, /rispondi).
  const withBody = render(h(card.PublicErrorScreen, { retry: () => undefined, body: PUBLIC_TEXT.error.saved }));
  assert.equal(textOf(withBody), "U Unbundle Questa pagina non si è caricata. Le risposte che hai già inviato sono salve. Riprova");
  // Senza `retry` (una scheda resa dal server, dove non c'è un confine d'errore) la stessa scheda, e «Riprova» ricarica.
  const server = render(h(card.PublicStateCard, { kind: "error" }));
  assert.equal(textOf(server), "Questa pagina non si è caricata. Riprova");
  assert.equal(count(server, /<button\b/g), 1);
  // Al tocco: il `retry` di Next, senza argomenti; altrimenti la pagina si ricarica.
  const source = readFileSync(new URL("retry-button.tsx", DIR), "utf8");
  assert.match(source, /onClick=\{\(\) => \(retry \? retry\(\) : window\.location\.reload\(\)\)\}/);
  assert.match(source, /^"use client";/, "solo il pulsante è del client");
});

test("the light root of the public route layouts, rendered by the server", () => {
  const html = render(h(shell.PublicRoot, {}, h("p", {}, "x")));
  assert.match(html, /^<div data-slot="public-root" class="survey-light min-h-dvh w-full min-w-0 overflow-x-clip bg-background text-foreground">/);
  // `clip`, non `hidden`: con `hidden` la radice diventa un contenitore che scorre e le barre `sticky` non restano in vista.
  assert.doesNotMatch(html, /overflow-x-hidden/);
});

test("the sizes: the main button full width and 48 px, the rest at least 44 px, fields at 16 px; long labels wrap", () => {
  for (const classes of [PUBLIC_PRIMARY, PUBLIC_SECONDARY]) {
    for (const needed of ["min-h-12", "h-auto", "w-full", "text-base", "whitespace-normal", "wrap-anywhere", "text-center"]) {
      assert.ok(classes.split(" ").includes(needed), `${needed} in «${classes}»`);
    }
  }
  assert.match(PUBLIC_LINK, /\bmin-h-11\b/);
  assert.match(PUBLIC_FIELD, /\bh-11\b/);
  assert.match(PUBLIC_FIELD, /(?:^| )text-base\b/);
  assert.match(PUBLIC_FIELD, /\bmd:text-base\b/, "anche da 768 px, dove il campo di base scende a 14 px");
});

test("the texts: the words of §4 outside the dashboard, no code, «AI» and neutral gender", () => {
  const texts = [
    PUBLIC_TEXT.brand,
    PUBLIC_TEXT.notice,
    PUBLIC_TEXT.help,
    PUBLIC_TEXT.writeTo,
    PUBLIC_TEXT.invalidLink.title,
    PUBLIC_TEXT.invalidLink.body,
    PUBLIC_TEXT.error.title,
    PUBLIC_TEXT.error.saved,
    PUBLIC_TEXT.error.retry,
    PUBLIC_TEXT.loading,
    brandLine("Cliente Demo"),
  ];
  assert.deepEqual(findHubForbiddenIn(texts, "esterno"), []);
  for (const text of texts) assert.doesNotMatch(text, /\b[A-Z]{2}-\d{4}\b|\bIA\b/, text);
  assert.equal(fillPublic("{Cliente} e {Altro}", { Cliente: "Cliente Demo" }), "Cliente Demo e {Altro}");
  assert.equal(fillPublic("{toString}", {}), "{toString}", "nessuna chiave ereditata");
});

test("the shell has no portal, no browser dialog and no inline text outside the text module", () => {
  const files = readdirSync(DIR).filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f));
  assert.ok(files.includes("public-shell.tsx") && files.includes("state-card.tsx"));
  for (const file of files) {
    const source = readFileSync(new URL(file, DIR), "utf8");
    assert.doesNotMatch(source, /from "(?:@\/components\/ui\/(?:select|dialog|popover|tooltip|sheet|dropdown-menu|sonner|alert-dialog)|sonner)"/, `${file}: portale`);
    assert.doesNotMatch(source, /window\.(?:confirm|prompt|alert)\b/, file);
    // Solo «Riprova» è del client (il tocco); il guscio e le schede si rendono sul server.
    if (file !== "retry-button.tsx") assert.doesNotMatch(source, /^\s*"use client"/m, `${file}: si rende sul server`);
  }
  // Le parole a schermo vengono dal modulo dei testi: nei componenti non ci sono frasi scritte a mano.
  const code = (file: string) =>
    readFileSync(new URL(file, DIR), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  for (const file of ["public-shell.tsx", "state-card.tsx", "retry-button.tsx"]) {
    for (const sentence of ["non vale", "Riprova", "Come usiamo", "Lateral Space", "Serve aiuto"]) assert.ok(!code(file).includes(sentence), `${file}: «${sentence}»`);
  }
});
