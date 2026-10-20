import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { SubmitContributionDeps } from "../portfolio/submit-contribution.ts";
import { hashIntegrationToken } from "./auth.ts";
import { EXAMPLE_CONNECTOR_PROFILE_INPUT, EXAMPLE_INSTRUCTIONS_TEMPLATE, exampleSubmission } from "./contract.fixtures.ts";
import type { ExposedTokenAlertDeps } from "./exposed-token-alert.ts";
import type { ConnectorHandlerDeps } from "./handler.ts";
import { EXAMPLE_GUIDE } from "./tools.fixtures.ts";

// Opt-in integration suite (prompt WP10 «isolamento», criterion 19): two synthetic
// workspaces, both with the connector on, their own token, prefix and guide, and the same
// contributions on both sides. Search, status, unknown_related_code, idempotency, guide,
// credentials, rate-limit buckets and a REST submission never cross from one workspace to
// the other. Real gate, token table, `connector_rate_limits`, shared submit service, search
// and status SQL, driven by the SDK client through the route handler in memory; ranking and
// notifications are dropped (no model, no network).
//   node scripts/connettore-test/run-db-tests.mjs
// Same guards as route.integration.test.ts. Synthetic data, created and deleted here; test
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

type Side = "a" | "b";
const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), user: randomUUID(), a: randomUUID(), b: randomUUID() };
const slugs: Record<Side, string> = { a: `k10-iso-a-${suffix}`, b: `k10-iso-b-${suffix}` };
const PREFIX: Record<Side, string> = { a: "IA", b: "IB" };
const tokens = {} as Record<Side | "restA", { token: string; id: string }>;
const TITLE = `Archivio dei verbali di cantiere ${suffix}`;
const SUBMITTER = { name: "Persona di prova dell'isolamento", email: `isolamento.${suffix}@esempio.test` };
const KEY = `k10-iso-${suffix}-0001`;
// B ha una guida diversa: senza l'agente «atlante» (parole chiave della riconciliazione).
const GUIDE_A = EXAMPLE_GUIDE;
const GUIDE_B = { ...EXAMPLE_GUIDE, agentCatalog: (EXAMPLE_GUIDE.agentCatalog as Array<{ id: string }>).filter((agent) => agent.id !== "atlante") };
const fakeAlertDeps: ExposedTokenAlertDeps = { findAdminChannel: async () => null, post: async () => undefined };

let deps: ConnectorHandlerDeps;
let handle: (request: Request, slug: string, deps: ConnectorHandlerDeps) => Promise<Response>;
let handleRest: typeof import("../portfolio/submission-http.ts").handlePortfolioSubmissionPost;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
const clients = {} as Record<Side, Client>;
const captured: string[] = [];
const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };

const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];
type Structured = Record<string, unknown>;
const other = (side: Side): Side => (side === "a" ? "b" : "a");

