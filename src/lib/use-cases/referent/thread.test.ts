import test from "node:test";
import assert from "node:assert/strict";
import {
  CLARIFY_FROM_STATUSES,
  REFERENT_EDIT_LOCKED_STATUSES,
  REFERENT_THREAD_RULES,
  REPLY_TO_VERIFY_FROM_STATUSES,
  addThreadFacts,
  anchorKeyOf,
  newsForTeam,
  referentCanEdit,
  threadEmailAt,
  threadFactsOf,
  threadTurn,
  waitsForReferent,
  waitsForTeam,
  type ThreadMessageFact,
} from "./thread.ts";
import { checkReferentThreadText, checkThreadLine } from "./text.ts";
import { REFERENT_THREAD_TEXT } from "./labels.ts";
import { findHubForbidden } from "../copy-guard.ts";
import { romeLocalToUtc } from "../../uc/calendar.ts";

// (Rilascio 6) Le regole del filo con il referente, senza database. Dati sintetici.

const NEED = "aaaaaaaa-0000-4000-8000-000000000001";
let seq = 0;
function msg(m: Partial<ThreadMessageFact>): ThreadMessageFact {
  seq++;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    requestId: "11111111-0000-4000-8000-000000000001",
    anchor: "domanda",
    needId: NEED,
    componentKey: null,
    side: "team",
    kind: "chiarimento",
    replyToId: null,
    body: "Quanto, più o meno?",
    createdAt: new Date("2026-11-10T10:00:00Z"),
    seenAt: null,
    handledAt: null,
    removedAt: null,
    ...m,
  };
}

test("l'ancora: una domanda, una voce, «Generale»", () => {
  assert.equal(anchorKeyOf({ anchor: "domanda", needId: NEED.toUpperCase(), componentKey: null }), `d:${NEED}`);
  assert.equal(anchorKeyOf({ anchor: "beneficio", needId: null, componentKey: "tempo-1" }), "b:tempo-1");
  assert.equal(anchorKeyOf({ anchor: "generale", needId: null, componentKey: null }), "g");
});

test("chi aspetta chi: il chiarimento aspetta il referente, il dubbio il team, la risposta su una voce o «Generale» il team fino a «Fatto»", () => {
  const clar = msg({});
  const doubt = msg({ side: "referente", kind: "dubbio" });
  const replyOnQuestion = msg({ side: "referente", kind: "risposta", replyToId: clar.id });
  const replyOnBenefit = msg({ side: "referente", kind: "risposta", anchor: "beneficio", needId: null, componentKey: "tempo-1", replyToId: clar.id });
  const addition = msg({ side: "referente", kind: "aggiunta", anchor: "generale", needId: null });
  const teamReply = msg({ side: "team", kind: "risposta", replyToId: doubt.id });
  assert.equal(waitsForReferent(clar), true);
  assert.equal(waitsForReferent({ ...clar, handledAt: new Date() }), false, "gestito");
  assert.equal(waitsForReferent({ ...clar, removedAt: new Date() }), false, "tolto");
  assert.equal(waitsForReferent(teamReply), false, "una risposta del team non chiede niente");
  assert.equal(waitsForTeam(doubt), true);
  assert.equal(newsForTeam(replyOnQuestion), false, "su una domanda lo dice lo stato dell'informazione");
  assert.equal(newsForTeam(replyOnBenefit), true);
  assert.equal(newsForTeam(addition), true);
  assert.deepEqual(threadFactsOf([clar, doubt, replyOnQuestion, replyOnBenefit, addition, teamReply]), { clarifications: 1, doubts: 1, news: 2 });
  assert.deepEqual(addThreadFacts({ clarifications: 1, doubts: 0, news: 0 }, { clarifications: 0, doubts: 2, news: 1 }), { clarifications: 1, doubts: 2, news: 1 });
  assert.deepEqual(addThreadFacts({ clarifications: 1, doubts: 0, news: 0 }, null), { clarifications: 1, doubts: 0, news: 0 });
});

test("di chi è il turno: prima il team, poi il referente, altrimenti nessuno", () => {
  const none = { clarifications: 0, doubts: 0, news: 0 };
  assert.equal(threadTurn({ facts: { ...none, doubts: 1, clarifications: 1 }, openQuestions: 2 }), "team");
  assert.equal(threadTurn({ facts: { ...none, news: 1 }, openQuestions: 0 }), "team");
  assert.equal(threadTurn({ facts: none, openQuestions: 0, teamToVerify: true }), "team");
  assert.equal(threadTurn({ facts: { ...none, clarifications: 1 }, openQuestions: 0 }), "referente");
  assert.equal(threadTurn({ facts: none, openQuestions: 1 }), "referente");
  assert.equal(threadTurn({ facts: none, openQuestions: 0 }), null);
});

