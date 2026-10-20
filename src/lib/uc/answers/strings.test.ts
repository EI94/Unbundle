import test from "node:test";
import assert from "node:assert/strict";
import { cleanText, collapseSpaces, deaccent, foldKey, isPlainObject, nonEmptyString, sameLabel, utf8Length } from "./strings.ts";

test("cleanText normalizes to NFC, removes zero-width characters and odd spaces", () => {
  assert.equal(cleanText("  é​  x  "), "é  x");
  assert.equal(cleanText("﻿1 200"), "1 200");
  assert.equal(cleanText("riga\nriga"), "riga\nriga");
});

test("collapseSpaces keeps one space between words, newlines included", () => {
  assert.equal(collapseSpaces("  Mai   due\n\nconsegne\tal giorno "), "Mai due consegne al giorno");
});

test("deaccent and foldKey compare labels without accents, case and punctuation", () => {
  assert.equal(deaccent("Città più è"), "Citta piu e");
  assert.equal(foldKey("Città d'arrivo"), "citta_d_arrivo");
  assert.equal(foldKey("  Costo orario (€) "), "costo_orario");
  assert.equal(foldKey("---"), "");
  assert.ok(sameLabel("Città d'arrivo", "citta-d-ARRIVO"));
  assert.ok(!sameLabel("", ""));
});

test("nonEmptyString and isPlainObject", () => {
  assert.equal(nonEmptyString("  a "), "a");
  assert.equal(nonEmptyString("   "), null);
  assert.equal(nonEmptyString(3), null);
  assert.ok(isPlainObject({}));
  assert.ok(!isPlainObject([]));
  assert.ok(!isPlainObject(null));
  assert.ok(!isPlainObject(new Date(0)));
  assert.ok(!isPlainObject(new Map()));
  assert.ok(isPlainObject(Object.create(null)));
  assert.ok(isPlainObject(JSON.parse('{"a":1}')));
});

test("utf8Length matches Buffer.byteLength", () => {
  for (const s of ["", "abc", "€ 1.200", "città", "😀 ok", "日本"]) {
    assert.equal(utf8Length(s), Buffer.byteLength(s, "utf8"), s);
  }
});
