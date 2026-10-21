import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REVIEW_TEAM_NAME, reviewTeamName } from "./review-team.ts";

// Il test confronta sempre con la costante, mai con il suo valore (DESIGN §14.2).

test("senza nome del workspace si usa il nome predefinito", () => {
  assert.equal(reviewTeamName(null), DEFAULT_REVIEW_TEAM_NAME);
  assert.equal(reviewTeamName(undefined), DEFAULT_REVIEW_TEAM_NAME);
  assert.equal(reviewTeamName({}), DEFAULT_REVIEW_TEAM_NAME);
  assert.equal(reviewTeamName({ aiTransformationTeamName: null }), DEFAULT_REVIEW_TEAM_NAME);
});

test("un nome vuoto o fatto solo di spazi vale come assente", () => {
  for (const blank of ["", " ", "   ", "\t", "\n", " \t\n "]) {
    assert.equal(reviewTeamName({ aiTransformationTeamName: blank }), DEFAULT_REVIEW_TEAM_NAME, JSON.stringify(blank));
  }
});

test("il nome scelto dal workspace vince, senza spazi ai lati", () => {
  assert.equal(reviewTeamName({ aiTransformationTeamName: "CoE AI" }), "CoE AI");
  assert.equal(reviewTeamName({ aiTransformationTeamName: "  Digital Factory  " }), "Digital Factory");
});

test("la costante è un nome vero, non vuoto e senza spazi ai lati", () => {
  assert.equal(typeof DEFAULT_REVIEW_TEAM_NAME, "string");
  assert.ok(DEFAULT_REVIEW_TEAM_NAME.length > 0);
  assert.equal(DEFAULT_REVIEW_TEAM_NAME, DEFAULT_REVIEW_TEAM_NAME.trim());
  // Né articolo né «team» davanti: i testi lo mettono da solo (DESIGN §14.2).
  assert.doesNotMatch(DEFAULT_REVIEW_TEAM_NAME, /^(il|lo|la|l'|i|gli|le|team)\s/i);
});
