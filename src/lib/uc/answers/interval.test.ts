import test from "node:test";
import assert from "node:assert/strict";
import { candidateSplits, intervalKindFromConfig, normalizeIntervallo } from "./interval.ts";

const strict = { strict: true };
const ok = (raw: unknown, config = {}) => {
  const o = normalizeIntervallo(raw, config, strict);
  assert.deepEqual(o.errors, [], JSON.stringify(raw));
  return o;
};
const codes = (raw: unknown, config = {}) => normalizeIntervallo(raw, config, strict).errors.map((e) => e.code);

test("candidateSplits tries words, long dashes, spaced and plain hyphens", () => {
  assert.deepEqual(candidateSplits("da 10 a 20")[0], { left: "10", right: "20", hint: null });
  assert.deepEqual(candidateSplits("dalle 22 alle 6")[0], { left: "22", right: "6", hint: "ora" });
  assert.deepEqual(candidateSplits("10–20 kg")[0], { left: "10", right: "20 kg", hint: null });
  assert.deepEqual(candidateSplits("-5 - 10")[0], { left: "-5", right: "10", hint: null });
});

test("numbers with a unit written once", () => {
  const o = ok("10–20 kg");
  assert.deepEqual(o.value, { from: 10, to: 20, kind: "numero", unit: "kg" });
  assert.deepEqual(o.normalized, { from_si: 10, to_si: 20, unit_si: "kg" });
  assert.deepEqual(ok("10-20").normalized, { from_si: 10, to_si: 20, unit_si: null });
  assert.deepEqual(ok("da 1.200 a 1.500 m").normalized, { from_si: 1200, to_si: 1500, unit_si: "m" });
  assert.deepEqual(ok("10 kg-20 kg").value, { from: 10, to: 20, kind: "numero", unit: "kg" });
  assert.deepEqual(ok({ from: 2, to: 3, unit: "t" }).normalized, { from_si: 2000, to_si: 3000, unit_si: "kg" });
  assert.deepEqual(ok("2-4", { unit: "cambi al mese" }).normalized, { from_si: 2, to_si: 4, unit_si: "cambi al mese" });
});

test("same unit at both ends, start before end", () => {
  assert.deepEqual(codes("10 kg - 20 m"), ["unita_diverse"]);
  assert.deepEqual(codes("20-10"), ["inizio_dopo_fine"]);
  assert.deepEqual(codes("2-12", { max: 10 }), ["sopra_massimo"]);
  assert.equal(normalizeIntervallo("20-10", {}, strict).normalized, null);
});

test("times may cross midnight, with a warning", () => {
  const o = ok("22:00-06:00");
  assert.deepEqual(o.value, { from: "22:00", to: "06:00", kind: "ora", crosses_midnight: true });
  assert.deepEqual(o.normalized, { from: "22:00", to: "06:00", crosses_midnight: true });
  assert.equal(o.warnings[0].code, "a_cavallo_mezzanotte");
  assert.deepEqual(ok("23:30–05:30").normalized, { from: "23:30", to: "05:30", crosses_midnight: true });
  assert.deepEqual(ok("08.30-17.45").normalized, { from: "08:30", to: "17:45", crosses_midnight: false });
  assert.deepEqual(ok("dalle 22 alle 6").normalized, { from: "22:00", to: "06:00", crosses_midnight: true });
  // «10.50-20.75» non sono orari (minuti oltre 59): sono numeri.
  assert.deepEqual(ok("10.50-20.75").value, { from: 10.5, to: 20.75, kind: "numero" });
});

test("dates and days of the year", () => {
  assert.deepEqual(ok("dal 1/10/2025 al 30/9/2026").normalized, { from: "2025-10-01", to: "2026-09-30" });
  assert.deepEqual(ok("01/10/2025 - 30/09/2026").value, { from: "2025-10-01", to: "2026-09-30", kind: "data" });
  assert.deepEqual(codes("30/09/2026 - 01/10/2025"), ["inizio_dopo_fine"]);
  assert.deepEqual(ok("01/05–30/09").normalized, { from: "05-01", to: "09-30", crosses_year: false });
  const winter = ok("01/11–31/03");
  assert.deepEqual(winter.normalized, { from: "11-01", to: "03-31", crosses_year: true });
  assert.equal(winter.warnings[0].code, "a_cavallo_anno");
});

test("durations, with the unit from the item or the answer", () => {
  assert.deepEqual(ok("2-3 giorni", { unit: "ore o giorni" }).normalized, { from_minutes: 2880, to_minutes: 4320 });
  assert.deepEqual(codes("2-3", { unit: "ore o giorni" }), ["unita_mancante"]);
  assert.deepEqual(ok("30-45", { unit: "minuti" }).value, { from: 30, to: 45, kind: "durata", unit: "min" });
  assert.deepEqual(ok("1-2 ore").normalized, { from_minutes: 60, to_minutes: 120 });
  assert.deepEqual(codes("2 ore - 3 giorni", { kind: "durata" }), ["unita_diverse"]);
  // On a duration item «1.30-2.30» is hours and minutes, with the same warning as a single duration.
  const dotted = ok("1.30-2.30", { kind: "durata" });
  assert.deepEqual(dotted.normalized, { from_minutes: 90, to_minutes: 150 });
  assert.deepEqual(dotted.warnings.map((w) => w.code), ["letto_come_ore_minuti"]);
});

test("config.kind forces the type of the ends", () => {
  assert.deepEqual(intervalKindFromConfig({ kind: "ora" }), { kind: "ora", timeUnit: null });
  assert.equal(intervalKindFromConfig({ unit: "minuti" }).kind, "durata");
  assert.equal(intervalKindFromConfig({ unit: "kg" }).kind, "numero");
  assert.equal(intervalKindFromConfig({}).kind, null);
  assert.deepEqual(codes("10-20", { kind: "data" }), ["data_non_valida", "data_non_valida"]);
  assert.deepEqual(ok({ from: "22", to: "6", kind: "ora" }).normalized, { from: "22:00", to: "06:00", crosses_midnight: true });
});

test("missing or unreadable intervals", () => {
  assert.deepEqual(codes(""), ["intervallo_mancante"]);
  assert.deepEqual(codes(null), ["intervallo_mancante"]);
  assert.deepEqual(codes("tanto"), ["intervallo_non_valido"]);
  assert.deepEqual(codes({ from: "10" }), ["estremi_mancanti"]);
  assert.equal(normalizeIntervallo({ from: "10" }, {}, strict).errors[0].field, "to");
});
