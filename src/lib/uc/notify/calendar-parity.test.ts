// The reminder schedule keeps its own copy of the Italian working-day calendar
// for use without injection; the cron injects `src/lib/uc/calendar.ts`. This
// test keeps the two copies identical, day by day.
import test from "node:test";
import assert from "node:assert/strict";
import * as shared from "../calendar.ts";
import * as schedule from "./schedule.ts";

const FROM_YEAR = 2024;
const TO_YEAR = 2040;

test("reminder calendar and shared calendar agree on Easter and on every day", () => {
  for (let year = FROM_YEAR; year <= TO_YEAR; year++) {
    assert.equal(schedule.easterSunday(year), shared.easterSunday(year), `Easter ${year}`);
  }
  assert.equal(schedule.FOUR_OCTOBER_HOLIDAY_FROM_YEAR, shared.FOUR_OCTOBER_HOLIDAY_FROM_YEAR);
  let day = `${FROM_YEAR}-01-01`;
  let checked = 0;
  while (day <= `${TO_YEAR}-12-31`) {
    assert.equal(schedule.isItalianHoliday(day), shared.isItalianHoliday(day), `holiday ${day}`);
    assert.equal(schedule.ITALIAN_CALENDAR.isWorkingDay(day), shared.isWorkingDay(day), `working day ${day}`);
    day = shared.addCalendarDays(day, 1);
    checked++;
  }
  assert.ok(checked > 6000);
});

test("working days between two instants match with either calendar", () => {
  const sharedCalendar: schedule.WorkingCalendar = { isWorkingDay: (d) => shared.isWorkingDay(d) };
  const cases: [string, string][] = [
    ["2026-09-30T08:00:00Z", "2026-10-07T08:00:00Z"],
    ["2026-12-23T10:00:00Z", "2027-01-08T10:00:00Z"],
    ["2027-03-25T10:00:00Z", "2027-04-02T10:00:00Z"],
    ["2026-10-31T23:30:00Z", "2026-11-03T06:00:00Z"],
  ];
  for (const [from, to] of cases) {
    const a = new Date(from);
    const b = new Date(to);
    assert.equal(schedule.workingDaysBetween(a, b), schedule.workingDaysBetween(a, b, sharedCalendar), `${from} → ${to}`);
    assert.equal(schedule.workingDaysBetween(a, b), shared.workingDaysBetween(a, b), `${from} → ${to} (shared)`);
  }
});
