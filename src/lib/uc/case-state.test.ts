import test from "node:test";
import assert from "node:assert/strict";
import {
  CASE_STATUS_LABEL,
  CASE_TRANSITIONS,
  MVP_AVAILABLE_GATES,
  checkCaseTransition,
  isAllowedCaseTransition,
  isCasePastG1,
  nextCaseStatuses,
  type CaseTransitionInput,
} from "./case-state.ts";
import type { Actor } from "./types.ts";
import { CASE_STATUSES, type CaseStatus, type GateKey } from "./vocab.ts";

const NOW = new Date("2026-10-07T10:00:00Z");
const LEAD: Actor = { type: "utente", userId: "u-lead", roles: ["ls_lead"] };
const ANALYST: Actor = { type: "utente", userId: "u-a", roles: ["ls_analista"] };
const OWNER: Actor = { type: "utente", userId: "u-owner", roles: ["owner_cliente"] };
const SYSTEM: Actor = { type: "sistema", job: "creazione" };

function input(from: CaseStatus, to: CaseStatus, over: Partial<CaseTransitionInput> = {}): CaseTransitionInput {
  return {
    from,
    to,
    actor: LEAD,
    reason: null,
    approvedGates: new Set<GateKey>(),
    enteredAt: new Date("2026-09-01T10:00:00Z"),
    now: NOW,
    availableGates: MVP_AVAILABLE_GATES,
    statusBeforeSuspension: null,
    ...over,
  };
}
const code = (r: { ok: boolean; code?: string }) => (r.ok ? "ok" : r.code);

/** Whitelist attesa (PIANO §3.4): avanti, indietro per correzioni, sospensione e chiusura da ogni stato di lavoro. */
const FORWARD: Record<CaseStatus, CaseStatus[]> = {
  bozza: ["raccolta"],
  raccolta: ["pronto_sviluppo"],
  pronto_sviluppo: ["in_sviluppo"],
  in_sviluppo: ["backtest"],
  backtest: ["collaudo", "in_sviluppo"],
  collaudo: ["stabilizzazione", "in_sviluppo"],
  stabilizzazione: ["in_esercizio", "in_sviluppo"],
  in_esercizio: ["misura_roi"],
  misura_roi: ["in_esercizio"],
  sospeso: [],
  chiuso: [],
};

test("the whitelist is complete and nothing else is allowed", () => {
  for (const from of CASE_STATUSES) {
    for (const to of CASE_STATUSES) {
      let expected: boolean;
      if (from === "chiuso") expected = false;
      else if (from === "sospeso") expected = to !== "sospeso";
      else expected = FORWARD[from].includes(to) || to === "sospeso" || to === "chiuso";
      assert.equal(isAllowedCaseTransition(from, to), expected, `${from}>${to}`);
      if (!expected && from !== to) {
        const r = checkCaseTransition(input(from, to, { actor: SYSTEM, reason: "motivo valido" }));
        assert.equal(r.ok, false, `${from}>${to}`);
      }
    }
  }
  assert.deepEqual(CASE_TRANSITIONS.chiuso, []);
  assert.equal(Object.keys(CASE_STATUS_LABEL).length, 11);
});

test("case status labels follow the vocabulary of DESIGN §2.6", () => {
  assert.deepEqual(CASE_STATUS_LABEL, {
    bozza: "Bozza",
    raccolta: "In preparazione",
    pronto_sviluppo: "Pronto per lo sviluppo",
    in_sviluppo: "In sviluppo",
    backtest: "Prova sul passato",
    collaudo: "In collaudo",
    stabilizzazione: "In rodaggio",
    in_esercizio: "In uso",
    misura_roi: "Misura del valore",
    sospeso: "In pausa",
    chiuso: "Chiuso",
  });
});

