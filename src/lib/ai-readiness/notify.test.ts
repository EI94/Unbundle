import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  READINESS_ANSWERS_SIGNAL,
  READINESS_BELL_TEXT,
  READINESS_SIGNAL_ENTITY,
  READINESS_SIGNAL_TYPES,
  READINESS_THRESHOLD_SIGNAL,
  isReadinessSignalType,
  readinessSignalHref,
} from "./notify.ts";
import { readinessBellPlan, readinessSignalId } from "./notify-plan.ts";
import { signalEntry, signalHref } from "../notifications/bell.ts";
import { findHubForbiddenIn } from "../use-cases/copy-guard.ts";

// (Rilascio 10, ondata 7b; audit «Fuori» §6.7, riga 30) Le nuove risposte all'AI Readiness in campanella, a chi gestisce
// la rilevazione: una riga per rilevazione aggiornata sul posto, una sola quando le risposte arrivano alla soglia, il
// link alla scheda giusta, niente persone. Chi le vede lo prova `queries/ai-readiness-notify.integration.test.ts`.
// Dati inventati.

const WS = "11111111-2222-4333-8444-555555555555";
const AS = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const OTHER = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

test("one fixed row per assessment and type: the same id every time, a different one for each assessment and type", () => {
  const answers = readinessSignalId(READINESS_ANSWERS_SIGNAL, AS);
  assert.match(answers, UUID_V5);
  assert.equal(readinessSignalId(READINESS_ANSWERS_SIGNAL, AS.toUpperCase()), answers, "maiuscole o minuscole, la stessa riga");
  assert.notEqual(readinessSignalId(READINESS_THRESHOLD_SIGNAL, AS), answers);
  assert.notEqual(readinessSignalId(READINESS_ANSWERS_SIGNAL, OTHER), answers);
  assert.throws(() => readinessSignalId(READINESS_ANSWERS_SIGNAL, "non-una-rilevazione"), /Rilevazione non valida/);
});

test("aggregated, never one per answer: the answers row carries today's number; the threshold row starts at the threshold", () => {
  assert.deepEqual(readinessBellPlan({ assessmentId: AS, name: "Rilevazione di prova", responses: 0, expected: 120, threshold: 5 }), { answers: null, threshold: null });
  const below = readinessBellPlan({ assessmentId: AS, name: "Rilevazione di prova", responses: 4, expected: 120, threshold: 5 });
  assert.equal(below.threshold, null);
  assert.deepEqual(below.answers, {
    id: readinessSignalId(READINESS_ANSWERS_SIGNAL, AS),
    type: READINESS_ANSWERS_SIGNAL,
    title: "Nuove risposte all'AI Readiness",
    description: "«Rilevazione di prova»: 4 risposte su 120 attese.",
  });
  const at = readinessBellPlan({ assessmentId: AS, name: "Rilevazione di prova", responses: 5, expected: null, threshold: 5 });
  assert.equal(at.answers?.id, below.answers?.id, "la stessa riga, aggiornata sul posto");
  assert.equal(at.answers?.description, "«Rilevazione di prova»: 5 risposte.");
  assert.deepEqual(at.threshold, {
    id: readinessSignalId(READINESS_THRESHOLD_SIGNAL, AS),
    type: READINESS_THRESHOLD_SIGNAL,
    title: "AI Readiness: i risultati ci sono",
    description: "«Rilevazione di prova»: 5 risposte, abbastanza per i risultati per area e per la sintesi.",
  });
  const later = readinessBellPlan({ assessmentId: AS, name: "Rilevazione di prova", responses: 46, expected: 120, threshold: 5 });
  assert.equal(later.threshold?.id, at.threshold?.id, "la soglia è sempre la stessa riga: il database la scrive una volta");
  assert.equal(readinessBellPlan({ assessmentId: AS, name: " ", responses: 1, expected: null, threshold: 5 }).answers?.description, "«AI Readiness»: 1 risposta.");
});

