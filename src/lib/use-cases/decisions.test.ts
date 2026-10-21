import test from "node:test";
import assert from "node:assert/strict";
import { allowedNextStatuses, isAllowedStatusTransition } from "../use-case-lifecycle.ts";
import { CASE_STATUSES } from "../uc/vocab.ts";
import {
  applyDecision,
  applyDecisionPatch,
  applyIntakeChange,
  applyWhen,
  checkStartRealization,
  DECISION_MESSAGES,
  DOSSIER_IN_USE_STATUSES,
  type DecisionCard,
  type DecisionContext,
  type DecisionResult,
  type DossierStatus,
} from "./decisions.ts";
import { COST_AMOUNT_ERROR, PUBLIC_NOTE_REQUIRED_ERROR } from "./inputs.ts";
import type { Decision, Phase } from "./types.ts";

// Decisioni: docs/use-case/DESIGN.md §3.7 (ogni riga e i passaggi vietati) e §3.6 («Quando» e
// data di revisione). Schede, codici e note sintetici.

// ─── Oracolo del test: codice per il cliente e fase (§3.5, §3.4) ────
// La funzione vera è `connectorStatus` (src/lib/connector/status.ts, K3) e `phaseOfUseCase`
// (phase.ts, H1c). Qui una copia della tabella di §3.5, solo per controllare la colonna
// «Dopo, per il cliente» di §3.7 e per calcolare la fase tra due decisioni di fila.

type Columns = Pick<
  DecisionCard,
  "status" | "portfolioReviewStatus" | "reviewedBy" | "publicNote" | "intake" | "reviewBy" | "dossierStatus"
>;

function clientStatus(c: Columns): string {
  const intake = c.intake ?? {};
  if (c.portfolioReviewStatus === "archived") return intake.archiveReason === "duplicato" ? "DOPPIONE" : "ARCHIVIATA";
  if (c.status === "implemented") return "REALIZZATA";
  if (c.status === "rejected") return "NON_AVVIATA";
  if (c.dossierStatus !== null) return "AVVIATA_COME_CASO";
  if (c.status === "in_progress") return "IN_SVILUPPO";
  if (c.status === "accepted") return "APPROVATA";
  if ((c.status === "draft" || c.status === "proposed") && (c.portfolioReviewStatus === "scored" || c.reviewBy)) return "VALUTATA";
  if (c.portfolioReviewStatus === "needs_inputs" && c.reviewedBy && c.publicNote?.trim()) return "SERVONO_INFORMAZIONI";
  const untouched = c.portfolioReviewStatus === "in_review" || (c.portfolioReviewStatus === "needs_inputs" && !c.reviewedBy);
  if (untouched && intake.possibleDuplicateOf) return "POSSIBILE_DOPPIONE";
  if (c.portfolioReviewStatus === "in_review") return "IN_VALUTAZIONE";
  return "RICEVUTA";
}

function phaseOf(c: Columns): Phase {
  switch (clientStatus(c)) {
    case "DOPPIONE":
    case "ARCHIVIATA":
    case "NON_AVVIATA":
      return "chiuso";
    case "REALIZZATA":
      return "realizzato";
    case "AVVIATA_COME_CASO":
    case "IN_SVILUPPO":
      return "in_realizzazione";
    case "APPROVATA":
      return "approvato";
    default:
      return "da_valutare";
  }
}

// ─── Schede d'esempio ────────────────────────────────────────────────

const NOW = new Date("2026-10-14T10:00:00Z"); // oggi a Roma: 2026-10-14, T4 2026
const ME = "00000000-0000-4000-8000-0000000000a1";

function card(columns: Partial<DecisionCard> = {}): DecisionCard {
  const base: DecisionCard = {
    id: "00000000-0000-4000-8000-000000000012",
    code: "XX-0012",
    phase: "da_valutare",
    status: "proposed",
    portfolioReviewStatus: "needs_inputs",
    portfolioKind: "use_case_ai",
    targetQuarter: null,
    reviewBy: null,
    reviewedBy: null,
    publicNote: null,
    intake: null,
    dossierStatus: null,
    customScores: null,
    valueEurYear: null,
    costEurOnce: null,
    costBand: null,
    ...columns,
  };
  return { ...base, phase: columns.phase ?? phaseOf(base) };
}

/** Le schede di §3.5, una per sotto-stato. */
const cards = {
  nuova: card(),
  draft: card({ status: "draft" }),
  inValutazione: card({ portfolioReviewStatus: "in_review" }),
  possibileDoppione: card({ portfolioReviewStatus: "in_review", intake: { possibleDuplicateOf: "XX-0007" } }),
  serveInfo: card({ reviewedBy: ME, publicNote: "Quante richieste al mese?" }),
  valutata: card({ portfolioReviewStatus: "scored", customScores: { impact: { efficiency: 4 } } }),
  rimandata: card({ portfolioReviewStatus: "in_review", reviewBy: "2027-01-14" }),
  daRivedere: card({ portfolioReviewStatus: "scored", reviewBy: "2026-10-01" }),
  nascosta: card({ intake: { hiddenFromSearch: true } }),
  approvatoTrimestre: card({ status: "accepted", portfolioReviewStatus: "scored", targetQuarter: "2027-Q1" }),
  approvatoPiuAvanti: card({ status: "accepted", portfolioReviewStatus: "scored" }),
  approvatoScaduto: card({ status: "accepted", portfolioReviewStatus: "scored", targetQuarter: "2026-Q3" }),
  approvatoDiffondere: card({ status: "accepted", portfolioKind: "best_practice", targetQuarter: "2027-Q1" }),
  approvatoTipoNull: card({ status: "accepted", portfolioKind: null }),
  inRealizzazioneSenzaDossier: card({ status: "in_progress", portfolioReviewStatus: "scored", targetQuarter: "2026-Q4" }),
  realizzato: card({ status: "implemented", portfolioReviewStatus: "scored" }),
  diffusa: card({ status: "implemented", portfolioKind: "best_practice" }),
  nonAvviato: card({ status: "rejected", portfolioReviewStatus: "in_review" }),
  doppione: card({ portfolioReviewStatus: "archived", intake: { archiveReason: "duplicato", duplicateOfCode: "XX-0007" } }),
  archiviato: card({ portfolioReviewStatus: "archived", intake: { archiveReason: "superato", area: "acquisti" } }),
  archiviatoDaApprovato: card({ status: "accepted", portfolioReviewStatus: "archived", targetQuarter: null, intake: { archiveReason: "altro" } }),
  archiviatoInRealizzazione: card({ status: "in_progress", portfolioReviewStatus: "archived", intake: { archiveReason: "ritirato" } }),
  archiviatoRealizzato: card({ status: "implemented", portfolioReviewStatus: "archived", intake: { archiveReason: "superato" } }),
  // Chiuse con un dossier collegato: «Non avviare» e «Archivia» col dossier chiuso (§3.7),
  // «Archivia» da Realizzato col dossier «In uso».
  nonAvviatoConDossier: card({ status: "rejected", portfolioReviewStatus: "scored", dossierStatus: "chiuso" }),
  archiviatoConDossier: card({ status: "accepted", portfolioReviewStatus: "archived", intake: { archiveReason: "superato" }, dossierStatus: "chiuso" }),
  archiviatoRealizzatoConDossier: card({ status: "implemented", portfolioReviewStatus: "archived", intake: { archiveReason: "superato" }, dossierStatus: "in_esercizio" }),
};

