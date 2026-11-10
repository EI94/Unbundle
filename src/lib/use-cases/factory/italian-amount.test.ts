// I numeri scritti all'italiana nei moduli del progetto dell'agente (rilascio 8.0a).
import test from "node:test";
import assert from "node:assert/strict";
import { italianAmount } from "./italian-amount.ts";

test("le migliaia con il punto, i decimali con la virgola o con il punto", () => {
  const cases: Array<[string, number | null]> = [
    ["", null],
    ["  ", null],
    ["40", 40],
    ["12,5", 12.5],
    ["12.5", 12.5],
    ["1.200", 1200],
    ["12.500", 12500],
    ["1.200,50", 1200.5],
    [" 25 ", 25],
    ["1 200", 1200],
  ];
  for (const [input, expected] of cases) assert.equal(italianAmount(input), expected, JSON.stringify(input));
});

test("tutto il resto non è un numero: niente negativi, niente lettere, niente due virgole", () => {
  for (const input of ["-5", "dieci", "12,5,3", "1,200.50", "€ 25", "1e3"]) assert.ok(Number.isNaN(italianAmount(input)), input);
});
