import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Niente scorrimento orizzontale da 768 a 1024 px nell'area «Use case». Da 768 px la barra laterale
// prende 256 px della finestra: a 768 px la pagina ha circa 460 px, a 1024 circa 700. Due cause:
// 1. il riquadro accanto alla barra (`SidebarInset`), elemento flex senza `min-w-0`, prendeva la
//    larghezza minima del contenuto più largo e faceva scorrere tutta la pagina;
// 2. righe, liste di «Priorità» e tabelle di «Cosa serve» cambiavano forma sulla finestra (`lg:`,
//    `md:`), con colonne che accanto alla barra non ci stanno; la barra dei filtri non andava a capo.
// La prova nella pagina vera è scripts/use-case-test/screens-hub.mjs (--overflow-widths, di
// default 768, 900, 1024 e 1280); qui il sorgente, perché la causa non torni.
//
// Il contrario a 1280 px: la pagina ha 960 px (945 con una barra di scorrimento classica). Con le
// colonne da 64rem la lista di «Priorità» e le righe di «Da decidere» le perdevano; ora le hanno da
// 58rem (928 px), con colonne che a quella larghezza ci stanno.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

/**
 * Le forme che dipendono dalla larghezza della finestra da 768 px in su (`md:`, `lg:`, `max-lg:` …),
 * dove la barra laterale prende 256 px. `sm:` resta: al telefono non c'è barra (i bersagli da dito).
 */
const VIEWPORT_VARIANT = /(?<![@\w/-])(?:max-)?(?:md|lg|xl|2xl):/;