async function connect(slug: string, token: string) {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:53130/api/mcp/connettore/${slug}`), {
    fetch: async (input: string | URL, init?: RequestInit) => handle(new Request(input, init), slug, deps),
    requestInit: { headers: { authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: "isolamento-k10", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function call(side: Side, name: string, args: object) {
  const result = await clients[side].callTool({ name, arguments: args as Record<string, unknown> });
  return { isError: result.isError === true, content: result.structuredContent as Structured };
}

const submission = (overrides: Parameters<typeof exampleSubmission>[0] = {}) =>
  exampleSubmission({ idempotencyKey: KEY, title: TITLE, submittedBy: SUBMITTER, ...overrides });

const codesOf = (content: Structured) => ((content.results as Structured[]) ?? []).map((r) => String(r.code));
const bucket = async (name: string) => Number((await one(`SELECT coalesce(sum(count), 0)::int AS n FROM connector_rate_limits WHERE bucket = $1`, [name])).n);

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
  q = (text, params = []) => sql.query(text, params) as Promise<Record<string, unknown>[]>;
  const [integrations, appTools, handler, rest] = await Promise.all([
    import("../db/queries/workspace-integrations.ts"),
    import("./app-tools.ts"),
    import("./handler.ts"),
    import("../portfolio/submission-http.ts"),
  ]);
  handle = handler.handleConnectorRequest;
  handleRest = rest.handlePortfolioSubmissionPost;
  const submit: SubmitContributionDeps = { ...rest.appSubmitContributionDeps, autoScore: async () => { throw new Error("non usato"); }, notify: async () => {} };
  deps = appTools.appConnectorHandlerDeps({ schedule: () => {}, env: { MCP_CONNECTOR_ENABLED: "true" }, submit, alertDeps: fakeAlertDeps });

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova (isolamento)', $2)`, [ids.org, `org-k10-iso-${suffix}`]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Lateral Space di prova')`, [ids.user, `ls.k10.iso.${suffix}@ls.test`]);
  for (const side of ["a", "b"] as const) {
    await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [ids[side], ids.org, `Workspace isolamento ${side.toUpperCase()} ${suffix}`]);
    await q(
      `INSERT INTO workspace_connector_configs (workspace_id, slug, enabled, code_prefix, workspace_display_name, guide, guide_version, profile, instructions_template)
       VALUES ($1, $2, true, $3, $4, $5::jsonb, '2026-10.1', $6::jsonb, $7)`,
      [
        ids[side],
        slugs[side],
        PREFIX[side],
        side === "a" ? "Alfa" : "Beta",
        JSON.stringify(side === "a" ? GUIDE_A : GUIDE_B),
        JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT),
        EXAMPLE_INSTRUCTIONS_TEMPLATE,
      ]
    );
    const created = await integrations.createConnectorIntegrationToken({ workspaceId: ids[side], label: "Connettore di prova", createdByUserId: ids.user });
    tokens[side] = { token: created.token, id: created.row.id };
    clients[side] = await connect(slugs[side], tokens[side].token);
  }
  const restA = await integrations.createWorkspaceIntegrationToken({ workspaceId: ids.a, label: "REST di prova", createdByUserId: ids.user });
  tokens.restA = { token: restA.token, id: restA.row.id };
});

after(async () => {
  if (!enabled) return;
  for (const client of Object.values(clients)) await client.close();
  Object.assign(console, originalConsole);
  const patterns = [ids.a, ids.b, ...Object.values(tokens).map((t) => t.id)].map((p) => `%${p}%`);
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE ANY($1::text[])`, [patterns]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
});

test("stessa segnalazione con la stessa chiave nei due workspace: due segnalazioni, ognuna col codice del suo workspace, mai un duplicato dell'altro", opts, async () => {
  for (const side of ["a", "b"] as const) {
    const sent = await call(side, "submit_contribution", submission());
    assert.equal(sent.isError, false, String(sent.content.error));
    assert.equal(sent.content.duplicate, false, `${side}: la chiave dell'altro workspace non è un duplicato`);
    assert.equal(sent.content.code, `${PREFIX[side]}-0001`);
  }
  for (const side of ["a", "b"] as const) {
    const replay = await call(side, "submit_contribution", submission());
    assert.equal(replay.content.duplicate, true);
    assert.equal(replay.content.code, `${PREFIX[side]}-0001`, `${side}: il duplicato è la segnalazione del proprio workspace`);
  }
  const rows = await q(
    `SELECT s.workspace_id, u.workspace_id AS use_case_workspace, u.code
       FROM external_contribution_submissions s JOIN use_cases u ON u.id = s.use_case_id
      WHERE s.idempotency_key = $1 ORDER BY u.code`,
    [KEY]
  );
  assert.deepEqual(
    rows.map((r) => [r.workspace_id, r.use_case_workspace, r.code]),
    [
      [ids.a, ids.a, "IA-0001"],
      [ids.b, ids.b, "IB-0001"],
    ]
  );
  // Una seconda segnalazione per lato: i contatori dei codici sono separati.
  for (const side of ["a", "b"] as const) {
    const sent = await call(side, "submit_contribution", submission({ idempotencyKey: `${KEY}-${side}2`, title: `Promemoria delle scadenze dei documenti di cantiere ${suffix}` }));
    assert.equal(sent.content.code, `${PREFIX[side]}-0002`);
  }
});

