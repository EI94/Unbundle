import test from "node:test";
import assert from "node:assert/strict";
import {
  addWorkingDays,
  easterSunday,
  inRomeSendWindow,
  isItalianHoliday,
  isoWeekOf,
  isoWeekRome,
  itemsToMarkMissing,
  nextReminderAt,
  reminderAction,
  requestsToExpire,
  romeDate,
  romeLocalToUtc,
  romeParts,
  weeklySummaryDue,
  workingDaysBetween,
  type ReminderRequestState,
  type WorkingCalendar,
} from "./schedule.ts";

const at = (iso: string) => new Date(iso);

test("Easter and Easter Monday", () => {
  assert.equal(easterSunday(2024), "2024-03-31");
  assert.equal(easterSunday(2026), "2026-04-05");
  assert.equal(easterSunday(2027), "2027-03-28");
  assert.equal(easterSunday(2038), "2038-04-25");
  assert.equal(isItalianHoliday("2026-04-06"), true, "Pasquetta");
  assert.equal(isItalianHoliday("2027-03-29"), true, "Pasquetta 2027");
  assert.equal(isItalianHoliday("2026-04-07"), false);
});

test("national holidays, no patron saints, and bridges stay working days", () => {
  for (const d of ["2026-01-01", "2026-01-06", "2026-04-25", "2026-05-01", "2026-06-02", "2026-08-15", "2026-11-01", "2026-12-08", "2026-12-25", "2026-12-26"]) {
    assert.equal(isItalianHoliday(d), true, d);
  }
  assert.equal(isItalianHoliday("2026-06-29"), false, "San Pietro e Paolo (Roma) is a patron saint, not national");
  // 4 ottobre: di nuovo festa nazionale dal 2026.
  assert.equal(isItalianHoliday("2025-10-04"), false);
  assert.equal(isItalianHoliday("2027-10-04"), true, "San Francesco 2027 (Monday)");
  assert.equal(workingDaysBetween(at("2027-10-01T09:00:00Z"), at("2027-10-05T09:00:00Z")), 1);
  // Ponte: lunedì 7 dicembre 2026 tra il weekend e l'Immacolata di martedì è lavorativo.
  assert.equal(workingDaysBetween(at("2026-12-04T09:00:00Z"), at("2026-12-10T09:00:00Z")), 3);
  assert.throws(() => isItalianHoliday("2026-02-30"));
});

test("Rome dates and windows across daylight saving changes", () => {
  assert.equal(romeDate(at("2026-10-06T22:30:00Z")), "2026-10-07", "00:30 in Rome is already the next day");
  assert.deepEqual(romeParts(at("2026-10-07T07:00:00Z")), { date: "2026-10-07", hour: 9, minute: 0, weekday: 3 });
  // Ora solare (UTC+1) prima del 29 marzo 2026, legale (UTC+2) dopo.
  assert.equal(inRomeSendWindow(at("2026-03-27T07:00:00Z")), false, "08:00 CET");
  assert.equal(inRomeSendWindow(at("2026-03-27T08:00:00Z")), true, "09:00 CET");
  assert.equal(inRomeSendWindow(at("2026-03-30T07:00:00Z")), true, "09:00 CEST");
  assert.equal(inRomeSendWindow(at("2026-10-23T16:00:00Z")), false, "18:00 CEST");
  assert.equal(inRomeSendWindow(at("2026-10-26T16:59:00Z")), true, "17:59 CET");
  assert.equal(inRomeSendWindow(at("2026-10-10T09:00:00Z")), false, "Saturday");
  assert.equal(inRomeSendWindow(at("2026-12-08T09:00:00Z")), false, "Immacolata");
  assert.equal(romeLocalToUtc("2026-03-29", 9).toISOString(), "2026-03-29T07:00:00.000Z");
  assert.equal(romeLocalToUtc("2026-03-28", 9).toISOString(), "2026-03-28T08:00:00.000Z");
  assert.throws(() => romeLocalToUtc("2026-03-29", 2, 30), /inesistente/);
});

