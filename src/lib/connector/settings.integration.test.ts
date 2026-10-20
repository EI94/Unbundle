import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { EXAMPLE_CONNECTOR_PROFILE_INPUT, EXAMPLE_INSTRUCTIONS_TEMPLATE } from "./contract.fixtures.ts";
import type { ConnectorGateDeps } from "./gate.ts";
import { canActivateConnector, connectorSettingsView, shouldShowConnectorCard } from "./settings-view.ts";

// Opt-in integration suite for the «Connettore Claude» settings card (PIANO-LAVORI §3.5,
// K7r) on the connector's own local cluster only: the real queries behind the card and
// its actions (`workspace-integrations.ts`), then the effect on the real gate.
//   node scripts/connettore-test/run-db-tests.mjs
// Same guards as the other connector suites: CONN_TEST_ISOLATED=true, a loopback
// DATABASE_URL equal to UC_TEST_DATABASE_URL, the local Neon transport and the test
// resolver for `@/` imports. Synthetic data, created and deleted by the suite. Test
// tokens are generated at run time and never printed.
const url = process.env.DATABASE_URL;
const enabled = process.env.CONN_TEST_ISOLATED === "true" && Boolean(url);
if (enabled) {
  const parsed = new URL(url!);
  if (parsed.hostname !== "127.0.0.1" || process.env.UC_TEST_DATABASE_URL !== url) {
    throw new Error("Connector DB tests need a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL");
  }
  if ((globalThis.fetch as { name?: string }).name !== "localNeonFetch") {
    throw new Error("Preload scripts/uc-test/local-neon.cjs to reach the local test database");
  }
}
const opts = { skip: !enabled };

type App = {
  integrations: typeof import("../db/queries/workspace-integrations.ts");
  gate: typeof import("./gate.ts").gateConnectorRequest;
  gateDeps: (env: Record<string, string | undefined>) => ConnectorGateDeps;
  q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};
let app: App;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), user: randomUUID(), wsA: randomUUID(), wsB: randomUUID(), wsD6: randomUUID() };
const slugA = `k7-a-${suffix}`;
const slugD6 = `k7-d6-${suffix}`;
const DAY = 24 * 60 * 60 * 1000;
/** Istanti prima e dopo la creazione dei token di `before`: la scadenza deve stare a 90 giorni da qui. */
const created = { from: 0, to: 0 };
const tokens = {} as Record<"connA" | "connA2" | "v1A" | "connB", { token: string; id: string }>;
const ON = { MCP_CONNECTOR_ENABLED: "true" };

const one = async (text: string, params: unknown[] = []) => (await app.q(text, params))[0];

