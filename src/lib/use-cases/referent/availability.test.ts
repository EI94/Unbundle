import test from "node:test";
import assert from "node:assert/strict";
import { referentAskEnabled, referentPublicWritesAvailable } from "./availability.ts";

// Quando «Chiedi al referente» è acceso (SPEC §0 «Availability»).
const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const OTHER = "3f2a9c1e-0000-4000-8000-0000000000a2";

test("referentAskEnabled: l'area Use case accesa per il workspace, senza guardare UC_ENABLED", () => {
  const hub = { USE_CASE_HUB_WORKSPACES: WS };
  assert.equal(referentAskEnabled(WS, hub), true);
  assert.equal(referentAskEnabled(OTHER, hub), false);
  assert.equal(referentAskEnabled(WS, { ...hub, UC_ENABLED: "false" }), true);
  assert.equal(referentAskEnabled(WS, { ...hub, UC_ENABLED: "true", UC_WORKSPACE_IDS: OTHER }), true);
  assert.equal(referentAskEnabled(null, hub), false);
  assert.equal(referentAskEnabled(WS, {}), false);
});

test("referentAskEnabled: l'interruttore e le anteprime di Vercel la spengono", () => {
  const hub = { USE_CASE_HUB_WORKSPACES: WS };
  assert.equal(referentAskEnabled(WS, { ...hub, USE_CASE_REFERENTS: "off" }), false);
  assert.equal(referentAskEnabled(WS, { ...hub, USE_CASE_REFERENTS: " off " }), false);
  assert.equal(referentAskEnabled(WS, { ...hub, USE_CASE_REFERENTS: "on" }), true);
  assert.equal(referentAskEnabled(WS, { ...hub, VERCEL_ENV: "preview" }), false);
  assert.equal(referentAskEnabled(WS, { ...hub, VERCEL_ENV: "production" }), true);
});

test("referentPublicWritesAvailable: su Vercel serve UC_SECRET, fuori no", () => {
  assert.equal(referentPublicWritesAvailable({}), true);
  assert.equal(referentPublicWritesAvailable({ VERCEL_ENV: "" }), true);
  assert.equal(referentPublicWritesAvailable({ VERCEL_ENV: "preview" }), false);
  assert.equal(referentPublicWritesAvailable({ VERCEL_ENV: "production" }), false);
  assert.equal(referentPublicWritesAvailable({ VERCEL_ENV: "production", UC_SECRET: "  " }), false);
  assert.equal(referentPublicWritesAvailable({ VERCEL_ENV: "production", UC_SECRET: "segreto" }), true);
  assert.equal(referentPublicWritesAvailable({ VERCEL_ENV: "preview", UC_SECRET: "segreto" }), true);
});
