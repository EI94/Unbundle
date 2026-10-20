import test from "node:test";
import assert from "node:assert/strict";
import { findForbidden } from "./copy-guard.ts";
import { formatEuro } from "./format.ts";
import type { NextStepInput } from "./next-step.ts";
import {
  REALIZATION_TEXT,
  dossierCardView,
  dossierCodeFor,
  dossierIdentity,
  formatBreakEven,
  generatedCaseCode,
  generatedCodeStem,
  realizationDescription,
  realizationDossierView,
  roiTotals,
  sortDossierCards,
  startDefaults,
  type DossierFacts,
} from "./realization.ts";

const WS = "11111111-1111-4111-8111-111111111111";
const CASE = "22222222-2222-4222-8222-222222222222";
const UC = "33333333-3333-4333-8333-333333333333";
const NOW = new Date("2026-10-14T10:00:00Z");

function step(over: Partial<NextStepInput> = {}): NextStepInput {
  return {
    now: NOW,
    status: "raccolta",
    statusBeforeSuspension: null,
    statusChangedAt: null,
    gateReconfirm: false,
    g1: { required: 245, ok: 12, ready: false, byGroup: { da_verificare: 30 } },
    pendingGateReview: null,
    referents: 4,
    unassignedMust: 0,
    unsentMust: 137,
    toVerifyForMe: 0,
    toVerifyMust: 0,
    oldestToVerifyAt: null,
    toVerifyTotal: 0,
    waitingOnReferents: 0,
    blockersActive: 0,
    blockedMust: 0,
    privacyBlockerActive: false,
    mySignaturesPending: [],
    privacySignerMissing: false,
    forwardTransition: null,
    nextMilestone: { title: "Kick-off", date: "2026-11-15" },
    catalog: null,
    ...over,
  };
}

function facts(over: Partial<DossierFacts> = {}): DossierFacts {
  return {
    workspaceId: WS,
    caseId: CASE,
    caseCode: "SR-UC-01",
    caseTitle: "Smistamento richieste",
    status: "raccolta",
    updatedAt: new Date("2026-10-13T08:00:00Z"),
    useCase: { id: UC, code: "XX-0012", title: "Smistamento delle richieste" },
    canOpen: true,
    roles: ["ls_lead"],
    nextStep: step(),
    ...over,
  };
}

test("the card: use case code and title, status, one progress number, my step or the next milestone", () => {
  const card = dossierCardView(facts());
  assert.deepEqual(card, {
    caseId: CASE,
    useCaseId: UC,
    code: "XX-0012",
    title: "Smistamento delle richieste",
    statusLabel: "In preparazione",
    statusTone: "giallo",
    progress: { ok: 12, required: 245, inReview: 30 },
    context: { kind: "turno", text: "Tocca a te · Invia le domande" },
    href: `/dashboard/${WS}/casi-duso/${CASE}`,
    myTurn: true,
    updatedAt: "2026-10-13T08:00:00.000Z",
  });
  // An observer of the workspace opens it, with no step of his own: the next milestone.
  const observer = dossierCardView(facts({ roles: ["osservatore"] }));
  assert.deepEqual(observer.context, { kind: "tappa", text: "Prossima tappa · 15 nov" });
  assert.equal(observer.myTurn, false);
  // Another reviewer does not open it: no step, the link goes to the use case card.
  const other = dossierCardView(facts({ canOpen: false, roles: [] }));
  assert.equal(other.href, `/dashboard/${WS}/use-cases/${UC}`);
  assert.equal(other.context?.kind, "tappa");
  // Without a parent use case: the dossier's code and title, no link for non-openers.
  const orphan = dossierCardView(facts({ useCase: null, canOpen: false, roles: [] }));
  assert.deepEqual([orphan.code, orphan.title, orphan.href], ["SR-UC-01", "Smistamento richieste", null]);
  // A paused dossier keeps its grey dot; without a milestone there is no context line.
  const paused = dossierCardView(facts({ status: "sospeso", roles: ["osservatore"], nextStep: step({ status: "sospeso", statusBeforeSuspension: "raccolta", nextMilestone: null }) }));
  assert.deepEqual([paused.statusLabel, paused.statusTone, paused.context], ["In pausa", "grigio", null]);
  // No required questions: no progress (zero is not shown).
  assert.equal(dossierCardView(facts({ nextStep: step({ g1: { required: 0, ok: 0, ready: false, byGroup: {} } }) })).progress, null);
});