function toolsList(token: string) {
  return new Request(`http://127.0.0.1:53130/api/mcp/connettore/${slugA}`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
}

before(async () => {
  if (!enabled) return;
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  const [integrations, gate, appDeps] = await Promise.all([
    import("../db/queries/workspace-integrations.ts"),
    import("./gate.ts"),
    import("./app-deps.ts"),
  ]);
  const noAlerts = { findAdminChannel: async () => null, post: async () => {} };
  app = {
    integrations,
    gate: gate.gateConnectorRequest,
    gateDeps: (env) => appDeps.appConnectorGateDeps(env, noAlerts),
    q: (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>,
  };

  await app.q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova', $2)`, [ids.org, `org-k7-${suffix}`]);
  await app.q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Lateral Space di prova')`, [ids.user, `ls.k7.${suffix}@ls.test`]);
  for (const [id, name] of [[ids.wsA, "A"], [ids.wsB, "B"], [ids.wsD6, "D6"]]) {
    await app.q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [id, ids.org, `Workspace K7 ${name} ${suffix}`]);
  }
  // Solo A ha la configurazione; B no.
  await app.q(
    `INSERT INTO workspace_connector_configs (workspace_id, slug, enabled, code_prefix, workspace_display_name, guide_version, allowed_domains, allowed_origins, limits)
     VALUES ($1, $2, true, 'XK', 'Organizzazione di prova', '1.0', '["prova.test"]'::jsonb, '["https://claude.ai"]'::jsonb, '{"readsPerHour": 500}'::jsonb)`,
    [ids.wsA, slugA]
  );
  // La riga che ogni workspace riceve per i codici (DESIGN §10.6, D6): spenta, senza guida.
  await app.q(`INSERT INTO workspace_connector_configs (workspace_id, slug, code_prefix) VALUES ($1, $2, 'XD')`, [ids.wsD6, slugD6]);
  const conn = async (workspaceId: string) => {
    const { token, row } = await integrations.createConnectorIntegrationToken({ workspaceId, label: "Connettore di prova", createdByUserId: ids.user });
    return { token, id: row.id };
  };
  created.from = Date.now();
  tokens.connA = await conn(ids.wsA);
  tokens.connA2 = await conn(ids.wsA);
  tokens.connB = await conn(ids.wsB);
  created.to = Date.now();
  const v1 = await integrations.createWorkspaceIntegrationToken({ workspaceId: ids.wsA, label: "Claude team di prova", createdByUserId: ids.user });
  tokens.v1A = { token: v1.token, id: v1.row.id };
});

after(async () => {
  if (!enabled) return;
  await app.q(`DELETE FROM connector_rate_limits WHERE bucket LIKE ANY($1::text[])`, [Object.values(tokens).map((t) => `%${t.id}%`)]);
  await app.q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await app.q(`DELETE FROM users WHERE id = $1`, [ids.user]);
});

test("lettura della scheda: configurazione senza guida, solo i token del connettore di questo workspace", opts, async () => {
  const settings = await app.integrations.getConnectorSettings(ids.wsA);
  assert.ok(settings);
  assert.equal(settings.slug, slugA);
  assert.equal(settings.enabled, true);
  assert.equal(settings.codePrefix, "XK");
  assert.equal(settings.hasGuide, false, "nessuna guida caricata");
  assert.equal("guide" in settings, false, "la scheda non legge il contenuto della guida");
  assert.equal(await app.integrations.getConnectorSettings(ids.wsB), null, "B non ha la configurazione");

  assert.equal(settings.profileReady, false, "nessun profilo del cliente né modello delle istruzioni");
  assert.equal("profile" in settings || "instructionsTemplate" in settings, false, "il contenuto di profilo e modello non esce dal server");

  await app.q(`UPDATE workspace_connector_configs SET guide = '{"guideVersion": "1.0"}'::jsonb WHERE workspace_id = $1`, [ids.wsA]);
  const guideOnly = (await app.integrations.getConnectorSettings(ids.wsA))!;
  assert.equal(guideOnly.hasGuide, true);
  assert.equal(canActivateConnector(guideOnly), false, "con la sola guida la rotta risponderebbe 500: niente token nuovi");
  // Profilo e modello come li carica connector-admin profile (K8).
  await app.q(`UPDATE workspace_connector_configs SET profile = $2::jsonb, instructions_template = $3 WHERE workspace_id = $1`, [
    ids.wsA,
    JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT),
    EXAMPLE_INSTRUCTIONS_TEMPLATE,
  ]);
  const withGuide = (await app.integrations.getConnectorSettings(ids.wsA))!;
  assert.equal(withGuide.profileReady, true);
  assert.equal(canActivateConnector(withGuide), true);

  const listed = await app.integrations.getConnectorIntegrationTokens(ids.wsA);
  assert.deepEqual(listed.map((t) => t.id).sort(), [tokens.connA.id, tokens.connA2.id].sort(), "niente token v1, niente token di B");
  const view = connectorSettingsView(withGuide, listed);
  assert.equal(view.status, "attivo");
  assert.equal(view.config!.url, `https://www.theunbundle.com/api/mcp/connettore/${slugA}`);
  assert.deepEqual(view.config!.allowedDomains, ["prova.test"]);
  assert.deepEqual(view.config!.allowedOrigins, ["https://claude.ai"]);
  assert.equal(view.config!.limits.readsPerHour, 500);
  assert.equal(view.config!.limits.submitsPerHour, 200);
  assert.equal(view.config!.nextCode, "XK-0001");
  assert.equal(view.config!.guideVersion, "1.0");
  for (const t of view.tokens) {
    assert.equal(t.state, "attivo");
    assert.equal(t.exposed, false);
  }
  // Decisione 4 dell'arresto B: 90 giorni dalla creazione.
  for (const t of listed) {
    const expires = t.expiresAt!.getTime();
    assert.ok(expires >= created.from + 90 * DAY && expires <= created.to + 90 * DAY, "scadenza a 90 giorni");
  }
  const serialized = JSON.stringify(view);
  for (const t of Object.values(tokens)) assert.ok(!serialized.includes(t.token), "nessun segreto nella vista");
  assert.ok(!/[0-9a-f]{64}/.test(serialized), "nessun hash nella vista");
});

