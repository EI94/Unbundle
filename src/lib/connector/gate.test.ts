import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { CONNECTOR_SCOPES, CONNECTOR_TOKEN_PREFIX, hashIntegrationToken } from "./auth.ts";
import type { ConnectorConfigRow } from "./config.ts";
import { gateConnectorRequest, type ConnectorGateDeps } from "./gate.ts";
import { MCP_BODY_MAX_BYTES } from "./http-hygiene.ts";

// Prompt WP4 e WP10 (auth, igiene, interruttori, log) con dipendenze finte.
// La stessa catena sul database locale è in `access.integration.test.ts`.

const fakeToken = () => `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
const SLUG = "prova-a";
const URL_A = `https://www.theunbundle.com/api/mcp/connettore/${SLUG}`;
const BODY = { jsonrpc: "2.0", id: 1, method: "tools/list" };
const PAYLOAD_TEXT = "Verbali automatici di Persona Inventata";

function configRow(patch: Partial<ConnectorConfigRow> = {}): ConnectorConfigRow {
  return {
    workspaceId: "11111111-1111-4111-8111-111111111111",
    slug: SLUG,
    enabled: true,
    codePrefix: "XX",
    identityMode: "dichiarata",
    authMode: "header",
    workspaceDisplayName: "Organizzazione di prova",
    guide: null,
    guideVersion: null,
    allowedOrigins: ["https://claude.ai"],
    limits: {},
    esgEnabled: false,
    ...patch,
  };
}

function setup(opts: { config?: ConnectorConfigRow | null; env?: Record<string, string | undefined>; validToken?: string; throwOn?: "config" | "auth" | "exposed" } = {}) {
  const calls = { loadConfig: 0, authenticate: [] as Array<{ tokenHash: string; workspaceId: string; requiredScopes: readonly string[] }>, exposed: [] as string[] };
  const logs: string[] = [];
  const tokenId = randomUUID();
  const config = opts.config === undefined ? configRow() : opts.config;
  const deps: ConnectorGateDeps = {
    env: opts.env ?? { MCP_CONNECTOR_ENABLED: "true" },
    async loadConfig(slug) {
      calls.loadConfig += 1;
      if (opts.throwOn === "config") throw Object.assign(new Error(`timeout leggendo ${slug} ${PAYLOAD_TEXT}`), { code: "57014" });
      return config && config.slug === slug ? config : null;
    },
    async authenticateToken(input) {
      calls.authenticate.push(input);
      if (opts.throwOn === "auth") throw Object.assign(new Error(`errore per ${input.tokenHash}`), { code: "08006" });
      if (opts.validToken && input.tokenHash === hashIntegrationToken(opts.validToken) && input.workspaceId === config?.workspaceId) {
        return { id: tokenId, scopes: ["connector:read", "connector:submit"] };
      }
      return null;
    },
    async markTokenExposed(hash) {
      calls.exposed.push(hash);
      if (opts.throwOn === "exposed") throw new Error(`non riuscito ${hash}`);
    },
    log: { error: (...args: unknown[]) => logs.push(args.map(String).join(" ")) },
  };
  return { deps, calls, logs, tokenId };
}

function request(url = URL_A, init: { method?: string; headers?: Record<string, string>; body?: string | null } = {}) {
  return new Request(url, {
    method: init.method ?? "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...init.headers },
    body: init.body === undefined ? JSON.stringify(BODY) : init.body,
  });
}

async function rejectedWith(result: Awaited<ReturnType<typeof gateConnectorRequest>>, status: number, error: string) {
  assert.equal(result.ok, false);
  if (result.ok) return null;
  assert.equal(result.response.status, status);
  assert.equal(result.outcome, error);
  assert.equal(result.response.headers.get("cache-control"), "no-store");
  assert.equal(result.response.headers.get("x-content-type-options"), "nosniff");
  const text = await result.response.text();
  assert.equal(text, JSON.stringify({ error }));
  return result.response;
}

test("token valido: principal di fase 1, configurazione e corpo; si cercano entrambi gli scope nel workspace dello slug", async () => {
  const token = fakeToken();
  const { deps, calls, tokenId } = setup({ validToken: token });
  const result = await gateConnectorRequest(request(URL_A, { headers: { authorization: `Bearer ${token}`, origin: "https://claude.ai" } }), SLUG, deps);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.deepEqual(result.body, BODY);
  assert.deepEqual(result.principal, {
    workspaceId: configRow().workspaceId,
    slug: SLUG,
    principalKey: `token:${tokenId}`,
    identityMode: "dichiarata",
    scopes: ["connector:read", "connector:submit"],
    tokenId,
    identityId: null,
  });
  assert.equal(result.config.enabled, true);
  assert.deepEqual(calls.authenticate, [{ tokenHash: hashIntegrationToken(token), workspaceId: configRow().workspaceId, requiredScopes: CONNECTOR_SCOPES }]);
  assert.deepEqual(calls.exposed, []);
});

