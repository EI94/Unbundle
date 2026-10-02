import test from "node:test";
import assert from "node:assert/strict";
import { emptyIdeaFields, validateIdeaSubmission, ideaPortfolioFields, ideaFieldsSchema, ideaSaveRequestSchema, ideaSubmitRequestSchema, ideaSubmissionSchema, ideaValidationErrors } from "./idea-contract.ts";

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

const scope = { workspaceId: "10000000-0000-4000-8000-000000000001", programId: "10000000-0000-4000-8000-000000000002", expectedUserId: "10000000-0000-4000-8000-000000000003" };
const draftId = "10000000-0000-4000-8000-000000000004";
test("idea creation requires the page's expected identity and an explicitly new draft", () => {
  const request={...scope,draftId:null,expectedRevision:null,fields:emptyIdeaFields};
  assert.deepEqual(ideaSaveRequestSchema.parse(request),request);
  const {expectedUserId,...unbound}=request; void expectedUserId;
  assert.throws(()=>ideaSaveRequestSchema.parse(unbound));
  assert.throws(()=>ideaSaveRequestSchema.parse({...request,expectedUserId:""}));
  assert.throws(()=>ideaSaveRequestSchema.parse({...request,userId:scope.expectedUserId}));
});
test("an existing idea save binds both object identity and revision, never revision alone", () => {
  const request={...scope,draftId,expectedRevision:1,fields:emptyIdeaFields};
  assert.deepEqual(ideaSaveRequestSchema.parse(request),request);
  assert.throws(()=>ideaSaveRequestSchema.parse({...request,draftId:null}));
  assert.throws(()=>ideaSaveRequestSchema.parse({...request,expectedRevision:null}));
  const {draftId:omitted,...withoutId}=request; void omitted;
  assert.throws(()=>ideaSaveRequestSchema.parse(withoutId));
});
test("idea submission and its retries retain expected identity as well as draft identity", () => {
  const request={...scope,draftId,expectedRevision:2,idempotencyKey:"10000000-0000-4000-8000-000000000005"};
  assert.deepEqual(ideaSubmitRequestSchema.parse(request),request);
  const {expectedUserId,...unbound}=request; void expectedUserId;
  assert.throws(()=>ideaSubmitRequestSchema.parse(unbound));
  assert.throws(()=>ideaSubmitRequestSchema.parse({...request,draftId:null}));
});


test("an incomplete saved idea reports the missing output field, not a technical failure", () => {
  const fields={...emptyIdeaFields,title:"A useful idea",problem:"A recurring task",desiredOutput:""};
  assert.deepEqual(ideaFieldsSchema.parse(fields),fields);
  const result=ideaSubmissionSchema.safeParse(fields);assert.equal(result.success,false);
  if(result.success)throw new Error("Expected field validation failure");
  assert.deepEqual(Object.keys(ideaValidationErrors(result.error)),["desiredOutput"]);
  assert.equal(ideaSubmissionSchema.safeParse({...fields,desiredOutput:"     "}).success,false);
  assert.equal(ideaSubmissionSchema.safeParse({...fields,desiredOutput:"12345"}).success,true);
});
test("all required idea fields are reported together while optional blanks remain valid", () => {
  const missing=ideaSubmissionSchema.safeParse(emptyIdeaFields);assert.equal(missing.success,false);
  if(missing.success)throw new Error("Expected field validation failure");
  assert.deepEqual(Object.keys(ideaValidationErrors(missing.error)).sort(),["desiredOutput","problem","title"]);
  const fields={...emptyIdeaFields,title:" Idea title ",problem:"A recurring task",desiredOutput:"A useful outcome"};
  assert.equal(validateIdeaSubmission(fields).title,"Idea title");
});
