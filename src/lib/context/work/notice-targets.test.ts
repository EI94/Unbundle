import test from "node:test";
import assert from "node:assert/strict";
import { editNoticeTargets } from "./notice-targets.ts";

// «Il contesto è cambiato» dopo «Modifica» (RILASCIO-9b-COSTRUZIONE.md §2.8): solo gli use case la cui vista cambia.
const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

test("solo gli use case: quelli aggiunti e quelli tolti, non quelli che restano", () => {
  assert.deepEqual(editNoticeTargets({ before: { visibility: "tutti", useCaseIds: [B] }, after: { visibility: "tutti", useCaseIds: [B, A] }, textChanged: false }), [{ useCaseId: A, shared: true }]);
  assert.deepEqual(editNoticeTargets({ before: { visibility: "tutti", useCaseIds: [A, B] }, after: { visibility: "tutti", useCaseIds: [A] }, textChanged: false }), [{ useCaseId: B, shared: true }]);
  assert.deepEqual(editNoticeTargets({ before: { visibility: "tutti", useCaseIds: [A, B] }, after: { visibility: "tutti", useCaseIds: [B, C] }, textChanged: false }), [
    { useCaseId: C, shared: true },
    { useCaseId: A, shared: true },
  ]);
  assert.deepEqual(editNoticeTargets({ before: { visibility: "tutti", useCaseIds: [A] }, after: { visibility: "tutti", useCaseIds: [A] }, textChanged: false }), [], "niente di cambiato, o solo la sezione");
});

test("testo o visibilità cambiati: tutti gli use case, quelli di prima e quelli di adesso", () => {
  assert.deepEqual(editNoticeTargets({ before: { visibility: "tutti", useCaseIds: [A, B] }, after: { visibility: "tutti", useCaseIds: [A, B] }, textChanged: true }), [
    { useCaseId: A, shared: true },
    { useCaseId: B, shared: true },
  ]);
  assert.deepEqual(editNoticeTargets({ before: { visibility: "tutti", useCaseIds: [A, B] }, after: { visibility: "tutti", useCaseIds: [A] }, textChanged: true }), [
    { useCaseId: A, shared: true },
    { useCaseId: B, shared: true },
  ]);
  // Un fatto «Per tutti» che diventa «Solo Lateral Space»: chi costruisce da fuori lo perde, e lo sa (senza testo).
  assert.deepEqual(editNoticeTargets({ before: { visibility: "tutti", useCaseIds: [A] }, after: { visibility: "ls", useCaseIds: [A] }, textChanged: false }), [{ useCaseId: A, shared: true }]);
  // Allargato: anche chi costruisce da fuori.
  assert.deepEqual(editNoticeTargets({ before: { visibility: "ls", useCaseIds: [A] }, after: { visibility: "tutti", useCaseIds: [A] }, textChanged: false }), [{ useCaseId: A, shared: true }]);
});

test("un fatto «Solo Lateral Space» prima e dopo avvisa solo chi costruisce da Lateral Space; da fuori conta lo use case che lo vedeva o lo vede", () => {
  assert.deepEqual(editNoticeTargets({ before: { visibility: "ls", useCaseIds: [A] }, after: { visibility: "ls", useCaseIds: [A] }, textChanged: true }), [{ useCaseId: A, shared: false }]);
  assert.deepEqual(editNoticeTargets({ before: { visibility: "ls", useCaseIds: [A] }, after: { visibility: "ls", useCaseIds: [B] }, textChanged: false }), [
    { useCaseId: B, shared: false },
    { useCaseId: A, shared: false },
  ]);
  // Allargato e spostato insieme: lo use case nuovo lo vede «Per tutti», quello tolto non l'aveva mai visto da fuori.
  assert.deepEqual(editNoticeTargets({ before: { visibility: "ls", useCaseIds: [A] }, after: { visibility: "tutti", useCaseIds: [B] }, textChanged: false }), [
    { useCaseId: B, shared: true },
    { useCaseId: A, shared: false },
  ]);
  // Gli id si confrontano senza badare alle maiuscole, una volta sola.
  assert.deepEqual(editNoticeTargets({ before: { visibility: "tutti", useCaseIds: [A.toUpperCase()] }, after: { visibility: "tutti", useCaseIds: [A, A] }, textChanged: false }), []);
});
