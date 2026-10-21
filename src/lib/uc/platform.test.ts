import test from "node:test";
import assert from "node:assert/strict";
import {
  cronWorkspaceFilter,
  hubAreaOn,
  parseHubWorkspaceList,
  parsePlainUuidList,
  rolloutEnv,
  ucCronWorkspaceScope,
  ucOnForEveryWorkspace,
  ucSelfHealEnabled,
} from "./platform.ts";

const A = "0f8e2a64-1b7c-4d3e-9a5f-6c2b1d0e9f8a";
const B = "7c1d9e2f-3a4b-4c5d-8e6f-0a1b2c3d4e5f";

test("the uc self-heal is on outside production unless UC_SCHEMA_SELF_HEAL says off", () => {
  assert.equal(ucSelfHealEnabled({}), true);
  assert.equal(ucSelfHealEnabled({ UC_SCHEMA_SELF_HEAL: "" }), true);
  assert.equal(ucSelfHealEnabled({ UC_SCHEMA_SELF_HEAL: "on" }), true);
  assert.equal(ucSelfHealEnabled({ VERCEL_ENV: "preview" }), true);
  for (const off of ["off", "OFF", " off ", "false", "0", "no"]) assert.equal(ucSelfHealEnabled({ UC_SCHEMA_SELF_HEAL: off }), false, off);
});

test("in production the uc self-heal is off unless UC_SCHEMA_SELF_HEAL says on", () => {
  const prod = { VERCEL_ENV: "production" };
  assert.equal(ucSelfHealEnabled(prod), false, "a forgotten variable never runs the uc DDL from a request");
  assert.equal(ucSelfHealEnabled({ ...prod, UC_SCHEMA_SELF_HEAL: "" }), false);
  assert.equal(ucSelfHealEnabled({ ...prod, UC_SCHEMA_SELF_HEAL: "maybe" }), false);
  assert.equal(ucSelfHealEnabled({ ...prod, UC_SCHEMA_SELF_HEAL: "off" }), false);
  for (const on of ["on", "ON", " true ", "1", "yes"]) assert.equal(ucSelfHealEnabled({ ...prod, UC_SCHEMA_SELF_HEAL: on }), true, on);
});

test("crons run on the same workspaces as the pages", () => {
  assert.deepEqual(ucCronWorkspaceScope({}), { kind: "elenco", ids: [] });
  assert.deepEqual(ucCronWorkspaceScope({ UC_WORKSPACE_IDS: "", VERCEL_ENV: "production" }), { kind: "elenco", ids: [] });
  assert.deepEqual(ucCronWorkspaceScope({ UC_WORKSPACE_IDS: `${B}, ${A.toUpperCase()}, nonsense` }), { kind: "elenco", ids: [A, B] });
  assert.deepEqual(ucCronWorkspaceScope({ UC_WORKSPACE_IDS: "*" }), { kind: "tutti" });
  assert.deepEqual(ucCronWorkspaceScope({ UC_WORKSPACE_IDS: "*", VERCEL_ENV: "preview" }), { kind: "tutti" });
  // In production «*» does not count: only the explicit entries.
  assert.deepEqual(ucCronWorkspaceScope({ UC_WORKSPACE_IDS: "*", VERCEL_ENV: "production" }), { kind: "elenco", ids: [] });
  assert.deepEqual(ucCronWorkspaceScope({ UC_WORKSPACE_IDS: `*, ${A}`, VERCEL_ENV: "production" }), { kind: "elenco", ids: [A] });
  assert.equal(cronWorkspaceFilter({ kind: "tutti" }), null);
  assert.deepEqual(cronWorkspaceFilter({ kind: "elenco", ids: [A] }), [A]);
  assert.deepEqual(cronWorkspaceFilter({ kind: "elenco", ids: [] }), []);
});

test("without a workspace the section counts as on only with «*» outside production", () => {
  assert.equal(ucOnForEveryWorkspace({}), false);
  assert.equal(ucOnForEveryWorkspace({ UC_WORKSPACE_IDS: A }), false);
  assert.equal(ucOnForEveryWorkspace({ UC_WORKSPACE_IDS: "*" }), true);
  assert.equal(ucOnForEveryWorkspace({ UC_WORKSPACE_IDS: `${A}, *`, VERCEL_ENV: "preview" }), true);
  assert.equal(ucOnForEveryWorkspace({ UC_WORKSPACE_IDS: "*", VERCEL_ENV: "production" }), false);
});

test("USE_CASE_HUB_EXCLUDE is read as a plain comma-separated uuid list, no wildcard", () => {
  assert.deepEqual(parsePlainUuidList(undefined), { ids: [], ignored: [] });
  assert.deepEqual(parsePlainUuidList(" , "), { ids: [], ignored: [] });
  assert.deepEqual(parsePlainUuidList(`${A.toUpperCase()}, ${B},${A}`), { ids: [A, B], ignored: [] });
  assert.deepEqual(parsePlainUuidList(`*, ${A}, non-un-id`), { ids: [A], ignored: ["*", "non-un-id"] });
  // Spaces are not separators: two ids glued by a space are one bad entry.
  assert.deepEqual(parsePlainUuidList(`${A} ${B}`), { ids: [], ignored: [`${A} ${B}`] });
});

test("USE_CASE_HUB_WORKSPACES: «*» means every workspace, otherwise a plain uuid list; the exclude list wins", () => {
  assert.deepEqual(parseHubWorkspaceList(undefined), { wildcard: false, ids: [], ignored: [] });
  assert.deepEqual(parseHubWorkspaceList(" * "), { wildcard: true, ids: [], ignored: [] });
  assert.deepEqual(parseHubWorkspaceList(`*, ${A.toUpperCase()}, all`), { wildcard: true, ids: [A], ignored: ["all"] });
  assert.deepEqual(parseHubWorkspaceList(`${A},${B}`), { wildcard: false, ids: [A, B], ignored: [] });
  const none = parsePlainUuidList("");
  assert.equal(hubAreaOn(A, parseHubWorkspaceList("*"), none), true);
  assert.equal(hubAreaOn(A, parseHubWorkspaceList("*"), parsePlainUuidList(A.toUpperCase())), false);
  assert.equal(hubAreaOn(B, parseHubWorkspaceList(A), none), false);
  assert.equal(hubAreaOn(A, parseHubWorkspaceList(A), parsePlainUuidList("*")), true, "«*» never excludes everyone");
});

test("rolloutEnv keeps only the two switch variables", () => {
  assert.deepEqual(rolloutEnv({ UC_WORKSPACE_IDS: A, VERCEL_ENV: "production", UC_SECRET: "x" }), { UC_WORKSPACE_IDS: A, VERCEL_ENV: "production" });
});
