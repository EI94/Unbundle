import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { ITEM_KINDS } from "../src/lib/uc/vocab.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverPath = join(__dirname, "unbundle-casi-server.mjs");

const CASE_ID = "0f1e2d3c-4b5a-4968-8776-655443322110";
const TOOLS = ["get_data_dictionary", "get_gate_status", "get_open_items", "get_validated_catalog", "list_cases", "list_use_cases"];
const LIST_TOOLS = ["list_cases", "list_use_cases"];

function startServer(env = {}) {
  const child = spawn(process.execPath, [serverPath], {
    env: { ...process.env, UNBUNDLE_MCP_TOKEN: "", ...env },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const lines = [];
  let buffer = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    const parts = buffer.split("\n");
    buffer = parts.pop() ?? "";
    for (const line of parts) if (line.trim()) lines.push(JSON.parse(line));
  });
  return { child, lines };
}

function send(child, message) {
  child.stdin.write(`${JSON.stringify(message)}\n`);
}

async function waitFor(lines, predicate) {
  const started = Date.now();
  while (Date.now() - started < 4000) {
    const found = lines.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for MCP response. Got: ${JSON.stringify(lines)}`);
}

async function initialize(child, lines) {
  send(child, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "unbundle-test", version: "1.0.0" } },
  });
  await waitFor(lines, (line) => line.id === 1);
  send(child, { jsonrpc: "2.0", method: "notifications/initialized", params: {} });
}

let nextId = 10;
async function callTool(child, lines, name, args = {}) {
  const id = nextId++;
  send(child, { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });
  const line = await waitFor(lines, (l) => l.id === id);
  return line.result ?? line.error;
}

async function stop(child) {
  child.kill();
  await once(child, "close").catch(() => {});
}

/** API finta: registra le richieste e risponde con `respond(req)`. */
async function fakeApi(respond) {
  const requests = [];
  const api = createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    const out = respond(req);
    if (!out) return; // nessuna risposta: serve al test del timeout
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(JSON.stringify(out.body));
  });
  api.listen(0, "127.0.0.1");
  await once(api, "listening");
  const close = () => {
    api.closeAllConnections();
    api.close();
  };
  return { url: `http://127.0.0.1:${api.address().port}`, requests, close };
}

test("casi MCP server exposes five read-only tools plus the list_use_cases alias and fails readably without a token", async () => {
  const { child, lines } = startServer();
  try {
    await initialize(child, lines);
    send(child, { jsonrpc: "2.0", id: 2, method: "tools/list", params: {} });
    const list = await waitFor(lines, (line) => line.id === 2);
    const tools = list.result.tools;
    assert.deepEqual(tools.map((t) => t.name).sort(), TOOLS);
    for (const tool of tools) {
      assert.equal(tool.annotations?.readOnlyHint, true, `${tool.name} read only`);
      assert.equal(tool.annotations?.destructiveHint, false);
      const props = Object.keys(tool.inputSchema?.properties ?? {});
      assert.ok(!props.includes("confirmedByUser") && !props.includes("idempotencyKey"), `${tool.name} has no write guards`);
    }
    const catalog = tools.find((t) => t.name === "get_validated_catalog");
    assert.deepEqual(catalog.inputSchema.properties.kinds.items.enum, [...ITEM_KINDS]);
    assert.deepEqual(catalog.inputSchema.required, ["caseId"]);

    for (const name of TOOLS) {
      const result = await callTool(child, lines, name, LIST_TOOLS.includes(name) ? {} : { caseId: CASE_ID });
      assert.equal(result.isError, true, name);
      assert.match(result.content[0].text, /UNBUNDLE_MCP_TOKEN/);
      assert.equal(result.structuredContent?.error, "missing_token");
    }
  } finally {
    await stop(child);
  }
});

test("each tool sends a GET with the bearer token to its case route", async () => {
  const api = await fakeApi((req) => {
    if (req.url === "/api/mcp/casi/cases") return { status: 200, body: { ok: true, cases: [{ id: CASE_ID, code: "ES-UC-01" }] } };
    if (req.url.startsWith(`/api/mcp/casi/cases/${CASE_ID}/catalog`)) {
      return { status: 200, body: { ok: true, version: 2, items: [{ key: "ent.richiesta" }], excluded: [{ key: "q.es.01", status: "in_verifica" }], text_hidden: "ambiente_non_approvato" } };
    }
    if (req.url.endsWith("/open-items")) return { status: 200, body: { ok: true, gate: "G1", count: 3, items: [] } };
    if (req.url.endsWith("/dictionary")) return { status: 200, body: { ok: true, entities: [{ key: "ent.richiesta", fields: [] }], orphan_fields: [] } };
    if (req.url.endsWith("/gate")) return { status: 200, body: { ok: true, gate_reconfirm: true, gate_status: { gate: "G1", required: 5, ok: 2, ready: false } } };
    return { status: 404, body: { ok: false, error: "non_trovato" } };
  });
  const { child, lines } = startServer({ UNBUNDLE_API_URL: `${api.url}/`, UNBUNDLE_MCP_TOKEN: "ub_mcp_prova" });
  try {
    await initialize(child, lines);

    const list = await callTool(child, lines, "list_cases");
    assert.notEqual(list.isError, true);
    assert.match(list.content[0].text, /1 caso leggibile/);
    assert.equal(list.structuredContent.cases[0].code, "ES-UC-01");

    const catalog = await callTool(child, lines, "get_validated_catalog", { caseId: CASE_ID, version: 2, kinds: ["regola", "campo"] });
    assert.notEqual(catalog.isError, true);
    assert.match(catalog.content[0].text, /Catalogo v2: 1 voci validate, 1 escluse/);
    assert.match(catalog.content[0].text, /ambiente AI del caso non è ancora approvato/);
    // Il JSON completo è anche nel testo, per i client che non leggono structuredContent.
    assert.deepEqual(JSON.parse(catalog.content[0].text.split("\n\n").slice(1).join("\n\n")), catalog.structuredContent);

    const open = await callTool(child, lines, "get_open_items", { caseId: CASE_ID });
    assert.match(open.content[0].text, /3 voci mancano al gate G1/);
    const dictionary = await callTool(child, lines, "get_data_dictionary", { caseId: CASE_ID });
    assert.match(dictionary.content[0].text, /1 entità/);
    const gate = await callTool(child, lines, "get_gate_status", { caseId: CASE_ID });
    assert.match(gate.content[0].text, /2 di 5 voci a posto, non pronto\. Gate da riconfermare\./);

    // The old name answers exactly like list_cases, on the same route.
    const alias = await callTool(child, lines, "list_use_cases");
    assert.deepEqual(alias, list);

    assert.deepEqual(
      api.requests.map((r) => r.url),
      [
        "/api/mcp/casi/cases",
        `/api/mcp/casi/cases/${CASE_ID}/catalog?version=2&kinds=regola%2Ccampo`,
        `/api/mcp/casi/cases/${CASE_ID}/open-items`,
        `/api/mcp/casi/cases/${CASE_ID}/dictionary`,
        `/api/mcp/casi/cases/${CASE_ID}/gate`,
        "/api/mcp/casi/cases",
      ]
    );
    for (const r of api.requests) {
      assert.equal(r.method, "GET");
      assert.equal(r.authorization, "Bearer ub_mcp_prova");
    }
  } finally {
    await stop(child);
    api.close();
  }
});

test("API refusals become readable errors; invalid input never reaches the API", async () => {
  const api = await fakeApi((req) => {
    if (req.url.includes("/catalog")) {
      return { status: 404, body: { ok: false, error: "nessuna_versione_congelata", message: "Il catalogo non è ancora congelato: serve l'approvazione del gate G1." } };
    }
    if (req.url.endsWith("/gate")) return { status: 401, body: { ok: false, error: "non_autorizzato" } };
    return { status: 403, body: { ok: false, error: "scope_mancante" } };
  });
  const { child, lines } = startServer({ UNBUNDLE_API_URL: api.url, UNBUNDLE_MCP_TOKEN: "ub_mcp_prova" });
  try {
    await initialize(child, lines);
    const catalog = await callTool(child, lines, "get_validated_catalog", { caseId: CASE_ID });
    assert.equal(catalog.isError, true);
    assert.match(catalog.content[0].text, /\(404\): Il catalogo non è ancora congelato/);
    assert.equal(catalog.structuredContent.status, 404);
    assert.equal(catalog.structuredContent.response.error, "nessuna_versione_congelata");

    const gate = await callTool(child, lines, "get_gate_status", { caseId: CASE_ID });
    assert.equal(gate.isError, true);
    assert.match(gate.content[0].text, /token: è mancante, scaduto o revocato/);

    const open = await callTool(child, lines, "get_open_items", { caseId: CASE_ID });
    assert.match(open.content[0].text, /non ha il permesso/);

    const before = api.requests.length;
    const bad = await callTool(child, lines, "get_open_items", { caseId: "../../workspaces" });
    assert.equal(bad.isError, true);
    const badKind = await callTool(child, lines, "get_validated_catalog", { caseId: CASE_ID, kinds: ["segreti"] });
    assert.equal(badKind.isError, true);
    const badVersion = await callTool(child, lines, "get_validated_catalog", { caseId: CASE_ID, version: 0 });
    assert.equal(badVersion.isError, true);
    assert.equal(api.requests.length, before);
  } finally {
    await stop(child);
    api.close();
  }
});

test("a slow API ends with a timeout error", async () => {
  const api = await fakeApi(() => null);
  const { child, lines } = startServer({ UNBUNDLE_API_URL: api.url, UNBUNDLE_MCP_TOKEN: "ub_mcp_prova", UNBUNDLE_MCP_TIMEOUT_MS: "200" });
  try {
    await initialize(child, lines);
    const result = await callTool(child, lines, "list_use_cases");
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /non ha risposto entro 200 ms/);
    assert.equal(result.structuredContent.response.error, "timeout");
  } finally {
    await stop(child);
    api.close();
  }
});
