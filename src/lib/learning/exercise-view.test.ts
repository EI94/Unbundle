import test from "node:test";
import assert from "node:assert/strict";
import { ACTIVITY_WATCH_LEAD_MS, activityWatchFrom, confirmDescription, exerciseProgress, notOpenSentence, problemSentence, readableDraft } from "./exercise-view.ts";
import { LEARNING_TEXT } from "./text.ts";

// (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.3-§4.4) Le regole pure
// dell'esercizio: il numero della barra fissa, la conferma breve, la frase di un problema senza gergo del server, la
// copia leggibile e l'esercizio non ancora aperto. Dati inventati.

const X = LEARNING_TEXT.exercise;
const active = {
  title: "La verifica",
  items: [
    { id: "q1", prompt: "Che cosa controlli per primo?", options: [{ id: "o1", text: "Le fonti" }, { id: "o2", text: "Il tono" }] },
    { id: "q2", prompt: "Quando chiedi aiuto?", options: [{ id: "o3", text: "Subito" }, { id: "o4", text: "Mai" }] },
  ],
  requiredTextFields: [{ id: "f1", label: "Che cosa cambieresti?", minChars: 10, maxChars: 200 }],
  allowedModes: ["review_reference_output"],
};

test("the one number of the fixed bar: the same parts the check before sending asks for", () => {
  const empty = { answers: {}, fields: {} };
  assert.deepEqual(exerciseProgress(active, empty, "questions"), { done: 0, total: 4 }, "domande, commento e «Come hai lavorato»");
  const partial = { answers: { q1: "o1" }, fields: { f1: "troppo" }, mode: "review_reference_output" };
  assert.deepEqual(exerciseProgress(active, partial, "questions"), { done: 2, total: 4 }, "un commento troppo corto non conta");
  assert.deepEqual(exerciseProgress(active, { ...partial, fields: { f1: "  abbastanza lungo  " } }, "questions"), { done: 3, total: 4 });
  assert.deepEqual(exerciseProgress(active, partial, "decisions"), { done: 1, total: 2 }, "il caso: prima solo le domande");
  assert.deepEqual(exerciseProgress(active, partial, "reflection"), { done: 1, total: 2 }, "poi commento e modalità");
  assert.deepEqual(exerciseProgress({ ...active, requiredTextFields: [], allowedModes: [] }, { answers: { q1: "o2", q2: "o3" }, fields: {} }, "questions"), { done: 2, total: 2 });
  assert.equal(X.progress(3, 5), "3 di 5");
  assert.equal(X.send, "Invia");
});

test("the short confirmation says what happens after sending, for each kind of exercise", () => {
  assert.equal(confirmDescription({ decisionsPending: false, isCase: false }), X.confirmQuiz);
  assert.equal(confirmDescription({ decisionsPending: true, isCase: true }), X.confirmDecisions);
  assert.equal(confirmDescription({ decisionsPending: false, isCase: true }), X.confirmReflection);
  assert.equal(X.confirmTitle, "Inviare le risposte?");
});

test("a problem in one sentence: never «versione server» or «verifica tecnica»; the server's reason when it explains why", () => {
  assert.equal(problemSentence("conflict", "Salvataggio non confermato. Conserva le modifiche e ricarica la versione server."), X.conflict);
  assert.equal(problemSentence("technical", "La versione del contenuto richiede una verifica tecnica. La bozza è conservata."), X.technical);
  assert.equal(problemSentence("unauthenticated", "Accesso non confermato."), X.unauthenticated);
  assert.equal(problemSentence("closed", "Il tuo turno è chiuso."), "Il tuo turno è chiuso.");
  assert.equal(problemSentence("offline", ""), X.fallback);
  for (const code of ["conflict", "technical", "unauthenticated"]) assert.doesNotMatch(problemSentence(code, "versione server verifica tecnica"), /server|tecnica/);
});

test("the copy to download reads as words: questions with the chosen answer, the comment, how one worked; no ids, no JSON", () => {
  const copy = readableDraft(active, { answers: { q1: "o1" }, fields: { f1: "Rileggerei la bozza." }, mode: "review_reference_output" }, (mode) => (mode === "review_reference_output" ? "Ho letto l’esempio qui" : mode));
  assert.equal(copy, [
    "Le mie risposte · La verifica",
    "",
    "Domanda 1: Che cosa controlli per primo?",
    "Risposta: Le fonti",
    "",
    "Domanda 2: Quando chiedi aiuto?",
    "Risposta: (nessuna)",
    "",
    "Che cosa cambieresti?:",
    "Rileggerei la bozza.",
    "",
    "Come hai lavorato: Ho letto l’esempio qui",
    "",
  ].join("\n"));
  assert.doesNotMatch(copy, /q1|o1|f1|[{}"]/);
});

test("an exercise not open yet: one sentence with the time, and it checks by itself from two hours before", () => {
  const opens = Date.parse("2026-11-23T14:00:00.000Z");
  const scheduled = { state: "scheduled", opensAt: new Date(opens).toISOString(), reason: "L’attività sarà disponibile dal 23 novembre 2026, 15:00, oppure quando chi tiene il corso aprirà la lezione." };
  assert.equal(notOpenSentence(scheduled, opens - 30 * 60_000), "Si apre alle 15:00, quando chi tiene il corso dà il via.");
  assert.equal(notOpenSentence(scheduled, opens - 26 * 60 * 60_000), "Si apre lun 23 nov, 15:00, quando chi tiene il corso dà il via.");
  assert.equal(notOpenSentence({ state: "session_closed", opensAt: null, reason: "Il tuo turno è chiuso." }, opens), "Il tuo turno è chiuso.");
  assert.equal(notOpenSentence({ state: "planned", opensAt: null, reason: null }, opens), X.notOpen);
  assert.equal(activityWatchFrom(scheduled, opens - 60 * 60_000), opens - ACTIVITY_WATCH_LEAD_MS);
  assert.equal(activityWatchFrom(scheduled, opens - 13 * 60 * 60_000), null, "più di 12 ore prima: niente");
  assert.equal(activityWatchFrom({ state: "session_closed", opensAt: null }, opens), null, "un esercizio chiuso non si aspetta");
  assert.equal(ACTIVITY_WATCH_LEAD_MS, 2 * 60 * 60_000);
});
