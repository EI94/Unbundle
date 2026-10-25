import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbiddenIn } from "./copy-guard.ts";
import { DEFAULT_VALUE_PARAMS, VALUE_PARAMS_ERRORS, originFollowsCurrentMonth, type ValueParams } from "./value-model.ts";
import {
  VALUE_PARAMS_FIELD_ERRORS,
  VALUE_PARAMS_TEXT,
  parseDecimalText,
  parseValueParamsTexts,
  valueParamsLines,
  valueParamsTexts,
  valueParamsTextsChanged,
} from "./value-params-form.ts";

// «Ipotesi di calcolo» di Impostazioni › Valutazione (spec di Pierpaolo, 25/10/2026).

const PARAMS: ValueParams = { ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" };

test("numeri all'italiana: punti delle migliaia, virgola dei decimali", () => {
  assert.equal(parseDecimalText("35"), 35);
  assert.equal(parseDecimalText("37,5"), 37.5);
  assert.equal(parseDecimalText("37.5"), 37.5);
  assert.equal(parseDecimalText("15.000"), 15_000);
  assert.equal(parseDecimalText("1.500,25"), 1500.25);
  assert.equal(parseDecimalText(" 50 000 "), 50_000);
  for (const bad of ["", "-3", "1,2,3", "12.34.5", "dieci", "1e3", null, undefined, {}]) assert.equal(parseDecimalText(bad), null, String(bad));
});

test("i campi partono dalle ipotesi; il mese vuoto se il workspace segue il mese corrente", () => {
  const texts = valueParamsTexts(PARAMS, null);
  assert.deepEqual(texts, {
    hourlyCostEur: "35",
    dayCostEur: "0",
    midValueEur: "15.000",
    highValueEur: "50.000",
    buildMonths: "2",
    rampMonths: "3",
    horizonMonths: "24",
    originMonth: "",
    includeUnmeasured: false,
  });
  assert.equal(valueParamsTexts({ ...PARAMS, hourlyCostEur: 37.5 }, "2026-11").hourlyCostEur, "37,5");
  assert.equal(valueParamsTexts(PARAMS, "2026-11").originMonth, "2026-11");
});

test("salvataggio: i testi diventano numeri; il mese vuoto non si salva", () => {
  const texts = { ...valueParamsTexts(PARAMS, null), hourlyCostEur: "37,5", highValueEur: "60.000", includeUnmeasured: true };
  assert.deepEqual(parseValueParamsTexts(texts), {
    ok: true,
    value: {
      hourlyCostEur: 37.5,
      dayCostEur: 0,
      midValueEur: 15_000,
      highValueEur: 60_000,
      buildMonths: 2,
      rampMonths: 3,
      horizonMonths: 24,
      includeUnmeasured: true,
    },
  });
  const withMonth = parseValueParamsTexts({ ...texts, originMonth: "2027-01" });
  assert.ok(withMonth.ok && withMonth.value.originMonth === "2027-01");
});

test("errori per campo, in italiano: limiti, mesi interi, mese, «Medio» sotto «Alto»", () => {
  const base = valueParamsTexts(PARAMS, null);
  assert.deepEqual(parseValueParamsTexts({ ...base, hourlyCostEur: "tanto", rampMonths: "" }), {
    ok: false,
    fieldErrors: { hourlyCostEur: VALUE_PARAMS_FIELD_ERRORS.hourlyCostEur, rampMonths: VALUE_PARAMS_FIELD_ERRORS.rampMonths },
  });
  assert.deepEqual(parseValueParamsTexts({ ...base, horizonMonths: "2,5" }), { ok: false, fieldErrors: { horizonMonths: VALUE_PARAMS_FIELD_ERRORS.horizonMonths } });
  assert.deepEqual(parseValueParamsTexts({ ...base, horizonMonths: "0" }), { ok: false, fieldErrors: { horizonMonths: VALUE_PARAMS_FIELD_ERRORS.horizonMonths } });
  assert.deepEqual(parseValueParamsTexts({ ...base, hourlyCostEur: "20.000" }), { ok: false, fieldErrors: { hourlyCostEur: VALUE_PARAMS_FIELD_ERRORS.hourlyCostEur } });
  assert.deepEqual(parseValueParamsTexts({ ...base, originMonth: "2027-13" }), { ok: false, fieldErrors: { originMonth: VALUE_PARAMS_FIELD_ERRORS.originMonth } });
  assert.deepEqual(parseValueParamsTexts({ ...base, midValueEur: "50.000" }), { ok: false, fieldErrors: { midValueEur: VALUE_PARAMS_ERRORS.midNotBelowHigh } });
  assert.deepEqual(parseValueParamsTexts({ ...base, highValueEur: "0" }), { ok: false, fieldErrors: { highValueEur: VALUE_PARAMS_FIELD_ERRORS.highValueEur } });
  assert.equal(parseValueParamsTexts({ ...base, includeUnmeasured: "sì" }).ok, false);
  assert.equal(parseValueParamsTexts(null).ok, false);
});

test("modificato solo se cambia un valore, non la grafia", () => {
  const saved = valueParamsTexts(PARAMS, null);
  assert.equal(valueParamsTextsChanged(saved, saved), false);
  assert.equal(valueParamsTextsChanged({ ...saved, midValueEur: "15000" }, saved), false);
  assert.equal(valueParamsTextsChanged({ ...saved, midValueEur: "16.000" }, saved), true);
  assert.equal(valueParamsTextsChanged({ ...saved, originMonth: "2026-12" }, saved), true);
  assert.equal(valueParamsTextsChanged({ ...saved, includeUnmeasured: true }, saved), true);
  assert.equal(valueParamsTextsChanged({ ...saved, hourlyCostEur: "x" }, saved), true);
});

test("riquadro in sola lettura: righe semplici, mese corrente detto per esteso; copy-guard verde", () => {
  const lines = valueParamsLines(PARAMS, { followsCurrentMonth: true });
  assert.deepEqual(
    lines.map((line) => `${line.label}: ${line.value}`),
    [
      "Costo di un'ora di lavoro: 35 €",
      "Costo di una giornata di sviluppo: 0 €",
      "Beneficio per «Medio», da: 15.000 € all'anno",
      "Beneficio per «Alto», da: 50.000 € all'anno",
      "Mesi dall'avvio all'entrata in uso: 2 mesi",
      "Mesi per arrivare al beneficio pieno: 3 mesi",
      "Mesi della curva del valore: 24 mesi",
      "Primo mese della curva: il mese corrente (nov 2026)",
      "Conta anche le voci da misurare: no",
    ],
  );
  assert.equal(valueParamsLines({ ...PARAMS, rampMonths: 1 })[5].value, "1 mese");
  const texts = [
    ...lines.flatMap((line) => [line.label, line.value]),
    ...Object.values(VALUE_PARAMS_FIELD_ERRORS),
    VALUE_PARAMS_TEXT.title,
    VALUE_PARAMS_TEXT.help,
    VALUE_PARAMS_TEXT.readOnly,
    ...Object.values(VALUE_PARAMS_TEXT.fields).flatMap((field) => Object.values(field)),
  ];
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
});

test("il primo mese della curva segue il mese corrente quando non è salvato", () => {
  assert.equal(originFollowsCurrentMonth(null), true);
  assert.equal(originFollowsCurrentMonth({ valueParams: {} }), true);
  assert.equal(originFollowsCurrentMonth({ valueParams: { originMonth: "2026-13" } }), true, "un mese che non esiste non vale");
  assert.equal(originFollowsCurrentMonth({ valueParams: { originMonth: "2026-11" } }), false);
  const lines = valueParamsLines({ ...DEFAULT_VALUE_PARAMS, originMonth: "2026-11" }, { followsCurrentMonth: true });
  assert.equal(lines.find((line) => line.key === "originMonth")?.value, "il mese corrente (nov 2026)");
});
