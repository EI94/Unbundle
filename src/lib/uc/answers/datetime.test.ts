import test from "node:test";
import assert from "node:assert/strict";
import {
  daysInMonth,
  isIsoDate,
  isLeapYear,
  isValidTimeZone,
  itemTimeZone,
  localToUtcCandidates,
  normalizeData,
  normalizeDataOra,
  parseDateIt,
  parseDayMonth,
  parseTimeIt,
  romeToday,
  tzOffsetMinutes,
} from "./datetime.ts";

const ctx = { today: "2026-10-07", tz: "Europe/Rome" as const };
const date = (input: unknown) => {
  const p = parseDateIt(input);
  assert.ok(p.ok, String(input));
  return p.value;
};
const dateError = (input: unknown) => {
  const p = parseDateIt(input);
  assert.ok(!p.ok, String(input));
  return p.errors[0].code;
};

test("calendar helpers", () => {
  assert.ok(isLeapYear(2024) && isLeapYear(2000) && !isLeapYear(1900) && !isLeapYear(2026));
  assert.equal(daysInMonth(2024, 2), 29);
  assert.equal(daysInMonth(2026, 2), 28);
  assert.equal(daysInMonth(2026, 13), 0);
  assert.ok(isIsoDate("2024-02-29"));
  assert.ok(!isIsoDate("2026-02-29"));
  assert.ok(!isIsoDate("2026-2-1"));
});

test("parseDateIt reads gg/mm/aaaa, ISO and Italian month names", () => {
  assert.equal(date("30/09/2025"), "2025-09-30");
  assert.equal(date("1/10/2025"), "2025-10-01");
  assert.equal(date("01-10-2025"), "2025-10-01");
  assert.equal(date("01.10.2025"), "2025-10-01");
  assert.equal(date("2025-10-01"), "2025-10-01");
  assert.equal(date("3 marzo 2025"), "2025-03-03");
  assert.equal(date("1° gennaio 2026"), "2026-01-01");
  assert.equal(date("lunedì 2 febbraio 2026"), "2026-02-02");
  assert.equal(date("29/02/2024"), "2024-02-29");
});

test("parseDateIt rejects dates that do not exist", () => {
  assert.equal(dateError("31/02/2025"), "data_inesistente");
  assert.equal(dateError("29/02/2026"), "data_inesistente");
  assert.equal(dateError("31/04/2026"), "data_inesistente");
  assert.equal(dateError("01/13/2026"), "data_inesistente");
  assert.equal(dateError("00/10/2026"), "data_inesistente");
  assert.equal(dateError("01/10/1850"), "anno_non_valido");
  assert.equal(dateError("ieri"), "data_non_valida");
  assert.equal(dateError("10/2025"), "data_non_valida");
  assert.equal(dateError(""), "data_mancante");
  assert.equal(dateError(20251001), "data_non_valida");
});

test("two-digit years are read as 20xx with a warning", () => {
  const p = parseDateIt("30/09/25");
  assert.ok(p.ok);
  assert.equal(p.value, "2025-09-30");
  assert.equal(p.warnings[0].code, "anno_a_due_cifre");
  // The message never repeats the year that was written.
  assert.equal(parseDateIt("12/03/85").warnings[0].message.includes("85"), false);
});

test("parseDayMonth and parseTimeIt", () => {
  assert.deepEqual(parseDayMonth("01/05"), { ok: true, value: "05-01", warnings: [] });
  assert.deepEqual(parseDayMonth("1 maggio"), { ok: true, value: "05-01", warnings: [] });
  assert.ok(parseDayMonth("29/02").ok, "29 febbraio vale come ricorrenza");
  assert.ok(!parseDayMonth("31/04").ok);
  assert.ok(!parseDayMonth("10").ok);
  const t = (s: string) => {
    const p = parseTimeIt(s);
    return p.ok ? p.value : null;
  };
  assert.equal(t("23:30"), "23:30");
  assert.equal(t("23.30"), "23:30");
  assert.equal(t("7"), "07:00");
  assert.equal(t("ore 7"), "07:00");
  assert.equal(t("23h30"), "23:30");
  assert.equal(t("23:30 locali"), "23:30");
  assert.equal(t("24:00"), null);
  assert.equal(t("12:60"), null);
  assert.equal(t("mezzanotte"), null);
});

test("romeToday follows the Rome calendar, not UTC", () => {
  assert.equal(romeToday(new Date("2026-10-07T21:59:00Z")), "2026-10-07");
  assert.equal(romeToday(new Date("2026-10-07T22:00:00Z")), "2026-10-08");
  assert.equal(romeToday(new Date("2026-01-15T23:30:00Z")), "2026-01-16");
  assert.equal(romeToday(new Date("2026-01-15T22:30:00Z")), "2026-01-15");
});

test("time zones and offsets", () => {
  assert.ok(isValidTimeZone("Europe/Rome"));
  assert.ok(isValidTimeZone("UTC"));
  assert.ok(!isValidTimeZone("Europa/Roma"));
  assert.ok(!isValidTimeZone(""));
  assert.equal(tzOffsetMinutes("Europe/Rome", Date.UTC(2026, 6, 1)), 120);
  assert.equal(tzOffsetMinutes("Europe/Rome", Date.UTC(2026, 0, 1)), 60);
  assert.equal(itemTimeZone({ unit: "UTC" }), "UTC");
  assert.equal(itemTimeZone({ tz: "Europe/London" }), "Europe/London");
  assert.equal(itemTimeZone({}), "Europe/Rome");
});

