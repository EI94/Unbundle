import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbidden } from "../use-cases/copy-guard.ts";
import type { NeedView } from "../use-cases/needs.ts";
import type { WorkspaceStep } from "../use-cases/panoramica.ts";
import type { ContributorUseCase } from "../use-cases/permissions.ts";
import { DEFAULT_VALUE_PARAMS } from "../use-cases/value-model.ts";
import type { HubItem } from "../use-cases/views.ts";
import { NO_PROGRAM_COSTS } from "../programma/curve.ts";
import { buildProgramView, type ProgramInput, type ProgramView } from "../programma/view.ts";
import { workspaceStepHref, workspaceStepView, type StepView } from "./next-step.ts";
import { startChecklist, type StartFacts } from "./start.ts";
import { HOME_TEXT, atPct, dayMonth, startOrdinal, turnTo } from "./text.ts";
import { CONTRIBUTOR_ROWS_SHOWN, contributorRows, courseRows, homeBigNumber, homeRows, keyResultsProgress, reviewerHome, countUseCases, type ReviewerHomeInput } from "./view.ts";

// La Home (rilascio 10, ondata 2b; docs/ui-10/PROPOSTA-10.md §3.3, prototipo S1, S1b, S1c) come oggetto già deciso:
// il prossimo passo (D3 e «Per partire»), il numero grande, le quattro righe, i propri use case. Dati inventati (codici
// XX-00NN, «Cliente Demo»), come §9.1 della proposta.

const WS = "11111111-1111-4111-8111-111111111111";
const TODAY = "2026-11-18"; // T4 2026
const BASE = `/dashboard/${WS}`;
const LINKS = { workspaceId: WS, companyName: "Cliente Demo", salHref: null };

let seq = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function hub(o: Partial<HubItem> = {}): HubItem {
  seq += 1;
  return {
    id: uuid(seq),
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
const toDecide = (waitingSince: string) => hub({ waitingSince: waitingSince as HubItem["waitingSince"], phase: "da_valutare", subState: "nuova", phaseLabel: "Da valutare · Nuova", quando: null, targetQuarter: null });

function need(o: Partial<NeedView> = {}): NeedView {
  seq += 1;
  return {
    id: uuid(5000 + seq),
    type: "requisito",
    kind: "altro",
    title: `Informazione ${seq}`,
    detail: null,
    ownerLabel: null,
    ownerSide: null,
    status: "da_chiedere",
    availability: null,
    dueOn: null,
    dueLabel: null,
    dueIsProposal: false,
    forLabel: null,
    sortOrder: 0,
    version: 1,
    importKey: null,
    createdAt: "2026-10-01T10:00:00.000Z",
    updatedAt: "2026-10-01T10:00:00.000Z",
    doneAt: null,
    archivedAt: null,
    archiveReason: null,
    useCaseIds: [],
    ...o,
  };
}

/** Il workspace di §9.1: 24 use case (4 da valutare, 16 approvati, 3 in realizzazione, 1 in uso). */
function demoItems(): { items: HubItem[]; quarter: HubItem[] } {
  const decide = [toDecide("2026-11-09"), toDecide("2026-11-12"), toDecide("2026-11-15"), toDecide("2026-11-17")];
  const quarter = Array.from({ length: 5 }, () => hub());
  const next = Array.from({ length: 7 }, () => hub({ targetQuarter: "2027-Q1", phaseLabel: "Approvato · T1 2027", quando: "T1 2027" }));
  const later = Array.from({ length: 4 }, () => hub({ targetQuarter: null, subState: "piu_avanti", phaseLabel: "Approvato · Più avanti", quando: "Più avanti" }));
  const building = Array.from({ length: 3 }, () => hub({ phase: "in_realizzazione", subState: "dossier", phaseLabel: "In realizzazione" }));
  const inUse = [hub({ phase: "realizzato", subState: "realizzato", phaseLabel: "Realizzato" })];
  return { items: [...decide, ...quarter, ...next, ...later, ...building, ...inUse], quarter };
}

/** Una pagina del Programma vera (`buildProgramView`), con i numeri di §9.1 sopra. */
function demoView(over: (view: ProgramView) => Partial<ProgramView> = () => ({})): ProgramView {
  const input: ProgramInput = {
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
  };
  const view = buildProgramView(input);
  const krs = [100, 80, 60, null, null].map((progress, i) => ({ id: `kr${i}`, title: `Risultato ${i}`, unit: "%", direction: "increase" as const, base: 0, now: 0, target: 100, progress, checkins: [], useCases: [], kpi: null }));
  const base: ProgramView = {
    ...view,
    results: { ...view.results, estimated: 412_000, estimatedCount: 20, inUse: 38_000, inUseCount: 1 },
    objectives: [{ id: "o1", title: "Obiettivo", timeframe: null, goal: null, keyResults: krs }],
  };
  return { ...base, ...over(base) };
}

function reviewerInput(o: Partial<ReviewerHomeInput> = {}): ReviewerHomeInput {
  return { workspaceId: WS, companyName: "Cliente Demo", today: TODAY, isLateralSpace: true, defaultUnitTerm: true, items: [], needs: [], suppliers: { authorized: true, canAuthorize: true }, program: demoView(), start: null, ...o };
}

const NEW_FACTS: StartFacts = { discovery: true, notes: true, mappedUnits: 0, goals: 0, decided: 0, toDecide: 0 };

// ─── I testi ─────────────────────────────────────────────────────────

/** Ogni stringa del modulo, con le funzioni chiamate su valori di prova. */
function allTexts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    const out: unknown[] = [];
    for (const args of [[1, 1, 1], [12, 9, 3], ["2026-11-03", "2026-12-01"], ["2026-Q4" as unknown, 2]]) {
      try {
        out.push((value as (...a: unknown[]) => unknown)(...args));
      } catch {
        /* argomenti di un'altra forma */
      }
    }
    return out.flatMap(allTexts);
  }
  if (value && typeof value === "object") return Object.values(value).flatMap(allTexts);
  return [];
}

