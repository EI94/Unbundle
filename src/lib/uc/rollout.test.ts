import test from "node:test";
import assert from "node:assert/strict";
import { isProductionEnv, isUcWorkspaceEnabled, parseUcWorkspaceIds } from "./rollout.ts";

const A = "0f8e2a64-1b7c-4d3e-9a5f-6c2b1d0e9f8a";
const B = "7c1d9e2f-3a4b-4c5d-8e6f-0a1b2c3d4e5f";

test("empty or missing list: the section is off, in production and outside", () => {
  for (const VERCEL_ENV of ["production", "preview", "development", undefined]) {
    assert.equal(isUcWorkspaceEnabled(A, { VERCEL_ENV }), false, `missing, ${VERCEL_ENV}`);
    assert.equal(isUcWorkspaceEnabled(A, { UC_WORKSPACE_IDS: "", VERCEL_ENV }), false, `empty, ${VERCEL_ENV}`);
    assert.equal(isUcWorkspaceEnabled(A, { UC_WORKSPACE_IDS: " , \n ", VERCEL_ENV }), false, `blank, ${VERCEL_ENV}`);
  }
});

test("listed workspaces only, case-insensitive, any separator", () => {
  const env = { UC_WORKSPACE_IDS: `${A.toUpperCase()},  ${B}\n`, VERCEL_ENV: "production" };
  assert.equal(isUcWorkspaceEnabled(A, env), true);
  assert.equal(isUcWorkspaceEnabled(B.toUpperCase(), env), true);
  assert.equal(isUcWorkspaceEnabled("3a2b1c0d-9e8f-4a7b-8c6d-5e4f3a2b1c0d", env), false);
  assert.equal(isUcWorkspaceEnabled(A, { UC_WORKSPACE_IDS: `${B} ${A}` }), true);
  assert.equal(isUcWorkspaceEnabled(A, { UC_WORKSPACE_IDS: `${B};${A}` }), true);
});

test("«*» is accepted only outside production", () => {
  assert.equal(isUcWorkspaceEnabled(A, { UC_WORKSPACE_IDS: "*" }), true, "local and harness");
  assert.equal(isUcWorkspaceEnabled(A, { UC_WORKSPACE_IDS: "*", VERCEL_ENV: "preview" }), true);
  assert.equal(isUcWorkspaceEnabled(A, { UC_WORKSPACE_IDS: "*", VERCEL_ENV: "development" }), true);
  assert.equal(isUcWorkspaceEnabled(A, { UC_WORKSPACE_IDS: "*", VERCEL_ENV: "production" }), false);
  // In production the explicit entries still count next to an ignored «*».
  assert.equal(isUcWorkspaceEnabled(A, { UC_WORKSPACE_IDS: `*, ${A}`, VERCEL_ENV: "production" }), true);
  assert.equal(isUcWorkspaceEnabled(B, { UC_WORKSPACE_IDS: `*, ${A}`, VERCEL_ENV: "production" }), false);
});

test("invalid entries and invalid workspace ids are ignored", () => {
  const list = parseUcWorkspaceIds(`${A}, non-un-uuid, 123, ${A}`);
  assert.deepEqual([...list.ids], [A]);
  assert.deepEqual(list.ignored, ["non-un-uuid", "123"]);
  assert.equal(list.wildcard, false);
  assert.equal(isUcWorkspaceEnabled("non-un-uuid", { UC_WORKSPACE_IDS: "non-un-uuid" }), false);
  assert.equal(isUcWorkspaceEnabled("", { UC_WORKSPACE_IDS: "*" }), false);
  assert.equal(isUcWorkspaceEnabled(null, { UC_WORKSPACE_IDS: "*" }), false);
  assert.equal(isUcWorkspaceEnabled(undefined, { UC_WORKSPACE_IDS: A }), false);
});

test("production means the Vercel production deploy only", () => {
  assert.equal(isProductionEnv({ VERCEL_ENV: "production" }), true);
  assert.equal(isProductionEnv({ VERCEL_ENV: "preview" }), false);
  assert.equal(isProductionEnv({}), false);
});
