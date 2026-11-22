// La pagina «Agent Factory» del rilascio 10, ondata 6b (docs/ui-10/PROPOSTA-10.md §3.6 e prototipo S5; audit
// AUDIT-REALIZZAZIONE.md §3.25, F-135…F-144): il modello della pagina e la pagina resa in HTML. Il prossimo passo è la
// prima voce di «Da fare per te» e il solo pulsante pieno; al massimo tre voci sotto, poi «Altre N»; «La linea» senza
// zeri e come filtro; una riga per caso con il tag, la stazione, il passo e la qualità; le famiglie con un nome di parole
// e i «Dettagli»; la riga della CI (8.2b) sotto i casi; «Chi costruisce» e «Repository da aggiornare» solo al manager;
// mai «fabbrica», mai un comando nella riga. Router, avvisi e azioni sono finti; dati inventati (§9.1 della proposta).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { installAppModules } from "../../lib/ai/claude-test-kit.ts";
import type { FactoryCaseRow, FactoryOverview, FactoryTodo } from "../../lib/db/queries/use-case-factory-line.ts";
import { agentPalette } from "../../lib/use-cases/agents.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import { STATION_LABEL, type Station } from "../../lib/use-cases/factory/line.ts";
import { enableTsxImports } from "../use-cases/detail/referent/tsx-test-loader.ts";
import type { CiFamilyRow, CiTodo } from "./ci-view.ts";
import { FACTORY_TEXT } from "./factory-text.ts";
import {
  FACTORY_OLD_ANCHORS,
  FACTORY_PANELS,
  STATION_PARAM,
  caseHealth,
  ciTodoView,
  factoryCaseView,
  factoryPanelKeys,
  factoryPanelOf,
  factoryScreenModel,
  factoryTodoView,
  familyName,
  orderTodos,
  stationOfParam,
  type FactoryScreenModel,
} from "./factory-view.ts";

const stubAction = (name: string) => `export async function ${name}() { return { ok: false, code: "permesso_negato", message: "no" }; }`;
await installAppModules({
  "next/navigation": `export function useRouter() { return { push() {}, refresh() {}, replace() {} }; }
    export function usePathname() { return "/"; }
    export function useSearchParams() { return new URLSearchParams(); }`,
  sonner: `export const toast = Object.assign(() => {}, { success() {}, error() {} });`,
  "@/lib/actions/ci-keys": ["createCiKeyAction", "rotateCiKeyAction", "revokeCiKeyAction"].map(stubAction).join("\n"),
  "@/lib/actions/use-case-workspace-team": ["addBuilderAction", "removeBuilderAction"].map(stubAction).join("\n"),
  "@/lib/actions/workspace-collaboration": ["createWorkspaceInvitationAction"].map(stubAction).join("\n"),
});
await enableTsxImports();
const { FactoryScreen } = await import("./factory-screen.tsx");
const { BuildersPanelBody, AddBuilder, builderPersonGroups, inviteNewBuilder, NEW_PERSON } = await import("./builders-panel.tsx");
const { sheetHistoryMove } = await import("../ui-10/side-sheet.tsx");

const WS = "11111111-1111-4111-8111-111111111111";
const NOW = new Date("2026-11-22T10:00:00.000Z");
const BASE = `/dashboard/${WS}/agent-factory`;

const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
const render = (element: ReactElement) => readable(renderToStaticMarkup(element));
/** Il testo visibile, un pezzo per elemento: senza le parti solo per i lettori di schermo e senza quelle chiuse. */
const visible = (html: string) =>
  html
    .replace(/<span [^>]*class="sr-only"[^>]*>[\s\S]*?<\/span>/g, " ")
    .replace(/<dl [^>]*hidden=""[^>]*>[\s\S]*?<\/dl>/g, " ")
    .split(/<[^>]+>/)
    .map((p) => p.trim())
    .filter(Boolean);