/** Una scheda «In realizzazione» con il dossier in quello stato (`status` resta accepted). */
const withDossier = (dossierStatus: DossierStatus) =>
  card({ status: "accepted", portfolioReviewStatus: "scored", targetQuarter: "2026-Q4", dossierStatus });

const DA_VALUTARE = [cards.nuova, cards.draft, cards.inValutazione, cards.possibileDoppione, cards.serveInfo, cards.valutata, cards.rimandata, cards.daRivedere];
const APPROVATO = [cards.approvatoTrimestre, cards.approvatoPiuAvanti, cards.approvatoScaduto, cards.approvatoDiffondere, cards.approvatoTipoNull];
const IN_REALIZZAZIONE = [cards.inRealizzazioneSenzaDossier, ...CASE_STATUSES.map(withDossier)];
const REALIZZATO = [cards.realizzato, cards.diffusa];
const CHIUSO = [
  cards.nonAvviato,
  cards.doppione,
  cards.archiviato,
  cards.archiviatoDaApprovato,
  cards.archiviatoInRealizzazione,
  cards.archiviatoRealizzato,
  cards.nonAvviatoConDossier,
  cards.archiviatoConDossier,
  cards.archiviatoRealizzatoConDossier,
];
const ALL = [...DA_VALUTARE, ...APPROVATO, ...IN_REALIZZAZIONE, ...REALIZZATO, ...CHIUSO];

/** AI Builder del cliente: revisore, non di Lateral Space. */
const builder: DecisionContext = { now: NOW, actor: { userId: ME, isReviewer: true, isLateralSpace: false }, ucSectionEnabled: true };
/** Persona di Lateral Space con ruolo da revisore. */
const lateral: DecisionContext = { ...builder, actor: { ...builder.actor, isLateralSpace: true } };
/** Contributore. */
const contributor: DecisionContext = { ...builder, actor: { userId: ME, isReviewer: false, isLateralSpace: false } };

const target = { id: "00000000-0000-4000-8000-000000000007", code: "XX-0007" };

function ok(result: DecisionResult) {
  if (!result.ok) assert.fail(`atteso ok, ricevuto ${result.error}: ${result.message}`);
  return result;
}

function after(c: DecisionCard, result: DecisionResult) {
  const next = applyDecisionPatch(c, ok(result).patch);
  return { ...next, phase: phaseOf(next) };
}

function expectError(result: { ok: true } | { ok: false; error: string; message: string }, error: string, message?: string) {
  assert.equal(result.ok, false, "attesa una decisione rifiutata");
  if (!result.ok) {
    assert.equal(result.error, error);
    if (message) assert.equal(result.message, message);
  }
}

const decisions: Decision[] = [
  { type: "approva", quando: "piu_avanti" },
  { type: "rimanda", reviewBy: "2026-11-14" },
  { type: "serve_info", publicNote: "Serve il volume mensile." },
  { type: "non_avviare", publicNote: "Lo copre già un altro strumento." },
  { type: "doppione", ofCode: "XX-0007" },
  { type: "archivia", reason: "superato" },
  { type: "riapri" },
  { type: "segna_diffusa" },
  { type: "segna_realizzato" },
  { type: "segna_in_realizzazione" },
];

const ctxFor = (d: Decision, base: DecisionContext = builder): DecisionContext => ({
  ...base,
  duplicateTarget: d.type === "doppione" ? target : undefined,
  ucSectionEnabled: d.type === "segna_in_realizzazione" ? false : base.ucSectionEnabled,
  actor: d.type === "segna_in_realizzazione" ? { ...base.actor, isLateralSpace: true } : base.actor,
});

// ─── Approva ─────────────────────────────────────────────────────────

test("Approva · da ogni sotto-stato di Da valutare: accepted, target_quarter dalla scelta, review_by NULL → APPROVATA", () => {
  for (const c of DA_VALUTARE) {
    for (const [quando, quarter] of [["questo_trimestre", "2026-Q4"], ["prossimo_trimestre", "2027-Q1"], ["piu_avanti", null]] as const) {
      const result = ok(applyDecision(c, { type: "approva", quando }, builder));
      assert.deepEqual(result.patch, { status: "accepted", targetQuarter: quarter, reviewBy: null });
      assert.equal(result.action, "decisione");
      const next = after(c, result);
      assert.equal(clientStatus(next), "APPROVATA", "APPROVATA qualunque trimestre");
      assert.equal(next.phase, "approvato");
    }
  }
});

test("Approva · un trimestre esplicito (MCP del team) e un valore non valido", () => {
  assert.equal(ok(applyDecision(cards.nuova, { type: "approva", quando: "2027-Q3" }, builder)).patch.targetQuarter, "2027-Q3");
  for (const quando of ["2027-Q5", "subito", ""]) {
    expectError(applyDecision(cards.nuova, { type: "approva", quando: quando as never }, builder), "dati_non_validi", DECISION_MESSAGES.whenInvalid);
  }
});

test("Approva · «Mostralo ai colleghi» toglie la scheda dalla ricerca solo se era nascosta", () => {
  const shown = ok(applyDecision(cards.nascosta, { type: "approva", quando: "piu_avanti", showToColleagues: true }, builder));
  assert.deepEqual(shown.patch.intake, { set: { hiddenFromSearch: false }, remove: [] });
  assert.deepEqual(shown.fields, ["visibilita"]);
  const kept = ok(applyDecision(cards.nascosta, { type: "approva", quando: "piu_avanti" }, builder));
  assert.equal(kept.patch.intake, undefined, "la casella non spuntata lascia la scheda nascosta");
  assert.equal(ok(applyDecision(cards.nuova, { type: "approva", quando: "piu_avanti", showToColleagues: true }, builder)).patch.intake, undefined);
});

test("Approva · vietato fuori da Da valutare", () => {
  for (const c of [...APPROVATO, ...IN_REALIZZAZIONE, ...REALIZZATO, ...CHIUSO]) {
    expectError(applyDecision(c, { type: "approva", quando: "questo_trimestre" }, builder), "transizione_non_ammessa");
  }
});

// ─── Rimanda ─────────────────────────────────────────────────────────

test("Rimanda · Da valutare: status proposed (anche da draft), review_by = data futura → VALUTATA", () => {
  for (const c of DA_VALUTARE) {
    const result = ok(applyDecision(c, { type: "rimanda", reviewBy: "2027-01-14" }, builder));
    assert.deepEqual(result.patch, { status: "proposed", reviewBy: "2027-01-14" });
    const next = after(c, result);
    assert.equal(clientStatus(next), "VALUTATA", "una scheda rimandata il cliente la legge «Valutata»");
    assert.equal(next.phase, "da_valutare");
  }
  assert.equal(after(cards.draft, applyDecision(cards.draft, { type: "rimanda", reviewBy: "2026-10-15" }, builder)).status, "proposed");
});

