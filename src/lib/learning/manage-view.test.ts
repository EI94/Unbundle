import test from "node:test";
import assert from "node:assert/strict";
import { ADMIN_TABS, activitiesState, adminTab, adminTabHref, lessonsNextStep, linkState, linkUsable, moduleLabel } from "./manage-view.ts";
import { activityAvailability } from "./availability.ts";
import { LEARNING_TEXT } from "./text.ts";

// (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.11) Le regole pure di
// «Gestisci»: le quattro schede e il loro indirizzo, il prossimo passo di «Lezioni» (il solo pulsante pieno), lo stato
// di un link e delle attività in parole, il modulo senza codice. Dati inventati.

const NOW = Date.parse("2026-11-23T12:00:00.000Z");
const H = 60 * 60_000;
const lesson = (cohortId: string, startOffsetHours: number) => ({ cohortId, startsAt: new Date(NOW + startOffsetHours * H).toISOString(), endsAt: new Date(NOW + (startOffsetHours + 2) * H).toISOString() });
const link = (o: Partial<{ id: string; cohortId: string; doorOpen: boolean; revokedAt: string | null; expiresAt: string }> = {}) => ({
  id: "l1", cohortId: "c1", doorOpen: false, revokedAt: null, expiresAt: new Date(NOW + 24 * H).toISOString(), ...o,
});

test("four tabs with an address; an unknown or missing value is «Lezioni», which needs no parameter", () => {
  assert.deepEqual([...ADMIN_TABS], ["lezioni", "materiali", "persone", "impostazioni"]);
  assert.equal(adminTab(undefined), "lezioni");
  assert.equal(adminTab("persone"), "persone");
  assert.equal(adminTab("links"), "lezioni", "le sezioni di prima non avevano indirizzo: nessun alias");
  assert.equal(adminTabHref("/dashboard/w/learning/p/admin", "", "materiali"), "/dashboard/w/learning/p/admin?scheda=materiali");
  assert.equal(adminTabHref("/dashboard/w/learning/p/admin", "?scheda=materiali&x=1", "lezioni"), "/dashboard/w/learning/p/admin?x=1");
  assert.equal(adminTabHref("/dashboard/w/learning/p/admin", "?scheda=persone", "impostazioni"), "/dashboard/w/learning/p/admin?scheda=impostazioni");
});

test("«Lezioni»: the next lesson's step is the only filled button: create its link, then open its entrance, then nothing", () => {
  const lessons = [lesson("c2", 48), lesson("c1", 2), lesson("c0", -48)];
  assert.deepEqual(lessonsNextStep(lessons, [], NOW), { cohortId: "c1", step: "create", linkId: null }, "la prossima per data, non la prima dell'elenco");
  assert.deepEqual(lessonsNextStep(lessons, [link({ revokedAt: new Date(NOW - H).toISOString() })], NOW), { cohortId: "c1", step: "create", linkId: null }, "un link disattivato non conta");
  assert.deepEqual(lessonsNextStep(lessons, [link({ expiresAt: new Date(NOW - 1).toISOString() })], NOW), { cohortId: "c1", step: "create", linkId: null }, "nemmeno uno scaduto");
  assert.deepEqual(lessonsNextStep(lessons, [link()], NOW), { cohortId: "c1", step: "openDoor", linkId: "l1" });
  assert.equal(lessonsNextStep(lessons, [link({ doorOpen: true })], NOW), null, "ingresso aperto: niente da fare");
  assert.deepEqual(lessonsNextStep([lesson("c1", -1)], [], NOW), { cohortId: "c1", step: "create", linkId: null }, "una lezione in corso è ancora la prossima");
  assert.equal(lessonsNextStep([lesson("c0", -48)], [], NOW), null, "tutte finite: nessun pulsante pieno");
});

test("a link's state and a lesson's activities, as a dot and a word", () => {
  assert.deepEqual(linkState(link(), NOW), { label: "Ingresso chiuso", tone: "giallo" });
  assert.deepEqual(linkState(link({ doorOpen: true }), NOW), { label: "Ingresso aperto", tone: "verde" });
  assert.deepEqual(linkState(link({ expiresAt: new Date(NOW).toISOString() }), NOW), { label: "Scaduto", tone: "grigio" });
  assert.deepEqual(linkState(link({ revokedAt: new Date(NOW).toISOString(), doorOpen: true }), NOW), { label: "Disattivato", tone: "grigio" });
  assert.equal(linkUsable(link(), NOW), true);
  assert.deepEqual(activitiesState("scheduled"), { label: "Attività secondo la scaletta", tone: "blu" });
  assert.deepEqual(activitiesState("open"), { label: "Attività aperte", tone: "verde" });
  assert.deepEqual(activitiesState("closed"), { label: "Risposte sospese", tone: "giallo" });
});

test("a module in words, never its code", () => {
  assert.equal(moduleLabel("m1"), "Modulo 1");
  assert.equal(moduleLabel("M12"), "Modulo 12");
  assert.equal(moduleLabel(null), "Tutto il corso");
  assert.equal(moduleLabel("extra"), "extra");
});

test("the three activity buttons say what availability really does (activityAvailability)", () => {
  const L = LEARNING_TEXT.manage.lessons;
  const start = Date.parse("2026-11-23T13:30:00.000Z");
  const exercise = { module_id: "m1", type: "knowledge_check", purpose: "formative", opens_after_minutes: 30 };
  const at = (status: string, minutes: number) => activityAvailability({ enabled: true, programStatus: "published", activity: exercise, session: { startsAt: new Date(start).toISOString(), status }, now: start + minutes * 60_000 });
  // «Apri le attività ora»: aperto subito, senza aspettare la scaletta.
  assert.equal(at("open", 5).writeAccess, true);
  assert.match(L.openNowAsk, /da adesso, senza aspettare la scaletta/);
  // «Torna alla scaletta»: aperto in anticipo → si richiude fino alla sua ora (chi lo sta facendo non salva); arrivato
  // all'ora → resta aperto.
  assert.equal(at("scheduled", 5).writeAccess, false);
  assert.equal(at("scheduled", 5).state, "scheduled");
  assert.equal(at("scheduled", 30).writeAccess, true);
  assert.match(L.backToPlanAsk, /aperti in anticipo si richiudono fino ad allora/);
  assert.match(L.backToPlanAsk, /non può salvare né inviare finché non si riaprono/);
  assert.match(L.backToPlanAsk, /Quelli già arrivati alla loro ora restano aperti\./);
  assert.doesNotMatch(L.backToPlanAsk, /quelli già aperti restano aperti/, "la frase di prima era falsa");
  // «Sospendi le risposte»: salvataggi e consegne fermi, a ogni ora.
  for (const minutes of [5, 40, 200]) assert.equal(at("closed", minutes).writeAccess, false);
  assert.match(L.suspendAsk, /Salvataggi e consegne si fermano/);
});
