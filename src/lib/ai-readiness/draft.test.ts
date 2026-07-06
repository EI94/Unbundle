import test from "node:test";
import assert from "node:assert/strict";
import { AI_READINESS_SYSTEM_TEMPLATE } from "./default-template.ts";
import {
  draftPrefillFromResponse,
  normalizeDraftPayload,
} from "./draft.ts";
import type { AiReadinessAnswer } from "./types.ts";

const scaleQuestion = AI_READINESS_SYSTEM_TEMPLATE.questions.find(
  (question) => question.answerType === "scale"
);
const choiceQuestion = AI_READINESS_SYSTEM_TEMPLATE.questions.find(
  (question) => question.answerType === "single_choice"
);
const textQuestion = AI_READINESS_SYSTEM_TEMPLATE.questions.find(
  (question) => question.answerType === "text"
);

test("normalizza le risposte bozza tenendo solo domande valide del template", () => {
  assert.ok(scaleQuestion && choiceQuestion);
  const result = normalizeDraftPayload(AI_READINESS_SYSTEM_TEMPLATE, {
    answers: {
      [scaleQuestion.id]: "4",
      [choiceQuestion.id]: choiceQuestion.options?.[0]?.value ?? "",
      "question-inesistente": "5",
    },
    consents: { privacyAccepted: true, benchmarkConsent: false, marketingConsent: false },
    useCase: { useCaseTitle: "Automazione fatture", campoIgnoto: "x" },
  });

  const byId = new Map(result.answers.map((item) => [item.questionId, item]));
  assert.equal(byId.get(scaleQuestion.id)?.value, 4);
  assert.equal(
    byId.get(choiceQuestion.id)?.value,
    choiceQuestion.options?.[0]?.value
  );
  assert.ok(!byId.has("question-inesistente"));
  assert.equal(result.consents.privacyAccepted, true);
  assert.equal(result.useCase.useCaseTitle, "Automazione fatture");
  assert.ok(!("campoIgnoto" in result.useCase));
});

test("scarta valori scale non numerici e opzioni scelta non previste", () => {
  assert.ok(scaleQuestion && choiceQuestion);
  const result = normalizeDraftPayload(AI_READINESS_SYSTEM_TEMPLATE, {
    answers: {
      [scaleQuestion.id]: "non-un-numero",
      [choiceQuestion.id]: "opzione-farlocca",
    },
    consents: {},
    useCase: {},
  });
  assert.equal(result.answers.length, 0);
});

test("payload malformato o vuoto non genera errori", () => {
  const fromNull = normalizeDraftPayload(AI_READINESS_SYSTEM_TEMPLATE, null);
  assert.equal(fromNull.answers.length, 0);
  assert.equal(fromNull.consents.privacyAccepted, false);

  const fromGarbage = normalizeDraftPayload(AI_READINESS_SYSTEM_TEMPLATE, {
    answers: "not-an-object",
    consents: 42,
    useCase: ["a"],
  });
  assert.equal(fromGarbage.answers.length, 0);
});

test("draftPrefillFromResponse ricostruisce answers, consensi e use case", () => {
  assert.ok(scaleQuestion && textQuestion);
  const answers: AiReadinessAnswer[] = [
    {
      questionId: scaleQuestion.id,
      value: 3,
      answerType: "scale",
      pillarId: scaleQuestion.pillarId,
      sectionId: scaleQuestion.sectionId,
      answeredAt: "2026-07-05T00:00:00.000Z",
    },
    {
      questionId: textQuestion.id,
      value: "Nota libera",
      answerType: "text",
      pillarId: textQuestion.pillarId,
      sectionId: textQuestion.sectionId,
      answeredAt: "2026-07-05T00:00:00.000Z",
    },
  ];
  const prefill = draftPrefillFromResponse({
    answers,
    metadata: {
      draft: {
        consents: { privacyAccepted: true, benchmarkConsent: true, marketingConsent: false },
        useCase: { useCaseTitle: "Titolo", useCasePainPoint: "Pain" },
      },
    },
  });
  assert.equal(prefill.answers[scaleQuestion.id], "3");
  assert.equal(prefill.answers[textQuestion.id], "Nota libera");
  assert.equal(prefill.consents.privacyAccepted, true);
  assert.equal(prefill.consents.benchmarkConsent, true);
  assert.equal(prefill.consents.marketingConsent, false);
  assert.equal(prefill.useCase.useCaseTitle, "Titolo");
  assert.equal(prefill.useCase.useCasePainPoint, "Pain");
});

test("il round-trip bozza→prefill preserva i valori", () => {
  assert.ok(scaleQuestion);
  const normalized = normalizeDraftPayload(AI_READINESS_SYSTEM_TEMPLATE, {
    answers: { [scaleQuestion.id]: "5" },
    consents: { privacyAccepted: true },
    useCase: { useCaseTitle: "Round trip" },
  });
  const prefill = draftPrefillFromResponse({
    answers: normalized.answers,
    metadata: {
      draft: { consents: normalized.consents, useCase: normalized.useCase },
    },
  });
  assert.equal(prefill.answers[scaleQuestion.id], "5");
  assert.equal(prefill.useCase.useCaseTitle, "Round trip");
  assert.equal(prefill.consents.privacyAccepted, true);
});