test("working-day arithmetic", () => {
  assert.equal(workingDaysBetween(at("2026-10-05T08:00:00Z"), at("2026-10-05T15:00:00Z")), 0);
  assert.equal(workingDaysBetween(at("2026-10-09T08:00:00Z"), at("2026-10-12T08:00:00Z")), 1, "Friday to Monday");
  assert.equal(workingDaysBetween(at("2026-10-12T08:00:00Z"), at("2026-10-09T08:00:00Z")), 0);
  assert.equal(addWorkingDays("2026-04-02", 3), "2026-04-08", "Thursday + 3 skips the weekend and Easter Monday");
  assert.equal(addWorkingDays("2026-10-05", 0), "2026-10-05");
});

test("ISO weeks", () => {
  assert.equal(isoWeekOf("2026-01-01"), "2026-W01");
  assert.equal(isoWeekOf("2027-01-01"), "2026-W53");
  assert.equal(isoWeekOf("2024-12-30"), "2025-W01");
  assert.equal(isoWeekRome(at("2026-10-04T22:30:00Z")), "2026-W41", "Monday 00:30 in Rome");
});

function req(over: Partial<ReminderRequestState> = {}): ReminderRequestState {
  return {
    status: "inviata",
    purpose: "raccolta",
    sentAt: at("2026-10-05T08:00:00Z"), // lunedì 5 ottobre, 10:00 a Roma
    expiresAt: at("2026-11-04T08:00:00Z"),
    revokedAt: null,
    reminderCount: 0,
    escalatedAt: null,
    caseStatus: "raccolta",
    ...over,
  };
}

test("reminders at 3 and 7 working days, then the Owner at 10, never a third reminder", () => {
  assert.equal(reminderAction(req(), at("2026-10-07T08:00:00Z")), null, "2 working days");
  assert.equal(reminderAction(req(), at("2026-10-08T08:00:00Z")), "promemoria_1");
  assert.equal(reminderAction(req({ status: "in_corso" }), at("2026-10-08T08:00:00Z")), "promemoria_1");
  assert.equal(reminderAction(req({ reminderCount: 1 }), at("2026-10-13T08:00:00Z")), null);
  assert.equal(reminderAction(req({ reminderCount: 1 }), at("2026-10-14T08:00:00Z")), "promemoria_2");
  assert.equal(reminderAction(req({ reminderCount: 2 }), at("2026-10-16T08:00:00Z")), null);
  assert.equal(reminderAction(req({ reminderCount: 2 }), at("2026-10-19T08:00:00Z")), "segnalazione_owner");
  assert.equal(reminderAction(req({ reminderCount: 2, escalatedAt: at("2026-10-19T08:00:00Z") }), at("2026-10-27T08:00:00Z")), null);
});

test("no reminders outside the window or for requests that do not wait", () => {
  const due = at("2026-10-08T08:00:00Z");
  assert.equal(reminderAction(req(), at("2026-10-08T18:30:00Z")), null, "20:30 in Rome");
  assert.equal(reminderAction(req(), at("2026-10-10T08:00:00Z")), null, "Saturday");
  assert.equal(reminderAction(req({ purpose: "approvazioni" }), due), null);
  assert.equal(reminderAction(req({ status: "completata" }), due), null);
  assert.equal(reminderAction(req({ status: "bozza", sentAt: null }), due), null);
  assert.equal(reminderAction(req({ revokedAt: at("2026-10-06T08:00:00Z") }), due), null);
  assert.equal(reminderAction(req({ expiresAt: at("2026-10-08T07:00:00Z") }), due), null);
  assert.equal(reminderAction(req({ caseStatus: "sospeso" }), due), null);
  assert.equal(reminderAction(req({ caseStatus: "chiuso" }), due), null);
});