test("Rimanda · la data è obbligatoria, valida e dopo oggi (a Roma)", () => {
  for (const reviewBy of ["2026-10-14", "2026-10-13", "2025-12-31"]) {
    expectError(applyDecision(cards.nuova, { type: "rimanda", reviewBy: reviewBy as never }, builder), "dati_non_validi", DECISION_MESSAGES.reviewByNotFuture);
  }
  for (const reviewBy of ["", "2027-02-30", "14/01/2027", "domani"]) {
    expectError(applyDecision(cards.nuova, { type: "rimanda", reviewBy: reviewBy as never }, builder), "dati_non_validi", DECISION_MESSAGES.reviewByInvalid);
  }
  // Alle 23:30 UTC del 14 ottobre a Roma è già il 15: il 15 non è più futuro.
  const lateNight = { ...builder, now: new Date("2026-10-14T22:30:00Z") };
  expectError(applyDecision(cards.nuova, { type: "rimanda", reviewBy: "2026-10-15" }, lateNight), "dati_non_validi");
  assert.equal(applyDecision(cards.nuova, { type: "rimanda", reviewBy: "2026-10-15" }, builder).ok, true);
});

test("Rimanda · vietato fuori da Da valutare", () => {
  for (const c of [...APPROVATO, ...IN_REALIZZAZIONE, ...REALIZZATO, ...CHIUSO]) {
    expectError(applyDecision(c, { type: "rimanda", reviewBy: "2027-01-14" }, builder), "transizione_non_ammessa");
  }
});

// ─── Serve info ──────────────────────────────────────────────────────

test("Serve info · Da valutare: needs_inputs, reviewed_by = chi decide, review_by NULL, nota pubblica → SERVONO_INFORMAZIONI", () => {
  for (const c of [cards.nuova, cards.inValutazione, cards.serveInfo, cards.rimandata]) {
    const result = ok(applyDecision(c, { type: "serve_info", publicNote: "  Quante richieste al mese?  " }, builder));
    assert.deepEqual(result.patch, {
      portfolioReviewStatus: "needs_inputs",
      reviewedBy: ME,
      reviewBy: null,
      publicNote: "Quante richieste al mese?",
    });
    assert.equal(clientStatus(after(c, result)), "SERVONO_INFORMAZIONI");
  }
});

test("Serve info · la nota pubblica è obbligatoria, al massimo 1.000 caratteri; la chiede una persona", () => {
  for (const publicNote of ["", "   "]) {
    expectError(applyDecision(cards.nuova, { type: "serve_info", publicNote }, builder), "dati_non_validi", PUBLIC_NOTE_REQUIRED_ERROR);
  }
  expectError(applyDecision(cards.nuova, { type: "serve_info", publicNote: "a".repeat(1001) }, builder), "dati_non_validi", "Massimo 1.000 caratteri.");
  assert.equal(applyDecision(cards.nuova, { type: "serve_info", publicNote: "a".repeat(1000) }, builder).ok, true);
  const system = { ...builder, actor: { ...builder.actor, userId: null } };
  expectError(applyDecision(cards.nuova, { type: "serve_info", publicNote: "Nota" }, system), "permesso_mancante");
});

test("Serve info · vietato fuori da Da valutare", () => {
  for (const c of [...APPROVATO, ...IN_REALIZZAZIONE, ...REALIZZATO, ...CHIUSO]) {
    expectError(applyDecision(c, { type: "serve_info", publicNote: "Nota" }, builder), "transizione_non_ammessa");
  }
});

// ─── Non avviare ─────────────────────────────────────────────────────

const reject: Decision = { type: "non_avviare", publicNote: "Lo copre già un altro strumento." };

test("Non avviare · Da valutare, Approvato, In realizzazione senza dossier: rejected, target_quarter e review_by NULL → NON_AVVIATA", () => {
  for (const c of [...DA_VALUTARE, ...APPROVATO, cards.inRealizzazioneSenzaDossier]) {
    const result = ok(applyDecision(c, reject, builder));
    assert.deepEqual(result.patch, {
      status: "rejected",
      targetQuarter: null,
      reviewBy: null,
      publicNote: "Lo copre già un altro strumento.",
    });
    const next = after(c, result);
    assert.equal(clientStatus(next), "NON_AVVIATA");
    assert.equal(next.phase, "chiuso");
  }
});

test("Non avviare · con il dossier chiuso è ammesso, con un dossier attivo no", () => {
  const closed = withDossier("chiuso");
  assert.equal(closed.phase, "in_realizzazione");
  assert.equal(clientStatus(after(closed, applyDecision(closed, reject, builder))), "NON_AVVIATA");
  for (const status of CASE_STATUSES.filter((s) => s !== "chiuso")) {
    expectError(applyDecision(withDossier(status), reject, builder), "transizione_non_ammessa", DECISION_MESSAGES.rejectActiveDossier);
  }
});

test("Non avviare · nota pubblica obbligatoria; dalla PATCH REST (legacy) no, e la nota resta com'era", () => {
  expectError(applyDecision(cards.nuova, { type: "non_avviare", publicNote: null }, builder), "dati_non_validi", PUBLIC_NOTE_REQUIRED_ERROR);
  expectError(applyDecision(cards.nuova, { type: "non_avviare", publicNote: " " }, builder), "dati_non_validi", PUBLIC_NOTE_REQUIRED_ERROR);
  const legacy = ok(applyDecision(cards.serveInfo, { type: "non_avviare", publicNote: null, legacy: true }, builder));
  assert.deepEqual(legacy.patch, { status: "rejected", targetQuarter: null, reviewBy: null });
  const legacyWithNote = ok(applyDecision(cards.nuova, { type: "non_avviare", publicNote: "Nota", legacy: true }, builder));
  assert.equal(legacyWithNote.patch.publicNote, "Nota");
});

test("Non avviare · vietato da Realizzato e da Chiuso", () => {
  for (const c of [...REALIZZATO, ...CHIUSO]) expectError(applyDecision(c, reject, builder), "transizione_non_ammessa");
});

// ─── Doppione di… ────────────────────────────────────────────────────

const duplicate: Decision = { type: "doppione", ofCode: " xx-0007 " };
const withTarget = { ...builder, duplicateTarget: target };

test("Doppione di… · Da valutare e Approvato: archived, archiveReason duplicato, duplicateOfCode → DOPPIONE", () => {
  for (const c of [...DA_VALUTARE, ...APPROVATO]) {
    const result = ok(applyDecision(c, duplicate, withTarget));
    assert.deepEqual(result.patch, {
      portfolioReviewStatus: "archived",
      intake: { set: { archiveReason: "duplicato", duplicateOfCode: "XX-0007" }, remove: [] },
    });
    const next = after(c, result);
    assert.equal(clientStatus(next), "DOPPIONE");
    assert.equal(next.phase, "chiuso");
  }
});

