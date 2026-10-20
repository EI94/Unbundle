import test from "node:test";
import assert from "node:assert/strict";
import {
  decideExistingSubmission,
  IDEMPOTENCY_RETRY_AFTER_MAX_SECONDS,
  IDEMPOTENCY_STALE_AFTER_SECONDS,
  tokenPrincipalKey,
} from "./idempotency.ts";

const HASH = "a".repeat(64);
const row = (patch: Partial<Parameters<typeof decideExistingSubmission>[0]> = {}) => ({
  status: "pending",
  requestHash: HASH,
  useCaseId: null,
  reservedUseCaseId: "uc-prenotato",
  ageSeconds: 1,
  ...patch,
});

test("hash diverso → conflitto, qualunque sia lo stato", () => {
  for (const status of ["pending", "completed", "failed"]) {
    assert.deepEqual(decideExistingSubmission(row({ status, useCaseId: "x" }), "b".repeat(64)), { kind: "conflict" });
  }
});

test("stesso hash e completata → duplicato; completata senza segnalazione → conflitto", () => {
  assert.deepEqual(decideExistingSubmission(row({ status: "completed", useCaseId: "uc-1" }), HASH), { kind: "duplicate" });
  assert.deepEqual(decideExistingSubmission(row({ status: "completed", useCaseId: null }), HASH), { kind: "conflict" });
});

test("failed → ripresa, anche appena fallita", () => {
  assert.deepEqual(decideExistingSubmission(row({ status: "failed", ageSeconds: 0 }), HASH), { kind: "takeover" });
});

test("riga già collegata a una segnalazione (anche failed o pending, codice precedente) → duplicato, mai ripresa", () => {
  assert.deepEqual(decideExistingSubmission(row({ status: "failed", useCaseId: "uc-1" }), HASH), { kind: "duplicate" });
  assert.deepEqual(decideExistingSubmission(row({ status: "pending", useCaseId: "uc-1", ageSeconds: 3600 }), HASH), { kind: "duplicate" });
  assert.deepEqual(decideExistingSubmission(row({ status: "pending", useCaseId: "uc-1", ageSeconds: 1 }), HASH), { kind: "duplicate" });
});

test("in corso da poco → in_progress con retryAfterSeconds tra 1 e 5", () => {
  const fresh = decideExistingSubmission(row({ ageSeconds: 0.2 }), HASH);
  assert.deepEqual(fresh, { kind: "in_progress", retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_MAX_SECONDS });
  const almostStale = decideExistingSubmission(row({ ageSeconds: IDEMPOTENCY_STALE_AFTER_SECONDS - 0.5 }), HASH);
  assert.deepEqual(almostStale, { kind: "in_progress", retryAfterSeconds: 1 });
  const odd = decideExistingSubmission(row({ ageSeconds: Number.NaN }), HASH);
  assert.equal(odd.kind, "in_progress");
});

test("in corso da oltre 2 minuti (updated_at) → ripresa", () => {
  assert.equal(IDEMPOTENCY_STALE_AFTER_SECONDS, 120);
  assert.deepEqual(decideExistingSubmission(row({ ageSeconds: 120 }), HASH), { kind: "takeover" });
  assert.deepEqual(decideExistingSubmission(row({ ageSeconds: 3600 }), HASH), { kind: "takeover" });
});

test("riga del codice precedente (id prenotato NULL) mai collegata → sempre in corso, mai ripresa", () => {
  const legacy = { reservedUseCaseId: null, useCaseId: null };
  for (const patch of [{ status: "failed", ageSeconds: 0 }, { status: "pending", ageSeconds: 3600 }, { status: "pending", ageSeconds: 1 }]) {
    assert.deepEqual(decideExistingSubmission(row({ ...legacy, ...patch }), HASH), {
      kind: "in_progress",
      retryAfterSeconds: IDEMPOTENCY_RETRY_AFTER_MAX_SECONDS,
    });
  }
  // Collegata a una segnalazione: duplicato; contenuto diverso: conflitto.
  assert.deepEqual(decideExistingSubmission(row({ reservedUseCaseId: null, useCaseId: "uc-1", status: "failed" }), HASH), { kind: "duplicate" });
  assert.deepEqual(decideExistingSubmission(row({ ...legacy, status: "failed" }), "b".repeat(64)), { kind: "conflict" });
});

test("principal di fase 1 dal token", () => {
  assert.equal(tokenPrincipalKey("11111111-1111-4111-8111-111111111111"), "token:11111111-1111-4111-8111-111111111111");
});
