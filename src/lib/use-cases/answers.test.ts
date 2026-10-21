import test from "node:test";
import assert from "node:assert/strict";
import {
  ANSWER_MAX,
  ANSWER_PENDING_INTAKE_KEY,
  ANSWER_TEXT,
  ANSWERS_KEPT,
  answerHint,
  answerRefusal,
  answerSignalTitle,
  answersOf,
  askedTitle,
  isAnswerPending,
  parseAnswerText,
  pendingAnswer,
  questionLabel,
  sameQuestion,
  withAnswer,
} from "./answers.ts";
import { DEFAULT_REVIEW_TEAM_NAME } from "../review-team.ts";
import { findHubForbidden } from "./copy-guard.ts";
import { applyDecision, applyDecisionPatch, type DecisionCard } from "./decisions.ts";
import { phaseOfUseCase } from "./phase.ts";
import type { Decision } from "./types.ts";

// «Rispondi» su «Serve info» (D17): regole pure. Testi sintetici.

test("il testo della risposta: semplice, a capo uniformi, senza caratteri di controllo, da 3 a 2.000 caratteri", () => {
  assert.deepEqual(parseAnswerText("  Circa 120 a settimana.\r\n\r\n\r\n\r\nIl lunedì il doppio.  "), { ok: true, value: "Circa 120 a settimana.\n\nIl lunedì il doppio." });
  assert.deepEqual(parseAnswerText("Uno\u0000\u0007 due\ttre"), { ok: true, value: "Uno due\ttre" });
  assert.deepEqual(parseAnswerText("riga   \nriga"), { ok: true, value: "riga\nriga" });
  for (const raw of ["", "   ", "ok", null, 42, undefined, { text: "Una risposta" }]) {
    const parsed = parseAnswerText(raw);
    assert.equal(parsed.ok, false, JSON.stringify(raw));
  }
  assert.equal(parseAnswerText("x".repeat(ANSWER_MAX)).ok, true);
  assert.deepEqual(parseAnswerText("x".repeat(ANSWER_MAX + 1)), { ok: false, error: ANSWER_TEXT.tooLong });
  assert.equal(ANSWER_TEXT.tooLong, "Scrivi al massimo 2.000 caratteri.");
  // I caratteri contano come lettere, non come unità UTF-16.
  assert.equal(parseAnswerText("😀".repeat(ANSWER_MAX)).ok, true);
});

test("risponde solo chi ha proposto, solo in «Serve info»", () => {
  assert.equal(answerRefusal({ own: true, phase: "da_valutare", subState: "serve_info" }), null);
  assert.equal(answerRefusal({ own: false, phase: "da_valutare", subState: "serve_info" }), "non_propria");
  for (const [phase, subState] of [
    ["da_valutare", "nuova"],
    ["da_valutare", "valutata"],
    ["da_valutare", "rimandata"],
    ["approvato", "trimestre"],
    ["chiuso", "non_avviato"],
  ]) {
    assert.equal(answerRefusal({ own: true, phase, subState }), "non_richiesta", `${phase}.${subState}`);
  }
});

test("la risposta vale per la domanda letta: la nota pubblica come la legge chi ha proposto", () => {
  assert.equal(sameQuestion("Quante a settimana?", "Quante a settimana?"), true);
  assert.equal(sameQuestion("Quante a settimana?", "Quante al giorno?"), false);
  assert.equal(sameQuestion("Quante a settimana?", null), false);
  assert.equal(sameQuestion(null, "Quante al giorno?"), false);
  // Una nota vuota la proiezione del contributore la manda come null.
  for (const [seen, current] of [
    [null, null],
    [null, ""],
    [null, "   "],
    ["", null],
  ] as const) {
    assert.equal(sameQuestion(seen, current), true, `${JSON.stringify(seen)} / ${JSON.stringify(current)}`);
  }
  // Il confronto è sul testo intero, spazi compresi: è il testo che la pagina mostrava.
  assert.equal(sameQuestion("Quante a settimana?", "Quante a settimana? "), false);
});

