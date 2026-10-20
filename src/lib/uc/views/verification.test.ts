import test from "node:test";
import assert from "node:assert/strict";
import { rowToLoadedItem } from "../sql/transitions.ts";
import {
  VERIFICATION_PAGE_SIZE,
  buildQueue,
  excludedFromQueue,
  mineExcludedText,
  parseReviewSlot,
  queuePage,
  reviewHref,
  reviewKeyAction,
  reviewPosition,
  rowsToReviewQueue,
} from "./verification.ts";
import { LS_USER, OTHER_LS, lsUser, snapshotRow } from "./view.fixtures.ts";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const D = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

test("the queue skips items the user answered or whose link the user copied, oldest answer first", () => {
  const items = [
    rowToLoadedItem(snapshotRow({ id: A, key: "q.a.01", a_id: "a1", current_answer_id: "a1", a_created_at: "2026-10-05T10:00:00Z" })),
    rowToLoadedItem(snapshotRow({ id: B, key: "q.a.02", a_id: "b1", current_answer_id: "b1", a_created_at: "2026-10-01T10:00:00Z", status: "parziale" })),
    rowToLoadedItem(snapshotRow({ id: C, key: "q.a.03", responder_user_ids: [LS_USER] })),
    rowToLoadedItem(snapshotRow({ id: D, key: "q.a.04", token_issuer_user_ids: [LS_USER] })),
  ];
  assert.equal(excludedFromQueue(items[2], LS_USER), true);
  assert.equal(excludedFromQueue(items[2], OTHER_LS), false);
  const { entries, excludedMine } = buildQueue({
    items,
    answers: [
      { item_id: A, value: { value: 10, unit: null }, encrypted: false, erased: false, source_ref: null, confidence: "certo", valid_from: null, responder_contact_name: "Referente", acting_role_key: "resp_servizio" },
    ],
    checks: [{ item_id: B, check_key: "min_righe", outcome: "avviso", message: "Meno righe del minimo" }],
    user: lsUser,
    roles: ["ls_analista"],
    roleLabels: { resp_servizio: "Servizio" },
  });
  assert.equal(excludedMine, 2);
  assert.deepEqual(entries.map((e) => e.key), ["q.a.02", "q.a.01"]);
  assert.deepEqual(entries[1].value, { kind: "value", text: "10" });
  assert.equal(entries[1].roleLabel, "Servizio");
  assert.equal(entries[1].confidence, "Certo");
  assert.deepEqual(entries[0].checks, [{ checkKey: "min_righe", outcome: "avviso", message: "Meno righe del minimo" }]);
  assert.deepEqual(entries[1].validate, { ok: true });
});

test("a long queue is shown one page at a time, in arrival order", () => {
  const entries = Array.from({ length: 160 }, (_, i) => i);
  const first = queuePage(entries, 1);
  assert.equal(first.entries.length, VERIFICATION_PAGE_SIZE);
  assert.deepEqual([first.total, first.page, first.pages], [160, 1, 4]);
  assert.deepEqual(queuePage(entries, 4).entries, entries.slice(150));
  assert.equal(queuePage(entries, 99).page, 4, "past the last page shows the last one");
  assert.equal(queuePage(entries, Number.NaN).page, 1);
  assert.deepEqual(queuePage([], 3), { entries: [], total: 0, page: 1, pages: 1 });
});

// ── Verifica una alla volta (DESIGN §3.6.4) ───────────────────────────

test("review queue: the viewer's own answers stay out and are counted", () => {
  assert.deepEqual(
    rowsToReviewQueue([
      { id: A, mine: false },
      { id: B, mine: true },
      { id: C, mine: "f" },
      { id: D, mine: "t" },
    ]),
    { ids: [A, C], mine: 2 },
  );
});

test("review position: the requested card if still there, otherwise the first; «3 di 160»", () => {
  assert.deepEqual(reviewPosition([A, B, C], B.toUpperCase()), { currentId: B, index: 2, total: 3, prevId: A, nextId: C });
  assert.deepEqual(reviewPosition([A, B, C], D), { currentId: A, index: 1, total: 3, prevId: null, nextId: B });
  assert.deepEqual(reviewPosition([A, B, C], null).currentId, A);
  assert.deepEqual(reviewPosition([], A), { currentId: null, index: 0, total: 0, prevId: null, nextId: null });
});

test("after an action the next card is the one that followed, even if a colleague verified it meanwhile", () => {
  const base = "/v";
  // On B (2 of 4): «Valida» goes to C, expected where B was.
  const onB = reviewPosition([A, B, C, D], B);
  assert.equal(reviewHref(base, onB, "done"), `/v?voce=${C}&posto=2`);
  // The page after the action reads the new queue (B left it): C opens, 2 of 3.
  const after = reviewPosition([A, C, D], C, parseReviewSlot("2"));
  assert.deepEqual(after, { currentId: C, index: 2, total: 3, prevId: A, nextId: D });
  // A colleague verified C too: the card in C's place is D, not the first one.
  assert.equal(reviewPosition([A, D], C, parseReviewSlot("2")).currentId, D);
  // «Salta» and «←» do not change the queue: the slot is the card's own.
  assert.equal(reviewHref(base, onB, "next"), `/v?voce=${C}&posto=3`);
  assert.equal(reviewHref(base, onB, "prev"), `/v?voce=${A}&posto=1`);
  assert.equal(reviewPosition([A, B, D], C, 3).currentId, D);
  // The last card: after it, the queue reloads from the top (or ends).
  const last = reviewPosition([A, B], B);
  assert.equal(reviewHref(base, last, "done"), base);
  assert.equal(reviewPosition([A], null, null).currentId, A);
  assert.equal(reviewPosition([A, B], D, 9).currentId, B, "a slot past the end is the last card");
  for (const bad of ["0", "-1", "x", "1.5", undefined]) assert.equal(parseReviewSlot(bad), null);
});

test("keyboard: V validates, C asks, arrows move; never while typing or with a modifier", () => {
  assert.equal(reviewKeyAction({ key: "v", typing: false }), "validate");
  assert.equal(reviewKeyAction({ key: "C", typing: false }), "clarify");
  assert.equal(reviewKeyAction({ key: "ArrowRight", typing: false }), "next");
  assert.equal(reviewKeyAction({ key: "ArrowLeft", typing: false }), "prev");
  assert.equal(reviewKeyAction({ key: "v", typing: true }), null);
  assert.equal(reviewKeyAction({ key: "v", metaKey: true, typing: false }), null);
  assert.equal(reviewKeyAction({ key: "x", typing: false }), null);
});

test("the four eyes in words: the answers of the viewer go to a colleague", () => {
  assert.equal(mineExcludedText(12, "elenco"), "12 risposte non sono qui perché le hai date tu: le verifica un collega.");
  assert.equal(mineExcludedText(1, "elenco"), "1 risposta non è qui perché l'hai data tu: la verifica un collega.");
  assert.equal(mineExcludedText(12, "fine"), "12 risposte le hai date tu: le verifica un collega.");
  assert.equal(mineExcludedText(0, "fine"), null);
});
