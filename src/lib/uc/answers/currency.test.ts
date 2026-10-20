import test from "node:test";
import assert from "node:assert/strict";
import { currencyFromToken, currencyFromUnit, normalizeValuta, parseMoneyText, perFromUnit, vatFromText, vatFromUnit } from "./currency.ts";

const ctx = { strict: true, today: "2026-10-07" };
const draft = { strict: false, today: "2026-10-07" };
const codes = (o: { errors: { code: string }[] }) => o.errors.map((e) => e.code);

test("currency symbols, ISO codes and Italian words", () => {
  assert.equal(currencyFromToken("€"), "EUR");
  assert.equal(currencyFromToken("£"), "GBP");
  assert.equal(currencyFromToken("$"), "USD");
  assert.equal(currencyFromToken("chf"), "CHF");
  assert.equal(currencyFromToken("euro"), "EUR");
  assert.equal(currencyFromToken("franchi svizzeri"), "CHF");
  // Una sigla d'aeroporto non è una valuta.
  assert.equal(currencyFromToken("LIN"), null);
  assert.equal(currencyFromToken("FCO"), null);
});

test("VAT from free text", () => {
  assert.equal(vatFromText("IVA inclusa"), "inclusa");
  assert.equal(vatFromText("compresa l'IVA"), "inclusa");
  assert.equal(vatFromText("ivato"), "inclusa");
  assert.equal(vatFromText("+ IVA"), "esclusa");
  assert.equal(vatFromText("IVA esclusa"), "esclusa");
  assert.equal(vatFromText("oltre IVA"), "esclusa");
  assert.equal(vatFromText("al netto dell'IVA"), "esclusa");
  assert.equal(vatFromText("prezzo senza IVA"), "esclusa");
  assert.equal(vatFromText("non ivato"), "esclusa");
  assert.equal(vatFromText("prezzo pieno"), null);
});

test("per, VAT and currency proposed by the template unit", () => {
  assert.equal(perFromUnit("€ per notte"), "notte");
  assert.equal(perFromUnit("€/ora"), "ora");
  assert.equal(perFromUnit("EUR/ora"), "ora");
  assert.equal(perFromUnit("€ all'anno"), "anno");
  assert.equal(perFromUnit("€ all'anno per cliente"), "anno per cliente");
  assert.equal(perFromUnit("€ per volo (oppure % del prezzo senza IVA)"), "volo");
  assert.equal(perFromUnit("€/anno, IVA esclusa"), "anno");
  assert.equal(perFromUnit("€"), null);
  assert.equal(perFromUnit("EUR"), null);
  assert.equal(vatFromUnit("€/anno, IVA esclusa"), "esclusa");
  // L'IVA tra parentesi riguarda l'alternativa, non l'importo.
  assert.equal(vatFromUnit("€ per volo (oppure % del prezzo senza IVA)"), null);
  assert.equal(currencyFromUnit("EUR/ora"), "EUR");
  assert.equal(currencyFromUnit("nella valuta della riga"), null);
});

test("parseMoneyText reads amount, currency, VAT and per", () => {
  const p = parseMoneyText("€ 1.200,50 a volo IVA esclusa", true);
  assert.ok(!Array.isArray(p));
  assert.deepEqual(p.money, { amount: 1200.5, currency: "EUR", vat: "esclusa", per: "volo" });
  const q = parseMoneyText("1200 EUR + IVA al mese", true);
  assert.ok(!Array.isArray(q));
  assert.deepEqual(q.money, { amount: 1200, currency: "EUR", vat: "esclusa", per: "mese" });
  const r = parseMoneyText("CHF 300", true);
  assert.ok(!Array.isArray(r));
  assert.equal(r.money.currency, "CHF");
  assert.ok(Array.isArray(parseMoneyText("€ 300 CHF", true)), "two different currencies");
  assert.ok(Array.isArray(parseMoneyText("circa 2.000 €", true)));
  const prose = parseMoneyText("circa 1.750 € (F123)", false);
  assert.ok(!Array.isArray(prose) && prose.fromProse && prose.money.amount === 1750 && prose.money.currency === "EUR");
});

