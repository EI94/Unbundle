import test from "node:test";
import assert from "node:assert/strict";
import { AI_READINESS_SYSTEM_TEMPLATE } from "./default-template.ts";
import {
  filterTemplateDefinition,
  includedPillarsFromScoringConfig,
} from "./template-scope.ts";
import { scoreResponse } from "./scoring.ts";
import type { AiReadinessAnswer } from "./types.ts";

test("includedPillarsFromScoringConfig: assente o vuoto = tutti i pilastri", () => {
  assert.equal(includedPillarsFromScoringConfig(null), null);
  assert.equal(includedPillarsFromScoringConfig({}), null);
  assert.equal(includedPillarsFromScoringConfig({ includedPillars: [] }), null);
  assert.equal(
    includedPillarsFromScoringConfig({ includedPillars: "technology" }),
    null
  );
  assert.deepEqual(
    includedPillarsFromScoringConfig({ includedPillars: ["adoption"] }),
    ["adoption"]
  );
});

test("filterTemplateDefinition restringe pilastri, sezioni e domande", () => {
  const filtered = filterTemplateDefinition(AI_READINESS_SYSTEM_TEMPLATE, [
    "adoption",
  ]);
  assert.deepEqual(
    filtered.pillars.map((pillar) => pillar.id),
    ["adoption"]
  );
  assert.ok(filtered.sections.length > 0);
  assert.ok(filtered.sections.every((section) => section.pillarId === "adoption"));
  assert.ok(filtered.questions.length > 0);
  assert.ok(filtered.questions.every((question) => question.pillarId === "adoption"));
});

test("selezione senza match reale ricade sul template completo", () => {
  const filtered = filterTemplateDefinition(AI_READINESS_SYSTEM_TEMPLATE, [
    "pilastro-inventato",
  ]);
  assert.equal(filtered.pillars.length, AI_READINESS_SYSTEM_TEMPLATE.pillars.length);
});

test("lo scoring su template filtrato usa solo i pilastri inclusi", () => {
  const filtered = filterTemplateDefinition(AI_READINESS_SYSTEM_TEMPLATE, [
    "technology",
  ]);
  const answers: AiReadinessAnswer[] = filtered.questions
    .filter((question) => question.answerType === "scale")
    .map((question) => ({
      questionId: question.id,
      value: 4,
      answerType: question.answerType,
      pillarId: question.pillarId,
      sectionId: question.sectionId,
      answeredAt: "2026-07-07T00:00:00.000Z",
    }));
  const scores = scoreResponse({ template: filtered, answers });
  assert.equal(typeof scores.pillarScores.technology, "number");
  assert.ok(!("adoption" in scores.pillarScores));
  assert.equal(scores.bottleneckPillar, "technology");
  assert.ok(scores.readinessIndex != null);
});
