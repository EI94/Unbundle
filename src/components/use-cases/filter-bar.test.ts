import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// (Rilascio 10, §3.4) La barra dei filtri della pagina «Use case» è il pezzo comune `FilterChips`: «Cerca» e «Filtri
// (n)», un foglio con tutti i filtri, i chip attivi con ✕ e «Togli tutti». Gli stessi parametri di prima. Resa in HTML,
// senza database (dati inventati).
let bar: typeof import("./filter-bar.tsx");
let render: (props: Record<string, unknown>) => string;
before(async () => {
  await enableTsxImports();
  bar = await import("./filter-bar.tsx");
  const { createElement } = (await import("react")) as unknown as { createElement: (type: unknown, props: unknown, ...children: unknown[]) => unknown };
  const { renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string };
  render = (props) => renderToStaticMarkup(createElement(bar.FilterBar, props));
});

const BASE = "/dashboard/ws/use-cases";
const MORE = {
  channels: [{ value: "slack_proposed", label: "Slack" }],
  areas: [{ value: "amministrazione_finanza", label: "Amministrazione e finanza" }],
  agents: [{ value: "LIBRA", label: "LIBRA" }],
  labs: [{ value: "AI Lab Prova", label: "AI Lab Prova" }],
  quarters: [{ value: "2027-Q1", label: "T1 2027" }],
  infos: [{ value: "da-verificare", label: "Da verificare" }],
};
const REFERENT = { options: [{ value: "manca", label: "Manca il referente · 4", word: "Manca il referente" }], shown: true, selected: null };
const SOURCE = readFileSync(new URL("./filter-bar.tsx", import.meta.url), "utf8");
const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("i campi del foglio: tutti e nove, nell'ordine della proposta; «Tipo» solo dove filtra; senza voci il campo non c'è", () => {
  const fields = bar.filterFields({ query: { vista: "panoramica" }, mode: "revisore", kind: "filtro", more: MORE, referent: REFERENT });
  assert.deepEqual(
    fields.map((field) => [field.key, field.label]),
    [
      ["referente", "Referente"],
      ["area", "Area"],
      ["tipo", "Tipo"],
      ["origine", "Origine"],
      ["canale", "Canale"],
      ["agente", "Agente"],
      ["trimestre", "Trimestre"],
      ["info", "Informazioni"],
      ["lab", "AI Lab"],
    ],
  );
  // Le due matrici del menu «⋯» sono solo «Da costruire»: lì «Tipo» non c'è.
  assert.ok(!bar.filterFields({ query: { vista: "panoramica", mostra: "matrice" }, mode: "revisore", kind: "nessuno", more: MORE }).some((field) => field.key === "tipo"));
  // Un campo senza voci (nessun agente nei titoli, nessun AI Lab) non c'è: un foglio senza scelte non serve.
  const few = bar.filterFields({ query: { vista: "panoramica" }, mode: "revisore", kind: "filtro", more: { ...MORE, agents: [], labs: [], infos: [] } });
  assert.deepEqual(few.map((field) => field.key), ["area", "tipo", "origine", "canale", "trimestre"]);
  // I nomi lunghi dell'origine solo nel foglio; il chip dice «Dal basso» (D4).
  const origin = fields.find((field) => field.key === "origine");
  assert.deepEqual(origin?.options, [
    { value: "adoption", label: "AI Adoption · dal basso", chip: "Dal basso" },
    { value: "transformation", label: "AI Transformation · dall'alto", chip: "Dall'alto" },
  ]);
  // «Referente»: la voce con il numero ai revisori, il chip con la sola parola.
  assert.deepEqual(fields[0].options, [{ value: "manca", label: "Manca il referente · 4", chip: "Manca il referente" }]);
});

test("(rilascio 10, §3.4) in «Cosa serve» prima «Stato», con «Ferme», «A posto» e «Aperte»; nelle altre viste no", () => {
  const fields = bar.filterFields({ query: { vista: "cosa-serve", stato: "ferme" }, mode: "revisore", kind: "filtro", more: MORE, referent: REFERENT });
  assert.equal(fields[0].key, "stato");
  assert.equal(fields[0].label, "Stato");
  assert.equal(fields[0].value, "ferme");
  assert.deepEqual(fields[0].options.map((option) => option.label), ["Da chiedere", "In attesa", "Da verificare", "Ferme", "A posto", "Aperte"]);
  for (const vista of ["panoramica", "da-decidere"]) {
    assert.ok(!bar.filterFields({ query: { vista, stato: "ferme" }, mode: "revisore", kind: "filtro", more: MORE }).some((field) => field.key === "stato"), vista);
  }
});

