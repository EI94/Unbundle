import test from "node:test";
import assert from "node:assert/strict";
import { decimalPlaces, extractNumbersIt, formatNumberIt, parseNumberIt, roundTo } from "./number-it.ts";

function value(input: unknown): number {
  const p = parseNumberIt(input);
  assert.ok(p.ok, `non letto: ${String(input)}`);
  return p.value;
}

function rejected(input: unknown): string {
  const p = parseNumberIt(input);
  assert.ok(!p.ok, `letto per errore: ${String(input)}`);
  return p.errors[0].code;
}

test("Italian reading: comma is the decimal, dot groups thousands", () => {
  assert.equal(value("1.200"), 1200);
  assert.equal(value("1,5"), 1.5);
  assert.equal(value("1.200,50"), 1200.5);
  assert.equal(value("12.500.000"), 12_500_000);
  assert.equal(value("1.234.567,891"), 1234567.891);
  assert.equal(value(",5"), 0.5);
  assert.equal(value("0,05"), 0.05);
});

test("only dots: thousands groups of three, otherwise the dot is a decimal", () => {
  assert.equal(value("1.5"), 1.5);
  assert.equal(value("12.75"), 12.75);
  assert.equal(value("1.2345"), 1.2345);
  // Uno zero iniziale non apre un gruppo di migliaia.
  assert.equal(value("0.500"), 0.5);
  assert.equal(value("0.5"), 0.5);
});

test("spaces and apostrophes are thousands separators only in groups of three", () => {
  assert.equal(value("1 200"), 1200);
  assert.equal(value("1 200,5"), 1200.5);
  assert.equal(value("1'200"), 1200);
  assert.equal(value("1’200’000"), 1_200_000);
  assert.equal(rejected("1 20"), "numero_non_valido");
});

test("signs, unicode minus and ready numbers", () => {
  assert.equal(value("-3,5"), -3.5);
  assert.equal(value("−3"), -3);
  assert.equal(value("+7"), 7);
  assert.equal(value(42), 42);
  assert.ok(Object.is(value("-0"), 0));
});

test("rejects malformed input, text, scientific notation and non-finite numbers", () => {
  for (const bad of ["1.2.3", "1,200.50", "1,2,3", "abc", "1e3", "12a", "1..2", "--1", "1.200,", "1."]) {
    assert.equal(rejected(bad), "numero_non_valido", bad);
  }
  assert.equal(rejected(""), "numero_mancante");
  assert.equal(rejected("   "), "numero_mancante");
  assert.equal(rejected(Number.NaN), "numero_non_valido");
  assert.equal(rejected(Number.POSITIVE_INFINITY), "numero_non_valido");
  assert.equal(rejected(null), "numero_non_valido");
  assert.equal(rejected({}), "numero_non_valido");
});

test("a comma followed by three digits is read as a decimal with a warning", () => {
  const p = parseNumberIt("1,200", "value");
  assert.ok(p.ok);
  assert.equal(p.value, 1.2);
  assert.equal(p.warnings[0].code, "virgola_ambigua");
  assert.equal(p.warnings[0].field, "value");
  // The message is a fixed example: it never repeats the user's number.
  assert.equal(parseNumberIt("7,345").ok && parseNumberIt("7,345").warnings[0].message.includes("7"), false);
  const zero = parseNumberIt("0,500");
  assert.ok(zero.ok);
  assert.equal(zero.warnings.length, 0);
});

test("errors carry the field and never the typed value", () => {
  const p = parseNumberIt("segreto", "amount");
  assert.ok(!p.ok);
  assert.equal(p.errors[0].field, "amount");
  assert.ok(!p.errors[0].message.includes("segreto"));
});

test("decimalPlaces and roundTo", () => {
  assert.equal(decimalPlaces(12), 0);
  assert.equal(decimalPlaces(12.5), 1);
  assert.equal(decimalPlaces(12.25), 2);
  assert.equal(decimalPlaces(1e-7), 7);
  assert.equal(roundTo(0.1 + 0.2, 2), 0.3);
  assert.equal(roundTo(1.005, 2), 1.01);
  assert.equal(roundTo(-1.005, 2), -1.01);
});

test("extractNumbersIt finds numbers in prose and skips identifiers like F123 or A320", () => {
  assert.deepEqual(
    extractNumbersIt("circa 1.750 € (F123) per il tipo A320, rif. A.8").map((n) => n.value),
    [1750],
  );
  assert.deepEqual(
    extractNumbersIt("da 10-20 kg, poi -3").map((n) => n.value),
    [10, 20, -3],
  );
  assert.deepEqual(
    extractNumbersIt("1,5h prima").map((n) => n.value),
    [1.5],
  );
  assert.deepEqual(extractNumbersIt("nessun numero"), []);
});

test("formatNumberIt writes Italian numbers", () => {
  assert.equal(formatNumberIt(1200.5), "1.200,5");
  assert.equal(formatNumberIt(-1234567), "-1.234.567");
  assert.equal(formatNumberIt(0.1 + 0.2), "0,3");
  assert.equal(formatNumberIt(12), "12");
});