test("Doppione di… · il codice è di un altro use case dello stesso workspace, mai della scheda stessa", () => {
  expectError(applyDecision(cards.nuova, duplicate, builder), "dati_non_validi", DECISION_MESSAGES.duplicateNotFound);
  expectError(applyDecision(cards.nuova, duplicate, { ...builder, duplicateTarget: null }), "dati_non_validi", DECISION_MESSAGES.duplicateNotFound);
  expectError(applyDecision(cards.nuova, duplicate, { ...builder, duplicateTarget: { id: target.id, code: "XX-0008" } }), "dati_non_validi", DECISION_MESSAGES.duplicateNotFound);
  expectError(applyDecision(cards.nuova, { type: "doppione", ofCode: "XX-0012" }, { ...builder, duplicateTarget: { id: cards.nuova.id, code: "XX-0012" } }), "dati_non_validi", DECISION_MESSAGES.duplicateItself);
  expectError(applyDecision(cards.nuova, { type: "doppione", ofCode: "XX-0012" }, { ...builder, duplicateTarget: { id: target.id, code: "XX-0012" } }), "dati_non_validi", DECISION_MESSAGES.duplicateItself);
  expectError(applyDecision(cards.nuova, { type: "doppione", ofCode: "sette" }, withTarget), "dati_non_validi");
});

test("Doppione di… · vietato da In realizzazione, Realizzato e Chiuso", () => {
  for (const c of [...IN_REALIZZAZIONE, ...REALIZZATO, ...CHIUSO]) expectError(applyDecision(c, duplicate, withTarget), "transizione_non_ammessa");
});

// ─── Archivia ────────────────────────────────────────────────────────

test("Archivia · ogni fase tranne Chiuso: archived, archiveReason, target_quarter e review_by NULL → ARCHIVIATA", () => {
  for (const c of [...DA_VALUTARE, ...APPROVATO, cards.inRealizzazioneSenzaDossier, withDossier("chiuso"), ...REALIZZATO]) {
    for (const reason of ["superato", "ritirato", "fuori_perimetro", "altro"] as const) {
      const result = ok(applyDecision(c, { type: "archivia", reason }, builder));
      assert.deepEqual(result.patch, {
        portfolioReviewStatus: "archived",
        targetQuarter: null,
        reviewBy: null,
        intake: { set: { archiveReason: reason }, remove: [] },
      });
      const next = after(c, result);
      assert.equal(clientStatus(next), "ARCHIVIATA", "anche da Realizzato: la precedenza vince");
      assert.equal(next.phase, "chiuso");
    }
  }
});

test("Archivia · con un dossier attivo: transizione_non_ammessa, «Per archiviarlo, chiudi prima il dossier.»", () => {
  assert.equal(DECISION_MESSAGES.archiveActiveDossier, "Per archiviarlo, chiudi prima il dossier.");
  for (const status of CASE_STATUSES.filter((s) => s !== "chiuso")) {
    expectError(applyDecision(withDossier(status), { type: "archivia", reason: "superato" }, builder), "transizione_non_ammessa", "Per archiviarlo, chiudi prima il dossier.");
  }
});

test("Archivia · motivo obbligatorio dall'elenco; vietato da Chiuso", () => {
  for (const reason of ["duplicato", "", "boh"]) {
    expectError(applyDecision(cards.nuova, { type: "archivia", reason: reason as never }, builder), "dati_non_validi", DECISION_MESSAGES.reasonInvalid);
  }
  for (const c of CHIUSO) expectError(applyDecision(c, { type: "archivia", reason: "altro" }, builder), "transizione_non_ammessa");
});

// ─── Riapri ──────────────────────────────────────────────────────────

test("Riapri · da rejected: status proposed, in_review senza valori del team → IN_VALUTAZIONE", () => {
  const result = ok(applyDecision(cards.nonAvviato, { type: "riapri" }, builder));
  assert.deepEqual(result.patch, { status: "proposed", portfolioReviewStatus: "in_review", targetQuarter: null, reviewBy: null });
  const next = after(cards.nonAvviato, result);
  assert.equal(clientStatus(next), "IN_VALUTAZIONE");
  assert.equal(next.phase, "da_valutare");
});

test("Riapri · da rejected con valori del team: scored → VALUTATA", () => {
  for (const values of [{ customScores: { impact: { efficiency: 3 } } }, { valueEurYear: 60_000 }, { costEurOnce: 40_000 }, { costBand: 2 }]) {
    const c = card({ status: "rejected", portfolioReviewStatus: "scored", ...values });
    const result = ok(applyDecision(c, { type: "riapri" }, builder));
    assert.equal(result.patch.portfolioReviewStatus, "scored", JSON.stringify(values));
    assert.equal(clientStatus(after(c, result)), "VALUTATA");
  }
});

test("Riapri · da archived: stessa regola su portfolio_review_status, si tolgono archiveReason e duplicateOfCode", () => {
  for (const c of [cards.doppione, cards.archiviato]) {
    const result = ok(applyDecision(c, { type: "riapri" }, builder));
    assert.deepEqual(result.patch, {
      portfolioReviewStatus: "in_review",
      targetQuarter: null,
      reviewBy: null,
      intake: { set: {}, remove: ["archiveReason", "duplicateOfCode"] },
    });
    const next = after(c, result);
    assert.equal(next.intake?.archiveReason, undefined);
    assert.equal(next.intake?.duplicateOfCode, undefined);
    assert.equal(clientStatus(next), "IN_VALUTAZIONE");
  }
  // Gli altri dati di intake restano.
  assert.equal(after(cards.archiviato, applyDecision(cards.archiviato, { type: "riapri" }, builder)).intake?.area, "acquisti");
});

test("Riapri · da archived con valori del team: scored → VALUTATA, senza archiveReason né duplicateOfCode", () => {
  const values = [{ customScores: { impact: { efficiency: 3 } } }, { valueEurYear: 60_000 }, { costEurOnce: 40_000 }, { costBand: 2 }];
  for (const intake of [{ archiveReason: "superato" }, { archiveReason: "duplicato", duplicateOfCode: "XX-0007" }]) {
    for (const value of values) {
      const c = card({ portfolioReviewStatus: "archived", intake, ...value });
      const label = `${intake.archiveReason} · ${JSON.stringify(value)}`;
      const result = ok(applyDecision(c, { type: "riapri" }, builder));
      assert.deepEqual(
        result.patch,
        { portfolioReviewStatus: "scored", targetQuarter: null, reviewBy: null, intake: { set: {}, remove: ["archiveReason", "duplicateOfCode"] } },
        label,
      );
      const next = after(c, result);
      assert.equal(next.intake?.archiveReason, undefined, label);
      assert.equal(next.intake?.duplicateOfCode, undefined, label);
      assert.equal(clientStatus(next), "VALUTATA", label);
      assert.equal(next.phase, "da_valutare", label);
    }
  }
});

