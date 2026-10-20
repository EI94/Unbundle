import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { CONNECTOR_PROVIDER, CONNECTOR_TOKEN_PREFIX, hashIntegrationToken, type ConnectorPrincipal } from "./auth.ts";
import type { ConnectorRuntimeConfig } from "./config.ts";
import { exposedTokenAlertText, type ExposedTokenAlertDeps } from "./exposed-token-alert.ts";
import { gateConnectorRequest, type ConnectorGateDeps } from "./gate.ts";
import { MCP_BODY_MAX_BYTES } from "./http-hygiene.ts";
import {
  consumeConnectorRateLimit,
  consumeRateLimits,
  rateLimitKindForMessage,
  type RateLimitRule,
  type SqlExecutor,
} from "./rate-limit.ts";

// Opt-in integration suite for the connector WP4 (auth, scopes, switches, HTTP hygiene,
// rate limits, logs) on the connector's own local cluster only, with the real app
// queries (`workspace-integrations.ts`) and the real `connector_rate_limits` table:
//   node scripts/connettore-test/run-db-tests.mjs
// Same guards as src/lib/portfolio/submission.integration.test.ts: CONN_TEST_ISOLATED=true,
// a loopback DATABASE_URL equal to UC_TEST_DATABASE_URL, the local Neon transport and the
// test resolver for `@/` imports. Synthetic data, created and deleted by the suite. Test
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

type Integrations = typeof import("../db/queries/workspace-integrations.ts");
type App = {
  integrations: Integrations;
  signals: typeof import("../db/queries/signals.ts");
  slackAlertDeps: ExposedTokenAlertDeps;
  gateDeps: (env?: Record<string, string | undefined>) => ConnectorGateDeps;
  exec: SqlExecutor;
  handleRest: typeof import("../portfolio/submission-http.ts").handlePortfolioSubmissionPost;
  q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
};
let app: App;

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), user: randomUUID(), wsA: randomUUID(), wsB: randomUUID(), wsC: randomUUID(), wsDay: randomUUID(), tokenDay: randomUUID(), wsBoth: randomUUID(), tokenBoth: randomUUID() };
const slugs = { a: `k4-a-${suffix}`, b: `k4-b-${suffix}`, c: `k4-c-${suffix}` };
type TokenName =
  | "connA"
  | "connA2"
  | "leakA"
  | "connB"
  | "connC"
  | "raceC"
  | "classC"
  | "restA"
  | "readOnlyA"
  | "submitOnlyA"
  | "revokedA"
  | "expiredA";
const tokens = {} as Record<TokenName, { token: string; id: string }>;
const PAYLOAD_TEXT = `Verbali automatici di Persona Inventata ${suffix}`;
const ON = { MCP_CONNECTOR_ENABLED: "true" };
const BOT_TOKEN = `xoxb-finto-${randomBytes(12).toString("hex")}`;

// Avvisi a Lateral Space di un token esposto: canale admin finto (il canale è l'id del
// workspace), nessuna chiamata a Slack.
const alerts: Array<{ channelId: string; text: string }> = [];
const fakeAlertDeps: ExposedTokenAlertDeps = {
  findAdminChannel: async (workspaceId) => ({ channelId: workspaceId, botToken: BOT_TOKEN }),
  post: async (target, text) => {
    alerts.push({ channelId: target.channelId, text });
  },
};

// Ogni riga scritta su console durante la suite: alla fine nessun token, hash o testo.
const captured: string[] = [];
const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };

function mcpRequest(slug: string, init: { token?: string | null; body?: unknown; headers?: Record<string, string>; method?: string; query?: string } = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json, text/event-stream",
    ...(init.token ? { authorization: `Bearer ${init.token}` } : {}),
    ...init.headers,
  };
  const method = init.method ?? "POST";
  return new Request(`http://127.0.0.1:53130/api/mcp/connettore/${slug}${init.query ?? ""}`, {
    method,
    headers,
    body: method === "POST" ? (typeof init.body === "string" ? init.body : JSON.stringify(init.body ?? { jsonrpc: "2.0", id: 1, method: "tools/list" })) : null,
  });
}

