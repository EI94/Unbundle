import test from "node:test";
import assert from "node:assert/strict";
import { BASE_UNITS, UNITS, convert, leadingUnit, lookupUnit, normalizeNumero, parseUnitHint, splitNumberAndUnit, toBase, unitByCode } from "./units.ts";

const strict = { strict: true };
const draft = { strict: false };
const codes = (list: { code: string }[]) => list.map((i) => i.code);

test("every unit has unique aliases and a base unit for its dimension", () => {
  const aliases = UNITS.flatMap((u) => u.aliases);
  assert.equal(new Set(aliases).size, aliases.length);
  for (const u of UNITS) assert.ok(BASE_UNITS[u.dimension]);
  for (const base of Object.values(BASE_UNITS)) assert.equal(unitByCode(base)?.factor, 1, base);
});

test("lookupUnit reads Italian and English spellings without case or accents", () => {
  assert.equal(lookupUnit("Metri")?.code, "m");
  assert.equal(lookupUnit("piedi")?.code, "ft");
  assert.equal(lookupUnit("NM")?.code, "NM");
  assert.equal(lookupUnit("miglia nautiche")?.code, "NM");
  assert.equal(lookupUnit("km/h")?.code, "km/h");
  assert.equal(lookupUnit("nodi")?.code, "kt");
  assert.equal(lookupUnit("libbre")?.code, "lb");
  assert.equal(lookupUnit("galloni")?.code, "USG");
  assert.equal(lookupUnit("m³")?.code, "m3");
  assert.equal(lookupUnit("min.")?.code, "min");
  assert.equal(lookupUnit("'")?.code, "min");
  assert.equal(lookupUnit("passeggeri"), null);
});

test("conversions to the base unit (feet → metres, NM, pounds, gallons, knots)", () => {
  const m = unitByCode("m")!;
  assert.equal(convert(1000, unitByCode("ft")!, m), 304.8);
  assert.deepEqual(toBase(1, unitByCode("NM")!), { value: 1852, unit: "m" });
  assert.deepEqual(toBase(2, unitByCode("t")!), { value: 2000, unit: "kg" });
  assert.deepEqual(toBase(10, unitByCode("lb")!), { value: 4.535924, unit: "kg" });
  assert.deepEqual(toBase(1, unitByCode("USG")!), { value: 3.785412, unit: "l" });
  assert.deepEqual(toBase(1, unitByCode("m3")!), { value: 1000, unit: "l" });
  assert.deepEqual(toBase(100, unitByCode("kt")!), { value: 185.2, unit: "km/h" });
  assert.deepEqual(toBase(1.5, unitByCode("h")!), { value: 90, unit: "min" });
  assert.throws(() => convert(1, m, unitByCode("kg")!));
});

test("leadingUnit and splitNumberAndUnit", () => {
  assert.equal(leadingUnit("ore per anno")?.unit.code, "h");
  assert.equal(leadingUnit("ore per anno")?.rest, "per anno");
  assert.equal(leadingUnit("miglia nautiche (NM)")?.unit.code, "NM");
  assert.equal(leadingUnit("passeggeri"), null);
  assert.deepEqual(splitNumberAndUnit("1.200 m"), { number: "1.200", rest: "m" });
  assert.deepEqual(splitNumberAndUnit("-3,5kg"), { number: "-3,5", rest: "kg" });
  assert.deepEqual(splitNumberAndUnit("90'"), { number: "90", rest: "'" });
  assert.equal(splitNumberAndUnit("circa 3"), null);
});

test("parseUnitHint reads the free-text unit of the template", () => {
  assert.equal(parseUnitHint("metri").unit?.code, "m");
  assert.equal(parseUnitHint("NM (miglia nautiche)").unit?.code, "NM");
  assert.equal(parseUnitHint("nodi (kt)").unit?.code, "kt");
  assert.deepEqual(codes(parseUnitHint("ore o giorni").alternatives), ["h", "giorni"]);
  // Le parti che iniziano con una preposizione precisano la prima unità.
  assert.equal(parseUnitHint("ore per turno o per giorno").unit?.code, "h");
  assert.equal(parseUnitHint("ore (0 se non si fa mai)").unit?.code, "h");
  assert.equal(parseUnitHint("ore all'anno per aereo").unit?.code, "h");
  assert.equal(parseUnitHint("giorni di preavviso (0 se non può)").unit?.code, "giorni");
  // Grandezze diverse o conteggi: etichetta.
  assert.equal(parseUnitHint("t, passeggeri o km secondo fascia").label, "t, passeggeri o km secondo fascia");
  assert.equal(parseUnitHint("passeggeri").label, "passeggeri");
  assert.equal(parseUnitHint("kg/h").label, "kg/h");
  // Intervalli ammessi.
  assert.deepEqual(parseUnitHint("0-1").range, { min: 0, max: 1 });
  assert.equal(parseUnitHint("0-1").label, null);
  assert.deepEqual(parseUnitHint("punti 1-5").range, { min: 1, max: 5 });
  assert.deepEqual(parseUnitHint("categoria (1-10)").range, { min: 1, max: 10 });
  assert.deepEqual(parseUnitHint(null), { raw: null, unit: null, alternatives: [], label: null, range: null });
  assert.equal(parseUnitHint("   ").raw, null);
});