test("Riapri · da archived lo stato resta com'era: torna dov'era, non in «Da decidere» (§15 punto 10)", () => {
  // «Riapri» non è un passaggio da accepted, in_progress o implemented: i passaggi nuovi sono
  // solo draft → proposed e rejected → proposed, e «Approvato → Da decidere» non esiste.
  // «Dopo, per il cliente» (IN_VALUTAZIONE o VALUTATA) vale per le schede archiviate da Da valutare.
  const expected: Array<[DecisionCard, string, Phase]> = [
    [cards.archiviatoDaApprovato, "APPROVATA", "approvato"],
    [cards.archiviatoInRealizzazione, "IN_SVILUPPO", "in_realizzazione"],
    [cards.archiviatoRealizzato, "REALIZZATA", "realizzato"],
  ];
  for (const [c, code, phase] of expected) {
    const result = ok(applyDecision(c, { type: "riapri" }, builder));
    assert.equal(result.patch.status, undefined, c.status);
    const next = after(c, result);
    assert.equal(next.status, c.status);
    assert.equal(clientStatus(next), code, c.status);
    assert.equal(next.phase, phase, c.status);
  }
  // Approvato senza trimestre: «Approvato · Più avanti».
  assert.equal(after(cards.archiviatoDaApprovato, applyDecision(cards.archiviatoDaApprovato, { type: "riapri" }, builder)).targetQuarter, null);
});

test("Riapri · con un dossier collegato non torna mai in «Da decidere»", () => {
  assert.equal(DECISION_MESSAGES.reopenWithDossier, "Ha già un dossier: non può tornare in «Da decidere».");
  // Un «Non avviato» con il dossier, chiuso o riaperto nei Casi d'uso: resta chiuso. Con
  // status proposed e il dossier collegato sarebbe «In realizzazione», senza decisioni possibili.
  for (const dossierStatus of CASE_STATUSES) {
    const c = card({ status: "rejected", portfolioReviewStatus: "scored", dossierStatus });
    assert.equal(c.phase, "chiuso");
    expectError(applyDecision(c, { type: "riapri" }, builder), "transizione_non_ammessa", DECISION_MESSAGES.reopenWithDossier);
  }
  // Un archiviato col dossier torna dov'era: In realizzazione (dossier chiuso) o Realizzato.
  const reopened = after(cards.archiviatoConDossier, applyDecision(cards.archiviatoConDossier, { type: "riapri" }, builder));
  assert.equal(reopened.status, "accepted");
  assert.equal(clientStatus(reopened), "AVVIATA_COME_CASO");
  assert.equal(reopened.phase, "in_realizzazione");
  // Da lì le decisioni del dossier chiuso restano possibili.
  assert.equal(applyDecision(reopened, reject, builder).ok, true, "Non avviare");
  assert.equal(applyDecision(reopened, { type: "archivia", reason: "superato" }, builder).ok, true, "Archivia");
  const realized = after(cards.archiviatoRealizzatoConDossier, applyDecision(cards.archiviatoRealizzatoConDossier, { type: "riapri" }, builder));
  assert.equal(clientStatus(realized), "REALIZZATA");
  assert.equal(realized.phase, "realizzato");
});

test("Riapri · nessuna scheda chiusa finisce in uno stato senza decisioni possibili", () => {
  // Ogni combinazione di stato, archiviazione e dossier che dà la fase Chiuso.
  const closed: DecisionCard[] = [];
  for (const status of ["draft", "proposed", "accepted", "in_progress", "implemented", "rejected"] as const) {
    for (const intake of [null, { archiveReason: "superato" }, { archiveReason: "duplicato", duplicateOfCode: "XX-0007" }]) {
      for (const dossierStatus of [null, ...CASE_STATUSES]) {
        const c = card({ status, portfolioReviewStatus: intake ? "archived" : "in_review", intake, dossierStatus });
        if (c.phase === "chiuso") closed.push(c);
      }
    }
  }
  assert.ok(closed.length > 0);
  for (const c of closed) {
    const label = `${c.status} · ${c.portfolioReviewStatus} · dossier ${c.dossierStatus ?? "no"}`;
    const result = applyDecision(c, { type: "riapri" }, builder);
    if (!result.ok) {
      expectError(result, "transizione_non_ammessa", DECISION_MESSAGES.reopenWithDossier);
      assert.notEqual(c.dossierStatus, null, label);
      continue;
    }
    const next = after(c, result);
    assert.notEqual(next.phase, "chiuso", label);
    // Con un dossier collegato mai draft o proposed: la scheda sarebbe «In realizzazione» senza uscita.
    if (next.dossierStatus !== null) assert.ok(next.status !== "draft" && next.status !== "proposed", label);
    if (next.phase === "da_valutare") assert.ok(["IN_VALUTAZIONE", "VALUTATA"].includes(clientStatus(next)), label);
    // Almeno una decisione è di nuovo possibile, tranne «In realizzazione» col dossier attivo:
    // lì la scheda avanza col dossier, come ogni scheda avviata (§6.4).
    const possible = decisions.some((d) => applyDecision(next, d, ctxFor(d, lateral)).ok) || applyWhen(next, "piu_avanti", builder).ok;
    const advancesWithDossier = next.phase === "in_realizzazione" && next.dossierStatus !== null && next.dossierStatus !== "chiuso";
    assert.ok(possible || advancesWithDossier, label);
  }
});

test("Riapri · vietato fuori da Chiuso", () => {
  for (const c of [...DA_VALUTARE, ...APPROVATO, ...IN_REALIZZAZIONE, ...REALIZZATO]) {
    expectError(applyDecision(c, { type: "riapri" }, builder), "transizione_non_ammessa");
  }
});

test("«Serve info», poi «Non avviare», poi «Riapri»: IN_VALUTAZIONE, non SERVONO_INFORMAZIONI (riga 23 di §3.5)", () => {
  let c = cards.nuova;
  c = after(c, applyDecision(c, { type: "serve_info", publicNote: "Quante richieste al mese?" }, builder));
  assert.equal(clientStatus(c), "SERVONO_INFORMAZIONI");
  c = after(c, applyDecision(c, { type: "non_avviare", publicNote: "Senza volumi non lo avviamo." }, builder));
  assert.equal(clientStatus(c), "NON_AVVIATA");
  c = after(c, applyDecision(c, { type: "riapri" }, builder));
  // Persona e nota pubblica ci sono ancora, ma la revisione è in_review.
  assert.equal(c.reviewedBy, ME);
  assert.equal(c.publicNote, "Senza volumi non lo avviamo.");
  assert.equal(c.status, "proposed");
  assert.equal(c.portfolioReviewStatus, "in_review");
  assert.equal(clientStatus(c), "IN_VALUTAZIONE");
  assert.equal(c.phase, "da_valutare");
});

// ─── Dopo una risposta a «Serve info» (D17) ──────────────────────────

