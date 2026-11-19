import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import { agentPalette } from "../../lib/use-cases/agents.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import type { ValueParts } from "../../lib/use-cases/format.ts";
import { infoProgressView } from "../../lib/use-cases/info-progress.ts";
import type { ContributorUseCase } from "../../lib/use-cases/permissions.ts";
import type { ReferentStateKey } from "../../lib/use-cases/referent/use-case-state.ts";
import type { CostFigure } from "../../lib/use-cases/valuation.ts";
import type { AnyHubItem, HubItem } from "../../lib/use-cases/views.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// Le corsie della Panoramica rese in HTML (rilascio «Panoramica»; rilascio 10, §3.4, D7, prototipo S2): la card
// con il tag dell'agente, il Valore con la barra e «Costo» senza la fonte, il chip del referente solo quando chiede
// un'azione, tre card e poi «Vedi tutti (N)», «Più avanti» e «In uso» in pieghe chiuse, «In realizzazione», e la
// forma dei contributori, senza cifre.
//
// I vuoti vengono da hub-header.tsx, che porta con sé il menu «⋯» con le sue azioni del server (e il
// database): qui il menu è un componente vuoto, il resto è quello vero.
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};
let lanes: typeof import("./panorama-lanes.tsx");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
before(async () => {
  await enableTsxImports();
  const menu = `data:text/javascript,${encodeURIComponent("export function HubMenu() { return null; }")}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "./hub-menu" && context.parentURL?.endsWith("/hub-header.tsx")) return { url: menu, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  lanes = await import("./panorama-lanes.tsx");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const TODAY = "2026-10-29"; // T4 2026
const BASE = "/dashboard/ws/use-cases";

let seq = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NO_VALUE: ValueParts = { score: null, word: null, source: null, perYear: null, benefits: null };
const counted = (amount: number): ValueParts => ({ ...NO_VALUE, perYear: { amount, source: "team" } });
const pending = (pendingEur: number): ValueParts => ({ ...NO_VALUE, benefits: { state: "da_misurare", benefitEur: 0, pendingEur, hours: 0 } });
const QUALITATIVE: ValueParts = { ...NO_VALUE, benefits: { state: "qualitativo", benefitEur: 0, pendingEur: 0, hours: 0 } };
const TEAM_30K: CostFigure = { source: "team_importo", amount: 30_000, band: 2, fromBand: false, position: 2, referenceEur: 30_000 };
const STIMA_700: CostFigure = { source: "stima", amount: 700, band: 1, fromBand: false, runEurYear: 1_200, position: 1, referenceEur: 700 };

function hub(o: Partial<HubItem> = {}): HubItem {
  seq += 1;
  return {
    id: uuid(seq),
    code: `XX-${String(1000 + seq).padStart(4, "0")}`,
    title: `Use case ${String(seq).padStart(3, "0")}`,
    origin: "adoption",
    kind: "da_costruire",
    phase: "approvato",
    subState: "trimestre",
    phaseLabel: "Approvato · T4 2026",
    tone: "blu",
    quando: "T4 2026",
    targetQuarter: "2026-Q4",
    value: NO_VALUE,
    cost: null,
    claudeHoursPerYear: null,
    realizedOn: null,
    ...o,
  } as HubItem;
}

const contributor = (o: Partial<ContributorUseCase> & { title: string }): ContributorUseCase =>
  ({ id: uuid(8000 + (seq += 1)), phase: "approvato", subState: "trimestre", phaseLabel: "Approvato · T1 2027", quando: "T1 2027", own: false, ...o }) as ContributorUseCase;

function render(items: readonly AnyHubItem[], props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(lanes.PanoramaLanes, {
      items,
      today: TODAY,
      agents: agentPalette(items),
      barScale: 0,
      basePath: BASE,
      query: { vista: "panoramica" },
      filtersActive: false,
      clearHref: `${BASE}?vista=panoramica`,
      grouping: null,
      agentHref: (param: string) => `${BASE}?vista=panoramica&agente=${param}#panoramica-approvati`,
      agentFilter: null,
      ...props,
    }),
  );
}

/** La card di uno use case, dal suo `data-id` alla chiusura del suo `<li>`. */
function cardOf(html: string, id: string): string {
  const start = html.indexOf(`data-id="${id}"`);
  assert.ok(start >= 0, `card ${id}`);
  return html.slice(start, html.indexOf("</li>", start));
}

const textOf = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&amp;/g, "&");
/** Lo spazio non separabile (`keepTogether`): un numero resta con la sua parola, il «·» con la parte prima. */
const N = "\u00a0";

