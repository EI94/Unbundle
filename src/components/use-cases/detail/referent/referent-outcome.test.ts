import test from "node:test";
import assert from "node:assert/strict";
import { REFERENT_ERROR_MESSAGES } from "../../../../lib/use-cases/referent/labels.ts";
import { REFERENT_STALE_CODES, referentOutcome } from "./referent-outcome.ts";

// Dopo un'azione di «Chiedi al referente»: toast, rilettura della pagina, finestra (SPEC §5.1, §5.5).

test("riuscita: il toast del server e la finestra si chiude", () => {
  assert.deepEqual(referentOutcome({ ok: true, data: null, message: "Link revocato." }, { inDialog: true }), {
    ok: true,
    toast: { kind: "success", text: "Link revocato." },
    refresh: false,
    close: true,
    error: null,
  });
  assert.equal(referentOutcome({ ok: true, data: null, message: null }, { inDialog: false }).toast, null);
});

test("dati superati (versione, domande cambiate, richiesta chiusa…): toast, la pagina si rilegge, la finestra si chiude", () => {
  for (const code of ["versione_superata", "domande_cambiate", "richiesta_chiusa", "non_trovato"]) {
    assert.ok(REFERENT_STALE_CODES.has(code), code);
    const outcome = referentOutcome({ ok: false, code, message: REFERENT_ERROR_MESSAGES[code] ?? "x" }, { inDialog: true });
    assert.deepEqual([outcome.refresh, outcome.close, outcome.toast?.kind], [true, true, "error"], code);
  }
});

test("altri errori: dentro la finestra se c'è, altrimenti un toast; mai un testo vuoto", () => {
  const inDialog = referentOutcome({ ok: false, code: "email_in_uso", message: REFERENT_ERROR_MESSAGES.email_in_uso }, { inDialog: true });
  assert.deepEqual(inDialog, { ok: false, toast: null, refresh: false, close: false, error: REFERENT_ERROR_MESSAGES.email_in_uso });
  const button = referentOutcome({ ok: false, code: "promemoria_gia_inviato", message: "Oggi a Mario è già partita un'email." }, { inDialog: false });
  assert.deepEqual(button.toast, { kind: "error", text: "Oggi a Mario è già partita un'email." });
  assert.equal(referentOutcome({ ok: false, code: "riprova", message: "" }, { inDialog: true }).error, REFERENT_ERROR_MESSAGES.riprova);
});
