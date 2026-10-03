import test from "node:test";
import assert from "node:assert/strict";
import { readLearningAdminRequest, LEARNING_ADMIN_MAX_BYTES } from "./admin-http.ts";
import { LearningHttpError } from "./http.ts";

const origin = "https://training.example.invalid";
const workspaceId = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const expectedUserId = "55555555-5555-4555-8555-dddddddddddd";
const body = JSON.stringify({ expectedUserId, operation: "catalog", input: { workspaceId } });
const request = (value: BodyInit = body, headers: Record<string, string> = {}) => new Request(`${origin}/api/learning/admin`, {
  method: "POST", headers: { origin, "content-type": "application/json", ...headers }, body: value,
});
const status = (code: number) => (error: unknown) => error instanceof LearningHttpError && error.status === code;

test("admin boundary parses an allowed request and rejects unknown operations and forged scope fields", async () => {
  assert.deepEqual(await readLearningAdminRequest(request(), origin), { expectedUserId, operation: "catalog", input: { workspaceId } });
  for (const value of [
    { expectedUserId, operation: "constructor", input: { workspaceId } },
    { expectedUserId, operation: "catalog", input: { workspaceId, role: "exec_sponsor" } },
    { expectedUserId, operation: "catalog", input: { workspaceId }, userId: workspaceId },
    { expectedUserId, operation: "catalog", input: [] }, null,
  ]) await assert.rejects(() => readLearningAdminRequest(request(JSON.stringify(value)), origin), status(422));
});

test("admin origin and media checks precede any reading of private pack data", async () => {
  for (const headers of [{ origin: "https://attacker.example.invalid" }, { origin: "null" }]) {
    const incoming = request(body, headers);
    await assert.rejects(() => readLearningAdminRequest(incoming, origin), status(403));
    assert.equal(incoming.bodyUsed, false);
  }
  const absent = request(); absent.headers.delete("origin");
  await assert.rejects(() => readLearningAdminRequest(absent, origin), status(403));
  assert.equal(absent.bodyUsed, false);
  const media = request(body, { "content-type": "text/plain" });
  await assert.rejects(() => readLearningAdminRequest(media, origin), status(415));
  assert.equal(media.bodyUsed, false);
});

test("admin upload cap measures bytes even with absent or dishonest Content-Length", async () => {
  const large = JSON.stringify({ expectedUserId, operation: "inspectPack", input: { workspaceId, pack: "é".repeat(LEARNING_ADMIN_MAX_BYTES / 2) } });
  await assert.rejects(() => readLearningAdminRequest(request(large), origin), status(413));
  await assert.rejects(() => readLearningAdminRequest(request(large, { "content-length": "1" }), origin), status(413));
  for (const length of [String(LEARNING_ADMIN_MAX_BYTES + 1), "-1", "NaN", "1.5"]) {
    const incoming = request(body, { "content-length": length });
    await assert.rejects(() => readLearningAdminRequest(incoming, origin), status(413));
    assert.equal(incoming.bodyUsed, false);
  }
});

test("admin chunked overflow cancels the stream and incomplete UTF-8 is rejected", async () => {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) { controller.enqueue(new Uint8Array(100_000)); },
    cancel() { cancelled = true; },
  });
  const incoming = new Request(`${origin}/api/learning/admin`, {
    method: "POST", headers: { origin, "content-type": "application/json" }, body: stream, duplex: "half",
  } as RequestInit);
  await assert.rejects(() => readLearningAdminRequest(incoming, origin), status(413));
  assert.equal(cancelled, true);
  await assert.rejects(() => readLearningAdminRequest(request(new Uint8Array([0xc3])), origin), status(400));
});

test("admin malformed private input never appears in boundary error messages", async () => {
  const privateMarker = "SYNTHETIC_PRIVATE_MARKER_DO_NOT_ECHO";
  for (const value of [privateMarker, JSON.stringify({ expectedUserId, operation: privateMarker, input: {} })]) {
    await assert.rejects(() => readLearningAdminRequest(request(value), origin), error => {
      assert.ok(error instanceof LearningHttpError);
      assert.equal(error.message.includes(privateMarker), false);
      return true;
    });
  }
});
