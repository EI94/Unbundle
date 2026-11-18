import test from "node:test";
import assert from "node:assert/strict";
import type { ValueParts } from "./format.ts";
import { buildLanes, PANORAMA_SECTION_ID } from "./lanes.ts";
import { buildNeedsBoard, needsSummaryPieces, type NeedView } from "./needs.ts";
import {
  OVERVIEW_STEP_KEYS,
  OVERVIEW_STEP_TARGET,
  SAL_EVERY_DAYS,
  WORKSPACE_STEP_KEYS,
  addDays,
  nextSalFrom,
  overviewFigures,
  overviewSteps,
  portfolioLine,
  salDue,
  workspaceNextStep,
  workspaceSteps,
  type WorkspaceStepInput,
} from "./panoramica.ts";
import type { ContributorUseCase, UseCaseViewer } from "./permissions.ts";
import type { CostFigure } from "./valuation.ts";
import type { RoadmapValue } from "./value-charts.ts";
import { DEFAULT_VALUE_PARAMS, type MonthCode } from "./value-model.ts";
import { applyHubFilters, hasActiveFilters, parseHubParams, pendingValueTotal, roadmapTotals, type HubItem } from "./views.ts";

// La testa della Panoramica (rilascio «Panoramica»): fasi, cifre, «Su tutto il portafoglio» e
// «Prossimo passo». Dati inventati: codici XX-0000.

const TODAY = "2026-10-29"; // T4 2026

let seq = 0;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const NO_VALUE: ValueParts = { score: null, word: null, source: null, perYear: null, benefits: null };
const counted = (amount: number, pendingEur = 0): ValueParts => ({
  ...NO_VALUE,
  perYear: { amount, source: "team" },
  benefits: pendingEur ? { state: "contato", benefitEur: amount, pendingEur, hours: 0 } : null,
});
const pending = (pendingEur: number): ValueParts => ({ ...NO_VALUE, benefits: { state: "da_misurare", benefitEur: 0, pendingEur, hours: 0 } });
const TEAM_30K: CostFigure = { source: "team_importo", amount: 30_000, band: 2, fromBand: false, position: 2, referenceEur: 30_000 };

/** Una scheda dei revisori con i soli campi che la testa legge (corsie, `roadmapTotals`, `decideCount`). */
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

const toDecide = (o: Partial<HubItem> = {}) => hub({ phase: "da_valutare", subState: "nuova", phaseLabel: "Da valutare · Nuova", quando: null, targetQuarter: null, ...o });

const contributor = (o: Partial<ContributorUseCase> & { title: string }): ContributorUseCase =>
  ({ id: uuid(8000 + (seq += 1)), phase: "approvato", subState: "trimestre", phaseLabel: "Approvato · T4 2026", quando: "T4 2026", own: false, ...o }) as ContributorUseCase;

