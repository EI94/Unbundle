import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbidden } from "../copy-guard.ts";
import { REFERENT_ERROR_MESSAGES, REFERENT_PRIVACY_NOTICE, privacyNoticeTexts, privacyNoticeView } from "./labels.ts";
import { PRIVACY_NOT_SHOWN, linkPrivacyWait, privacyAccepted, privacyAcceptanceShown, privacyWaitOf, waitsForPrivacy } from "./state.ts";

// (Rilascio 9b) L'informativa di `/rispondi` passa da `ucq-2026-11-2` a `ucq-2026-11-3` (rilascio 10, D5: a `ref-2026-11-1`,
// l'informativa comune del kit del referente) e Vercel Hobby non ha Skew
// Protection: le pagine aperte prima del rilascio (49414cc9) parlano con il server nuovo. Un'accettazione deve provare
// quale testo era sullo schermo; una scrittura di chi aveva letto la versione vecchia aspetta, senza far perdere il testo.
// Regole pure, senza database: le rotte vere sono in handler.integration.test.ts.

const NOW = REFERENT_PRIVACY_NOTICE.version;
const OLD = "ucq-2026-11-3";
const at = new Date("2026-11-10T09:00:00Z");

test("perché una scrittura aspetta: informativa mai letta, oppure letta in una versione vecchia", () => {
  assert.equal(NOW, "ref-2026-11-1");
  assert.equal(privacyWaitOf({ privacyAcceptedAt: null, privacyNoticeVersion: null }), "informativa_da_leggere");
  assert.equal(privacyWaitOf({ privacyAcceptedAt: at, privacyNoticeVersion: OLD }), "informativa_aggiornata");
  assert.equal(privacyWaitOf({ privacyAcceptedAt: at, privacyNoticeVersion: null }), "informativa_aggiornata", "letta, ma non si sa quale");
  assert.equal(privacyWaitOf({ privacyAcceptedAt: at, privacyNoticeVersion: NOW }), null);
  // La regola resta una: si scrive solo con la versione di adesso letta.
  for (const r of [
    { privacyAcceptedAt: null, privacyNoticeVersion: null },
    { privacyAcceptedAt: at, privacyNoticeVersion: OLD },
    { privacyAcceptedAt: at, privacyNoticeVersion: NOW },
  ]) {
    assert.equal(privacyWaitOf(r) === null, privacyAccepted(r));
  }
});

test("l'attesa di un link: quella risolta dal token; senza, «mai letta» (i link costruiti a mano nei test)", () => {
  assert.equal(linkPrivacyWait({ privacyAccepted: true, privacyWait: "informativa_aggiornata" }), null, "letta adesso: niente da aspettare");
  assert.equal(linkPrivacyWait({ privacyAccepted: false, privacyWait: "informativa_aggiornata" }), "informativa_aggiornata");
  assert.equal(linkPrivacyWait({ privacyAccepted: false, privacyWait: null }), "informativa_da_leggere");
  assert.equal(linkPrivacyWait({ privacyAccepted: false }), "informativa_da_leggere");
});

test("la pagina nuova riconosce le due attese, e solo quelle", () => {
  assert.equal(waitsForPrivacy("informativa_da_leggere"), true);
  assert.equal(waitsForPrivacy("informativa_aggiornata"), true);
  for (const code of ["informativa_cambiata", "link_non_valido", "non_disponibile", "gia_inviata", "testo_sanitario", "errore", "rete"]) assert.equal(waitsForPrivacy(code), false, code);
});

test("«Iniziamo» si registra solo con la prova del testo mostrato: la pagina di prima manda solo `version`", () => {
  assert.equal(privacyAcceptanceShown({ version: NOW, shown: NOW }), true, "la pagina nuova: il testo della vista, la sua versione");
  // Il corpo della pagina di produzione (49414cc9): `{ version: view.privacy.version }`. Dopo una vista riletta dal server
  // nuovo è la versione di adesso, ma il testo sullo schermo è il suo: nessun consenso.
  assert.equal(privacyAcceptanceShown({ version: NOW }), false);
  assert.equal(privacyAcceptanceShown({ version: OLD }), false);
  assert.equal(privacyAcceptanceShown({ version: NOW, shown: OLD }), false, "un testo di un'altra versione");
  assert.equal(privacyAcceptanceShown({ version: OLD, shown: NOW }), false);
  assert.equal(privacyAcceptanceShown({ version: NOW, shown: true }), false);
  for (const body of [null, undefined, NOW, [NOW, NOW], {}]) assert.equal(privacyAcceptanceShown(body), false, JSON.stringify(body));
  assert.equal(privacyAcceptanceShown({ version: "ucq-2027-01-1", shown: "ucq-2027-01-1" }, "ucq-2027-01-1"), true, "vale per ogni versione");
});