test("(D7) la card del revisore: il titolo intero prima di tag e cifre, il tag nascosto ai lettori di schermo, la barra, il Valore e «Costo» senza la fonte", () => {
  const libra = hub({ title: "LIBRA L1 · Lettura dei documenti esteri", value: counted(12_250), cost: TEAM_30K });
  const stima = hub({ title: "LIBRA L2 · Riconciliazione", value: pending(5_840), cost: STIMA_700 });
  const html = render([libra, stima], { barScale: 31_500 });
  const card = cardOf(html, libra.id);
  assert.match(card, /^data-id="[^"]+" data-lane="questo_trimestre" data-agent="LIBRA" class="min-w-0"/);
  const link = card.slice(card.indexOf("<a "));
  const title = link.indexOf('<span class="sr-only">LIBRA L1 · </span>Lettura dei documenti esteri');
  assert.ok(title > 0, link);
  assert.ok(title < link.indexOf('data-figure="valore"') && title < link.indexOf('data-figure="costo"'), "il titolo prima del Valore e del costo");
  assert.match(link, /<span data-slot="agent-tag" data-tone="\d+" aria-hidden="true"/);
  assert.ok(!link.includes("XX-"), "niente codice accanto al tag");
  // Dall'alto: la barra, poi il Valore e, a destra, il costo; la fonte del costo sta nel pannello (D7).
  assert.ok(link.indexOf('data-slot="value-bar"') < link.indexOf('data-figure="valore"') && link.indexOf('data-figure="valore"') < link.indexOf('data-figure="costo"'));
  assert.match(card, /data-figure="costo" data-cost-source="team_importo" data-source-in="pannello"/);
  assert.ok(textOf(card).includes("Costo 30.000 €") && !textOf(card).includes("team"), textOf(card));
  assert.ok(!card.includes("data-source="), "nessuna fonte sulla card");
  const model = cardOf(html, stima.id);
  assert.match(model, /data-figure="costo" data-cost-source="stima" data-source-in="pannello"/);
  assert.ok(textOf(model).includes("Costo 700 €") && !model.includes("data-source="), "«Benefici e costi»: niente fonte");
  // Il Valore: gli euro con la barra piena sulla scala; il tetto da misurare tratteggiato.
  assert.ok(textOf(card).includes(`12.250${N}€${N}all'anno`) && !card.includes("Valore: "), textOf(card));
  assert.match(card, /<span aria-hidden="true" data-slot="value-bar" data-bar="contato" class="block h-1 w-full rounded-full bg-muted"><span class="block h-full rounded-full bg-uc-agente-\d+" style="width:38\.9%"><\/span>/);
  assert.ok(textOf(model).includes(`da misurare${N}· fino a 5.840${N}€`));
  assert.match(model, /data-bar="da_misurare"[^>]*><span class="block h-full rounded-full border border-dashed border-uc-agente-\d+" style="width:18\.5%"/);
  // Senza agente: il codice e la barra grigia.
  const plain = hub({ title: "Smistamento delle richieste", value: counted(3_000) });
  const neutral = cardOf(render([plain], { barScale: 12_000 }), plain.id);
  assert.ok(neutral.includes(plain.code!) && !neutral.includes("agent-tag") && !neutral.includes("data-agent"));
  assert.match(neutral, /class="block h-full rounded-full bg-muted-foreground" style="width:25\.0%"/);
});

