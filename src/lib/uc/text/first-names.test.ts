import test from "node:test";
import assert from "node:assert/strict";
import { FIRST_NAMES, HONORIFICS, NOT_SURNAMES, PLACE_PREFIXES, PUBLIC_NAME_PAIRS, isFirstName } from "./first-names.ts";

test("about 400 generic first names, folded and without duplicates", () => {
  assert.ok(FIRST_NAMES.size >= 380 && FIRST_NAMES.size <= 450, `found ${FIRST_NAMES.size}`);
  for (const n of FIRST_NAMES) assert.match(n, /^[a-z]{2,}$/, n);
  assert.ok(isFirstName("mario") && isFirstName("giulia") && !isFirstName("Mario"));
});

test("names that are mostly common words or places are excluded", () => {
  const ambiguous = [
    "rosa",
    "franco",
    "bianca",
    "stella",
    "viola",
    "vera",
    "sole",
    "fiore",
    "gemma",
    "luce",
    "gioia",
    "speranza",
    "felice",
    "fortunato",
    "natale",
    "domenica",
    "assunta",
    "immacolata",
    "alba",
    "aurora",
    "asia",
    "sofia",
    "ginevra",
    "emilia",
    "vittoria",
    "virginia",
    "marino",
    "romano",
    "santo",
    "leone",
    "celeste",
    "pace",
    "amato",
    "benvenuto",
    "franca",
    "romeo",
    "oscar",
  ];
  for (const n of ambiguous) assert.ok(!FIRST_NAMES.has(n), n);
});

test("support lists are folded lowercase", () => {
  for (const set of [NOT_SURNAMES, PLACE_PREFIXES, HONORIFICS]) {
    for (const w of set) assert.match(w, /^[a-z]+$/, w);
  }
  for (const pair of PUBLIC_NAME_PAIRS) {
    assert.match(pair, /^[a-z]+ [a-z]+$/, pair);
    assert.ok(FIRST_NAMES.has(pair.split(" ")[0]), pair);
  }
});
