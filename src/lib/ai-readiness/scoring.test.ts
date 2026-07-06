import test from "node:test";
import assert from "node:assert/strict";
import { AI_READINESS_SYSTEM_TEMPLATE } from "./default-template.ts";
import { aggregateScores, scoreResponse } from "./scoring.ts";
import type { AiReadinessAnswer } from "./types.ts";

function answer(questionId: string, value: number | string): AiReadinessAnswer {
  const question = AI_READINESS_SYSTEM_TEMPLATE.questions.find(
    (item) => item.id === questionId
  );
  assert.ok(question);
  return {
    questionId,
    value,
    answerType: question.answerType,
    pillarId: question.pillarId,
    sectionId: question.sectionId,
    answeredAt: "2026-07-05T00:00:00.000Z",
  };
}

test("calcola readiness index vincolato dal pillar piu debole", () => {
  const answers = AI_READINESS_SYSTEM_TEMPLATE.questions
    .filter((question) => question.answerType !== "text")
    .map((question) => {
      if (question.pillarId === "context") return answer(question.id, 1);
      if (question.answerType === "single_choice") return answer(question.id, "enthusiastic");
      return answer(question.id, 5);
    });

  const scored = scoreResponse({
    template: AI_READINESS_SYSTEM_TEMPLATE,
    answers,
  });

  assert.equal(scored.pillarScores.context, 1);
  assert.equal(scored.weakestPillarScore, 1);
  assert.equal(scored.bottleneckPillar, "context");
  assert.ok((scored.readinessIndex ?? 0) < (scored.weightedAverage ?? 0));
});

test("non mostra score di unita sotto soglia aggregazione", () => {
  const derivedScores = scoreResponse({
    template: AI_READINESS_SYSTEM_TEMPLATE,
    answers: AI_READINESS_SYSTEM_TEMPLATE.questions
      .filter((question) => question.answerType !== "text")
      .map((question) =>
        question.answerType === "single_choice"
          ? answer(question.id, "curious")
          : answer(question.id, 3)
      ),
  });
  const dashboard = aggregateScores({
    template: AI_READINESS_SYSTEM_TEMPLATE,
    aggregationThreshold: 3,
    respondents: [
      { organizationUnit: "Ops", pseudonymousId: "p1", inviteStatus: "completed" },
      { organizationUnit: "Ops", pseudonymousId: "p2", inviteStatus: "completed" },
      { organizationUnit: "Sales", pseudonymousId: "p3", inviteStatus: "completed" },
      { organizationUnit: "Sales", pseudonymousId: "p4", inviteStatus: "completed" },
      { organizationUnit: "Sales", pseudonymousId: "p5", inviteStatus: "completed" },
    ],
    responses: [
      { pseudonymousId: "p1", derivedScores },
      { pseudonymousId: "p2", derivedScores },
      { pseudonymousId: "p3", derivedScores },
      { pseudonymousId: "p4", derivedScores },
      { pseudonymousId: "p5", derivedScores },
    ],
  });

  const ops = dashboard.units.find((unit) => unit.unit === "Ops");
  const sales = dashboard.units.find((unit) => unit.unit === "Sales");
  assert.equal(ops?.aggregationThresholdMet, false);
  assert.equal(ops?.overallScore, null);
  assert.equal(sales?.aggregationThresholdMet, true);
  assert.equal(sales?.overallScore, 3.04);
});
