import test from "node:test";
import assert from "node:assert/strict";
import { checkDraftText, checkQuestionTitle, checkRequestMessage, checkReviewerAnswer, checkSubmitText } from "./text.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_PRIVACY_CONTACT } from "./labels.ts";

// I controlli del testo (SPEC §3.1, §3.8, §3.9). Testi inventati.
const NEED = "3f2a9c1e-0000-4000-8000-0000000000e1";

test("bozza: si rifiutano solo dati sanitari e discriminatori; nomi, email e telefoni non danno avvisi (rilascio 5.1)", () => {
  const health = checkDraftText("Lo fa Paola, che è in malattia per una visita medica.");
  assert.equal(health.ok, false);
  for (const text of ["Le fatture le controlla Mario Rossi ogni lunedì.", "Scrivete a mario.rossi@topjet.it", "Chiamate il +39 333 1234567"]) {
    assert.deepEqual(checkDraftText(text), { ok: true, warnings: [] }, text);
  }
  const taxCode = checkDraftText("Il codice è RSSMRA80A01H501U.");
  assert.equal(taxCode.ok, true);
  if (taxCode.ok) assert.deepEqual(taxCode.warnings.map((w) => w.code), ["testo_codice_fiscale"], "il codice fiscale resta un avviso");
  const clean = checkDraftText("Circa 20 fatture al giorno, 5.000 all'anno.");
  assert.deepEqual(clean, { ok: true, warnings: [] });
});

test("invio: nomi, email e telefoni passano; salute e codici fiscali bloccano, con il campo della domanda", () => {
  for (const text of ["Le controlla Mario Rossi.", "Scrivete a mario.rossi@topjet.it", "Chiamate il +39 333 1234567", "Circa 20 fatture al giorno."]) {
    assert.deepEqual(checkSubmitText(text, NEED), { ok: true }, text);
  }
  for (const text of ["Ha una diagnosi di diabete", "Il codice è RSSMRA80A01H501U."]) {
    const out = checkSubmitText(text, NEED);
    assert.equal(out.ok, false, text);
    if (!out.ok) {
      assert.ok(out.issues.length > 0);
      assert.ok(out.issues.every((i) => i.field === NEED && i.code.startsWith("testo_")), JSON.stringify(out.issues));
      assert.ok(out.issues.every((i) => i.code !== "testo_nome_persona" && i.code !== "testo_contatto"), JSON.stringify(out.issues));
    }
  }
  const mixed = checkSubmitText("Mario Rossi ha una diagnosi di diabete", NEED);
  assert.equal(mixed.ok, false);
  if (!mixed.ok) assert.deepEqual([...new Set(mixed.issues.map((i) => i.code))], ["testo_sanitario"], "solo il dato sanitario, mai il nome");
});

/** (Rilascio 5.1) Quello che il team non può scrivere al referente né sulla scheda, come il referente: il codice del primo. */
const TEAM_REFUSED: ReadonlyArray<[string, string]> = [
  ["Il collega è in malattia per una visita medica.", "testo_sanitario"],
  ["Ha una diagnosi di diabete", "testo_sanitario"],
  ["Il codice è RSSMRA80A01H501U.", "testo_codice_fiscale"],
  ["È nato il 01/01/1980.", "testo_data_nascita"],
];
/** (Rilascio 5.1, decisione del titolare del 04/11/2026) Nomi, email e telefoni di altre persone passano. */
const TEAM_ACCEPTED = [
  "Per dubbi scrivi a mario.rossi@cliente.test",
  "Oppure chiama il +39 333 1234567",
  "Le controlla Mario Rossi, chiedi a lui o a Bruna Esempio.",
  "Il responsabile è Aldo Prova (aldo.prova@cliente.test, 333 1234567).",
];