test("ricerca: ognuno trova solo le sue segnalazioni e gli agenti della sua guida", opts, async () => {
  for (const side of ["a", "b"] as const) {
    const found = await call(side, "find_similar_contributions", { query: "verbali cantiere archivio scadenze" });
    assert.equal(found.isError, false);
    const codes = codesOf(found.content);
    assert.deepEqual([...codes].sort(), [`${PREFIX[side]}-0001`, `${PREFIX[side]}-0002`], side);
    assert.ok(codes.every((code) => !code.startsWith(PREFIX[other(side)])), side);
  }
  const agents = async (side: Side) =>
    ((await call(side, "find_similar_contributions", { query: "riconciliazione fatture fornitori" })).content.matchingAgents as Structured[]).map((a) => a.id);
  assert.ok((await agents("a")).includes("atlante"));
  assert.equal((await agents("b")).includes("atlante"), false, "B non riceve gli agenti della guida di A");
});

test("stato per codice: il codice dell'altro workspace è not_found, anche con lo stesso numero; nascondere in A non tocca B", opts, async () => {
  for (const side of ["a", "b"] as const) {
    const own = await call(side, "get_contribution_status", { code: `${PREFIX[side]}-0001` });
    assert.equal(own.isError, false);
    assert.equal(own.content.title, TITLE);
    const foreign = await call(side, "get_contribution_status", { code: `${PREFIX[other(side)]}-0001` });
    assert.equal(foreign.isError, true);
    assert.equal(foreign.content.error, "not_found");
    assert.deepEqual(Object.keys(foreign.content).sort(), ["error", "message"]);
  }
  await q(`UPDATE use_cases SET intake = coalesce(intake, '{}'::jsonb) || '{"hiddenFromSearch": true}'::jsonb WHERE workspace_id = $1 AND code = 'IA-0001'`, [ids.a]);
  try {
    assert.equal((await call("a", "get_contribution_status", { code: "IA-0001" })).content.title, null);
    assert.equal((await call("b", "get_contribution_status", { code: "IB-0001" })).content.title, TITLE);
    assert.equal(codesOf((await call("a", "find_similar_contributions", { query: "verbali cantiere archivio" })).content).includes("IA-0001"), false);
    assert.ok(codesOf((await call("b", "find_similar_contributions", { query: "verbali cantiere archivio" })).content).includes("IB-0001"));
  } finally {
    await q(`UPDATE use_cases SET intake = intake - 'hiddenFromSearch' WHERE workspace_id = $1 AND code = 'IA-0001'`, [ids.a]);
  }
});

test("collegamenti: un codice dell'altro workspace dà unknown_related_code; il proprio si collega", opts, async () => {
  for (const side of ["a", "b"] as const) {
    const foreign = await call(side, "submit_contribution", submission({ idempotencyKey: `${KEY}-${side}-rel1`, relatedCode: `${PREFIX[other(side)]}-0002`, relationType: "integra" }));
    assert.equal(foreign.isError, true);
    assert.equal(foreign.content.error, "unknown_related_code");
    const own = await call(side, "submit_contribution", submission({ idempotencyKey: `${KEY}-${side}-rel2`, relatedCode: `${PREFIX[side]}-0002`, relationType: "integra" }));
    assert.equal(own.isError, false, String(own.content.error));
    assert.equal(own.content.statusCode, "POSSIBILE_DOPPIONE");
    const row = await one(`SELECT intake ->> 'possibleDuplicateOf' AS dup FROM use_cases WHERE workspace_id = $1 AND code = $2`, [ids[side], own.content.code]);
    assert.equal(row.dup, `${PREFIX[side]}-0002`);
  }
});

