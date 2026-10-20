import test from "node:test";
import assert from "node:assert/strict";
import {
  addCalendarDays,
  addWorkingDays,
  easterSunday,
  inRomeSendWindow,
  isItalianHoliday,
  isWorkingDay,
  isoWeekday,
  italianHolidays,
  nextRomeSendWindowStart,
  romeDate,
  romeLocalToUtc,
  romeParts,
  workingDaysBetween,
} from "./calendar.ts";

const at = (iso: string) => new Date(iso);

test("Easter Sunday is computed for known years", () => {
  assert.equal(easterSunday(2019), "2019-04-21");
  assert.equal(easterSunday(2024), "2024-03-31");
  assert.equal(easterSunday(2025), "2025-04-20");
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
  assert.equal(easterSunday(2038), "2038-04-25");
  assert.throws(() => easterSunday(1800));
});

test("Easter Monday and the national holidays are not working days", () => {
  assert.equal(isItalianHoliday("2026-04-06"), true);
  assert.equal(isWorkingDay("2026-04-06"), false);
  assert.equal(isItalianHoliday("2025-04-21"), true);
  // Good Friday is a working day in Italy.
  assert.equal(isWorkingDay("2026-04-03"), true);
  for (const date of ["2027-01-01", "2027-01-06", "2026-04-25", "2026-05-01", "2026-06-02", "2026-08-15", "2026-11-01", "2026-12-08", "2026-12-25", "2026-12-26"]) {
    assert.equal(isItalianHoliday(date), true, date);
  }
  const names = italianHolidays(2026).map((h) => h.date);
  assert.deepEqual(names, [...names].sort());
  assert.equal(new Set(names).size, names.length);
});

test("4 October is a national holiday from 2026", () => {
  assert.equal(isItalianHoliday("2025-10-04"), false);
  assert.equal(isItalianHoliday("2026-10-04"), true);
  assert.equal(isItalianHoliday("2027-10-04"), true);
  assert.equal(isWorkingDay("2027-10-04"), false);
});

test("bridge days and local patron days stay working days", () => {
  // Monday between Sunday and the Tuesday of 8 December.
  assert.equal(isoWeekday("2026-12-07"), 1);
  assert.equal(isWorkingDay("2026-12-07"), true);
  // Monday 1 June 2026, before Tuesday 2 June.
  assert.equal(isWorkingDay("2026-06-01"), true);
  // Patron saints are not national holidays (e.g. Rome 29 June, Milan 7 December).
  assert.equal(isWorkingDay("2026-06-29"), true);
  // Weekends are never working days.
  assert.equal(isWorkingDay("2026-10-10"), false);
  assert.equal(isWorkingDay("2026-10-11"), false);
});

test("reminders at 3, 7 and 10 working days skip weekends and Easter Monday", () => {
  const sent = "2026-04-02";
  assert.equal(addWorkingDays(sent, 3), "2026-04-08");
  assert.equal(addWorkingDays(sent, 7), "2026-04-14");
  assert.equal(addWorkingDays(sent, 10), "2026-04-17");
  assert.equal(workingDaysBetween(sent, "2026-04-08"), 3);
  assert.equal(workingDaysBetween(sent, "2026-04-07"), 2);
  assert.equal(workingDaysBetween(sent, "2026-04-17"), 10);
});

test("reminders across 1 May and the end of the year", () => {
  const sent = "2026-04-27";
  assert.equal(addWorkingDays(sent, 3), "2026-04-30");
  assert.equal(addWorkingDays(sent, 7), "2026-05-07");
  assert.equal(addWorkingDays(sent, 10), "2026-05-12");
  assert.equal(addWorkingDays("2026-12-23", 1), "2026-12-24");
  assert.equal(addWorkingDays("2026-12-23", 2), "2026-12-28");
  assert.equal(addWorkingDays("2026-12-31", 1), "2027-01-04");
  assert.equal(addWorkingDays("2026-12-31", 2), "2027-01-05");
});

test("working-day arithmetic is consistent", () => {
  assert.equal(addWorkingDays("2026-10-09", 0), "2026-10-09");
  assert.equal(addWorkingDays("2026-10-10", 0), "2026-10-10");
  assert.equal(addWorkingDays("2026-10-09", 1), "2026-10-12");
  assert.equal(addWorkingDays("2026-10-10", 1), "2026-10-12");
  assert.equal(workingDaysBetween("2026-10-12", "2026-10-12"), 0);
  assert.equal(workingDaysBetween("2026-10-12", "2026-10-09"), 0);
  for (let n = 0; n <= 25; n++) {
    for (const start of ["2026-03-27", "2026-04-02", "2026-12-21", "2027-07-30"]) {
      assert.equal(workingDaysBetween(start, addWorkingDays(start, n)), n, `${start} + ${n}`);
    }
  }
  assert.throws(() => addWorkingDays("2026-10-09", -1));
  assert.throws(() => addWorkingDays("2026-10-09", 1.5));
  assert.throws(() => addWorkingDays("2026-02-30", 1));
  assert.throws(() => isWorkingDay("2026-13-01"));
  assert.throws(() => isWorkingDay("07/10/2026"));
  assert.equal(addCalendarDays("2028-02-28", 1), "2028-02-29");
});

