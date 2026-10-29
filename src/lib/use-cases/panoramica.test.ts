import test from "node:test";
import assert from "node:assert/strict";
import type { ValueParts } from "./format.ts";
import { buildLanes, PANORAMA_SECTION_ID } from "./lanes.ts";
import { buildNeedsBoard, needsSummaryPieces, type NeedView } from "./needs.ts";
import {
  OVERVIEW_STEP_KEYS,
  OVERVIEW_STEP_TARGET,
  overviewFigures,
  overviewNextStep,
  overviewSteps,
  portfolioLine,
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
  // La corsia: l'approvato del T4 e lo scaduto del T3; non quello già partito.
  assert.deepEqual(figures.quarter, { count: 2, quarter: "2026-Q4" });
  assert.equal(figures.quarter?.count, buildLanes(items, TODAY).lanes[0].entries.length);
  assert.deepEqual(figures.pending, pendingValueTotal(items));
  assert.deepEqual(figures.pending, { amountEur: 8_840, count: 3, note: "su 3 use case" });

  // Niente in questo trimestre: la cifra non c'è, le altre sì.
  const later = overviewFigures([hub({ targetQuarter: "2027-Q1", value: counted(1_000) })], TODAY);
  assert.equal(later?.quarter, null);
  assert.equal(later?.value?.amountEur, 1_000);
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

// ─── Prossimo passo ──────────────────────────────────────────────────

test("prossimo passo: i requisiti degli approvati di questo trimestre prima delle decisioni, ognuno una volta", () => {
  const a = hub();
  const b = hub();
  const started = hub({ phase: "in_realizzazione", subState: "senza_dossier", targetQuarter: "2026-Q4" });
  const next = hub({ targetQuarter: "2027-Q1" });
  const overdue = hub({ targetQuarter: "2026-Q3" });
  const items = [a, b, started, next, overdue, toDecide(), toDecide()];
  const needs = [
    // Per i due use case del trimestre: una volta sola.
    need({ useCaseIds: [a.id, b.id] }),
    need({ status: "bloccata", useCaseIds: [b.id.toUpperCase()] }),
    // Già partito, del trimestre dopo, scaduto: non contano.
    need({ useCaseIds: [started.id] }),
    need({ status: "bloccata", useCaseIds: [next.id] }),
    need({ useCaseIds: [overdue.id] }),
    // Né i passi, né le archiviate, né quelle a posto o in attesa.
    need({ type: "passo", status: "proposta", useCaseIds: [a.id] }),
    need({ status: "bloccata", archivedAt: "2026-10-20T10:00:00.000Z", useCaseIds: [a.id] }),
    need({ status: "validata", useCaseIds: [a.id] }),
    need({ status: "chiesta", useCaseIds: [a.id] }),
  ];
  assert.deepEqual(overviewNextStep({ items, needs, today: TODAY }), { kind: "requisiti", quarter: "2026-Q4", toAsk: 1, toVerify: 0, blocked: 1 });
  // Quelli da verificare contano con gli altri, non solo quando non c'è altro.
  const withVerify = [...needs, need({ status: "in_verifica", useCaseIds: [a.id, b.id] }), need({ status: "in_verifica", useCaseIds: [next.id] })];
  assert.deepEqual(overviewNextStep({ items, needs: withVerify, today: TODAY }), { kind: "requisiti", quarter: "2026-Q4", toAsk: 1, toVerify: 1, blocked: 1 });
  // Tutto chiesto: quelli da verificare da soli.
  const verify = [need({ status: "in_verifica", useCaseIds: [a.id] }), need({ status: "chiesta", useCaseIds: [b.id] })];
  assert.deepEqual(overviewNextStep({ items, needs: verify, today: TODAY }), { kind: "requisiti", quarter: "2026-Q4", toAsk: 0, toVerify: 1, blocked: 0 });
  // Niente da chiedere né da verificare: le decisioni.
  assert.deepEqual(overviewNextStep({ items, needs: [need({ status: "chiesta", useCaseIds: [a.id] })], today: TODAY }), { kind: "decisioni", count: 2 });
});

test("prossimo passo e «Cosa serve» del trimestre, dove porta il pulsante: gli stessi requisiti, contati allo stesso modo", () => {
  // La forma di TopJet il 29/10/2026, in piccolo: requisiti di più use case del trimestre, uno già
  // partito, uno del trimestre dopo, uno scaduto; ogni gruppo di stato, archiviate e passi.
  const a = hub({ title: "LIBRA L1 · Lettura delle fatture estere" });
  const b = hub({ title: "SIRIO S3 · File F24 delle tasse passeggeri" });
  const c = hub({ title: "AUTO X2 · Bonifici massivi" });
  const started = hub({ phase: "in_realizzazione", subState: "senza_dossier", targetQuarter: "2026-Q4" });
  const next = hub({ targetQuarter: "2027-Q1" });
  const overdue = hub({ targetQuarter: "2026-Q3" });
  const items = [a, b, c, started, next, overdue, toDecide()];
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
  const step = overviewNextStep({ items, needs, today: TODAY });
  assert.deepEqual(step, { kind: "requisiti", quarter: "2026-Q4", toAsk: 3, toVerify: 2, blocked: 1 });
  // La pagina del pulsante (`?vista=cosa-serve&trimestre=2026-Q4`), come la compone hub.tsx.
  const viewer: UseCaseViewer = { userId: uuid(9000), email: "persona.prova@cliente.test", emailVerified: true, role: "function_lead", isLateralSpace: false };
  const params = parseHubParams(new URLSearchParams("vista=cosa-serve&trimestre=2026-Q4"), viewer);
  assert.ok(hasActiveFilters(params));
  const filtered = applyHubFilters(items, params);
  const board = buildNeedsBoard(needs, items, {
    today: TODAY,
    params: DEFAULT_VALUE_PARAMS,
    only: { useCaseIds: new Set(filtered.map((item) => item.id.toLowerCase())), q: params.q },
  });
  assert.ok(step?.kind === "requisiti");
  assert.deepEqual({ toAsk: board.counts.toAsk, toVerify: board.counts.toVerify, blocked: board.counts.blocked }, { toAsk: step.toAsk, toVerify: step.toVerify, blocked: step.blocked });
  // I numeri del riquadro si leggono nella riga sotto «Requisiti», con le stesse parole.
  assert.deepEqual(needsSummaryPieces(board.counts), ["7 aperti", "3 da chiedere", "1 in attesa", "2 da verificare", "1 bloccato", "1 a posto"]);
});

test("prossimo passo: le decisioni senza approvati di questo trimestre o senza esigenze; altrimenti niente", () => {
  const next = hub({ targetQuarter: "2027-Q1" });
  const items = [next, toDecide(), toDecide({ subState: "serve_info" })];
  const needs = [need({ useCaseIds: [next.id] })];
  assert.deepEqual(overviewNextStep({ items, needs, today: TODAY }), { kind: "decisioni", count: 1 }, "«Serve info» non conta");
  const current = hub();
  assert.deepEqual(overviewNextStep({ items: [current, toDecide()], needs: null, today: TODAY }), { kind: "decisioni", count: 1 }, "senza esigenze");
  assert.equal(overviewNextStep({ items: [current], needs: [need({ status: "chiesta", useCaseIds: [current.id] })], today: TODAY }), null);
  assert.equal(overviewNextStep({ items: [], needs: [], today: TODAY }), null);
  // A gennaio il T4 2026 è scaduto: i suoi requisiti non dicono più «per partire con il T1».
  assert.deepEqual(overviewNextStep({ items: [current, toDecide()], needs: [need({ useCaseIds: [current.id] })], today: "2027-01-05" }), { kind: "decisioni", count: 1 });
});
