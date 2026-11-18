import test from "node:test";
import assert from "node:assert/strict";
import { PICKER_STAY_PARAMS, directWorkspaceId, wantsNewWorkspace } from "./workspaces.ts";

// (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.2, D1) Con un solo workspace si entra diretti; l'elenco resta a chi lo
// chiede dal selettore e a chi arriva con un avviso. Id inventati.

const ws = (id: string) => ({ workspace: { id } });
const ONE = [{ workspaces: [ws("00000000-0000-4000-8000-0000000000a1")] }];

test("un solo workspace: si entra diretti", () => {
  assert.equal(directWorkspaceId(ONE), "00000000-0000-4000-8000-0000000000a1");
  assert.equal(directWorkspaceId(ONE, {}), "00000000-0000-4000-8000-0000000000a1");
  // Lo stesso workspace in due gruppi (organizzazione e condiviso) conta una volta.
  assert.equal(directWorkspaceId([...ONE, { workspaces: [ws("00000000-0000-4000-8000-0000000000a1")] }]), "00000000-0000-4000-8000-0000000000a1");
  // Un parametro qualsiasi, che non chiede l'elenco, non lo ferma.
  assert.equal(directWorkspaceId(ONE, { altro: "1" }), "00000000-0000-4000-8000-0000000000a1");
});

test("nessun workspace o più di uno: l'elenco", () => {
  assert.equal(directWorkspaceId([]), null);
  assert.equal(directWorkspaceId([{ workspaces: [] }]), null);
  assert.equal(directWorkspaceId([{ workspaces: [ws("a"), ws("b")] }]), null);
  assert.equal(directWorkspaceId([{ workspaces: [ws("a")] }, { workspaces: [ws("b")] }]), null);
});

test("l'elenco resta a chi lo chiede («Tutti i workspace», «Nuovo workspace») e a chi ha un avviso da leggere", () => {
  assert.deepEqual(PICKER_STAY_PARAMS, ["tutti", "nuovo", "workspaceDeleted", "slack_error", "granola"]);
  for (const key of PICKER_STAY_PARAMS) assert.equal(directWorkspaceId(ONE, { [key]: "1" }), null, key);
  assert.equal(directWorkspaceId(ONE, { slack_error: "invalid_state" }), null);
  assert.equal(directWorkspaceId(ONE, { tutti: "" }), "00000000-0000-4000-8000-0000000000a1", "un valore vuoto non chiede niente");
  assert.equal(wantsNewWorkspace({ nuovo: "1" }), true);
  assert.equal(wantsNewWorkspace({ nuovo: "0" }), false);
  assert.equal(wantsNewWorkspace({}), false);
});
