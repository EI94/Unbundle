import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import { CONTEXT_TEXT as T } from "../../lib/context/text.ts";
import type { PersonHits } from "../../lib/db/queries/context-people.ts";
import type { SourceListItem } from "../../lib/db/queries/context-sources.ts";

// «Cerca una persona» reso sul server (rilascio 9b, RILASCIO-9b-COSTRUZIONE.md §2.13): il link c'è solo per Lateral
// Space; i risultati a gruppi, nell'ordine del piano e con il numero, il nome evidenziato, «Storia» per le versioni di
// prima, i documenti con «Apri» (solo quelli con un pannello) e la frase sui documenti che restano; il piede con «Togli
// «…» da tutto» non pieno e la conferma con i testi del piano. Router, avvisi e azioni sono finti.

const REACT = import.meta.resolve("react");
await installAppModules({
  "next/navigation": `export function useRouter() { return { push() {}, refresh() {}, replace() {} }; }
    export function usePathname() { return "/"; }
    export function useSearchParams() { return new URLSearchParams(); }`,
  "next/link": `import React from ${JSON.stringify(REACT)};
    export default function Link({ href, children, prefetch, scroll, replace, ...rest }) { return React.createElement("a", { href: String(href), ...rest }, children); }`,
  sonner: `export const toast = Object.assign(() => {}, { success() {}, error() {} });`,
  "@/lib/actions/context": ["removeSourceAction", "setDocumentVisibilityAction", "writeFactAction", "editFactAction", "reconfirmFactAction", "retireFactAction"]
    .map((name) => `export async function ${name}() { return { ok: true, value: true }; }`)
    .join("\n"),
  "@/lib/actions/context-people": ["searchPersonAction", "erasePersonAction"].map((name) => `export async function ${name}() { return { ok: false, error: "riprova", message: "" }; }`).join("\n"),
  "@/lib/actions/uc-subprocessors": `export async function declareSubprocessorsAction() { return { ok: true, data: null, message: "" }; }`,
});
await enableTsxImports();
const { PeopleSearch, PeopleResults, EraseFooter, erasableCount, eraseNumbers, confirmReady, CONFIRM_GUARD_MS } = await import("./people-search.tsx");
const { NotesView } = await import("./notes-view.tsx");

const WS = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-11-18";
const render = (element: ReactElement) => renderToStaticMarkup(element);
/** Il testo visibile, un pezzo per elemento, con le entità decodificate. */
function textOf(html: string): string[] {
  return html
    .split(/<[^>]+>/)
    .map((piece) => piece.replaceAll("&#x27;", "'").replaceAll("&quot;", '"').replaceAll("&amp;", "&").replaceAll("&lt;", "<").replaceAll("&gt;", ">").trim())
    .filter(Boolean);
}
/** Le classi dei pulsanti con quel testo. */
function buttonClasses(html: string, label: string): string[] {
  return [...html.matchAll(/<button[^>]*class="([^"]*)"[^>]*>([\s\S]*?)<\/button>/g)].filter((m) => textOf(m[2]).join(" ") === label).map((m) => m[1]);
}
const FILLED = /(^|\s)bg-primary(\s|$)/;

function hits(over: Partial<PersonHits> = {}): PersonHits {
  return {
    term: "Rossi",
    isEmail: false,
    notes: {
      total: 2,
      rows: [
        { id: "n1", title: "Call di avvio", occurredOn: "2026-11-14", snippet: { before: "Ha chiamato Mario ", match: "Rossi", after: " per gli ordini." } },
        { id: "n3", title: "Trascrizione", occurredOn: "2026-11-12", snippet: null },
      ],
    },
    facts: {
      total: 3,
      rows: [
        { id: "f1", history: false, statement: "Rossi gestisce il magazzino.", snippet: { before: "", match: "Rossi", after: " gestisce il magazzino." } },
        { id: "f0", history: true, statement: "Rossi gestiva gli ordini.", snippet: { before: "", match: "Rossi", after: " gestiva gli ordini." } },
      ],
    },
    items: { total: 7 },
    map: { total: 2 },
    documents: { total: 2, rows: [{ sourceId: null, fileName: "listino.xlsx" }, { sourceId: "s1", fileName: "organigramma-rossi.pdf" }] },
    granola: { total: 1 },
    chat: { total: 1 },
    inClientName: false,
    ...over,
  };
}
const none = hits({ notes: { total: 0, rows: [] }, facts: { total: 0, rows: [] }, items: { total: 0 }, map: { total: 0 }, documents: { total: 0, rows: [] }, granola: { total: 0 }, chat: { total: 0 } });
const noop = () => undefined;

