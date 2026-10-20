import test from "node:test";
import assert from "node:assert/strict";
import { normalizePercentuale, parsePercentHint } from "./percent.ts";

const strict = { strict: true };
const codes = (o: { errors: { code: string }[] }) => o.errors.map((e) => e.code);

test("parsePercentHint reads the base from the template unit", () => {
  assert.deepEqual(parsePercentHint("% dei preventivi"), { base: "dei preventivi", fractionScale: false });
  assert.deepEqual(parsePercentHint("%"), { base: null, fractionScale: false });
  assert.deepEqual(parsePercentHint("0-100%"), { base: null, fractionScale: false });
  assert.deepEqual(parsePercentHint("da 0 a 1"), { base: null, fractionScale: true });
  assert.deepEqual(parsePercentHint(null), { base: null, fractionScale: false });
});

test("percentuale accepts «12,5%», «12,5 per cento» and a base in the text", () => {
  const o = normalizePercentuale("12,5% del venduto", {}, strict);
  assert.deepEqual(o.value, { value: 12.5, base: "del venduto" });
  assert.deepEqual(o.normalized, { fraction: 0.125 });
  assert.deepEqual(normalizePercentuale("12,5 per cento", { base: "del costo" }, strict).normalized, { fraction: 0.125 });
  assert.deepEqual(normalizePercentuale({ value: "10%", base: "del venduto" }, {}, strict).normalized, { fraction: 0.1 });
  assert.deepEqual(normalizePercentuale(10, { unit: "% dei preventivi" }, strict).value, { value: 10, base: "dei preventivi" });
});

test("percentuale needs a base, stays between 0 and 100, at most 2 decimals", () => {
  assert.deepEqual(codes(normalizePercentuale("12%", {}, strict)), ["base_mancante"]);
  assert.deepEqual(codes(normalizePercentuale("120%", { base: "x" }, strict)), ["percentuale_fuori_intervallo"]);
  assert.deepEqual(codes(normalizePercentuale("-1%", { base: "x" }, strict)), ["percentuale_fuori_intervallo"]);
  assert.deepEqual(codes(normalizePercentuale("12,555%", { base: "x" }, strict)), ["troppi_decimali"]);
  assert.deepEqual(codes(normalizePercentuale("12,55%", { base: "x" }, strict)), []);
  assert.deepEqual(codes(normalizePercentuale("5%", { base: "x", min: 10 }, strict)), ["sotto_minimo"]);
  assert.deepEqual(codes(normalizePercentuale("50%", { base: "x", max: 30 }, strict)), ["sopra_massimo"]);
});

test("percentuale on a 0-1 scale accepts the fraction", () => {
  assert.deepEqual(normalizePercentuale("0,35", { unit: "da 0 a 1", base: "x" }, strict).normalized, { fraction: 0.35 });
  // Con il segno di percentuale resta una percentuale.
  assert.deepEqual(normalizePercentuale("0,35%", { unit: "da 0 a 1", base: "x" }, strict).normalized, { fraction: 0.0035 });
});

test("percentuale: prose only in drafts", () => {
  assert.equal(codes(normalizePercentuale("circa il 10% del venduto, forse di più", {}, strict))[0], "percentuale_non_valida");
  const d = normalizePercentuale("circa il 7% (F321)", { base: "del venduto" }, { strict: false });
  assert.deepEqual(d.value, { value: 7, base: "del venduto" });
  assert.ok(d.warnings.some((w) => w.code === "letto_da_testo"));
  assert.deepEqual(codes(normalizePercentuale("", {}, strict)), ["numero_mancante"]);
});
