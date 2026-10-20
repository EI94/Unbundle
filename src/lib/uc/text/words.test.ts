import test from "node:test";
import assert from "node:assert/strict";
import { anyAround, foldSameLength, isAllCaps, isTitleCase, onlySpacesBetween, prepareText, rawWord, wordIndexAt } from "./words.ts";

test("foldSameLength lowercases and removes accents without changing the length", () => {
  for (const s of ["Città PIÙ È", "Nicolò", "İstanbul", "Straße", "😀 ok É", "ﬁne", "é"]) {
    const folded = foldSameLength(s);
    assert.equal(folded.length, s.length, s);
  }
  assert.equal(foldSameLength("Città PIÙ È"), "citta piu e");
  assert.equal(foldSameLength("ABC def"), "abc def");
});

test("prepareText splits words on punctuation and apostrophes, with offsets in the NFC text", () => {
  const t = prepareText("Dell'aereo, VISITA medica-2026 é");
  assert.deepEqual(t.norms, ["dell", "aereo", "visita", "medica", "2026", "e"]);
  assert.equal(rawWord(t, 2), "VISITA");
  assert.equal(t.text.slice(t.starts[5], t.ends[5]), "é");
  assert.equal(t.folded.length, t.text.length);
});

test("wordIndexAt finds the word at or after an offset", () => {
  const t = prepareText("uno due tre");
  assert.equal(wordIndexAt(t, 0), 0);
  assert.equal(wordIndexAt(t, 3), 1);
  assert.equal(wordIndexAt(t, 5), 1);
  assert.equal(wordIndexAt(t, 100), 3);
});

test("case helpers", () => {
  assert.ok(isTitleCase("Mario") && isTitleCase("Èlia"));
  assert.ok(!isTitleCase("mario") && !isTitleCase("MARIO") && !isTitleCase("M"));
  assert.ok(isAllCaps("ROSSI") && !isAllCaps("Rossi") && !isAllCaps("R"));
});

test("neighbours and spacing", () => {
  const t = prepareText("a b,  c\nd");
  assert.ok(onlySpacesBetween(t, 0, 1));
  assert.ok(!onlySpacesBetween(t, 1, 2));
  assert.ok(!onlySpacesBetween(t, 2, 3));
  assert.ok(anyAround(t, 0, 2, (j) => t.norms[j] === "c"));
  assert.ok(!anyAround(t, 0, 1, (j) => t.norms[j] === "c"));
  assert.ok(!anyAround(t, 0, 5, (j) => j === 0), "the word itself is excluded");
});
