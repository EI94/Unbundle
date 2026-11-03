import test from "node:test";
import assert from "node:assert/strict";
import { USE_CASE_NOTICE_TEXT, noticeContextOf, noticeTextOf } from "./notices.ts";

// I testi delle notifiche degli use case nella campanella (SPEC §P2.6.5).
const n = (over: Partial<Parameters<typeof noticeTextOf>[0]> = {}) => ({ kind: "risposte" as const, answers: 0, unknowns: 0, documents: 0, followUp: null, ...over });

test("risposte: solo risposte, risposte e documenti, risposte e «Non lo so», solo «Non lo so», tutto a zero", () => {
  assert.deepEqual(noticeTextOf(n({ answers: 1 })), { title: "Risposte arrivate", description: "1 risposta da verificare in «Cosa serve»." });
  assert.deepEqual(noticeTextOf(n({ answers: 3 })), { title: "Risposte arrivate", description: "3 risposte da verificare in «Cosa serve»." });
  assert.deepEqual(noticeTextOf(n({ answers: 2, documents: 1 })), { title: "Risposte arrivate", description: "2 risposte e 1 documento da verificare in «Cosa serve»." });
  assert.deepEqual(noticeTextOf(n({ answers: 1, unknowns: 2 })), {
    title: "Risposte arrivate",
    description: "1 risposta da verificare in «Cosa serve». 2 «Non ce l'ho»: serve chiedere a qualcun altro.",
  });
  const onlyUnknown = noticeTextOf(n({ unknowns: 1 }));
  assert.deepEqual(onlyUnknown, { title: "Risposte arrivate", description: "1 «Non ce l'ho»: serve chiedere a qualcun altro." });
  assert.ok(!onlyUnknown.description.includes("da verificare"), "solo «Non lo so»: niente «da verificare»");
  assert.deepEqual(noticeTextOf(n()), { title: "Risposte arrivate", description: "Da verificare in «Cosa serve»." });
  assert.deepEqual(noticeTextOf(n({ answers: -3, documents: Number.NaN })), { title: "Risposte arrivate", description: "Da verificare in «Cosa serve»." });
});

test("documenti, nessuna risposta, informazioni complete", () => {
  assert.deepEqual(noticeTextOf(n({ kind: "documenti", documents: 1 })), { title: "Nuovi documenti", description: "1 documento in «Cosa serve»." });
  assert.deepEqual(noticeTextOf(n({ kind: "documenti", documents: 5 })), { title: "Nuovi documenti", description: "5 documenti in «Cosa serve»." });
  assert.deepEqual(noticeTextOf(n({ kind: "documenti" })), { title: "Nuovi documenti", description: "1 documento in «Cosa serve»." });
  assert.deepEqual(noticeTextOf(n({ kind: "senza_risposta", followUp: "ultimo_promemoria" })), {
    title: "Nessuna risposta",
    description: "È partito l'ultimo promemoria e restano domande senza risposta.",
  });
  assert.deepEqual(noticeTextOf(n({ kind: "senza_risposta", followUp: "scaduta" })), { title: "Nessuna risposta", description: "Il link è scaduto e restano domande senza risposta." });
  assert.deepEqual(noticeTextOf(n({ kind: "complete" })), { title: "Informazioni complete", description: "Ci sono tutte le informazioni che servono dal cliente." });
});

test("(0025) «Pronto da avviare» e «Autorizza i fornitori»: titolo e una frase, mai conteggi né «caso d'uso»", () => {
  assert.deepEqual(noticeTextOf(n({ kind: "pronto" })), { title: "Pronto da avviare", description: "Non manca niente dal cliente: si può avviare la realizzazione." });
  assert.deepEqual(noticeTextOf(n({ kind: "pronto", answers: 3, documents: 2 })), noticeTextOf(n({ kind: "pronto" })), "i conteggi non contano");
  assert.deepEqual(noticeTextOf(n({ kind: "fornitori" })), {
    title: "Autorizza i fornitori",
    description: "Serve il tuo ok sui sub-responsabili, in Impostazioni, per chiedere le informazioni di questo use case.",
  });
  for (const text of Object.values(USE_CASE_NOTICE_TEXT.titles)) assert.doesNotMatch(text, /caso d'uso|casi d'uso/i);
  assert.doesNotMatch(USE_CASE_NOTICE_TEXT.ready + USE_CASE_NOTICE_TEXT.suppliers, /caso d'uso|casi d'uso/i);
});

test("contesto: codice e titolo, o il titolo; al massimo 120 caratteri", () => {
  assert.equal(noticeContextOf("TJ-0004", "Fatture  fornitori"), "TJ-0004 · Fatture fornitori");
  assert.equal(noticeContextOf(null, "Fatture fornitori"), "Fatture fornitori");
  const long = noticeContextOf("TJ-0004", "x".repeat(300));
  assert.equal(long.length, 120);
  assert.ok(long.endsWith("…"));
  assert.equal(USE_CASE_NOTICE_TEXT.contextSeparator, " · ");
});
