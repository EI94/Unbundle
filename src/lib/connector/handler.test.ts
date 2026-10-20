import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { LATEST_PROTOCOL_VERSION } from "@modelcontextprotocol/sdk/types.js";
import { CONNECTOR_TOKEN_PREFIX, hashIntegrationToken } from "./auth.ts";
import type { ConnectorConfigRow } from "./config.ts";
import { buildToolInputSchemas, CONNECTOR_TOOL_NAMES } from "./contract.ts";
import {
  EXAMPLE_CONNECTOR_PROFILE_INPUT,
  EXAMPLE_INSTRUCTIONS_TEMPLATE,
  EXAMPLE_PROFILE,
  EXAMPLE_TOOL_TEXTS,
  exampleSubmission,
} from "./contract.fixtures.ts";
import type { ConnectorGateDeps } from "./gate.ts";
import { handleConnectorRequest, transportOutcome, type ConnectorHandlerDeps } from "./handler.ts";
import { connectorServerInstructions } from "./instructions.ts";
import { CONNECTOR_TOOL_ANNOTATIONS } from "./tools.ts";
import { EXAMPLE_GUIDE, TOKEN_ID_A, toolHarness, WORKSPACE_A, type ToolHarnessOptions } from "./tools.fixtures.ts";

// Rotta del connettore (prompt WP5) dall'ingresso al server MCP, con un vero client
// dell'SDK collegato in memoria (nessuna rete) e dipendenze finte. Dati sintetici; il
// token di prova nasce qui e non viene mai stampato.

