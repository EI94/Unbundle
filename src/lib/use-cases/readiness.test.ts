import test from "node:test";
import assert from "node:assert/strict";
import { PHASES, SUB_STATES } from "./types.ts";
import { NEED_REQUIREMENT_STATUSES, type NeedStatus } from "./needs.ts";
import { isReadyToStart as isPageReady } from "./guided.ts";
import { deriveInfoProgress } from "./info-progress.ts";
import {
  READINESS_LATER_RULE,
  READY_NEED_STATUSES,
  isReadyToStart,
  isScheduledQuarter,
  readinessInputsChanged,
  waitsForSubprocessorsOk,
  type ReadinessInput,
} from "./readiness.ts";

// Le due regole delle notifiche «Pronto da avviare» e «Autorizza i fornitori», su tutta la tabella
// di verità. Oggi a Roma: 1 novembre 2026, trimestre 2026-Q4.
const TODAY = "2026-11-01";
const base: ReadinessInput = { kind: "da_costruire", phase: "approvato", targetQuarter: "2026-Q4", clientNeeds: [], today: TODAY };
const ready = (patch: Partial<ReadinessInput>) => isReadyToStart({ ...base, ...patch });

test("«Più avanti» è il trimestre assente, come la pillola", () => {
  assert.equal(READINESS_LATER_RULE, "trimestre_assente");
  assert.deepEqual([...READY_NEED_STATUSES], ["validata", "non_applicabile"]);
});

test("pronto: Da costruire, approvato, trimestre di adesso o dopo, nessuna informazione del cliente", () => {
  assert.equal(ready({}), true);
  assert.equal(ready({ targetQuarter: "2027-Q1" }), true, "il prossimo");
  assert.equal(ready({ targetQuarter: "2028-Q3" }), true, "un trimestre lontano conta come pianificato");
});

test("non pronto: Da diffondere, ogni altra fase", () => {
  assert.equal(ready({ kind: "da_diffondere" }), false);
  for (const phase of PHASES) assert.equal(ready({ phase }), phase === "approvato", phase);
});

test("non pronto: «Più avanti», trimestre passato, valore rovinato", () => {
  assert.equal(ready({ targetQuarter: null }), false);
  assert.equal(ready({ targetQuarter: "2026-Q3" }), false, "scaduto");
  assert.equal(ready({ targetQuarter: "2025-Q4" }), false);
  for (const bad of ["", "2026-Q5", "T4 2026", "2026-q4", "26-Q4"]) assert.equal(ready({ targetQuarter: bad }), false, bad);
  assert.equal(ready({ today: "non-una-data" }), false, "oggi illeggibile");
});

test("informazioni del cliente: ognuna «A posto» o «Non si applica»; uno stato sconosciuto non è fatto", () => {
  for (const status of NEED_REQUIREMENT_STATUSES) {
    const done = status === "validata" || status === "non_applicabile";
    assert.equal(ready({ clientNeeds: [{ status }] }), done, status);
    assert.equal(ready({ clientNeeds: [{ status: "validata" }, { status }] }), done, `con un'altra a posto: ${status}`);
  }
  assert.equal(ready({ clientNeeds: [{ status: "validata" }, { status: "non_applicabile" }] }), true);
  assert.equal(ready({ clientNeeds: [{ status: "sconosciuto" }] }), false);
});

test("trimestre pianificato: confini", () => {
  assert.equal(isScheduledQuarter("2026-Q4", "2026-10-01"), true);
  assert.equal(isScheduledQuarter("2026-Q4", "2026-12-31"), true);
  assert.equal(isScheduledQuarter("2026-Q4", "2027-01-01"), false);
  assert.equal(isScheduledQuarter(null, TODAY), false);
});

const wait = (patch: Partial<Parameters<typeof waitsForSubprocessorsOk>[0]>) =>
  waitsForSubprocessorsOk({ phase: "approvato", targetQuarter: "2026-Q4", clientNeeds: [{ status: "da_chiedere" }], today: TODAY, acknowledged: false, ...patch });

test("aspetta l'ok: approvato, pianificato, qualcosa da chiedere, nessun ok", () => {
  assert.equal(wait({}), true);
  for (const status of ["da_chiedere", "mancante", "parziale"]) assert.equal(wait({ clientNeeds: [{ status }] }), true, status);
  for (const status of NEED_REQUIREMENT_STATUSES.filter((s) => !["da_chiedere", "mancante", "parziale"].includes(s))) {
    assert.equal(wait({ clientNeeds: [{ status }] }), false, status);
  }
  assert.equal(wait({ clientNeeds: [{ status: "validata" }, { status: "parziale" }] }), true);
});

test("non aspetta: ok dato, niente da chiedere, «Più avanti», scaduto, altra fase", () => {
  assert.equal(wait({ acknowledged: true }), false);
  assert.equal(wait({ clientNeeds: [] }), false);
  assert.equal(wait({ targetQuarter: null }), false);
  assert.equal(wait({ targetQuarter: "2026-Q2" }), false);
  for (const phase of PHASES) assert.equal(wait({ phase }), phase === "approvato", phase);
});

test("le colonne che contano per la regola", () => {
  const before = { status: "proposed", portfolioReviewStatus: "scored", targetQuarter: null, portfolioKind: "use_case_ai" };
  assert.equal(readinessInputsChanged(before, { ...before }), false);
  assert.equal(readinessInputsChanged(before, { ...before, status: "accepted" }), true);
  assert.equal(readinessInputsChanged(before, { ...before, portfolioReviewStatus: "archived" }), true);
  assert.equal(readinessInputsChanged(before, { ...before, targetQuarter: "2026-Q4" }), true);
  assert.equal(readinessInputsChanged(before, { ...before, portfolioKind: "best_practice" }), true);
});

test("pronto da avviare dice quello che dice la scheda (G9 di guided.ts) su ogni valore che il database accetta", () => {
  const quarters = ["2026-Q4", "2027-Q1", "2028-Q3", "2026-Q3", "2020-Q1", null];
  const needSets: { status: NeedStatus }[][] = [[], ...NEED_REQUIREMENT_STATUSES.map((status) => [{ status }]), [{ status: "validata" }, { status: "non_applicabile" }], [{ status: "validata" }, { status: "parziale" }]];
  let cases = 0;
  let readyCases = 0;
  for (const phase of PHASES) {
    for (const subState of SUB_STATES[phase]) {
      for (const kind of ["da_costruire", "da_diffondere"] as const) {
        for (const targetQuarter of quarters) {
          // La fase arriva da phaseOfUseCase: approvato vuol dire «trimestre» con un trimestre, «più avanti» senza.
          if (phase === "approvato" && (subState === "trimestre") !== (targetQuarter !== null)) continue;
          for (const clientNeeds of needSets) {
            const info = deriveInfoProgress(clientNeeds.map((need, i) => ({ id: `n${i}`, status: need.status })), [], new Date(`${TODAY}T10:00:00Z`));
            const page = isPageReady({ phase, subState, kind, targetQuarter }, info ? { state: info.state } : null, TODAY);
            assert.equal(isReadyToStart({ kind, phase, targetQuarter, clientNeeds, today: TODAY }), page, JSON.stringify({ phase, subState, kind, targetQuarter, clientNeeds }));
            cases++;
            if (page) readyCases++;
          }
        }
      }
    }
  }
  assert.ok(cases > 1000, String(cases));
  assert.ok(readyCases > 0 && readyCases < cases, `${readyCases} pronti su ${cases}`);
});
