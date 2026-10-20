import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  CONNECTOR_DEFAULT_LIMITS,
  connectorSuspendedError,
  isConnectorRouteEnabled,
  isValidConnectorSlug,
  resolveConnectorLimits,
  toConnectorRuntimeConfig,
  type ConnectorConfigRow,
} from "./config.ts";

// Prompt WP4 (interruttori, limiti) e WP10. Dati sintetici.

test("MCP_CONNECTOR_ENABLED: la rotta si accende solo con true", () => {
  assert.equal(isConnectorRouteEnabled({ MCP_CONNECTOR_ENABLED: "true" }), true);
  assert.equal(isConnectorRouteEnabled({ MCP_CONNECTOR_ENABLED: " true " }), true);
  for (const value of [undefined, "", "false", "1", "TRUE", "yes", "on"]) {
    assert.equal(isConnectorRouteEnabled({ MCP_CONNECTOR_ENABLED: value }), false, String(value));
  }
  assert.equal(isConnectorRouteEnabled({}), false);
});

test("slug: minuscole, cifre e trattini, da 3 a 40", () => {
  for (const slug of ["abc", "prova-a", "esempio", "a1-b2", "x".repeat(40)]) assert.equal(isValidConnectorSlug(slug), true, slug);
  for (const slug of ["ab", "Esempio", "prova_a", "prova a", "x".repeat(41), "", null, 42, "../x"]) {
    assert.equal(isValidConnectorSlug(slug), false, String(slug));
  }
});

test("limiti: predefiniti di fase 1, valori della config solo se interi validi", () => {
  assert.deepEqual(CONNECTOR_DEFAULT_LIMITS, { submitsPerHour: 200, readsPerHour: 3000, submitsPerDayWorkspace: 1000, submitsPerHourPerUser: 10 });
  assert.deepEqual(resolveConnectorLimits(null), { ...CONNECTOR_DEFAULT_LIMITS });
  assert.deepEqual(resolveConnectorLimits([]), { ...CONNECTOR_DEFAULT_LIMITS });
  assert.deepEqual(resolveConnectorLimits({ submitsPerHour: 50, readsPerHour: 0 }), { ...CONNECTOR_DEFAULT_LIMITS, submitsPerHour: 50, readsPerHour: 0 });
  assert.deepEqual(
    resolveConnectorLimits({ submitsPerHour: -1, readsPerHour: 1.5, submitsPerDayWorkspace: "900", submitsPerHourPerUser: 2_000_000, extra: 1 }),
    { ...CONNECTOR_DEFAULT_LIMITS }
  );
});

function row(patch: Partial<ConnectorConfigRow> = {}): ConnectorConfigRow {
  return {
    workspaceId: randomUUID(),
    slug: "prova-a",
    enabled: true,
    codePrefix: "XX",
    identityMode: "dichiarata",
    authMode: "header",
    workspaceDisplayName: "  Organizzazione di prova  ",
    guide: { guideVersion: "1" },
    guideVersion: "1",
    allowedOrigins: ["https://claude.ai/", "non valida"],
    limits: { readsPerHour: 100 },
    esgEnabled: true,
    ...patch,
  };
}

test("configurazione pronta: origini normalizzate, limiti risolti, modalità note", () => {
  const source = row();
  const config = toConnectorRuntimeConfig(source);
  assert.deepEqual(config, {
    workspaceId: source.workspaceId,
    slug: "prova-a",
    enabled: true,
    codePrefix: "XX",
    identityMode: "dichiarata",
    authMode: "header",
    workspaceDisplayName: "Organizzazione di prova",
    guide: { guideVersion: "1" },
    guideVersion: "1",
    allowedOrigins: ["https://claude.ai"],
    limits: { ...CONNECTOR_DEFAULT_LIMITS, readsPerHour: 100 },
    esgEnabled: true,
    // Senza profilo e senza modello delle istruzioni la rotta non parte (handler.ts).
    profile: null,
    instructionsTemplate: null,
    profileProblems: ["profile", "instructions_template"],
  });
  const other = toConnectorRuntimeConfig(row({ identityMode: "verificata", authMode: "oauth", guide: [], workspaceDisplayName: " ", guideVersion: null, allowedOrigins: null, esgEnabled: null }));
  assert.equal(other.identityMode, "verificata");
  assert.equal(other.authMode, "oauth");
  assert.equal(other.guide, null);
  assert.equal(other.workspaceDisplayName, null);
  assert.deepEqual(other.allowedOrigins, []);
  assert.equal(other.esgEnabled, false);
});

test("connettore sospeso: ogni tool risponde connector_disabled", () => {
  assert.equal(connectorSuspendedError({ enabled: true }), null);
  const error = connectorSuspendedError({ enabled: false });
  assert.equal(error?.error, "connector_disabled");
  assert.match(error?.message ?? "", /sospeso/);
});