test("le risposte in intake: in coda, le ultime 20, malformate saltate; nessun dato su chi risponde", () => {
  assert.deepEqual(answersOf(null), []);
  assert.deepEqual(answersOf({ risposte: "testo" }), []);
  const valid = { at: "2026-10-19T10:00:00.000Z", text: "Prima." };
  assert.deepEqual(answersOf({ risposte: [valid, { at: "ieri", text: "x" }, { at: valid.at, text: " " }, { text: "senza data" }, "stringa"] }), [valid]);
  const many = Array.from({ length: ANSWERS_KEPT }, (_, i) => ({ at: `2026-10-${String(i + 1).padStart(2, "0")}T10:00:00.000Z`, text: `Risposta ${i + 1}` }));
  const next = withAnswer({ risposte: many }, { at: "2026-10-30T10:00:00.000Z", text: "Ultima." });
  assert.equal(next.length, ANSWERS_KEPT);
  assert.equal(next[0].text, "Risposta 2");
  assert.equal(next.at(-1)?.text, "Ultima.");
  for (const answer of next) assert.deepEqual(Object.keys(answer).sort(), ["at", "text"]);
});

test("il segnale della campanella: codice e titolo, mai il testo; al massimo 500 caratteri", () => {
  assert.equal(answerSignalTitle({ code: "XX-0024", title: "Riepilogo delle chiamate" }), "Risposta ricevuta: XX-0024 Riepilogo delle chiamate");
  assert.equal(answerSignalTitle({ code: null, title: "Senza codice" }), "Risposta ricevuta: Senza codice");
  assert.equal([...answerSignalTitle({ code: "XX-0001", title: "x".repeat(600) })].length, 500);
});

test("i testi di «Rispondi» rispettano il copy-guard dell'area", () => {
  for (const text of Object.values(ANSWER_TEXT)) assert.deepEqual(findHubForbidden(text, "area"), [], text);
});

test("i testi che nominano chi valuta usano il nome del team da solo, senza «team» davanti (§14.2, H7)", () => {
  for (const name of [DEFAULT_REVIEW_TEAM_NAME, "Digital Factory"]) {
    for (const text of [askedTitle(name), questionLabel(name), answerHint(name)]) {
      assert.ok(text.includes(name), text);
      assert.doesNotMatch(text, /\bteam\b|\b(il|del|al) (AI|Digital|CoE)/i, text);
      assert.deepEqual(findHubForbidden(text, "area"), [], text);
    }
  }
  assert.equal(askedTitle("Digital Factory"), "Digital Factory ti chiede informazioni");
  assert.equal(questionLabel("CoE AI"), "La domanda di CoE AI");
  for (const text of Object.values(ANSWER_TEXT)) assert.doesNotMatch(text, /\bdel team\b/, text);
});

test("la risposta in attesa di decisione: solo con `rispostaInAttesa` sull'ultima, in «Da valutare» e non in «Serve info»", () => {
  const answers = [
    { at: "2026-10-01T09:00:00.000Z", text: "Prima" },
    { at: "2026-10-05T09:00:00.000Z", text: "Seconda" },
  ];
  const intake = { risposte: answers, [ANSWER_PENDING_INTAKE_KEY]: answers[1].at };
  assert.equal(ANSWER_PENDING_INTAKE_KEY, "rispostaInAttesa");
  assert.equal(isAnswerPending({ intake, phase: "da_valutare", subState: "nuova" }), true);
  assert.equal(pendingAnswer({ intake, phase: "da_valutare", subState: "nuova" })?.text, "Seconda");
  assert.equal(pendingAnswer({ intake, phase: "da_valutare", subState: "possibile_doppione" })?.text, "Seconda");
  assert.equal(pendingAnswer({ intake, phase: "da_valutare", subState: "serve_info" }), null, "una domanda nuova aspetta una risposta nuova");
  assert.equal(pendingAnswer({ intake, phase: "approvato", subState: "trimestre" }), null, "già deciso");
  assert.equal(pendingAnswer({ intake: { risposte: [] }, phase: "da_valutare", subState: "nuova" }), null);
  // Senza il segno, o con il segno di una risposta vecchia, niente è in attesa: la fase da sola non basta.
  assert.equal(pendingAnswer({ intake: { risposte: answers }, phase: "da_valutare", subState: "nuova" }), null, "senza segno");
  assert.equal(pendingAnswer({ intake: { risposte: answers, [ANSWER_PENDING_INTAKE_KEY]: answers[0].at }, phase: "da_valutare", subState: "nuova" }), null);
  assert.equal(pendingAnswer({ intake: { risposte: answers, [ANSWER_PENDING_INTAKE_KEY]: true }, phase: "da_valutare", subState: "nuova" }), null);
  assert.equal(pendingAnswer({ intake: null, phase: "da_valutare", subState: "nuova" }), null);
});

