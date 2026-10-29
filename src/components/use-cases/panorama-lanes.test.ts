import test, { before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { agentPalette } from "../../lib/use-cases/agents.ts";
import type { ValueParts } from "../../lib/use-cases/format.ts";
import { infoProgressView } from "../../lib/use-cases/info-progress.ts";
import type { ContributorUseCase } from "../../lib/use-cases/permissions.ts";
import type { CostFigure } from "../../lib/use-cases/valuation.ts";
import type { AnyHubItem, HubItem } from "../../lib/use-cases/views.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// Le corsie della Panoramica resi in HTML (rilascio «Panoramica»): la card con il tag dell'agente,
// il costo d'avvio, il Valore con la barra, «Mostra gli altri», «In realizzazione», «Realizzati» e la
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

test("la card del revisore: il titolo intero prima di tag e cifre, il tag nascosto ai lettori di schermo, l'avvio con la fonte", () => {
  const libra = hub({ title: "LIBRA L1 · Lettura delle fatture estere", value: counted(12_250), cost: TEAM_30K });
  const stima = hub({ title: "LIBRA L2 · Riconciliazione", value: pending(5_840), cost: STIMA_700 });
  const html = render([libra, stima], { barScale: 31_500 });
  const card = cardOf(html, libra.id);
  assert.match(card, /^data-id="[^"]+" data-lane="questo_trimestre" data-agent="LIBRA" class="min-w-0"/);
  const link = card.slice(card.indexOf("<a "));
  const title = link.indexOf('<span class="sr-only">LIBRA L1 · </span>Lettura delle fatture estere');
  assert.ok(title > 0, link);
  assert.ok(title < link.indexOf('data-figure="valore"') && title < link.indexOf('data-figure="costo"'), "il titolo prima del Valore e del costo");
  assert.match(link, /<span data-slot="agent-tag" data-tone="\d+" aria-hidden="true"/);
  assert.ok(!link.includes("XX-"), "niente codice accanto al tag");
  // L'avvio: un importo del team con la sua fonte; «Benefici e costi» senza.
  assert.match(card, /data-figure="costo" data-cost-source="team_importo"/);
  assert.ok(textOf(card).includes("avvio 30.000 € · team"), textOf(card));
  assert.match(card, /data-source="team_importo"/);
  const model = cardOf(html, stima.id);
  assert.match(model, /data-figure="costo" data-cost-source="stima"/);
  assert.ok(textOf(model).includes("avvio 700 €") && !model.includes("data-source="), "«Benefici e costi»: niente fonte");
  // Il Valore: gli euro con la barra piena sulla scala; il tetto da misurare tratteggiato.
  assert.ok(textOf(card).includes("12.250 € all'anno") && !card.includes("Valore: "), textOf(card));
  assert.match(card, /<span aria-hidden="true" data-slot="value-bar" data-bar="contato" class="block h-1\.5 w-full rounded-full bg-muted"><span class="block h-full rounded-full bg-uc-agente-\d+" style="width:38\.9%"><\/span>/);
  assert.ok(textOf(model).includes("da misurare · fino a 5.840 €"));
  assert.match(model, /data-bar="da_misurare"[^>]*><span class="block h-full rounded-full border border-dashed border-uc-agente-\d+" style="width:18\.5%"/);
  // Senza agente: il codice e la barra grigia.
  const plain = hub({ title: "Smistamento delle richieste", value: counted(3_000) });
  const neutral = cardOf(render([plain], { barScale: 12_000 }), plain.id);
  assert.ok(neutral.includes(plain.code!) && !neutral.includes("agent-tag") && !neutral.includes("data-agent"));
  assert.match(neutral, /class="block h-full rounded-full bg-muted-foreground" style="width:25\.0%"/);
});

test("la card: «Scaduto» e il trimestre a parte, «Da diffondere» senza costo, «Valore: da stimare», il chip di «Raccolta informazioni»", () => {
  const overdue = hub({ title: "ORSA O1 · Solleciti", targetQuarter: "2026-Q3" });
  const best = hub({ title: "Buone pratiche", kind: "da_diffondere", targetQuarter: "2027-Q1", cost: TEAM_30K });
  const later = hub({ title: "Più tardi", targetQuarter: "2027-Q3", value: QUALITATIVE });
  const info = infoProgressView({
    state: "senza_risposta",
    since: null,
    reminded: false,
    until: null,
    silentReason: "scaduta",
    blocked: false,
    received: 0,
    total: 3,
    toAsk: 0,
    toVerify: 0,
    waiting: 0,
    unanswered: 3,
    blockedCount: 0,
  });
  const html = render([overdue, best, later], { info: { [overdue.id.toLowerCase()]: info } });
  const late = cardOf(html, overdue.id);
  assert.ok(late.includes(">Scaduto<") && late.includes(">T3 2026<"), late);
  assert.match(late, /Valore: <\/span><span[^>]*>da stimare</);
  assert.ok(!late.includes('data-figure="costo"'), "senza costo niente «da stimare» del costo");
  assert.ok(late.includes('data-slot="info-chip"') && late.includes("Info: senza risposta"));
  const diffuse = cardOf(html, best.id);
  assert.ok(diffuse.includes("Da diffondere") && !diffuse.includes('data-figure="costo"'), "le best practice senza costo");
  const after = cardOf(html, later.id);
  assert.ok(after.includes('data-lane="piu_avanti"') && after.includes(">T3 2027<") && after.includes(">ritorno qualitativo<") && !after.includes("value-bar"));
});

test("una corsia: «7 use case · … contati all'anno», le prime 5 card, poi «Mostra gli altri 2» con «Mostra meno»", () => {
  const seven = Array.from({ length: 7 }, (_, index) => hub({ title: `Corsia ${index}`, value: counted(1_000 * (index + 1)) }));
  const html = render(seven, { barScale: 7_000 });
  const lane = html.slice(html.indexOf('data-lane="questo_trimestre"'), html.indexOf('data-lane="prossimo_trimestre"'));
  assert.match(lane, /<h2 id="lane-questo_trimestre" class="text-sm font-semibold">Questo trimestre · T4 2026<\/h2>/);
  assert.ok(textOf(lane).includes("7 use case · 28.000 € contati all'anno"), textOf(lane));
  assert.match(lane, /data-figure="corsia"/);
  const more = lane.indexOf('<details data-slot="lane-more"');
  assert.ok(more > 0, "le altre dietro un <details>");
  assert.equal((lane.slice(0, more).match(/data-slot="lane-card"/g) ?? []).length, 5);
  assert.equal((lane.slice(more).match(/data-slot="lane-card"/g) ?? []).length, 2);
  const details = lane.slice(more);
  assert.doesNotMatch(/<details[^>]*>/.exec(details)![0].replace(/="[^"]*"/g, ""), /\sopen\b/);
  assert.ok(details.includes('<span class="[[open]&gt;summary&gt;&amp;]:hidden">Mostra gli altri 2</span>'), details);
  assert.ok(details.includes('<span class="hidden [[open]&gt;summary&gt;&amp;]:inline">Mostra meno</span>'));
  // Le altre due corsie ci sono, vuote.
  for (const key of ["prossimo_trimestre", "piu_avanti"]) {
    const empty = html.slice(html.indexOf(`data-lane="${key}"`));
    assert.ok(empty.slice(0, empty.indexOf("</section>")).includes("Nessuno use case."), key);
  }
  // La sezione delle corsie: l'ancora e il fuoco dopo «Per agente».
  assert.match(html, /<section id="panoramica-approvati" tabindex="-1" aria-label="Use case per trimestre" data-slot="panorama-plan"/);
  assert.match(html, /<div data-slot="lanes" class="grid gap-6 @min-\[58rem\]\/hub:grid-cols-3 @min-\[58rem\]\/hub:gap-4">/);
});

test("«In realizzazione»: la card del dossier se c'è, altrimenti «Senza dossier»; con il dossier in errore solo la fase", () => {
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
  assert.match(section, /<h2 id="panoramica-in-realizzazione" class="flex scroll-mt-24 items-baseline gap-2 text-sm font-semibold">In realizzazione <span[^>]*>2<\/span><\/h2>/);
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
});

test("«Realizzati»: chiusi, con il conto, l'ancora, il mese e gli euro senza barra", () => {
  const old = hub({ title: "Prima", phase: "realizzato", subState: "realizzato", phaseLabel: "Realizzato", realizedOn: "2026-05-10" });
  const recent = hub({ title: "Dopo", phase: "realizzato", subState: "realizzato", phaseLabel: "Realizzato", realizedOn: "2026-09-10", value: counted(8_000) });
  const html = render([old, recent], { barScale: 8_000 });
  const opening = /<details[^>]*>/.exec(html)?.[0] ?? "";
  assert.match(opening, /^<details id="panoramica-realizzati" data-slot="panoramica-realizzati" class="scroll-mt-24">$/);
  const summary = /<summary[^>]*>([\s\S]*?)<\/summary>/.exec(html)?.[1] ?? "";
  assert.ok(summary.includes('Realizzati <span class="text-xs font-normal text-muted-foreground tabular-nums">2</span>'), summary);
  assert.ok(html.indexOf(`data-id="${recent.id}"`) < html.indexOf(`data-id="${old.id}"`), "dal più recente");
  const card = cardOf(html, recent.id);
  assert.ok(card.includes('data-lane="realizzati"') && textOf(card).includes("Realizzato · set 2026") && textOf(card).includes("8.000 € all'anno"), textOf(card));
  assert.ok(!card.includes("value-bar") && !card.includes('data-figure="costo"'));
});

test("vuoti: «Niente in programma, per ora»; con i filtri «Niente in programma con questi filtri.», o «Nessuno use case con questi filtri.» senza schede", () => {
  const decide = hub({ phase: "da_valutare", subState: "nuova", phaseLabel: "Da valutare · Nuova" });
  assert.ok(render([decide]).includes("Niente in programma, per ora"));
  assert.ok(render([decide]).includes("Approva uno use case e scegli quando farlo."));
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
  const html = render([zeta, overdue, alfa], { info: { [zeta.id.toLowerCase()]: info }, barScale: 0 });
  for (const text of ["data-figure", "€", "value-bar", "info-chip", "Scaduto", "text-red-300", ">T3 2026<", "avvio"]) assert.ok(!html.includes(text), text);
  assert.ok((html.match(/data-slot="agent-tag"/g) ?? []).length === 3, "i tag dell'agente");
  assert.ok(html.includes("Approvato · T1 2027") && html.includes("Approvato · T3 2026"), "la pillola dice il trimestre");
  const next = html.slice(html.indexOf('data-lane="prossimo_trimestre"'));
  assert.ok(next.includes('<p class="text-xs text-muted-foreground tabular-nums">2 use case</p>'));
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
  assert.match(byAgent, /<div data-slot="plan-grouping"><nav aria-label="Raggruppa"/);
  assert.match(byAgent, /aria-current="page"[^>]*><span>Per agente<\/span>/);
  assert.ok(byAgent.includes('data-slot="agent-grid"') && !byAgent.includes('data-slot="lanes"'));
  const byQuarter = render([libra, plain], { grouping: grouping("trimestre") });
  assert.ok(byQuarter.includes('data-slot="lanes"') && !byQuarter.includes('data-slot="agent-grid"'));
  assert.match(byQuarter, /aria-current="page"[^>]*><span>Per trimestre<\/span>/);
  assert.match(render([libra], { agentFilter: "LIBRA" }), /aria-label="Use case di LIBRA per trimestre"/);
  assert.match(render([plain], { agentFilter: "altri" }), /aria-label="Altri use case per trimestre"/);
  assert.ok(!render([libra]).includes("plan-grouping"), "senza la scelta niente controllo");
  assert.equal(lanes.agentSectionLabel("ORSA"), "Use case di ORSA per trimestre");
});
