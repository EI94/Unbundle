import test from "node:test";
import assert from "node:assert/strict";
import { findHealthTerms, healthIds } from "./health-terms.ts";
import { prepareText } from "./words.ts";

const terms = (text: string) => findHealthTerms(prepareText(text)).map((m) => m.term);

test("«visita medica» and the other phrases are found as one term", () => {
  assert.deepEqual(terms("Serve la visita medica annuale"), ["visita medica"]);
  assert.deepEqual(terms("Le VISITE MEDICHE dei piloti"), ["visita medica"]);
  assert.deepEqual(terms("certificato medico"), ["certificato medico"]);
  assert.deepEqual(terms("Idoneità medica e idoneità psicofisica"), ["idoneita medica", "idoneita psicofisica"]);
  assert.deepEqual(terms("lo stato di salute"), ["stato di salute"]);
  assert.deepEqual(terms("per motivi di salute"), ["motivi di salute"]);
  assert.deepEqual(terms("cartella clinica"), ["cartella clinica"]);
});

test("every stem of the lexicon blocks, in any form", () => {
  const words = [
    "medico",
    "medicina",
    "sanitari",
    "sanitaria",
    "malattia",
    "malattie",
    "malato",
    "diagnosi",
    "patologia",
    "terapia",
    "terapeutico",
    "farmaci",
    "farmacia",
    "invalidità",
    "gravidanza",
    "incinta",
    "maternità",
    "allergie",
    "allergico",
    "ricovero",
    "ricoverato",
    "sintomi",
    "vaccino",
    "vaccinazioni",
    "psicologo",
    "psichiatra",
    "infortunio",
    "clinico",
    "sanguigno",
    "disabile",
    "disabili",
    "handicap",
    "covid",
  ];
  for (const w of words) assert.equal(terms(`il ${w} del caso`).length, 1, w);
});

test("disabilità the noun blocks, disabilitare the verb does not", () => {
  assert.deepEqual(terms("passeggero con disabilità"), ["disabilita"]);
  assert.deepEqual(terms("passeggero con disabilita'"), ["disabilita"]);
  assert.deepEqual(terms("bisogna disabilitare la funzione"), []);
  assert.deepEqual(terms("la notifica è disabilitata"), []);
  assert.deepEqual(terms("il sistema disabilita il campo"), []);
});

test("domain false positives: hangarage and technical diagnostics", () => {
  assert.deepEqual(terms("il ricovero in hangar costa 200 €"), []);
  assert.deepEqual(terms("ricovero notturno dell'aereo"), []);
  assert.deepEqual(terms("la diagnostica del motore"), []);
  assert.deepEqual(terms("diagnostica di bordo"), []);
  // Ma la diagnosi resta sanitaria e il ricovero di una persona pure.
  assert.deepEqual(terms("diagnosi del pilota"), ["diagnosi"]);
  assert.deepEqual(terms("ricoverato in ospedale"), ["ricoverato"]);
});

test("ordinary words are not health terms", () => {
  assert.deepEqual(terms("media dei voli, mediamente 3, medio raggio, immediato"), []);
  assert.deepEqual(terms("intermedio, sintonia, terra, farmer, salute e sicurezza"), []);
  assert.deepEqual(terms("codice invalido, valido"), []);
});

test("healthIds include the stems of the phrases", () => {
  const ids = healthIds(prepareText("Quali visite mediche e dati sanitari escludete?"));
  assert.ok(ids.has("visita medica") && ids.has("medic") && ids.has("sanitar"));
  assert.deepEqual([...healthIds(prepareText("nessuno"))], []);
  const m = findHealthTerms(prepareText("visita medica"))[0];
  assert.deepEqual(m.ids, ["visita medica", "medic"]);
  assert.deepEqual([m.first, m.last], [0, 1]);
});
