import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
const { acknowledgePrivacy } = await import("../db/queries/uc-public.ts");

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

/** Un link vivo, inventato, e un esecutore che tiene ogni batch e risponde come la SQL di «Ho letto» (`privacyAckSql`). */
function ackOn() {
  const batches: (readonly { text: string; params: readonly unknown[] }[])[] = [];
  const executor = {
    batch: async (statements: readonly { text: string; params: readonly unknown[] }[]) => {
      batches.push(statements);
      return [[{ live: 1, updated: 1 }]];
    },
  };
  const link = { live: true, tokenId: randomUUID(), workspaceId: randomUUID(), caseId: randomUUID(), requestId: randomUUID(), contactId: randomUUID(), privacyAckAt: null, privacyNoticeVersion: null };
  return { batches, ack: (body: unknown) => acknowledgePrivacy(executor as never, link as never, body, {} as never) };
}
const codeOf = (r: { ok: boolean; code?: string }) => (r.ok ? null : r.code);

test("«Ho letto, iniziamo» si registra solo con la prova del testo mostrato: la pagina di prima manda solo `version`", async () => {
  const now = REFERENT_PRIVACY_NOTICE.version;
  const { batches, ack } = ackOn();
  // Una pagina di produzione (49414cc9) non ancora accettata mostra il testo che ha dentro, `uc-2026-10-2` («nomi di
  // persone: il sistema li blocca»). Il primo tocco manda la versione della sua vista: 409 `informativa_cambiata`, che
  // quella pagina mostra con il messaggio del server, e poi rilegge la vista (`refresh()`).
  const first = await ack({ version: "uc-2026-10-2" });
  assert.equal(codeOf(first), "informativa_cambiata");
  assert.equal(publicStatusFor("informativa_cambiata"), 409);
  assert.match(first.ok ? "" : first.message, /aggiorna la pagina/, "il messaggio chiede di ricaricare la pagina");
  // Il secondo tocco, dopo `refresh()`: la versione della vista è quella del server, il testo sullo schermo no.
  const second = await ack({ version: now });
  assert.equal(codeOf(second), "informativa_cambiata", "nessun consenso a un testo che il referente non ha visto");
  assert.match(second.ok ? "" : second.message, /aggiorna la pagina/);
  // Una prova di un'altra versione, lo stesso.
  for (const body of [{ version: now, shown: "uc-2026-10-2" }, { version: "uc-2026-10-2", shown: now }]) assert.equal(codeOf(await ack(body)), "informativa_cambiata", JSON.stringify(body));
  assert.equal(batches.length, 0, "niente si registra: né la data, né la versione, né l'evento «informativa.vista»");
  // La pagina nuova: la versione del testo che ha mostrato (`noticeFor`), come prova.
  assert.deepEqual(await ack({ version: now, shown: now }), { ok: true, value: { version: now } });
  assert.equal(batches.length, 1);
  assert.match(batches[0][0].text, /privacy_ack_at/);
  assert.ok(batches[0][0].params.includes(now), "registra la versione di adesso");
  // Un corpo che non è quello della pagina resta «Dati non validi».
  for (const body of [null, "uc-2026-11-1", { shown: now }, { version: now, shown: now, altro: true }, { version: now, shown: 1 }]) assert.equal(codeOf(await ack(body)), "dati_non_validi", JSON.stringify(body));
  assert.equal(batches.length, 1);
});

test("il messaggio per le pagine di prima: calmo, dice cosa fare, nessun codice", () => {
  assert.equal(PRIVACY_UPDATED_MESSAGE, "Abbiamo aggiornato l'informativa: ricarica la pagina per leggerla e continuare.");
  assert.deepEqual(findForbiddenIn([PRIVACY_UPDATED_MESSAGE], "cliente"), []);
  assert.doesNotMatch(PRIVACY_UPDATED_MESSAGE, /«Ho letto, iniziamo»/, "non nomina un pulsante che quelle pagine non mostrano");
});