test("(D7) la card: «Scaduto» come stato, niente trimestre a parte né «Da diffondere», «Valore: da stimare»; il chip del referente solo quando chiede un'azione", () => {
  const overdue = hub({ title: "ORSA O1 · Solleciti", targetQuarter: "2026-Q3" });
  const best = hub({ title: "Buone pratiche", kind: "da_diffondere", targetQuarter: "2027-Q1", cost: TEAM_30K });
  const later = hub({ title: "Più tardi", targetQuarter: "2027-Q3", value: QUALITATIVE });
  const waiting = hub({ title: "In attesa", targetQuarter: "2027-Q1" });
  const asked = hub({ title: "Una domanda", targetQuarter: "2027-Q1" });
  const states: Record<string, ReferentStateKey> = {
    [overdue.id.toLowerCase()]: "nessuna_risposta",
    [best.id.toLowerCase()]: "da_verificare",
    [later.id.toLowerCase()]: "manca",
    [waiting.id.toLowerCase()]: "in_attesa",
    [asked.id.toLowerCase()]: "ha_chiesto",
  };
  const html = render([overdue, best, later, waiting, asked], { referentStates: states });
  const late = cardOf(html, overdue.id);
  // «Scaduto»: puntino rosso più parola; il trimestre passato lo dice il pannello.
  assert.match(late, /<span data-slot="expired-tag"[^>]*><span aria-hidden="true" class="size-1\.5 shrink-0 rounded-full bg-uc-rosso"><\/span><span class="font-medium text-foreground">Scaduto<\/span><\/span>/);
  assert.ok(!late.includes(">T3 2026<") && !late.includes("text-red-300"), late);
  assert.match(late, /Valore: <\/span><span[^>]*>da stimare</);
  assert.ok(!late.includes('data-figure="costo"'), "senza costo niente «da stimare» del costo");
  // Il chip: puntino più parola, solo per «Nessuna risposta», «Risposte da verificare» e «Manca il referente».
  assert.match(late, /data-slot="referent-chip" data-state="nessuna_risposta" data-form="puntino"/);
  assert.ok(late.includes(">Nessuna risposta<") && late.includes("bg-uc-rosso") && !late.includes('data-slot="info-chip"'));
  const diffuse = cardOf(html, best.id);
  assert.ok(!diffuse.includes("Da diffondere") && !diffuse.includes('data-figure="costo"'), "le best practice senza costo, e il tipo sta nel pannello");
  assert.ok(diffuse.includes('data-state="da_verificare"') && diffuse.includes(">Risposte da verificare<"));
  const after = cardOf(html, later.id);
  assert.ok(after.includes('data-lane="piu_avanti"') && !after.includes(">T3 2027<") && after.includes(">ritorno qualitativo<") && !after.includes("value-bar"));
  assert.ok(after.includes('data-state="manca"') && after.includes(">Manca il referente<"));
  // «Il referente ha chiesto qualcosa» aspetta il team: il chip giallo resta anche quando la domanda arriva.
  const question = cardOf(html, asked.id);
  assert.ok(question.includes('data-state="ha_chiesto"') && question.includes(">Il referente ha chiesto qualcosa<") && question.includes("bg-uc-giallo"), question);
  // «In attesa del referente» non chiede niente a chi guarda: sulla card non c'è.
  assert.ok(!cardOf(html, waiting.id).includes("referent-chip"), "solo gli stati che chiedono un'azione");
});