async function expectRejected(request: Request, slug: string, status: number, error: string, env: Record<string, string | undefined> = ON) {
  const result = await gateConnectorRequest(request, slug, app.gateDeps(env));
  assert.equal(result.ok, false, `${status} ${error}`);
  if (result.ok) throw new Error("unreachable");
  assert.equal(result.response.status, status);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
  assert.equal(result.response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(await result.response.text(), JSON.stringify({ error }));
  return result.response;
}

async function admit(slug: string, token: string, body?: unknown) {
  const result = await gateConnectorRequest(mcpRequest(slug, { token, body }), slug, app.gateDeps(ON));
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  return result as { ok: true; principal: ConnectorPrincipal; config: ConnectorRuntimeConfig; body: unknown };
}

const one = async (text: string, params: unknown[] = []) => (await app.q(text, params))[0];

before(async () => {
  if (!enabled) return;
  for (const level of ["log", "info", "warn", "error"] as const) {
    console[level] = (...args: unknown[]) => {
      captured.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
      originalConsole[level](...args);
    };
  }
  const { neon } = await import("@neondatabase/serverless");
  const sql = neon(url!);
  const [integrations, signals, appDeps, rest] = await Promise.all([
    import("../db/queries/workspace-integrations.ts"),
    import("../db/queries/signals.ts"),
    import("./app-deps.ts"),
    import("../portfolio/submission-http.ts"),
  ]);
  app = {
    integrations,
    signals,
    slackAlertDeps: appDeps.appExposedTokenAlertDeps,
    gateDeps: (env) => appDeps.appConnectorGateDeps(env, fakeAlertDeps),
    exec: appDeps.appRateLimitExecutor,
    handleRest: rest.handlePortfolioSubmissionPost,
    q: (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>,
  };

  await app.q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova', $2)`, [ids.org, `org-k4-${suffix}`]);
  await app.q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Lateral Space di prova')`, [ids.user, `ls.k4.${suffix}@ls.test`]);
  for (const [id, name] of [[ids.wsA, "A"], [ids.wsB, "B"], [ids.wsC, "C"]]) {
    await app.q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [id, ids.org, `Workspace K4 ${name} ${suffix}`]);
  }
  // A: acceso, origine di claude.ai ammessa. B: sospeso. C: modalità oauth e 3 invii al giorno.
  await app.q(
    `INSERT INTO workspace_connector_configs (workspace_id, slug, enabled, code_prefix, allowed_origins) VALUES ($1, $2, true, 'XA', '["https://claude.ai"]'::jsonb)`,
    [ids.wsA, slugs.a]
  );
  await app.q(`INSERT INTO workspace_connector_configs (workspace_id, slug, enabled, code_prefix) VALUES ($1, $2, false, 'XB')`, [ids.wsB, slugs.b]);
  await app.q(
    `INSERT INTO workspace_connector_configs (workspace_id, slug, enabled, code_prefix, auth_mode, limits) VALUES ($1, $2, true, 'XC', 'oauth', '{"submitsPerDayWorkspace": 3}'::jsonb)`,
    [ids.wsC, slugs.c]
  );

  const make = async (name: TokenName, create: () => Promise<{ token: string; row: { id: string } }>) => {
    const { token, row } = await create();
    tokens[name] = { token, id: row.id };
  };
  const conn = (workspaceId: string) => () => integrations.createConnectorIntegrationToken({ workspaceId, label: "Connettore di prova", createdByUserId: ids.user });
  await make("connA", conn(ids.wsA));
  await make("connA2", conn(ids.wsA));
  await make("leakA", conn(ids.wsA));
  await make("connB", conn(ids.wsB));
  await make("connC", conn(ids.wsC));
  await make("raceC", conn(ids.wsC));
  await make("classC", conn(ids.wsC));
  await make("revokedA", conn(ids.wsA));
  await make("restA", () => integrations.createWorkspaceIntegrationToken({ workspaceId: ids.wsA, label: "REST di prova", createdByUserId: ids.user }));
  await make("readOnlyA", () =>
    integrations.createWorkspaceIntegrationToken({ workspaceId: ids.wsA, label: "Solo lettura", createdByUserId: ids.user, provider: "claude_connector", scopes: ["connector:read"] })
  );
  await make("submitOnlyA", () =>
    integrations.createWorkspaceIntegrationToken({ workspaceId: ids.wsA, label: "Solo invio", createdByUserId: ids.user, provider: "claude_connector", scopes: ["connector:submit"] })
  );
  await make("expiredA", () =>
    integrations.createWorkspaceIntegrationToken({
      workspaceId: ids.wsA,
      label: "Scaduto",
      createdByUserId: ids.user,
      provider: "claude_connector",
      scopes: ["connector:read", "connector:submit"],
      expiresAt: new Date(Date.now() - 60_000),
    })
  );
  await integrations.revokeWorkspaceIntegrationToken({ workspaceId: ids.wsA, tokenId: tokens.revokedA.id });
});

after(async () => {
  if (!enabled) return;
  Object.assign(console, originalConsole);
  const patterns = [ids.wsA, ids.wsB, ids.wsC, ids.wsDay, ids.tokenDay, ids.wsBoth, ids.tokenBoth, ...Object.values(tokens).map((t) => t.id), `test:${suffix}`].map((p) => `%${p}%`);
  await app.q(`DELETE FROM connector_rate_limits WHERE bucket LIKE ANY($1::text[])`, [patterns]);
  await app.q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await app.q(`DELETE FROM users WHERE id = $1`, [ids.user]);
});

test("token del connettore: due scope, provider, 90 giorni, solo l'hash in tabella", opts, async () => {
  const row = await one(
    `SELECT provider, scopes, token_hash, token_prefix, extract(epoch FROM (expires_at - (now() AT TIME ZONE 'UTC')))::int AS ttl, last_used_at, revoked_at
       FROM workspace_integration_tokens WHERE id = $1`,
    [tokens.connA.id]
  );
  assert.equal(row.provider, "claude_connector");
  assert.deepEqual(row.scopes, ["connector:read", "connector:submit"]);
  assert.equal(row.token_hash, createHash("sha256").update(tokens.connA.token, "utf8").digest("hex"));
  assert.ok(tokens.connA.token.startsWith(CONNECTOR_TOKEN_PREFIX));
  assert.equal(row.token_prefix, `${tokens.connA.token.slice(0, 14)}...`);
  const days = Number(row.ttl) / 86_400;
  assert.ok(days > 89.9 && days <= 90, String(days));
  assert.equal(row.last_used_at, null);
  const anywhere = await one(`SELECT count(*)::int AS n FROM workspace_integration_tokens t WHERE to_jsonb(t)::text LIKE $1`, [`%${tokens.connA.token}%`]);
  assert.equal(Number(anywhere.n), 0, "il token in chiaro non è mai salvato");
});

test("auth: un token valido passa, aggiorna last_used_at e dà il principal di fase 1", opts, async () => {
  const admitted = await admit(slugs.a, tokens.connA.token);
  assert.deepEqual(admitted.principal, {
    workspaceId: ids.wsA,
    slug: slugs.a,
    principalKey: `token:${tokens.connA.id}`,
    identityMode: "dichiarata",
    scopes: ["connector:read", "connector:submit"],
    tokenId: tokens.connA.id,
    identityId: null,
  });
  assert.equal(admitted.config.enabled, true);
  assert.deepEqual(admitted.config.allowedOrigins, ["https://claude.ai"]);
  const row = await one(`SELECT last_used_at FROM workspace_integration_tokens WHERE id = $1`, [tokens.connA.id]);
  assert.notEqual(row.last_used_at, null);
  // Con l'Origin ammesso passa anche dal browser.
  const fromBrowser = await gateConnectorRequest(mcpRequest(slugs.a, { token: tokens.connA.token, headers: { origin: "https://claude.ai" } }), slugs.a, app.gateDeps(ON));
  assert.equal(fromBrowser.ok, true);
});

test("auth: 401 JSON senza WWW-Authenticate per assente, revocato, scaduto, uno scope, altro workspace, REST", opts, async () => {
  const cases: Array<[string, string | null, Record<string, string>?]> = [
    ["senza header", null],
    ["schema Basic", null, { authorization: `Basic ${tokens.connA.token}` }],
    ["solo il token", null, { authorization: tokens.connA.token }],
    ["revocato", tokens.revokedA.token],
    ["scaduto", tokens.expiredA.token],
    ["solo connector:read", tokens.readOnlyA.token],
    ["solo connector:submit", tokens.submitOnlyA.token],
    ["altro workspace", tokens.connB.token],
    ["token REST", tokens.restA.token],
  ];
  for (const [label, token, headers] of cases) {
    const response = await expectRejected(mcpRequest(slugs.a, { token, headers }), slugs.a, 401, "unauthorized");
    assert.equal(response.headers.get("www-authenticate"), null, label);
  }
  await expectRejected(mcpRequest("k4-inesistente", { token: tokens.connA.token }), "k4-inesistente", 401, "unauthorized");
  // Un token che non passa non viene toccato.
  const touched = await app.q(
    `SELECT id FROM workspace_integration_tokens WHERE id = ANY($1::uuid[]) AND last_used_at IS NOT NULL`,
    [[tokens.revokedA.id, tokens.expiredA.id, tokens.readOnlyA.id, tokens.submitOnlyA.id, tokens.connB.id, tokens.restA.id]]
  );
  assert.deepEqual(touched, []);
});

test("auth: il token del connettore sulla REST riceve il rifiuto di scope di oggi (403)", opts, async () => {
  const response = await app.handleRest(
    new Request("http://127.0.0.1/api/mcp/portfolio/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.connA.token}` },
      body: JSON.stringify({ idempotencyKey: `k4-${suffix}`, confirmedByUser: true }),
    }),
    { schedule: () => {} }
  );
  assert.equal(response.status, 403);
  assert.deepEqual(await response.json(), { ok: false, error: "forbidden" });
});