test("happy paths of every allowed transition", () => {
  const g = (k: GateKey[]) => new Set<GateKey>(k);
  const all: GateKey[] = ["G1", "G2", "G3", "G4"];
  const cases: [CaseStatus, CaseStatus, Partial<CaseTransitionInput>][] = [
    ["bozza", "raccolta", { actor: SYSTEM }],
    ["raccolta", "pronto_sviluppo", { actor: SYSTEM, approvedGates: g(["G1"]) }],
    ["pronto_sviluppo", "in_sviluppo", {}],
    ["in_sviluppo", "backtest", { actor: SYSTEM, approvedGates: g(["G2"]), availableGates: all }],
    ["backtest", "collaudo", { actor: OWNER, availableGates: all }],
    ["backtest", "in_sviluppo", {}],
    ["collaudo", "stabilizzazione", { actor: SYSTEM, approvedGates: g(["G3"]), availableGates: all }],
    ["collaudo", "in_sviluppo", {}],
    ["stabilizzazione", "in_esercizio", {}],
    ["stabilizzazione", "in_sviluppo", {}],
    ["in_esercizio", "misura_roi", {}],
    ["misura_roi", "in_esercizio", { actor: SYSTEM, approvedGates: g(["G4"]), availableGates: all }],
    ["misura_roi", "chiuso", { reason: "Si ferma", closeSignatures: { ls: true, cliente: true } }],
  ];
  for (const [from, to, over] of cases) {
    assert.equal(code(checkCaseTransition(input(from, to, over))), "ok", `${from}>${to}`);
  }
});

test("G1 approval freezes the catalog and moves the portfolio card", () => {
  const r = checkCaseTransition(input("raccolta", "pronto_sviluppo", { actor: SYSTEM, approvedGates: new Set(["G1"]) }));
  assert.ok(r.ok);
  assert.deepEqual(r.ok && r.value.sideEffects, ["congela_catalogo", "portafoglio_in_corso", "notifica_team"]);
  assert.equal(code(checkCaseTransition(input("raccolta", "pronto_sviluppo", { actor: SYSTEM }))), "gate_non_approvato");
  assert.equal(code(checkCaseTransition(input("raccolta", "pronto_sviluppo", { approvedGates: new Set(["G1"]) }))), "attore_non_ammesso");
});

test("G2–G4 are rejected in the MVP", () => {
  const allApproved = new Set<GateKey>(["G1", "G2", "G3", "G4"]);
  for (const [from, to] of [["in_sviluppo", "backtest"], ["collaudo", "stabilizzazione"], ["misura_roi", "in_esercizio"]] as const) {
    const r = checkCaseTransition(input(from, to, { actor: SYSTEM, approvedGates: allApproved }));
    assert.equal(code(r), "gate_non_disponibile", `${from}>${to}`);
    assert.equal(!r.ok && r.message, "Gate non disponibile in questa versione.");
  }
});

test("suspension saves the previous state and only that state can come back", () => {
  assert.equal(code(checkCaseTransition(input("raccolta", "sospeso"))), "motivo_obbligatorio");
  assert.equal(code(checkCaseTransition(input("raccolta", "sospeso", { actor: ANALYST, reason: "Scheda A.8 ritirata" }))), "attore_non_ammesso");
  const s = checkCaseTransition(input("raccolta", "sospeso", { reason: "Scheda A.8 ritirata" }));
  assert.ok(s.ok);
  assert.equal(s.ok && s.value.patch.statusBeforeSuspension, "raccolta");
  assert.deepEqual(s.ok && s.value.sideEffects, ["ferma_invii"]);

  const back = checkCaseTransition(input("sospeso", "raccolta", { statusBeforeSuspension: "raccolta" }));
  assert.ok(back.ok);
  assert.equal(back.ok && back.value.patch.statusBeforeSuspension, null);
  assert.deepEqual(back.ok && back.value.sideEffects, ["riprendi_invii"]);
  assert.equal(code(checkCaseTransition(input("sospeso", "in_sviluppo", { statusBeforeSuspension: "raccolta" }))), "ripresa_non_ammessa");
  assert.equal(code(checkCaseTransition(input("sospeso", "raccolta", { statusBeforeSuspension: null }))), "stato_precedente_assente");
  assert.deepEqual(nextCaseStatuses("sospeso", "in_sviluppo"), ["in_sviluppo", "chiuso"]);
});