test("instants become Rome dates before counting", () => {
  // 23:30 UTC on Saturday 28 March is already Sunday 29 March in Rome.
  assert.equal(romeDate(at("2026-03-28T23:30:00Z")), "2026-03-29");
  assert.equal(romeDate(at("2026-07-14T22:30:00Z")), "2026-07-15");
  assert.equal(romeDate(at("2026-07-14T21:59:00Z")), "2026-07-14");
  // Friday 22:30 UTC in summer = Saturday 00:30 in Rome: not a working day.
  assert.equal(isWorkingDay(at("2026-07-17T22:30:00Z")), false);
  assert.equal(addWorkingDays(at("2026-04-02T21:30:00Z"), 3), "2026-04-08");
  assert.deepEqual(romeParts(at("2026-10-07T10:15:00Z")), { date: "2026-10-07", year: 2026, month: 10, day: 7, hour: 12, minute: 15, weekday: 3 });
  assert.throws(() => romeDate(new Date("nope")));
});

test("the 09-18 Rome window follows winter time", () => {
  // Friday 27 March 2026, CET (UTC+1).
  assert.equal(inRomeSendWindow(at("2026-03-27T07:59:00Z")), false);
  assert.equal(inRomeSendWindow(at("2026-03-27T08:00:00Z")), true);
  assert.equal(inRomeSendWindow(at("2026-03-27T16:59:00Z")), true);
  assert.equal(inRomeSendWindow(at("2026-03-27T17:00:00Z")), false);
  // Monday 26 October 2026, back to CET.
  assert.equal(inRomeSendWindow(at("2026-10-26T07:30:00Z")), false);
  assert.equal(inRomeSendWindow(at("2026-10-26T08:00:00Z")), true);
});

test("the 09-18 Rome window follows summer time", () => {
  // Monday 30 March 2026, CEST (UTC+2), the day after the change.
  assert.equal(inRomeSendWindow(at("2026-03-30T06:59:00Z")), false);
  assert.equal(inRomeSendWindow(at("2026-03-30T07:00:00Z")), true);
  assert.equal(inRomeSendWindow(at("2026-03-30T15:59:00Z")), true);
  assert.equal(inRomeSendWindow(at("2026-03-30T16:00:00Z")), false);
});

test("no sending on weekends and holidays, even at 10 in Rome", () => {
  assert.equal(inRomeSendWindow(at("2026-10-10T08:00:00Z")), false);
  assert.equal(inRomeSendWindow(at("2026-04-06T08:00:00Z")), false);
  assert.equal(inRomeSendWindow(at("2026-12-25T09:00:00Z")), false);
  assert.equal(inRomeSendWindow(at("2026-12-07T09:00:00Z")), true);
});

test("the next window opens at 09:00 Rome on the next working day", () => {
  const inside = at("2026-10-07T10:00:00Z");
  assert.equal(nextRomeSendWindowStart(inside).toISOString(), inside.toISOString());
  // Early morning on a working day: same day at 09:00 CEST.
  assert.equal(nextRomeSendWindowStart(at("2026-03-30T05:00:00Z")).toISOString(), "2026-03-30T07:00:00.000Z");
  // Friday evening before the change to summer time: Monday 09:00 CEST.
  assert.equal(nextRomeSendWindowStart(at("2026-03-27T17:30:00Z")).toISOString(), "2026-03-30T07:00:00.000Z");
  // Friday evening before Easter Monday: Tuesday.
  assert.equal(nextRomeSendWindowStart(at("2026-04-03T16:30:00Z")).toISOString(), "2026-04-07T07:00:00.000Z");
  // Friday evening before the change to winter time: Monday 09:00 CET.
  assert.equal(nextRomeSendWindowStart(at("2026-10-23T17:00:00Z")).toISOString(), "2026-10-26T08:00:00.000Z");
});

test("Rome local times convert to UTC across the clock change", () => {
  assert.equal(romeLocalToUtc("2026-01-15", 9).toISOString(), "2026-01-15T08:00:00.000Z");
  assert.equal(romeLocalToUtc("2026-07-15", 9, 30).toISOString(), "2026-07-15T07:30:00.000Z");
  assert.equal(romeLocalToUtc("2026-03-29", 9).toISOString(), "2026-03-29T07:00:00.000Z");
  assert.equal(romeLocalToUtc("2026-10-25", 9).toISOString(), "2026-10-25T08:00:00.000Z");
  assert.throws(() => romeLocalToUtc("2026-10-25", 24));
});
