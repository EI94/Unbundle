import test from "node:test";
import assert from "node:assert/strict";
import { LEARNING_REQUEST_MAX_BYTES, LearningHttpError, learningRequestOrigin, readLearningRequest } from "./http.ts";
const origin = "https://training.example.invalid";
function request(body: string, headers: Record<string,string> = {}) {
  return new Request(`${origin}/api/learning`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body });
}
const payload = JSON.stringify({ operation: "saveLearningDraft", input: { attemptId: "untrusted-id" } });
const status = (code:number) => (error:unknown) => error instanceof LearningHttpError && error.status===code;
test("gateway accepts only the explicit operation/input envelope and leaves input validation to existing actions", async () => {
  const value = await readLearningRequest(request(payload), origin);
  assert.deepEqual(value, { operation: "saveLearningDraft", input: { attemptId: "untrusted-id" } });
  for (const body of [JSON.stringify({operation:"constructor",input:{}}),JSON.stringify({operation:"saveLearningDraft",input:{},userId:"forged"}),JSON.stringify({operation:"saveLearningDraft",input:[]}),"{}","null","not-json"])
    await assert.rejects(() => readLearningRequest(request(body), origin), status(400));
});
test("cross origin, missing origin and non-JSON requests are denied before body or DAL execution", async () => {
  await assert.rejects(() => readLearningRequest(request(payload,{origin:"https://other.example.invalid"}),origin),status(403));
  const missing=request(payload);missing.headers.delete("origin");await assert.rejects(()=>readLearningRequest(missing,origin),status(403));
  await assert.rejects(()=>readLearningRequest(request(payload,{"content-type":"text/plain"}),origin),status(415));
});
test("body limit counts bytes without trusting absent or dishonest Content-Length", async () => {
  const large=JSON.stringify({operation:"saveLearningDraft",input:{text:"é".repeat(LEARNING_REQUEST_MAX_BYTES/2)}});
  await assert.rejects(()=>readLearningRequest(request(large),origin),status(413));
  await assert.rejects(()=>readLearningRequest(request(large,{"content-length":"1"}),origin),status(413));
  await assert.rejects(()=>readLearningRequest(request(payload,{"content-length":String(LEARNING_REQUEST_MAX_BYTES+1)}),origin),status(413));
});
test("chunked overflow cancels the reader and malformed UTF-8 is rejected", async () => {
  let cancelled=false;
  const stream=new ReadableStream<Uint8Array>({pull(controller){controller.enqueue(new Uint8Array(40_000));},cancel(){cancelled=true;}});
  const chunked=new Request(`${origin}/api/learning`,{method:"POST",headers:{origin,"content-type":"application/json"},body:stream,duplex:"half"} as RequestInit);
  await assert.rejects(()=>readLearningRequest(chunked,origin),status(413));assert.equal(cancelled,true);
  const invalid=new Request(`${origin}/api/learning`,{method:"POST",headers:{origin,"content-type":"application/json"},body:new Uint8Array([0xc3,0x28])});
  await assert.rejects(()=>readLearningRequest(invalid,origin),status(400));
});

test("same-origin authority uses original Host without trusting forwarded-host or Next internal hostname", async () => {
  const actual = request(payload,{host:"127.0.0.1:53100",origin:"http://127.0.0.1:53100","x-forwarded-host":"attacker.invalid"});
  assert.equal(learningRequestOrigin(actual,"http:"),"http://127.0.0.1:53100");
  await readLearningRequest(actual,learningRequestOrigin(actual,"http:"));
  actual.headers.set("origin","http://attacker.invalid");
  await assert.rejects(()=>readLearningRequest(actual,learningRequestOrigin(actual,"http:")),status(403));
  for(const host of ["good.invalid@attacker.invalid","good.invalid,attacker.invalid","good.invalid/path","good.invalid\\evil.invalid"])
    assert.throws(()=>learningRequestOrigin(request(payload,{host}),"https:"),status(403));
  assert.throws(()=>learningRequestOrigin(request(payload),"https:"),status(403));
});
