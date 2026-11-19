import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Niente scorrimento orizzontale da 768 a 1024 px nell'area «Use case». Da 768 px la barra laterale
// prende 256 px della finestra: a 768 px la pagina ha circa 460 px, a 1024 circa 700. Due cause:
// 1. il riquadro accanto alla barra (`SidebarInset`), elemento flex senza `min-w-0`, prendeva la
//    larghezza minima del contenuto più largo e faceva scorrere tutta la pagina;
// 2. righe, corsie della Panoramica e tabelle di «Cosa serve» cambiavano forma sulla finestra (`lg:`,
//    `md:`), con colonne che accanto alla barra non ci stanno; la barra dei filtri non andava a capo.
// La prova nella pagina vera è scripts/use-case-test/screens-hub.mjs (--overflow-widths, di
// default 768, 900, 1024 e 1280); qui il sorgente, perché la causa non torni.
//
// Il contrario a 1280 px: la pagina ha 960 px (945 con una barra di scorrimento classica). Con le
// colonne da 64rem le righe di «Da decidere» le perdevano; ora le hanno da 58rem (928 px), come le
// tre corsie della Panoramica, che a quella larghezza stanno affiancate.

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

test("la pagina «Use case» è un contenitore: righe, corsie e tabelle guardano la sua larghezza", () => {
  assert.match(read("src/components/use-cases/hub.tsx"), /data-slot="use-case-hub" data-view=\{view\} className="@container\/hub /);
  for (const [file, variant, columns] of [
    ["src/components/use-cases/use-case-row.tsx", "@min-[58rem]/hub:", ["grid", "flex-row"]],
  ] as const) {
    // Ogni stringa del file (className, cn(…), costanti delle classi).
    const classes = [...read(file).matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]).join(" ");
    assert.doesNotMatch(classes, VIEWPORT_VARIANT, `${file}: una forma sulla larghezza della finestra`);
    assert.ok(columns.some((shape) => classes.includes(`${variant}${shape}`)), `${file}: le colonne sulla larghezza del riquadro (${variant})`);
  }
  // (Rilascio 10, §3.4) La testa della Panoramica è il prossimo passo e il numero grande, pezzi comuni che vanno a capo
  // da sé: nessuna colonna, e nessuna forma sulla larghezza della finestra.
  const top = [...read("src/components/use-cases/panoramica-top.tsx").matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]).join(" ");
  assert.doesNotMatch(top, VIEWPORT_VARIANT, "panoramica-top.tsx: una forma sulla larghezza della finestra");
  // «Cosa serve» (rilascio 4; rilascio 10, §3.4): l'elenco o il calendario («Elenco | Calendario»), una colonna a
  // ogni larghezza, mai due colonne impilate al telefono; le righe sono un elenco (la tabella non c'è più).
  const needs = read("src/components/use-cases/needs-board.tsx");
  assert.ok(!needs.includes("grid-cols-[minmax(0,1fr)_18rem]") && !needs.includes("<aside"), "niente più colonna accanto");
  assert.match(needs, /showCalendar \? \(\s*<Timeline /);
  assert.match(needs, /data-slot="needs-list" className="divide-y rounded-lg border"/);
  assert.ok(!needs.includes("<table") && !needs.includes("@4xl/hub:"), "nessuna tabella e nessuna forma da 56rem");
  const classes = [...needs.matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]).join(" ");
  assert.doesNotMatch(classes, VIEWPORT_VARIANT, "needs-board.tsx: una forma sulla larghezza della finestra");
});