const SLUG = "prova-a";
const URL_A = `http://127.0.0.1:53130/api/mcp/connettore/${SLUG}`;
const TOKEN = `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
const ON = { MCP_CONNECTOR_ENABLED: "true" };

function configRow(patch: Partial<ConnectorConfigRow> = {}): ConnectorConfigRow {
  return {
    workspaceId: WORKSPACE_A,
    slug: SLUG,
    enabled: true,
    codePrefix: "XA",
    identityMode: "dichiarata",
    authMode: "header",
    workspaceDisplayName: "Alfa e Beta",
    guide: { ...EXAMPLE_GUIDE },
    guideVersion: "2026-10.1",
    allowedOrigins: [],
    limits: {},
    esgEnabled: false,
    profile: JSON.parse(JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT)),
    instructionsTemplate: EXAMPLE_INSTRUCTIONS_TEMPLATE,
    ...patch,
  };
}

function setup(
  opts: { env?: Record<string, string | undefined>; config?: Partial<ConnectorConfigRow>; tools?: ToolHarnessOptions; serve?: ConnectorHandlerDeps["serve"] } = {}
) {
  const lines: string[] = [];
  const log = {
    info: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
    error: (...args: unknown[]) => lines.push(args.map(String).join(" ")),
  };
  const config = configRow(opts.config);
  const gate: ConnectorGateDeps = {
    env: opts.env ?? ON,
    loadConfig: async (slug) => (slug === config.slug ? config : null),
    authenticateToken: async (input) =>
      input.tokenHash === hashIntegrationToken(TOKEN) && input.workspaceId === config.workspaceId
        ? { id: TOKEN_ID_A, scopes: ["connector:read", "connector:submit"] }
        : null,
    markTokenExposed: async () => null,
  };
  const tools = toolHarness(opts.tools);
  tools.deps.log = log;
  const deps: ConnectorHandlerDeps = {
    gate,
    tools: tools.deps,
    log,
    ...(opts.serve ? { serve: opts.serve } : {}),
  };
  const fetchInProcess = async (url: string | URL, init?: RequestInit) => handleConnectorRequest(new Request(url, init), SLUG, deps);
  return { deps, lines, tools, fetchInProcess };
}

async function connect(
  fetchImpl: (url: string | URL, init?: RequestInit) => Promise<Response>,
  opts: { token?: string | null; rewriteVersion?: string } = {}
) {
  const seen: Array<{ method?: string; status: number; protocolVersion?: string }> = [];
  const wrapped = async (url: string | URL, init?: RequestInit) => {
    let body = init?.body;
    let method: string | undefined;
    if (typeof body === "string") {
      const message = JSON.parse(body) as { method?: string; params?: { protocolVersion?: string } };
      method = message.method;
      if (opts.rewriteVersion && message.method === "initialize" && message.params) {
        message.params.protocolVersion = opts.rewriteVersion;
        body = JSON.stringify(message);
      }
    }
    const response = await fetchImpl(url, { ...init, body });
    let protocolVersion: string | undefined;
    if (method === "initialize" && response.ok) {
      protocolVersion = ((await response.clone().json()) as { result?: { protocolVersion?: string } }).result?.protocolVersion;
    }
    seen.push({ method: method ?? init?.method, status: response.status, protocolVersion });
    return response;
  };
  const token = opts.token === undefined ? TOKEN : opts.token;
  const transport = new StreamableHTTPClientTransport(new URL(URL_A), {
    fetch: wrapped,
    requestInit: { headers: token ? { authorization: `Bearer ${token}` } : {} },
  });
  const client = new Client({ name: "prova-connettore", version: "1.0.0" });
  await client.connect(transport);
  return { client, transport, seen };
}

function rpc(body: unknown, init: { method?: string; headers?: Record<string, string>; token?: string | null; url?: string } = {}) {
  const method = init.method ?? "POST";
  const token = init.token === undefined ? TOKEN : init.token;
  return new Request(init.url ?? URL_A, {
    method,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...init.headers,
    },
    body: method === "POST" ? JSON.stringify(body) : null,
  });
}

const INIT = (version = LATEST_PROTOCOL_VERSION) => ({
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: version, capabilities: {}, clientInfo: { name: "prova", version: "1" } },
});

function callLines(lines: string[]) {
  return lines.filter((l) => l.startsWith("[mcp] call ")).map((l) => JSON.parse(l.slice("[mcp] call ".length)) as Record<string, unknown>);
}

test("client dell'SDK: initialize con l'ultima versione, istruzioni del workspace, 4 tool del contratto", async () => {
  const { fetchInProcess, tools } = setup();
  const { client, transport, seen } = await connect(fetchInProcess);
  assert.equal(transport.protocolVersion, LATEST_PROTOCOL_VERSION);
  assert.equal(LATEST_PROTOCOL_VERSION, "2025-11-25");
  assert.deepEqual(client.getServerVersion(), { name: "unbundle", version: "2.0.0" });
  assert.equal(client.getInstructions(), connectorServerInstructions("Alfa e Beta", EXAMPLE_INSTRUCTIONS_TEMPLATE));
  assert.deepEqual(client.getServerCapabilities()?.tools, {});

  const { tools: listed } = await client.listTools();
  assert.deepEqual(
    listed.map((t) => t.name),
    [...CONNECTOR_TOOL_NAMES]
  );
  const schemas = buildToolInputSchemas(EXAMPLE_PROFILE);
  for (const tool of listed) {
    const name = tool.name as (typeof CONNECTOR_TOOL_NAMES)[number];
    assert.equal(tool.title, EXAMPLE_TOOL_TEXTS[name].title);
    assert.equal(tool.description, EXAMPLE_TOOL_TEXTS[name].description);
    assert.deepEqual(tool.inputSchema, schemas[name]);
    assert.deepEqual(tool.annotations, CONNECTOR_TOOL_ANNOTATIONS[name]);
    assert.equal(tool.outputSchema, undefined);
  }
  // initialize, notifications/initialized e tools/list non consumano il limite.
  assert.equal(tools.limiter.statements.length, 0);
  assert.equal(seen.find((s) => s.method === "initialize")?.status, 200);
  assert.equal(seen.find((s) => s.method === "notifications/initialized")?.status, 202);
  await client.close();
});

test("client 2025-06-18: la versione si negozia e i tool funzionano", async () => {
  const { fetchInProcess, tools } = setup();
  const { client, transport, seen } = await connect(fetchInProcess, { rewriteVersion: "2025-06-18" });
  assert.equal(seen.find((s) => s.method === "initialize")?.protocolVersion, "2025-06-18");
  assert.equal(transport.protocolVersion, "2025-06-18");
  assert.equal((await client.listTools()).tools.length, 4);
  const guide = await client.callTool({ name: "get_intake_guide", arguments: {} });
  assert.equal(guide.isError, undefined);
  assert.equal((guide.structuredContent as { guideVersion: string }).guideVersion, "2026-10.1");
  assert.equal(tools.limiter.total("read"), 1);
  await client.close();

  // Una versione sconosciuta riceve l'ultima.
  const old = setup();
  const response = await handleConnectorRequest(rpc(INIT("2023-01-01")), SLUG, old.deps);
  assert.equal(response.status, 200);
  assert.equal(((await response.json()) as { result: { protocolVersion: string } }).result.protocolVersion, LATEST_PROTOCOL_VERSION);
});

test("tools/call: guida, ricerca, invio, stato; HTTP 200 anche per gli errori del contratto", async () => {
  const { fetchInProcess, tools } = setup({
    tools: {
      statusByCode: {
        "XA-0001": {
          code: "XA-0001",
          title: "Riconciliazione automatica delle fatture fornitori",
          kind: "use_case_ai",
          area: "amministrazione",
          statusCode: "RICEVUTA",
          statusLabel: "Ricevuta",
          statusChangedAt: "2026-10-14",
          publicNote: null,
          linkedCaseCode: null,
          duplicateOfCode: null,
        },
      },
    },
  });
  const { client, seen } = await connect(fetchInProcess);
  const search = await client.callTool({ name: "find_similar_contributions", arguments: { query: "fatture fornitori" } });
  assert.equal((search.structuredContent as { note: string }).note.length > 0, true);

  const first = await client.callTool({ name: "submit_contribution", arguments: { ...exampleSubmission() } });
  assert.equal(first.isError, undefined);
  assert.deepEqual(
    { ok: (first.structuredContent as Record<string, unknown>).ok, duplicate: (first.structuredContent as Record<string, unknown>).duplicate },
    { ok: true, duplicate: false }
  );
  const status = await client.callTool({ name: "get_contribution_status", arguments: { code: "XA-0001" } });
  assert.equal((status.structuredContent as { statusCode: string }).statusCode, "RICEVUTA");

  const invalid = await client.callTool({ name: "submit_contribution", arguments: { title: "x" } });
  assert.equal(invalid.isError, true);
  const error = invalid.structuredContent as { error: string; fieldErrors: Record<string, string> };
  assert.equal(error.error, "invalid_payload");
  assert.ok(error.fieldErrors.title);
  assert.doesNotMatch(JSON.stringify(invalid), /Input validation error/);
  // Ogni POST JSON-RPC con una richiesta ha risposto 200.
  for (const s of seen.filter((s) => s.method === "tools/call")) assert.equal(s.status, 200);
  assert.equal(tools.limiter.total("submit"), 1);
  await client.close();
});

test("tool sconosciuto: errore JSON-RPC, HTTP 200, nessun limite consumato", async () => {
  const { deps, tools, lines } = setup();
  const response = await handleConnectorRequest(rpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "mario_rossi", arguments: {} } }), SLUG, deps);
  assert.equal(response.status, 200);
  const body = (await response.json()) as { error: { code: number; message: string } };
  assert.equal(body.error.code, -32602);
  assert.equal(tools.limiter.statements.length, 0);
  const [line] = callLines(lines);
  assert.equal(line.tool, "unknown");
  assert.equal(line.outcome, "unknown_tool");
});

// Tutti i metodi che Next gestisce in una rotta (la rotta li esporta tutti verso l'handler).
const OTHER_METHODS = ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS"];

test("ogni metodo diverso da POST → 405 con Allow: POST; spento → 404; senza profilo → 500", async () => {
  const { deps, lines } = setup();
  for (const method of OTHER_METHODS) {
    const response = await handleConnectorRequest(rpc(null, { method }), SLUG, deps);
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "POST", method);
    assert.equal(response.headers.get("cache-control"), "no-store", method);
    assert.equal(response.headers.get("x-content-type-options"), "nosniff", method);
    assert.equal(await response.text(), JSON.stringify({ error: "method_not_allowed" }), method);
  }
  assert.equal(callLines(lines).filter((l) => l.outcome === "method_not_allowed").length, OTHER_METHODS.length);
  for (const env of [{}, { MCP_CONNECTOR_ENABLED: "false" }, { MCP_CONNECTOR_ENABLED: "1" }]) {
    for (const method of ["POST", ...OTHER_METHODS]) {
      const off = setup({ env });
      const response = await handleConnectorRequest(rpc(INIT(), { method }), SLUG, off.deps);
      assert.equal(response.status, 404, `${method} ${JSON.stringify(env)}`);
    }
  }
  // Profilo del cliente o modello delle istruzioni del workspace assente o non valido:
  // 500, anche con il connettore sospeso; nel log solo i nomi dei campi, mai i valori.
  const profileCases: Array<[string, Partial<ConnectorConfigRow>, string[]]> = [
    ["profilo assente", { profile: null }, ["profile"]],
    ["profilo assente, connettore sospeso", { profile: null, enabled: false }, ["profile"]],
    ["profilo senza testi dei tool", { profile: { contract: EXAMPLE_PROFILE } }, ["profile.tools", "profile.reviewNotes"]],
    ["valore segreto non valido", { profile: { ...EXAMPLE_CONNECTOR_PROFILE_INPUT, contract: { ...EXAMPLE_PROFILE, areas: ["Valore Segreto"] } } }, ["profile.contract.areas.0"]],
    ["modello assente", { instructionsTemplate: null }, ["instructions_template"]],
    ["modello senza segnaposto", { instructionsTemplate: "Istruzioni Segrete senza nome." }, ["instructions_template"]],
  ];
  for (const [label, patch, fields] of profileCases) {
    const missing = setup({ config: patch });
    const response = await handleConnectorRequest(rpc(INIT()), SLUG, missing.deps);
    assert.equal(response.status, 500, label);
    assert.equal(response.headers.get("cache-control"), "no-store", label);
    assert.equal(await response.text(), JSON.stringify({ error: "internal_error" }), label);
    const line = missing.lines.find((l) => l.startsWith("[connector] profile_missing"));
    assert.ok(line, label);
    assert.deepEqual(JSON.parse(line.slice("[connector] profile_missing ".length)).fields, fields, label);
    assert.doesNotMatch(missing.lines.join("\n"), /Segret/, label);
  }
  // Un guasto prima del server dell'SDK: 500 JSON con le intestazioni di igiene, log senza dati.
  const broken = setup({
    serve: async () => {
      throw new Error("guasto con Testo Segreto");
    },
  });
  const failed = await handleConnectorRequest(rpc(INIT()), SLUG, broken.deps);
  assert.equal(failed.status, 500);
  assert.equal(failed.headers.get("cache-control"), "no-store");
  assert.equal(await failed.text(), JSON.stringify({ error: "internal_error" }));
  assert.ok(broken.lines.some((l) => l.startsWith("[connector] mcp_server_failed")));
  assert.doesNotMatch(broken.lines.join("\n"), /Segreto/);
});

test("senza credenziale 401, token in query 400 senza eco, Origin non ammesso 403", async () => {
  const { deps } = setup();
  const anonymous = await handleConnectorRequest(rpc(INIT(), { token: null }), SLUG, deps);
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.headers.get("www-authenticate"), null);
  assert.equal(await anonymous.text(), JSON.stringify({ error: "unauthorized" }));

  const leaked = `${CONNECTOR_TOKEN_PREFIX}${randomBytes(24).toString("base64url")}`;
  const inQuery = await handleConnectorRequest(rpc(INIT(), { url: `${URL_A}?token=${leaked}` }), SLUG, deps);
  assert.equal(inQuery.status, 400);
  const text = await inQuery.text();
  assert.equal(text, JSON.stringify({ error: "token_in_url" }));

  const origin = await handleConnectorRequest(rpc(INIT(), { headers: { origin: "https://esempio.test" } }), SLUG, deps);
  assert.equal(origin.status, 403);
  assert.equal(await origin.text(), JSON.stringify({ error: "origin_not_allowed" }));
});

test("client più recenti: server/discover con il protocollo 2026-07-28 riceve 400 dall'SDK, poi initialize funziona (come Claude Code 2.1.299)", async () => {
  const { deps, lines } = setup();
  const discover = await handleConnectorRequest(
    rpc({ jsonrpc: "2.0", id: 1, method: "server/discover", params: {} }, { headers: { "mcp-protocol-version": "2026-07-28" } }),
    SLUG,
    deps
  );
  assert.equal(discover.status, 400);
  assert.equal(discover.headers.get("cache-control"), "no-store");
  assert.match(((await discover.json()) as { error?: { message?: string } }).error?.message ?? "", /Unsupported protocol version/);
  const init = await handleConnectorRequest(rpc(INIT()), SLUG, deps);
  assert.equal(init.status, 200);
  assert.deepEqual(
    callLines(lines).map((c) => [c.tool, c.outcome]),
    [
      ["server/discover", "http_400"],
      ["initialize", "ok"],
    ]
  );
});

test("log dell'Origin: un client di Claude per nome anche se respinto, un'origine ammessa per nome, ogni altra come «other»", async () => {
  // Elenco vuoto (predefinito): ogni Origin dà 403, e il log dice quale client di Claude l'ha mandato.
  const closed = setup();
  const fromClaude = await handleConnectorRequest(rpc(INIT(), { headers: { origin: "https://claude.ai" } }), SLUG, closed.deps);
  assert.equal(fromClaude.status, 403);
  const foreign = await handleConnectorRequest(rpc(INIT(), { headers: { origin: "https://persona-inventata.esempio.test" } }), SLUG, closed.deps);
  assert.equal(foreign.status, 403);
  await handleConnectorRequest(rpc(INIT()), SLUG, closed.deps);
  const closedLines = callLines(closed.lines);
  assert.deepEqual(
    closedLines.map((c) => [c.outcome, c.origin]),
    [
      ["origin_not_allowed", "https://claude.ai"],
      ["origin_not_allowed", "other"],
      ["ok", undefined],
    ]
  );
  assert.equal(closed.lines.join("\n").includes("persona-inventata"), false);

  // Origine ammessa dal workspace: la richiesta passa e ogni riga porta l'origine.
  const open = setup({ config: { allowedOrigins: ["https://intranet.esempio.test"] } });
  const allowed = await handleConnectorRequest(rpc(INIT(), { headers: { origin: "https://intranet.esempio.test" } }), SLUG, open.deps);
  assert.equal(allowed.status, 200);
  assert.deepEqual(callLines(open.lines).map((c) => [c.tool, c.outcome, c.origin]), [["initialize", "ok", "https://intranet.esempio.test"]]);
});

test("connettore sospeso: handshake e tools/list funzionano, ogni tool risponde connector_disabled", async () => {
  const { fetchInProcess, tools } = setup({ config: { enabled: false } });
  const { client } = await connect(fetchInProcess);
  assert.equal((await client.listTools()).tools.length, 4);
  for (const name of CONNECTOR_TOOL_NAMES) {
    const result = await client.callTool({ name, arguments: {} });
    assert.equal(result.isError, true);
    assert.equal((result.structuredContent as { error: string }).error, "connector_disabled");
  }
  assert.equal(tools.limiter.statements.length, 0);
  await client.close();
});

test("risposte: intestazioni di igiene; Accept senza text/event-stream → 406 dell'SDK", async () => {
  const { deps } = setup();
  const ok = await handleConnectorRequest(rpc(INIT()), SLUG, deps);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("cache-control"), "no-store");
  assert.equal(ok.headers.get("x-content-type-options"), "nosniff");
  assert.match(ok.headers.get("content-type") ?? "", /application\/json/);
  assert.equal(ok.headers.get("mcp-session-id"), null, "senza stato: nessuna sessione");
  const notAcceptable = await handleConnectorRequest(rpc(INIT(), { headers: { accept: "application/json" } }), SLUG, deps);
  assert.equal(notAcceptable.status, 406);
  assert.equal(notAcceptable.headers.get("cache-control"), "no-store");
  assert.equal(transportOutcome(406), "http_406");
  assert.equal(transportOutcome(202), "ok");
});

test("log: una riga per messaggio, con slug, tool, esito e id del token; mai token, testi o email", async () => {
  const { fetchInProcess, lines } = setup();
  const { client } = await connect(fetchInProcess);
  await client.listTools();
  const title = "Riconciliazione automatica con Persona Inventata";
  await client.callTool({ name: "submit_contribution", arguments: { ...exampleSubmission({ title }) } });
  await client.callTool({ name: "get_contribution_status", arguments: { code: "XA-0042" } });
  await client.close();
  // Una richiesta respinta dall'ingresso ha la sua riga, con il codice di igiene.
  await fetchInProcess(URL_A, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });

  const calls = callLines(lines);
  const byTool = (tool: string) => calls.filter((c) => c.tool === tool);
  assert.equal(byTool("initialize").length, 1);
  assert.equal(byTool("notifications/initialized").length, 1);
  assert.equal(byTool("tools/list").length, 1);
  assert.deepEqual(byTool("submit_contribution").map((c) => c.outcome), ["ok"]);
  assert.deepEqual(byTool("get_contribution_status").map((c) => c.outcome), ["not_found"]);
  for (const call of calls.filter((c) => c.outcome !== "unsupported_media_type" && c.outcome !== "method_not_allowed")) {
    assert.equal(call.area, "connector");
    assert.equal(call.slug, SLUG);
    assert.equal(call.token, TOKEN_ID_A.slice(0, 8));
    assert.equal(typeof call.ms, "number");
  }
  assert.ok(calls.some((c) => c.outcome === "unsupported_media_type"));
  const all = lines.join("\n");
  for (const secret of [TOKEN, hashIntegrationToken(TOKEN), title, "Persona Inventata", "proponente@esempio.test", "Persona di prova", "fatture"]) {
    assert.equal(all.includes(secret), false, "segreto o testo nel log");
  }
});
