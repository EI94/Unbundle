import test from "node:test";
import assert from "node:assert/strict";
import { definitionHash, sha256Hex, stableStringify, stableValue } from "./hash.ts";

test("key order never changes the text, array order does", () => {
  const a = { b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } };
  const b = { a: { c: null, d: [3, { x: 2, y: 1 }] }, b: 1 };
  assert.equal(stableStringify(a), stableStringify(b));
  assert.equal(stableStringify(a), '{"a":{"c":null,"d":[3,{"x":2,"y":1}]},"b":1}');
  assert.notEqual(stableStringify({ l: [1, 2] }), stableStringify({ l: [2, 1] }));
});

test("undefined properties are dropped like JSON.stringify, undefined in arrays becomes null", () => {
  assert.equal(stableStringify({ a: undefined, b: 1 }), '{"b":1}');
  assert.equal(stableStringify([undefined, 1]), "[null,1]");
  assert.deepEqual(stableValue("x"), "x");
});

test("keys sort by code unit, independent of the locale", () => {
  assert.equal(stableStringify({ b: 1, B: 2, a: 3, é: 4 }), '{"B":2,"a":3,"b":1,"é":4}');
});

test("definition hash is sha256 hex of the stable text", () => {
  const def = { schema: "unbundle.uc-template/1", key: "esempio.x", items: [{ key: "ent.a" }] };
  const hash = definitionHash(def);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.equal(hash, sha256Hex(stableStringify(def)));
  assert.equal(hash, definitionHash({ items: [{ key: "ent.a" }], key: "esempio.x", schema: "unbundle.uc-template/1" }));
  assert.notEqual(hash, definitionHash({ ...def, key: "esempio.y" }));
});
