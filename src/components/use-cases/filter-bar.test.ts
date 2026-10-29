import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// La barra dei filtri resa in HTML (rilascio «Panoramica»): «Togli i filtri» nella riga anche al
// telefono, come sola ✕ per i revisori e come parola per i contributori; «Altri filtri» senza la sua
// copia dentro, contro la barra al telefono. I componenti client chiamano `useRouter()`: un router
// che non naviga.
let bar: typeof import("./filter-bar.tsx");
let render: (props: Record<string, unknown>) => string;
before(async () => {
  await enableTsxImports();
  bar = await import("./filter-bar.tsx");
  const { createElement } = (await import("react")) as unknown as { createElement: (type: unknown, props: unknown, ...children: unknown[]) => unknown };
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  const { AppRouterContext } = (await import("next/dist/shared/lib/app-router-context.shared-runtime.js")) as unknown as { AppRouterContext: unknown };
  const router = { push() {}, replace() {}, refresh() {}, prefetch() {}, back() {}, forward() {} };
  render = (props) =>
    renderToStaticMarkup(createElement((AppRouterContext as { Provider: unknown }).Provider, { value: router }, createElement(bar.FilterBar, props)));
});

const BASE = "/dashboard/ws/use-cases";
const MORE = { channels: [], areas: [{ value: "Finanza", label: "Finanza" }], agents: [{ value: "LIBRA", label: "LIBRA" }], labs: [], quarters: [], infos: [] };
const SOURCE = readFileSync(new URL("../../../src/components/use-cases/filter-bar.tsx", import.meta.url), "utf8");
const POPOVER = readFileSync(new URL("../../../src/components/ui/popover.tsx", import.meta.url), "utf8");

function reviewer(query: Record<string, string>, active = true, kind = "filtro"): string {
  const clearHref = `${BASE}?vista=${query.vista}${query.mostra ? `&mostra=${query.mostra}` : ""}`;
  return render({ basePath: BASE, query, mode: "revisore", kind, more: MORE, active, clearHref });
}

/** I link con il nome «Togli i filtri» per i lettori di schermo: la ✕ dei revisori. */
const clearTags = (html: string) => [...html.matchAll(/<a\b[^>]*aria-label="Togli i filtri"[^>]*>/g)].map((match) => match[0]);

test("revisori, con un filtro: «Togli i filtri» è l'ultimo controllo della riga a ogni larghezza; al telefono la sola ✕ da 44 px", () => {
  for (const [query, kind, href] of [
    [{ vista: "panoramica", tipo: "costruire" }, "filtro", `${BASE}?vista=panoramica`],
    [{ vista: "da-decidere", agente: "LIBRA" }, "filtro", `${BASE}?vista=da-decidere`],
    [{ vista: "panoramica", mostra: "matrice", origine: "adoption" }, "nessuno", `${BASE}?vista=panoramica&amp;mostra=matrice`],
  ] as const) {
    const html = reviewer(query, true, kind);
    const tags = clearTags(html);
    assert.equal(tags.length, 1, "una sola, nella riga");
    assert.ok(tags[0].includes(`href="${href}"`), tags[0]);
    const classes = /class="([^"]*)"/.exec(tags[0])![1].split(" ");
    for (const name of ["min-h-11", "min-w-11", "px-0", "sm:min-h-8", "sm:min-w-0", "sm:px-2.5"]) assert.ok(classes.includes(name), name);
    assert.ok(!classes.includes("px-2.5"), "al telefono niente margini: la ✕ sta nel bersaglio da 44 px");
    // Dopo la ✕ la barra si chiude: l'ultimo controllo, in un riquadro che non si nasconde più al telefono.
    assert.ok(html.endsWith(`<span class="hidden sm:inline">Togli i filtri</span></a></span></div>`), html.slice(-200));
    assert.match(html, /<span class="shrink-0"><a\b[^>]*aria-label="Togli i filtri"[^>]*><svg\b[^>]*class="lucide lucide-x sm:hidden" aria-hidden="true">/);
    assert.ok(!html.includes("hidden sm:inline-flex"));
    // L'ordine del fuoco è quello della riga: «Tipo», la ricerca, «Altri filtri», «Togli i filtri».
    const at = (text: string) => html.indexOf(text);
    if (kind === "filtro") assert.ok(at('aria-label="Tipo:') >= 0 && at('aria-label="Tipo:') < at('type="search"'));
    assert.ok(at('type="search"') < at('aria-label="Altri filtri"') && at('aria-label="Altri filtri"') < at('aria-label="Togli i filtri"'));
    assert.deepEqual(findHubForbiddenIn([html.replace(/<[^>]+>/g, " ")], "area"), []);
  }
});

test("revisori, senza filtri: niente ✕ né «Togli i filtri»", () => {
  const html = reviewer({ vista: "panoramica" }, false);
  assert.ok(!html.includes("Togli i filtri") && !html.includes("lucide-x"));
});

test("contributori: solo la ricerca e la parola «Togli i filtri» anche al telefono, come prima", () => {
  const html = render({ basePath: BASE, query: { vista: "da-decidere", q: "fatture" }, mode: "contributore", kind: "filtro", active: true, clearHref: `${BASE}?vista=da-decidere` });
  assert.match(html, /<span class="shrink-0"><a\b[^>]*class="[^"]*min-h-11 shrink-0 text-muted-foreground sm:min-h-8" href="\/dashboard\/ws\/use-cases\?vista=da-decidere">Togli i filtri<\/a><\/span><\/div>$/);
  assert.equal(clearTags(html).length, 0);
  for (const text of ["lucide-x", "Altri filtri", "Tipo"]) assert.ok(!html.includes(text), text);
});

test("i bersagli della riga al telefono: 44 px; il segnaposto della ricerca finisce con «…» se non ci sta", () => {
  const html = reviewer({ vista: "panoramica", tipo: "costruire" });
  const more = /<button\b[^>]*aria-label="Altri filtri"[^>]*>/.exec(html)![0];
  for (const name of ["min-h-11", "min-w-11", "sm:min-h-8", "sm:min-w-0"]) assert.ok(more.includes(name), `«Altri filtri»: ${name}`);
  assert.match(/<input\b[^>]*type="search"[^>]*>/.exec(html)![0], /class="[^"]*\bh-11 pl-8 text-ellipsis sm:h-8\b/);
});

test("«Altri filtri»: niente «Togli i filtri» dentro; al telefono si apre contro la barra, alto al più lo spazio che resta", () => {
  assert.doesNotMatch(SOURCE, /clear=\{clear\}|<div className="sm:hidden">\{clear\}<\/div>/);
  assert.match(SOURCE, /<div ref=\{bar\} data-slot="filter-bar"/);
  assert.match(SOURCE, /<MoreFilters [^>]*anchor=\{bar\}/);
  assert.match(SOURCE, /anchor=\{phone \? anchor : undefined\}/);
  assert.match(SOURCE, /className="max-h-\(--available-height\) w-72 max-w-\[calc\(100vw-2rem\)\] gap-3 overflow-y-auto overscroll-contain p-3"/);
  // Il riquadro di shadcn passa l'ancora a base-ui; senza, l'ancora è il bottone, come prima.
  assert.match(POPOVER, /"align" \| "alignOffset" \| "anchor" \| "side" \| "sideOffset"/);
  assert.match(POPOVER, /anchor=\{anchor\}/);
});