test("messaggio del revisore: vuoto è null, al massimo 1.000 caratteri; nomi, email e telefoni passano, il resto come per il referente", () => {
  assert.deepEqual(checkRequestMessage(null), { ok: true, value: null });
  assert.deepEqual(checkRequestMessage("   "), { ok: true, value: null });
  assert.deepEqual(checkRequestMessage(" Ciao, \r\ngrazie "), { ok: true, value: "Ciao, \ngrazie" });
  assert.deepEqual(checkRequestMessage("a".repeat(1001)), { ok: false, code: "messaggio_troppo_lungo", message: REFERENT_ERROR_MESSAGES.messaggio_troppo_lungo });
  for (const text of TEAM_ACCEPTED) assert.deepEqual(checkRequestMessage(text), { ok: true, value: text }, text);
  for (const [text, code] of TEAM_REFUSED) {
    const out = checkRequestMessage(text);
    assert.equal(out.ok ? null : out.code, code, text);
    // Lo stesso testo il referente non lo può inviare.
    assert.equal(checkSubmitText(text, NEED).ok, false, text);
  }
  const mixed = checkRequestMessage("Mario Rossi ha una diagnosi di diabete, il codice è RSSMRA80A01H501U");
  assert.equal(mixed.ok ? null : mixed.code, "testo_sanitario", "prima il dato sanitario, mai il nome");
  assert.equal(checkRequestMessage(42 as unknown as string).ok, false);
});

test("titolo di una domanda: niente contatti né nomi", () => {
  const out = checkQuestionTitle("Scrivi a mario.rossi@topjet.it quante fatture arrivano");
  assert.equal(out.ok, false);
  if (!out.ok) assert.equal(out.code, "testo_contatto");
  assert.deepEqual(checkQuestionTitle("Quante fatture arrivano ogni mese?"), { ok: true });
});

test("risposta del team: da 1 a 4.000 caratteri; nomi, email e telefoni passano, il resto come per il referente", () => {
  assert.deepEqual(checkReviewerAnswer("  "), { ok: false, code: "risposta_vuota", message: REFERENT_ERROR_MESSAGES.risposta_vuota });
  assert.deepEqual(checkReviewerAnswer("a".repeat(4001)), { ok: false, code: "testo_troppo_lungo", message: REFERENT_ERROR_MESSAGES.testo_troppo_lungo });
  assert.deepEqual(checkReviewerAnswer(" 20 al giorno \r\n "), { ok: true, value: "20 al giorno" });
  for (const text of TEAM_ACCEPTED) assert.deepEqual(checkReviewerAnswer(text), { ok: true, value: text }, text);
  for (const [text, code] of TEAM_REFUSED) {
    const out = checkReviewerAnswer(text);
    assert.equal(out.ok ? null : out.code, code, text);
  }
});

test("informativa: l'indirizzo per i dati è quello esplicito, poi il reply-to, poi il mittente (che può non ricevere posta)", () => {
  const FROM = "Lateral Space via Unbundle <avvisi@notifiche.example.test>";
  assert.equal(REFERENT_PRIVACY_CONTACT({ USE_CASE_REFERENTS_PRIVACY_EMAIL: "privacy@example.test", UC_EMAIL_REPLY_TO: "risposte@example.test", UC_EMAIL_FROM: FROM }), "privacy@example.test");
  assert.equal(REFERENT_PRIVACY_CONTACT({ UC_EMAIL_REPLY_TO: " Risposte@Example.test ", UC_EMAIL_FROM: FROM }), "risposte@example.test");
  for (const bad of ["Nome <risposte@example.test>", "a@example.test, b@example.test", "a@example.test;b@example.test"]) {
    assert.equal(REFERENT_PRIVACY_CONTACT({ UC_EMAIL_REPLY_TO: bad, UC_EMAIL_FROM: FROM }), "avvisi@notifiche.example.test", bad);
  }
  assert.equal(REFERENT_PRIVACY_CONTACT({}), "chi ti ha mandato il link");
});