test("il link «Cerca una persona» c'è nella vista «Appunti» di Lateral Space, non in quella «Documenti» del cliente", () => {
  const closed = render(createElement(PeopleSearch, { workspaceId: WS, today: TODAY, onOpenSource: noop }));
  assert.deepEqual(textOf(closed), ["Cerca una persona"], "chiuso: solo il link, niente campo");
  assert.equal(buttonClasses(closed, "Cerca una persona").some((c) => FILLED.test(c)), false, "un link, non un pulsante pieno");
  const source: SourceListItem = { id: "s1", kind: "appunti", origin: "web", title: "Call di avvio", occurredOn: "2026-11-14", state: "letto", readReason: null, openProposals: 0, visibility: "ls", document: null, canRemove: true };
  const ls = textOf(render(createElement(NotesView, { workspaceId: WS, today: TODAY, lateralSpace: true, sources: [source], initialSourceId: null })));
  assert.ok(ls.includes("Cerca una persona"));
  assert.ok(ls.indexOf("Cerca una persona") > ls.indexOf("Call di avvio"), "in fondo, dopo l'elenco");
  assert.ok(textOf(render(createElement(NotesView, { workspaceId: WS, today: TODAY, lateralSpace: true, sources: [], initialSourceId: null }))).includes("Cerca una persona"));
  const client = textOf(render(createElement(NotesView, { workspaceId: WS, today: TODAY, lateralSpace: false, sources: [], initialSourceId: null })));
  assert.equal(client.includes("Cerca una persona"), false);
});

test("i risultati: i gruppi nell'ordine del piano, ognuno con il numero; i gruppi vuoti non ci sono", () => {
  const text = textOf(render(createElement(PeopleResults, { hits: hits(), today: TODAY, onOpenDocument: noop })));
  const groups = ["Appunti", "Fatti", "Citazioni, proposte, impegni e domande", "Mappa", "Documenti", "Regole di Granola", "Memoria della chat"];
  const at = groups.map((label) => text.indexOf(label));
  assert.ok(at.every((i) => i >= 0), JSON.stringify(text));
  assert.deepEqual([...at].sort((a, b) => a - b), at, "nell'ordine del piano");
  assert.deepEqual(at.map((i) => text[i + 1]), ["2", "3", "7", "2", "2", "1", "1"]);
  const fewer = textOf(render(createElement(PeopleResults, { hits: hits({ granola: { total: 0 }, items: { total: 0 }, map: { total: 0 } }), today: TODAY, onOpenDocument: noop })));
  assert.equal(fewer.includes("Regole di Granola") || fewer.includes("Citazioni, proposte, impegni e domande") || fewer.includes("Mappa"), false);
  assert.deepEqual(textOf(render(createElement(PeopleResults, { hits: none, today: TODAY, onOpenDocument: noop }))), ["Non compare da nessuna parte."]);
});

test("appunti e fatti con il nome evidenziato, «Storia» per le versioni di prima; i documenti con «Apri» solo se hanno un pannello", () => {
  const html = render(createElement(PeopleResults, { hits: hits(), today: TODAY, onOpenDocument: noop }));
  assert.equal(html.match(/<mark[^>]*>Rossi<\/mark>/g)?.length, 3, "il nome di un appunto e dei due fatti");
  const text = textOf(html);
  assert.ok(text.includes("Call di avvio") && text.includes("14 nov") && text.includes("Ha chiamato Mario") && text.includes("per gli ordini."));
  assert.equal(text.filter((t) => t === "Storia").length, 1);
  assert.ok(text.includes("I documenti restano: aprili e togli quelli che servono."));
  assert.ok(text.includes("listino.xlsx") && text.includes("organigramma-rossi.pdf"));
  assert.equal(text.filter((t) => t === "Apri").length, 1, "il documento di prima della 9a non ha un pannello");
  // L'evidenziato usa i colori del tema: nessun colore fisso.
  assert.match(html, /<mark class="[^"]*bg-primary\/15[^"]*text-foreground/);
});

/** Il piede per «Mario Rossi», con i numeri della ricerca di prova (2 appunti; 3 fatti e 7 altri testi). */
const footer = (over: Partial<Parameters<typeof EraseFooter>[0]> = {}) =>
  render(createElement(EraseFooter, { term: "Mario Rossi", ...eraseNumbers(hits()), inClientName: false, asking: false, busy: false, onAsk: noop, onCancel: noop, onConfirm: noop, ...over }));

test("il piede: «Togli «…» da tutto» non pieno; poi la conferma con i testi del piano e «Togli» distruttivo ma non pieno", () => {
  const first = footer();
  assert.deepEqual(textOf(first), ["Togli «Mario Rossi» da tutto"]);
  assert.equal(buttonClasses(first, "Togli «Mario Rossi» da tutto").some((c) => FILLED.test(c)), false);
  const confirm = footer({ asking: true });
  assert.deepEqual(textOf(confirm), [
    "Togliere «Mario Rossi»?",
    "Si cancella il testo di 2 appunti e si correggono 10 testi.",
    "Il testo degli appunti trovati si cancella: restano data, fatti e un titolo generico. Nei fatti, anche nella storia, nelle citazioni, nelle proposte, negli impegni e nelle domande il nome diventa «una persona». Le regole di Granola e la memoria della chat lo perdono; i nodi della Mappa con quel nome si tolgono. I documenti restano. Non si torna indietro.",
    "Togli",
    "Annulla",
  ]);
  const erase = buttonClasses(confirm, "Togli");
  assert.equal(erase.length, 1);
  assert.equal(FILLED.test(erase[0]), false, "non pieno");
  assert.match(erase[0], /bg-destructive\/10/, "il tono distruttivo, leggero");
});

test("un doppio clic non toglie: «Annulla» sta dove era «Togli … da tutto» (a destra sullo schermo largo, sotto sul telefono) e «Togli» aspetta 600 ms", () => {
  const confirm = footer({ asking: true });
  const row = /<div class="([^"]*)"><button[^>]*>Togli<\/button><button[^>]*>Annulla<\/button><\/div>/.exec(confirm);
  assert.ok(row, "«Togli» prima, «Annulla» ultimo");
  const classes = row[1].split(/\s+/);
  // Sul telefono una colonna nell'ordine dei pulsanti: «Annulla» in basso, come prima. Sullo schermo largo una riga: «Annulla» a destra.
  assert.ok(classes.includes("flex-col") && classes.includes("sm:flex-row") && classes.includes("sm:justify-end"), row[1]);
  assert.equal(classes.some((c) => /reverse/.test(c)), false, "nessun ordine rovesciato");
  // Il primo pulsante sta a destra in basso, dove poi c'è «Annulla».
  assert.match(buttonClasses(footer(), "Togli «Mario Rossi» da tutto")[0], /sm:self-end/);
  // «Togli» non vale per 600 ms da quando la conferma si apre.
  assert.equal(CONFIRM_GUARD_MS, 600);
  assert.deepEqual([confirmReady(1000, 1000), confirmReady(1000, 1250), confirmReady(1000, 1599), confirmReady(1000, 1600), confirmReady(1000, 5000)], [false, false, false, true, true]);
  const source = readFileSync(new URL("./people-search.tsx", import.meta.url), "utf8");
  assert.match(source, /onClick=\{\(\) => \{\s*openedAt\.current = performance\.now\(\);\s*onAsk\(\);\s*\}\}/, "il primo clic segna quando si apre la conferma");
  assert.match(source, /onClick=\{\(\) => \{\s*if \(confirmReady\(openedAt\.current, performance\.now\(\)\)\) onConfirm\(\);\s*\}\}/, "«Togli» passa da confirmReady");
  assert.doesNotMatch(source, /onClick=\{onConfirm\}/);
});