const words = (html: string) => visible(html).join(" ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
/** I pulsanti pieni: `[data-slot=button]` con la classe `bg-primary`, come nell'harness delle schermate. */
function filledButtons(html: string): string[] {
  return [...html.matchAll(/<(?:a|button)\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => tag.includes('data-slot="button"') && (/class="([^"]*)"/.exec(tag)?.[1].split(/\s+/) ?? []).includes("bg-primary"));
}

let seq = 0;
function row(o: Partial<FactoryCaseRow> & { station: Station; nextStep: string; title: string; code: string; repo: string | null }): FactoryCaseRow {
  seq += 1;
  return {
    useCaseId: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    caseId: `00000000-0000-4000-9000-${String(seq).padStart(12, "0")}`,
    tasks: { total: 8, open: 1, inProgress: 2, inReview: 0, done: 5, cancelled: 0 },
    sessions: { count: 12, tokens: 1_200_000, costUsd: 140, lastAt: "2026-11-21T10:00:00.000Z" },
    prs: { open: 1, merged: 5, medianDays: 1.5, costPerPrUsd: 3.2, tokensPerPr: 120_000 },
    mine: true,
    evals: null,
    benches: [],
    ...o,
  };
}

const B = "Voltaen/cliente-demo-contabilita";
const C = "Voltaen/cliente-demo-vendite";
const XX7 = row({ code: "XX-0007", title: "BETA · Registrazione fatture passive", station: "costruzione", nextStep: "1 compito da prendere", repo: B, evals: { quality: 0.96, thresholdsMet: true, fakeModels: false, inConstruction: false, withoutAi: false, branch: "main", level: "pull_request", models: {}, at: "2026-11-20T10:00:00.000Z" } });
const XX19 = row({ code: "XX-0019", title: "GAMMA · Ordini dal sito", station: "collaudo", nextStep: "Prova con il cliente", repo: C, evals: { quality: 0.8, thresholdsMet: false, fakeModels: false, inConstruction: false, withoutAi: false, branch: "main", level: "pull_request", models: {}, at: "2026-11-20T10:00:00.000Z" } });
const XX12 = row({ code: "XX-0012", title: "ALFA · Smistamento delle richieste", station: "dossier", nextStep: "Imposta il progetto", repo: null, tasks: { total: 0, open: 0, inProgress: 0, inReview: 0, done: 0, cancelled: 0 }, sessions: { count: 0, tokens: 0, costUsd: 0, lastAt: null }, prs: { open: 0, merged: 0, medianDays: null, costPerPrUsd: null, tokensPerPr: null } });
const XX3 = row({ code: "XX-0003", title: "BETA · Riconciliazione incassi", station: "esercizio", nextStep: "Tutto in ordine", repo: B });

const todo = (o: Partial<FactoryTodo> & Pick<FactoryTodo, "kind" | "text">): FactoryTodo => ({ useCaseId: XX7.useCaseId, caseId: XX7.caseId, code: "XX-0007", ...o });
const TODOS: FactoryTodo[] = [
  todo({ kind: "rivedi", text: "La PR #12 di T-3 aspetta una revisione.", ref: "T-3", href: "https://github.com/Voltaen/cliente-demo-contabilita/pull/12" }),
  todo({ kind: "domande", text: "2 domande proposte dai coding agent da decidere in «Cosa serve».", count: 2 }),
  todo({ kind: "approva", useCaseId: XX12.useCaseId, caseId: XX12.caseId, code: "XX-0012", text: "Il progetto aspetta la tua approvazione." }),
  todo({ kind: "fermo", text: "T-5 è fermo da giorni: riprendilo con «unbundle take» o lascialo con una nota.", ref: "T-5" }),
  todo({ kind: "proposte", text: "2 proposte di compito da decidere.", count: 2 }),
];

function overview(o: Partial<FactoryOverview> = {}): Pick<FactoryOverview, "cases" | "families" | "todos" | "queue"> {
  const cases = o.cases ?? [XX7, XX19, XX12, XX3];
  return {
    cases,
    families: o.families ?? [
      { repo: B, templateVersion: "1.5.0", commonVersion: "1.2.0", cases: cases.filter((c) => c.repo === B) },
      { repo: C, templateVersion: "1.6.0", commonVersion: null, cases: cases.filter((c) => c.repo === C) },
      { repo: null, templateVersion: null, commonVersion: null, cases: cases.filter((c) => c.repo === null) },
    ],
    todos: o.todos ?? TODOS,
    queue: o.queue ?? [{ repo: B, text: "Ha il modello 1.5.0, c'è il 1.6.0: «unbundle aggiorna» apre la pull request." }],
  };
}

const PALETTE = agentPalette([XX7, XX19, XX12].map((c) => ({ title: c.title })));

function model(o: { manager?: boolean; station?: Station | null; ciTodos?: CiTodo[]; over?: Partial<FactoryOverview> } = {}): FactoryScreenModel {
  return factoryScreenModel({ workspaceId: WS, manager: o.manager ?? true, overview: overview(o.over), ciTodos: o.ciTodos ?? [], palette: PALETTE, station: o.station ?? null, clientName: "Cliente Demo", now: NOW });
}

const CI_ROW: CiFamilyRow = { repo: B, kind: "usata", manages: false, tone: "verde", text: "CI collegata · ultimo invio oggi · la chiave scade il 17/05/2027", primary: null, menu: [] };
function screen(m: FactoryScreenModel, o: { builders?: boolean; ciRows?: Record<string, CiFamilyRow>; initialPanel?: string | null } = {}) {
  return render(
    createElement(FactoryScreen, {
      model: m,
      initialPanel: o.initialPanel ?? null,
      builders: o.builders === false ? null : { rows: [], candidates: [], choices: [], ciLive: [], canInvite: true },
      ciRows: o.ciRows ?? { [B.toLowerCase()]: CI_ROW },
    }),
  );
}

test("«Da fare per te»: un verbo breve, il codice a parte, il perché senza comandi; «Collega Claude Code» porta a «Il tuo account»", () => {
  const views = TODOS.map((t, i) => factoryTodoView(WS, t, i, "Cliente Demo"));
  // (Revisione 6b) Nel pulsante e nella riga solo il verbo; il compito sta nel grigio, accanto al codice del caso.
  assert.deepEqual(
    views.map((v) => [v.kind, v.row, v.code]),
    [
      ["rivedi", "Rivedi una modifica", "XX-0007 · T-3"],
      ["domande", "Decidi 2 domande sul codice", "XX-0007"],
      ["approva", "Approva il progetto", "XX-0012"],
      ["fermo", "Riprendi un compito fermo", "XX-0007 · T-5"],
      ["proposte", "Decidi 2 proposte di compito", "XX-0007"],
    ],
  );
  for (const v of views) assert.doesNotMatch(v.button, /\bT-\d+\b/, `${v.kind}: niente codice nel pulsante`);
  const asked = factoryTodoView(WS, todo({ kind: "chiesto", text: "Qualcuno del team chiede T-3, che hai tu: passaglielo o rispondigli.", ref: "T-3" }), 0, "Cliente Demo");
  assert.deepEqual([asked.button, asked.code], ["Rispondi a una richiesta", "XX-0007 · T-3"]);
  assert.equal(views[0].external, true, "la modifica si apre su GitHub");
  assert.equal(views[0].why, "La modifica #12 di T-3 aspetta una revisione. Si apre su GitHub.");
  assert.equal(views[3].why, "T-5 è fermo da giorni: riprendilo o lascialo con una nota.");
  for (const v of views) assert.doesNotMatch(`${v.row} ${v.why}`, /unbundle|«compiti importa»|\bPR\b/, v.kind);
  assert.equal(views[2].href, `/dashboard/${WS}/casi-duso/${XX12.caseId}/costruzione`);
  assert.equal(views[1].href, `/dashboard/${WS}/use-cases/${XX7.useCaseId}/proposte`);
  const collega = factoryTodoView(WS, { kind: "collega", useCaseId: "", caseId: "", code: "", text: "Collega Claude Code: nel terminale «unbundle login», poi scegli Cliente Demo." }, 0, "Cliente Demo");
  assert.deepEqual([collega.row, collega.code, collega.href], ["Collega Claude Code", "", `/dashboard/${WS}?account=claude`]);
  assert.doesNotMatch(collega.why, /unbundle/);
  const banco = factoryTodoView(WS, todo({ kind: "banco", text: "Per lettura il più conveniente che rispetta le soglie è Claude Haiku 5.5." }), 0, "Cliente Demo");
  assert.equal(banco.href, `/dashboard/${WS}/casi-duso/${XX7.caseId}/costruzione#banco`);
});

test("(8.2b) le voci della CI restano con le loro frasi e portano alla famiglia, anche con un filtro acceso", () => {
  const ci: CiTodo[] = [{ kind: "metti", repo: B, text: "Metti su GitHub la chiave nuova della CI di cliente-demo-contabilita.", href: "#famiglia-cliente-demo-contabilita" }];
  const m = model({ ciTodos: ci, over: { todos: [] } });
  assert.deepEqual(m.todos.map((t) => [t.kind, t.row, t.button, t.href]), [
    ["ci-metti", "Metti su GitHub la chiave nuova della CI di cliente-demo-contabilita.", "Metti la chiave su GitHub", `${BASE}#famiglia-cliente-demo-contabilita`],
  ]);
  const html = screen(m);
  assert.match(html, /data-action="next-step"[^>]*>[\s\S]*?Metti la chiave su GitHub</);
  assert.equal(filledButtons(html).length, 1);
});

test("«La linea»: un chip per stazione con almeno un caso, nell'ordine della linea; un chip filtra, toccato di nuovo toglie il filtro", () => {
  const m = model();
  assert.deepEqual(m.chips.map((c) => [c.label, c.count]), [["Da impostare", 1], ["In costruzione", 1], ["In prova", 1], ["In uso", 1]]);
  assert.ok(m.chips.every((c) => c.count > 0), "lo zero non si vede");
  assert.equal(m.chips[1].href, `${BASE}?stazione=in-costruzione`);
  const filtered = model({ station: "costruzione" });
  assert.deepEqual(filtered.families.map((f) => f.cases.map((c) => c.code)), [["XX-0007"]]);
  assert.equal(filtered.chips.find((c) => c.active)?.href, BASE, "il chip acceso toglie il filtro");
  assert.equal(filtered.filter?.label, "1 caso · In costruzione");
  assert.equal(filtered.cases.length, 4, "i pannelli dei casi nascosti dal filtro si aprono lo stesso");
  // L'indirizzo dice la stazione a parole; un valore che non c'è vale «nessun filtro».
  for (const [station, slug] of Object.entries(STATION_PARAM)) assert.equal(stationOfParam(slug), station);
  assert.equal(stationOfParam("costruzione"), null);
  assert.equal(stationOfParam(null), null);
  // Una stazione senza casi non filtra.
  assert.equal(model({ station: "approvato" }).filter, null);
});

test("le famiglie: un nome di parole; repository, modello (e se è indietro) e comune nei «Dettagli»; l'ancora della CI resta", () => {
  assert.equal(familyName(B), "Cliente demo contabilita");
  assert.equal(familyName("Voltaen/topjet-rosa.git"), "Topjet rosa");
  assert.equal(familyName(null), "Ancora senza repository");
  const [contabilita, vendite, senza] = model().families;
  assert.equal(contabilita.anchor, "famiglia-cliente-demo-contabilita");
  assert.deepEqual(contabilita.details, [
    { label: "Repository", value: B },
    { label: "Modello", value: "1.5.0 · indietro: c'è il 1.6.0" },
    { label: "Comune", value: "1.2.0" },
    { label: "Aggiornamento", value: "«unbundle aggiorna» apre la pull request." },
  ]);
  assert.deepEqual(vendite.details.map((d) => d.value), [C, "1.6.0"]);
  assert.equal(senza.anchor, "da-avviare");
  assert.deepEqual(senza.details, []);
});

test("una riga per caso: tag dell'agente, codice, titolo, stazione, passo, qualità; i fatti tecnici nel pannello del caso", () => {
  const m = model();
  const xx7 = m.cases.find((c) => c.code === "XX-0007");
  assert.ok(xx7);
  assert.deepEqual([xx7.key, xx7.title, xx7.tag?.label, xx7.stationLabel, xx7.next], ["XX-0007", "Registrazione fatture passive", "BETA", "In costruzione", "1 compito da prendere"]);
  assert.ok(xx7.tag?.tone, "il tono dell'agente, lo stesso delle card");
  assert.deepEqual(xx7.health, { tone: "verde", label: "Qualità 96%" });
  assert.deepEqual(caseHealth(XX19.evals), { tone: "giallo", label: "Qualità 80%, sotto soglia" });
  assert.equal(caseHealth(null), null);
  const facts = Object.fromEntries(xx7.facts.map((f) => [f.label, f.value]));
  assert.equal(facts.Compiti, "5 di 8 fatti · 2 in corso");
  assert.equal(facts.Modifiche, "1 aperta · 5 unite, di solito 1,5 giorni dalla presa all'unione");
  assert.equal(facts["Sessioni dei coding agent"], "12 sessioni, l'ultima ieri");
  assert.match(facts["Costo delle sessioni"], /per modifica unita/);
  assert.equal(xx7.href, `/dashboard/${WS}/casi-duso/${XX7.caseId}/costruzione`);
  // (F-140) Senza repository, il comando che lo crea sta nel pannello del caso, non nella riga.
  const xx12 = m.cases.find((c) => c.code === "XX-0012");
  assert.deepEqual(xx12?.how, ["Il repository della famiglia lo crea, dal terminale, «unbundle repo create XX-0012»."]);
  assert.ok(m.cases.every((c) => !/unbundle/.test(`${c.title} ${c.next} ${c.stationLabel}`)), "mai un comando nella riga");
});

test("i pannelli (`?apri=`): il caso per codice (anche in minuscolo), «Chi costruisce» e la coda solo al manager; `#team` e `#coda` li aprono", () => {
  const keys = factoryPanelKeys(model());
  assert.deepEqual(keys, ["XX-0007", "XX-0019", "XX-0012", "XX-0003", FACTORY_PANELS.todos, FACTORY_PANELS.builders, FACTORY_PANELS.queue]);
  assert.equal(factoryPanelOf(keys, "xx-0012"), "XX-0012");
  assert.equal(factoryPanelOf(keys, "sconosciuto"), null);
  assert.equal(factoryPanelOf(keys, null), null);
  const builderKeys = factoryPanelKeys(model({ manager: false }));
  assert.ok(!builderKeys.includes(FACTORY_PANELS.builders) && !builderKeys.includes(FACTORY_PANELS.queue), "chi costruisce: solo i casi");
  assert.deepEqual(FACTORY_OLD_ANCHORS, { team: "chi-costruisce", coda: "repository" });
  assert.deepEqual(model({ manager: false }).queue, [], "la coda solo al manager");
});

test("la pagina del manager (S5): un solo pulsante pieno, la prima voce; tre voci e «Altre 1»; «⋯» con Chi costruisce e la coda", () => {
  const html = screen(model());
  assert.match(html, /<h1 class="text-2xl font-semibold tracking-tight">Agent Factory<\/h1>/);
  const filled = filledButtons(html);
  assert.equal(filled.length, 1, "un solo pulsante pieno");
  assert.match(filled[0], /href="https:\/\/github\.com\/Voltaen\/cliente-demo-contabilita\/pull\/12"/);
  assert.match(filled[0], /target="_blank"/);
  assert.match(html, /data-action="next-step"[^>]*>[\s\S]*?Rivedi una modifica<\/a>/);
  const perTe = /<section aria-labelledby="per-te"[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
  assert.equal([...perTe.matchAll(/data-todo=/g)].length, 3, "al massimo tre righe sotto il pulsante");
  assert.match(perTe, />Altre 1</);
  assert.ok(!perTe.includes("Rivedi una modifica"), "la prima voce è il pulsante, non si ripete");
  assert.match(html, /aria-label="Altre azioni dell'Agent Factory"/);
  // Le righe dei casi aprono il pannello; la riga della CI sta sotto la sua famiglia.
  assert.equal([...html.matchAll(/data-row="caso"/g)].length, 4);
  assert.match(html, /<section id="famiglia-cliente-demo-contabilita"[\s\S]*?data-slot="ci-row"/);
  assert.match(html, /<nav aria-labelledby="la-linea"/);
  assert.doesNotMatch(html, /fabbrica/i);
  assert.doesNotMatch(visible(html).join(" "), /unbundle/, "nessun comando in vista");
  assert.deepEqual(findHubForbiddenIn(visible(html), "area"), []);
  const n = words(html);
  assert.ok(n <= 150, `${n} parole in vista (obiettivo ≤150)`);
});

test("chi costruisce (anche da fuori): i suoi casi, la riga della CI senza pulsanti, niente «⋯» né «Chi costruisce»", () => {
  const m = model({ manager: false });
  const html = screen(m, { builders: false });
  assert.match(html, />I casi dove sei nel team\.</);
  assert.doesNotMatch(html, /Altre azioni dell'Agent Factory/);
  assert.doesNotMatch(html, /Chi costruisce|Repository da aggiornare/);
  assert.match(html, /data-slot="ci-row"/);
  assert.doesNotMatch(html, /data-slot="ci-actions"/);
});

test("niente da fare: «Tutto in ordine» senza pulsante; nessun caso: la frase e «Vai agli use case»", () => {
  const calm = screen(model({ over: { todos: [] } }));
  assert.equal(filledButtons(calm).length, 0);
  assert.match(calm, /data-slot="next-step-done"/);
  assert.doesNotMatch(calm, /Da fare per te/);
  const none = screen(model({ over: { cases: [], families: [], todos: [] } }));
  assert.match(none, new RegExp(FACTORY_TEXT.empty.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(none, new RegExp(`href="/dashboard/${WS}/use-cases"[^>]*>Vai agli use case`));
  assert.doesNotMatch(none, /La linea/);
});

test("«Chi costruisce»: l'elenco, «Aggiungi» bordato che apre il modulo; a chi può invitare anche un'e-mail nuova", () => {
  const data = {
    rows: [
      { userId: "u1", name: "Persona Esterna", email: "p@example.com", external: true, role: "builder_esterno" as const, where: { all: true, useCaseIds: [] }, whereCodes: [], cli: false, blocked: null, openCases: 2, repos: [B] },
    ],
    candidates: [{ userId: "u2", name: "Altra Persona", isLateralSpace: false, blocked: null }],
    choices: [],
    ciLive: [B.toLowerCase()],
    canInvite: true,
  };
  const body = render(createElement(BuildersPanelBody, { workspaceId: WS, data: data as never }));
  assert.match(body, /Persona Esterna/);
  assert.match(body, /esterno · Sviluppatore · tutti i casi · CLI da collegare/);
  assert.match(body, /aria-label="Togli Persona Esterna da chi costruisce"/);
  assert.equal(filledButtons(body).length, 0, "nessun pulsante pieno nel pannello: «Aggiungi» è bordato");
  assert.match(body, />Aggiungi<\/button>/);
  const form = render(createElement(AddBuilder, { workspaceId: WS, data: data as never }));
  assert.match(form, /Non la trovi\? Scrivi la sua e-mail con «Una persona nuova, per e-mail»\./);
  const noInvite = render(createElement(AddBuilder, { workspaceId: WS, data: { ...data, canInvite: false } as never }));
  assert.match(noInvite, /Invitala prima nel workspace, da Impostazioni › Team, come Analista\./);
  assert.deepEqual(findHubForbiddenIn(visible(body), "area"), []);
});

test("i testi e la pagina: niente «fabbrica», niente `SettingsSection` nella pagina di lavoro, le stazioni del vocabolario", () => {
  const root = new URL("../../../", import.meta.url);
  const page = readFileSync(new URL("src/app/(dashboard)/dashboard/[workspaceId]/agent-factory/page.tsx", root), "utf8");
  const screenSource = readFileSync(new URL("src/components/agent-factory/factory-screen.tsx", root), "utf8");
  for (const source of [page, screenSource]) {
    assert.doesNotMatch(source, /SettingsSection/);
    assert.doesNotMatch(source, /fabbrica/i);
  }
  assert.deepEqual(Object.values(STATION_LABEL), ["Da impostare", "In impostazione", "Da costruire", "In costruzione", "In prova", "In uso"]);
  const texts = JSON.stringify(FACTORY_TEXT);
  assert.doesNotMatch(texts, /fabbrica|caso d'uso/i);
});

// ─── La revisione dell'ondata 6b ──────────────────────────────────────

test("(revisione) le voci della CI non finiscono in fondo: prima le più urgenti e, a pari urgenza, quelle della CI", () => {
  const metti = { kind: "metti" as const, repo: B, text: "Metti su GitHub la chiave nuova della CI di cliente-demo-contabilita.", href: "#famiglia-cliente-demo-contabilita" };
  const collegaCi = { kind: "collega" as const, repo: C, text: "Collega la CI di cliente-demo-vendite: le evals di main arriveranno da sole.", href: "#famiglia-cliente-demo-vendite" };
  const banco = todo({ kind: "banco", text: "Per lettura il più conveniente che rispetta le soglie è Claude Haiku 5.5." });
  const m = model({ ciTodos: [collegaCi, metti], over: { todos: [...TODOS, banco] } });
  assert.deepEqual(
    m.todos.map((t) => t.kind),
    ["ci-metti", "rivedi", "approva", "domande", "fermo", "proposte", "ci-collega", "banco"],
  );
  // La chiave nuova da mettere su GitHub è il pulsante pieno, non una riga dentro «Altre N».
  assert.match(screen(m), /data-action="next-step"[^>]*>[\s\S]*?Metti la chiave su GitHub/);
  // L'ordine della lettura resta, a parità d'urgenza e di tipo.
  assert.deepEqual(orderTodos([]), []);
});

test("(revisione) una voce della stessa pagina, da un pannello: il pannello si chiude sostituendo il suo passo, non tornando indietro", () => {
  const ci = ciTodoView(WS, { kind: "collega", repo: B, text: "Collega la CI di cliente-demo-contabilita: le evals di main arriveranno da sole.", href: "#famiglia-cliente-demo-contabilita" });
  assert.equal(ci.samePage, true);
  assert.equal(ci.href, `${BASE}#famiglia-cliente-demo-contabilita`);
  assert.ok(TODOS.every((t, i) => factoryTodoView(WS, t, i, "Cliente Demo").samePage === false));
  // La mossa nella cronologia: aprire aggiunge un passo; chiudere torna indietro di quello, tranne con `replace`.
  assert.equal(sheetHistoryMove({ next: true, wasOpen: false, pushed: false }), "push");
  assert.equal(sheetHistoryMove({ next: false, wasOpen: true, pushed: true }), "back");
  assert.equal(sheetHistoryMove({ next: false, wasOpen: true, pushed: true, replace: true }), "replace", "poi il link va all'ancora: ✕ non riapre il pannello");
  assert.equal(sheetHistoryMove({ next: true, wasOpen: true, pushed: true }), "replace", "da un pannello all'altro");
  assert.equal(sheetHistoryMove({ next: false, wasOpen: true, pushed: false }), "replace", "aperto da un link: si chiude sostituendo");
  // Il pannello «Da fare per te» passa la chiusura con `replace` alle righe della stessa pagina, che la chiamano prima di andare.
  const source = readFileSync(new URL("./factory-screen.tsx", import.meta.url), "utf8");
  assert.match(source, /<TodoRow key=\{t\.key\} todo=\{t\} onSamePage=\{\(\) => setPanel\(null, \{ replace: true \}\)\} \/>/);
  assert.match(source, /<Link href=\{todo\.href\} className=\{ROW_CLASS\} onClick=\{todo\.samePage && onSamePage \? onSamePage : undefined\}/);
  const sheet = readFileSync(new URL("../ui-10/side-sheet.tsx", import.meta.url), "utf8");
  assert.match(sheet, /const move = sheetHistoryMove\(\{ next: next !== null, wasOpen, pushed: pushed\.current, replace: opts\.replace \}\);/);
});

test("(revisione) il costo totale delle sessioni solo al manager; agli altri la media per modifica unita, da 3 in su", () => {
  const cost = (manager: boolean, c = XX7) => factoryCaseView(WS, c, PALETTE, NOW, manager).facts.find((f) => f.label === "Costo delle sessioni")?.value ?? null;
  assert.match(cost(true) ?? "", /^140,00\s?USD, 1\.200\.000 token · in media 3,20\s?USD e 120\.000 token per modifica unita$/);
  assert.match(cost(false) ?? "", /^in media 3,20\s?USD e 120\.000 token per modifica unita$/, "chi costruisce: mai il totale");
  // Sotto le 3 modifiche unite la lettura non dà la media: a chi costruisce niente costo.
  const few = { ...XX7, prs: { ...XX7.prs, merged: 2, costPerPrUsd: null, tokensPerPr: null } };
  assert.equal(cost(false, few), null);
  assert.match(cost(true, few) ?? "", /^140,00\s?USD, 1\.200\.000 token$/);
  assert.equal(model({ manager: false }).cases.find((c) => c.code === "XX-0007")?.facts.find((f) => f.label === "Costo delle sessioni")?.value.includes("1.200.000"), false);
});

test("(revisione) i «Dettagli» di una famiglia indietro dicono come aggiornarla, anche a chi costruisce senza la coda", () => {
  const families = model({ manager: false }).families;
  const contabilita = families.find((f) => f.repo === B);
  assert.deepEqual(contabilita?.details.find((d) => d.label === "Aggiornamento"), { label: "Aggiornamento", value: "«unbundle aggiorna» apre la pull request." });
  assert.equal(families.find((f) => f.repo === C)?.details.some((d) => d.label === "Aggiornamento"), false, "aggiornata: niente");
  const unknown = model({ over: { families: [{ repo: B, templateVersion: null, commonVersion: null, cases: [XX7] }] } }).families[0];
  assert.deepEqual(unknown.details.map((d) => d.value), [B, "non ancora nota", "la dice il prossimo «unbundle start», oppure «unbundle aggiorna»."]);
});

test("(revisione) a11y: il pulsante verso GitHub dice che apre una nuova scheda; ogni «Dettagli» ha il nome della sua famiglia; il codice in grigio", () => {
  const html = screen(model());
  assert.match(html, /<a href="https:\/\/github\.com\/[^"]*" target="_blank" rel="noreferrer" aria-label="Rivedi una modifica \(si apre in una nuova scheda\)"/);
  assert.match(html, /aria-label="Dettagli di Cliente demo contabilita"/);
  assert.match(html, /aria-label="Dettagli di Cliente demo vendite"/);
  assert.match(html, /<p data-slot="next-step-code"[^>]*>XX-0007 · T-3<\/p>/);
});

test("(revisione) una persona nuova: l'invito come Analista, con l'e-mail ripulita; la voce solo a chi può invitare", async () => {
  const sent: Array<{ ws: string; email: unknown; role: unknown }> = [];
  const fake = (async (ws: string, _prev: unknown, form: FormData) => {
    sent.push({ ws, email: form.get("email"), role: form.get("role") });
    return { ok: true, message: "Link creato.", fieldErrors: {}, data: { inviteUrl: "https://esempio.test/invite/abc" } };
  }) as never;
  assert.deepEqual(await inviteNewBuilder(WS, "  nuova@cliente.test ", fake), { ok: true, url: "https://esempio.test/invite/abc" });
  assert.deepEqual(sent, [{ ws: WS, email: "nuova@cliente.test", role: "analyst" }]);
  const refused = (async () => ({ ok: false, message: "Controlla i campi evidenziati.", fieldErrors: { email: "Email non valida." } })) as never;
  assert.deepEqual(await inviteNewBuilder(WS, "x", refused), { ok: false, error: "Email non valida." });
  const broken = (async () => {
    throw new Error("rete");
  }) as never;
  assert.deepEqual(await inviteNewBuilder(WS, "x@y.test", broken), { ok: false, error: FACTORY_TEXT.builders.inviteFailed });
  const candidates = [{ userId: "u2", name: "Altra Persona", isLateralSpace: false, blocked: null }];
  const values = (canInvite: boolean) => builderPersonGroups({ candidates, canInvite }).flatMap((g) => g.options.map((o) => o.value));
  assert.ok(values(true).includes(NEW_PERSON));
  assert.ok(!values(false).includes(NEW_PERSON), "senza il permesso di invitare la voce non c'è");
  assert.match(FACTORY_TEXT.builders.emailHint, /da mandare tu/, "Unbundle non manda l'invito: lo dice");
});
