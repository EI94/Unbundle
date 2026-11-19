import test, { before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import type { NeedUseCaseRef, NeedView, NeedsBoard } from "../../lib/use-cases/needs.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// «Cosa serve» come una lista sola (rilascio 4, spec §13; rilascio 10, §3.4): la vista resa sul server da un elenco
// sintetico, senza database. In cima il prossimo passo e tre conteggi che filtrano; ogni requisito una volta sotto chi
// deve muoversi (per organizzazione, mai per persona), tre righe in vista per gruppo e «Vedi tutte (N)», «Già a posto»
// chiuso; le «Scadenze» a un tocco, con «Elenco | Calendario». Le prove nella pagina vera sono quelle di
// needs-render.integration.test.ts.

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
const BASE = "/dashboard/ws/use-cases";
const render = (b: NeedsBoard, props: Record<string, unknown> = {}) =>
  readable(
    renderToStaticMarkup(
      createElement(board.NeedsBoardView, {
        board: b,
        clientLabel: "Alfa e Beta",
        hrefOf: (id: string) => `?vista=cosa-serve&apri=${id}`,
        basePath: BASE,
        query: { vista: "cosa-serve" },
        ...props,
      }),
    ),
  );
/** I pulsanti pieni: `[data-slot=button]` con la classe `bg-primary`. */
const filled = (html: string) =>
  [...html.matchAll(/<(?:a|button)\b[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));

function readable(page: string): string {
  return page.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}
const N = " ";
const textOf = (html: string) => html.replace(/<(?:[^>"]|"[^"]*")*>/g, "").replace(/\s+/g, " ").replace(/ /g, " ").trim();
/** I link `<a>` di un pezzo di pagina: gli attributi (in qualunque ordine) e il testo. */
function anchors(html: string): Array<{ attrs: Record<string, string>; text: string }> {
  return [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/g)].map((m) => ({
    attrs: Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map((a) => [a[1], a[2]])),
    text: textOf(m[2]),
  }));
}
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

test("la vista: il prossimo passo, i tre conteggi che filtrano, i gruppi per organizzazione nell'ordine, senza numeri nei titoli", () => {
  const list = fixture();
  const html = render(build(list));
  const root = between(html, '<div data-slot="needs-board"');
  // Il solo pulsante pieno: «Verifica 1 risposta», che apre il pannello del primo use case con una risposta da verificare.
  const buttons = filled(html);
  assert.equal(buttons.length, 1);
  assert.ok(buttons[0].includes(`href="?vista=cosa-serve&apri=${A}"`), buttons[0]);
  assert.ok(textOf(between(root, 'data-slot="next-step"', "</section>")).includes("Verifica 1 risposta"));
  assert.ok(root.indexOf('data-slot="next-step"') < root.indexOf('data-slot="needs-counts"'), "il passo prima dei conteggi");
  // Tre conteggi, senza gli zeri, ognuno un link che filtra (e torna all'elenco).
  const counts = anchors(between(root, 'data-slot="needs-counts"', "</ul>")).map((a) => [a.attrs["data-state"], a.text, a.attrs.href]);
  assert.deepEqual(counts, [
    ["da-chiedere", "Da chiedere 8", `${BASE}?vista=cosa-serve&stato=da-chiedere`],
    ["in-attesa", "In attesa 1", `${BASE}?vista=cosa-serve&stato=in-attesa`],
    ["da-verificare", "Da verificare 1", `${BASE}?vista=cosa-serve&stato=da-verificare`],
  ]);
  assert.ok(!root.includes("aperte") && !root.includes("ferma ·") && !root.includes('data-slot="needs-summary"'), "«Ferme», «A posto» e «Aperte» stanno nel foglio «Filtri»");
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
});

test("il prossimo passo: «Verifica N risposte» se ce ne sono; altrimenti «Chiedi le informazioni», sul primo use case da chiedere; niente da fare, nessun pulsante", () => {
  const list = fixture();
  const noVerify = list.filter((n) => n.status !== "in_verifica");
  const ask = render(build(noVerify));
  const [button] = filled(ask);
  assert.ok(button && button.includes(`href="?vista=cosa-serve&apri=${A}"`), button);
  assert.ok(textOf(between(ask, 'data-slot="next-step"', "</section>")).includes("Chiedi le informazioni"));
  // Una risposta da verificare senza use case collegato: il pulsante porta alle righe «Da verificare».
  const loose = render(build([need({ title: "Risposta libera", ownerSide: "cliente", status: "in_verifica", useCaseIds: [], forLabel: "Tutto il programma" })]));
  assert.ok(filled(loose)[0]?.includes(`href="${BASE}?vista=cosa-serve&stato=da-verificare"`), filled(loose)[0]);
  // Solo attese e ferme: niente da fare per chi guarda, nessun pulsante pieno né «Prossimo passo».
  const waiting = render(build([need({ title: "In attesa", ownerSide: "fornitore", status: "chiesta" }), need({ title: "Ferma", ownerSide: "lateral_space", status: "bloccata" })]));
  assert.equal(filled(waiting).length, 0);
  assert.ok(!waiting.includes('data-slot="next-step"'));
});

test("un gruppo: le prime tre righe, prima da verificare, poi «Vedi tutte (N)» chiuso; «Insieme» con il cliente", () => {
  const list = fixture();
  const html = render(build(list));
  const client = between(html, 'data-need-group="cliente"', 'data-need-group="fornitore"');
  const more = details(client, "needs-group-more");
  assert.equal(more.opening, '<details data-slot="needs-group-more">', "chiuso di default");
  assert.equal(more.summary, "Vedi tutte (9)");
  const shown = ids(client.slice(0, client.indexOf('<details data-slot="needs-group-more"')));
  const byTitle = new Map(list.map((n) => [n.title, n.id]));
  assert.deepEqual(shown, ["Risposta da guardare", "Cliente 1", "Cliente 2"].map((t) => byTitle.get(t)), "tre, prima quella da verificare");
  assert.deepEqual(ids(more.body), ["Cliente 3", "Cliente 4", "Cliente 5", "Cliente 6", "Insieme 1", "Insieme 2"].map((t) => byTitle.get(t)));
  // «Insieme» lo dice nel suo «Chi»; la riga: titolo, stato, «Chi», «Per».
  const together = between(client, `data-need="${byTitle.get("Insieme 1")}"`, "</li>");
  assert.ok(textOf(together).includes("Insieme"));
  const first = between(client, `data-need="${byTitle.get("Cliente 1")}"`, "</li>");
  assert.match(first, new RegExp(`<span data-meta="chi" class="inline-flex min-w-0 items-center gap-x-2"><span class="min-w-0">Aldo Prova, ufficio acquisti${N}· Cliente</span>`));
  assert.ok(first.includes(">Da chiedere<") && first.includes('href="?vista=cosa-serve&apri=' + A + '"'), "lo stato dei cinque e «Per» che apre il pannello");
  // «Per» con il tag dell'agente al posto del prefisso, il prefisso solo per i lettori di schermo; niente codice.
  const per = between(first, 'data-meta="per"', "</a>");
  assert.ok(per.includes('data-slot="agent-tag"') && per.includes(">LIBRA L1</span>"), per);
  assert.ok(per.includes('<span class="sr-only">LIBRA L1 · </span>Smistamento'), per);
  assert.ok(!textOf(per.replace(/<span class="sr-only">[^<]*<\/span>/g, "")).includes("XV-0001"), "il tag al posto del codice");
  // Più use case: «Per 2 use case» chiuso, con prima gli agenti dei titoli.
  const two = between(client, `data-need="${byTitle.get("Insieme 2")}"`, "</li>");
  assert.ok(two.indexOf('data-slot="need-agents"') < two.indexOf(`Per 2${N}use${N}case`));
  // Il gruppo di Lateral Space: «Ferma», mai «Bloccata».
  const ls = between(html, 'data-need-group="lateral_space"', "</section>");
  assert.ok(ls.includes(">Ferma<") && !ls.includes("Bloccata"));
  assert.ok(!between(html, 'data-need-group="fornitore"', "</section>").includes("needs-group-more"), "uno solo: nessun «Vedi tutte»");
  // Quattro righe: «Vedi tutte (4)», con l'ultima dentro.
  const four = render(build(list.filter((n) => n.ownerSide === "cliente" && n.type === "requisito" && n.status === "da_chiedere").slice(0, 4)));
  assert.equal(details(four, "needs-group-more").summary, "Vedi tutte (4)");
  assert.equal(ids(details(four, "needs-group-more").body).length, 1);
});

test("ogni requisito una volta; «Già a posto · N» chiuso dopo i gruppi", () => {
  const list = fixture();
  const html = render(build(list));
  const groupsColumn = between(html, '<div data-slot="needs-groups"');
  const done = details(groupsColumn, "needs-done");
  assert.equal(done.opening, '<details data-slot="needs-done">');
  assert.equal(done.summary, "Già a posto · 2");
  const requirementIds = list.filter((n) => n.type === "requisito").map((n) => n.id);
  const shown = ids(groupsColumn);
  assert.equal(shown.length, requirementIds.length, "aperti e a posto");
  assert.equal(new Set(shown).size, shown.length, "nessuno due volte");
  assert.ok(requirementIds.every((id) => shown.includes(id)));
  assert.ok(groupsColumn.lastIndexOf('data-need-group="') < groupsColumn.indexOf('data-slot="needs-done"'), "dopo i gruppi");
  // Nell'elenco le scadenze non ci sono: sono a un tocco, nel «Calendario».
  assert.ok(!html.includes('data-slot="needs-steps"') && !html.includes("<aside"));
});

test("(rilascio 10, §3.4) un conteggio scelto: le sole righe di quello stato, il conteggio acceso che si toglie con un altro tocco", () => {
  const list = fixture();
  const byTitle = new Map(list.map((n) => [n.title, n.id]));
  const html = render(build(list), { state: "da-verificare", query: { vista: "cosa-serve", stato: "da-verificare" } });
  assert.deepEqual(ids(between(html, '<div data-slot="needs-groups"')), [byTitle.get("Risposta da guardare")]);
  assert.ok(!html.includes('data-slot="needs-done"'), "niente «Già a posto» con uno stato");
  const active = anchors(between(html, 'data-slot="needs-counts"', "</ul>")).find((a) => a.attrs["aria-current"] === "true");
  assert.equal(active?.attrs["data-state"], "da-verificare", "il conteggio scelto è acceso");
  assert.equal(active?.attrs.href, `${BASE}?vista=cosa-serve`, "un altro tocco lo toglie");
  assert.ok(textOf(between(html, 'data-slot="needs-counts"', "</ul>")).includes("Da chiedere 8"), "i conteggi restano quelli di tutta la vista");
  // «A posto» (dal foglio): le righe a posto per organizzazione.
  const done = render(build(list), { state: "a-posto" });
  assert.deepEqual(ids(between(done, '<div data-slot="needs-groups"')), ["A posto 1", "A posto 2"].map((t) => byTitle.get(t)));
  // «Ferme» senza righe: una frase e «Togli i filtri», che toglie solo lo stato.
  const none = render(build(list.filter((n) => n.status !== "bloccata")), { state: "ferme", query: { vista: "cosa-serve", stato: "ferme", q: "es" } });
  assert.ok(none.includes("Nessuna informazione in questo stato."));
  assert.match(none, new RegExp(`href="${BASE}\\?vista=cosa-serve&q=es"[^>]*>Togli i filtri<`));
});

test("«Elenco | Calendario»: le «Scadenze» a un tocco, «Prima di oggi» in testa, le prime cinque, la sezione spezzata ripete il titolo, «Fatta · 1»", () => {
  const list = fixture();
  const listView = render(build(list));
  const toggle = anchors(between(listView, 'aria-label="Elenco o calendario"', "</nav>"));
  assert.deepEqual(
    toggle.map((a) => [a.text, a.attrs.href, a.attrs["aria-current"] ?? null]),
    [
      ["Elenco", `${BASE}?vista=cosa-serve`, "page"],
      ["Calendario8", `${BASE}?vista=cosa-serve&calendario=1`, null],
    ],
    "con il numero delle scadenze aperte",
  );
  const html = render(build(list), { calendar: true, query: { vista: "cosa-serve", calendario: "1" } });
  assert.ok(html.includes('data-mode="calendario"') && !html.includes('data-slot="needs-groups"'), "il calendario al posto dell'elenco");
  const steps = between(html, '<section aria-labelledby="cosa-serve-passi" data-slot="needs-steps"');
  assert.ok(steps.includes('<h2 id="cosa-serve-passi" class="text-sm font-semibold">Scadenze</h2>'));
  const more = details(steps, "needs-steps-more");
  const visible = steps.slice(0, steps.indexOf('<details data-slot="needs-steps-more"'));
  const headings = (part: string) => [...part.matchAll(/<h3 id="([^"]+)" class="text-xs font-medium text-muted-foreground">([^<]*)<\/h3>/g)].map((m) => m[2]);
  assert.deepEqual(headings(visible), ["Prima di oggi", "Novembre 2026"], "gli scaduti prima; oggi è di novembre");
  const byTitle = new Map(list.map((n) => [n.title, n.id]));
  assert.deepEqual(ids(visible), ["Scaduto", "Oggi", "Novembre 1", "Novembre 2", "Novembre 3"].map((t) => byTitle.get(t)), "i primi cinque, per data");
  assert.equal(more.opening, '<details data-slot="needs-steps-more">');
  assert.equal(more.summary, "Mostra le altre 3");
  assert.deepEqual(headings(more.body), ["Novembre 2026", "Dicembre 2026", "Senza data"], "novembre spezzato: il titolo si ripete");
  assert.deepEqual(ids(more.body), ["Novembre 4", "Dicembre", "Da fissare"].map((t) => byTitle.get(t)));
  const headingIds = [...steps.matchAll(/<h3 id="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(headingIds).size, headingIds.length);
  const late = between(steps, `data-need="${byTitle.get("Scaduto")}"`, "</li>");
  assert.match(late, /<time dateTime="2026-10-20" class="block text-xs font-medium tabular-nums">20[\s\u00a0\u202f]ott<\/time>/);
  assert.ok(late.includes(">Confermata<"), "la scadenza è confermata");
  assert.ok(between(more.body, `data-need="${byTitle.get("Dicembre")}"`, "</li>").includes('<span data-meta="chi" class="min-w-0">Lateral Space</span>'));
  assert.ok(!between(more.body, `data-need="${byTitle.get("Da fissare")}"`, "</li>").includes("<time"), "senza data, nessun <time>");
  const done = details(steps, "needs-steps-done");
  assert.equal(done.summary, "Fatta · 1");
  // Senza scadenze l'interruttore non c'è, e `calendario=1` mostra l'elenco.
  const onlyRequirements = render(build(list.filter((n) => n.type === "requisito")), { calendar: true });
  assert.ok(!onlyRequirements.includes("Elenco o calendario") && onlyRequirements.includes('data-slot="needs-groups"'));
});

test("«Per N use case»: il titolo della riga lo leggono come descrizione, senza ripeterlo in ogni riga", () => {
  const list = fixture();
  const html = render(build(list));
  const shared = list.find((n) => n.title === "Insieme 2");
  assert.ok(shared);
  assert.match(html, new RegExp(`<summary aria-describedby="cosa-serve-titolo-${shared.id}"[^>]*>`));
  assert.equal(html.split(`id="cosa-serve-titolo-${shared.id}"`).length - 1, 1);
  assert.ok(!html.includes('class="sr-only">: '), "il titolo non si ripete");
  const described = [...html.matchAll(/aria-describedby="([^"]+)"/g)].flatMap((m) => m[1].split(" "));
  assert.ok(described.length > 0);
  for (const id of described) assert.ok(html.includes(`id="${id}"`), id);
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(all).size, all.length, "id unici");
});

test("con una ricerca tutte le parti chiuse della vista sono aperte; con gli altri filtri no", () => {
  const list = fixture();
  const searched = render(build(list), { searched: true });
  for (const slot of ["needs-group-more", "needs-done"]) assert.equal(details(searched, slot).opening, `<details data-slot="${slot}" open="">`, slot);
  const calendar = render(build(list), { searched: true, calendar: true });
  for (const slot of ["needs-steps-more", "needs-steps-done"]) assert.equal(details(calendar, slot).opening, `<details data-slot="${slot}" open="">`, slot);
  const filtered = render(build(list), { filtersActive: true });
  for (const slot of ["needs-group-more", "needs-done"]) assert.equal(details(filtered, slot).opening, `<details data-slot="${slot}">`, slot);
});

test("i casi limite: solo passi, «Niente da chiedere» e il calendario a un tocco; vuota", () => {
  const list = fixture();
  const onlySteps = render(build(list.filter((n) => n.type === "passo")));
  assert.ok(onlySteps.includes('<p data-slot="needs-none" class="text-sm text-muted-foreground">Niente da chiedere per ora.</p>'));
  assert.ok(onlySteps.includes("Elenco o calendario") && !onlySteps.includes('data-slot="needs-counts"'), "nessun conteggio a zero");
  const filteredSteps = render(build(list.filter((n) => n.type === "passo")), { filtersActive: true });
  assert.ok(filteredSteps.includes(">Niente da chiedere con questi filtri.</p>"));
  const empty = render(build([]), { inRealization: 1, realizationHref: "/p#panoramica-in-realizzazione" });
  assert.ok(empty.includes('data-slot="hub-empty"') && empty.includes("Niente da chiedere per ora") && !empty.includes("needs-counts"));
  assert.match(empty, /<a [^>]*href="\/p#panoramica-in-realizzazione"[^>]*>Vai alla Panoramica<\/a>/);
  const none = render(build([]), { filtersActive: true, clearHref: "/h?vista=cosa-serve" });
  assert.ok(none.includes("Niente da chiedere con questi filtri.") && none.includes(">Togli i filtri<"));
  const loose = render(build([need({ title: "Per tutti", ownerSide: "cliente", useCaseIds: [], forLabel: "Tutto il programma" })]));
  assert.ok(between(loose, 'data-need-group="cliente"').includes("Tutto il programma"));
  const progress = render(build(list), { inRealization: 2, realizationHref: "/p#panoramica-in-realizzazione" });
  assert.ok(progress.indexOf('data-slot="needs-in-progress"') > progress.indexOf('data-slot="needs-groups"'));
});

test("i testi nuovi della vista passano la guardia delle parole e non contano persone", () => {
  for (const props of [{}, { calendar: true }, { state: "a-posto" }]) {
    const html = render(build(fixture()), props);
    const texts = [...html.matchAll(/>([^<>]+)</g)].map((m) => m[1].trim()).filter(Boolean);
    assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
    assert.ok(!/Aldo Prova[^<]*\d/.test(html));
  }
  assert.deepEqual(findHubForbiddenIn(Object.values(board.NEEDS_BOARD_TEXT).filter((v): v is string => typeof v === "string"), "area"), []);
  assert.equal(board.NEEDS_BOARD_TEXT.seeAll(12), "Vedi tutte (12)");
});