test("la conferma dice i numeri prima di «Togli»: dalla stessa ricerca, al singolare e al plurale; senza appunti né testi nessuna riga", () => {
  const P = T.people;
  assert.deepEqual(eraseNumbers(hits()), { notes: 2, texts: 3 + 7 }, "i testi corretti: fatti, citazioni, proposte, impegni e domande, come «Fatto: …»");
  assert.equal(P.eraseCount(3, 7), "Si cancella il testo di 3 appunti e si correggono 7 testi.");
  assert.equal(P.eraseCount(1, 1), "Si cancella il testo di 1 appunto e si corregge 1 testo.");
  assert.equal(P.eraseCount(1, 4), "Si cancella il testo di 1 appunto e si correggono 4 testi.");
  assert.equal(P.eraseCount(2, 0), "Si cancella il testo di 2 appunti.");
  assert.equal(P.eraseCount(0, 4), "Si correggono 4 testi.");
  assert.equal(P.eraseCount(0, 1), "Si corregge 1 testo.");
  const onlyGranola = textOf(footer({ notes: 0, texts: 0, asking: true }));
  assert.equal(onlyGranola.some((t) => t.startsWith("Si c")), false, "solo Granola e chat: niente numeri da dire");
});

test("una parola sola del nome del cliente: al posto di «Togli … da tutto» la frase che chiede nome e cognome, nessun pulsante", () => {
  const html = footer({ term: "Alfa", inClientName: true });
  assert.deepEqual(textOf(html), ["Questa parola è anche nel nome del cliente: scrivi nome e cognome, oppure l'e-mail."]);
  assert.doesNotMatch(html, /<button/);
  assert.doesNotMatch(footer({ term: "Alfa", inClientName: true, asking: true }), /<button/, "nemmeno a conferma aperta");
});

test("«Togli … da tutto» conta tutto tranne i documenti, che restano", () => {
  assert.equal(erasableCount(hits()), 2 + 3 + 7 + 2 + 1 + 1);
  assert.equal(erasableCount(hits({ notes: { total: 0, rows: [] }, facts: { total: 0, rows: [] }, items: { total: 0 }, map: { total: 0 }, granola: { total: 0 }, chat: { total: 0 } })), 0, "solo documenti: niente da togliere");
  assert.equal(erasableCount(hits({ notes: { total: 0, rows: [] }, facts: { total: 0, rows: [] }, items: { total: 0 }, map: { total: 1 }, granola: { total: 0 }, chat: { total: 0 } })), 1, "un nodo della Mappa si toglie");
});