test("versione della guida: la scheda mostra quella che Claude riceve, anche senza la colonna", opts, async () => {
  const version = async () => connectorSettingsView(await app.integrations.getConnectorSettings(ids.wsA), []).config!.guideVersion;
  try {
    await app.q(`UPDATE workspace_connector_configs SET guide_version = NULL, guide = '{"guideVersion": "1.3"}'::jsonb WHERE workspace_id = $1`, [ids.wsA]);
    assert.equal(await version(), "1.3", "colonna vuota: la versione della guida");
    await app.q(`UPDATE workspace_connector_configs SET guide = '{"guideVersion": 1.3}'::jsonb WHERE workspace_id = $1`, [ids.wsA]);
    assert.equal(await version(), null, "un numero non è una versione, come per get_intake_guide");
    await app.q(`UPDATE workspace_connector_configs SET guide_version = '1.4', guide = '{"guideVersion": "1.3"}'::jsonb WHERE workspace_id = $1`, [ids.wsA]);
    assert.equal(await version(), "1.4", "prima la colonna");
  } finally {
    await app.q(`UPDATE workspace_connector_configs SET guide_version = '1.0', guide = '{"guideVersion": "1.0"}'::jsonb WHERE workspace_id = $1`, [ids.wsA]);
  }
});

test("riga di D6 (spenta, senza guida): niente scheda, non si accende, nessun token", opts, async () => {
  const settings = await app.integrations.getConnectorSettings(ids.wsD6);
  assert.ok(settings);
  assert.deepEqual([settings.enabled, settings.hasGuide, settings.guideVersion, settings.guideJsonVersion], [false, false, null, null]);
  const view = connectorSettingsView(settings, await app.integrations.getConnectorIntegrationTokens(ids.wsD6));
  assert.equal(view.status, "non_configurato");
  assert.equal(view.config, null);
  assert.equal(shouldShowConnectorCard(view), false, "nessuna scheda in un workspace senza connettore");
  assert.equal(canActivateConnector(settings), false, "l'azione non crea token");

  // Accendere non scrive nulla; spegnere resta possibile.
  assert.equal(await app.integrations.setConnectorEnabled({ workspaceId: ids.wsD6, enabled: true, updatedBy: ids.user }), null);
  const still = await one(`SELECT enabled, updated_by FROM workspace_connector_configs WHERE workspace_id = $1`, [ids.wsD6]);
  assert.deepEqual([still.enabled, still.updated_by], [false, null]);
  assert.deepEqual(await app.integrations.setConnectorEnabled({ workspaceId: ids.wsD6, enabled: false, updatedBy: ids.user }), { enabled: false });

  // Con la guida caricata (script operatore) diventa un connettore sospeso; senza profilo e
  // modello delle istruzioni non si accende (la rotta risponderebbe 500), con entrambi sì.
  await app.q(`UPDATE workspace_connector_configs SET guide = '{"guideVersion": "1.0"}'::jsonb WHERE workspace_id = $1`, [ids.wsD6]);
  const guideOnly = (await app.integrations.getConnectorSettings(ids.wsD6))!;
  assert.equal(connectorSettingsView(guideOnly, []).status, "sospeso");
  assert.equal(canActivateConnector(guideOnly), false);
  assert.equal(await app.integrations.setConnectorEnabled({ workspaceId: ids.wsD6, enabled: true, updatedBy: ids.user }), null, "senza profilo non si accende");
  await app.q(`UPDATE workspace_connector_configs SET profile = $2::jsonb WHERE workspace_id = $1`, [ids.wsD6, JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT)]);
  assert.equal(await app.integrations.setConnectorEnabled({ workspaceId: ids.wsD6, enabled: true, updatedBy: ids.user }), null, "senza modello non si accende");
  await app.q(`UPDATE workspace_connector_configs SET instructions_template = $2 WHERE workspace_id = $1`, [ids.wsD6, EXAMPLE_INSTRUCTIONS_TEMPLATE]);
  const ready = (await app.integrations.getConnectorSettings(ids.wsD6))!;
  assert.equal(canActivateConnector(ready), true);
  assert.deepEqual(await app.integrations.setConnectorEnabled({ workspaceId: ids.wsD6, enabled: true, updatedBy: ids.user }), { enabled: true });
});

