import test from "node:test";
import assert from "node:assert/strict";
import { findHubForbiddenIn } from "../../use-cases/copy-guard.ts";
import { findForbiddenIn } from "./copy-guard.ts";
import { DOMANDE_TEXT } from "./domande-text.ts";
import { BULK_ACTION_LABEL } from "./bulk.ts";
import { QUESTION_ACTION_LABEL } from "./item-detail.ts";
import { mineExcludedText } from "./verification.ts";

// (Rilascio 10, ondata 5a, §3.5 e §4.2) I testi di Domande, del pannello della domanda, di «Verifica una alla volta» e
// del pannello «File»: le parole della dashboard (niente «caso d'uso», «dossier», «requisito»…), niente codici né gergo
// per il cliente, genere neutro. Le funzioni si chiamano con valori inventati.

/** Ogni testo del modulo, anche quelli fatti da una funzione. */
function texts(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (typeof value === "function") {
    const fn = value as (...args: unknown[]) => unknown;
    return fn.length === 0 ? texts(fn()) : [fn(3, 12, 245), fn(1, 1, 1), fn(0, 0, 0), fn("Listino 2026.pdf", "2 giorni fa"), fn(null, null)].flatMap((v) => (typeof v === "string" ? [v] : []));
  }
  if (value && typeof value === "object") return Object.values(value).flatMap(texts);
  return [];
}

const ALL = [...texts(DOMANDE_TEXT), ...Object.values(BULK_ACTION_LABEL), ...Object.values(QUESTION_ACTION_LABEL), mineExcludedText(3, "fine") ?? "", mineExcludedText(1, "elenco") ?? ""];

test("the Domande texts pass the dashboard copy guard and the client one", () => {
  assert.ok(ALL.length > 120, `${ALL.length} testi`);
  assert.deepEqual(findHubForbiddenIn(ALL, "area").map((m) => `«${m.match}» in «${m.text}»`), []);
  assert.deepEqual(findForbiddenIn(ALL, "cliente").map((m) => `«${m.match}» in «${m.text}»`), []);
});

test("neutral gender and calm tone: never «collega», no warning about personal data, no declaration", () => {
  for (const t of ALL) {
    assert.doesNotMatch(t, /\bcolleg(?:a|hi|he)\b/i, t);
    assert.doesNotMatch(t, /Niente (?:nomi|dati personali)|non contiene dati sanitari|quarantena/i, t);
  }
});

test("one verb to entrust, one to ask: the same words in the panel, the selection and Persone (§4)", () => {
  assert.equal(DOMANDE_TEXT.actions.reassign, "Affida a…");
  assert.equal(QUESTION_ACTION_LABEL.reassign, "Affida a…");
  assert.equal(BULK_ACTION_LABEL.assign, "Affida a…");
  assert.equal(DOMANDE_TEXT.actions.askReferent, "Chiedi al referente");
  assert.equal(QUESTION_ACTION_LABEL.askAgain, "Chiedi al referente");
  assert.equal(BULK_ACTION_LABEL.send, "Chiedi al referente");
  assert.ok(!ALL.some((t) => /^(?:Chiedi di nuovo|Invia|Assegna a…)$/.test(t)), "the words of yesterday are gone");
});

test("zero is not shown: «File», not «File (0)»; the counts read in Italian", () => {
  assert.equal(DOMANDE_TEXT.bar.files(0), "File");
  assert.equal(DOMANDE_TEXT.bar.files(1234), "File (1.234)");
  assert.equal(DOMANDE_TEXT.panel.activity(0), "Attività");
  assert.equal(DOMANDE_TEXT.panel.activity(5), "Attività · 5");
  assert.equal(DOMANDE_TEXT.filters.senzaReferenteCount(137), "Senza referente (137)");
  assert.equal(DOMANDE_TEXT.filters.senzaReferenteCount(0), "Senza referente");
  assert.equal(DOMANDE_TEXT.files.required(4), "Documenti richiesti (4)");
  assert.equal(DOMANDE_TEXT.files.seeAll(6), "Vedi tutti (6)");
  assert.equal(DOMANDE_TEXT.pages.range(1, 50, 245), "1–50 di 245");
  assert.equal(DOMANDE_TEXT.panel.linked(1), "Collegata a 1 domanda");
});