test("MCP_CONNECTOR_ENABLED spento: 404 per ogni metodo, senza toccare il database", async () => {
  for (const env of [{}, { MCP_CONNECTOR_ENABLED: "false" }]) {
    const { deps, calls } = setup({ env, validToken: fakeToken() });
    for (const method of ["POST", "GET", "DELETE"]) {
      await rejectedWith(await gateConnectorRequest(request(URL_A, { method, body: method === "POST" ? undefined : null }), SLUG, deps), 404, "not_found");
    }
    assert.equal(calls.loadConfig, 0);
    assert.equal(calls.authenticate.length, 0);
  }
});

test("GET e DELETE: 405 con Allow: POST", async () => {
  const { deps } = setup();
  for (const method of ["GET", "DELETE", "PUT"]) {
    const response = await rejectedWith(await gateConnectorRequest(request(URL_A, { method, body: null }), SLUG, deps), 405, "method_not_allowed");
    assert.equal(response?.headers.get("allow"), "POST");
  }
});

test("token nell'indirizzo: 400 senza eco, segnalato come esposto solo per hash, prima di ogni altra cosa", async () => {
  const token = fakeToken();
  const { deps, calls, logs } = setup({ validToken: token });
  for (const url of [`${URL_A}?token=${token}`, `${URL_A}?q=${token}`, `https://www.theunbundle.com/api/mcp/connettore/${token}`]) {
    const result = await gateConnectorRequest(request(url, { headers: { authorization: `Bearer ${token}` } }), SLUG, deps);
    const response = await rejectedWith(result, 400, "token_in_url");
    assert.equal(response?.headers.get("location"), null);
  }
  assert.deepEqual(calls.exposed, [hashIntegrationToken(token), hashIntegrationToken(token), hashIntegrationToken(token)]);
  assert.equal(calls.loadConfig, 0);
  assert.equal(calls.authenticate.length, 0);
  // Un nome da credenziale senza un token riconoscibile: 400, niente da segnalare.
  await rejectedWith(await gateConnectorRequest(request(`${URL_A}?apiKey=qualcosa`), SLUG, deps), 400, "token_in_url");
  assert.equal(calls.exposed.length, 3);
  assert.deepEqual(logs, []);

  const failing = setup({ throwOn: "exposed" });
  await rejectedWith(await gateConnectorRequest(request(`${URL_A}?token=${token}`), SLUG, failing.deps), 400, "token_in_url");
  assert.equal(failing.logs.length, 1);
  assert.match(failing.logs[0], /exposed_token_flag_failed/);
  assert.equal(failing.logs[0].includes(token), false);
  assert.equal(failing.logs[0].includes(hashIntegrationToken(token)), false);
});

test("401 JSON senza WWW-Authenticate: senza header, schema sbagliato, token sconosciuto, slug inesistente", async () => {
  const token = fakeToken();
  const other = fakeToken();
  const { deps, calls } = setup({ validToken: token });
  const cases: Array<[Request, string]> = [
    [request(), SLUG],
    [request(URL_A, { headers: { authorization: token } }), SLUG],
    [request(URL_A, { headers: { authorization: `Basic ${token}` } }), SLUG],
    [request(URL_A, { headers: { "x-api-key": token } }), SLUG],
    [request(URL_A, { headers: { cookie: `token=${token}` } }), SLUG],
    [request(URL_A, { body: JSON.stringify({ ...BODY, token }) }), SLUG],
    [request(URL_A, { headers: { authorization: `Bearer ${other}` } }), SLUG],
    [request("https://www.theunbundle.com/api/mcp/connettore/altro-slug", { headers: { authorization: `Bearer ${token}` } }), "altro-slug"],
    [request("https://www.theunbundle.com/api/mcp/connettore/Slug_Non_Valido", { headers: { authorization: `Bearer ${token}` } }), "Slug_Non_Valido"],
  ];
  for (const [req, slug] of cases) {
    const response = await rejectedWith(await gateConnectorRequest(req, slug, deps), 401, "unauthorized");
    assert.equal(response?.headers.get("www-authenticate"), null);
  }
  // Solo il token sconosciuto con lo schema giusto arriva al database.
  assert.deepEqual(calls.authenticate.map((c) => c.tokenHash), [hashIntegrationToken(other)]);
});