test("token nell'indirizzo: 400 senza eco; un token valido diventa «esposto» sulla sua riga, una volta sola, con un solo avviso", opts, async () => {
  const alertsBefore = alerts.length;
  for (const query of [`?token=${tokens.leakA.token}`, `?q=${tokens.leakA.token}`]) {
    await expectRejected(mcpRequest(slugs.a, { token: tokens.leakA.token, query }), slugs.a, 400, "token_in_url");
  }
  // Nel percorso, e con il token di un altro workspace: segnalato nel workspace del token.
  await expectRejected(mcpRequest(tokens.connB.token, {}), tokens.connB.token, 400, "token_in_url");
  // Revocato: già fuori uso, niente segnalazione.
  await expectRejected(mcpRequest(slugs.a, { query: `?apiKey=${tokens.revokedA.token}` }), slugs.a, 400, "token_in_url");

  const flagged = await app.q(
    `SELECT id, workspace_id, revoked_at FROM workspace_integration_tokens WHERE exposed_at IS NOT NULL AND workspace_id = ANY($1::uuid[])`,
    [[ids.wsA, ids.wsB]]
  );
  assert.deepEqual(
    flagged.map((r) => [r.workspace_id, r.id]).sort(),
    [[ids.wsA, tokens.leakA.id], [ids.wsB, tokens.connB.id]].sort()
  );
  // Esposto non vuol dire revocato: la revoca la decide Lateral Space.
  for (const row of flagged) assert.equal(row.revoked_at, null);
  const exposed = await app.integrations.getExposedIntegrationTokenIds(ids.wsA);
  assert.deepEqual([...exposed.keys()], [tokens.leakA.id]);
  assert.ok(exposed.get(tokens.leakA.id) instanceof Date);

  // Un avviso per token (la seconda richiesta con leakA non ne manda un altro), nel
  // canale admin del workspace del token, con il testo fisso.
  const sent = alerts.slice(alertsBefore);
  assert.deepEqual(sent.map((a) => a.channelId).sort(), [ids.wsA, ids.wsB].sort());
  for (const alert of sent) {
    assert.equal(alert.text, exposedTokenAlertText(CONNECTOR_PROVIDER));
    for (const secret of [tokens.leakA.token, tokens.connB.token, hashIntegrationToken(tokens.leakA.token), tokens.leakA.id]) {
      assert.equal(alert.text.includes(secret), false);
    }
  }
});

