import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nodeModule from "node:module";
import type { ContributorHomeData, ReviewerHomeData } from "../../lib/db/queries/use-case-home.ts";
import { HOME_TEXT } from "../../lib/home/text.ts";
import { reviewerHome } from "../../lib/home/view.ts";
import { NO_PROGRAM_COSTS } from "../../lib/programma/curve.ts";
import { buildProgramView, type ProgramView } from "../../lib/programma/view.ts";
import { DEFAULT_VALUE_PARAMS } from "../../lib/use-cases/value-model.ts";
import type { HubItem } from "../../lib/use-cases/views.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";

// La Home resa in HTML (rilascio 10, ondata 2b; prototipo S1, S1b, S1c): per ogni ruolo il solo pulsante pieno, il
// numero grande o «Per partire», le righe, i propri use case; e gli indirizzi di prima (`/programma`, `?apri=`).
//
// I moduli dei pannelli portano con sé le azioni del server del Programma (e il database): qui i moduli dei campi sono
// componenti vuoti, il resto è quello vero. Dati inventati (§9.1 della proposta).

type ResolveResult = { url: string; shortCircuit?: boolean };
const { registerHooks } = nodeModule as unknown as {
  registerHooks(hooks: { resolve?(specifier: string, context: { parentURL?: string }, nextResolve: (specifier: string, context: object) => ResolveResult): ResolveResult }): void;
};

const FORMS = ["AsksEditor", "CaseDevControl", "CloseSalButton", "CustomKpiForm", "FactAsk", "FactsEditor", "KeyResultEditor", "KpiCatalog", "KpiEditor", "LsCostsForm", "WeightsForm"];

let program: typeof import("../programma/program-home.tsx");
let panels: typeof import("../programma/program-panels.tsx");
let contributor: typeof import("./contributor-home.tsx");
let render: (element: unknown) => string;
let h: (type: unknown, props: unknown) => unknown;

before(async () => {
  await enableTsxImports();
  const forms = `data:text/javascript,${encodeURIComponent(FORMS.map((name) => `export function ${name}() { return null; }`).join("\n"))}`;
  registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier === "./program-forms" && context.parentURL?.includes("/components/programma/")) return { url: forms, shortCircuit: true };
      return nextResolve(specifier, context);
    },
  });
  program = await import("../programma/program-home.tsx");
  panels = await import("../programma/program-panels.tsx");
  contributor = await import("./contributor-home.tsx");
  const react = await import("react");
  h = (type, props) => react.createElement(type as never, props as never);
  ({ renderToStaticMarkup: render } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});

const WS = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-11-18";
// A schermo un numero resta con la sua parola (U+00A0, `keepTogether`): qui si leggono spazi normali.
const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\u00a0/g, " ");
const textOf = (html: string) => readable(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** I pulsanti pieni: `[data-slot=button]` con la classe `bg-primary`, come nell'harness delle schermate. */
function filledButtons(html: string): string[] {
  return [...html.matchAll(/<(?:a|button)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));
}

let seq = 0;
function hub(o: Partial<HubItem> = {}): HubItem {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    code: `XX-${String(seq).padStart(4, "0")}`,
    title: `Use case ${seq}`,
    origin: "adoption",
    kind: "da_costruire",
    phase: "approvato",
    subState: "trimestre",
    phaseLabel: "Approvato · T4 2026",
    tone: "blu",
    quando: "T4 2026",
    targetQuarter: "2026-Q4",
    value: { score: null, word: null, source: null, perYear: null, benefits: null },
    cost: null,
    valueModel: null,
    waitingSince: TODAY,
    arrivedOn: TODAY,
    realizedOn: null,
    ...o,
  } as HubItem;
}