test("token esposto: la scheda lo vede dalla riga del token", opts, async () => {
  await app.q(`UPDATE workspace_integration_tokens SET exposed_at = (now() AT TIME ZONE 'UTC') WHERE id = $1`, [tokens.connA2.id]);
  const view = connectorSettingsView(await app.integrations.getConnectorSettings(ids.wsA), await app.integrations.getConnectorIntegrationTokens(ids.wsA));
  const exposed = view.tokens.find((t) => t.id === tokens.connA2.id)!;
  assert.equal(exposed.exposed, true);
  assert.equal(exposed.active, true);
  assert.ok(exposed.exposedOn);
  assert.equal(view.tokens.find((t) => t.id === tokens.connA.id)!.exposed, false);
});

test("interruttore: sospende e riaccende, registra chi; senza configurazione non scrive nulla", opts, async () => {
  const before = await one(`SELECT updated_at FROM workspace_connector_configs WHERE workspace_id = $1`, [ids.wsA]);
  assert.deepEqual(await app.integrations.setConnectorEnabled({ workspaceId: ids.wsA, enabled: false, updatedBy: ids.user }), { enabled: false });
  const row = await one(`SELECT enabled, updated_by, updated_at FROM workspace_connector_configs WHERE workspace_id = $1`, [ids.wsA]);
  assert.equal(row.enabled, false);
  assert.equal(row.updated_by, ids.user);
  assert.ok(new Date(String(row.updated_at)).getTime() >= new Date(String(before.updated_at)).getTime());

  // Sospeso: l'ingresso fa passare il token e la configurazione porta enabled=false
  // (ogni tool risponderà connector_disabled, come prova route.integration.test.ts).
  const suspended = await app.gate(toolsList(tokens.connA.token), slugA, app.gateDeps(ON));
  assert.equal(suspended.ok, true);
  if (suspended.ok) assert.equal(suspended.config.enabled, false);
  const view = connectorSettingsView(await app.integrations.getConnectorSettings(ids.wsA), await app.integrations.getConnectorIntegrationTokens(ids.wsA));
  assert.equal(view.status, "sospeso");

  assert.deepEqual(await app.integrations.setConnectorEnabled({ workspaceId: ids.wsA, enabled: true, updatedBy: ids.user }), { enabled: true });
  const resumed = await app.gate(toolsList(tokens.connA.token), slugA, app.gateDeps(ON));
  assert.equal(resumed.ok && resumed.config.enabled, true);

  assert.equal(await app.integrations.setConnectorEnabled({ workspaceId: ids.wsB, enabled: true, updatedBy: ids.user }), null);
  const none = await one(`SELECT count(*)::int AS n FROM workspace_connector_configs WHERE workspace_id = $1`, [ids.wsB]);
  assert.equal(Number(none.n), 0, "nessuna riga creata per B");
});