test("D17 · «Approva», «Rimanda», «Doppione di…» e «Archivia» salvano la nota pubblica con la decisione, nella stessa patch", () => {
  const asked = card({ portfolioReviewStatus: "in_review", reviewedBy: ME, publicNote: "Quante visite al mese?" });
  const withNote: Decision[] = [
    { type: "approva", quando: "piu_avanti", publicNote: "  Approvato, partiamo a gennaio.  " },
    { type: "rimanda", reviewBy: "2026-11-14", publicNote: "  Approvato, partiamo a gennaio.  " },
    { type: "doppione", ofCode: "XX-0007", publicNote: "  Approvato, partiamo a gennaio.  " },
    { type: "archivia", reason: "superato", publicNote: "  Approvato, partiamo a gennaio.  " },
  ];
  for (const d of withNote) {
    const result = ok(applyDecision(asked, d, ctxFor(d)));
    assert.equal(result.patch.publicNote, "Approvato, partiamo a gennaio.", d.type);
    assert.ok(result.fields.includes("nota_pubblica"), d.type);
    // Vuota: la nota si toglie. Assente: non cambia.
    const cleared = ok(applyDecision(asked, { ...d, publicNote: "   " } as Decision, ctxFor(d)));
    assert.equal(cleared.patch.publicNote, null, d.type);
    const without = { ...d } as Decision & { publicNote?: string };
    delete without.publicNote;
    const untouched = ok(applyDecision(asked, without, ctxFor(d)));
    assert.equal("publicNote" in untouched.patch, false, d.type);
    assert.equal(untouched.fields.includes("nota_pubblica"), false, d.type);
    // Troppo lunga: niente decisione, l'errore sul campo.
    const long = applyDecision(asked, { ...d, publicNote: "x".repeat(1001) } as Decision, ctxFor(d));
    expectError(long, "dati_non_validi");
    assert.ok(!long.ok && long.fieldErrors?.publicNote, d.type);
  }
  // La regola della decisione resta prima della nota: fuori fase non passa, con o senza nota.
  expectError(applyDecision(cards.realizzato, withNote[0], builder), "transizione_non_ammessa");
});

test("D17 · ogni decisione toglie `intake.rispostaInAttesa`; senza il segno la patch non cambia", () => {
  const answered = card({
    portfolioReviewStatus: "in_review",
    reviewedBy: ME,
    publicNote: "Quante visite al mese?",
    intake: { risposte: [{ at: "2026-10-13T09:00:00.000Z", text: "Circa 40." }], rispostaInAttesa: "2026-10-13T09:00:00.000Z" },
  });
  for (const d of decisions) {
    const c = d.type === "riapri" ? { ...answered, status: "rejected" as const, phase: "chiuso" as const } : d.type.startsWith("segna_") ? null : answered;
    if (!c) continue;
    const result = ok(applyDecision(c, d, ctxFor(d)));
    assert.ok(result.patch.intake?.remove.includes("rispostaInAttesa"), d.type);
    const next = applyDecisionPatch(c, result.patch);
    assert.equal(Object.hasOwn(next.intake ?? {}, "rispostaInAttesa"), false, d.type);
    assert.equal((next.intake as { risposte: unknown[] }).risposte.length, 1, `${d.type}: le risposte restano`);
  }
  // Nessun segno: la patch di sempre (lo provano anche i test sopra con `deepEqual`).
  const plain = ok(applyDecision(cards.nuova, { type: "rimanda", reviewBy: "2026-11-14" }, builder));
  assert.equal(plain.patch.intake, undefined);
});

// ─── Quando ──────────────────────────────────────────────────────────

test("Quando · Approvato: cambia solo target_quarter → APPROVATA", () => {
  for (const c of APPROVATO) {
    const result = ok(applyWhen(c, "prossimo_trimestre", builder));
    assert.deepEqual(result.patch, { targetQuarter: "2027-Q1" });
    assert.equal(result.action, "quando");
    assert.equal(clientStatus(after(c, result)), "APPROVATA");
  }
  assert.equal(ok(applyWhen(cards.approvatoTrimestre, "piu_avanti", builder)).patch.targetQuarter, null);
  assert.equal(ok(applyWhen(cards.approvatoTrimestre, "2027-Q3", builder)).patch.targetQuarter, "2027-Q3");
  // La Storia nomina «quando» solo se il trimestre cambia.
  assert.deepEqual(ok(applyWhen(cards.approvatoTrimestre, "questo_trimestre", builder)).fields, ["quando"]);
  assert.deepEqual(ok(applyWhen(cards.approvatoTrimestre, "2027-Q1", builder)).fields, []);
  expectError(applyWhen(cards.approvatoTrimestre, "T1 2027", builder), "dati_non_validi", DECISION_MESSAGES.whenInvalid);
});

test("Quando · solo in fase Approvato", () => {
  for (const c of [...DA_VALUTARE, ...IN_REALIZZAZIONE, ...REALIZZATO, ...CHIUSO]) {
    expectError(applyWhen(c, "questo_trimestre", builder), "transizione_non_ammessa");
  }
});

// ─── Segna come diffusa ──────────────────────────────────────────────

test("Segna come diffusa · Approvato «Da diffondere»: implemented → REALIZZATA", () => {
  const result = ok(applyDecision(cards.approvatoDiffondere, { type: "segna_diffusa" }, builder));
  assert.deepEqual(result.patch, { status: "implemented" });
  assert.equal(clientStatus(after(cards.approvatoDiffondere, result)), "REALIZZATA");
  for (const c of [cards.approvatoTrimestre, cards.approvatoTipoNull, ...DA_VALUTARE, ...IN_REALIZZAZIONE, ...REALIZZATO, ...CHIUSO]) {
    expectError(applyDecision(c, { type: "segna_diffusa" }, builder), "transizione_non_ammessa");
  }
});

// ─── Segna come realizzato ───────────────────────────────────────────

test("Segna come realizzato · In realizzazione senza dossier: sempre → REALIZZATA", () => {
  const result = ok(applyDecision(cards.inRealizzazioneSenzaDossier, { type: "segna_realizzato" }, builder));
  assert.deepEqual(result.patch, { status: "implemented" });
  assert.equal(clientStatus(after(cards.inRealizzazioneSenzaDossier, result)), "REALIZZATA");
});

test("Segna come realizzato · con un dossier solo se è «In uso» o «Misura del valore»", () => {
  assert.deepEqual(DOSSIER_IN_USE_STATUSES, ["in_esercizio", "misura_roi"]);
  for (const status of CASE_STATUSES) {
    const result = applyDecision(withDossier(status), { type: "segna_realizzato" }, builder);
    if (status === "in_esercizio" || status === "misura_roi") {
      assert.equal(clientStatus(after(withDossier(status), result)), "REALIZZATA", status);
    } else {
      expectError(result, "transizione_non_ammessa", DECISION_MESSAGES.realizedNeedsDossierInUse);
    }
  }
});

test("Segna come realizzato · vietato fuori da In realizzazione", () => {
  for (const c of [...DA_VALUTARE, ...APPROVATO, ...REALIZZATO, ...CHIUSO]) {
    expectError(applyDecision(c, { type: "segna_realizzato" }, builder), "transizione_non_ammessa");
  }
});

// ─── Segna come in realizzazione ─────────────────────────────────────

const dossiersOff: DecisionContext = { ...lateral, ucSectionEnabled: false };