test("il riquadro accanto alla barra laterale si stringe con la finestra (min-w-0)", () => {
  const sidebar = read("src/components/ui/sidebar.tsx");
  const inset = sidebar.slice(sidebar.indexOf("function SidebarInset("), sidebar.indexOf("function SidebarInput("));
  assert.match(inset, /data-slot="sidebar-inset"/);
  assert.match(inset, /"relative flex w-full min-w-0 flex-1 flex-col /);
});

test("la pagina «Use case» è un contenitore: righe, lista e tabelle guardano la sua larghezza", () => {
  assert.match(read("src/components/use-cases/hub.tsx"), /data-slot="use-case-hub" data-view=\{view\} className="@container\/hub /);
  for (const [file, variant] of [
    ["src/components/use-cases/use-case-row.tsx", "@min-[58rem]/hub:"],
    ["src/components/use-cases/priority-list.tsx", "@min-[58rem]/hub:"],
    ["src/components/use-cases/diffuse-list.tsx", "@4xl/hub:"],
    // La testa della Panoramica: le fasi in fila e «Prossimo passo» su una riga dal riquadro di 42rem.
    ["src/components/use-cases/panoramica-top.tsx", "@2xl/hub:"],
  ] as const) {
    // Ogni stringa del file (className, cn(…), costanti delle classi).
    const classes = [...read(file).matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]).join(" ");
    assert.doesNotMatch(classes, VIEWPORT_VARIANT, `${file}: una forma sulla larghezza della finestra`);
    assert.ok(classes.includes(`${variant}grid`) || classes.includes(`${variant}flex-row`), `${file}: le colonne sulla larghezza del riquadro (${variant})`);
  }
  const needs = read("src/components/use-cases/needs-board.tsx");
  assert.match(needs, /className="hidden overflow-hidden rounded-lg border @4xl\/hub:block"/);
  assert.match(needs, /data-slot="needs-list" className="divide-y rounded-lg border @4xl\/hub:hidden"/);
  // Le schede del trimestre in due colonne sulla larghezza del riquadro, non della finestra.
  assert.ok(needs.includes("@4xl/hub:grid-cols-2"));
  assert.ok(!needs.includes("lg:grid-cols-2"));
});

/** Le tracce di un `grid-cols-[…]` in rem: la misura fissa, o il minimo di `minmax(min,…fr)`. */
function trackMinimums(template: string): number[] {
  return template.split("_").map((track) => {
    const fixed = /^([\d.]+)rem$/.exec(track);
    const flexible = /^minmax\(([\d.]+)rem,[\d.]+fr\)$/.exec(track);
    const rem = fixed?.[1] ?? flexible?.[1];
    assert.ok(rem, `traccia senza una misura in rem o un minimo in rem (le righe non resterebbero allineate): ${track}`);
    return Number(rem);
  });
}

test("la lista di «Priorità» e le righe dei revisori hanno le colonne da 58rem, e a 58rem ci stanno", () => {
  // A 1280 px di finestra la pagina ha 960 px (60rem), 945 con una barra di scorrimento classica.
  const list = read("src/components/use-cases/priority-list.tsx");
  // Quattro coppie di colonne: con e senza la zona (quando nessuna riga la scrive), con e senza
  // l'origine (quando tutte le righe hanno la stessa).
  const narrows = [...list.matchAll(/@min-\[58rem\]\/hub:grid-cols-\[([^\]\s]+)\]/g)].map((match) => match[1]);
  const wides = [...list.matchAll(/@5xl\/hub:grid-cols-\[([^\]\s]+)\]/g)].map((match) => match[1]);
  assert.equal(narrows.length, 4, "le colonne da 58rem, con e senza la zona e l'origine");
  assert.equal(wides.length, 4, "le colonne da 64rem, con e senza la zona e l'origine");
  assert.match(list, /@min-\[58rem\]\/hub:grid /);
  assert.match(list, /@min-\[58rem\]\/hub:gap-3"/);
  assert.match(list, /className=\{cn\("flex flex-col gap-2 px-3 py-2\.5", columns\)\}/);
  // Ogni colonna con un minimo fisso: la somma, gli spazi tra le colonne (gap-3) e i margini (px-3) stanno nel riquadro.
  const counts: number[] = [];
  for (const [index, narrow] of narrows.entries()) {
    const wide = wides[index];
    const sizes = [narrow, wide].map((template) => trackMinimums(template).length);
    assert.equal(sizes[0], sizes[1], `${narrow} e ${wide}: le stesse colonne da 58rem e da 64rem`);
    counts.push(sizes[0]);
    for (const [template, page] of [[narrow, 58], [wide, 64]] as const) {
      const tracks = trackMinimums(template);
      const total = tracks.reduce((sum, rem) => sum + rem, 0) + (tracks.length - 1) * 0.75 + 2 * 0.75;
      assert.ok(total <= page, `${template}: ${total}rem in un riquadro di ${page}rem`);
    }
  }
  assert.deepEqual([...counts].sort(), [5, 6, 6, 7], "sette colonne con zona e origine, cinque senza");
  // Il titolo ha la quota più grande di quel che resta (2fr), mai meno di 9rem; senza la colonna
  // dell'origine (8,25rem) mai meno di 16rem.
  for (const narrow of narrows) {
    const withOrigin = narrow.includes("_8.25rem_");
    assert.match(narrow, withOrigin ? /^4\.5rem_minmax\(9rem,2fr\)_8\.25rem_/ : /^4\.5rem_minmax\(16rem,2fr\)_minmax\(7rem,1fr\)_/, narrow);
  }
  // Il chip di «Raccolta informazioni» sta sotto il titolo, non accanto: non gli toglie spazio.
  assert.match(list, /<span className="flex min-w-0 flex-col items-start gap-0\.5">\s*<Link/);
  // Il titolo va su due righe a ogni larghezza: con «Origine» e «Zona» una riga sola lo taglia dopo poche parole.
  assert.match(list, /className="line-clamp-2 max-w-full min-w-0 text-sm font-semibold /);
  assert.ok(!list.includes("hub:line-clamp-1"), "nessuna riga sola per il titolo con le colonne");
  // L'origine c'è solo quando c'è la sua colonna, anche nella riga stretta del telefono.
  assert.match(list, /\{originColumn \? \(\s*<span className="min-w-0">\s*<OriginChip origin=\{item\.origin\} \/>/);
  // Valore va a capo dopo «·», nella lista e nella riga, invece di scrivere sopra il Costo.
  assert.match(list, /<ValueFigure value=\{item\.value\} withLabel wrap /);
  const row = read("src/components/use-cases/use-case-row.tsx");
  assert.match(row, /<ValueFigure value=\{item\.value\} withLabel wrap \/>/);
  assert.match(row, /const REVIEWER_ROW_LINK = `\$\{ROW_LINK\} @min-\[58rem\]\/hub:flex-row /);
  // In una riga sola il titolo (con il codice) tiene almeno 14rem e la parte con le cifre si stringe.
  assert.match(row, /"flex min-w-0 items-baseline gap-3 @min-\[58rem\]\/hub:min-w-56 @min-\[58rem\]\/hub:flex-1"/);
  assert.match(row, /"flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 @min-\[58rem\]\/hub:flex-nowrap @min-\[58rem\]\/hub:gap-x-3"/);
  // Lo script delle schermate controlla le colonne dallo stesso riquadro.
  assert.match(read("scripts/use-case-test/screens-hub.mjs"), /const HUB_COLUMNS_FROM_PX = 928;/);
});

test("la «Panoramica»: tre corsie da 58rem del riquadro, prima una sotto l'altra", () => {
  const lanes = read("src/components/use-cases/panorama-lanes.tsx");
  // Affiancate da 58rem (928 px, a 1280 px di finestra), con le card una sotto l'altra; più stretto le
  // corsie una sotto l'altra, con le card in due colonne da 36rem.
  assert.ok(lanes.includes('data-slot="lanes" className="grid gap-6 @min-[58rem]/hub:grid-cols-3 @min-[58rem]/hub:gap-4"'));
  assert.ok(lanes.includes('<ul className="grid gap-2 @xl/hub:grid-cols-2 @min-[58rem]/hub:grid-cols-1">'));
  for (const file of [
    "src/components/use-cases/panorama-lanes.tsx",
    "src/components/use-cases/lane-card.tsx",
    "src/components/use-cases/agent-tag.tsx",
    "src/components/use-cases/agent-grid.tsx",
  ]) {
    const classes = [...read(file).matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]).join(" ");
    assert.doesNotMatch(classes, VIEWPORT_VARIANT, `${file}: una forma sulla larghezza della finestra`);
  }
  // La card: il titolo prende quel che resta accanto al costo e va a capo dentro una parola lunga.
  const card = read("src/components/use-cases/lane-card.tsx");
  assert.ok(card.includes("grid-cols-[minmax(0,1fr)_auto]"));
  assert.match(card, /className="line-clamp-2 min-w-0 text-sm font-semibold break-words text-foreground"/);
  assert.match(card, /<li data-slot="lane-card" data-id=\{item\.id\} data-lane=\{place\} data-agent=\{agent\?\.agent\} className="min-w-0">/);
  // Lo script delle schermate controlla le colonne delle corsie dallo stesso riquadro.
  assert.ok(read("scripts/use-case-test/screens-hub.mjs").includes("if (layout.laneColumns"));
});

test("la barra dei filtri va a capo dal tablet e resta una riga al telefono", () => {
  assert.match(read("src/components/use-cases/filter-bar.tsx"), /data-slot="filter-bar"[^>]*className="flex min-w-0 flex-nowrap items-center gap-2 sm:flex-wrap"/);
});

test("l'origine sta nella barra dei filtri solo con la pagina larga almeno 42rem, altrimenti in «Altri filtri»", () => {
  // A 768 px, accanto alla barra laterale, la pagina ha 464 px: con l'origine nella barra i controlli di
  // «Priorità» andavano su tre righe. Da 42rem «Tipo», origine e ricerca stanno in una riga, il resto nella seconda.
  const bar = read("src/components/use-cases/filter-bar.tsx");
  assert.match(bar, /const ORIGIN_INLINE = "sm:@2xl\/hub:block";/);
  assert.match(bar, /<nav ref=\{originNav\} aria-label=\{FILTER_TEXT\.originLabel\} className=\{cn\("hidden max-w-full min-w-0 shrink-0", ORIGIN_INLINE\)\}>/);
  // Il numero di «Altri filtri» conta l'origine quando sta dentro: le stesse condizioni, rovesciate.
  assert.match(bar, /tabular-nums sm:@2xl\/hub:hidden">\{countWithOrigin\}/);
  assert.match(bar, /hidden text-xs text-muted-foreground tabular-nums sm:@2xl\/hub:inline">\{count\}/);
  // Dentro «Altri filtri» (un portale, fuori dal riquadro) lo decide la barra all'apertura.
  assert.match(bar, /if \(open\) setOriginInside\(!originShown\(\)\);/);
  assert.match(bar, /\{originInside \? \(\s*<MoreField\s+label=\{FILTER_TEXT\.originLabel\}/);
  assert.doesNotMatch(bar, /<div className="sm:hidden">\s*<MoreField/, "l'origine dentro «Altri filtri» non segue più solo la finestra");
});

test("lo script delle schermate controlla lo scorrimento orizzontale e le colonne a 768, 900, 1024 e 1280 px", () => {
  const screens = read("scripts/use-case-test/screens-hub.mjs");
  assert.match(screens, /const DEFAULT_OVERFLOW_WIDTHS = \[768, 900, 1024, 1280\];/);
  assert.match(screens, /const layout = await hubLayout\(page\);/);
  assert.match(screens, /if \(layout\.priorityWithoutColumns\) failures\.push\(/);
  assert.match(screens, /if \(layout\.rowsOnTwoLines\) failures\.push\(/);
  assert.match(screens, /if \(layout\.wider\) failures\.push\(/);
  assert.match(screens, /for \(const width of \[\.\.\.widths, \.\.\.overflowWidths\]\)/);
  assert.match(screens, /if \(report\.horizontalOverflow\) \{/);
  assert.match(screens, /failures\.push\(`horizontal scroll at \$\{width\} px/);
});
