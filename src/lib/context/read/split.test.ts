import test from "node:test";
import assert from "node:assert/strict";
import { CONTEXT_LIMITS } from "../vocab.ts";
import { partsFor, splitForReading } from "./split.ts";

// Appunti lunghi (RILASCIO-9a-COSTRUZIONE.md §4.2): parti da al massimo 100.000 caratteri, al massimo 3.

const line = (i: number) => `Riga ${String(i).padStart(6, "0")} degli appunti, con qualche parola in più per farla lunga.\n`;
function textOf(length: number): string {
  let out = "";
  for (let i = 0; out.length < length; i++) out += line(i);
  return out.slice(0, length);
}

test("fino a 100.000 caratteri: una parte, il testo com'è", () => {
  for (const length of [0, 20, 99_999, 100_000]) {
    const text = textOf(length);
    assert.deepEqual(splitForReading(text), [text], String(length));
    assert.equal(partsFor(length), 1);
  }
});

test("250.000 caratteri: tre parti che unite ridanno il testo, ognuna entro il limite, tagliate a un a capo", () => {
  const text = textOf(250_000);
  const parts = splitForReading(text);
  assert.equal(parts.length, 3);
  assert.equal(partsFor(250_000), 3);
  assert.equal(parts.join(""), text, "niente si taglia in silenzio");
  for (const part of parts) assert.ok(part.length > 0 && part.length <= CONTEXT_LIMITS.partChars, String(part.length));
  assert.ok(parts[0].endsWith("\n") && parts[1].endsWith("\n"), "il taglio è a un a capo");
  assert.ok(parts[0].length > 90_000, "la prima parte si riempie fin dove c'è un a capo");
});

test("300.000 caratteri, il massimo di un appunto: tre parti lo coprono sempre", () => {
  for (const text of [textOf(300_000), "x".repeat(300_000), `${"y".repeat(150_000)}\n${"z".repeat(149_999)}`]) {
    const parts = splitForReading(text);
    assert.equal(parts.length, 3);
    assert.equal(parts.join(""), text);
    for (const part of parts) assert.ok(part.length > 0 && part.length <= CONTEXT_LIMITS.partChars, String(part.length));
  }
});

test("poco oltre il limite: due parti; senza a capo si taglia a un punto, altrimenti al limite", () => {
  const text = textOf(100_001);
  const parts = splitForReading(text);
  assert.equal(parts.length, 2);
  assert.equal(parts.join(""), text);
  assert.ok(parts[0].endsWith("\n"));
  const sentences = "Una frase senza a capo. ".repeat(6_000); // 144.000 caratteri
  const bySentence = splitForReading(sentences);
  assert.equal(bySentence.length, 2);
  assert.equal(bySentence.join(""), sentences);
  assert.ok(bySentence[0].endsWith(". "), "il taglio è dopo un punto");
  const solid = "a".repeat(150_000);
  const hard = splitForReading(solid);
  assert.deepEqual(hard.map((p) => p.length), [100_000, 50_000]);
  // Mai a metà di un carattere di due unità.
  const emoji = `${"a".repeat(99_999)}😀${"b".repeat(50_000)}`;
  const safe = splitForReading(emoji);
  assert.equal(safe.join(""), emoji);
  assert.equal(safe[0].length, 99_999);
});