test("Segna come in realizzazione · Approvato «Da costruire», sezione Casi d'uso spenta, Lateral Space → in_progress, IN_SVILUPPO", () => {
  for (const c of [cards.approvatoTrimestre, cards.approvatoPiuAvanti, cards.approvatoScaduto, cards.approvatoTipoNull]) {
    const result = ok(applyDecision(c, { type: "segna_in_realizzazione" }, dossiersOff));
    assert.deepEqual(result.patch, { status: "in_progress" });
    const next = after(c, result);
    assert.equal(clientStatus(next), "IN_SVILUPPO");
    assert.equal(next.phase, "in_realizzazione");
  }
});

test("Segna come in realizzazione · solo Lateral Space, solo con la sezione spenta, solo «Da costruire» approvati", () => {
  expectError(applyDecision(cards.approvatoTrimestre, { type: "segna_in_realizzazione" }, { ...builder, ucSectionEnabled: false }), "permesso_mancante", DECISION_MESSAGES.onlyLateralSpace);
  expectError(applyDecision(cards.approvatoTrimestre, { type: "segna_in_realizzazione" }, lateral), "transizione_non_ammessa", DECISION_MESSAGES.dossiersOn);
  expectError(applyDecision(cards.approvatoDiffondere, { type: "segna_in_realizzazione" }, dossiersOff), "transizione_non_ammessa");
  for (const c of [...DA_VALUTARE, ...IN_REALIZZAZIONE, ...REALIZZATO, ...CHIUSO]) {
    expectError(applyDecision(c, { type: "segna_in_realizzazione" }, dossiersOff), "transizione_non_ammessa");
  }
});

// ─── Avvia la realizzazione ──────────────────────────────────────────

test("Avvia la realizzazione · Approvato «Da costruire» senza dossier, solo Lateral Space; status resta accepted", () => {
  for (const c of [cards.approvatoTrimestre, cards.approvatoPiuAvanti, cards.approvatoTipoNull]) {
    assert.deepEqual(checkStartRealization(c, lateral), { ok: true });
  }
  // Dopo l'avvio la fase la dà il collegamento: accepted con un dossier è AVVIATA_COME_CASO.
  assert.equal(clientStatus({ ...cards.approvatoTrimestre, dossierStatus: "raccolta" }), "AVVIATA_COME_CASO");
  expectError(checkStartRealization(cards.approvatoTrimestre, builder), "permesso_mancante", DECISION_MESSAGES.onlyLateralSpace);
  expectError(checkStartRealization(cards.approvatoTrimestre, contributor), "permesso_mancante");
  expectError(checkStartRealization(cards.approvatoTrimestre, dossiersOff), "transizione_non_ammessa", DECISION_MESSAGES.dossiersOff);
  expectError(checkStartRealization(cards.approvatoTrimestre, { ...lateral, dossierReadFailed: true }), "riprova");
  for (const c of [cards.approvatoDiffondere, ...DA_VALUTARE, ...IN_REALIZZAZIONE, ...REALIZZATO, ...CHIUSO]) {
    expectError(checkStartRealization(c, lateral), "transizione_non_ammessa");
  }
});

// ─── Chi decide (D3) ─────────────────────────────────────────────────

test("D3 · il contributore non decide nulla", () => {
  for (const c of ALL) {
    for (const d of decisions) expectError(applyDecision(c, d, ctxFor(d, contributor)), "permesso_mancante", DECISION_MESSAGES.notReviewer);
    expectError(applyWhen(c, "questo_trimestre", contributor), "permesso_mancante");
  }
});

test("D3 · l'AI Builder del cliente prende tutte le decisioni tranne «Segna come in realizzazione» e «Avvia»", () => {
  const cases: Array<[DecisionCard, Decision]> = [
    [cards.nuova, { type: "approva", quando: "questo_trimestre" }],
    [cards.nuova, { type: "rimanda", reviewBy: "2027-01-14" }],
    [cards.nuova, { type: "serve_info", publicNote: "Nota" }],
    [cards.nuova, reject],
    [cards.nuova, duplicate],
    [cards.nuova, { type: "archivia", reason: "ritirato" }],
    [cards.nonAvviato, { type: "riapri" }],
    [cards.approvatoDiffondere, { type: "segna_diffusa" }],
    [withDossier("in_esercizio"), { type: "segna_realizzato" }],
  ];
  for (const [c, d] of cases) assert.equal(applyDecision(c, d, withTarget).ok, true, d.type);
  assert.equal(applyWhen(cards.approvatoTrimestre, "prossimo_trimestre", builder).ok, true);
  expectError(applyDecision(cards.approvatoTrimestre, { type: "segna_in_realizzazione" }, { ...builder, ucSectionEnabled: false }), "permesso_mancante");
  expectError(checkStartRealization(cards.approvatoTrimestre, builder), "permesso_mancante");
});

// ─── Lettura del dossier fallita (§9.1 passo 2) ──────────────────────

test("dossier non leggibile: le decisioni che ne dipendono rispondono riprova, le altre proseguono", () => {
  const failed: DecisionContext = { ...withTarget, dossierReadFailed: true };
  const unreadable = DECISION_MESSAGES.dossierUnreadable;
  assert.equal(unreadable, "Non riesco a leggere lo stato del dossier. Riprova tra poco.");
  expectError(applyDecision(cards.nuova, reject, failed), "riprova", unreadable);
  expectError(applyDecision(cards.approvatoTrimestre, reject, failed), "riprova", unreadable);
  expectError(applyDecision(cards.nuova, duplicate, failed), "riprova", unreadable);
  expectError(applyDecision(cards.approvatoTrimestre, { type: "archivia", reason: "superato" }, failed), "riprova", unreadable);
  expectError(applyDecision(cards.inRealizzazioneSenzaDossier, { type: "archivia", reason: "superato" }, failed), "riprova", unreadable);
  expectError(applyDecision(cards.inRealizzazioneSenzaDossier, { type: "segna_realizzato" }, failed), "riprova", unreadable);
  expectError(applyDecision(cards.nonAvviato, { type: "riapri" }, failed), "riprova", unreadable);
  // Le altre scritture passano.
  assert.equal(applyDecision(cards.nuova, { type: "approva", quando: "piu_avanti" }, failed).ok, true);
  assert.equal(applyDecision(cards.nuova, { type: "rimanda", reviewBy: "2027-01-14" }, failed).ok, true);
  assert.equal(applyDecision(cards.nuova, { type: "serve_info", publicNote: "Nota" }, failed).ok, true);
  assert.equal(applyDecision(cards.nuova, { type: "archivia", reason: "superato" }, failed).ok, true, "Archivia da Da valutare");
  assert.equal(applyDecision(cards.realizzato, { type: "archivia", reason: "superato" }, failed).ok, true, "Archivia da Realizzato");
  assert.equal(applyDecision(cards.approvatoDiffondere, { type: "segna_diffusa" }, failed).ok, true);
  assert.equal(applyWhen(cards.approvatoTrimestre, "prossimo_trimestre", failed).ok, true);
});

// ─── §3.6: «Quando» e data di revisione, mai sovrapposti ─────────────

