import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { CONNECTOR_TOKEN_PREFIX, hashIntegrationToken } from "../../connector/auth.ts";
import { gateConnectorRequest, type ConnectorGateDeps } from "../../connector/gate.ts";
import { handleTeamMcpRequest, type TeamHandlerDeps } from "../mcp/handler.ts";
import { newCiKey } from "./keys.ts";

// (8.2b, revisione) Una chiave della CI vista nell'indirizzo di una rotta MCP (il connettore, il MCP del team) si revoca
// come nelle rotte della CLI: la rotta risponde 400 `token_in_url` e passa i token trovati a `revokeCiKeys` (nell'app
// `revokeCiKeysFoundInUrl` → `revokeCiKeysInUrl`: `esposta`, e `chiave_ci_bloccata` dopo la risposta). Un guasto della
// revoca non cambia la risposta e nel log resta solo un codice, mai la chiave. Dipendenze finte, chiavi generate qui.

const CONNECTOR_URL = "https://www.theunbundle.com/api/mcp/connettore/prova-a";
const TEAM_URL = "http://127.0.0.1:53120/api/mcp/use-case";
const post = (url: string) => new Request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }) });

function connectorDeps(revoke?: (candidates: readonly string[]) => Promise<unknown>) {
  const exposed: string[] = [];
  const logs: string[] = [];
  const deps: ConnectorGateDeps = {
    env: { MCP_CONNECTOR_ENABLED: "true" },
    loadConfig: async () => null,
    authenticateToken: async () => null,
    markTokenExposed: async (hash) => void exposed.push(hash),
    ...(revoke ? { revokeCiKeys: revoke } : {}),
    log: { error: (...args: unknown[]) => void logs.push(args.map(String).join(" ")) },
  };
  return { deps, exposed, logs };
}

function teamDeps(revoke?: (candidates: readonly string[]) => Promise<unknown>) {
  const exposed: string[] = [];
  const logs: string[] = [];
  const log = { info: (...args: unknown[]) => void logs.push(args.map(String).join(" ")), error: (...args: unknown[]) => void logs.push(args.map(String).join(" ")) };
  const deps = {
    env: { MCP_TEAM_ENABLED: "true" },
    // Non servono: la rotta si ferma prima, sul token nell'indirizzo.
    auth: {} as TeamHandlerDeps["auth"],
    tools: {} as TeamHandlerDeps["tools"],
    markTokenExposed: async (hash: string) => void exposed.push(hash),
    ...(revoke ? { revokeCiKeys: revoke } : {}),
    log,
  } satisfies TeamHandlerDeps;
  return { deps, exposed, logs };
}

test("il connettore: una chiave della CI nell'indirizzo, 400 token_in_url e la revoca; un altro token non la chiama", async () => {
  const key = newCiKey();
  const seen: (readonly string[])[] = [];
  const { deps, exposed, logs } = connectorDeps(async (candidates) => void seen.push(candidates));
  const result = await gateConnectorRequest(post(`${CONNECTOR_URL}?token=${key}`), "prova-a", deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.outcome, "token_in_url");
  assert.equal(result.response.status, 400);
  assert.deepEqual(seen, [[key]]);
  assert.deepEqual(exposed, [hashIntegrationToken(key)], "il segno «esposto» di prima resta (per i token di workspace)");
  // Un token del connettore nell'indirizzo: la revoca si chiama con quello, ed è lei a ignorarlo (nessuna chiave della CI).
  const other = `${CONNECTOR_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  await gateConnectorRequest(post(`${CONNECTOR_URL}?q=${other}`), "prova-a", deps);
  assert.deepEqual(seen[1], [other]);
  // Senza token riconoscibili (solo il nome del parametro): niente da revocare.
  await gateConnectorRequest(post(`${CONNECTOR_URL}?apiKey=qualcosa`), "prova-a", deps);
  assert.equal(seen.length, 2);
  assert.ok(!logs.join("\n").includes(key));
});

test("il connettore: una revoca che non riesce non cambia il 400 e nel log non lascia la chiave", async () => {
  const key = newCiKey();
  const { deps, logs } = connectorDeps(async () => {
    throw new Error(`guasto con ${key}`);
  });
  const result = await gateConnectorRequest(post(`${CONNECTOR_URL}/${key}`), "prova-a", deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.response.status, 400);
  assert.match(logs.join("\n"), /ci_key_revoke_failed/);
  assert.ok(!logs.join("\n").includes(key), "mai la chiave nel log");
});

test("il MCP del team: una chiave della CI nell'indirizzo, 400 token_in_url e la revoca; un guasto della revoca non cambia la risposta", async () => {
  const key = newCiKey();
  const seen: (readonly string[])[] = [];
  const ok = teamDeps(async (candidates) => void seen.push(candidates));
  const response = await handleTeamMcpRequest(post(`${TEAM_URL}?token=${key}`), ok.deps);
  assert.equal(response.status, 400);
  assert.deepEqual(JSON.parse(await response.text()), { error: "token_in_url" });
  assert.deepEqual(seen, [[key]]);
  const failing = teamDeps(async () => {
    throw new Error(`guasto con ${key}`);
  });
  const failed = await handleTeamMcpRequest(post(`${TEAM_URL}?access_token=${key}`), failing.deps);
  assert.equal(failed.status, 400);
  assert.match(failing.logs.join("\n"), /ci_key_revoke_failed/);
  for (const lines of [ok.logs, failing.logs]) assert.ok(!lines.join("\n").includes(key), "mai la chiave nel log");
});

test("nell'app le due rotte MCP revocano con la stessa funzione della CLI, caricata solo per una chiave della CI", () => {
  const connector = readFileSync(new URL("../../connector/app-deps.ts", import.meta.url), "utf8");
  const team = readFileSync(new URL("../mcp/app-deps.ts", import.meta.url), "utf8");
  const helper = connector.slice(connector.indexOf("export async function revokeCiKeysFoundInUrl("), connector.indexOf("\n}\n", connector.indexOf("export async function revokeCiKeysFoundInUrl(")));
  assert.match(helper, /if \(ciKeyCandidates\(candidates\)\.length === 0\) return;/);
  assert.match(helper, /await import\("@\/lib\/use-cases\/cli\/route-kit"\)/);
  assert.match(helper, /await revokeCiKeysInUrl\(candidates\);/);
  assert.match(connector, /revokeCiKeys: revokeCiKeysFoundInUrl,\n {2}\};/);
  assert.match(team, /revokeCiKeys: revokeCiKeysFoundInUrl,\n {4}tools:/);
});
