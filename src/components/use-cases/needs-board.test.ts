import test, { before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import type { NeedUseCaseRef, NeedView, NeedsBoard } from "../../lib/use-cases/needs.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// «Cosa serve» come una lista sola (rilascio 4, spec §13): la vista resa sul server da un elenco
// sintetico, senza database. Ogni requisito una volta sotto chi deve muoversi (per organizzazione,
// mai per persona), cinque righe in vista per gruppo, «Già a posto» chiuso, la linea del tempo dei
// prossimi passi accanto, i primi cinque in vista. Le prove nella pagina vera, con i dati di TopJet
// (prova), sono quelle del banco di prova (probe-r4b) e di needs-render.integration.test.ts.

let board: typeof import("./needs-board.tsx");
let needs: typeof import("../../lib/use-cases/needs.ts");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
/** `module.registerHooks` di Node 24 (i tipi di @types/node del progetto non lo hanno ancora). */
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

before(async () => {
  await enableTsxImports();
  // hub-header.tsx (il vuoto) porta con sé il menu «⋯» della testata e la sua action, che legge il
  // database: qui non serve (come in panorama-lanes.test.ts).
  const menu = `data:text/javascript,${encodeURIComponent("export function HubMenu() { return null; }")}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "./hub-menu" && context.parentURL?.endsWith("/hub-header.tsx")) return { url: menu, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  board = await import("./needs-board.tsx");
  needs = await import("../../lib/use-cases/needs.ts");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const TODAY = "2026-11-02";
const A = "aaaaaaaa-0000-4000-8000-000000000001";
const B = "bbbbbbbb-0000-4000-8000-000000000002";
const ITEMS: NeedUseCaseRef[] = [
  { id: A, code: "XV-0001", title: "LIBRA L1 · Smistamento" },
  { id: B, code: "XV-0002", title: "ORSA O1 · Fatture" },
];

let seq = 0;
function need(over: Partial<NeedView> = {}): NeedView {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    type: "requisito",
    kind: "altro",
    title: `Esigenza ${seq}`,
    detail: null,
    ownerLabel: null,
    ownerSide: null,
    status: "da_chiedere",
    availability: null,
    dueOn: null,
    dueLabel: null,
    dueIsProposal: false,
    forLabel: null,
    sortOrder: seq,
    version: 1,
    importKey: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    doneAt: null,
    archivedAt: null,
    archiveReason: null,
    useCaseIds: [A],
    ...over,
  };
}

/** Sette del cliente (una da verificare), due «Insieme», un fornitore, uno di Lateral Space, due a posto; otto passi. */
function fixture(): NeedView[] {
  return [
    ...Array.from({ length: 6 }, (_, i) => need({ title: `Cliente ${i + 1}`, ownerSide: "cliente", ownerLabel: i === 0 ? "Aldo Prova, ufficio acquisti" : null, detail: `Dettaglio lungo del cliente numero ${i + 1}` })),
    need({ title: "Risposta da guardare", ownerSide: "cliente", status: "in_verifica", sortOrder: 99 }),
    need({ title: "Insieme 1", ownerSide: "insieme" }),
    need({ title: "Insieme 2", ownerSide: "insieme", useCaseIds: [A, B] }),
    need({ title: "Del fornitore", ownerSide: "fornitore", status: "chiesta" }),
    need({ title: "Di Lateral Space", ownerSide: "lateral_space", status: "bloccata" }),
    need({ title: "A posto 1", ownerSide: "cliente", status: "validata" }),
    need({ title: "A posto 2", ownerSide: "fornitore", status: "non_applicabile" }),
    need({ type: "passo", status: "confermata", title: "Scaduto", dueOn: "2026-10-20" }),
    need({ type: "passo", status: "proposta", title: "Oggi", dueOn: TODAY }),
    need({ type: "passo", status: "proposta", title: "Novembre 1", dueOn: "2026-11-10" }),
    need({ type: "passo", status: "proposta", title: "Novembre 2", dueOn: "2026-11-20" }),
    need({ type: "passo", status: "proposta", title: "Novembre 3", dueOn: "2026-11-25" }),
    need({ type: "passo", status: "proposta", title: "Novembre 4", dueOn: "2026-11-28" }),
    need({ type: "passo", status: "confermata", title: "Dicembre", dueOn: "2026-12-05", ownerLabel: "Lateral Space", ownerSide: "lateral_space" }),
    need({ type: "passo", status: "proposta", title: "Da fissare", useCaseIds: [] }),
    need({ type: "passo", status: "fatta", title: "Fatto", dueOn: "2026-10-01" }),
  ];
}

const build = (list: NeedView[], only: import("../../lib/use-cases/needs.ts").NeedsBoardFilter | null = null): NeedsBoard => needs.buildNeedsBoard(list, ITEMS, { today: TODAY, only });
const render = (b: NeedsBoard, props: Record<string, unknown> = {}) =>
  readable(renderToStaticMarkup(createElement(board.NeedsBoardView, { board: b, clientLabel: "Alfa e Beta", hrefOf: (id: string) => `?vista=cosa-serve&apri=${id}`, ...props })));

function readable(page: string): string {
  return page.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
const N = " ";
const textOf = (html: string) => html.replace(/<(?:[^>"]|"[^"]*")*>/g, "").replace(/\s+/g, " ").replace(/ /g, " ").trim();
function between(page: string, from: string, to?: string): string {
  const start = page.indexOf(from);
  assert.ok(start >= 0, `manca ${from}`);
  const end = to ? page.indexOf(to, start + from.length) : -1;
  return page.slice(start, end === -1 ? undefined : end);
}
/** Il `<details data-slot=…>` dalla sua apertura alla sua chiusura (senza `<details>` dentro dello stesso slot). */
function details(page: string, slot: string): { opening: string; summary: string; body: string } {
  const start = page.indexOf(`<details data-slot="${slot}"`);
  assert.ok(start >= 0, `manca ${slot}`);
  let depth = 0;
  let at = start;
  const re = /<details\b|<\/details>/g;
  re.lastIndex = start;
  for (let m = re.exec(page); m; m = re.exec(page)) {
    depth += m[0] === "</details>" ? -1 : 1;
    if (depth === 0) {
      at = m.index;
      break;
    }
  }
  const html = page.slice(start, at);
  return { opening: html.slice(0, html.indexOf(">") + 1), summary: textOf(between(html, "<summary", "</summary>")), body: html.slice(html.indexOf("</summary>")) };
}
const ids = (html: string) => [...html.matchAll(/<li data-need="([^"]+)"/g)].map((match) => match[1]);

test("la vista: la riga dei conteggi in cima, i gruppi per organizzazione nell'ordine, senza numeri nei titoli", () => {
  const list = fixture();
  const html = render(build(list));
  const root = between(html, '<div data-slot="needs-board"');
  // La riga dei conteggi è il primo <p> della vista.
  assert.ok(root.indexOf("<p") === root.indexOf('<p data-slot="needs-summary"'), "il primo <p> è la riga dei conteggi");
  assert.equal(textOf(between(root, 'data-slot="needs-summary"', "</p>").replace(/^[^>]*>/, "")), "11 aperti · 8 da chiedere · 1 in attesa · 1 da verificare · 1 fermo · 2 a posto");
  const groups = [...html.matchAll(/<section aria-labelledby="(cosa-serve-gruppo-[a-z_]+)" data-need-group="([a-z_]+)"[^>]*><h2 id="\1" class="text-sm font-semibold">([^<]*)<\/h2>/g)].map((m) => [m[2], m[3]]);
  assert.deepEqual(groups, [
    ["cliente", "Alfa e Beta"],
    ["fornitore", "Fornitori"],
    ["lateral_space", "Lateral Space"],
  ]);
  // Nessun titolo di pagina, nessuna tabella, nessuna scheda del trimestre, nessun dettaglio, nessun €.
  for (const gone of [">Requisiti<", "<table", "Cosa vi chiediamo", "Il ritorno da confermare", "Dopo la scheda A.8", "Chi conferma i numeri", "€", "Dettaglio lungo", "data-need-area", "data-quarter-ask"]) {
    assert.ok(!html.includes(gone), gone);
  }
  // Nessun pulsante pieno nella vista: quello pieno è «Nuovo use case» della testata.
  assert.ok(!/class="[^"]*\bbg-primary\b/.test(html));
});

test("un gruppo: le prime cinque righe, prima da verificare, poi «Mostra le altre N» chiuso; «Insieme» con il cliente", () => {
  const list = fixture();
  const html = render(build(list));
  const client = between(html, 'data-need-group="cliente"', 'data-need-group="fornitore"');
  const more = details(client, "needs-group-more");
  assert.equal(more.opening, '<details data-slot="needs-group-more">', "chiuso di default");
  assert.equal(more.summary, "Mostra le altre 4");
  const shown = ids(client.slice(0, client.indexOf('<details data-slot="needs-group-more"')));
  const byTitle = new Map(list.map((n) => [n.title, n.id]));
  assert.deepEqual(shown, ["Risposta da guardare", "Cliente 1", "Cliente 2", "Cliente 3", "Cliente 4"].map((t) => byTitle.get(t)), "cinque, prima quella da verificare");
  assert.deepEqual(ids(more.body), ["Cliente 5", "Cliente 6", "Insieme 1", "Insieme 2"].map((t) => byTitle.get(t)));
  // «Insieme» lo dice nel suo «Chi»; la riga: titolo, stato, «Chi», «Per».
  const together = between(client, `data-need="${byTitle.get("Insieme 1")}"`, "</li>");
  assert.ok(textOf(together).includes("Insieme"));
  const first = between(client, `data-need="${byTitle.get("Cliente 1")}"`, "</li>");
  assert.match(first, new RegExp(`<span data-meta="chi" class="inline-flex min-w-0 items-center gap-x-2"><span class="min-w-0">Aldo Prova, ufficio acquisti${N}· Cliente</span>`));
  assert.ok(first.includes(">Da chiedere<") && first.includes('href="?vista=cosa-serve&apri=' + A + '"'), "lo stato dei cinque e «Per» che apre il pannello");
  // Più use case: «Per 2 use case» chiuso, con prima gli agenti dei titoli.
  const two = between(client, `data-need="${byTitle.get("Insieme 2")}"`, "</li>");
  assert.ok(two.indexOf('data-slot="need-agents"') < two.indexOf(`Per 2${N}use${N}case`));
  // Il gruppo di Lateral Space: «Ferma», mai «Bloccata».
  const ls = between(html, 'data-need-group="lateral_space"', "</section>");
  assert.ok(ls.includes(">Ferma<") && !ls.includes("Bloccata"));
  assert.ok(!between(html, 'data-need-group="fornitore"', "</section>").includes("needs-group-more"), "uno solo: nessun «Mostra»");
  // Sei righe: «Mostra l'altra».
  const six = render(build(list.filter((n) => n.ownerSide === "cliente" && n.type === "requisito").slice(0, 6)));
  assert.equal(details(six, "needs-group-more").summary, "Mostra l'altra");
});

test("ogni requisito una volta; «Già a posto · N» chiuso dopo i gruppi, nella colonna della lista", () => {
  const list = fixture();
  const html = render(build(list));
  const groupsColumn = between(html, '<div data-slot="needs-groups"', '<aside data-slot="needs-timeline"');
  const done = details(groupsColumn, "needs-done");
  assert.equal(done.opening, '<details data-slot="needs-done">');
  assert.equal(done.summary, "Già a posto · 2");
  const requirementIds = list.filter((n) => n.type === "requisito").map((n) => n.id);
  const shown = ids(groupsColumn);
  assert.equal(shown.length, requirementIds.length, "aperti e a posto");
  assert.equal(new Set(shown).size, shown.length, "nessuno due volte");
  assert.ok(requirementIds.every((id) => shown.includes(id)));
  assert.ok(groupsColumn.lastIndexOf('data-need-group="') < groupsColumn.indexOf('data-slot="needs-done"'), "dopo i gruppi");
});

test("«Prossimi passi»: accanto alla lista, «Prima di oggi» in testa, i primi cinque, la sezione spezzata ripete il titolo, «Fatti · N»", () => {
  const list = fixture();
  const html = render(build(list));
  // La griglia: la lista e la linea del tempo, sul riquadro della pagina.
  assert.ok(html.includes('<div data-slot="needs-layout" class="grid gap-8 @min-[58rem]/hub:grid-cols-[minmax(0,1fr)_18rem] @min-[58rem]/hub:gap-x-8">'));
  const aside = between(html, '<aside data-slot="needs-timeline" class="min-w-0 self-start">', "</aside>");
  assert.ok(aside.includes('<section aria-labelledby="cosa-serve-passi" data-slot="needs-steps"') && aside.includes('<h2 id="cosa-serve-passi" class="text-sm font-semibold">Prossimi passi</h2>'));
  const more = details(aside, "needs-steps-more");
  const visible = aside.slice(0, aside.indexOf('<details data-slot="needs-steps-more"'));
  const headings = (part: string) => [...part.matchAll(/<h3 id="([^"]+)" class="text-xs font-medium text-muted-foreground">([^<]*)<\/h3>/g)].map((m) => m[2]);
  assert.deepEqual(headings(visible), ["Prima di oggi", "Novembre 2026"], "gli scaduti prima; oggi è di novembre");
  const byTitle = new Map(list.map((n) => [n.title, n.id]));
  assert.deepEqual(ids(visible), ["Scaduto", "Oggi", "Novembre 1", "Novembre 2", "Novembre 3"].map((t) => byTitle.get(t)), "i primi cinque, per data");
  assert.equal(more.opening, '<details data-slot="needs-steps-more">');
  assert.equal(more.summary, "Mostra gli altri 3");
  assert.deepEqual(headings(more.body), ["Novembre 2026", "Dicembre 2026", "Senza data"], "novembre spezzato: il titolo si ripete");
  assert.deepEqual(ids(more.body), ["Novembre 4", "Dicembre", "Da fissare"].map((t) => byTitle.get(t)));
  // Gli id dei titoli sono unici anche quando una sezione si ripete.
  const headingIds = [...aside.matchAll(/<h3 id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(headingIds).size, headingIds.length);
  // La data su una riga sua, con <time>; lo stato e «Chi»; nessun numero nei titoli delle sezioni.
  const late = between(aside, `data-need="${byTitle.get("Scaduto")}"`, "</li>");
  assert.match(late, /<time dateTime="2026-10-20" class="block text-xs font-medium tabular-nums">20(?: | )ott<\/time>/);
  assert.ok(late.includes(">Confermato<"));
  assert.ok(between(more.body, `data-need="${byTitle.get("Dicembre")}"`, "</li>").includes('<span data-meta="chi" class="min-w-0">Lateral Space</span>'));
  assert.ok(!between(more.body, `data-need="${byTitle.get("Da fissare")}"`, "</li>").includes("<time"), "senza data, nessun <time>");
  const done = details(aside, "needs-steps-done");
  assert.equal(done.opening, '<details data-slot="needs-steps-done">');
  assert.equal(done.summary, "Fatto · 1");
  assert.ok(done.body.includes('<time dateTime="2026-10-01"'));
  // Ogni passo aperto una volta, fuori dai fatti.
  const open = ids(aside.slice(0, aside.indexOf('<details data-slot="needs-steps-done"')));
  assert.equal(open.length, 8);
  assert.equal(new Set(open).size, 8);
  // Le liste hanno la linea a sinistra, solo per decorazione.
  assert.ok(aside.includes('<ol class="space-y-3 border-l border-border pl-3">'));
});

test("con una ricerca tutte le parti chiuse della vista sono aperte; con gli altri filtri no", () => {
  const list = fixture();
  const searched = render(build(list), { searched: true });
  for (const slot of ["needs-group-more", "needs-done", "needs-steps-more", "needs-steps-done"]) assert.equal(details(searched, slot).opening, `<details data-slot="${slot}" open="">`, slot);
  const filtered = render(build(list), { filtersActive: true, quarter: "T4 2026" });
  for (const slot of ["needs-group-more", "needs-done", "needs-steps-more", "needs-steps-done"]) assert.equal(details(filtered, slot).opening, `<details data-slot="${slot}">`, slot);
  // Il trimestre in testa alla riga dei conteggi.
  assert.ok(textOf(between(filtered, 'data-slot="needs-summary"', "</p>").replace(/^[^>]*>/, "")).startsWith("T4 2026 · 11 aperti"));
});

test("i casi limite: senza passi niente colonna; solo passi la riga dei conteggi e «Niente da chiedere»; vuota", () => {
  const list = fixture();
  const onlyRequirements = render(build(list.filter((n) => n.type === "requisito")));
  assert.ok(onlyRequirements.includes('<div data-slot="needs-layout">') && !onlyRequirements.includes("needs-timeline"), "la lista prende la larghezza");
  const onlySteps = render(build(list.filter((n) => n.type === "passo")));
  const root = between(onlySteps, '<div data-slot="needs-board"');
  assert.ok(root.indexOf("<p") === root.indexOf('<p data-slot="needs-summary"'));
  assert.equal(textOf(between(root, 'data-slot="needs-summary"', "</p>").replace(/^[^>]*>/, "")), "Nessuno aperto");
  assert.ok(onlySteps.includes('<p data-slot="needs-none" class="text-sm text-muted-foreground">Niente da chiedere per ora.</p>'));
  assert.ok(onlySteps.includes('data-slot="needs-timeline"'));
  const filteredSteps = render(build(list.filter((n) => n.type === "passo")), { filtersActive: true });
  assert.ok(filteredSteps.includes(">Niente da chiedere con questi filtri.</p>"));
  // Vuota: il vuoto di sempre, con «Vai alla Panoramica» se qualcosa è in realizzazione.
  const empty = render(build([]), { inRealization: 1, realizationHref: "/p#panoramica-in-realizzazione" });
  assert.ok(empty.includes('data-slot="hub-empty"') && empty.includes("Niente da chiedere per ora") && !empty.includes("needs-summary"));
  assert.match(empty, /<a [^>]*href="\/p#panoramica-in-realizzazione"[^>]*>Vai alla Panoramica<\/a>/);
  const none = render(build([]), { filtersActive: true, clearHref: "/h?vista=cosa-serve" });
  assert.ok(none.includes("Niente da chiedere con questi filtri.") && none.includes(">Togli i filtri<"));
  // Un requisito senza use case: nel suo gruppo, con il suo «Per» a parole.
  const loose = render(build([need({ title: "Per tutti", ownerSide: "cliente", useCaseIds: [], forLabel: "Tutto il programma" })]));
  assert.ok(between(loose, 'data-need-group="cliente"').includes("Tutto il programma"));
  // In realizzazione: la riga con il link, dopo la lista.
  const progress = render(build(list), { inRealization: 2, realizationHref: "/p#panoramica-in-realizzazione" });
  assert.ok(progress.indexOf('data-slot="needs-in-progress"') > progress.indexOf('data-slot="needs-layout"'));
});

test("i testi nuovi della vista passano la guardia delle parole e non contano persone", () => {
  const html = render(build(fixture()));
  const texts = [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean);
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
  // Nessun numero accanto a un nome: «Chi» è un testo della riga.
  assert.ok(!/Aldo Prova[^<]*\d/.test(html));
});
