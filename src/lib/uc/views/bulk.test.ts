import test from "node:test";
import assert from "node:assert/strict";
import { itemTransitionRules } from "../item-state.ts";
import { SENDABLE_ITEM_STATUSES } from "../sql/request-commands.ts";
import type { ItemStatus } from "../vocab.ts";
import { BULK_ACTIONS, BULK_ACTION_LABEL, BULK_CHUNK, BULK_FROM, MAX_NA_AT_ONCE, answersText, bulkOutcomeText, chunks, eligibleIds, groupSkipped, questionsText, skippedText } from "./bulk.ts";

const fromStates = (trigger: string) =>
  [...new Set(itemTransitionRules().filter((r) => r.triggers.includes(trigger as never)).map((r) => r.from))].sort();

test("the statuses each bulk action starts from match the item state machine", () => {
  assert.deepEqual([...BULK_FROM.missing!].sort(), fromStates("esito_mancante"));
  assert.deepEqual([...BULK_FROM.partial!].sort(), fromStates("esito_parziale"));
  assert.deepEqual([...BULK_FROM.send!].sort(), fromStates("invio_richiesta"));
  assert.deepEqual([...BULK_FROM.send!].sort(), [...SENDABLE_ITEM_STATUSES].sort());
  assert.deepEqual([...BULK_FROM.confirm!].sort(), fromStates("richiesta_conferma"));
  assert.equal(BULK_FROM.assign, null);
  assert.equal(BULK_FROM.due, null);
});

test("chunk sizes stay within the command limits", () => {
  // assignItems 2000, setItemsDue and transitionItems 500, sendRequests and requestConfirmation 2000.
  assert.ok(BULK_CHUNK.assign <= 2000 && BULK_CHUNK.due <= 500 && BULK_CHUNK.missing <= 500 && BULK_CHUNK.partial <= 500);
  assert.equal(BULK_CHUNK.send, 2000, "one call per 2,000 items: one request per referent, not one per small batch");
  assert.equal(BULK_CHUNK.confirm, 2000);
  assert.deepEqual(chunks([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunks([], 500), []);
  assert.deepEqual(chunks([1, 2], 0), [[1], [2]]);
});

test("eligible ids keep only the statuses an action accepts, without duplicates", () => {
  const sel: Partial<Record<ItemStatus, string[]>> = { da_chiedere: ["a", "b"], in_verifica: ["c"], validata: ["d"], chiesta: ["e", "a"] };
  assert.deepEqual(eligibleIds(sel, "send").sort(), ["a", "b"]);
  assert.deepEqual(eligibleIds(sel, "confirm"), ["c"]);
  assert.deepEqual(eligibleIds(sel, "missing").sort(), ["a", "c", "e"]);
  assert.deepEqual(eligibleIds(sel, "assign").sort(), ["a", "b", "c", "d", "e"]);
  const many = { da_chiedere: Array.from({ length: 80 }, (_, i) => `id${i}`) };
  assert.equal(eligibleIds(many, "na").length, MAX_NA_AT_ONCE);
});

test("skipped items are grouped by reason, most frequent first, with a few keys", () => {
  const groups = groupSkipped(
    [
      { key: "q.a.01", message: "Assegna prima la voce a un referente." },
      { key: "q.a.02", message: "La voce è ancora bloccata." },
      { key: "q.a.03", message: "Assegna prima la voce a un referente." },
      { key: "", message: "Assegna prima la voce a un referente." },
    ],
    2,
  );
  assert.deepEqual(groups, [
    { message: "Assegna prima la voce a un referente.", count: 3, keys: ["q.a.01", "q.a.03"] },
    { message: "La voce è ancora bloccata.", count: 1, keys: ["q.a.02"] },
  ]);
});

// ── Domande (DESIGN §3.6.2) ───────────────────────────────────────────

test("Domande counts questions and answers in words", () => {
  assert.equal(questionsText(1), "1 domanda");
  assert.equal(questionsText(2812), "2.812 domande");
  assert.equal(answersText(1), "1 risposta");
  assert.equal(answersText(160), "160 risposte");
});

test("skipped questions in one toast line: reasons without keys, at most three", () => {
  const groups = groupSkipped([
    { key: "q.a.1", message: "Senza referente." },
    { key: "q.a.2", message: "Senza referente." },
    { key: "q.a.3", message: "Già in un'altra richiesta." },
  ]);
  const line = skippedText(groups);
  assert.equal(line, "3 saltate: senza referente (2), già in un'altra richiesta (1).");
  assert.doesNotMatch(line, /q\.a\./);
  assert.equal(skippedText([]), "");
  assert.equal(skippedText(groups, 4), "7 saltate: senza referente (2), già in un'altra richiesta (1), altre per gli stessi motivi.");
});

test("the selection toasts say what happened (§3.6.2)", () => {
  assert.equal(bulkOutcomeText("assign", 12, { contactName: "Mario Rossi" }), "12 domande assegnate a Mario Rossi.");
  assert.equal(bulkOutcomeText("assign", 1, { contactName: "Mario Rossi" }), "1 domanda assegnata a Mario Rossi.");
  assert.equal(bulkOutcomeText("send", 3, { requests: 2 }), "3 domande inviate: 2 richieste.");
  assert.equal(bulkOutcomeText("confirm", 1, { requests: 1 }), "1 domanda rimandata per conferma: 1 richiesta.");
  assert.equal(bulkOutcomeText("due", 5), "Scadenza proposta su 5 domande.");
  assert.equal(bulkOutcomeText("due", 5, { cleared: true }), "Scadenza tolta da 5 domande.");
  assert.equal(bulkOutcomeText("missing", 2), "2 domande segnate: manca il dato.");
  assert.equal(bulkOutcomeText("partial", 1), "1 domanda segnata: risposta parziale.");
  assert.equal(bulkOutcomeText("na", 4), "«Non si applica» proposta su 4 domande: servono le due firme.");
  assert.deepEqual(Object.keys(BULK_ACTION_LABEL).sort(), [...BULK_ACTIONS].sort());
});