test("guida: ognuno riceve la sua", opts, async () => {
  const catalog = async (side: Side) => ((await call(side, "get_intake_guide", {})).content.agentCatalog as Structured[]).map((a) => a.id);
  assert.deepEqual(await catalog("a"), (GUIDE_A.agentCatalog as Structured[]).map((a) => a.id));
  assert.deepEqual(await catalog("b"), (GUIDE_B.agentCatalog as Structured[]).map((a) => a.id));
});

test("credenziali e limiti: il token di un workspace non apre l'altro; ogni workspace ha i suoi secchi", opts, async () => {
  const listTools = (slug: string, token: string) =>
    handle(
      new Request(`http://127.0.0.1:53130/api/mcp/connettore/${slug}`, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      slug,
      deps
    );
  for (const side of ["a", "b"] as const) {
    const crossed = await listTools(slugs[other(side)], tokens[side].token);
    assert.equal(crossed.status, 401);
    assert.equal(await crossed.text(), JSON.stringify({ error: "unauthorized" }));
    assert.equal((await listTools(slugs[side], tokens[side].token)).status, 200);
  }
  // Ogni lato ha fatto gli stessi invii riusciti (2 nuovi, 2 duplicati che non contano, 1 collegato;
  // il codice dell'altro workspace si ferma prima del limite): 3 per token e per giorno del workspace.
  for (const side of ["a", "b"] as const) {
    assert.equal(await bucket(`conn:${tokens[side].id}:submit`), 3, side);
    assert.equal(await bucket(`conn:ws:${ids[side]}:submit:day`), 3, side);
  }
});

test("REST: un invio con il token REST di A resta in A; B non lo trova né per codice né con la ricerca", opts, async () => {
  const restTitle = `Registro delle consegne di magazzino ${suffix}`;
  const response = await handleRest(
    new Request("http://127.0.0.1/api/mcp/portfolio/submissions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${tokens.restA.token}` },
      body: JSON.stringify({
        idempotencyKey: `k10-iso-rest-${suffix}`,
        confirmedByUser: true,
        contributionKind: "best_practice",
        submittedBy: { name: "Persona REST di prova" },
        title: restTitle,
        problem: "Le consegne di magazzino si registrano a mano su un foglio condiviso.",
        flowDescription: "Un assistente compila il registro dalle bolle di consegna.",
        humanInTheLoop: "Chi riceve la merce controlla il registro a fine giornata.",
        expectedImpact: "Meno tempo per la registrazione delle consegne.",
        dataRequirements: "Bolle di consegna in PDF.",
      }),
    }),
    { schedule: () => {}, deps: { autoScore: async () => { throw new Error("non usato"); }, notify: async () => {} } }
  );
  assert.equal(response.status, 201);
  const row = await one(`SELECT workspace_id, code FROM use_cases WHERE title = $1`, [restTitle]);
  assert.equal(row.workspace_id, ids.a);
  assert.match(String(row.code), /^IA-\d{4}$/);
  assert.ok(codesOf((await call("a", "find_similar_contributions", { query: "registro consegne magazzino" })).content).includes(String(row.code)));
  assert.deepEqual(codesOf((await call("b", "find_similar_contributions", { query: "registro consegne magazzino" })).content), []);
  assert.equal((await call("b", "get_contribution_status", { code: String(row.code) })).content.error, "not_found");
});

test("log dell'isolamento: nessun token, hash, testo della segnalazione, nome o email", opts, () => {
  const secrets = Object.values(tokens).flatMap((t) => [t.token, hashIntegrationToken(t.token)]);
  for (const line of captured) {
    for (const secret of secrets) assert.equal(line.includes(secret), false, "token nel log");
    for (const text of [TITLE, SUBMITTER.name, SUBMITTER.email, "verbali di cantiere", "consegne di magazzino"]) assert.equal(line.includes(text), false, "testo nel log");
  }
  assert.ok(captured.some((line) => line.startsWith("[mcp] call ") && line.includes('"outcome":"unknown_related_code"')));
});
