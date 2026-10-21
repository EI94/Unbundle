import test from "node:test";
import assert from "node:assert/strict";
import {
  USE_CASE_HUB_EXCLUDE_ENV,
  USE_CASE_HUB_WORKSPACES_ENV,
  hubRollout,
  hubWorkspaceIds,
  hubWorkspacesAmong,
  isUseCaseHubWorkspace,
  hubOnForEveryWorkspace,
} from "./rollout.ts";

// UUID inventati per la prova.
const A = "0b6f6c1e-3d2a-4c55-9a51-1f3e2d4c5b6a";
const B = "7d9e8f10-2a3b-4c4d-8e5f-6a7b8c9d0e1f";
const C = "c0ffee00-1234-4abc-9def-0123456789ab";

const env = (value: string | undefined, exclude?: string) => ({ [USE_CASE_HUB_WORKSPACES_ENV]: value, [USE_CASE_HUB_EXCLUDE_ENV]: exclude });

test("le variabili si chiamano USE_CASE_HUB_WORKSPACES e USE_CASE_HUB_EXCLUDE", () => {
  assert.equal(USE_CASE_HUB_WORKSPACES_ENV, "USE_CASE_HUB_WORKSPACES");
  assert.equal(USE_CASE_HUB_EXCLUDE_ENV, "USE_CASE_HUB_EXCLUDE");
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

test("«*»: area accesa per ogni workspace, anche quelli che nasceranno", () => {
  for (const value of ["*", " * ", "*,", `*,${B}`, `${B}, *`]) {
    for (const id of [A, B, C, C.toUpperCase()]) assert.equal(isUseCaseHubWorkspace(id, env(value)), true, `${value} ${id}`);
    assert.equal(hubOnForEveryWorkspace(env(value)), true, value);
  }
  // L'elenco esplicito non elenca nessuno con «*» da solo: si enumerano i workspace che esistono.
  assert.equal(hubWorkspaceIds(env("*")).size, 0);
  assert.deepEqual(hubWorkspacesAmong([A, B.toUpperCase(), A], env("*")), [A, B]);
  // Un id non valido resta spento anche con «*».
  for (const id of [null, undefined, "", "*", "not-a-uuid", `${A}x`]) assert.equal(isUseCaseHubWorkspace(id, env("*")), false, String(id));
});

test("solo l'asterisco vale «tutti»: altre parole non accendono nulla", () => {
  for (const value of ["all", "true", "**", "*x", "tutti"]) {
    assert.equal(isUseCaseHubWorkspace(A, env(value)), false, value);
    assert.equal(hubOnForEveryWorkspace(env(value)), false, value);
  }
  assert.equal(hubOnForEveryWorkspace(env(`${A},${B}`)), false);
  assert.equal(hubOnForEveryWorkspace({}), false);
});

test("USE_CASE_HUB_EXCLUDE spegne quei workspace anche con «*», e anche dall'elenco", () => {
  const star = env("*", ` ${B.toUpperCase()} , not-a-uuid`);
  assert.equal(isUseCaseHubWorkspace(A, star), true);
  assert.equal(isUseCaseHubWorkspace(B, star), false);
  assert.equal(isUseCaseHubWorkspace(C, star), true);
  assert.deepEqual(hubWorkspacesAmong([A, B, C], star), [A, C]);
  assert.deepEqual([...hubRollout(star).excluded], [B]);

  const list = env(`${A},${B}`, B);
  assert.equal(isUseCaseHubWorkspace(A, list), true);
  assert.equal(isUseCaseHubWorkspace(B, list), false);
  assert.deepEqual([...hubWorkspaceIds(list)], [A]);
  // Un «*» negli esclusi non spegne tutto: per spegnere tutto si svuota l'elenco.
  assert.equal(isUseCaseHubWorkspace(A, env("*", "*")), true);
  // Senza esclusi l'elenco esplicito è quello di sempre.
  assert.deepEqual(hubRollout(env(`${A},${B}`)), { all: false, ids: new Set([A, B]), excluded: new Set() });
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
  const beforeExclude = process.env[USE_CASE_HUB_EXCLUDE_ENV];
  try {
    delete process.env[USE_CASE_HUB_EXCLUDE_ENV];
    process.env[USE_CASE_HUB_WORKSPACES_ENV] = A;
    assert.equal(isUseCaseHubWorkspace(A), true);
    assert.equal(isUseCaseHubWorkspace(B), false);
    process.env[USE_CASE_HUB_WORKSPACES_ENV] = "*";
    process.env[USE_CASE_HUB_EXCLUDE_ENV] = A;
    assert.equal(isUseCaseHubWorkspace(A), false);
    assert.equal(isUseCaseHubWorkspace(B), true);
    delete process.env[USE_CASE_HUB_WORKSPACES_ENV];
    assert.equal(isUseCaseHubWorkspace(B), false);
  } finally {
    if (before === undefined) delete process.env[USE_CASE_HUB_WORKSPACES_ENV];
    else process.env[USE_CASE_HUB_WORKSPACES_ENV] = before;
    if (beforeExclude === undefined) delete process.env[USE_CASE_HUB_EXCLUDE_ENV];
    else process.env[USE_CASE_HUB_EXCLUDE_ENV] = beforeExclude;
  }
});

test("uc-doctor legge l'interruttore con le stesse regole dell'app (src/lib/uc/platform.ts)", async () => {
  const { hubAreaOn, parseHubWorkspaceList, parsePlainUuidList } = await import("../uc/platform.ts");
  const samples: Array<[string | undefined, string | undefined]> = [
    [undefined, undefined],
    ["", A],
    ["*", undefined],
    [" * ", `${B}, x`],
    [`*,${A}`, A.toUpperCase()],
    [`${A}, ${B.toUpperCase()}`, undefined],
    [`${A},${B}`, B],
    ["all", undefined],
    [`${A}x,{${B}}`, undefined],
    [A, "*"],
  ];
  for (const [list, exclude] of samples) {
    for (const id of [A, B, C]) {
      assert.equal(
        hubAreaOn(id, parseHubWorkspaceList(list), parsePlainUuidList(exclude)),
        isUseCaseHubWorkspace(id, env(list, exclude)),
        `${list} / ${exclude} / ${id}`,
      );
    }
  }
});
