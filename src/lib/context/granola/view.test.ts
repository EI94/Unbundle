import test from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_TEXT } from "../text.ts";
import {
  granolaCardState,
  granolaCompactLine,
  granolaFlashLine,
  granolaSyncLine,
  granolaUpdatedLine,
  relativeWhen,
  splitPeopleEntries,
  splitTitleWords,
} from "./view.ts";

// Che cosa mostrano i blocchi di Granola (RILASCIO-9a-COSTRUZIONE.md §8.9): ogni testo da CONTEXT_TEXT.granola.

const T = CONTEXT_TEXT.granola;
const NOW = new Date("2026-11-16T10:00:00Z");

test("lo stato del blocco in Impostazioni: non disponibile, non collegato, collegato, da ricollegare", () => {
  assert.equal(granolaCardState({ available: false, connected: true, status: "attiva" }), "non_disponibile");
  assert.equal(granolaCardState({ available: true, connected: false, status: null }), "non_collegato");
  assert.equal(granolaCardState({ available: true, connected: true, status: "attiva" }), "collegato");
  assert.equal(granolaCardState({ available: true, connected: true, status: "da_ricollegare" }), "da_ricollegare");
});

test("la riga dopo il ritorno da Granola", () => {
  assert.deepEqual(granolaFlashLine("collegato"), { tone: "ok", text: T.connected });
  assert.deepEqual(granolaFlashLine("annullato"), { tone: "error", text: T.connectFailed });
  assert.deepEqual(granolaFlashLine("errore"), { tone: "error", text: T.connectFailed });
  assert.deepEqual(granolaFlashLine("scaduto"), { tone: "error", text: T.stateExpired });
  assert.equal(granolaFlashLine(undefined), null);
  assert.equal(granolaFlashLine("<script>"), null, "un valore inventato non mostra niente");
});

test("quando, a parole, e la riga «Granola aggiornato …»", () => {
  assert.equal(relativeWhen(new Date(NOW.getTime() - 20_000), NOW), "ora");
  assert.equal(relativeWhen(new Date(NOW.getTime() + 5_000), NOW), "ora", "un orologio un po' avanti");
  assert.equal(relativeWhen(new Date(NOW.getTime() - 5 * 60_000), NOW), "5 minuti fa");
  assert.equal(relativeWhen(new Date(NOW.getTime() - 3 * 3600_000), NOW), "3 ore fa");
  assert.equal(relativeWhen("2026-11-15T09:00:00Z", NOW), "ieri");
  assert.equal(relativeWhen("2026-11-04T09:00:00Z", NOW), "12 giorni fa");
  assert.equal(relativeWhen(null, NOW), null);
  assert.equal(relativeWhen("non una data", NOW), null);
  assert.equal(granolaUpdatedLine(new Date(NOW.getTime() - 5 * 60_000), NOW), "Granola aggiornato 5 minuti fa");
  assert.equal(granolaUpdatedLine(null, NOW), null);
});

test("dopo un giro: che cosa è entrato, o perché no; la riga compatta parla solo se serve", () => {
  assert.deepEqual(granolaSyncLine({ status: "fatto", imported: 2, updated: 0 }), { tone: "ok", text: "2 call nuove da Granola." });
  assert.deepEqual(granolaSyncLine({ status: "fatto", imported: 0, updated: 1 }), { tone: "info", text: "Niente di nuovo da Granola." });
  assert.deepEqual(granolaSyncLine({ status: "limite", imported: 0, updated: 0 }), { tone: "error", text: T.rateLimited });
  assert.deepEqual(granolaSyncLine({ status: "da_ricollegare", imported: 0, updated: 0 }), { tone: "error", text: T.expired });
  assert.deepEqual(granolaSyncLine({ status: "non_riuscito", imported: 0, updated: 0 }), { tone: "error", text: T.loadFailed });
  assert.deepEqual(granolaSyncLine({ status: "in_corso", imported: 0, updated: 0 }), { tone: "info", text: T.refreshing });
  assert.deepEqual(granolaSyncLine({ status: "non_collegato", imported: 0, updated: 0 }), { tone: "info", text: T.notConnectedLine });
  for (const status of ["recente", "in_corso", "limite", "non_riuscito", "non_collegato"]) assert.equal(granolaSyncLine({ status, imported: 0, updated: 0 }, true), null, status);
  assert.equal(granolaSyncLine({ status: "fatto", imported: 0, updated: 3 }, true), null);
  assert.deepEqual(granolaSyncLine({ status: "fatto", imported: 1, updated: 0 }, true), { tone: "ok", text: "1 call nuova da Granola." });
});

test("la riga compatta della Memoria: mentre aggiorna, quello che è entrato, «Da smistare (n)», altrimenti niente", () => {
  assert.deepEqual(granolaCompactLine({ syncing: true, last: null, unsortedCount: 4 }), { text: T.refreshing, toNotes: false });
  assert.deepEqual(granolaCompactLine({ syncing: false, last: { status: "fatto", imported: 2, updated: 0 }, unsortedCount: 4 }), { text: "2 call nuove da Granola.", toNotes: true });
  assert.deepEqual(granolaCompactLine({ syncing: false, last: { status: "fatto", imported: 0, updated: 0 }, unsortedCount: 5 }), { text: "Da smistare (5)", toNotes: true });
  assert.deepEqual(granolaCompactLine({ syncing: false, last: { status: "da_ricollegare", imported: 0, updated: 0 }, unsortedCount: 0 }), { text: T.expired, toNotes: false });
  assert.equal(granolaCompactLine({ syncing: false, last: null, unsortedCount: 0 }), null);
  assert.equal(granolaCompactLine({ syncing: false, last: { status: "recente", imported: 0, updated: 0 }, unsortedCount: 0 }), null);
});

test("persone e domini: e-mail, domini (anche con @ davanti), separatori diversi, doppioni e valori sbagliati", () => {
  assert.deepEqual(splitPeopleEntries(" Giulia@Nardi.test, @nardi.test; nardi-group.test  giulia@nardi.test ciao a@b"), {
    emails: ["giulia@nardi.test"],
    domains: ["nardi.test", "nardi-group.test"],
    invalid: ["ciao", "a@b"],
  });
  assert.deepEqual(splitPeopleEntries(""), { emails: [], domains: [], invalid: [] });
});

test("le parole nel titolo: separate da virgole, senza doppioni, con le frasi di più parole", () => {
  assert.deepEqual(splitTitleWords("Ferrari, nardi ;  Officina   Nardi", ["Nardi"]), ["Nardi", "Ferrari", "Officina Nardi"]);
  assert.deepEqual(splitTitleWords("  ", ["Nardi"]), ["Nardi"]);
});
