import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { parseCss } from "../../theme/test-support/board-css.ts";
import { WIDE_QUERY } from "./prefs.ts";

// Il foglio delle viste della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.8, §9.2). Le regole di scopo, token e
// colori le controlla src/components/theme/board-theme.test.ts su tutti e tre i fogli; qui quello che vale per questo:
// - nessuna regola riscrive una regola di board.css con lo stesso selettore (il confronto con il riferimento resta
//   vero): quello che cambia in un contesto nuovo ha un selettore suo;
// - sulla finestra solo il pannello dell'assistente (la stessa soglia del codice), il tocco e il passaggio; le griglie
//   si misurano sull'area della board;
// - ogni classe che il foglio nomina esiste: in board.css o nel markup delle viste (niente regole morte, niente refusi);
// - sul tocco niente trascinamento e i controlli nascosti al passaggio si vedono.

const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");
const views = parseCss(read("src/components/mappatura/board-views.css"));
const board = parseCss(read("src/components/mappatura/board.css"));

test("nessuna regola del foglio delle viste riscrive una regola di board.css con lo stesso selettore", () => {
  const ported = new Set(board.map((rule) => rule.selector));
  const rewritten = views.filter((rule) => ported.has(rule.selector)).map((rule) => `${rule.at ?? ""} ${rule.selector}`);
  assert.deepEqual(rewritten, []);
  assert.ok(views.length > 60, "le regole ci sono");
});

test("sulla finestra solo il pannello dell'assistente (la soglia del codice), il tocco e il passaggio; il resto sull'area della board", () => {
  const media = [...new Set(views.filter((rule) => rule.at?.startsWith("@media")).map((rule) => rule.at))].sort();
  assert.deepEqual(media, ["@media (hover: hover)", "@media (hover: none)", `@media ${WIDE_QUERY}`]);
  for (const rule of views.filter((item) => item.at?.startsWith("@container"))) assert.match(rule.at!, /^@container board \((max|min)-width: \d+px\)$/, rule.at!);
  // Il pannello agganciato: una colonna di 380 px, ferma sotto la barra del workspace; sotto la soglia sopra la pagina.
  const docked = views.find((rule) => rule.at === `@media ${WIDE_QUERY}` && rule.selector === "[data-board-root] .b-assist")!.declarations;
  assert.deepEqual([docked.get("position"), docked.get("top"), docked.get("width"), docked.get("flex")], ["sticky", "var(--board-shell-top)", "380px", "0 0 380px"]);
  const over = views.find((rule) => rule.at === null && rule.selector === "[data-board-root] .b-assist")!.declarations;
  assert.deepEqual([over.get("position"), over.get("width"), over.get("z-index")], ["fixed", "min(540px, 100%)", "50"]);
  assert.equal(views.find((rule) => rule.selector === "[data-board-root] .b-assist[hidden]")?.declarations.get("display"), "none", "chiuso, il pannello resta montato ma non si vede");
});

test("ogni classe che il foglio nomina esiste, in board.css o nel markup delle viste", () => {
  const walk = (dir: string): string[] =>
    readdirSync(new URL(`../../../../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? walk(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`]));
  const markup = walk("src/components/mappatura")
    .filter((file) => file.endsWith(".tsx"))
    .map(read)
    .join("\n");
  const known = new Set([...board.flatMap((rule) => rule.selector.match(/\.b-[a-z0-9-]+/g) ?? []), ...(markup.match(/\bb-[a-z0-9-]+/g) ?? []).map((name) => `.${name}`)]);
  const used = new Set(views.flatMap((rule) => rule.selector.match(/\.b-[a-z0-9-]+/g) ?? []));
  assert.deepEqual([...used].filter((name) => !known.has(name)), []);
  // E al contrario: ogni classe che le viste della board scrivono ha una regola in uno dei tre fogli.
  const companion = parseCss(read("src/components/mappatura/board-companion.css"));
  const styled = new Set([...board, ...views, ...companion].flatMap((rule) => rule.selector.match(/\.b-[a-z0-9-]+/g) ?? []));
  const written = walk("src/components/mappatura/board")
    .filter((file) => file.endsWith(".tsx"))
    .flatMap((file) => [...read(file).matchAll(/className=(?:"([^"]+)"|\{[^}]*?"([^"]+)")/g)].flatMap((match) => (match[1] ?? match[2]).split(/\s+/)))
    .filter((name) => name.startsWith("b-"));
  assert.ok(written.length > 40);
  assert.deepEqual([...new Set(written)].filter((name) => !styled.has(`.${name}`)), []);
});

