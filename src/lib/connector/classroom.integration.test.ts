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

// Opt-in integration suite (prompt WP10, criteria 6 and 9 on the real route): a class of 30
// people in the same hour on the one organisation token of phase 1, each with an SDK client
// (initialize, tools/list, guide, two searches, one submission, one status), never receives
// rate_limited; then, with 200 submissions in the hour, the 201st gets rate_limited with
// retryAfterSeconds up to the end of the hour, while a replay of an earlier submission still
// gets duplicate: true and reads stay free. Real gate, token table, `connector_rate_limits`,
// shared submit service and codes, driven through the route handler in memory; ranking and
// notifications are dropped (no model, no network).
//   node scripts/connettore-test/run-db-tests.mjs
// Same guards as route.integration.test.ts. Synthetic data, created and deleted here; the
// test token is generated at run time and never printed.
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

const suffix = randomBytes(3).toString("hex");
const ids = { org: randomUUID(), user: randomUUID(), ws: randomUUID() };
const slug = `k10-aula-${suffix}`;
const PEOPLE = 30;
const SUBMITS_PER_HOUR = 200;
const fakeAlertDeps: ExposedTokenAlertDeps = { findAdminChannel: async () => null, post: async () => undefined };

let deps: ConnectorHandlerDeps;
let handle: (request: Request, slug: string, deps: ConnectorHandlerDeps) => Promise<Response>;
let q: (text: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;
let token = { token: "", id: "" };
const captured: string[] = [];
const originalConsole = { log: console.log, info: console.info, warn: console.warn, error: console.error };

const one = async (text: string, params: unknown[] = []) => (await q(text, params))[0];
type Structured = Record<string, unknown>;

async function connect() {
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:53130/api/mcp/connettore/${slug}`), {
    fetch: async (input: string | URL, init?: RequestInit) => handle(new Request(input, init), slug, deps),
    requestInit: { headers: { authorization: `Bearer ${token.token}` } },
  });
  const client = new Client({ name: "aula-k10", version: "1.0.0" });
  await client.connect(transport);
  return client;
}

async function call(client: Client, name: string, args: object) {
  const result = await client.callTool({ name, arguments: args as Record<string, unknown> });
  return { isError: result.isError === true, content: result.structuredContent as Structured };
}

async function rawCall(id: number, name: string, args: object) {
  const response = await handle(
    new Request(`http://127.0.0.1:53130/api/mcp/connettore/${slug}`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token.token}` },
      body: JSON.stringify({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } }),
    }),
    slug,
    deps
  );
  assert.equal(response.status, 200);
  const json = (await response.json()) as { result: { isError?: boolean; structuredContent: Structured } };
  return { isError: json.result.isError === true, content: json.result.structuredContent };
}

const bucket = async (name: string) => Number((await one(`SELECT coalesce(sum(count), 0)::int AS n FROM connector_rate_limits WHERE bucket = $1`, [name])).n);
const titleOf = (n: number) => `Bozza delle risposte ricorrenti, aula ${suffix} numero ${String(n).padStart(3, "0")}`;
const personSubmission = (n: number) =>
  exampleSubmission({ idempotencyKey: `k10-aula-${suffix}-${n}`, title: titleOf(n), submittedBy: { name: `Persona ${n} dell'aula` } });

/** Seconds left in the current hour on the database clock (the bucket windows use it). */
async function secondsLeftInHour() {
  return Number((await one(`SELECT ceil(extract(epoch FROM (date_trunc('hour', now()) + interval '1 hour' - now())))::int AS s`)).s);
}

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
  const submit: SubmitContributionDeps = { ...rest.appSubmitContributionDeps, autoScore: async () => { throw new Error("non usato"); }, notify: async () => {} };
  // Ranking e notifiche dopo la risposta: qui non partono.
  deps = appTools.appConnectorHandlerDeps({ schedule: () => {}, env: { MCP_CONNECTOR_ENABLED: "true" }, submit, alertDeps: fakeAlertDeps });

  await q(`INSERT INTO organizations (id, name, slug) VALUES ($1, 'Organizzazione di prova (aula)', $2)`, [ids.org, `org-k10-aula-${suffix}`]);
  await q(`INSERT INTO users (id, email, name) VALUES ($1, $2, 'Lateral Space di prova')`, [ids.user, `ls.k10.aula.${suffix}@ls.test`]);
  await q(`INSERT INTO workspaces (id, organization_id, name) VALUES ($1, $2, $3)`, [ids.ws, ids.org, `Workspace aula ${suffix}`]);
  // Limiti predefiniti di fase 1 (colonna con il suo DEFAULT): 200 invii e 3.000 letture l'ora.
  await q(
    `INSERT INTO workspace_connector_configs (workspace_id, slug, enabled, code_prefix, workspace_display_name, guide, guide_version, profile, instructions_template)
     VALUES ($1, $2, true, 'AU', 'Alfa e Beta', $3::jsonb, '2026-10.1', $4::jsonb, $5)`,
    [ids.ws, slug, JSON.stringify(EXAMPLE_GUIDE), JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT), EXAMPLE_INSTRUCTIONS_TEMPLATE]
  );
  const created = await integrations.createConnectorIntegrationToken({ workspaceId: ids.ws, label: "Connettore dell'aula", createdByUserId: ids.user });
  token = { token: created.token, id: created.row.id };
});