// Un giro intero con le regole vere: la risposta, poi le decisioni (`applyDecision`) e la fase
// dopo ognuna (`phaseOfUseCase`). Oggi a Roma 2026-10-14.
const FLOW_NOW = new Date("2026-10-14T10:00:00Z");
const REVIEWER = "00000000-0000-4000-8000-0000000000a1";
const ANSWER_AT = "2026-10-13T09:00:00.000Z";

type FlowCard = Omit<DecisionCard, "phase">;

function answeredCard(): FlowCard {
  return {
    id: "00000000-0000-4000-8000-000000000031",
    code: "XX-0031",
    portfolioKind: "use_case_ai",
    dossierStatus: null,
    status: "proposed",
    portfolioReviewStatus: "in_review",
    targetQuarter: null,
    reviewBy: null,
    reviewedBy: REVIEWER,
    publicNote: "Quante visite fate al mese?",
    intake: { risposte: [{ at: ANSWER_AT, text: "Circa 40." }], [ANSWER_PENDING_INTAKE_KEY]: ANSWER_AT },
    customScores: null,
  };
}

function phaseOf(c: FlowCard) {
  return phaseOfUseCase({ ...c, duplicateOfCode: null, today: "2026-10-14" });
}

function decide(c: FlowCard, decision: Decision): FlowCard {
  const result = applyDecision({ ...c, phase: phaseOf(c).phase }, decision, {
    now: FLOW_NOW,
    actor: { userId: REVIEWER, isReviewer: true, isLateralSpace: true },
    ucSectionEnabled: true,
  });
  assert.ok(result.ok, decision.type);
  return applyDecisionPatch(c, result.patch);
}

function pending(c: FlowCard): boolean {
  const p = phaseOf(c);
  return isAnswerPending({ intake: c.intake, phase: p.phase, subState: p.subState });
}

test("dopo una decisione la risposta non è più in attesa: «Rimanda», «Da rivedere», «Riapri» dopo «Non avviare»", () => {
  const answered = answeredCard();
  assert.equal(phaseOf(answered).subState, "nuova");
  assert.equal(pending(answered), true, "tornata in «Da decidere»");

  // «Rimanda»: «Da valutare · Rimandata», niente più in attesa; anche a data arrivata («Da rivedere»).
  const postponed = decide(answered, { type: "rimanda", reviewBy: "2026-11-02" });
  assert.equal(phaseOf(postponed).subState, "rimandata");
  assert.equal(Object.hasOwn(postponed.intake ?? {}, ANSWER_PENDING_INTAKE_KEY), false);
  assert.equal(pending(postponed), false, "rimandata");
  const toReview = { ...postponed, reviewBy: "2026-10-01" };
  assert.equal(phaseOf(toReview).subState, "da_rivedere");
  assert.equal(pending(toReview), false, "da rivedere");

  // «Non avviare», poi «Riapri»: di nuovo «Da valutare · Nuova», con le risposte vecchie e niente in attesa.
  const rejected = decide(answered, { type: "non_avviare", publicNote: "Non ora: manca il budget." });
  assert.equal(phaseOf(rejected).phase, "chiuso");
  const reopened = decide(rejected, { type: "riapri" });
  assert.deepEqual([phaseOf(reopened).phase, phaseOf(reopened).subState], ["da_valutare", "nuova"]);
  assert.equal((reopened.intake as { risposte: unknown[] }).risposte.length, 1, "le risposte restano");
  assert.equal(pending(reopened), false, "riaperta");

  // «Valutata» (valori del team, nessuna decisione): la risposta resta in attesa.
  assert.equal(pending({ ...answered, portfolioReviewStatus: "scored" }), true, "valutata ma non decisa");

  // Ogni decisione toglie il segno, con la sua patch di `intake` (Archivia tiene il motivo).
  const archived = decide(answered, { type: "archivia", reason: "superato" });
  assert.deepEqual(Object.keys(archived.intake ?? {}).sort(), ["archiveReason", "risposte"]);
  for (const decision of [
    { type: "approva", quando: "questo_trimestre" },
    { type: "serve_info", publicNote: "E all'anno?" },
  ] as Decision[]) {
    assert.equal(Object.hasOwn(decide(answered, decision).intake ?? {}, ANSWER_PENDING_INTAKE_KEY), false, decision.type);
  }
});
