import test from "node:test";
import assert from "node:assert/strict";
import { createAttemptOrder, getActivity, getLearnerActivity, getSubmittedCaseExample, localDateTimeToUtc, parseTrainingPack, trainingPackHash } from "./pack.ts";
import { gradeActivity, gradeRubric, LearningValidationError, validateCompleteness, validateDraftResponses } from "./grading.ts";
import type { AttemptResponses, PrivateTrainingPack } from "./types.ts";

import { createGenericTrainingPack as fixture } from "./test-fixture.ts";

function responses(pack: PrivateTrainingPack, activityId = "exit"): AttemptResponses {
  const activity = getActivity(pack, activityId);
  return { answers: Object.fromEntries(activity.item_ids!.map((id) => [id, pack.items.find((entry) => entry.id === id)!.correct_option_ids[0]])),
    fields: Object.fromEntries((activity.required_text_fields ?? []).map((field) => [field.id, "x".repeat(field.min_chars)])), ...(activity.allowed_modes ? { mode: activity.allowed_modes[0] } : {}) };
}

test("private schema validates versioned fixture and keeps future module metadata", () => {
  const pack = parseTrainingPack(fixture());
  assert.deepEqual(pack.modules.map((module) => module.id), ["m1", "m2", "m3"]);
  assert.equal(pack.content_version, "2026-10-01.1");
});
for (const [label, mutate] of [
  ["unknown schema version", (pack) => { (pack as unknown as { schema_version: string }).schema_version = "2.0.0"; }],
  ["unknown top-level key", (pack) => { Object.assign(pack, { unsafe: true }); }],
  ["duplicate module", (pack) => { pack.modules.push(pack.modules[0]); }],
  ["duplicate global cohort", (pack) => { pack.modules[1].cohorts[0].id = pack.modules[0].cohorts[0].id; }],
  ["duplicate item", (pack) => { pack.items.push(pack.items[0]); }],
  ["duplicate option", (pack) => { pack.items[0].options.push(pack.items[0].options[0]); }],
  ["missing uncertainty choice", (pack) => { pack.items[0].options = pack.items[0].options.filter((entry) => entry.id !== "unsure"); }],
  ["multiple keys for single choice", (pack) => { pack.items[0].correct_option_ids.push("option-1"); }],
  ["key absent from options", (pack) => { pack.items[0].correct_option_ids = ["unknown"]; }],
  ["uncertainty as key", (pack) => { pack.items[0].correct_option_ids = ["unsure"]; }],
  ["unknown item reference", (pack) => { pack.activities[0].item_ids![0] = "missing"; }],
  ["item attached to wrong module", (pack) => { pack.items[0].module_id = "m2"; }],
  ["item attached to wrong activity", (pack) => { pack.items[0].activity_id = "exit"; }],
  ["unknown competency", (pack) => { pack.items[0].competency_id = "missing"; }],
  ["unknown evidence source", (pack) => { pack.items[0].evidence_refs = ["missing"]; }],
  ["unknown evidence fact", (pack) => { pack.items[0].evidence_refs = ["generic-case:missing"]; }],
  ["wrong duration", (pack) => { pack.modules[0].cohorts[0].end_local = "2026-10-05T17:00:00"; }],
  ["threshold greater than item count", (pack) => { pack.activities[2].pass_min_correct = 99; }],
  ["missing threshold", (pack) => { delete pack.activities[2].pass_min_correct; }],
  ["disabled essential check", (pack) => { pack.activities[2].required_critical_correct = false; }],
  ["retake cycle", (pack) => { pack.activities[2].retake_activity_id = "exit"; }],
  ["missing retake", (pack) => { pack.activities[2].retake_activity_id = "unknown"; }],
  ["non-synthetic case", (pack) => { (pack.cases[0] as unknown as { synthetic: boolean }).synthetic = false; }],
  ["required field limits inverted", (pack) => { pack.activities[1].required_text_fields![0].min_chars = 1001; }],
  ["unknown rubric critical criterion", (pack) => { pack.rubrics[0].critical_criterion_ids = ["missing"]; }],
  ["incorrect rubric total", (pack) => { pack.rubrics[0].max_points = 100; }],
  ["private policy weakened", (pack) => { (pack.policy as unknown as { llm_grade_is_final: boolean }).llm_grade_is_final = true; }],
] satisfies [string, (pack: PrivateTrainingPack) => void][]) {
  test(`strict import rejects ${label}`, () => { const pack = fixture(); mutate(pack); assert.throws(() => parseTrainingPack(pack)); });
}