test("localToUtcCandidates: missing hour in spring, repeated hour in autumn", () => {
  assert.deepEqual(localToUtcCandidates({ year: 2026, month: 3, day: 29, hour: 2, minute: 30 }, "Europe/Rome"), []);
  assert.deepEqual(
    localToUtcCandidates({ year: 2026, month: 10, day: 25, hour: 2, minute: 30 }, "Europe/Rome").map((ms) => new Date(ms).toISOString()),
    ["2026-10-25T00:30:00.000Z", "2026-10-25T01:30:00.000Z"],
  );
  assert.deepEqual(
    localToUtcCandidates({ year: 2026, month: 7, day: 1, hour: 23, minute: 30 }, "Europe/Rome").map((ms) => new Date(ms).toISOString()),
    ["2026-07-01T21:30:00.000Z"],
  );
});

test("data: normalized ISO date with the allowed window", () => {
  assert.deepEqual(normalizeData("30/09/2025", {}, ctx).normalized, "2025-09-30");
  assert.deepEqual(normalizeData({ value: "30/09/2025" }, {}, ctx).value, "2025-09-30");
  // Una data di estrazione non sta nel futuro.
  assert.equal(normalizeData("08/10/2026", { max_date: "today" }, ctx).errors[0].code, "data_futura");
  assert.deepEqual(normalizeData("07/10/2026", { max_date: "today" }, ctx).errors, []);
  assert.equal(normalizeData("06/10/2026", { min_date: "today" }, ctx).errors[0].code, "data_passata");
  assert.equal(normalizeData("31/12/2024", { min_date: "2025-01-01" }, ctx).errors[0].code, "data_troppo_presto");
  assert.equal(normalizeData("01/01/2028", { max_date: "2027-12-31" }, ctx).errors[0].code, "data_troppo_tardi");
  assert.equal(normalizeData("01/01/2028", { max_date: "2027-12-31" }, ctx).normalized, null);
});

test("data_ora: stored in UTC with the original time zone (a closure at 23:30 local time)", () => {
  const summer = normalizeDataOra("30/09/2025 23:30", {}, ctx);
  assert.deepEqual(summer.value, { local: "2025-09-30T23:30", tz: "Europe/Rome" });
  assert.deepEqual(summer.normalized, { utc: "2025-09-30T21:30:00.000Z", tz: "Europe/Rome" });
  const winter = normalizeDataOra({ local: "2026-01-15T23:30", tz: "Europe/Rome" }, {}, ctx);
  assert.deepEqual(winter.normalized, { utc: "2026-01-15T22:30:00.000Z", tz: "Europe/Rome" });
  const london = normalizeDataOra({ date: "15/01/2026", time: "09:00" }, { tz: "Europe/London" }, ctx);
  assert.deepEqual(london.normalized, { utc: "2026-01-15T09:00:00.000Z", tz: "Europe/London" });
  const utc = normalizeDataOra("15/01/2026 09:00", { unit: "UTC" }, ctx);
  assert.deepEqual(utc.normalized, { utc: "2026-01-15T09:00:00.000Z", tz: "UTC" });
});

test("data_ora: a non-existent hour is an error, a repeated hour takes the first with a warning", () => {
  const missing = normalizeDataOra("29/03/2026 02:30", {}, ctx);
  assert.equal(missing.errors[0].code, "ora_inesistente");
  assert.equal(missing.normalized, null);
  const repeated = normalizeDataOra("25/10/2026 02:30", {}, ctx);
  assert.deepEqual(repeated.normalized, { utc: "2026-10-25T00:30:00.000Z", tz: "Europe/Rome" });
  assert.equal(repeated.warnings[0].code, "ora_ambigua");
});

test("data_ora: explicit offsets win and are recomputed in the item time zone", () => {
  const z = normalizeDataOra("2026-07-01T21:30Z", {}, ctx);
  assert.deepEqual(z.normalized, { utc: "2026-07-01T21:30:00.000Z", tz: "UTC" });
  const offset = normalizeDataOra("2026-07-01 23:30+02:00", {}, ctx);
  assert.deepEqual(offset.value, { local: "2026-07-01T23:30", tz: "Europe/Rome" });
  assert.deepEqual(offset.normalized, { utc: "2026-07-01T21:30:00.000Z", tz: "Europe/Rome" });
});

test("data_ora: time only is a recurring local time; errors are explicit", () => {
  const recurring = normalizeDataOra("23:30", {}, ctx);
  assert.deepEqual(recurring.normalized, { local_time: "23:30", tz: "Europe/Rome" });
  assert.equal(recurring.warnings[0].code, "solo_orario");
  assert.deepEqual(normalizeDataOra("23:30", { time_only: true }, ctx).warnings, []);
  assert.equal(normalizeDataOra("30/09/2025 23:30", { time_only: true }, ctx).warnings[0].code, "data_ignorata");
  assert.equal(normalizeDataOra("30/09/2025", {}, ctx).errors[0].code, "orario_mancante");
  assert.equal(normalizeDataOra({ local: "domani sera" }, {}, ctx).errors[0].code, "data_ora_non_valida");
  assert.equal(normalizeDataOra({ local: "2026-01-15T10:00", tz: "Mars/Base" }, {}, ctx).errors[0].code, "fuso_non_valido");
  assert.equal(normalizeDataOra("31/02/2026 10:00", {}, ctx).errors[0].code, "data_inesistente");
  assert.equal(normalizeDataOra("30/09/2026 25:00", {}, ctx).errors[0].code, "orario_non_valido");
  assert.equal(normalizeDataOra("08/10/2026 10:00", { max_date: "today" }, ctx).errors[0].code, "data_futura");
});
