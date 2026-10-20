import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { CONNECTOR_TOKEN_PREFIX } from "./auth.ts";
import { formatMcpCallLog, logMcpCall, MCP_PROTOCOL_METHODS } from "./call-log.ts";
import { CONNECTOR_TOOL_NAMES } from "./contract.ts";
import { CLAUDE_CLIENT_ORIGINS } from "./http-hygiene.ts";

// Prompt WP4 (log). Dati sintetici.

const AT = new Date("2026-10-14T08:00:00.000Z");

test("una riga per chiamata: data, area, slug, tool, esito, durata, 8 caratteri dell'id del token", () => {
  const tokenId = randomUUID();
  const line = JSON.parse(
    formatMcpCallLog(
      { area: "connector", slug: "prova-a", tool: "submit_contribution", knownTools: CONNECTOR_TOOL_NAMES, outcome: "ok", durationMs: 123.6, tokenId },
      AT
    )
  );
  assert.deepEqual(line, {
    at: "2026-10-14T08:00:00.000Z",
    area: "connector",
    slug: "prova-a",
    tool: "submit_contribution",
    outcome: "ok",
    ms: 124,
    token: tokenId.slice(0, 8),
  });
  assert.deepEqual(JSON.parse(formatMcpCallLog({ area: "team-mcp", tool: "tools/list", outcome: "rate_limited", durationMs: -3 }, AT)), {
    at: "2026-10-14T08:00:00.000Z",
    area: "team-mcp",
    tool: "tools/list",
    outcome: "rate_limited",
    ms: 0,
  });
});

test("nessun valore fuori forma entra nel log: token, testi, email, nomi", () => {
  const secret = `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const line = formatMcpCallLog(
    {
      area: "Connector <script>",
      slug: "persona.inventata@example.test",
      tool: "Verbali automatici di Persona Inventata",
      outcome: secret,
      durationMs: Number.NaN,
      tokenId: secret,
    },
    AT
  );
  assert.deepEqual(JSON.parse(line), { at: "2026-10-14T08:00:00.000Z", area: "unknown", tool: "unknown", outcome: "unknown", ms: 0 });
  for (const leaked of [secret, "example.test", "Persona", "script"]) assert.equal(line.includes(leaked), false, leaked);
});

test("il nome del tool viene dal client: entra solo un metodo del protocollo o un tool del server", () => {
  const tool = (name: string, knownTools?: readonly string[]) =>
    JSON.parse(formatMcpCallLog({ area: "connector", tool: name, knownTools, outcome: "ok", durationMs: 1 }, AT)).tool;
  // Minuscolo e con la forma giusta, ma scritto da qualcuno: mai nel log.
  for (const name of ["mario_rossi", "verbali_cliente_x", "persona/inventata"]) {
    assert.equal(tool(name), "unknown", name);
    assert.equal(tool(name, CONNECTOR_TOOL_NAMES), "unknown", name);
  }
  for (const name of CONNECTOR_TOOL_NAMES) {
    assert.equal(tool(name, CONNECTOR_TOOL_NAMES), name);
    assert.equal(tool(name), "unknown", `${name} senza l'elenco del server`);
  }
  for (const method of MCP_PROTOCOL_METHODS) assert.equal(tool(method), method);
  // La prima richiesta dei client più recenti (protocollo 2026-07-28), respinta dall'SDK 1.29 con 400.
  assert.equal(tool("server/discover"), "server/discover");
  // Un elenco con un valore fuori forma non lo fa passare.
  assert.equal(tool("Mario Rossi", ["Mario Rossi"]), "unknown");
  // Il MCP del team passa i suoi tool.
  assert.equal(tool("search_use_cases", ["search_use_cases"]), "search_use_cases");
});

test("logMcpCall scrive con info e il prefisso [mcp] call", () => {
  const lines: string[] = [];
  logMcpCall(
    { area: "connector", slug: "prova-a", tool: "get_intake_guide", knownTools: CONNECTOR_TOOL_NAMES, outcome: "ok", durationMs: 5 },
    { info: (msg: string) => lines.push(msg) },
    AT
  );
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\[mcp\] call \{"at":"2026-10-14T08:00:00.000Z","area":"connector","slug":"prova-a","tool":"get_intake_guide","outcome":"ok","ms":5\}$/);
});

test("Origin: entra solo un'origine conosciuta (client di Claude o ammessa dal workspace), ogni altra come «other»", () => {
  const origin = (header: string | null | undefined, knownOrigins?: readonly string[]) =>
    JSON.parse(formatMcpCallLog({ area: "connector", tool: "initialize", outcome: "ok", durationMs: 1, origin: header, knownOrigins }, AT)).origin;
  assert.equal(origin(undefined, CLAUDE_CLIENT_ORIGINS), undefined, "senza header nessun campo");
  assert.equal(origin(null, CLAUDE_CLIENT_ORIGINS), undefined);
  assert.equal(origin("https://claude.ai", CLAUDE_CLIENT_ORIGINS), "https://claude.ai");
  assert.equal(origin("https://Intranet.Esempio.test/", [...CLAUDE_CLIENT_ORIGINS, "https://intranet.esempio.test"]), "https://intranet.esempio.test");
  assert.equal(origin("https://claude.ai"), "other", "senza elenco nessuna origine è conosciuta");
  const line = formatMcpCallLog(
    { area: "connector", tool: "initialize", outcome: "origin_not_allowed", durationMs: 1, origin: "https://persona-inventata.esempio.test", knownOrigins: CLAUDE_CLIENT_ORIGINS },
    AT
  );
  assert.equal(JSON.parse(line).origin, "other");
  assert.equal(line.includes("persona-inventata"), false);
});