test("all supplied schedule times convert using the correct Rome offset", () => {
  for (const [local, utc] of [
    ["2026-10-05T14:30:00", "2026-10-05T12:30:00.000Z"], ["2026-10-07T10:00:00", "2026-10-07T08:00:00.000Z"],
    ["2026-10-27T10:00:00", "2026-10-27T09:00:00.000Z"], ["2026-10-28T11:00:00", "2026-10-28T10:00:00.000Z"],
    ["2026-11-03T11:00:00", "2026-11-03T10:00:00.000Z"], ["2026-11-04T11:00:00", "2026-11-04T10:00:00.000Z"],
  ]) assert.equal(localDateTimeToUtc(local, "Europe/Rome").toISOString(), utc);
});
test("invalid calendar dates, ambiguous DST times and nonexistent DST times are rejected", () => {
  for (const date of ["2026-02-30T10:00:00", "2026-13-05T10:00:00", "2026-10-05T25:00:00", "2026-10-05", "2026-03-29T02:30:00", "2026-10-25T02:30:00"]) assert.throws(() => localDateTimeToUtc(date, "Europe/Rome"));
  assert.throws(() => localDateTimeToUtc("2026-10-05T10:00:00", "Not/AZone"));
});
test("learner DTO never reveals grading material or complete private case before submit", () => {
  const pack = fixture();
  const dto = getLearnerActivity(pack, "case", createAttemptOrder(pack, "case"));
  const payload = JSON.stringify(dto);
  for (const secret of ["correct_option_ids", "feedback", "evidence_refs", "critical", "PRIVATE_", "facts", '"reference_output":', "boundaries", "source_snapshot_sha"]) assert.equal(payload.includes(secret), false, secret);
  assert.equal(dto.case?.text, pack.cases[0].text);
  assert.equal(dto.case?.preparedBadOutput, pack.cases[0].prepared_bad_output);
  assert.equal(dto.case?.task, pack.cases[0].task);
});
test("DTO allowlisting remains safe even if a later private field is added", () => {
  const pack = fixture();
  Object.assign(pack.activities[0], { private_solution: "DO_NOT_SEND" });
  Object.assign(pack.items[0], { private_solution: "DO_NOT_SEND" });
  assert.equal(JSON.stringify(getLearnerActivity(pack, "check", createAttemptOrder(pack, "check"))).includes("DO_NOT_SEND"), false);
});
test("stored shuffle is stable across reload and grading is by IDs for 100 permutations", () => {
  const pack = fixture(); const answers = responses(pack); const expected = gradeActivity(pack, "exit", answers); const before = JSON.stringify(pack);
  for (let round = 0; round < 100; round++) {
    const order = createAttemptOrder(pack, "exit");
    const dto = getLearnerActivity(pack, "exit", order);
    assert.deepEqual(getLearnerActivity(pack, "exit", structuredClone(order)), dto);
    assert.deepEqual(new Set(dto.items.map((item) => item.id)), new Set(getActivity(pack, "exit").item_ids));
    assert.deepEqual(gradeActivity(pack, "exit", answers), expected);
  }
  assert.equal(JSON.stringify(pack), before);
});
test("corrupt persisted order cannot drop or duplicate questions or options", () => {
  const pack = fixture(); let order = createAttemptOrder(pack, "exit"); order.itemIds.pop();
  assert.throws(() => getLearnerActivity(pack, "exit", order));
  order = createAttemptOrder(pack, "exit"); order.optionIds[order.itemIds[0]][0] = "invalid";
  assert.throws(() => getLearnerActivity(pack, "exit", order));
});
test("all correct, all unsure and exact threshold match objective semantics", () => {
  const pack = fixture(); const correct = responses(pack);
  assert.equal(gradeActivity(pack, "exit", correct).status, "consolidated");
  const unsure = responses(pack); for (const id of Object.keys(unsure.answers)) unsure.answers[id] = "unsure";
  assert.equal(gradeActivity(pack, "exit", unsure).correct, 0);
  assert.equal(gradeActivity(pack, "exit", unsure).status, "needs_practice");
  const boundary = responses(pack); boundary.answers["exit-q0"] = "unsure"; boundary.answers["exit-q1"] = "unsure";
  assert.equal(gradeActivity(pack, "exit", boundary).correct, 6);
  assert.equal(gradeActivity(pack, "exit", boundary).status, "consolidated");
  boundary.answers["exit-q2"] = "unsure";
  assert.equal(gradeActivity(pack, "exit", boundary).status, "needs_practice");
});
test("7 of 8 with an essential error needs practice", () => {
  const pack = fixture(); const response = responses(pack); response.answers["exit-q7"] = "unsure";
  const result = gradeActivity(pack, "exit", response);
  assert.equal(result.correct, 7); assert.equal(result.status, "needs_practice"); assert.deepEqual(result.essential_errors, ["exit-q7"]);
});
test("formative completion is separate from mastery and no text semantics are graded", () => {
  const pack = fixture(); const response = responses(pack, "check"); for (const id of Object.keys(response.answers)) response.answers[id] = "unsure";
  assert.equal(gradeActivity(pack, "check", response).status, "formative_completed");
  assert.equal(gradeActivity(pack, "case", responses(pack, "case")).correct, 6);
});
test("draft accepts incomplete answers and preserves unsaved text content literally", () => {
  const pack = fixture(); const raw = { answers: {}, fields: { reflection: " <script>alert('literal')</script>  " } };
  assert.deepEqual(validateDraftResponses(pack, "case", raw), raw);
  assert.throws(() => validateCompleteness(pack, "case", raw));
});
test("all incomplete, invalid and forged submissions fail rather than returning zero", () => {
  const pack = fixture();
  const missing = responses(pack); delete missing.answers["exit-q0"];
  const unknown = responses(pack); unknown.answers["exit-q0"] = "unknown";
  const injected = responses(pack); injected.answers.score = "100";
  for (const response of [missing, unknown, injected]) assert.throws(() => gradeActivity(pack, "exit", response), LearningValidationError);
  for (const key of ["score", "userId", "role", "rubricVersion", "confidence"]) assert.throws(() => validateDraftResponses(pack, "exit", { ...responses(pack), [key]: 5 }));
});
test("field IDs, max length, trimmed minimum and required mode are validated server side", () => {
  const pack = fixture();
  for (const text of ["", "    ", "x".repeat(14), "x".repeat(1001)]) { const response = responses(pack, "case"); response.fields.reflection = text; assert.throws(() => gradeActivity(pack, "case", response)); }
  const missingMode = responses(pack, "case"); delete missingMode.mode; assert.throws(() => gradeActivity(pack, "case", missingMode));
  assert.throws(() => validateDraftResponses(pack, "case", { answers: {}, fields: { unexpected: "text" } }));
  assert.throws(() => validateDraftResponses(pack, "exit", { ...responses(pack), mode: "execute_authorized_assistant" }));
});
test("Unicode text limits count characters consistently with the reference grader", () => {
  const pack = fixture(); const response = responses(pack, "case"); response.fields.reflection = "😀".repeat(15);
  assert.doesNotThrow(() => validateCompleteness(pack, "case", response));
  response.fields.reflection = "😀".repeat(14); assert.throws(() => validateCompleteness(pack, "case", response));
});
test("feedback returns only submitted activity evidence and a separate prepared example", () => {
  const pack = fixture(); const result = gradeActivity(pack, "case", responses(pack, "case"));
  assert.equal(result.items[0].feedback, "PRIVATE_FEEDBACK_MARKER"); assert.deepEqual(result.items[0].evidence, ["PRIVATE_FACT_MARKER"]);
  assert.deepEqual(getSubmittedCaseExample(pack, "case"), { referenceOutput: "PRIVATE_REFERENCE_MARKER", prompt: "PRIVATE_PROMPT_MARKER" });
  assert.equal(getSubmittedCaseExample(pack, "exit"), null);
});
test("retake grades independently and leaves original answers/result intact", () => {
  const pack = fixture(); const first = responses(pack); first.answers["exit-q7"] = "unsure";
  const firstResult = gradeActivity(pack, "exit", first); const original = structuredClone(firstResult);
  assert.equal(gradeActivity(pack, "retake", responses(pack, "retake")).status, "consolidated");
  assert.deepEqual(firstResult, original); assert.equal(first.answers["exit-q7"], "unsure");
});
test("version hash changes with the private grading spec but is stable for unchanged input", () => {
  const pack = fixture(); const original = trainingPackHash(pack);
  assert.equal(trainingPackHash(structuredClone(pack)), original);
  pack.items[0].correct_option_ids = ["option-1"]; assert.notEqual(trainingPackHash(pack), original);
});
test("future human rubric keeps essential controls and refuses missing/boolean scores", () => {
  const rubric = fixture().rubrics[0]; const scores = Object.fromEntries(rubric.criteria.map((criterion) => [criterion.id, 2]));
  assert.equal(gradeRubric(rubric, scores), "consolidated"); scores["criterion-0"] = 0;
  assert.equal(gradeRubric(rubric, scores), "needs_practice");
  assert.throws(() => gradeRubric(rubric, { ...scores, "criterion-0": true }));
  delete scores["criterion-0"]; assert.throws(() => gradeRubric(rubric, scores));
});