test("valuta: complete answers are normalized to euro", () => {
  const o = normalizeValuta("€ 1.200,50 a volo IVA esclusa", {}, ctx);
  assert.deepEqual(codes(o), []);
  assert.deepEqual(o.value, { amount: 1200.5, currency: "EUR", vat: "esclusa", per: "volo" });
  assert.deepEqual(o.normalized, { amount_eur: 1200.5 });
  const obj = normalizeValuta({ amount: "2.000", vat: "inclusa", per: "notte", valid_from: "01/10/2026" }, {}, ctx);
  assert.deepEqual(obj.normalized, { amount_eur: 2000 });
  assert.equal(obj.validFrom, "2026-10-01");
  assert.deepEqual(normalizeValuta(150, { unit: "€ per notte", vat: "inclusa" }, ctx).value, {
    amount: 150,
    currency: "EUR",
    vat: "inclusa",
    per: "notte",
  });
});

test("valuta: VAT and per are mandatory, proposed by the template when possible", () => {
  assert.deepEqual(codes(normalizeValuta("1.000", {}, ctx)), ["iva_mancante", "per_mancante"]);
  const fromUnit = normalizeValuta("1.000", { unit: "€/anno, IVA esclusa" }, ctx);
  assert.deepEqual(codes(fromUnit), []);
  assert.deepEqual(fromUnit.value, { amount: 1000, currency: "EUR", vat: "esclusa", per: "anno" });
});

test("valuta: amounts outside euro need the exchange rate, its date and source", () => {
  assert.deepEqual(codes(normalizeValuta("CHF 300 a notte IVA inclusa", {}, ctx)), ["cambio_mancante"]);
  const ok = normalizeValuta(
    { amount: "300", currency: "CHF", vat: "inclusa", per: "notte", fx: { rate_to_eur: "1,05", date: "01/10/2026", source: "BCE" } },
    {},
    ctx,
  );
  assert.deepEqual(codes(ok), []);
  assert.deepEqual(ok.normalized, { amount_eur: 315 });
  const bad = normalizeValuta(
    { amount: "300", currency: "GBP", vat: "inclusa", per: "notte", fx: { rate_to_eur: "0", date: "01/12/2026", source: "" } },
    {},
    ctx,
  );
  assert.deepEqual(codes(bad), ["cambio_non_valido", "data_futura", "fonte_cambio_mancante"]);
  assert.equal(bad.normalized, null);
});

test("valuta: negative amounts, unknown currencies and bad dates are rejected", () => {
  assert.ok(codes(normalizeValuta("-5 € a volo IVA inclusa", {}, ctx)).includes("importo_negativo"));
  assert.ok(codes(normalizeValuta({ amount: "5", currency: "XYZ", vat: "inclusa", per: "volo" }, {}, ctx)).includes("valuta_non_valida"));
  assert.ok(codes(normalizeValuta({ amount: "5", vat: "inclusa", per: "volo", valid_from: "31/02/2026" }, {}, ctx)).includes("data_inesistente"));
  assert.deepEqual(codes(normalizeValuta(undefined, {}, ctx)), ["importo_mancante"]);
  assert.deepEqual(codes(normalizeValuta("", {}, ctx)), ["importo_mancante"]);
});

test("valuta: prose is read only in drafts, with what is still missing", () => {
  assert.deepEqual(codes(normalizeValuta("circa 1.750 € (F123)", { unit: "€ per evento" }, ctx)), ["importo_non_valido"]);
  const d = normalizeValuta("circa 1.750 € (F123)", { unit: "€ per evento" }, draft);
  assert.deepEqual(d.value, { amount: 1750, currency: "EUR", vat: null, per: "evento" });
  assert.deepEqual(codes(d), ["iva_mancante"]);
  assert.ok(d.warnings.some((w) => w.code === "letto_da_testo"));
});
