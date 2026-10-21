import test from "node:test";
import assert from "node:assert/strict";
import {
  TEAM_REQUEST_RETRY_AFTER_MAX_SECONDS,
  TEAM_REQUEST_STALE_AFTER_SECONDS,
  decideExistingTeamRequest,
  releasesKey,
} from "./idempotency.ts";

// Idempotenza del MCP del team (docs/use-case/DESIGN.md §9.4): stessa logica del connettore WP1.

const hash = "a".repeat(64);

test("hash diverso: conflitto, qualunque sia lo stato", () => {
  for (const status of ["pending", "completed", "failed"]) {
    assert.deepEqual(decideExistingTeamRequest({ status, requestHash: "b".repeat(64), ageSeconds: 999 }, hash), { kind: "conflict" }, status);
  }
});

test("completata con lo stesso hash: la stessa risposta (duplicato)", () => {
  assert.deepEqual(decideExistingTeamRequest({ status: "completed", requestHash: hash, ageSeconds: 0 }, hash), { kind: "duplicate" });
});

test("fallita, o in corso da oltre 2 minuti: si riprende", () => {
  assert.deepEqual(decideExistingTeamRequest({ status: "failed", requestHash: hash, ageSeconds: 1 }, hash), { kind: "takeover" });
  assert.deepEqual(decideExistingTeamRequest({ status: "pending", requestHash: hash, ageSeconds: TEAM_REQUEST_STALE_AFTER_SECONDS }, hash), { kind: "takeover" });
  assert.deepEqual(decideExistingTeamRequest({ status: "pending", requestHash: hash, ageSeconds: 3600 }, hash), { kind: "takeover" });
});

test("in corso da poco: idempotency_in_progress con un'attesa da 1 a 5 secondi", () => {
  assert.deepEqual(decideExistingTeamRequest({ status: "pending", requestHash: hash, ageSeconds: 0 }, hash), {
    kind: "in_progress",
    retryAfterSeconds: TEAM_REQUEST_RETRY_AFTER_MAX_SECONDS,
  });
  assert.deepEqual(decideExistingTeamRequest({ status: "pending", requestHash: hash, ageSeconds: 118.5 }, hash), { kind: "in_progress", retryAfterSeconds: 2 });
  assert.deepEqual(decideExistingTeamRequest({ status: "pending", requestHash: hash, ageSeconds: Number.NaN }, hash), { kind: "in_progress", retryAfterSeconds: 5 });
  assert.deepEqual(decideExistingTeamRequest({ status: "pending", requestHash: hash, ageSeconds: -4 }, hash), { kind: "in_progress", retryAfterSeconds: 5 });
});

test("la chiave torna libera solo per un errore certo che non ha scritto nulla", () => {
  for (const code of ["invalid_payload", "not_found", "permesso_mancante", "version_conflict", "transizione_non_ammessa", "area_spenta"]) {
    assert.equal(releasesKey(code, { partial: false }), true, code);
    assert.equal(releasesKey(code, { partial: true }), false, `${code} dopo una scrittura a metà`);
  }
  for (const code of ["riprova", "internal_error", "rate_limited", "idempotency_conflict"]) assert.equal(releasesKey(code, { partial: false }), false, code);
});