test("scope parziali restituiti per errore dal database: 401 lo stesso", async () => {
  const token = fakeToken();
  const { deps } = setup({ validToken: token });
  deps.authenticateToken = async () => ({ id: randomUUID(), scopes: ["connector:read"] });
  await rejectedWith(await gateConnectorRequest(request(URL_A, { headers: { authorization: `Bearer ${token}` } }), SLUG, deps), 401, "unauthorized");
});

test("modalità oauth (fase 2, spenta): 401 con WWW-Authenticate e i metadati della risorsa", async () => {
  const token = fakeToken();
  const { deps, calls } = setup({ validToken: token, config: configRow({ authMode: "oauth" }) });
  const response = await rejectedWith(await gateConnectorRequest(request(URL_A, { headers: { authorization: `Bearer ${token}` } }), SLUG, deps), 401, "unauthorized");
  assert.equal(
    response?.headers.get("www-authenticate"),
    `Bearer resource_metadata="https://www.theunbundle.com/.well-known/oauth-protected-resource/api/mcp/connettore/${SLUG}"`
  );
  assert.equal(calls.authenticate.length, 0);
});

test("igiene: Origin non ammesso 403, Content-Type 415, corpo oltre 256 KB 413, JSON non valido 400", async () => {
  const token = fakeToken();
  const { deps } = setup({ validToken: token });
  const auth = { authorization: `Bearer ${token}` };
  await rejectedWith(await gateConnectorRequest(request(URL_A, { headers: { ...auth, origin: "https://evil.test" } }), SLUG, deps), 403, "origin_not_allowed");
  await rejectedWith(await gateConnectorRequest(request(URL_A, { headers: { ...auth, origin: "null" } }), SLUG, deps), 403, "origin_not_allowed");
  await rejectedWith(await gateConnectorRequest(request(URL_A, { headers: { ...auth, "content-type": "text/plain" } }), SLUG, deps), 415, "unsupported_media_type");
  await rejectedWith(
    await gateConnectorRequest(request(URL_A, { headers: { ...auth, "content-length": String(MCP_BODY_MAX_BYTES + 1) } }), SLUG, deps),
    413,
    "payload_too_large"
  );
  const big = JSON.stringify({ ...BODY, pad: "x".repeat(MCP_BODY_MAX_BYTES) });
  await rejectedWith(await gateConnectorRequest(request(URL_A, { headers: auth, body: big }), SLUG, deps), 413, "payload_too_large");
  await rejectedWith(await gateConnectorRequest(request(URL_A, { headers: auth, body: "{ non json" }), SLUG, deps), 400, "invalid_json");

  // Con l'elenco vuoto ogni Origin presente si rifiuta, anche quello di claude.ai.
  const closed = setup({ validToken: token, config: configRow({ allowedOrigins: [] }) });
  await rejectedWith(await gateConnectorRequest(request(URL_A, { headers: { ...auth, origin: "https://claude.ai" } }), SLUG, closed.deps), 403, "origin_not_allowed");
  assert.equal((await gateConnectorRequest(request(URL_A, { headers: auth }), SLUG, closed.deps)).ok, true);
});

test("una richiesta senza credenziale non fa leggere il corpo", async () => {
  const { deps } = setup();
  const req = request(URL_A, { body: JSON.stringify({ ...BODY, pad: "x".repeat(1000) }) });
  await rejectedWith(await gateConnectorRequest(req, SLUG, deps), 401, "unauthorized");
  assert.equal(req.bodyUsed, false);
});

test("connettore sospeso: il gate passa (i tool rispondono connector_disabled)", async () => {
  const token = fakeToken();
  const { deps } = setup({ validToken: token, config: configRow({ enabled: false }) });
  const result = await gateConnectorRequest(request(URL_A, { headers: { authorization: `Bearer ${token}` } }), SLUG, deps);
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.config.enabled, false);
});

test("errori del database: 500 internal_error, log senza token, hash, slug sbagliati o testi", async () => {
  const token = fakeToken();
  for (const throwOn of ["config", "auth"] as const) {
    const { deps, logs } = setup({ validToken: token, throwOn });
    const body = JSON.stringify({ ...BODY, params: { title: PAYLOAD_TEXT } });
    await rejectedWith(await gateConnectorRequest(request(URL_A, { headers: { authorization: `Bearer ${token}` }, body }), SLUG, deps), 500, "internal_error");
    assert.equal(logs.length, 1, throwOn);
    for (const leaked of [token, hashIntegrationToken(token), PAYLOAD_TEXT, "timeout", "errore per"]) {
      assert.equal(logs[0].includes(leaked), false, `${throwOn}: ${leaked.slice(0, 12)}`);
    }
  }
});
