import test from "node:test";
import assert from "node:assert/strict";
import { materialAccess, contentDisposition } from "./material-access.ts";

const NOW = Date.parse("2026-10-05T13:00:00Z"); // lunedì 15:00 a Roma, a metà lezione
const ENDS = "2026-10-05T14:00:00Z"; // 16:00 a Roma
const learner = { trainer: false, enrolled: true, featureEnabled: true, session: { endsAt: ENDS, status: "scheduled" } };
const always = { audience: "learners", availableAfterSession: false };
const afterLesson = { audience: "learners", availableAfterSession: true };
const trainerOnly = { audience: "trainers", availableAfterSession: false };

test("la cartella degli esercizi si scarica subito", () => {
  const access = materialAccess(always, learner, NOW);
  assert.equal(access.visible, true);
  assert.equal(access.visible && access.downloadable, true);
});

test("le slide con le soluzioni restano chiuse fino a fine lezione, e lo dicono", () => {
  const access = materialAccess(afterLesson, learner, NOW);
  assert.equal(access.visible, true);
  assert.ok(access.visible && !access.downloadable);
  assert.ok(access.visible && !access.downloadable && access.reason.includes("fine lezione"));
});

test("a lezione finita le slide si aprono, anche se il formatore non ha chiuso il turno", () => {
  const access = materialAccess(afterLesson, learner, Date.parse(ENDS));
  assert.ok(access.visible && access.downloadable);
});

test("se il formatore chiude il turno prima, le slide si aprono subito", () => {
  const access = materialAccess(afterLesson, { ...learner, session: { endsAt: ENDS, status: "closed" } }, NOW);
  assert.ok(access.visible && access.downloadable);
});

test("un materiale di regia non esiste per un partecipante, nemmeno come titolo", () => {
  assert.deepEqual(materialAccess(trainerOnly, learner, NOW), { visible: false });
  assert.deepEqual(materialAccess(trainerOnly, learner, Date.parse(ENDS) + 86_400_000), { visible: false });
});

test("chi non è iscritto, o un corso nascosto, non vede nulla", () => {
  assert.deepEqual(materialAccess(always, { ...learner, enrolled: false }, NOW), { visible: false });
  assert.deepEqual(materialAccess(always, { ...learner, featureEnabled: false }, NOW), { visible: false });
});

test("il formatore vede e scarica tutto, sempre", () => {
  const trainer = { trainer: true, enrolled: false, featureEnabled: false, session: null };
  for (const rules of [always, afterLesson, trainerOnly]) {
    const access = materialAccess(rules, trainer, NOW);
    assert.ok(access.visible && access.downloadable, `${rules.audience}/${rules.availableAfterSession}`);
  }
});

test("una data di fine turno non valida non apre le slide per sbaglio", () => {
  const access = materialAccess(afterLesson, { ...learner, session: { endsAt: "non-una-data", status: "scheduled" } }, NOW);
  assert.ok(access.visible && !access.downloadable);
});

test("il nome del file nell'intestazione non permette di iniettare parametri", () => {
  assert.equal(
    contentDisposition("esercizi-unleash.zip"),
    `attachment; filename="esercizi-unleash.zip"; filename*=UTF-8''esercizi-unleash.zip`
  );
  const tricky = contentDisposition('a"; filename="evil.exe');
  assert.ok(!tricky.includes('filename="evil.exe"'), tricky);
  const accented = contentDisposition("Formazione AI · Unleash Creativity.pptx");
  assert.ok(accented.includes("filename*=UTF-8''Formazione%20AI%20%C2%B7%20Unleash%20Creativity.pptx"), accented);
});