test("token esposto: nessun segnale in campanella o Intelligence, per nessun membro; chi segna letto non spegne lo stato", opts, async () => {
  // La campanella e Intelligence leggono getSignalsByWorkspace per ogni membro (tranne chi segue solo i corsi).
  for (const workspaceId of [ids.wsA, ids.wsB]) {
    const feed = await app.signals.getSignalsByWorkspace(workspaceId, 50);
    assert.deepEqual(feed.filter((s) => s.signalType === "connector_token_exposed" || s.relatedEntityId === tokens.leakA.id), []);
  }
  const rows = await one(`SELECT count(*)::int AS n FROM weekly_signals WHERE workspace_id = ANY($1::uuid[])`, [[ids.wsA, ids.wsB]]);
  assert.equal(Number(rows.n), 0);
  // «Segna tutto come letto» di un membro qualunque tocca solo weekly_signals: lo stato resta.
  await app.q(`UPDATE weekly_signals SET is_read = true WHERE workspace_id = $1`, [ids.wsA]);
  assert.ok((await app.integrations.getExposedIntegrationTokenIds(ids.wsA)).has(tokens.leakA.id));
});

test("token esposto: 10 richieste contemporanee con lo stesso token → una sola segnalazione e un solo avviso", opts, async () => {
  const hash = hashIntegrationToken(tokens.raceC.token);
  const results = await Promise.all(Array.from({ length: 10 }, () => app.integrations.markIntegrationTokenExposed(hash)));
  assert.deepEqual(results.filter(Boolean), [{ tokenId: tokens.raceC.id, workspaceId: ids.wsC, provider: CONNECTOR_PROVIDER }]);

  // Una classe con l'indirizzo sbagliato: 10 richieste insieme dall'ingresso vero.
  const alertsBefore = alerts.length;
  await Promise.all(
    Array.from({ length: 10 }, () =>
      expectRejected(mcpRequest(slugs.c, { query: `?token=${tokens.classC.token}` }), slugs.c, 400, "token_in_url")
    )
  );
  assert.deepEqual(alerts.slice(alertsBefore).map((a) => a.channelId), [ids.wsC]);
  const row = await one(`SELECT exposed_at, revoked_at FROM workspace_integration_tokens WHERE id = $1`, [tokens.classC.id]);
  assert.notEqual(row.exposed_at, null);
  assert.equal(row.revoked_at, null);
});

test("elenchi: la card v1 non vede i token del connettore; la scheda del connettore li vede con lo stato «esposto»", opts, async () => {
  const fresh = await app.integrations.createConnectorIntegrationToken({ workspaceId: ids.wsA, label: "Nuovo connettore", createdByUserId: ids.user });
  const v1 = await app.integrations.getWorkspaceIntegrationTokens(ids.wsA);
  assert.deepEqual(v1.map((t) => [t.id, t.provider]), [[tokens.restA.id, "claude_mcp"]]);

  const connector = await app.integrations.getConnectorIntegrationTokens(ids.wsA);
  const connectorIds = connector.map((t) => t.id).sort();
  const expected = [fresh.row.id, ...(["connA", "connA2", "leakA", "revokedA", "readOnlyA", "submitOnlyA", "expiredA"] as const).map((n) => tokens[n].id)].sort();
  assert.deepEqual(connectorIds, expected);
  for (const token of connector) {
    assert.equal(token.provider, CONNECTOR_PROVIDER);
    assert.equal(token.exposedAt instanceof Date, token.id === tokens.leakA.id, token.label);
    assert.equal("tokenHash" in token, false);
  }

  const both = await app.integrations.getWorkspaceIntegrationTokens(ids.wsA, { providers: ["claude_mcp", CONNECTOR_PROVIDER] });
  assert.equal(both.length, expected.length + 1);
  assert.deepEqual(await app.integrations.getWorkspaceIntegrationTokens(ids.wsA, { providers: [] }), []);
});

