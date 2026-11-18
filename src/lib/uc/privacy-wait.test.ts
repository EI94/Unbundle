import test from "node:test";
import assert from "node:assert/strict";
import { publicError, publicStatusFor } from "./http.ts";
import { privacyAcknowledged, privacyWait } from "./public-rows.ts";
import { PRIVACY_PENDING_MESSAGE, PRIVACY_UPDATED_MESSAGE, REFERENT_PRIVACY_NOTICE, noticeFor, waitsForPrivacy, type ReferentNoticeText } from "./public-view.ts";
import { findForbiddenIn } from "./views/copy-guard.ts";
import { isRetryableStatus, parseApiResponse } from "./views/referente-form.ts";

// (Ondata 0) L'informativa di `/r` cambia versione con un rilascio (`uc-2026-10-2` → `uc-2026-11-1`), e Vercel Hobby
// non ha Skew Protection: le pagine aperte prima incontrano il server nuovo. Le scritture di chi aveva letto la
// versione vecchia aspettano come prima, ma con un esito che quelle pagine non trattano come un rifiuto della bozza;
// la vista porta il testo da accettare.

await import(new URL("../../../scripts/use-case-test/test-hooks.mjs", import.meta.url).href);
const { uploadResponse } = await import("../../app/api/r/[token]/upload-response.ts");

const at = new Date("2026-11-10T09:00:00Z");

test("perché una scrittura aspetta: informativa mai letta, oppure letta in una versione vecchia", () => {
  const now = REFERENT_PRIVACY_NOTICE.version;
  assert.equal(privacyWait({ privacyAckAt: null, privacyNoticeVersion: null }, now), "informativa_da_leggere");
  assert.equal(privacyWait({ privacyAckAt: at, privacyNoticeVersion: "uc-2026-10-2" }, now), "informativa_aggiornata");
  assert.equal(privacyWait({ privacyAckAt: at, privacyNoticeVersion: now }, now), null);
  // La regola resta la stessa: si scrive solo con la versione di adesso letta.
  for (const link of [{ privacyAckAt: null, privacyNoticeVersion: null }, { privacyAckAt: at, privacyNoticeVersion: "uc-2026-10-2" }, { privacyAckAt: at, privacyNoticeVersion: now }]) {
    assert.equal(privacyWait(link, now) === null, privacyAcknowledged(link, now));
  }
});

test("versione vecchia: 503 «informativa_aggiornata», che il salvataggio delle pagine di prima riprova tenendo la copia sul dispositivo", async () => {
  assert.equal(publicStatusFor("informativa_aggiornata"), 503);
  const answer = publicError("informativa_aggiornata");
  assert.equal(answer.status, 503);
  const body = await answer.json();
  assert.deepEqual(body, { ok: false, error: "informativa_aggiornata", message: PRIVACY_UPDATED_MESSAGE });
  // Il salvataggio automatico delle pagine di prima (`use-autosave.ts` di 49414cc9) cancella la copia sul dispositivo
  // dopo ogni rifiuto, salvo `link_non_valido` e gli stati che `isRetryableStatus` riprova: con il 409 la perdeva.
  assert.equal(isRetryableStatus(answer.status), true, "la pagina di prima la tiene e riprova");
  assert.equal(isRetryableStatus(publicStatusFor("informativa_da_leggere")), false);
  assert.equal(publicStatusFor("informativa_da_leggere"), 409, "mai letta: come prima");
  // La pagina nuova legge il codice prima dello stato.
  assert.deepEqual(parseApiResponse(503, body), { ok: false, status: 503, code: "informativa_aggiornata", message: PRIVACY_UPDATED_MESSAGE, issues: [] });
});

test("i caricamenti dal link rispondono allo stesso modo", async () => {
  const updated = uploadResponse({ ok: false, code: "informativa_aggiornata", message: PRIVACY_UPDATED_MESSAGE });
  assert.equal(updated.status, 503);
  assert.deepEqual(await updated.json(), { ok: false, error: "informativa_aggiornata", message: PRIVACY_UPDATED_MESSAGE });
  assert.equal(uploadResponse({ ok: false, code: "informativa_da_leggere", message: PRIVACY_PENDING_MESSAGE }).status, 409);
});

test("la pagina nuova riconosce le due attese, e solo quelle", () => {
  assert.equal(waitsForPrivacy("informativa_da_leggere"), true);
  assert.equal(waitsForPrivacy("informativa_aggiornata"), true);
  for (const code of ["informativa_cambiata", "link_non_valido", "non_disponibile", "stato_non_ammesso", "testo_sanitario", "errore"]) assert.equal(waitsForPrivacy(code), false, code);
});

test("il testo da accettare è sempre quello della versione chiesta: della vista, della pagina se è lo stesso, altrimenti nessuno", () => {
  const next: ReferentNoticeText = { ...REFERENT_PRIVACY_NOTICE, version: "uc-2027-01-1", lead: "Tre cose da sapere, aggiornate." };
  const own = REFERENT_PRIVACY_NOTICE;
  assert.equal(noticeFor({ version: next.version, notice: next }), next, "il server nuovo manda il suo testo");
  assert.equal(noticeFor({ version: own.version, notice: own }), own);
  assert.equal(noticeFor({ version: own.version }), own, "un server di prima, della stessa versione della pagina");
  assert.equal(noticeFor({ version: "uc-2026-10-2" }), null, "un server di prima, di un'altra versione: si ricarica");
  assert.equal(noticeFor({ version: next.version, notice: own }), null, "un testo di un'altra versione non vale");
});

test("il messaggio per le pagine di prima: calmo, dice cosa fare, nessun codice", () => {
  assert.equal(PRIVACY_UPDATED_MESSAGE, "Abbiamo aggiornato l'informativa: ricarica la pagina per leggerla e continuare.");
  assert.deepEqual(findForbiddenIn([PRIVACY_UPDATED_MESSAGE], "cliente"), []);
  assert.doesNotMatch(PRIVACY_UPDATED_MESSAGE, /«Ho letto, iniziamo»/, "non nomina un pulsante che quelle pagine non mostrano");
});
