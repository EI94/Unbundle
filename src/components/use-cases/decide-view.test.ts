import test, { before } from "node:test";
import assert from "node:assert/strict";
import * as nodeModule from "node:module";
import { DEFAULT_REVIEW_TEAM_NAME } from "../../lib/review-team.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import type { ContributorUseCase } from "../../lib/use-cases/permissions.ts";
import type { HubItem } from "../../lib/use-cases/views.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// (Rilascio 10, §3.4) «Da decidere» resa sul server, senza database (dati inventati, codici XX-00NN): la riga dei
// revisori con cinque cose (tag e titolo, codice piccolo, sotto-stato, Valore in parole, giorni) e l'origine come
// punto; il costo nel pannello; il solo pulsante pieno «Inizia dal più vecchio», che apre il pannello della prima riga;
// l'avviso ai contributori con «Rispondi».
let view: typeof import("./decide-view.tsx");
let agents: typeof import("../../lib/use-cases/agents.ts");
let renderToStaticMarkup: (element: unknown) => string;
let createElement: (type: unknown, props: unknown) => unknown;
type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

before(async () => {
  await enableTsxImports();
  // hub-header.tsx (i vuoti) porta con sé il menu «⋯» della testata e la sua action: qui non serve.
  const menu = `data:text/javascript,${encodeURIComponent("export function HubMenu() { return null; }")}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "./hub-menu" && context.parentURL?.endsWith("/hub-header.tsx")) return { url: menu, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  view = await import("./decide-view.tsx");
  agents = await import("../../lib/use-cases/agents.ts");
  const react = await import("react");
  createElement = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const TODAY = "2026-11-19";
const BASE = "/dashboard/ws/use-cases";
let seq = 0;
function item(over: Partial<HubItem> & { title: string }): HubItem {
  seq += 1;
  return {
    id: `aaaaaaaa-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    code: `XX-00${String(seq).padStart(2, "0")}`,
    origin: "adoption",
    kind: "da_costruire",
    phase: "da_valutare",
    subState: "nuova",
    phaseLabel: "Da valutare · Nuova",
    tone: "grigio",
    quando: null,
    targetQuarter: null,
    reviewBy: null,
    value: { score: null, word: null, source: null, perYear: null },
    cost: { source: "team_importo", amount: 30_000, band: 2, fromBand: false },
    zone: null,
    valueModel: null,
    risks: [],
    claudeHoursPerYear: null,
    source: "web_proposed",
    area: null,
    aiLab: null,
    hiddenFromSearch: false,
    publicNote: null,
    answered: false,
    problemPreview: null,
    arrivedOn: "2026-11-01",
    waitingSince: "2026-11-01",
    realizedOn: null,
    dossier: null,
    version: 1,
    ...over,
  } as HubItem;
}

const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const textOf = (html: string) => html.replace(/<span class="sr-only">[^<]*<\/span>/g, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const filled = (html: string) =>
  [...html.matchAll(/<(?:a|button)\b[^>]*>/g)].map((m) => m[0]).filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));