test("canale admin di Slack: lo dà il workspace con l'installazione e il canale scelto, gli altri no", opts, async () => {
  await app.q(`INSERT INTO slack_installations (workspace_id, slack_team_id, bot_token, notify_channel_id) VALUES ($1, $2, $3, 'C0K4PROVA')`, [
    ids.wsA,
    `T-k4-a-${suffix}`,
    BOT_TOKEN,
  ]);
  await app.q(`INSERT INTO slack_installations (workspace_id, slack_team_id, bot_token) VALUES ($1, $2, $3)`, [ids.wsB, `T-k4-b-${suffix}`, BOT_TOKEN]);
  assert.deepEqual(await app.slackAlertDeps.findAdminChannel(ids.wsA), { channelId: "C0K4PROVA", botToken: BOT_TOKEN });
  assert.equal(await app.slackAlertDeps.findAdminChannel(ids.wsB), null, "Slack senza canale scelto");
  assert.equal(await app.slackAlertDeps.findAdminChannel(ids.wsC), null, "Slack non installato");
});

test("interruttori: MCP_CONNECTOR_ENABLED spento → 404; connettore sospeso → passa e i tool dicono connector_disabled", opts, async () => {
  for (const env of [{}, { MCP_CONNECTOR_ENABLED: "false" }]) {
    for (const method of ["POST", "GET", "DELETE"]) {
      await expectRejected(mcpRequest(slugs.a, { token: tokens.connA.token, method }), slugs.a, 404, "not_found", env);
    }
  }
  for (const method of ["GET", "DELETE"]) {
    const response = await expectRejected(mcpRequest(slugs.a, { token: tokens.connA.token, method }), slugs.a, 405, "method_not_allowed");
    assert.equal(response.headers.get("allow"), "POST");
  }
  const suspended = await admit(slugs.b, tokens.connB.token);
  assert.equal(suspended.config.enabled, false);
  const { connectorSuspendedError } = await import("./config.ts");
  assert.equal(connectorSuspendedError(suspended.config)?.error, "connector_disabled");
});

test("modalità oauth: 401 con WWW-Authenticate e i metadati della risorsa", opts, async () => {
  const response = await expectRejected(mcpRequest(slugs.c, { token: tokens.connC.token }), slugs.c, 401, "unauthorized");
  assert.equal(
    response.headers.get("www-authenticate"),
    `Bearer resource_metadata="https://www.theunbundle.com/.well-known/oauth-protected-resource/api/mcp/connettore/${slugs.c}"`
  );
});

