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