const rowsOf = (html: string) => [...html.matchAll(/<li data-slot="use-case-row" data-id="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({ id: m[1], html: m[2] }));

function render(items: readonly unknown[], props: Record<string, unknown> = {}) {
  return readable(
    renderToStaticMarkup(
      createElement(view.DecideView, {
        items,
        teamName: DEFAULT_REVIEW_TEAM_NAME,
        today: TODAY,
        basePath: BASE,
        query: { vista: "da-decidere" },
        overviewHref: `${BASE}?vista=panoramica`,
        filtersActive: false,
        clearHref: `${BASE}?vista=da-decidere`,
        canDecide: true,
        ...props,
      }),
    ),
  );
}

test("la riga dei revisori: tag e titolo, codice piccolo, sotto-stato, giorni e Valore in parole; l'origine è un punto; niente costo né referente", () => {
  const tagged = item({ title: "LIBRA L1 · Smistamento delle richieste", origin: "transformation", value: { score: 4, word: "alto", source: "team", perYear: null }, waitingSince: "2026-11-10" });
  const plain = item({ title: "Verbali delle riunioni", subState: "possibile_doppione", phaseLabel: "Da valutare · Possibile doppione" });
  const palette = agents.agentPalette([tagged]);
  const html = render([tagged, plain], { agents: palette });
  const [first] = rowsOf(html);
  assert.equal(first.id, plain.id, "prima chi aspetta da più giorni");
  // Il titolo senza il prefisso, che resta per i lettori di schermo; il tag nel colore dell'agente.
  const row = rowsOf(html).find((r) => r.id === tagged.id)!.html;
  assert.ok(row.includes('data-slot="agent-tag"') && row.includes(">LIBRA L1</span>"), row);
  assert.ok(row.includes('<span class="sr-only">LIBRA L1 · </span>Smistamento delle richieste'));
  // Nell'ordine della proposta: tag e titolo, codice, sotto-stato, giorni, Valore; ognuno una volta.
  assert.equal(textOf(row), "LIBRA L1 Smistamento delle richieste XX-0001 Nuova da 9 giorni Valore: Alto");
  // L'origine: un punto con le parole per i lettori di schermo e al passaggio del mouse, mai il chip a schermo.
  assert.match(row, /<span data-slot="origin-dot" data-origin="transformation" title="Origine: Dall'alto"[^>]*><span aria-hidden="true" class="size-2 rounded-full bg-indigo-500"><\/span><span class="sr-only">Origine: Dall'alto<\/span><\/span>/);
  assert.ok(!row.includes('data-slot="origin-chip"'));
  // Il sotto-stato è un puntino e una parola; «Possibile doppione» nella seconda riga.
  assert.ok(row.includes('data-slot="status-dot"') && textOf(first.html).includes("Possibile doppione"));
  // Il costo sta nel pannello; il chip del referente fuori da questa vista; il tipo nella scheda.
  for (const gone of ['data-figure="costo"', "30.000", "Costo", 'data-slot="referent-chip"', "Da costruire"]) assert.ok(!html.includes(gone), gone);
  // Senza Valore: «Valore: da stimare» in grigio, una sola frase.
  assert.ok(textOf(first.html).includes("Valore: da stimare"));
  // Ogni riga apre il suo pannello, restando nella vista.
  assert.ok(html.includes(`href="${BASE}?vista=da-decidere&apri=${tagged.id}"`));
});

test("«Inizia dal più vecchio»: il solo pulsante pieno, apre il pannello della prima riga; il «?» dice da quanto aspetta", () => {
  const oldest = item({ title: "Riconciliazione incassi", waitingSince: "2026-10-19" });
  const newer = item({ title: "Solleciti di pagamento", waitingSince: "2026-11-18" });
  const html = render([newer, oldest]);
  const buttons = filled(html);
  assert.equal(buttons.length, 1);
  assert.ok(buttons[0].includes(`href="${BASE}?vista=da-decidere&apri=${oldest.id}"`), buttons[0]);
  const step = /<section aria-labelledby="da-decidere-passo-etichetta" data-slot="next-step"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.ok(textOf(step).startsWith("Prossimo passo Inizia dal più vecchio"), textOf(step));
  assert.ok(step.includes("Il più vecchio aspetta da 31 giorni."), "il perché, anche per i lettori di schermo");
  assert.ok(html.indexOf('data-slot="next-step"') < html.indexOf('data-slot="use-case-row"'), "sopra la lista");
  // Un solo use case: «Aspetta da …».
  assert.ok(render([oldest]).includes("Aspetta da 31 giorni."));
  // Chi non decide, o solo «Serve info» (aspettano chi ha proposto): nessun pulsante pieno.
  assert.equal(filled(render([oldest], { canDecide: false })).length, 0);
  const asked = item({ title: "Archivio contratti", subState: "serve_info", phaseLabel: "Da valutare · Serve info" });
  const onlyAsked = render([asked]);
  assert.equal(filled(onlyAsked).length, 0);
  assert.ok(onlyAsked.includes("In attesa di risposta") && rowsOf(onlyAsked).length === 1, "«Serve info» sotto il divisore");
});

test("contributori («In valutazione»): niente pulsante pieno; l'avviso con «Rispondi» resta; niente chip del referente", () => {
  const own = { id: "bbbbbbbb-0000-4000-8000-000000000001", code: "XX-0024", title: "Riepilogo delle chiamate", phase: "da_valutare", subState: "serve_info", phaseLabel: "Da valutare · Serve info", quando: null, own: true, publicNote: "Quante chiamate al giorno?" } as unknown as ContributorUseCase;
  const other = { id: "bbbbbbbb-0000-4000-8000-000000000002", title: "Archivio offerte", phase: "da_valutare", subState: null, phaseLabel: "Da valutare", quando: null, own: false } as unknown as ContributorUseCase;
  const html = render([own, other], { overviewHref: null, canDecide: false, referentStates: { [other.id]: "manca" } });
  assert.equal(filled(html).length, 0);
  const notice = /<ul data-slot="answer-notice"[\s\S]*?<\/ul>/.exec(html)?.[0] ?? "";
  assert.ok(textOf(notice).includes(`${DEFAULT_REVIEW_TEAM_NAME} ti chiede informazioni: XX-0024 Riepilogo delle chiamate Rispondi`), textOf(notice));
  assert.ok(notice.includes(`href="${BASE}?vista=da-decidere&apri=${own.id}"`));
  assert.ok(!html.includes('data-slot="referent-chip"') && !html.includes("Manca il referente"));
  assert.ok(html.includes("Proposto da te"));
});

test("i vuoti e i testi: «Le nuove idee arrivano qui.», niente «proposte»; la guardia delle parole", () => {
  const empty = render([]);
  assert.ok(textOf(empty).includes("Niente da decidere Le nuove idee arrivano qui. Vai alla Panoramica"));
  assert.equal(view.DECIDE_TEXT.start, "Inizia dal più vecchio");
  assert.deepEqual(findHubForbiddenIn(Object.values(view.DECIDE_TEXT), "area"), []);
  assert.ok(!Object.values(view.DECIDE_TEXT).some((text) => /propost/i.test(text)));
  const html = render([item({ title: "Titolo di prova" })]);
  assert.deepEqual(findHubForbiddenIn([textOf(html)], "area"), []);
});

test("(rilascio 10, §3.4) la riga sulle proposte altrui del contributore: la stessa frase della scheda, «ad» davanti a una «a»", async () => {
  const row = await import("./use-case-row.tsx");
  assert.equal(row.othersCardNote(DEFAULT_REVIEW_TEAM_NAME), `Dettagli visibili a chi l'ha proposto e ad ${DEFAULT_REVIEW_TEAM_NAME}.`);
  assert.equal(row.othersCardNote("  CoE   AI "), "Dettagli visibili a chi l'ha proposto e a CoE AI.");
  // Il nome entra com'è: «$&», «$'» e «$1» non sono schemi di sostituzione.
  assert.equal(row.othersCardNote("Team $& $' $1"), "Dettagli visibili a chi l'ha proposto e a Team $& $' $1.");
  assert.deepEqual(findHubForbiddenIn([row.othersCardNote("CoE AI"), row.ROW_TEXT.othersNote, row.ROW_TEXT.othersNoteVowel], "area"), []);
});