test("igiene HTTP: Origin non ammesso 403, Content-Type 415, corpo oltre 256 KB 413", opts, async () => {
  const token = tokens.connA.token;
  await expectRejected(mcpRequest(slugs.a, { token, headers: { origin: "https://evil.test" } }), slugs.a, 403, "origin_not_allowed");
  await expectRejected(mcpRequest(slugs.b, { token: tokens.connB.token, headers: { origin: "https://claude.ai" } }), slugs.b, 403, "origin_not_allowed");
  await expectRejected(mcpRequest(slugs.a, { token, headers: { "content-type": "text/plain" } }), slugs.a, 415, "unsupported_media_type");
  await expectRejected(
    mcpRequest(slugs.a, { token, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", pad: "x".repeat(MCP_BODY_MAX_BYTES) }) }),
    slugs.a,
    413,
    "payload_too_large"
  );
  await expectRejected(mcpRequest(slugs.a, { token, body: "{ non json" }), slugs.a, 400, "invalid_json");
});

/** Una sessione di Claude: handshake, elenco dei tool, guida, due ricerche, un invio, uno stato. */
function session(i: number) {
  const call = (id: number, name: string, args: Record<string, unknown> = {}) => ({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  return [
    { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: `persona-${i}`, version: "1" } } },
    { jsonrpc: "2.0", method: "notifications/initialized" },
    { jsonrpc: "2.0", id: 2, method: "tools/list" },
    call(3, "get_intake_guide"),
    call(4, "find_similar_contributions", { query: "verbali riunioni" }),
    call(5, "find_similar_contributions", { query: "note spese" }),
    call(6, "submit_contribution", { title: PAYLOAD_TEXT }),
    call(7, "get_contribution_status", { code: "XA-0001" }),
  ];
}

async function bucketCount(bucket: string) {
  const row = await one(`SELECT coalesce(sum(count), 0)::int AS n FROM connector_rate_limits WHERE bucket = $1`, [bucket]);
  return Number(row.n);
}

/**
 * Il percorso che la rotta (K5) seguirà: consuma il limite solo se
 * `rateLimitKindForMessage` dà un tipo, cioè solo per `tools/call`. Qui si prova
 * l'ingresso con la classificazione e il secchio vero; la prova sulla rotta vera
 * (transport e handler dell'SDK: zero righe dopo initialize e tools/list, una dopo
 * un tools/call) è un test d'integrazione di K5.
 */
async function consumeLikeTheRoute(slug: string, token: string, message: unknown) {
  const gate = await admit(slug, token, message);
  if (rateLimitKindForMessage(gate.body) === null) return null;
  const tool = (gate.body as { params: { name: string } }).params.name;
  return consumeConnectorRateLimit(app.exec, { principal: gate.principal, tool, limits: gate.config.limits });
}

test("limite, ingresso e classificazione (la rotta vera è di K5): initialize, notifiche e tools/list restano fuori dal secchio, tools/call no", opts, async () => {
  const { principal, config } = await admit(slugs.a, tokens.connA2.token);
  for (let i = 0; i < 5; i += 1) {
    for (const message of session(i).slice(0, 3)) {
      assert.equal(await consumeLikeTheRoute(slugs.a, tokens.connA2.token, message), null);
    }
  }
  const rows = await app.q(`SELECT bucket FROM connector_rate_limits WHERE bucket LIKE $1`, [`%${tokens.connA2.id}%`]);
  assert.deepEqual(rows, []);
  // Controllo positivo: una tools/call per lo stesso percorso consuma una volta il secchio delle letture.
  assert.deepEqual(await consumeLikeTheRoute(slugs.a, tokens.connA2.token, session(0)[3]), { ok: true });
  assert.equal(await bucketCount(`conn:${tokens.connA2.id}:read`), 1);
  assert.equal(await bucketCount(`conn:${tokens.connA2.id}:submit`), 0);
  assert.equal(config.limits.submitsPerHour, 200);
  assert.equal(principal.tokenId, tokens.connA2.id);
});

test("limite: 30 persone nella stessa ora sullo stesso token, ognuna con guida, due ricerche, un invio e uno stato → mai rate_limited", opts, async () => {
  let calls = 0;
  for (let i = 0; i < 30; i += 1) {
    for (const message of session(i)) {
      const result = await consumeLikeTheRoute(slugs.a, tokens.connA.token, message);
      if (result === null) continue;
      assert.deepEqual(result, { ok: true }, `persona ${i}, messaggio ${JSON.stringify((message as { id?: number }).id)}`);
      calls += 1;
    }
  }
  assert.equal(calls, 150);
  assert.equal(await bucketCount(`conn:${tokens.connA.id}:read`), 120);
  assert.equal(await bucketCount(`conn:${tokens.connA.id}:submit`), 30);
  assert.equal(await bucketCount(`conn:ws:${ids.wsA}:submit:day`), 30);
});

test("limite: il 201° invio nell'ora dalla stessa credenziale → rate_limited con retryAfterSeconds; le letture restano libere", opts, async () => {
  const { principal, config } = await admit(slugs.a, tokens.connA2.token);
  const submit = () => consumeConnectorRateLimit(app.exec, { principal, tool: "submit_contribution", limits: config.limits });
  for (let i = 1; i <= 200; i += 1) assert.deepEqual(await submit(), { ok: true }, `invio ${i}`);
  const limited = await submit();
  assert.equal(limited.ok, false);
  if (limited.ok) return;
  assert.equal(limited.error.error, "rate_limited");
  const retry = limited.error.retryAfterSeconds ?? 0;
  const now = new Date();
  const toNextHour = 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds());
  assert.ok(retry > 0 && retry <= 3600, String(retry));
  assert.ok(Math.abs(retry - toNextHour) <= 5, `${retry} vs ${toNextHour}`);
  // Il 202° è respinto e nessuno dei due ha consumato.
  assert.equal((await submit()).ok, false);
  assert.equal(await bucketCount(`conn:${tokens.connA2.id}:submit`), 200);
  assert.equal(await bucketCount(`conn:ws:${ids.wsA}:submit:day`), 230);
  assert.deepEqual(await consumeConnectorRateLimit(app.exec, { principal, tool: "get_contribution_status", limits: config.limits }), { ok: true });
});

test("limite: il secchio del giorno vale per tutto il workspace, fino alla mezzanotte italiana", opts, async () => {
  const principal = { workspaceId: ids.wsC, tokenId: tokens.connC.id, identityId: null };
  const { resolveConnectorLimits } = await import("./config.ts");
  const limits = resolveConnectorLimits({ submitsPerDayWorkspace: 3 });
  for (let i = 0; i < 3; i += 1) {
    assert.deepEqual(await consumeConnectorRateLimit(app.exec, { principal, tool: "submit_contribution", limits }), { ok: true });
  }
  const limited = await consumeConnectorRateLimit(app.exec, { principal, tool: "submit_contribution", limits });
  assert.equal(limited.ok, false);
  if (limited.ok) return;
  assert.equal(limited.error.error, "rate_limited");
  const retry = limited.error.retryAfterSeconds ?? 0;
  // Fino alla prossima mezzanotte di Roma: al massimo 25 ore (il giorno del ritorno all'ora solare).
  assert.ok(retry > 0 && retry <= 90_000, String(retry));
  const midnight = await one(
    `SELECT ceil(extract(epoch FROM (((date_trunc('day', now(), 'Europe/Rome') AT TIME ZONE 'Europe/Rome') + interval '1 day') AT TIME ZONE 'Europe/Rome' - now())))::int AS s`
  );
  assert.ok(Math.abs(retry - Number(midnight.s)) <= 5, `${retry} vs ${midnight.s}`);
  assert.equal(await bucketCount(`conn:${tokens.connC.id}:submit`), 3, "il secchio dell'ora non ha contato l'invio respinto");
});

/** Inizi delle finestre salvate per un secchio, in UTC. */
async function windowStarts(bucket: string) {
  const rows = await app.q(
    `SELECT to_char(window_start AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI"Z"') AS w, count FROM connector_rate_limits WHERE bucket = $1 ORDER BY window_start`,
    [bucket]
  );
  return rows.map((r) => `${r.w}=${r.count}`);
}

test("limite: il giorno in ora italiana ricomincia a mezzanotte di Roma, anche nei cambi d'ora di ottobre e marzo", opts, async () => {
  const consumeAt = (rules: RateLimitRule[], iso: string) => consumeRateLimits(app.exec, rules, { random: () => 0.99, at: new Date(iso) });
  const retryAt = async (rules: RateLimitRule[], iso: string) => {
    const decision = await consumeAt(rules, iso);
    assert.equal(decision.ok, false, iso);
    return decision.ok ? 0 : decision.retryAfterSeconds;
  };

  // Ottobre 2026: domenica 25 dura 25 ore (alle 03:00 CEST si torna alle 02:00 CET, 01:00 UTC).
  const october: RateLimitRule[] = [{ bucket: `test:${suffix}:rome-oct`, window: "day", limit: 1, timeZone: "Europe/Rome" }];
  assert.deepEqual(await consumeAt(october, "2026-10-24T21:59:59Z"), { ok: true }, "sabato 23:59:59 CEST");
  assert.equal(await retryAt(october, "2026-10-24T21:59:59Z"), 1);
  assert.deepEqual(await consumeAt(october, "2026-10-24T22:00:00Z"), { ok: true }, "domenica 00:00 CEST: giorno nuovo");
  assert.equal(await retryAt(october, "2026-10-24T22:00:00Z"), 90_000, "un giorno di 25 ore");
  assert.equal(await retryAt(october, "2026-10-25T00:30:00Z"), 81_000, "02:30 CEST, prima del cambio");
  assert.equal(await retryAt(october, "2026-10-25T01:30:00Z"), 77_400, "02:30 CET, dopo il cambio");
  assert.equal(await retryAt(october, "2026-10-25T22:59:59Z"), 1, "domenica 23:59:59 CET");
  assert.deepEqual(await consumeAt(october, "2026-10-25T23:00:00Z"), { ok: true }, "lunedì 00:00 CET");
  // La mezzanotte UTC non fa ricominciare nulla: lunedì 01:00 CET è ancora lunedì in Italia.
  assert.equal(await retryAt(october, "2026-10-26T00:00:00Z"), 82_800);
  assert.deepEqual(await windowStarts(october[0].bucket), ["2026-10-23T22:00Z=1", "2026-10-24T22:00Z=1", "2026-10-25T23:00Z=1"]);

  // Marzo 2027: domenica 28 dura 23 ore (alle 02:00 CET si passa alle 03:00 CEST, 01:00 UTC).
  const march: RateLimitRule[] = [{ bucket: `test:${suffix}:rome-mar`, window: "day", limit: 1, timeZone: "Europe/Rome" }];
  assert.deepEqual(await consumeAt(march, "2027-03-27T22:59:59Z"), { ok: true }, "sabato 23:59:59 CET");
  assert.deepEqual(await consumeAt(march, "2027-03-27T23:00:00Z"), { ok: true }, "domenica 00:00 CET: giorno nuovo");
  assert.equal(await retryAt(march, "2027-03-27T23:00:00Z"), 82_800, "un giorno di 23 ore");
  assert.equal(await retryAt(march, "2027-03-28T00:59:59Z"), 75_601, "01:59:59 CET, prima del cambio");
  assert.equal(await retryAt(march, "2027-03-28T01:00:00Z"), 75_600, "03:00 CEST, dopo il cambio");
  assert.equal(await retryAt(march, "2027-03-28T21:59:59Z"), 1, "domenica 23:59:59 CEST");
  assert.deepEqual(await consumeAt(march, "2027-03-28T22:00:00Z"), { ok: true }, "lunedì 00:00 CEST");
  assert.deepEqual(await windowStarts(march[0].bucket), ["2027-03-26T23:00Z=1", "2027-03-27T23:00Z=1", "2027-03-28T22:00Z=1"]);

  // Le finestre di un'ora restano in UTC e di 3.600 secondi, anche nella notte del cambio.
  const hour: RateLimitRule[] = [{ bucket: `test:${suffix}:hour-oct`, window: "hour", limit: 1 }];
  assert.deepEqual(await consumeAt(hour, "2026-10-25T00:30:00Z"), { ok: true });
  assert.equal(await retryAt(hour, "2026-10-25T00:59:30Z"), 30);
  assert.deepEqual(await consumeAt(hour, "2026-10-25T01:00:00Z"), { ok: true });
});

test("limite: il secchio giornaliero del workspace si azzera alla mezzanotte di Roma, non a quella UTC", opts, async () => {
  const principal = { workspaceId: ids.wsDay, tokenId: ids.tokenDay, identityId: null };
  const { resolveConnectorLimits } = await import("./config.ts");
  const limits = resolveConnectorLimits({ submitsPerDayWorkspace: 1 });
  const submitAt = (iso: string) =>
    consumeConnectorRateLimit(app.exec, { principal, tool: "submit_contribution", limits }, { random: () => 0.99, at: new Date(iso) });
  assert.deepEqual(await submitAt("2026-10-25T22:30:00Z"), { ok: true }, "domenica 23:30 CET");
  const full = await submitAt("2026-10-25T22:45:00Z");
  assert.deepEqual(full, { ok: false, error: { error: "rate_limited", message: "Troppe richieste in poco tempo: riprova più tardi.", retryAfterSeconds: 900 } });
  // Stesso giorno UTC (25 ottobre), ma in Italia è lunedì: il secchio ricomincia.
  assert.deepEqual(await submitAt("2026-10-25T23:00:00Z"), { ok: true }, "lunedì 00:00 CET");
  // La mezzanotte UTC (lunedì 01:00 CET) non lo azzera.
  const sameDay = await submitAt("2026-10-26T00:00:00Z");
  assert.equal(sameDay.ok, false);
  assert.equal(!sameDay.ok && sameDay.error.retryAfterSeconds, 82_800);
  assert.deepEqual(await windowStarts(`conn:ws:${ids.wsDay}:submit:day`), ["2026-10-24T22:00Z=1", "2026-10-25T23:00Z=1"]);
});

test("limite: con l'ora del token e il giorno del workspace pieni si riprova alla mezzanotte di Roma", opts, async () => {
  const principal = { workspaceId: ids.wsBoth, tokenId: ids.tokenBoth, identityId: null };
  const { resolveConnectorLimits } = await import("./config.ts");
  const limits = resolveConnectorLimits({ submitsPerHour: 1, submitsPerDayWorkspace: 1 });
  const submitAt = (iso: string) =>
    consumeConnectorRateLimit(app.exec, { principal, tool: "submit_contribution", limits }, { random: () => 0.99, at: new Date(iso) });
  const retryAt = async (iso: string) => {
    const decision = await submitAt(iso);
    assert.equal(decision.ok, false, iso);
    return decision.ok ? 0 : decision.error.retryAfterSeconds;
  };
  assert.deepEqual(await submitAt("2026-10-26T00:10:00Z"), { ok: true }, "lunedì 01:10 CET");
  // L'ora finisce fra 40 minuti, il giorno di Roma alle 23:00 UTC: vale il giorno.
  assert.equal(await retryAt("2026-10-26T00:20:00Z"), 81_600, "01:20 CET, ora e giorno pieni");
  // Dopo la fine dell'ora il giorno è ancora pieno: lo diceva già la risposta di prima.
  assert.equal(await retryAt("2026-10-26T01:00:00Z"), 79_200, "02:00 CET, solo il giorno pieno");
  assert.deepEqual(await submitAt("2026-10-26T23:00:00Z"), { ok: true }, "martedì 00:00 CET");
  assert.deepEqual(await windowStarts(`conn:${ids.tokenBoth}:submit`), ["2026-10-26T00:00Z=1", "2026-10-26T23:00Z=1"]);
  assert.deepEqual(await windowStarts(`conn:ws:${ids.wsBoth}:submit:day`), ["2026-10-25T23:00Z=1", "2026-10-26T23:00Z=1"]);
});

test("limite: richieste concorrenti non superano mai il limite", opts, async () => {
  const rules = [{ bucket: `test:${suffix}:race`, window: "hour" as const, limit: 10 }];
  const results = await Promise.all(Array.from({ length: 25 }, () => consumeRateLimits(app.exec, rules, { random: () => 0.99 })));
  assert.equal(results.filter((r) => r.ok).length, 10);
  for (const r of results) if (!r.ok) assert.ok(r.retryAfterSeconds > 0);
});

test("limite: la pulizia cancella le finestre più vecchie di 48 ore", opts, async () => {
  await app.q(
    `INSERT INTO connector_rate_limits (bucket, window_start, count) VALUES ($1, now() - interval '3 days', 5), ($2, now() - interval '1 day', 5)`,
    [`test:${suffix}:old`, `test:${suffix}:recent`]
  );
  const result = await consumeRateLimits(app.exec, [{ bucket: `test:${suffix}:tick`, window: "minute", limit: 5 }], { random: () => 0 });
  assert.deepEqual(result, { ok: true });
  const left = await app.q(`SELECT bucket FROM connector_rate_limits WHERE bucket = ANY($1::text[]) ORDER BY bucket`, [
    [`test:${suffix}:old`, `test:${suffix}:recent`, `test:${suffix}:tick`],
  ]);
  assert.deepEqual(left.map((r) => r.bucket), [`test:${suffix}:recent`, `test:${suffix}:tick`]);
});

test("log: un errore vero del database con il token nel messaggio non lo porta nel log", opts, async () => {
  const before = captured.length;
  const leaky: SqlExecutor = (text, params) => {
    void text;
    void params;
    return app.exec("SELECT $1::integer AS n", [tokens.connA.token]);
  };
  const result = await consumeConnectorRateLimit(leaky, { principal: { workspaceId: ids.wsA, tokenId: tokens.connA.id, identityId: null }, tool: "submit_contribution", limits: (await admit(slugs.a, tokens.connA.token)).config.limits });
  assert.equal(result.ok, false);
  assert.equal(!result.ok && result.error.error, "internal_error");
  const lines = captured.slice(before);
  assert.equal(lines.length, 1);
  assert.match(lines[0], /\[connector\] rate_limit_failed/);
});

test("log: in tutta la suite nessun token, hash o testo della segnalazione", opts, () => {
  const secrets = [...Object.values(tokens).flatMap((t) => [t.token, hashIntegrationToken(t.token)]), BOT_TOKEN];
  for (const line of captured) {
    for (const secret of secrets) assert.equal(line.includes(secret), false);
    assert.equal(line.includes(PAYLOAD_TEXT), false);
  }
});