test("le righe dei revisori hanno le colonne da 58rem del riquadro", () => {
  // A 1280 px di finestra la pagina ha 960 px (60rem), 945 con una barra di scorrimento classica.
  const row = read("src/components/use-cases/use-case-row.tsx");
  assert.match(row, /const REVIEWER_ROW_LINK = `\$\{ROW_LINK\} @min-\[58rem\]\/hub:flex-row /);
  // (Rilascio 10, §3.4) La riga di «Da decidere»: in una riga sola il titolo tiene almeno 14rem e prende il resto; le
  // altre quattro in colonne della stessa larghezza in ogni riga. Più stretto vanno sotto il titolo, a capo se serve.
  const decide = row.slice(row.indexOf("function DecideRow("), row.indexOf("export function OwnMarker("));
  assert.match(decide, /"flex min-w-0 items-start gap-2 @min-\[58rem\]\/hub:min-w-56 @min-\[58rem\]\/hub:flex-1"/);
  assert.match(decide, /"flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 @min-\[58rem\]\/hub:shrink-0 @min-\[58rem\]\/hub:flex-nowrap"/);
  for (const column of [
    /<CodeLabel code=\{item\.code\} className="@min-\[58rem\]\/hub:w-16" \/>/,
    /<StatusDot tone=\{item\.tone\} label=\{reviewerSubStateText\(item\)\} className="@min-\[58rem\]\/hub:w-40" \/>/,
    /whitespace-nowrap text-muted-foreground @min-\[58rem\]\/hub:w-24">\{waitingLabel\(/,
    /<ValueFigure value=\{item\.value\} withLabel className="@min-\[58rem\]\/hub:w-44" \/>/,
  ]) {
    assert.match(decide, column);
  }
  assert.ok(!row.includes("function ReviewerRow(") && !row.includes("RowFigures"), "la riga con Valore e Costo non c'è più");
  // Lo script delle schermate controlla righe e corsie dallo stesso riquadro.
  assert.match(read("scripts/use-case-test/screens-hub.mjs"), /const HUB_COLUMNS_FROM_PX = 928;/);
});

test("la «Panoramica»: tre corsie da 58rem del riquadro, prima una sotto l'altra", () => {
  const lanes = read("src/components/use-cases/panorama-lanes.tsx");
  // Affiancate da 58rem (928 px, a 1280 px di finestra), con le card una sotto l'altra; più stretto le
  // corsie una sotto l'altra, con le card in due colonne da 36rem.
  assert.ok(lanes.includes('data-slot="lanes" className="grid gap-6 @min-[58rem]/hub:grid-cols-3 @min-[58rem]/hub:gap-4"'));
  assert.ok(lanes.includes('const LANE_GRID = "grid gap-2 @xl/hub:grid-cols-2 @min-[58rem]/hub:grid-cols-1";'));
  for (const file of [
    "src/components/use-cases/panorama-lanes.tsx",
    "src/components/use-cases/lane-card.tsx",
    "src/components/use-cases/agent-tag.tsx",
    "src/components/use-cases/agent-grid.tsx",
    // I grafici del menu «⋯», al posto delle corsie.
    "src/components/use-cases/chart-view.tsx",
  ]) {
    const classes = [...read(file).matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]).join(" ");
    assert.doesNotMatch(classes, VIEWPORT_VARIANT, `${file}: una forma sulla larghezza della finestra`);
  }
  // La card (rilascio 10, D7): il titolo prende tutta la riga e va a capo dentro una parola lunga; il Valore e il costo
  // stanno nella riga sotto la barra e vanno a capo invece di scrivere uno sopra l'altro.
  const card = read("src/components/use-cases/lane-card.tsx");
  assert.ok(card.includes('"flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5"'));
  assert.match(card, /className="line-clamp-2 min-w-0 text-sm font-semibold break-words text-foreground"/);
  assert.match(card, /<li data-slot="lane-card" data-id=\{item\.id\} data-lane=\{place\} data-agent=\{agent\?\.agent\} className="min-w-0">/);
  // Lo script delle schermate controlla le colonne delle corsie dallo stesso riquadro.
  assert.ok(read("scripts/use-case-test/screens-hub.mjs").includes("if (layout.laneColumns"));
});

test("i grafici del menu «⋯»: grafico o elenco sulla larghezza del riquadro (36rem), mai della finestra", () => {
  // A 768 px di finestra la pagina ha 464 px: le bolle e la curva, disegnate da `md:`, ci stavano
  // strette e le etichette, messe per 600 px, coprivano le bolle vicine. Ora da una pagina di 36rem.
  const files = [
    "src/components/use-cases/value-cost-matrix.tsx",
    "src/components/use-cases/benefit-bubbles.tsx",
    "src/components/use-cases/value-jcurve.tsx",
    "src/components/use-cases/value-by-lever.tsx",
    "src/components/use-cases/roadmap-value.tsx",
    "src/components/use-cases/chart-label.tsx",
  ];
  for (const file of files) {
    const classes = [...read(file).matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]).join(" ");
    assert.doesNotMatch(classes, VIEWPORT_VARIANT, `${file}: una forma sulla larghezza della finestra`);
  }
  assert.match(read("src/components/use-cases/benefit-bubbles.tsx"), /data-slot="benefit-bubbles-chart" className="hidden grid-cols-\[4\.5rem_minmax\(0,1fr\)\] gap-x-2 @xl\/hub:grid"/);
  const curve = read("src/components/use-cases/value-jcurve.tsx");
  assert.match(curve, /data-slot="value-jcurve-chart" aria-hidden className="hidden grid-cols-\[4\.5rem_minmax\(0,1fr\)\] gap-x-2 @xl\/hub:grid"/);
  assert.match(curve, /data-slot="value-jcurve-list" className="space-y-3 text-sm @xl\/hub:hidden"/);
  const levers = read("src/components/use-cases/value-by-lever.tsx");
  assert.match(levers, /data-slot="value-by-lever-bars" className="hidden space-y-1 @xl\/hub:block"/);
  assert.match(levers, /data-slot="value-by-lever-list" className="space-y-1 @xl\/hub:hidden"/);
});

test("(rilascio 10, §3.4) la barra dei filtri è il pezzo comune: «Cerca» (un'icona al telefono) e «Filtri (n)» in una riga, i chip sotto", () => {
  const bar = read("src/components/use-cases/filter-bar.tsx");
  assert.match(bar, /<div data-slot="filter-bar" className="min-w-0">\s*<FilterChips /);
  const chips = read("src/components/ui-10/filter-chips.tsx");
  assert.ok(chips.includes('"flex min-w-0 items-center gap-2"') && chips.includes("size-11 sm:hidden"), "una riga, la lente da 44 px al telefono");
  assert.ok(chips.includes('data-slot="filter-chips-active" className="flex flex-wrap items-center gap-2"'), "i chip vanno a capo, mai di lato");
  const classes = [...bar.matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]).join(" ");
  assert.doesNotMatch(classes, VIEWPORT_VARIANT, "filter-bar.tsx: una forma sulla larghezza della finestra");
});

test("(rilascio 10, §3.4) tutti e nove i filtri in un foglio, nell'ordine della proposta: niente più prima riga né «Altri filtri»", () => {
  const bar = read("src/components/use-cases/filter-bar.tsx");
  assert.doesNotMatch(bar, /ORIGIN_INLINE|originNav|<KindMenu|function MoreFilters|<ReferentMenu|<AreaMenu/);
  const order = ["\"referente\"", "\"area\"", "\"tipo\"", "\"origine\"", "\"canale\"", "\"agente\"", "\"trimestre\"", "\"info\"", "\"lab\""].map((key) => bar.indexOf(`push(${key}`));
  assert.ok(order.every((at, i) => at > 0 && (i === 0 || at > order[i - 1])), order.join(", "));
});

test("lo script delle schermate controlla lo scorrimento orizzontale e le colonne a 768, 900, 1024 e 1280 px", () => {
  const screens = read("scripts/use-case-test/screens-hub.mjs");
  assert.match(screens, /const DEFAULT_OVERFLOW_WIDTHS = \[768, 900, 1024, 1280\];/);
  assert.match(screens, /const layout = await hubLayout\(page\);/);
  assert.match(screens, /if \(layout\.rowsOnTwoLines\) failures\.push\(/);
  assert.match(screens, /if \(layout\.wider\) failures\.push\(/);
  assert.match(screens, /for \(const width of \[\.\.\.widths, \.\.\.overflowWidths\]\)/);
  assert.match(screens, /if \(report\.horizontalOverflow\) \{/);
  assert.match(screens, /failures\.push\(`horizontal scroll at \$\{width\} px/);
});

test("la scheda guidata: una colonna di 768 px, il percorso in riga da 40rem della scheda, mai la finestra", () => {
  const detail = read("src/components/use-cases/detail/detail.tsx");
  // (Rilascio 10, §3.4) Una colonna, larga al massimo 768 px, come le board: niente più colonna di destra.
  assert.match(detail, /data-slot="use-case-detail" data-projection=\{result\.projection\} className=\{cn\("@container\/scheda mx-auto w-full max-w-3xl min-w-0", className\)\}/);
  assert.ok(detail.includes('data-slot="scheda-body" className="mt-8 min-w-0 space-y-10"'));
  for (const gone of ["scheda-grid", "scheda-aside", "grid-cols-[minmax(0,1fr)_18rem]"]) assert.ok(!detail.includes(gone), gone);
  // Il contributore tiene la sua colonna di lettura.
  assert.match(detail, /data-projection="contributore" className=\{cn\("mx-auto w-full max-w-3xl min-w-0 space-y-6", className\)\}/);
  const path = read("src/components/use-cases/detail/use-case-path.tsx");
  assert.ok(path.includes('"grid-cols-3 @min-[40rem]/scheda:grid-cols-6"') && path.includes('"grid-cols-2 @min-[40rem]/scheda:grid-cols-4"'));
  // (Rilascio 6, B.1) Il passo è una riga sola, che va a capo tra i controlli, mai dentro un pulsante.
  const box = read("src/components/use-cases/detail/next-step-box.tsx");
  assert.ok(box.includes('data-slot="next-step-actions" className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"'));
  // (Rilascio 10, §5.7) Al telefono il pulsante pieno del passo è largo quanto la colonna, meno il «?».
  assert.ok(box.includes('const touch = cn("min-h-11 sm:min-h-8", wide && "max-sm:flex-1");'));
  // «Valore»: il numero grande (`BigNumber`), poi una riga; «Come cambia il lavoro»: i tre passi in riga da 40rem.
  assert.ok(read("src/components/use-cases/detail/impact-block.tsx").includes('<p data-slot="valore-riga" className={NOTE}>'));
  assert.ok(read("src/components/use-cases/detail/work-flow.tsx").includes("@min-[40rem]/scheda:grid-cols-[minmax(0,1fr)_1.25rem_minmax(0,1fr)_1.25rem_minmax(0,1fr)]"));
  for (const file of [
    "src/components/use-cases/detail/detail.tsx",
    "src/components/use-cases/detail/use-case-path.tsx",
    "src/components/use-cases/detail/path-disclosure.tsx",
    "src/components/use-cases/detail/next-step-box.tsx",
    "src/components/use-cases/detail/fold.tsx",
    "src/components/use-cases/detail/arrival.tsx",
    "src/components/use-cases/detail/referent/dialog-host.tsx",
    "src/components/use-cases/detail/impact-block.tsx",
    "src/components/use-cases/detail/work-flow.tsx",
  ]) {
    const classes = [...read(file).matchAll(/["`]([^"`\n]*)["`]/g)].map((match) => match[1]).join(" ");
    assert.doesNotMatch(classes, VIEWPORT_VARIANT, `${file}: una forma sulla larghezza della finestra`);
  }
});

test("«Quando»: le tre scelte restano su una riga e una parola lunga va a capo, mai tagliata", () => {
  // Nella card «Quando» della scheda (p-4 e bordo) a 400 px ogni scelta ha 94 px: «Prossimo trimestre»
  // ne vuole 104 e con `truncate` diventava «Prossimo trime…» (a 375 anche «Questo trime…»).
  const when = read("src/components/use-cases/when-control.tsx");
  assert.ok(when.includes('"grid w-full max-w-md grid-cols-3 gap-1 rounded-lg bg-muted p-1"'), "tre scelte in una riga");
  assert.ok(when.includes('<span className="w-full text-xs leading-tight text-balance">{parts.title}</span>'), "il titolo va a capo, bilanciato");
  assert.doesNotMatch(when, /\btruncate\b/, "nessuna etichetta tagliata con «…»");
});
