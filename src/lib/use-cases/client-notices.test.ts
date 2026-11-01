import test from "node:test";
import assert from "node:assert/strict";
import { USE_CASE_CLIENT_NOTICES_ENV, clientNoticeWorkspaceIds, clientNoticesEnabled, readyNoticesEnabled } from "./client-notices.ts";

// L'interruttore degli avvisi alle persone del cliente: spento ovunque finché un UUID non è
// nell'elenco, e mai senza «Chiedi al referente». UUID inventati.
const A = "0b6f6c1e-3d2a-4c55-9a51-1f3e2d4c5b6a";
const B = "7d9e8f10-2a3b-4c4d-8e5f-6a7b8c9d0e1f";

const env = (notices: string | undefined, extra: Record<string, string | undefined> = {}) => ({
  USE_CASE_HUB_WORKSPACES: "*",
  [USE_CASE_CLIENT_NOTICES_ENV]: notices,
  ...extra,
});

test("la variabile si chiama USE_CASE_CLIENT_NOTICES", () => {
  assert.equal(USE_CASE_CLIENT_NOTICES_ENV, "USE_CASE_CLIENT_NOTICES");
});

test("assente o vuota: spenta per tutti", () => {
  for (const value of [undefined, "", " ", ",", " , "]) {
    assert.equal(clientNoticesEnabled(A, env(value)), false, JSON.stringify(value));
    assert.equal(clientNoticeWorkspaceIds(env(value)).size, 0);
  }
});

test("«*» non accende niente, di proposito", () => {
  assert.equal(clientNoticesEnabled(A, env("*")), false);
  assert.equal(clientNoticesEnabled(A, env(`*,${B}`)), false);
  assert.equal(clientNoticesEnabled(B, env(`*,${B}`)), true);
});

test("un elenco di UUID: solo quelli, maiuscole e spazi ammessi", () => {
  assert.equal(clientNoticesEnabled(A, env(A)), true);
  assert.equal(clientNoticesEnabled(B, env(A)), false);
  assert.equal(clientNoticesEnabled(A.toUpperCase(), env(` ${A.toUpperCase()} , ${B}`)), true);
  assert.equal(clientNoticesEnabled(B, env(` ${A.toUpperCase()} , ${B}`)), true);
  assert.deepEqual([...clientNoticeWorkspaceIds(env(`${A.toUpperCase()},${A}`))], [A]);
});

test("errori di battitura e voci che non sono UUID si ignorano", () => {
  for (const value of ["true", "all", "on", A.slice(0, 30), `${A}x`, `${A} ${B}`, `{${A}}`]) {
    assert.equal(clientNoticesEnabled(A, env(value)), false, value);
  }
  assert.equal(clientNoticesEnabled("non-un-uuid", env(A)), false);
  assert.equal(clientNoticesEnabled(null, env(A)), false);
  assert.equal(clientNoticesEnabled(undefined, env(A)), false);
});

test("mai senza «Chiedi al referente»: area spenta o esclusa, USE_CASE_REFERENTS=off, anteprima", () => {
  assert.equal(clientNoticesEnabled(A, env(A, { USE_CASE_HUB_WORKSPACES: "" })), false, "area spenta");
  assert.equal(clientNoticesEnabled(A, env(A, { USE_CASE_HUB_WORKSPACES: B })), false, "area accesa per un altro");
  assert.equal(clientNoticesEnabled(A, env(A, { USE_CASE_HUB_WORKSPACES: A })), true, "area accesa per lui");
  assert.equal(clientNoticesEnabled(A, env(A, { USE_CASE_HUB_EXCLUDE: A })), false, "escluso");
  assert.equal(clientNoticesEnabled(A, env(A, { USE_CASE_REFERENTS: "off" })), false, "referenti spenti");
  assert.equal(clientNoticesEnabled(A, env(A, { USE_CASE_REFERENTS: " off " })), false);
  assert.equal(clientNoticesEnabled(A, env(A, { VERCEL_ENV: "preview" })), false, "anteprima");
  assert.equal(clientNoticesEnabled(A, env(A, { VERCEL_ENV: "production" })), true);
});

test("«Pronto da avviare» (solo Lateral Space): area accesa e non un'anteprima, senza l'interruttore del cliente", () => {
  assert.equal(readyNoticesEnabled(A, env(undefined)), true);
  assert.equal(readyNoticesEnabled(A, env(undefined, { USE_CASE_HUB_WORKSPACES: "" })), false);
  assert.equal(readyNoticesEnabled(A, env(undefined, { USE_CASE_HUB_EXCLUDE: A })), false);
  assert.equal(readyNoticesEnabled(A, env(undefined, { VERCEL_ENV: "preview" })), false);
  assert.equal(readyNoticesEnabled("x", env(undefined)), false);
});
