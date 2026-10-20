import test from "node:test";
import assert from "node:assert/strict";
import { decodeWindows1252, windows1252Table } from "./charset.ts";

test("Windows-1252 maps 0x80-0x9F to the real characters", () => {
  assert.equal(decodeWindows1252(Uint8Array.of(0x80, 0x93, 0x94, 0x96, 0x97, 0x85)), "€“”–—…");
  assert.equal(decodeWindows1252(Uint8Array.of(0x63, 0x69, 0x74, 0x74, 0xe0)), "città");
  assert.equal(decodeWindows1252(new Uint8Array(0)), "");
});

test("unassigned bytes stay C1 controls and the table has 256 entries", () => {
  const table = windows1252Table();
  assert.equal(table.length, 256);
  for (const b of [0x81, 0x8d, 0x8f, 0x90, 0x9d]) assert.equal(table[b], String.fromCharCode(b));
  assert.equal(table[0x41], "A");
  assert.equal(table[0xff], "ÿ");
});

test("long inputs are decoded in chunks without losing bytes", () => {
  const bytes = new Uint8Array(20_000).fill(0x61);
  bytes[8191] = 0x80;
  bytes[8192] = 0xe8;
  const text = decodeWindows1252(bytes);
  assert.equal(text.length, 20_000);
  assert.equal(text[8191], "€");
  assert.equal(text[8192], "è");
});
