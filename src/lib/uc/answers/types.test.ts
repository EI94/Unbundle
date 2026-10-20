import test from "node:test";
import assert from "node:assert/strict";
import { TABLE_CELL_TYPES, outcome } from "./types.ts";

test("outcome fills normalized, errors and warnings with empty defaults", () => {
  assert.deepEqual(outcome({ value: 1 }), { value: 1, normalized: null, errors: [], warnings: [] });
  assert.deepEqual(outcome({ value: null, partial: true }).partial, true);
});

test("table cell types are unique stable codes", () => {
  assert.equal(new Set(TABLE_CELL_TYPES).size, TABLE_CELL_TYPES.length);
  for (const t of TABLE_CELL_TYPES) assert.match(t, /^[a-z_]+$/);
});
