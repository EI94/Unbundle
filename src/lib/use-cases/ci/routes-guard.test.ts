import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { gateConnectorRequest, type ConnectorGateDeps } from "../../connector/gate.ts";
import { hashIntegrationToken } from "../../connector/auth.ts";
import type { TeamAuthDeps } from "../mcp/auth.ts";
import { handleTeamMcpRequest, type TeamHandlerDeps } from "../mcp/handler.ts";
import type { TeamToolDeps } from "../mcp/tools.ts";
import { newCiKey } from "./keys.ts";

// Le difese contro la chiave della CI fuori posto (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.2, §2.7):
// - le verifiche dei token dell'MCP del team e dell'MCP dei dossier rifiutano una chiave della CI nell'indirizzo (400,
//   prima di leggere la configurazione o il token), e la chiave non finisce nei log;
// - le rotte della CI passano tutte dalle difese (anche il metodo che non hanno: la chiave nell'indirizzo si revoca), la
//   revoca viene prima del 400, nei log solo codici dell'area `ci`, e la CI scrive senza persona.
// Dipendenze finte, nessun database; la chiave si genera qui e non si stampa mai.

const root = new URL("../../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, root), "utf8");

test("l'MCP del team: una chiave della CI nell'indirizzo è 400 token_in_url, prima dell'autenticazione, mai nei log", async () => {
  const key = newCiKey();
  const lines: string[] = [];
  const exposed: string[] = [];
  const auth: TeamAuthDeps = {
    async findToken() {
      throw new Error("mai: l'indirizzo si controlla prima");
    },
    async ownerAccess() {
      return null;
    },
    async ownerProfile() {
      return null;
    },
    async markUsed() {},
  };
  const deps: TeamHandlerDeps = {
    env: { MCP_TEAM_ENABLED: "true" },
    auth,
    async markTokenExposed(hash) {
      exposed.push(hash);
      return null;
    },
    tools: {} as unknown as TeamToolDeps,
    log: { info: (...args: unknown[]) => lines.push(args.join(" ")), error: (...args: unknown[]) => lines.push(args.join(" ")) },
  };
  for (const url of [`http://127.0.0.1:53120/api/mcp/use-case?token=${key}`, `http://127.0.0.1:53120/api/mcp/use-case/${key}`]) {
    const response = await handleTeamMcpRequest(
      new Request(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` }, body: "{}" }),
      deps,
    );
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.deepEqual(JSON.parse(text), { error: "token_in_url" });
    assert.ok(!text.includes(key));
  }
  assert.deepEqual(exposed, [hashIntegrationToken(key), hashIntegrationToken(key)], "solo l'impronta");
  assert.ok(!lines.join("\n").includes("ub_ci_"), "mai la chiave nei log");
});

test("l'MCP dei dossier: una chiave della CI nell'indirizzo è 400 token_in_url, prima della configurazione e del token", async () => {
  const key = newCiKey();
  const logs: string[] = [];
  const calls = { config: 0, auth: 0, exposed: [] as string[] };
  const deps: ConnectorGateDeps = {
    env: { MCP_CONNECTOR_ENABLED: "true" },
    async loadConfig() {
      calls.config += 1;
      return null;
    },
    async authenticateToken() {
      calls.auth += 1;
      return { id: randomUUID(), scopes: [] };
    },
    async markTokenExposed(hash) {
      calls.exposed.push(hash);
    },
    log: { error: (...args: unknown[]) => logs.push(args.map(String).join(" ")) },
  } as ConnectorGateDeps;
  const result = await gateConnectorRequest(new Request(`https://app.test/api/mcp/connettore/prova-a?q=${key}`, { method: "POST", body: "{}" }), "prova-a", deps);
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.equal(result.outcome, "token_in_url");
  assert.equal(result.response.status, 400);
  assert.ok(!(await result.response.text()).includes(key));
  assert.deepEqual([calls.config, calls.auth, calls.exposed], [0, 0, [hashIntegrationToken(key)]]);
  assert.ok(!logs.join("\n").includes("ub_ci_"));
});

test("le rotte della CI: ogni metodo passa dalle difese, la chiave nell'indirizzo si revoca prima del 400", () => {
  const kit = read("src/lib/use-cases/ci/route-kit.ts");
  const screen = kit.slice(kit.indexOf("export async function screenCiRequest("), kit.indexOf("export async function ciMethodNotAllowed("));
  const revoke = screen.indexOf("await revokeCiKeysInUrl(finding.candidates);");
  assert.ok(revoke > 0, "screenCiRequest revoca le chiavi della CI trovate nell'indirizzo");
  assert.ok(revoke < screen.indexOf('return ciError("chiave_nell_indirizzo");'), "prima di rispondere 400");
  assert.match(screen, /findTokenInUrl\(request\.url, \{ tokenPrefixes: TOKEN_PREFIXES \}\)/);
  assert.match(kit, /const TOKEN_PREFIXES = \[\.\.\.DEFAULT_TOKEN_PREFIXES, CLI_TOKEN_PREFIX, CLI_DEVICE_CODE_PREFIX\];/);
  // L'ordine di `openCi`: difese, 0042 (503), chiave (401), limiti (429), area.
  const open = kit.slice(kit.indexOf("export async function openCi("), kit.indexOf("export async function runCiWrite("));
  const order = ["screenCiRequest(", "ciKeysStoreReady(", "authenticateCiKey(", "consumeRateLimits(", "ciArea("].map((s) => open.indexOf(s));
  assert.ok(order.every((at) => at > 0), String(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "nell'ordine");
  // L'idempotenza della CLI, con la chiave della CI e mai il token di una persona.
  assert.match(kit, /principalKey: ciIdempotencyOwner\(opened\.principal\.keyId\), logScope: "ci"/);

  const casi = read("src/app/api/ci/casi/route.ts");
  assert.match(casi, /export async function GET\(request: Request\): Promise<Response> \{\n {2}const opened = await openCi\(request, \{ method: "GET", write: false \}\);/);
  assert.match(casi, /export async function POST\(request: Request\): Promise<Response> \{\n {2}return ciMethodNotAllowed\(request, "GET"\);/);
  const evals = read("src/app/api/ci/evals/route.ts");
  assert.match(evals, /export async function POST\(request: Request\): Promise<Response> \{\n {2}const opened = await openCi\(request, \{ method: "POST", write: true \}\);/);
  assert.match(evals, /export async function GET\(request: Request\): Promise<Response> \{\n {2}return ciMethodNotAllowed\(request, "POST"\);/);
  // La CI scrive senza persona, con la fonte `ci`.
  assert.match(evals, /actorUserId: null,/);
  assert.match(evals, /source: \{ kind: "ci", keyId: principal\.keyId, runUrl: run\.url, repo: principal\.repo \}/);
});

test("nei log delle rotte della CI solo codici dell'area ci: mai la console, mai il corpo o la chiave", () => {
  for (const path of ["src/lib/use-cases/ci/route-kit.ts", "src/lib/use-cases/ci/api.ts", "src/app/api/ci/casi/route.ts", "src/app/api/ci/evals/route.ts"]) {
    const text = read(path);
    assert.ok(!/console\.(log|info|warn|error|debug)\(/.test(text), path);
    for (const call of text.match(/logSafeError\([^)]*\)/g) ?? []) assert.match(call, /^logSafeError\("ci", "[a-z ]+", error\)$/, `${path}: ${call}`);
  }
});
