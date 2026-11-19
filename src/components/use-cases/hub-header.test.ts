import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// La testata di «Use case» (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.4, prototipo S2): H1 «Use case» senza
// sottotitolo, «Nuovo» bordato e il «⋯» con «Grafici ›» · «Proponi dai processi» · «Esporta in Excel».
//
// Il menu «⋯» porta con sé le sue azioni del server (e il database): nella testata resa qui è un componente che
// scrive le sue prop; il menu vero si prova dal suo sorgente (il contenuto di un menu chiuso non è nell'HTML).
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};
let header: typeof import("./hub-header.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  const menu = `data:text/javascript,${encodeURIComponent(
    "export function HubMenu(props) { return 'MENU:' + props.charts.map((link) => link.label + '=' + link.href).join('|'); }",
  )}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "./hub-menu" && context.parentURL?.endsWith("/hub-header.tsx")) return { url: menu, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  header = await import("./hub-header.tsx");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const BASE = "/dashboard/ws/use-cases";
const MENU = {
  exportHref: "/dashboard/ws/portfolio/export",
  activityMapping: "pronto",
  mappingHref: "/dashboard/ws/mapping",
  charts: [
    { label: "Matrice", href: `${BASE}?vista=panoramica&mostra=matrice` },
    { label: "Curva del valore", href: `${BASE}?vista=panoramica&mostra=curva` },
  ],
};

function render(props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(createElement(header.HubHeader, { workspaceId: "ws", newHref: `${BASE}?vista=panoramica&nuovo=1`, menu: MENU, ...props }));
}

const read = (file: string) => readFileSync(new URL(file, import.meta.url), "utf8");

test("la testata: H1 «Use case» senza sottotitolo, «Nuovo» bordato con il nome intero per i lettori di schermo", () => {
  const html = render();
  assert.match(html, /<h1 class="text-2xl font-semibold tracking-tight">Use case<\/h1>/);
  assert.ok(!html.includes("Dal basso e dall") && !/<\/h1><p\b/.test(html), "nessun sottotitolo");
  const link = /<a\b[^>]*href="[^"]*nuovo=1"[^>]*>([\s\S]*?)<\/a>/.exec(html);
  assert.ok(link, "«Nuovo»");
  assert.match(link[0], /aria-label="Nuovo use case"/);
  assert.ok(link[1].replace(/<[^>]+>/g, "") === "Nuovo", link[1]);
  assert.ok(!/class="[^"]*\bbg-primary\b/.test(link[0]), "bordato");
  assert.match(link[0], /class="[^"]*\bborder\b/);
  // Pieno solo dove la pagina non ha un altro pulsante pieno (il contributore, l'area vuota): lo decide la pagina.
  assert.match(/<a\b[^>]*nuovo=1[^>]*>/.exec(render({ newUseCaseVariant: "default" }))![0], /\bbg-primary\b/);
  // Il «⋯» riceve i grafici; senza menu (i contributori) non c'è.
  assert.ok(html.includes(`MENU:Matrice=${BASE}?vista=panoramica&amp;mostra=matrice|Curva del valore=${BASE}?vista=panoramica&amp;mostra=curva`), html);
  assert.ok(!render({ menu: null }).includes("MENU:"));
});

test("i testi della testata passano la guardia delle parole; nessun testo morto", () => {
  const t = header.HUB_TEXT;
  assert.equal(t.newShort, "Nuovo");
  assert.equal(t.newUseCase, "Nuovo use case");
  assert.ok(!Object.hasOwn(t, "subtitle"), "il sottotitolo non c'è più");
  assert.deepEqual(findHubForbiddenIn(Object.values(t), "area"), []);
});

test("il «⋯»: «Grafici ›» (un sottomenu con «Matrice» e «Curva del valore»), poi «Proponi dai processi», poi «Esporta in Excel»", () => {
  const source = read("./hub-menu.tsx");
  assert.match(source, /export const HUB_MENU_TEXT = Object\.freeze\(\{\s*label: "Altre azioni",[\s\S]*?charts: "Grafici",\s*export: "Esporta in Excel",/);
  const sub = source.indexOf("<DropdownMenuSubTrigger");
  const propose = source.indexOf("{ACTIVITY_MAPPING_TEXT.menuItem}");
  const exported = source.indexOf("{HUB_MENU_TEXT.export}");
  assert.ok(sub > 0 && sub < propose && propose < exported, "l'ordine di §3.4");
  assert.match(source, /<DropdownMenuSubTrigger data-action="charts-menu" className=\{ITEM\}>\s*\{HUB_MENU_TEXT\.charts\}/);
  assert.match(source, /\{charts\.length \? \(/, "senza grafici niente «Grafici»");
  assert.match(source, /<MenuPrimitive\.LinkItem key=\{link\.href\}[^>]*render=\{<Link href=\{link\.href\} \/>\}/, "i grafici sono link dell'app");
  assert.ok(source.includes("window.location.assign(exportHref)"), "l'export è un file da scaricare");
  // Le voci: 44 px al telefono.
  assert.match(source, /const ITEM =\s*"flex min-h-11 /);
  assert.ok(!source.includes("<ActionMenu") && !source.includes("@/components/uc/ui/action-menu"), "un menu solo, con il sottomenu");
  const texts = [...source.matchAll(/^\s+(?:label|charts|export|openMapping): "([^"]+)",$/gm)].map((match) => match[1]);
  assert.deepEqual(texts, ["Altre azioni", "Grafici", "Esporta in Excel", "Apri i processi"]);
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
});

test("la pagina: «Nuovo» bordato per i revisori, pieno per il contributore e nell'area vuota; i grafici nel «⋯»", () => {
  const hub = read("./hub.tsx").replace(/\s+/g, " ");
  assert.ok(hub.includes('const newVariant = reviewer && items.length > 0 ? "outline" : "default";'));
  assert.ok(hub.includes("newUseCaseVariant={newVariant}"));
  assert.ok(hub.includes("charts: chartLinks,"), "i grafici nel menu della testata");
  assert.ok(hub.includes("const chartLinks = hubChartMenu(data.charts).map((key) => ({ label: CHART_MENU_LABEL[key], href: chartHref(key) }));"));
  assert.ok(!hub.includes("SubprocessorsLsNotice") && !hub.includes("subprocessorsPendingForLs"), "niente avviso sui fornitori: c'è il passo «Autorizza i fornitori»");
});
