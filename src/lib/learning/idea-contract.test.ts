import test from "node:test";
import assert from "node:assert/strict";
import { emptyIdeaFields, validateIdeaSubmission, ideaPortfolioFields, ideaFieldsSchema } from "./idea-contract.ts";

test("an optional idea may remain an empty draft but cannot be submitted empty", () => {
  assert.deepEqual(ideaFieldsSchema.parse(emptyIdeaFields), emptyIdeaFields);
  assert.throws(() => validateIdeaSubmission(emptyIdeaFields));
  assert.throws(() => validateIdeaSubmission({ ...emptyIdeaFields, title: "     " }));
});
test("ideas reject private data and ownership injected into payload", () => {
  for (const key of ["userId", "score", "answers", "sourceAttemptId", "workspaceId"]) {
    assert.throws(() => ideaFieldsSchema.parse({ ...emptyIdeaFields, [key]: "forged" }));
  }
});
test("portfolio projection is explicit and contains only voluntary business fields", () => {
  const fields = validateIdeaSubmission({ ...emptyIdeaFields, title: " A useful idea ", problem: "A recurring problem", desiredOutput: "A clear summary" });
  const projected = ideaPortfolioFields(fields);
  assert.equal(projected.title, "A useful idea");
  assert.deepEqual(Object.keys(projected).sort(), ["title", "description", "businessCase", "dataRequirements", "guardrails"].sort());
});