test("sul tocco niente trascinamento; i controlli che compaiono al passaggio si vedono sempre", () => {
  const touch = views.filter((rule) => rule.at === "@media (hover: none)");
  const declared = (selector: string) => touch.find((rule) => rule.selector === `[data-board-root] ${selector}`)?.declarations;
  assert.equal(declared(".b-node-w > .b-grip")?.get("display"), "none");
  assert.equal(declared(".b-row-ctl")?.get("opacity"), "1");
  assert.equal(declared(".b-point .b-point-ctl")?.get("opacity"), "1");
  assert.equal(declared(".b-add-step")?.get("opacity"), ".8");
});

test("una corsia vuota che si modifica mostra sempre «+ nota»; in una corsia con note compare al passaggio o al fuoco (P21)", () => {
  const empty = views.find((rule) => rule.at === null && rule.selector === "[data-board-root] .b-cell:not(:has(.b-note-w)) > .b-add");
  assert.equal(empty?.declarations.get("opacity"), "1");
  // Il riferimento nasconde «+ nota» fino al passaggio: la regola portata resta com'è, per le corsie con note.
  assert.equal(board.find((rule) => rule.at === null && rule.selector === "[data-board-root] .b-cell .b-add")?.declarations.get("opacity"), "0");
});

test("nelle tabelle impilate del telefono il nome della colonna e i passi stanno sulla stessa riga", () => {
  const stacked = views.find((rule) => rule.at === "@container board (max-width: 680px)" && rule.selector === "[data-board-root] .b-tbl.b-stack .b-steprefs");
  // In linea: i passi scorrono dopo «Passi: » e vanno a capo come un testo (un riquadro, anche in linea, andrebbe a capo
  // intero appena i passi sono più di uno).
  assert.equal(stacked?.declarations.get("display"), "inline");
  assert.equal(views.find((rule) => rule.at === "@container board (max-width: 680px)" && rule.selector === "[data-board-root] .b-tbl.b-stack .b-stepref")?.declarations.get("margin-right"), "12px");
  // «Passi: » è il ::before della cella (board.css): un blocco dopo di lui andrebbe a capo.
  assert.ok(board.some((rule) => rule.selector === "[data-board-root] .b-tbl.b-stack td[data-l]::before"));
});

// ─── La mappa: card della larghezza del riferimento, in griglia ──────

/** Una dichiarazione di una regola di board.css (o del foglio delle viste), nel contesto dato. */
const rule = (sheet: typeof board, selector: string, at: string | null = null) => sheet.find((item) => item.at === at && item.selector === `[data-board-root] ${selector}`)?.declarations;

test("le card della mappa: la larghezza del riferimento a 1440, mai stirate per riempire una riga corta; la mappa si legge come una griglia", () => {
  // Il token: 188 px, la card della riga di sei passi del riferimento a 1440 (188,7 px nella sua mappa di 1382 px, BOARD-SPEC
  // §6 la arrotonda a 189): sei card in sola lettura stanno nella mappa di 1440 senza farla scorrere, come lì.
  assert.equal(board.find((item) => item.at === null && item.selector === "[data-board-root]" && item.declarations.has("--board-card"))?.declarations.get("--board-card"), "188px");
  assert.ok(136 + 24 + 6 * 188 + 5 * 18 <= 1382, "sei passi nella mappa del riferimento a 1440");
  // La card, con o senza la maniglia: base fissa, niente crescita, mai più stretta.
  for (const selector of [".b-pm-steps .b-node", ".b-node-w"]) {
    const declared = rule(board, selector);
    assert.equal(declared?.get("flex")?.replace(/\s+/g, " "), "0 0 var(--board-card)", `${selector}: flex`);
    assert.equal(declared?.get("min-width"), "var(--board-card)", `${selector}: min-width`);
  }
  // Dentro la card con la maniglia la card riempie il suo posto, e niente di più.
  assert.equal(rule(board, ".b-node-w > .b-node")?.get("flex"), "1 1 auto");
  // Ogni riga è larga quanto la più lunga: n card della stessa larghezza, n − 1 frecce, i margini, l'etichetta.
  const arrow = rule(board, ".b-arrow")?.get("width");
  const padding = rule(board, ".b-pm-steps")?.get("padding");
  assert.deepEqual([arrow, padding], ["18px", "12px"]);
  for (const [at, label] of [[null, "160px"], ["@container board (max-width:1499px)", "136px"]] as const) {
    const row = rule(board, ".b-pm-row", at);
    assert.equal(row?.get("grid-template-columns"), `${label} minmax(0,1fr)`);
    assert.equal(row?.get("min-width"), `calc(${label} + 24px + var(--steps, 1) * (var(--board-card) + 18px) - 18px + var(--b-after, 0px))`, `${at ?? "sempre"}: la larghezza della riga`);
  }
});

