import test from "node:test";
import assert from "node:assert/strict";
import { copyIsCurrent, missingCompanyFields, registerFacts, registerStatus, type RegisterFacts } from "./register-view.ts";

// (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.13) Il registro in una frase:
// «In ordine», oppure che cosa manca, nell'ordine di prima; i fatti in una riga grigia senza zeri. Dati inventati.

const complete: RegisterFacts["organization"] = { legalName: "Cliente Demo S.r.l.", registerOwner: "Persona Demo, HR", aiActRole: "deployer", aiSystems: ["Claude"], useContext: "Uffici", trainers: "Formatrice Demo" };
function register(o: Omit<Partial<RegisterFacts>, "totals"> & { totals?: Partial<RegisterFacts["totals"]> } = {}): RegisterFacts {
  return {
    organization: complete,
    companies: [],
    sessions: [{ state: "svolta", endsAt: "2026-11-23T15:30:00.000Z" }],
    ...o,
    totals: { sessionsHeld: 1, peopleAttended: 18, undocumented: 0, sessionsScheduled: 0, ...o.totals },
  };
}

test("the missing company data, in words, as before (one legal name per company when the course has several)", () => {
  assert.deepEqual(missingCompanyFields(register()), []);
  assert.deepEqual(missingCompanyFields(register({ organization: { ...complete, legalName: null, aiActRole: null, aiSystems: [] } })), ["ragione sociale", "ruolo nell'uso dell'AI", "sistemi di AI in uso"]);
  const two = register({ organization: { ...complete, legalName: null }, companies: [{ domain: "a.test", legalName: "A" }, { domain: "b.test", legalName: null }] });
  assert.deepEqual(missingCompanyFields(two), ["ragione sociale per @b.test"]);
  assert.doesNotMatch(missingCompanyFields(register({ organization: { ...complete, aiActRole: null, aiSystems: [] } })).join(" "), /\bIA\b|AI Act/);
});

test("one status sentence, in order: company data, attendances to check, an up-to-date copy, else «In ordine»", () => {
  const copy = "2026-11-23T16:00:00.000Z";
  assert.deepEqual(registerStatus(register({ organization: { ...complete, trainers: null, useContext: null } }), copy), { tone: "giallo", sentence: "Mancano 2 dati dell'azienda.", fix: "dati-azienda" });
  assert.equal(registerStatus(register({ organization: { ...complete, trainers: null } }), copy).sentence, "Manca un dato dell'azienda.");
  assert.deepEqual(registerStatus(register({ totals: { undocumented: 3 } }), copy), { tone: "giallo", sentence: "3 presenze da controllare.", fix: "presenze" });
  assert.equal(registerStatus(register({ sessions: [{ state: "senza_partecipanti", endsAt: "2026-11-23T15:30:00.000Z" }] }), copy).sentence, "Una lezione conclusa senza partecipanti.");
  assert.deepEqual(registerStatus(register({ totals: { sessionsHeld: 0 }, sessions: [] }), null), { tone: "grigio", sentence: "Nessuna lezione ancora svolta.", fix: null });
  assert.equal(registerStatus(register(), null).sentence, "Scarica una copia aggiornata.");
  assert.equal(registerStatus(register(), "2026-11-23T15:00:00.000Z").sentence, "Scarica una copia aggiornata.", "una copia di prima della fine dell'ultima lezione non basta");
  assert.deepEqual(registerStatus(register(), copy), { tone: "verde", sentence: "In ordine.", fix: null });
});

test("the copy is current after the end of the last lesson held; the facts line never shows a zero", () => {
  assert.equal(copyIsCurrent(register(), "2026-11-23T15:30:00.000Z"), true);
  assert.equal(copyIsCurrent(register(), null), false);
  assert.equal(copyIsCurrent(register({ sessions: [] }), "2026-01-01T00:00:00.000Z"), true);
  assert.equal(registerFacts(register(), "23/11/2026 17:00"), "1 lezione svolta · 18 persone · ultima copia 23/11/2026 17:00");
  assert.equal(registerFacts(register({ totals: { sessionsHeld: 0, peopleAttended: 0, sessionsScheduled: 2 } }), null), "2 in programma");
  assert.equal(registerFacts(register({ totals: { sessionsHeld: 0, peopleAttended: 0 } }), null), "");
});
