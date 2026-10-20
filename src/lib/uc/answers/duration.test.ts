import test from "node:test";
import assert from "node:assert/strict";
import { normalizeDurata, readDurationText } from "./duration.ts";

const strict = { strict: true };
const minutes = (raw: unknown, config = {}) => {
  const o = normalizeDurata(raw, config, strict);
  assert.deepEqual(o.errors, [], JSON.stringify(raw));
  return (o.normalized as { minutes: number }).minutes;
};
const codes = (raw: unknown, config = {}) => normalizeDurata(raw, config, strict).errors.map((e) => e.code);

test("durata reads minutes, hours, days and «2:30»", () => {
  assert.equal(minutes("90 min"), 90);
  assert.equal(minutes("90'"), 90);
  assert.equal(minutes("1,5 h"), 90);
  assert.equal(minutes("1,5 ore"), 90);
  assert.equal(minutes("2:30"), 150);
  assert.equal(minutes("2:30 h"), 150);
  assert.equal(minutes("3 giorni"), 4320);
  assert.equal(minutes("1 settimana"), 10080);
  assert.equal(minutes("45 secondi"), 0.75);
});

test("durata reads compound forms", () => {
  assert.equal(minutes("2 ore e 30"), 150);
  assert.equal(minutes("2 ore e 30 minuti"), 150);
  assert.equal(minutes("1h30"), 90);
  assert.equal(minutes("2 ore e mezza"), 150);
  assert.equal(minutes("mezz'ora"), 30);
  assert.equal(minutes("un'ora"), 60);
  assert.equal(minutes("un giorno"), 1440);
  assert.equal(minutes("1 giorno e 4 ore"), 1680);
});

test("durata: a bare number takes the unit of the item", () => {
  assert.equal(minutes("12", { unit: "ore" }), 720);
  assert.equal(minutes("3", { unit: "giorni di preavviso (0 se non può)" }), 4320);
  assert.equal(minutes("3", { unit: "ore per turno o per giorno" }), 180);
  assert.equal(minutes({ amount: "1,5", unit: "ore" }), 90);
  assert.equal(minutes({ amount: 2 }, { unit: "minuti" }), 2);
});

test("durata: «ore o giorni» needs the unit; no unit at all needs it too", () => {
  assert.deepEqual(codes("3", { unit: "ore o giorni" }), ["unita_mancante"]);
  assert.match(normalizeDurata("3", { unit: "ore o giorni" }, strict).errors[0].message, /ore o giorni/);
  assert.deepEqual(codes("3"), ["unita_mancante"]);
  assert.equal(minutes("3 giorni", { unit: "ore o giorni" }), 4320);
});

test("durata: wrong units, negatives and bounds", () => {
  assert.deepEqual(codes("3 kg"), ["unita_incompatibile"]);
  assert.deepEqual(codes({ amount: 3, unit: "cubiti" }), ["unita_sconosciuta"]);
  assert.deepEqual(codes("-2 ore"), ["durata_negativa"]);
  // min e max nell'unità della voce.
  assert.deepEqual(codes("30 min", { unit: "ore", min: 1 }), ["sotto_minimo"]);
  assert.deepEqual(codes("2 giorni", { unit: "ore", max: 24 }), ["sopra_massimo"]);
  // Senza unità nella voce, in minuti.
  assert.deepEqual(codes("2 ore", { max: 90 }), ["sopra_massimo"]);
  assert.deepEqual(codes(""), ["durata_mancante"]);
  assert.deepEqual(codes(null), ["durata_mancante"]);
  assert.deepEqual(codes("tanto"), ["durata_non_valida"]);
});

test("durata: months count as 30 days with a warning", () => {
  const o = normalizeDurata("2 mesi", {}, strict);
  assert.deepEqual(o.normalized, { minutes: 86400 });
  assert.equal(o.warnings[0].code, "mese_30_giorni");
});

test("readDurationText reads prose only when not strict", () => {
  assert.ok(Array.isArray(readDurationText("circa 2,5 ore prima della partenza", true)));
  const r = readDurationText("circa 2,5 ore prima della partenza (F456)", false);
  assert.ok(!Array.isArray(r));
  assert.equal(r.amount, 2.5);
  assert.equal(r.unit?.code, "h");
  assert.equal(r.fromProse, true);
  const o = normalizeDurata("circa 2,5 ore prima della partenza", {}, { strict: false });
  assert.deepEqual(o.normalized, { minutes: 150 });
  assert.ok(o.warnings.some((w) => w.code === "letto_da_testo"));
});

test("durata: «2.30» is hours and minutes like the time of day, with a warning; Excel «02:30:00» is accepted", () => {
  for (const [raw, config, expected] of [
    ["2.30 h", {}, 150],
    ["2.30 ore", {}, 150],
    ["2.30", {}, 150],
    ["1.45", { unit: "ore" }, 105],
  ] as const) {
    const o = normalizeDurata(raw, config, strict);
    assert.deepEqual(o.errors, [], raw);
    assert.deepEqual(o.normalized, { minutes: expected }, raw);
    assert.deepEqual(o.warnings.map((w) => w.code), ["letto_come_ore_minuti"], raw);
    assert.equal(o.warnings[0].message.includes(raw), raw === "2.30", "the message is a fixed example, not the user's value");
  }
  // «2:30» is unambiguous: no warning.
  assert.deepEqual(normalizeDurata("2:30", {}, strict).warnings, []);
  // Minutes from 60 up are not minutes: the dot stays a decimal.
  assert.equal(minutes("1.75 h"), 105);
  // Excel copies durations as hh:mm:ss.
  assert.equal(minutes("02:30:00"), 150);
  assert.equal(minutes("00:45:30"), 45.5);
  assert.deepEqual(codes("02:30:75"), ["durata_non_valida"]);
  // Tables and intervals read cells the same way.
  const cell = readDurationText("2.30", true);
  assert.ok(!Array.isArray(cell) && cell.amount === 150);
});