test("i testi della Home: «use case» e mai «caso d'uso», «proposta», codici o inglese di troppo", () => {
  const texts = allTexts(HOME_TEXT).filter((t) => typeof t === "string" && t.length > 0);
  assert.ok(texts.length > 60, `${texts.length} testi`);
  for (const t of texts) {
    assert.deepEqual(findHubForbidden(t, "area"), [], t);
    assert.doesNotMatch(t, /\bpropost[ae]\b|caso d['’]uso|Sub-responsabili|\bGoal\b|\bwave\b|Overview|Percorso/i, t);
  }
  assert.equal(HOME_TEXT.title, "Home");
  assert.equal(HOME_TEXT.rows.sal, "SAL (stato di avanzamento)", "la prima volta in pagina, per esteso");
});

test("le date e «Tocca a»: «1° dicembre», «Tocca ad Azienda Prova.»", () => {
  assert.equal(dayMonth("2026-11-03"), "3 novembre");
  assert.equal(dayMonth("2026-12-01"), "1° dicembre");
  assert.equal(turnTo("Cliente Demo"), "Tocca a Cliente Demo.");
  assert.equal(turnTo("  Azienda   Prova "), "Tocca ad Azienda Prova.");
  assert.deepEqual([0, 1, 2, 3, 4].map(startOrdinal), ["primo", "secondo", "terzo", "quarto", "quinto"]);
});

// ─── Il prossimo passo (D3) ──────────────────────────────────────────

const DECIDE: WorkspaceStep = { key: "decidere", mine: true, count: 4, oldestDays: 9 };
const ASK: WorkspaceStep = { key: "chiedere", mine: true, count: 12, quarter: "2026-Q4" };

test("il passo del workspace: il verbo, l'icona e il «?» con il passo dopo (prototipo S1)", () => {
  assert.deepEqual(workspaceStepView([DECIDE, ASK], LINKS), {
    key: "decidere",
    icon: "decidi",
    label: "Decidi 4 use case",
    why: "Il più vecchio aspetta da 9 giorni. Poi: 12 informazioni da chiedere per il T4 2026.",
    mine: true,
    turn: null,
    href: `${BASE}/use-cases?vista=da-decidere`,
    panel: null,
  });
  assert.equal(workspaceStepView([], LINKS), null, "«Tutto in ordine»");
  const one = workspaceStepView([{ key: "decidere", mine: true, count: 1, oldestDays: 1 }], LINKS);
  assert.deepEqual([one?.label, one?.why], ["Decidi 1 use case", "Aspetta da 1 giorno."]);
  assert.equal(workspaceStepView([{ key: "decidere", mine: true, count: 2, oldestDays: 0 }], LINKS)?.why, "Il più vecchio è arrivato oggi.");
});

test("il passo del workspace: ogni regola con le sue parole e il suo indirizzo", () => {
  const view = (step: WorkspaceStep, then?: WorkspaceStep): StepView => workspaceStepView(then ? [step, then] : [step], LINKS)!;
  const suppliers = view({ key: "fornitori", mine: true, waiting: 3 }, DECIDE);
  assert.deepEqual([suppliers.label, suppliers.icon, suppliers.href], ["Autorizza i fornitori", "fornitori", `${BASE}/settings#sub-responsabili`]);
  assert.equal(suppliers.why, "Senza l'ok le domande al referente non partono: 3 informazioni aspettano. Poi: 4 use case da decidere.");
  const waiting = view({ key: "fornitori", mine: false, waiting: 1 });
  assert.deepEqual([waiting.label, waiting.mine, waiting.turn], ["Manca l'ok sui fornitori", false, "Tocca a Cliente Demo."]);
  assert.equal(waiting.why, "Senza l'ok le domande al referente non partono: 1 informazione aspetta.");
  const ask = view(ASK, { key: "verificare", mine: true, count: 1 });
  // (D3) «Chiedi» e «Verifica» aprono «Cosa serve» sul loro stato: il pulsante pieno della vista è lo stesso passo.
  assert.deepEqual([ask.label, ask.href], ["Chiedi 12 informazioni", `${BASE}/use-cases?vista=cosa-serve&trimestre=2026-Q4&stato=da-chiedere`]);
  assert.equal(ask.why, "Servono agli use case del T4 2026 per partire. Poi: 1 risposta da verificare.");
  assert.equal(view({ key: "chiedere", mine: true, count: 1, quarter: "2027-Q1" }).label, "Chiedi 1 informazione");
  const verify = view({ key: "verificare", mine: true, count: 2 }, { key: "sal", mine: true, first: true, lastOn: null, days: null });
  assert.deepEqual([verify.label, verify.icon, verify.href], ["Verifica 2 risposte", "verifica", `${BASE}/use-cases?vista=cosa-serve&stato=da-verificare`]);
  assert.equal(verify.why, "I referenti hanno risposto: controlla le risposte prima di usarle. Poi: il SAL da chiudere.");
  // Sulla Home «Chiudi il SAL» apre il pannello del SAL; dalla Panoramica porta lì con `?apri=sal`.
  const sal = view({ key: "sal", mine: true, first: false, lastOn: "2026-10-20", days: 29 });
  assert.deepEqual([sal.label, sal.href, sal.panel, sal.why], ["Chiudi il SAL", null, "sal", "L'ultimo è del 20 ottobre, 29 giorni fa."]);
  const fromHub = workspaceStepView([{ key: "sal", mine: true, first: true, lastOn: null, days: null }], { ...LINKS, salHref: `${BASE}?apri=sal` })!;
  assert.deepEqual([fromHub.href, fromHub.panel, fromHub.why], [`${BASE}?apri=sal`, null, HOME_TEXT.steps.sal.whyFirst]);
  const salTurn = view({ key: "sal", mine: false, first: true, lastOn: null, days: null });
  assert.deepEqual([salTurn.label, salTurn.turn], ["SAL da chiudere", "Tocca a chi gestisce il workspace."]);
  assert.equal(workspaceStepHref(ASK, LINKS), `${BASE}/use-cases?vista=cosa-serve&trimestre=2026-Q4&stato=da-chiedere`);
});

// ─── «Per partire» ───────────────────────────────────────────────────

test("«Per partire» (S1b): cinque righe, «2 di 5», e la prima riga aperta è il pulsante pieno, «Mappa i processi»", () => {
  const start = startChecklist(NEW_FACTS, { workspaceId: WS, isLateralSpace: true, defaultUnitTerm: true })!;
  assert.deepEqual(start.rows.map((row) => [row.label, row.done]), [
    ["Racconta l'azienda", true],
    ["Aggiungi gli appunti delle prime call", true],
    ["Mappa i processi di una funzione", false],
    ["Scrivi gli obiettivi", false],
    ["Decidi i primi use case", false],
  ]);
  assert.deepEqual([start.done, start.total, HOME_TEXT.start.progress(start.done, start.total)], [2, 5, "2 di 5"]);
  assert.deepEqual(start.next, {
    key: "per-partire-processi",
    icon: "processi",
    label: "Mappa i processi",
    why: "È il terzo passo di «Per partire».",
    mine: true,
    turn: null,
    href: `${BASE}/mapping`,
    panel: null,
  });
  assert.deepEqual(start.rows.map((row) => row.href), [`${BASE}/setup/leadership`, `${BASE}/contesto?vista=appunti`, `${BASE}/mapping`, `${BASE}/strategy`, `${BASE}/use-cases`]);
});

test("«Per partire»: solo in un workspace nuovo; sparisce appena uno use case è deciso, anche con righe aperte", () => {
  const ctx = { workspaceId: WS, isLateralSpace: false, defaultUnitTerm: true };
  assert.equal(startChecklist({ ...NEW_FACTS, decided: 1 }, ctx), null);
  assert.equal(startChecklist({ discovery: false, notes: false, mappedUnits: 0, goals: 0, decided: 3, toDecide: 2 }, ctx), null, "un workspace che lavora senza Discovery non torna all'elenco");
  // Un revisore del cliente: gli appunti li aggiunge Lateral Space, il suo passo è la prima riga sua.
  const client = startChecklist({ discovery: true, notes: false, mappedUnits: 0, goals: 0, decided: 0, toDecide: 0 }, ctx)!;
  assert.deepEqual([client.rows[1].mine, client.next?.key, client.next?.why], [false, "per-partire-processi", "È il terzo passo di «Per partire»."]);
  const ls = startChecklist({ discovery: true, notes: false, mappedUnits: 0, goals: 0, decided: 0, toDecide: 0 }, { ...ctx, isLateralSpace: true })!;
  assert.deepEqual([ls.next?.key, ls.next?.label, ls.next?.why], ["per-partire-appunti", "Aggiungi gli appunti", "È il secondo passo di «Per partire»."]);
  // L'ultima riga: con use case da decidere porta a «Da decidere» e dice quanti.
  const last = startChecklist({ discovery: true, notes: true, mappedUnits: 2, goals: 3, decided: 0, toDecide: 4 }, ctx)!;
  assert.deepEqual([last.done, last.next?.label, last.next?.href], [4, "Decidi 4 use case", `${BASE}/use-cases?vista=da-decidere`]);
  // Un'altra parola per le unità («reparto»): la riga non nomina «funzione».
  const other = startChecklist(NEW_FACTS, { ...ctx, defaultUnitTerm: false })!;
  assert.equal(other.rows[2].label, "Mappa i processi");
});

// ─── La Home dei revisori ────────────────────────────────────────────

test("la Home dei revisori (S1): il passo D3, il numero grande e le quattro righe con i loro fatti", () => {
  const { items, quarter } = demoItems();
  const needs = Array.from({ length: 12 }, (_, i) => need({ useCaseIds: [quarter[i % quarter.length].id] }));
  const home = reviewerHome(reviewerInput({ items, needs }));
  assert.equal(home.start, null, "un workspace che lavora: niente «Per partire»");
  assert.deepEqual([home.step?.label, home.step?.why, home.step?.mine], ["Decidi 4 use case", "Il più vecchio aspetta da 9 giorni. Poi: 12 informazioni da chiedere per il T4 2026.", true]);
  assert.deepEqual(home.bigNumber, { value: "412.000 €", label: "Valore all'anno", note: "su 20 use case · in uso 38.000 €" });
  assert.deepEqual(
    home.rows.map((row) => [row.title, row.fact, row.panel]),
    [
      ["Iniziative", "24 use case · 3 in realizzazione · 1 in uso", "iniziative"],
      ["Persone", "38 formate su 120", "persone"],
      ["Obiettivi", "5 risultati chiave · in media all'80 %", "obiettivi"],
      ["SAL (stato di avanzamento)", "ultimo il 3 novembre · prossimo dal 1° dicembre", "sal"],
    ],
  );
});

test("la Home dei revisori: niente da fare è «Tutto in ordine»; l'ok sui fornitori viene prima di tutto", () => {
  const { items, quarter } = demoItems();
  const calm = reviewerHome(reviewerInput({ items: items.filter((item) => item.phase !== "da_valutare") }));
  assert.equal(calm.step, null);
  const blocked = reviewerHome(reviewerInput({ items, needs: [need({ useCaseIds: [quarter[0].id] })], suppliers: { authorized: false, canAuthorize: false } }));
  assert.deepEqual([blocked.step?.key, blocked.step?.mine, blocked.step?.turn], ["fornitori", false, "Tocca a Cliente Demo."]);
  // Il SAL dovuto, a chi lo chiude: il pulsante apre il pannello del SAL della Home.
  const due = reviewerHome(reviewerInput({ items: [hub()], program: demoView((v) => ({ sal: { ...v.sal, lastOn: "2026-10-20" } })) }));
  assert.deepEqual([due.step?.key, due.step?.panel, due.step?.href], ["sal", "sal", null]);
});

test("la Home di un workspace nuovo (S1b): «Per partire» al posto del numero grande, e le righe a zero non ci sono", () => {
  const empty = demoView((v) => ({
    results: { ...v.results, estimated: 0, estimatedCount: 0, inUse: 0, inUseCount: 0 },
    people: { ...v.people, training: null, levels: null },
    objectives: [],
    kpis: [],
    initiatives: [],
    sal: { lastOn: null, changes: [] },
    viewer: { ...v.viewer, canEdit: false },
  }));
  const home = reviewerHome(reviewerInput({ items: [], program: empty, start: NEW_FACTS }));
  assert.equal(home.bigNumber, null);
  assert.equal(home.start?.done, 2);
  assert.deepEqual([home.step?.label, home.step?.why], ["Mappa i processi", "È il terzo passo di «Per partire»."]);
  assert.deepEqual(home.rows, [], "le quattro righe, a zero, non ci sono");
});

test("le righe: lo zero non si dice, ma «Obiettivi» c'è per ogni revisore, anche per chi non cambia il Programma", () => {
  const counts = countUseCases([hub(), hub({ phase: "chiuso", subState: "archiviato" }), hub({ phase: "in_realizzazione" })]);
  assert.deepEqual(counts, { total: 2, inProgress: 1, inUse: 0 });
  assert.equal(HOME_TEXT.facts.initiatives(2, 1, 0), "2 use case · 1 in realizzazione");
  assert.equal(HOME_TEXT.facts.initiatives(1, 0, 0), "1 use case");
  const none = demoView((v) => ({ objectives: [], kpis: [], sal: { lastOn: null, changes: [] }, people: { ...v.people, training: null, levels: null } }));
  const rows = homeRows(none, counts);
  assert.deepEqual(rows.map((row) => [row.key, row.fact]), [
    ["iniziative", "2 use case · 1 in realizzazione"],
    ["obiettivi", "Scrivi gli obiettivi"],
    ["sal", "il primo da chiudere"],
  ]);
  // Un revisore del cliente che non gestisce il workspace (function_lead, analyst) non cambia il Programma, ma gli
  // obiettivi li scrive (`/strategy`): senza la riga non avrebbe più una strada per arrivarci.
  const reader = homeRows(demoView(() => ({ objectives: [], kpis: [], viewer: { isLateralSpace: false, canEdit: false } })), counts);
  assert.deepEqual(reader.find((row) => row.key === "obiettivi"), { key: "obiettivi", title: "Obiettivi", fact: "Scrivi gli obiettivi", panel: "obiettivi" });
  assert.equal(HOME_TEXT.facts.writeGoals, HOME_TEXT.start.rows.obiettivi, "le parole di «Per partire»");
  // In un workspace nuovo «Per partire» ha già «Scrivi gli obiettivi»: da fare, la Home non la ripete; fatta, la riga
  // dice che cosa manca. Con risultati chiave o KPI, la riga è quella di sempre.
  const ctx = { workspaceId: WS, isLateralSpace: false, defaultUnitTerm: true };
  const open = startChecklist(NEW_FACTS, ctx);
  const written = startChecklist({ ...NEW_FACTS, goals: 2 }, ctx);
  assert.ok(!homeRows(none, counts, open).some((row) => row.key === "obiettivi"), "una riga sola per lo stesso passo");
  assert.equal(homeRows(none, counts, written).find((row) => row.key === "obiettivi")?.fact, "Aggiungi i risultati chiave");
  assert.equal(homeRows(demoView(), counts, open).find((row) => row.key === "obiettivi")?.fact, "5 risultati chiave · in media all'80 %");
  const oneKpi = demoView(() => ({ objectives: [], kpis: [{ id: "kpi-1" } as ProgramView["kpis"][number]] }));
  assert.equal(homeRows(oneKpi, counts, open).find((row) => row.key === "obiettivi")?.fact, "1 KPI");
  // Anche dalla Home intera: un revisore che non cambia il Programma, in un workspace che lavora, ha la riga.
  const home = reviewerHome(reviewerInput({ items: [hub()], program: demoView(() => ({ objectives: [], kpis: [], viewer: { isLateralSpace: false, canEdit: false } })) }));
  assert.ok(home.rows.some((row) => row.key === "obiettivi" && row.fact === "Scrivi gli obiettivi"));
  assert.deepEqual(keyResultsProgress([]), { total: 0, averagePct: null });
  assert.equal(HOME_TEXT.facts.keyResults(1, 42.4), "1 risultato chiave · al 42 %");
  assert.deepEqual([1, 8, 11, 42, 80, 89, 100].map(atPct), ["all'1 %", "all'8 %", "all'11 %", "al 42 %", "all'80 %", "all'89 %", "al 100 %"]);
  assert.equal(HOME_TEXT.facts.trained(1, null), "1 formata");
  assert.equal(homeBigNumber({ results: { ...none.results, estimated: 0 } }), null, "lo zero non si mostra");
  assert.deepEqual(homeBigNumber({ results: { ...none.results, estimated: 5_000, estimatedCount: 1, inUse: 0, inUseCount: 0 } }), { value: "5.000 €", label: "Valore all'anno", note: "su 1 use case" });
});

test("(rilascio 10) «Persone» c'è anche con la sola «Chi propone, per area», che prima stava sulla Panoramica", () => {
  const counts = countUseCases([hub()]);
  const participation = { rows: [{ label: "Amministrazione", count: 4, bestPractices: 1 }, { label: "Vendite", count: 2, bestPractices: 0 }], companies: [] };
  const none = demoView((v) => ({ people: { ...v.people, training: null, levels: null } }));
  // Senza formazione né AI Readiness la riga non c'era; con chi propone c'è, con quanti use case e quante aree.
  assert.ok(!homeRows(none, counts).some((row) => row.key === "persone"));
  assert.deepEqual(homeRows(none, counts, null, participation).find((row) => row.key === "persone"), { key: "persone", title: "Persone", fact: "6 use case da 2 aree", panel: "persone" });
  assert.equal(HOME_TEXT.facts.byArea(1, 1), "1 use case da 1 area");
  // Con la formazione la riga dice la formazione, come prima.
  assert.equal(homeRows(demoView(), counts, null, participation).find((row) => row.key === "persone")?.fact, homeRows(demoView(), counts).find((row) => row.key === "persone")?.fact);
  // Senza righe nessuna riga in più; anche dalla Home intera.
  assert.ok(!homeRows(none, counts, null, { rows: [], companies: [] }).some((row) => row.key === "persone"));
  assert.ok(reviewerHome(reviewerInput({ items: [hub()], program: none, participation })).rows.some((row) => row.key === "persone"));
  assert.equal(HOME_TEXT.panels.pendingFact(23_400, 9), "fino a 23.400 € · su 9 use case");
  assert.equal(HOME_TEXT.panels.pendingFact(500, 1), "fino a 500 € · su 1 use case");
});

test("senza il Programma (0029 assente) o con l'area spenta: il passo resta, il numero e le righe no", () => {
  const home = reviewerHome(reviewerInput({ items: [toDecide("2026-11-15")], program: null }));
  assert.deepEqual([home.step?.label, home.bigNumber, home.rows], ["Decidi 1 use case", null, []]);
  const off = reviewerHome(reviewerInput({ items: [], needs: null, suppliers: null, program: null, start: NEW_FACTS }));
  assert.equal(off.step?.label, "Mappa i processi");
});

// ─── La Home dei contributori ────────────────────────────────────────

const own = (o: Partial<ContributorUseCase> & { title: string }): ContributorUseCase =>
  ({ id: uuid(8000 + (seq += 1)), phase: "da_valutare", subState: "nuova", phaseLabel: "Da valutare · Nuova", quando: null, own: true, code: `XX-00${seq}`, publicNote: null, ...o }) as ContributorUseCase;

test("«I tuoi use case» (S1c): solo i propri, prima i vivi e i chiusi in fondo, con codice, fase e scheda", () => {
  const closed = own({ title: "Archivio offerte", code: "XX-0009", phase: "chiuso", subState: "doppione", phaseLabel: "Chiuso · Doppione" });
  const approved = own({ title: "Ordini ai fornitori", code: "XX-0021", phase: "approvato", subState: "trimestre", phaseLabel: "Approvato · T4 2026" });
  const fresh = own({ title: "Controllo note spese", code: "XX-0034" });
  const others = { id: uuid(9999), title: "Di un collega", phase: "approvato", subState: "trimestre", phaseLabel: "Approvato · T4 2026", quando: "T4 2026", own: false } as ContributorUseCase;
  const rows = contributorRows([closed, others, approved, fresh], WS);
  assert.deepEqual(rows.map((row) => [row.code, row.title, row.phaseLabel]), [
    ["XX-0034", "Controllo note spese", "Da valutare · Nuova"],
    ["XX-0021", "Ordini ai fornitori", "Approvato · T4 2026"],
    ["XX-0009", "Archivio offerte", "Chiuso · Doppione"],
  ]);
  assert.equal(rows[0].href, `${BASE}/use-cases/${fresh.id}`);
  assert.ok(!JSON.stringify(rows).includes("Di un collega"), "mai quelli degli altri");
  assert.equal(CONTRIBUTOR_ROWS_SHOWN, 3);
  assert.equal(HOME_TEXT.contributor.mine(3), "I tuoi use case (3)");
  assert.equal(HOME_TEXT.contributor.propose, "Proponi un use case");
  assert.equal(HOME_TEXT.contributor.byArea, "Chi propone, per area");
});

test("la card del corso: i corsi che si seguono, non quelli che si gestiscono soltanto", () => {
  const rows = courseRows(
    [
      { id: "p1", title: "Corso di prova", canParticipate: true },
      { id: "p2", title: "Corso gestito", canParticipate: false },
    ],
    WS,
  );
  assert.deepEqual(rows, [{ id: "p1", title: "Corso di prova", href: `${BASE}/learning/p1` }]);
});
