import test from "node:test";
import assert from "node:assert/strict";
import { cliCaseAccessFailure } from "./case-errors.ts";

// La CLI legge un guasto come 503, non come «caso non trovato» (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md §16).

test("un guasto delle tabelle dei dossier è 503, da riprovare; mai «non trovato»", () => {
  const failure = cliCaseAccessFailure("non_disponibile");
  assert.deepEqual([failure.status, failure.code], [503, "non_disponibile"]);
  assert.equal(failure.message, "Unbundle non risponde per questo caso: riprova tra qualche minuto.");
  assert.equal(failure.headers["Retry-After"], "60");
});

test("la sezione spenta per il workspace e il caso che non vedi restano «non trovato»", () => {
  for (const code of ["disattivata", "non_trovato"] as const) {
    const failure = cliCaseAccessFailure(code);
    assert.deepEqual([failure.status, failure.code], [404, "non_trovato"], code);
  }
});