test("the bell rows link to the right tab: new answers to Raccolta › Persone, the threshold to Risultati", () => {
  const answers = { signalType: READINESS_ANSWERS_SIGNAL, relatedEntityType: READINESS_SIGNAL_ENTITY, relatedEntityId: AS };
  const threshold = { ...answers, signalType: READINESS_THRESHOLD_SIGNAL };
  assert.equal(readinessSignalHref(WS, answers), `/dashboard/${WS}/ai-readiness?assessment=${AS}&scheda=raccolta#persone`);
  assert.equal(readinessSignalHref(WS, threshold), `/dashboard/${WS}/ai-readiness?assessment=${AS}`);
  // Le stesse regole nella campanella, con l'area «Use case» accesa o spenta.
  for (const hub of [true, false]) {
    assert.equal(signalHref(WS, answers, hub), readinessSignalHref(WS, answers));
    assert.equal(signalHref(WS, threshold, hub), readinessSignalHref(WS, threshold));
  }
  assert.equal(readinessSignalHref(WS, { ...answers, relatedEntityType: "use_case" }), null);
  assert.equal(readinessSignalHref(WS, { ...answers, relatedEntityId: null }), null);
  assert.equal(readinessSignalHref(WS, { ...answers, relatedEntityId: "x" }), null);
  assert.equal(readinessSignalHref(WS, { ...answers, signalType: "new_portfolio_item" }), null);
  const entry = signalEntry(WS, { id: readinessSignalId(READINESS_ANSWERS_SIGNAL, AS), title: READINESS_BELL_TEXT.answersTitle, description: "«Rilevazione di prova»: 4 risposte.", ...answers, createdAt: "2026-11-23T09:30:00.000Z", read: false }, true);
  assert.equal(entry.href, `/dashboard/${WS}/ai-readiness?assessment=${AS}&scheda=raccolta#persone`);
  assert.equal(entry.unread, true);
  assert.deepEqual([...READINESS_SIGNAL_TYPES], ["ai_readiness_risposte", "ai_readiness_soglia"]);
  assert.ok(isReadinessSignalType("ai_readiness_soglia") && !isReadinessSignalType("use_case_digest"));
});

test("the bell texts: the dashboard's words, calm, counts only, no person", () => {
  const texts = [
    READINESS_BELL_TEXT.answersTitle,
    READINESS_BELL_TEXT.thresholdTitle,
    READINESS_BELL_TEXT.answers("Rilevazione", 46, 120),
    READINESS_BELL_TEXT.answers("Rilevazione", 1, null),
    READINESS_BELL_TEXT.threshold("Rilevazione", 5),
  ];
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
  for (const t of texts) {
    assert.doesNotMatch(t, /survey|assessment|respondent|@|punteggio/i, t);
    assert.ok(t.length <= 120, t);
  }
});

test("the hook: after a submitted questionnaire, after the answer (`after`), never blocking whoever answered", () => {
  const actions = readFileSync(new URL("../actions/ai-readiness.ts", import.meta.url), "utf8");
  const submit = actions.slice(actions.indexOf("export async function submitAiReadinessResponseAction"), actions.indexOf("export async function recomputeAiReadinessScoresAction"));
  assert.match(submit, /const dashboard = await recomputeAiReadinessScores\(assessment\.id\);/);
  assert.match(submit, /responses: dashboard\.responseCount,/);
  assert.match(submit, /after\(\(\) => notifyReadinessResponse\(notice\)\);/);
  const writer = readFileSync(new URL("../db/queries/ai-readiness-notify.ts", import.meta.url), "utf8");
  assert.match(writer, /catch \(error\) \{\s*logSafeError\("ai-readiness", "bell_failed"/, "un errore della campanella non arriva a chi risponde");
  // Una rilevazione eliminata porta via le sue righe.
  assert.match(actions, /await deleteReadinessBell\(\{ workspaceId, assessmentId \}\);/);
});