test("the column order: my turn first, then the latest change", () => {
  const cards = [
    { caseId: "a", myTurn: false, updatedAt: "2026-10-10T00:00:00.000Z" },
    { caseId: "b", myTurn: true, updatedAt: "2026-10-01T00:00:00.000Z" },
    { caseId: "c", myTurn: false, updatedAt: "2026-10-12T00:00:00.000Z" },
    { caseId: "d", myTurn: true, updatedAt: "2026-10-05T00:00:00.000Z" },
    { caseId: "e", myTurn: false, updatedAt: null },
  ];
  assert.deepEqual(
    sortDossierCards(cards).map((c) => c.caseId),
    ["d", "b", "c", "a", "e"],
  );
});

test("the chapter summary: link only for openers, my step instead of the milestone, figures or «da calcolare»", () => {
  const roi = roiTotals({ implementation_cost: "18500", annual_benefit: 60000, break_even_months: "4" });
  const view = realizationDossierView({ ...facts(), roi });
  assert.deepEqual(view, {
    caseId: CASE,
    statusLabel: "In preparazione",
    statusTone: "giallo",
    closed: false,
    progress: { ok: 12, required: 245, inReview: 30 },
    myStep: { label: "Invia le domande", href: `/dashboard/${WS}/casi-duso/${CASE}/persone?invia=1` },
    nextMilestone: "15 nov",
    // `Intl` puts a no-break space before the euro sign.
    figures: { cost: formatEuro(18500), benefit: formatEuro(60000), breakEven: "4 mesi" },
    href: `/dashboard/${WS}/casi-duso/${CASE}`,
  });
  const other = realizationDossierView({ ...facts({ canOpen: false, roles: [] }), roi: roiTotals(null) });
  assert.deepEqual([other.href, other.myStep], [null, null]);
  assert.deepEqual(other.figures, { cost: null, benefit: null, breakEven: null });
  assert.equal(realizationDossierView({ ...facts({ status: "chiuso", nextStep: step({ status: "chiuso" }) }), roi: roiTotals(null) }).closed, true);
});

test("ROI totals: the saved columns first, else computeRoi on the lines; missing values stay null", () => {
  const lines = {
    cost_lines: [
      { key: "sviluppo", label: "Sviluppo", kind: "una_tantum", value: 12000 },
      { key: "canone", label: "Canone", kind: "ricorrente", value: 2000 },
    ],
    benefit_lines: [{ key: "tempo", lever: "tempo", value: 26000 }],
  };
  assert.deepEqual(roiTotals(lines), { implementation: 12000, annualBenefit: 26000, breakEvenMonths: 6 });
  assert.deepEqual(roiTotals({ ...lines, implementation_cost: "15000.00" }).implementation, 15000);
  assert.deepEqual(roiTotals({ cost_lines: JSON.stringify(lines.cost_lines), benefit_lines: "[]" }), { implementation: null, annualBenefit: null, breakEvenMonths: null });
  assert.deepEqual([formatBreakEven(4), formatBreakEven(1), formatBreakEven(4.5), formatBreakEven(null)], ["4 mesi", "1 mese", "4,5 mesi", null]);
});