test("a holiday shifts the reminder to the next working day", () => {
  // Inviata giovedì 2 aprile 2026: venerdì 3, (weekend), Pasquetta 6 esclusa, martedì 7, mercoledì 8.
  const r = req({ sentAt: at("2026-04-02T08:00:00Z"), expiresAt: at("2026-05-02T08:00:00Z") });
  assert.equal(reminderAction(r, at("2026-04-07T08:00:00Z")), null);
  assert.equal(reminderAction(r, at("2026-04-08T08:00:00Z")), "promemoria_1");
  assert.equal(nextReminderAt(r, at("2026-04-02T09:00:00Z"))?.toISOString(), "2026-04-08T07:00:00.000Z");
});

test("the calendar can be injected", () => {
  const everyDay: WorkingCalendar = { isWorkingDay: () => true };
  assert.equal(reminderAction(req(), at("2026-10-08T08:00:00Z"), everyDay), "promemoria_1");
  assert.equal(workingDaysBetween(at("2026-10-09T08:00:00Z"), at("2026-10-12T08:00:00Z"), everyDay), 3);
  assert.equal(inRomeSendWindow(at("2026-10-10T09:00:00Z"), everyDay), true);
});

test("next reminder time follows the thresholds and stops before expiry", () => {
  const now = at("2026-10-05T09:00:00Z");
  assert.equal(nextReminderAt(req(), now)?.toISOString(), "2026-10-08T07:00:00.000Z");
  assert.equal(nextReminderAt(req({ reminderCount: 1 }), now)?.toISOString(), "2026-10-14T07:00:00.000Z");
  assert.equal(nextReminderAt(req({ reminderCount: 2 }), now)?.toISOString(), "2026-10-19T07:00:00.000Z");
  assert.equal(nextReminderAt(req({ reminderCount: 2, escalatedAt: now }), now), null);
  assert.equal(nextReminderAt(req({ expiresAt: at("2026-10-07T00:00:00Z") }), now), null);
  assert.equal(nextReminderAt(req({ status: "completata" }), now), null);
});

test("rule 7a: asked items past due after two reminders become missing", () => {
  const now = at("2026-10-20T08:00:00Z");
  const ids = itemsToMarkMissing(
    [
      { id: "a", status: "chiesta", dueAt: at("2026-10-19T00:00:00Z"), requestReminderCount: 2 },
      { id: "b", status: "chiesta", dueAt: at("2026-10-19T00:00:00Z"), requestReminderCount: 1 },
      { id: "c", status: "chiesta", dueAt: at("2026-10-21T00:00:00Z"), requestReminderCount: 2 },
      { id: "d", status: "in_verifica", dueAt: at("2026-10-19T00:00:00Z"), requestReminderCount: 2 },
      { id: "e", status: "chiesta", dueAt: null, requestReminderCount: 2 },
    ],
    now,
  );
  assert.deepEqual(ids, ["a"]);
});

test("rule 7d: waiting requests past expiry expire", () => {
  const now = at("2026-11-05T00:00:00Z");
  const ids = requestsToExpire(
    [
      { id: "a", status: "inviata", expiresAt: at("2026-11-04T08:00:00Z") },
      { id: "b", status: "in_corso", expiresAt: at("2026-11-05T00:00:00Z") },
      { id: "c", status: "aperta", expiresAt: at("2026-11-06T00:00:00Z") },
      { id: "d", status: "completata", expiresAt: at("2026-11-01T00:00:00Z") },
      { id: "e", status: "revocata", expiresAt: at("2026-11-01T00:00:00Z") },
      { id: "f", status: "bozza", expiresAt: null },
    ],
    now,
  );
  assert.deepEqual(ids, ["a", "b"]);
});

test("weekly summary on the first working day of the week", () => {
  assert.deepEqual(weeklySummaryDue(at("2026-10-05T08:00:00Z")), { due: true, week: "2026-W41" });
  assert.equal(weeklySummaryDue(at("2026-10-05T06:00:00Z")).due, false, "08:00 in Rome, before the window");
  assert.equal(weeklySummaryDue(at("2026-10-06T08:00:00Z")).due, false, "Tuesday");
  assert.equal(weeklySummaryDue(at("2026-04-06T08:00:00Z")).due, false, "Easter Monday");
  assert.deepEqual(weeklySummaryDue(at("2026-04-07T08:00:00Z")), { due: true, week: "2026-W15" });
});
