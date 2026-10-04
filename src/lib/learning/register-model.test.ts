import test from "node:test";
import assert from "node:assert/strict";
import { createGenericTrainingPack } from "./test-fixture.ts";
import { companyDomain, companyDomains, DOCUMENTED, distinctPeople, joinTiming, moduleCompetencies, participation, requiredActivities } from "./register-model.ts";

const pack = createGenericTrainingPack();
const START = "2026-10-05T12:30:00Z";
const END = "2026-10-05T14:00:00Z";

test("un ingresso durante la lezione, o poco prima, conta come ingresso alla lezione", () => {
  assert.equal(joinTiming("2026-10-05T12:32:00Z", START, END), "durante_la_lezione");
  assert.equal(joinTiming("2026-10-05T12:00:00Z", START, END), "durante_la_lezione");
  assert.equal(joinTiming(END, START, END), "durante_la_lezione");
});

test("un ingresso molto prima o dopo la lezione è registrato per quello che è", () => {
  assert.equal(joinTiming("2026-10-04T20:00:00Z", START, END), "prima_della_lezione");
  assert.equal(joinTiming("2026-10-05T14:01:00Z", START, END), "dopo_la_lezione");
});

test("senza un ingresso dal link, o con una data illeggibile, non si inventa nulla", () => {
  assert.equal(joinTiming(null, START, END), "non_rilevato");
  assert.equal(joinTiming("non-una-data", START, END), "non_rilevato");
});

test("le esercitazioni richieste escludono le facoltative e i recuperi", () => {
  const { required, parentOf } = requiredActivities(pack, "m1");
  assert.deepEqual(required.sort(), ["case", "exit"]);
  assert.equal(parentOf.get("retake"), "exit");
});

test("si contano le consegne, non i risultati", () => {
  const result = participation({ pack, moduleId: "m1", submittedActivityIds: ["case", "exit"], enrollmentStatus: "active" });
  assert.deepEqual(result, { required: 2, submitted: 2, status: "esercitazioni_completate" });
  assert.equal(Object.hasOwn(result, "score"), false);
  assert.equal(Object.hasOwn(result, "outcome"), false);
});

test("un recupero vale per l'esercitazione che recupera, e un'attività facoltativa non conta", () => {
  assert.equal(participation({ pack, moduleId: "m1", submittedActivityIds: ["case", "retake"], enrollmentStatus: "active" }).status, "esercitazioni_completate");
  assert.deepEqual(participation({ pack, moduleId: "m1", submittedActivityIds: ["check"], enrollmentStatus: "active" }),
    { required: 2, submitted: 0, status: "nessuna_esercitazione" });
});

test("consegne ripetute della stessa esercitazione non gonfiano il conteggio", () => {
  const result = participation({ pack, moduleId: "m1", submittedActivityIds: ["case", "case", "case"], enrollmentStatus: "active" });
  assert.deepEqual(result, { required: 2, submitted: 1, status: "esercitazioni_in_parte" });
});

test("un'iscrizione sospesa resta visibile nel registro come tale", () => {
  assert.equal(participation({ pack, moduleId: "m1", submittedActivityIds: ["case", "exit"], enrollmentStatus: "revoked" }).status, "iscrizione_sospesa");
});

test("un'attività di un altro modulo non conta per questo modulo", () => {
  assert.equal(participation({ pack, moduleId: "m2", submittedActivityIds: ["case", "exit"], enrollmentStatus: "active" }).submitted, 0);
});

test("le competenze del modulo vengono dalle domande che contiene", () => {
  assert.deepEqual(moduleCompetencies(pack, "m1"), ["Generic competency"]);
  assert.deepEqual(moduleCompetencies(pack, "m2"), []);
});

test("le persone si contano una volta sola, anche fra piattaforma e presenze manuali", () => {
  assert.equal(distinctPeople([
    { userId: "u1", email: "a@x.it", name: "A" },
    { userId: "u1", email: "a@x.it", name: "A" },
    { userId: null, email: "B@x.it", name: "B" },
    { userId: null, email: "b@x.it ", name: "B bis" },
    { userId: null, email: null, name: "Carla Rossi" },
  ]), 3);
});

test("il dominio aziendale si legge dall'email; le caselle personali non fanno società", () => {
  assert.equal(companyDomain("Mario.Rossi@TopJet.aero "), "topjet.aero");
  assert.equal(companyDomain("anna@aliserio.it"), "aliserio.it");
  assert.equal(companyDomain("qualcuno@gmail.com"), null);
  assert.equal(companyDomain(null), null);
  assert.equal(companyDomain("non-una-email"), null);
  assert.equal(companyDomain("a@b@c.it"), null);
});

test("le società del corso si contano per persone, dalla più numerosa", () => {
  assert.deepEqual(companyDomains([
    { userId: "u1", email: "a@aliserio.it", name: "A" },
    { userId: "u1", email: "a@aliserio.it", name: "A" },
    { userId: "u2", email: "b@topjet.aero", name: "B" },
    { userId: "u3", email: "c@topjet.aero", name: "C" },
    { userId: null, email: "d@gmail.com", name: "D" },
    { userId: null, email: null, name: "E" },
  ]), [{ domain: "topjet.aero", people: 2 }, { domain: "aliserio.it", people: 1 }]);
});

test("chi si è solo iscritto non risulta partecipante: la partecipazione va documentata", () => {
  const base = { pack, moduleId: "m1", submittedActivityIds: [], enrollmentStatus: "active", sessionHeld: true };
  assert.equal(participation({ ...base, joinTiming: "durante_la_lezione" }).status, "nessuna_esercitazione");
  assert.equal(participation({ ...base, joinTiming: "prima_della_lezione" }).status, "partecipazione_non_documentata");
  assert.equal(participation({ ...base, joinTiming: "non_rilevato" }).status, "partecipazione_non_documentata");
  assert.equal(DOCUMENTED.has("partecipazione_non_documentata"), false);
  // Un'esercitazione consegnata documenta la presenza anche senza ingresso in aula.
  assert.equal(participation({ ...base, joinTiming: "prima_della_lezione", submittedActivityIds: ["case"] }).status, "esercitazioni_in_parte");
});

test("una sessione non ancora svolta non dice niente sulla partecipazione", () => {
  assert.equal(participation({ pack, moduleId: "m1", submittedActivityIds: [], enrollmentStatus: "active", sessionHeld: false, joinTiming: "prima_della_lezione" }).status, "sessione_in_programma");
});