test("§3.6 · target_quarter si scrive con «Approva» e «Quando», si azzera con «Non avviare», «Archivia», «Riapri»", () => {
  assert.equal(ok(applyDecision(cards.nuova, { type: "approva", quando: "prossimo_trimestre" }, builder)).patch.targetQuarter, "2027-Q1");
  assert.equal(ok(applyWhen(cards.approvatoPiuAvanti, "questo_trimestre", builder)).patch.targetQuarter, "2026-Q4");
  assert.equal(ok(applyDecision(cards.approvatoTrimestre, reject, builder)).patch.targetQuarter, null);
  assert.equal(ok(applyDecision(cards.approvatoTrimestre, { type: "archivia", reason: "altro" }, builder)).patch.targetQuarter, null);
  assert.equal(ok(applyDecision(cards.archiviatoDaApprovato, { type: "riapri" }, builder)).patch.targetQuarter, null);
  // Le altre decisioni non lo toccano.
  for (const [c, d] of [
    [cards.nuova, { type: "rimanda", reviewBy: "2027-01-14" }],
    [cards.nuova, { type: "serve_info", publicNote: "Nota" }],
    [cards.approvatoDiffondere, { type: "segna_diffusa" }],
    [cards.inRealizzazioneSenzaDossier, { type: "segna_realizzato" }],
  ] as Array<[DecisionCard, Decision]>) {
    assert.equal(ok(applyDecision(c, d, builder)).patch.targetQuarter, undefined, d.type);
  }
});

test("§3.6 · review_by si scrive con «Rimanda», si azzera con «Approva», «Non avviare», «Archivia», «Riapri» (e «Serve info», §3.7)", () => {
  const parked = cards.rimandata;
  assert.equal(ok(applyDecision(cards.nuova, { type: "rimanda", reviewBy: "2027-01-14" }, builder)).patch.reviewBy, "2027-01-14");
  for (const d of [{ type: "approva", quando: "piu_avanti" }, reject, { type: "archivia", reason: "superato" }, { type: "serve_info", publicNote: "Nota" }] as Decision[]) {
    const result = ok(applyDecision(parked, d, builder));
    assert.equal(result.patch.reviewBy, null, d.type);
    assert.ok(result.fields.includes("revisione"), d.type);
  }
  assert.equal(ok(applyDecision(cards.nonAvviato, { type: "riapri" }, builder)).patch.reviewBy, null);
});

test("§3.6 · i due campi non si sovrappongono: un approvato non ha review_by, un rimandato non ha target_quarter", () => {
  const approved = after(cards.rimandata, applyDecision(cards.rimandata, { type: "approva", quando: "questo_trimestre" }, builder));
  assert.equal(approved.reviewBy, null);
  assert.equal(approved.targetQuarter, "2026-Q4");
  const parked = after(cards.nuova, applyDecision(cards.nuova, { type: "rimanda", reviewBy: "2027-01-14" }, builder));
  assert.equal(parked.targetQuarter, null);
  assert.equal(parked.reviewBy, "2027-01-14");
});

// ─── Ciclo di vita: i passaggi nuovi vivono solo qui ─────────────────

test("use-case-lifecycle.ts non cambia: allowedNextStatuses('rejected') resta vuoto", () => {
  assert.deepEqual(allowedNextStatuses("rejected"), []);
  assert.equal(isAllowedStatusTransition("draft", "proposed"), false);
  assert.equal(isAllowedStatusTransition("rejected", "proposed"), false);
});

test("ogni cambio di stato ammesso è un passaggio della mappa di oggi, oppure draft → proposed o rejected → proposed", () => {
  const NEW = new Set(["draft>proposed", "rejected>proposed"]);
  const seen = new Set<string>();
  for (const c of ALL) {
    for (const d of decisions) {
      const result = applyDecision(c, d, ctxFor(d));
      if (!result.ok || result.patch.status === undefined || result.patch.status === c.status) continue;
      const step = `${c.status}>${result.patch.status}`;
      seen.add(step);
      assert.ok(isAllowedStatusTransition(c.status, result.patch.status) || NEW.has(step), `${d.type}: ${step}`);
    }
  }
  assert.ok(seen.has("draft>proposed"), "Rimanda da draft");
  assert.ok(seen.has("rejected>proposed"), "Riapri da rejected");
});

test("nessuna decisione cancella: ogni esito tocca solo le colonne di §3.7", () => {
  const allowed = new Set(["status", "portfolioReviewStatus", "targetQuarter", "reviewBy", "reviewedBy", "publicNote", "intake"]);
  for (const c of ALL) {
    for (const d of decisions) {
      const result = applyDecision(c, d, ctxFor(d));
      if (result.ok) for (const key of Object.keys(result.patch)) assert.ok(allowed.has(key), `${d.type}: ${key}`);
    }
  }
});

// ─── Patch e Storia ──────────────────────────────────────────────────

test("la patch di intake toglie e poi scrive, e lascia le altre chiavi", () => {
  assert.deepEqual(applyIntakeChange(null, { set: { archiveReason: "altro" }, remove: [] }), { archiveReason: "altro" });
  assert.deepEqual(
    applyIntakeChange({ archiveReason: "duplicato", duplicateOfCode: "XX-0007", area: "acquisti" }, { set: {}, remove: ["archiveReason", "duplicateOfCode"] }),
    { area: "acquisti" },
  );
  assert.deepEqual(applyIntakeChange({ hiddenFromSearch: true, tools: ["x"] }, { set: { hiddenFromSearch: false }, remove: [] }), { hiddenFromSearch: false, tools: ["x"] });
});

test("la Storia nomina solo i campi che cambiano davvero, mai i valori", () => {
  assert.deepEqual(ok(applyDecision(cards.nuova, { type: "approva", quando: "piu_avanti" }, builder)).fields, []);
  assert.deepEqual(ok(applyDecision(cards.nuova, { type: "approva", quando: "questo_trimestre" }, builder)).fields, ["quando"]);
  assert.deepEqual(ok(applyDecision(cards.rimandata, { type: "approva", quando: "questo_trimestre" }, builder)).fields, ["quando", "revisione"]);
  assert.deepEqual(ok(applyDecision(cards.nuova, { type: "serve_info", publicNote: "Nota" }, builder)).fields, ["nota_pubblica"]);
  assert.deepEqual(ok(applyDecision(cards.serveInfo, { type: "serve_info", publicNote: "Quante richieste al mese?" }, builder)).fields, []);
  for (const c of ALL) {
    for (const d of decisions) {
      const result = applyDecision(c, d, ctxFor(d));
      if (result.ok) assert.ok(result.fields.every((f) => /^[a-z_]+$/.test(f)), `${d.type}: ${result.fields.join(",")}`);
    }
  }
});

test("gli errori dei dati indicano il campo", () => {
  const result = applyDecision(cards.nuova, { type: "serve_info", publicNote: "" }, builder);
  assert.deepEqual(result, { ok: false, error: "dati_non_validi", message: PUBLIC_NOTE_REQUIRED_ERROR, fieldErrors: { publicNote: PUBLIC_NOTE_REQUIRED_ERROR } });
  assert.notEqual(PUBLIC_NOTE_REQUIRED_ERROR, COST_AMOUNT_ERROR);
});
