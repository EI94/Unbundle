import test from "node:test";
import assert from "node:assert/strict";
import { activityAvailability, attemptAccess, formatLearningDate, latestActivityAttempt } from "./availability.ts";

const check = { module_id: "m1", type: "knowledge_check", purpose: "formative" };
const session = { startsAt: "2026-10-05T12:30:00.000Z", status: "scheduled" };
const options = { enabled: true, programStatus: "published", activity: check, session, now: Date.parse("2026-10-05T13:00:00.000Z") };

test("each M1 activity opens at its exact server instant, including the millisecond boundary", () => {
  for (const [activity, minute] of [[check, 30], [{...check, type:"case_review",purpose:"practice"},78], [{...check,purpose:"post_module"},105], [{...check,purpose:"retake"},105]] as const) {
    const opens=Date.parse(session.startsAt)+minute*60_000;
    assert.equal(activityAvailability({...options,activity,now:opens-1}).writeAccess,false);
    assert.equal(activityAvailability({...options,activity,now:opens}).writeAccess,true);
    assert.equal(activityAvailability({...options,activity,now:opens+1}).writeAccess,true);
  }
});
test("early explicit opening overrides the clock, but closed/archived/hidden policy wins", () => {
  const early={...options,now:0,session:{...session,status:"open"}};
  assert.equal(activityAvailability(early).writeAccess,true);
  for (const status of ["closed","archived"]) {
    const result=activityAvailability({...early,programStatus:status});
    assert.equal(result.writeAccess,false);assert.equal(result.readAccess,true);assert.equal(result.state,"course_closed");
  }
  const hidden=activityAvailability({...early,enabled:false});
  assert.equal(hidden.readAccess,false);assert.equal(hidden.writeAccess,false);assert.equal(hidden.opensAt,null);
  const closed=activityAvailability({...options,session:{...session,status:"closed"},now:Number.MAX_SAFE_INTEGER});
  assert.equal(closed.writeAccess,false);assert.equal(closed.state,"session_closed");
});
test("missing/invalid turns and unsupported modules never look available; an ended open course has no invented deadline", () => {
  for (const session of [null,{startsAt:"invalid",status:"scheduled"},{...options.session,status:"unknown"}]) assert.equal(activityAvailability({...options,session}).writeAccess,false);
  assert.equal(activityAvailability({...options,activity:{...check,module_id:"m2"},session:{...session,status:"open"}}).state,"planned");
  assert.equal(activityAvailability({...options,now:Date.parse("2026-12-01T00:00:00Z")}).writeAccess,true);
});
test("availability belongs to the assigned cohort, not the earliest replica", () => {
  const later={startsAt:"2026-10-07T08:00:00Z",status:"scheduled"};
  assert.equal(activityAvailability(options).writeAccess,true);
  const blocked=activityAvailability({...options,session:later});
  assert.equal(blocked.state,"scheduled");assert.equal(blocked.opensAt,"2026-10-07T08:30:00.000Z");
});
test("Rome rendering follows DST and scheduled arithmetic stays on UTC instants", () => {
  assert.match(formatLearningDate("2026-10-05T13:00:00Z"),/15:00/);
  assert.match(formatLearningDate("2026-10-27T09:00:00Z"),/10:00/);
  const spring=activityAvailability({...options,session:{startsAt:"2026-03-29T00:45:00Z",status:"scheduled"},now:Date.parse("2026-03-29T01:14:59.999Z")});
  assert.equal(spring.opensAt,"2026-03-29T01:15:00.000Z");assert.match(spring.reason!,/03:15/);
  const autumn=activityAvailability({...options,session:{startsAt:"2026-10-25T00:45:00Z",status:"scheduled"},now:Date.parse("2026-10-25T01:14:59.999Z")});
  assert.equal(autumn.opensAt,"2026-10-25T01:15:00.000Z");assert.match(autumn.reason!,/02:15/);
});
test("submitted feedback is immutable while recovery can open independently; closed drafts stay read-only", () => {
  const open=activityAvailability(options),closed=activityAvailability({...options,programStatus:"closed"});
  const submitted=attemptAccess("submitted",open,open);
  assert.equal(submitted.writeAccess,false);assert.equal(submitted.canRetake,true);
  assert.equal(attemptAccess("submitted",closed,closed).canRetake,false);
  const draft=attemptAccess("draft",closed,closed);
  assert.equal(draft.writeAccess,false);assert.match(draft.readOnlyReason!,/chiuso/);
  assert.equal(attemptAccess("draft",open,null).writeAccess,true);
  assert.equal(attemptAccess("submitted",open,null).canRetake,false);
  assert.equal(attemptAccess("submitted",activityAvailability({...options,enabled:false}),activityAvailability({...options,enabled:false})).canRetake,false);
});
test("overview follows recovery without replacing the original submitted history or another activity", () => {
  const first={activityId:"final-a",status:"submitted",result:"needs_practice"};
  const caseAttempt={activityId:"case",status:"submitted",result:"consolidated"};
  const recovery={activityId:"final-b",status:"draft",result:null};
  const history=[first,caseAttempt,recovery];const original=structuredClone(history);
  assert.equal(latestActivityAttempt({id:"final-a",retake_activity_id:"final-b"},history),recovery);
  assert.equal(latestActivityAttempt({id:"case"},history),caseAttempt);
  assert.deepEqual(history,original);assert.equal(first.result,"needs_practice");
});
