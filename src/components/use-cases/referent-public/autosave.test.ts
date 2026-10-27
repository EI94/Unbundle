import test from "node:test";
import assert from "node:assert/strict";
import { AUTOSAVE_DELAY_MS, autosaveLabelKey, autosaveReducer, dueDraft, initialAutosave, needsFlush, sameDraft, waitFor, type AutosaveState, type DraftValue } from "./autosave.ts";
import { REFERENT_PUBLIC_TEXT } from "../../../lib/use-cases/referent/labels.ts";

// Il salvataggio automatico delle risposte (SPEC §4.4 punto 4): 1,5 secondi dopo l'ultimo tasto e
// uscendo dal campo; «Salvato», «Salvataggio…», «Non salvato: riprova»; un blocco del testo non salva.

const v = (text: string, dontKnow = false): DraftValue => ({ text, dontKnow });
const label = (s: AutosaveState) => {
  const key = autosaveLabelKey(s);
  return key ? REFERENT_PUBLIC_TEXT.autosave[key] : null;
};

test("si aspetta 1,5 secondi dall'ultimo tasto, poi si salva una volta", () => {
  assert.equal(AUTOSAVE_DELAY_MS, 1500);
  let s = initialAutosave(v(""));
  assert.equal(label(s), null, "niente «Salvato» prima di una modifica");
  s = autosaveReducer(s, { type: "edit", value: v("Ogni"), now: 1000 });
  s = autosaveReducer(s, { type: "edit", value: v("Ogni giorno"), now: 1800 });
  assert.equal(dueDraft(s, 3000), null, "1,2 secondi dopo l'ultimo tasto: si aspetta");
  assert.equal(waitFor(s, 3000), 300);
  assert.deepEqual(dueDraft(s, 3300), v("Ogni giorno"));
  s = autosaveReducer(s, { type: "start", value: v("Ogni giorno") });
  assert.equal(label(s), "Salvataggio…");
  assert.equal(dueDraft(s, 99_999), null, "una chiamata alla volta");
  s = autosaveReducer(s, { type: "success", value: v("Ogni giorno"), savedAt: "2026-10-27T10:00:00.000Z", warnings: [] });
  assert.equal(label(s), "Salvato");
  assert.equal(needsFlush(s), false);
  assert.equal(dueDraft(s, 99_999), null);
});

test("uscire dal campo salva subito; senza modifiche non salva", () => {
  let s = initialAutosave(v("Excel"), "2026-10-26T10:00:00.000Z");
  s = autosaveReducer(s, { type: "blur", now: 10 });
  assert.equal(dueDraft(s, 10), null, "uguale al salvato");
  s = autosaveReducer(s, { type: "edit", value: v("Excel e SAP"), now: 100 });
  s = autosaveReducer(s, { type: "blur", now: 200 });
  assert.deepEqual(dueDraft(s, 200), v("Excel e SAP"));
  // Tornare al testo salvato (o con solo spazi in più) non salva niente.
  s = autosaveReducer(s, { type: "edit", value: v(" Excel "), now: 300 });
  assert.equal(dueDraft(s, 10_000), null);
  assert.equal(needsFlush(s), false);
});

test("una modifica durante il salvataggio riparte quando finisce", () => {
  let s = autosaveReducer(initialAutosave(v("")), { type: "edit", value: v("Due"), now: 0 });
  s = autosaveReducer(s, { type: "start", value: v("Due") });
  s = autosaveReducer(s, { type: "edit", value: v("Due persone"), now: 500 });
  assert.equal(needsFlush(s), true);
  s = autosaveReducer(s, { type: "success", value: v("Due"), savedAt: "2026-10-27T10:00:00.000Z", warnings: [] });
  assert.equal(s.status, "pending");
  assert.equal(dueDraft(s, 1000), null);
  assert.deepEqual(dueDraft(s, 2000), v("Due persone"));
});

test("errore di rete: «Non salvato: riprova», si riprova alla prossima modifica o uscendo dal campo", () => {
  let s = autosaveReducer(initialAutosave(v("")), { type: "edit", value: v("Tre ore"), now: 0 });
  s = autosaveReducer(s, { type: "start", value: v("Tre ore") });
  s = autosaveReducer(s, { type: "failure", value: v("Tre ore") });
  assert.equal(label(s), "Non salvato: riprova");
  assert.equal(needsFlush(s), true);
  assert.equal(dueDraft(s, 99_999), null, "nessun nuovo tentativo da solo");
  s = autosaveReducer(s, { type: "blur", now: 5000 });
  assert.deepEqual(dueDraft(s, 5000), v("Tre ore"));
});

test("blocco del testo: errore del campo, niente salvato, finché il testo non cambia", () => {
  let s = autosaveReducer(initialAutosave(v("")), { type: "edit", value: v("Chiedere a mario.rossi@topjet.it"), now: 0 });
  s = autosaveReducer(s, { type: "start", value: s.value });
  s = autosaveReducer(s, { type: "blocked", value: v("Chiedere a mario.rossi@topjet.it"), issues: [{ code: "testo_contatti", message: "Togli email e telefoni." }] });
  assert.equal(s.status, "blocked");
  assert.deepEqual(s.fieldError.map((i) => i.code), ["testo_contatti"]);
  assert.equal(label(s), null, "si mostra l'errore del campo, non lo stato");
  assert.deepEqual(s.saved, v(""), "niente è salvato");
  assert.equal(needsFlush(s), false, "l'invio non lo riprova");
  s = autosaveReducer(s, { type: "blur", now: 100 });
  assert.equal(dueDraft(s, 100), null, "uscire dal campo non lo riprova");
  s = autosaveReducer(s, { type: "edit", value: v("Chiedere all'ufficio acquisti"), now: 200 });
  assert.deepEqual(s.fieldError, []);
  assert.deepEqual(dueDraft(s, 200 + AUTOSAVE_DELAY_MS), v("Chiedere all'ufficio acquisti"));
});

test("gli avvisi del server restano sotto il campo dopo il salvataggio", () => {
  let s = autosaveReducer(initialAutosave(v("")), { type: "edit", value: v("Il 3 maggio"), now: 0 });
  s = autosaveReducer(s, { type: "start", value: s.value });
  s = autosaveReducer(s, { type: "success", value: v("Il 3 maggio"), savedAt: "2026-10-27T10:00:00.000Z", warnings: [{ code: "testo_data", message: "Controlla la data." }] });
  assert.deepEqual(s.warnings.map((w) => w.code), ["testo_data"]);
});

test("«Non lo so»: il testo non conta", () => {
  assert.equal(sameDraft(v("abc", true), v("", true)), true);
  assert.equal(sameDraft(v("", true), v("", false)), false);
  let s = initialAutosave(v("Bozza"));
  s = autosaveReducer(s, { type: "edit", value: v("", true), now: 0 });
  assert.deepEqual(dueDraft(s, AUTOSAVE_DELAY_MS), v("", true));
});