function need(o: Partial<NeedView> = {}): NeedView {
  seq += 1;
  return {
    id: uuid(5000 + seq),
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

// ─── Fasi ────────────────────────────────────────────────────────────

test("fasi: «Da decidere» con il numero del selettore, poi approvati, in realizzazione e realizzati (anche «diffusa»)", () => {
  const items = [
    hub(),
    hub({ targetQuarter: "2027-Q1" }),
    hub({ targetQuarter: "2026-Q3" }),
    hub({ phase: "in_realizzazione", subState: "senza_dossier" }),
    hub({ phase: "realizzato", subState: "realizzato" }),
    hub({ phase: "realizzato", subState: "diffusa" }),
    toDecide(),
    hub({ phase: "chiuso", subState: "non_avviato" }),
  ];
  assert.deepEqual(overviewSteps(items, { reviewer: true, decide: 4 }), [
    { key: "da_decidere", count: 4 },
    { key: "approvati", count: 3 },
    { key: "in_realizzazione", count: 1 },
    { key: "realizzati", count: 2 },
  ]);
  // «Approvati» è quanti stanno nelle tre corsie, scaduti compresi.
  const lanes = buildLanes(items, TODAY).lanes.reduce((sum, lane) => sum + lane.entries.length, 0);
  assert.equal(lanes, 3);
  assert.deepEqual(overviewSteps([], { reviewer: true, decide: 0 }).map((step) => step.count), [0, 0, 0, 0]);
});

test("fasi del contributore: «In valutazione» senza numero, le altre fasi contate sulla sua proiezione", () => {
  const items = [contributor({ title: "Alfa" }), contributor({ title: "Beta", phase: "realizzato", subState: "diffusa" }), contributor({ title: "Gamma", phase: "da_valutare" })];
  assert.deepEqual(overviewSteps(items, { reviewer: false, decide: 0 }), [
    { key: "da_decidere", count: null },
    { key: "approvati", count: 1 },
    { key: "in_realizzazione", count: 0 },
    { key: "realizzati", count: 1 },
  ]);
  assert.deepEqual([...OVERVIEW_STEP_KEYS], ["da_decidere", "approvati", "in_realizzazione", "realizzati"]);
  // Le ancore sono quelle delle sezioni della Panoramica.
  assert.deepEqual(OVERVIEW_STEP_TARGET, {
    approvati: PANORAMA_SECTION_ID.approvati,
    in_realizzazione: PANORAMA_SECTION_ID.inRealizzazione,
    realizzati: PANORAMA_SECTION_ID.realizzati,
  });
  assert.ok(Object.isFrozen(OVERVIEW_STEP_TARGET));
});

// ─── Cifre ───────────────────────────────────────────────────────────

test("cifre: valore e costo di `roadmapTotals`, gli use case della corsia di questo trimestre (scaduti compresi), «fino a»", () => {
  const items = [
    hub({ value: counted(12_250), cost: TEAM_30K }),
    hub({ targetQuarter: "2026-Q3", value: pending(5_840) }),
    hub({ targetQuarter: "2027-Q1", value: counted(5_000, 1_000) }),
    hub({ phase: "in_realizzazione", subState: "senza_dossier", targetQuarter: "2026-Q4", value: pending(2_000), cost: TEAM_30K }),
    hub({ phase: "realizzato", subState: "realizzato", value: counted(9_000) }),
    toDecide({ value: counted(50_000) }),
  ];
  const figures = overviewFigures(items, TODAY);
  assert.ok(figures);
  const totals = roadmapTotals(items);
  assert.deepEqual(figures.value, totals.expectedValue);
  assert.deepEqual(figures.cost, totals.committedCost);
  assert.equal(figures.value?.amountEur, 17_250);
  // «costo di avvio» è l'avvio delle card «Da costruire» delle corsie: quello in realizzazione, che ha
  // lo stesso costo ma nessun «avvio» sulla sua card, resta fuori.
  const lanesView = buildLanes(items, TODAY);
  const laneStartEur = lanesView.lanes.flatMap((lane) => lane.entries).reduce((sum, entry) => sum + (entry.item.kind === "da_costruire" ? (entry.item.cost?.referenceEur ?? 0) : 0), 0);
  assert.equal(lanesView.inProgress.filter((item) => item.cost).length, 1, "in realizzazione con un costo");
  assert.deepEqual([figures.cost?.amountEur, figures.cost?.note], [laneStartEur, "su 1 use case"]);
  assert.equal(laneStartEur, 30_000);
  // La corsia: l'approvato del T4 e lo scaduto del T3; non quello già partito.
  assert.deepEqual(figures.quarter, { count: 2, quarter: "2026-Q4" });
  assert.equal(figures.quarter?.count, buildLanes(items, TODAY).lanes[0].entries.length);
  assert.deepEqual(figures.pending, pendingValueTotal(items));
  assert.deepEqual(figures.pending, { amountEur: 8_840, count: 3, note: "su 3 use case" });

  // Niente in questo trimestre: la cifra non c'è, le altre sì.
  const later = overviewFigures([hub({ targetQuarter: "2027-Q1", value: counted(1_000) })], TODAY);
  assert.equal(later?.quarter, null);
  assert.equal(later?.value?.amountEur, 1_000);
  // Con i centesimi: le corsie e «In realizzazione» fanno la cifra in testa, come le card la scrivono.
  const cents = [
    hub({ value: counted(1_000.5) }),
    hub({ value: counted(1_000.5) }),
    hub({ targetQuarter: "2027-Q1", value: counted(4_042.5) }),
    hub({ phase: "in_realizzazione", subState: "senza_dossier", value: counted(2_719.5) }),
  ];
  const centsLanes = buildLanes(cents, TODAY);
  assert.equal(overviewFigures(cents, TODAY)?.value?.amountEur, 1_001 + 1_001 + 4_043 + 2_720);
  assert.equal(
    centsLanes.lanes.reduce((sum, lane) => sum + (lane.countedEurYear ?? 0), 0) + (centsLanes.inProgressCountedEurYear ?? 0),
    overviewFigures(cents, TODAY)?.value?.amountEur,
  );
  // Senza cifre: null.
  assert.equal(overviewFigures([], TODAY), null);
  assert.equal(overviewFigures([toDecide(), hub({ phase: "realizzato", subState: "realizzato", value: counted(1) })], TODAY), null);
});

// ─── Su tutto il portafoglio ─────────────────────────────────────────

/** I soli campi di `buildRoadmapValue` che legge la riga. */
function value(o: { hours?: number[]; breakevenMonth?: MonthCode | null; breakevenText?: string | null; months?: MonthCode[] }): RoadmapValue {
  const hours = o.hours ?? [];
  return {
    cards: hours.map((h) => ({ hours: h })),
    hours: hours.reduce((sum, h) => sum + h, 0),
    curve: { months: o.months ?? ["2026-11", "2026-12"], net: [], breakeven: null, breakevenMonth: o.breakevenMonth ?? null },
    goLives: [],
    low: null,
    breakevenText: o.breakevenText ?? null,
  } as unknown as RoadmapValue;
}

test("«Su tutto il portafoglio»: le ore se qualcuna ne libera, il pareggio nel mese, «subito» o oltre l'ultimo mese", () => {
  assert.deepEqual(portfolioLine(value({ hours: [115.5, 62.4], breakevenMonth: "2027-04", breakevenText: "apr 27" })), {
    hours: 177.9,
    breakeven: { kind: "mese", month: "2027-04" },
  });
  assert.deepEqual(portfolioLine(value({ hours: [0], breakevenText: "subito" })), { hours: null, breakeven: { kind: "subito" } });
  assert.deepEqual(portfolioLine(value({ hours: [10], breakevenText: "oltre ott 28", months: ["2026-11", "2027-06", "2028-10"] })), {
    hours: 10,
    breakeven: { kind: "oltre", month: "2028-10" },
  });
  assert.deepEqual(portfolioLine(value({ hours: [12] })), { hours: 12, breakeven: null }, "solo le ore");
  assert.equal(portfolioLine(value({ hours: [0, 0] })), null);
  assert.equal(portfolioLine(null), null);
});

// ─── Prossimo passo del workspace (rilascio 10, D3) ──────────────────

/** Il passo con tutto acceso: l'ok sui fornitori, le esigenze, il SAL. */
function stepInput(o: Partial<WorkspaceStepInput> = {}): WorkspaceStepInput {
  return { items: [], needs: [], today: TODAY, suppliers: { authorized: true, canAuthorize: true }, sal: { lastOn: "2026-10-20", canClose: true }, ...o };
}

const keysOf = (i: WorkspaceStepInput) => workspaceSteps(i).map((step) => step.key);

test("D3: le cinque regole nell'ordine fornitori · decidere · chiedere · verificare · SAL", () => {
  assert.deepEqual(WORKSPACE_STEP_KEYS, ["fornitori", "decidere", "chiedere", "verificare", "sal"]);
  const current = hub();
  const items = [current, toDecide({ waitingSince: "2026-10-20" }), toDecide({ waitingSince: "2026-10-26" })];
  const needs = [need({ useCaseIds: [current.id] }), need({ status: "in_verifica", useCaseIds: [current.id] })];
  const all = stepInput({ items, needs, suppliers: { authorized: false, canAuthorize: true }, sal: { lastOn: "2026-09-01", canClose: true } });
  assert.deepEqual(keysOf(all), ["fornitori", "decidere", "chiedere", "verificare", "sal"]);
  assert.equal(workspaceNextStep(all)?.key, "fornitori", "prima ciò che blocca altre persone");
  // Tolto un passo, il successivo sale: la regola non cambia ordine.
  assert.deepEqual(keysOf({ ...all, suppliers: { authorized: true, canAuthorize: true } }), ["decidere", "chiedere", "verificare", "sal"]);
  assert.deepEqual(keysOf({ ...all, suppliers: null, items: [current] }), ["chiedere", "verificare", "sal"]);
  assert.deepEqual(keysOf({ ...all, suppliers: null, items: [current], needs: [need({ status: "in_verifica", useCaseIds: [current.id] })] }), ["verificare", "sal"]);
  assert.deepEqual(keysOf({ ...all, suppliers: null, items: [current], needs: [] }), ["sal"]);
  // Niente da fare: «Tutto in ordine».
  assert.equal(workspaceNextStep(stepInput({ items: [current], sal: { lastOn: TODAY, canClose: true } })), null);
  assert.deepEqual(workspaceSteps(stepInput()), []);
});

test("D3 · fornitori: solo se manca l'ok e ci sono informazioni da chiedere, che l'ok tiene ferme", () => {
  const current = hub();
  const later = hub({ targetQuarter: "2027-Q2" });
  const missing = { authorized: false, canAuthorize: true };
  // Un'informazione da chiedere di un altro trimestre: anche lei aspetta l'ok.
  assert.deepEqual(workspaceSteps(stepInput({ items: [later], needs: [need({ useCaseIds: [later.id] })], suppliers: missing, sal: null }))[0], { key: "fornitori", mine: true, waiting: 1 });
  // Niente da chiedere (solo in attesa o da verificare): l'ok non ferma nessuno, nessun passo.
  assert.deepEqual(keysOf(stepInput({ items: [current], needs: [need({ status: "chiesta", useCaseIds: [current.id] })], suppliers: missing, sal: null })), []);
  // Chi non può dare l'ok: lo stato, non il pulsante.
  assert.deepEqual(workspaceNextStep(stepInput({ items: [current], needs: [need({ useCaseIds: [current.id] })], suppliers: { authorized: false, canAuthorize: false }, sal: null })), { key: "fornitori", mine: false, waiting: 1 });
  // L'ok c'è, la funzione è spenta o le esigenze non si leggono: la regola non vale.
  for (const o of [{ suppliers: { authorized: true, canAuthorize: false } }, { suppliers: null }, { needs: null }]) {
    assert.notEqual(workspaceNextStep(stepInput({ items: [current], needs: [need({ useCaseIds: [current.id] })], sal: null, ...o }))?.key, "fornitori", JSON.stringify(o));
  }
});

test("D3 · decidere: gli use case che aspettano una decisione, «Serve info» no, con i giorni del più vecchio", () => {
  const items = [toDecide({ waitingSince: "2026-10-20" }), toDecide({ waitingSince: "2026-10-27" }), toDecide({ subState: "serve_info", waitingSince: "2026-09-01" }), hub()];
  assert.deepEqual(workspaceNextStep(stepInput({ items, sal: null })), { key: "decidere", mine: true, count: 2, oldestDays: 9 });
  assert.deepEqual(workspaceNextStep(stepInput({ items: [toDecide({ waitingSince: TODAY })], sal: null })), { key: "decidere", mine: true, count: 1, oldestDays: 0 });
});

test("D3 · chiedere: le informazioni da chiedere degli approvati di questo trimestre, ognuna una volta", () => {
  const a = hub();
  const b = hub();
  const started = hub({ phase: "in_realizzazione", subState: "senza_dossier", targetQuarter: "2026-Q4" });
  const next = hub({ targetQuarter: "2027-Q1" });
  const overdue = hub({ targetQuarter: "2026-Q3" });
  const items = [a, b, started, next, overdue];
  const needs = [
    need({ useCaseIds: [a.id, b.id] }),
    need({ status: "mancante", useCaseIds: [b.id.toUpperCase()] }),
    // Già partito, del trimestre dopo, scaduto: non contano.
    need({ useCaseIds: [started.id] }),
    need({ useCaseIds: [next.id] }),
    need({ useCaseIds: [overdue.id] }),
    // Né i passi, né le archiviate, né quelle ferme, a posto o in attesa.
    need({ type: "passo", status: "proposta", useCaseIds: [a.id] }),
    need({ archivedAt: "2026-10-20T10:00:00.000Z", useCaseIds: [a.id] }),
    need({ status: "bloccata", useCaseIds: [a.id] }),
    need({ status: "validata", useCaseIds: [a.id] }),
    need({ status: "chiesta", useCaseIds: [a.id] }),
  ];
  assert.deepEqual(workspaceNextStep(stepInput({ items, needs, suppliers: null, sal: null })), { key: "chiedere", mine: true, count: 2, quarter: "2026-Q4" });
  // Senza esigenze lette: la regola non vale.
  assert.equal(workspaceNextStep(stepInput({ items, needs: null, suppliers: null, sal: null })), null);
  // A gennaio il T4 2026 è scaduto: le sue informazioni non sono più «per il trimestre».
  assert.equal(workspaceNextStep(stepInput({ items: [a], needs: [need({ useCaseIds: [a.id] })], today: "2027-01-05", suppliers: null, sal: null })), null);
});

test("D3 · verificare: le risposte da verificare in tutto il workspace, ognuna una volta", () => {
  const a = hub();
  const later = hub({ targetQuarter: "2027-Q2" });
  const shared = need({ status: "in_verifica", useCaseIds: [a.id, later.id] });
  const needs = [shared, { ...shared }, need({ status: "in_verifica", useCaseIds: [later.id] }), need({ status: "in_verifica", useCaseIds: [] }), need({ status: "in_verifica", archivedAt: "2026-10-01T10:00:00.000Z" })];
  assert.deepEqual(workspaceNextStep(stepInput({ items: [a, later], needs, suppliers: null, sal: null })), { key: "verificare", mine: true, count: 3 });
});

test("D3 · SAL: il primo appena il Programma ha uno use case, poi ogni 28 giorni; lo chiude chi gestisce", () => {
  assert.equal(SAL_EVERY_DAYS, 28);
  const approved = hub();
  // Il primo SAL: dovuto con uno use case approvato, in realizzazione o realizzato; non con soli da valutare.
  assert.deepEqual(workspaceNextStep(stepInput({ items: [approved], sal: { lastOn: null, canClose: true } })), { key: "sal", mine: true, first: true, lastOn: null, days: null });
  assert.equal(workspaceNextStep(stepInput({ items: [hub({ phase: "da_valutare", subState: "rimandata" })], sal: { lastOn: null, canClose: true } })), null);
  assert.equal(salDue(null, TODAY, []), false);
  // Dal 28° giorno dopo l'ultimo.
  assert.equal(salDue("2026-10-01", TODAY, [approved]), true, "dal 1° al 29 ottobre: 28 giorni");
  assert.equal(salDue("2026-10-02", TODAY, [approved]), false, "27 giorni");
  assert.equal(salDue("2026-09-01", TODAY, []), true, "dopo il primo, il SAL è dovuto anche senza use case");
  assert.deepEqual(workspaceNextStep(stepInput({ items: [approved], sal: { lastOn: "2026-10-01", canClose: false } })), { key: "sal", mine: false, first: false, lastOn: "2026-10-01", days: 28 });
  // Senza Programma (area spenta, 0029 assente): nessun SAL.
  assert.equal(workspaceNextStep(stepInput({ items: [approved], sal: null })), null);
  // «ultimo il 3 novembre · prossimo dal 1° dicembre».
  assert.equal(nextSalFrom("2026-11-03"), "2026-12-01");
  assert.equal(nextSalFrom(null), null);
  assert.equal(addDays("2026-12-20", 28), "2027-01-17");
});

test("D3 e «Cosa serve», dove porta il pulsante: gli stessi numeri, contati allo stesso modo", () => {
  // La forma di un cliente in piccolo: informazioni di più use case del trimestre, uno già partito, uno del
  // trimestre dopo, uno scaduto; ogni gruppo di stato, archiviate e passi.
  const a = hub({ title: "LIBRA L1 · Lettura dei documenti esteri" });
  const b = hub({ title: "SIRIO S3 · File F24 delle imposte locali" });
  const c = hub({ title: "AUTO X2 · Bonifici massivi" });
  const started = hub({ phase: "in_realizzazione", subState: "senza_dossier", targetQuarter: "2026-Q4" });
  const next = hub({ targetQuarter: "2027-Q1" });
  const overdue = hub({ targetQuarter: "2026-Q3" });
  const items = [a, b, c, started, next, overdue];
  const needs = [
    need({ useCaseIds: [a.id, b.id] }),
    need({ status: "mancante", useCaseIds: [c.id] }),
    need({ status: "parziale", useCaseIds: [a.id, next.id] }),
    need({ status: "chiesta", useCaseIds: [b.id] }),
    need({ status: "in_verifica", useCaseIds: [c.id] }),
    need({ status: "in_verifica", useCaseIds: [a.id, c.id] }),
    need({ status: "bloccata", useCaseIds: [b.id] }),
    need({ status: "validata", useCaseIds: [a.id] }),
    need({ status: "in_verifica", useCaseIds: [started.id] }),
    need({ status: "bloccata", useCaseIds: [next.id, overdue.id] }),
    need({ status: "bloccata", archivedAt: "2026-10-20T10:00:00.000Z", useCaseIds: [a.id] }),
    need({ type: "passo", status: "proposta", useCaseIds: [a.id] }),
  ];
  const steps = workspaceSteps(stepInput({ items, needs, suppliers: null, sal: null }));
  assert.deepEqual(steps.map((step) => step.key), ["chiedere", "verificare"]);
  const ask = steps[0];
  const verify = steps[1];
  assert.ok(ask.key === "chiedere" && verify.key === "verificare");
  // «Chiedi 3 informazioni» porta a «Cosa serve» del trimestre (`?vista=cosa-serve&trimestre=2026-Q4`), come la compone hub.tsx.
  const viewer: UseCaseViewer = { userId: uuid(9000), email: "persona.prova@cliente.test", emailVerified: true, role: "function_lead", isLateralSpace: false };
  const params = parseHubParams(new URLSearchParams("vista=cosa-serve&trimestre=2026-Q4"), viewer);
  assert.ok(hasActiveFilters(params));
  const filtered = applyHubFilters(items, params);
  const quarterBoard = buildNeedsBoard(needs, items, { today: TODAY, params: DEFAULT_VALUE_PARAMS, only: { useCaseIds: new Set(filtered.map((item) => item.id.toLowerCase())), q: params.q } });
  assert.equal(ask.count, quarterBoard.counts.toAsk);
  assert.equal(ask.count, 3);
  // «Verifica 3 risposte» porta a «Cosa serve» senza filtri: la sua riga dei conteggi dice lo stesso numero.
  const board = buildNeedsBoard(needs, items, { today: TODAY, params: DEFAULT_VALUE_PARAMS });
  assert.equal(verify.count, board.counts.toVerify);
  assert.ok(needsSummaryPieces(board.counts).includes("3 da verificare"), needsSummaryPieces(board.counts).join(" · "));
});