test("identity: the use case code and title; without a code column the dossier code", () => {
  assert.deepEqual(dossierIdentity({ caseCode: "SR-UC-01", caseTitle: "Dossier", useCase: { code: "XX-0012", title: "Idea" } }), { code: "XX-0012", title: "Idea" });
  assert.deepEqual(dossierIdentity({ caseCode: "SR-UC-01", caseTitle: "Dossier", useCase: { code: null, title: "Idea" } }), { code: "SR-UC-01", title: "Idea" });
  assert.deepEqual(dossierIdentity({ caseCode: "SR-UC-01", caseTitle: "Dossier", useCase: null }), { code: "SR-UC-01", title: "Dossier" });
});

test("start defaults: the name from the title, the sentence from the first line of the problem", () => {
  assert.deepEqual(startDefaults({ title: "  Smistamento   richieste ", problem: "Le richieste arrivano a una casella sola. Poi qualcuno le smista.\nSeconda riga." }), {
    title: "Smistamento richieste",
    oneLiner: "Le richieste arrivano a una casella sola.",
  });
  assert.deepEqual(startDefaults({ title: "x".repeat(300), problem: null }).title.length, 255);
  assert.equal(startDefaults({ title: "T", problem: `${"a".repeat(600)}` }).oneLiner.length, 500);
});

test("the starting description: «In breve» from problem and how it works, the rest under «Dallo use case», never the proposer", () => {
  const description = realizationDescription({
    title: "Smistamento",
    problem: "Le richieste arrivano a una casella sola.",
    flow: "Claude legge la richiesta e propone il team.",
    humanInTheLoop: "Il coordinatore conferma.",
    guardrails: "Mai risposte automatiche ai clienti.",
    dataRequirements: "Storico delle richieste.",
  });
  assert.deepEqual(description, {
    in_breve: "Le richieste arrivano a una casella sola.\n\nClaude legge la richiesta e propone il team.",
    dallo_use_case: { chi_controlla: "Il coordinatore conferma.", limiti: "Mai risposte automatiche ai clienti.", dati: "Storico delle richieste." },
  });
  assert.deepEqual(realizationDescription({ title: "x", problem: "  ", flow: null, humanInTheLoop: null, guardrails: null, dataRequirements: null }), {});
  assert.doesNotMatch(JSON.stringify(description), /proposed|propost/i);
});

test("the dossier code: the use case's with the column (refused without one), generated from the name without it", () => {
  assert.deepEqual(dossierCodeFor({ hasCodeColumn: true, useCaseCode: "xx-0012", title: "Smistamento", taken: new Set() }), { ok: true, code: "XX-0012", source: "use_case" });
  assert.deepEqual(dossierCodeFor({ hasCodeColumn: true, useCaseCode: null, title: "Smistamento", taken: new Set() }), { ok: false, reason: "codice_mancante" });
  assert.deepEqual(dossierCodeFor({ hasCodeColumn: true, useCaseCode: "non valido!", title: "Smistamento", taken: new Set() }), { ok: false, reason: "codice_mancante" });
  assert.deepEqual(dossierCodeFor({ hasCodeColumn: false, useCaseCode: null, title: "Smistamento richieste", taken: new Set(["SR-UC-01"]) }), {
    ok: true,
    code: "SR-UC-02",
    source: "generato",
  });
  assert.equal(generatedCaseCode("Qualità è più", new Set()), "QEP-UC-01");
  assert.equal(generatedCaseCode("Smistamento", new Set()), "SMIS-UC-01");
  assert.equal(generatedCaseCode("!", new Set()), "UC-UC-01");
  assert.equal(generatedCodeStem("Smistamento richieste"), "SR");
  for (const title of ["Smistamento richieste", "Qualità è più", "a", "Prezzi e sconti 2027"]) assert.match(generatedCaseCode(title, new Set()), /^[A-Z0-9][A-Z0-9-]{1,39}$/);
});

test("every fixed text passes the copy guard and never says «caso d'uso» or «Opportunità»", () => {
  for (const text of Object.values(REALIZATION_TEXT)) {
    assert.deepEqual(findForbidden(text, "cliente"), [], text);
    assert.doesNotMatch(text, /caso d'uso|casi d'uso|opportunit/i, text);
  }
});
