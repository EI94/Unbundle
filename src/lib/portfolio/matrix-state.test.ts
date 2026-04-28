import test from "node:test";
import assert from "node:assert/strict";
import { reconcileScoreOverridesWithServerItems } from "./matrix-state.ts";

test("rimuove override stale quando il server torna con dati piu recenti", () => {
  const previous = {
    uc_1: { updatedAt: "2026-04-28T08:00:00.000Z", overallScore: 5 },
  };
  const next = reconcileScoreOverridesWithServerItems(previous, [
    { id: "uc_1", updatedAt: "2026-04-28T08:01:00.000Z" },
  ]);

  assert.deepEqual(next, {});
});

test("mantiene override ottimistico finche il server non ha raggiunto quel save", () => {
  const previous = {
    uc_1: { updatedAt: "2026-04-28T08:02:00.000Z", overallScore: 5 },
  };
  const next = reconcileScoreOverridesWithServerItems(previous, [
    { id: "uc_1", updatedAt: "2026-04-28T08:01:00.000Z" },
  ]);

  assert.equal(next, previous);
});

test("non tocca override senza timestamp finche non arriva un save tracciabile", () => {
  const previous = {
    uc_1: { overallScore: 5 },
  };
  const next = reconcileScoreOverridesWithServerItems(previous, [
    { id: "uc_1", updatedAt: "2026-04-28T08:01:00.000Z" },
  ]);

  assert.equal(next, previous);
});
