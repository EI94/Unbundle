import test from "node:test";
import assert from "node:assert/strict";
import { grantCoversCohort,csvCell,suppressSmallSplit,m1ReleaseMinutes } from "./policy.ts";
test("explicit capabilities do not inherit portfolio/sponsor access and preserve cohort boundaries",()=>{
  const grants=[{capability:"review",cohortId:"group-a"},{capability:"aggregate",cohortId:null}];
  assert.equal(grantCoversCohort(grants,"review","group-a"),true);
  assert.equal(grantCoversCohort(grants,"review","group-b"),false);
  assert.equal(grantCoversCohort(grants,"export","group-a"),false);
  assert.equal(grantCoversCohort(grants,"aggregate","group-b"),true);
  assert.equal(grantCoversCohort([{capability:"exec_sponsor",cohortId:null}],"review","group-a"),false);
});
test("CSV formula cells including leading whitespace and control bytes are inert",()=>{
  for(const prefix of ["", " ","\t","\r\n","\u0000","\u00a0","\ufeff"])
    for(const op of ["=","+","-","@"])
      assert.equal(csvCell(`${prefix}${op}1+1`),`"'${prefix}${op}1+1"`);
  assert.equal(csvCell('Text, "quoted"'), '"Text, ""quoted"""');
  assert.equal(csvCell(null),'""');
});
test("small cohorts and small complementary result cells are suppressed",()=>{
  assert.equal(suppressSmallSplit(4,4),null);
  assert.equal(suppressSmallSplit(6,5),null);
  assert.equal(suppressSmallSplit(9,5),null);
  assert.equal(suppressSmallSplit(10,5),5);
  assert.equal(suppressSmallSplit(10,0),0);
  assert.equal(suppressSmallSplit(8,3),null);
  assert.equal(suppressSmallSplit(8,5),null);
  assert.equal(suppressSmallSplit(10,5),5);
  assert.equal(suppressSmallSplit(5,5),5);
  assert.equal(suppressSmallSplit(5,0),0);
});

test("M1 windows depend on activity semantics and not private client identifiers",()=>{
  assert.equal(m1ReleaseMinutes({module_id:"m1",type:"knowledge_check",purpose:"formative"}),30);
  assert.equal(m1ReleaseMinutes({module_id:"m1",type:"case_review",purpose:"practice"}),78);
  assert.equal(m1ReleaseMinutes({module_id:"m1",type:"knowledge_check",purpose:"post_module"}),105);
  assert.equal(m1ReleaseMinutes({module_id:"m1",type:"knowledge_check",purpose:"retake"}),105);
  assert.equal(m1ReleaseMinutes({module_id:"m2",type:"knowledge_check",purpose:"post_module"}),null);
});