after(async () => {
  if (!enabled) return;
  Object.assign(console, originalConsole);
  await q(`DELETE FROM connector_rate_limits WHERE bucket LIKE ANY($1::text[])`, [[`%${token.id}%`, `%${ids.ws}%`]]);
  await q(`DELETE FROM organizations WHERE id = $1`, [ids.org]);
  await q(`DELETE FROM users WHERE id = $1`, [ids.user]);
});

test("aula: 30 persone sullo stesso token in un'ora, ognuna con guida, due ricerche, un invio e uno stato → mai rate_limited; poi il 201° invio → rate_limited", opts, async (t) => {
  // Tutta la prova sta nella stessa finestra di un'ora: vicino al cambio d'ora si aspetta la prossima.
  const left = await secondsLeftInHour();
  if (left < 150) {
    t.diagnostic(`attesa di ${left + 2} s per stare in una sola finestra oraria`);
    await new Promise((resolve) => setTimeout(resolve, (left + 2) * 1000));
  }

  const codes: string[] = [];
  for (let n = 1; n <= PEOPLE; n += 1) {
    const client = await connect();
    assert.equal((await client.listTools()).tools.length, 4);
    const outcomes = [
      await call(client, "get_intake_guide", {}),
      await call(client, "find_similar_contributions", { query: "bozze risposte ricorrenti" }),
      await call(client, "find_similar_contributions", { query: "riconciliazione fatture fornitori" }),
    ];
    const sent = await call(client, "submit_contribution", personSubmission(n));
    outcomes.push(sent, await call(client, "get_contribution_status", { code: String(sent.content.code) }));
    for (const [i, out] of outcomes.entries()) assert.equal(out.isError, false, `persona ${n}, chiamata ${i + 1}: ${String(out.content.error)}`);
    assert.equal(sent.content.duplicate, false);
    codes.push(String(sent.content.code));
    await client.close();
  }
  assert.equal(new Set(codes).size, PEOPLE);
  assert.deepEqual(codes.slice(0, 2), ["AU-0001", "AU-0002"]);
  // initialize, notifications/initialized e tools/list non contano: 4 letture e 1 invio a persona.
  assert.equal(await bucket(`conn:${token.id}:read`), PEOPLE * 4);
  assert.equal(await bucket(`conn:${token.id}:submit`), PEOPLE);
  assert.equal(await bucket(`conn:ws:${ids.ws}:submit:day`), PEOPLE);

  // Fino a 200 invii nell'ora dalla stessa credenziale.
  for (let n = PEOPLE + 1; n <= SUBMITS_PER_HOUR; n += 1) {
    const out = await rawCall(n, "submit_contribution", personSubmission(n));
    assert.equal(out.isError, false, `invio ${n}: ${String(out.content.error)}`);
  }
  assert.equal(await bucket(`conn:${token.id}:submit`), SUBMITS_PER_HOUR);

  // Il 201°: rate_limited con retryAfterSeconds fino alla fine dell'ora, nel formato del contratto.
  const limited = await rawCall(1000, "submit_contribution", personSubmission(SUBMITS_PER_HOUR + 1));
  const toEnd = await secondsLeftInHour();
  assert.equal(limited.isError, true);
  assert.equal(limited.content.error, "rate_limited");
  assert.deepEqual(Object.keys(limited.content).sort(), ["error", "message", "retryAfterSeconds"]);
  const retry = Number(limited.content.retryAfterSeconds);
  assert.ok(retry > 0 && retry <= 3600, String(retry));
  assert.ok(Math.abs(retry - toEnd) <= 5, `${retry} vs ${toEnd}`);
  // Il duplicato di un invio dell'aula passa anche a secchio pieno, senza consumare.
  const replay = await rawCall(1001, "submit_contribution", personSubmission(1));
  assert.equal(replay.isError, false);
  assert.equal(replay.content.duplicate, true);
  assert.equal(replay.content.code, codes[0]);
  // Le letture hanno il loro secchio.
  const status = await rawCall(1002, "get_contribution_status", { code: codes[0] });
  assert.equal(status.isError, false);
  assert.equal(await bucket(`conn:${token.id}:submit`), SUBMITS_PER_HOUR);
  assert.equal(await bucket(`conn:${token.id}:read`), PEOPLE * 4 + 1);
  const rows = await one(`SELECT count(*)::int AS n FROM use_cases WHERE workspace_id = $1`, [ids.ws]);
  assert.equal(Number(rows.n), SUBMITS_PER_HOUR);
});

test("log dell'aula: nessun token, hash, titolo o nome", opts, () => {
  const secrets = [token.token, hashIntegrationToken(token.token)];
  for (const line of captured) {
    for (const secret of secrets) assert.equal(line.includes(secret), false, "token nel log");
    for (const text of [`aula ${suffix}`, "dell'aula", "proponente@esempio.test"]) assert.equal(line.includes(text), false, "testo nel log");
  }
  assert.ok(captured.some((line) => line.startsWith("[mcp] call ") && line.includes('"outcome":"rate_limited"')));
});
