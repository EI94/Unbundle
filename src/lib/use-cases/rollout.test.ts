import test from "node:test";
import assert from "node:assert/strict";
import { isUseCaseHubWorkspace, USE_CASE_HUB_WORKSPACES_ENV, hubWorkspaceIds } from "./rollout.ts";

// UUID inventati per la prova.
const A = "0b6f6c1e-3d2a-4c55-9a51-1f3e2d4c5b6a";
const B = "7d9e8f10-2a3b-4c4d-8e5f-6a7b8c9d0e1f";
const C = "c0ffee00-1234-4abc-9def-0123456789ab";

const env = (value: string | undefined) => ({ [USE_CASE_HUB_WORKSPACES_ENV]: value });

test("la variabile si chiama USE_CASE_HUB_WORKSPACES", () => {
  assert.equal(USE_CASE_HUB_WORKSPACES_ENV, "USE_CASE_HUB_WORKSPACES");
});

test("vuota o assente: area spenta ovunque", () => {
  for (const value of [undefined, "", " ", ",", " , ,"]) {
    assert.equal(isUseCaseHubWorkspace(A, env(value)), false, JSON.stringify(value));
    assert.equal(hubWorkspaceIds(env(value)).size, 0, JSON.stringify(value));
  }
  assert.equal(isUseCaseHubWorkspace(A, {}), false);
});

test("accesa solo per i workspace dell'elenco", () => {
  const list = env(`${A},${B}`);
  assert.equal(isUseCaseHubWorkspace(A, list), true);
  assert.equal(isUseCaseHubWorkspace(B, list), true);
  assert.equal(isUseCaseHubWorkspace(C, list), false);
});

test("spazi intorno alle voci e maiuscole non contano", () => {
  const list = env(`  ${A.toUpperCase()} ,\n${B}  `);
  assert.equal(isUseCaseHubWorkspace(A, list), true);
  assert.equal(isUseCaseHubWorkspace(B.toUpperCase(), list), true);
  assert.equal(isUseCaseHubWorkspace(` ${B} `, list), true);
  assert.deepEqual([...hubWorkspaceIds(list)].sort(), [A, B].sort());
});

test("niente *: un asterisco non accende nessun workspace", () => {
  for (const value of ["*", " * ", "*,", `*,${B}`, "all", "true"]) {
    assert.equal(isUseCaseHubWorkspace(A, env(value)), false, value);
  }
  assert.equal(isUseCaseHubWorkspace(B, env(`*,${B}`)), true);
});

test("le voci che non sono UUID validi si ignorano, le altre restano", () => {
  const list = env(`not-a-uuid,${A}x,${A.slice(0, -1)},{${B}},${C}`);
  assert.deepEqual([...hubWorkspaceIds(list)], [C]);
  assert.equal(isUseCaseHubWorkspace(A, list), false);
  assert.equal(isUseCaseHubWorkspace(B, list), false);
  assert.equal(isUseCaseHubWorkspace(C, list), true);
});

test("un id di workspace non valido non è mai acceso", () => {
  const list = env(`${A},${B}`);
  for (const id of [null, undefined, "", "*", "not-a-uuid", `${A},${B}`, `${A}x`]) {
    assert.equal(isUseCaseHubWorkspace(id, list), false, String(id));
  }
});

test("senza parametro legge process.env", () => {
  const before = process.env[USE_CASE_HUB_WORKSPACES_ENV];
  try {
    process.env[USE_CASE_HUB_WORKSPACES_ENV] = A;
    assert.equal(isUseCaseHubWorkspace(A), true);
    assert.equal(isUseCaseHubWorkspace(B), false);
    delete process.env[USE_CASE_HUB_WORKSPACES_ENV];
    assert.equal(isUseCaseHubWorkspace(A), false);
  } finally {
    if (before === undefined) delete process.env[USE_CASE_HUB_WORKSPACES_ENV];
    else process.env[USE_CASE_HUB_WORKSPACES_ENV] = before;
  }
});
