import test from "node:test";
import assert from "node:assert/strict";
import { learningRetentionEligibility } from "./retention.ts";
const closedAt = new Date("2026-10-01T12:00:00.000Z");
test("retention is ineligible before expiry and eligible at the exact recorded boundary", () => {
  const input = { status: "closed", closedAt, retentionDays: 90 };
  assert.equal(learningRetentionEligibility(input, new Date("2026-12-30T11:59:59.999Z")).eligible, false);
  const actual = learningRetentionEligibility(input, new Date("2026-12-30T12:00:00.000Z"));
  assert.equal(actual.eligible, true);
  assert.equal(actual.expiresAt?.toISOString(), "2026-12-30T12:00:00.000Z");
});
test("published programs and missing closure date cannot be purged", () => {
  assert.equal(learningRetentionEligibility({ status: "published", closedAt, retentionDays: 1 }, new Date("2027-01-01T00:00:00Z")).eligible, false);
  assert.equal(learningRetentionEligibility({ status: "closed", closedAt: null, retentionDays: 1 }).eligible, false);
});
test("archived programs are eligible only after the same retention period", () => {
  assert.equal(learningRetentionEligibility({ status: "archived", closedAt, retentionDays: 1 }, new Date("2026-10-02T12:00:00Z")).eligible, true);
});
test("retention configuration rejects invalid dates, zero, fractional and excessive days", () => {
  for (const retentionDays of [0, -1, 1.5, 3651, NaN]) assert.throws(() => learningRetentionEligibility({ status: "closed", closedAt, retentionDays }));
  assert.throws(() => learningRetentionEligibility({ status: "closed", closedAt: new Date("invalid"), retentionDays: 1 }));
  assert.throws(() => learningRetentionEligibility({ status: "closed", closedAt, retentionDays: 1 }, new Date("invalid")));
});
test("retention elapsed time is unaffected by Rome DST change", () => {
  const input = { status: "closed", closedAt: new Date("2026-10-24T10:00:00Z"), retentionDays: 2 };
  assert.equal(learningRetentionEligibility(input, new Date("2026-10-26T09:59:59Z")).eligible, false);
  assert.equal(learningRetentionEligibility(input, new Date("2026-10-26T10:00:00Z")).eligible, true);
});