test("decisione 3 del titolare: la risposta si modifica finché l'informazione non è «A posto» (o «Non si applica»)", () => {
  assert.deepEqual([...REFERENT_EDIT_LOCKED_STATUSES], ["validata", "non_applicabile"]);
  for (const status of ["in_verifica", "chiesta", "mancante", "parziale", "da_chiedere"] as const) assert.equal(referentCanEdit(status, false), true, status);
  assert.equal(referentCanEdit("validata", false), false);
  assert.equal(referentCanEdit("non_applicabile", false), false);
  assert.equal(referentCanEdit("in_verifica", true), false, "archiviata");
  // Un chiarimento riporta «In attesa» anche da «A posto»; la risposta riporta «Da verificare».
  assert.deepEqual([...CLARIFY_FROM_STATUSES], ["in_verifica", "mancante", "parziale", "validata"]);
  assert.deepEqual([...REPLY_TO_VERIFY_FROM_STATUSES], ["chiesta", "mancante", "parziale", "validata"]);
});

test("l'email di una novità del team: in orario d'ufficio, al massimo una al giorno, mai dopo la scadenza", () => {
  const tuesday10 = romeLocalToUtc("2026-11-10", 10);
  const base = { status: "completata" as const, revokedAt: null, expiresAt: new Date("2026-12-10T10:00:00Z"), sentAt: new Date("2026-11-02T09:00:00Z"), lastEmailAt: new Date("2026-11-05T09:00:00Z") };
  assert.deepEqual(threadEmailAt(base, tuesday10, new Set()), tuesday10, "subito nella finestra");
  // Oggi è già partita un'email (alla richiesta, o un promemoria): il giorno lavorativo dopo, alle 9.
  assert.deepEqual(threadEmailAt({ ...base, lastEmailAt: new Date(tuesday10.getTime() - 3_600_000) }, tuesday10, new Set()), romeLocalToUtc("2026-11-11", 9));
  assert.deepEqual(threadEmailAt(base, tuesday10, new Set(["2026-11-10"])), romeLocalToUtc("2026-11-11", 9));
  // Fuori orario: alle 9 del giorno lavorativo dopo (sabato → lunedì).
  assert.deepEqual(threadEmailAt(base, romeLocalToUtc("2026-11-14", 11), new Set()), romeLocalToUtc("2026-11-16", 9));
  // Dopo «Correggi l'email» le email di oggi sono andate al vecchio indirizzo: subito.
  assert.deepEqual(threadEmailAt({ ...base, lastEmailAt: tuesday10, addressChanged: true }, tuesday10, new Set(["2026-11-10"])), tuesday10);
  // Niente email: revocata, scaduta, mai partita, oltre la scadenza.
  assert.equal(threadEmailAt({ ...base, status: "revocata" }, tuesday10, new Set()), null);
  assert.equal(threadEmailAt({ ...base, status: "scaduta" }, tuesday10, new Set()), null);
  assert.equal(threadEmailAt({ ...base, sentAt: null }, tuesday10, new Set()), null);
  assert.equal(threadEmailAt({ ...base, expiresAt: new Date(tuesday10.getTime() + 60_000) }, romeLocalToUtc("2026-11-14", 11), new Set()), null);
});

test("i testi del filo: una riga del team (nomi sì, dati sanitari no), un testo del referente", () => {
  assert.equal(REFERENT_THREAD_RULES.teamLineMax, 300);
  assert.deepEqual(checkThreadLine("  Lo controlla Mario Rossi,\nmario@rondine.test?  ", 300), { ok: true, value: "Lo controlla Mario Rossi, mario@rondine.test?" }, "una riga");
  assert.equal((checkThreadLine("x", 300) as { code: string }).code, "testo_vuoto");
  assert.equal((checkThreadLine("y".repeat(301), 300) as { code: string }).code, "riga_troppo_lunga");
  assert.equal((checkThreadLine("Ha una diagnosi di diabete?", 300) as { code: string }).code, "testo_sanitario");
  assert.equal((checkThreadLine("Il codice è RSSMRA80A01H501U?", 300) as { code: string }).code, "testo_codice_fiscale");
  assert.equal(checkReferentThreadText("Circa 220, lo sa anche Bruna (+39 000 0000000).", 1000).ok, true);
  assert.equal(checkReferentThreadText("", 1000).ok, false);
  assert.equal(checkReferentThreadText("Ha una diagnosi di diabete", 1000).ok, false);
});

test("le parole del filo sulla scheda: «use case», mai «caso d'uso», poche parole", () => {
  const all = Object.values(REFERENT_THREAD_TEXT).flatMap((v) => (typeof v === "string" ? [v] : Object.values(v)));
  for (const text of all) assert.deepEqual(findHubForbidden(text, "area"), [], text);
  assert.ok(all.every((t) => t.split(/\s+/).length <= 12), "nessuna frase lunga");
  assert.equal(REFERENT_THREAD_TEXT.turnReferent, "Tocca al referente");
  assert.equal(REFERENT_THREAD_TEXT.turnTeam, "Tocca a noi");
});