function view(over: (v: ProgramView) => Partial<ProgramView> = () => ({})): ProgramView {
  const v = buildProgramView({
    workspaceId: WS,
    companyName: "Cliente Demo",
    today: TODAY,
    items: [hub({ phase: "realizzato", subState: "realizzato" })],
    params: { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" },
    settings: { employees: 120, employeesSource: "manuale", revenueEur: null, revenueSource: null, costs: { ...NO_PROGRAM_COSTS, caseDev: new Map() }, weights: null, asks: [], lastSalOn: "2026-11-03", updatedAt: null },
    training: { trained: 38, hours: 30, sessions: 4, exercises: 30 },
    readiness: null,
    goals: [],
    checkins: [],
    krLinks: [],
    kpis: [],
    kpiValues: [],
    snapshots: [],
    viewer: { isLateralSpace: true, canEdit: true },
  });
  const base = { ...v, results: { ...v.results, estimated: 412_000, estimatedCount: 20, inUse: 38_000, inUseCount: 1 } };
  return { ...base, ...over(base) };
}

function reviewer(o: { items?: HubItem[]; program?: ProgramView | null; start?: Parameters<typeof reviewerHome>[0]["start"]; state?: ReviewerHomeData["programState"]; description?: string } = {}): ReviewerHomeData {
  const programView = o.program === undefined ? view() : o.program;
  const decide = Array.from({ length: 4 }, (_, i) => hub({ phase: "da_valutare", subState: "nuova", phaseLabel: "Da valutare · Nuova", targetQuarter: null, waitingSince: `2026-11-${String(9 + i).padStart(2, "0")}` as HubItem["waitingSince"] }));
  const home = reviewerHome({
    workspaceId: WS,
    companyName: "Cliente Demo",
    today: TODAY,
    isLateralSpace: true,
    defaultUnitTerm: true,
    items: o.items ?? [...decide, hub(), hub({ phase: "in_realizzazione" }), hub({ phase: "realizzato", subState: "realizzato" })],
    needs: [],
    suppliers: { authorized: true, canAuthorize: true },
    program: programView,
    start: o.start ?? null,
  });
  return {
    kind: "revisore",
    workspaceId: WS,
    companyName: "Cliente Demo",
    description: o.description ?? null,
    home,
    program: programView,
    programState: o.state ?? (programView ? "ok" : "non_pronto"),
    pendingValue: null,
    participation: null,
  };
}

// ─── Revisori ────────────────────────────────────────────────────────

test("Home dei revisori (S1): H1 «Home», «⋯», un solo pulsante pieno «Decidi 4 use case», il numero grande e le righe", () => {
  const html = readable(render(h(program.ProgramHome, { data: reviewer(), initialPanel: null })));
  assert.match(html, /<div data-slot="home" data-home="revisore"/);
  assert.match(html, /<h1 class="text-2xl font-semibold tracking-tight">Home<\/h1>/);
  assert.match(html, /aria-label="Altre azioni"/, "il «⋯» della testata");
  const filled = filledButtons(html);
  assert.equal(filled.length, 1, "un solo pulsante pieno");
  assert.match(filled[0], /href="\/dashboard\/11111111-1111-4111-8111-111111111111\/use-cases\?vista=da-decidere"/);
  assert.ok(textOf(html).includes("Prossimo passo Decidi 4 use case"), textOf(html));
  assert.ok(html.includes('class="sr-only">Il più vecchio aspetta da 9 giorni.</span>'));
  // Il numero grande e «Tutti i numeri ›».
  assert.ok(html.includes(">412.000 €</p>") && html.includes(">Valore all'anno</p>") && html.includes(">su 20 use case · in uso 38.000 €</p>"));
  assert.match(html, /<button type="button" aria-haspopup="dialog" data-slot="text-action"[^>]*>Tutti i numeri<svg/);
  // Le quattro righe aprono un pannello; nessuna è a zero.
  for (const key of ["iniziative", "persone", "obiettivi", "sal"]) assert.match(html, new RegExp(`<button type="button" aria-haspopup="dialog" data-slot="row" data-row="${key}"`), key);
  assert.ok(textOf(html).includes("SAL (stato di avanzamento) ultimo il 3 novembre · prossimo dal 1° dicembre"));
  assert.ok(!html.includes("Per partire"), "un workspace che lavora: niente «Per partire»");
  // Niente di quello che la Home ha tolto: l'Overview, il Percorso, gli stream in inglese, le tessere.
  for (const gone of ["Percorso", "Three streams", "Automate", "Strumenti", "Workspace"]) assert.ok(!textOf(html).includes(gone), gone);
});

test("Home di un workspace nuovo (S1b): «Per partire · 2 di 5», le righe fatte con la spunta e il passo «Mappa i processi»", () => {
  const empty = view((v) => ({
    results: { ...v.results, estimated: 0, estimatedCount: 0, inUse: 0, inUseCount: 0 },
    people: { ...v.people, training: null, levels: null },
    objectives: [],
    kpis: [],
    initiatives: [],
    sal: { lastOn: null, changes: [] },
    viewer: { ...v.viewer, canEdit: false },
  }));
  const data = reviewer({ items: [], program: empty, start: { discovery: true, notes: true, mappedUnits: 0, goals: 0, decided: 0, toDecide: 0 } });
  const html = readable(render(h(program.ProgramHome, { data, initialPanel: null })));
  assert.equal(filledButtons(html).length, 1);
  assert.match(filledButtons(html)[0], /href="\/dashboard\/11111111-1111-4111-8111-111111111111\/contesto\?vista=processi"/);
  assert.ok(textOf(html).includes("Prossimo passo Mappa i processi"));
  assert.ok(html.includes('class="sr-only">È il terzo passo di «Per partire».</span>'));
  assert.ok(html.includes('<h2 id="per-partire" class="text-base font-semibold">Per partire <span class="font-normal text-muted-foreground">· 2 di 5</span></h2>'));
  assert.match(html, /data-start="racconta" data-done="">.*Racconta l'azienda<span class="sr-only"> \(fatto\)<\/span>/);
  assert.match(html, /<li data-start="processi"><a data-slot="row"[^>]*href="\/dashboard\/[^"]+\/contesto\?vista=processi">/);
  assert.ok(!html.includes("big-number"), "«Per partire» al posto del numero grande");
  assert.ok(!html.includes('data-slot="row" data-row='), "le quattro righe, a zero, non ci sono");
});

test("Home dei revisori senza il Programma (0029 assente): il passo e una riga che lo dice, senza «⋯» né pannelli", () => {
  const html = readable(render(h(program.ProgramHome, { data: reviewer({ program: null, state: "non_pronto" }), initialPanel: "valore" })));
  assert.equal(filledButtons(html).length, 1);
  assert.ok(html.includes(HOME_TEXT.notReady));
  assert.ok(!html.includes('aria-label="Altre azioni"'));
  assert.ok(!html.includes("big-number") && !html.includes("Tutti i numeri"));
});

test("la descrizione del workspace, che diceva l'Overview, sta sotto il titolo della Home", () => {
  const html = readable(render(h(program.ProgramHome, { data: reviewer({ description: "Il programma AI di prova." }), initialPanel: null })));
  assert.match(html, /<h1[^>]*>Home<\/h1>.*<p class="line-clamp-2 text-sm text-muted-foreground">Il programma AI di prova\.<\/p><\/header>/);
  const mine = readable(render(h(contributor.ContributorHome, { data: contributorData({ description: "Il programma AI di prova." }) })));
  assert.ok(mine.includes('<p class="line-clamp-2 text-sm text-muted-foreground">Il programma AI di prova.</p>'));
  assert.ok(!readable(render(h(program.ProgramHome, { data: reviewer(), initialPanel: null }))).includes("line-clamp-2"), "senza descrizione niente riga");
});

test("niente da fare: «Tutto in ordine», e nessun pulsante pieno nella Home", () => {
  const html = readable(render(h(program.ProgramHome, { data: reviewer({ items: [hub()] }), initialPanel: null })));
  assert.ok(textOf(html).includes("Prossimo passo Tutto in ordine"));
  assert.equal(filledButtons(html).length, 0);
});

// ─── Contributori ────────────────────────────────────────────────────

function contributorData(o: Partial<ContributorHomeData> = {}): ContributorHomeData {
  const base = `/dashboard/${WS}`;
  return {
    kind: "contributore",
    workspaceId: WS,
    description: null,
    useCases: [
      { id: "a", code: "XX-0034", title: "Controllo note spese", phaseLabel: "Da valutare · Nuova", phase: "da_valutare", subState: "nuova", href: `${base}/use-cases/a` },
      { id: "b", code: "XX-0021", title: "Ordini ai fornitori", phaseLabel: "Approvato · T4 2026", phase: "approvato", subState: "trimestre", href: `${base}/use-cases/b` },
      { id: "c", code: "XX-0009", title: "Archivio offerte", phaseLabel: "Chiuso · Doppione", phase: "chiuso", subState: "doppione", href: `${base}/use-cases/c` },
    ],
    participation: { rows: [{ label: "Amministrazione", count: 4, bestPractices: 1 }], companies: [] },
    courses: [],
    proposeHref: `${base}/use-cases/nuovo`,
    ...o,
  };
}

test("Home dei contributori (S1c): «Proponi un use case» pieno, «I tuoi use case (3)», la piega chiusa «Chi propone, per area»", () => {
  const html = readable(render(h(contributor.ContributorHome, { data: contributorData() })));
  assert.match(html, /<div data-slot="home" data-home="contributore"/);
  assert.match(html, /<h1 class="text-2xl font-semibold tracking-tight">Home<\/h1>/);
  const filled = filledButtons(html);
  assert.equal(filled.length, 1);
  assert.match(filled[0], /href="\/dashboard\/[^"]+\/use-cases\/nuovo"/);
  assert.ok(textOf(html).includes("Proponi un use case"));
  assert.ok(html.includes('<h2 id="i-tuoi-use-case" class="text-base font-semibold">I tuoi use case (3)</h2>'));
  assert.ok(textOf(html).includes("XX-0034 · Controllo note spese Da valutare · Nuova"), textOf(html));
  assert.ok(textOf(html).includes("XX-0009 · Archivio offerte Chiuso · Doppione"));
  assert.match(html, /<a data-slot="row"[^>]*href="\/dashboard\/[^"]+\/use-cases\/a">/);
  assert.match(html, /<section id="chi-propone" data-slot="fold"[^>]*><h2 class="text-base font-semibold"><button type="button" aria-expanded="false"/);
  assert.ok(html.includes("Chi propone, per area"));
  assert.ok(!html.includes("Vedi tutti"), "tre righe: tutte in vista");
  // Mai quello dei revisori: il passo del workspace, «Per partire», i numeri del Programma.
  for (const reviewerOnly of ["Prossimo passo", "Per partire", "Valore all'anno", "SAL", "€"]) assert.ok(!textOf(html).includes(reviewerOnly), reviewerOnly);
});

test("Home dei contributori: oltre tre «Vedi tutti (N)»; senza use case un vuoto con lo stesso pulsante; il corso", () => {
  const many = contributorData();
  const extra = Array.from({ length: 2 }, (_, i) => ({ ...many.useCases[1], id: `x${i}`, code: `XX-005${i}`, title: `Altro ${i}`, href: `/dashboard/${WS}/use-cases/x${i}` }));
  const html = readable(render(h(contributor.ContributorHome, { data: { ...many, useCases: [...many.useCases, ...extra] } })));
  assert.ok(html.includes("I tuoi use case (5)"));
  assert.match(html, /<details data-slot="show-all"[^>]*><summary[^>]*>Vedi tutti \(5\)<\/summary>/);
  const none = readable(render(h(contributor.ContributorHome, { data: contributorData({ useCases: [], participation: { rows: [], companies: [] }, courses: [{ id: "p1", title: "Corso di prova", href: `/dashboard/${WS}/learning/p1` }] }) })));
  assert.equal(filledButtons(none).length, 1, "il pulsante pieno sta nel vuoto");
  assert.ok(none.includes('data-slot="empty-state"') && none.includes(HOME_TEXT.contributor.empty));
  assert.ok(!none.includes("I tuoi use case"), "lo zero non si dice");
  assert.ok(!none.includes("chi-propone"), "nessuna partecipazione: niente piega");
  assert.match(none, /<a data-slot="row"[^>]*href="\/dashboard\/[^"]+\/learning\/p1">/);
  assert.ok(textOf(none).includes("Corso di prova Il tuo corso"));
});

// ─── Gli indirizzi di prima ──────────────────────────────────────────

test("(rilascio 10) «Tutti i numeri» ha il valore da misurare; «Persone» ha «Chi propone, per area» (prima sulla Panoramica)", () => {
  const open = () => {};
  const body = (panel: string, extras: Record<string, unknown> = {}) => render(h(panels.PanelBody, { panel, view: view(), open, extras }));
  // Il valore da misurare, sotto il valore stimato, quando c'è: una riga senza pannello.
  const numbers = body("numeri", { pendingValue: { amountEur: 23_400, count: 9 } });
  assert.ok(numbers.indexOf('data-row="valore"') < numbers.indexOf('data-row="da-misurare"') && numbers.indexOf('data-row="da-misurare"') < numbers.indexOf('data-row="in-uso"'), "sotto il valore stimato");
  assert.ok(textOf(numbers).includes("Valore da misurare all'anno fino a 23.400 € · su 9 use case"), textOf(numbers));
  assert.match(numbers, /<div data-slot="row" data-row="da-misurare"/, "una riga ferma, senza pannello né freccia");
  assert.ok(!body("numeri").includes('data-row="da-misurare"'), "lo zero non si dice");
  // «Chi propone, per area» in «Persone», con le aree e la riga delle società; mai in «Formazione».
  const participation = { rows: [{ label: "Amministrazione", count: 4, bestPractices: 1 }], companies: [{ label: "Cliente Demo", count: 4 }] };
  const people = body("persone", { participation });
  assert.ok(textOf(people).includes("Chi propone, per area") && textOf(people).includes("Amministrazione 4") && textOf(people).includes("di cui 1 da diffondere"), textOf(people));
  assert.ok(people.includes('data-slot="participation"'));
  assert.ok(!body("formazione", { participation }).includes("Chi propone, per area"));
  assert.ok(!body("persone", { participation: { rows: [], companies: [] } }).includes("Chi propone, per area"), "senza aree niente");
  // La Home passa ai pannelli quello che legge, a ogni revisore.
  const home = readFileSync(new URL("../programma/program-home.tsx", import.meta.url), "utf8");
  assert.ok(home.includes("extras={{ pendingValue: data.pendingValue, participation: data.participation }}"));
});

test("`/programma` è un alias della Home: la stessa pagina, con i suoi `?apri=`; la campanella apre ancora `?apri=rivedere`", () => {
  const app = new URL("../../app/(dashboard)/dashboard/[workspaceId]/", import.meta.url);
  const home = readFileSync(new URL("page.tsx", app), "utf8");
  const alias = readFileSync(new URL("programma/page.tsx", app), "utf8");
  // La Home e il suo alias controllano l'accesso prima di tutto (il learner va ai suoi corsi), poi disegnano la Home:
  // la Home dentro un Suspense con il suo scheletro (home-page.test.ts), l'alias con il suo `loading.tsx`.
  assert.match(home, /const \{ session, access \} = await requireWorkspacePage\(workspaceId\);[^\n]*\n?\s*return \(\s*<Suspense fallback=\{<HomeSkeleton \/>\}>\s*<HomeRoute session=\{session\} access=\{access\} searchParams=\{searchParams\} \/>\s*<\/Suspense>\s*\);/);
  assert.match(home, /import \{ HomeRoute \} from "@\/components\/home\/home-route";/);
  assert.match(alias, /const \{ session, access \} = await requireWorkspacePage\(workspaceId\);\s*return homePage\(\{ session, access, searchParams: await searchParams \}\);/, "il learner va ai suoi corsi");
  assert.match(alias, /import \{ homePage \} from "@\/components\/home\/home-route";/);
  assert.match(readFileSync(new URL("./home-route.tsx", import.meta.url), "utf8"), /export async function HomeRoute\([\s\S]*?\) \{\s*return homePage\(\{ session, access, searchParams: await searchParams \}\);\s*\}/);
  // I quattordici pannelli di prima restano tutti, con il loro nome; `scenari` porta alla curva.
  const before = ["valore", "in-uso", "dipendente", "indice", "curva", "in_uso", "in_realizzazione", "da_avviare", "supporto", "formazione", "rivedere", "persone", "obiettivi", "sal"];
  for (const name of before) assert.equal(panels.programPanelOf(name), name, name);
  assert.equal(panels.programPanelOf("scenari"), "curva");
  for (const name of ["numeri", "iniziative", "impostazioni"]) assert.equal(panels.programPanelOf(name), name);
  assert.equal(panels.programPanelOf("sconosciuto"), null);
  assert.equal(panels.programPanelOf(null), null);
  const bell = readFileSync(new URL("../../lib/notifications/bell.ts", import.meta.url), "utf8");
  assert.ok(bell.includes("/programma?apri=rivedere"), "il link della campanella non cambia");
  // I titoli dei pannelli della Home sono le parole delle sue righe.
  assert.deepEqual(["persone", "obiettivi", "sal", "numeri", "iniziative", "impostazioni"].map((p) => panels.programPanelTitle(p as never)), ["Persone", "Obiettivi", "SAL (stato di avanzamento)", "Tutti i numeri", "Iniziative", "Impostazioni del programma"]);
  // Dopo un salvataggio del Programma si rilegge anche la Home.
  const actions = readFileSync(new URL("../../lib/actions/use-case-program.ts", import.meta.url), "utf8");
  assert.ok(actions.includes("revalidatePath(`/dashboard/${workspaceId}`);") && actions.includes("revalidatePath(`/dashboard/${workspaceId}/programma`);"));
});

test("la Home sceglie per ruolo: i revisori il Programma, gli altri «I tuoi use case»; chi segue un corso resta nei corsi", () => {
  const route = readFileSync(new URL("./home-route.tsx", import.meta.url), "utf8");
  assert.match(route, /if \(data\.kind === "contributore"\) return <ContributorHome data=\{data\} \/>;/);
  const loader = readFileSync(new URL("../../lib/db/queries/use-case-home.ts", import.meta.url), "utf8");
  assert.match(loader, /return abilitiesForUseCase\(viewer\)\.isReviewer \? loadReviewerHome\(/);
  // «Per partire» si legge solo per i revisori, e solo quando nessuno use case è deciso.
  assert.match(loader, /decided \|\| \(legacy \?\? 0\) > 0 \? Promise\.resolve\(null\) : startFacts\(workspace, items, legacy\)/);
  assert.ok(loader.indexOf("startFacts(workspace, items, legacy)") > loader.indexOf("async function loadReviewerHome"));
  assert.equal(loader.slice(loader.indexOf("async function loadContributorHome")).includes("startFacts("), false);
});
