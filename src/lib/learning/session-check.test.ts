import test from "node:test";
import assert from "node:assert/strict";
import { readLearningSessionCheck } from "./session-check.ts";

const origin = "https://training.example";
const input = { workspaceId: "11111111-1111-4111-8111-111111111111", expectedUserId: "22222222-2222-4222-8222-222222222222" };
function request(value: unknown, headers: Record<string, string> = {}) {
  return new Request(`${origin}/api/learning/session`, { method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: JSON.stringify(value) });
}
test("session check accepts only the expected identity and workspace, never an authority override", async () => {
  assert.deepEqual(await readLearningSessionCheck(request(input), origin), input);
  for (const invalid of [{ ...input, role: "admin" }, { ...input, expectedUserId: "not-a-user" }, { workspaceId: input.workspaceId }]) {
    await assert.rejects(readLearningSessionCheck(request(invalid), origin), { status: 400 });
  }
});
test("session check rejects cross-origin, missing-origin and non-JSON requests", async () => {
  for (const badOrigin of ["", "https://other.example"]) {
    await assert.rejects(readLearningSessionCheck(request(input, { origin: badOrigin }), origin), { status: 403 });
  }
  await assert.rejects(readLearningSessionCheck(request(input, { "content-type": "text/plain" }), origin), { status: 415 });
});
test("session check bounds streamed bodies even without Content-Length", async () => {
  await assert.rejects(readLearningSessionCheck(request({ ...input, payload: "x".repeat(1100) }), origin), { status: 413 });
  await assert.rejects(readLearningSessionCheck(new Request(`${origin}/api/learning/session`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: "{" }), origin), { status: 400 });
});
