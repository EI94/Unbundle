import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { sha256Hex } from "./sha256.ts";

const node = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

test("sha256Hex matches node:crypto, padding boundaries included", () => {
  const samples = ["", "abc", "Mai due consegne nello stesso giro", "città € 😀", "日本語"];
  for (let n = 50; n <= 130; n++) samples.push("x".repeat(n));
  samples.push("é".repeat(1000));
  for (const s of samples) assert.equal(sha256Hex(s), node(s), JSON.stringify(s.slice(0, 20)));
});

test("sha256Hex returns 64 lowercase hex characters", () => {
  assert.match(sha256Hex("qualsiasi"), /^[0-9a-f]{64}$/);
});