test("numero: value and unit, normalized to the base unit", () => {
  const o = normalizeNumero("1.200 m", { unit: "metri" }, strict);
  assert.deepEqual(o.value, { value: 1200, unit: "m" });
  assert.deepEqual(o.normalized, { value_si: 1200, unit_si: "m" });
  const ft = normalizeNumero("3.937 piedi", { unit: "metri" }, strict);
  assert.deepEqual(ft.value, { value: 3937, unit: "ft" });
  assert.deepEqual(ft.normalized, { value_si: 1199.9976, unit_si: "m" });
  const obj = normalizeNumero({ value: "1,2", unit: "t" }, { unit: "kg" }, strict);
  assert.deepEqual(obj.normalized, { value_si: 1200, unit_si: "kg" });
  assert.deepEqual(normalizeNumero(7, {}, strict).normalized, { value_si: 7, unit_si: null });
});

test("numero: the unit of the item applies when none is written", () => {
  assert.deepEqual(normalizeNumero("1200", { unit: "metri" }, strict).normalized, { value_si: 1200, unit_si: "m" });
  assert.deepEqual(normalizeNumero("12", { unit: "passeggeri" }, strict).normalized, { value_si: 12, unit_si: "passeggeri" });
  assert.deepEqual(normalizeNumero("12 passeggeri", { unit: "passeggeri" }, strict).warnings, []);
  assert.equal(normalizeNumero("12 pax", { unit: "passeggeri" }, strict).warnings[0].code, "unita_ignorata");
});

test("numero: wrong or unknown units", () => {
  assert.equal(normalizeNumero("12 kg", { unit: "metri" }, strict).errors[0].code, "unita_incompatibile");
  assert.equal(normalizeNumero("12 kg", { unit: "passeggeri" }, strict).errors[0].code, "unita_incompatibile");
  const unknown = normalizeNumero("12 cubiti", { unit: "metri" }, strict);
  assert.equal(unknown.errors[0].code, "unita_sconosciuta");
  assert.equal(unknown.normalized, null);
  assert.equal(normalizeNumero("3", { unit: "ore o giorni" }, strict).errors[0].code, "unita_mancante");
  assert.deepEqual(normalizeNumero("3 giorni", { unit: "ore o giorni" }, strict).normalized, { value_si: 4320, unit_si: "min" });
  // Unità libera senza indicazioni nel template: si tiene com'è scritta.
  assert.deepEqual(normalizeNumero("4 colli", {}, strict).normalized, { value_si: 4, unit_si: "colli" });
});

test("numero: integer, min and max (also from a range in the unit)", () => {
  assert.equal(normalizeNumero("7,5", { integer: true }, strict).errors[0].code, "intero_richiesto");
  assert.equal(normalizeNumero("0", { min: 1 }, strict).errors[0].code, "sotto_minimo");
  assert.equal(normalizeNumero("11", { max: 10 }, strict).errors[0].code, "sopra_massimo");
  assert.equal(normalizeNumero("1,4", { unit: "0-1" }, strict).errors[0].code, "sopra_massimo");
  assert.equal(normalizeNumero("0,4", { unit: "0-1" }, strict).errors.length, 0);
  // Il minimo vale nell'unità della voce: 1.000 piedi sono meno di 500 metri.
  assert.equal(normalizeNumero("1.000 ft", { unit: "metri", min: 500 }, strict).errors[0].code, "sotto_minimo");
  assert.equal(normalizeNumero("2.000 ft", { unit: "metri", min: 500 }, strict).errors.length, 0);
});

test("numero: extra text is an error when sending and a warning in drafts", () => {
  assert.equal(normalizeNumero("1.200 m circa, da verificare", { unit: "metri" }, strict).errors[0].code, "testo_in_piu");
  const d = normalizeNumero("1.200 m circa, da verificare", { unit: "metri" }, draft);
  assert.equal(d.errors.length, 0);
  assert.equal(d.warnings[0].code, "testo_in_piu");
});

test("numero: prose is read only in drafts and only with a single number", () => {
  assert.equal(normalizeNumero("circa 7 posti", {}, strict).errors[0].code, "numero_non_valido");
  const d = normalizeNumero("circa 9 posti (F999)", {}, draft);
  assert.deepEqual(d.value, { value: 9, unit: null });
  assert.ok(d.warnings.some((w) => w.code === "letto_da_testo"));
  assert.equal(normalizeNumero("tra 5 e 7", {}, draft).errors[0].code, "numero_non_valido");
  assert.equal(normalizeNumero("", {}, strict).errors[0].code, "numero_mancante");
  assert.equal(normalizeNumero(null, {}, strict).errors[0].code, "numero_non_valido");
});