test("closing is allowed from any non-terminal state with a reason, and revokes links and tokens", () => {
  for (const from of CASE_STATUSES.filter((s) => s !== "chiuso" && s !== "misura_roi")) {
    assert.equal(code(checkCaseTransition(input(from, "chiuso"))), "motivo_obbligatorio", from);
    assert.equal(code(checkCaseTransition(input(from, "chiuso", { actor: ANALYST, reason: "Archiviato" }))), "attore_non_ammesso", from);
    const r = checkCaseTransition(input(from, "chiuso", { reason: "Archiviato", statusBeforeSuspension: from === "sospeso" ? "raccolta" : null }));
    assert.ok(r.ok, from);
    assert.deepEqual(r.ok && r.value.sideEffects, ["revoca_richieste", "annulla_coda", "revoca_token_mcp"]);
    assert.equal(r.ok && r.value.patch.closedReason, "Archiviato");
    assert.equal(r.ok && r.value.patch.statusBeforeSuspension, null);
  }
  // After the ROI review, closing needs Lateral Space and the client.
  assert.equal(code(checkCaseTransition(input("misura_roi", "chiuso", { reason: "Si ferma" }))), "firme_mancanti");
  assert.equal(code(checkCaseTransition(input("misura_roi", "chiuso", { reason: "Si ferma", closeSignatures: { ls: true, cliente: false } }))), "firme_mancanti");
  // Suspending first does not skip the two signatures.
  const viaSuspension = { reason: "Si ferma", statusBeforeSuspension: "misura_roi" as const };
  assert.equal(code(checkCaseTransition(input("sospeso", "chiuso", viaSuspension))), "firme_mancanti");
  assert.equal(code(checkCaseTransition(input("sospeso", "chiuso", { ...viaSuspension, closeSignatures: { ls: false, cliente: true } }))), "firme_mancanti");
  assert.ok(checkCaseTransition(input("sospeso", "chiuso", { ...viaSuspension, closeSignatures: { ls: true, cliente: true } })).ok);
  // A closed case never changes.
  for (const to of CASE_STATUSES) {
    if (to !== "chiuso") assert.equal(code(checkCaseTransition(input("chiuso", to, { reason: "x".repeat(10) }))), "caso_chiuso", to);
  }
});

test("stabilization lasts at least 14 days", () => {
  const entered = new Date("2026-10-01T10:00:00Z");
  assert.equal(code(checkCaseTransition(input("stabilizzazione", "in_esercizio", { enteredAt: entered }))), "stabilizzazione_in_corso");
  assert.equal(code(checkCaseTransition(input("stabilizzazione", "in_esercizio", { enteredAt: null }))), "stabilizzazione_in_corso");
  const ok14 = checkCaseTransition(input("stabilizzazione", "in_esercizio", { enteredAt: entered, now: new Date("2026-10-15T10:00:00Z") }));
  assert.ok(ok14.ok);
  assert.deepEqual(ok14.ok && ok14.value.sideEffects, ["portafoglio_implementato"]);
});

test("the first send moves bozza to raccolta only by the system", () => {
  assert.equal(code(checkCaseTransition(input("bozza", "raccolta"))), "attore_non_ammesso");
  assert.equal(code(checkCaseTransition(input("bozza", "raccolta", { actor: SYSTEM }))), "ok");
  assert.equal(code(checkCaseTransition(input("bozza", "bozza"))), "stato_invariato");
});

test("past G1 includes a suspended case that was past G1", () => {
  assert.equal(isCasePastG1("raccolta"), false);
  assert.equal(isCasePastG1("pronto_sviluppo"), true);
  assert.equal(isCasePastG1("misura_roi"), true);
  assert.equal(isCasePastG1("chiuso"), false);
  assert.equal(isCasePastG1("sospeso", "raccolta"), false);
  assert.equal(isCasePastG1("sospeso", "collaudo"), true);
});

test("case roles are recomputed with the user context", () => {
  const lsUser = { userId: "u-lead", emailVerified: true, emailDomain: "ls.test", isLateralSpace: true };
  const reason = "Cambio di priorità del cliente";
  assert.equal(code(checkCaseTransition(input("raccolta", "sospeso", { reason, user: lsUser }))), "ok");
  // The domain was removed from UC_LS_EMAIL_DOMAINS: ls_lead no longer counts.
  assert.equal(code(checkCaseTransition(input("raccolta", "sospeso", { reason, user: { ...lsUser, isLateralSpace: false } }))), "attore_non_ammesso");
  // The context must be the acting user.
  assert.equal(code(checkCaseTransition(input("raccolta", "sospeso", { reason, user: { ...lsUser, userId: "u-other" } }))), "attore_non_ammesso");
  // An Owner who became Lateral Space cannot sign as the client.
  const owner = { userId: "u-owner", emailVerified: true, emailDomain: "ls.test", isLateralSpace: true };
  assert.equal(code(checkCaseTransition(input("backtest", "collaudo", { actor: OWNER, user: owner, availableGates: ["G1", "G2", "G3", "G4"] }))), "attore_non_ammesso");
  assert.equal(code(checkCaseTransition(input("backtest", "collaudo", { actor: OWNER, user: { ...owner, isLateralSpace: false }, availableGates: ["G1", "G2", "G3", "G4"] }))), "ok");
});
