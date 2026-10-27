import test from "node:test";
import assert from "node:assert/strict";
import {
  HISTORY_ACTOR_TEXT,
  REFERENT_HISTORY_CODES,
  REFERENT_HISTORY_FIELD,
  REFERENT_HISTORY_TEXT,
  historyActorText,
  isReferentHistoryCode,
  isReferentHistoryEvent,
  referentHistoryText,
} from "./history.ts";

// «Chiedi al referente» nella Storia (SPEC §5.6, §P2.10.6).

test("ogni codice ha il suo testo, e nessun testo nomina persone o numeri", () => {
  assert.deepEqual(Object.keys(REFERENT_HISTORY_TEXT).sort(), [...REFERENT_HISTORY_CODES].sort());
  for (const code of REFERENT_HISTORY_CODES) {
    const text = referentHistoryText({ phaseAfter: code });
    assert.equal(text, `Chiedi al referente: ${REFERENT_HISTORY_TEXT[code]}`);
    assert.doesNotMatch(text.replace("dopo 12 mesi", ""), /\d|@/);
  }
  assert.equal(referentHistoryText({ phaseAfter: "ignoto" }), "Chiedi al referente");
  assert.equal(referentHistoryText({ phaseAfter: null }), "Chiedi al referente");
});

test("testi verbatim di §5.6", () => {
  assert.equal(referentHistoryText({ phaseAfter: "inviata" }), "Chiedi al referente: richiesta inviata");
  assert.equal(referentHistoryText({ phaseAfter: "risposte" }), "Chiedi al referente: risposte ricevute");
  assert.equal(referentHistoryText({ phaseAfter: "revocata_sistema" }), "Chiedi al referente: link revocato: il referente non è più attivo");
  assert.equal(referentHistoryText({ phaseAfter: "conservazione" }), "Chiedi al referente: risposte e file cancellati dopo 12 mesi");
});

test("righe e codici della funzione", () => {
  assert.equal(REFERENT_HISTORY_FIELD, "richiesta_referente");
  assert.ok(isReferentHistoryEvent({ fields: ["richiesta_referente"] }));
  assert.equal(isReferentHistoryEvent({ fields: ["cosa_serve"] }), false);
  assert.ok(isReferentHistoryCode("file_team"));
  assert.equal(isReferentHistoryCode("FILE_TEAM"), false);
  assert.equal(isReferentHistoryCode(3), false);
});

test("chi ha agito: «Referente» dalla pagina pubblica, «Unbundle» per il resto del sistema, null per le persone", () => {
  assert.deepEqual(HISTORY_ACTOR_TEXT, { referente: "Referente", sistema: "Unbundle" });
  assert.equal(historyActorText({ actorKind: "sistema", channel: "web" }), "Referente");
  assert.equal(historyActorText({ actorKind: "sistema", channel: "altro" }), "Unbundle");
  assert.equal(historyActorText({ actorKind: "persona", channel: "pagina" }), null);
});
