import test from "node:test";
import assert from "node:assert/strict";
import { CLI_CONTEXT_UNAVAILABLE, CLI_NEEDS_REVIEWER_ROLE, cliCaseAccessFailure, notBuilderMessage } from "./case-errors.ts";

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

test("(8.0c) a chi scende a Contributore il no dice che il ruolo si cambia da Impostazioni › Team; agli altri il testo della porta", () => {
  assert.equal(CLI_NEEDS_REVIEWER_ROLE, "Per costruire serve almeno il ruolo di Analista nel workspace: lo cambia chi gestisce il workspace, da Impostazioni › Team.");
  assert.equal(notBuilderMessage("ruolo_workspace", "testo della porta"), CLI_NEEDS_REVIEWER_ROLE);
  for (const blocked of [null, "non_disponibile"]) assert.equal(notBuilderMessage(blocked, "testo della porta"), "testo della porta");
});

test("(9b) il contesto del cliente che non risponde è 503 con «Unbundle non risponde», da riprovare; mai «non trovato»", () => {
  assert.deepEqual(CLI_CONTEXT_UNAVAILABLE, { status: 503, code: "non_disponibile", message: "Unbundle non risponde: riprova tra qualche minuto.", headers: { "Retry-After": "60" } });
  assert.ok(Object.isFrozen(CLI_CONTEXT_UNAVAILABLE) && Object.isFrozen(CLI_CONTEXT_UNAVAILABLE.headers));
});