test("la vista porta l'informativa intera di adesso, già riempita, come la riempiva la pagina", () => {
  const values = { company: "Cliente di prova", expires: "26 novembre 2026", requester: "Persona di prova", contact: "privacy@example.test" };
  const notice = privacyNoticeView(values);
  const filled = privacyNoticeTexts(values);
  assert.deepEqual(notice, {
    version: NOW,
    title: REFERENT_PRIVACY_NOTICE.title,
    lead: REFERENT_PRIVACY_NOTICE.lead,
    summary: filled.summary,
    fullTextLabel: REFERENT_PRIVACY_NOTICE.fullTextLabel,
    paragraphs: filled.paragraphs,
    button: REFERENT_PRIVACY_NOTICE.button,
    footerLabel: REFERENT_PRIVACY_NOTICE.footerLabel,
  });
  assert.ok(notice.paragraphs.some((p) => p.includes("tenere aggiornato quello che sappiamo del lavoro di Cliente di prova, senza il tuo nome")), "la frase del 9b resta");
});

test("il testo nuovo: calmo, dice cosa fare, nessuna parola vietata o tecnica", () => {
  assert.equal(REFERENT_ERROR_MESSAGES.informativa_aggiornata, "Abbiamo aggiornato l'informativa: ricarica la pagina per leggerla e continuare.");
  assert.doesNotMatch(REFERENT_ERROR_MESSAGES.informativa_aggiornata, /«Iniziamo»/, "lo legge anche la pagina di prima, che non sa mostrare l'informativa nuova");
  // La pagina di produzione mostra il messaggio di `informativa_cambiata` sotto «Iniziamo»: chiede di ricaricare.
  assert.match(REFERENT_ERROR_MESSAGES.informativa_cambiata, /ricarica la pagina/);
  const text = REFERENT_ERROR_MESSAGES.informativa_aggiornata;
  assert.deepEqual(findHubForbidden(text, "esterno"), [], text);
  assert.doesNotMatch(text, /\b(token|MCP|workflow|versione|ucq-)\b/i, text);
});

test("la pagina di produzione (49414cc9) non tratta il codice nuovo come una domanda da rileggere", () => {
  // I codici per cui quella pagina rilegge la vista e ricostruisce le domande dalla bozza del server (con il testo non
  // ancora salvato perso), dai suoi `question-card.tsx`, `thread.tsx` e `referent-ask-page.tsx`, fermi a quel rilascio.
  const rebuilds = {
    bozza: ["link_non_valido", "domanda_non_disponibile", "gia_inviata", "informativa_da_leggere"],
    filo: ["risposta_chiusa", "domanda_non_disponibile", "informativa_da_leggere"],
    passi: ["link_non_valido", "stima_cambiata", "gia_inviata", "domanda_non_disponibile", "informativa_da_leggere"],
    invio: ["link_non_valido", "domanda_non_disponibile", "informativa_da_leggere", "domande_nuove", "stima_mancante"],
  };
  const outdated = privacyWaitOf({ privacyAcceptedAt: at, privacyNoticeVersion: OLD });
  assert.ok(outdated);
  for (const [where, codes] of Object.entries(rebuilds)) assert.ok(!codes.includes(outdated), where);
  // «Iniziamo» di quella pagina mostra il messaggio del server solo per questi codici (gli altri: «Non riesco a
  // registrarlo»): il rifiuto senza la prova è uno di questi, e il suo messaggio chiede di ricaricare.
  const showsMessage = ["informativa_cambiata", "troppe_richieste"];
  assert.ok(showsMessage.includes(PRIVACY_NOT_SHOWN));
  assert.match(REFERENT_ERROR_MESSAGES[PRIVACY_NOT_SHOWN], /ricarica la pagina/);
});
