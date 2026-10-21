import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { hashIntegrationToken } from "../../connector/auth.ts";
import { MCP_BODY_MAX_BYTES } from "../../connector/http-hygiene.ts";
import { TEAM_MCP_SCOPES, TEAM_MCP_TOKEN_PREFIX, type TeamAuthDeps } from "./auth.ts";
import { TEAM_MCP_TOOL_ANNOTATIONS, TEAM_MCP_TOOL_NAMES } from "./contract.ts";
import { handleTeamMcpRequest, type TeamHandlerDeps } from "./handler.ts";
import { teamMcpInstructions } from "./instructions.ts";
import type { TeamToolDeps } from "./tools.ts";

// La rotta del MCP del team in memoria (docs/use-case/DESIGN.md §9.4): igiene HTTP del
// connettore, autenticazione, server senza stato, log senza dati. Dipendenze finte; il
// database locale è in `mcp.integration.test.ts`. Token generati qui, mai stampati.

const URL_BASE = "http://127.0.0.1:53120/api/mcp/use-case";
const token = `${TEAM_MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
const tokenId = randomUUID();
const workspaceId = randomUUID();

function deps(opts: { enabled?: boolean } = {}) {
  const lines: string[] = [];
  const exposed: string[] = [];
  const auth: TeamAuthDeps = {
    async findToken(hash) {
      return hash === hashIntegrationToken(token) ? { id: tokenId, workspaceId, ownerUserId: randomUUID(), scopes: [...TEAM_MCP_SCOPES] } : null;
    },
    async ownerAccess() {
      return { role: "function_lead", workspaceName: "Alfa e Beta" };
    },
    async ownerProfile() {
      return { email: "builder@cliente.test", emailVerified: true, isLateralSpace: false };
    },
    async markUsed() {},
  };
  const tools = { isAreaOn: () => false } as unknown as TeamToolDeps;
  const d: TeamHandlerDeps = {
    env: { MCP_TEAM_ENABLED: opts.enabled === false ? undefined : "true" },
    auth,
    async markTokenExposed(hash) {
      exposed.push(hash);
      return null;
    },
    tools,
    log: { info: (...args: unknown[]) => lines.push(args.join(" ")), error: (...args: unknown[]) => lines.push(args.join(" ")) },
  };
  return { deps: d, lines, exposed };
}

function rpc(body: unknown, headers: Record<string, string> = {}, url = URL_BASE, method = "POST") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}`, ...headers },
    body: method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body),
  });
}

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "prova", version: "1.0.0" } } };

async function json(response: Response) {
  return JSON.parse(await response.text()) as Record<string, unknown>;
}

function assertHygiene(response: Response) {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

test("MCP_TEAM_ENABLED spento: 404 per ogni metodo, senza toccare l'autenticazione", async () => {
  const { deps: d, lines } = deps({ enabled: false });
  for (const method of ["POST", "GET", "DELETE", "HEAD", "PUT", "PATCH", "OPTIONS"]) {
    const response = await handleTeamMcpRequest(rpc(initialize, {}, URL_BASE, method), d);
    assert.equal(response.status, 404, method);
    assertHygiene(response);
  }
  assert.ok(lines.every((line) => line.includes('"outcome":"not_found"') && line.includes('"area":"team-mcp"')));
});

test("solo POST: 405 con Allow: POST per GET, DELETE, HEAD, PUT, PATCH e OPTIONS", async () => {
  const { deps: d } = deps();
  for (const method of ["GET", "DELETE", "HEAD", "PUT", "PATCH", "OPTIONS"]) {
    const response = await handleTeamMcpRequest(rpc(initialize, {}, URL_BASE, method), d);
    assert.equal(response.status, 405, method);
    assert.equal(response.headers.get("allow"), "POST", method);
    assertHygiene(response);
  }
});

test("token nell'indirizzo: 400 token_in_url senza ripetere l'indirizzo; il token si segna esposto (solo come hash)", async () => {
  const { deps: d, exposed, lines } = deps();
  const response = await handleTeamMcpRequest(rpc(initialize, {}, `${URL_BASE}?token=${token}`), d);
  assert.equal(response.status, 400);
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error: "token_in_url" });
  assert.equal(text.includes(token), false);
  assert.deepEqual(exposed, [hashIntegrationToken(token)]);
  assert.equal(lines.join("\n").includes(token), false);
  const named = await handleTeamMcpRequest(rpc(initialize, {}, `${URL_BASE}?access_token=qualcosa`), d);
  assert.equal(named.status, 400);
});

test("Origin presente: 403; Content-Type non JSON: 415; corpo oltre 256 KB: 413; senza token: 401", async () => {
  const { deps: d } = deps();
  assert.equal((await handleTeamMcpRequest(rpc(initialize, { origin: "https://claude.ai" }), d)).status, 403);
  assert.equal((await handleTeamMcpRequest(rpc(initialize, { "content-type": "text/plain" }), d)).status, 415);
  assert.equal((await handleTeamMcpRequest(rpc(initialize, { "content-length": String(MCP_BODY_MAX_BYTES + 1) }), d)).status, 413);
  const big = new Request(URL_BASE, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ ...initialize, padding: "x".repeat(MCP_BODY_MAX_BYTES) }),
  });
  assert.equal((await handleTeamMcpRequest(big, d)).status, 413);
  const anonymous = await handleTeamMcpRequest(rpc(initialize, { authorization: "" }), d);
  assert.equal(anonymous.status, 401);
  assert.deepEqual(await json(anonymous), { error: "unauthorized" });
  assert.equal(anonymous.headers.get("www-authenticate"), null);
  const other = await handleTeamMcpRequest(rpc(initialize, { authorization: `Bearer ${TEAM_MCP_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}` }), d);
  assert.equal(other.status, 401);
});

test("con l'SDK: initialize con nome e istruzioni del workspace, tools/list con 6 tool e annotazioni; area spenta su ogni tool", async () => {
  const { deps: d, lines } = deps();
  const transport = new StreamableHTTPClientTransport(new URL(URL_BASE), {
    fetch: async (input, init) => handleTeamMcpRequest(new Request(input, init), d),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "prova-h5a", version: "1.0.0" });
  await client.connect(transport);
  assert.deepEqual(client.getServerVersion(), { name: "unbundle-use-case", title: "Unbundle Use case", version: "1.0.0" });
  assert.equal(client.getInstructions(), teamMcpInstructions("Alfa e Beta"));
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name), [...TEAM_MCP_TOOL_NAMES]);
  for (const tool of tools) {
    assert.deepEqual(tool.annotations, TEAM_MCP_TOOL_ANNOTATIONS[tool.name as keyof typeof TEAM_MCP_TOOL_ANNOTATIONS]);
    assert.equal(tool.outputSchema, undefined);
  }
  const result = await client.callTool({ name: "get_use_case", arguments: { code: "XX-0012" } });
  assert.equal(result.isError, true);
  assert.equal((result.structuredContent as { error: string }).error, "area_spenta");
  await client.close();

  const log = lines.join("\n");
  assert.equal(log.includes(token), false, "mai il token nel log");
  assert.equal(log.includes("Bearer"), false);
  assert.ok(lines.some((line) => line.includes('"tool":"get_use_case"') && line.includes('"outcome":"area_spenta"') && line.includes(`"token":"${tokenId.slice(0, 8)}"`)));
  assert.ok(lines.some((line) => line.includes('"tool":"tools/list"')));
  assert.equal(log.includes("XX-0012"), false, "nemmeno gli argomenti dei tool");
});
