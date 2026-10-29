import test, { before } from "node:test";
import assert from "node:assert/strict";
import { agentPalette } from "../../lib/use-cases/agents.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import type { AgentGroup } from "../../lib/use-cases/lanes.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// «Per agente» (rilascio «Panoramica»): una card per agente del titolo, con il nome nel suo colore,
// gli euro contati, la barra e i trimestri; un clic porta alle corsie del solo agente.
let grid: typeof import("./agent-grid.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  grid = await import("./agent-grid.tsx");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const BASE = "/dashboard/ws/use-cases";
const NOW = { key: "questo_trimestre", short: "T4", label: "Questo trimestre · T4 2026" } as const;
const NEXT = { key: "prossimo_trimestre", short: "T1", label: "Prossimo trimestre · T1 2027" } as const;
const LATER = { key: "piu_avanti", short: "Più avanti", label: "Più avanti" } as const;

const GROUPS: AgentGroup[] = [
  { param: "LIBRA", agent: "LIBRA", label: "LIBRA", count: 7, perYearEur: 12_300, counted: 3, lanes: [{ ...NOW, count: 3 }, { ...NEXT, count: 3 }, { ...LATER, count: 1 }] },
  { param: "ORSA", agent: "ORSA", label: "ORSA", count: 1, perYearEur: 3_000, counted: 1, lanes: [{ ...NOW, count: 1 }] },
  { param: "AUTO", agent: "AUTO", label: "AUTO", count: 2, perYearEur: 0, counted: 0, lanes: [{ ...NEXT, count: 2 }] },
  { param: "altri", agent: null, label: "Altri use case", count: 2, perYearEur: 0, counted: 0, lanes: [{ ...LATER, count: 2 }] },
];
const AGENTS = agentPalette([{ title: "AUTO H1 · Cedolini" }, { title: "LIBRA L1 · Fatture" }, { title: "ORSA O1 · Solleciti" }]);
/** La pagina passa i link così: le corsie del solo agente, senza `mostra`, con l'ancora. */
const hrefOf = (param: string) => `${BASE}?vista=panoramica&agente=${param}#panoramica-approvati`;

const render = (groups = GROUPS) => renderToStaticMarkup(createElement(grid.AgentGrid, { groups, hrefOf, agents: AGENTS }));
function cardOf(html: string, param: string): string {
  const start = html.indexOf(`data-agent="${param}"`);
  assert.ok(start >= 0, `card ${param}`);
  return html.slice(start, html.indexOf("</li>", start));
}
const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");

test("una card per agente: il nome in maiuscolo, monospazio e nel suo colore; quanti use case; gli euro «su N use case»", () => {
  const html = render();
  assert.match(html, /^<ul data-slot="agent-grid" class="grid gap-3 @2xl\/hub:grid-cols-2 @5xl\/hub:grid-cols-3">/);
  assert.deepEqual([...html.matchAll(/data-slot="agent-card" data-agent="([^"]+)"/g)].map((match) => match[1]), ["LIBRA", "ORSA", "AUTO", "altri"], "l'ordine dei gruppi");
  const libra = cardOf(html, "LIBRA");
  const name = /<span class="([^"]*)">LIBRA<\/span>/.exec(libra)?.[1].split(" ") ?? [];
  for (const cls of ["font-mono", "uppercase", "tracking-wide", "font-semibold", `text-uc-agente-${AGENTS.tones.LIBRA}`]) assert.ok(name.includes(cls), cls);
  assert.ok(textOf(libra).includes("7 use case"));
  assert.ok(textOf(libra).includes("12.300 € all'anno · su 3 use case"), textOf(libra));
  assert.match(libra, /<span data-figure="valore" class="text-sm font-medium text-foreground tabular-nums">12\.300 € all&#x27;anno<\/span>/);
  // Tutti contati: niente «su N use case».
  const orsa = cardOf(html, "ORSA");
  assert.ok(textOf(orsa).includes("3.000 € all'anno") && !textOf(orsa).includes("su 1 use case"));
  // Nessuna cifra: lo dice, senza barra.
  const auto = cardOf(html, "AUTO");
  assert.ok(textOf(auto).includes("Nessuna cifra contata") && !auto.includes("data-figure"));
  assert.ok(!auto.includes('data-slot="agent-bar"'), "senza euro niente barra");
  assert.equal(grid.AGENT_GRID_TEXT.noCounted, "Nessuna cifra contata");
});

test("la barra sulla scala del gruppo più grande, nascosta ai lettori di schermo; i trimestri con il nome intero per i lettori di schermo", () => {
  const html = render();
  const libra = cardOf(html, "LIBRA");
  assert.match(libra, /<span aria-hidden="true" data-slot="agent-bar" class="block h-1\.5 rounded-full bg-muted"><span class="block h-full rounded-full bg-uc-agente-\d+" style="width:100%"><\/span>/);
  // 3.000 su 12.300: 24%.
  assert.match(cardOf(html, "ORSA"), /style="width:24%"/);
  const chips = libra.slice(libra.indexOf('class="mt-auto flex flex-wrap gap-1.5"'));
  assert.ok(chips.includes('<span aria-hidden="true">T4 · 3</span><span class="sr-only">Questo trimestre · T4 2026: 3 use case</span>'), chips);
  assert.ok(chips.includes('<span aria-hidden="true">Più avanti · 1</span><span class="sr-only">Più avanti: 1 use case</span>'));
  assert.ok(!chips.includes("<ul") && !chips.includes("<li"), "i trimestri non sono un elenco dentro il link");
  // La barra più corta resta visibile: almeno il 4%.
  const tiny = render([{ ...GROUPS[0] }, { ...GROUPS[1], perYearEur: 100 }]);
  assert.match(cardOf(tiny, "ORSA"), /style="width:4%"/);
});

test("il link: le corsie del solo agente, senza `mostra`, con l'ancora; «Altri use case» senza il colore né il monospazio", () => {
  const html = render();
  const libra = cardOf(html, "LIBRA");
  const href = /<a [^>]*href="([^"]*)"/.exec(libra)?.[1] ?? "";
  assert.ok(href.includes("agente=LIBRA") && !href.includes("mostra") && href.endsWith("#panoramica-approvati"), href);
  assert.match(libra, /<a [^>]*class="flex h-full scroll-mt-24 flex-col gap-2 rounded-xl border border-input bg-card /);
  // L'ancora del ritorno da «‹ Tutti gli agenti»: Next scorre alla card e `HashFocusLink` le dà il fuoco.
  assert.match(libra, /<a id="agente-LIBRA" [^>]*href="[^"]*agente=LIBRA#panoramica-approvati"/);
  const others = cardOf(html, "altri");
  assert.match(others, /<a id="agente-altri" [^>]*href="[^"]*agente=altri#panoramica-approvati"/);
  const ids = [...html.matchAll(/<a id="([^"]+)"/g)].map((match) => match[1]);
  assert.deepEqual(ids, ["agente-LIBRA", "agente-ORSA", "agente-AUTO", "agente-altri"], "un'ancora per card, mai due uguali");
  const name = /<span class="([^"]*)">Altri use case<\/span>/.exec(others)?.[1].split(" ") ?? [];
  assert.ok(name.includes("text-foreground") && !name.includes("font-mono") && !name.includes("uppercase"), name.join(" "));
  assert.ok(!others.includes("uc-agente"), "senza agente nessun colore");
  assert.deepEqual(findHubForbiddenIn([textOf(html)], "area"), []);
});