test("«+ passo» ha il suo posto in fondo a ogni riga della mappa che si modifica: --b-after copre il bottone e il segno di un trascinamento", () => {
  const px = (value: string | undefined, what: string) => {
    const match = /^(\d+(?:\.\d+)?)px$/.exec(value?.trim() ?? "");
    assert.ok(match, `${what}: «${value}» non è in px`);
    return Number(match[1]);
  };
  // Quello che sta dopo l'ultima card: il margine del contenitore, il bottone tratteggiato (margini, bordo, la scritta) e,
  // mentre si trascina un passo in fondo alla riga, il segno di dove cadrà.
  const after = rule(board, ".b-pm-after");
  const add = rule(board, ".b-add");
  const mark = rule(views, ".b-drop-mark");
  assert.equal(after?.get("flex"), "none", "il posto di «+ passo» non si stringe");
  assert.equal(rule(views, ".b-add-step")?.get("white-space"), "nowrap", "«+ passo» non va a capo");
  const [padY, padX] = (add?.get("padding") ?? "").split(/\s+/);
  assert.equal(px(padY, "padding verticale del bottone"), 2);
  const border = px(/^(\d+px)/.exec(add?.get("border") ?? "")?.[1], "bordo del bottone");
  // La scritta «+ passo» in Geist 12 px: 42,5 px in Chrome (lo script delle schermate controlla che resti dentro la riga).
  const TEXT = 43;
  assert.equal(add?.get("font-size"), "12px");
  const need = px(after?.get("padding-left"), "margine di .b-pm-after") + 2 * px(padX, "padding del bottone") + 2 * border + TEXT + px(mark?.get("width"), "segno") + px(mark?.get("margin-right"), "margine del segno");
  const room = px(rule(views, ".b-pm[data-adds]")?.get("--b-after"), "--b-after");
  assert.ok(room >= need, `--b-after ${room} px, ne servono ${need}`);
  // La mappa in sola lettura non ha «+ passo»: niente posto in più (la larghezza della riga lo legge con 0 px di default).
  assert.equal(views.filter((item) => item.declarations.has("--b-after")).map((item) => item.selector).join(), "[data-board-root] .b-pm[data-adds]");
});

test("il posto del toast: in fondo alla colonna della board (fermo in fondo alla finestra), sopra il campo dell'assistente, in fondo a un drawer", () => {
  const companion = parseCss(read("src/components/mappatura/board-companion.css"));
  // Il posto: alto zero, sopra la pagina; nella colonna della board fermo in fondo alla finestra, e sale di --b-toast-lift.
  const dock = rule(board, ".b-toast-dock");
  assert.deepEqual([dock?.get("position"), dock?.get("height"), dock?.get("z-index")], ["relative", "0", "60"]);
  const page = rule(board, ".b-board-col > .b-toast-dock");
  assert.deepEqual([page?.get("position"), page?.get("bottom")], ["sticky", "var(--b-toast-lift, 0px)"]);
  // Il toast nel suo posto: centrato su di lui (la regola del riferimento: left 50%, translate −50%), largo quanto il testo.
  const inDock = rule(board, ".b-toast-dock > .b-toast");
  assert.deepEqual([inDock?.get("position"), inDock?.get("width")], ["absolute", "max-content"]);
  assert.deepEqual([rule(board, ".b-toast")?.get("left"), rule(board, ".b-toast")?.get("max-width")], ["50%", "calc(100% - 32px)"]);
  // Sopra la pagina, il pannello dell'assistente: il posto è il bordo alto del campo, il toast sta sopra di lui.
  const field = companion.find((item) => item.at === null && item.selector === "[data-board-root] .b-comp-form > .b-toast-dock")?.declarations;
  assert.deepEqual([field?.get("position"), field?.get("bottom"), field?.get("left"), field?.get("right")], ["absolute", "100%", "0", "0"]);
  assert.equal(companion.find((item) => item.selector === "[data-board-root] .b-comp-form")?.declarations.get("position"), "sticky", "il campo è il riferimento del suo posto");
  // Gli strumenti della mappa (con «Evidenzia attriti») non si coprono: il toast ci sale sopra.
  assert.match(read("src/components/mappatura/board/today-view.tsx"), /<div className="b-ctrl b-map-tools" data-b="map-tools" data-toast-avoid="">/);
  // Il compagno mette il toast del pannello in testa al suo campo.
  assert.match(read("src/components/mappatura/companion/companion.tsx"), /<form className="b-comp-form" onSubmit=\{onSubmit\}>\s+\{\/\*[^*]*\*\/\}\s+<PanelToast \/>/);
});
