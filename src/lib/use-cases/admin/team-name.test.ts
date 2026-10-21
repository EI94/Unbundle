import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_REVIEW_TEAM_NAME } from "../../review-team.ts";
import { LEGACY_TEAM_NAME, isLegacyTeamName, teamNamesSql } from "./team-name.ts";

// use-case-admin team-name (docs/use-case/DESIGN.md §10.5 e §14.2).

test("collide solo «AI Transformation», senza distinguere maiuscole e spazi", () => {
  for (const name of [LEGACY_TEAM_NAME, "ai transformation", "  AI  TRANSFORMATION ", "Ai\tTransformation"]) {
    assert.equal(isLegacyTeamName(name), true, JSON.stringify(name));
  }
  for (const name of ["AI Transformation Team", "AI-Transformation", "CoE AI", "", null, undefined, 42, DEFAULT_REVIEW_TEAM_NAME]) {
    assert.equal(isLegacyTeamName(name), false, JSON.stringify(name));
  }
});

test("il nome predefinito del team non è quello che collide", () => {
  assert.notEqual(DEFAULT_REVIEW_TEAM_NAME.toLowerCase(), LEGACY_TEAM_NAME.toLowerCase());
});

test("la lettura non scrive e filtra l'ambito", () => {
  assert.match(teamNamesSql(false), /^SELECT /);
  assert.doesNotMatch(teamNamesSql(false), /\$1|UPDATE|INSERT|DELETE/);
  assert.match(teamNamesSql(true), /AND w\.id = \$1::uuid/);
});