test("revoca: solo un token del connettore di questo workspace, una volta; poi il connettore risponde 401", opts, async () => {
  const revokedAt = async (id: string) => (await one(`SELECT revoked_at FROM workspace_integration_tokens WHERE id = $1`, [id])).revoked_at;

  // Il token v1 della card «Claude per Unbundle» non si revoca da qui.
  assert.equal(await app.integrations.revokeConnectorIntegrationToken({ workspaceId: ids.wsA, tokenId: tokens.v1A.id }), null);
  assert.equal(await revokedAt(tokens.v1A.id), null);
  // Il token del connettore di B non si revoca dalla scheda di A.
  assert.equal(await app.integrations.revokeConnectorIntegrationToken({ workspaceId: ids.wsA, tokenId: tokens.connB.id }), null);
  assert.equal(await revokedAt(tokens.connB.id), null);
  // Un id inesistente.
  assert.equal(await app.integrations.revokeConnectorIntegrationToken({ workspaceId: ids.wsA, tokenId: randomUUID() }), null);

  assert.equal((await app.gate(toolsList(tokens.connA2.token), slugA, app.gateDeps(ON))).ok, true, "prima della revoca passa");
  const revoked = await app.integrations.revokeConnectorIntegrationToken({ workspaceId: ids.wsA, tokenId: tokens.connA2.id });
  assert.equal(revoked?.id, tokens.connA2.id);
  assert.ok(revoked?.revokedAt instanceof Date);
  assert.ok(Math.abs(revoked!.revokedAt!.getTime() - Date.now()) < 60_000, "revoked_at in UTC, come le altre colonne");
  assert.equal(await app.integrations.revokeConnectorIntegrationToken({ workspaceId: ids.wsA, tokenId: tokens.connA2.id }), null, "una volta sola");

  const after = await app.gate(toolsList(tokens.connA2.token), slugA, app.gateDeps(ON));
  assert.equal(after.ok, false);
  if (!after.ok) {
    assert.equal(after.response.status, 401);
    assert.equal(await after.response.text(), JSON.stringify({ error: "unauthorized" }));
  }
  assert.equal((await app.gate(toolsList(tokens.connA.token), slugA, app.gateDeps(ON))).ok, true, "l'altro token resta valido");

  const view = connectorSettingsView(await app.integrations.getConnectorSettings(ids.wsA), await app.integrations.getConnectorIntegrationTokens(ids.wsA));
  assert.deepEqual(
    view.tokens.map((t) => [t.id, t.state]),
    [
      [tokens.connA.id, "attivo"],
      [tokens.connA2.id, "revocato"],
    ]
  );
});

test("token nuovo dalla scheda: 90 giorni, avviso dal 76° giorno", opts, async () => {
  const t0 = Date.now();
  const { token, row } = await app.integrations.createConnectorIntegrationToken({ workspaceId: ids.wsA, label: "Token nuovo di prova", createdByUserId: ids.user });
  const t1 = Date.now();
  tokens.connA = { token, id: row.id };
  const listed = await app.integrations.getConnectorIntegrationTokens(ids.wsA);
  const fresh = listed.find((t) => t.id === row.id)!;
  // La durata si misura dall'orologio di chi crea, non da created_at: il cluster locale
  // gira con TimeZone=Europe/Rome e il default now() di una colonna senza fuso è spostato.
  const expires = fresh.expiresAt!.getTime();
  assert.ok(expires >= t0 + 90 * DAY && expires <= t1 + 90 * DAY, "scadenza a 90 giorni dalla creazione");
  // Con la durata verificata, i giorni si contano dall'istante di creazione che la scadenza implica.
  const at = (days: number) => new Date(expires - 90 * DAY + days * DAY);
  const settings = await app.integrations.getConnectorSettings(ids.wsA);
  const stateOn = (days: number) => connectorSettingsView(settings, [fresh], at(days)).tokens[0];
  assert.equal(stateOn(0).state, "attivo");
  assert.equal(stateOn(75).state, "attivo");
  assert.equal(stateOn(76).state, "in_scadenza");
  assert.equal(stateOn(90).state, "scaduto");
  assert.equal(connectorSettingsView(settings, [fresh], at(90)).status, "senza_token");
});
