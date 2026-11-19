import test from "node:test";
import assert from "node:assert/strict";
import type { ValueParts } from "./format.ts";
import { NO_PROGRAM_COSTS, programCards } from "../programma/curve.ts";
import { programResults } from "../programma/figures.ts";
import { buildLanes, countedEurOf } from "./lanes.ts";
import { buildNeedsBoard, needsSummaryPieces, type NeedView } from "./needs.ts";
import {
  SAL_EVERY_DAYS,
  WORKSPACE_STEP_KEYS,
  addDays,
  nextSalFrom,
  overviewNumber,
  salDue,
  workspaceNextStep,
  workspaceSteps,
  type WorkspaceStepInput,
} from "./panoramica.ts";
import type { UseCaseViewer } from "./permissions.ts";
import type { CostFigure } from "./valuation.ts";
import { DEFAULT_VALUE_PARAMS } from "./value-model.ts";
import { applyHubFilters, hasActiveFilters, parseHubParams, roadmapTotals, type HubItem } from "./views.ts";

// La testa della Panoramica (rilascio 10, §3.4): il numero grande e il prossimo passo del workspace (D3).
// Dati inventati: codici XX-0000.

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

// ─── Il numero grande (rilascio 10, §3.4) ────────────────────────────

test("il numero grande: gli euro contati degli approvati, in realizzazione e in uso, come `roadmapTotals`", () => {
  const items = [
    hub({ value: counted(12_250), cost: TEAM_30K }),
    hub({ targetQuarter: "2026-Q3", value: pending(5_840) }),
    hub({ targetQuarter: "2027-Q1", value: counted(5_000, 1_000) }),
    hub({ phase: "in_realizzazione", subState: "senza_dossier", targetQuarter: "2026-Q4", value: pending(2_000), cost: TEAM_30K }),
    hub({ phase: "realizzato", subState: "realizzato", value: counted(9_000) }),
    toDecide({ value: counted(50_000) }),
  ];
  assert.deepEqual(overviewNumber(items), roadmapTotals(items).expectedValue);
  assert.deepEqual(overviewNumber(items), { amountEur: 26_250, count: 3 }, "l'in uso sì, quello da decidere e i soli «da misurare» no");
  // Con i centesimi: le card fanno la cifra, come la scrivono.
  const cents = [
    hub({ value: counted(1_000.5) }),
    hub({ value: counted(1_000.5) }),
    hub({ targetQuarter: "2027-Q1", value: counted(4_042.5) }),
    hub({ phase: "in_realizzazione", subState: "senza_dossier", value: counted(2_719.5) }),
    hub({ phase: "realizzato", subState: "realizzato", value: counted(0.5) }),
  ];
  const centsLanes = buildLanes(cents, TODAY);
  assert.equal(overviewNumber(cents)?.amountEur, 1_001 + 1_001 + 4_043 + 2_720 + 1);
  assert.equal(
    centsLanes.lanes.reduce((sum, lane) => sum + countedEurOf(lane.entries.map((entry) => entry.item)), 0) + countedEurOf(centsLanes.inProgress) + (centsLanes.doneCountedEurYear ?? 0),
    overviewNumber(cents)?.amountEur,
  );
  // Senza cifre: niente numero (lo zero non si mostra); il solo «da misurare» sta nella Home.
  assert.equal(overviewNumber([]), null);
  assert.equal(overviewNumber([toDecide({ value: counted(1) }), hub({ value: pending(4_000) })]), null);
});

test("(rilascio 10) il numero grande della Panoramica è il «Valore stimato all'anno» della Home, sugli stessi use case", () => {
  const items = [
    hub({ value: counted(12_250.5) }),
    hub({ targetQuarter: "2027-Q1", value: counted(4_042.5) }),
    hub({ targetQuarter: "2026-Q3", value: counted(3_000) }),
    hub({ phase: "in_realizzazione", subState: "senza_dossier", value: counted(2_719.5) }),
    hub({ phase: "realizzato", subState: "realizzato", realizedOn: "2026-06-10", value: counted(38_000) }),
    hub({ phase: "realizzato", subState: "diffusa", realizedOn: "2026-07-10", kind: "da_diffondere", value: counted(1_200) }),
    hub({ value: pending(5_840) }),
    hub({ value: counted(0) }),
    toDecide({ value: counted(50_000) }),
    hub({ phase: "chiuso", subState: "non_avviato", value: counted(9_000) }),
  ];
  const home = programResults(programCards(items, { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-10" }, NO_PROGRAM_COSTS, TODAY).cards, { employees: null, revenueEur: null });
  assert.deepEqual(overviewNumber(items), { amountEur: home.estimated, count: home.estimatedCount });
  assert.deepEqual(overviewNumber(items), { amountEur: 12_251 + 4_043 + 3_000 + 2_720 + 38_000 + 1_200, count: 6 });
});

test("il numero grande segue i filtri, come le corsie", () => {
  const lead = { userId: uuid(1), email: "lead@example.test", emailVerified: true, role: "transformation_lead", isLateralSpace: false } as UseCaseViewer;
  const adoption = hub({ value: counted(10_000) });
  const transformation = hub({ origin: "transformation", value: counted(4_000) });
  const params = parseHubParams(new URLSearchParams("origine=transformation"), lead);
  assert.ok(hasActiveFilters(params));
  assert.deepEqual(overviewNumber(applyHubFilters([adoption, transformation], params)), { amountEur: 4_000, count: 1 });
  assert.deepEqual(overviewNumber([adoption, transformation]), { amountEur: 14_000, count: 2 });
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
