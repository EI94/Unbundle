import test from "node:test";
import assert from "node:assert/strict";
import { addDaysToDate, computeStaleAt, defaultRequiresValidityPeriod, isIsoDate, itemsToExpire, romeDateOf, romeMidnightUtc, romeOffsetMinutes } from "./freshness.ts";

test("Rome offset follows summer and winter time", () => {
  assert.equal(romeOffsetMinutes(new Date("2026-07-01T12:00:00Z")), 120);
  assert.equal(romeOffsetMinutes(new Date("2026-01-15T12:00:00Z")), 60);
});

test("Rome calendar date of an instant", () => {
  assert.equal(romeDateOf(new Date("2026-10-07T21:59:59Z")), "2026-10-07");
  assert.equal(romeDateOf(new Date("2026-10-07T22:00:00Z")), "2026-10-08");
  assert.equal(romeDateOf(new Date("2026-01-07T23:30:00Z")), "2026-01-08");
});

test("Rome midnight across the clock changes", () => {
  assert.equal(romeMidnightUtc("2026-03-29").toISOString(), "2026-03-28T23:00:00.000Z"); // day of the spring change
  assert.equal(romeMidnightUtc("2026-03-30").toISOString(), "2026-03-29T22:00:00.000Z");
  assert.equal(romeMidnightUtc("2026-10-25").toISOString(), "2026-10-24T22:00:00.000Z"); // day of the autumn change
  assert.equal(romeMidnightUtc("2026-10-26").toISOString(), "2026-10-25T23:00:00.000Z");
});

test("calendar helpers validate dates", () => {
  assert.equal(isIsoDate("2026-02-29"), false);
  assert.equal(isIsoDate("2028-02-29"), true);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("1/10/2026"), false);
  assert.equal(addDaysToDate("2026-12-30", 3), "2027-01-02");
  assert.throws(() => addDaysToDate("2026-02-30", 1));
  assert.throws(() => romeMidnightUtc("nope"));
});

test("stale_at = (valid_from or answer date) + days, at 00:00 in Rome", () => {
  const answeredAt = new Date("2026-10-07T22:30:00Z"); // 00:30 of 8 October in Rome
  assert.equal(computeStaleAt({ freshnessDays: null, validFrom: null, answeredAt }), null);
  assert.equal(computeStaleAt({ freshnessDays: 7, validFrom: null, answeredAt })?.toISOString(), "2026-10-14T22:00:00.000Z");
  assert.equal(computeStaleAt({ freshnessDays: 7, validFrom: "2026-10-01", answeredAt })?.toISOString(), "2026-10-07T22:00:00.000Z");
  // Across the autumn change the deadline is still Rome midnight (UTC+1 after the change).
  assert.equal(computeStaleAt({ freshnessDays: 7, validFrom: "2026-10-20", answeredAt })?.toISOString(), "2026-10-26T23:00:00.000Z");
  assert.throws(() => computeStaleAt({ freshnessDays: 0, validFrom: null, answeredAt }));
  assert.throws(() => computeStaleAt({ freshnessDays: 7, validFrom: "2026-02-31", answeredAt }));
});

test("validated items whose data expired, for the uc-freshness cron", () => {
  const now = new Date("2026-10-07T22:00:00Z");
  const items = [
    { id: "a", status: "validata" as const, staleAt: new Date("2026-10-07T22:00:00Z") },
    { id: "b", status: "validata" as const, staleAt: new Date("2026-10-08T22:00:00Z") },
    { id: "c", status: "validata" as const, staleAt: null },
    { id: "d", status: "in_verifica" as const, staleAt: new Date("2026-10-01T22:00:00Z") },
    { id: "e", status: "validata" as const, staleAt: new Date("2026-09-30T22:00:00Z") },
  ];
  assert.deepEqual(itemsToExpire(items, now), ["a", "e"]);
  assert.deepEqual(itemsToExpire([], now), []);
});

test("amounts require a validity period by default", () => {
  assert.equal(defaultRequiresValidityPeriod("valuta"), true);
  assert.equal(defaultRequiresValidityPeriod("numero"), false);
  assert.equal(defaultRequiresValidityPeriod(null), false);
});