test("(rilascio 10) una corsia: «T4 2026» con il conteggio, le prime 3 card, poi «Vedi tutti (7)» con «Mostra meno»; le corsie vuote non ci sono", () => {
  const seven = Array.from({ length: 7 }, (_, index) => hub({ title: `Corsia ${index}`, value: counted(1_000 * (index + 1)) }));
  const html = render(seven, { barScale: 7_000 });
  const lane = html.slice(html.indexOf('data-lane="questo_trimestre"'));
  assert.match(lane, /<h2 id="lane-questo_trimestre" class="flex items-baseline gap-2 text-base font-semibold">T4 2026 <span class="text-sm font-normal text-muted-foreground tabular-nums">7<span class="sr-only"> use case<\/span><\/span><\/h2>/);
  assert.ok(!textOf(lane).includes("contati all'anno") && !lane.includes('data-figure="corsia"'), "nessuna somma in testa alla corsia");
  const more = lane.indexOf('<details data-slot="lane-more"');
  assert.ok(more > 0, "le altre dietro un <details>");
  assert.equal((lane.slice(0, more).match(/data-slot="lane-card"/g) ?? []).length, 3);
  assert.equal((lane.slice(more).match(/data-slot="lane-card"/g) ?? []).length, 4);
  const details = lane.slice(more);
  assert.doesNotMatch(/<details[^>]*>/.exec(details)![0].replace(/="[^"]*"/g, ""), /\sopen\b/);
  assert.ok(details.includes('<span class="[[open]&gt;summary&gt;&amp;]:hidden">Vedi tutti (7)</span>'), details);
  assert.ok(details.includes('<span class="hidden [[open]&gt;summary&gt;&amp;]:inline">Mostra meno</span>'));
  // Tre card o meno: nessun «Vedi tutti».
  assert.ok(!render(seven.slice(0, 3)).includes("lane-more"));
  // Le corsie vuote non ci sono: niente «T1 2027» né «Più avanti».
  for (const key of ["prossimo_trimestre", "piu_avanti"]) assert.ok(!html.includes(`data-lane="${key}"`), key);
  assert.ok(!html.includes("Nessuno use case."), "lo zero non si vede");
  // La sezione delle corsie: l'ancora e il fuoco dopo «Per agente».
  assert.match(html, /<section id="panoramica-approvati" tabindex="-1" aria-label="Use case per trimestre" data-slot="panorama-plan"/);
  assert.match(html, /<div data-slot="lanes" class="grid gap-6 @min-\[58rem\]\/hub:grid-cols-3 @min-\[58rem\]\/hub:gap-4">/);
});

test("(rilascio 10) «Più avanti»: una piega chiusa con il riepilogo «4 use case», le sue card dentro; un link a `#panoramica-piu-avanti` la apre", () => {
  const four = Array.from({ length: 4 }, (_, index) => hub({ title: `Dopo ${index}`, targetQuarter: index ? "2027-Q3" : null }));
  const next = hub({ title: "Il prossimo", targetQuarter: "2027-Q1" });
  const html = render([...four, next]);
  assert.ok(html.includes('<section id="panoramica-piu-avanti" data-slot="fold"'), "la piega");
  const fold = html.slice(html.indexOf('<section id="panoramica-piu-avanti"'));
  assert.match(fold, /<h2 class="text-base font-semibold"><button type="button" aria-expanded="false" aria-controls="panoramica-piu-avanti-contenuto"/);
  assert.ok(textOf(fold).startsWith(`Più avanti4${N}use${N}case`), textOf(fold).slice(0, 40));
  assert.match(fold, /<div id="panoramica-piu-avanti-contenuto" data-slot="fold-content" hidden=""/);
  assert.equal((fold.match(/data-slot="lane-card"/g) ?? []).length, 4, "le card stanno dentro la piega");
  assert.ok(fold.includes(">Vedi tutti (4)<"));
  // «T1 2027» resta una corsia aperta, accanto.
  assert.match(html, /<h2 id="lane-prossimo_trimestre"[^>]*>T1 2027 <span[^>]*>1<span class="sr-only"> use case<\/span><\/span><\/h2>/);
});

test("«In realizzazione»: la card del dossier se c'è, altrimenti «Senza dossier»; con il dossier in errore solo la fase; tre card, poi «Vedi tutti»", () => {
  const withDossier = hub({ title: "Con dossier", phase: "in_realizzazione", subState: "dossier", phaseLabel: "In realizzazione · Bozza" });
  const without = hub({ title: "Senza", phase: "in_realizzazione", subState: "senza_dossier", phaseLabel: "In realizzazione · Senza dossier" });
  const dossier = {
    caseId: uuid(9001),
    useCaseId: withDossier.id,
    code: withDossier.code,
    title: withDossier.title,
    statusLabel: "Bozza",
    statusTone: "grigio",
    progress: null,
    context: null,
    href: `/dashboard/ws/casi-duso/${uuid(9001)}`,
    myTurn: false,
    updatedAt: null,
  };
  const column = { state: "pronta", cards: [dossier], byUseCase: new Map([[withDossier.id, dossier]]), readOnlyNotice: false };
  const html = render([without, withDossier], { dossierColumn: column });
  const section = html.slice(html.indexOf('aria-labelledby="panoramica-in-realizzazione"'));
  // L'ancora prende il fuoco («Vai alla Panoramica» da «Cosa serve»): `tabindex="-1"`, senza contorno.
  assert.match(section, /<h2 id="panoramica-in-realizzazione" tabindex="-1" class="flex scroll-mt-24 items-baseline gap-2 text-base font-semibold outline-none">In realizzazione <span[^>]*>2<span class="sr-only"> use case<\/span><\/span><\/h2>/);
  assert.ok(section.indexOf(`data-id="${withDossier.id}"`) < section.indexOf(`data-id="${without.id}"`), "prima quelli con la card del dossier");
  const card = cardOf(section, withDossier.id);
  assert.match(card, /data-slot="dossier-card"/);
  assert.ok(card.includes("ring-input") && !card.includes("ring-foreground/10"), "il bordo dei campi");
  assert.ok(cardOf(section, without.id).includes("In realizzazione · Senza dossier"));
  assert.ok(!html.includes('id="panoramica-approvati"'), "senza approvati niente corsie");
  // Senza la colonna dei dossier, la card dello use case; con il dossier in errore solo la fase.
  assert.ok(!render([withDossier]).includes('data-slot="dossier-card"'));
  const down = render([without], { dossierDown: true });
  assert.ok(cardOf(down, without.id).includes(">In realizzazione<") && !down.includes("Senza dossier"));
  assert.ok(!cardOf(down, without.id).includes("data-figure"), "in realizzazione nessuna cifra");
  // (Rilascio 10) Tre card, poi «Vedi tutti (5)».
  const five = Array.from({ length: 5 }, (_, index) => hub({ title: `Avviato ${index}`, phase: "in_realizzazione", subState: "senza_dossier", phaseLabel: "In realizzazione · Senza dossier" }));
  const many = render(five);
  const list = many.slice(many.indexOf('aria-labelledby="panoramica-in-realizzazione"'));
  assert.equal((list.slice(0, list.indexOf('data-slot="lane-more"')).match(/data-slot="lane-card"/g) ?? []).length, 3);
  assert.ok(list.includes(">Vedi tutti (5)<"));
});

test("le cifre si sommano: le card scrivono le loro cifre arrotondate, «In uso» ne dice la somma, «Per agente» le corsie dell'agente", () => {
  // Tre card da 1.000,5 €: ognuna «1.001 € all'anno»; in testa alle corsie nessuna somma (il numero grande la dice).
  const three = Array.from({ length: 3 }, (_, index) => hub({ title: `Centesimi ${index}`, value: counted(1_000.5) }));
  const html = render(three, { barScale: 1_000.5 });
  for (const item of three) assert.ok(textOf(cardOf(html, item.id)).includes(`1.001${N}€${N}all'anno`), item.title);
  // «In realizzazione»: solo il conto, senza euro.
  const building = hub({ title: "Avviato", phase: "in_realizzazione", subState: "senza_dossier", phaseLabel: "In realizzazione · Senza dossier", value: counted(2_719) });
  const quiet = hub({ title: "Avviato senza cifra", phase: "in_realizzazione", subState: "senza_dossier", phaseLabel: "In realizzazione · Senza dossier" });
  const progress = render([building, quiet]);
  assert.match(progress, /<h2 id="panoramica-in-realizzazione"[^>]*>In realizzazione <span[^>]*>2<span class="sr-only"> use case<\/span><\/span><\/h2>/);
  assert.ok(!progress.includes('data-figure="in-realizzazione"'));
  assert.deepEqual(findHubForbiddenIn([textOf(progress)], "area"), []);
  // «In uso»: la somma delle cifre delle sue card, arrotondate una a una.
  const used = [
    hub({ title: "Usato", phase: "realizzato", subState: "realizzato", phaseLabel: "Realizzato", realizedOn: "2026-05-10", value: counted(1_000.5) }),
    hub({ title: "Usato 2", phase: "realizzato", subState: "realizzato", phaseLabel: "Realizzato", realizedOn: "2026-06-10", value: counted(1_000.5) }),
  ];
  assert.ok(textOf(render(used)).includes(`In uso2${N}use${N}case${N}· 2.002${N}€${N}all'anno`), textOf(render(used)));
  // Ai contributori nessun euro, neanche in «In realizzazione».
  const theirs = render([contributor({ title: "ORSA O1 · Solleciti", phase: "in_realizzazione", subState: "senza_dossier", phaseLabel: "In realizzazione", quando: null })]);
  assert.ok(theirs.includes("In realizzazione") && !theirs.includes("€") && !theirs.includes("data-figure"), theirs);
  // «Per agente»: due card di LIBRA con i centesimi in due corsie; la card dell'agente somma le loro cifre.
  const libra = [
    hub({ title: "LIBRA L1 · Fatture", value: counted(16_292.5) }),
    hub({ title: "LIBRA L2 · Pagamenti", targetQuarter: "2027-Q1", value: counted(11_042.5) }),
  ];
  const grid = render(libra, {
    grouping: {
      active: "agente",
      items: [
        { key: "trimestre", label: "Per trimestre", href: `${BASE}?vista=panoramica` },
        { key: "agente", label: "Per agente", href: `${BASE}?vista=panoramica&mostra=agenti` },
      ],
    },
  });
  const agentCard = grid.slice(grid.indexOf('data-agent="LIBRA"'));
  assert.ok(textOf(agentCard).includes(`27.336${N}€${N}all'anno`), textOf(agentCard));
  const lanesOfLibra = render(libra, { agentFilter: "LIBRA" });
  assert.ok(textOf(lanesOfLibra).includes(`16.293${N}€${N}all'anno`) && textOf(lanesOfLibra).includes(`11.043${N}€${N}all'anno`));
});

test("(rilascio 10) «In uso»: una piega chiusa con il riepilogo, l'ancora di prima, il mese e gli euro senza barra", () => {
  const old = hub({ title: "Prima", phase: "realizzato", subState: "realizzato", phaseLabel: "Realizzato", realizedOn: "2026-05-10" });
  const recent = hub({ title: "Dopo", phase: "realizzato", subState: "realizzato", phaseLabel: "Realizzato", realizedOn: "2026-09-10", value: counted(8_000) });
  const html = render([old, recent], { barScale: 8_000 });
  // L'ancora di prima (`#panoramica-realizzati`) apre la piega: i link che girano ancora valgono.
  assert.match(html, /<div data-slot="panoramica-realizzati"><section id="panoramica-realizzati" data-slot="fold"/);
  const fold = html.slice(html.indexOf('<section id="panoramica-realizzati"'));
  assert.match(fold, /aria-expanded="false" aria-controls="panoramica-realizzati-contenuto"/);
  assert.ok(textOf(fold).startsWith(`In uso2${N}use${N}case${N}· 8.000${N}€${N}all'anno`), textOf(fold).slice(0, 60));
  assert.match(fold, /data-slot="fold-content" hidden=""/);
  assert.ok(html.indexOf(`data-id="${recent.id}"`) < html.indexOf(`data-id="${old.id}"`), "dal più recente");
  const card = cardOf(html, recent.id);
  assert.ok(card.includes('data-lane="realizzati"') && textOf(card).includes(`Realizzato${N}· set${N}2026`) && textOf(card).includes(`8.000${N}€${N}all'anno`), textOf(card));
  assert.ok(!card.includes("value-bar") && !card.includes('data-figure="costo"'));
  // Ai contributori il riepilogo senza euro.
  const theirs = render([contributor({ title: "In uso", phase: "realizzato", subState: "realizzato", phaseLabel: "Realizzato", quando: null })], { contributor: true });
  assert.ok(textOf(theirs).includes(`In uso1${N}use${N}case`) && !theirs.includes("€"), textOf(theirs));
});

test("vuoti: «Niente in programma, per ora»; con i filtri «Niente in programma con questi filtri.», o «Nessuno use case con questi filtri.» senza schede", () => {
  const decide = hub({ phase: "da_valutare", subState: "nuova", phaseLabel: "Da valutare · Nuova" });
  assert.ok(render([decide]).includes("Niente in programma, per ora"));
  assert.ok(render([decide]).includes("Approva uno use case e scegli quando farlo."));
  // Il contributore non approva, e non vede gli approvati nascosti alla ricerca: il vuoto dice solo
  // che cosa trova qui, non che nel workspace non c'è niente di approvato.
  const own = contributor({ title: "La mia proposta", phase: "da_valutare", subState: "nuova", phaseLabel: "Da valutare · Nuova", quando: null, own: true });
  const mine = textOf(render([own], { contributor: true }));
  assert.ok(mine.includes("Niente in programma, per ora"), mine);
  // Il nome della vista non va a capo: «In valutazione» resta intero.
  assert.ok(mine.includes(`Qui trovi gli use case approvati visibili a tutti. Quelli da valutare sono in «In${N}valutazione».`), mine);
  assert.ok(!mine.includes("«In valutazione»"));
  for (const text of ["Nessuno use case è ancora approvato", "Approva uno use case", "nascost"]) assert.ok(!mine.includes(text), text);
  assert.deepEqual(findHubForbiddenIn([lanes.LANES_TEXT.emptyContributorBody], "area"), []);
  const filtered = render([decide], { filtersActive: true });
  assert.ok(filtered.includes("Niente in programma con questi filtri.") && filtered.includes("Togli i filtri"));
  assert.ok(render([], { filtersActive: true }).includes("Nessuno use case con questi filtri."));
});

test("contributori: tag, titolo e la pillola della fase, per titolo; nessuna cifra, niente «Scaduto» né trimestre a parte", () => {
  const zeta = contributor({ title: "LIBRA L2 · Zeta" });
  const alfa = contributor({ title: "LIBRA L1 · Alfa" });
  const overdue = contributor({ title: "ORSA O1 · Solleciti", phaseLabel: "Approvato · T3 2026", quando: "T3 2026" });
  const info = infoProgressView({
    state: "da_verificare",
    since: null,
    reminded: false,
    until: null,
    silentReason: null,
    blocked: false,
    received: 2,
    total: 6,
    toAsk: 0,
    toVerify: 2,
    waiting: 0,
    unanswered: 0,
    blockedCount: 0,
  });
  void info;
  // (Rilascio 5) Ai contributori lo stato del referente, solo la parola, sotto la pillola; (rilascio 10, D7) solo
  // quando chiede un'azione: «In attesa del referente» sulla card non c'è, lo dice il pannello.
  const html = render([zeta, overdue, alfa], { referentStates: { [zeta.id.toLowerCase()]: "manca", [alfa.id.toLowerCase()]: "in_attesa" }, barScale: 0 });
  assert.ok(cardOf(html, zeta.id).includes('data-slot="referent-chip" data-state="manca"') && cardOf(html, zeta.id).includes(">Manca il referente<"));
  assert.ok(!cardOf(html, alfa.id).includes("referent-chip"));
  for (const text of ["data-figure", "€", "value-bar", "info-chip", "Scaduto", "text-red-300", ">T3 2026<", "avvio"]) assert.ok(!html.includes(text), text);
  assert.ok((html.match(/data-slot="agent-tag"/g) ?? []).length === 3, "i tag dell'agente");
  assert.ok(html.includes("Approvato · T1 2027") && html.includes("Approvato · T3 2026"), "la pillola dice il trimestre");
  const next = html.slice(html.indexOf('data-lane="prossimo_trimestre"'));
  assert.match(next, /<h2 id="lane-prossimo_trimestre"[^>]*>T1 2027 <span[^>]*>2<span class="sr-only"> use case<\/span><\/span><\/h2>/);
  assert.ok(next.indexOf(alfa.id) < next.indexOf(zeta.id), "per titolo");
});

test("«Per trimestre | Per agente»: le card degli agenti al posto delle corsie; dopo un clic, le corsie dell'agente con il suo nome", () => {
  const libra = hub({ title: "LIBRA L1 · Fatture", value: counted(12_250) });
  const plain = hub({ title: "Smistamento" });
  const grouping = (active: "trimestre" | "agente") => ({
    active,
    items: [
      { key: "trimestre", label: "Per trimestre", href: `${BASE}?vista=panoramica` },
      { key: "agente", label: "Per agente", href: `${BASE}?vista=panoramica&mostra=agenti` },
    ],
  });
  const byAgent = render([libra, plain], { grouping: grouping("agente") });
  assert.match(byAgent, /aria-label="Use case per agente" data-slot="panorama-plan"/);
  assert.match(byAgent, /<div data-slot="plan-grouping" class="flex flex-wrap items-center justify-between gap-2"><nav aria-label="Raggruppa"/);
  assert.match(byAgent, /aria-current="page"[^>]*><span>Per agente<\/span>/);
  assert.ok(byAgent.includes('data-slot="agent-grid"') && !byAgent.includes('data-slot="lanes"'));
  assert.ok(!byAgent.includes("agent-in-progress"));
  // Un use case di LIBRA in realizzazione: la sua card lo dice sotto la cifra.
  const building = hub({ title: "LIBRA L3 · Scadenzario", phase: "in_realizzazione", value: counted(4_042.5) });
  const withBuilding = render([libra, plain, building], { grouping: grouping("agente") });
  const libraCard = withBuilding.slice(withBuilding.indexOf('data-agent="LIBRA"'), withBuilding.indexOf("</li>", withBuilding.indexOf('data-agent="LIBRA"')));
  assert.ok(textOf(libraCard).includes(`12.250${N}€${N}all'anno+${N}4.043${N}€ in realizzazione`), textOf(libraCard));
  // «In realizzazione» sotto lo conta, senza euro in testa (rilascio 10).
  assert.match(withBuilding, /<h2 id="panoramica-in-realizzazione"[^>]*>In realizzazione <span[^>]*>1<span class="sr-only"> use case<\/span><\/span><\/h2>/);
  assert.equal(withBuilding.split('data-slot="agent-in-progress"').length - 1, 1, "solo la card di LIBRA");
  const byQuarter = render([libra, plain], { grouping: grouping("trimestre") });
  assert.ok(byQuarter.includes('data-slot="lanes"') && !byQuarter.includes('data-slot="agent-grid"'));
  assert.match(byQuarter, /aria-current="page"[^>]*><span>Per trimestre<\/span>/);
  const drill = render([libra], { agentFilter: "LIBRA", grouping: grouping("trimestre") });
  assert.match(drill, /aria-label="Use case di LIBRA per trimestre"/);
  // A schermo, sopra le corsie: di chi sono, quanti, e la strada per tornare agli agenti.
  const line = drill.slice(drill.indexOf('data-slot="agent-filter-line"'), drill.indexOf("</p>", drill.indexOf('data-slot="agent-filter-line"')));
  assert.equal(textOf(line.slice(line.indexOf(">") + 1)), `LIBRA${N}· 1${N}use${N}caseTutti gli agenti`);
  // Il ritorno porta alla card di LIBRA (`#agente-LIBRA`): il link sparisce con il clic e il fuoco va lì, non sul <body>.
  assert.match(line, new RegExp(`<a [^>]*href="${BASE.replace(/[?]/g, "\\?")}\\?vista=panoramica&amp;mostra=agenti#agente-LIBRA"`));
  assert.ok(!line.includes("bg-primary"), "un link, non un pulsante pieno");
  const others = render([plain], { agentFilter: "altri" });
  assert.match(others, /aria-label="Altri use case per trimestre"/);
  assert.ok(others.includes('data-slot="agent-filter-line"') && textOf(others).includes(`Altri use case${N}· 1${N}use${N}case`));
  assert.ok(!others.includes("Tutti gli agenti"), "senza «Per agente» niente ritorno");
  assert.match(render([plain], { agentFilter: "altri", grouping: grouping("trimestre") }), /<a [^>]*href="[^"]*mostra=agenti#agente-altri"/);
  // Il segmento «Per agente» resta senza ancora (`scroll={false}`): resta a schermo, e il fuoco con lui.
  assert.match(drill, /<nav aria-label="Raggruppa"[\s\S]*?href="[^"]*mostra=agenti"/);
  assert.ok(!byQuarter.includes('data-slot="agent-filter-line"'), "senza il filtro nessuna riga");
  assert.ok(!render([libra]).includes("plan-grouping"), "senza la scelta niente controllo");
  assert.equal(lanes.agentSectionLabel("ORSA"), "Use case di ORSA per trimestre");
  // Aperto dall'indirizzo, «Per agente» viene in vista: il segno sta nel gruppo, dopo i segmenti
  // (in fondo alla sezione `space-y-3` darebbe un margine sotto le card), e solo per «Per agente».
  const MARK = '<span hidden="" data-slot="reveal-on-load"></span>';
  const landing = render([libra, plain], { grouping: { ...grouping("agente"), landOnLoad: true } });
  assert.equal(landing.split(MARK).length - 1, 1);
  assert.match(landing, /<div data-slot="plan-grouping" class="[^"]*"><nav [\s\S]*?<\/nav><span hidden="" data-slot="reveal-on-load"><\/span><\/div>/);
  assert.ok(!byAgent.includes(MARK), "senza `landOnLoad` (un pannello, un avviso) niente segno");
  assert.ok(!render([libra, plain], { grouping: { ...grouping("trimestre"), landOnLoad: true } }).includes(MARK), "le corsie: niente segno");
  assert.ok(!render([libra], { agentFilter: "LIBRA", grouping: { ...grouping("trimestre"), landOnLoad: true } }).includes(MARK), "le corsie di un agente: le porta l'ancora");
  const theirs = [contributor({ title: "LIBRA L1 · Fatture" })];
  assert.ok(!render(theirs, { grouping: { ...grouping("agente"), landOnLoad: true } }).includes(MARK), "il contributore: le corsie");
});

test("(rilascio 10, §3.4) i grafici stanno nel «⋯» della testata: nella riga di «Per trimestre | Per agente» nessun «Grafici»", () => {
  const item = hub({ title: "LIBRA L1 · Fatture", targetQuarter: "2026-Q4" });
  assert.ok(!render([item], {}).includes("Grafici") && !render([item], {}).includes("charts-menu"));
  const source = readFileSync(new URL("./panorama-lanes.tsx", import.meta.url), "utf8");
  assert.ok(!source.includes("ChartsMenu") && !/\bcharts\b/.test(source), "la prop dei grafici non c'è più");
});

test("(rilascio 10, §3.4) «Chi propone, per area» sta nella Home (Persone): la Panoramica non la legge e non la mostra", () => {
  const source = readFileSync(new URL("./hub.tsx", import.meta.url), "utf8");
  for (const text of ["getPortfolioParticipation", "ParticipationList", "ParticipationCard", "participation"]) assert.ok(!source.includes(text), text);
  const home = readFileSync(new URL("../../lib/db/queries/use-case-home.ts", import.meta.url), "utf8");
  assert.ok(home.includes("program ? readParticipation(workspace.id) : Promise.resolve(null)"), "la Home dei revisori la legge");
});
