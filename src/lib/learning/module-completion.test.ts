import test from "node:test";
import assert from "node:assert/strict";
import { moduleCompletion } from "./module-completion.ts";
import { createGenericTrainingPack } from "./test-fixture.ts";

// Nel pacchetto di prova: "check" è formativo e non obbligatorio, "case" ed
// "exit" sono obbligatori, "retake" è il recupero di "exit".
const pack = createGenericTrainingPack();
const done = (activityId: string, status = "consolidated") => ({ activityId, status: "submitted", result: { status } });

test("senza tentativi il modulo non è iniziato e le attività richieste sono quelle dichiarate", () => {
  const result = moduleCompletion(pack, "m1", []);
  assert.deepEqual(result, { required: 2, submitted: 0, status: "not_started", outcome: null });
});

test("un'attività facoltativa non conta per il completamento", () => {
  const result = moduleCompletion(pack, "m1", [done("check", "formative_completed")]);
  assert.equal(result.required, 2);
  assert.equal(result.submitted, 0);
  assert.equal(result.status, "in_progress");
});

test("una bozza avvia il modulo ma non lo completa", () => {
  const result = moduleCompletion(pack, "m1", [{ activityId: "case", status: "draft" }]);
  assert.equal(result.status, "in_progress");
  assert.equal(result.submitted, 0);
});

test("tutte le obbligatorie consegnate: completato, esito consolidato solo se lo sono tutte", () => {
  assert.deepEqual(moduleCompletion(pack, "m1", [done("case"), done("exit")]), {
    required: 2, submitted: 2, status: "completed", outcome: "consolidated",
  });
  assert.equal(moduleCompletion(pack, "m1", [done("case"), done("exit", "needs_practice")]).outcome, "needs_practice");
});

test("il recupero conta per l'attività che recupera, e vale l'ultima consegna", () => {
  const result = moduleCompletion(pack, "m1", [done("case"), done("exit", "needs_practice"), done("retake")]);
  assert.equal(result.status, "completed");
  assert.equal(result.outcome, "consolidated");
});

test("le attività di un altro modulo non contano", () => {
  const result = moduleCompletion(pack, "m2", [done("case"), done("exit")]);
  assert.equal(result.required, 0);
  assert.equal(result.status, "not_started");
});

test("un modulo senza attività obbligatorie non risulta mai completato per sbaglio", () => {
  const result = moduleCompletion(pack, "m3", []);
  assert.equal(result.status, "not_started");
  assert.equal(result.outcome, null);
});