test("contributori: la ricerca e «Referente» quando serve, nient'altro; senza «Referente» nemmeno «Filtri»", () => {
  const contributor = { options: [{ value: "manca", label: "Manca il referente", word: "Manca il referente" }, { value: "in-attesa", label: "In attesa del referente", word: "In attesa del referente" }], shown: true, selected: null };
  assert.deepEqual(bar.filterFields({ query: { vista: "da-decidere" }, mode: "contributore", kind: "filtro", referent: contributor }).map((field) => field.key), ["referente"]);
  assert.deepEqual(bar.filterFields({ query: { vista: "da-decidere", origine: "adoption" }, mode: "contributore", kind: "filtro", more: MORE, referent: { ...contributor, shown: false } }), []);
  const html = readable(render({ basePath: BASE, query: { vista: "da-decidere", q: "fatture" }, mode: "contributore", kind: "filtro", referent: { ...contributor, shown: false } }));
  assert.match(html, /<form role="search"[^>]*action="\/dashboard\/ws\/use-cases"/);
  assert.ok(!textOf(html).includes("Filtri"), "nessun foglio vuoto");
  assert.ok(!html.includes("Altri filtri") && !html.includes("Cerca per titolo o codice"));
});

test("resa: «Cerca» e «Filtri (n)»; i chip attivi con ✕ e «Togli tutti»; i parametri di prima, senza pannelli né ricevute", () => {
  const query = { vista: "da-decidere", origine: "adoption", area: "amministrazione_finanza", referente: "manca", q: "fatture", apri: "aaaaaaaa-0000-4000-8000-000000000001", thanks: "1" };
  const html = readable(render({ basePath: BASE, query, mode: "revisore", kind: "filtro", more: MORE, referent: { ...REFERENT, selected: "manca" } }));
  assert.equal((html.match(/data-slot="filter-bar"/g) ?? []).length, 1, "una sola barra");
  assert.ok(textOf(html).includes("Filtri (3)"));
  // I chip: le parole, mai l'id dell'area, i nomi corti dell'origine.
  const chips = [...html.matchAll(/<li class="inline-flex[^"]*"><span>([^<]*)<\/span><a aria-label="([^"]*)"[^>]*href="([^"]*)"/g)].map((m) => [m[1], m[3], m[2]]);
  assert.deepEqual(chips.map((chip) => chip[0]), ["Referente: Manca il referente", "Area: Amministrazione e finanza", "Origine: Dal basso"]);
  // Ogni ✕ toglie il suo filtro e tiene gli altri, la vista e la ricerca; mai il pannello o la ricevuta.
  assert.equal(chips[2][1], `${BASE}?vista=da-decidere&area=amministrazione_finanza&referente=manca&q=fatture`);
  assert.equal(chips[2][2], "Togli Origine: Dal basso");
  assert.ok(html.includes(`href="${BASE}?vista=da-decidere">Togli tutti</a>`), "«Togli tutti» toglie anche la ricerca");
  for (const transient of ["apri", "thanks"]) assert.ok(!new RegExp(`[?&]${transient}=`).test(html) && !html.includes(`name="${transient}"`), transient);
  // La ricerca: un modulo GET con la vista e i filtri di adesso.
  const search = /<form role="search"[\s\S]*?<\/form>/.exec(html)?.[0] ?? "";
  for (const [name, value] of [["vista", "da-decidere"], ["origine", "adoption"], ["area", "amministrazione_finanza"], ["referente", "manca"]]) {
    assert.ok(search.includes(`<input type="hidden" name="${name}" value="${value}"/>`), name);
  }
  assert.match(search, /<input type="search"[^>]*name="q" value="fatture"/);
  assert.deepEqual(findHubForbiddenIn([textOf(html)], "area"), []);
});

test("i vecchi link con «da stimare» (`stima`): un chip per toglierlo, fuori dai grafici; sui grafici non è un filtro", () => {
  const panoramica = bar.filterFields({ query: { vista: "panoramica", stima: "mancante" }, mode: "revisore", kind: "filtro", more: MORE });
  assert.deepEqual(panoramica.at(-1), { key: "stima", label: "Stima", options: [{ value: "mancante", label: "Da stimare" }, { value: "fuori-matrice", label: "Senza beneficio contato" }], value: "mancante" });
  assert.ok(!bar.filterFields({ query: { vista: "panoramica", mostra: "matrice", stima: "mancante" }, mode: "revisore", kind: "nessuno", more: MORE }).some((field) => field.key === "stima"));
  assert.ok(!bar.filterFields({ query: { vista: "panoramica" }, mode: "revisore", kind: "filtro", more: MORE }).some((field) => field.key === "stima"));
});

test("il sorgente: il pezzo comune, niente più tendine né popover propri; nessun filtro per persona", () => {
  assert.match(SOURCE, /import \{ FilterChips, type FilterField, type FilterOption \} from "@\/components\/ui-10\/filter-chips";/);
  for (const gone of ["DropdownMenu", "Popover", "useRouter", "MORE_FILTERS_COLLISION", "Altri filtri", "Togli i filtri", "router.replace"]) assert.ok(!SOURCE.includes(gone), gone);
  for (const person of ["proponente", "proposedBy", "autore"]) assert.ok(!SOURCE.includes(person), person);
});
