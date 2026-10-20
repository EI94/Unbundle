import test from "node:test";
import assert from "node:assert/strict";
import { failed, issue, parsed, withField } from "./issues.ts";

test("issue omits the field when it is not given", () => {
  assert.deepEqual(issue("x", "Messaggio."), { code: "x", message: "Messaggio." });
  assert.deepEqual(issue("x", "Messaggio.", "amount"), { field: "amount", code: "x", message: "Messaggio." });
});

test("withField prefixes nested fields and fills missing ones", () => {
  const out = withField([issue("a", "A", "unit"), issue("b", "B")], "from");
  assert.deepEqual(
    out.map((i) => i.field),
    ["from.unit", "from"],
  );
});

test("parsed and failed build the two shapes with warnings", () => {
  const w = [issue("w", "W")];
  assert.deepEqual(parsed(3, w), { ok: true, value: 3, warnings: w });
  assert.deepEqual(failed(issue("e", "E")), { ok: false, errors: [issue("e", "E")], warnings: [] });
  assert.deepEqual(failed([issue("e", "E"), issue("f", "F")], w).ok, false);
});
