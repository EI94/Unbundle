import test from "node:test";
import assert from "node:assert/strict";
import { checkDraftText, checkQuestionTitle, checkRequestMessage, checkReviewerAnswer, checkSubmitText } from "./text.ts";
import { REFERENT_ERROR_MESSAGES } from "./labels.ts";

// I controlli del testo (SPEC §3.1, §3.8, §3.9). Testi inventati.
const NEED = "3f2a9c1e-0000-4000-8000-0000000000e1";

test("bozza: si rifiutano solo dati sanitari e discriminatori, il resto sono avvisi", () => {
  const health = checkDraftText("Lo fa Paola, che è in malattia per una visita medica.");
  assert.equal(health.ok, false);
  const named = checkDraftText("Le fatture le controlla Mario Rossi ogni lunedì.");
  assert.equal(named.ok, true);
  if (named.ok) assert.ok(named.warnings.length > 0, "il nome è un avviso");
  const clean = checkDraftText("Circa 20 fatture al giorno, 5.000 all'anno.");
  assert.deepEqual(clean, { ok: true, warnings: [] });
});

test("invio: nomi, email, telefoni e salute bloccano, con il campo della domanda", () => {
  for (const text of ["Le controlla Mario Rossi.", "Scrivete a mario.rossi@topjet.it", "Chiamate il +39 333 1234567", "Ha una diagnosi di diabete"]) {
    const out = checkSubmitText(text, NEED);
    assert.equal(out.ok, false, text);
    if (!out.ok) {
      assert.ok(out.issues.length > 0);
      assert.ok(out.issues.every((i) => i.field === NEED && i.code.startsWith("testo_")), JSON.stringify(out.issues));
    }
  }
  assert.deepEqual(checkSubmitText("Circa 20 fatture al giorno.", NEED), { ok: true });
});

test("messaggio del revisore: vuoto è null, al massimo 1.000 caratteri, niente contatti", () => {
  assert.deepEqual(checkRequestMessage(null), { ok: true, value: null });
  assert.deepEqual(checkRequestMessage("   "), { ok: true, value: null });
  assert.deepEqual(checkRequestMessage(" Ciao, \r\ngrazie "), { ok: true, value: "Ciao, \ngrazie" });
  assert.deepEqual(checkRequestMessage("a".repeat(1001)), { ok: false, code: "messaggio_troppo_lungo", message: REFERENT_ERROR_MESSAGES.messaggio_troppo_lungo });
  const email = checkRequestMessage("Per dubbi scrivi a mario.rossi@topjet.it");
  assert.equal(email.ok, false);
  if (!email.ok) assert.equal(email.code, "testo_contatto");
  const phone = checkRequestMessage("Oppure chiama il +39 333 1234567");
  assert.equal(phone.ok, false);
  if (!phone.ok) assert.equal(phone.code, "testo_contatto");
  assert.equal(checkRequestMessage(42 as unknown as string).ok, false);
});

test("titolo di una domanda: niente contatti né nomi", () => {
  const out = checkQuestionTitle("Scrivi a mario.rossi@topjet.it quante fatture arrivano");
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, "testo_contatto");
  assert.deepEqual(checkQuestionTitle("Quante fatture arrivano ogni mese?"), { ok: true });
});

test("risposta del team: da 1 a 4.000 caratteri, senza dati personali", () => {
  assert.deepEqual(checkReviewerAnswer("  "), { ok: false, code: "risposta_vuota", message: REFERENT_ERROR_MESSAGES.risposta_vuota });
  assert.deepEqual(checkReviewerAnswer("a".repeat(4001)), { ok: false, code: "testo_troppo_lungo", message: REFERENT_ERROR_MESSAGES.testo_troppo_lungo });
  assert.deepEqual(checkReviewerAnswer(" 20 al giorno \r\n "), { ok: true, value: "20 al giorno" });
  assert.equal(checkReviewerAnswer("Le controlla Mario Rossi").ok, false);
});
